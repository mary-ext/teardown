import { createEffect, createMemo, createSignal, onCleanup, type Accessor, type Signal } from 'solid-js';

/**
 * creates a signal that derives its initial value from an accessor but can be overwritten.
 * when the source accessor changes, the signal resets to the new derived value.
 *
 * @param accessor the source accessor to derive from
 * @returns a signal tuple [getter, setter]
 */
export function createDerivedSignal<T>(accessor: Accessor<T>): Signal<T> {
	const computable = createMemo(() => createSignal(accessor()));

	// @ts-expect-error: setter type mismatch is fine
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return [() => computable()[0](), (next) => computable()[1](next)] as Signal<T>;
}

/**
 * creates an abortable signal pair for cancelling async operations.
 * calling create() aborts any previous signal and returns a fresh one.
 * automatically aborts on component cleanup.
 *
 * @returns tuple of [create, abort] functions
 */
export const makeAbortable = (): [create: () => AbortSignal, abort: () => void] => {
	let controller: AbortController | undefined;

	const abort = (): void => {
		controller?.abort();
	};
	const create = (): AbortSignal => {
		abort();
		controller = new AbortController();
		return controller.signal;
	};

	onCleanup(abort);

	return [create, abort];
};

/**
 * creates a throttled accessor that emits the source value at most once per interval.
 * uses trailing edge only: waits for the interval to elapse, then emits the latest value.
 *
 * @param source the source accessor to throttle
 * @param ms throttle interval in milliseconds
 * @returns throttled accessor
 */
export function createTrailingThrottle<T>(source: Accessor<T>, ms: number): Accessor<T> {
	let lastSource = source();
	let timeout: number | undefined;

	const [throttled, setThrottled] = createSignal(lastSource);

	createEffect((initialMount: boolean) => {
		lastSource = source();

		if (initialMount || timeout !== undefined) {
			return false;
		}

		timeout = setTimeout(() => {
			timeout = undefined;
			return setThrottled(() => lastSource);
		}, ms);

		return false;
	}, true);

	return throttled;
}
