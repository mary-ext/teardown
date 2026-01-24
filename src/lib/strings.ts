export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, ' ').trim();
}

// matches ANSI escape sequences (colors, cursor movement, etc.)
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * strips ANSI escape codes from a string.
 *
 * @param input string potentially containing ANSI codes
 * @returns string with ANSI codes removed
 */
export function stripAnsi(input: string): string {
	return input.replace(ANSI_REGEX, '');
}
