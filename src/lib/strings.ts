export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, ' ').trim();
}
