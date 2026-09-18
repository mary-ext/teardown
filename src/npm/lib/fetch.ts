import { untar } from '@mary/tar';
import type { Volume } from 'memfs';

import { FetchError } from './errors';

/**
 * options for fetching packages.
 */
export interface FetchOptions {
	/** max concurrent fetches, a positive integer (default 16) */
	concurrency?: number;
	/** regex patterns for files to exclude (matched against path after the root folder is stripped) */
	exclude?: RegExp[];
}

/**
 * default patterns for files that are not needed for bundling.
 * matches against the file path within the package (e.g., "README.md", "docs/guide.md")
 */
export const DEFAULT_EXCLUDE_PATTERNS: RegExp[] = [
	// docs and meta files
	/^README(\..*)?$/i,
	/^LICENSE(\..*)?$/i,
	/^LICENCE(\..*)?$/i,
	/^CHANGELOG(\..*)?$/i,
	/^HISTORY(\..*)?$/i,
	/^CONTRIBUTING(\..*)?$/i,
	/^AUTHORS(\..*)?$/i,
	/^SECURITY(\..*)?$/i,
	/^CODE_OF_CONDUCT(\..*)?$/i,
	/^\.github\//,
	/^\.vscode\//,
	/^\.idea\//,
	/^docs?\//i,

	// test files
	/^__tests__\//,
	/^tests?\//i,
	/^specs?\//i,
	/\.(test|spec)\.[jt]sx?$/,
	/\.stories\.[jt]sx?$/,

	// config files
	/^\..+rc(\..*)?$/,
	/^\.editorconfig$/,
	/^\.gitignore$/,
	/^\.npmignore$/,
	/^\.eslint/,
	/^\.prettier/,
	/^tsconfig(\..+)?\.json$/,
	/^jest\.config/,
	/^vitest\.config/,
	/^rollup\.config/,
	/^webpack\.config/,
	/^vite\.config/,
	/^babel\.config/,

	// source maps (usually not needed in bundling)
	/\.map$/,

	// typescript declaration files (not needed for bundling)
	/\.d\.[cm]?ts$/,

	// flow type annotations
	/\.js\.flow$/,
	/\.flow$/,

	// example/demo directories
	/^examples?\//i,
];

/**
 * where and how to extract a tarball.
 */
export interface TarballOptions {
	/** the tarball URL */
	url: string;
	/** the destination path in the volume (e.g., "/node_modules/react") */
	destPath: string;
	/** regex patterns for files to skip */
	exclude: RegExp[];
}

/**
 * maps a tarball entry to a path within the package.
 * npm packs files under `package/`, but some older tarballs use another root folder, like `node/`.
 * @returns the relative path, or null for empty, absolute, or parent-traversing paths
 */
const toPackagePath = (name: string): string | null => {
	if (name.startsWith('/')) {
		return null;
	}

	const segments = name.split(/[/\\]/).filter((segment) => segment !== '' && segment !== '.');
	if (segments.includes('..')) {
		return null;
	}

	// single-segment entries have no root folder
	if (segments.length > 1) {
		segments.shift();
	}
	return segments.length > 0 ? segments.join('/') : null;
};

/**
 * extracts a gzipped tarball into a volume, stripping its root folder and skipping unsafe paths.
 *
 * @param volume the volume to write to
 * @param options the tarball and where to extract it
 * @returns total file size in bytes, including excluded files
 * @throws {FetchError} if the tarball can't be fetched
 */
export async function fetchTarballToVolume(
	volume: Volume,
	{ url, destPath, exclude }: TarballOptions,
): Promise<number> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new FetchError(url, response.status, response.statusText);
	}

	const body = response.body;
	if (!body) {
		throw new FetchError(url, 0, 'response has no body');
	}

	// decompress gzip -> extract tar
	const decompressed = body.pipeThrough(new DecompressionStream('gzip'));

	let totalSize = 0;

	for await (const entry of untar(decompressed)) {
		// skip directories
		if (entry.type !== 'file') {
			continue;
		}

		const path = toPackagePath(entry.name);
		if (path === null) {
			continue;
		}

		// count size from tar header for all files (including excluded ones)
		totalSize += entry.size;

		// check if file should be excluded (skip extraction but size already counted)
		if (exclude.some((pattern) => pattern.test(path))) {
			continue;
		}

		const content = await entry.bytes();
		const fullPath = `${destPath}/${path}`;

		// ensure parent directories exist
		const parentDir = fullPath.slice(0, fullPath.lastIndexOf('/'));
		volume.mkdirSync(parentDir, { recursive: true });

		volume.writeFileSync(fullPath, content);
	}

	return totalSize;
}
