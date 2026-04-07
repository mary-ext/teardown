import { createComputed, createMemo, createSignal, untrack } from 'solid-js';

// #region types

export type QueryState = 'unresolved' | 'pending' | 'ready' | 'refreshing' | 'errored';

export interface QueryResource<T> {
	(): T | undefined;
	state: QueryState;
	loading: boolean;
	error: Error | undefined;
}

export interface QueryActions<T, R = unknown> {
	mutate: Setter<T | undefined>;
	refetch: (info?: R) => Promise<T | undefined> | T | undefined;
}

export type QueryReturn<T, R = unknown> = [QueryResource<T>, QueryActions<T, R>];

export type QuerySource<S> = S | false | null | undefined | (() => S | false | null | undefined);
export type QueryFetcher<S, T, R> = (source: S, info: ResourceFetcherInfo<T, R>) => T | Promise<T>;

export type ResourceFetcherInfo<T, R = unknown> = { value: T | undefined; refetching: R | boolean };

export interface QueryOptions<T> {
	initialValue?: T;
	/** keep previous data while loading new data (default: true) */
	keepPreviousData?: boolean;
}

type Setter<T> = (v: T | ((prev: T) => T)) => T;

// #endregion

// #region helpers

function isPromise<T>(v: unknown): v is Promise<T> {
	return v !== null && typeof v === 'object' && 'then' in v;
}

function castError(err: unknown): Error {
	if (err instanceof Error) {
		return err;
	}
	return new Error(typeof err === 'string' ? err : 'unknown error', { cause: err });
}

// #endregion

// #region createQuery

/**
 * creates a reactive query that fetches data based on a source signal.
 * similar to createResource but without Suspense integration (no throwing).
 *
 * @param source the source signal or value (false/null/undefined to skip fetching)
 * @param fetcher the async function to fetch data
 * @param options query options
 * @returns tuple of [resource, actions]
 */
export function createQuery<T, S = true, R = unknown>(
	source: QuerySource<S>,
	fetcher: QueryFetcher<S, T, R>,
	options?: QueryOptions<T>,
): QueryReturn<T, R>;
export function createQuery<T, R = unknown>(
	fetcher: QueryFetcher<true, T, R>,
	options?: QueryOptions<T>,
): QueryReturn<T, R>;
export function createQuery<T, S, R>(
	pSource: QuerySource<S> | QueryFetcher<S, T, R>,
	pFetcher?: QueryFetcher<S, T, R> | QueryOptions<T>,
	pOptions?: QueryOptions<T>,
): QueryReturn<T, R> {
	let source: QuerySource<S>;
	let fetcher: QueryFetcher<S, T, R>;
	let options: QueryOptions<T>;

	// normalize arguments
	if (typeof pFetcher === 'function') {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		source = pSource as QuerySource<S>;
		fetcher = pFetcher;
		options = pOptions || {};
	} else {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		source = true as QuerySource<S>;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		fetcher = pSource as QueryFetcher<S, T, R>;
		options = pFetcher || {};
	}

	let pr: Promise<T> | null = null;
	let scheduled = false;
	let resolved = 'initialValue' in options;

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const dynamic = typeof source === 'function' && createMemo(source as () => S | false | null | undefined);
	const [value, setValue] = createSignal(options.initialValue);
	const [error, setError] = createSignal<Error>();
	const [state, setState] = createSignal<QueryState>(resolved ? 'ready' : 'unresolved');

	function loadEnd(p: Promise<T> | null, v: T | undefined, err?: Error) {
		if (pr === p) {
			pr = null;
			if (err === undefined) {
				setValue(() => v);
				resolved = true;
			}
			setState(err !== undefined ? 'errored' : resolved ? 'ready' : 'unresolved');
			setError(err);
		}
		return v;
	}

	function read(): T | undefined {
		// no throwing - just return the value (or undefined if loading/errored)
		return value();
	}

	function load(refetching: R | boolean = true): Promise<T | undefined> | T | undefined {
		if (refetching !== false && scheduled) {
			return;
		}
		scheduled = false;

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const lookup = dynamic ? dynamic() : (source as S);

		if (lookup == null || lookup === false) {
			if (options.keepPreviousData === false) {
				resolved = false;
				loadEnd(pr, undefined);
			} else {
				loadEnd(pr, untrack(value));
			}
			return;
		}

		let fetchError: unknown;
		const p = untrack(() => {
			try {
				return fetcher(lookup, {
					value: value(),
					refetching,
				});
			} catch (e) {
				fetchError = e;
			}
		});

		if (fetchError !== undefined) {
			loadEnd(pr, undefined, castError(fetchError));
			return;
		} else if (!isPromise<T>(p)) {
			loadEnd(pr, p);
			return p;
		}

		pr = p;
		scheduled = true;
		queueMicrotask(() => (scheduled = false));

		if (options.keepPreviousData === false) {
			setValue(undefined);
			resolved = false;
		}

		setState(resolved ? 'refreshing' : 'pending');

		return p.then(
			(v) => loadEnd(p, v),
			(e) => loadEnd(p, undefined, castError(e)),
		);
	}

	// attach properties to read function
	Object.defineProperties(read, {
		state: { get: () => state() },
		error: { get: () => error() },
		loading: {
			get() {
				const s = state();
				return s === 'pending' || s === 'refreshing';
			},
		},
	});

	if (dynamic) {
		createComputed(() => load(false));
	} else {
		void load(false);
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return [read as QueryResource<T>, { refetch: load, mutate: setValue }];
}

// #endregion
