export type ScanErrorKind =
	/** There is no usable Bluetooth adapter */
	| "no-hardware"
	/** Bluetooth sockets are not available, e.g. in a Docker container without host networking */
	| "address-family-not-supported"
	/** The native Bluetooth driver was built for another Node.js version */
	| "rebuild-required"
	/** The Bluetooth driver is not installed */
	| "driver-missing"
	/** Known harmless errors of the driver */
	| "ignorable"
	| "unknown";

/** Determines what an error reported by the scanner means for the local Bluetooth adapter */
export function classifyScanError(err: Error): ScanErrorKind {
	const message = err?.message ?? "";
	if (
		/compatible USB Bluetooth/.test(message) ||
		/LIBUSB_ERROR_NOT_SUPPORTED/.test(message)
	) {
		return "no-hardware";
	} else if (/NODE_MODULE_VERSION/.test(message)) {
		return "rebuild-required";
	} else if (message.includes(`The value of "offset" is out of range`)) {
		// this happens in noble sometimes
		return "ignorable";
	} else if (message.includes("EAFNOSUPPORT")) {
		return "address-family-not-supported";
	} else if (/Cannot find module/.test(message)) {
		return "driver-missing";
	}
	return "unknown";
}
