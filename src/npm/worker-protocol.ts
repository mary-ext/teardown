import * as v from 'valibot';

// #region option schemas

const resolveOptionsSchema = v.object({
	installPeers: v.optional(v.boolean()),
});

const fetchOptionsSchema = v.object({
	concurrency: v.optional(v.number()),
	exclude: v.optional(v.array(v.instance(RegExp))),
});

const initOptionsSchema = v.object({
	resolve: v.optional(resolveOptionsSchema),
	fetch: v.optional(fetchOptionsSchema),
});

const bundleOptionsSchema = v.object({
	rolldown: v.optional(
		v.object({
			external: v.optional(v.array(v.string())),
			minify: v.optional(v.boolean()),
		}),
	),
});

// #endregion

// #region result schemas

const subpathSchema = v.object({
	subpath: v.string(),
	target: v.string(),
	isWildcard: v.boolean(),
});

const discoveredSubpathsSchema = v.object({
	subpaths: v.array(subpathSchema),
	defaultSubpath: v.nullable(v.string()),
});

const installedPackageSchema = v.object({
	name: v.string(),
	version: v.string(),
	size: v.number(),
	path: v.string(),
	level: v.number(),
	installedBy: v.number(),
	dependencyCount: v.number(),
	description: v.optional(v.string()),
	license: v.optional(v.string()),
	isPeer: v.boolean(),
});

const initResultSchema = v.object({
	name: v.string(),
	version: v.string(),
	subpaths: discoveredSubpathsSchema,
	installSize: v.number(),
	packages: v.array(installedPackageSchema),
	peerDependencies: v.array(v.string()),
});

const bundleChunkSchema = v.object({
	fileName: v.string(),
	code: v.string(),
	size: v.number(),
	gzipSize: v.number(),
	brotliSize: v.optional(v.number()),
	isEntry: v.boolean(),
	exports: v.array(v.string()),
});

const bundleResultSchema = v.object({
	chunks: v.array(bundleChunkSchema),
	size: v.number(),
	gzipSize: v.number(),
	brotliSize: v.optional(v.number()),
	exports: v.array(v.string()),
	isCjs: v.boolean(),
});

// #endregion

// #region request schemas (worker parses these)

const initRequestSchema = v.object({
	id: v.number(),
	type: v.literal('init'),
	packageSpec: v.string(),
	options: v.optional(initOptionsSchema),
});

const bundleRequestSchema = v.object({
	id: v.number(),
	type: v.literal('bundle'),
	subpath: v.string(),
	selectedExports: v.nullable(v.array(v.string())),
	options: v.optional(bundleOptionsSchema),
});

export const workerRequestSchema = v.variant('type', [initRequestSchema, bundleRequestSchema]);

export type WorkerRequest = v.InferOutput<typeof workerRequestSchema>;

// #endregion

// #region response schemas (main thread parses these)

const initResponseSchema = v.object({
	id: v.number(),
	type: v.literal('init'),
	result: initResultSchema,
});

const bundleResponseSchema = v.object({
	id: v.number(),
	type: v.literal('bundle'),
	result: bundleResultSchema,
});

const errorResponseSchema = v.object({
	id: v.number(),
	type: v.literal('error'),
	error: v.string(),
});

const progressResponseSchema = v.variant('kind', [
	v.object({
		type: v.literal('progress'),
		kind: v.literal('resolve'),
		name: v.string(),
		version: v.string(),
	}),
	v.object({
		type: v.literal('progress'),
		kind: v.literal('fetch'),
		current: v.number(),
		total: v.number(),
		name: v.string(),
	}),
	v.object({
		type: v.literal('progress'),
		kind: v.literal('bundle'),
	}),
	v.object({
		type: v.literal('progress'),
		kind: v.literal('compress'),
	}),
]);

export const workerResponseSchema = v.variant('type', [
	initResponseSchema,
	bundleResponseSchema,
	errorResponseSchema,
	progressResponseSchema,
]);

export type ProgressMessage = v.InferOutput<typeof progressResponseSchema>;
export type WorkerResponse = v.InferOutput<typeof workerResponseSchema>;

// re-export inferred types for convenience
export type InitOptions = v.InferOutput<typeof initOptionsSchema>;
export type InitResult = v.InferOutput<typeof initResultSchema>;
export type InstalledPackage = v.InferOutput<typeof installedPackageSchema>;

// #endregion
