import type { Placement } from '@floating-ui/dom';
import { createContext, useContext, type Accessor } from 'solid-js';

import type { RovingTabindexController } from '../lib/create-roving-tabindex';

// #region types

export interface MenuContextValue {
	/** whether the menu is open */
	open: Accessor<boolean>;
	/** set the menu open state */
	setOpen: (open: boolean) => void;
	/** the trigger element ref */
	triggerRef: Accessor<HTMLElement | null>;
	/** set the trigger element ref */
	setTriggerRef: (el: HTMLElement | null) => void;
	/** unique ID for the trigger */
	triggerId: string;
	/** unique ID for the menu */
	menuId: string;
	/** placement for the popover */
	placement: () => Placement;
	/** roving tabindex controller for keyboard navigation */
	rovingTabindex: RovingTabindexController;
	/** the popover element ref for scrolling */
	popoverRef: Accessor<HTMLElement | null>;
	/** set the popover element ref */
	setPopoverRef: (el: HTMLElement | null) => void;
}

export interface MenuListContextValue {
	/** whether menu items should reserve space for checkmarks */
	hasCheckmarks: boolean;
	/** whether menu items should reserve space for icons */
	hasIcons: boolean;
}

// #endregion

// #region menu context

const MenuContext = createContext<MenuContextValue>();

export const MenuProvider = MenuContext.Provider;

export function useMenuContext(): MenuContextValue {
	const ctx = useContext(MenuContext);
	if (!ctx) {
		throw new Error('Menu components must be used within a Menu.Root');
	}
	return ctx;
}

// #endregion

// #region menu list context

const MenuListContext = createContext<MenuListContextValue>();

export const MenuListProvider = MenuListContext.Provider;

export function useMenuListContext(): MenuListContextValue | undefined {
	return useContext(MenuListContext);
}

// #endregion
