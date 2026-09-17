import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';

import { install, type InstallCounts } from './install';

const readJson = (volume: Volume, path: string) => {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return JSON.parse(volume.readFileSync(path, 'utf8') as string);
};

describe('install', () => {
	it('links roots at the top and dependencies next to their dependents', async () => {
		const volume = new Volume();
		await install(['is-odd@3.0.1'], volume);

		expect(readJson(volume, '/node_modules/is-odd/package.json').name).toBe('is-odd');
		expect(
			readJson(volume, '/node_modules/.pnpm/is-odd@3.0.1/node_modules/is-number/package.json').name,
		).toBe('is-number');
		expect(volume.existsSync('/node_modules/is-number')).toBe(false);
	});

	it('respects the concurrency limit', async () => {
		const volume = new Volume();
		await install(['is-odd@3.0.1'], volume, { fetch: { concurrency: 1 } });

		expect(volume.existsSync('/node_modules/is-odd/package.json')).toBe(true);
	});

	it('reports unique packages as they resolve, download and link', async () => {
		const volume = new Volume();
		const reports: InstallCounts[] = [];
		const { layout } = await install(['is-odd@3.0.1'], volume, {
			onProgress(counts) {
				reports.push(counts);
			},
		});

		expect(reports.at(-1)).toEqual({ resolved: 2, downloaded: 2, added: layout.entries.size });
		// each report advances exactly one counter
		expect(reports.map((c) => c.resolved + c.downloaded + c.added)).toEqual(reports.map((_, idx) => idx + 1));
	});

	it('places scoped packages', async () => {
		const volume = new Volume();
		await install(['@babel/parser@7.23.0'], volume);

		expect(readJson(volume, '/node_modules/@babel/parser/package.json').name).toBe('@babel/parser');
		expect(volume.existsSync('/node_modules/.pnpm/@babel+parser@7.23.0/node_modules/@babel/parser')).toBe(
			true,
		);
	});

	it('links each dependent to the version it asked for', async () => {
		// is-odd depends on is-number@6.x, but we also request is-number@7.x
		const volume = new Volume();
		await install(['is-odd@3.0.1', 'is-number@7.0.0'], volume);

		expect(readJson(volume, '/node_modules/is-number/package.json').version).toBe('7.0.0');
		expect(
			readJson(volume, '/node_modules/.pnpm/is-odd@3.0.1/node_modules/is-number/package.json').version,
		).toMatch(/^6\./);
	});

	it('skips auto-installed peers that a dependent provides', async () => {
		// root react 17 replaces the auto-installed react 18 fallback
		const volume = new Volume();
		const { resolution, layout } = await install(['react@17.0.2', 'use-sync-external-store@1.2.0'], volume);

		const fallback = [...resolution.packages.values()].find(
			(pkg) => pkg.name === 'react' && pkg.version !== '17.0.2',
		);
		expect(fallback).toBeDefined();

		const stored = volume.readdirSync('/node_modules/.pnpm').map(String);
		expect(stored).not.toContain(`react@${fallback!.version}`);
		expect(stored).toContain('use-sync-external-store@1.2.0(react@17.0.2)');
		expect([...layout.entries.keys()].filter((id) => id.startsWith('react@'))).toEqual(['react@17.0.2']);
	});
});
