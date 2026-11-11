/**
 * The gateway interface "ble-gateway/1": how other adapters deliver BLE advertisements
 * they received (e.g. from an ESPHome Bluetooth proxy) to this adapter.
 *
 * This file has no dependencies, so adapters that deliver advertisements can copy it.
 *
 *   adapter.sendTo("ble.0", "gateway:advertisements", {
 *       gatewayId: "proxy-og",
 *       items: [{ address: "a4:c1:38:12:34:56", rssi: -67, data: "<base64>" }],
 *   });
 *
 * There is no registration: a gateway is created when its first advertisement arrives.
 * It is identified by the sending instance and the gatewayId, e.g. "esphome.0:proxy-og".
 */

export const GATEWAY_PROTOCOL = "ble-gateway/1";

/** The commands this adapter accepts via sendTo */
export const GatewayCommands = {
	/** Delivers a batch of received advertisements */
	advertisements: "gateway:advertisements",
	/** Lists the known gateways */
	getGateways: "getGateways",
	/** Lists the devices that were recently received, with the gateways that see them */
	getDevices: "getDevices",
} as const;

export interface GatewayAdvertisement {
	/** MAC address of the sending device, e.g. "a4:c1:38:12:34:56". Upper case and "-" are accepted. */
	address: string;
	/** Defaults to "unknown" */
	addressType?: "public" | "random" | "unknown";
	/** Signal strength in dBm */
	rssi: number;
	/**
	 * The raw payload of the advertisement, base64 encoded: the AD structures as they were received,
	 * optionally followed by those of the scan response.
	 */
	data: string;
	connectable?: boolean;
}

/** Payload of "gateway:advertisements" */
export interface GatewayAdvertisementsMessage {
	/** Identifies the gateway within the sending instance. Letters, digits, "_", "-" and ".", up to 64 chars. */
	gatewayId: string;
	/** At most MAX_ADVERTISEMENTS_PER_MESSAGE items */
	items: GatewayAdvertisement[];
}

export const MAX_ADVERTISEMENTS_PER_MESSAGE = 500;

/** Result of "gateway:advertisements" */
export interface GatewayAdvertisementsResult {
	/** How many items were accepted */
	accepted: number;
	/** How many items were skipped because they were invalid */
	rejected: number;
}

/** An entry of the result of "getGateways" */
export interface GatewayInfo {
	/** "local" for the Bluetooth adapter of the host, otherwise "<sender>:<gatewayId>" */
	id: string;
	type: "local" | "server" | "remote";
	/** The instance that delivers the advertisements, e.g. "esphome.0". Only for type "remote". */
	sender?: string;
	connected: boolean;
	/** Timestamp of the last received advertisement */
	lastAdvertisement?: number;
	/** How many advertisements were received since the adapter started */
	advertisements: number;
	/** How many of them were skipped because another gateway delivered the same packet first */
	duplicates: number;
}

/** An entry of the result of "getDevices" */
export interface DeviceInfo {
	address: string;
	name?: string;
	/** The gateways that recently received the device, strongest signal first */
	gateways: { id: string; rssi: number; lastSeen: number }[];
}

export type GatewayErrorCode = "INVALID_PAYLOAD";

/** All commands of the gateway interface answer with either a result or an error */
export type GatewayResponse<T> =
	| { error: null; result: T }
	| { error: { code: GatewayErrorCode; message: string } };
