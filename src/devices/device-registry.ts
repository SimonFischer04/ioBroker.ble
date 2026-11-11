import type { PeripheralInfo } from "../lib/advertisement";
import type { DeviceInfo } from "../lib/gateway-protocol";

export interface DeviceRegistryOptions {
	/**
	 * When several gateways receive the same packet, they deliver it within this time.
	 * Only the first copy is decoded.
	 */
	dedupeWindowMs: number;
	/** How long the RSSI a gateway measured is considered when determining the best one */
	rssiMaxAgeMs: number;
	/** Devices that were not received for this long are forgotten */
	deviceMaxAgeMs: number;
}

const defaultOptions: DeviceRegistryOptions = {
	dedupeWindowMs: 1000,
	rssiMaxAgeMs: 30000,
	deviceMaxAgeMs: 10 * 60000,
};

interface GatewayReception {
	rssi: number;
	lastSeen: number;
}

interface DeviceEntry {
	address: string;
	name?: string;
	gateways: Map<string, GatewayReception>;
	lastSeen: number;
	/** The payload that was last passed on to the decoders... */
	processedFingerprint?: string;
	/** ...when... */
	processedAt: number;
	/** ...and which gateway delivered it */
	processedGateway?: string;
}

export interface Observation {
	/** Whether another gateway already delivered this packet, so it must not be decoded again */
	duplicate: boolean;
	/** The strongest signal any gateway recently measured for this device */
	bestRssi: number;
	/** The gateway that measured it */
	bestGateway: string;
}

/** The gateway ID used for advertisements that do not say where they come from */
const UNKNOWN_GATEWAY = "unknown";

/**
 * Remembers which gateways receive which devices and how well.
 * This is what makes several receivers behave like one: the same packet is decoded once
 * and the signal strength of a device is the one of the gateway that receives it best.
 */
export class DeviceRegistry {
	public constructor(options: Partial<DeviceRegistryOptions> = {}) {
		this.options = { ...defaultOptions, ...options };
	}

	private readonly options: DeviceRegistryOptions;
	private readonly devices = new Map<string, DeviceEntry>();
	private lastPrune = 0;

	/** Records a received advertisement and tells how to treat it */
	public observe(
		peripheral: PeripheralInfo,
		now: number = Date.now(),
	): Observation {
		const gatewayId = peripheral.gatewayId ?? UNKNOWN_GATEWAY;

		let device = this.devices.get(peripheral.address);
		if (!device) {
			device = {
				address: peripheral.address,
				gateways: new Map(),
				lastSeen: now,
				processedAt: 0,
			};
			this.devices.set(peripheral.address, device);
		}
		device.lastSeen = now;
		if (peripheral.advertisement.localName) {
			device.name = peripheral.advertisement.localName;
		}
		device.gateways.set(gatewayId, {
			rssi: peripheral.rssi,
			lastSeen: now,
		});

		// A packet is a duplicate when a different gateway delivered the same payload just before.
		// The same gateway delivering it again is a retransmission of the device and treated as
		// before: it is passed on.
		const fingerprint = getFingerprint(peripheral);
		const duplicate =
			device.processedFingerprint === fingerprint &&
			device.processedGateway !== gatewayId &&
			now - device.processedAt < this.options.dedupeWindowMs;
		if (!duplicate) {
			device.processedFingerprint = fingerprint;
			device.processedGateway = gatewayId;
			device.processedAt = now;
		}

		let bestRssi = peripheral.rssi;
		let bestGateway = gatewayId;
		for (const [id, reception] of device.gateways) {
			if (
				now - reception.lastSeen <= this.options.rssiMaxAgeMs &&
				reception.rssi > bestRssi
			) {
				bestRssi = reception.rssi;
				bestGateway = id;
			}
		}

		if (now - this.lastPrune > 60000) this.prune(now);

		return { duplicate, bestRssi, bestGateway };
	}

	/** Lists the devices that were recently received */
	public getDevices(now: number = Date.now()): DeviceInfo[] {
		this.prune(now);
		return [...this.devices.values()].map((device) => ({
			address: device.address,
			name: device.name,
			gateways: [...device.gateways]
				.map(([id, { rssi, lastSeen }]) => ({ id, rssi, lastSeen }))
				.sort((a, b) => b.rssi - a.rssi),
		}));
	}

	/** Forgets the devices and receptions that are too old */
	public prune(now: number = Date.now()): void {
		this.lastPrune = now;
		for (const [address, device] of this.devices) {
			if (now - device.lastSeen > this.options.deviceMaxAgeMs) {
				this.devices.delete(address);
				continue;
			}
			for (const [id, reception] of device.gateways) {
				if (now - reception.lastSeen > this.options.deviceMaxAgeMs) {
					device.gateways.delete(id);
				}
			}
		}
	}
}

/** Identifies the content of an advertisement, independent of who received it */
function getFingerprint(peripheral: PeripheralInfo): string {
	const { serviceData, manufacturerData } = peripheral.advertisement;
	const parts: string[] = [];
	for (const entry of serviceData ?? []) {
		parts.push(`${entry.uuid}=${entry.data.toString("hex")}`);
	}
	parts.push(`m=${manufacturerData?.toString("hex") ?? ""}`);
	return parts.join("|");
}
