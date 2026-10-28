import { partition } from '@mary/array-fns';
import { cleanVersion, maxSatisfying, parseRange, parseVersion, satisfies } from '@oomfware/semver';
import type { Range } from '@oomfware/semver';
import * as v from 'valibot';

import { parsePackageSpecifier } from '../../lib/package-name';
import type { Registry } from '../../lib/package-name';

import { InvalidManifestError, InvalidSpecifierError, NoMatchingVersionError } from './errors';
import { reverseJsrName } from './jsr-name';
import { applyPackageExtensions } from './package-extensions';
import { packageExtensions } from './package-extensions-data';
import { fetchPackument } from './registry';
import { abbreviatedManifestSchema } from './types';
import type { AbbreviatedManifest, PackageSpecifier, ResolvedPackage, ResolutionResult } from './types';

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

const splitNameAndRange = (spec: string): { name: string; range: string } => {
	const at = spec.indexOf('@', 1);
	if (at === -1) {
		return { name: spec, range: 'latest' };
	}
	return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' };
};

/**
 * resolves a manifest dependency's name, range, and registry.
 * accepts ranges, dist-tags, `npm:` aliases, `jsr:` specifiers, and JSR's `@jsr/*` names.
 *
 * @param name the dependency's declared import name
 * @param range the declared range or specifier
 * @param parentRegistry the registry of the declaring package
 * @returns the canonical package name, range, and registry to fetch
 * @throws {InvalidSpecifierError} for Git, URL, or file dependencies
 */
export function parseDependency(name: string, range: string, parentRegistry: Registry): PackageSpecifier {
	if (range.startsWith('npm:')) {
		const target = splitNameAndRange(range.slice(4));
		// JSR's npm compatibility names only exist on JSR's registry
		if (target.name.startsWith('@jsr/')) {
			return { name: reverseJsrName(target.name), range: target.range, registry: 'jsr' };
		}
		return { ...target, registry: 'npm' };
	}

	if (range.startsWith('jsr:')) {
		const rest = range.slice(4);
		// either `jsr:@scope/name@range` or `jsr:range` for the declared name
		if (rest.startsWith('@')) {
			return { ...splitNameAndRange(rest), registry: 'jsr' };
		}
		return { name, range: rest || 'latest', registry: 'jsr' };
	}

	// semver ranges and dist-tags never contain these, but URLs, paths and git shorthands do
	if (range.includes(':') || range.includes('/')) {
		throw new InvalidSpecifierError(`${name}@${range}`, `only registry dependencies are supported`);
	}

	// only JSR manifests use bare `@jsr/*` names for JSR dependencies
	if (parentRegistry === 'jsr' && name.startsWith('@jsr/')) {
		return { name: reverseJsrName(name), range, registry: 'jsr' };
	}

	return { name, range, registry: 'npm' };
}

const isDeprecated = (entry: unknown): boolean => {
	return typeof entry === 'object' && entry !== null && 'deprecated' in entry && !!entry.deprecated;
};

const ANY_STABLE: Range = parseRange('*', { loose: true })!;
const ANY: Range = parseRange('*', { loose: true, includePrerelease: true })!;

/**
 * uses `latest`, falling back to the highest stable version, then the highest prerelease.
 */
const getLatest = (
	versions: Record<string, unknown>,
	distTags: Record<string, string>,
): string | undefined => {
	if (Object.hasOwn(distTags, 'latest')) {
		return distTags.latest;
	}

	const all = Object.keys(versions);
	return maxSatisfying(all, ANY_STABLE) ?? maxSatisfying(all, ANY) ?? undefined;
};

/**
 * selects the preferred version that satisfies a range.
 * @param versions version entries by version string
 * @param distTags dist-tags by tag
 * @param range version range or dist-tag
 * @returns the selected version, or null when none match
 */
export function pickVersion(
	versions: Record<string, unknown>,
	distTags: Record<string, string>,
	range: string,
): string | null {
	if (range === '' || range === 'latest') {
		const latest = getLatest(versions, distTags);
		return latest !== undefined && Object.hasOwn(versions, latest) ? latest : null;
	}

	// check if range is a dist-tag
	if (Object.hasOwn(distTags, range)) {
		const taggedVersion = distTags[range]!;
		return Object.hasOwn(versions, taggedVersion) ? taggedVersion : null;
	}

	// check if range is an exact version
	if (Object.hasOwn(versions, range)) {
		return range;
	}

	// check cleaned version (handles v1.0.0 -> 1.0.0)
	const cleanedVersion = cleanVersion(range, { loose: true });
	if (cleanedVersion && Object.hasOwn(versions, cleanedVersion)) {
		return cleanedVersion;
	}

	// wildcard ranges include prereleases
	const parsed = parseRange(range, { loose: true, includePrerelease: range === '*' || range === 'x' });
	if (parsed === null) {
		return null;
	}

	// prefer 'latest' tag if it satisfies the range (pnpm behavior)
	// publishers tag 'latest' intentionally, so respect that choice
	const latestVersion = distTags.latest;
	if (latestVersion !== undefined && Object.hasOwn(versions, latestVersion)) {
		const latest = parseVersion(latestVersion, parsed);
		if (latest !== null && satisfies(latest, parsed)) {
			return latestVersion;
		}
	}

	// highest satisfying version, preferring non-deprecated versions (pnpm behavior)
	const [deprecated, current] = partition(Object.keys(versions), (version) =>
		isDeprecated(versions[version]),
	);
	return maxSatisfying(current, parsed) ?? maxSatisfying(deprecated, parsed);
}

const parseManifest = (entry: unknown, name: string, version: string): AbbreviatedManifest => {
	const result = v.safeParse(abbreviatedManifestSchema, entry);
	if (!result.success) {
		throw new InvalidManifestError(name, version, result.issues[0].message);
	}
	return result.output;
};

const getBundledNames = (manifest: AbbreviatedManifest): Set<string> => {
	const bundled = manifest.bundleDependencies ?? manifest.bundledDependencies;
	if (bundled === true) {
		return new Set(Object.keys(manifest.dependencies ?? {}));
	}
	return new Set(Array.isArray(bundled) ? bundled : []);
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
	/** picked versions by "registry:name@range" key */
	picked: Map<string, string | null>;
	/** names requested at the root, which provide peers to every package */
	rootNames: Set<string>;
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

	let version: string | null;
	{
		const pickKey = `${registry}:${name}@${range}`;
		const picked = ctx.picked.get(pickKey);
		if (picked !== undefined) {
			version = picked;
		} else {
			version = pickVersion(packument.versions, packument['dist-tags'], range);
			ctx.picked.set(pickKey, version);
		}
	}

	if (version === null) {
		throw new NoMatchingVersionError(name, range);
	}

	const key = `${registry}:${name}@${version}`;

	// early registration allows deduplication to terminate dependency cycles
	const existing = ctx.resolved.get(key);
	if (existing) {
		ctx.onResolve?.(existing, { cached: true, peer });
		return existing;
	}

	const parsed = parseManifest(packument.versions[version], name, version);
	const manifest = applyPackageExtensions(parsed, packageExtensions);

	const resolved: ResolvedPackage = {
		name,
		registry,
		version: manifest.version,
		tarball: manifest.dist.tarball,
		integrity: manifest.dist.integrity,
		unpackedSize: manifest.dist.unpackedSize,
		dependencies: new Map(),
		peers: new Map(),
	};

	ctx.resolved.set(key, resolved);
	ctx.onResolve?.(resolved, { cached: false, peer });

	// dependencies of a peer fallback are needed only if the fallback is used
	const depsToResolve: Array<[name: string, range: string, peer: boolean]> = [];

	const deps = manifest.dependencies ?? {};
	const optionalDeps = manifest.optionalDependencies ?? {};

	// add regular dependencies
	{
		const bundled = getBundledNames(manifest);
		for (const [depName, depRange] of Object.entries(deps)) {
			// optional declarations override regular ones; bundled dependencies are already in the tarball
			if (Object.hasOwn(optionalDeps, depName) || bundled.has(depName)) {
				continue;
			}
			depsToResolve.push([depName, depRange, peer]);
		}
	}

	// resolve required peers as fallbacks for peers not provided by ancestors
	if (manifest.peerDependencies) {
		const peerMeta = manifest.peerDependenciesMeta ?? {};
		for (const [peerName, peerRange] of Object.entries(manifest.peerDependencies)) {
			// the package itself and declared dependencies take precedence
			if (peerName === name || Object.hasOwn(deps, peerName) || Object.hasOwn(optionalDeps, peerName)) {
				continue;
			}

			resolved.peers.set(peerName, peerRange);

			// roots provide peers to every package, so their fallbacks would go unused
			if (ctx.installPeers && peerMeta[peerName]?.optional !== true && !ctx.rootNames.has(peerName)) {
				depsToResolve.push([peerName, peerRange, true]);
			}
		}
	}

	// resolve all dependencies in parallel
	const resolvedDeps = await Promise.all(
		depsToResolve.map(async ([depName, depRange, depPeer]) => {
			const target = parseDependency(depName, depRange, registry);
			const dep = await resolvePackage({ ...target, peer: depPeer }, ctx);
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
	const parsedSpecs = specifiers.map(parseSpecifier);

	const ctx: ResolutionContext = {
		resolved: new Map(),
		picked: new Map(),
		rootNames: new Set(parsedSpecs.map((spec) => spec.name)),
		installPeers: options.installPeers ?? true,
		onResolve: options.onResolve,
	};

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
