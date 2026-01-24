import { createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';

import { LucideCheck, LucideCircleAlert, LucideInfo, LucideLoader } from '../icons/lucide';
import { LRUCache } from '../lib/lru';
import SizeStat from './size-stat';
import { createQuery } from '../lib/query';
import { createDerivedSignal } from '../lib/signals';
import { progress } from '../npm/events';
import type { BundleResult, DiscoveredSubpaths, ProgressMessage } from '../npm/types';
import type { BundlerWorker } from '../npm/worker-client';
import Button from '../primitives/button';
import * as Dropdown from '../primitives/dropdown';
import * as Field from '../primitives/field';

// #region helpers

function serializeCacheKey(subpath: string, exports: string[] | null, excludePeers: boolean): string {
	const base = exports === null ? subpath : `${subpath}\0${exports.join('\0')}`;
	return excludePeers ? `${base}\0peers` : base;
}

function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

// #endregion

// #region component

interface PackageBundleProps {
	packageName: string;
	subpaths: DiscoveredSubpaths;
	worker: BundlerWorker;
	excludePeers: boolean;
	peerDependencies: string[];
}

const PackageBundle = (props: PackageBundleProps) => {
	const packageName = props.packageName;
	const subpaths = props.subpaths;
	const worker = props.worker;
	const peerDependencies = props.peerDependencies;

	/** formats a subpath for display, replacing `.` and `./` with the package name */
	const formatSubpath = (subpath: string) => {
		if (subpath === '.') {
			return packageName;
		}
		if (subpath.startsWith('./')) {
			return packageName + subpath.slice(1);
		}

		return subpath;
	};

	const bundleCache = new LRUCache<string, BundleResult>(32);

	const [subpath, setSubpath] = createSignal(subpaths.defaultSubpath!);

	// initial bundle query - fetches all exports to discover what's available
	const [initialBundle, { refetch: refetchInitial }] = createQuery(
		subpath,
		async (subpath) => {
			const cacheKey = serializeCacheKey(subpath, null, false);
			const cached = bundleCache.peek(cacheKey);
			if (cached) {
				return cached;
			}

			const res = await worker.bundle(subpath, null);
			bundleCache.put(cacheKey, res);
			return res;
		},
		{ keepPreviousData: false },
	);

	// selectedExports derives from initialBundle exports, resets when they change
	const [selectedExports, setSelectedExports] = createDerivedSignal(() => {
		const $initialBundle = initialBundle.state === 'ready' && initialBundle();
		return $initialBundle ? $initialBundle.exports : [];
	});

	// bundle query - runs when initial bundle is ready, uses cache when all exports selected
	const [bundle, { refetch: refetchBundle }] = createQuery(
		() => {
			const $subpath = subpath();
			if (!$subpath) {
				return null;
			}

			const $initialBundle = initialBundle.state === 'ready' && initialBundle();
			if (!$initialBundle) {
				return null;
			}

			const exports = selectedExports();
			// if selection equals all exports, pass null to reuse LRU cache
			const exportsParam = arraysEqual(exports, $initialBundle.exports) ? null : exports;

			return { subpath: $subpath, exports: exportsParam, excludePeers: props.excludePeers };
		},
		async ({ subpath, exports, excludePeers }) => {
			const cacheKey = serializeCacheKey(subpath, exports, excludePeers);
			const cached = bundleCache.get(cacheKey);
			if (cached) {
				return cached;
			}

			const options = excludePeers ? { rolldown: { external: peerDependencies } } : undefined;
			const res = await worker.bundle(subpath, exports, options);
			bundleCache.put(cacheKey, res);
			return res;
		},
	);

	const toggleExport = (exportName: string) => {
		const current = selectedExports();
		if (current.includes(exportName)) {
			setSelectedExports(current.filter((e) => e !== exportName));
		} else {
			setSelectedExports([...current, exportName]);
		}
	};

	const selectAll = () => {
		const $initialBundle = initialBundle.state === 'ready' && initialBundle();
		if ($initialBundle) {
			setSelectedExports($initialBundle.exports);
		}
	};

	const selectNone = () => setSelectedExports([]);

	const isExportSelected = (exportName: string) => {
		return selectedExports().includes(exportName);
	};

	return (
		<div class="flex flex-col gap-5">
			{/* section header */}
			<h3 class="text-base-400 font-semibold text-neutral-foreground-1">Bundle size</h3>

			{/* subpath selector */}
			<Show when={subpaths.subpaths.length > 1}>
				<Field.Root label="Subpath">
					<Dropdown.Root value={subpath()} onValueChange={setSubpath}>
						<Dropdown.Trigger>{formatSubpath(subpath())}</Dropdown.Trigger>
						<Dropdown.Listbox>
							<For each={subpaths.subpaths}>
								{(sp) => <Dropdown.Option value={sp.subpath}>{formatSubpath(sp.subpath)}</Dropdown.Option>}
							</For>
						</Dropdown.Listbox>
					</Dropdown.Root>
				</Field.Root>
			</Show>

			{/* bundle results */}
			<Switch>
				<Match when={initialBundle.state === 'errored'}>
					<div class="flex flex-col items-center justify-center gap-3 py-12">
						<LucideCircleAlert class="text-danger-foreground-1 size-5" />
						<span class="text-base-300 text-neutral-foreground-2">{initialBundle.error?.message}</span>
						<Button appearance="subtle" onClick={() => refetchInitial()}>
							Retry
						</Button>
					</div>
				</Match>

				<Match when={bundle.state === 'errored'}>
					<div class="flex flex-col items-center justify-center gap-3 py-12">
						<LucideCircleAlert class="text-danger-foreground-1 size-5" />
						<span class="text-base-300 text-neutral-foreground-2">{bundle.error?.message}</span>
						<Button appearance="subtle" onClick={() => refetchBundle()}>
							Retry
						</Button>
					</div>
				</Match>

				<Match when={initialBundle() && bundle()}>
					{(bundleData) => (
						<div class="flex flex-col gap-5">
							{/* size display card */}
							<div class="flex items-stretch gap-6 rounded-lg border border-neutral-stroke-3 bg-neutral-background-1 p-4">
								<SizeStat label="Minified" size={bundleData().size} />
								<div class="w-px bg-neutral-stroke-3" />
								<SizeStat label="Gzip" size={bundleData().gzipSize} />

								<Show when={bundleData().brotliSize !== undefined}>
									<div class="w-px bg-neutral-stroke-3" />
									<SizeStat label="Brotli" size={bundleData().brotliSize!} />
								</Show>

								<Show when={bundleData().zstdSize !== undefined}>
									<div class="w-px bg-neutral-stroke-3" />
									<SizeStat label="Zstd" size={bundleData().zstdSize!} />
								</Show>
								<Show when={bundle.state === 'refreshing'}>
									<div class="flex items-center">
										<LucideLoader class="size-5 animate-spin-linear text-neutral-foreground-3" />
									</div>
								</Show>
							</div>

							<Switch>
								<Match when={bundleData().isCjs}>
									<div class="flex items-center gap-2 text-base-200 text-neutral-foreground-3">
										<LucideInfo class="size-4" />
										<span>CommonJS module — tree-shaking unavailable</span>
									</div>
								</Match>

								<Match when={!initialBundle()?.exports.length}>
									<div class="flex items-center gap-2 text-base-200 text-neutral-foreground-3">
										<LucideInfo class="size-4" />
										<span>No exports detected — side-effects only module</span>
									</div>
								</Match>

								<Match when={initialBundle()?.exports}>
									{(allExports) => (
										<div class="flex flex-col gap-3">
											<div class="flex items-center justify-between">
												<span class="text-base-300 font-medium text-neutral-foreground-2">
													Exports ({allExports().length})
												</span>
												<div class="flex gap-1">
													<Button appearance="subtle" size="small" onClick={selectAll}>
														All
													</Button>
													<Button appearance="subtle" size="small" onClick={selectNone}>
														None
													</Button>
												</div>
											</div>
											<div class="flex flex-wrap gap-1.5">
												<For each={allExports()}>
													{(exp) => {
														const selected = () => isExportSelected(exp);
														return (
															<button
																onClick={() => toggleExport(exp)}
																class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-base-300 transition duration-100 select-none"
																classList={{
																	'border-brand-stroke-1 bg-brand-background-2 text-brand-foreground-2 hover:bg-brand-background-2-hover hover:text-brand-foreground-2-hover active:bg-brand-background-2-pressed active:text-brand-foreground-2-pressed':
																		selected(),
																	'border-neutral-stroke-1 bg-neutral-background-1 text-neutral-foreground-2 hover:bg-neutral-background-1-hover hover:text-neutral-foreground-2-hover active:bg-neutral-background-1-pressed active:text-neutral-foreground-2-pressed':
																		!selected(),
																}}
															>
																<LucideCheck
																	class="duration-fast size-3.5 transition"
																	classList={{
																		'opacity-100': selected(),
																		'opacity-0': !selected(),
																	}}
																/>
																<span>{exp}</span>
															</button>
														);
													}}
												</For>
											</div>
										</div>
									)}
								</Match>
							</Switch>
						</div>
					)}
				</Match>

				<Match when>
					{(() => {
						const [progressState, setProgressState] = createSignal<ProgressMessage | null>(null);

						onCleanup(progress.listen((msg) => setProgressState(msg)));

						return (
							<div class="flex flex-col items-center justify-center gap-3 py-12">
								<LucideLoader class="size-5 animate-spin-linear text-neutral-foreground-3" />

								{(() => {
									const p = progressState();

									switch (p?.kind) {
										case 'compress':
											return <span class="text-base-300 text-neutral-foreground-2">Compressing</span>;
										default:
											return <span class="text-base-300 text-neutral-foreground-2">Bundling...</span>;
									}
								})()}
							</div>
						);
					})()}
				</Match>
			</Switch>
		</div>
	);
};

export default PackageBundle;

// #endregion
