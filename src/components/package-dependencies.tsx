import { createMemo, createSignal, For, Show } from 'solid-js';

import { LucideSearch } from '../icons/lucide';
import { tw } from '../lib/classes';
import { formatBytes } from '../lib/format';
import type { InstalledPackage } from '../npm/types';
import * as Dropdown from '../primitives/dropdown';
import Input from '../primitives/input';
import Tooltip from '../primitives/tooltip';

// #region types

type SortOption = 'level' | 'size' | 'installedBy' | 'dependencies' | 'name';

interface SortConfig {
	label: string;
	compare: (a: InstalledPackage, b: InstalledPackage) => number;
}

// #endregion

// #region constants

const SORT_OPTIONS: Record<SortOption, SortConfig> = {
	level: {
		label: 'Dependency level',
		compare: (a, b) => a.level - b.level || a.name.localeCompare(b.name),
	},
	size: {
		label: 'Package size',
		compare: (a, b) => b.size - a.size || a.name.localeCompare(b.name),
	},
	installedBy: {
		label: 'Installed by count',
		compare: (a, b) => b.dependents.length - a.dependents.length || a.name.localeCompare(b.name),
	},
	dependencies: {
		label: 'Dependencies count',
		compare: (a, b) => b.dependencies.length - a.dependencies.length || a.name.localeCompare(b.name),
	},
	name: {
		label: 'Name',
		compare: (a, b) => a.name.localeCompare(b.name),
	},
};

/** colors for the size breakdown bar segments (Tailwind 500 palette) */
const SEGMENT_COLORS = [
	tw`bg-[#ef4444]`, // red
	tw`bg-[#f97316]`, // orange
	tw`bg-[#eab308]`, // yellow
	tw`bg-[#84cc16]`, // lime
	tw`bg-[#22c55e]`, // green
	tw`bg-[#10b981]`, // emerald
	tw`bg-[#06b6d4]`, // cyan
	tw`bg-[#0ea5e9]`, // sky
	tw`bg-[#3b82f6]`, // blue
	tw`bg-[#6366f1]`, // indigo
	tw`bg-[#8b5cf6]`, // violet
	tw`bg-[#d946ef]`, // fuchsia
	tw`bg-[#ec4899]`, // pink
];

// #endregion

// #region size breakdown bar

/**
 * cyrb53 hash - fast 53-bit hash with good distribution.
 * @see https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
function cyrb53(str: string, seed = 0): number {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** derives a consistent color index from a package name */
function getCanonicalColorIndex(name: string): number {
	return cyrb53(name) % SEGMENT_COLORS.length;
}

/** threshold above which we use greedy instead of DP (for performance) */
const COLOR_RESOLUTION_DP_LIMIT = 2000;

/**
 * resolves adjacent color collisions with globally minimal adjustments.
 * uses dynamic programming to find the assignment that changes the fewest segments
 * from their canonical (hash-based) colors while ensuring no adjacent segments share a color.
 * falls back to greedy for very large inputs.
 */
function resolveColorCollisions(canonicalIndices: number[]): number[] {
	const numSegments = canonicalIndices.length;
	const numColors = SEGMENT_COLORS.length;

	if (numSegments === 0) {
		return [];
	}
	if (numSegments === 1) {
		return [canonicalIndices[0]];
	}

	// fall back to greedy for very large inputs
	if (numSegments > COLOR_RESOLUTION_DP_LIMIT) {
		const resolved: number[] = [canonicalIndices[0]];
		for (let i = 1; i < numSegments; i++) {
			const canonical = canonicalIndices[i];
			resolved.push(canonical === resolved[i - 1] ? (canonical + 1) % numColors : canonical);
		}
		return resolved;
	}

	// dp[c] = min cost to reach current position with color c
	let prev = Array.from({ length: numColors }, () => 0);
	let curr = Array.from({ length: numColors }, () => 0);

	// parent[i][c] = color of position i that led to optimal assignment at position i+1 with color c
	const parent: number[][] = [];

	// base case: position 0
	for (let c = 0; c < numColors; c++) {
		prev[c] = c === canonicalIndices[0] ? 0 : 1;
	}

	// fill DP table
	for (let i = 1; i < numSegments; i++) {
		const canonical = canonicalIndices[i];
		const parentRow = Array.from({ length: numColors }, () => 0);

		for (let c = 0; c < numColors; c++) {
			const cost = c === canonical ? 0 : 1;

			// find best previous color that isn't c
			let bestPrevCost = Infinity;
			let bestPrevColor = 0;
			for (let cp = 0; cp < numColors; cp++) {
				if (cp !== c && prev[cp] < bestPrevCost) {
					bestPrevCost = prev[cp];
					bestPrevColor = cp;
				}
			}

			curr[c] = cost + bestPrevCost;
			parentRow[c] = bestPrevColor;
		}

		parent.push(parentRow);
		[prev, curr] = [curr, prev];
	}

	// find best final color
	let bestFinal = 0;
	for (let c = 1; c < numColors; c++) {
		if (prev[c] < prev[bestFinal]) {
			bestFinal = c;
		}
	}

	// backtrack to build result (build reversed, then flip)
	let color = bestFinal;
	const reversed = [color];
	for (let i = parent.length - 1; i >= 0; i--) {
		color = parent[i][color];
		reversed.push(color);
	}
	return reversed.reverse();
}

interface SizeBreakdownBarProps {
	packages: InstalledPackage[];
	installSize: number;
}

const SizeBreakdownBar = (props: SizeBreakdownBarProps) => {
	const segments = createMemo(() => {
		// sort by size descending for the bar
		const sorted = [...props.packages].sort((a, b) => b.size - a.size);

		// compute canonical colors, then resolve adjacent collisions
		const canonicalIndices = sorted.map((pkg) => getCanonicalColorIndex(pkg.name));
		const resolvedIndices = resolveColorCollisions(canonicalIndices);

		return sorted.map((pkg, i) => ({
			pkg,
			percent: (pkg.size / props.installSize) * 100,
			color: SEGMENT_COLORS[resolvedIndices[i]],
		}));
	});

	return (
		<div class="flex h-8 w-full overflow-hidden rounded-lg">
			<For each={segments()}>
				{(segment) => (
					<Tooltip
						content={
							<>
								<span class="font-medium">{segment.pkg.name}</span>
								<span class="text-neutral-foreground-3">
									{' '}
									— {formatBytes(segment.pkg.size)} ({segment.percent.toFixed(1)}%)
								</span>
							</>
						}
						relationship="label"
						placement="bottom"
					>
						{(triggerProps) => (
							<div
								{...triggerProps}
								class={`${segment.color} duration-fast min-w-0 transition-opacity hover:opacity-80`}
								style={{ width: `${segment.percent}%` }}
								tabIndex={0}
							/>
						)}
					</Tooltip>
				)}
			</For>
		</div>
	);
};

// #endregion

// #region package card

interface PackageCardProps {
	pkg: InstalledPackage;
	installSize: number;
}

const PackageCard = (props: PackageCardProps) => {
	const percent = () => (props.pkg.size / props.installSize) * 100;

	return (
		<div class="group duration-fast flex gap-4 rounded-lg border border-transparent px-3 py-4 transition hover:border-neutral-stroke-3 hover:bg-neutral-background-1">
			{/* left side: percentage and size */}
			<div class="flex w-16 shrink-0 flex-col items-end text-right">
				<span class="text-base-400 font-semibold text-neutral-foreground-1">{percent().toFixed(0)}%</span>
				<span class="text-base-300 text-neutral-foreground-3">{formatBytes(props.pkg.size)}</span>
			</div>

			{/* main content */}
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				{/* name, version, and level */}
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-base-400 font-semibold text-neutral-foreground-1">{props.pkg.name}</span>
					<span class="my-px text-base-300 text-neutral-foreground-3">{props.pkg.version}</span>
					<Show when={props.pkg.level > 0}>
						<span class="rounded-md bg-neutral-background-3 px-1.5 py-0.5 text-base-200 font-medium text-neutral-foreground-3">
							Level {props.pkg.level}
						</span>
					</Show>
				</div>

				{/* stats */}
				<div class="flex flex-wrap gap-4 text-base-300">
					<span class="text-neutral-foreground-3">
						<span class="font-medium text-neutral-foreground-2">Installed by:</span>{' '}
						{props.pkg.dependents.length}
					</span>
					<span class="text-neutral-foreground-3">
						<span class="font-medium text-neutral-foreground-2">Dependencies:</span>{' '}
						{props.pkg.dependencies.length}
					</span>
				</div>
			</div>
		</div>
	);
};

// #endregion

// #region component

interface PackageDependenciesProps {
	packages: InstalledPackage[];
	installSize: number;
	excludePeers: boolean;
}

const PackageDependencies = (props: PackageDependenciesProps) => {
	const [filter, setFilter] = createSignal('');
	const [sortBy, setSortBy] = createSignal<SortOption>('level');

	// filter out peer packages when excludePeers is true
	const displayPackages = createMemo(() => {
		return props.excludePeers ? props.packages.filter((p) => !p.isPeer) : props.packages;
	});

	const displayInstallSize = createMemo(() => {
		return displayPackages().reduce((sum, pkg) => sum + pkg.size, 0);
	});

	const filteredAndSorted = createMemo(() => {
		const filterText = filter().toLowerCase();
		const sortConfig = SORT_OPTIONS[sortBy()];

		let result = displayPackages();

		if (filterText) {
			result = result.filter((pkg) => pkg.name.toLowerCase().includes(filterText));
		} else {
			result = [...result];
		}

		return [...result].sort(sortConfig.compare);
	});

	return (
		<div class="flex flex-col gap-5">
			{/* header with total */}
			<div class="flex flex-wrap items-baseline justify-between gap-4">
				<h3 class="text-base-400 font-semibold text-neutral-foreground-1">Install size</h3>
				<div class="text-base-300 text-neutral-foreground-2">
					<span class="text-base-400 font-semibold text-neutral-foreground-1">
						{formatBytes(displayInstallSize())}
					</span>
					<span class="text-neutral-foreground-3"> across {displayPackages().length} packages</span>
				</div>
			</div>

			{/* size breakdown bar */}
			<SizeBreakdownBar packages={displayPackages()} installSize={displayInstallSize()} />

			{/* filter and sort controls */}
			{displayPackages().length > 1 && (
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
					{/* filter input */}
					<Input
						class="sm:flex-4"
						type="text"
						placeholder="Filter packages..."
						value={filter()}
						onInput={(e) => setFilter(e.currentTarget.value)}
						contentBefore={<LucideSearch class="size-4" />}
					/>

					{/* sort dropdown */}
					<Dropdown.Root value={sortBy()} onValueChange={(v) => setSortBy(v as SortOption)}>
						<Dropdown.Trigger class="sm:flex-3">
							<span class="whitespace-pre text-neutral-foreground-3">Sort by </span>
							<span>{SORT_OPTIONS[sortBy()].label}</span>
						</Dropdown.Trigger>

						<Dropdown.Listbox>
							<For each={Object.entries(SORT_OPTIONS) as [SortOption, SortConfig][]}>
								{([key, config]) => <Dropdown.Option value={key}>{config.label}</Dropdown.Option>}
							</For>
						</Dropdown.Listbox>
					</Dropdown.Root>
				</div>
			)}

			{/* package list */}
			<div class="-mx-3 flex flex-col">
				<For each={filteredAndSorted()}>
					{(pkg) => <PackageCard pkg={pkg} installSize={displayInstallSize()} />}
				</For>

				<Show when={filteredAndSorted().length === 0}>
					<div class="py-12 text-center text-base-300 text-neutral-foreground-3">
						No packages match your filter
					</div>
				</Show>
			</div>
		</div>
	);
};

export default PackageDependencies;

// #endregion
