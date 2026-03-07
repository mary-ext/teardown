import { createContext, useContext, type Accessor } from 'solid-js';

import type { ActiveDescendantController } from '../lib/create-active-descendant';

// #region types

export interface DropdownContextValue {
	/** whether the listbox is open */
	open: Accessor<boolean>;
	/** set the listbox open state */
	setOpen: (open: boolean) => void;
	/** the trigger element ref */
	triggerRef: Accessor<HTMLElement | null>;
	/** set the trigger element ref */
	setTriggerRef: (el: HTMLElement | null) => void;
	/** unique ID for the trigger */
	triggerId: string;
	/** unique ID for the listbox */
	listboxId: string;
	/** currently selected value */
	selectedValue: Accessor<string | undefined>;
	/** select an option by value */
	selectOption: (value: string) => void;
	/** active descendant controller for keyboard navigation */
	activeDescendant: ActiveDescendantController;
	/** the listbox element ref for scrolling */
	listboxRef: Accessor<HTMLElement | null>;
	/** set the listbox element ref */
	setListboxRef: (el: HTMLElement | null) => void;
	/** map from option ID to option value */
	getOptionValue: (id: string) => string | undefined;
	/** register option value for an ID */
	registerOptionValue: (id: string, value: string) => void;
	/** unregister option value for an ID */
	unregisterOptionValue: (id: string) => void;
}

// #endregion

// #region context

const DropdownContext = createContext<DropdownContextValue>();

export const DropdownProvider = DropdownContext.Provider;

export function useDropdownContext(): DropdownContextValue {
	const ctx = useContext(DropdownContext);
	if (!ctx) {
		throw new Error('Dropdown components must be used within a Dropdown.Root');
	}
	return ctx;
}

// #endregion
