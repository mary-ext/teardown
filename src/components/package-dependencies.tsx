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

/** colors for the size breakdown bar segments */
const SEGMENT_COLORS = [
	tw`bg-[#f97316]`, // orange
	tw`bg-[#eab308]`, // yellow
	tw`bg-[#22c55e]`, // green
	tw`bg-[#06b6d4]`, // cyan
	tw`bg-[#3b82f6]`, // blue
	tw`bg-[#8b5cf6]`, // violet
	tw`bg-[#ec4899]`, // pink
	tw`bg-[#f43f5e]`, // rose
];

// #endregion

// #region size breakdown bar

interface SizeBreakdownBarProps {
	packages: InstalledPackage[];
	installSize: number;
}

const SizeBreakdownBar = (props: SizeBreakdownBarProps) => {
	const segments = createMemo(() => {
		// sort by size descending for the bar
		const sorted = [...props.packages].sort((a, b) => b.size - a.size);
		return sorted.map((pkg, i) => ({
			pkg,
			percent: (pkg.size / props.installSize) * 100,
			color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
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

				{/* description */}
				<Show when={props.pkg.description}>
					<p class="line-clamp-2 text-base-300 text-neutral-foreground-2">{props.pkg.description}</p>
				</Show>

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
			result = result.filter(
				(pkg) =>
					pkg.name.toLowerCase().includes(filterText) || pkg.description?.toLowerCase().includes(filterText),
			);
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
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
				{/* filter input */}
				<Input
					class="sm:flex-1"
					type="text"
					placeholder="Filter packages..."
					value={filter()}
					onInput={(e) => setFilter(e.currentTarget.value)}
					contentBefore={<LucideSearch class="size-4" />}
				/>

				{/* sort dropdown */}
				<Dropdown.Root value={sortBy()} onValueChange={(v) => setSortBy(v as SortOption)}>
					<Dropdown.Trigger class="w-auto">
						<span class="mr-1 text-neutral-foreground-3">Sort:</span>
						<span>{SORT_OPTIONS[sortBy()].label}</span>
					</Dropdown.Trigger>
					<Dropdown.Listbox>
						<For each={Object.entries(SORT_OPTIONS) as [SortOption, SortConfig][]}>
							{([key, config]) => <Dropdown.Option value={key}>{config.label}</Dropdown.Option>}
						</For>
					</Dropdown.Listbox>
				</Dropdown.Root>
			</div>

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
