import type { PackageSession } from '../npm/worker-client';

import PackageBundle from './package-bundle';
import PackageDependencies from './package-dependencies';

// #region component

interface PackageResultProps {
	result: PackageSession;
}

const PackageResult = (props: PackageResultProps) => {
	const result = props.result;

	return (
		<div class="flex flex-col gap-8">
			{/* package header */}
			<div class="flex flex-wrap gap-3">
				<h2 class="min-w-0 text-base-600 font-bold wrap-break-word text-neutral-foreground-1">
					{result.name}
				</h2>

				<span class="my-1.25 text-base-400 text-neutral-foreground-3">{result.version}</span>
			</div>

			{/* bundle size section */}
			{result.subpaths.defaultSubpath !== null && (
				<>
					<PackageBundle
						packageName={/* @once */ result.name}
						subpaths={/* @once */ result.subpaths}
						worker={/* @once */ result.worker}
					/>
					<hr class="border-neutral-stroke-3" />
				</>
			)}

			{/* install size section */}
			<PackageDependencies
				packages={/* @once */ result.packages}
				installSize={/* @once */ result.installSize}
			/>
		</div>
	);
};

export default PackageResult;

// #endregion
