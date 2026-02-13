import { createEffect, onCleanup, Show, type JSX } from 'solid-js';

import { LucideCheck } from '../../icons/lucide';
import { modality } from '../../lib/modality';

import { useMenuContext, useMenuListContext } from './context';

// #region types

export interface MenuItemProps {
	/** item content */
	children: JSX.Element;
	/** icon to display before the content */
	icon?: JSX.Element;
	/** whether the item is checked (shows checkmark) */
	checked?: boolean;
	/** called when the item is selected */
	onClick?: () => void;
	/** whether the item is disabled */
	disabled?: boolean;
	/** whether clicking this item should keep the menu open */
	persistOnClick?: boolean;
}

// #endregion

// #region component

const MenuItem = (props: MenuItemProps) => {
	const ctx = useMenuContext();
	const listCtx = useMenuListContext();

	const hasCheckmarks = () => listCtx?.hasCheckmarks ?? false;
	const hasIcons = () => listCtx?.hasIcons ?? false;

	// stable ref for isFocused check
	let itemRef: HTMLElement | undefined;

	const isFocused = () => (itemRef ? ctx.rovingTabindex.isFocused(itemRef) : false);

	const handleClick = () => {
		if (props.disabled) {
			return;
		}
		props.onClick?.();
		if (!props.persistOnClick) {
			ctx.setOpen(false);
		}
	};

	const handleKeyDown = (ev: KeyboardEvent) => {
		if (props.disabled) {
			return;
		}
		if (ev.key === 'Enter' || ev.key === ' ') {
			ev.preventDefault();
			handleClick();
		}
	};

	const handleMouseMove = () => {
		if (modality() === 'pointer' && !props.disabled && itemRef) {
			// find the index of this item and focus it
			const items = ctx.popoverRef()?.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]');
			if (items) {
				const index = Array.from(items).indexOf(itemRef);
				if (index !== -1) {
					ctx.rovingTabindex.setFocusedIndex(index, true);
				}
			}
		}
	};

	return (
		<div
			ref={(el) => {
				itemRef = el;

				// register item with roving tabindex controller
				const textValue = typeof props.children === 'string' ? props.children : undefined;
				ctx.rovingTabindex.register(el, props.disabled, textValue);

				onCleanup(() => {
					ctx.rovingTabindex.unregister(el);
				});

				// scroll into view when focused via keyboard
				createEffect(() => {
					const popover = ctx.popoverRef();
					if (isFocused() && modality() === 'keyboard' && popover) {
						const padding = 4;
						const popoverRect = popover.getBoundingClientRect();
						const itemRect = el.getBoundingClientRect();

						if (itemRect.top < popoverRect.top + padding) {
							popover.scrollTop -= popoverRect.top + padding - itemRect.top;
						} else if (itemRect.bottom > popoverRect.bottom - padding) {
							popover.scrollTop += itemRect.bottom - (popoverRect.bottom - padding);
						}
					}
				});
			}}
			role={hasCheckmarks() ? 'menuitemcheckbox' : 'menuitem'}
			tabIndex={isFocused() ? 0 : -1}
			aria-checked={hasCheckmarks() ? props.checked : undefined}
			aria-disabled={props.disabled}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			onMouseMove={handleMouseMove}
			class="box-border flex min-h-8 max-w-72.5 items-center gap-1 rounded-md px-1.5 py-1.5 text-base-300 outline-none select-none"
			classList={{
				'cursor-not-allowed text-neutral-foreground-disabled': props.disabled,
				'text-neutral-foreground-2 hover:text-neutral-foreground-2-hover active:bg-neutral-background-1-pressed':
					!props.disabled,
				'bg-neutral-background-1-hover': isFocused() && !props.disabled,
			}}
		>
			{/* checkmark slot - reserve space when hasCheckmarks is true */}
			<Show when={hasCheckmarks()}>
				<span class="flex size-4 shrink-0 items-center justify-center">
					<Show when={props.checked}>
						<LucideCheck class="size-4" />
					</Show>
				</span>
			</Show>

			{/* icon slot - reserve space when hasIcons is true */}
			<Show when={hasIcons()}>
				<span class="flex size-5 shrink-0 items-center justify-center">{props.icon}</span>
			</Show>

			{/* content */}
			<span class="grow">{props.children}</span>
		</div>
	);
};

export default MenuItem;

// #endregion
