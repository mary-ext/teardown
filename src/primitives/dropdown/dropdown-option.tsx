import { createEffect, createUniqueId, onCleanup, Show, type JSX } from 'solid-js';

import { LucideCheck } from '../../icons/lucide';
import { modality } from '../../lib/modality';
import { scrollIntoContainerView } from '../../lib/scroll';

import { useDropdownContext } from './context';

// #region types

export interface DropdownOptionProps {
	/** option content (display label) */
	children: JSX.Element;
	/** option value (defaults to children if string) */
	value: string;
	/** whether the option is disabled */
	disabled?: boolean;
}

// #endregion

// #region component

const DropdownOption = (props: DropdownOptionProps) => {
	const ctx = useDropdownContext();
	const optionId = createUniqueId();

	const isSelected = () => ctx.selectedValue() === props.value;
	const isActive = () => ctx.activeDescendant.activeId() === optionId;

	const handleClick = () => {
		if (props.disabled) {
			return;
		}
		ctx.selectOption(props.value);
	};

	const handleMouseMove = () => {
		if (modality() === 'pointer' && !props.disabled) {
			ctx.activeDescendant.setActiveId(optionId);
		}
	};

	return (
		<div
			ref={(el) => {
				// register option with active descendant controller
				const textValue = typeof props.children === 'string' ? props.children : props.value;
				ctx.activeDescendant.register({
					id: optionId,
					disabled: props.disabled,
					textValue,
				});
				ctx.registerOptionValue(optionId, props.value);

				onCleanup(() => {
					ctx.activeDescendant.unregister(optionId);
					ctx.unregisterOptionValue(optionId);
				});

				// scroll into view when active changes via keyboard
				createEffect(() => {
					const listbox = ctx.listboxRef();
					if (isActive() && modality() === 'keyboard' && listbox) {
						scrollIntoContainerView(listbox, el);
					}
				});
			}}
			id={optionId}
			role="option"
			tabIndex={-1}
			aria-selected={isSelected()}
			aria-disabled={props.disabled}
			onClick={handleClick}
			onMouseMove={handleMouseMove}
			class="box-border flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-base-300 outline-none select-none"
			classList={{
				'cursor-not-allowed text-neutral-foreground-disabled': props.disabled,
				'text-neutral-foreground-2 hover:text-neutral-foreground-2-hover active:bg-neutral-background-1-pressed':
					!props.disabled,
				'bg-neutral-background-1-hover': isActive() && !props.disabled,
			}}
		>
			{/* checkmark for selected state */}
			<span class="flex size-4 shrink-0 items-center justify-center">
				<Show when={isSelected()}>
					<LucideCheck class="size-4" />
				</Show>
			</span>

			{/* content */}
			<span class="min-w-0 grow wrap-break-word">{props.children}</span>
		</div>
	);
};

export default DropdownOption;

// #endregion
