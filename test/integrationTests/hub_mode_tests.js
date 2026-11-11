// @ts-check

/**
 * Hub Mode Integration Test
 *
 * The adapter must work as a pure hub: without Bluetooth hardware, without the Bluetooth
 * driver (noble) in use, only handling advertisements other adapters deliver.
 *
 * The first suite disables the local Bluetooth adapter, like a user who only has ESPHome
 * proxies does. The second one leaves it enabled, which is the default: on a host without
 * Bluetooth hardware (like the CI runners) earlier versions terminated in that case, now the
 * adapter must keep running and still accept advertisements from gateways.
 */

const { spawnSync } = require("child_process");
const { expect } = require("chai");
const {
	PACKETS,
	SENDER,
	allowNewDevices,
	delay,
	deliver,
	getValue,
	sendToAdapter,
	startAdapter,
	stopAdapter,
	waitFor,
	waitForValue,
} = require("./helpers");

const DEVICE = "a4:c1:38:12:34:56";

/**
 * Lists the command lines of the child processes of a process
 *
 * @param {number} pid - ID of the parent process
 * @returns {string[] | undefined} undefined if they cannot be determined on this platform
 */
function getChildProcesses(pid) {
	if (process.platform !== "linux") {
		return undefined;
	}
	const result = spawnSync("ps", ["-o", "args=", "--ppid", String(pid)], {
		encoding: "utf8",
	});
	if (result.error) {
		return undefined;
	}
	// ps exits with 1 when there is no child process
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** @param {(name: string, fn: (getHarness: () => any) => void) => void} suite */
exports.runTests = function (suite) {
	suite("Hub mode - local Bluetooth adapter disabled", (getHarness) => {
		/** @type {any} */
		let harness;

		before(async function () {
			this.timeout(60000);
			harness = getHarness();
			await startAdapter(harness, {
				localScanner: false,
				plugins: "bthome",
			});
		});

		after(() => stopAdapter(harness));

		it("runs without a source of advertisements", async function () {
			this.timeout(30000);

			// Long enough for a scanner process to start and fail, if there was one
			await delay(3000);
			expect(harness.isAdapterRunning(), "adapter is running").to.be.true;

			const gateways = await sendToAdapter(harness, "getGateways", {});
			expect(gateways).to.deep.equal({ error: null, result: [] });
			expect(await getValue(harness, "info.connection")).to.equal(false);
		});

		it("does not start the scanner of the local Bluetooth adapter", async function () {
			this.timeout(30000);

			// The Bluetooth driver runs in a child process of the adapter
			const children = getChildProcesses(harness.adapterProcess.pid);
			if (children === undefined) {
				// Cannot be determined on this platform
				this.skip();
			}
			expect(children, "child processes of the adapter").to.deep.equal(
				[],
			);
		});

		it("still rejects unknown commands", async function () {
			this.timeout(30000);

			const response = await sendToAdapter(harness, "doesNotExist", {});
			expect(response).to.deep.equal({ error: "Unknown command!" });
		});

		it("handles the advertisements a gateway delivers", async function () {
			this.timeout(30000);

			await allowNewDevices(harness);
			const response = await deliver(harness, "proxy-og", [
				{ address: DEVICE, rssi: -67, data: PACKETS.bthomeThermometer },
			]);
			expect(response).to.deep.equal({
				error: null,
				result: { accepted: 1, rejected: 0 },
			});

			await waitForValue(harness, `${DEVICE}.temperature`, 25);
			await waitForValue(harness, "info.connection", true);
			const gateways = await sendToAdapter(harness, "getGateways", {});
			expect(
				gateways.result.map((/** @type {any} */ g) => g.id),
			).to.deep.equal([`${SENDER}:proxy-og`]);
		});
	});

	suite(
		"Hub mode - local Bluetooth adapter enabled, but possibly no hardware",
		(getHarness) => {
			/** @type {any} */
			let harness;

			before(async function () {
				this.timeout(60000);
				harness = getHarness();
				// The default configuration of a new instance
				await startAdapter(harness, {
					localScanner: true,
					plugins: "bthome",
				});
			});

			after(() => stopAdapter(harness));

			it("keeps running, whether the host has Bluetooth hardware or not", async function () {
				this.timeout(60000);

				// Wait until the scanner either works or has given up
				const deadline = Date.now() + 8000;
				while (Date.now() < deadline) {
					expect(harness.isAdapterRunning(), "adapter is running").to
						.be.true;
					const gateways = await sendToAdapter(
						harness,
						"getGateways",
						{},
					);
					const local = gateways.result.find(
						(/** @type {any} */ g) => g.id === "local",
					);
					if (local && local.connected) {
						break;
					}
					await delay(500);
				}
				expect(harness.isAdapterRunning(), "adapter is running").to.be
					.true;
			});

			it("handles the advertisements a gateway delivers", async function () {
				this.timeout(30000);

				await allowNewDevices(harness);
				await deliver(harness, "proxy-og", [
					{
						address: DEVICE,
						rssi: -67,
						data: PACKETS.bthomeThermometer,
					},
				]);
				await waitForValue(harness, `${DEVICE}.temperature`, 25);

				const gateways = await waitFor(async () => {
					const response = await sendToAdapter(
						harness,
						"getGateways",
						{},
					);
					return response.result.some(
						(/** @type {any} */ g) =>
							g.id === `${SENDER}:proxy-og` && g.connected,
					);
				}, "the gateway to be listed");
				expect(gateways).to.be.true;
				await waitForValue(harness, "info.connection", true);
			});
		},
	);
};
