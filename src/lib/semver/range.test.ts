import * as semver from 'semver';
import { describe, expect, it } from 'vitest';

import { maxSatisfying, parseRange, satisfies } from './range';
import type { RangeOptions } from './range';

/** seeded for reproducible inputs */
const createRandom = (seed: number) => {
	return (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
};

const test = (range: string, version: string, options?: RangeOptions): boolean => {
	const parsed = parseRange(range, options);
	return parsed !== null && satisfies(version, parsed);
};

describe('satisfies', () => {
	it.each([
		['^1.2.3', '1.9.0', true],
		['^1.2.3', '2.0.0', false],
		['^0.2.3', '0.3.0', false],
		['^0.0.3', '0.0.4', false],
		['~1.2.3', '1.2.9', true],
		['~1.2.3', '1.3.0', false],
		['~> 1.2', '1.2.9', true],
		['1.x', '1.9.9', true],
		['1.2.x', '1.3.0', false],
		['>1.2', '1.3.0', true],
		['<=1.2', '1.2.9', true],
		['>= 1.2.3 < 2', '1.5.0', true],
		['1.2.3 - 2.3', '2.3.9', true],
		['1.2.3 - 2.3.4', '2.3.5', false],
		['^1.2.3+build', '1.3.0', true],
		['1.0.0 || >=2.0.0 <2.1.0', '2.0.5', true],
		['', '1.0.0', true],
		['>2 <1', '1.5.0', false],
	])('%s includes %s: %s', (range, version, expected) => {
		expect(test(range, version)).toBe(expected);
	});

	it('only lets prereleases through sets that opt into their version', () => {
		expect(test('^1.2.3-beta.1', '1.2.3-beta.2')).toBe(true);
		expect(test('^1.2.3-beta.1', '1.2.4-beta.1')).toBe(false);
		expect(test('^1.2.3-beta.1', '1.2.4-beta.1', { includePrerelease: true })).toBe(true);
		expect(test('*', '1.0.0-beta')).toBe(false);
		expect(test('*', '1.0.0-beta', { includePrerelease: true })).toBe(true);
	});

	it('collapses to a lone `*` set like node-semver', () => {
		// the `*` set wins even though the other set allows the prerelease
		expect(test('* || 1.2.3-beta', '1.2.3-beta')).toBe(false);
		// `>=0.0.0` is dropped as a synonym of `*`
		expect(test('>=0.0.0 <0.0.0-beta', '0.0.0-alpha')).toBe(true);
	});

	it('rejects invalid comparators unless loose', () => {
		expect(parseRange('^1.2.3 foo')).toBeNull();
		expect(test('^1.2.3 foo', '1.5.0', { loose: true })).toBe(true);
		expect(parseRange('foo', { loose: true })).toBeNull();
		expect(test('foo || 1.2.3', '1.2.3', { loose: true })).toBe(true);
	});

	it('rejects ranges producing versions past MAX_SAFE_INTEGER', () => {
		expect(parseRange('^' + Number.MAX_SAFE_INTEGER + '.0.0', { loose: true })).toBeNull();
		expect(parseRange('~' + Number.MAX_SAFE_INTEGER + '.0.0', { loose: true })).not.toBeNull();
	});
});

describe('maxSatisfying', () => {
	it('picks the highest satisfying version', () => {
		const range = parseRange('^1.0.0')!;
		expect(maxSatisfying(['1.0.0', '1.5.0', '2.0.0', '1.2.0'], range)).toBe('1.5.0');
		expect(maxSatisfying(['0.1.0', '2.0.0'], range)).toBeNull();
	});

	it('picks the first of equally high versions', () => {
		const range = parseRange('1.x', { loose: true })!;
		expect(maxSatisfying(['1.0.0+a', 'v1.0.0', '1.0.0+b'], range)).toBe('1.0.0+a');
	});
});

describe('compatibility with node-semver', () => {
	const random = createRandom(7);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

	const combos = [
		{ includePrerelease: false, loose: false },
		{ includePrerelease: false, loose: true },
		{ includePrerelease: true, loose: false },
		{ includePrerelease: true, loose: true },
	];

	const ranges: string[] = [];
	{
		const ops = [
			'',
			'',
			'',
			'=',
			'>',
			'>=',
			'<',
			'<=',
			'^',
			'^',
			'~',
			'~',
			'~>',
			'v',
			'>= ',
			'~ ',
			'^ ',
			'=v',
			'>==',
		];
		const parts = ['0', '1', '2', '10', '01', 'x', 'X', '*', '9007199254740991'];
		const pres = ['', '', '', '-0', '-beta', '-01', 'beta', '-alpha.1', '-', '+build'];
		const joins = [' ', ' ', ' ', '  ', ' || ', '||', ' - ', '\t'];
		const junk = ['foo', '-', '1.2.3.4', '>', '*1.2.3', '1.x.2', 'x.1'];
		const version = () => {
			const count = 1 + Math.floor(random() * 3);
			let s = pick(parts);
			for (let k = 1; k < count; k++) {
				s += '.' + pick(parts);
			}
			return count === 3 ? s + pick(pres) : s;
		};
		const comparator = () => (random() < 0.05 ? pick(junk) : pick(ops) + version());
		for (let i = 0; i < 20000; i++) {
			let s = comparator();
			for (let n = Math.floor(random() * 4); n > 0; n--) {
				s += pick(joins) + comparator();
			}
			ranges.push(s);
		}
	}

	const versions: string[] = [];
	for (const major of [0, 1, 2, 10]) {
		for (const minor of [0, 1, 2]) {
			for (const patch of [0, 1, 2]) {
				for (const pre of ['', '-0', '-alpha', '-beta', '-beta.1']) {
					versions.push(major + '.' + minor + '.' + patch + pre);
				}
			}
		}
	}

	// collect failures to avoid millions of assertion calls
	it('accepts the same ranges and matches the same versions', () => {
		const mismatches: string[] = [];
		for (const range of ranges) {
			const options = pick(combos);
			let expected: semver.Range | null = null;
			try {
				expected = new semver.Range(range, options);
			} catch {}

			const parsed = parseRange(range, options);
			if ((parsed === null) !== (expected === null)) {
				mismatches.push(JSON.stringify(range) + ' validity ' + JSON.stringify(options));
				continue;
			}
			if (parsed === null) {
				continue;
			}
			for (const version of versions) {
				if (satisfies(version, parsed) !== expected!.test(version)) {
					mismatches.push(JSON.stringify(range) + ' ' + version + ' ' + JSON.stringify(options));
				}
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('finds the same highest version', () => {
		const mismatches: string[] = [];
		const shuffled = versions.toSorted(() => random() - 0.5);
		for (const range of ranges.slice(0, 5000)) {
			const options = pick(combos);
			const parsed = parseRange(range, options);
			if ((parsed && maxSatisfying(shuffled, parsed)) !== semver.maxSatisfying(shuffled, range, options)) {
				mismatches.push(JSON.stringify(range) + ' ' + JSON.stringify(options));
			}
		}
		expect(mismatches).toEqual([]);
	});
});
