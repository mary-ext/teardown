/**
 * formats bytes into a human-readable string.
 *
 * @param bytes the number of bytes
 * @param decimals number of decimal places (default: 1)
 * @returns formatted string like "1.2 kB" or "3.4 MB"
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
	if (bytes === 0) {
		return '0 B';
	}

	const k = 1000;
	const sizes = ['B', 'kB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
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
