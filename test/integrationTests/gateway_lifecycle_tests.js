// @ts-check

/**
 * Gateway Lifecycle Integration Test
 *
 * Gateways are not registered: one appears with its first advertisement. It is offline when
 * it delivers nothing for a while (60 seconds by default, 2 seconds in the first suite), or
 * immediately when the instance that delivers for it is stopped. info.connection tells
 * whether at least one source of advertisements is active.
 */

const { expect } = require("chai");
const {
	NAMESPACE,
	PACKETS,
	SENDER,
	deliver,
	getValue,
	sendToAdapter,
	startAdapter,
	stopAdapter,
	waitForValue,
} = require("./helpers");

const DEVICE = "a4:c1:38:12:34:56";
const OG = "gateways.test_0_proxy-og";
const EG = "gateways.test_0_proxy-eg";

/**
 * Whether the adapter lists the gateway as active
 *
 * @param {any} harness - Integration test harness
 * @param {string} id - ID of the gateway
 * @returns {Promise<boolean | undefined>} undefined if the gateway is not listed
 */
async function isConnected(harness, id) {
	const response = await sendToAdapter(harness, "getGateways", {});
	const gateway = response.result.find((/** @type {any} */ g) => g.id === id);
	return gateway ? gateway.connected : undefined;
}

/** @param {(name: string, fn: (getHarness: () => any) => void) => void} suite */
exports.runTests = function (suite) {
	suite(
		"Gateway lifecycle - appearing, going offline and coming back",
		(getHarness) => {
			/** @type {any} */
			let harness;
			const STALE = "gateways.test_0_proxy-old";

			before(async function () {
				this.timeout(60000);
				harness = getHarness();

				// A gateway that was active when the adapter was stopped the last time
				await harness.objects.setObjectAsync(
					`${NAMESPACE}.${STALE}.connected`,
					{
						type: "state",
						common: {
							name: "Gateway is active",
							role: "indicator.reachable",
							type: "boolean",
							read: true,
							write: false,
						},
						native: {},
					},
				);
				await harness.states.setStateAsync(
					`${NAMESPACE}.${STALE}.connected`,
					{
						val: true,
						ack: true,
					},
				);

				await startAdapter(harness, {
					plugins: "bthome",
					gatewayTimeout: 2,
				});
			});

			after(() => stopAdapter(harness));

			it("starts without an active gateway", async function () {
				this.timeout(30000);

				const response = await sendToAdapter(
					harness,
					"getGateways",
					{},
				);
				expect(response).to.deep.equal({ error: null, result: [] });
				expect(await getValue(harness, "info.connection")).to.equal(
					false,
				);
				// Gateways of the last run are offline until they deliver again
				expect(await getValue(harness, `${STALE}.connected`)).to.equal(
					false,
				);
			});

			it("creates a gateway with its first advertisement", async function () {
				this.timeout(30000);

				const before = Date.now();
				await deliver(harness, "proxy-og", [
					{ address: DEVICE, data: PACKETS.bthomeThermometer },
				]);

				await waitForValue(harness, `${OG}.connected`, true);
				await waitForValue(harness, "info.connection", true);
				expect(await isConnected(harness, `${SENDER}:proxy-og`)).to.be
					.true;

				const response = await sendToAdapter(
					harness,
					"getGateways",
					{},
				);
				expect(response.result[0].lastAdvertisement).to.be.within(
					before - 1000,
					Date.now() + 1000,
				);
			});

			it("marks a gateway offline when it stops delivering", async function () {
				this.timeout(30000);

				await waitForValue(harness, `${OG}.connected`, false, 8000);
				await waitForValue(harness, "info.connection", false);
				expect(await isConnected(harness, `${SENDER}:proxy-og`)).to.be
					.false;
			});

			it("marks the gateway online again with the next advertisement", async function () {
				this.timeout(30000);

				// An empty batch is enough: the gateway is there, it just received nothing
				const response = await deliver(harness, "proxy-og", []);
				expect(response.result).to.deep.equal({
					accepted: 0,
					rejected: 0,
				});

				await waitForValue(harness, `${OG}.connected`, true);
				await waitForValue(harness, "info.connection", true);
			});

			it("stays connected as long as one gateway delivers", async function () {
				this.timeout(30000);

				// proxy-og goes silent, proxy-eg keeps delivering
				const deadline = Date.now() + 8000;
				while ((await getValue(harness, `${OG}.connected`)) !== false) {
					expect(
						Date.now(),
						"proxy-og went offline in time",
					).to.be.below(deadline);
					await deliver(harness, "proxy-eg", [
						{ address: DEVICE, data: PACKETS.bthomeThermometer },
					]);
					await new Promise((resolve) => setTimeout(resolve, 300));
				}

				expect(await getValue(harness, `${EG}.connected`)).to.equal(
					true,
				);
				expect(await getValue(harness, "info.connection")).to.equal(
					true,
				);
			});
		},
	);

	suite("Gateway lifecycle - the delivering instance stops", (getHarness) => {
		/** @type {any} */
		let harness;
		const ALIVE = `system.adapter.${SENDER}.alive`;

		before(async function () {
			this.timeout(60000);
			harness = getHarness();
			await harness.states.setStateAsync(ALIVE, { val: true, ack: true });
			// The default timeout of 60 seconds: silence cannot be the reason for going offline here
			await startAdapter(harness, { plugins: "bthome" });
		});

		after(() => stopAdapter(harness));

		it("marks all its gateways offline immediately", async function () {
			this.timeout(30000);

			await deliver(harness, "proxy-og", [
				{ address: DEVICE, data: PACKETS.bthomeThermometer },
			]);
			await deliver(harness, "proxy-eg", [
				{ address: DEVICE, data: PACKETS.bthomeThermometer },
			]);
			await waitForValue(harness, `${OG}.connected`, true);
			await waitForValue(harness, `${EG}.connected`, true);
			await waitForValue(harness, "info.connection", true);

			// js-controller sets this state when the instance stops
			await harness.states.setStateAsync(ALIVE, {
				val: false,
				ack: true,
			});

			await waitForValue(harness, `${OG}.connected`, false, 5000);
			await waitForValue(harness, `${EG}.connected`, false, 5000);
			await waitForValue(harness, "info.connection", false, 5000);
		});

		it("accepts its advertisements again after it was started", async function () {
			this.timeout(30000);

			await harness.states.setStateAsync(ALIVE, { val: true, ack: true });
			await deliver(harness, "proxy-og", [
				{ address: DEVICE, data: PACKETS.bthomeThermometer },
			]);

			await waitForValue(harness, `${OG}.connected`, true);
			await waitForValue(harness, "info.connection", true);
			// The other gateway has not delivered yet
			expect(await getValue(harness, `${EG}.connected`)).to.equal(false);
		});
	});
};
