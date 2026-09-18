import { InvalidSpecifierError } from './errors';

/**
 * converts `@scope/name` to `@jsr/scope__name` for npm compatibility.
 *
 * @param name a scoped JSR package name
 * @returns the npm-compatible name
 * @throws {InvalidSpecifierError} if the name isn't scoped
 */
export function transformJsrName(name: string): string {
	if (!name.startsWith('@')) {
		throw new InvalidSpecifierError(name, 'JSR packages must be scoped');
	}
	const withoutAt = name.slice(1);
	const transformed = withoutAt.replace('/', '__');
	return `@jsr/${transformed}`;
}

/**
 * restores `@jsr/scope__name` to `@scope/name`.
 *
 * @param name the npm-compatible JSR package name
 * @returns the canonical JSR package name
 * @throws {InvalidSpecifierError} if the name isn't under `@jsr/`
 */
export function reverseJsrName(name: string): string {
	if (!name.startsWith('@jsr/')) {
		throw new InvalidSpecifierError(name, 'not a JSR npm-compatible name');
	}
	const withoutPrefix = name.slice(5);
	const restored = withoutPrefix.replace('__', '/');
	return `@${restored}`;
}
