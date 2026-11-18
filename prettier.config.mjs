import prettierConfig from "@iobroker/eslint-config/prettier.config.mjs";

export default {
	...prettierConfig,
	// Keep the existing source style while sharing ioBroker's formatter defaults.
	printWidth: 80,
	useTabs: true,
	singleQuote: false,
	arrowParens: "always",
	singleAttributePerLine: false,
};
