import {
	compareMain,
	compareVersions,
	findPrereleaseStart,
	isDigit,
	isSpace,
	mainScan,
	MAX_LENGTH,
	parseDigits,
	parsePrerelease,
	parseVersion,
	scanDigits,
	scanMain,
} from './version';
import type { Version } from './version';

// #region types

/**
 * options for parsing ranges.
 */
export interface RangeOptions {
	/**
	 * allow prereleases without a comparator mentioning their `major.minor.patch`
	 * @default false
	 */
	includePrerelease?: boolean;
	/**
	 * accept non-conforming versions and skip unparseable comparators instead of rejecting the range
	 * @default false
	 */
	loose?: boolean;
}

/**
 * intersection of space-separated comparators.
 */
export interface ComparatorSet {
	/** lower bound, null when unbounded */
	lower: Version | null;
	lowerInclusive: boolean;
	/** upper bound, null when unbounded */
	upper: Version | null;
	upperInclusive: boolean;
}

/**
 * a parsed version range.
 */
export interface Range {
	includePrerelease: boolean;
	loose: boolean;
	/** `||`-separated alternatives; empty when the range matches nothing */
	sets: ComparatorSet[];
}

// #endregion

// #region constants

const CHAR_SPACE = 32;
const CHAR_STAR = 42;
const CHAR_PLUS = 43;
const CHAR_HYPHEN = 45;
const CHAR_DOT = 46;
const CHAR_ZERO = 48;
const CHAR_LESS = 60;
const CHAR_EQUALS = 61;
const CHAR_GREATER = 62;
const CHAR_UPPER_X = 88;
const CHAR_CARET = 94;
const CHAR_X = 120;
const CHAR_V = 118;
const CHAR_TILDE = 126;

const OP_EQ = 0;
const OP_GT = 1;
const OP_GTE = 2;
const OP_LT = 3;
const OP_LTE = 4;

const INVALID = 0;
const BOUNDED = 1;
/** any version; represented by an empty comparator in node-semver */
const WILDCARD = 2;

// #endregion

// #region set building

/**
 * intersects comparator bounds.
 */
class SetBuilder {
	readonly includePrerelease: boolean;
	readonly loose: boolean;
	/** `0` includes prereleases in generated lower bounds; empty excludes them */
	readonly floor: string;

	lower: Version | null = null;
	lowerInclusive = true;
	upper: Version | null = null;
	upperInclusive = true;
	/** a comparator matches nothing */
	empty = false;
	/** an unsafe version component invalidates the entire range, even in loose mode */
	fatal = false;
	comparators = 0;

	constructor(options: RangeOptions | undefined) {
		this.includePrerelease = options?.includePrerelease ?? false;
		this.loose = options?.loose ?? false;
		this.floor = this.includePrerelease ? '0' : '';
	}

	reset(): void {
		this.lower = null;
		this.lowerInclusive = true;
		this.upper = null;
		this.upperInclusive = true;
		this.empty = false;
		this.comparators = 0;
	}

	create(major: number, minor: number, patch: number, prerelease: string): Version | null {
		if (
			major > Number.MAX_SAFE_INTEGER ||
			minor > Number.MAX_SAFE_INTEGER ||
			patch > Number.MAX_SAFE_INTEGER
		) {
			this.fatal = true;
			return null;
		}
		return { major, minor, patch, prerelease, build: '' };
	}

	addLower(major: number, minor: number, patch: number, prerelease: string, inclusive: boolean): void {
		const version = this.create(major, minor, patch, prerelease);
		if (version === null) {
			return;
		}
		if (this.lower !== null) {
			const cmp = compareVersions(version, this.lower);
			if (cmp < 0 || (cmp === 0 && inclusive)) {
				return;
			}
		}
		this.lower = version;
		this.lowerInclusive = inclusive;
	}

	addUpper(major: number, minor: number, patch: number, prerelease: string, inclusive: boolean): void {
		const version = this.create(major, minor, patch, prerelease);
		if (version === null) {
			return;
		}
		if (this.upper !== null) {
			const cmp = compareVersions(version, this.upper);
			if (cmp > 0 || (cmp === 0 && inclusive)) {
				return;
			}
		}
		this.upper = version;
		this.upperInclusive = inclusive;
	}

	/**
	 * adds a lower bound at `major.minor.0`.
	 * @param zero omit the bound for literal `0.0`, which node-semver treats as `*`
	 */
	addFloor(major: number, minor: number, zero: boolean): void {
		if (!zero) {
			this.addLower(major, minor, 0, this.floor, true);
		}
	}

	addMajor(major: number, zero: boolean): void {
		this.addFloor(major, 0, zero);
		this.addUpper(major + 1, 0, 0, '0', false);
	}

	addMinor(major: number, minor: number, zero: boolean): void {
		this.addFloor(major, minor, zero);
		this.addUpper(major, minor + 1, 0, '0', false);
	}

	/**
	 * @returns the intersection, or null if empty
	 */
	build(): ComparatorSet | null {
		const { lower, upper } = this;
		if (this.empty) {
			return null;
		}
		if (lower !== null && upper !== null) {
			const cmp = compareVersions(lower, upper);
			if (cmp > 0 || (cmp === 0 && !(this.lowerInclusive && this.upperInclusive))) {
				return null;
			}
		}
		return {
			lower,
			lowerInclusive: this.lowerInclusive,
			upper,
			upperInclusive: this.upperInclusive,
		};
	}
}

// #endregion

// #region comparator parsing

/**
 * scans an x-range identifier: a number, `x`, `X` or `*`.
 * @returns the index after it, or -1 if there is none
 */
const scanPart = (str: string, start: number, end: number, loose: boolean): number => {
	if (start >= end) {
		return -1;
	}
	const c = str.charCodeAt(start);
	if (c === CHAR_X || c === CHAR_UPPER_X || c === CHAR_STAR) {
		return start + 1;
	}
	const i = scanDigits(str, start, end);
	if (i === start || (!loose && c === CHAR_ZERO && i - start > 1)) {
		return -1;
	}
	return i;
};

/** missing parts (`start === -1`) count as wildcards */
const isWildcard = (str: string, start: number): boolean => {
	return start === -1 || !isDigit(str.charCodeAt(start));
};

/** literal `0`, not a loose equivalent such as `00` */
const isZero = (str: string, start: number, end: number): boolean => {
	return end - start === 1 && str.charCodeAt(start) === CHAR_ZERO;
};

/**
 * expands a comparator into bounds using node-semver's rules.
 * @param primitive accept only an operator and a full version, without range shorthand
 * @returns `INVALID`, `BOUNDED`, or `WILDCARD`
 */
const parseComparator = (
	b: SetBuilder,
	str: string,
	start: number,
	end: number,
	primitive: boolean,
): number => {
	const loose = b.loose;

	let sugar = 0;
	let op = OP_EQ;
	let i = start;
	{
		const c = str.charCodeAt(i);
		if (c === CHAR_CARET || c === CHAR_TILDE) {
			if (primitive) {
				return INVALID;
			}
			sugar = c;
			i++;
			if (c === CHAR_TILDE && i < end && str.charCodeAt(i) === CHAR_GREATER) {
				i++;
			}
		} else {
			if (c === CHAR_LESS) {
				op = OP_LT;
				i++;
			} else if (c === CHAR_GREATER) {
				op = OP_GT;
				i++;
			}
			if (i < end && str.charCodeAt(i) === CHAR_EQUALS) {
				i++;
				if (op === OP_LT) {
					op = OP_LTE;
				} else if (op === OP_GT) {
					op = OP_GTE;
				}
			}
		}
	}

	const prefixStart = i;
	while (i < end) {
		const c = str.charCodeAt(i);
		if (c !== CHAR_V && c !== CHAR_EQUALS) {
			break;
		}
		i++;
	}
	const prefixEnd = i;

	// parts, each spanning `[xStart, xEnd)`, or -1 when missing
	const majorStart = i;
	const majorEnd = scanPart(str, i, end, loose);
	if (majorEnd === -1) {
		return INVALID;
	}
	let minorStart = -1;
	let minorEnd = -1;
	let patchStart = -1;
	let patchEnd = -1;
	let preStart = -1;
	let prerelease = '';
	i = majorEnd;
	if (i < end) {
		if (str.charCodeAt(i) !== CHAR_DOT) {
			return INVALID;
		}
		minorStart = i + 1;
		minorEnd = scanPart(str, minorStart, end, loose);
		if (minorEnd === -1) {
			return INVALID;
		}
		i = minorEnd;
	}
	if (i < end) {
		if (str.charCodeAt(i) !== CHAR_DOT) {
			return INVALID;
		}
		patchStart = i + 1;
		patchEnd = scanPart(str, patchStart, end, loose);
		if (patchEnd === -1) {
			return INVALID;
		}
		i = patchEnd;
	}
	if (i < end) {
		// prereleases may only follow a patch
		if (patchStart === -1) {
			return INVALID;
		}
		preStart = findPrereleaseStart(str, i, end, loose);
		if (preStart === -1) {
			return INVALID;
		}
		const parsed = parsePrerelease(str, preStart, end, loose);
		if (parsed === null) {
			return INVALID;
		}
		prerelease = parsed;
	}

	const xMajor = isWildcard(str, majorStart);
	const xMinor = isWildcard(str, minorStart);
	const xPatch = isWildcard(str, patchStart);
	const major = xMajor ? 0 : parseDigits(str, majorStart, majorEnd);
	const minor = xMinor ? 0 : parseDigits(str, minorStart, minorEnd);
	const patch = xPatch ? 0 : parseDigits(str, patchStart, patchEnd);
	const zMajor = isZero(str, majorStart, majorEnd);
	const zMinor = isZero(str, minorStart, minorEnd);
	const zPatch = isZero(str, patchStart, patchEnd);

	// node-semver drops a `>=` written exactly as `0.0.0`, or `0.0.0-0` with `includePrerelease`,
	// as a synonym of `*`
	const anyFloor =
		zMajor &&
		zMinor &&
		zPatch &&
		(preStart === -1 ? !b.includePrerelease : b.includePrerelease && isZero(str, preStart, end));

	switch (sugar) {
		// #region caret
		case CHAR_CARET: {
			if (xMajor) {
				return WILDCARD;
			}
			if (xMinor) {
				b.addMajor(major, zMajor);
			} else if (xPatch) {
				if (zMajor) {
					b.addMinor(major, minor, zMinor);
				} else {
					b.addFloor(major, minor, false);
					b.addUpper(major + 1, 0, 0, '0', false);
				}
			} else {
				if (!anyFloor) {
					b.addLower(major, minor, patch, prerelease, true);
				}
				if (!zMajor) {
					b.addUpper(major + 1, 0, 0, '0', false);
				} else if (!zMinor) {
					b.addUpper(major, minor + 1, 0, '0', false);
				} else {
					b.addUpper(major, minor, patch + 1, '0', false);
				}
			}
			return BOUNDED;
		}
		// #endregion

		// #region tilde
		case CHAR_TILDE: {
			if (xMajor) {
				return WILDCARD;
			}
			if (xMinor) {
				b.addMajor(major, zMajor);
			} else if (xPatch) {
				b.addMinor(major, minor, zMajor && zMinor);
			} else {
				if (!anyFloor) {
					b.addLower(major, minor, patch, prerelease, true);
				}
				b.addUpper(major, minor + 1, 0, '0', false);
			}
			return BOUNDED;
		}
		// #endregion
	}

	// #region x-ranges

	if (xMajor || xMinor || xPatch) {
		// `*.1` and `1.x.1` are not x-ranges
		if (primitive || (xMajor && minorStart !== -1 && !xMinor) || (xMinor && patchStart !== -1 && !xPatch)) {
			return INVALID;
		}

		if (xMajor) {
			if (op === OP_GT || op === OP_LT) {
				b.empty = true;
				return BOUNDED;
			}
			return WILDCARD;
		}

		switch (op) {
			case OP_EQ: {
				if (xMinor) {
					b.addMajor(major, zMajor);
				} else {
					b.addMinor(major, minor, zMajor && zMinor);
				}
				break;
			}
			case OP_GT: {
				// >1 is >=2.0.0, >1.2 is >=1.3.0
				if (xMinor) {
					b.addFloor(major + 1, 0, false);
				} else {
					b.addFloor(major, minor + 1, false);
				}
				break;
			}
			case OP_GTE: {
				b.addFloor(major, minor, zMajor && (xMinor || zMinor));
				break;
			}
			case OP_LT: {
				b.addUpper(major, minor, 0, '0', false);
				break;
			}
			case OP_LTE: {
				// <=1 is <2.0.0-0, <=1.2 is <1.3.0-0
				if (xMinor) {
					b.addUpper(major + 1, 0, 0, '0', false);
				} else {
					b.addUpper(major, minor + 1, 0, '0', false);
				}
				break;
			}
		}
		return BOUNDED;
	}

	// #endregion

	// #region primitives

	// strict mode allows only a single `v` between the operator and the version
	if (
		!loose &&
		prefixEnd !== prefixStart &&
		(prefixEnd - prefixStart > 1 || str.charCodeAt(prefixStart) !== CHAR_V)
	) {
		return INVALID;
	}

	switch (op) {
		case OP_EQ: {
			b.addLower(major, minor, patch, prerelease, true);
			b.addUpper(major, minor, patch, prerelease, true);
			break;
		}
		case OP_GT: {
			b.addLower(major, minor, patch, prerelease, false);
			break;
		}
		case OP_GTE: {
			if (!(prefixEnd === prefixStart && anyFloor)) {
				b.addLower(major, minor, patch, prerelease, true);
			}
			break;
		}
		case OP_LT: {
			b.addUpper(major, minor, patch, prerelease, false);
			break;
		}
		case OP_LTE: {
			b.addUpper(major, minor, patch, prerelease, true);
			break;
		}
	}
	return BOUNDED;

	// #endregion
};

// #endregion

// #region slow path

// node-semver regexes for inputs requiring normalization
const NON_NUMERIC_ID = '\\d*[a-zA-Z-][a-zA-Z0-9-]*';
const BUILD = '(?:\\+([a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*))';

const createXRangePlain = (loose: boolean): string => {
	const part = loose ? '\\d+|x|X|\\*' : '0|[1-9]\\d*|x|X|\\*';
	const id = '(?:' + NON_NUMERIC_ID + '|' + (loose ? '\\d+' : '0|[1-9]\\d*') + ')';
	const prerelease = '(?:' + (loose ? '-?' : '-') + '(' + id + '(?:\\.' + id + ')*))';
	return (
		'[v=\\s]*(' + part + ')(?:\\.(' + part + ')(?:\\.(' + part + ')(?:' + prerelease + ')?' + BUILD + '?)?)?'
	);
};

const createLoosePlain = (): string => {
	const id = '(?:' + NON_NUMERIC_ID + '|\\d+)';
	return '[v=\\s]*(\\d+)\\.(\\d+)\\.(\\d+)(?:-?((?:' + id + ')(?:\\.' + id + ')*))?' + BUILD + '?';
};

const createHyphenRange = (loose: boolean): RegExp => {
	const plain = createXRangePlain(loose);
	return new RegExp('^\\s?(' + plain + ')\\s-\\s(' + plain + ')\\s?$');
};

const BUILD_RE = new RegExp(BUILD, 'g');
const HYPHEN_RE = createHyphenRange(false);
const HYPHEN_LOOSE_RE = createHyphenRange(true);
const COMPARATOR_TRIM_RE = new RegExp(
	'(\\s?)((?:<|>)?=?)\\s?(' + createLoosePlain() + '|' + createXRangePlain(false) + ')',
	'g',
);
const TILDE_TRIM_RE = /(\s?)~>?\s/g;
const CARET_TRIM_RE = /(\s?)\^\s/g;
const STAR_RE = /(<|>)?=?\s*\*/;
const WHITESPACE_RE = /\s+/g;

const isX = (id: string | undefined): boolean => {
	return !id || id === 'x' || id === 'X' || id === '*';
};

/**
 * expands hyphen ranges using node-semver's rules.
 */
const hyphenReplace = (includePrerelease: boolean) => {
	return (
		_match: string,
		from: string,
		fM: string,
		fm: string | undefined,
		fp: string | undefined,
		fpr: string | undefined,
		_fb: string | undefined,
		to: string,
		tM: string,
		tm: string | undefined,
		tp: string | undefined,
		tpr: string | undefined,
	): string => {
		const z = includePrerelease ? '-0' : '';

		if (isX(fM)) {
			from = '';
		} else if (isX(fm)) {
			from = '>=' + fM + '.0.0' + z;
		} else if (isX(fp)) {
			from = '>=' + fM + '.' + fm + '.0' + z;
		} else if (fpr) {
			from = '>=' + from;
		} else {
			from = '>=' + from + z;
		}

		if (isX(tM)) {
			to = '';
		} else if (isX(tm)) {
			to = '<' + (+tM + 1) + '.0.0-0';
		} else if (isX(tp)) {
			to = '<' + tM + '.' + (+tm! + 1) + '.0-0';
		} else if (tpr) {
			to = '<=' + tM + '.' + tm + '.' + tp + '-' + tpr;
		} else if (includePrerelease) {
			to = '<' + tM + '.' + tm + '.' + (+tp! + 1) + '-0';
		} else {
			to = '<=' + to;
		}

		return (from + ' ' + to).trim();
	};
};

const HYPHEN_REPLACE = hyphenReplace(false);
const HYPHEN_REPLACE_PRERELEASE = hyphenReplace(true);

/**
 * checks for build metadata, hyphen ranges, or whitespace requiring normalization.
 */
const needsRewrite = (part: string): boolean => {
	let prev = 0;
	for (let i = 0; i < part.length; i++) {
		const c = part.charCodeAt(i);
		if (c === CHAR_PLUS) {
			return true;
		}
		if (isSpace(c)) {
			switch (prev) {
				case CHAR_SPACE:
				case CHAR_LESS:
				case CHAR_EQUALS:
				case CHAR_GREATER:
				case CHAR_CARET:
				case CHAR_TILDE: {
					return true;
				}
			}
			if (c !== CHAR_SPACE) {
				return true;
			}
		} else if (c === CHAR_HYPHEN && prev === CHAR_SPACE && part.charCodeAt(i + 1) === CHAR_SPACE) {
			return true;
		}
		prev = c;
	}
	return false;
};

/**
 * normalizes whitespace, removes build metadata, and expands hyphen ranges before splitting.
 */
const rewritePart = (part: string, b: SetBuilder): string[] => {
	let str = part.replace(WHITESPACE_RE, ' ');
	str = str.replace(BUILD_RE, '');
	str = str.replace(
		b.loose ? HYPHEN_LOOSE_RE : HYPHEN_RE,
		b.includePrerelease ? HYPHEN_REPLACE_PRERELEASE : HYPHEN_REPLACE,
	);
	str = str.replace(COMPARATOR_TRIM_RE, '$1$2$3');
	str = str.replace(TILDE_TRIM_RE, '$1~');
	str = str.replace(CARET_TRIM_RE, '$1^');
	return str.split(WHITESPACE_RE);
};

/**
 * adds a comparator's bounds and updates the valid comparator count.
 * @param edge whether the comparator is the first or last of its set
 * @returns false if the comparator invalidates the whole range
 */
const addComparator = (b: SetBuilder, str: string, start: number, end: number, edge: boolean): boolean => {
	// an empty comparator is any version
	let result = start === end ? WILDCARD : parseComparator(b, str, start, end, false);

	// node-semver retries invalid comparators after removing the first star expression
	if (result === INVALID) {
		const star = str.indexOf('*', start);
		if (star !== -1 && star < end) {
			const stripped = str.slice(start, end).replace(STAR_RE, '');
			if (stripped !== '') {
				result = parseComparator(b, stripped, 0, stripped.length, true);
			}
		}
	}

	if (result === INVALID) {
		return b.loose;
	}
	// node-semver's join/split drops empty wildcard comparators except at the edges
	if (result !== WILDCARD || edge) {
		b.comparators++;
	}
	return true;
};

// #endregion

// #region public api

/** matches any version, prereleases included only with `includePrerelease` */
const ANY_SET: ComparatorSet = {
	lower: null,
	lowerInclusive: true,
	upper: null,
	upperInclusive: true,
};

/**
 * parses a version range with node-semver's semantics.
 * @param input the range, e.g. `^1.2.3 || >=2.0.0-beta <3`
 * @param options parsing options
 * @returns the parsed range, or null if invalid
 */
export const parseRange = (input: string, options?: RangeOptions): Range | null => {
	const b = new SetBuilder(options);
	const parts = input.split('||');
	const sets: ComparatorSet[] = [];

	let valid = false;
	let any = false;
	for (let p = 0; p < parts.length; p++) {
		const part = parts[p]!.trim();
		b.reset();

		if (!needsRewrite(part)) {
			let start = 0;
			while (start < part.length) {
				let end = part.indexOf(' ', start);
				if (end === -1) {
					end = part.length;
				}
				if (!addComparator(b, part, start, end, start === 0 || end === part.length)) {
					return null;
				}
				start = end + 1;
			}
		} else {
			const list = rewritePart(part, b);
			for (let i = 0; i < list.length; i++) {
				const comparator = list[i]!;
				if (!addComparator(b, comparator, 0, comparator.length, i === 0 || i === list.length - 1)) {
					return null;
				}
			}
		}

		if (b.fatal) {
			return null;
		}
		// loose mode drops sets with no valid comparators; an empty input still matches any version
		if (part !== '' && b.comparators === 0) {
			continue;
		}

		valid = true;
		const set = b.build();
		if (set === null) {
			continue;
		}
		// node-semver lets `*` override other sets, including their prerelease permissions
		if (set.lower === null && set.upper === null) {
			any = true;
		}
		sets.push(set);
	}

	if (!valid) {
		return null;
	}

	return {
		includePrerelease: b.includePrerelease,
		loose: b.loose,
		sets: any ? [ANY_SET] : sets,
	};
};

const allowsPrerelease = (bound: Version | null, version: Version): boolean => {
	return (
		bound !== null &&
		bound.prerelease !== '' &&
		compareMain(version.major, version.minor, version.patch, bound) === 0
	);
};

/**
 * tests whether a version satisfies a range.
 * @param range the range
 * @param version the version
 * @returns whether the version is within the range
 */
export const testRange = (range: Range, version: Version): boolean => {
	const sets = range.sets;
	const gated = version.prerelease !== '' && !range.includePrerelease;

	for (let i = 0; i < sets.length; i++) {
		const { lower, lowerInclusive, upper, upperInclusive } = sets[i]!;

		if (lower !== null) {
			const cmp = compareVersions(version, lower);
			if (cmp < 0 || (cmp === 0 && !lowerInclusive)) {
				continue;
			}
		}
		if (upper !== null) {
			const cmp = compareVersions(version, upper);
			if (cmp > 0 || (cmp === 0 && !upperInclusive)) {
				continue;
			}
		}

		// prereleases only match sets that opt into their `major.minor.patch`
		if (gated && !allowsPrerelease(lower, version) && !allowsPrerelease(upper, version)) {
			continue;
		}

		return true;
	}

	return false;
};

/**
 * tests whether a version string satisfies a range.
 * @param version the version, parsed with the range's `loose` option
 * @param range the range
 * @returns whether the version is valid and within the range
 */
export const satisfies = (version: string, range: Range): boolean => {
	const parsed = parseVersion(version, range);
	return parsed !== null && testRange(range, parsed);
};

/**
 * finds the highest version that satisfies a range.
 * @param versions version strings; parsed with the range's `loose` option, invalid ones skipped
 * @param range the range
 * @returns the highest matching version, first on ties, or null if none match
 */
export const maxSatisfying = (versions: readonly string[], range: Range): string | null => {
	const { loose, sets } = range;
	if (sets.length === 0) {
		return null;
	}

	// outer bounds let us reject versions by `major.minor.patch` without a full parse
	let lowest = sets[0]!.lower;
	let highest = sets[0]!.upper;
	for (let i = 1; i < sets.length; i++) {
		const { lower, upper } = sets[i]!;
		if (
			lowest !== null &&
			(lower === null || compareMain(lower.major, lower.minor, lower.patch, lowest) < 0)
		) {
			lowest = lower;
		}
		if (
			highest !== null &&
			(upper === null || compareMain(upper.major, upper.minor, upper.patch, highest) > 0)
		) {
			highest = upper;
		}
	}

	let best: Version | null = null;
	let bestRaw: string | null = null;
	// registry versions are usually oldest first; scan backwards to skip lower versions sooner
	for (let i = versions.length - 1; i >= 0; i--) {
		const raw = versions[i]!;
		if (raw.length > MAX_LENGTH || !scanMain(raw, 0, raw.length, loose)) {
			continue;
		}
		{
			const { major, minor, patch } = mainScan;
			if (
				(best !== null && compareMain(major, minor, patch, best) < 0) ||
				(lowest !== null && compareMain(major, minor, patch, lowest) < 0) ||
				(highest !== null && compareMain(major, minor, patch, highest) > 0)
			) {
				continue;
			}
		}

		const version = parseVersion(raw, range);
		// on a tie, the earlier version wins
		if (version === null || (best !== null && compareVersions(version, best) < 0)) {
			continue;
		}
		if (testRange(range, version)) {
			best = version;
			bestRaw = raw;
		}
	}
	return bestRaw;
};

// #endregion
