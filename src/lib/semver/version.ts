// #region types

/**
 * a parsed semantic version.
 */
export interface Version {
	major: number;
	minor: number;
	patch: number;
	/** dot-separated prerelease identifiers, empty when absent */
	prerelease: string;
	/** dot-separated build metadata, empty when absent */
	build: string;
}

/**
 * options for parsing versions.
 */
export interface VersionOptions {
	/**
	 * accept mixed `v`, `=` and whitespace prefixes, leading zeros, and hyphenless prereleases
	 * such as `1.2.3beta`
	 * @default false
	 */
	loose?: boolean;
}

// #endregion

// #region character classes

/** versions longer than this are rejected, matching node-semver */
export const MAX_LENGTH = 256;

const CHAR_HYPHEN = 45;
const CHAR_DOT = 46;
const CHAR_ZERO = 48;
const CHAR_EQUALS = 61;
const CHAR_V = 118;

const DIGIT = 1;
const LETTER = 2;

/** character classes for `[0-9A-Za-z-]`; 0 for invalid characters */
const IDENTIFIER_CHARS = /* #__PURE__ */ (() => {
	const table = new Uint8Array(128);
	table.fill(DIGIT, 48, 58);
	table.fill(LETTER, 65, 91);
	table.fill(LETTER, 97, 123);
	table[CHAR_HYPHEN] = LETTER;
	return table;
})();

const charClass = (c: number): number => {
	return c < 128 ? IDENTIFIER_CHARS[c]! : 0;
};

/**
 * @param c a char code
 * @returns whether it is `[0-9]`
 */
export const isDigit = (c: number): boolean => {
	return c >= 48 && c <= 57;
};

/**
 * @param c a char code
 * @returns whether it is `[0-9A-Za-z-]`, the alphabet of prerelease and build identifiers
 */
export const isIdentifierChar = (c: number): boolean => {
	return charClass(c) !== 0;
};

/**
 * @param c a char code
 * @returns whether it matches JavaScript's `\s` character class
 */
export const isSpace = (c: number): boolean => {
	if (c <= 32) {
		return c === 32 || (c >= 9 && c <= 13);
	}
	if (c < 0xa0) {
		return false;
	}
	return (
		c === 0xa0 ||
		c === 0x1680 ||
		(c >= 0x2000 && c <= 0x200a) ||
		c === 0x2028 ||
		c === 0x2029 ||
		c === 0x202f ||
		c === 0x205f ||
		c === 0x3000 ||
		c === 0xfeff
	);
};

// #endregion

// #region scanning

/**
 * finds the end of a digit run.
 * @param str the string to scan
 * @param start where the run starts
 * @param end where scanning stops
 * @returns the index after the last digit
 */
export const scanDigits = (str: string, start: number, end: number): number => {
	let i = start;
	while (i < end && isDigit(str.charCodeAt(i))) {
		i++;
	}
	return i;
};

/**
 * reads a digit run; values above `Number.MAX_SAFE_INTEGER` may lose precision.
 * @param str the string holding the run
 * @param start where the run starts
 * @param end where the run ends
 * @returns the numeric value, or 0 for an empty run
 */
export const parseDigits = (str: string, start: number, end: number): number => {
	let value = 0;
	for (let i = start; i < end; i++) {
		value = value * 10 + (str.charCodeAt(i) - CHAR_ZERO);
	}
	return value;
};

/**
 * node-semver normalizes numeric identifiers only below `MAX_SAFE_INTEGER`.
 */
const stripLeadingZeros = (prerelease: string): string => {
	return prerelease
		.split('.')
		.map((id) => {
			if (/^[0-9]+$/.test(id)) {
				const num = +id;
				if (num < Number.MAX_SAFE_INTEGER) {
					return '' + num;
				}
			}
			return id;
		})
		.join('.');
};

/**
 * finds where the prerelease following a patch starts.
 * @param str the string to scan
 * @param index the index right after the patch, before `end`
 * @param end where scanning stops
 * @param loose whether the hyphen is optional
 * @returns the start of the first identifier, or -1 if none can start there
 */
export const findPrereleaseStart = (str: string, index: number, end: number, loose: boolean): number => {
	const c = str.charCodeAt(index);
	if (c === CHAR_HYPHEN) {
		// in loose mode, a lone hyphen is an identifier rather than a separator
		if (loose && !(index + 1 < end && isIdentifierChar(str.charCodeAt(index + 1)))) {
			return index;
		}
		return index + 1;
	}
	if (loose && isIdentifierChar(c)) {
		return index;
	}
	return -1;
};

/**
 * parses dot-separated prerelease identifiers spanning exactly `[start, end)`.
 * @param str the string to scan
 * @param start where the identifiers start
 * @param end where they must end
 * @param loose whether numeric identifiers may have leading zeros
 * @returns the normalized prerelease, or null for invalid identifiers
 */
export const parsePrerelease = (str: string, start: number, end: number, loose: boolean): string | null => {
	let leadingZero = false;
	let i = start;
	while (true) {
		const idStart = i;
		let seen = 0;
		while (i < end) {
			const k = charClass(str.charCodeAt(i));
			if (k === 0) {
				break;
			}
			seen |= k;
			i++;
		}

		if (i === idStart) {
			return null;
		}
		if (seen === DIGIT && i - idStart > 1 && str.charCodeAt(idStart) === CHAR_ZERO) {
			if (!loose) {
				return null;
			}
			leadingZero = true;
		}

		if (i === end) {
			break;
		}
		if (str.charCodeAt(i) !== CHAR_DOT) {
			return null;
		}
		i++;
	}

	const prerelease = str.slice(start, end);
	return leadingZero ? stripLeadingZeros(prerelease) : prerelease;
};

/**
 * checks that dot-separated build identifiers span exactly `[start, end)`.
 */
const isBuild = (str: string, start: number, end: number): boolean => {
	let i = start;
	while (true) {
		const idStart = i;
		while (i < end && charClass(str.charCodeAt(i)) !== 0) {
			i++;
		}
		if (i === idStart) {
			return false;
		}
		if (i === end) {
			return true;
		}
		if (str.charCodeAt(i) !== CHAR_DOT) {
			return false;
		}
		i++;
	}
};

/**
 * shared result of `scanMain`; read only after a successful call and before the next call.
 */
export const mainScan = {
	major: 0,
	minor: 0,
	patch: 0,
	/** index after the patch */
	index: 0,
	/** end of the version with trailing whitespace trimmed */
	end: 0,
};

/**
 * scans the whitespace, prefix and `major.minor.patch` that start a version, storing the results
 * in `mainScan`.
 * @param str the string to scan
 * @param start where the version starts
 * @param end where the version ends
 * @param loose whether to accept loose prefixes and leading zeros
 * @returns whether `major.minor.patch` is valid; the suffix is not checked
 */
export const scanMain = (str: string, start: number, end: number, loose: boolean): boolean => {
	while (start < end && isSpace(str.charCodeAt(start))) {
		start++;
	}
	while (end > start && isSpace(str.charCodeAt(end - 1))) {
		end--;
	}

	let i = start;
	if (loose) {
		while (i < end) {
			const c = str.charCodeAt(i);
			if (c !== CHAR_V && c !== CHAR_EQUALS && !isSpace(c)) {
				break;
			}
			i++;
		}
	} else if (i < end && str.charCodeAt(i) === CHAR_V) {
		i++;
	}

	for (let part = 0; part < 3; part++) {
		if (part !== 0) {
			if (i >= end || str.charCodeAt(i) !== CHAR_DOT) {
				return false;
			}
			i++;
		}

		const partStart = i;
		let value = 0;
		while (i < end) {
			const d = str.charCodeAt(i) - CHAR_ZERO;
			if (d < 0 || d > 9) {
				break;
			}
			value = value * 10 + d;
			i++;
		}
		if (i === partStart || (!loose && i - partStart > 1 && str.charCodeAt(partStart) === CHAR_ZERO)) {
			return false;
		}
		if (value > Number.MAX_SAFE_INTEGER) {
			return false;
		}

		switch (part) {
			case 0: {
				mainScan.major = value;
				break;
			}
			case 1: {
				mainScan.minor = value;
				break;
			}
			default: {
				mainScan.patch = value;
			}
		}
	}

	mainScan.index = i;
	mainScan.end = end;
	return true;
};

/**
 * parses a version spanning exactly `[start, end)` after trimming whitespace.
 */
const scanVersion = (str: string, start: number, end: number, loose: boolean): Version | null => {
	if (!scanMain(str, start, end, loose)) {
		return null;
	}
	const { major, minor, patch } = mainScan;
	let i = mainScan.index;
	end = mainScan.end;

	let prerelease = '';
	let build = '';
	if (i < end) {
		let plus = str.indexOf('+', i);
		if (plus === -1 || plus > end) {
			plus = end;
		}

		if (i !== plus) {
			const preStart = findPrereleaseStart(str, i, plus, loose);
			if (preStart === -1) {
				return null;
			}
			const parsed = parsePrerelease(str, preStart, plus, loose);
			if (parsed === null) {
				return null;
			}
			prerelease = parsed;
		}

		if (plus !== end) {
			if (!isBuild(str, plus + 1, end)) {
				return null;
			}
			build = str.slice(plus + 1, end);
		}
	}

	return { major, minor, patch, prerelease, build };
};

// #endregion

// #region comparison

/**
 * compares two dot-separated prerelease strings by precedence.
 * @returns a negative number if `a` sorts first, positive if `b` does, zero if equal
 */
const comparePrerelease = (a: string, b: string): number => {
	if (a === b) {
		return 0;
	}
	// a release outranks any of its prereleases
	if (a === '') {
		return 1;
	}
	if (b === '') {
		return -1;
	}

	const aLength = a.length;
	const bLength = b.length;
	let i = 0;
	let j = 0;
	while (true) {
		let aEnd = i;
		let aNumeric = true;
		for (; aEnd < aLength; aEnd++) {
			const c = a.charCodeAt(aEnd);
			if (c === CHAR_DOT) {
				break;
			}
			aNumeric &&= isDigit(c);
		}

		let bEnd = j;
		let bNumeric = true;
		for (; bEnd < bLength; bEnd++) {
			const c = b.charCodeAt(bEnd);
			if (c === CHAR_DOT) {
				break;
			}
			bNumeric &&= isDigit(c);
		}

		const aSize = aEnd - i;
		const bSize = bEnd - j;
		if (aNumeric && bNumeric) {
			if (aSize > 15 || bSize > 15) {
				// identifiers past MAX_SAFE_INTEGER compare as lossy numbers, like node-semver
				const aId = a.slice(i, aEnd);
				const bId = b.slice(j, bEnd);
				if (aId !== bId) {
					// distinct identifiers that round to the same number end the comparison as equal
					return Math.sign(Number(aId) - Number(bId));
				}
			} else if (aSize !== bSize) {
				// short numeric identifiers never have leading zeros, so length orders them
				return aSize - bSize;
			} else {
				for (let k = 0; k < aSize; k++) {
					const d = a.charCodeAt(i + k) - b.charCodeAt(j + k);
					if (d !== 0) {
						return d;
					}
				}
			}
		} else if (aNumeric) {
			return -1;
		} else if (bNumeric) {
			return 1;
		} else {
			const size = Math.min(aSize, bSize);
			for (let k = 0; k < size; k++) {
				const d = a.charCodeAt(i + k) - b.charCodeAt(j + k);
				if (d !== 0) {
					return d;
				}
			}
			if (aSize !== bSize) {
				return aSize - bSize;
			}
		}

		i = aEnd + 1;
		j = bEnd + 1;
		const aDone = aEnd >= aLength;
		const bDone = bEnd >= bLength;
		if (aDone || bDone) {
			// a shorter identifier list sorts first
			return Number(bDone) - Number(aDone);
		}
	}
};

/**
 * compares a `major.minor.patch` to a version's, ignoring its prerelease.
 * @param major the major version
 * @param minor the minor version
 * @param patch the patch version
 * @param version the version to compare against
 * @returns negative, positive, or zero when `major.minor.patch` is lower, higher, or equal
 */
export const compareMain = (major: number, minor: number, patch: number, version: Version): number => {
	if (major !== version.major) {
		return major < version.major ? -1 : 1;
	}
	if (minor !== version.minor) {
		return minor < version.minor ? -1 : 1;
	}
	if (patch !== version.patch) {
		return patch < version.patch ? -1 : 1;
	}
	return 0;
};

// #endregion

// #region public api

/**
 * parses a semantic version.
 * @param input the version string, surrounding whitespace is ignored
 * @param options parsing options
 * @returns the parsed version, or null if invalid
 */
export const parseVersion = (input: string, options?: VersionOptions): Version | null => {
	if (input.length > MAX_LENGTH) {
		return null;
	}
	return scanVersion(input, 0, input.length, options?.loose ?? false);
};

/**
 * parses a version after stripping leading `=` and `v` characters, like `semver.clean`.
 * @param input the version string
 * @param options parsing options
 * @returns the normalized version string without build metadata, or null if invalid
 */
export const cleanVersion = (input: string, options?: VersionOptions): string | null => {
	// unlike parseVersion, semver.clean checks length after removing whitespace and prefixes
	let start = 0;
	let end = input.length;
	while (start < end && isSpace(input.charCodeAt(start))) {
		start++;
	}
	while (end > start && isSpace(input.charCodeAt(end - 1))) {
		end--;
	}
	while (start < end) {
		const c = input.charCodeAt(start);
		if (c !== CHAR_EQUALS && c !== CHAR_V) {
			break;
		}
		start++;
	}

	if (end - start > MAX_LENGTH) {
		return null;
	}
	const version = scanVersion(input, start, end, options?.loose ?? false);
	return version !== null ? formatVersion(version) : null;
};

/**
 * formats a version without its build metadata.
 * @param version the version
 * @returns the version string
 */
export const formatVersion = (version: Version): string => {
	const main = version.major + '.' + version.minor + '.' + version.patch;
	return version.prerelease !== '' ? main + '-' + version.prerelease : main;
};

/**
 * compares two versions by precedence, ignoring build metadata.
 * @param a the first version
 * @param b the second version
 * @returns a negative number if `a` sorts first, positive if `b` does, zero if equal
 */
export const compareVersions = (a: Version, b: Version): number => {
	return compareMain(a.major, a.minor, a.patch, b) || comparePrerelease(a.prerelease, b.prerelease);
};

/**
 * sorts version strings from highest to lowest precedence.
 * @param versions the version strings
 * @param options parsing options
 * @returns a sorted copy; equal versions keep their order, and unparseable ones come last
 */
export const rsortVersions = (versions: readonly string[], options?: VersionOptions): string[] => {
	// parse each version once, rather than on every comparison
	return versions
		.map((raw) => ({ raw, version: parseVersion(raw, options) }))
		.sort((a, b) => {
			if (a.version === null || b.version === null) {
				return Number(a.version === null) - Number(b.version === null);
			}
			return compareVersions(b.version, a.version);
		})
		.map((entry) => entry.raw);
};

// #endregion
