// @ts-check

const fs = require("fs");
const os = require("os");
const path = require("path");
const { tests } = require("@iobroker/testing");
const integrationTests = require("./integrationTests");

// The test installation in the temp directory is reused between runs. Its lockfiles pin the
// adapter package it was first installed with, so npm takes that one from its cache instead
// of the current build as long as the version is unchanged. Without them the adapter is
// installed from the freshly packed build. On CI the directory does not exist yet.
const testDir = path.join(os.tmpdir(), "test-iobroker.ble");
for (const lockfile of [
	"package-lock.json",
	path.join("node_modules", ".package-lock.json"),
]) {
	fs.rmSync(path.join(testDir, lockfile), { force: true });
}

// Runs the adapter in a test ioBroker installation,
// see https://github.com/ioBroker/testing for a detailed explanation and further options.
//
// The default test "The adapter starts" runs with the default configuration, which uses the
// Bluetooth adapter of the host. The CI runners have none: the adapter must keep running
// anyway, because it can still receive advertisements from external gateways. That is why
// no exit code is allowed here.
tests.integration(path.join(__dirname, ".."), {
	defineAdditionalTests({ suite }) {
		integrationTests.runTests(suite);
	},
});
