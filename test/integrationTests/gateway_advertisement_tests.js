// @ts-check

/**
 * Gateway Interface Integration Test - advertisements
 *
 * Another adapter delivers the advertisements its gateways (e.g. ESPHome Bluetooth proxies)
 * received with sendTo("ble.0", "gateway:advertisements", ...). The packets used here are
 * raw payloads as the devices send them, so the whole chain is covered: validating the
 * message, parsing the AD structures, selecting the decoder plugin, creating the objects
 * and writing the states.
 *
 * The second suite covers what protects an installation from being flooded with devices:
 * new devices are only recorded while the user allows it, and only advertisements of the
 * monitored services are handled.
 */

const { expect } = require("chai");
const {
	AD,
	NAMESPACE,
	PACKETS,
	allowNewDevices,
	buildAdvertisement,
	delay,
	deliver,
	getValue,
	sendToAdapter,
	startAdapter,
	stopAdapter,
	waitFor,
	waitForValue,
} = require("./helpers");

const GATEWAY = "proxy-og";

/**
 * Whether the device object exists
 *
 * @param {any} harness - Integration test harness
 * @param {string} address - MAC address of the device
 * @returns {Promise<boolean>}
 */
async function deviceExists(harness, address) {
	return !!(await harness.objects.getObjectAsync(`${NAMESPACE}.${address}`));
}

/** @param {(name: string, fn: (getHarness: () => any) => void) => void} suite */
exports.runTests = function (suite) {
	suite(
		"Gateway interface - advertisements of the supported devices",
		(getHarness) => {
			/** @type {any} */
			let harness;

			before(async function () {
				this.timeout(60000);
				harness = getHarness();
				await startAdapter(harness, {
					plugins: "xiaomi, ruuvi-tag, bthome",
					// Not every device advertises a service, e.g. the RuuviTag
					services: "*",
				});
				await allowNewDevices(harness);
			});

			after(() => stopAdapter(harness));

			it("decodes a BTHome thermometer", async function () {
				this.timeout(30000);
				const address = "a4:c1:38:12:34:56";

				// Gateways may report the address in upper case
				const response = await deliver(harness, GATEWAY, [
					{
						address: address.toUpperCase(),
						addressType: "public",
						rssi: -67,
						data: PACKETS.bthomeThermometer,
					},
				]);
				expect(response).to.deep.equal({
					error: null,
					result: { accepted: 1, rejected: 0 },
				});

				await waitForValue(harness, `${address}.temperature`, 25);
				expect(
					await getValue(harness, `${address}.humidity`),
				).to.be.closeTo(50.55, 0.001);
				expect(await getValue(harness, `${address}.battery`)).to.equal(
					100,
				);
				expect(await getValue(harness, `${address}.rssi`)).to.equal(
					-67,
				);

				// The device ID is the address in lower case, as it has always been
				const device = await harness.objects.getObjectAsync(
					`${NAMESPACE}.${address}`,
				);
				expect(device.type).to.equal("device");
				expect(device.native).to.include({
					id: "a4c138123456",
					address,
					addressType: "public",
				});
				expect(await deviceExists(harness, address.toUpperCase())).to.be
					.false;

				const temperature = await harness.objects.getObjectAsync(
					`${NAMESPACE}.${address}.temperature`,
				);
				expect(temperature.common).to.include({
					type: "number",
					unit: "°C",
					write: false,
				});
				const state = await harness.states.getStateAsync(
					`${NAMESPACE}.${address}.temperature`,
				);
				expect(state.ack).to.be.true;
			});

			it("updates the values with the next packet", async function () {
				this.timeout(30000);
				const address = "a4:c1:38:12:34:56";

				await deliver(harness, GATEWAY, [
					{ address, rssi: -72, data: PACKETS.bthomeThermometerNext },
				]);

				await waitForValue(harness, `${address}.temperature`, 25.5);
				await waitForValue(harness, `${address}.humidity`, 49);
				await waitForValue(harness, `${address}.rssi`, -72);
			});

			it("decodes several devices delivered in one message", async function () {
				this.timeout(30000);
				const motion = "a4:c1:38:00:00:01";
				const xiaomi = "4c:65:a8:d0:ae:65";
				const ruuvi = "c0:cd:26:60:01:a0";

				const response = await deliver(harness, GATEWAY, [
					{ address: motion, data: PACKETS.bthomeMotion },
					{ address: xiaomi, data: PACKETS.xiaomiHumidity },
					{
						address: ruuvi,
						addressType: "random",
						rssi: -91,
						data: PACKETS.ruuviTag,
					},
				]);
				expect(response.result).to.deep.equal({
					accepted: 3,
					rejected: 0,
				});

				// BTHome motion sensor with a button
				await waitForValue(harness, `${motion}.motion`, true);
				await waitForValue(harness, `${motion}.illuminance`, 6);
				await waitForValue(harness, `${motion}.button`, "press");

				// Xiaomi MiBeacon
				await waitForValue(harness, `${xiaomi}.humidity`, 56);

				// RuuviTag: decoded from the manufacturer data
				await waitForValue(harness, `${ruuvi}.temperature`, 27.08);
				await waitForValue(harness, `${ruuvi}.humidity`, 44);
				await waitForValue(harness, `${ruuvi}.pressure`, 977.84);
				await waitForValue(harness, `${ruuvi}.accelerationZ`, 1017);
				await waitForValue(harness, `${ruuvi}.rssi`, -91);
			});

			it("records devices no plugin knows with their raw data", async function () {
				this.timeout(30000);
				const address = "a4:c1:38:00:00:02";

				await deliver(harness, GATEWAY, [
					{ address, data: PACKETS.unknownDevice },
				]);

				await waitForValue(
					harness,
					`${address}.services.181a`,
					"a4c13812345600c4",
				);
				// The name the device advertises
				const device = await harness.objects.getObjectAsync(
					`${NAMESPACE}.${address}`,
				);
				expect(device.common.name).to.equal("ATC_123456");
			});

			it("ignores advertisements without data", async function () {
				this.timeout(30000);
				const address = "a4:c1:38:00:00:03";
				const marker = "a4:c1:38:00:00:04";

				await deliver(harness, GATEWAY, [
					{ address, data: PACKETS.withoutData },
					{ address, data: "" },
					// Handled after the ones above
					{ address: marker, data: PACKETS.bthomeThermometer },
				]);

				await waitForValue(harness, `${marker}.temperature`, 25);
				await delay(300);
				expect(await deviceExists(harness, address)).to.be.false;
			});

			it("skips invalid advertisements and handles the rest of the message", async function () {
				this.timeout(30000);
				const address = "a4:c1:38:00:00:05";

				const response = await deliver(harness, GATEWAY, [
					{ address: "not-a-mac", data: PACKETS.bthomeThermometer },
					{ address, data: "not base64!" },
					// The payload is cut off within the service data: nothing usable is left
					{
						address,
						data: Buffer.from("0201060e16d2fc40", "hex").toString(
							"base64",
						),
					},
					{ address, data: PACKETS.bthomeThermometerNext },
				]);
				expect(response).to.deep.equal({
					error: null,
					result: { accepted: 2, rejected: 2 },
				});

				await waitForValue(harness, `${address}.temperature`, 25.5);
			});

			it("rejects messages it does not understand", async function () {
				this.timeout(30000);

				for (const message of [
					"advertisement",
					{ items: [] },
					{ gatewayId: "proxy og", items: [] },
					{ gatewayId: GATEWAY },
					{ gatewayId: GATEWAY, items: new Array(501).fill({}) },
				]) {
					const response = await sendToAdapter(
						harness,
						"gateway:advertisements",
						message,
					);
					expect(
						response.error,
						JSON.stringify(message).slice(0, 60),
					).to.be.an("object");
					expect(response.error.code).to.equal("INVALID_PAYLOAD");
					expect(response.error.message).to.be.a("string").that.is.not
						.empty;
				}
				expect(harness.isAdapterRunning(), "adapter is running").to.be
					.true;
			});

			it("lists the received devices", async function () {
				this.timeout(30000);

				const response = await sendToAdapter(harness, "getDevices", {});
				expect(response.error).to.be.null;
				const device = response.result.find(
					(/** @type {any} */ d) => d.address === "a4:c1:38:00:00:02",
				);
				expect(device, "the device").to.be.ok;
				expect(device.name).to.equal("ATC_123456");
				expect(device.gateways).to.have.length(1);
				expect(device.gateways[0]).to.include({
					id: `test.0:${GATEWAY}`,
					rssi: -70,
				});
			});
		},
	);

	suite(
		"Gateway interface - new devices and monitored services",
		(getHarness) => {
			/** @type {any} */
			let harness;
			const known = "a4:c1:38:12:34:56";

			before(async function () {
				this.timeout(60000);
				harness = getHarness();
				// With this configuration only the service of the BTHome plugin (fcd2) is monitored
				await startAdapter(harness, {
					plugins: "bthome",
					services: "",
				});
			});

			after(() => stopAdapter(harness));

			it("does not record new devices unless the user allows it", async function () {
				this.timeout(30000);

				expect(
					await getValue(harness, "options.allowNewDevices"),
				).to.equal(false);
				const response = await deliver(harness, GATEWAY, [
					{ address: known, data: PACKETS.bthomeThermometer },
				]);
				// The advertisement is valid, it is just not recorded
				expect(response.result).to.deep.equal({
					accepted: 1,
					rejected: 0,
				});

				await delay(1000);
				expect(await deviceExists(harness, known)).to.be.false;
			});

			it("records new devices while the user allows it", async function () {
				this.timeout(30000);

				await allowNewDevices(harness);
				await deliver(harness, GATEWAY, [
					{ address: known, data: PACKETS.bthomeThermometer },
				]);

				await waitForValue(harness, `${known}.temperature`, 25);
			});

			it("only handles advertisements of the monitored services", async function () {
				this.timeout(30000);
				const otherService = "a4:c1:38:00:00:02";
				const manufacturerDataOnly = "c0:cd:26:60:01:a0";
				const marker = "a4:c1:38:00:00:04";

				await deliver(harness, GATEWAY, [
					{ address: otherService, data: PACKETS.unknownDevice },
					{ address: manufacturerDataOnly, data: PACKETS.ruuviTag },
					// Handled after the ones above
					{ address: marker, data: PACKETS.bthomeThermometer },
				]);

				await waitForValue(harness, `${marker}.temperature`, 25);
				await delay(300);
				expect(await deviceExists(harness, otherService)).to.be.false;
				expect(await deviceExists(harness, manufacturerDataOnly)).to.be
					.false;

				// They are not listed either
				const devices = await sendToAdapter(harness, "getDevices", {});
				expect(
					devices.result
						.map((/** @type {any} */ d) => d.address)
						.sort(),
				).to.deep.equal([marker, known].sort());
			});

			it("keeps updating known devices after new ones are no longer accepted", async function () {
				this.timeout(30000);
				const unknown = "a4:c1:38:00:00:06";

				const id = `${NAMESPACE}.options.allowNewDevices`;
				await harness.states.setStateAsync(id, {
					val: false,
					ack: false,
				});
				await waitFor(async () => {
					const state = await harness.states.getStateAsync(id);
					return state.val === false && state.ack === true;
				}, "the adapter to stop accepting new devices");

				await deliver(harness, GATEWAY, [
					{ address: unknown, data: PACKETS.bthomeThermometer },
					{ address: known, data: PACKETS.bthomeThermometerNext },
				]);

				await waitForValue(harness, `${known}.temperature`, 25.5);
				await delay(300);
				expect(await deviceExists(harness, unknown)).to.be.false;
			});

			it("handles a monitored service the device only lists", async function () {
				this.timeout(30000);
				const address = "a4:c1:38:00:00:07";

				await allowNewDevices(harness);
				await deliver(harness, GATEWAY, [
					{
						address,
						// Lists the BTHome service, the data belongs to another one
						data: buildAdvertisement(
							[AD.completeServices16, "d2fc"],
							[AD.serviceData16, "1a18" + "0102"],
						),
					},
				]);

				// No BTHome data, so the default plugin records the raw data
				await waitForValue(harness, `${address}.services.181a`, "0102");
			});
		},
	);
};
