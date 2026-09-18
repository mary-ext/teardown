import { FetchError } from './errors';

/** retry delays in milliseconds */
const RETRY_DELAYS = [250, 1_000];

const isTransientError = (error: unknown): boolean => {
	if (error instanceof FetchError) {
		return error.status === 408 || error.status === 429 || error.status >= 500;
	}

	// fetch and decompression failures surface as TypeError, truncated JSON as SyntaxError
	return error instanceof TypeError || error instanceof SyntaxError;
};

/**
 * retries a task up to twice on transient errors, with backoff.
 *
 * @param task the task to run; must be safe to repeat
 * @returns the task's result
 * @throws the last error if retries are exhausted or the error isn't transient
 */
export const retry = async <T>(task: () => Promise<T>): Promise<T> => {
	for (let attempt = 0; ; attempt++) {
		try {
			// oxlint-disable-next-line no-await-in-loop
			return await task();
		} catch (error) {
			if (attempt >= RETRY_DELAYS.length || !isTransientError(error)) {
				throw error;
			}

			// oxlint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
		}
	}
};
