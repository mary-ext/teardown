import { createEffect, createMemo, createSignal, For, Match, onCleanup, Switch } from 'solid-js';

import { LucideCircleAlert, LucideLoader } from '../icons/lucide';
import { formatPackageSpecifier } from '../lib/package-name';
import { createQuery } from '../lib/query';
import { progress } from '../npm/events';
import { pickPackageVersion, type PackageManifest } from '../npm/packument';
import type { ProgressMessage } from '../npm/types';
import { initPackage } from '../npm/worker-client';
import Button from '../primitives/button';
import * as Dropdown from '../primitives/dropdown';
import Toggle from '../primitives/toggle';

import PackageBundle from './package-bundle';
import PackageDependencies from './package-dependencies';

// #region component

interface PackageResultProps {
	manifest: PackageManifest;
	range: string;
	onVersionChange: (version: string) => void;
}

const PackageResult = (props: PackageResultProps) => {
	const manifest = props.manifest;

	const version = createMemo(() => pickPackageVersion(manifest, props.range));

	const [session, { refetch }] = createQuery(
		() => {
			const picked = version();
			return picked
				? formatPackageSpecifier({ registry: manifest.registry, name: manifest.name, range: picked })
				: undefined;
		},
		(s) => initPackage(s),
		{ keepPreviousData: false },
	);

	createEffect(() => {
		const $session = session();
		if (!$session) {
			return;
		}

		onCleanup(() => $session.worker.terminate());
	});

	const [excludePeers, setExcludePeers] = createSignal(false);

	return (
		<div class="flex flex-col gap-4">
			<div class="flex flex-wrap items-baseline gap-3">
				<h2 class="min-w-0 text-base-600 font-bold wrap-break-word text-neutral-foreground-1">
					{manifest.name}
				</h2>

				<Dropdown.Root value={version()} onValueChange={props.onVersionChange}>
					<Dropdown.Trigger>{version() ?? props.range}</Dropdown.Trigger>
					<Dropdown.Listbox>
						<For each={/* @once */ manifest.availableVersions}>
							{(v) => <Dropdown.Option value={v}>{v}</Dropdown.Option>}
						</For>
					</Dropdown.Listbox>
				</Dropdown.Root>
			</div>

			<Switch>
				<Match when={!version()}>
					<div class="flex flex-col items-center justify-center gap-3 py-12">
						<LucideCircleAlert class="text-danger-foreground-1 size-5" />
						<span class="text-base-300 text-neutral-foreground-2">
							No version of {manifest.name} satisfies {props.range}
						</span>
					</div>
				</Match>

				<Match when={session()} keyed>
					{(s) => {
						const hasPeerDeps = s.peerDependencies.length > 0;
						const hasSubpaths = s.subpaths.defaultSubpath !== null;

						return (
							<>
								{s.description && <p class="text-base-300 text-neutral-foreground-2">{s.description}</p>}

								{hasPeerDeps && (
									<>
										<Toggle
											checked={excludePeers()}
											onChange={(ev) => setExcludePeers(ev.currentTarget.checked)}
											class="-mx-2"
										>
											Exclude peer dependencies
										</Toggle>

										<hr class="mb-4 border-neutral-stroke-3" />
									</>
								)}

								{hasSubpaths && (
									<>
										<PackageBundle
											packageName={/* @once */ s.name}
											subpaths={/* @once */ s.subpaths}
											worker={/* @once */ s.worker}
											excludePeers={excludePeers()}
											peerDependencies={/* @once */ s.peerDependencies}
										/>

										<hr class="my-4 border-neutral-stroke-3" />
									</>
								)}

								<PackageDependencies
									packages={/* @once */ s.packages}
									installSize={/* @once */ s.installSize}
									excludePeers={excludePeers()}
								/>
							</>
						);
					}}
				</Match>

				<Match when={session.state === 'errored'}>
					<div class="flex flex-col items-center justify-center gap-3 py-12">
						<LucideCircleAlert class="text-danger-foreground-1 size-5" />
						<span class="text-base-300 text-neutral-foreground-2">{session.error?.message}</span>
						<Button appearance="subtle" onClick={() => refetch()}>
							Retry
						</Button>
					</div>
				</Match>

				<Match when>
					<InstallProgress />
				</Match>
			</Switch>
		</div>
	);
};

export default PackageResult;

// #endregion

// #region InstallProgress

const InstallProgress = () => {
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
						return <span class="text-base-300 text-neutral-foreground-2">Installing...</span>;
				}
			})()}
		</div>
	);
};

// #endregion
