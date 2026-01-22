import { sample, sampleOne } from '@mary/array-fns';
import { createEffect, createMemo, createSignal, Match, onCleanup, Switch } from 'solid-js';
import * as v from 'valibot';

import PackageResult from './components/package-result';
import PackageSearchInput from './components/package-search-input';
import {
	LucideArrowDown,
	LucideCircleAlert,
	LucideHandHeart,
	LucideLoader,
	LucideScissorsLineDashed,
} from './icons/lucide';
import { TangledDolly } from './icons/tangled';
import { PACKAGE_SPECIFIER_RE } from './lib/package-name';
import { createQuery } from './lib/query';
import { createDerivedSignal } from './lib/signals';
import { useSearchParams } from './lib/use-search-params';
import { progress } from './npm/events';
import { initPackage } from './npm/worker-client';
import type { ProgressMessage } from './npm/worker-protocol';
import Button from './primitives/button';
import Tooltip from './primitives/tooltip';

const RECOMMENDATIONS: (string | string[])[] = [
	// UI frameworks
	'preact',
	'react',
	'solid-js',
	'svelte',
	'vue',

	// routing
	'@solidjs/router',
	'@tanstack/react-router',
	'navaid',
	'path-to-regexp',
	'react-router',
	'regexparam',
	'trouter',
	'vue-router',
	'wouter',

	// state management
	'immer',
	'jotai',
	'nanostores',
	'zustand',
	'valtio',

	// data fetched
	['@tanstack/react-query', '@tanstack/vue-query', '@tanstack/solid-query'],
	'swr',

	// HTTP clients
	'axios',
	'ky',
	'ofetch',
	'redaxios',
	'wretch',

	// validation/schema
	'zod',
	'valibot',
	'yup',
	'ajv',
	'arktype',
	'superstruct',
	'@badrap/valita',

	// date/time
	['date-fns', '@date-fns/tz', '@date-fns/utc'],
	'dayjs',
	'luxon',
	'moment',
	'tinydate',

	// class names/styling
	'clsx',
	'classnames',
	'tailwind-merge',

	// ID generation
	'nanoid',
	'uuid',
	'hexoid',
	'uid',

	// deep clone/equality
	'klona',
	'dequal',
	'fast-deep-equal',
	'rfdc',

	// query strings
	'qs',
	'qss',
	'query-string',

	// i18n
	'i18next',
	'rosetta',

	// markdown
	'marked',
	['markdown-it', 'markdown-exit'],

	// search
	'fuse.js',
	'minisearch',

	// animation
	['framer-motion', 'motion-v', 'motion'],

	// forms
	'formik',
	'react-hook-form',
	[
		'@formisch/preact',
		'@formisch/qwik',
		'@formisch/react',
		'@formisch/solid',
		'@formisch/svelte',
		'@formisch/vue',
	],
	[
		'@tanstack/angular-form',
		'@tanstack/lit-form',
		'@tanstack/react-form',
		'@tanstack/solid-form',
		'@tanstack/svelte-form',
		'@tanstack/vue-form',
	],

	// tables
	[
		'@tanstack/angular-table',
		'@tanstack/lit-table',
		'@tanstack/qwik-table',
		'@tanstack/react-table',
		'@tanstack/solid-table',
		'@tanstack/svelte-table',
		'@tanstack/vue-table',
	],

	// virtualization
	'rc-virtual-list',
	'virtua',
	[
		'@tanstack/angular-virtual',
		'@tanstack/lit-virtual',
		'@tanstack/react-virtual',
		'@tanstack/solid-virtual',
		'@tanstack/svelte-virtual',
		'@tanstack/vue-virtual',
	],

	// storage
	'idb-keyval',
	'idb',

	// CSV
	'papaparse',

	// sanitization
	'dompurify',

	// functional/result types
	'effect',
	'neverthrow',
	'true-myth',

	// promise utilities
	'p-all',
	'p-limit',
	'p-map',
	'p-queue',
	'p-series',

	// utilities
	'es-toolkit',
	'lodash-es',
	'ramda',
	'underscore',

	// UI component libraries
	'@base-ui/react',
	'@chakra-ui/react',
	'@fluentui/react-components',
	'antd',
	'corvu',
	'tamagui',
	['@mui/material', '@mui/joy'],
	['radix-ui', '@radix-ui/themes'],
	['radix-vue', 'reka-ui'],

	// CSS-in-JS / styling
	['@emotion/react', '@emotion/styled'],
	'styled-components',
	'styled-jsx',

	// positioning/floating
	'nanopop',
	['@floating-ui/dom', '@floating-ui/react', '@floating-ui/react-dom', '@floating-ui/vue'],
];

function App() {
	const [params, setParams] = useSearchParams({
		q: v.pipe(v.string(), v.regex(PACKAGE_SPECIFIER_RE)),
	});

	const packageName = createMemo(() => params().q);

	const [query, setQuery] = createDerivedSignal(() => packageName() ?? '');

	const [result, { refetch }] = createQuery(packageName, (name) => initPackage(name), {
		keepPreviousData: false,
	});

	createEffect(() => {
		const $result = result();
		if (!$result) {
			return;
		}

		onCleanup(() => $result.worker.terminate());
	});

	const recs = sample(RECOMMENDATIONS, 6)
		.flatMap((v) => (Array.isArray(v) ? sampleOne(v) : v))
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

				<Switch>
					<Match when={result()} keyed>
						{(result) => <PackageResult result={result} />}
					</Match>

					<Match when={result.state === 'errored'}>
						<div class="flex flex-col items-center justify-center gap-3 py-12">
							<LucideCircleAlert class="text-danger-foreground-1 size-5" />
							<span class="text-base-300 text-neutral-foreground-2">{result.error?.message}</span>
							<Button appearance="subtle" onClick={() => refetch()}>
								Retry
							</Button>
						</div>
					</Match>

					<Match when={result.state === 'pending' || result.state === 'refreshing'} keyed>
						{(_) => {
							const [progressState, setProgressState] = createSignal<ProgressMessage | null>(null);

							onCleanup(progress.listen((msg) => setProgressState(msg)));

							return (
								<div class="flex flex-col items-center justify-center gap-3 py-12">
									<LucideLoader class="size-5 animate-spin-linear text-neutral-foreground-3" />

									{(() => {
										const p = progressState();

										switch (p?.kind) {
											case 'resolve':
												return (
													<span class="text-base-300 text-neutral-foreground-2">
														Resolved {p.name}@{p.version}
													</span>
												);
											case 'fetch':
												return (
													<div class="flex flex-col items-center gap-1">
														<span class="text-base-300 text-neutral-foreground-2">Downloaded {p.name}</span>
														<span class="text-base-200 text-neutral-foreground-3">
															{p.current} / {p.total}
														</span>
													</div>
												);
											default:
												return <span class="text-base-300 text-neutral-foreground-2">Loading...</span>;
										}
									})()}
								</div>
							);
						}}
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
