import { createEffect, createMemo, createSignal, createUniqueId, type JSX } from 'solid-js';

import { createActiveDescendant } from '../lib/create-active-descendant';

import { DropdownProvider, type DropdownContextValue } from './context';

// #region types

export interface DropdownRootProps {
	/** dropdown content (DropdownTrigger and DropdownListbox) */
	children: JSX.Element;
	/** controlled selected value */
	value?: string;
	/** default selected value for uncontrolled usage */
	defaultValue?: string;
	/** callback when selection changes */
	onValueChange?: (value: string) => void;
	/** controlled open state */
	open?: boolean;
	/** default open state for uncontrolled usage */
	defaultOpen?: boolean;
	/** callback when open state changes */
	onOpenChange?: (open: boolean) => void;
}

// #endregion

// #region component

const DropdownRoot = (props: DropdownRootProps) => {
	const triggerId = createUniqueId();
	const listboxId = createUniqueId();

	const [triggerRef, setTriggerRef] = createSignal<HTMLElement | null>(null);
	const [listboxRef, setListboxRef] = createSignal<HTMLElement | null>(null);

	// open state - support both controlled and uncontrolled
	const [internalOpen, setInternalOpen] = createSignal(props.defaultOpen ?? false);
	const open = () => props.open ?? internalOpen();
	const setOpen = (value: boolean) => {
		if (props.open === undefined) {
			setInternalOpen(value);
		}
		props.onOpenChange?.(value);
	};

	// selected value - support both controlled and uncontrolled
	const [internalValue, setInternalValue] = createSignal(props.defaultValue);
	const selectedValue = createMemo(() => props.value ?? internalValue());

	const selectOption = (value: string) => {
		if (props.value === undefined) {
			setInternalValue(value);
		}
		props.onValueChange?.(value);
		setOpen(false);
	};

	// active descendant for keyboard navigation
	const activeDescendant = createActiveDescendant();

	// map option IDs to values
	const optionValueMap = new Map<string, string>();

	const getOptionValue = (id: string) => optionValueMap.get(id);
	const registerOptionValue = (id: string, value: string) => optionValueMap.set(id, value);
	const unregisterOptionValue = (id: string) => optionValueMap.delete(id);

	// when opening, set active to selected value or first item
	createEffect(() => {
		if (open()) {
			const selected = selectedValue();
			if (selected) {
				// find the option ID for the selected value
				for (const [id, value] of optionValueMap) {
					if (value === selected) {
						activeDescendant.setActiveId(id);
						return;
					}
				}
			}
			// no selection or not found, activate first
			activeDescendant.first();
		} else {
			activeDescendant.clear();
		}
	});

	const context: DropdownContextValue = {
		open,
		setOpen,
		triggerRef,
		setTriggerRef,
		triggerId,
		listboxId,
		selectedValue,
		selectOption,
		activeDescendant,
		listboxRef,
		setListboxRef,
		getOptionValue,
		registerOptionValue,
		unregisterOptionValue,
	};

	return <DropdownProvider value={context}>{props.children}</DropdownProvider>;
};

export default DropdownRoot;

// #endregion
