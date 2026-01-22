export const tw = (strings: TemplateStringsArray, ...values: string[]) => {
	return String.raw({ raw: strings }, ...values);
};
