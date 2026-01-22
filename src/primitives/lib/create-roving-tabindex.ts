import { createSignal, type Accessor } from 'solid-js';

// #region types

export interface RovingTabindexOptions {
	/** callback when focused index changes */
	onFocusChange?: (index: number) => void;
}

interface RovingTabindexItem {
	el: HTMLElement;
	disabled?: boolean;
	textValue?: string;
}

export interface RovingTabindexController {
	/** currently focused index (-1 if none) */
	focusedIndex: Accessor<number>;
	/** set focused index and optionally focus the element */
	setFocusedIndex: (index: number, focus?: boolean) => void;
	/** navigate and focus first non-disabled item */
	first: () => void;
	/** navigate and focus last non-disabled item */
	last: () => void;
	/** navigate and focus next non-disabled item (circular) */
	next: () => void;
	/** navigate and focus prev non-disabled item (circular) */
	prev: () => void;
	/** find and focus item by character (typeahead) */
	search: (char: string) => void;
	/** register an item element */
	register: (el: HTMLElement, disabled?: boolean, textValue?: string) => void;
	/** unregister an item element */
	unregister: (el: HTMLElement) => void;
	/** check if an element is the focused one */
	isFocused: (el: HTMLElement) => boolean;
	/** clear all items */
	clear: () => void;
}

// #endregion

// #region implementation

const SEARCH_TIMEOUT = 500;

/**
 * creates a controller for managing roving tabindex navigation.
 *
 * for composite widgets where DOM focus moves between items (menus, toolbars).
 *
 * @param options configuration options
 * @returns controller for managing roving tabindex state
 */
export function createRovingTabindex(options?: RovingTabindexOptions): RovingTabindexController {
	const [focusedIndex, setFocusedIndexInternal] = createSignal(-1);

	// maintain insertion order for navigation
	const items: RovingTabindexItem[] = [];

	// typeahead state
	let searchBuffer = '';
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	const setFocusedIndex = (index: number, focus = true) => {
		setFocusedIndexInternal(index);
		options?.onFocusChange?.(index);

		if (focus && index >= 0 && index < items.length) {
			items[index].el.focus();
		}
	};

	const getEnabledIndices = (): number[] => {
		const indices: number[] = [];
		for (let i = 0; i < items.length; i++) {
			if (!items[i].disabled) {
				indices.push(i);
			}
		}
		return indices;
	};

	const first = () => {
		const enabled = getEnabledIndices();
		if (enabled.length === 0) {
			return;
		}
		setFocusedIndex(enabled[0]);
	};

	const last = () => {
		const enabled = getEnabledIndices();
		if (enabled.length === 0) {
			return;
		}
		setFocusedIndex(enabled[enabled.length - 1]);
	};

	const next = () => {
		const enabled = getEnabledIndices();
		if (enabled.length === 0) {
			return;
		}

		const current = focusedIndex();
		// find position in enabled array
		const currentPos = enabled.indexOf(current);
		// circular: wrap to first if at end or not found
		const nextPos = currentPos === -1 || currentPos >= enabled.length - 1 ? 0 : currentPos + 1;
		setFocusedIndex(enabled[nextPos]);
	};

	const prev = () => {
		const enabled = getEnabledIndices();
		if (enabled.length === 0) {
			return;
		}

		const current = focusedIndex();
		// find position in enabled array
		const currentPos = enabled.indexOf(current);
		// circular: wrap to last if at start or not found
		const prevPos = currentPos <= 0 ? enabled.length - 1 : currentPos - 1;
		setFocusedIndex(enabled[prevPos]);
	};

	const search = (char: string) => {
		// accumulate characters within timeout
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
		searchBuffer += char.toLowerCase();
		searchTimeout = setTimeout(() => {
			searchBuffer = '';
		}, SEARCH_TIMEOUT);

		const enabled = getEnabledIndices();
		if (enabled.length === 0) {
			return;
		}

		// start search from item after current, wrapping around
		const current = focusedIndex();
		const currentPos = enabled.indexOf(current);
		const startPos = currentPos === -1 ? 0 : currentPos;

		for (let i = 0; i < enabled.length; i++) {
			const pos = (startPos + i) % enabled.length;
			const index = enabled[pos];
			const item = items[index];
			const textValue = item.textValue?.toLowerCase() ?? item.el.textContent?.toLowerCase() ?? '';

			if (textValue.startsWith(searchBuffer)) {
				setFocusedIndex(index);
				return;
			}
		}
	};

	const register = (el: HTMLElement, disabled?: boolean, textValue?: string) => {
		items.push({ el, disabled, textValue });
	};

	const unregister = (el: HTMLElement) => {
		const index = items.findIndex((item) => item.el === el);
		if (index !== -1) {
			items.splice(index, 1);
			// adjust focused index if needed
			const current = focusedIndex();
			if (current >= index) {
				setFocusedIndexInternal(Math.max(-1, current - 1));
			}
		}
	};

	const isFocused = (el: HTMLElement): boolean => {
		const index = items.findIndex((item) => item.el === el);
		return index !== -1 && index === focusedIndex();
	};

	const clear = () => {
		items.length = 0;
		setFocusedIndexInternal(-1);
		searchBuffer = '';
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
	};

	return {
		focusedIndex,
		setFocusedIndex,
		first,
		last,
		next,
		prev,
		search,
		register,
		unregister,
		isFocused,
		clear,
	};
}

// #endregion
