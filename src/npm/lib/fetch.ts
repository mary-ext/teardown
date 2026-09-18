import { concat, equals } from '@atcute/uint8array';
import { untar } from '@mary/tar';
import type { Volume } from 'memfs';

import { FetchError, IntegrityError } from './errors';
import { retry } from './retry';

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
	/** expected SRI hashes, or undefined to skip verification */
	integrity: string | undefined;
	/** the destination path in the volume (e.g., "/node_modules/react") */
	destPath: string;
	/** regex patterns for files to skip */
	exclude: RegExp[];
}

/** SRI algorithms supported by WebCrypto, strongest first */
const INTEGRITY_ALGORITHMS = [
	['sha512', 'SHA-512'],
	['sha384', 'SHA-384'],
	['sha256', 'SHA-256'],
	['sha1', 'SHA-1'],
] as const;

/**
 * checks data against the strongest supported SRI algorithm.
 * @returns true if any hash for that algorithm matches, or no algorithm is supported
 */
const checkIntegrity = async (data: Uint8Array<ArrayBuffer>, integrity: string): Promise<boolean> => {
	// SRI tokens are `algorithm-digest[?options]`
	const hashes = integrity
		.trim()
		.split(/\s+/)
		.map((hash) => {
			const dash = hash.indexOf('-');
			return { prefix: hash.slice(0, dash), digest: hash.slice(dash + 1).split('?')[0]! };
		});

	const supported = INTEGRITY_ALGORITHMS.find(([prefix]) => hashes.some((hash) => hash.prefix === prefix));
	if (supported === undefined) {
		return true;
	}

	const [prefix, algorithm] = supported;
	const actual = new Uint8Array(await crypto.subtle.digest(algorithm, data));

	return hashes.some((hash) => {
		if (hash.prefix !== prefix) {
			return false;
		}

		try {
			return equals(
				Uint8Array.from(atob(hash.digest), (char) => char.charCodeAt(0)),
				actual,
			);
		} catch {
			return false;
		}
	});
};

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

const extractTarball = async (volume: Volume, { url, integrity, destPath, exclude }: TarballOptions) => {
	const response = await fetch(url);
	if (!response.ok) {
		throw new FetchError(url, response.status, response.statusText);
	}

	let body = response.body;
	if (!body) {
		throw new FetchError(url, 0, 'response has no body');
	}

	// WebCrypto needs the full compressed body. collect inline to preserve extraction backpressure;
	// tee() would let the download outpace extraction.
	const compressed: Uint8Array[] = [];
	if (integrity !== undefined) {
		body = body.pipeThrough(
			new TransformStream({
				transform(chunk, controller) {
					compressed.push(chunk);
					controller.enqueue(chunk);
				},
			}),
		);
	}

	// decompress gzip -> extract tar
	const decompressed = body.pipeThrough(new DecompressionStream('gzip'));

	// duplicate paths count only the last entry's size
	const sizes = new Map<string, number>();
	const createdDirs = new Set<string>();

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
		sizes.set(path, entry.size);

		// check if file should be excluded (skip extraction but size already counted)
		if (exclude.some((pattern) => pattern.test(path))) {
			continue;
		}

		const content = await entry.bytes();
		const fullPath = `${destPath}/${path}`;

		// ensure parent directories exist
		const parentDir = fullPath.slice(0, fullPath.lastIndexOf('/'));
		if (!createdDirs.has(parentDir)) {
			volume.mkdirSync(parentDir, { recursive: true });
			createdDirs.add(parentDir);
		}

		volume.writeFileSync(fullPath, content);
	}

	if (integrity !== undefined && !(await checkIntegrity(concat(compressed), integrity))) {
		throw new IntegrityError(url);
	}

	let totalSize = 0;
	for (const size of sizes.values()) {
		totalSize += size;
	}
	return totalSize;
};

/**
 * extracts a gzipped tarball into a volume, stripping its root folder and skipping unsafe paths.
 * retries transient failures. failed extraction or integrity checks may leave files in the volume.
 *
 * @param volume the volume to write to
 * @param options the tarball and where to extract it
 * @returns total file size in bytes, including excluded files; duplicate paths count the last entry
 * @throws {FetchError} if the tarball can't be fetched
 * @throws {IntegrityError} if the tarball doesn't match `options.integrity`
 */
export const fetchTarballToVolume = (volume: Volume, options: TarballOptions): Promise<number> => {
	// retries overwrite files left by earlier attempts
	return retry(() => extractTarball(volume, options));
};
