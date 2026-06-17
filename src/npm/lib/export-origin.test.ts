import { parseAst, type ParserOptions } from '@rolldown/browser/parseAst';
import { describe, expect, it } from 'vitest';

import { type ExportOrigin, type ModuleReader, resolveExportOrigins } from './export-origin';

// #region helpers

/** picks parser options from a module id's extension; null lets the parser use JS defaults. */
function parserOptionsFor(id: string): ParserOptions | null {
	if (/\.[mc]?tsx?$/.test(id)) {
		return { lang: id.endsWith('x') ? 'tsx' : 'ts' };
	}
	if (id.endsWith('.jsx')) {
		return { lang: 'jsx' };
	}

	return null;
}

/** normalizes a relative specifier against an importer's directory. */
function joinPath(importer: string, specifier: string): string {
	const fromDir = importer.slice(0, importer.lastIndexOf('/'));
	const out: string[] = [];
	for (const part of `${fromDir}/${specifier}`.split('/')) {
		if (part === '' || part === '.') {
			continue;
		}
		if (part === '..') {
			out.pop();
		} else {
			out.push(part);
		}
	}

	return `/${out.join('/')}`;
}

/** builds a reader over an in-memory file map, resolving relative specifiers with extension/index fallbacks. */
function makeReader(files: Record<string, string>): ModuleReader {
	return {
		parse: (source, id) => parseAst(source, parserOptionsFor(id), id),
		readFile: (id) => files[id] ?? null,
		resolve: (specifier, importer) => {
			// bare specifiers are treated as unresolvable (external)
			if (!specifier.startsWith('.')) {
				return null;
			}

			const base = joinPath(importer, specifier);
			for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
				if (candidate in files) {
					return candidate;
				}
			}

			return null;
		},
	};
}

function trace(
	files: Record<string, string>,
	names: string[],
	entry = '/pkg/index.js',
): Promise<Map<string, ExportOrigin>> {
	return resolveExportOrigins(makeReader(files), entry, names);
}

// #endregion

describe('resolveExportOrigins', () => {
	it('traces a locally declared export to the entry module', async () => {
		const files = { '/pkg/index.js': 'export const foo = 1;\nexport function bar() {}\nexport class Baz {}' };
		const origins = await trace(files, ['Baz', 'bar', 'foo']);
		expect(origins.get('foo')).toEqual({ id: '/pkg/index.js', kind: 'module' });
		expect(origins.get('bar')).toEqual({ id: '/pkg/index.js', kind: 'module' });
		expect(origins.get('Baz')).toEqual({ id: '/pkg/index.js', kind: 'module' });
	});

	it('traces a re-exported name to its defining submodule', async () => {
		const files = {
			'/pkg/foo.js': 'export const foo = 1;',
			'/pkg/index.js': "export { foo } from './foo.js';",
		};
		expect((await trace(files, ['foo'])).get('foo')).toEqual({ id: '/pkg/foo.js', kind: 'module' });
	});

	it('follows an alias on a re-export', async () => {
		const files = {
			'/pkg/foo.js': 'export const foo = 1;',
			'/pkg/index.js': "export { foo as bar } from './foo.js';",
		};
		expect((await trace(files, ['bar'])).get('bar')).toEqual({ id: '/pkg/foo.js', kind: 'module' });
	});

	it('traces a default re-exported as a named export', async () => {
		const files = {
			'/pkg/alpha.js': 'export default function alpha() {}',
			'/pkg/index.js': "export { default as alpha } from './alpha.js';",
		};
		expect((await trace(files, ['alpha'])).get('alpha')).toEqual({ id: '/pkg/alpha.js', kind: 'module' });
	});

	it('traces a bare default re-export', async () => {
		const files = {
			'/pkg/index.js': "export { default } from './x.js';",
			'/pkg/x.js': 'export default 42;',
		};
		expect((await trace(files, ['default'])).get('default')).toEqual({ id: '/pkg/x.js', kind: 'module' });
	});

	it('follows an imported binding that is then re-exported', async () => {
		const files = {
			'/pkg/index.js': "import { x as y } from './m.js';\nexport { y as z };",
			'/pkg/m.js': 'export const x = 1;',
		};
		expect((await trace(files, ['z'])).get('z')).toEqual({ id: '/pkg/m.js', kind: 'module' });
	});

	it('follows an imported default that is then re-exported', async () => {
		const files = {
			'/pkg/index.js': "import d from './m.js';\nexport { d as z };",
			'/pkg/m.js': 'export default 1;',
		};
		expect((await trace(files, ['z'])).get('z')).toEqual({ id: '/pkg/m.js', kind: 'module' });
	});

	it('treats a namespace import re-export as the namespaced module', async () => {
		const files = {
			'/pkg/index.js': "import * as ns from './m.js';\nexport { ns as z };",
			'/pkg/m.js': 'export const a = 1;',
		};
		expect((await trace(files, ['z'])).get('z')).toEqual({ id: '/pkg/m.js', kind: 'module' });
	});

	it('treats export * as ns as the namespaced module', async () => {
		const files = {
			'/pkg/index.js': "export * as ns from './m.js';",
			'/pkg/m.js': 'export const a = 1;',
		};
		expect((await trace(files, ['ns'])).get('ns')).toEqual({ id: '/pkg/m.js', kind: 'module' });
	});

	it('resolves a name through a bare export *', async () => {
		const files = {
			'/pkg/index.js': "export * from './m.js';",
			'/pkg/m.js': 'export const a = 1;',
		};
		expect((await trace(files, ['a'])).get('a')).toEqual({ id: '/pkg/m.js', kind: 'module' });
	});

	it('traces through a multi-hop barrel chain', async () => {
		const files = {
			'/pkg/index.js': "export { thing } from './mid.js';",
			'/pkg/leaf.js': 'export const thing = 1;',
			'/pkg/mid.js': "export { thing } from './leaf.js';",
		};
		expect((await trace(files, ['thing'])).get('thing')).toEqual({ id: '/pkg/leaf.js', kind: 'module' });
	});

	it('reports ambiguity when two star sources resolve the same name', async () => {
		const files = {
			'/pkg/a.js': 'export const dup = 1;',
			'/pkg/b.js': 'export const dup = 2;',
			'/pkg/index.js': "export * from './a.js';\nexport * from './b.js';",
		};
		const origin = (await trace(files, ['dup'])).get('dup');
		expect(origin?.kind).toBe('ambiguous');
		expect(origin).toEqual({ ids: expect.arrayContaining(['/pkg/a.js', '/pkg/b.js']), kind: 'ambiguous' });
	});

	it('does not re-export default through a bare export *', async () => {
		const files = {
			'/pkg/impl.js': 'export default 1;\nexport const named = 2;',
			'/pkg/index.js': "export * from './impl.js';",
		};
		const origins = await trace(files, ['default', 'named']);
		// bare `export *` carries `named` but never `default`
		expect(origins.get('named')).toEqual({ id: '/pkg/impl.js', kind: 'module' });
		expect(origins.get('default')).toEqual({ kind: 'unknown' });
	});

	it('still resolves default via an explicit re-export alongside a bare star', async () => {
		const files = {
			'/pkg/impl.js': 'export default 1;',
			'/pkg/index.js': "export * from './other.js';\nexport { default } from './impl.js';",
			'/pkg/other.js': 'export const a = 1;',
		};
		expect((await trace(files, ['default'])).get('default')).toEqual({ id: '/pkg/impl.js', kind: 'module' });
	});

	it('taints a star result when another star source is indeterminate', async () => {
		const files = {
			'/pkg/a.js': 'export const foo = 1;',
			// the second star source is external/unresolvable and might also export foo
			'/pkg/index.js': "export * from './a.js';\nexport * from 'external';",
		};
		expect((await trace(files, ['foo'])).get('foo')).toEqual({ kind: 'unknown' });
	});

	it('lets an explicit re-export win over an indeterminate star source', async () => {
		const files = {
			'/pkg/foo.js': 'export const foo = 1;',
			'/pkg/index.js': "export * from 'external';\nexport { foo } from './foo.js';",
		};
		expect((await trace(files, ['foo'])).get('foo')).toEqual({ id: '/pkg/foo.js', kind: 'module' });
	});

	it('traces a destructured variable export to its module', async () => {
		const files = {
			'/pkg/index.js':
				'const obj = { foo: 1, bar: 2 };\nexport const { foo, bar } = obj;\nexport const [baz] = [3];',
		};
		const origins = await trace(files, ['bar', 'baz', 'foo']);
		expect(origins.get('foo')).toEqual({ id: '/pkg/index.js', kind: 'module' });
		expect(origins.get('bar')).toEqual({ id: '/pkg/index.js', kind: 'module' });
		expect(origins.get('baz')).toEqual({ id: '/pkg/index.js', kind: 'module' });
	});

	it('parses TypeScript sources and ignores type-only exports', async () => {
		const files = {
			'/pkg/impl.ts': 'export const foo: number = 1;\nexport enum Mode { A, B }',
			'/pkg/index.ts': "export type { Thing } from './types.ts';\nexport { foo, Mode } from './impl.ts';",
			'/pkg/types.ts': 'export interface Thing { x: number }',
		};
		const origins = await trace(files, ['Mode', 'Thing', 'foo'], '/pkg/index.ts');
		expect(origins.get('foo')).toEqual({ id: '/pkg/impl.ts', kind: 'module' });
		expect(origins.get('Mode')).toEqual({ id: '/pkg/impl.ts', kind: 'module' });
		// type-only re-export is not a runtime origin
		expect(origins.get('Thing')).toEqual({ kind: 'unknown' });
	});

	it('terminates on cyclic star re-exports', async () => {
		const files = {
			'/pkg/a.js': "export * from './b.js';",
			'/pkg/b.js': "export * from './a.js';",
			'/pkg/index.js': "export * from './a.js';",
		};
		expect((await trace(files, ['missing'])).get('missing')).toEqual({ kind: 'unknown' });
	});

	it('returns unknown for an unresolvable (external) source', async () => {
		const files = { '/pkg/index.js': "export { thing } from 'external-pkg';" };
		expect((await trace(files, ['thing'])).get('thing')).toEqual({ kind: 'unknown' });
	});

	it('returns unknown for a name that is not exported', async () => {
		const files = { '/pkg/index.js': 'export const foo = 1;' };
		expect((await trace(files, ['nope'])).get('nope')).toEqual({ kind: 'unknown' });
	});
});
