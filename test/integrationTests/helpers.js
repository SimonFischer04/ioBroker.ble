// @ts-check

/**
 * Helpers to talk to the adapter the way another adapter does: with sendTo
 */

const NAMESPACE = "ble.0";

/** The instance the test harness sends messages as. Gateways are named after it. */
const SENDER = "test.0";

/**
 * Sleeps for the given time
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls until the check returns a truthy value
 *
 * @param {() => Promise<any>} check - Returns the result once the condition is met, a falsy value otherwise
 * @param {string} description - Used in the timeout error
 * @param {number} [timeoutMs] - How long to wait before giving up
 * @returns {Promise<any>} The first truthy result of check
 * @throws {Error} When the condition was not met within the timeout
 */
async function waitFor(check, description, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	do {
		try {
			const result = await check();
			if (result) {
				return result;
			}
		} catch (error) {
			lastError = error;
		}
		await delay(100);
	} while (Date.now() < deadline);
	throw new Error(
		`Timed out after ${timeoutMs}ms waiting for ${description}${
			lastError ? ` (last error: ${lastError})` : ""
		}`,
	);
}

/**
 * Sends a message to the adapter and resolves with its answer.
 * The harness matches answers by order, so messages must be sent one after the other.
 *
 * @param {any} harness - Integration test harness
 * @param {string} command - Message command
 * @param {any} message - Message payload
 * @param {number} [timeoutMs] - How long to wait for the answer
 * @returns {Promise<any>} The answer of the adapter
 */
function sendToAdapter(harness, command, message, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() =>
				reject(
					new Error(
						`No answer to "${command}" within ${timeoutMs}ms`,
					),
				),
			timeoutMs,
		);
		harness.sendTo(NAMESPACE, command, message, (response) => {
			clearTimeout(timer);
			resolve(response);
		});
	});
}

/**
 * Builds the payload of an advertisement as it is received over the air: a sequence of
 * AD structures (length, type, data).
 *
 * @param {[type: number, hex: string][]} structures - The AD structures, data as hex string
 * @returns {string} The payload, base64 encoded like the gateway interface expects it
 */
function buildAdvertisement(...structures) {
	return Buffer.concat(
		structures.map(([type, hex]) => {
			const data = Buffer.from(hex, "hex");
			return Buffer.concat([Buffer.from([data.length + 1, type]), data]);
		}),
	).toString("base64");
}

/** AD types, see Bluetooth Assigned Numbers 2.3 */
const AD = {
	flags: 0x01,
	completeServices16: 0x03,
	completeName: 0x09,
	serviceData16: 0x16,
	manufacturerData: 0xff,
};

/**
 * Packets as the devices send them. The payloads are the ones the unit tests of the decoders use.
 */
const PACKETS = {
	/** BTHome v2 thermometer (e.g. pvvx firmware): packet 0xa5, battery 100 %, 25.00 °C, 50.55 % */
	bthomeThermometer: buildAdvertisement(
		[AD.flags, "06"],
		[AD.serviceData16, "d2fc" + "4000a5016402c40903bf13"],
	),
	/** The same thermometer a measurement later: packet 0xa6, battery 100 %, 25.50 °C, 49.00 % */
	bthomeThermometerNext: buildAdvertisement(
		[AD.flags, "06"],
		[AD.serviceData16, "d2fc" + "4000a6016402f609032413"],
	),
	/** BTHome v2 motion sensor with button: battery 100 %, 6 lx, motion, button pressed */
	bthomeMotion: buildAdvertisement(
		[AD.flags, "06"],
		[AD.serviceData16, "d2fc" + "44009801640558020021013a01"],
	),
	/** Xiaomi MiBeacon (service fe95) of a LYWSDCGQ thermometer: humidity 56 % */
	xiaomiHumidity: buildAdvertisement(
		[AD.flags, "06"],
		[AD.serviceData16, "95fe" + "70205b04d4281061c8593f090610023002"],
	),
	/** RuuviTag, data format 3 in the manufacturer data (company 0x0499) */
	ruuviTag: buildAdvertisement(
		[AD.flags, "06"],
		[AD.manufacturerData, "990403581b08baa8ffc3004303f90bb3"],
	),
	/** A device no plugin knows: a name and service data for the service 181a */
	unknownDevice: buildAdvertisement(
		[AD.flags, "06"],
		[AD.completeName, Buffer.from("ATC_123456").toString("hex")],
		[AD.serviceData16, "1a18" + "a4c13812345600c4"],
	),
	/** A phone or similar: only flags and a service list, no data */
	withoutData: buildAdvertisement(
		[AD.flags, "1a"],
		[AD.completeServices16, "0f18"],
	),
};

/**
 * Delivers advertisements like a gateway adapter does
 *
 * @param {any} harness - Integration test harness
 * @param {string} gatewayId - ID of the gateway within the sender
 * @param {{address: string, rssi?: number, data: string, addressType?: string}[]} items - The advertisements
 * @returns {Promise<any>} The answer of the adapter
 */
function deliver(harness, gatewayId, items) {
	return sendToAdapter(harness, "gateway:advertisements", {
		gatewayId,
		items: items.map((item) => ({ rssi: -70, ...item })),
	});
}

/**
 * Allows the adapter to record new devices, like the checkbox in the settings does
 *
 * @param {any} harness - Integration test harness
 * @returns {Promise<void>}
 */
async function allowNewDevices(harness) {
	const id = `${NAMESPACE}.options.allowNewDevices`;
	await harness.states.setStateAsync(id, { val: true, ack: false });
	await waitFor(async () => {
		const state = await harness.states.getStateAsync(id);
		return state && state.val === true && state.ack === true;
	}, "the adapter to accept new devices");
}

/**
 * Reads the value of a state of the adapter
 *
 * @param {any} harness - Integration test harness
 * @param {string} id - ID of the state, relative to the namespace of the adapter
 * @returns {Promise<any>} The value, undefined if the state does not exist
 */
async function getValue(harness, id) {
	const state = await harness.states.getStateAsync(`${NAMESPACE}.${id}`);
	return state ? state.val : undefined;
}

/**
 * Waits until a state of the adapter has the expected value
 *
 * @param {any} harness - Integration test harness
 * @param {string} id - ID of the state, relative to the namespace of the adapter
 * @param {any} expected - The expected value
 * @param {number} [timeoutMs] - How long to wait before giving up
 * @returns {Promise<void>}
 */
async function waitForValue(harness, id, expected, timeoutMs) {
	let actual;
	try {
		await waitFor(
			async () => {
				actual = await getValue(harness, id);
				return actual === expected;
			},
			`${id} to be ${JSON.stringify(expected)}`,
			timeoutMs,
		);
	} catch (e) {
		throw new Error(
			`${/** @type {Error} */ (e).message}, it is ${JSON.stringify(actual)}`,
		);
	}
}

/**
 * Configures the adapter and starts it. The Bluetooth adapter of the host is not used unless
 * the configuration says so, so the tests behave the same on every machine.
 *
 * @param {any} harness - Integration test harness
 * @param {Record<string, any>} [native] - Settings of the instance
 * @returns {Promise<void>}
 */
async function startAdapter(harness, native = {}) {
	await harness.changeAdapterConfig("ble", {
		native: { localScanner: false, ...native },
	});
	await harness.startAdapterAndWait();
	// The adapter answers messages once it has finished starting
	await waitFor(async () => {
		const response = await sendToAdapter(harness, "getGateways", {}, 2000);
		return response && response.error === null;
	}, "the adapter to answer messages");
}

/**
 * Stops the adapter if it is running
 *
 * @param {any} harness - Integration test harness
 * @returns {Promise<void>}
 */
async function stopAdapter(harness) {
	if (harness && harness.isAdapterRunning()) {
		await harness.stopAdapter();
	}
}

module.exports = {
	NAMESPACE,
	SENDER,
	PACKETS,
	AD,
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
};
