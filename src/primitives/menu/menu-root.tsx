import type { Placement } from '@floating-ui/dom';
import { createEffect, createMemo, createSignal, createUniqueId, type JSX } from 'solid-js';

import { createRovingTabindex } from '../lib/create-roving-tabindex';

import { MenuProvider, type MenuContextValue } from './context';

// #region types

export interface MenuRootProps {
	/** menu content (MenuTrigger and MenuPopover) */
	children: JSX.Element;
	/** controlled open state */
	open?: boolean;
	/** default open state for uncontrolled usage */
	defaultOpen?: boolean;
	/** callback when open state changes */
	onOpenChange?: (open: boolean) => void;
	/** placement of the menu popover relative to trigger */
	placement?: Placement;
}

// #endregion

// #region component

const MenuRoot = (props: MenuRootProps) => {
	const triggerId = createUniqueId();
	const menuId = createUniqueId();

	const [triggerRef, setTriggerRef] = createSignal<HTMLElement | null>(null);
	const [popoverRef, setPopoverRef] = createSignal<HTMLElement | null>(null);

	// support both controlled and uncontrolled modes
	const [internalOpen, setInternalOpen] = createSignal(props.defaultOpen ?? false);

	const open = () => props.open ?? internalOpen();
	const setOpen = (value: boolean) => {
		if (props.open === undefined) {
			setInternalOpen(value);
		}
		props.onOpenChange?.(value);
	};

	// roving tabindex for keyboard navigation
	const rovingTabindex = createRovingTabindex();

	// when closing, clear items
	createEffect(() => {
		if (!open()) {
			rovingTabindex.clear();
		}
	});

	const context: MenuContextValue = {
		open,
		setOpen,
		triggerRef,
		setTriggerRef,
		triggerId,
		menuId,
		placement: createMemo(() => props.placement ?? 'bottom-start'),
		rovingTabindex,
		popoverRef,
		setPopoverRef,
	};

	return <MenuProvider value={context}>{props.children}</MenuProvider>;
};

export default MenuRoot;

// #endregion
