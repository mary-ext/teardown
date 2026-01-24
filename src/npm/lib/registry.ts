import { FetchError, InvalidSpecifierError, PackageNotFoundError } from './errors';
import type { Packument, Registry } from './types';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const JSR_REGISTRY = 'https://npm.jsr.io';

/**
 * cache for packuments to avoid refetching during resolution.
 * key format: "registry:name" (e.g., "npm:react" or "jsr:@luca/flag")
 */
const packumentCache = new Map<string, Packument>();

/**
 * transforms a JSR package name to the npm-compatible format.
 * `@scope/name` becomes `@jsr/scope__name`
 *
 * @param name the JSR package name (must be scoped)
 * @returns the transformed npm-compatible name
 */
export function transformJsrName(name: string): string {
	if (!name.startsWith('@')) {
		throw new InvalidSpecifierError(name, 'JSR packages must be scoped');
	}
	// @scope/name -> @jsr/scope__name
	const withoutAt = name.slice(1); // "scope/name"
	const transformed = withoutAt.replace('/', '__'); // "scope__name"
	return `@jsr/${transformed}`;
}

/**
 * reverses the JSR npm-compatible name back to the canonical format.
 * `@jsr/scope__name` becomes `@scope/name`
 *
 * @param name the npm-compatible JSR package name
 * @returns the canonical JSR package name
 */
export function reverseJsrName(name: string): string {
	if (!name.startsWith('@jsr/')) {
		throw new InvalidSpecifierError(name, 'not a JSR npm-compatible name');
	}
	// @jsr/scope__name -> @scope/name
	const withoutPrefix = name.slice(5); // "scope__name"
	const restored = withoutPrefix.replace('__', '/'); // "scope/name"
	return `@${restored}`;
}

/**
 * fetches the packument (full package metadata) from a registry.
 * uses the abbreviated format when possible for smaller payloads.
 *
 * @param name the package name (can be scoped like @scope/pkg)
 * @param registry which registry to fetch from (defaults to 'npm')
 * @returns the packument with all versions
 * @throws if the package doesn't exist or network fails
 */
export async function fetchPackument(name: string, registry: Registry = 'npm'): Promise<Packument> {
	const cacheKey = `${registry}:${name}`;
	const cached = packumentCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	let registryUrl: string;
	let fetchName: string;

	if (registry === 'jsr') {
		registryUrl = JSR_REGISTRY;
		fetchName = transformJsrName(name);
	} else {
		registryUrl = NPM_REGISTRY;
		fetchName = name;
	}

	const encodedName = fetchName.startsWith('@')
		? `@${encodeURIComponent(fetchName.slice(1))}`
		: encodeURIComponent(fetchName);

	const url = `${registryUrl}/${encodedName}`;

	const response = await fetch(url, {
		headers: {
			// request abbreviated format (corgi) for smaller payloads
			Accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
		},
	});

	if (!response.ok) {
		if (response.status === 404) {
			throw new PackageNotFoundError(name, registry);
		}
		throw new FetchError(url, response.status, response.statusText);
	}

	const packument = (await response.json()) as Packument;
	packumentCache.set(cacheKey, packument);
	return packument;
}

/**
 * clears the packument cache.
 * useful for testing or when you want fresh data.
 */
export function clearPackumentCache(): void {
	packumentCache.clear();
}
