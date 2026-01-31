import { dequal } from 'dequal';
import { createSignal, onCleanup, type Accessor } from 'solid-js';
import * as v from 'valibot';

/** schema definition for search params - each schema must accept string input */
type SearchParamsDefinition = Record<string, v.GenericSchema<string | string[] | undefined, unknown>>;

export interface UseSearchParamsOptions {
	/** use replaceState instead of pushState when updating URL */
	replace?: boolean;
}

/** infers output type with all fields optional */
type InferSearchParamsOutput<T extends SearchParamsDefinition> = {
	[K in keyof T]: v.InferOutput<T[K]> | undefined;
};

/**
 * creates a reactive signal for validated URL search parameters.
 * all parameters are optional. array schemas automatically use getAll().
 *
 * @param definition record of valibot schemas (each should accept string input)
 * @param options configuration options
 * @returns a tuple of [params accessor, setParams function]
 *
 * @example
 * ```ts
 * const [params, setParams] = useSearchParams({
 *   q: v.string(),
 *   page: v.pipe(v.string(), v.transform(Number)),
 *   tags: v.array(v.string()),
 * });
 *
 * params().q    // string | undefined
 * params().page // number | undefined
 * params().tags // string[] | undefined
 * ```
 */
export const useSearchParams = <T extends SearchParamsDefinition>(
	definition: T,
	options?: UseSearchParamsOptions,
): [Accessor<InferSearchParamsOutput<T>>, (params: Partial<InferSearchParamsOutput<T>>) => void] => {
	const getValidatedParams = () => {
		const searchParams = new URLSearchParams(window.location.search);
		const result: Record<string, unknown> = {};

		for (const key in definition) {
			const schema = definition[key]!;

			let raw: string | string[] | undefined;
			if (schema.type === 'array') {
				const values = searchParams.getAll(key);
				raw = values.length > 0 ? values : undefined;
			} else {
				raw = searchParams.get(key) ?? undefined;
			}

			if (raw === undefined) {
				result[key] = undefined;
			} else {
				const parsed = v.safeParse(schema!, raw);
				result[key] = parsed.success ? parsed.output : undefined;
			}
		}

		return result as InferSearchParamsOutput<T>;
	};

	const [params, setParamsInternal] = createSignal(getValidatedParams());

	const handlePopState = () => {
		setParamsInternal(() => getValidatedParams());
	};

	window.addEventListener('popstate', handlePopState);
	onCleanup(() => window.removeEventListener('popstate', handlePopState));

	const setParams = (newParams: Partial<InferSearchParamsOutput<T>>) => {
		const current = params();
		const merged = { ...current, ...newParams };

		const result: Record<string, unknown> = {};
		const searchParams = new URLSearchParams(window.location.search);

		for (const key in definition) {
			searchParams.delete(key);

			const value = merged[key];
			if (value === undefined) {
				result[key] = undefined;
				continue;
			}

			const parsed = v.safeParse(definition[key]!, value);
			if (!parsed.success) {
				result[key] = undefined;
				continue;
			}

			result[key] = parsed.output;
			if (Array.isArray(parsed.output)) {
				for (const item of parsed.output) {
					searchParams.append(key, String(item));
				}
			} else {
				searchParams.set(key, String(parsed.output));
			}
		}

		const validated = result as InferSearchParamsOutput<T>;

		if (dequal(current, validated)) {
			return;
		}

		const url = new URL(window.location.href);
		url.search = searchParams.toString();

		if (options?.replace) {
			history.replaceState(null, '', url);
		} else {
			history.pushState(null, '', url);
		}

		setParamsInternal(() => validated);
	};

	return [params, setParams];
};
