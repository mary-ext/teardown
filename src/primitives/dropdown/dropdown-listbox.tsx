import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { createEffect, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useDropdownContext } from './context';

// #region types

export interface DropdownListboxProps {
	/** listbox content (DropdownOption components) */
	children: JSX.Element;
}

// #endregion

// #region component

const DropdownListbox = (props: DropdownListboxProps) => {
	const ctx = useDropdownContext();

	return (
		<>
			{ctx.open() && (
				<Portal>
					<div
						ref={(el) => {
							ctx.setListboxRef(el);
							onCleanup(() => {
								ctx.setListboxRef(null);
							});

							createEffect(() => {
								const trigger = ctx.triggerRef();
								if (!trigger) {
									return;
								}

								const updatePosition = async () => {
									const { x, y } = await computePosition(trigger, el, {
										placement: 'bottom-start',
										strategy: 'absolute',
										middleware: [
											offset(4),
											flip(),
											shift({ padding: 8 }),
											size({
												padding: 8,
												apply({ availableWidth }) {
													Object.assign(el.style, {
														maxWidth: `${availableWidth}px`,
													});
												},
											}),
										],
									});

									Object.assign(el.style, {
										position: 'absolute',
										left: `${x}px`,
										top: `${y}px`,
										minWidth: `${trigger.offsetWidth}px`,
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

								// handle escape key to close
								const handleKeyDown = (ev: KeyboardEvent) => {
									if (ev.key === 'Escape') {
										ev.preventDefault();
										ctx.setOpen(false);
										ctx.triggerRef()?.focus();
									}
								};

								document.addEventListener('mousedown', handleClickOutside);
								document.addEventListener('keydown', handleKeyDown);

								onCleanup(() => {
									document.removeEventListener('mousedown', handleClickOutside);
									document.removeEventListener('keydown', handleKeyDown);
								});
							}
						}}
						id={ctx.listboxId}
						role="listbox"
						aria-labelledby={ctx.triggerId}
						class="fixed z-50 box-border flex max-h-80 min-w-34.5 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-md border border-transparent-stroke bg-neutral-background-1 p-1 shadow-16"
					>
						{props.children}
					</div>
				</Portal>
			)}
		</>
	);
};

export default DropdownListbox;

// #endregion
