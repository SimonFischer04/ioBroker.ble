// @ts-check

/**
 * Multi Gateway Integration Test
 *
 * With several gateways in a house, the same packet of a device arrives several times: once
 * per gateway that receives it. The adapter must behave like there was one good receiver:
 * every packet is decoded once, and the signal strength of the device is the one of the
 * gateway that receives it best.
 */

const { expect } = require("chai");
const {
	NAMESPACE,
	PACKETS,
	SENDER,
	allowNewDevices,
	deliver,
	getValue,
	sendToAdapter,
	startAdapter,
	stopAdapter,
	waitFor,
	waitForValue,
} = require("./helpers");

const DEVICE = "a4:c1:38:12:34:56";
const FAR = `${SENDER}:proxy-keller`;
const NEAR = `${SENDER}:proxy-og`;

/**
 * Reads the gateways from the adapter, by ID
 *
 * @param {any} harness - Integration test harness
 * @returns {Promise<Record<string, any>>}
 */
async function getGateways(harness) {
	const response = await sendToAdapter(harness, "getGateways", {});
	expect(response.error).to.be.null;
	return Object.fromEntries(
		response.result.map((/** @type {any} */ g) => [g.id, g]),
	);
}

/** @param {(name: string, fn: (getHarness: () => any) => void) => void} suite */
exports.runTests = function (suite) {
	suite(
		"Several gateways - the same device received by more than one",
		(getHarness) => {
			/** @type {any} */
			let harness;

			before(async function () {
				this.timeout(60000);
				harness = getHarness();
				await startAdapter(harness, { plugins: "bthome" });
				await allowNewDevices(harness);
			});

			after(() => stopAdapter(harness));

			it("decodes a packet once, no matter how many gateways deliver it", async function () {
				this.timeout(30000);

				await deliver(harness, "proxy-keller", [
					{
						address: DEVICE,
						rssi: -85,
						data: PACKETS.bthomeThermometer,
					},
				]);
				await deliver(harness, "proxy-og", [
					{
						address: DEVICE,
						rssi: -55,
						data: PACKETS.bthomeThermometer,
					},
				]);

				await waitForValue(harness, `${DEVICE}.temperature`, 25);

				const gateways = await waitFor(async () => {
					const result = await getGateways(harness);
					return result[NEAR] && result[NEAR].duplicates === 1
						? result
						: undefined;
				}, "the second copy to be counted as duplicate");
				expect(gateways[FAR]).to.include({
					type: "remote",
					sender: SENDER,
					connected: true,
					advertisements: 1,
					duplicates: 0,
				});
				expect(gateways[NEAR]).to.include({
					type: "remote",
					sender: SENDER,
					connected: true,
					advertisements: 1,
					duplicates: 1,
				});
			});

			it("knows which gateways receive the device and how well", async function () {
				this.timeout(30000);

				const response = await sendToAdapter(harness, "getDevices", {});
				expect(response.error).to.be.null;
				expect(response.result).to.have.length(1);
				const [device] = response.result;
				expect(device.address).to.equal(DEVICE);
				// Strongest signal first
				expect(
					device.gateways.map((/** @type {any} */ g) => ({
						id: g.id,
						rssi: g.rssi,
					})),
				).to.deep.equal([
					{ id: NEAR, rssi: -55 },
					{ id: FAR, rssi: -85 },
				]);
				for (const gateway of device.gateways) {
					expect(gateway.lastSeen).to.be.closeTo(Date.now(), 20000);
				}
			});

			it("reports the signal strength of the gateway that receives the device best", async function () {
				this.timeout(30000);

				// The first packet came from the far gateway before the near one was known
				expect(await getValue(harness, `${DEVICE}.rssi`)).to.equal(-85);

				// The next packet is delivered by the far gateway first again
				await deliver(harness, "proxy-keller", [
					{
						address: DEVICE,
						rssi: -86,
						data: PACKETS.bthomeThermometerNext,
					},
				]);
				await deliver(harness, "proxy-og", [
					{
						address: DEVICE,
						rssi: -56,
						data: PACKETS.bthomeThermometerNext,
					},
				]);

				await waitForValue(harness, `${DEVICE}.temperature`, 25.5);
				// The far gateway delivered the packet, the value is the one the near gateway measured last
				await waitForValue(harness, `${DEVICE}.rssi`, -55);

				const gateways = await getGateways(harness);
				expect(gateways[FAR]).to.include({
					advertisements: 2,
					duplicates: 0,
				});
				expect(gateways[NEAR]).to.include({
					advertisements: 2,
					duplicates: 2,
				});
			});

			it("decodes a packet again when the device repeats it later", async function () {
				this.timeout(30000);

				// Sensors repeat the last packet until there is a new measurement. More than a
				// second later it is a new transmission, not a copy from another gateway.
				await new Promise((resolve) => setTimeout(resolve, 1200));
				await deliver(harness, "proxy-og", [
					{
						address: DEVICE,
						rssi: -50,
						data: PACKETS.bthomeThermometerNext,
					},
				]);

				await waitForValue(harness, `${DEVICE}.rssi`, -50);
				const gateways = await getGateways(harness);
				expect(gateways[NEAR]).to.include({
					advertisements: 3,
					duplicates: 2,
				});
			});

			it("creates states for every gateway", async function () {
				this.timeout(30000);

				for (const [gateway, objectId] of [
					[FAR, "gateways.test_0_proxy-keller"],
					[NEAR, "gateways.test_0_proxy-og"],
				]) {
					const channel = await waitFor(
						() =>
							harness.objects.getObjectAsync(
								`${NAMESPACE}.${objectId}`,
							),
						`the channel of ${gateway}`,
					);
					expect(channel.type).to.equal("channel");
					expect(channel.common.name).to.equal(gateway);
					expect(channel.native).to.deep.equal({
						id: gateway,
						type: "remote",
						sender: SENDER,
					});

					await waitForValue(harness, `${objectId}.connected`, true);
					const lastAdvertisement = await waitFor(
						() =>
							getValue(harness, `${objectId}.lastAdvertisement`),
						`the last advertisement of ${gateway}`,
					);
					expect(lastAdvertisement).to.be.closeTo(Date.now(), 30000);
				}
				expect(await getValue(harness, "info.connection")).to.equal(
					true,
				);
			});
		},
	);
};
