import { describe, expect, it } from 'vitest';

import { attributeExports, type AttributionInput, type ModuleCost } from './attribution';
import type { ExportOrigin } from './export-origin';

// #region helpers

function moduleCosts(entries: Record<string, [bytes: number, async?: boolean]>): Map<string, ModuleCost> {
	return new Map(Object.entries(entries).map(([id, [bytes, async = false]]) => [id, { async, bytes }]));
}

function graph(edges: Record<string, string[]>): Map<string, string[]> {
	return new Map(Object.entries(edges));
}

function origins(entries: Record<string, ExportOrigin>): Map<string, ExportOrigin> {
	return new Map(Object.entries(entries));
}

function weight(attribution: ReturnType<typeof attributeExports>, name: string) {
	return attribution.exports.find((e) => e.name === name);
}

// #endregion

describe('attributeExports', () => {
	it('attributes disjoint private modules to each export', () => {
		const input: AttributionInput = {
			graph: graph({ '/a.js': [], '/b.js': [] }),
			moduleCosts: moduleCosts({ '/a.js': [100], '/b.js': [50] }),
			origins: origins({ a: { id: '/a.js', kind: 'module' }, b: { id: '/b.js', kind: 'module' } }),
			totalBytes: 150,
		};
		const result = attributeExports(input);
		expect(weight(result, 'a')).toEqual({ asyncBytes: 0, confidence: 'high', initialBytes: 100, name: 'a' });
		expect(weight(result, 'b')).toEqual({ asyncBytes: 0, confidence: 'high', initialBytes: 50, name: 'b' });
		expect(result.shared).toBe(0);
		expect(result.unattributed).toBe(0);
		expect(result.overhead).toBe(0);
	});

	it('pools a module reached by two exports into shared', () => {
		const input: AttributionInput = {
			graph: graph({ '/a.js': ['/shared.js'], '/b.js': ['/shared.js'], '/shared.js': [] }),
			moduleCosts: moduleCosts({ '/a.js': [50], '/b.js': [50], '/shared.js': [100] }),
			origins: origins({ a: { id: '/a.js', kind: 'module' }, b: { id: '/b.js', kind: 'module' } }),
			totalBytes: 200,
		};
		const result = attributeExports(input);
		expect(weight(result, 'a')?.initialBytes).toBe(50);
		expect(weight(result, 'b')?.initialBytes).toBe(50);
		expect(result.shared).toBe(100);
		expect(result.unattributed).toBe(0);
	});

	it('counts modules reached by no export as unattributed', () => {
		const input: AttributionInput = {
			graph: graph({ '/a.js': [] }),
			moduleCosts: moduleCosts({ '/a.js': [50], '/orphan.js': [30] }),
			origins: origins({ a: { id: '/a.js', kind: 'module' } }),
			totalBytes: 80,
		};
		const result = attributeExports(input);
		expect(weight(result, 'a')?.initialBytes).toBe(50);
		expect(result.unattributed).toBe(30);
	});

	it('reports the gap between measured total and module costs as overhead', () => {
		const input: AttributionInput = {
			graph: graph({ '/a.js': [] }),
			moduleCosts: moduleCosts({ '/a.js': [50] }),
			origins: origins({ a: { id: '/a.js', kind: 'module' } }),
			totalBytes: 70,
		};
		expect(attributeExports(input).overhead).toBe(20);
	});

	it('splits an export private bytes into initial and async', () => {
		const input: AttributionInput = {
			graph: graph({ '/a.js': ['/lazy.js'], '/lazy.js': [] }),
			moduleCosts: moduleCosts({ '/a.js': [40], '/lazy.js': [60, true] }),
			origins: origins({ a: { id: '/a.js', kind: 'module' } }),
			totalBytes: 100,
		};
		expect(weight(attributeExports(input), 'a')).toEqual({
			asyncBytes: 60,
			confidence: 'high',
			initialBytes: 40,
			name: 'a',
		});
	});

	it('leaves an unknown-origin export at zero and pools its modules as unattributed', () => {
		const input: AttributionInput = {
			graph: graph({ '/m.js': [] }),
			moduleCosts: moduleCosts({ '/m.js': [50] }),
			origins: origins({ a: { kind: 'unknown' } }),
			totalBytes: 50,
		};
		const result = attributeExports(input);
		expect(weight(result, 'a')).toEqual({ asyncBytes: 0, confidence: 'unknown', initialBytes: 0, name: 'a' });
		expect(result.unattributed).toBe(50);
	});

	it('seeds an ambiguous export from the union of candidate modules', () => {
		const input: AttributionInput = {
			graph: graph({ '/x.js': [], '/y.js': [] }),
			moduleCosts: moduleCosts({ '/x.js': [30], '/y.js': [20] }),
			origins: origins({ a: { ids: ['/x.js', '/y.js'], kind: 'ambiguous' } }),
			totalBytes: 50,
		};
		expect(weight(attributeExports(input), 'a')).toEqual({
			asyncBytes: 0,
			confidence: 'ambiguous',
			initialBytes: 50,
			name: 'a',
		});
	});

	it('keeps every byte accounted for (sums to total)', () => {
		const input: AttributionInput = {
			graph: graph({
				'/a.js': ['/shared.js', '/lazy.js'],
				'/b.js': ['/shared.js'],
				'/lazy.js': [],
				'/shared.js': [],
			}),
			moduleCosts: moduleCosts({
				'/a.js': [40],
				'/b.js': [35],
				'/lazy.js': [60, true],
				'/orphan.js': [10],
				'/shared.js': [100],
			}),
			origins: origins({ a: { id: '/a.js', kind: 'module' }, b: { id: '/b.js', kind: 'module' } }),
			totalBytes: 300,
		};
		const result = attributeExports(input);
		const exportTotal = result.exports.reduce((sum, e) => sum + e.initialBytes + e.asyncBytes, 0);
		expect(exportTotal + result.shared + result.unattributed + result.overhead).toBe(result.total);
		// a privately owns its entry module + the lazy chunk; shared.js is pooled
		expect(weight(result, 'a')).toEqual({ asyncBytes: 60, confidence: 'high', initialBytes: 40, name: 'a' });
		expect(weight(result, 'b')?.initialBytes).toBe(35);
		expect(result.shared).toBe(100);
		expect(result.unattributed).toBe(10);
		expect(result.overhead).toBe(55);
	});
});
