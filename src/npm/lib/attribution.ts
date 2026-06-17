import type { Attribution, ExportWeight } from '../types';

import type { ExportOrigin } from './export-origin';

// #region types

/** rendered byte cost of a single module in the bundle output. */
export interface ModuleCost {
	/** whether the module lives in an async (dynamically-imported) chunk rather than the entry chunk */
	async: boolean;
	/** utf-8 byte length of the module's rendered (post-tree-shake) code */
	bytes: number;
}

/** inputs for {@link attributeExports}, all derived from a single bundle build. */
export interface AttributionInput {
	/** module id -> reachable module ids over static + dynamic imports */
	graph: Map<string, string[]>;
	/** module id -> its rendered byte cost */
	moduleCosts: Map<string, ModuleCost>;
	/** export name -> traced origin module */
	origins: Map<string, ExportOrigin>;
	/** measured total byte length of all generated chunks */
	totalBytes: number;
}

// #endregion

// #region core

/** the modules an origin seeds reachability from. */
function seedsOf(origin: ExportOrigin): string[] {
	switch (origin.kind) {
		case 'ambiguous': {
			return origin.ids;
		}
		case 'module': {
			return [origin.id];
		}
		case 'unknown': {
			return [];
		}
	}
}

function confidenceOf(origin: ExportOrigin): ExportWeight['confidence'] {
	switch (origin.kind) {
		case 'ambiguous': {
			return 'ambiguous';
		}
		case 'module': {
			return 'high';
		}
		case 'unknown': {
			return 'unknown';
		}
	}
}

/** the set of modules reachable from the given seeds over the import graph. */
function reachFrom(graph: Map<string, string[]>, seeds: string[]): Set<string> {
	const seen = new Set<string>();
	const stack = [...seeds];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);

		const edges = graph.get(id);
		if (edges) {
			for (const next of edges) {
				if (!seen.has(next)) {
					stack.push(next);
				}
			}
		}
	}

	return seen;
}

/**
 * partitions a bundle's measured bytes across the exports that pull them in.
 *
 * a module reached by exactly one export is that export's private weight; a module
 * reached by several goes to a shared pool, undivided; a module reached by none is
 * unattributed. the difference between the measured total and the sum of module
 * costs is reported as bundler overhead.
 *
 * @param input module costs, the reachability graph, traced origins, and the measured total
 * @returns the per-export breakdown plus shared, unattributed, and overhead buckets
 */
export function attributeExports(input: AttributionInput): Attribution {
	const { graph, moduleCosts, origins, totalBytes } = input;

	// reachable module set per export, and per-export tallies in input order
	const reach = new Map<string, Set<string>>();
	const weights = new Map<string, ExportWeight>();
	for (const [name, origin] of origins) {
		reach.set(name, reachFrom(graph, seedsOf(origin)));
		weights.set(name, { asyncBytes: 0, confidence: confidenceOf(origin), initialBytes: 0, name });
	}

	let moduleTotal = 0;
	let shared = 0;
	let unattributed = 0;
	for (const [id, cost] of moduleCosts) {
		moduleTotal += cost.bytes;

		// find the sole owner, short-circuiting once two are known
		let owner: string | null = null;
		let owners = 0;
		for (const [name, reached] of reach) {
			if (reached.has(id)) {
				owner = name;
				owners += 1;
				if (owners > 1) {
					break;
				}
			}
		}

		if (owners === 0) {
			unattributed += cost.bytes;
		} else if (owners === 1) {
			const weight = weights.get(owner!)!;
			if (cost.async) {
				weight.asyncBytes += cost.bytes;
			} else {
				weight.initialBytes += cost.bytes;
			}
		} else {
			shared += cost.bytes;
		}
	}

	return {
		exports: [...weights.values()],
		// glue/wrappers and inlined-module bytes that map to no rendered module; may be negative
		overhead: totalBytes - moduleTotal,
		shared,
		total: totalBytes,
		unattributed,
	};
}

// #endregion
