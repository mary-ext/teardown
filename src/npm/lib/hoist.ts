import type { HoistedNode, HoistedResult, ResolvedPackage } from './types';

/**
 * attempts to place a package at the root level.
 * returns true if placement succeeded, false if there's a conflict.
 *
 * a conflict occurs when:
 * - a different version of the same package is already at root
 *
 * @param root the current root node_modules map
 * @param pkg the package to place
 * @returns true if placed at root, false if needs nesting
 */
function tryPlaceAtRoot(root: Map<string, HoistedNode>, pkg: ResolvedPackage): boolean {
	const existing = root.get(pkg.name);

	if (!existing) {
		// no conflict, place at root
		root.set(pkg.name, {
			name: pkg.name,
			version: pkg.version,
			tarball: pkg.tarball,
			integrity: pkg.integrity,
			unpackedSize: pkg.unpackedSize,
			dependencyCount: pkg.dependencies.size,
			nested: new Map(),
		});
		return true;
	}

	// same version already at root - reuse it
	if (existing.version === pkg.version) {
		return true;
	}

	// different version - conflict, needs nesting
	return false;
}

/**
 * hoists dependencies as high as possible in the tree.
 * follows npm's hoisting algorithm:
 * 1. try to place each package at root
 * 2. if conflict, nest it under its parent
 *
 * peer dependencies are handled by the resolver - they're added as regular
 * dependencies of the package that requested them, so they naturally get
 * hoisted to root if no conflict, or nested under the dependent if there's
 * a version conflict. this ensures the bundler resolves peers correctly.
 *
 * @param roots the root packages from resolution
 * @returns the hoisted node_modules structure
 */
export function hoist(roots: ResolvedPackage[]): HoistedResult {
	const root = new Map<string, HoistedNode>();

	// track which packages we've visited to avoid infinite loops
	const visited = new Set<string>();

	/**
	 * recursively process a package and its dependencies.
	 * returns the hoisted node for this package.
	 */
	function processPackage(pkg: ResolvedPackage, parentNode: HoistedNode | null): HoistedNode | null {
		const key = `${pkg.name}@${pkg.version}`;

		// skip if already processed
		if (visited.has(key)) {
			// return the existing node from root if it exists
			return root.get(pkg.name) ?? null;
		}
		visited.add(key);

		// try to place at root first
		const placedAtRoot = tryPlaceAtRoot(root, pkg);
		let node: HoistedNode;

		if (placedAtRoot) {
			node = root.get(pkg.name)!;
		} else if (parentNode) {
			// conflict at root, nest under parent
			node = {
				name: pkg.name,
				version: pkg.version,
				tarball: pkg.tarball,
				integrity: pkg.integrity,
				unpackedSize: pkg.unpackedSize,
				dependencyCount: pkg.dependencies.size,
				nested: new Map(),
			};
			parentNode.nested.set(pkg.name, node);
		} else {
			// this shouldn't happen for root packages
			throw new Error(`cannot place root package ${pkg.name}@${pkg.version}`);
		}

		// process dependencies
		for (const dep of pkg.dependencies.values()) {
			processPackage(dep, node);
		}

		return node;
	}

	// process all root packages
	for (const rootPkg of roots) {
		processPackage(rootPkg, null);
	}

	return { root };
}

/**
 * converts a hoisted result to a flat list of paths.
 * useful for debugging and testing.
 *
 * @param result the hoisted result
 * @returns array of paths like ["node_modules/react", "node_modules/react/node_modules/scheduler"]
 */
export function hoistedToPaths(result: HoistedResult): string[] {
	const paths: string[] = [];

	function walk(nodes: Map<string, HoistedNode>, prefix: string): void {
		for (const [name, node] of nodes) {
			const path = `${prefix}/${name}`;
			paths.push(path);
			if (node.nested.size > 0) {
				walk(node.nested, `${path}/node_modules`);
			}
		}
	}

	walk(result.root, 'node_modules');
	return paths.sort();
}
