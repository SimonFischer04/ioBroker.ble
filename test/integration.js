// @ts-check

const assert = require("node:assert/strict");
const path = require("path");
const { tests } = require("@iobroker/testing");
const adapterDir = path.join(__dirname, "..");

// Run tests
tests.integration(adapterDir, {
	// Use a reproducible controller version instead of a moving development build.
	controllerVersion: "7.2.5",
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
	},
});
