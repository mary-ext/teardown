import * as semver from 'semver';
import * as v from 'valibot';

import { parsePackageSpecifier } from '../../lib/package-name';
import type { Registry } from '../../lib/package-name';

import { InvalidManifestError, InvalidSpecifierError, NoMatchingVersionError } from './errors';
import { applyPackageExtensions } from './package-extensions';
import { packageExtensions } from './package-extensions-data';
import { reverseJsrName } from './jsr-name';
import { fetchPackument } from './registry';
import { abbreviatedManifestSchema } from './types';
import type {
	AbbreviatedManifest,
	PackageSpecifier,
	PackumentVersion,
	ResolvedPackage,
	ResolutionResult,
} from './types';

/**
 * parses a package specifier string into name, range, and registry.
 * handles scoped packages, JSR packages, and various formats:
 * - "foo" -> { name: "foo", range: "latest", registry: "npm" }
 * - "foo@^1.0.0" -> { name: "foo", range: "^1.0.0", registry: "npm" }
 * - "@scope/foo@~2.0.0" -> { name: "@scope/foo", range: "~2.0.0", registry: "npm" }
 * - "npm:foo@^1.0.0" -> { name: "foo", range: "^1.0.0", registry: "npm" }
 * - "jsr:@luca/flag" -> { name: "@luca/flag", range: "latest", registry: "jsr" }
 * - "jsr:@luca/flag@^1.0.0" -> { name: "@luca/flag", range: "^1.0.0", registry: "jsr" }
 *
 * @param spec the package specifier string
 * @returns parsed specifier with name, range, and registry
 */
export function parseSpecifier(spec: string): PackageSpecifier {
	const parsed = parsePackageSpecifier(spec);
	if (!parsed) {
		throw new InvalidSpecifierError(spec, `invalid package specifier`);
	}
	if (parsed.registry === 'jsr' && !parsed.name.startsWith('@')) {
		throw new InvalidSpecifierError(spec, `JSR packages must be scoped`);
	}
	return parsed;
}

/**
 * selects the preferred version that satisfies a range.
 * @param versions versions by version string
 * @param distTags dist-tags by tag
 * @param range version range or dist-tag
 * @returns the selected version, or null when none match
 */
export function pickVersion(
	versions: Record<string, PackumentVersion>,
	distTags: Record<string, string>,
	range: string,
): string | null {
	// empty range means latest
	if (range === '') {
		const latest = distTags.latest!;
		return latest in versions ? latest : null;
	}

	// check if range is a dist-tag
	if (range in distTags) {
		const taggedVersion = distTags[range]!;
		return taggedVersion in versions ? taggedVersion : null;
	}

	// normalize loose version formats (v1.0.0, = 1.0.0)
	const cleanedRange = semver.validRange(range, { loose: true }) ?? range;

	// check if range is an exact version
	if (versions[range]) {
		return range;
	}

	// check cleaned version (handles v1.0.0 -> 1.0.0)
	const cleanedVersion = semver.clean(range, { loose: true });
	if (cleanedVersion && versions[cleanedVersion]) {
		return cleanedVersion;
	}

	// for wildcard ranges, use loose mode to include prereleases
	const isWildcard = range === '*' || range === 'x' || range === '';
	const satisfiesOptions = { loose: true, includePrerelease: isWildcard };

	// prefer 'latest' tag if it satisfies the range (pnpm behavior)
	// publishers tag 'latest' intentionally, so respect that choice
	const latestVersion = distTags.latest;
	if (latestVersion && versions[latestVersion]) {
		if (semver.satisfies(latestVersion, cleanedRange, satisfiesOptions)) {
			return latestVersion;
		}
	}

	// find all versions satisfying the range
	const validVersions = Object.keys(versions)
		.filter((v) => semver.satisfies(v, cleanedRange, satisfiesOptions))
		// oxlint-disable-next-line unicorn/no-array-sort
		.sort(semver.rcompare);

	if (validVersions.length === 0) {
		return null;
	}

	// prefer non-deprecated versions (pnpm behavior)
	const nonDeprecated = validVersions.find((v) => !versions[v]!.deprecated);
	if (nonDeprecated !== undefined) {
		return nonDeprecated;
	}

	// fall back to deprecated if no alternatives
	return validVersions[0]!;
}

const parseManifest = (entry: PackumentVersion, name: string, version: string): AbbreviatedManifest => {
	const result = v.safeParse(abbreviatedManifestSchema, entry);
	if (!result.success) {
		throw new InvalidManifestError(name, version, result.issues[0].message);
	}
	return result.output;
};

/**
 * options for dependency resolution.
 */
export interface ResolveOptions {
	/**
	 * whether to auto-install peer dependencies.
	 * when true, required (non-optional) peer dependencies are resolved automatically.
	 * @default true
	 */
	installPeers?: boolean;
	/**
	 * called for each resolved edge, including cached packages, without waiting for dependencies.
	 * @param pkg the resolved package; its dependencies may still be pending
	 * @param edge how the package was reached
	 */
	onResolve?: (pkg: ResolvedPackage, edge: ResolvedEdge) => void;
}

export interface ResolvedEdge {
	/** already resolved through another edge */
	cached: boolean;
	/** reached through an auto-installed peer fallback */
	peer: boolean;
}

/**
 * context for tracking resolution state across recursive calls.
 */
interface ResolutionContext {
	/** all resolved packages by "registry:name@version" key for deduping */
	resolved: Map<string, ResolvedPackage>;
	/** whether required peer dependencies are auto-installed */
	installPeers: boolean;
	onResolve: ResolveOptions['onResolve'];
}

/**
 * a dependency edge to resolve.
 */
interface Edge {
	name: string;
	/** version range to satisfy */
	range: string;
	registry: Registry;
	/** whether the edge only exists through an auto-installed peer dependency */
	peer: boolean;
}

/**
 * resolves a single package and its dependencies recursively.
 *
 * @param edge the dependency edge to resolve
 * @param ctx resolution context for deduping
 * @returns the resolved package tree
 */
async function resolvePackage(
	{ name, range, registry, peer }: Edge,
	ctx: ResolutionContext,
): Promise<ResolvedPackage> {
	const packument = await fetchPackument(name, registry);
	const version = pickVersion(packument.versions, packument['dist-tags'], range);

	if (version === null) {
		throw new NoMatchingVersionError(name, range);
	}

	const parsed = parseManifest(packument.versions[version]!, name, version);

	const key = `${registry}:${name}@${parsed.version}`;

	// early registration allows deduplication to terminate dependency cycles
	const existing = ctx.resolved.get(key);
	if (existing) {
		ctx.onResolve?.(existing, { cached: true, peer });
		return existing;
	}

	const manifest = applyPackageExtensions(parsed, packageExtensions);

	const resolved: ResolvedPackage = {
		name,
		version: manifest.version,
		tarball: manifest.dist.tarball,
		integrity: manifest.dist.integrity,
		unpackedSize: manifest.dist.unpackedSize,
		dependencies: new Map(),
		peers: new Set(),
	};

	ctx.resolved.set(key, resolved);
	ctx.onResolve?.(resolved, { cached: false, peer });

	// dependencies of a peer fallback are needed only if the fallback is used
	const depsToResolve: Array<[name: string, range: string, peer: boolean]> = [];

	// add regular dependencies
	const deps = manifest.dependencies ?? {};
	for (const [depName, depRange] of Object.entries(deps)) {
		depsToResolve.push([depName, depRange, peer]);
	}

	// resolve required peers as fallbacks for peers not provided by ancestors
	if (manifest.peerDependencies) {
		const peerMeta = manifest.peerDependenciesMeta ?? {};
		for (const [peerName, peerRange] of Object.entries(manifest.peerDependencies)) {
			// regular deps take precedence
			if (peerName in deps) {
				continue;
			}

			resolved.peers.add(peerName);

			if (ctx.installPeers && peerMeta[peerName]?.optional !== true) {
				depsToResolve.push([peerName, peerRange, true]);
			}
		}
	}

	// resolve all dependencies in parallel
	const resolvedDeps = await Promise.all(
		depsToResolve.map(async ([depName, depRange, depPeer]) => {
			// when a JSR package depends on @jsr/*, reverse to canonical name and fetch from JSR
			// otherwise use npm (even for @jsr/* from npm packages - that's what the author intended)
			let resolvedName = depName;
			let depRegistry: Registry = 'npm';
			if (registry === 'jsr' && depName.startsWith('@jsr/')) {
				resolvedName = reverseJsrName(depName);
				depRegistry = 'jsr';
			}
			const dep = await resolvePackage(
				{ name: resolvedName, range: depRange, registry: depRegistry, peer: depPeer },
				ctx,
			);
			return [depName, dep] as const;
		}),
	);

	for (const [depName, dep] of resolvedDeps) {
		resolved.dependencies.set(depName, dep);
	}

	return resolved;
}

/**
 * resolves one or more packages and all their dependencies.
 * this is the main entry point for dependency resolution.
 *
 * @param specifiers package specifiers to resolve (e.g., ["react@^18.0.0", "jsr:@luca/flag"])
 * @param options resolution options
 * @returns the full resolution result with all packages
 */
export async function resolve(specifiers: string[], options: ResolveOptions = {}): Promise<ResolutionResult> {
	const ctx: ResolutionContext = {
		resolved: new Map(),
		installPeers: options.installPeers ?? true,
		onResolve: options.onResolve,
	};

	const parsedSpecs = specifiers.map(parseSpecifier);

	const roots = await Promise.all(
		parsedSpecs.map(({ name, range, registry }) =>
			resolvePackage({ name, range, registry, peer: false }, ctx),
		),
	);

	return {
		roots,
		packages: ctx.resolved,
	};
}
