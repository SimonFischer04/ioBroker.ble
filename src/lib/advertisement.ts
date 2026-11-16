/**
 * The adapter's own model of a received BLE advertisement.
 * It has the shape the decoder plugins have always worked with (the one `noble` produces),
 * but does not depend on `noble`, so advertisements can come from any source.
 */

export type AddressType = "public" | "random" | "unknown";

export interface ServiceData {
	/** 16 bit UUIDs as 4 lowercase hex chars ("fcd2"), longer UUIDs as lowercase hex without dashes */
	uuid: string;
	data: Buffer;
}

export interface AdvertisementData {
	localName?: string;
	txPowerLevel?: number;
	serviceUuids?: string[];
	serviceData?: ServiceData[];
	/** The manufacturer specific data including the two leading bytes of the company ID */
	manufacturerData?: Buffer;
}

export interface PeripheralInfo {
	/** The MAC address without colons */
	id: string;
	uuid: string;
	/** The MAC address in lowercase with colons, e.g. "a4:c1:38:12:34:56" */
	address: string;
	addressType: AddressType;
	connectable?: boolean;
	advertisement: AdvertisementData;
	rssi: number;
	/** Which gateway received this advertisement. Set by the transports. */
	gatewayId?: string;
}

const MAC_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/**
 * Brings a MAC address into the form the adapter uses for its device IDs (lowercase with colons).
 * Returns undefined if the input is not a MAC address.
 */
export function normalizeAddress(address: unknown): string | undefined {
	if (typeof address !== "string") return undefined;
	let ret = address.trim().toLowerCase().replace(/-/g, ":");
	// Also accept addresses without separators
	if (/^[0-9a-f]{12}$/.test(ret)) {
		ret = ret.match(/.{2}/g)!.join(":");
	}
	return MAC_REGEX.test(ret) ? ret : undefined;
}
