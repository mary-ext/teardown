import { getUtf8Length } from '@atcute/uint8array';
import { rolldown } from '@rolldown/browser';
import { memfs } from '@rolldown/browser/experimental';

import { BundleError } from './errors';
import { progress } from './events';

const { volume } = memfs!;

// #region types

/**
 * options for bundling.
 */
export interface BundleOptions {
	/** additional rolldown options */
	rolldown?: {
		/** external packages to exclude from bundle */
		external?: string[];
		/** whether to minify */
		minify?: boolean;
	};
}

/**
 * a bundled chunk.
 */
export interface BundleChunk {
	/** chunk filename */
	fileName: string;
	/** the bundled code */
	code: string;
	/** raw size in bytes */
	size: number;
	/** gzipped size in bytes */
	gzipSize: number;
	/** brotli size in bytes, if supported */
	brotliSize?: number;
	/** whether this is the entry chunk */
	isEntry: boolean;
	/** exported names from this chunk */
	exports: string[];
}

/**
 * result of bundling a package.
 */
export interface BundleResult {
	/** all output chunks */
	chunks: BundleChunk[];
	/** total raw size in bytes (all chunks) */
	size: number;
	/** total gzipped size in bytes (all chunks) */
	gzipSize: number;
	/** total brotli size in bytes (all chunks), if supported */
	brotliSize?: number;
	/** exported names from the entry chunk */
	exports: string[];
}

// #endregion

// #region helpers

const VIRTUAL_ENTRY_ID = '\0virtual:entry';

/**
 * checks if a file likely has a default export.
 * looks for common patterns in ESM and CJS.
 */
function hasDefaultExport(source: string): boolean {
	// ESM patterns
	if (/\bexport\s+default\b/.test(source)) {
		return true;
	}
	if (/\bexport\s*\{\s*[^}]*\bdefault\b/.test(source)) {
		return true;
	}
	// CJS patterns (bundlers typically convert these to default exports)
	if (/\bmodule\.exports\s*=/.test(source)) {
		return true;
	}
	if (/\bexports\.default\s*=/.test(source)) {
		return true;
	}
	return false;
}

/**
 * creates a virtual entry point that imports and re-exports from a specific subpath.
 *
 * @param packageName the package name
 * @param subpath the export subpath (e.g., ".", "./utils")
 * @param selectedExports list of specific exports to include, or null for all
 * @param includeDefault whether to include default export (only used when selectedExports is null)
 * @returns the entry point code
 */
function createVirtualEntry(
	packageName: string,
	subpath: string,
	selectedExports: string[] | null,
	includeDefault: boolean,
): string {
	const importPath = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;

	if (selectedExports === null) {
		// re-export everything
		let code = `export * from '${importPath}';\n`;
		if (includeDefault) {
			code += `export { default } from '${importPath}';\n`;
		}
		return code;
	}

	// specific exports selected (empty array = export nothing)
	// quote names to handle non-identifier exports
	const quoted = selectedExports.map((e) => JSON.stringify(e));
	return `export { ${quoted.join(', ')} } from '${importPath}';\n`;
}

/**
 * get compressed size using a compression stream.
 */
async function getCompressedSize(code: string, format: CompressionFormat): Promise<number> {
	const stream = new Blob([code]).stream();
	const compressed = stream.pipeThrough(new CompressionStream(format));
	const reader = compressed.getReader();

	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		size += value.byteLength;
	}

	return size;
}

/**
 * get gzip size using compression stream.
 */
async function getGzipSize(code: string): Promise<number> {
	return getCompressedSize(code, 'gzip');
}

/**
 * whether brotli compression is supported.
 * - `undefined`: not yet checked
 * - `true`: supported
 * - `false`: not supported
 */
export let isBrotliSupported: boolean | undefined;

/**
 * get brotli size using compression stream, if supported.
 * returns `undefined` if brotli is not supported by the browser.
 */
export async function getBrotliSize(code: string): Promise<number | undefined> {
	if (isBrotliSupported === false) {
		return undefined;
	}

	if (isBrotliSupported === undefined) {
		try {
			// @ts-expect-error 'br' is not in the type definition yet
			const size = await getCompressedSize(code, 'br');
			isBrotliSupported = true;
			return size;
		} catch {
			isBrotliSupported = false;
			return undefined;
		}
	}

	// @ts-expect-error 'br' is not in the type definition yet
	return getCompressedSize(code, 'br');
}

// #endregion

// #region core

/**
 * bundles a subpath from a package that's already loaded in rolldown's memfs.
 *
 * @param packageName the package name (e.g., "react")
 * @param subpath the export subpath to bundle (e.g., ".", "./utils")
 * @param selectedExports specific exports to include, or null for all
 * @param options bundling options
 * @returns bundle result with chunks, sizes, and exported names
 */
export async function bundlePackage(
	packageName: string,
	subpath: string,
	selectedExports: string[] | null,
	options: BundleOptions,
): Promise<BundleResult> {
	// bundle with rolldown
	const bundle = await rolldown({
		input: { main: VIRTUAL_ENTRY_ID },
		cwd: '/',
		external: options.rolldown?.external,
		plugins: [
			{
				name: 'virtual-entry',
				resolveId(id: string) {
					if (id === VIRTUAL_ENTRY_ID) {
						return id;
					}
				},
				async load(id: string) {
					if (id !== VIRTUAL_ENTRY_ID) {
						return;
					}

					// check if the module has a default export
					let includeDefault = false;
					if (selectedExports === null) {
						const importPath = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;
						const resolved = await this.resolve(importPath);

						if (resolved) {
							try {
								const source = volume.readFileSync(resolved.id, 'utf8') as string;
								includeDefault = hasDefaultExport(source);
							} catch {
								// couldn't read file, skip default export
							}
						}
					}

					return createVirtualEntry(packageName, subpath, selectedExports, includeDefault);
				},
			},
		],
	});

	const output = await bundle.generate({
		format: 'esm',
		minify: options.rolldown?.minify ?? true,
	});

	// process all chunks
	const rawChunks = output.output.filter((o) => o.type === 'chunk');

	progress.emit({ type: 'progress', kind: 'compress' });

	const chunks: BundleChunk[] = await Promise.all(
		rawChunks.map(async (chunk) => {
			const code = chunk.code;
			const size = getUtf8Length(code);
			const [gzipSize, brotliSize] = await Promise.all([getGzipSize(code), getBrotliSize(code)]);

			return {
				fileName: chunk.fileName,
				code,
				size,
				gzipSize,
				brotliSize,
				isEntry: chunk.isEntry,
				exports: chunk.exports || [],
			};
		}),
	);

	// find entry chunk for exports
	const entryChunk = chunks.find((c) => c.isEntry);
	if (!entryChunk) {
		throw new BundleError('no entry chunk found in bundle output');
	}

	// aggregate sizes
	const totalSize = chunks.reduce((acc, c) => acc + c.size, 0);
	const totalGzipSize = chunks.reduce((acc, c) => acc + c.gzipSize, 0);
	const totalBrotliSize = isBrotliSupported ? chunks.reduce((acc, c) => acc + c.brotliSize!, 0) : undefined;

	await bundle.close();

	return {
		chunks,
		size: totalSize,
		gzipSize: totalGzipSize,
		brotliSize: totalBrotliSize,
		exports: entryChunk.exports,
	};
}

// #endregion
