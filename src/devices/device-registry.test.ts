import { expect } from "chai";
import type { PeripheralInfo } from "../lib/advertisement";
import { DeviceRegistry } from "./device-registry";

function peripheral(
	gatewayId: string | undefined,
	rssi: number,
	payload: string = "4000a5016402c40903bf13",
	address: string = "a4:c1:38:12:34:56",
): PeripheralInfo {
	return {
		id: address.replace(/:/g, ""),
		uuid: address.replace(/:/g, ""),
		address,
		addressType: "public",
		rssi,
		gatewayId,
		advertisement: {
			localName: "ATC_123456",
			serviceData: [{ uuid: "fcd2", data: Buffer.from(payload, "hex") }],
		},
	};
}

describe("devices/device-registry => DeviceRegistry", () => {
	it("passes on every packet of a single gateway, like before", () => {
		const registry = new DeviceRegistry();
		// The same payload again and again, as sensors do between measurements
		for (const now of [0, 100, 200, 5000]) {
			const result = registry.observe(peripheral("local", -70), now);
			expect(result.duplicate).to.be.false;
			expect(result.bestRssi).to.equal(-70);
		}
	});

	it("handles a packet only once when several gateways receive it", () => {
		const registry = new DeviceRegistry();
		expect(registry.observe(peripheral("a", -80), 1000).duplicate).to.be
			.false;
		expect(registry.observe(peripheral("b", -60), 1010).duplicate).to.be
			.true;
		expect(registry.observe(peripheral("c", -90), 1020).duplicate).to.be
			.true;
	});

	it("handles the next packet again, no matter which gateway is first", () => {
		const registry = new DeviceRegistry();
		registry.observe(peripheral("a", -80), 1000);
		registry.observe(peripheral("b", -60), 1010);

		// New content
		expect(registry.observe(peripheral("b", -60, "4000a6"), 1500).duplicate)
			.to.be.false;
		expect(registry.observe(peripheral("a", -80, "4000a6"), 1510).duplicate)
			.to.be.true;

		// The same content after the dedupe window is a new transmission
		expect(registry.observe(peripheral("a", -80, "4000a6"), 4000).duplicate)
			.to.be.false;
	});

	it("does not mix up devices", () => {
		const registry = new DeviceRegistry();
		registry.observe(peripheral("a", -80), 1000);
		const other = peripheral("b", -60, undefined, "a4:c1:38:00:00:01");
		expect(registry.observe(other, 1010).duplicate).to.be.false;
	});

	it("treats advertisements without a gateway as one source", () => {
		const registry = new DeviceRegistry();
		expect(registry.observe(peripheral(undefined, -70), 0).duplicate).to.be
			.false;
		expect(registry.observe(peripheral(undefined, -70), 10).duplicate).to.be
			.false;
	});

	it("reports the signal of the gateway that receives the device best", () => {
		const registry = new DeviceRegistry();
		registry.observe(peripheral("far", -85), 1000);
		const near = registry.observe(peripheral("near", -55), 1010);
		expect(near.bestRssi).to.equal(-55);
		expect(near.bestGateway).to.equal("near");

		// The next packet is delivered by the far gateway first
		const next = registry.observe(peripheral("far", -85, "4000a6"), 3000);
		expect(next.bestRssi).to.equal(-55);
		expect(next.bestGateway).to.equal("near");
	});

	it("forgets the signal of a gateway that no longer receives the device", () => {
		const registry = new DeviceRegistry({ rssiMaxAgeMs: 30000 });
		registry.observe(peripheral("near", -55), 0);
		const result = registry.observe(peripheral("far", -85), 31000);
		expect(result.bestRssi).to.equal(-85);
		expect(result.bestGateway).to.equal("far");
	});

	it("lists the devices with their gateways, strongest first", () => {
		const registry = new DeviceRegistry();
		registry.observe(peripheral("far", -85), 1000);
		registry.observe(peripheral("near", -55), 1010);

		expect(registry.getDevices(2000)).to.deep.equal([
			{
				address: "a4:c1:38:12:34:56",
				name: "ATC_123456",
				gateways: [
					{ id: "near", rssi: -55, lastSeen: 1010 },
					{ id: "far", rssi: -85, lastSeen: 1000 },
				],
			},
		]);
	});

	it("forgets devices that are gone", () => {
		const registry = new DeviceRegistry({ deviceMaxAgeMs: 60000 });
		registry.observe(peripheral("a", -80), 0);
		registry.observe(
			peripheral("a", -80, undefined, "a4:c1:38:00:00:01"),
			50000,
		);
		expect(registry.getDevices(70000).map((d) => d.address)).to.deep.equal([
			"a4:c1:38:00:00:01",
		]);
	});
});
