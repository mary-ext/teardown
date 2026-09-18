import * as semver from 'semver';

import type { IsolatedResult, ResolvedPackage, StoreEntry } from './types';

/** a named dependency visible to a package. */
interface Slot {
	pkg: ResolvedPackage;
	/** scope used to resolve this package's peers */
	scope: Scope;
	/** cached acyclic store id */
	id: string | undefined;
	entry: Instance | undefined;
}

/** a store entry with unresolved dependency links. */
interface Instance {
	pkg: ResolvedPackage;
	id: string;
	links: Map<string, Slot>;
}

/** dependency scope, searched before its parent. */
interface Scope {
	layer: Map<string, Slot>;
	/** package that owns this dependency layer; also available as a peer provider */
	owner: Slot | null;
	parent: Scope | null;
}

const lookup = (scope: Scope | null, name: string): Slot | undefined => {
	for (let s = scope; s !== null; s = s.parent) {
		const slot = s.layer.get(name) ?? (s.owner?.pkg.name === name ? s.owner : undefined);
		if (slot !== undefined) {
			return slot;
		}
	}
	return undefined;
};

// cap nested peer ids, which appear in every module path
const MAX_ID_LENGTH = 120;

/** concatenated 32-bit FNV-1a hashes with different offsets. */
const hash = (input: string): string => {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		a = Math.imul(a ^ code, 0x01000193);
		b = Math.imul(b ^ code, 0x01000193);
	}
	return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
};

const toDirName = (id: string): string => {
	if (id.length <= MAX_ID_LENGTH) {
		return id;
	}
	const digest = hash(id);
	return `${id.slice(0, MAX_ID_LENGTH - digest.length - 1)}_${digest}`;
};

const toIds = (slots: Map<string, Slot>): Map<string, string> => {
	return new Map(Array.from(slots, ([name, slot]) => [name, slot.entry!.id]));
};

const getChildren = (pkg: ResolvedPackage): Array<[name: string, dep: ResolvedPackage]> => {
	return Array.from(pkg.dependencies).filter(([name]) => name !== pkg.name);
};

/**
 * finds peer names each subtree needs from its ancestors.
 *
 * includes peers of auto-installed fallbacks, even if layout later omits those fallbacks.
 */
const findOpenPeers = (roots: ResolvedPackage[]): Map<ResolvedPackage, Set<string>> => {
	const open = new Map<ResolvedPackage, Set<string>>();
	const dependents = new Map<ResolvedPackage, ResolvedPackage[]>();

	{
		const stack = [...roots];
		for (const pkg of roots) {
			open.set(pkg, new Set(pkg.peers.keys()));
		}

		while (stack.length > 0) {
			const pkg = stack.pop()!;
			for (const [, dep] of getChildren(pkg)) {
				if (!open.has(dep)) {
					open.set(dep, new Set(dep.peers.keys()));
					stack.push(dep);
				}

				let list = dependents.get(dep);
				if (list === undefined) {
					dependents.set(dep, (list = []));
				}
				list.push(pkg);
			}
		}
	}

	// propagate to a fixed point to handle dependency cycles
	const queue = [...open.keys()];
	while (queue.length > 0) {
		const pkg = queue.pop()!;
		const names = open.get(pkg)!;

		for (const dependent of dependents.get(pkg) ?? []) {
			const target = open.get(dependent)!;
			const provides = (name: string) => name === dependent.name || dependent.dependencies.has(name);
			let grew = false;

			for (const name of names) {
				if (!target.has(name) && !provides(name)) {
					target.add(name);
					grew = true;
				}
			}

			if (grew) {
				queue.push(dependent);
			}
		}
	}

	return open;
};

/**
 * shares the highest version satisfying all fallback ranges for a peer.
 * peers with no common version keep per-package fallbacks.
 */
const selectPeerProviders = (packages: ResolvedPackage[]): Map<string, ResolvedPackage> => {
	const versionsByName = Map.groupBy(packages, (pkg) => pkg.name);

	// only required peers get fallbacks
	const fallbackRanges = Map.groupBy(
		packages.flatMap((pkg) => Array.from(pkg.peers).filter(([name]) => pkg.dependencies.has(name))),
		([name]) => name,
	);

	const providers = new Map<string, ResolvedPackage>();
	for (const [name, peers] of fallbackRanges) {
		const ranges = [...new Set(peers.map(([, range]) => range))];

		const best = (versionsByName.get(name) ?? [])
			.filter((pkg) =>
				ranges.every((range) =>
					semver.satisfies(pkg.version, range, { loose: true, includePrerelease: true }),
				),
			)
			.toSorted((a, b) => semver.rcompare(a.version, b.version, true))
			.at(0);

		if (best !== undefined) {
			providers.set(name, best);
		}
	}

	return providers;
};

/**
 * returns the base store id of a package.
 *
 * @param pkg the package
 * @returns `name@version` with `/` replaced by `+` for a single path segment
 */
export const getBaseId = (pkg: ResolvedPackage): string => {
	return `${pkg.name.replace('/', '+')}@${pkg.version}`;
};

/**
 * returns a package's directory in the virtual store.
 *
 * @param id the store entry id
 * @param name the package name
 * @returns the absolute path to the package directory
 */
export const getEntryPath = (id: string, name: string): string => {
	return `/node_modules/.pnpm/${id}/node_modules/${name}`;
};

/**
 * builds a pnpm-style layout with one entry per package and peer context.
 * peers prefer ancestor providers, then a shared version satisfying all fallback ranges,
 * then per-package fallbacks. missing peers stay unlinked.
 *
 * entry ids include nested peer ids, e.g. `lib@1.0.0(react-dom@18.0.0(react@18.0.0))`,
 * truncated with a hash suffix beyond 120 characters.
 *
 * @param roots the root packages from resolution
 * @returns the isolated layout
 */
export const isolate = (roots: ResolvedPackage[]): IsolatedResult => {
	const openPeers = findOpenPeers(roots);
	const instances = new Map<string, Instance>();

	// include ancestor-provided peers in subtree identity, including each peer's own context
	const resolving = new Set<Slot>();
	const getId = (slot: Slot): { id: string; complete: boolean } => {
		if (slot.id !== undefined) {
			return { id: slot.id, complete: true };
		}

		// terminate cyclic peer ids at the repeated package
		if (resolving.has(slot)) {
			return { id: getBaseId(slot.pkg), complete: false };
		}

		resolving.add(slot);

		let id = getBaseId(slot.pkg);
		let complete = true;
		for (const name of [...openPeers.get(slot.pkg)!].toSorted()) {
			const provider = lookup(slot.scope, name);
			if (provider !== undefined) {
				const peer = getId(provider);
				id += `(${peer.id})`;
				complete &&= peer.complete;
			}
		}

		resolving.delete(slot);

		// cycle-truncated ids depend on the traversal root and cannot be cached
		if (complete) {
			slot.id = id;
		}
		return { id, complete };
	};

	const instantiate = (slot: Slot): Instance => {
		const { pkg } = slot;
		const id = toDirName(getId(slot).id);

		// registered before descending, so dependency cycles link back to it
		{
			const existing = instances.get(id);
			if (existing !== undefined) {
				return existing;
			}
		}

		const layer = new Map<string, Slot>();
		const instance: Instance = { pkg, id, links: layer };
		instances.set(id, instance);

		for (const name of pkg.peers.keys()) {
			const provider = lookup(slot.scope, name);
			if (provider !== undefined) {
				layer.set(name, provider);
			}
		}

		const scope: Scope = { layer, owner: slot, parent: slot.scope };
		const owned: Slot[] = [];
		for (const [name, dep] of getChildren(pkg)) {
			// peers provided by dependents win over the auto-installed fallback
			if (!layer.has(name)) {
				const child: Slot = { pkg: dep, scope, id: undefined, entry: undefined };
				layer.set(name, child);
				owned.push(child);
			}
		}

		// register all siblings before resolving their peer links
		for (const child of owned) {
			child.entry = instantiate(child);
		}

		return instance;
	};

	// roots override shared providers; shared providers get no root `/node_modules` links
	const providerScope: Scope = { layer: new Map(), owner: null, parent: null };
	const rootScope: Scope = { layer: new Map(), owner: null, parent: providerScope };
	for (const pkg of roots) {
		rootScope.layer.set(pkg.name, { pkg, scope: rootScope, id: undefined, entry: undefined });
	}
	for (const [name, pkg] of selectPeerProviders([...openPeers.keys()])) {
		providerScope.layer.set(name, { pkg, scope: rootScope, id: undefined, entry: undefined });
	}

	for (const slot of rootScope.layer.values()) {
		slot.entry = instantiate(slot);
	}

	// instantiate linked providers, including those added while iterating
	for (const instance of instances.values()) {
		for (const slot of instance.links.values()) {
			slot.entry ??= instantiate(slot);
		}
	}

	const entries = new Map<string, StoreEntry>();
	const hoisted = new Map<string, string>();
	for (const [id, instance] of instances) {
		entries.set(id, { id, pkg: instance.pkg, links: toIds(instance.links) });

		if (!hoisted.has(instance.pkg.name)) {
			hoisted.set(instance.pkg.name, id);
		}
	}

	return { entries, roots: toIds(rootScope.layer), hoisted };
};
