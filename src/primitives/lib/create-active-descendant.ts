import { createSignal, type Accessor } from 'solid-js';

// #region types

export interface ActiveDescendantOptions {
	/** callback when active descendant changes */
	onActiveChange?: (id: string | null) => void;
}

export interface ActiveDescendantItem {
	id: string;
	disabled?: boolean;
	/** for character search (typeahead) */
	textValue?: string;
}

export interface ActiveDescendantController {
	/** currently active item ID */
	activeId: Accessor<string | null>;
	/** set active item by ID */
	setActiveId: (id: string | null) => void;
	/** navigate to first non-disabled item */
	first: () => string | null;
	/** navigate to last non-disabled item */
	last: () => string | null;
	/** navigate to next non-disabled item (circular) */
	next: () => string | null;
	/** navigate to prev non-disabled item (circular) */
	prev: () => string | null;
	/** find item by character (typeahead) */
	search: (char: string) => string | null;
	/** register an item */
	register: (item: ActiveDescendantItem) => void;
	/** unregister an item */
	unregister: (id: string) => void;
	/** clear all items */
	clear: () => void;
}

// #endregion

// #region implementation

const SEARCH_TIMEOUT = 500;

/**
 * creates a controller for managing aria-activedescendant navigation.
 *
 * for composite widgets where focus stays on a parent element (dropdowns, comboboxes).
 *
 * @param options configuration options
 * @returns controller for managing active descendant state
 */
export function createActiveDescendant(options?: ActiveDescendantOptions): ActiveDescendantController {
	const [activeId, setActiveIdInternal] = createSignal<string | null>(null);

	// maintain insertion order for navigation
	const items: ActiveDescendantItem[] = [];

	// typeahead state
	let searchBuffer = '';
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	const setActiveId = (id: string | null) => {
		setActiveIdInternal(id);
		options?.onActiveChange?.(id);
	};

	const getEnabledItems = () => items.filter((item) => !item.disabled);

	const getActiveIndex = () => {
		const current = activeId();
		if (!current) {
			return -1;
		}
		const enabled = getEnabledItems();
		return enabled.findIndex((item) => item.id === current);
	};

	const first = (): string | null => {
		const enabled = getEnabledItems();
		if (enabled.length === 0) {
			return null;
		}
		const id = enabled[0]!.id;
		setActiveId(id);
		return id;
	};

	const last = (): string | null => {
		const enabled = getEnabledItems();
		if (enabled.length === 0) {
			return null;
		}
		const id = enabled[enabled.length - 1]!.id;
		setActiveId(id);
		return id;
	};

	const next = (): string | null => {
		const enabled = getEnabledItems();
		if (enabled.length === 0) {
			return null;
		}

		const currentIndex = getActiveIndex();
		// circular: wrap to first if at end or no current
		const nextIndex = currentIndex === -1 || currentIndex >= enabled.length - 1 ? 0 : currentIndex + 1;
		const id = enabled[nextIndex]!.id;
		setActiveId(id);
		return id;
	};

	const prev = (): string | null => {
		const enabled = getEnabledItems();
		if (enabled.length === 0) {
			return null;
		}

		const currentIndex = getActiveIndex();
		// circular: wrap to last if at start or no current
		const prevIndex = currentIndex <= 0 ? enabled.length - 1 : currentIndex - 1;
		const id = enabled[prevIndex]!.id;
		setActiveId(id);
		return id;
	};

	const search = (char: string): string | null => {
		// accumulate characters within timeout
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
		searchBuffer += char.toLowerCase();
		searchTimeout = setTimeout(() => {
			searchBuffer = '';
		}, SEARCH_TIMEOUT);

		const enabled = getEnabledItems();
		if (enabled.length === 0) {
			return null;
		}

		// start search from item after current, wrapping around
		const currentIndex = getActiveIndex();
		const startIndex = currentIndex === -1 ? 0 : currentIndex;

		for (let i = 0; i < enabled.length; i++) {
			const index = (startIndex + i) % enabled.length;
			const item = enabled[index]!;
			const textValue = item.textValue?.toLowerCase() ?? '';

			if (textValue.startsWith(searchBuffer)) {
				setActiveId(item.id);
				return item.id;
			}
		}

		return null;
	};

	const register = (item: ActiveDescendantItem) => {
		items.push(item);
	};

	const unregister = (id: string) => {
		const index = items.findIndex((item) => item.id === id);
		if (index !== -1) {
			items.splice(index, 1);
		}
	};

	const clear = () => {
		items.length = 0;
		setActiveId(null);
		searchBuffer = '';
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
	};

	return {
		activeId,
		setActiveId,
		first,
		last,
		next,
		prev,
		search,
		register,
		unregister,
		clear,
	};
}

// #endregion
