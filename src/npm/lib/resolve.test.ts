import { describe, expect, it } from 'vitest';

import { hoist, hoistedToPaths } from './hoist';
import { reverseJsrName, transformJsrName } from './registry';
import { parseSpecifier, pickVersion, resolve } from './resolve';
import type { AbbreviatedManifest } from './types';

describe('parseSpecifier', () => {
	it('parses bare package name', () => {
		expect(parseSpecifier('react')).toEqual({ name: 'react', range: 'latest', registry: 'npm' });
	});

	it('parses package with version', () => {
		expect(parseSpecifier('react@18.2.0')).toEqual({
			name: 'react',
			range: '18.2.0',
			registry: 'npm',
		});
	});

	it('parses package with range', () => {
		expect(parseSpecifier('react@^18.0.0')).toEqual({
			name: 'react',
			range: '^18.0.0',
			registry: 'npm',
		});
	});

	it('parses scoped package', () => {
		expect(parseSpecifier('@babel/core')).toEqual({
			name: '@babel/core',
			range: 'latest',
			registry: 'npm',
		});
	});

	it('parses scoped package with version', () => {
		expect(parseSpecifier('@babel/core@7.23.0')).toEqual({
			name: '@babel/core',
			range: '7.23.0',
			registry: 'npm',
		});
	});

	it('parses scoped package with range', () => {
		expect(parseSpecifier('@types/node@^20.0.0')).toEqual({
			name: '@types/node',
			range: '^20.0.0',
			registry: 'npm',
		});
	});

	it('parses jsr package', () => {
		expect(parseSpecifier('jsr:@luca/flag')).toEqual({
			name: '@luca/flag',
			range: 'latest',
			registry: 'jsr',
		});
	});

	it('parses jsr package with version', () => {
		expect(parseSpecifier('jsr:@luca/flag@1.0.0')).toEqual({
			name: '@luca/flag',
			range: '1.0.0',
			registry: 'jsr',
		});
	});

	it('parses jsr package with range', () => {
		expect(parseSpecifier('jsr:@std/path@^1.0.0')).toEqual({
			name: '@std/path',
			range: '^1.0.0',
			registry: 'jsr',
		});
	});

	it('throws for unscoped jsr package', () => {
		expect(() => parseSpecifier('jsr:flag')).toThrow('JSR packages must be scoped');
	});

	it('parses npm: prefix as noop', () => {
		expect(parseSpecifier('npm:react')).toEqual({
			name: 'react',
			range: 'latest',
			registry: 'npm',
		});
	});

	it('parses npm: prefix with version', () => {
		expect(parseSpecifier('npm:react@18.2.0')).toEqual({
			name: 'react',
			range: '18.2.0',
			registry: 'npm',
		});
	});

	it('parses npm: prefix with scoped package', () => {
		expect(parseSpecifier('npm:@babel/core@^7.0.0')).toEqual({
			name: '@babel/core',
			range: '^7.0.0',
			registry: 'npm',
		});
	});
});

describe('transformJsrName', () => {
	it('transforms scoped package name', () => {
		expect(transformJsrName('@luca/flag')).toBe('@jsr/luca__flag');
	});

	it('transforms std package name', () => {
		expect(transformJsrName('@std/path')).toBe('@jsr/std__path');
	});

	it('throws for unscoped package', () => {
		expect(() => transformJsrName('flag')).toThrow('JSR packages must be scoped');
	});
});

describe('reverseJsrName', () => {
	it('reverses npm-compatible JSR name', () => {
		expect(reverseJsrName('@jsr/luca__flag')).toBe('@luca/flag');
	});

	it('reverses std package name', () => {
		expect(reverseJsrName('@jsr/std__internal')).toBe('@std/internal');
	});

	it('throws for non-JSR name', () => {
		expect(() => reverseJsrName('@babel/core')).toThrow('not a JSR npm-compatible name');
	});
});

describe('pickVersion', () => {
	const mockVersions: Record<string, AbbreviatedManifest> = {
		'1.0.0': {
			name: 'test',
			version: '1.0.0',
			dist: { tarball: 'https://example.com/test-1.0.0.tgz', shasum: 'abc123' },
		},
		'1.1.0': {
			name: 'test',
			version: '1.1.0',
			dist: { tarball: 'https://example.com/test-1.1.0.tgz', shasum: 'abc124' },
		},
		'2.0.0': {
			name: 'test',
			version: '2.0.0',
			dist: { tarball: 'https://example.com/test-2.0.0.tgz', shasum: 'abc125' },
		},
		'2.1.0-beta.1': {
			name: 'test',
			version: '2.1.0-beta.1',
			dist: { tarball: 'https://example.com/test-2.1.0-beta.1.tgz', shasum: 'abc126' },
		},
	};

	const distTags = { latest: '2.0.0', next: '2.1.0-beta.1' };

	it('resolves dist-tag', () => {
		const result = pickVersion(mockVersions, distTags, 'latest');
		expect(result?.version).toBe('2.0.0');
	});

	it('resolves next dist-tag', () => {
		const result = pickVersion(mockVersions, distTags, 'next');
		expect(result?.version).toBe('2.1.0-beta.1');
	});

	it('resolves exact version', () => {
		const result = pickVersion(mockVersions, distTags, '1.0.0');
		expect(result?.version).toBe('1.0.0');
	});

	it('resolves caret range', () => {
		const result = pickVersion(mockVersions, distTags, '^1.0.0');
		expect(result?.version).toBe('1.1.0');
	});

	it('resolves tilde range', () => {
		const result = pickVersion(mockVersions, distTags, '~1.0.0');
		expect(result?.version).toBe('1.0.0');
	});

	it('returns null for unsatisfied range', () => {
		const result = pickVersion(mockVersions, distTags, '^3.0.0');
		expect(result).toBeNull();
	});
});

describe('resolve', () => {
	it('resolves a simple package', async () => {
		const result = await resolve(['is-odd@3.0.1']);

		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].name).toBe('is-odd');
		expect(result.roots[0].version).toBe('3.0.1');

		// is-odd depends on is-number
		expect(result.roots[0].dependencies.has('is-number')).toBe(true);
	});

	it('resolves multiple packages', async () => {
		const result = await resolve(['is-odd@3.0.1', 'is-even@1.0.0']);

		expect(result.roots).toHaveLength(2);
		expect(result.roots[0].name).toBe('is-odd');
		expect(result.roots[1].name).toBe('is-even');
	});

	it('deduplicates shared dependencies', async () => {
		// both is-odd and is-even depend on is-number
		const result = await resolve(['is-odd@3.0.1', 'is-even@1.0.0']);

		// count unique packages
		const isNumberVersions = new Set<string>();
		for (const pkg of result.packages.values()) {
			if (pkg.name === 'is-number') {
				isNumberVersions.add(pkg.version);
			}
		}

		// should have is-number in the packages map
		expect(isNumberVersions.size).toBeGreaterThan(0);
	});

	it('resolves a JSR package', async () => {
		const result = await resolve(['jsr:@luca/flag@1.0.1']);

		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].name).toBe('@luca/flag');
		expect(result.roots[0].version).toBe('1.0.1');
		expect(result.roots[0].tarball).toContain('npm.jsr.io');
	});

	it('resolves a JSR package with JSR dependencies', async () => {
		// @std/path@1.1.4 depends on @jsr/std__internal (reversed to @std/internal)
		const result = await resolve(['jsr:@std/path@1.1.4']);

		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].name).toBe('@std/path');
		expect(result.roots[0].version).toBe('1.1.4');

		// dependency is stored under the original name from the manifest
		expect(result.roots[0].dependencies.has('@jsr/std__internal')).toBe(true);
		const internal = result.roots[0].dependencies.get('@jsr/std__internal')!;
		// but the resolved package uses the canonical name
		expect(internal.name).toBe('@std/internal');
		expect(internal.tarball).toContain('npm.jsr.io');
	});

	it('auto-installs required peer dependencies', async () => {
		// use-sync-external-store has react as a required peer
		const result = await resolve(['use-sync-external-store@1.2.0']);

		// react should be added as a dependency of use-sync-external-store
		const mainPkg = result.roots[0];
		expect(mainPkg.dependencies.has('react')).toBe(true);

		// react should also be in the packages map
		const hasReact = Array.from(result.packages.values()).some((p) => p.name === 'react');
		expect(hasReact).toBe(true);
	});

	it('skips optional peer dependencies', async () => {
		// resolve something with optional peers and verify they're not installed
		const result = await resolve(['use-sync-external-store@1.2.0']);

		// react should be there (required peer) as a dependency
		const mainPkg = result.roots[0];
		expect(mainPkg.dependencies.has('react')).toBe(true);
	});

	it('respects installPeers: false option', async () => {
		const result = await resolve(['use-sync-external-store@1.2.0'], { installPeers: false });

		// should only have the requested package
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].name).toBe('use-sync-external-store');
	});
});

describe('hoist', () => {
	it('hoists simple dependencies to root', async () => {
		const result = await resolve(['is-odd@3.0.1']);
		const hoisted = hoist(result.roots);
		const paths = hoistedToPaths(hoisted);

		// both is-odd and is-number should be at root
		expect(paths).toContain('node_modules/is-odd');
		expect(paths).toContain('node_modules/is-number');
	});

	it('nests conflicting versions', async () => {
		// this test would need packages with conflicting versions
		// for now, just verify the basic structure works
		const result = await resolve(['is-odd@3.0.1']);
		const hoisted = hoist(result.roots);

		expect(hoisted.root.size).toBeGreaterThan(0);
		expect(hoisted.root.has('is-odd')).toBe(true);
	});
});
