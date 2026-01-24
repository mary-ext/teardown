import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_EXCLUDE_PATTERNS, fetchPackagesToVolume } from './fetch';
import { hoist } from './hoist';
import { resolve } from './resolve';

describe('fetchPackagesToVolume', () => {
	it('fetches and extracts a simple package', async () => {
		// resolve a tiny package
		const result = await resolve(['is-odd@3.0.1'], { installPeers: false });
		const hoisted = hoist(result.roots);
		const volume = new Volume();
		await fetchPackagesToVolume(hoisted, volume);

		// should have files from is-odd
		const isOddPackageJson = volume.readFileSync('/node_modules/is-odd/package.json', 'utf8');
		expect(isOddPackageJson).toBeDefined();

		// verify it's valid JSON
		const json = JSON.parse(isOddPackageJson as string);
		expect(json.name).toBe('is-odd');

		// should also have is-number (dependency)
		const isNumberPackageJson = volume.readFileSync('/node_modules/is-number/package.json', 'utf8');
		expect(isNumberPackageJson).toBeDefined();
	});

	it('respects concurrency limit', async () => {
		const result = await resolve(['is-odd@3.0.1'], { installPeers: false });
		const hoisted = hoist(result.roots);
		const volume = new Volume();

		// should work with concurrency of 1
		await fetchPackagesToVolume(hoisted, volume, { concurrency: 1 });
		const files = volume.toJSON();
		expect(Object.keys(files).length).toBeGreaterThan(0);
	});

	it('excludes files matching default patterns', async () => {
		const result = await resolve(['is-odd@3.0.1'], { installPeers: false });
		const hoisted = hoist(result.roots);
		const volume = new Volume();
		await fetchPackagesToVolume(hoisted, volume);

		// should not have README or LICENSE
		const files = volume.toJSON();
		for (const path of Object.keys(files)) {
			const filename = path.split('/').pop()!;
			expect(filename.toUpperCase()).not.toMatch(/^README/);
			expect(filename.toUpperCase()).not.toMatch(/^LICENSE/);
		}
	});

	it('can disable exclusions with empty array', async () => {
		const result = await resolve(['is-odd@3.0.1'], { installPeers: false });
		const hoisted = hoist(result.roots);

		const volumeNoExclude = new Volume();
		await fetchPackagesToVolume(hoisted, volumeNoExclude, { exclude: [] });

		const volumeWithExclude = new Volume();
		await fetchPackagesToVolume(hoisted, volumeWithExclude);

		// should have more files when nothing is excluded
		const noExcludeCount = Object.keys(volumeNoExclude.toJSON()).length;
		const withExcludeCount = Object.keys(volumeWithExclude.toJSON()).length;
		expect(noExcludeCount).toBeGreaterThanOrEqual(withExcludeCount);
	});
});

describe('unpackedSize calculation', () => {
	it('populates unpackedSize from tarball when registry does not provide it', async () => {
		// JSR packages don't have unpackedSize in registry metadata
		const result = await resolve(['jsr:@luca/flag@1.0.1']);
		const hoisted = hoist(result.roots);
		const volume = new Volume();

		// before fetch, unpackedSize should be undefined (JSR doesn't provide it)
		const rootNode = hoisted.root.get('@luca/flag')!;
		expect(rootNode.unpackedSize).toBeUndefined();

		await fetchPackagesToVolume(hoisted, volume);

		// after fetch, unpackedSize should be populated from tarball
		expect(rootNode.unpackedSize).toBeGreaterThan(0);
	});

	it('preserves registry-provided unpackedSize for npm packages', async () => {
		const result = await resolve(['is-odd@3.0.1'], { installPeers: false });
		const hoisted = hoist(result.roots);
		const volume = new Volume();

		// npm registry provides unpackedSize
		const rootNode = hoisted.root.get('is-odd')!;
		const registrySize = rootNode.unpackedSize;
		expect(registrySize).toBeGreaterThan(0);

		await fetchPackagesToVolume(hoisted, volume);

		// should preserve the registry-provided size
		expect(rootNode.unpackedSize).toBe(registrySize);
	});

	it('includes excluded files in size calculation', async () => {
		const result = await resolve(['is-odd@3.0.1'], { installPeers: false });
		const hoisted = hoist(result.roots);

		// clear the registry-provided size to force calculation from tarball
		const rootNode = hoisted.root.get('is-odd')!;
		rootNode.unpackedSize = undefined;

		const volume = new Volume();
		await fetchPackagesToVolume(hoisted, volume);

		// size should include README, LICENSE, etc. even though they're excluded from extraction
		const extractedFiles = volume.toJSON();
		const extractedSize = Object.values(extractedFiles).reduce(
			(sum, content) => sum + (content as string).length,
			0,
		);

		// tarball size should be >= extracted size (includes excluded files)
		expect(rootNode.unpackedSize).toBeGreaterThanOrEqual(extractedSize);
	});
});

describe('DEFAULT_EXCLUDE_PATTERNS', () => {
	it('matches README files', () => {
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('README.md'))).toBe(true);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('README'))).toBe(true);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('readme.txt'))).toBe(true);
	});

	it('matches LICENSE files', () => {
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('LICENSE'))).toBe(true);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('LICENSE.md'))).toBe(true);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('LICENCE'))).toBe(true);
	});

	it('matches test directories', () => {
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('__tests__/foo.js'))).toBe(true);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('test/index.js'))).toBe(true);
	});

	it('matches source maps', () => {
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.js.map'))).toBe(true);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('dist/bundle.js.map'))).toBe(true);
	});

	it('does not match source files', () => {
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.js'))).toBe(false);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('src/utils.ts'))).toBe(false);
		expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('package.json'))).toBe(false);
	});
});
