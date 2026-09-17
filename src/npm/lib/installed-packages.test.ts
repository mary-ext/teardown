import { describe, expect, it } from 'vitest';

import { buildInstalledPackages } from './installed-packages';
import { isolate } from './isolate';
import { resolve } from './resolve';
import type { ResolutionResult, ResolvedPackage } from './types';

const build = (result: ResolutionResult, peerDepNames: Set<string>) => {
	return buildInstalledPackages(isolate(result.roots), result.roots[0]!.name, peerDepNames);
};

const pkg = (spec: string, deps: ResolvedPackage[] = [], peers: string[] = []): ResolvedPackage => {
	const [name, version = '1.0.0'] = spec.split('@');
	return {
		name: name!,
		version,
		tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
		unpackedSize: 100,
		dependencies: new Map(deps.map((d) => [d.name, d])),
		peers: new Set(peers),
	};
};

describe('buildInstalledPackages', () => {
	it('lists each package version once across peer-specialised entries', () => {
		const lib = pkg('lib', [], ['react']);
		const app = pkg('app', [pkg('a', [pkg('react@17.0.0'), lib]), pkg('b', [pkg('react'), lib])]);
		const packages = buildInstalledPackages(isolate([app]), 'app', new Set());

		expect(packages.map((p) => `${p.name}@${p.version}`).toSorted()).toEqual([
			'a@1.0.0',
			'app@1.0.0',
			'b@1.0.0',
			'lib@1.0.0',
			'react@1.0.0',
			'react@17.0.0',
		]);

		const libInfo = packages.find((p) => p.name === 'lib')!;
		expect(libInfo.level).toBe(2);
		expect(libInfo.dependencies.map((d) => d.version).toSorted()).toEqual(['1.0.0', '17.0.0']);
		expect(libInfo.dependents.map((d) => d.name).toSorted()).toEqual(['a', 'b']);
	});

	it('leaves out auto-installed peers that a dependent provides', () => {
		const lib = pkg('lib', [pkg('react@19.0.0')], ['react']);
		const app = pkg('app', [pkg('react'), lib]);
		const packages = buildInstalledPackages(isolate([app]), 'app', new Set());

		expect(packages.filter((p) => p.name === 'react').map((p) => p.version)).toEqual(['1.0.0']);
	});

	it('clears peer-only status for packages also reachable through regular dependencies', () => {
		const shared = pkg('shared');
		const app = pkg('app', [pkg('peer', [shared]), pkg('dep', [pkg('deeper', [shared])])], ['peer']);
		const packages = buildInstalledPackages(isolate([app]), 'app', new Set(['peer']));

		const status = Object.fromEntries(packages.map((p) => [p.name, p.isPeer]));
		expect(status).toEqual({ app: false, dep: false, deeper: false, peer: true, shared: false });
	});

	it('builds packages from a simple dependency tree', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const packages = build(result, new Set());

		// should have is-odd and is-number
		const names = packages.map((p) => p.name);
		expect(names).toContain('is-odd');
		expect(names).toContain('is-number');

		// is-odd should be level 0, is-number should be level 1
		const isOdd = packages.find((p) => p.name === 'is-odd')!;
		const isNumber = packages.find((p) => p.name === 'is-number')!;
		expect(isOdd.level).toBe(0);
		expect(isNumber.level).toBe(1);

		// none should be marked as peer (no peer deps)
		expect(packages.every((p) => !p.isPeer)).toBe(true);
	});

	it('correctly sets dependents', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const packages = build(result, new Set());

		// is-odd is the root, no dependents
		const isOdd = packages.find((p) => p.name === 'is-odd')!;
		expect(isOdd.dependents.length).toBe(0);

		// is-number is depended on by is-odd
		const isNumber = packages.find((p) => p.name === 'is-number')!;
		expect(isNumber.dependents.length).toBe(1);
		expect(isNumber.dependents[0]!.name).toBe('is-odd');
	});

	it('correctly sets dependencies', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const packages = build(result, new Set());

		// is-odd has 1 dependency (is-number)
		const isOdd = packages.find((p) => p.name === 'is-odd')!;
		expect(isOdd.dependencies.length).toBe(1);
		expect(isOdd.dependencies[0]!.name).toBe('is-number');
	});

	it('marks peer dependencies correctly', async () => {
		// use-sync-external-store has react as a peer dependency
		const result = await resolve(['use-sync-external-store@1.2.0']);
		const peerDepNames = new Set(['react']);
		const packages = build(result, peerDepNames);

		// react and its deps should be marked as peer
		const react = packages.find((p) => p.name === 'react');
		expect(react).toBeDefined();
		expect(react!.isPeer).toBe(true);

		// use-sync-external-store should not be marked as peer
		const main = packages.find((p) => p.name === 'use-sync-external-store')!;
		expect(main.isPeer).toBe(false);

		// the dependency edge to react should be marked as peer
		const reactDep = main.dependencies.find((d) => d.name === 'react');
		expect(reactDep).toBeDefined();
		expect(reactDep!.isPeer).toBe(true);
	});

	it('marks transitive peer deps correctly', async () => {
		// use-sync-external-store@1.2.0 has react as peer
		// react has loose-envify as a regular dep
		// loose-envify should be marked as peer (only reachable through react)
		const result = await resolve(['use-sync-external-store@1.2.0']);
		const peerDepNames = new Set(['react']);
		const packages = build(result, peerDepNames);

		const looseEnvify = packages.find((p) => p.name === 'loose-envify');
		// loose-envify is a dep of react, which is peer-only
		if (looseEnvify) {
			expect(looseEnvify.isPeer).toBe(true);
		}
	});

	it('marks direct peer deps as peer even when also a transitive dep', async () => {
		// if a package is a direct peer dep of root but also reachable through
		// a transitive non-peer path, it should still be marked as peer
		const result = await resolve(['is-odd@3.0.1']);

		// pretend is-number is also a peer dep (but it's already a regular dep)
		const peerDepNames = new Set(['is-number']);
		const packages = build(result, peerDepNames);

		// is-number should be marked as peer because it's a direct peer dep of root
		const isNumber = packages.find((p) => p.name === 'is-number')!;
		expect(isNumber.isPeer).toBe(true);
	});

	it('marks peer deps as peer when also reachable through transitive deps', async () => {
		// graphql-request has graphql as a peer dep
		// @graphql-typed-document-node/core (a regular dep) also depends on graphql
		// graphql should still be marked as peer since it's a direct peer dep of root
		const result = await resolve(['graphql-request@7.4.0']);
		const peerDepNames = new Set(['graphql']);
		const packages = build(result, peerDepNames);

		// graphql should be marked as peer
		const graphql = packages.find((p) => p.name === 'graphql');
		expect(graphql).toBeDefined();
		expect(graphql!.isPeer).toBe(true);

		// @graphql-typed-document-node/core should NOT be marked as peer
		const typedDocNode = packages.find((p) => p.name === '@graphql-typed-document-node/core');
		expect(typedDocNode).toBeDefined();
		expect(typedDocNode!.isPeer).toBe(false);
	});
});
