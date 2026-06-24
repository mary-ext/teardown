import type { Expression, Program, Statement, StaticMemberExpression } from '@oxc-project/types';

// #region types

export type ModuleType = 'cjs' | 'esm' | 'umd' | 'unknown';

/**
 * information about a module's format and exports.
 */
export interface ModuleInfo {
	/** detected module format */
	type: ModuleType;
	/** whether the module has a default export */
	hasDefaultExport: boolean;
	/**
	 * detected named exports.
	 * for ESM: export names from export statements.
	 * for CJS: static property assignments to exports/module.exports.
	 */
	namedExports: string[];
}

// #endregion

// #region helpers

/**
 * views an AST node as an untyped property bag. the static node types don't expose the
 * fields these predicates probe for, and `unknown` widens to `any` without an assertion,
 * so this keeps the unsafe-cast escape hatch in one place rather than scattered `as any`.
 */
function fields(node: unknown): any {
	return node;
}

/**
 * checks if a node is a string literal with type "Literal".
 */
function isStringLiteral(node: unknown): node is { type: 'Literal'; value: string } {
	const o = fields(node);
	return o?.type === 'Literal' && typeof o.value === 'string';
}

/**
 * checks if a node is an identifier with the given name.
 *
 * handles every identifier shape (IdentifierReference, IdentifierName, …): they all
 * share type "Identifier" and a `name` property.
 */
function isIdentifier(node: unknown, name: string): boolean {
	const o = fields(node);
	return o?.type === 'Identifier' && o.name === name;
}

/**
 * checks if an expression is `exports` or `module.exports`.
 */
function isExportsObject(node: unknown): boolean {
	if (isIdentifier(node, 'exports')) {
		return true;
	}

	// module.exports
	const o = fields(node);
	return (
		o?.type === 'MemberExpression' &&
		!o.computed &&
		isIdentifier(o.object, 'module') &&
		isIdentifier(o.property, 'exports')
	);
}

/**
 * gets the property name from a static member expression.
 */
function getStaticPropertyName(node: StaticMemberExpression): string | null {
	const o = fields(node);
	if (o.computed) {
		// computed property like exports["foo"]
		return isStringLiteral(o.property) ? o.property.value : null;
	}

	// non-computed like exports.foo
	return o.property?.type === 'Identifier' ? o.property.name : null;
}

/**
 * extracts property names from an object expression (for `module.exports = { a, b }`).
 */
function extractObjectPropertyNames(node: Expression): string[] {
	if (node.type !== 'ObjectExpression') {
		return [];
	}

	const names: string[] = [];
	for (const prop of node.properties) {
		if (prop.type !== 'Property') {
			continue;
		}

		const key = fields(prop.key);
		if (key.type === 'Identifier') {
			names.push(key.name);
		} else if (isStringLiteral(key)) {
			names.push(key.value);
		}
	}

	return names;
}

// #endregion

// #region detection

/**
 * checks if an expression is a require() call.
 */
function isRequireCall(expr: Expression): boolean {
	return expr.type === 'CallExpression' && isIdentifier(expr.callee, 'require');
}

/**
 * checks an expression for CJS export patterns.
 * returns the export names found, or null if not a CJS pattern.
 */
function checkCjsExpression(expr: Expression): string[] | null {
	// assignment expressions: exports.foo = ... or module.exports = ...
	if (expr.type === 'AssignmentExpression' && expr.operator === '=') {
		const left = fields(expr.left);

		// exports.foo = ... or module.exports.foo = ...
		if (left.type === 'MemberExpression') {
			// direct assignment to exports.propertyName
			if (isExportsObject(left.object)) {
				const propName = getStaticPropertyName(left);
				return propName !== null ? [propName] : [];
			}

			// module.exports = require('...') (re-export, exports unknowable) or module.exports = { a, b }
			if (isExportsObject(left)) {
				return isRequireCall(expr.right) ? [] : extractObjectPropertyNames(expr.right);
			}
		}
	}

	// Object.defineProperty(exports, 'name', ...) or Object.defineProperty(module.exports, 'name', ...)
	if (expr.type === 'CallExpression' && expr.callee.type === 'MemberExpression') {
		const callee = fields(expr.callee);
		if (
			!callee.computed &&
			isIdentifier(callee.object, 'Object') &&
			isIdentifier(callee.property, 'defineProperty')
		) {
			const [target, propArg] = expr.arguments;
			if (
				target?.type !== 'SpreadElement' &&
				isExportsObject(target) &&
				propArg?.type !== 'SpreadElement' &&
				isStringLiteral(propArg)
			) {
				return [propArg.value];
			}
		}
	}

	return null;
}

/**
 * checks a statement for CJS patterns and extracts export info.
 * returns the export names found, or null if not a CJS pattern.
 */
function checkCjsStatement(stmt: Statement): string[] | null {
	// handle expression statements
	if (stmt.type === 'ExpressionStatement') {
		return checkCjsExpression(stmt.expression);
	}

	// handle if statements - check both branches for CJS patterns
	// e.g., if (process.env.NODE_ENV === 'production') module.exports = require('./prod')
	if (stmt.type === 'IfStatement') {
		let result: string[] | null = null;

		// check consequent
		if (stmt.consequent.type === 'ExpressionStatement') {
			result = checkCjsExpression(stmt.consequent.expression);
		} else if (stmt.consequent.type === 'BlockStatement') {
			for (const s of stmt.consequent.body) {
				const r = checkCjsStatement(s);
				if (r !== null) {
					result = result ? [...result, ...r] : r;
				}
			}
		}

		// check alternate
		if (stmt.alternate) {
			if (stmt.alternate.type === 'ExpressionStatement') {
				const r = checkCjsExpression(stmt.alternate.expression);
				if (r !== null) {
					result = result ? [...result, ...r] : r;
				}
			} else if (stmt.alternate.type === 'BlockStatement') {
				for (const s of stmt.alternate.body) {
					const r = checkCjsStatement(s);
					if (r !== null) {
						result = result ? [...result, ...r] : r;
					}
				}
			} else if (stmt.alternate.type === 'IfStatement') {
				const r = checkCjsStatement(stmt.alternate);
				if (r !== null) {
					result = result ? [...result, ...r] : r;
				}
			}
		}

		return result;
	}

	return null;
}

/**
 * recursively searches an AST subtree for a `define.amd` member access — the marker a
 * UMD wrapper uses to detect an AMD loader.
 */
function referencesDefineAmd(node: unknown): boolean {
	if (typeof node !== 'object' || node === null) {
		return false;
	}

	if (Array.isArray(node)) {
		return node.some((child) => referencesDefineAmd(child));
	}

	// matches both ESTree (`MemberExpression`) and Oxc (`StaticMemberExpression`) shapes
	const o = fields(node);
	if (
		(o.type === 'MemberExpression' || o.type === 'StaticMemberExpression') &&
		isIdentifier(o.object, 'define') &&
		isIdentifier(o.property, 'amd')
	) {
		return true;
	}

	return Object.values(node).some((value) => referencesDefineAmd(value));
}

/**
 * detects a UMD bundle: a top-level IIFE whose wrapper dispatches on `define.amd`.
 * only the invoked wrapper function is scanned (where the AMD branch lives), not its
 * factory argument, which holds the entire — potentially huge — module body.
 */
function looksLikeUmd(ast: Program): boolean {
	for (const stmt of ast.body) {
		if (stmt.type !== 'ExpressionStatement' || stmt.expression.type !== 'CallExpression') {
			continue;
		}

		const callee = stmt.expression.callee;
		if (
			(callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression') &&
			referencesDefineAmd(callee.body)
		) {
			return true;
		}
	}

	return false;
}

/**
 * analyzes an Oxc AST to determine the module format and exports.
 *
 * @param ast the parsed program AST
 * @returns module info with type, default export flag, and named exports
 */
export function analyzeModule(ast: Program): ModuleInfo {
	let type: ModuleType = 'unknown';
	let hasDefaultExport = false;
	const namedExports: string[] = [];

	for (const node of ast.body) {
		// ESM: import declarations
		if (node.type === 'ImportDeclaration') {
			type = 'esm';
			continue;
		}

		// ESM: export default
		if (node.type === 'ExportDefaultDeclaration') {
			type = 'esm';
			hasDefaultExport = true;
			continue;
		}

		// ESM: export all (export * from '...')
		if (node.type === 'ExportAllDeclaration') {
			type = 'esm';
			// star exports don't add to namedExports since we can't know them statically
			continue;
		}

		// ESM: named exports
		if (node.type === 'ExportNamedDeclaration') {
			type = 'esm';

			// export { a, b } or export { a } from '...'
			for (const spec of node.specifiers) {
				const exported = spec.exported;
				let name: string;

				if (exported.type === 'Identifier') {
					name = (exported as { name: string }).name;
				} else if (isStringLiteral(exported)) {
					name = exported.value;
				} else {
					continue;
				}

				if (name === 'default') {
					hasDefaultExport = true;
				} else {
					namedExports.push(name);
				}
			}

			// export const foo = ... or export function bar() {}
			if (node.declaration) {
				const decl = node.declaration;

				if (decl.type === 'VariableDeclaration') {
					for (const declarator of decl.declarations) {
						if (declarator.id.type === 'Identifier') {
							namedExports.push((declarator.id as { name: string }).name);
						}
					}
				} else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
					if (decl.id) {
						namedExports.push((decl.id as { name: string }).name);
					}
				}
			}

			continue;
		}

		// ESM: import.meta usage
		if (node.type === 'ExpressionStatement') {
			if (containsImportMeta(node.expression)) {
				type = 'esm';
				continue;
			}
		}

		// CJS detection (only if not already ESM)
		if (type !== 'esm') {
			const cjsExports = checkCjsStatement(node);
			if (cjsExports !== null) {
				type = 'cjs';
				namedExports.push(...cjsExports);
			}
		}
	}

	// a UMD bundle reads as a single opaque IIFE at the top level, so the statement scan
	// above leaves it `unknown`; recognize the wrapper so it's measured as a whole module
	// (default export) rather than tree-shaken to nothing.
	if (type === 'unknown' && looksLikeUmd(ast)) {
		type = 'umd';
		hasDefaultExport = true;
	}

	return { type, hasDefaultExport, namedExports };
}

/**
 * recursively checks if an expression contains import.meta.
 */
function containsImportMeta(expr: Expression): boolean {
	if (expr.type === 'MetaProperty') {
		const meta = expr.meta;
		const prop = expr.property;
		return meta.name === 'import' && prop.name === 'meta';
	}

	if (expr.type === 'MemberExpression') {
		return containsImportMeta(fields(expr).object);
	}

	if (expr.type === 'CallExpression') {
		// check callee and arguments
		if (containsImportMeta(expr.callee)) {
			return true;
		}
		for (const arg of expr.arguments) {
			if (arg.type !== 'SpreadElement' && containsImportMeta(arg)) {
				return true;
			}
		}
	}

	if (expr.type === 'BinaryExpression' || expr.type === 'LogicalExpression') {
		return containsImportMeta(fields(expr).left) || containsImportMeta(expr.right);
	}

	if (expr.type === 'UnaryExpression') {
		return containsImportMeta(expr.argument);
	}

	if (expr.type === 'ConditionalExpression') {
		return (
			containsImportMeta(expr.test) ||
			containsImportMeta(expr.consequent) ||
			containsImportMeta(expr.alternate)
		);
	}

	return false;
}

// #endregion
