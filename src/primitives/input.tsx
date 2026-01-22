import { splitProps, type JSX } from 'solid-js';

import { tw } from '../lib/classes';

import { useFieldContext } from './field';

// #region types

export type InputSize = 'small' | 'medium' | 'large';
export type InputAppearance = 'outline' | 'underline';

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'size'> {
	/** element rendered before the input text */
	contentBefore?: JSX.Element;
	/** element rendered after the input text */
	contentAfter?: JSX.Element;
	/** size variant */
	size?: InputSize;
	/** visual style variant */
	appearance?: InputAppearance;
	/** ref callback for the input element */
	inputRef?: (el: HTMLInputElement) => void;
}

// #endregion

// #region styles

const rootBaseStyles = tw`inline-flex items-center bg-neutral-background-1 align-middle outline-2 -outline-offset-2 outline-transparent transition duration-100`;

const rootSizeStyles: Record<InputSize, string> = {
	// minHeight 24px, gap 8px
	small: tw`min-h-6 gap-2 text-base-200`,
	// minHeight 32px, gap 8px
	medium: tw`min-h-8 gap-2 text-base-300`,
	// minHeight 40px, gap 8px
	large: tw`min-h-10 gap-2 text-base-400`,
};

const rootAppearanceStyles: Record<InputAppearance, string> = {
	outline: tw`rounded-md border border-neutral-stroke-1 hover:border-neutral-stroke-1-hover has-focus-visible:outline-compound-brand-stroke`,
	underline: tw`rounded-none border-b border-neutral-stroke-1 hover:border-neutral-stroke-1-hover has-focus-visible:outline-compound-brand-stroke`,
};

const rootDisabledStyles = tw`cursor-not-allowed border-neutral-stroke-disabled bg-transparent hover:border-neutral-stroke-disabled`;

const rootInvalidStyles = tw`border-status-danger-border-2 hover:border-status-danger-border-2 has-focus-visible:outline-status-danger-border-2`;

const inputBaseStyles = tw`min-w-0 grow bg-transparent outline-none selection:bg-brand-background selection:text-neutral-foreground-on-brand`;

const inputPaddingStyles: Record<InputSize, { combined: string; withContent: string }> = {
	small: { combined: tw`px-2`, withContent: tw`px-0.5` },
	medium: { combined: tw`px-2.5`, withContent: tw`px-0.5` },
	large: { combined: tw`px-3`, withContent: tw`px-1.5` },
};

const contentBaseStyles = tw`flex items-center text-neutral-foreground-3`;

const contentSizeStyles: Record<InputSize, string> = {
	small: tw`[&>svg]:size-3`,
	medium: tw`[&>svg]:size-4`,
	large: tw`[&>svg]:size-5`,
};

const contentPaddingStyles: Record<InputSize, { before: string; after: string }> = {
	small: { before: tw`pl-1.5`, after: tw`pr-1.5` },
	medium: { before: tw`pl-2.5`, after: tw`pr-2.5` },
	large: { before: tw`pl-3`, after: tw`pr-3` },
};

// #endregion

// #region component

const Input = (props: InputProps) => {
	const fieldCtx = useFieldContext();

	const [local, rest] = splitProps(props, [
		'contentBefore',
		'contentAfter',
		'size',
		'appearance',
		'class',
		'disabled',
		'inputRef',
		'id',
	]);

	const size = () => local.size ?? 'medium';
	const appearance = () => local.appearance ?? 'outline';
	const hasContentBefore = () => local.contentBefore !== undefined;
	const hasContentAfter = () => local.contentAfter !== undefined;

	// field context integration
	const inputId = () => local.id ?? fieldCtx?.controlId;
	const isInvalid = () => fieldCtx?.validationState() === 'error';
	const isRequired = () => fieldCtx?.required() ?? false;

	const ariaDescribedBy = () => {
		if (!fieldCtx) {
			return undefined;
		}
		return `${fieldCtx.validationMessageId} ${fieldCtx.hintId}`;
	};

	return (
		<div
			class={`${rootBaseStyles} ${rootSizeStyles[size()]} ${rootAppearanceStyles[appearance()]} ${local.disabled ? rootDisabledStyles : isInvalid() ? rootInvalidStyles : ''} ${local.class ?? ''}`}
		>
			{local.contentBefore && (
				<div
					class={`${contentBaseStyles} ${contentSizeStyles[size()]} ${contentPaddingStyles[size()].before}`}
				>
					{local.contentBefore}
				</div>
			)}

			<input
				ref={local.inputRef}
				id={inputId()}
				aria-describedby={ariaDescribedBy()}
				aria-invalid={isInvalid() || undefined}
				aria-required={isRequired() || undefined}
				class={`${inputBaseStyles} ${hasContentBefore() || hasContentAfter() ? inputPaddingStyles[size()].withContent : inputPaddingStyles[size()].combined} ${local.disabled ? 'cursor-not-allowed text-neutral-foreground-disabled placeholder:text-neutral-foreground-disabled' : 'text-neutral-foreground-1 placeholder:text-neutral-foreground-4'}`}
				disabled={local.disabled}
				{...rest}
			/>

			{local.contentAfter && (
				<div
					class={`${contentBaseStyles} ${contentSizeStyles[size()]} ${contentPaddingStyles[size()].after}`}
				>
					{local.contentAfter}
				</div>
			)}
		</div>
	);
};

export default Input;

// #endregion
