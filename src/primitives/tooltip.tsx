import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
import { createEffect, createSignal, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

// #region types

export type TooltipRelationship = 'label' | 'description' | 'inaccessible';

export interface TooltipTriggerProps {
	ref: (el: HTMLElement) => void;
	onPointerEnter: () => void;
	onPointerLeave: () => void;
	onFocus: () => void;
	onBlur: () => void;
	'aria-labelledby'?: string | undefined;
	'aria-describedby'?: string | undefined;
}

export interface TooltipProps {
	/** render prop that receives trigger props to spread onto your element */
	children: (props: TooltipTriggerProps) => JSX.Element;
	/** tooltip content */
	content: JSX.Element;
	/** how the tooltip relates to its trigger for accessibility */
	relationship: TooltipRelationship;
	/** positioning relative to trigger */
	placement?: Placement;
	/** delay before showing in ms */
	showDelay?: number;
	/** delay before hiding in ms */
	hideDelay?: number;
}

// #endregion

// #region component

const Tooltip = (props: TooltipProps) => {
	const tooltipId = createUniqueId();

	let showTimeout: ReturnType<typeof setTimeout> | undefined;
	let hideTimeout: ReturnType<typeof setTimeout> | undefined;

	const [visible, setVisible] = createSignal(false);
	const [triggerEl, setTriggerEl] = createSignal<HTMLElement>();

	const showDelay = () => props.showDelay ?? 250;
	const hideDelay = () => props.hideDelay ?? 250;
	const placement = () => props.placement ?? 'top';

	const clearTimeouts = () => {
		if (showTimeout) {
			clearTimeout(showTimeout);
			showTimeout = undefined;
		}
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = undefined;
		}
	};

	const scheduleShow = () => {
		clearTimeouts();
		showTimeout = setTimeout(() => {
			setVisible(true);
		}, showDelay());
	};

	const scheduleHide = () => {
		clearTimeouts();
		hideTimeout = setTimeout(() => {
			setVisible(false);
		}, hideDelay());
	};

	const handlePointerEnter = () => {
		scheduleShow();
	};

	const handlePointerLeave = () => {
		scheduleHide();
	};

	const handleFocus = () => {
		scheduleShow();
	};

	const handleBlur = () => {
		// hide immediately on blur
		clearTimeouts();
		setVisible(false);
	};

	// keep tooltip open when hovering over it
	const handleTooltipPointerEnter = () => {
		clearTimeouts();
	};

	const handleTooltipPointerLeave = () => {
		scheduleHide();
	};

	// cleanup timeouts on unmount
	onCleanup(clearTimeouts);

	const triggerProps: TooltipTriggerProps = {
		ref: (el: HTMLElement) => {
			setTriggerEl(el);
		},
		onPointerEnter: handlePointerEnter,
		onPointerLeave: handlePointerLeave,
		onFocus: handleFocus,
		onBlur: handleBlur,
		get 'aria-labelledby'() {
			return props.relationship === 'label' && visible() ? tooltipId : undefined;
		},
		get 'aria-describedby'() {
			return props.relationship === 'description' && visible() ? tooltipId : undefined;
		},
	};

	return (
		<>
			{props.children(triggerProps)}

			{visible() && (
				<Portal>
					<div
						ref={(el) => {
							createEffect(() => {
								const $trigger = triggerEl();
								if (!$trigger) {
									return;
								}

								const $placement = placement();

								const updatePosition = async () => {
									const { x, y } = await computePosition($trigger, el, {
										placement: $placement,
										strategy: 'absolute',
										middleware: [offset(4), flip(), shift({ padding: 8 })],
									});

									Object.assign(el.style, {
										position: 'absolute',
										left: `${x}px`,
										top: `${y}px`,
									});
								};

								onCleanup(autoUpdate($trigger, el, updatePosition));
							});

							const handleKeyDown = (ev: KeyboardEvent) => {
								if (ev.key === 'Escape') {
									clearTimeouts();
									setVisible(false);
								}
							};

							document.addEventListener('keydown', handleKeyDown);

							onCleanup(() => {
								document.removeEventListener('keydown', handleKeyDown);
							});
						}}
						id={tooltipId}
						role="tooltip"
						class="rounded fixed z-50 box-border max-w-60 cursor-default border border-transparent-stroke bg-neutral-background-1 pt-1 pr-2.5 pb-1.5 pl-2.5 text-base-200 wrap-break-word text-neutral-foreground-1 shadow-4"
						onPointerEnter={handleTooltipPointerEnter}
						onPointerLeave={handleTooltipPointerLeave}
					>
						{props.content}
					</div>
				</Portal>
			)}
		</>
	);
};

export default Tooltip;

// #endregion
