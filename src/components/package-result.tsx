import { createSignal, Show } from 'solid-js';

import type { PackageSession } from '../npm/worker-client';

import PackageBundle from './package-bundle';
import PackageDependencies from './package-dependencies';

// #region component

interface PackageResultProps {
	result: PackageSession;
}

const PackageResult = (props: PackageResultProps) => {
	const result = props.result;

	const [excludePeers, setExcludePeers] = createSignal(false);

	const hasPeerDeps = result.peerDependencies.length > 0;

	return (
		<div class="flex flex-col gap-8">
			{/* package header */}
			<div class="flex flex-wrap gap-3">
				<h2 class="min-w-0 text-base-600 font-bold wrap-break-word text-neutral-foreground-1">
					{result.name}
				</h2>

				<span class="my-1.25 text-base-400 text-neutral-foreground-3">{result.version}</span>
			</div>

			{/* peer deps toggle */}
			<Show when={hasPeerDeps}>
				<label class="flex items-center gap-2 text-base-300 text-neutral-foreground-2">
					<input
						type="checkbox"
						checked={excludePeers()}
						onChange={(e) => setExcludePeers(e.currentTarget.checked)}
						class="accent-brand-background-1 size-4"
					/>
					<span>Exclude peer dependencies</span>
				</label>
			</Show>

			{/* bundle size section */}
			{result.subpaths.defaultSubpath !== null && (
				<>
					<PackageBundle
						packageName={/* @once */ result.name}
						subpaths={/* @once */ result.subpaths}
						worker={/* @once */ result.worker}
						excludePeers={excludePeers()}
						peerDependencies={/* @once */ result.peerDependencies}
					/>
					<hr class="border-neutral-stroke-3" />
				</>
			)}

			{/* install size section */}
			<PackageDependencies
				packages={/* @once */ result.packages}
				installSize={/* @once */ result.installSize}
				excludePeers={excludePeers()}
			/>
		</div>
	);
};

export default PackageResult;

// #endregion
