import type { Volume } from 'memfs';

import type { FetchOptions } from './fetch';
import { isolate } from './isolate';
import { resolve, type ResolveOptions } from './resolve';
import { createPackageStore } from './store';
import type { IsolatedResult, ResolutionResult } from './types';

/**
 * options for installing packages.
 */
export interface InstallOptions {
	/** resolution options */
	resolve?: Omit<ResolveOptions, 'onResolve'>;
	/** fetch options */
	fetch?: FetchOptions;
}

/**
 * the outcome of an install.
 */
export interface InstallResult {
	/** the resolved dependency graph */
	resolution: ResolutionResult;
	/** the layout written to the volume */
	layout: IsolatedResult;
}

/**
 * installs packages in a pnpm-style virtual store with root links under `/node_modules`.
 *
 * @param specifiers package specifiers to install
 * @param volume the volume to write to, expected to be empty
 * @param options install options
 * @returns the resolved graph and installed layout
 * @throws {FetchError} if a package can't be fetched
 * @throws {RangeError} if `options.fetch.concurrency` isn't a positive integer
 */
export const install = async (
	specifiers: string[],
	volume: Volume,
	options: InstallOptions = {},
): Promise<InstallResult> => {
	// base store paths are independent of layout, allowing fetches during resolution
	const store = createPackageStore(volume, options.fetch);
	const resolution = await resolve(specifiers, {
		...options.resolve,
		onResolve(pkg, peer) {
			// defer peer fallbacks until layout determines which are needed
			if (!peer) {
				store.add(pkg);
			}
		},
	});

	const layout = isolate(resolution.roots);
	await store.link(layout);

	return { resolution, layout };
};
