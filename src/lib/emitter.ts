/**
 * callback type for event listeners.
 */
type Callback<T extends unknown[]> = (...args: T) => void;

/**
 * a simple typed event emitter.
 */
export interface EventEmitter<T extends unknown[]> {
	/**
	 * registers a listener for this event.
	 * @param callback the function to call when the event fires
	 * @returns a cleanup function that removes the listener
	 */
	listen: (callback: Callback<T>) => () => void;
	/**
	 * emits the event, calling all registered listeners synchronously.
	 * @param args the arguments to pass to listeners
	 */
	emit: (...args: T) => void;
}

/**
 * creates a typed event emitter.
 * uses a Set internally for O(1) add/remove operations.
 *
 * @returns an event emitter with listen and emit methods
 * @example
 * ```ts
 * const onProgress = createEventEmitter<[current: number, total: number]>();
 *
 * // in a Solid component:
 * onCleanup(onProgress.listen((current, total) => {
 *   console.log(`${current}/${total}`);
 * }));
 *
 * // elsewhere:
 * onProgress.emit(5, 10);
 * ```
 */
export function createEventEmitter<T extends unknown[]>(): EventEmitter<T> {
	let listener: Callback<T> | Callback<T>[] | undefined;

	return {
		listen(callback) {
			let closed = false;

			if (listener === undefined) {
				listener = callback;
			} else if (typeof listener === 'function') {
				listener = [listener, callback];
			} else {
				listener = listener.concat(callback);
			}

			return () => {
				if (closed) {
					return;
				}

				closed = true;

				if (listener === undefined) {
					return;
				}

				if (listener === callback) {
					listener = undefined;
				} else if (typeof listener !== 'function') {
					const index = listener.indexOf(callback);
					if (index !== -1) {
						if (listener.length === 2) {
							// ^ flips the bit, it's either 0 or 1 here.
							listener = listener[index ^ 1];
						} else {
							listener = listener.toSpliced(index, 1);
						}
					}
				}
			};
		},
		emit(...args) {
			if (listener === undefined) {
				return false;
			}
			if (typeof listener === 'function') {
				listener.apply(this, args);
			} else {
				for (let idx = 0, len = listener.length; idx < len; idx++) {
					listener[idx]!.apply(this, args);
				}
			}
		},
	};
}
