import { expect } from "chai";
import { classifyScanError } from "./scan-errors";

describe("transports/scan-errors => classifyScanError()", () => {
	const cases: [message: string, expected: string][] = [
		["No compatible USB Bluetooth 4.0 device found!", "no-hardware"],
		["LIBUSB_ERROR_NOT_SUPPORTED", "no-hardware"],
		[
			"The module was compiled against a different Node.js version using NODE_MODULE_VERSION 108.",
			"rebuild-required",
		],
		[
			'The value of "offset" is out of range. It must be >= 0 and <= 2.',
			"ignorable",
		],
		[
			"EAFNOSUPPORT, Address family not supported by protocol",
			"address-family-not-supported",
		],
		["Cannot find module '@stoprocent/noble'", "driver-missing"],
		["something else", "unknown"],
	];
	for (const [message, expected] of cases) {
		it(`"${message.slice(0, 40)}" => ${expected}`, () => {
			expect(classifyScanError(new Error(message))).to.equal(expected);
		});
	}

	it("does not fail for errors without a message", () => {
		expect(classifyScanError({} as Error)).to.equal("unknown");
	});
});
