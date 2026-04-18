import { sample, sampleOne } from '@mary/array-fns';
import { createMemo, Match, Switch } from 'solid-js';
import * as v from 'valibot';

import PackageResult from './components/package-result';
import PackageSearchInput from './components/package-search-input';
import { CentralExclamationTriangleSolid } from './icons/central';
import {
	LucideArrowDown,
	LucideCircleAlert,
	LucideHandHeart,
	LucideLoader,
	LucideScissorsLineDashed,
} from './icons/lucide';
import { TangledDolly } from './icons/tangled';
import {
	formatPackageSpecifier,
	PACKAGE_SPECIFIER_RE,
	parsePackageSpecifier,
	type Registry,
} from './lib/package-name';
import { createQuery } from './lib/query';
import { createDerivedSignal } from './lib/signals';
import { useSearchParams } from './lib/use-search-params';
import { fetchPackageManifest } from './npm/packument';
import Button from './primitives/button';
import Tooltip from './primitives/tooltip';
import { RECOMMENDATIONS } from './recommendations';

const isSafari = (() => {
	const ua = navigator.userAgent;
	return /AppleWebKit/.test(ua) && !/Chrome|Chromium/.test(ua);
})();

function App() {
	const [params, setParams] = useSearchParams({
		q: v.pipe(v.string(), v.regex(PACKAGE_SPECIFIER_RE)),
	});

	const parsed = createMemo(() => {
		const q = params().q;
		return q ? parsePackageSpecifier(q) : null;
	});

	const identity = createMemo<{ registry: Registry; name: string } | undefined>(
		() => {
			const p = parsed();
			return p ? { registry: p.registry, name: p.name } : undefined;
		},
		undefined,
		{ equals: (a, b) => a?.registry === b?.registry && a?.name === b?.name },
	);

	const range = createMemo(() => parsed()?.range ?? 'latest');

	const [query, setQuery] = createDerivedSignal(() => params().q ?? '');

	const [manifest, { refetch }] = createQuery(identity, (id) => fetchPackageManifest(id.registry, id.name), {
		keepPreviousData: false,
	});

	const recs = sample(RECOMMENDATIONS, 6)
		.flatMap((v) => (Array.isArray(v) ? sampleOne(v) : v))
		// oxlint-disable-next-line unicorn/no-array-sort
		.sort();

	return (
		<div class="mx-auto flex max-w-xl flex-col gap-6 p-4">
			<div class="flex h-12 items-center justify-between gap-1 rounded-lg border border-neutral-stroke-3 bg-neutral-background-1 px-4">
				<div class="flex shrink-0 items-center gap-2">
					<LucideScissorsLineDashed class="size-5 text-brand-foreground-2" />
					<h1 class="text-base-400 font-medium">teardown</h1>
				</div>

				<div class="-mr-2 flex items-center gap-1">
					<Tooltip content="Donate!" relationship="label" placement="bottom">
						{(triggerProps) => (
							<a
								{...triggerProps}
								target="_blank"
								href="https://github.com/sponsors/mary-ext"
								class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-transparent bg-subtle-background text-neutral-foreground-2 outline-2 -outline-offset-2 outline-transparent transition duration-100 hover:bg-subtle-background-hover focus-visible:outline-compound-brand-stroke active:bg-subtle-background-pressed"
							>
								<LucideHandHeart class="size-4" />
							</a>
						)}
					</Tooltip>

					<Tooltip content="Source code on tangled.org" relationship="label" placement="bottom">
						{(triggerProps) => (
							<a
								{...triggerProps}
								target="_blank"
								href="https://tangled.org/did:plc:ia76kvnndjutgedggx2ibrem/teardown"
								class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-transparent bg-subtle-background text-neutral-foreground-2 outline-2 -outline-offset-2 outline-transparent transition duration-100 hover:bg-subtle-background-hover focus-visible:outline-compound-brand-stroke active:bg-subtle-background-pressed"
							>
								<TangledDolly class="size-4" />
							</a>
						)}
					</Tooltip>
				</div>
			</div>

			<div class="flex min-h-0 grow flex-col gap-4 sm:px-4">
				<PackageSearchInput
					autofocus={/* @once */ !query()}
					value={query()}
					onChange={setQuery}
					onSelect={(specifier) => setParams({ q: specifier })}
				/>

				{isSafari && (
					<div class="flex gap-2 rounded-md border border-status-warning-border-1 bg-status-warning-background-1 px-3 py-1.75">
						<CentralExclamationTriangleSolid class="size-5 shrink-0 text-status-warning-foreground-3" />

						<div class="min-w-0 grow text-base-300 text-neutral-foreground-1">
							<span class="font-semibold">Not compatible with Safari.</span> Sorry, not sure why it doesn't
							work there. It seems to be Rolldown and WASI related.
						</div>
					</div>
				)}

				<Switch>
					<Match when={manifest()} keyed>
						{(m) => (
							<PackageResult
								manifest={m}
								range={range()}
								onVersionChange={(version) => {
									setParams({
										q: formatPackageSpecifier({ registry: m.registry, name: m.name, range: version }),
									});
								}}
							/>
						)}
					</Match>

					<Match when={manifest.state === 'errored'}>
						<div class="flex flex-col items-center justify-center gap-3 py-12">
							<LucideCircleAlert class="text-danger-foreground-1 size-5" />
							<span class="text-base-300 text-neutral-foreground-2">{manifest.error?.message}</span>
							<Button appearance="subtle" onClick={() => refetch()}>
								Retry
							</Button>
						</div>
					</Match>

					<Match when={manifest.loading}>
						<div class="flex flex-col items-center justify-center gap-3 py-12">
							<LucideLoader class="size-5 animate-spin-linear text-neutral-foreground-3" />
							<span class="text-base-300 text-neutral-foreground-2">Loading...</span>
						</div>
					</Match>

					<Match when>
						<div class="flex flex-col gap-4">
							<div>
								<p class="text-base-300 text-neutral-foreground-2">
									Find the cost of adding an npm package to your app's bundle size. <br />
									Makes use of <a>Rolldown</a> to bundle packages in your browser.
								</p>
							</div>

							<div class="flex flex-col gap-3">
								<p class="text-base-200 font-bold text-neutral-foreground-4 uppercase">Example packages</p>

								{recs.map((name) => {
									return (
										<div class="flex items-center gap-3">
											<LucideArrowDown class="size-4 rotate-270 text-neutral-foreground-3" />
											<button
												onClick={() => setParams({ q: `npm:${name}` })}
												class="cursor-pointer text-base-300 text-brand-foreground-2 transition hover:text-brand-foreground-2-hover hover:underline active:text-brand-foreground-2-pressed"
											>
												{name}
											</button>
										</div>
									);
								})}
							</div>
						</div>
					</Match>
				</Switch>
			</div>
		</div>
	);
}

export default App;
