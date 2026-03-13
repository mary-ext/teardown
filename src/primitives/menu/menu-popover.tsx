import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useMenuContext } from './context';

// #region types

export interface MenuPopoverProps {
	/** menu content (typically MenuList) */
	children: JSX.Element;
}

// #endregion

// #region component

const MenuPopover = (props: MenuPopoverProps) => {
	const ctx = useMenuContext();

	const handleKeyDown = (ev: KeyboardEvent) => {
		switch (ev.key) {
			case 'ArrowDown': {
				ev.preventDefault();
				ctx.rovingTabindex.next();
				break;
			}
			case 'ArrowUp': {
				ev.preventDefault();
				ctx.rovingTabindex.prev();
				break;
			}
			case 'Home': {
				ev.preventDefault();
				ctx.rovingTabindex.first();
				break;
			}
			case 'End': {
				ev.preventDefault();
				ctx.rovingTabindex.last();
				break;
			}
			case 'Escape': {
				ev.preventDefault();
				ctx.setOpen(false);
				ctx.triggerRef()?.focus();
				break;
			}
			default: {
				// character search (typeahead)
				if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
					ctx.rovingTabindex.search(ev.key);
				}
			}
		}
	};

	return (
		<>
			{ctx.open() && (
				<Portal>
					<div
						ref={(el) => {
							ctx.setPopoverRef(el);
							onCleanup(() => {
								ctx.setPopoverRef(null);
							});

							onMount(() => {
								// focus first item after items are registered
								requestAnimationFrame(() => {
									ctx.rovingTabindex.first();
								});
							});

							createEffect(() => {
								const trigger = ctx.triggerRef();
								if (!trigger) {
									return;
								}

								const placement = ctx.placement();

								const updatePosition = async () => {
									const { x, y } = await computePosition(trigger, el, {
										placement: placement,
										strategy: 'absolute',
										middleware: [offset(4), flip(), shift({ padding: 8 })],
									});

									Object.assign(el.style, {
										position: 'absolute',
										left: `${x}px`,
										top: `${y}px`,
									});
								};

								onCleanup(autoUpdate(trigger, el, updatePosition));
							});

							{
								// handle click outside to close
								const handleClickOutside = (ev: MouseEvent) => {
									const currentTrigger = ctx.triggerRef();
									if (
										// oxlint-disable-next-line typescript/no-unsafe-type-assertion
										!el.contains(ev.target as Node) &&
										currentTrigger &&
										// oxlint-disable-next-line typescript/no-unsafe-type-assertion
										!currentTrigger.contains(ev.target as Node)
									) {
										ctx.setOpen(false);
									}
								};

								document.addEventListener('mousedown', handleClickOutside);

								onCleanup(() => {
									document.removeEventListener('mousedown', handleClickOutside);
								});
							}
						}}
						id={ctx.menuId}
						role="menu"
						aria-labelledby={ctx.triggerId}
						onKeyDown={handleKeyDown}
						class="fixed z-50 box-border max-w-75 min-w-34.5 overflow-hidden rounded-md border border-transparent-stroke bg-neutral-background-1 p-1 text-base-300 text-neutral-foreground-1 shadow-16"
					>
						{props.children}
					</div>
				</Portal>
			)}
		</>
	);
};

export default MenuPopover;

// #endregion
