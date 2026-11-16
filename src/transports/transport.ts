import type { GatewayRegistry } from "../gateways/gateway-registry";
import type { PeripheralInfo } from "../lib/advertisement";

/** What a transport needs from the adapter */
export interface TransportContext {
	adapter: ioBroker.Adapter;
	/** Where the transport reports its gateways and whether they are active */
	gateways: GatewayRegistry;
	/** Called for every received advertisement. `gatewayId` must be set. */
	onAdvertisement: (peripheral: PeripheralInfo) => void;
}

/** A source of BLE advertisements */
export interface Transport {
	start(): void;
	stop(): void;
}
