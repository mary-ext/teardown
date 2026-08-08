import { dequal } from 'dequal';
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';

import { LucideCheck, LucideChevronDown, LucideCircleAlert, LucideInfo, LucideLoader } from '../icons/lucide';
import { formatBytes } from '../lib/format';
import { LRUCache } from '../lib/lru';
import { createQuery } from '../lib/query';
import { createDerivedSignal } from '../lib/signals';
import { progress } from '../npm/events';
import type {
	Attribution,
	BundleOptions,
	BundleOutput,
	BundleResult,
	DiscoveredSubpaths,
	ProgressMessage,
} from '../npm/types';
import type { BundlerWorker } from '../npm/worker-client';
import Button from '../primitives/button';
import * as Dropdown from '../primitives/dropdown';
import * as Field from '../primitives/field';

import SizeStat from './size-stat';

// #region helpers

type Platform = 'browser' | 'node';

const PLATFORM_LABELS: Record<Platform, string> = {
	browser: 'Browser',
	node: 'Node.js',
};

const PLATFORMS: Platform[] = ['browser', 'node'];

function serializeCacheKey(
	platform: Platform,
	subpath: string,
	exports: string[] | null,
	excludePeers: boolean,
	attribute = false,
): string {
	const base = exports === null ? subpath : `${subpath}\0${exports.join('\0')}`;
	const withPlatform = `${platform}\0${base}`;
	const withPeers = excludePeers ? `${withPlatform}\0peers` : withPlatform;
	return attribute ? `${withPeers}\0attr` : withPeers;
}

/** sorts output: entry chunk first, then chunks alphabetically, then assets alphabetically */
function sortOutput(output: BundleOutput[]): BundleOutput[] {
	return output.toSorted((a, b) => {
		// entry chunk comes first
		if (a.type === 'chunk' && a.isEntry) {
			return -1;
		}
		if (b.type === 'chunk' && b.isEntry) {
			return 1;
		}
		// chunks before assets
		if (a.type !== b.type) {
			return a.type === 'chunk' ? -1 : 1;
		}
		// lexicographical within same type
		if (a.filename < b.filename) {
			return -1;
		}
		if (a.filename > b.filename) {
			return 1;
		}
		return 0;
	});
}

function computeTotals(output: BundleOutput[]) {
	const size = output.reduce((s, f) => s + f.size, 0);
	const gzipSize = output.reduce((s, f) => s + f.gzipSize, 0);
	const brotliSize = output.every((f) => f.brotliSize !== undefined)
		? output.reduce((s, f) => s + f.brotliSize!, 0)
		: undefined;
	const zstdSize = output.every((f) => f.zstdSize !== undefined)
		? output.reduce((s, f) => s + f.zstdSize!, 0)
		: undefined;

	return { size, gzipSize, brotliSize, zstdSize };
}

/** renders a signed byte amount, e.g. a negative bundler-overhead delta. */
function formatSigned(bytes: number): string {
	return bytes < 0 ? `−${formatBytes(-bytes)}` : formatBytes(bytes);
}

/**
 * per-export size breakdown: private weight per export plus shared/unattributed/overhead buckets.
 * attribution is computed on the unminified bundle (per-module sizes are pre-minify), so byte
 * values are scaled by each part's code share to the minified `total` shown in the headline.
 */
const WeightBreakdown = (props: { attribution: Attribution; total: number }) => {
	const basis = () => props.attribution.total;
	const share = (bytes: number) => (basis() > 0 ? bytes / basis() : 0);
	const display = (bytes: number) => share(bytes) * props.total;

	const sorted = createMemo(() =>
		props.attribution.exports
			.map((weight) => ({ ...weight, raw: weight.asyncBytes + weight.initialBytes }))
			.toSorted((a, b) => b.raw - a.raw),
	);

	const coverage = createMemo(() => {
		const attributed = props.attribution.exports.reduce((sum, w) => sum + w.asyncBytes + w.initialBytes, 0);
		return share(attributed + props.attribution.shared);
	});

	return (
		<div class="flex flex-col gap-3">
			<For each={sorted()}>
				{(weight) => (
					<div class="flex flex-col gap-1">
						<div class="flex items-center justify-between gap-2 text-base-200">
							<span class="flex min-w-0 items-center gap-1.5">
								<span class="truncate font-mono text-neutral-foreground-2">{weight.name}</span>
								<Show when={weight.confidence !== 'high'}>
									<span class="rounded shrink-0 border border-neutral-stroke-1 px-1 text-neutral-foreground-3">
										{weight.confidence === 'ambiguous' ? 'ambiguous' : 'untraced'}
									</span>
								</Show>
							</span>
							<span class="shrink-0 text-neutral-foreground-2">
								{formatBytes(display(weight.raw))}
								<Show when={weight.asyncBytes > 0}>
									<span class="text-neutral-foreground-3">
										{' '}
										· {formatBytes(display(weight.asyncBytes))} async
									</span>
								</Show>
							</span>
						</div>
						<div class="h-1.5 overflow-hidden rounded-full bg-neutral-background-3">
							<div
								class="h-full rounded-full bg-brand-background"
								style={{ width: `${share(weight.raw) * 100}%` }}
							/>
						</div>
					</div>
				)}
			</For>

			<div class="flex flex-col gap-1 text-base-200 text-neutral-foreground-3">
				<Show when={props.attribution.shared > 0}>
					<div class="flex items-center justify-between">
						<span>Shared (2+ exports)</span>
						<span>{formatBytes(display(props.attribution.shared))}</span>
					</div>
				</Show>
				<Show when={props.attribution.unattributed > 0}>
					<div class="flex items-center justify-between">
						<span>Unattributed</span>
						<span>{formatBytes(display(props.attribution.unattributed))}</span>
					</div>
				</Show>
				<Show when={props.attribution.overhead !== 0}>
					<div class="flex items-center justify-between">
						<span>Bundler overhead</span>
						<span>{formatSigned(display(props.attribution.overhead))}</span>
					</div>
				</Show>
			</div>

			<p class="text-base-200 text-neutral-foreground-3">
				{`${Math.round(coverage() * 100)}% of ${formatBytes(props.total)} traced to exports — shared code is pooled, not split. approximate minified bytes.`}
			</p>
		</div>
	);
};

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

	// resolution platform — selects which export conditions win (e.g. a package's `browser`
	// build vs. its `import`/`node` ESM). changing it re-runs the initial bundle.
	const [platform, setPlatform] = createSignal<Platform>('browser');

	// initial bundle query - fetches all exports to discover what's available
	const [initialBundle, { refetch: refetchInitial }] = createQuery(
		() => ({ platform: platform(), subpath: subpath() }),
		async ({ platform, subpath }) => {
			const cacheKey = serializeCacheKey(platform, subpath, null, false);
			const cached = bundleCache.peek(cacheKey);
			if (cached) {
				return cached;
			}

			const res = await worker.bundle(subpath, null, { rolldown: { platform } });
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
			const exportsParam = dequal(exports, $initialBundle.exports) ? null : exports;

			return {
				subpath: $subpath,
				exports: exportsParam,
				excludePeers: props.excludePeers,
				platform: platform(),
			};
		},
		async ({ subpath, exports, excludePeers, platform }) => {
			const cacheKey = serializeCacheKey(platform, subpath, exports, excludePeers);
			const cached = bundleCache.get(cacheKey);
			if (cached) {
				return cached;
			}

			const rolldown: NonNullable<BundleOptions['rolldown']> = { platform };
			if (excludePeers) {
				rolldown.external = peerDependencies;
			}

			const res = await worker.bundle(subpath, exports, { rolldown });
			bundleCache.put(cacheKey, res);
			return res;
		},
	);

	// per-export weight breakdown — opt-in, since attribution traces the whole graph
	const [showWeights, setShowWeights] = createSignal(false);

	const [weights, { refetch: refetchWeights }] = createQuery(
		() => {
			if (!showWeights()) {
				return null;
			}

			const $subpath = subpath();
			const $initialBundle = initialBundle.state === 'ready' && initialBundle();
			if (!$subpath || !$initialBundle) {
				return null;
			}

			const exports = selectedExports();
			if (exports.length === 0) {
				return null;
			}

			// attribution needs concrete export names to trace, so never collapse to null
			return { subpath: $subpath, exports, excludePeers: props.excludePeers, platform: platform() };
		},
		async ({ subpath, exports, excludePeers, platform }) => {
			const cacheKey = serializeCacheKey(platform, subpath, exports, excludePeers, true);
			const cached = bundleCache.get(cacheKey);
			if (cached) {
				return cached;
			}

			const rolldown: NonNullable<BundleOptions['rolldown']> = { platform };
			if (excludePeers) {
				rolldown.external = peerDependencies;
			}

			const res = await worker.bundle(subpath, exports, { attribute: true, rolldown });
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

	const selectedSet = createMemo(() => new Set(selectedExports()));

	const isExportSelected = (exportName: string) => {
		return selectedSet().has(exportName);
	};

	return (
		<div class="flex flex-col gap-5">
			{/* section header */}
			<div class="flex flex-wrap items-baseline justify-between gap-4">
				<h3 class="text-base-400 font-semibold text-neutral-foreground-1">Bundle size</h3>

				{bundle.state === 'refreshing' && (
					<LucideLoader class="size-4 shrink-0 animate-spin-linear text-neutral-foreground-3" />
				)}
			</div>

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

			{/* platform selector — which export conditions resolve */}
			<Field.Root label="Platform">
				<Dropdown.Root
					value={platform()}
					onValueChange={(v) => {
						if (v === 'browser' || v === 'node') {
							setPlatform(v);
						}
					}}
				>
					<Dropdown.Trigger>{PLATFORM_LABELS[platform()]}</Dropdown.Trigger>
					<Dropdown.Listbox>
						<For each={/* @once */ PLATFORMS}>
							{(p) => <Dropdown.Option value={p}>{PLATFORM_LABELS[p]}</Dropdown.Option>}
						</For>
					</Dropdown.Listbox>
				</Dropdown.Root>
			</Field.Root>

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
					{(bundleData) => {
						const totals = createMemo(() => computeTotals(bundleData().output));
						const sortedOutput = createMemo(() => sortOutput(bundleData().output));
						const hasMultipleOutputs = createMemo(() => bundleData().output.length > 1);
						const [breakdownOpen, setBreakdownOpen] = createSignal(false);

						return (
							<div class="flex flex-col gap-5">
								{/* size display card */}
								<div class="sticky top-1 flex flex-wrap items-stretch gap-4 rounded-lg border border-neutral-stroke-3 bg-neutral-background-1 px-4 py-3">
									<SizeStat label="Minified" size={totals().size} />

									<SizeStat label="Gzip" size={totals().gzipSize} />

									{totals().brotliSize !== undefined && (
										<SizeStat label="Brotli" size={totals().brotliSize!} />
									)}

									{totals().zstdSize !== undefined && <SizeStat label="Zstd" size={totals().zstdSize!} />}
								</div>

								{/* breakdown table */}
								<Show when={hasMultipleOutputs()}>
									<div class="flex flex-col gap-2">
										<button
											class="flex items-center gap-1 text-base-200 text-neutral-foreground-2 hover:text-neutral-foreground-1"
											onClick={() => setBreakdownOpen((v) => !v)}
										>
											<LucideChevronDown
												class="size-4 transition-transform duration-150"
												classList={{ 'rotate-0': breakdownOpen(), '-rotate-90': !breakdownOpen() }}
											/>
											<span>Breakdown ({sortedOutput().length} files)</span>
										</button>

										<Show when={breakdownOpen()}>
											<div class="-mx-4 overflow-x-auto px-4">
												<table class="w-full text-base-200 whitespace-nowrap">
													<thead>
														<tr class="text-left text-neutral-foreground-3">
															<th class="py-1 pr-4 font-medium">File</th>
															<th class="py-1 pr-4 text-right font-medium">Minified</th>
															<th class="py-1 pr-4 text-right font-medium">Gzip</th>
															{totals().brotliSize !== undefined && (
																<th class="py-1 pr-4 text-right font-medium">Brotli</th>
															)}
															{totals().zstdSize !== undefined && (
																<th class="py-1 text-right font-medium">Zstd</th>
															)}
														</tr>
													</thead>
													<tbody>
														<For each={sortedOutput()}>
															{(item) => (
																<tr
																	classList={{
																		'text-neutral-foreground-2': item.type === 'chunk',
																		'text-neutral-foreground-3': item.type === 'asset',
																	}}
																>
																	<td class="py-1 pr-4 font-mono">{item.filename}</td>
																	<td class="py-1 pr-4 text-right">{formatBytes(item.size)}</td>
																	<td class="py-1 pr-4 text-right">{formatBytes(item.gzipSize)}</td>
																	{totals().brotliSize !== undefined && (
																		<td class="py-1 pr-4 text-right">
																			{item.brotliSize !== undefined ? formatBytes(item.brotliSize) : '—'}
																		</td>
																	)}
																	{totals().zstdSize !== undefined && (
																		<td class="py-1 text-right">
																			{item.zstdSize !== undefined ? formatBytes(item.zstdSize) : '—'}
																		</td>
																	)}
																</tr>
															)}
														</For>
													</tbody>
												</table>
											</div>
										</Show>
									</div>
								</Show>

								<Switch>
									<Match when={bundleData().moduleType === 'cjs'}>
										<div class="flex items-center gap-2 text-base-200 text-neutral-foreground-3">
											<LucideInfo class="size-4" />
											<span>CommonJS module — tree-shaking unavailable</span>
										</div>
									</Match>

									<Match when={bundleData().moduleType === 'umd'}>
										<div class="flex items-center gap-2 text-base-200 text-neutral-foreground-3">
											<LucideInfo class="size-4" />
											<span>UMD bundle — tree-shaking unavailable</span>
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

								{/* per-export weight breakdown (opt-in) */}
								<Show when={bundleData().moduleType === 'esm' && (initialBundle()?.exports.length ?? 0) > 0}>
									<div class="flex flex-col gap-3">
										<div class="flex items-center justify-between">
											<span class="text-base-300 font-medium text-neutral-foreground-2">
												Weight by export
											</span>
											<Button appearance="subtle" size="small" onClick={() => setShowWeights((v) => !v)}>
												{showWeights() ? 'Hide' : 'Show'}
											</Button>
										</div>

										<Show when={showWeights()}>
											<Switch>
												<Match when={weights.state === 'errored'}>
													<div class="flex items-center gap-2 text-base-200 text-neutral-foreground-3">
														<LucideCircleAlert class="size-4 shrink-0" />
														<span>{weights.error?.message}</span>
														<Button appearance="subtle" size="small" onClick={() => refetchWeights()}>
															Retry
														</Button>
													</div>
												</Match>

												<Match when={weights()?.attribution}>
													{(attr) => <WeightBreakdown attribution={attr()} total={totals().size} />}
												</Match>

												<Match when={selectedExports().length === 0}>
													<span class="text-base-200 text-neutral-foreground-3">
														Select at least one export to weigh.
													</span>
												</Match>

												<Match when>
													<div class="flex items-center gap-2 text-base-200 text-neutral-foreground-3">
														<LucideLoader class="size-4 shrink-0 animate-spin-linear" />
														<span>Analyzing exports…</span>
													</div>
												</Match>
											</Switch>
										</Show>
									</div>
								</Show>
							</div>
						);
					}}
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
										case 'compress': {
											return <span class="text-base-300 text-neutral-foreground-2">Compressing</span>;
										}
										default: {
											return <span class="text-base-300 text-neutral-foreground-2">Bundling...</span>;
										}
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
