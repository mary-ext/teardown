import * as v from 'valibot';

import { progress } from './events';
import {
	workerResponseSchema,
	type BundleOptions,
	type BundleResult,
	type InitOptions,
	type InitResult,
	type WorkerRequest,
} from './types';

export type { InitResult };

/**
 * a session for working with a package.
 * holds the worker and initialization result.
 */
export interface PackageSession extends InitResult {
	/** the worker instance for this session */
	worker: BundlerWorker;
}

/**
 * client for communicating with a bundler worker.
 * each instance spawns a new worker, intended for one package.
 */
export class BundlerWorker {
	private worker: Worker;
	private nextId = 0;
	private pending = new Map<number, PromiseWithResolvers<unknown>>();
	private ready: Promise<void>;
	private resolveReady!: () => void;

	constructor() {
		this.ready = new Promise((resolve) => {
			this.resolveReady = resolve;
		});

		this.worker = new Worker(new URL('./lib/worker-entry.ts', import.meta.url), { type: 'module' });
		this.worker.onmessage = this.handleMessage.bind(this);
		this.worker.onerror = this.handleError.bind(this);
	}

	private handleMessage(event: MessageEvent<unknown>): void {
		const parsed = v.safeParse(workerResponseSchema, event.data);
		if (!parsed.success) {
			console.error('[worker-client] invalid response:', parsed.issues, event.data);
			return;
		}

		const response = parsed.output;

		if (response.type === 'ready') {
			console.log('[worker-client] received ready signal');
			this.resolveReady();
			return;
		}

		// forward progress messages to global emitter
		if (response.type === 'progress') {
			progress.emit(response);
			return;
		}

		const deferred = this.pending.get(response.id);
		if (!deferred) {
			// response for a request we no longer care about (e.g., superseded bundle)
			return;
		}

		this.pending.delete(response.id);

		if (response.type === 'error') {
			deferred.reject(new Error(response.error));
		} else {
			deferred.resolve(response.result);
		}
	}

	private handleError(event: ErrorEvent): void {
		console.error('[worker-client] worker error:', event);
		// reject all pending requests
		for (const deferred of this.pending.values()) {
			deferred.reject(new Error('Worker error'));
		}
		this.pending.clear();
	}

	private async send<T>(message: WorkerRequest): Promise<T> {
		// wait for worker to be ready before sending
		await this.ready;

		const deferred = Promise.withResolvers<T>();
		this.pending.set(message.id, deferred as PromiseWithResolvers<unknown>);
		console.log('[worker-client] posting message:', message);
		this.worker.postMessage(message);
		return deferred.promise;
	}

	/**
	 * initializes the worker with a package.
	 * only the first call does work; subsequent calls return cached result.
	 */
	init(packageSpec: string, options?: InitOptions): Promise<InitResult> {
		return this.send<InitResult>({ id: this.nextId++, type: 'init', packageSpec, options });
	}

	/**
	 * bundles a subpath from the initialized package.
	 * uses "latest wins" - if called while a bundle is in progress,
	 * the previous pending request is superseded.
	 */
	bundle(subpath: string, selectedExports: string[] | null, options?: BundleOptions): Promise<BundleResult> {
		return this.send<BundleResult>({ id: this.nextId++, type: 'bundle', subpath, selectedExports, options });
	}

	/**
	 * terminates the worker.
	 */
	terminate(): void {
		this.worker.terminate();
		for (const deferred of this.pending.values()) {
			deferred.reject(new DOMException('Worker terminated', 'AbortError'));
		}
		this.pending.clear();
	}
}

/**
 * creates a new worker and initializes it with a package.
 * if initialization fails, the worker is terminated.
 *
 * @param packageSpec package specifier (e.g., "react@^18.0.0")
 * @param options initialization options
 * @returns session containing the worker and init result
 */
export async function initPackage(packageSpec: string, options?: InitOptions): Promise<PackageSession> {
	const worker = new BundlerWorker();
	try {
		const result = await worker.init(packageSpec, options);
		return { worker, ...result };
	} catch (error) {
		worker.terminate();
		throw error;
	}
}
