import * as v from 'valibot';

import type { Registry } from '../../lib/package-name';

import { FetchError, PackageNotFoundError } from './errors';
import { transformJsrName } from './jsr-name';
import { abbreviatedPackumentSchema, type AbbreviatedPackument } from './types';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const JSR_REGISTRY = 'https://npm.jsr.io';

/**
 * packuments by `registry:name`; promises let concurrent lookups share a fetch.
 */
const packumentCache = new Map<string, Promise<AbbreviatedPackument>>();

/**
 * fetches the abbreviated packument from a registry.
 * the abbreviated format contains only installation-relevant metadata.
 *
 * @param name the package name (can be scoped like @scope/pkg)
 * @param registry which registry to fetch from (defaults to 'npm')
 * @returns the abbreviated packument with all versions
 * @throws if the package doesn't exist, network fails, or response is invalid
 */
export function fetchPackument(name: string, registry: Registry = 'npm'): Promise<AbbreviatedPackument> {
	const cacheKey = `${registry}:${name}`;

	let promise = packumentCache.get(cacheKey);
	if (promise === undefined) {
		promise = loadPackument(name, registry);
		packumentCache.set(cacheKey, promise);

		// allow later lookups to try again
		promise.catch(() => packumentCache.delete(cacheKey));
	}

	return promise;
}

async function loadPackument(name: string, registry: Registry): Promise<AbbreviatedPackument> {
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

	const json = await response.json();
	return v.parse(abbreviatedPackumentSchema, json);
}
