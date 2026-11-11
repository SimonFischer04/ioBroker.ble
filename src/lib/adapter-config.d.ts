// This file extends the AdapterConfig type from "@types/iobroker"
// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			services: string;
			server: string;
			hciDevice: number;
			plugins: string;
			allowEmptyDevices: boolean;
			rssiThrottle: number;
			/**
			 * Whether the Bluetooth adapter of this host is used. When disabled, the adapter only
			 * handles advertisements other adapters deliver. Missing in old configurations = true.
			 */
			localScanner?: boolean;
			/** After how many seconds without advertisements an external gateway is offline */
			gatewayTimeout?: number;
		}
	}
}
// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
