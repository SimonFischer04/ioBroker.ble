import { entries } from "alcalzone-shared/objects";
import type { DeviceRegistry } from "../devices/device-registry";
import type { GatewayRegistry } from "../gateways/gateway-registry";
import type { PeripheralInfo } from "../lib/advertisement";
import { Global as _ } from "../lib/global";
import {
	extendChannel,
	extendDevice,
	extendState,
} from "../lib/iobroker-objects";
import type { Plugin } from "../plugins/plugin";

export interface AdvertisementProcessorOptions {
	/** The plugins that may handle advertisements, in the order they are asked */
	plugins: Plugin[];
	/** Whether devices without advertised data may be created */
	allowEmptyDevices: boolean;
	/** How frequent the RSSI of devices should be updated, in ms */
	rssiUpdateInterval: number;
}

/** After how many ms accepting new devices is disabled again */
const ALLOW_NEW_DEVICES_TIMEOUT = 5 * 60000;

/**
 * Turns advertisements into ioBroker objects and states: finds the plugin that handles
 * the device, lets it decode the advertisement and writes the result.
 */
export class AdvertisementProcessor {
	public constructor(
		private readonly options: AdvertisementProcessorOptions,
		private readonly devices: DeviceRegistry,
		private readonly gateways: GatewayRegistry,
	) {}

	/** Whether new devices may be recorded */
	private allowNewDevices = false;
	private resetAllowNewDevicesTimeout: NodeJS.Timeout | undefined;
	/** Cache of new devices we already ignored */
	private readonly ignoredNewDeviceIDs = new Set<string>();

	public dispose(): void {
		if (this.resetAllowNewDevicesTimeout) {
			clearTimeout(this.resetAllowNewDevicesTimeout);
		}
	}

	/** Enables or disables recording new devices */
	public setAllowNewDevices(allow: boolean): void {
		if (allow === this.allowNewDevices) return;
		this.allowNewDevices = allow;
		_.adapter.log.info(
			allow
				? "Now accepting new devices"
				: "No longer accepting new devices",
		);

		if (allow) {
			// Whenever allowNewDevices is set to true,
			// forget all devices we previously ignored
			this.ignoredNewDeviceIDs.clear();
			// Clear or restart the auto-reset timer
			this.autoResetAllowNewDevices();
		}
	}

	private autoResetAllowNewDevices(): void {
		if (this.resetAllowNewDevicesTimeout) {
			clearTimeout(this.resetAllowNewDevicesTimeout);
		}

		// After 5 minutes, reset it to false
		this.resetAllowNewDevicesTimeout = setTimeout(() => {
			this.allowNewDevices = false;
			_.adapter.setState("options.allowNewDevices", false, true);
			this.resetAllowNewDevicesTimeout = undefined;

			_.adapter.log.info(
				"No longer accepting new devices (automatic timeout)",
			);
		}, ALLOW_NEW_DEVICES_TIMEOUT);
	}

	public async process(peripheral: PeripheralInfo): Promise<void> {
		if (peripheral == null) return;

		let serviceDataIsNotEmpty = false;
		let manufacturerDataIsNotEmpty = false;

		_.adapter.log.debug(
			`discovered peripheral ${peripheral.address}${
				peripheral.gatewayId ? ` via ${peripheral.gatewayId}` : ""
			}`,
		);
		_.adapter.log.debug(
			`  has advertisement: ${peripheral.advertisement != null}`,
		);
		if (peripheral.advertisement != null) {
			_.adapter.log.debug(
				`  has serviceData: ${
					peripheral.advertisement.serviceData != null
				}`,
			);
			if (peripheral.advertisement.serviceData != null) {
				_.adapter.log.debug(
					`  serviceData = ${JSON.stringify(
						peripheral.advertisement.serviceData,
					)}`,
				);
				serviceDataIsNotEmpty =
					peripheral.advertisement.serviceData.length > 0;
			}
			_.adapter.log.debug(
				`  has manufacturerData: ${
					peripheral.advertisement.manufacturerData != null
				}`,
			);
			if (peripheral.advertisement.manufacturerData != null) {
				_.adapter.log.debug(
					`  manufacturerData = ${peripheral.advertisement.manufacturerData.toString(
						"hex",
					)}`,
				);
				manufacturerDataIsNotEmpty =
					peripheral.advertisement.manufacturerData.length > 0;
			}
		} else {
			// don't create devices for peripherals without advertised data
			return;
		}

		// Remember which gateway receives the device how well. When several gateways
		// receive the same packet, only the first copy is handled.
		const observation = this.devices.observe(peripheral);
		if (observation.duplicate) {
			_.adapter.log.debug(
				`  skipped, another gateway already delivered this packet`,
			);
			if (peripheral.gatewayId) {
				this.gateways.recordDuplicate(peripheral.gatewayId);
			}
			return;
		}

		// create devices if we selected to allow empty devices
		// or the peripheral transmits serviceData or manufacturerData
		if (
			!this.options.allowEmptyDevices &&
			!serviceDataIsNotEmpty &&
			!manufacturerDataIsNotEmpty
		) {
			return;
		}

		const deviceId = peripheral.address;

		// find out which plugin is handling this
		let plugin: Plugin | undefined;
		for (const p of this.options.plugins) {
			if (p.isHandling(peripheral)) {
				_.adapter.log.debug(`plugin ${p.name} is handling ${deviceId}`);
				plugin = p;
				break;
			}
		}
		if (!plugin) {
			_.adapter.log.warn(
				`no handling plugin found for peripheral ${peripheral.id}`,
			);
			return;
		}

		// Test if we may record this device
		if (!this.allowNewDevices) {
			// We may not. First test if we already ignored this device
			if (this.ignoredNewDeviceIDs.has(deviceId)) return;
			// If not, check if the RSSI object exists, as that exists for every one
			if (
				!(await _.objectCache.objectExists(
					`${_.adapter.namespace}.${deviceId}.rssi`,
				))
			) {
				// This is a new device. Remember that we need to ignore it
				this.ignoredNewDeviceIDs.add(deviceId);
				return;
			}
			// This is a known device
		}

		// Always ensure the rssi state exists and gets a value
		await extendState(`${deviceId}.rssi`, {
			id: "rssi",
			common: {
				role: "value.rssi",
				name: "signal strength (RSSI)",
				desc: "Signal strength of the device",
				type: "number",
				read: true,
				write: false,
			},
			native: {},
		});
		// update RSSI information
		const rssiState = await _.adapter.getStateAsync(`${deviceId}.rssi`);
		if (
			rssiState == null ||
			// Allow updating the unchanged state because some people use it for presence detection
			rssiState.ts + this.options.rssiUpdateInterval < Date.now() // But don't update too frequently
		) {
			_.adapter.log.debug(`updating rssi state for ${deviceId}`);
			// With several gateways, this is the signal strength of the one that receives the device best
			await _.adapter.setStateAsync(
				`${deviceId}.rssi`,
				observation.bestRssi,
				true,
			);
		}

		// Now update device-specific objects and states
		const context = plugin.createContext(peripheral);
		const objects = plugin.defineObjects(context);
		const values = plugin.getValues(context);

		// We can't do anything without objects
		if (objects == null) return;

		// Ensure the device object exists
		await extendDevice(deviceId, peripheral, objects.device);
		// Ensure the channel objects exist (optional)
		if (objects.channels != null && objects.channels.length > 0) {
			await Promise.all(
				objects.channels.map((c) =>
					extendChannel(deviceId + "." + c.id, c),
				),
			);
		}
		// Ensure the state objects exist. These might change in every advertisement frame
		await Promise.all(
			objects.states.map((s) => extendState(deviceId + "." + s.id, s)),
		);

		// Now fill the states with values
		if (values != null) {
			_.adapter.log.debug(
				`${deviceId} > got values: ${JSON.stringify(values)}`,
			);
			// eslint-disable-next-line prefer-const
			for (let [stateId, value] of entries(values)) {
				// Fix special chars
				stateId = stateId.replace(/[\(\)]+/g, "").replace(" ", "_");
				// set the value if there's an object for the state
				const iobStateId = `${_.adapter.namespace}.${deviceId}.${stateId}`;
				if ((await _.objectCache.getObject(iobStateId)) != null) {
					_.adapter.log.debug(`setting state ${iobStateId}`);
					await _.adapter.setStateChangedAsync(
						iobStateId,
						value ?? null,
						true,
					);
				} else {
					_.adapter.log.warn(
						`skipping state ${iobStateId} because the object does not exist`,
					);
				}
			}
		} else {
			_.adapter.log.debug(`${deviceId} > got no values`);
		}
	}
}
