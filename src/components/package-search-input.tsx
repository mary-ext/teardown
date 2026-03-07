import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';

import { LucideLoader, LucidePackage, LucideSearch } from '../icons/lucide';
import { modality } from '../lib/modality';
import { formatPackageSpecifier, parsePackageSpecifier, type Registry } from '../lib/package-name';
import { createQuery } from '../lib/query';
import { scrollIntoContainerView } from '../lib/scroll';
import { createTrailingThrottle, makeAbortable } from '../lib/signals';
import { normalizeWhitespace } from '../lib/strings';
import Input from '../primitives/input';

// #region types

interface SearchResult {
	name: string;
	version: string;
	description?: string;
	registry: Registry;
}

interface NpmSearchResponse {
	objects: Array<{
		package: {
			name: string;
			version: string;
			description?: string;
		};
	}>;
}

interface JsrSearchResponse {
	items: Array<{
		scope: string;
		name: string;
		latestVersion: string;
		description?: string;
	}>;
}

// #endregion

// #region search API

async function searchNpm(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`;
	const response = await fetch(url, { signal });
	if (!response.ok) {
		return [];
	}

	const data = (await response.json()) as NpmSearchResponse;

	return data.objects.map((obj) => ({
		name: obj.package.name,
		version: obj.package.version,
		description: obj.package.description,
		registry: 'npm' as const,
	}));
}

async function searchJsr(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const url = `https://api.jsr.io/packages?query=${encodeURIComponent(query)}&limit=10`;
	const response = await fetch(url, { signal });
	if (!response.ok) {
		return [];
	}

	const data = (await response.json()) as JsrSearchResponse;

	return data.items.map((item) => ({
		name: `@${item.scope}/${item.name}`,
		version: item.latestVersion,
		description: item.description,
		registry: 'jsr' as const,
	}));
}

interface ParsedQuery {
	registry: Registry | null;
	query: string;
}

function parseQuery(input: string): ParsedQuery {
	const trimmed = input.trim();
	if (trimmed.startsWith('npm:')) {
		return { registry: 'npm', query: trimmed.slice(4).trim() };
	}
	if (trimmed.startsWith('jsr:')) {
		return { registry: 'jsr', query: trimmed.slice(4).trim() };
	}
	return { registry: null, query: trimmed };
}

// #endregion

// #region component

interface PackageSearchInputProps {
	value: string;
	onChange: (next: string) => void;
	onSelect?: (specifier: string) => void;
	autofocus?: boolean;
	disabled?: boolean;
}

const PackageSearchInput = (props: PackageSearchInputProps) => {
	let listboxRef: HTMLDivElement | undefined;

	const [createAbortSignal] = makeAbortable();

	const [open, setOpen] = createSignal(false);
	const [activeIndex, setActiveIndex] = createSignal(-1);

	const throttledValue = createTrailingThrottle(() => normalizeWhitespace(props.value), 500);
	const parsed = createMemo(() => parseQuery(props.value));

	const [results] = createQuery(
		() => {
			const { registry, query } = parseQuery(throttledValue());
			if (query.length < 3) {
				return null;
			}

			return { registry, query };
		},
		async ({ registry, query }) => {
			const signal = createAbortSignal();
			if (registry === 'npm') {
				return searchNpm(query, signal);
			}
			if (registry === 'jsr') {
				return searchJsr(query, signal);
			}
			// default to npm when no prefix
			return searchNpm(query, signal);
		},
	);

	const showPopover = () => !props.disabled && open() && parsed().query.length >= 2;

	createEffect(() => {
		if (props.disabled) {
			setOpen(false);
			setActiveIndex(-1);
		}
	});

	const handleSelect = (result: SearchResult) => {
		const specifier = formatPackageSpecifier({
			registry: result.registry,
			name: result.name,
			range: 'latest',
		});
		props.onChange(specifier);
		props.onSelect?.(specifier);
		setOpen(false);
		setActiveIndex(-1);
	};

	const handleKeyDown = (ev: KeyboardEvent) => {
		if (props.disabled) {
			return;
		}

		const items = results() ?? [];

		switch (ev.key) {
			case 'ArrowDown': {
				if (items.length === 0) {
					return;
				}
				ev.preventDefault();
				setActiveIndex((i) => (i + 1) % items.length);
				break;
			}
			case 'ArrowUp': {
				if (items.length === 0) {
					return;
				}
				ev.preventDefault();
				setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
				break;
			}
			case 'Enter': {
				ev.preventDefault();
				const idx = activeIndex();
				if (idx >= 0 && idx < items.length) {
					handleSelect(items[idx]!);
				} else {
					const parsed = parsePackageSpecifier(props.value.trim());
					if (parsed) {
						props.onSelect?.(formatPackageSpecifier(parsed));
						setOpen(false);
						setActiveIndex(-1);
					}
				}
				break;
			}
			case 'Escape': {
				ev.preventDefault();
				setOpen(false);
				setActiveIndex(-1);
				break;
			}
		}
	};

	return (
		<div class="relative flex flex-col">
			<Input
				inputRef={(node) => {
					onMount(() => {
						if (props.autofocus) {
							node.focus();
						}
					});
				}}
				disabled={props.disabled}
				value={props.value}
				onInput={(ev) => {
					props.onChange(ev.currentTarget.value);
					setOpen(true);
					setActiveIndex(-1);
				}}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onKeyDown={handleKeyDown}
				placeholder="Search packages (npm: or jsr:)"
				role="combobox"
				aria-expanded={showPopover()}
				aria-autocomplete="list"
				contentBefore={
					<Show
						when={results.state === 'pending' || results.state === 'refreshing'}
						fallback={<LucideSearch />}
					>
						<LucideLoader class="animate-spin-linear" />
					</Show>
				}
			/>

			{/* listbox */}
			<Show when={showPopover()}>
				<div
					ref={(el) => (listboxRef = el)}
					class="absolute top-full right-0 left-0 z-10 mt-0.5 flex max-h-80 flex-col gap-0.5 overflow-y-auto rounded-md bg-neutral-background-1 p-1 text-base-300 shadow-16"
					role="listbox"
					tabindex={-1}
					onMouseDown={(e) => e.preventDefault()}
				>
					<Show
						when={results() && results()!.length > 0}
						fallback={
							<div class="px-2 py-1.5 text-base-300 text-neutral-foreground-3">
								{results.loading ? 'Searching...' : 'No packages found'}
							</div>
						}
					>
						<For each={results()}>
							{(result, index) => (
								<div
									ref={(el) => {
										createEffect(() => {
											if (activeIndex() === index() && modality() === 'keyboard' && listboxRef) {
												scrollIntoContainerView(listboxRef, el);
											}
										});
									}}
									role="option"
									aria-selected={activeIndex() === index()}
									class="flex gap-2 rounded-md px-2 py-1.5 text-base-300 text-neutral-foreground-1 select-none"
									classList={{
										'bg-neutral-background-1-hover': activeIndex() === index(),
										'hover:bg-neutral-background-1-hover active:bg-neutral-background-1-pressed':
											modality() === 'pointer',
									}}
									onMouseOver={() => modality() === 'pointer' && setActiveIndex(index())}
									onClick={() => handleSelect(result)}
								>
									<div class="grid size-5 shrink-0 place-items-center text-neutral-foreground-3">
										<LucidePackage class="size-4" />
									</div>

									<div class="flex min-w-0 grow flex-col">
										<div class="flex gap-1">
											{result.registry === 'jsr' && (
												<span class="font-medium text-neutral-foreground-3">jsr:</span>
											)}

											<span class="min-w-0 wrap-break-word">{result.name}</span>

											<span class="my-0.5 shrink-0 text-base-200 text-neutral-foreground-3">
												{result.version}
											</span>
										</div>

										<span class="line-clamp-2 text-base-200 text-neutral-foreground-3 empty:hidden">
											{result.description ?? ''}
										</span>
									</div>
								</div>
							)}
						</For>
					</Show>
				</div>
			</Show>
		</div>
	);
};

export default PackageSearchInput;

// #endregion
