import * as semver from 'semver';
import { describe, expect, it } from 'vitest';

import { cleanVersion, compareVersions, formatVersion, parseVersion } from './version';

/** seeded for reproducible inputs */
const createRandom = (seed: number) => {
	return (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
};

describe('parseVersion', () => {
	it('parses versions', () => {
		expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '', build: '' });
		expect(parseVersion(' v1.2.3-beta.1+build.5 ')).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: 'beta.1',
			build: 'build.5',
		});
	});

	it('rejects non-conforming versions outside loose mode', () => {
		for (const input of [
			'01.2.3',
			'1.2.3-01',
			'=1.2.3',
			'v 1.2.3',
			'1.2.3beta',
			'1.2',
			'1.2.3.4',
			'1.2.3-',
			'',
		]) {
			expect(parseVersion(input), input).toBeNull();
		}
	});

	it('accepts non-conforming versions in loose mode', () => {
		const loose = { loose: true };
		expect(parseVersion('=v 01.02.03', loose)).toMatchObject({ major: 1, minor: 2, patch: 3 });
		expect(parseVersion('1.2.3beta', loose)).toMatchObject({ prerelease: 'beta' });
		expect(parseVersion('1.2.3-alpha.007', loose)).toMatchObject({ prerelease: 'alpha.7' });
		expect(parseVersion('1.2.3-', loose)).toMatchObject({ prerelease: '-' });
		expect(parseVersion('1.2', loose)).toBeNull();
	});

	it('rejects parts past MAX_SAFE_INTEGER and inputs past 256 characters', () => {
		expect(parseVersion(Number.MAX_SAFE_INTEGER + '.0.0')).not.toBeNull();
		expect(parseVersion(Number.MAX_SAFE_INTEGER + 1 + '.0.0')).toBeNull();
		expect(parseVersion('1.2.3-' + 'a'.repeat(250))).not.toBeNull();
		expect(parseVersion('1.2.3-' + 'a'.repeat(251))).toBeNull();
	});
});

describe('cleanVersion', () => {
	it('strips prefixes and build metadata', () => {
		expect(cleanVersion('  =v1.2.3+build ')).toBe('1.2.3');
		expect(cleanVersion('v01.2.3')).toBeNull();
		expect(cleanVersion('v01.2.3', { loose: true })).toBe('1.2.3');
	});
});

describe('compareVersions', () => {
	it('orders by precedence', () => {
		const ordered = [
			'1.0.0-0',
			'1.0.0-1',
			'1.0.0-2',
			'1.0.0-10',
			'1.0.0-alpha',
			'1.0.0-alpha.1',
			'1.0.0-alpha.beta',
			'1.0.0-beta',
			'1.0.0-beta.2',
			'1.0.0-beta.11',
			'1.0.0-rc.1',
			'1.0.0',
			'1.0.1',
			'1.1.0',
			'2.0.0',
			'10.0.0',
		];
		for (let i = 0; i < ordered.length - 1; i++) {
			const a = parseVersion(ordered[i]!)!;
			const b = parseVersion(ordered[i + 1]!)!;
			expect(compareVersions(a, b), `${ordered[i]} < ${ordered[i + 1]}`).toBeLessThan(0);
			expect(compareVersions(b, a), `${ordered[i + 1]} > ${ordered[i]}`).toBeGreaterThan(0);
		}
	});

	it('ignores build metadata', () => {
		expect(compareVersions(parseVersion('1.0.0+a')!, parseVersion('1.0.0+b')!)).toBe(0);
	});
});

describe('compatibility with node-semver', () => {
	const random = createRandom(42);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

	const inputs: string[] = [];
	{
		const pieces = [
			'0',
			'1',
			'01',
			'10',
			'9007199254740992',
			'.',
			'.',
			'-',
			'+',
			'v',
			'=',
			' ',
			'a',
			'x',
			'-0',
			'-01',
		];
		const nums = ['0', '1', '2', '10', '01', '007', '9007199254740991', '9007199254740992'];
		const pres = [
			'',
			'-0',
			'-1',
			'-01',
			'-alpha',
			'-alpha.1',
			'-a.b',
			'--',
			'-',
			'beta',
			'-9007199254740992',
			'-a..b',
		];
		const builds = ['', '+b', '+001', '+a.b', '+', '+a..b'];
		const prefixes = ['', 'v', '=', 'v=', '= v', ' ', 'vv'];
		for (let i = 0; i < 5000; i++) {
			let s = '';
			for (let n = 1 + Math.floor(random() * 9); n > 0; n--) {
				s += pick(pieces);
			}
			inputs.push(s);
			inputs.push(
				pick(prefixes) + pick(nums) + '.' + pick(nums) + '.' + pick(nums) + pick(pres) + pick(builds),
			);
		}
	}

	it('parses the same versions', () => {
		for (const loose of [false, true]) {
			for (const input of inputs) {
				const expected = semver.parse(input, { loose });
				const actual = parseVersion(input, { loose });
				expect(actual && formatVersion(actual) + '+' + actual.build, input).toBe(
					expected && expected.version + '+' + expected.build.join('.'),
				);
				expect(cleanVersion(input, { loose }), input).toBe(semver.clean(input, { loose }));
			}
		}
	});

	it('compares the same way', () => {
		const valid = inputs.filter((input) => semver.valid(input, { loose: true }));
		for (let i = 0; i < 20000; i++) {
			const a = pick(valid);
			const b = pick(valid);
			const actual = compareVersions(parseVersion(a, { loose: true })!, parseVersion(b, { loose: true })!);
			expect(Math.sign(actual), `${a} vs ${b}`).toBe(semver.compare(a, b, { loose: true }));
		}
	});
});
