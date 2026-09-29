import { parseRange, satisfies } from '../../lib/semver/range';

import type { AbbreviatedManifest } from './types';

/**
 * dependencies a package uses without declaring, for the versions matching `range`.
 */
export interface PackageExtension {
	/** semver range of the package versions this applies to */
	range: string;
	/** dependencies to add, by name -> range */
	dependencies?: Record<string, string>;
	/** peer dependencies to add, by name -> range */
	peerDependencies?: Record<string, string>;
	/** names of `peerDependencies` that are optional */
	optionalPeers?: string[];
}

const orUndefined = <T extends object>(record: T): T | undefined => {
	return Object.keys(record).length > 0 ? record : undefined;
};

const matches = (version: string, range: string): boolean => {
	if (range === '*') {
		return true;
	}
	const parsed = parseRange(range, { includePrerelease: true });
	return parsed !== null && satisfies(version, parsed);
};

/**
 * adds known undeclared dependencies, preserving manifest declarations.
 *
 * @param manifest the package manifest
 * @param extensions extensions by package name
 * @returns an extended copy, or the original manifest if no rules match
 */
export const applyPackageExtensions = (
	manifest: AbbreviatedManifest,
	extensions: Record<string, PackageExtension[]>,
): AbbreviatedManifest => {
	// package names can collide with Object.prototype members
	if (!Object.hasOwn(extensions, manifest.name)) {
		return manifest;
	}

	const matching = extensions[manifest.name]!.filter((rule) => matches(manifest.version, rule.range));
	if (matching.length === 0) {
		return manifest;
	}

	const dependencies: Record<string, string> = {};
	const peerDependencies: Record<string, string> = {};
	const peerDependenciesMeta: Record<string, { optional?: boolean }> = {};
	for (const rule of matching) {
		Object.assign(dependencies, rule.dependencies);
		Object.assign(peerDependencies, rule.peerDependencies);
		for (const name of rule.optionalPeers ?? []) {
			// preserve declared peers' optionality
			if (!manifest.peerDependencies?.[name]) {
				peerDependenciesMeta[name] = { optional: true };
			}
		}
	}

	// declared fields win
	Object.assign(dependencies, manifest.dependencies);
	Object.assign(peerDependencies, manifest.peerDependencies);
	Object.assign(peerDependenciesMeta, manifest.peerDependenciesMeta);

	return {
		...manifest,
		dependencies: orUndefined(dependencies),
		peerDependencies: orUndefined(peerDependencies),
		peerDependenciesMeta: orUndefined(peerDependenciesMeta),
	};
};
