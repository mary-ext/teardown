import clsx from 'clsx';
import { createUniqueId, splitProps, type JSX } from 'solid-js';

export interface ToggleProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
	children: JSX.Element;
}

const Toggle = (props: ToggleProps) => {
	const [local, rest] = splitProps(props, ['children', 'class', 'id']);

	const id = createUniqueId();

	return (
		<div class={clsx('relative inline-flex items-start', local.class)}>
			<input
				id={id}
				type="checkbox"
				role="switch"
				class={clsx(`peer absolute top-0 left-0 h-9 w-14 opacity-0 outline-none`)}
				{...rest}
			/>

			<div
				aria-hidden="true"
				class={clsx(
					`pointer-events-none m-2 h-5 w-10 shrink-0 rounded-full border transition duration-200 ease-fluent`,

					`border-neutral-stroke-accessible peer-hover:border-neutral-stroke-accessible-hover peer-active:border-neutral-stroke-accessible-pressed peer-disabled:border-neutral-stroke-disabled`,
					`p peer-checked:border-transparent-stroke peer-checked:bg-compound-brand-background peer-checked:peer-hover:border-transparent-stroke-interactive peer-checked:peer-hover:bg-compound-brand-background-hover peer-checked:peer-active:border-transparent-stroke-interactive peer-checked:peer-active:bg-compound-brand-background-pressed peer-checked:peer-disabled:border-transparent-stroke-disabled peer-checked:peer-disabled:bg-neutral-background-disabled`,
				)}
			></div>

			<div
				aria-hidden="true"
				class={clsx(
					`pointer-events-none absolute top-0 left-0 m-2.75 size-3.5 rounded-full transition duration-200 ease-fluent`,

					`peer-checked:translate-x-5`,

					`bg-neutral-stroke-accessible peer-hover:bg-neutral-stroke-accessible-hover peer-active:bg-neutral-stroke-accessible-pressed peer-disabled:bg-neutral-foreground-disabled`,
					`peer-checked:bg-neutral-foreground-inverted peer-checked:peer-hover:bg-neutral-foreground-inverted peer-checked:peer-active:bg-neutral-foreground-inverted peer-checked:peer-disabled:bg-neutral-foreground-disabled`,
				)}
			></div>

			<div
				aria-hidden="true"
				class="pointer-events-none absolute inset-0 rounded-md outline-2 outline-transparent peer-focus-visible:outline-stroke-focus-2"
			></div>

			<label
				for={id}
				class={clsx(
					`p-2 text-base-300 select-none`,
					`text-neutral-foreground-1 peer-disabled:text-neutral-foreground-disabled`,
				)}
			>
				{local.children}
			</label>
		</div>
	);
};

export default Toggle;
