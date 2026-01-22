import { createContext, useContext, type Accessor } from 'solid-js';

// #region types

export type FieldValidationState = 'error' | 'warning' | 'success' | 'none';

export interface FieldContextValue {
	/** unique ID for the control element */
	controlId: string;
	/** unique ID for the validation message element */
	validationMessageId: string;
	/** unique ID for the hint element */
	hintId: string;
	/** whether the field is required */
	required: Accessor<boolean>;
	/** current validation state */
	validationState: Accessor<FieldValidationState>;
}

// #endregion

// #region context

const FieldContext = createContext<FieldContextValue>();

export const FieldProvider = FieldContext.Provider;

/**
 * returns field context if inside a Field, undefined otherwise.
 * use this in form controls to integrate with Field.
 */
export function useFieldContext(): FieldContextValue | undefined {
	return useContext(FieldContext);
}

// #endregion
