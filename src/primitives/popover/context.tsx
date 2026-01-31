import type { Placement } from '@floating-ui/dom';
import { createContext, useContext, type Accessor } from 'solid-js';

// #region types

export interface PopoverContextValue {
	/** whether the popover is open */
	open: Accessor<boolean>;
	/** set the popover open state */
	setOpen: (open: boolean, eventType?: string) => void;
	/** the trigger element ref */
	triggerRef: Accessor<HTMLElement | null>;
	/** set the trigger element ref */
	setTriggerRef: (el: HTMLElement | null) => void;
	/** the surface element ref */
	surfaceRef: Accessor<HTMLElement | null>;
	/** set the surface element ref */
	setSurfaceRef: (el: HTMLElement | null) => void;
	/** unique ID for the trigger */
	triggerId: string;
	/** unique ID for the surface */
	surfaceId: string;
	/** placement for the surface */
	placement: Accessor<Placement>;
	/** whether to open on hover */
	openOnHover: Accessor<boolean>;
}

// #endregion

// #region context

const PopoverContext = createContext<PopoverContextValue>();

export const PopoverProvider = PopoverContext.Provider;

export function usePopoverContext(): PopoverContextValue {
	const ctx = useContext(PopoverContext);
	if (!ctx) {
		throw new Error('Popover components must be used within a Popover.Root');
	}
	return ctx;
}

// #endregion
