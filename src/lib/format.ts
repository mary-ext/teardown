const byteUnits = ['B', 'kB', 'MB', 'GB'] as const;

/**
 * formats bytes into a human-readable string.
 *
 * @param bytes the number of bytes
 * @returns formatted string like "1.2 kB" or "3.4 MB"
 */
export function formatBytes(bytes: number): string {
	const k = 1000;
	const i = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(k)), byteUnits.length - 1);
	const value = bytes / Math.pow(k, i);

	return `${value.toLocaleString('en-US', { maximumSignificantDigits: 3 })} ${byteUnits[i]}`;
}

/**
 * formats bytes without unit conversion (always in bytes).
 *
 * @param bytes the number of bytes
 * @returns formatted string like "1,234 B"
 */
export function formatLongBytes(bytes: number): string {
	return `${bytes.toLocaleString('en-US')} B`;
}

/**
 * formats a number with thousand separators.
 *
 * @param n the number to format
 * @returns formatted string like "1,234"
 */
export function formatNumber(n: number): string {
	return n.toLocaleString('en-US');
}
