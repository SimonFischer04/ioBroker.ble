// @ts-check

const assert = require("node:assert/strict");
const path = require("node:path");
const { createServer } = require("node:net");
const { tests } = require("@iobroker/testing");
const adapterDir = path.join(__dirname, "..");

// Run tests
tests.integration(adapterDir, {
	// Exercise the declared minimum with a reproducible controller version.
	controllerVersion: "7.2.2",
	allowedExitCodes: [11],

	defineAdditionalTests({ it, suite }) {
		const ENV = { TESTING: "true" };

		suite("Renamed adapter namespace", (getHarness) => {
			it("creates ble2 objects and responds to ble2.0 messages", async function () {
				this.timeout(60000);
				const harness = getHarness();
				await harness.startAdapterAndWait(false, ENV);
				assert.equal(harness.adapterName, "ble2");
				// The controller marks the instance alive before ready() finishes.
				await new Promise((resolve) => setTimeout(resolve, 2500));
				const options = await harness.objects.getObjectAsync(
					"ble2.0.options.allowNewDevices",
				);
				assert.equal(options?._id, "ble2.0.options.allowNewDevices");
				// JSONConfig's live switch sends unacknowledged state commands.
				for (const val of [true, false]) {
					await harness.states.setStateAsync(options._id, {
						val,
						ack: false,
					});
					const deadline = Date.now() + 5000;
					let state;
					do {
						state = await harness.states.getStateAsync(options._id);
						if (state?.ack && state.val === val) {
							break;
						}
						await new Promise((resolve) => setTimeout(resolve, 50));
					} while (Date.now() < deadline);
					assert.equal(state?.val, val);
					assert.equal(state?.ack, true);
				}
				const response = await new Promise((resolve) => {
					harness.sendTo("ble2.0", "test", "message", resolve);
				});
				assert.deepEqual(response, { error: "Unknown command!" });
			});
		});

		suite("Mopeka remote scanner", (getHarness) => {
			it("creates and updates Mopeka states from TCP advertisements", async function () {
				this.timeout(60000);
				const harness = getHarness();
				const original = await harness.getAdapterConfig();
				let scannerSocket;
				let scannerError;
				const server = createServer((client) => {
					scannerSocket = client;
					client.on("error", (error) => {
						scannerError = error;
					});
				});
				await new Promise((resolve, reject) => {
					server.once("error", reject);
					server.listen(0, "127.0.0.1", resolve);
				});
				try {
					const address = server.address();
					assert.ok(address && typeof address !== "string");
					await harness.changeAdapterConfig("ble2", {
						native: {
							plugins: "mopeka",
							server: `127.0.0.1:${address.port}`,
						},
					});
					await harness.startAdapterAndWait(true, { TESTING: "" });
					assert.ok(scannerSocket);
					await harness.states.setStateAsync(
						"ble2.0.options.allowNewDevices",
						{ val: true, ack: false },
					);
					const enabledDeadline = Date.now() + 5000;
					while (Date.now() < enabledDeadline) {
						const state = await harness.states.getStateAsync(
							"ble2.0.options.allowNewDevices",
						);
						if (state?.val === true && state.ack) {
							break;
						}
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					const enabled = await harness.states.getStateAsync(
						"ble2.0.options.allowNewDevices",
					);
					assert.equal(enabled?.val, true);
					assert.equal(enabled?.ack, true);
					const prefix = "ble2.0.c9:f3:32:e0:f5:09";
					for (const { hex, values } of [
						{
							hex: "5900037043b6c3e0f509fae3",
							values: {
								mopeka_level_raw: 950,
								mopeka_reading_quality: 3,
								mopeka_temperature: 27,
								mopeka_battery_v: 3.5,
								mopeka_battery_percent: 100,
							},
						},
						{
							hex: "5900035128b603e0f509fae3",
							values: {
								mopeka_level_raw: null,
								mopeka_reading_quality: 0,
								mopeka_temperature: 0,
								mopeka_battery_v: 2.53125,
								mopeka_battery_percent: 51,
							},
						},
					]) {
						scannerSocket.write(
							`${JSON.stringify({
								type: "discover",
								peripheral: {
									id: "c9f332e0f509",
									address: "c9:f3:32:e0:f5:09",
									rssi: -63,
									advertisement: {
										serviceUuids: [],
										serviceData: [],
										manufacturerData: Buffer.from(
											hex,
											"hex",
										),
									},
								},
							})}\n`,
						);
						const deadline = Date.now() + 5000;
						while (Date.now() < deadline) {
							const quality = await harness.states.getStateAsync(
								`${prefix}.mopeka_reading_quality`,
							);
							const level = await harness.states.getStateAsync(
								`${prefix}.mopeka_level_raw`,
							);
							if (
								quality?.val ===
									values.mopeka_reading_quality &&
								level?.val === values.mopeka_level_raw &&
								level.ack
							) {
								break;
							}
							await new Promise((resolve) =>
								setTimeout(resolve, 50),
							);
						}
						for (const [id, value] of Object.entries(values)) {
							const obj = await harness.objects.getObjectAsync(
								`${prefix}.${id}`,
							);
							assert.equal(obj?.common.type, "number");
							assert.equal(obj?.common.write, false);
							const state = await harness.states.getStateAsync(
								`${prefix}.${id}`,
							);
							assert.equal(state?.val, value);
							assert.equal(state?.ack, true);
						}
					}
				} finally {
					// Finish TCP before terminating the peer process (Windows otherwise resets it).
					if (scannerSocket && !scannerSocket.destroyed) {
						await new Promise((resolve) => {
							scannerSocket.once("close", resolve);
							scannerSocket.end();
						});
					}
					await harness.stopAdapter();
					scannerSocket?.destroy();
					await new Promise((resolve) => server.close(resolve));
					if (original) {
						await harness.changeAdapterConfig("ble2", {
							native: original.native,
						});
					}
				}
				assert.ifError(scannerError);
			});
		});
	},
});
