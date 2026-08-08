import { createMemo, createUniqueId, Show, type JSX } from 'solid-js';

import {
	CentralCircleCheckSolid,
	CentralCircleXSolid,
	CentralExclamationTriangleSolid,
} from '../../icons/central';
import { tw } from '../../lib/classes';

import { FieldProvider, type FieldContextValue, type FieldValidationState } from './context';

// #region types

export type FieldSize = 'small' | 'medium' | 'large';
export type FieldOrientation = 'vertical' | 'horizontal';

export interface FieldRootProps {
	/** field content (the form control) */
	children: JSX.Element;
	/** label text for the field */
	label?: string;
	/** hint text displayed below the control */
	hint?: string;
	/** validation message displayed below the control */
	validationMessage?: string;
	/** validation state affects icon and colors */
	validationState?: FieldValidationState;
	/** marks the field as required, adds asterisk to label */
	required?: boolean;
	/** size variant affects label text size */
	size?: FieldSize;
	/** layout orientation */
	orientation?: FieldOrientation;
}

// #endregion

// #region styles

const rootBaseStyles = tw`grid`;

const rootOrientationStyles: Record<FieldOrientation, string> = {
	vertical: '',
	horizontal: tw`grid-cols-[33%_1fr]`,
};

const labelBaseStyles = tw`max-w-max text-neutral-foreground-1`;

const labelSizeStyles: Record<FieldSize, string> = {
	small: tw`text-base-200`,
	medium: tw`text-base-300`,
	large: tw`text-base-400`,
};

const labelVerticalStyles: Record<FieldSize, string> = {
	small: tw`mb-0.5 py-0.5`,
	medium: tw`mb-0.5 py-0.5`,
	large: tw`mb-1 py-px`,
};

const labelHorizontalStyles: Record<FieldSize, string> = {
	small: tw`row-span-full mr-3 py-1`,
	medium: tw`row-span-full mr-3 py-1`,
	large: tw`row-span-full mr-3 py-2`,
};

const secondaryTextStyles = tw`mt-0.5 text-base-100 text-neutral-foreground-3`;

const validationMessageStyles: Record<FieldValidationState, string> = {
	error: tw`text-status-danger-foreground-1`,
	warning: tw`text-neutral-foreground-3`,
	success: tw`text-neutral-foreground-3`,
	none: tw`text-neutral-foreground-3`,
};

const validationIconStyles: Record<Exclude<FieldValidationState, 'none'>, string> = {
	error: tw`text-status-danger-foreground-1`,
	warning: tw`text-status-warning-foreground-1`,
	success: tw`text-status-success-foreground-1`,
};

// #endregion

// #region component

const FieldRoot = (props: FieldRootProps) => {
	const baseId = createUniqueId();
	const controlId = `field-${baseId}-control`;
	const hintId = `field-${baseId}-hint`;
	const validationMessageId = `field-${baseId}-validation`;

	const size = () => props.size ?? 'medium';
	const orientation = () => props.orientation ?? 'vertical';
	const required = () => props.required ?? false;

	const validationState = createMemo((): FieldValidationState => {
		if (props.validationState) {
			return props.validationState;
		}
		// default to error if validationMessage is set
		return props.validationMessage ? 'error' : 'none';
	});

	const context: FieldContextValue = {
		controlId,
		validationMessageId,
		hintId,
		required,
		validationState,
	};

	const ValidationIcon = () => {
		const state = validationState();
		if (state === 'none') {
			return null;
		}

		const iconClass = `inline-block size-3 mr-1 align-[-1px] ${validationIconStyles[state]}`;

		switch (state) {
			case 'error': {
				return <CentralCircleXSolid class={iconClass} />;
			}
			case 'warning': {
				return <CentralExclamationTriangleSolid class={iconClass} />;
			}
			case 'success': {
				return <CentralCircleCheckSolid class={iconClass} />;
			}
		}
	};

	return (
		<FieldProvider value={context}>
			<div class={`${rootBaseStyles} ${rootOrientationStyles[orientation()]}`}>
				{/* label */}
				<Show when={props.label}>
					<label
						for={controlId}
						class={`${labelBaseStyles} ${labelSizeStyles[size()]} ${orientation() === 'vertical' ? labelVerticalStyles[size()] : labelHorizontalStyles[size()]}`}
					>
						{props.label}
						{props.required && <span class="text-status-danger-foreground-1">*</span>}
					</label>
				</Show>

				{/* control */}
				{props.children}

				{/* validation message */}
				<Show when={props.validationMessage}>
					<div
						id={validationMessageId}
						role={validationState() === 'error' || validationState() === 'warning' ? 'alert' : undefined}
						class={`${secondaryTextStyles} ${validationMessageStyles[validationState()]}`}
					>
						<ValidationIcon />
						{props.validationMessage}
					</div>
				</Show>

				{/* hint */}
				<Show when={props.hint}>
					<div id={hintId} class={secondaryTextStyles}>
						{props.hint}
					</div>
				</Show>
			</div>
		</FieldProvider>
	);
};

export default FieldRoot;

// #endregion
