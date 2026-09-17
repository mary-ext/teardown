import type { InstalledPackage, PackageRef } from '../types';

import { getBaseId } from './isolate';
import type { IsolatedResult, ResolvedPackage, StoreEntry } from './types';

interface PackageInfo {
	pkg: ResolvedPackage;
	level: number;
	peerOnly: boolean;
	dependents: Map<string, PackageRef>;
	dependencies: Map<string, PackageRef>;
}

interface Edge {
	from: StoreEntry;
	to: StoreEntry;
	/** whether this edge is a peer dependency of the root */
	peer: boolean;
	/** whether this traversal path passes through a root peer */
	peerOnly: boolean;
}

/**
 * lists packages reachable from the root, marking those reachable only through root peers.
 *
 * @param layout the isolated layout
 * @param rootName name of the root package
 * @param peerDepNames names of the root package's peer dependencies
 * @returns array of installed packages with peer status, one per package version
 */
export const buildInstalledPackages = (
	layout: IsolatedResult,
	rootName: string,
	peerDepNames: Set<string>,
): InstalledPackage[] => {
	const rootEntry = layout.entries.get(layout.roots.get(rootName)!)!;

	const packages = new Map<string, PackageInfo>();
	const getInfo = (entry: StoreEntry, level: number): PackageInfo => {
		const key = getBaseId(entry.pkg);
		let info = packages.get(key);
		if (info === undefined) {
			info = { pkg: entry.pkg, level, peerOnly: true, dependents: new Map(), dependencies: new Map() };
			packages.set(key, info);
		}
		return info;
	};

	getInfo(rootEntry, 0).peerOnly = false;

	// breadth-first traversal records minimum depth. revisit entries reached without peers
	// to clear peer-only status in their dependencies.
	const walked = new Set<StoreEntry>([rootEntry]);
	const walkedWithoutPeers = new Set<StoreEntry>([rootEntry]);

	let queue: Array<{ entry: StoreEntry; peerOnly: boolean }> = [{ entry: rootEntry, peerOnly: false }];
	for (let level = 1; queue.length > 0; level++) {
		// visit non-peer paths first to avoid redundant peer-only traversals
		const regular: Edge[] = [];
		const viaPeers: Edge[] = [];
		for (const { entry, peerOnly } of queue) {
			for (const [name, targetId] of entry.links) {
				const peer = entry === rootEntry && peerDepNames.has(name);
				const edge: Edge = {
					from: entry,
					to: layout.entries.get(targetId)!,
					peer,
					peerOnly: peerOnly || peer,
				};
				(edge.peerOnly ? viaPeers : regular).push(edge);
			}
		}

		const next: typeof queue = [];
		for (const { from, to, peer, peerOnly } of [...regular, ...viaPeers]) {
			const source = getInfo(from, level - 1);
			const dest = getInfo(to, level);
			if (!peerOnly) {
				dest.peerOnly = false;
			}

			source.dependencies.set(getBaseId(to.pkg), {
				name: to.pkg.name,
				version: to.pkg.version,
				isPeer: peer,
			});
			dest.dependents.set(getBaseId(from.pkg), {
				name: from.pkg.name,
				version: from.pkg.version,
				isPeer: peer,
			});

			if (!walked.has(to) || (!peerOnly && !walkedWithoutPeers.has(to))) {
				walked.add(to);
				if (!peerOnly) {
					walkedWithoutPeers.add(to);
				}
				next.push({ entry: to, peerOnly });
			}
		}

		queue = next;
	}

	return Array.from(packages.values(), ({ pkg, level, peerOnly, dependents, dependencies }) => ({
		name: pkg.name,
		version: pkg.version,
		size: pkg.unpackedSize ?? 0,
		level,
		dependents: [...dependents.values()],
		dependencies: [...dependencies.values()],
		// direct root peers retain peer status even when reachable without peers
		isPeer: peerDepNames.has(pkg.name) || peerOnly,
	}));
};
