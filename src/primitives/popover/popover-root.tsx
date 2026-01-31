import type { Placement } from '@floating-ui/dom';
import { createMemo, createSignal, createUniqueId, onCleanup, type JSX } from 'solid-js';

import { PopoverProvider, type PopoverContextValue } from './context';

// #region types

export interface PopoverRootProps {
	/** popover content (PopoverTrigger and PopoverSurface) */
	children: JSX.Element;
	/** controlled open state */
	open?: boolean;
	/** default open state for uncontrolled usage */
	defaultOpen?: boolean;
	/** callback when open state changes */
	onOpenChange?: (open: boolean) => void;
	/** whether to open on hover instead of click */
	openOnHover?: boolean;
	/** delay in ms before opening on hover */
	mouseEnterDelay?: number;
	/** delay in ms before closing after mouse leaves */
	mouseLeaveDelay?: number;
	/** placement of the surface relative to trigger */
	placement?: Placement;
}

// #endregion

// #region component

const PopoverRoot = (props: PopoverRootProps) => {
	const triggerId = createUniqueId();
	const surfaceId = createUniqueId();

	const [triggerRef, setTriggerRef] = createSignal<HTMLElement | null>(null);
	const [surfaceRef, setSurfaceRef] = createSignal<HTMLElement | null>(null);

	// support both controlled and uncontrolled modes
	const [internalOpen, setInternalOpen] = createSignal(props.defaultOpen ?? false);

	const open = () => props.open ?? internalOpen();

	const mouseEnterDelay = () => props.mouseEnterDelay ?? 0;
	const mouseLeaveDelay = () => props.mouseLeaveDelay ?? 500;

	let openTimeout: ReturnType<typeof setTimeout> | undefined;
	let closeTimeout: ReturnType<typeof setTimeout> | undefined;

	const clearTimeouts = () => {
		if (openTimeout) {
			clearTimeout(openTimeout);
			openTimeout = undefined;
		}
		if (closeTimeout) {
			clearTimeout(closeTimeout);
			closeTimeout = undefined;
		}
	};

	onCleanup(clearTimeouts);

	const setOpen = (value: boolean, eventType?: string) => {
		clearTimeouts();

		const updateState = (newValue: boolean) => {
			if (props.open === undefined) {
				setInternalOpen(newValue);
			}
			props.onOpenChange?.(newValue);
		};

		if (eventType === 'pointerenter') {
			// opening on hover - apply enter delay
			const delay = mouseEnterDelay();
			if (delay > 0) {
				openTimeout = setTimeout(() => updateState(true), delay);
			} else {
				updateState(true);
			}
		} else if (eventType === 'pointerleave') {
			// closing on hover - apply leave delay
			closeTimeout = setTimeout(() => updateState(false), mouseLeaveDelay());
		} else {
			// click or other events - immediate
			updateState(value);
		}
	};

	const context: PopoverContextValue = {
		open,
		setOpen,
		triggerRef,
		setTriggerRef,
		surfaceRef,
		setSurfaceRef,
		triggerId,
		surfaceId,
		placement: createMemo(() => props.placement ?? 'bottom-start'),
		openOnHover: createMemo(() => props.openOnHover ?? false),
	};

	return <PopoverProvider value={context}>{props.children}</PopoverProvider>;
};

export default PopoverRoot;

// #endregion
