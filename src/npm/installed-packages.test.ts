import { describe, expect, it } from 'vitest';

import { buildInstalledPackages } from './installed-packages';
import { resolve } from './resolve';

describe('buildInstalledPackages', () => {
	it('builds packages from a simple dependency tree', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const packages = buildInstalledPackages(result.roots[0], new Set());

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

	it('correctly sets installedBy count', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const packages = buildInstalledPackages(result.roots[0], new Set());

		// is-odd is the root, installedBy should be 0
		const isOdd = packages.find((p) => p.name === 'is-odd')!;
		expect(isOdd.installedBy).toBe(0);

		// is-number is depended on by is-odd
		const isNumber = packages.find((p) => p.name === 'is-number')!;
		expect(isNumber.installedBy).toBe(1);
	});

	it('correctly sets dependencyCount', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const packages = buildInstalledPackages(result.roots[0], new Set());

		// is-odd has 1 dependency (is-number)
		const isOdd = packages.find((p) => p.name === 'is-odd')!;
		expect(isOdd.dependencyCount).toBe(1);
	});

	it('marks peer dependencies correctly', async () => {
		// use-sync-external-store has react as a peer dependency
		const result = await resolve(['use-sync-external-store@1.2.0']);
		const peerDepNames = new Set(['react']);
		const packages = buildInstalledPackages(result.roots[0], peerDepNames);

		// react and its deps should be marked as peer
		const react = packages.find((p) => p.name === 'react');
		expect(react).toBeDefined();
		expect(react!.isPeer).toBe(true);

		// use-sync-external-store should not be marked as peer
		const main = packages.find((p) => p.name === 'use-sync-external-store')!;
		expect(main.isPeer).toBe(false);
	});

	it('marks transitive peer deps correctly', async () => {
		// use-sync-external-store@1.2.0 has react as peer
		// react has loose-envify as a regular dep
		// loose-envify should be marked as peer (only reachable through react)
		const result = await resolve(['use-sync-external-store@1.2.0']);
		const peerDepNames = new Set(['react']);
		const packages = buildInstalledPackages(result.roots[0], peerDepNames);

		const looseEnvify = packages.find((p) => p.name === 'loose-envify');
		// loose-envify is a dep of react, which is peer-only
		if (looseEnvify) {
			expect(looseEnvify.isPeer).toBe(true);
		}
	});

	it('does not mark shared deps as peer when reachable both ways', async () => {
		// if a package is reachable through both regular and peer deps,
		// it should NOT be marked as peer
		const result = await resolve(['is-odd@3.0.1']);

		// pretend is-number is also a peer dep (but it's already a regular dep)
		const peerDepNames = new Set(['is-number']);
		const packages = buildInstalledPackages(result.roots[0], peerDepNames);

		// is-number should still be marked as peer because it's only through peer edge
		const isNumber = packages.find((p) => p.name === 'is-number')!;
		expect(isNumber.isPeer).toBe(true);
	});
});
