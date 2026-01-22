import type { JSX } from 'solid-js';

import { useMenuContext } from './context';

// #region types

export interface MenuTriggerChildProps {
	ref: (el: HTMLElement) => void;
	id: string;
	'aria-haspopup': 'menu';
	'aria-expanded': boolean;
	'aria-controls': string | undefined;
	onClick: () => void;
	onKeyDown: (ev: KeyboardEvent) => void;
}

export interface MenuTriggerProps {
	/** render prop that receives trigger props to spread onto your element */
	children: (props: MenuTriggerChildProps) => JSX.Element;
}

// #endregion

// #region component

const MenuTrigger = (props: MenuTriggerProps) => {
	const ctx = useMenuContext();

	const handleClick = () => {
		ctx.setOpen(!ctx.open());
	};

	const handleKeyDown = (ev: KeyboardEvent) => {
		switch (ev.key) {
			case 'Enter':
			case ' ':
			case 'ArrowDown': {
				ev.preventDefault();
				ctx.setOpen(true);
				break;
			}
			case 'Escape': {
				if (ctx.open()) {
					ev.preventDefault();
					ctx.setOpen(false);
				}
				break;
			}
		}
	};

	const childProps: MenuTriggerChildProps = {
		ref: (el: HTMLElement) => ctx.setTriggerRef(el),
		id: ctx.triggerId,
		'aria-haspopup': 'menu',
		get 'aria-expanded'() {
			return ctx.open();
		},
		get 'aria-controls'() {
			return ctx.open() ? ctx.menuId : undefined;
		},
		onClick: handleClick,
		onKeyDown: handleKeyDown,
	};

	return <>{props.children(childProps)}</>;
};

export default MenuTrigger;

// #endregion
