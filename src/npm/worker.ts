import { memfs } from '@rolldown/browser/experimental';
import * as v from 'valibot';

import { bundlePackage, type BundleOptions } from './bundler';
import { progress } from './events';
import { fetchPackagesToVolume } from './fetch';
import { hoist } from './hoist';
import { resolve } from './resolve';
import { discoverSubpaths } from './subpaths';
import type { HoistedNode, HoistedResult, PackageJson, ResolvedPackage } from './types';
import {
	workerRequestSchema,
	type InitOptions,
	type InitResult,
	type InstalledPackage,
	type WorkerResponse,
} from './worker-protocol';

const { volume } = memfs!;

// forward progress events to main thread
progress.listen((msg) => {
	self.postMessage(msg satisfies WorkerResponse);
});

// #region helpers

function computePackageLevels(roots: ResolvedPackage[]): Map<string, number> {
	const levels = new Map<string, number>();
	const visited = new Set<string>();

	function walk(pkg: ResolvedPackage, level: number): void {
		const key = `${pkg.name}@${pkg.version}`;

		const existingLevel = levels.get(key);
		if (existingLevel === undefined || level < existingLevel) {
			levels.set(key, level);
		}

		if (visited.has(key)) {
			return;
		}
		visited.add(key);

		for (const dep of pkg.dependencies.values()) {
			walk(dep, level + 1);
		}

		visited.delete(key);
	}

	for (const root of roots) {
		walk(root, 0);
	}

	return levels;
}

function buildInstalledPackages(
	hoisted: HoistedResult,
	packageLevels: Map<string, number>,
): InstalledPackage[] {
	const packages: InstalledPackage[] = [];
	const installedByCount = new Map<string, number>();

	function collectPackages(nodes: Map<string, HoistedNode>, basePath: string): void {
		for (const node of nodes.values()) {
			const path = `${basePath}/${node.name}`;
			const key = `${node.name}@${node.version}`;

			packages.push({
				name: node.name,
				version: node.version,
				size: node.unpackedSize ?? 0,
				path,
				level: packageLevels.get(key) ?? 0,
				installedBy: 0,
				dependencyCount: node.dependencyCount,
				description: node.description,
				license: node.license,
			});

			for (const nested of node.nested.values()) {
				const nestedKey = `${nested.name}@${nested.version}`;
				installedByCount.set(nestedKey, (installedByCount.get(nestedKey) ?? 0) + 1);
			}

			if (node.nested.size > 0) {
				collectPackages(node.nested, `${path}/node_modules`);
			}
		}
	}

	for (const node of hoisted.root.values()) {
		const key = `${node.name}@${node.version}`;
		installedByCount.set(key, (installedByCount.get(key) ?? 0) + 1);
	}

	collectPackages(hoisted.root, 'node_modules');

	for (const pkg of packages) {
		const key = `${pkg.name}@${pkg.version}`;
		pkg.installedBy = installedByCount.get(key) ?? 0;
	}

	return packages;
}

// #endregion

// #region state

let packageName: string | null = null;
let initResult: InitResult | null = null;

let bundleInProgress = false;
let pendingBundleRequest: {
	id: number;
	subpath: string;
	selectedExports: string[] | null;
	options: BundleOptions;
} | null = null;

// #endregion

// #region handlers

async function handleInit(id: number, packageSpec: string, options: InitOptions = {}): Promise<void> {
	// if already initialized, return cached result
	if (initResult !== null) {
		self.postMessage({ id, type: 'init', result: initResult } satisfies WorkerResponse);
		return;
	}

	try {
		volume.reset();

		const resolution = await resolve([packageSpec], options.resolve);
		const hoisted = hoist(resolution.roots);

		await fetchPackagesToVolume(hoisted, volume, options.fetch);

		const mainPackage = resolution.roots[0];
		const pkgJsonPath = `/node_modules/${mainPackage.name}/package.json`;
		const pkgJsonContent = volume.readFileSync(pkgJsonPath, 'utf8') as string;
		const manifest = JSON.parse(pkgJsonContent) as PackageJson;

		packageName = mainPackage.name;

		const subpaths = discoverSubpaths(manifest, volume);

		const packageLevels = computePackageLevels(resolution.roots);
		const packages = buildInstalledPackages(hoisted, packageLevels);
		const installSize = packages.reduce((sum, pkg) => sum + pkg.size, 0);

		initResult = {
			name: mainPackage.name,
			version: mainPackage.version,
			subpaths,
			installSize,
			packages,
		};

		self.postMessage({ id, type: 'init', result: initResult } satisfies WorkerResponse);
	} catch (error) {
		self.postMessage({ id, type: 'error', error: String(error) } satisfies WorkerResponse);
	}
}

async function handleBundle(
	id: number,
	subpath: string,
	selectedExports: string[] | null,
	options: BundleOptions = {},
): Promise<void> {
	if (!packageName) {
		self.postMessage({
			id,
			type: 'error',
			error: 'not initialized - call init() first',
		} satisfies WorkerResponse);
		return;
	}

	// if a bundle is in progress, queue this one (replacing any previous pending)
	if (bundleInProgress) {
		// reject the previous pending request if any
		if (pendingBundleRequest) {
			self.postMessage({
				id: pendingBundleRequest.id,
				type: 'error',
				error: 'Superseded by newer request',
			} satisfies WorkerResponse);
		}
		pendingBundleRequest = { id, subpath, selectedExports, options };
		return;
	}

	await processBundleRequest(id, subpath, selectedExports, options);
}

async function processBundleRequest(
	id: number,
	subpath: string,
	selectedExports: string[] | null,
	options: BundleOptions,
): Promise<void> {
	bundleInProgress = true;

	try {
		const result = await bundlePackage(packageName!, subpath, selectedExports, options);
		self.postMessage({ id, type: 'bundle', result } satisfies WorkerResponse);
	} catch (error) {
		self.postMessage({ id, type: 'error', error: String(error) } satisfies WorkerResponse);
	} finally {
		bundleInProgress = false;

		// process pending request if any
		if (pendingBundleRequest) {
			const pending = pendingBundleRequest;
			pendingBundleRequest = null;
			await processBundleRequest(pending.id, pending.subpath, pending.selectedExports, pending.options);
		}
	}
}

// #endregion

// #region message handler

self.onmessage = (event: MessageEvent<unknown>) => {
	const parsed = v.safeParse(workerRequestSchema, event.data);
	if (!parsed.success) {
		console.error('[worker] invalid request:', parsed.issues);
		return;
	}

	const request = parsed.output;

	switch (request.type) {
		case 'init':
			handleInit(request.id, request.packageSpec, request.options);
			break;
		case 'bundle':
			handleBundle(request.id, request.subpath, request.selectedExports, request.options);
			break;
	}
};

// signal to main thread that we're ready
self.postMessage({ type: 'ready' });

// #endregion
