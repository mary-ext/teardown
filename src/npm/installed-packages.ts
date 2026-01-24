import type { ResolvedPackage } from './types';
import type { InstalledPackage } from './worker-protocol';

/**
 * builds the installed packages list from the resolved dependency tree.
 * also identifies which packages are only reachable through peer dependencies.
 *
 * @param root the root resolved package
 * @param peerDepNames names of the root package's peer dependencies
 * @returns array of installed packages with peer status
 */
export function buildInstalledPackages(root: ResolvedPackage, peerDepNames: Set<string>): InstalledPackage[] {
	// first pass: collect all unique packages and compute levels + installedBy
	const packageMap = new Map<
		string,
		{
			pkg: ResolvedPackage;
			level: number;
			installedBy: number;
		}
	>();

	// track which packages are reachable without going through peer deps
	const reachableWithoutPeers = new Set<string>();

	{
		const visited = new Set<string>();

		function walk(pkg: ResolvedPackage, level: number, inPeerSubtree: boolean): void {
			const key = `${pkg.name}@${pkg.version}`;

			// update level to shortest path
			const existing = packageMap.get(key);
			if (existing) {
				if (level < existing.level) {
					existing.level = level;
				}
			} else {
				packageMap.set(key, { pkg, level, installedBy: 0 });
			}

			// track if reachable without peers
			if (!inPeerSubtree) {
				reachableWithoutPeers.add(key);
			}

			// avoid infinite loops from cycles
			if (visited.has(key)) {
				return;
			}
			visited.add(key);

			// count installedBy for each dependency
			for (const [depName, dep] of pkg.dependencies) {
				const depKey = `${dep.name}@${dep.version}`;
				const depEntry = packageMap.get(depKey);
				if (depEntry) {
					depEntry.installedBy++;
				} else {
					packageMap.set(depKey, { pkg: dep, level: level + 1, installedBy: 1 });
				}

				// check if this edge goes through a root peer dep
				const isPeerEdge = pkg === root && peerDepNames.has(depName);
				walk(dep, level + 1, inPeerSubtree || isPeerEdge);
			}

			visited.delete(key);
		}

		walk(root, 0, false);
	}

	// build final array
	const packages: InstalledPackage[] = [];
	for (const [key, { pkg, level, installedBy }] of packageMap) {
		packages.push({
			name: pkg.name,
			version: pkg.version,
			size: pkg.unpackedSize ?? 0,
			path: `node_modules/${pkg.name}`,
			level,
			installedBy,
			dependencyCount: pkg.dependencies.size,
			description: pkg.description,
			license: pkg.license,
			isPeer: !reachableWithoutPeers.has(key),
		});
	}

	return packages;
}
