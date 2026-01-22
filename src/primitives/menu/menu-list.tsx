import type { JSX } from 'solid-js';

import { MenuListProvider } from './context';

// #region types

export interface MenuListProps {
	/** menu items */
	children: JSX.Element;
	/** whether menu items should reserve space for checkmarks */
	hasCheckmarks?: boolean;
	/** whether menu items should reserve space for icons */
	hasIcons?: boolean;
}

// #endregion

// #region component

const MenuList = (props: MenuListProps) => {
	return (
		<MenuListProvider
			value={{ hasCheckmarks: props.hasCheckmarks ?? false, hasIcons: props.hasIcons ?? false }}
		>
			<div class="flex flex-col gap-0.5">{props.children}</div>
		</MenuListProvider>
	);
};

export default MenuList;

// #endregion
