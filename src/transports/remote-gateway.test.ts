import { expect } from "chai";
import { MAX_ADVERTISEMENTS_PER_MESSAGE } from "../lib/gateway-protocol";
import {
	parseGatewayMessage,
	type ParsedGatewayMessage,
} from "./remote-gateway";

// BTHome v2: battery 100 %, 25 °C, 50.55 %
const BTHOME = "AgEGDhbS/EAApQFkAsQJA78T";

function parse(payload: unknown): ParsedGatewayMessage {
	const result = parseGatewayMessage("esphome.0", payload);
	if ("error" in result) {
		throw new Error(`unexpected error: ${result.error!.message}`);
	}
	return result;
}

function expectInvalid(payload: unknown, message: RegExp): void {
	const result = parseGatewayMessage("esphome.0", payload) as any;
	expect(result.error?.code).to.equal("INVALID_PAYLOAD");
	expect(result.error.message).to.match(message);
}

describe("transports/remote-gateway => parseGatewayMessage()", () => {
	it("converts the advertisements into what the plugins work with", () => {
		const result = parse({
			gatewayId: "proxy-og",
			items: [
				{
					address: "A4:C1:38:12:34:56",
					addressType: "public",
					rssi: -67,
					data: BTHOME,
					connectable: true,
				},
			],
		});

		expect(result.gatewayId).to.equal("esphome.0:proxy-og");
		expect(result.rejected).to.equal(0);
		expect(result.peripherals).to.deep.equal([
			{
				id: "a4c138123456",
				uuid: "a4c138123456",
				// The form the device IDs have always had
				address: "a4:c1:38:12:34:56",
				addressType: "public",
				connectable: true,
				rssi: -67,
				gatewayId: "esphome.0:proxy-og",
				advertisement: {
					serviceUuids: [],
					serviceData: [
						{
							uuid: "fcd2",
							data: Buffer.from("4000a5016402c40903bf13", "hex"),
						},
					],
				},
			},
		]);
	});

	it("only needs address, rssi and data", () => {
		const [peripheral] = parse({
			gatewayId: "p1",
			items: [{ address: "a4:c1:38:12:34:56", rssi: -67, data: BTHOME }],
		}).peripherals;
		expect(peripheral.addressType).to.equal("unknown");
		expect(peripheral.connectable).to.be.undefined;
	});

	it("accepts an empty batch", () => {
		expect(parse({ gatewayId: "p1", items: [] }).peripherals).to.be.empty;
	});

	it("skips invalid items without discarding the batch", () => {
		const valid = { address: "a4:c1:38:12:34:56", rssi: -67, data: BTHOME };
		const result = parse({
			gatewayId: "p1",
			items: [
				valid,
				{ ...valid, address: "not a mac" },
				{ ...valid, rssi: "-67" },
				{ ...valid, rssi: NaN },
				{ ...valid, data: "not base64!" },
				{ ...valid, data: undefined },
				{ ...valid, data: "A".repeat(4000) },
				null,
				"a4:c1:38:12:34:56",
			],
		});
		expect(result.peripherals).to.have.length(1);
		expect(result.rejected).to.equal(8);
	});

	it("rejects messages that are not understood at all", () => {
		expectInvalid(undefined, /object/);
		expectInvalid("advertisement", /object/);
		expectInvalid({ items: [] }, /gatewayId/);
		expectInvalid({ gatewayId: "", items: [] }, /gatewayId/);
		expectInvalid({ gatewayId: "proxy og", items: [] }, /gatewayId/);
		expectInvalid({ gatewayId: "a".repeat(65), items: [] }, /gatewayId/);
		expectInvalid({ gatewayId: "p1" }, /items/);
		expectInvalid({ gatewayId: "p1", items: {} }, /items/);
		expectInvalid(
			{
				gatewayId: "p1",
				items: new Array(MAX_ADVERTISEMENTS_PER_MESSAGE + 1).fill({}),
			},
			/more than/,
		);
	});
});
