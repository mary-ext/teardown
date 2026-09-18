import type { Volume } from 'memfs';

import { DEFAULT_EXCLUDE_PATTERNS, fetchTarballToVolume, type FetchOptions } from './fetch';
import { getBaseId, getEntryPath } from './isolate';
import type { IsolatedResult, ResolvedPackage, StoreEntry } from './types';

export interface PackageStoreOptions extends FetchOptions {
	/**
	 * called after a tarball is extracted into the store.
	 * @param pkg the fetched package
	 */
	onFetch?: (pkg: ResolvedPackage) => void;
	/**
	 * called when a layout entry's files are ready.
	 * @param entry the linked entry
	 */
	onLink?: (entry: StoreEntry) => void;
}

/**
 * fetches packages during resolution and links the completed layout.
 */
export interface PackageStore {
	/**
	 * queues a package for fetching, deduplicated by name and version.
	 * sets `pkg.unpackedSize` from the tarball if absent.
	 * @param pkg the package to fetch
	 */
	add(pkg: ResolvedPackage): void;
	/**
	 * installs the layout, fetching any missing packages.
	 * @param layout the isolated layout
	 * @throws {FetchError} if any fetch failed
	 */
	link(layout: IsolatedResult): Promise<void>;
}

/**
 * creates a virtual store backed by a volume, rooted at `/node_modules/.pnpm`.
 *
 * @param volume the volume to write to
 * @param options fetch settings and progress callbacks
 * @returns the store
 * @throws {RangeError} if `options.concurrency` isn't a positive integer
 */
export const createPackageStore = (volume: Volume, options: PackageStoreOptions = {}): PackageStore => {
	const concurrency = options.concurrency ?? 16;
	const exclude = options.exclude ?? DEFAULT_EXCLUDE_PATTERNS;

	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
	}

	const fetches = new Map<string, Promise<void>>();

	let active = 0;
	// ascending by size for largest-first pop()
	const waiting: Array<{ size: number; resolve: () => void }> = [];
	const acquire = async (size: number): Promise<void> => {
		if (active < concurrency) {
			active++;
			return;
		}

		// insert before equal sizes to preserve arrival order when popping
		let low = 0;
		let high = waiting.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (waiting[mid]!.size < size) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		await new Promise<void>((resolve) => waiting.splice(low, 0, { size, resolve }));
	};
	const release = (): void => {
		// start larger downloads first to reduce the wait for the last tarball
		const next = waiting.pop();
		if (next !== undefined) {
			next.resolve();
		} else {
			active--;
		}
	};

	const fetchPackage = (pkg: ResolvedPackage): Promise<void> => {
		const id = getBaseId(pkg);

		let promise = fetches.get(id);
		if (promise === undefined) {
			promise = (async () => {
				await acquire(pkg.unpackedSize ?? 0);
				try {
					const size = await fetchTarballToVolume(volume, {
						url: pkg.tarball,
						integrity: pkg.integrity,
						destPath: getEntryPath(id, pkg.name),
						exclude,
					});
					// JSR packages don't report their unpacked size
					pkg.unpackedSize ??= size;
				} finally {
					release();
				}

				options.onFetch?.(pkg);
			})();

			// link() propagates required fetch failures; unused fetches still need a rejection handler
			promise.catch(() => {});
			fetches.set(id, promise);
		}

		return promise;
	};

	const symlink = (target: string, path: string): void => {
		volume.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
		volume.symlinkSync(target, path);
	};

	const copyTree = (from: string, to: string): void => {
		volume.mkdirSync(to, { recursive: true });
		for (const dirent of volume.readdirSync(from, { withFileTypes: true })) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			const name = dirent.name as string;
			if (dirent.isDirectory()) {
				copyTree(`${from}/${name}`, `${to}/${name}`);
			} else {
				volume.linkSync(`${from}/${name}`, `${to}/${name}`);
			}
		}
	};

	return {
		add(pkg) {
			void fetchPackage(pkg);
		},
		async link({ entries, roots, hoisted }) {
			const pathOf = (id: string) => getEntryPath(id, entries.get(id)!.pkg.name);

			// symlinks can be created before their targets finish extracting
			for (const entry of entries.values()) {
				for (const [name, targetId] of entry.links) {
					symlink(pathOf(targetId), getEntryPath(entry.id, name));
				}
			}
			for (const [name, targetId] of roots) {
				symlink(pathOf(targetId), `/node_modules/${name}`);
			}
			for (const [name, targetId] of hoisted) {
				symlink(pathOf(targetId), `/node_modules/.pnpm/node_modules/${name}`);
			}

			// hardlinks share file contents while preserving each entry's real path for peer resolution
			await Promise.all(
				Array.from(entries.values(), async (entry) => {
					await fetchPackage(entry.pkg);

					// the base entry holds the files even when nothing links to it
					const baseId = getBaseId(entry.pkg);
					if (entry.id !== baseId) {
						copyTree(getEntryPath(baseId, entry.pkg.name), getEntryPath(entry.id, entry.pkg.name));
					}

					options.onLink?.(entry);
				}),
			);
		},
	};
};
