// @ts-check

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

		suite("Test sendTo", (getHarness) => {
			it("Should work", function () {
				this.timeout(60000);
				return new Promise((resolve) => {
					const harness = getHarness();
					harness.startAdapterAndWait(false, ENV).then(() => {
						setTimeout(() => {
							harness.sendTo(
								"ble.0",
								"test",
								"message",
								(resp) => {
									console.dir(resp);
									resolve();
								},
							);
						}, 2500);
					});
				});
			});
		});
	},
});
