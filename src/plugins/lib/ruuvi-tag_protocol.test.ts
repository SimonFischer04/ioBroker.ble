/* eslint-disable @typescript-eslint/no-namespace */
import type { PeripheralInfo } from "../../lib/scanProcessInterface";
import { expect } from "chai";
import * as proxyquireModule from "proxyquire";
import { createGlobalMock } from "../../../test/mocks/global";

// import mocks
const proxyquire = proxyquireModule.noPreserveCache();

namespace mocks {
	export const global = createGlobalMock({});
	// export const adapter = global.Global.adapter;
	// export const database = global.Global.database;
	// export const customSubscriptions = createCustomSubscriptionsMock();
}

const plugin = proxyquire<typeof import("../ruuvi-tag")>("../ruuvi-tag", {
	"../lib/global": mocks.global,
});

describe("ruuvi-tag protocol (service data) => ", () => {
	// a real packet:
	const peripheral = {
		id: "c0cd266001a0",
		address: "c0:cd:26:60:01:a0",
		addressType: "random",
		connectable: false,
		advertisement: {
			serviceData: [
				{
					uuid: "feaa",
					data: Buffer.from([
						16, 249, 3, 114, 117, 117, 46, 118, 105, 47, 35, 66, 76,
						103, 67, 65, 77, 73, 107, 70,
					]),
				},
			],
			serviceUuids: ["feaa"],
		},
		rssi: -91,
		state: "disconnected",
	} as unknown as PeripheralInfo;
	it("should be handling the packet", () => {
		plugin.isHandling(peripheral).should.be.true;
		// also for repeated tests
		plugin.isHandling(peripheral).should.be.true;
	});
});

describe("ruuvi-tag protocol (manufacturer data) => ", () => {
	// a real packet:
	const peripheral = {
		id: "c0cd266001a0",
		address: "c0:cd:26:60:01:a0",
		addressType: "random",
		connectable: false,
		advertisement: {
			manufacturerData: Buffer.from(
				"990403581b08baa8ffc3004303f90bb3",
				"hex",
			),
			serviceData: [],
			serviceUuids: [],
		},
		rssi: -91,
		state: "disconnected",
	} as unknown as PeripheralInfo;
	it("should be handling the packet", () => {
		plugin.isHandling(peripheral).should.be.true;
		// also for repeated tests
		plugin.isHandling(peripheral).should.be.true;
	});

	it("decodes manufacturer-only packets without a serviceData property", () => {
		const { serviceData, ...advertisement } = peripheral.advertisement;
		const packet = {
			...peripheral,
			advertisement,
		} as unknown as PeripheralInfo;
		expect(plugin.isHandling(packet)).to.be.true;
		const context = plugin.createContext(packet)!;
		expect(context).to.include({
			dataFormat: 3,
			humidity: 44,
			temperature: 27.08,
		});
		expect(plugin.getValues(context)).to.include({
			humidity: 44,
			temperature: 27.08,
		});
	});

	it("accepts a valid frame immediately after an empty frame from the same device", () => {
		const packet = {
			...peripheral,
			id: "initially-empty",
			advertisement: {},
		} as unknown as PeripheralInfo;
		expect(plugin.isHandling(packet)).to.be.false;
		expect(plugin.isHandling({ ...peripheral, id: packet.id })).to.be.true;
	});

	it("checks each frame even after the device has sent valid Ruuvi data", () => {
		expect(plugin.isHandling(peripheral)).to.be.true;
		for (const manufacturerData of [
			undefined,
			Buffer.from("4c000215", "hex"),
			Buffer.from("990403", "hex"),
		]) {
			const packet = {
				...peripheral,
				advertisement: { serviceData: [], manufacturerData },
			} as unknown as PeripheralInfo;
			expect(plugin.isHandling(packet)).to.be.false;
		}
		expect(plugin.isHandling(peripheral)).to.be.true;
	});
});
