import type { JSX } from 'solid-js';

import { usePopoverContext } from './context';

// #region types

export interface PopoverTriggerChildProps {
	ref: (el: HTMLElement) => void;
	id: string;
	'aria-haspopup': 'dialog';
	'aria-expanded': boolean;
	'aria-controls': string | undefined;
	onClick: () => void;
	onPointerEnter: () => void;
	onPointerLeave: () => void;
}

export interface PopoverTriggerProps {
	/** render prop that receives trigger props to spread onto your element */
	children: (props: PopoverTriggerChildProps) => JSX.Element;
}

// #endregion

// #region component

const PopoverTrigger = (props: PopoverTriggerProps) => {
	const ctx = usePopoverContext();

	const handleClick = () => {
		if (!ctx.openOnHover()) {
			ctx.setOpen(!ctx.open(), 'click');
		}
	};

	const handlePointerEnter = () => {
		if (ctx.openOnHover()) {
			ctx.setOpen(true, 'pointerenter');
		}
	};

	const handlePointerLeave = () => {
		if (ctx.openOnHover()) {
			ctx.setOpen(false, 'pointerleave');
		}
	};

	const childProps: PopoverTriggerChildProps = {
		ref: (el: HTMLElement) => ctx.setTriggerRef(el),
		id: ctx.triggerId,
		'aria-haspopup': 'dialog',
		get 'aria-expanded'() {
			return ctx.open();
		},
		get 'aria-controls'() {
			return ctx.open() ? ctx.surfaceId : undefined;
		},
		onClick: handleClick,
		onPointerEnter: handlePointerEnter,
		onPointerLeave: handlePointerLeave,
	};

	return <>{props.children(childProps)}</>;
};

export default PopoverTrigger;

// #endregion
