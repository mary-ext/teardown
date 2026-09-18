import * as v from 'valibot';

import type { Registry } from '../../lib/package-name';

// #region package.json schema

/**
 * package exports field - can be a string, array, object, or nested conditions.
 * @see https://nodejs.org/api/packages.html#exports
 */
const packageExportsSchema: v.GenericSchema<PackageExports> = v.union([
	v.null(),
	v.string(),
	v.array(v.string()),
	v.record(
		v.string(),
		v.lazy(() => packageExportsSchema),
	),
]);

export type PackageExports = string | string[] | { [key: string]: PackageExports } | null;

/**
 * base package.json schema with all standard fields.
 * other schemas pick from this to ensure consistency.
 * @see https://docs.npmjs.com/cli/v10/configuring-npm/package-json
 */
export const packageJsonSchema = v.object({
	name: v.string(),
	version: v.string(),
	description: v.optional(v.string()),
	keywords: v.optional(v.array(v.string())),
	homepage: v.optional(v.string()),
	license: v.optional(v.string()),
	main: v.optional(v.string()),
	module: v.optional(v.string()),
	browser: v.optional(v.union([v.string(), v.record(v.string(), v.union([v.string(), v.literal(false)]))])),
	types: v.optional(v.string()),
	typings: v.optional(v.string()),
	exports: v.optional(packageExportsSchema),
	type: v.optional(v.picklist(['module', 'commonjs'])),
	bin: v.optional(v.union([v.string(), v.record(v.string(), v.string())])),
	directories: v.optional(v.record(v.string(), v.string())),
	dependencies: v.optional(v.record(v.string(), v.string())),
	devDependencies: v.optional(v.record(v.string(), v.string())),
	peerDependencies: v.optional(v.record(v.string(), v.string())),
	peerDependenciesMeta: v.optional(v.record(v.string(), v.object({ optional: v.optional(v.boolean()) }))),
	bundleDependencies: v.optional(v.union([v.boolean(), v.array(v.string())])),
	optionalDependencies: v.optional(v.record(v.string(), v.string())),
	engines: v.optional(v.record(v.string(), v.string())),
	os: v.optional(v.array(v.string())),
	cpu: v.optional(v.array(v.string())),
	deprecated: v.optional(v.union([v.string(), v.boolean()])),
	sideEffects: v.optional(v.union([v.boolean(), v.array(v.string())])),
});

export type PackageJson = v.InferOutput<typeof packageJsonSchema>;

// #endregion

// #region abbreviated packument schemas

/**
 * distribution metadata for a package version.
 */
const distSchema = v.object({
	tarball: v.string(),
	integrity: v.optional(v.string()),
	unpackedSize: v.optional(v.number()),
});

/**
 * ignores malformed dependency ranges found in older releases and registry proxies.
 */
const dependencyMapSchema = v.pipe(
	v.unknown(),
	v.transform((input): Record<string, string> | undefined => {
		if (typeof input !== 'object' || input === null || Array.isArray(input)) {
			return undefined;
		}

		const ranges: Record<string, string> = {};
		for (const [name, range] of Object.entries(input)) {
			if (typeof range === 'string') {
				ranges[name] = range;
			}
		}
		return ranges;
	}),
);

/**
 * bundled dependency names, or `true` for all dependencies. malformed values are ignored.
 */
const bundleDependenciesSchema = v.fallback(
	v.optional(v.union([v.boolean(), v.array(v.string())])),
	undefined,
);

/**
 * manifest fields used during dependency resolution.
 * @see https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md#abbreviated-metadata-format
 */
export const abbreviatedManifestSchema = v.object({
	...v.pick(packageJsonSchema, ['name', 'version', 'deprecated', 'peerDependenciesMeta']).entries,
	dependencies: v.optional(dependencyMapSchema),
	optionalDependencies: v.optional(dependencyMapSchema),
	peerDependencies: v.optional(dependencyMapSchema),
	bundleDependencies: bundleDependenciesSchema,
	// legacy spelling
	bundledDependencies: bundleDependenciesSchema,
	dist: distSchema,
});

export type AbbreviatedManifest = v.InferOutput<typeof abbreviatedManifestSchema>;

const packumentVersionSchema = v.looseObject({
	deprecated: v.optional(v.unknown()),
});

export type PackumentVersion = v.InferOutput<typeof packumentVersionSchema>;

/**
 * abbreviated packument - minimal metadata for package resolution.
 * returned when requesting with Accept: application/vnd.npm.install-v1+json
 * @see https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md#abbreviated-metadata-format
 */
export const abbreviatedPackumentSchema = v.object({
	name: v.string(),
	// optional because some registries (e.g., JSR's npm mirror) may not include it
	modified: v.optional(v.string()),
	'dist-tags': v.record(v.string(), v.string()),
	versions: v.record(v.string(), packumentVersionSchema),
});

export type AbbreviatedPackument = v.InferOutput<typeof abbreviatedPackumentSchema>;

// #endregion

/**
 * a resolved package before layout.
 */
export interface ResolvedPackage {
	name: string;
	version: string;
	/** the tarball URL for fetching */
	tarball: string;
	/** SRI integrity hash if available */
	integrity?: string;
	/** unpacked size in bytes (from registry) */
	unpackedSize?: number;
	/** resolved dependencies (name -> ResolvedPackage), including auto-installed peers */
	dependencies: Map<string, ResolvedPackage>;
	/**
	 * peer names, including optional peers, excluding the package's own name and names declared as
	 * regular or optional dependencies
	 */
	peers: Set<string>;
}

/**
 * the input to the resolver - a package specifier.
 * can be just a name (uses latest) or name@version/range.
 */
export interface PackageSpecifier {
	name: string;
	/** version, range, or dist-tag. defaults to 'latest' */
	range: string;
	/** which registry to fetch from. defaults to 'npm' */
	registry: Registry;
}

/**
 * the full resolution result - a tree of resolved packages.
 */
export interface ResolutionResult {
	/** the root package(s) that were requested */
	roots: ResolvedPackage[];
	/** all unique packages in the resolution (for deduping) */
	packages: Map<string, ResolvedPackage>;
}

/**
 * a package instance at
 * `/node_modules/.pnpm/{id}/node_modules/{pkg.name}`.
 */
export interface StoreEntry {
	/**
	 * directory name under `/node_modules/.pnpm`: encoded `name@version` with peer-context
	 * suffixes, truncated with a hash if needed
	 */
	id: string;
	/** the package this entry is an instance of */
	pkg: ResolvedPackage;
	/** links placed next to the package, by dependency name -> target entry id */
	links: Map<string, string>;
}

/**
 * a virtual store layout and its external links.
 */
export interface IsolatedResult {
	/** every store entry by id */
	entries: Map<string, StoreEntry>;
	/** links under `/node_modules`, by package name -> entry id */
	roots: Map<string, string>;
	/**
	 * fallback links for undeclared imports under `/node_modules/.pnpm/node_modules`,
	 * by package name -> entry id
	 */
	hoisted: Map<string, string>;
}
