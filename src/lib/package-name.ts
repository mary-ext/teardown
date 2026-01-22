/**
 * regex for validating package specifiers.
 * matches: `[npm:|jsr:][@scope/]name[@version]`
 */
export const PACKAGE_SPECIFIER_RE =
	/^(?:(jsr|npm):)?((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)(?:@(.+))?$/;

export type Registry = 'npm' | 'jsr';

export interface ParsedPackageSpecifier {
	registry: Registry;
	name: string;
	range: string;
}

/**
 * parses a package specifier into registry, name, and version range.
 * @param input the string to parse
 * @returns parsed result, or null if invalid
 */
export const parsePackageSpecifier = (input: string): ParsedPackageSpecifier | null => {
	const match = PACKAGE_SPECIFIER_RE.exec(input);
	if (!match) {
		return null;
	}
	return {
		registry: (match[1] as Registry) ?? 'npm',
		name: match[2],
		range: match[3] ?? 'latest',
	};
};

/**
 * formats a package specifier into a string.
 * always includes registry prefix, omits version if it's 'latest'.
 * @param spec the parsed specifier
 * @returns formatted specifier string
 */
export const formatPackageSpecifier = (spec: ParsedPackageSpecifier): string => {
	const version = spec.range !== 'latest' ? `@${spec.range}` : '';
	return `${spec.registry}:${spec.name}${version}`;
};
