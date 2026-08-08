import * as semver from 'semver';

import type { Registry } from '../lib/package-name';

import { fetchPackument } from './lib/registry';
import { pickVersion } from './lib/resolve';
import type { PackumentVersion } from './lib/types';

/**
 * resolved packument-level metadata for a package.
 * fetched on the main thread so the package header (with a version switcher)
 * can render before the bundler worker is spawned. keyed on registry + name
 * only — version selection happens separately so switching versions doesn't
 * refetch the packument or remount the header.
 */
export interface PackageManifest {
	registry: Registry;
	name: string;
	versions: Record<string, PackumentVersion>;
	distTags: Record<string, string>;
	/** all available versions, sorted newest first */
	availableVersions: string[];
}

/**
 * fetches the packument for a package. the browser's http cache handles
 * deduping with the worker's own packument fetch during dependency resolution.
 */
export async function fetchPackageManifest(registry: Registry, name: string): Promise<PackageManifest> {
	const packument = await fetchPackument(name, registry);
	const availableVersions = Object.keys(packument.versions).toSorted(semver.rcompare);

	return {
		registry,
		name,
		versions: packument.versions,
		distTags: packument['dist-tags'],
		availableVersions,
	};
}

/**
 * resolves a range against a package manifest, returning the matching version string.
 */
export function pickPackageVersion(manifest: PackageManifest, range: string): string | undefined {
	return pickVersion(manifest.versions, manifest.distTags, range) ?? undefined;
}
