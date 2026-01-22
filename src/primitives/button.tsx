import { splitProps, type JSX } from 'solid-js';

import { tw } from '../lib/classes';

// #region types

export type ButtonAppearance = 'secondary' | 'primary' | 'outline' | 'subtle' | 'transparent';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
	/** button content */
	children: JSX.Element;
	/** visual style variant */
	appearance?: ButtonAppearance;
	/** size variant */
	size?: ButtonSize;
	/** icon-only button (square aspect ratio) */
	iconOnly?: boolean;
}

// #endregion

// #region styles

const baseStyles = tw`inline-flex items-center justify-center gap-1.5 rounded-md font-medium outline-2 -outline-offset-2 outline-transparent transition duration-100 select-none`;

const sizeStyles: Record<ButtonSize, string> = {
	// padding 3px 8px, fontSize 12px, fontWeight 400, minHeight 24px
	small: tw`min-h-6 min-w-16 px-2 py-0.5 text-base-200 font-normal`,
	// padding 5px 12px, fontSize 14px, fontWeight 600, minHeight 32px
	medium: tw`min-h-8 min-w-24 px-3 py-1 text-base-300`,
	// padding 8px 16px, fontSize 16px, fontWeight 600, minHeight 40px
	large: tw`min-h-10 min-w-24 px-4 py-2 text-base-400`,
};

const iconOnlySizeStyles: Record<ButtonSize, string> = {
	small: tw`min-h-6 min-w-6 p-0.5`,
	medium: tw`min-h-8 min-w-8 p-1`,
	large: tw`min-h-10 min-w-10 p-2`,
};

const appearanceStyles: Record<ButtonAppearance, string> = {
	// default: neutral background with border
	secondary: tw`border border-neutral-stroke-1 bg-neutral-background-1 text-neutral-foreground-1 hover:border-neutral-stroke-1-hover hover:bg-neutral-background-1-hover focus-visible:outline-compound-brand-stroke active:border-neutral-stroke-1-pressed active:bg-neutral-background-1-pressed disabled:cursor-not-allowed disabled:border-neutral-stroke-disabled disabled:bg-neutral-background-disabled disabled:text-neutral-foreground-disabled`,
	// brand background, white text
	primary: tw`border border-transparent bg-compound-brand-background text-neutral-foreground-on-brand hover:bg-compound-brand-background-hover focus-visible:outline-compound-brand-stroke active:bg-compound-brand-background-pressed disabled:cursor-not-allowed disabled:bg-neutral-background-disabled disabled:text-neutral-foreground-disabled`,
	// transparent background, visible border
	outline: tw`border border-neutral-stroke-1 bg-transparent text-neutral-foreground-1 hover:bg-subtle-background-hover focus-visible:outline-compound-brand-stroke active:bg-subtle-background-pressed disabled:cursor-not-allowed disabled:border-neutral-stroke-disabled disabled:text-neutral-foreground-disabled`,
	// subtle background, no border
	subtle: tw`border border-transparent bg-subtle-background text-neutral-foreground-2 hover:bg-subtle-background-hover focus-visible:outline-compound-brand-stroke active:bg-subtle-background-pressed disabled:cursor-not-allowed disabled:bg-transparent disabled:text-neutral-foreground-disabled`,
	// fully transparent
	transparent: tw`border border-transparent bg-transparent text-neutral-foreground-2 hover:bg-transparent-background-hover focus-visible:outline-compound-brand-stroke active:bg-transparent-background-pressed disabled:cursor-not-allowed disabled:text-neutral-foreground-disabled`,
};

// #endregion

// #region component

const Button = (props: ButtonProps) => {
	const [local, rest] = splitProps(props, ['children', 'class', 'appearance', 'size', 'iconOnly']);

	const appearance = () => local.appearance ?? 'secondary';
	const size = () => local.size ?? 'medium';

	return (
		<button
			type="button"
			class={`${baseStyles} ${local.iconOnly ? iconOnlySizeStyles[size()] : sizeStyles[size()]} ${appearanceStyles[appearance()]} ${local.class ?? ''}`}
			{...rest}
		>
			{local.children}
		</button>
	);
};

export default Button;

// #endregion
