import { expect } from "chai";
import type { PeripheralInfo } from "../lib/scanProcessInterface";
import { matchesScanFilter } from "../lib/scan-filter";
import plugin = require("./mopeka");

// Published Pro Check fixture, with Noble's two-byte manufacturer ID added:
// https://github.com/Bluetooth-Devices/mopeka-iot-ble/blob/main/tests/test_parser.py
const goodFrame = "5900037043b6c3e0f509fae3";
function peripheral(
	data: Buffer | undefined = Buffer.from(goodFrame, "hex"),
	serviceUuids: string[] = ["fee5"],
	address = "c9:f3:32:e0:f5:09",
): PeripheralInfo {
	return {
		address,
		advertisement: { manufacturerData: data, serviceUuids },
	} as PeripheralInfo;
}

describe("Mopeka Pro Check", () => {
	it("decodes the published Pro Check frame and defines matching read-only states", () => {
		const p = peripheral();
		expect(plugin.isHandling(p)).to.be.true;
		const context = plugin.createContext(p)!;
		expect(plugin.getValues(context)).to.deep.equal({
			mopeka_level_raw: 950,
			mopeka_temperature: 27,
			mopeka_battery_v: 3.5,
			mopeka_battery_percent: 100,
			mopeka_reading_quality: 3,
		});
		const objects = plugin.defineObjects(context)!;
		expect(objects.states.map((s) => s.id)).to.deep.equal(
			Object.keys(plugin.getValues(context)!),
		);
		for (const state of objects.states) {
			expect(state.common).to.include({
				read: true,
				write: false,
				type: "number",
			});
		}
		expect(
			objects.states.find((s) => s.id === "mopeka_battery_v")!.common!
				.unit,
		).to.equal("V");
		expect(
			objects.states.find((s) => s.id === "mopeka_temperature")!.common!
				.unit,
		).to.equal("°C");
	});

	it("accepts manufacturer-only frames through the scanner filter and embedded MAC suffix", () => {
		const p = peripheral(Buffer.from(goodFrame, "hex"), []);
		expect(matchesScanFilter(p, ["fe95"], plugin.manufacturerIds!)).to.be
			.true;
		expect(matchesScanFilter(p, ["fe95"], [])).to.be.false;
		expect(plugin.isHandling(p)).to.be.true;
	});

	it("accepts short and full service UUIDs without requiring a matching address suffix", () => {
		for (const service of [
			"fee5",
			"0000FEE5-0000-1000-8000-00805F9B34FB",
		]) {
			expect(
				plugin.isHandling(
					peripheral(Buffer.from(goodFrame, "hex"), [service], ""),
				),
			).to.be.true;
		}
	});

	it("does not confuse status bits with temperature, voltage, or an extended tank level", () => {
		const data = Buffer.from(goodFrame, "hex");
		data[3] |= 0x80;
		data[4] |= 0x80;
		const values = plugin.getValues(
			plugin.createContext(peripheral(data))!,
		)!;
		expect(values).to.include({
			mopeka_level_raw: 950,
			mopeka_temperature: 27,
			mopeka_battery_v: 3.5,
		});
	});

	it("clamps CR2032 estimates and calculates an intermediate battery level", () => {
		for (const [raw, percent] of [
			[70, 0],
			[81, 51],
			[92, 100],
		]) {
			const data = Buffer.from(goodFrame, "hex");
			data[3] = raw;
			expect(
				plugin.getValues(plugin.createContext(peripheral(data))!)!
					.mopeka_battery_percent,
			).to.equal(percent);
		}
	});

	it("decodes the full seven-bit temperature range", () => {
		for (const [raw, temperature] of [
			[0, -40],
			[40, 0],
			[127, 87],
		]) {
			const data = Buffer.from(goodFrame, "hex");
			data[4] = raw;
			expect(
				plugin.getValues(plugin.createContext(peripheral(data))!)!
					.mopeka_temperature,
			).to.equal(temperature);
		}
	});

	it("separates quality from the 14-bit level, and clears level for an invalid echo", () => {
		for (const quality of [0, 1, 2, 3]) {
			const data = Buffer.from(goodFrame, "hex");
			data.writeUInt16LE((quality << 14) | 16383, 5);
			const values = plugin.getValues(
				plugin.createContext(peripheral(data))!,
			)!;
			expect(values.mopeka_reading_quality).to.equal(quality);
			expect(values.mopeka_level_raw).to.equal(
				quality === 0 ? null : 16383,
			);
		}
	});

	it("rejects malformed data, other manufacturers, and unsupported Mopeka models", () => {
		const wrongCompany = Buffer.from(goodFrame, "hex");
		wrongCompany[0] = 0x4c;
		const otherModel = Buffer.from(goodFrame, "hex");
		otherModel[2] = 0x05;
		const invalid = [
			Buffer.alloc(0),
			Buffer.from([0x59]),
			wrongCompany,
			otherModel,
			...Array.from({ length: 11 }, (_, i) =>
				Buffer.from(goodFrame, "hex").subarray(0, i + 1),
			),
			Buffer.concat([Buffer.from(goodFrame, "hex"), Buffer.from([0])]),
		];
		for (const data of invalid) {
			expect(plugin.isHandling(peripheral(data))).to.be.false;
			expect(plugin.createContext(peripheral(data))).to.be.undefined;
		}
		expect(plugin.isHandling({} as PeripheralInfo)).to.be.false;
		expect(plugin.isHandling({ advertisement: {} } as PeripheralInfo)).to.be
			.false;
	});

	it("rejects unrelated Nordic data lacking a Mopeka service or matching MAC suffix", () => {
		expect(
			plugin.isHandling(
				peripheral(
					Buffer.from(goodFrame, "hex"),
					[],
					"aa:bb:cc:dd:ee:ff",
				),
			),
		).to.be.false;
	});
});
