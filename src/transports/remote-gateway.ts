import { parseAdvertisementData } from "../lib/ad-parser";
import { normalizeAddress, type PeripheralInfo } from "../lib/advertisement";
import {
	MAX_ADVERTISEMENTS_PER_MESSAGE,
	type GatewayAdvertisementsResult,
	type GatewayResponse,
} from "../lib/gateway-protocol";
import type { Transport, TransportContext } from "./transport";

const GATEWAY_ID_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
/** Extended advertisements can be up to 1650 bytes long */
const MAX_DATA_LENGTH = 1650;
const ALIVE_REGEX = /^system\.adapter\.(.+)\.alive$/;

export interface ParsedGatewayMessage {
	/** The ID of the gateway, unique across all senders: "<sender>:<gatewayId>" */
	gatewayId: string;
	peripherals: PeripheralInfo[];
	/** How many items were skipped because they were invalid */
	rejected: number;
}

function invalid(message: string): GatewayResponse<never> {
	return { error: { code: "INVALID_PAYLOAD", message } };
}

/**
 * Validates the payload of "gateway:advertisements" and converts the advertisements into the
 * form the decoder plugins work with. Invalid items are skipped, so a single broken packet
 * does not discard the whole batch.
 */
export function parseGatewayMessage(
	sender: string,
	payload: unknown,
): ParsedGatewayMessage | GatewayResponse<never> {
	if (payload == null || typeof payload !== "object") {
		return invalid("The message must be an object");
	}
	const { gatewayId, items } = payload as Record<string, unknown>;
	if (typeof gatewayId !== "string" || !GATEWAY_ID_REGEX.test(gatewayId)) {
		return invalid(
			`"gatewayId" must consist of 1 to 64 letters, digits, "_", "-" or "."`,
		);
	}
	if (!Array.isArray(items)) {
		return invalid(`"items" must be an array`);
	}
	if (items.length > MAX_ADVERTISEMENTS_PER_MESSAGE) {
		return invalid(
			`"items" must not contain more than ${MAX_ADVERTISEMENTS_PER_MESSAGE} advertisements`,
		);
	}

	const fullGatewayId = `${sender}:${gatewayId}`;
	const peripherals: PeripheralInfo[] = [];
	let rejected = 0;
	for (const item of items) {
		const peripheral = parseItem(item, fullGatewayId);
		if (peripheral) {
			peripherals.push(peripheral);
		} else {
			rejected++;
		}
	}
	return { gatewayId: fullGatewayId, peripherals, rejected };
}

function parseItem(
	item: unknown,
	gatewayId: string,
): PeripheralInfo | undefined {
	if (item == null || typeof item !== "object") return;
	const { address, addressType, rssi, data, connectable } = item as Record<
		string,
		unknown
	>;

	const normalizedAddress = normalizeAddress(address);
	if (!normalizedAddress) return;
	if (typeof rssi !== "number" || !Number.isFinite(rssi)) return;
	if (
		typeof data !== "string" ||
		data.length > Math.ceil(MAX_DATA_LENGTH / 3) * 4 ||
		!BASE64_REGEX.test(data)
	) {
		return;
	}

	const id = normalizedAddress.replace(/:/g, "");
	return {
		id,
		uuid: id,
		address: normalizedAddress,
		addressType:
			addressType === "public" || addressType === "random"
				? addressType
				: "unknown",
		connectable: typeof connectable === "boolean" ? connectable : undefined,
		advertisement: parseAdvertisementData(Buffer.from(data, "base64")),
		rssi,
		gatewayId,
	};
}

/**
 * Receives advertisements other adapters deliver via sendTo ("gateway:advertisements").
 * Each sender can deliver for several gateways, e.g. one per ESPHome Bluetooth proxy.
 */
export class RemoteGatewayTransport implements Transport {
	public constructor(private readonly ctx: TransportContext) {}

	private readonly senders = new Set<string>();

	public start(): void {
		// Nothing to do, the advertisements are pushed to us
	}

	public stop(): void {
		// Nothing to do
	}

	/**
	 * Handles a "gateway:advertisements" message
	 * @param sender The instance that sent the message, e.g. "esphome.0"
	 */
	public handleAdvertisements(
		sender: string,
		payload: unknown,
	): GatewayResponse<GatewayAdvertisementsResult> {
		const parsed = parseGatewayMessage(sender, payload);
		if ("error" in parsed) return parsed;

		this.watchSender(sender);
		this.ctx.gateways.recordAdvertisements(
			{ id: parsed.gatewayId, type: "remote", sender },
			parsed.peripherals.length,
		);
		for (const peripheral of parsed.peripherals) {
			this.ctx.onAdvertisement(peripheral);
		}

		return {
			error: null,
			result: {
				accepted: parsed.peripherals.length,
				rejected: parsed.rejected,
			},
		};
	}

	/** When the sending instance stops, its gateways are offline immediately */
	private watchSender(sender: string): void {
		if (this.senders.has(sender)) return;
		this.senders.add(sender);
		this.ctx.adapter.subscribeForeignStates(
			`system.adapter.${sender}.alive`,
		);
	}

	/** Must be called for the state changes the adapter receives */
	public handleStateChange(
		id: string,
		state: ioBroker.State | null | undefined,
	): void {
		const sender = ALIVE_REGEX.exec(id)?.[1];
		if (!sender || !this.senders.has(sender)) return;
		if (state?.val === false) {
			this.ctx.adapter.log.info(
				`${sender} was stopped, its gateways are offline`,
			);
			this.ctx.gateways.senderOffline(sender);
		}
	}
}
