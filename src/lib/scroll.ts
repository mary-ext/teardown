/**
 * scrolls a container so that the given item is visible, with padding.
 * adjusts `scrollTop` minimally — only scrolls if the item is partially or fully outside view.
 *
 * @param container the scrollable container element
 * @param item the item element to scroll into view
 * @param padding pixels of padding inside the container edges
 */
export function scrollIntoContainerView(container: HTMLElement, item: HTMLElement, padding = 4): void {
	const containerRect = container.getBoundingClientRect();
	const itemRect = item.getBoundingClientRect();

	if (itemRect.top < containerRect.top + padding) {
		container.scrollTop -= containerRect.top + padding - itemRect.top;
	} else if (itemRect.bottom > containerRect.bottom - padding) {
		container.scrollTop += itemRect.bottom - (containerRect.bottom - padding);
	}
}
