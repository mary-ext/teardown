import { concat } from '@atcute/uint8array';
import { writeTarEntry } from '@mary/tar';
import { Volume } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXCLUDE_PATTERNS, fetchTarballToVolume, type TarballOptions } from './fetch';

const IS_ODD_TARBALL = 'https://registry.npmjs.org/is-odd/-/is-odd-3.0.1.tgz';

// #region test helpers

const extract = (volume: Volume, url: string, options: Partial<TarballOptions> = {}): Promise<number> => {
	return fetchTarballToVolume(volume, {
		url,
		destPath: '/pkg',
		exclude: [],
		...options,
	});
};

const makeTarball = async (files: Array<[name: string, data: string]>): Promise<Uint8Array<ArrayBuffer>> => {
	const entries = files.map(([filename, data]) => writeTarEntry({ filename, data }));
	const tar = concat([...entries, new Uint8Array(1024)]);
	const gzipped = new Response(tar).body!.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(gzipped).arrayBuffer());
};

/** serves each response in turn, repeating the last */
const serve = (...responses: Array<() => Response>) => {
	const fetch = vi.fn(async () => responses[Math.min(fetch.mock.calls.length - 1, responses.length - 1)]!());
	vi.stubGlobal('fetch', fetch);
	return fetch;
};

// #endregion

// #region fetchTarballToVolume

describe('fetchTarballToVolume', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('extracts the package without its "package/" prefix', async () => {
		const volume = new Volume();
		await extract(volume, IS_ODD_TARBALL);

		expect(volume.existsSync('/pkg/package.json')).toBe(true);
		expect(volume.existsSync('/pkg/index.js')).toBe(true);
	});

	it('strips root folders other than "package/"', async () => {
		const tarball = await makeTarball([
			['node/package.json', '{}'],
			['node/lib/index.js', ''],
		]);
		serve(() => new Response(tarball));

		const volume = new Volume();
		await extract(volume, 'https://example.com/a.tgz');

		expect(Object.keys(volume.toJSON()).toSorted()).toEqual(['/pkg/lib/index.js', '/pkg/package.json']);
	});

	it('skips entries escaping the package', async () => {
		const tarball = await makeTarball([
			['package/index.js', 'ok'],
			['package/../../evil.js', 'nope'],
			['/abs.js', 'nope'],
		]);
		serve(() => new Response(tarball));

		const volume = new Volume();
		const size = await extract(volume, 'https://example.com/a.tgz');

		expect(Object.keys(volume.toJSON())).toEqual(['/pkg/index.js']);
		expect(size).toBe(2);
	});

	it('counts duplicate entries once, keeping the last', async () => {
		const tarball = await makeTarball([
			['package/a.js', 'first'],
			['package/a.js', 'second'],
		]);
		serve(() => new Response(tarball));

		const volume = new Volume();
		expect(await extract(volume, 'https://example.com/a.tgz')).toBe(6);
		expect(volume.readFileSync('/pkg/a.js', 'utf8')).toBe('second');
	});

	it('skips excluded files but counts them towards the size', async () => {
		const all = new Volume();
		const allSize = await extract(all, IS_ODD_TARBALL);

		const filtered = new Volume();
		const filteredSize = await extract(filtered, IS_ODD_TARBALL, { exclude: DEFAULT_EXCLUDE_PATTERNS });

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
			extract(new Volume(), 'https://registry.npmjs.org/is-odd/-/is-odd-0.0.0-missing.tgz'),
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
