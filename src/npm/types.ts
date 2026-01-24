/**
 * the parsed package.json of the main package.
 * includes fields relevant for export discovery and display.
 */
export interface PackageJson {
	name: string;
	version: string;
	description?: string;
	license?: string;
	main?: string;
	module?: string;
	browser?: string | Record<string, string | false>;
	types?: string;
	typings?: string;
	exports?: PackageExports;
	type?: 'module' | 'commonjs';
	peerDependencies?: Record<string, string>;
}

/**
 * package exports field - can be a string, array, object, or nested conditions.
 * https://nodejs.org/api/packages.html#exports
 */
export type PackageExports = string | string[] | { [key: string]: PackageExports } | null;

/**
 * npm registry packument - the full metadata for a package including all versions.
 * fetched from registry.npmjs.org/{package-name}
 */
export interface Packument {
	name: string;
	'dist-tags': Record<string, string>;
	versions: Record<string, PackageManifest>;
	time?: Record<string, string>;
}

/**
 * package manifest for a specific version.
 * this is what you'd find in a package.json plus registry metadata.
 */
export interface PackageManifest {
	name: string;
	version: string;
	description?: string;
	license?: string;
	main?: string;
	module?: string;
	exports?: PackageExports;
	type?: 'module' | 'commonjs';
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	optionalDependencies?: Record<string, string>;
	dist: {
		tarball: string;
		integrity?: string;
		shasum?: string;
		/** total unpacked size in bytes */
		unpackedSize?: number;
		/** number of files in the tarball */
		fileCount?: number;
	};
}

/**
 * a resolved package with its dependencies.
 * this is the output of the resolution step before hoisting.
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
	/** package description */
	description?: string;
	/** license identifier */
	license?: string;
	/** resolved dependencies (name -> ResolvedPackage) */
	dependencies: Map<string, ResolvedPackage>;
}

/**
 * supported package registries.
 */
export type Registry = 'npm' | 'jsr';

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
 * a node in the hoisted node_modules structure.
 * represents what should be written to node_modules/{name}
 */
export interface HoistedNode {
	name: string;
	version: string;
	tarball: string;
	integrity?: string;
	/** unpacked size in bytes (from registry) */
	unpackedSize?: number;
	/** package description */
	description?: string;
	/** license identifier */
	license?: string;
	/** number of direct dependencies */
	dependencyCount: number;
	/** nested node_modules for this package (when hoisting fails) */
	nested: Map<string, HoistedNode>;
}

/**
 * the result of hoisting - a flat(ish) node_modules structure.
 */
export interface HoistedResult {
	/** top-level node_modules entries */
	root: Map<string, HoistedNode>;
}
