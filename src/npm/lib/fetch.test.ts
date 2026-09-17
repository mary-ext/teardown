import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_EXCLUDE_PATTERNS, fetchTarballToVolume } from './fetch';

const IS_ODD_TARBALL = 'https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz';

// #region fetchTarballToVolume

describe('fetchTarballToVolume', () => {
	it('extracts the package without its "package/" prefix', async () => {
		const volume = new Volume();
		await fetchTarballToVolume(IS_ODD_TARBALL, '/pkg', volume, []);

		expect(volume.existsSync('/pkg/package.json')).toBe(true);
		expect(volume.existsSync('/pkg/index.js')).toBe(true);
	});

	it('skips excluded files but counts them towards the size', async () => {
		const all = new Volume();
		const allSize = await fetchTarballToVolume(IS_ODD_TARBALL, '/pkg', all, []);

		const filtered = new Volume();
		const filteredSize = await fetchTarballToVolume(
			IS_ODD_TARBALL,
			'/pkg',
			filtered,
			DEFAULT_EXCLUDE_PATTERNS,
		);

		expect(all.existsSync('/pkg/README.md')).toBe(true);
		expect(all.existsSync('/pkg/LICENSE')).toBe(true);
		expect(filtered.existsSync('/pkg/README.md')).toBe(false);
		expect(filtered.existsSync('/pkg/LICENSE')).toBe(false);

		expect(filteredSize).toBe(allSize);
		const extracted = Object.values(filtered.toJSON()).reduce(
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			(sum, content) => sum + (content as string).length,
			0,
		);
		expect(filteredSize).toBeGreaterThan(extracted);
	});

	it('rejects when the tarball is missing', async () => {
		await expect(
			fetchTarballToVolume(
				'https://registry.npmjs.org/is-odd/-/is-odd-0.0.0-missing.tgz',
				'/pkg',
				new Volume(),
				[],
			),
		).rejects.toThrow();
	});
});

// #endregion

// #region DEFAULT_EXCLUDE_PATTERNS

describe('DEFAULT_EXCLUDE_PATTERNS', () => {
	describe('documentation files', () => {
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

		it('matches CHANGELOG and HISTORY files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('CHANGELOG.md'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('HISTORY.md'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('changelog.txt'))).toBe(true);
		});

		it('matches example directories', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('examples/basic.js'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('example/demo.ts'))).toBe(true);
		});
	});

	describe('test files', () => {
		it('matches test directories', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('__tests__/foo.js'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('test/index.js'))).toBe(true);
		});

		it('matches test file patterns', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('foo.test.js'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('bar.spec.ts'))).toBe(true);
		});
	});

	describe('config files', () => {
		it('matches TypeScript config files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('tsconfig.json'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('tsconfig.build.json'))).toBe(true);
		});

		it('matches linter configs', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('.eslintrc'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('.eslintrc.json'))).toBe(true);
		});

		it('matches test runner configs', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('jest.config.js'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('vitest.config.ts'))).toBe(true);
		});

		it('matches dot directories', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('.github/workflows/ci.yml'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('.vscode/settings.json'))).toBe(true);
		});
	});

	describe('type definition files', () => {
		it('matches TypeScript declaration files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.d.ts'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('types.d.mts'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('lib/foo.d.cts'))).toBe(true);
		});

		it('matches Flow type files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.js.flow'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('types.flow'))).toBe(true);
		});

		it('does not match TypeScript source files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.ts'))).toBe(false);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.mts'))).toBe(false);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.cts'))).toBe(false);
		});
	});

	describe('source maps', () => {
		it('matches source map files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.js.map'))).toBe(true);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('dist/bundle.js.map'))).toBe(true);
		});
	});

	describe('source files (should NOT match)', () => {
		it('does not match JavaScript/TypeScript source files', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('index.js'))).toBe(false);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('src/utils.ts'))).toBe(false);
		});

		it('does not match package.json', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('package.json'))).toBe(false);
		});

		it('does not match dist/lib directories', () => {
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('dist/index.js'))).toBe(false);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('lib/index.js'))).toBe(false);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('cjs/index.js'))).toBe(false);
			expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test('esm/index.js'))).toBe(false);
		});
	});
});

// #endregion
