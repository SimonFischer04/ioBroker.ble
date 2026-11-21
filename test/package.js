const path = require("node:path");
const { tests } = require("@iobroker/testing");
const adapterDir = path.join(__dirname, "..");
tests.packageFiles(adapterDir);
