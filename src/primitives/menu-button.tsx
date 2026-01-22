import { splitProps, type JSX } from 'solid-js';

import { LucideChevronDown } from '../icons/lucide';

import Button, { type ButtonProps } from './button';

// #region types

export interface MenuButtonProps extends Omit<ButtonProps, 'children'> {
	/** button content */
	children: JSX.Element;
}

// #endregion

// #region component

const MenuButton = (props: MenuButtonProps) => {
	const [local, rest] = splitProps(props, ['children']);

	return (
		<Button {...rest}>
			{local.children}
			<LucideChevronDown class="size-4 text-neutral-foreground-3" />
		</Button>
	);
};

export default MenuButton;

// #endregion
