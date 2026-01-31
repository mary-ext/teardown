import clsx from 'clsx';
import { createMemo, type JSX } from 'solid-js';

import { LucideChevronDown } from '../../icons/lucide';
import { tw } from '../../lib/classes';
import { useFieldContext } from '../field';

import { useDropdownContext } from './context';

// #region types

export type DropdownSize = 'small' | 'medium' | 'large';
export type DropdownAppearance = 'outline' | 'underline';

export interface DropdownTriggerProps {
	/** placeholder text when no value is selected */
	placeholder?: string;
	/** display text for the selected value (if different from value) */
	children?: JSX.Element;
	/** size variant */
	size?: DropdownSize;
	/** visual style variant */
	appearance?: DropdownAppearance;
	/** whether the dropdown is disabled */
	disabled?: boolean;
	/** additional CSS classes */
	class?: string;
}

// #endregion

// #region styles

const rootBaseStyles = tw`inline-flex w-full min-w-0 items-center justify-between bg-neutral-background-1 text-left align-middle outline-2 -outline-offset-2 outline-transparent transition duration-100 select-none`;

const rootSizeStyles: Record<DropdownSize, string> = {
	small: tw`min-h-6 gap-2 px-2 text-base-200`,
	medium: tw`min-h-8 gap-2 px-2.5 text-base-300`,
	large: tw`min-h-10 gap-2 px-3 text-base-400`,
};

const rootAppearanceStyles: Record<DropdownAppearance, string> = {
	outline: tw`rounded-md border border-neutral-stroke-1 hover:border-neutral-stroke-1-hover focus-visible:outline-compound-brand-stroke`,
	underline: tw`rounded-none border-b border-neutral-stroke-1 hover:border-neutral-stroke-1-hover focus-visible:outline-compound-brand-stroke`,
};

const rootDisabledStyles = tw`cursor-not-allowed border-neutral-stroke-disabled bg-transparent text-neutral-foreground-disabled hover:border-neutral-stroke-disabled`;

const rootInvalidStyles = tw`border-status-danger-border-2 hover:border-status-danger-border-2 focus-visible:outline-status-danger-border-2`;

const iconSizeStyles: Record<DropdownSize, string> = {
	small: tw`size-3`,
	medium: tw`size-4`,
	large: tw`size-5`,
};

// #endregion

// #region component

const DropdownTrigger = (props: DropdownTriggerProps) => {
	const ctx = useDropdownContext();
	const fieldCtx = useFieldContext();

	const size = () => props.size ?? 'medium';
	const appearance = () => props.appearance ?? 'outline';

	// field context integration
	const triggerId = () => fieldCtx?.controlId ?? ctx.triggerId;
	const isInvalid = () => fieldCtx?.validationState() === 'error';
	const isRequired = () => fieldCtx?.required() ?? false;

	const ariaDescribedBy = () => {
		if (!fieldCtx) {
			return undefined;
		}
		return `${fieldCtx.validationMessageId} ${fieldCtx.hintId}`;
	};

	const handleClick = () => {
		if (props.disabled) {
			return;
		}
		ctx.setOpen(!ctx.open());
	};

	const handleKeyDown = (ev: KeyboardEvent) => {
		if (props.disabled) {
			return;
		}

		if (!ctx.open()) {
			// when closed, open on ArrowDown/ArrowUp/Enter/Space
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(ev.key)) {
				ev.preventDefault();
				ctx.setOpen(true);
			}
			return;
		}

		// when open, handle navigation
		switch (ev.key) {
			case 'ArrowDown': {
				ev.preventDefault();
				ctx.activeDescendant.next();
				break;
			}
			case 'ArrowUp': {
				ev.preventDefault();
				ctx.activeDescendant.prev();
				break;
			}
			case 'Home': {
				ev.preventDefault();
				ctx.activeDescendant.first();
				break;
			}
			case 'End': {
				ev.preventDefault();
				ctx.activeDescendant.last();
				break;
			}
			case 'Enter':
			case ' ': {
				ev.preventDefault();
				const activeId = ctx.activeDescendant.activeId();
				if (activeId) {
					const value = ctx.getOptionValue(activeId);
					if (value !== undefined) {
						ctx.selectOption(value, value);
					}
				}
				break;
			}
			case 'Escape': {
				ev.preventDefault();
				ctx.setOpen(false);
				break;
			}
			default: {
				// character search (typeahead)
				if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
					ctx.activeDescendant.search(ev.key);
				}
			}
		}
	};

	const hasValue = createMemo(() => ctx.selectedValue() !== undefined);

	return (
		<button
			ref={(el) => ctx.setTriggerRef(el)}
			type="button"
			id={triggerId()}
			role="combobox"
			aria-expanded={ctx.open()}
			aria-controls={ctx.open() ? ctx.listboxId : undefined}
			aria-haspopup="listbox"
			aria-activedescendant={ctx.open() ? (ctx.activeDescendant.activeId() ?? undefined) : undefined}
			aria-describedby={ariaDescribedBy()}
			aria-invalid={isInvalid() || undefined}
			aria-required={isRequired() || undefined}
			disabled={props.disabled}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			class={`${rootBaseStyles} ${rootSizeStyles[size()]} ${rootAppearanceStyles[appearance()]} ${props.disabled ? rootDisabledStyles : isInvalid() ? rootInvalidStyles : ''} ${props.class ?? ''}`}
		>
			<span
				class={clsx(
					`min-w-0 grow truncate`,
					hasValue() ? `text-neutral-foreground-1` : `text-neutral-foreground-4`,
				)}
			>
				{props.children ?? props.placeholder}
			</span>

			<LucideChevronDown class={`${iconSizeStyles[size()]} shrink-0 text-neutral-foreground-3`} />
		</button>
	);
};

export default DropdownTrigger;

// #endregion
