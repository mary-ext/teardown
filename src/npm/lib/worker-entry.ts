import { memfs } from '@rolldown/browser/experimental';
import * as v from 'valibot';

import { stripAnsi } from '../../lib/strings';
import { progress } from '../events';
import {
	workerRequestSchema,
	type BundleOptions,
	type InitOptions,
	type InitResult,
	type WorkerResponse,
} from '../types';

import { bundlePackage } from './bundler';
import { install, type InstallCounts } from './install';
import { buildInstalledPackages } from './installed-packages';
import { discoverSubpaths } from './subpaths';
import type { PackageJson } from './types';

const { volume } = memfs!;

/** minimum interval between install progress messages, in milliseconds */
const PROGRESS_INTERVAL = 100;

// forward progress events to main thread
progress.listen((msg) => {
	self.postMessage(msg);
});

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
	// throttle worker messages to limit UI updates
	let done = false;
	let latest: InstallCounts | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		timer = undefined;
		if (latest !== null) {
			progress.emit({ type: 'progress', kind: 'install', ...latest });
			latest = null;
			timer = setTimeout(flush, PROGRESS_INTERVAL);
		}
	};

	try {
		volume.reset();

		const { resolution, layout } = await install([packageSpec], volume, {
			...options,
			onProgress(counts) {
				// in-flight fetches keep reporting after a failed install
				if (done) {
					return;
				}
				latest = counts;
				if (timer === undefined) {
					flush();
				}
			},
		});

		const mainPackage = resolution.roots[0]!;
		const pkgJsonPath = `/node_modules/${mainPackage.name}/package.json`;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const pkgJsonContent = volume.readFileSync(pkgJsonPath, 'utf8') as string;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const manifest = JSON.parse(pkgJsonContent) as PackageJson;

		packageName = mainPackage.name;

		const subpaths = discoverSubpaths(manifest, volume);

		// include extension-added peers and peers also declared as regular dependencies
		const peerDepNames = new Set([...Object.keys(manifest.peerDependencies ?? {}), ...mainPackage.peers]);
		const peerDependencies = [...peerDepNames];

		const packages = buildInstalledPackages(layout, mainPackage.name, peerDepNames);
		const installSize = packages.reduce((sum, pkg) => sum + pkg.size, 0);

		initResult = {
			name: mainPackage.name,
			version: mainPackage.version,
			description: manifest.description,
			subpaths,
			installSize,
			packages,
			peerDependencies,
		};

		const event = {
			id,
			type: 'init',
			result: initResult,
		} satisfies WorkerResponse;

		self.postMessage(event);
	} catch (error) {
		console.error('[worker] init error:', error);

		const event = {
			id,
			type: 'error',
			error: stripAnsi(String(error)),
		} satisfies WorkerResponse;

		self.postMessage(event);
	} finally {
		done = true;
		clearTimeout(timer);
	}
}

async function handleBundle(
	id: number,
	subpath: string,
	selectedExports: string[] | null,
	options: BundleOptions = {},
): Promise<void> {
	if (!packageName) {
		const event = {
			id,
			type: 'error',
			error: 'not initialized - call init() first',
		} satisfies WorkerResponse;

		self.postMessage(event);
		return;
	}

	// if a bundle is in progress, queue this one (replacing any previous pending)
	if (bundleInProgress) {
		// reject the previous pending request if any
		if (pendingBundleRequest) {
			const event = {
				id: pendingBundleRequest.id,
				type: 'error',
				error: 'Superseded by newer request',
			} satisfies WorkerResponse;

			self.postMessage(event);
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
		console.error('[worker] bundle error:', error);
		self.postMessage({ id, type: 'error', error: stripAnsi(String(error)) } satisfies WorkerResponse);
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
		case 'init': {
			void handleInit(request.id, request.packageSpec, request.options);
			break;
		}
		case 'bundle': {
			void handleBundle(request.id, request.subpath, request.selectedExports, request.options);
			break;
		}
	}
};

// signal to main thread that we're ready
self.postMessage({ type: 'ready' } satisfies WorkerResponse);

// #endregion
