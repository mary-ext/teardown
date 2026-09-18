import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';

import { isolate } from './isolate';
import { resolve } from './resolve';
import { createPackageStore } from './store';
import type { ResolvedPackage } from './types';

const readJson = (volume: Volume, path: string) => {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return JSON.parse(volume.readFileSync(path, 'utf8') as string);
};

const resolveRoot = async (spec: string): Promise<ResolvedPackage> => {
	return (await resolve([spec], { installPeers: false })).roots[0]!;
};

describe('createPackageStore', () => {
	it('fetches packages that are added more than once only once', async () => {
		const root = await resolveRoot('is-odd@3.0.1');
		const volume = new Volume();
		const store = createPackageStore(volume);

		store.add(root);
		store.add(root);
		await store.link(isolate([root]));

		expect(volume.readdirSync('/node_modules/.pnpm/is-odd@3.0.1/node_modules').toSorted()).toEqual([
			'is-number',
			'is-odd',
		]);
	});

	it('fetches packages the layout needs but were never added', async () => {
		const root = await resolveRoot('is-odd@3.0.1');
		const volume = new Volume();
		await createPackageStore(volume).link(isolate([root]));

		expect(volume.existsSync('/node_modules/is-odd/package.json')).toBe(true);
		expect(volume.existsSync('/node_modules/.pnpm/node_modules/is-number/package.json')).toBe(true);
	});

	it('gives peer-specialised entries their own copy of the files', async () => {
		const isOdd = await resolveRoot('is-odd@3.0.1');
		const lib: ResolvedPackage = {
			name: 'is-number',
			version: '7.0.0',
			tarball: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz',
			dependencies: new Map(),
			peers: new Map([['is-odd', '*']]),
		};
		const app: ResolvedPackage = {
			name: 'is-even',
			version: '1.0.0',
			tarball: 'https://registry.npmjs.org/is-even/-/is-even-1.0.0.tgz',
			dependencies: new Map([
				['is-odd', isOdd],
				['is-number', lib],
			]),
			peers: new Map(),
		};

		const volume = new Volume();
		await createPackageStore(volume).link(isolate([app]));

		// symlinking package files would resolve peers from the wrong entry
		const entry = '/node_modules/.pnpm/is-number@7.0.0(is-odd@3.0.1)/node_modules';
		expect(readJson(volume, `${entry}/is-number/package.json`).version).toBe('7.0.0');
		expect(volume.realpathSync(`${entry}/is-number/package.json`)).toBe(`${entry}/is-number/package.json`);
		expect(readJson(volume, `${entry}/is-odd/package.json`).name).toBe('is-odd');
	});

	describe('unpackedSize', () => {
		it('fills it in from the tarball when the registry does not report it', async () => {
			// JSR packages don't have unpackedSize in registry metadata
			const root = await resolveRoot('jsr:@luca/flag@1.0.1');
			expect(root.unpackedSize).toBeUndefined();

			await createPackageStore(new Volume()).link(isolate([root]));

			expect(root.unpackedSize).toBeGreaterThan(0);
		});

		it('keeps the size the registry reports', async () => {
			const root = await resolveRoot('is-odd@3.0.1');
			const registrySize = root.unpackedSize;
			expect(registrySize).toBeGreaterThan(0);

			await createPackageStore(new Volume()).link(isolate([root]));

			expect(root.unpackedSize).toBe(registrySize);
		});
	});

	describe('failures', () => {
		it('rejects non-positive concurrency', () => {
			expect(() => createPackageStore(new Volume(), { concurrency: 0 })).toThrow(RangeError);
			expect(() => createPackageStore(new Volume(), { concurrency: 1.5 })).toThrow(RangeError);
		});

		it('rejects when a package fails to fetch', async () => {
			const missing: ResolvedPackage = {
				name: 'is-odd',
				version: '0.0.0-missing',
				tarball: 'https://registry.npmjs.org/is-odd/-/is-odd-0.0.0-missing.tgz',
				dependencies: new Map(),
				peers: new Map(),
			};

			await expect(createPackageStore(new Volume()).link(isolate([missing]))).rejects.toThrow();
		});
	});
});
