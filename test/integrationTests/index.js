// @ts-check

const gateway_advertisement_tests = require("./gateway_advertisement_tests");
const gateway_lifecycle_tests = require("./gateway_lifecycle_tests");
const hub_mode_tests = require("./hub_mode_tests");
const multi_gateway_tests = require("./multi_gateway_tests");

// Every suite exports runTests(suite) and is registered here.
//
// All suites run always: they need neither Bluetooth hardware nor a second adapter. The
// advertisements are delivered the way another adapter does it, with sendTo, see helpers.js.
// A harness cannot start the adapter again after stopAdapter(), so every scenario that needs
// its own configuration gets its own suite.

/** @param {(name: string, fn: (getHarness: () => any) => void) => void} suite */
exports.runTests = function (suite) {
	// The adapter without Bluetooth hardware and without the Bluetooth driver in use
	hub_mode_tests.runTests(suite);

	// Real packets of the supported devices, delivered by a gateway
	gateway_advertisement_tests.runTests(suite);

	// Several gateways receiving the same devices
	multi_gateway_tests.runTests(suite);

	// Gateways appearing, going offline and coming back
	gateway_lifecycle_tests.runTests(suite);
};
