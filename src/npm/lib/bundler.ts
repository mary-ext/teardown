import { encodeUtf8 } from '@atcute/uint8array';
import { rolldown } from '@rolldown/browser';
import { memfs } from '@rolldown/browser/experimental';

import { progress } from '../events';
import type { Attribution, BundleAsset, BundleChunk, BundleOptions, BundleResult } from '../types';

import { attributeExports, type ModuleCost } from './attribution';
import { BundleError } from './errors';
import { type ExportOrigin, type ModuleReader, resolveExportOrigins } from './export-origin';
import { analyzeModule, type ModuleType } from './module-type';

const { volume } = memfs!;

// #region helpers

const VIRTUAL_ENTRY_ID = '\0virtual:entry';

/**
 * get compressed size of raw bytes using a compression stream.
 */
async function getCompressedSizeFromBytes(data: Uint8Array, format: CompressionFormat): Promise<number> {
	const { readable, writable } = new CompressionStream(format);

	{
		const writer = writable.getWriter();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		void writer.write(data as Uint8Array<ArrayBuffer>);
		void writer.close();
	}

	let size = 0;
	{
		const reader = readable.getReader();
		while (true) {
			// oxlint-disable-next-line no-await-in-loop
			const { done, value: chunk } = await reader.read();
			if (done) {
				break;
			}

			size += chunk.byteLength;
		}
	}

	return size;
}

/**
 * get gzip size of raw bytes.
 */
function getGzipSizeFromBytes(data: Uint8Array): Promise<number> {
	return getCompressedSizeFromBytes(data, 'gzip');
}

/**
 * whether brotli compression is supported.
 * - `undefined`: not yet checked
 * - `true`: supported
 * - `false`: not supported
 */
let isBrotliSupported: boolean | undefined;

/**
 * get brotli size of raw bytes, if supported.
 * returns `undefined` if brotli is not supported by the browser.
 */
async function getBrotliSizeFromBytes(data: Uint8Array): Promise<number | undefined> {
	if (isBrotliSupported === false) {
		return undefined;
	}

	if (isBrotliSupported === undefined) {
		try {
			// @ts-expect-error 'brotli' is not in the type definition yet
			const size = await getCompressedSizeFromBytes(data, 'brotli');
			console.log(`[worker] brotli supported`);
			isBrotliSupported = true;
			return size;
		} catch {
			console.log(`[worker] brotli not supported`);
			isBrotliSupported = false;
			return undefined;
		}
	}

	// @ts-expect-error 'brotli' is not in the type definition yet
	return getCompressedSizeFromBytes(data, 'brotli');
}

/**
 * whether native zstd compression is supported.
 * - `undefined`: not yet checked
 * - `true`: supported
 * - `false`: not supported (will try WASM fallback)
 */
let isZstdSupported: boolean | undefined;

/**
 * zstd-wasm module state.
 * - `undefined`: not yet loaded
 * - `null`: failed to load
 * - module: loaded and ready
 */
let zstdWasm: typeof import('@bokuweb/zstd-wasm') | null | undefined;

/**
 * get zstd-compressed size of raw bytes using WASM fallback.
 * returns `undefined` if WASM failed to load.
 */
async function getZstdSizeWasmFromBytes(data: Uint8Array): Promise<number | undefined> {
	if (zstdWasm === null) {
		return undefined;
	}

	if (zstdWasm === undefined) {
		try {
			zstdWasm = await import('@bokuweb/zstd-wasm');
			await zstdWasm.init();
			console.log(`[worker] zstd-wasm initialized`);
		} catch {
			console.log(`[worker] zstd-wasm failed to load`);
			zstdWasm = null;
			return undefined;
		}
	}

	const compressed = zstdWasm.compress(data);

	return compressed.byteLength;
}

/**
 * get zstd size of raw bytes using compression stream if supported, or WASM fallback.
 * returns `undefined` if neither native nor WASM is available.
 */
async function getZstdSizeFromBytes(data: Uint8Array): Promise<number | undefined> {
	// use WASM fallback if native is known to be unsupported
	if (isZstdSupported === false) {
		return getZstdSizeWasmFromBytes(data);
	}

	if (isZstdSupported === undefined) {
		try {
			// @ts-expect-error 'zstd' is not in the type definition yet
			const size = await getCompressedSizeFromBytes(data, 'zstd');
			console.log(`[worker] zstd supported`);
			isZstdSupported = true;
			return size;
		} catch {
			console.log(`[worker] zstd not supported, trying wasm fallback`);
			isZstdSupported = false;
			return getZstdSizeWasmFromBytes(data);
		}
	}

	// @ts-expect-error 'zstd' is not in the type definition yet
	return getCompressedSizeFromBytes(data, 'zstd');
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
	// module format of the entry, detected in the load hook
	let moduleType: ModuleType = 'unknown';

	// per-export attribution state, populated only when requested (set in load/buildEnd hooks)
	const attribute = options.attribute ?? false;
	const graph = new Map<string, string[]>();
	let resolvedEntryId: string | null = null;
	let origins: Map<string, ExportOrigin> | undefined;

	// bundle with rolldown
	const bundle = await rolldown({
		input: { main: VIRTUAL_ENTRY_ID },
		cwd: '/',
		external: options.rolldown?.external,
		experimental: { resolveNewUrlToAsset: true },
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

					const importPath = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;

					// resolve the entry module
					const resolved = await this.resolve(importPath);
					if (!resolved) {
						throw new BundleError(`failed to resolve entry module: ${importPath}`);
					}
					resolvedEntryId = resolved.id;

					// JSON files only have a default export
					if (resolved.id.endsWith('.json')) {
						return `export { default } from '${importPath}';\n`;
					}

					// read the source file
					let source: string;
					try {
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion
						source = volume.readFileSync(resolved.id, 'utf8') as string;
					} catch {
						throw new BundleError(`failed to read entry module: ${resolved.id}`);
					}

					// parse and analyze the module
					let ast;
					try {
						ast = this.parse(source);
					} catch {
						throw new BundleError(`failed to parse entry module: ${resolved.id}`);
					}

					const moduleInfo = analyzeModule(ast);
					moduleType = moduleInfo.type;

					// CJS and UMD bundles can't be tree-shaken; measure the whole module via its
					// default export rather than emitting an empty re-export
					if (moduleType === 'cjs' || moduleType === 'umd') {
						return `export { default } from '${importPath}';\n`;
					}

					// unknown/side-effects only modules have no exports
					if (moduleType === 'unknown') {
						return `export {} from '${importPath}';\n`;
					}

					// ESM module handling
					if (selectedExports === null) {
						// re-export everything
						let code = `export * from '${importPath}';\n`;
						if (moduleInfo.hasDefaultExport) {
							code += `export { default } from '${importPath}';\n`;
						}
						return code;
					}

					// specific exports selected (empty array = export nothing)
					// quote names to handle non-identifier exports
					const quoted = selectedExports.map((e) => JSON.stringify(e));
					return `export { ${quoted.join(', ')} } from '${importPath}';\n`;
				},
				// snapshot the module graph and trace export origins for attribution.
				// runs in buildEnd where the full graph and the resolver are both available.
				async buildEnd() {
					if (!attribute || moduleType !== 'esm' || resolvedEntryId === null) {
						return;
					}

					for (const id of this.getModuleIds()) {
						const info = this.getModuleInfo(id);
						if (info) {
							graph.set(id, [...info.importedIds, ...info.dynamicallyImportedIds]);
						}
					}

					// for an all-exports bundle, the resolved name set lives on the virtual entry
					const names = selectedExports ?? this.getModuleInfo(VIRTUAL_ENTRY_ID)?.exports ?? [];
					const reader: ModuleReader = {
						parse: (source) => this.parse(source),
						readFile: (id) => {
							try {
								// oxlint-disable-next-line typescript/no-unsafe-type-assertion
								return volume.readFileSync(id, 'utf8') as string;
							} catch {
								return null;
							}
						},
						resolve: async (specifier, importer) => {
							const result = await this.resolve(specifier, importer);
							return result?.id ?? null;
						},
					};

					origins = await resolveExportOrigins(reader, resolvedEntryId, names);
				},
			},
		],
	});

	const output = await bundle.generate({
		format: 'esm',
		// per-module `code` is pre-minify, so attribution needs an unminified chunk to
		// share the same byte basis; the headline size still comes from the normal pass
		minify: attribute ? false : (options.rolldown?.minify ?? true),
	});

	// split output into chunks and assets
	const rawChunks = output.output.filter((o) => o.type === 'chunk');
	const rawAssets = output.output.filter((o) => o.type === 'asset');

	progress.emit({ type: 'progress', kind: 'compress' });

	const chunks: BundleChunk[] = await Promise.all(
		rawChunks.map(async (chunk) => {
			const bytes = encodeUtf8(chunk.code);
			const size = bytes.byteLength;
			const [gzipSize, brotliSize, zstdSize] = await Promise.all([
				getGzipSizeFromBytes(bytes),
				getBrotliSizeFromBytes(bytes),
				getZstdSizeFromBytes(bytes),
			]);

			return {
				type: 'chunk' as const,
				filename: chunk.fileName,
				size,
				gzipSize,
				brotliSize,
				zstdSize,
				isEntry: chunk.isEntry,
			};
		}),
	);

	const assets: BundleAsset[] = await Promise.all(
		rawAssets.map(async (asset) => {
			const raw = typeof asset.source === 'string' ? encodeUtf8(asset.source) : asset.source;
			// rolldown uses SharedArrayBuffer for WASM memory; CompressionStream rejects
			// views backed by shared buffers, so copy into a regular ArrayBuffer
			const data = raw.buffer instanceof SharedArrayBuffer ? raw.slice() : raw;
			const size = data.byteLength;
			const [gzipSize, brotliSize, zstdSize] = await Promise.all([
				getGzipSizeFromBytes(data),
				getBrotliSizeFromBytes(data),
				getZstdSizeFromBytes(data),
			]);

			return {
				type: 'asset' as const,
				filename: asset.fileName,
				size,
				gzipSize,
				brotliSize,
				zstdSize,
			};
		}),
	);

	// find entry chunk for exports
	const entryChunk = rawChunks.find((c) => c.isEntry);
	if (!entryChunk) {
		throw new BundleError('no entry chunk found in bundle output');
	}

	await bundle.close();

	// attribute the measured bytes across exports using the traced origins + graph.
	// `origins` is only populated in buildEnd for ESM entries, so it gates this implicitly.
	let attribution: Attribution | undefined;
	if (attribute && origins) {
		const moduleCosts = new Map<string, ModuleCost>();
		for (const chunk of rawChunks) {
			for (const [id, rendered] of Object.entries(chunk.modules)) {
				const bytes = rendered.code !== null ? encodeUtf8(rendered.code).byteLength : 0;
				const prev = moduleCosts.get(id);
				// a module shown in the entry chunk counts as initial, even if also split out
				moduleCosts.set(id, {
					async: (prev?.async ?? true) && !chunk.isEntry,
					bytes: (prev?.bytes ?? 0) + bytes,
				});
			}
		}

		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
		attribution = attributeExports({ graph, moduleCosts, origins, totalBytes });
	}

	return {
		attribution,
		output: [...chunks, ...assets],
		exports: entryChunk.exports || [],
		moduleType,
	};
}

// #endregion
