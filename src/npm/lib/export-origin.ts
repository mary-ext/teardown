import type {
	BindingIdentifier,
	BindingPattern,
	BindingRestElement,
	ModuleExportName,
	Program,
} from '@oxc-project/types';

// #region types

/**
 * the resolved origin of a single named export.
 * - `module`: traced to the module that defines (or namespaces) the binding.
 * - `ambiguous`: a bare `export *` resolved the name to more than one module.
 * - `unknown`: the name could not be traced (external, cjs, parse failure, or missing).
 */
export type ExportOrigin =
	| { id: string; kind: 'module' }
	| { ids: string[]; kind: 'ambiguous' }
	| { kind: 'unknown' };

/**
 * source access for the tracer, injected so it stays pure and testable.
 */
export interface ModuleReader {
	/**
	 * parses a module's source into an AST. injected so the tracer pulls in no parser
	 * of its own — the worker reuses rolldown's plugin-context parser.
	 * @param source the module source text
	 * @param id the resolved module id (e.g. for extension-based language inference)
	 * @returns the parsed program
	 * @throws if the source cannot be parsed
	 */
	parse: (source: string, id: string) => Program;
	/**
	 * resolves an import specifier relative to an importer module.
	 * @param specifier the import specifier (e.g. "./foo.js")
	 * @param importer the resolved id of the importing module
	 * @returns the resolved module id, or null if it cannot be resolved
	 */
	resolve: (specifier: string, importer: string) => Promise<string | null> | string | null;
	/**
	 * reads a module's source.
	 * @param id the resolved module id
	 * @returns the source text, or null if it cannot be read
	 */
	readFile: (id: string) => Promise<string | null> | string | null;
}

/** how a name exported by a module is produced within that module. */
type LocalBinding =
	| { imported: string; kind: 'import'; source: string }
	| { kind: 'importDefault'; source: string }
	| { kind: 'importStar'; source: string }
	| { kind: 'local' };

/** the export surface of a single module. */
interface ModuleExports {
	/** export name -> local binding defined or bound within this module */
	direct: Map<string, LocalBinding>;
	/** export name -> `export { imported as name } from source` */
	reExport: Map<string, { imported: string; source: string }>;
	/** sources of bare `export * from source` */
	star: string[];
	/** export name -> source for `export * as name from source` */
	starAs: Map<string, string>;
}

/**
 * internal trace result, finer-grained than {@link ExportOrigin} so that bare-star
 * resolution can tell "definitely not exported here" (`notFound`) apart from
 * "could not be determined" (`indeterminate`) — the latter must taint a star result
 * rather than be silently dropped.
 */
type Resolution =
	| { id: string; kind: 'module' }
	| { ids: string[]; kind: 'ambiguous' }
	| { kind: 'indeterminate' }
	| { kind: 'notFound' };

// #endregion

// #region parsing

/** extracts the string name from an export/binding identifier or string-literal name. */
function nameOf(node: BindingIdentifier | ModuleExportName): string | null {
	if (node.type === 'Identifier') {
		return node.name;
	}
	// string-literal name, e.g. export { x as 'a-b' }
	return typeof node.value === 'string' ? node.value : null;
}

/** collects every identifier bound by a (possibly destructured) binding pattern. */
function collectPatternNames(node: BindingPattern | BindingRestElement): string[] {
	switch (node.type) {
		case 'ArrayPattern': {
			return node.elements.flatMap((element) => (element ? collectPatternNames(element) : []));
		}
		case 'AssignmentPattern': {
			return collectPatternNames(node.left);
		}
		case 'Identifier': {
			return [node.name];
		}
		case 'ObjectPattern': {
			return node.properties.flatMap((property) =>
				property.type === 'RestElement'
					? collectPatternNames(property.argument)
					: collectPatternNames(property.value),
			);
		}
		case 'RestElement': {
			return collectPatternNames(node.argument);
		}
	}
}

/** collects the export surface of a parsed module, ignoring type-only constructs. */
function analyzeModuleExports(program: Program): ModuleExports {
	const direct = new Map<string, LocalBinding>();
	const reExport = new Map<string, { imported: string; source: string }>();
	const star: string[] = [];
	const starAs = new Map<string, string>();

	// local name -> import binding, collected first since imports are hoisted
	const imports = new Map<string, LocalBinding>();
	for (const node of program.body) {
		if (node.type !== 'ImportDeclaration' || node.importKind === 'type') {
			continue;
		}

		const source = node.source.value;
		for (const spec of node.specifiers) {
			switch (spec.type) {
				case 'ImportDefaultSpecifier': {
					imports.set(spec.local.name, { kind: 'importDefault', source });
					break;
				}
				case 'ImportNamespaceSpecifier': {
					imports.set(spec.local.name, { kind: 'importStar', source });
					break;
				}
				case 'ImportSpecifier': {
					if (spec.importKind === 'type') {
						break;
					}
					const imported = nameOf(spec.imported);
					if (imported !== null) {
						imports.set(spec.local.name, { imported, kind: 'import', source });
					}
					break;
				}
			}
		}
	}

	for (const node of program.body) {
		// export default ...
		if (node.type === 'ExportDefaultDeclaration') {
			direct.set('default', { kind: 'local' });
			continue;
		}

		// export * from source  /  export * as ns from source
		if (node.type === 'ExportAllDeclaration') {
			if (node.exported) {
				const name = nameOf(node.exported);
				if (name !== null) {
					starAs.set(name, node.source.value);
				}
			} else {
				star.push(node.source.value);
			}
			continue;
		}

		if (node.type !== 'ExportNamedDeclaration' || node.exportKind === 'type') {
			continue;
		}

		// export { a as b } from source
		if (node.source) {
			const source = node.source.value;
			for (const spec of node.specifiers) {
				if (spec.exportKind === 'type') {
					continue;
				}
				const exported = nameOf(spec.exported);
				const imported = nameOf(spec.local);
				if (exported !== null && imported !== null) {
					reExport.set(exported, { imported, source });
				}
			}
			continue;
		}

		// export const/function/class/enum ...
		const decl = node.declaration;
		if (decl) {
			if (decl.type === 'VariableDeclaration') {
				for (const declarator of decl.declarations) {
					for (const name of collectPatternNames(declarator.id)) {
						direct.set(name, { kind: 'local' });
					}
				}
			} else if (
				(decl.type === 'ClassDeclaration' ||
					decl.type === 'FunctionDeclaration' ||
					decl.type === 'TSEnumDeclaration') &&
				decl.id
			) {
				direct.set(decl.id.name, { kind: 'local' });
			}
		}

		// export { local as exported } — bound either to an import or a local declaration
		for (const spec of node.specifiers) {
			if (spec.exportKind === 'type') {
				continue;
			}
			const exported = nameOf(spec.exported);
			const local = nameOf(spec.local);
			if (exported === null || local === null) {
				continue;
			}

			direct.set(exported, imports.get(local) ?? { kind: 'local' });
		}
	}

	return { direct, reExport, star, starAs };
}

// #endregion

// #region tracing

/** reads and parses a module's export surface, memoized; null if unreadable or unparseable. */
async function getModuleExports(
	reader: ModuleReader,
	cache: Map<string, ModuleExports | null>,
	id: string,
): Promise<ModuleExports | null> {
	{
		const cached = cache.get(id);
		if (cached !== undefined) {
			return cached;
		}
	}

	let result: ModuleExports | null = null;
	const source = await reader.readFile(id);
	if (source !== null) {
		try {
			result = analyzeModuleExports(reader.parse(source, id));
		} catch {
			result = null;
		}
	}

	cache.set(id, result);
	return result;
}

/** traces a single export name from a module to the module that defines it. */
async function resolveName(
	reader: ModuleReader,
	cache: Map<string, ModuleExports | null>,
	id: string,
	name: string,
	visited: Set<string>,
): Promise<Resolution> {
	const key = `${id}\0${name}`;
	if (visited.has(key)) {
		return { kind: 'notFound' };
	}
	visited.add(key);

	const exports = await getModuleExports(reader, cache, id);
	if (!exports) {
		return { kind: 'indeterminate' };
	}

	// export { imported as name } from source
	const re = exports.reExport.get(name);
	if (re) {
		const target = await reader.resolve(re.source, id);
		return target !== null
			? resolveName(reader, cache, target, re.imported, visited)
			: { kind: 'indeterminate' };
	}

	// export * as name from source — the whole namespaced module is the origin
	const ns = exports.starAs.get(name);
	if (ns !== undefined) {
		const target = await reader.resolve(ns, id);
		return target !== null ? { id: target, kind: 'module' } : { kind: 'indeterminate' };
	}

	// defined or bound locally
	const binding = exports.direct.get(name);
	if (binding) {
		switch (binding.kind) {
			case 'import': {
				const target = await reader.resolve(binding.source, id);
				return target !== null
					? resolveName(reader, cache, target, binding.imported, visited)
					: { kind: 'indeterminate' };
			}
			case 'importDefault': {
				const target = await reader.resolve(binding.source, id);
				return target !== null
					? resolveName(reader, cache, target, 'default', visited)
					: { kind: 'indeterminate' };
			}
			case 'importStar': {
				const target = await reader.resolve(binding.source, id);
				return target !== null ? { id: target, kind: 'module' } : { kind: 'indeterminate' };
			}
			case 'local': {
				return { id, kind: 'module' };
			}
		}
	}

	// bare `export *` never re-exports the default binding
	if (name === 'default') {
		return { kind: 'notFound' };
	}

	// not found directly — try bare `export *` sources, each on an independent branch
	let indeterminate = false;
	const found = new Set<string>();
	for (const source of exports.star) {
		// oxlint-disable-next-line no-await-in-loop
		const target = await reader.resolve(source, id);
		if (target === null) {
			indeterminate = true;
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const origin = await resolveName(reader, cache, target, name, new Set(visited));
		switch (origin.kind) {
			case 'ambiguous': {
				for (const candidate of origin.ids) {
					found.add(candidate);
				}
				break;
			}
			case 'indeterminate': {
				indeterminate = true;
				break;
			}
			case 'module': {
				found.add(origin.id);
				break;
			}
			case 'notFound': {
				break;
			}
		}
	}

	if (found.size > 1) {
		return { ids: [...found], kind: 'ambiguous' };
	}
	// an indeterminate branch may also export this name, so a lone hit can't be trusted
	if (indeterminate) {
		return { kind: 'indeterminate' };
	}
	if (found.size === 1) {
		return { id: found.values().next().value!, kind: 'module' };
	}

	return { kind: 'notFound' };
}

/** collapses an internal {@link Resolution} to the public {@link ExportOrigin}. */
function toOrigin(resolution: Resolution): ExportOrigin {
	switch (resolution.kind) {
		case 'ambiguous': {
			return { ids: resolution.ids, kind: 'ambiguous' };
		}
		case 'indeterminate':
		case 'notFound': {
			return { kind: 'unknown' };
		}
		case 'module': {
			return { id: resolution.id, kind: 'module' };
		}
	}
}

/**
 * traces each named export of an entry module back to the module that defines it,
 * following re-export barrels, aliases, namespace exports, and `export *` chains.
 *
 * @param reader source access for reading and resolving modules
 * @param entryId the resolved id of the entry module to trace from
 * @param names the export names to trace
 * @returns a map from each requested name to its resolved origin
 */
export async function resolveExportOrigins(
	reader: ModuleReader,
	entryId: string,
	names: string[],
): Promise<Map<string, ExportOrigin>> {
	const cache = new Map<string, ModuleExports | null>();
	const origins = new Map<string, ExportOrigin>();
	for (const name of names) {
		// oxlint-disable-next-line no-await-in-loop
		origins.set(name, toOrigin(await resolveName(reader, cache, entryId, name, new Set())));
	}

	return origins;
}

// #endregion
