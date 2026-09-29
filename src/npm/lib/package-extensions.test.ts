import { describe, expect, it } from 'vitest';

import { parseRange } from '../../lib/semver/range';

import { applyPackageExtensions, type PackageExtension } from './package-extensions';
import { packageExtensions } from './package-extensions-data';
import type { AbbreviatedManifest } from './types';

const manifest = (version: string, fields: Partial<AbbreviatedManifest> = {}): AbbreviatedManifest => {
	return { name: 'lib', version, dist: { tarball: `https://example.com/lib-${version}.tgz` }, ...fields };
};

const extensions: Record<string, PackageExtension[]> = {
	lib: [
		{
			range: '<2',
			dependencies: { 'old-helper': '^1.0.0' },
		},
		{
			range: '*',
			peerDependencies: { react: '*', vue: '*' },
			optionalPeers: ['react', 'vue'],
		},
	],
};

describe('applyPackageExtensions', () => {
	it('adds dependencies from every matching rule', () => {
		const result = applyPackageExtensions(manifest('1.0.0'), extensions);

		expect(result.dependencies).toEqual({ 'old-helper': '^1.0.0' });
		expect(result.peerDependencies).toEqual({ react: '*', vue: '*' });
		expect(result.peerDependenciesMeta).toEqual({ react: { optional: true }, vue: { optional: true } });
	});

	it('skips rules whose range does not match', () => {
		const result = applyPackageExtensions(manifest('2.0.0'), extensions);

		expect(result.dependencies).toBeUndefined();
		expect(result.peerDependencies).toEqual({ react: '*', vue: '*' });
	});

	it('matches prerelease versions', () => {
		const result = applyPackageExtensions(manifest('1.5.0-beta.1'), extensions);

		expect(result.dependencies).toEqual({ 'old-helper': '^1.0.0' });
	});

	it('leaves declared peers required', () => {
		const result = applyPackageExtensions(
			manifest('2.0.0', { peerDependencies: { react: '^18.0.0' } }),
			extensions,
		);

		expect(result.peerDependenciesMeta).toEqual({ vue: { optional: true } });
	});

	it('ignores names inherited from Object.prototype', () => {
		const input = manifest('1.0.0', { name: 'constructor' });

		expect(applyPackageExtensions(input, extensions)).toBe(input);
		expect(applyPackageExtensions(input, packageExtensions)).toBe(input);
	});

	it('keeps what the manifest declares', () => {
		const input = manifest('2.0.0', {
			peerDependencies: { react: '^18.0.0' },
			peerDependenciesMeta: { react: { optional: false } },
		});
		const result = applyPackageExtensions(input, extensions);

		expect(result.peerDependencies).toEqual({ react: '^18.0.0', vue: '*' });
		expect(result.peerDependenciesMeta).toEqual({ react: { optional: false }, vue: { optional: true } });

		expect(input.peerDependencies).toEqual({ react: '^18.0.0' });
	});

	it('returns packages without rules as-is', () => {
		const input = manifest('1.0.0', { name: 'other' });

		expect(applyPackageExtensions(input, extensions)).toBe(input);
	});
});

describe('bundled package extensions', () => {
	it('has no type-only targets', () => {
		for (const rules of Object.values(packageExtensions)) {
			for (const rule of rules) {
				for (const name of Object.keys({ ...rule.dependencies, ...rule.peerDependencies })) {
					expect(name).not.toMatch(/^@types\//);
				}
			}
		}
	});

	it('has valid ranges', () => {
		for (const rules of Object.values(packageExtensions)) {
			for (const rule of rules) {
				expect(parseRange(rule.range), rule.range).not.toBeNull();
			}
		}
	});
});
