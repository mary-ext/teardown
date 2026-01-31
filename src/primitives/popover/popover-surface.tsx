import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

import { usePopoverContext } from './context';

// #region types

export interface PopoverSurfaceProps {
	/** popover content */
	children: JSX.Element;
	/** additional class names */
	class?: string;
}

// #endregion

// #region component

const PopoverSurface = (props: PopoverSurfaceProps) => {
	const ctx = usePopoverContext();

	const handlePointerEnter = () => {
		if (ctx.openOnHover()) {
			ctx.setOpen(true, 'pointerenter');
		}
	};

	const handlePointerLeave = () => {
		if (ctx.openOnHover()) {
			ctx.setOpen(false, 'pointerleave');
		}
	};

	return (
		<>
			{ctx.open() && (
				<Portal>
					<div
						ref={(el) => {
							ctx.setSurfaceRef(el);

							onMount(() => {
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
									// handle click outside to close (only in click mode)
									const handleClickOutside = (ev: MouseEvent) => {
										if (ctx.openOnHover()) {
											return;
										}
										const currentTrigger = ctx.triggerRef();
										if (
											!el.contains(ev.target as Node) &&
											currentTrigger &&
											!currentTrigger.contains(ev.target as Node)
										) {
											ctx.setOpen(false, 'clickoutside');
										}
									};

									// handle escape key to close
									const handleKeyDown = (ev: KeyboardEvent) => {
										if (ev.key === 'Escape') {
											ev.preventDefault();
											ctx.setOpen(false, 'escape');
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
							});

							onCleanup(() => {
								ctx.setSurfaceRef(null);
							});
						}}
						id={ctx.surfaceId}
						role="dialog"
						aria-labelledby={ctx.triggerId}
						onPointerEnter={handlePointerEnter}
						onPointerLeave={handlePointerLeave}
						class={`fixed z-50 box-border rounded-md border border-transparent-stroke bg-neutral-background-1 p-3 text-base-300 text-neutral-foreground-1 shadow-16 ${props.class ?? ''}`}
					>
						{props.children}
					</div>
				</Portal>
			)}
		</>
	);
};

export default PopoverSurface;

// #endregion
