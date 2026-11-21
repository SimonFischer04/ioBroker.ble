import type { PeripheralInfo } from "../lib/scanProcessInterface";
import type { Plugin } from "./plugin";

interface MopekaContext {
	levelRaw: number | null;
	temperature: number;
	batteryVoltage: number;
	batteryPercent: number;
	quality: number;
}

/**
 * Decode a standard Pro Check advertisement, including Noble's company ID prefix.
 * Layout verified against ESPHome mopeka_pro_check and mopeka-iot-ble test frames.
 *
 * @param peripheral Discovered peripheral
 */
function parseAdvertisement(
	peripheral: PeripheralInfo,
): MopekaContext | undefined {
	const data = peripheral.advertisement?.manufacturerData;
	if (
		!Buffer.isBuffer(data) ||
		data.length !== 12 ||
		data.readUInt16LE(0) !== 0x0059 ||
		data[2] !== 0x03
	) {
		return;
	}

	// 0x0059 belongs to Nordic, so the company ID alone cannot identify Mopeka.
	const hasService = peripheral.advertisement.serviceUuids?.some((uuid) => {
		const normalized = uuid.replace(/-/g, "").toLowerCase();
		return (
			normalized === "fee5" ||
			normalized === "0000fee500001000800000805f9b34fb"
		);
	});
	const address =
		typeof peripheral.address === "string"
			? peripheral.address.replace(/[:-]/g, "").toLowerCase()
			: "";
	const hasAddressSuffix =
		/^[0-9a-f]{12}$/.test(address) &&
		data.subarray(7, 10).toString("hex") === address.slice(-6);
	if (!hasService && !hasAddressSuffix) {
		return;
	}

	const batteryVoltage = (data[3] & 0x7f) / 32;
	const quality = data[6] >> 6;
	return {
		levelRaw: quality === 0 ? null : data.readUInt16LE(5) & 0x3fff,
		temperature: (data[4] & 0x7f) - 40,
		batteryVoltage,
		// CR2032 estimate used by ESPHome and mopeka-iot-ble, clamped to 0..100%.
		batteryPercent:
			Math.round(
				Math.max(
					0,
					Math.min(100, ((batteryVoltage - 2.2) / 0.65) * 100),
				) * 10,
			) / 10,
		quality,
	};
}

const plugin: Plugin<MopekaContext> = {
	name: "mopeka",
	description: "Mopeka Pro Check LPG tank sensor",
	advertisedServices: ["fee5"],
	manufacturerIds: [0x0059],
	isHandling: (peripheral) => parseAdvertisement(peripheral) != null,
	createContext: parseAdvertisement,
	defineObjects: (context) => {
		if (context == null) {
			return;
		}
		return {
			device: { common: { name: "Mopeka Pro Check" } },
			channels: undefined,
			states: [
				{
					id: "mopeka_level_raw",
					common: {
						name: "Raw tank level",
						desc: "Uncalibrated ultrasonic reading; unavailable without a valid echo",
						type: "number",
						role: "value.level",
						min: 0,
						max: 16383,
						read: true,
						write: false,
					},
				},
				{
					id: "mopeka_temperature",
					common: {
						name: "Temperature",
						type: "number",
						role: "value.temperature",
						unit: "°C",
						read: true,
						write: false,
					},
				},
				{
					id: "mopeka_battery_v",
					common: {
						name: "Battery voltage",
						type: "number",
						role: "value.voltage",
						unit: "V",
						read: true,
						write: false,
					},
				},
				{
					id: "mopeka_battery_percent",
					common: {
						name: "Battery estimate",
						type: "number",
						role: "value.battery",
						unit: "%",
						min: 0,
						max: 100,
						read: true,
						write: false,
					},
				},
				{
					id: "mopeka_reading_quality",
					common: {
						name: "Reading quality",
						type: "number",
						role: "value.quality",
						min: 0,
						max: 3,
						read: true,
						write: false,
						states: {
							0: "No valid echo",
							1: "Low",
							2: "Medium",
							3: "High",
						},
					},
				},
			],
		};
	},
	getValues: (context) =>
		context == null
			? undefined
			: {
					mopeka_level_raw: context.levelRaw,
					mopeka_temperature: context.temperature,
					mopeka_battery_v: context.batteryVoltage,
					mopeka_battery_percent: context.batteryPercent,
					mopeka_reading_quality: context.quality,
				},
};

export = plugin;
