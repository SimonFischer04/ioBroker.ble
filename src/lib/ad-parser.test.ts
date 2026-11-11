import { expect } from "chai";
import { parseAdvertisementData } from "./ad-parser";
import { normalizeAddress } from "./advertisement";

/** Builds the payload of an advertisement from [type, hex data] pairs */
function ad(...structures: [type: number, hex: string][]): Buffer {
	return Buffer.concat(
		structures.map(([type, hex]) => {
			const data = Buffer.from(hex, "hex");
			return Buffer.concat([Buffer.from([data.length + 1, type]), data]);
		}),
	);
}

describe("lib/ad-parser => parseAdvertisementData()", () => {
	it("returns empty lists for an empty payload", () => {
		expect(parseAdvertisementData(Buffer.alloc(0))).to.deep.equal({
			serviceUuids: [],
			serviceData: [],
		});
	});

	it("parses 16 bit service data with the UUID in the form the plugins expect", () => {
		// BTHome v2: the UUID 0xfcd2 is transmitted in little endian
		const parsed = parseAdvertisementData(
			ad([0x01, "06"], [0x16, "d2fc4000a5016402c40903bf13"]),
		);
		expect(parsed.serviceData).to.deep.equal([
			{
				uuid: "fcd2",
				data: Buffer.from("4000a5016402c40903bf13", "hex"),
			},
		]);
		expect(parsed.manufacturerData).to.be.undefined;
	});

	it("keeps the company ID in the manufacturer data", () => {
		// A real RuuviTag packet (data format 3), company ID 0x0499
		const parsed = parseAdvertisementData(
			ad([0x01, "06"], [0xff, "990403581b08baa8ffc3004303f90bb3"]),
		);
		expect(parsed.manufacturerData!.toString("hex")).to.equal(
			"990403581b08baa8ffc3004303f90bb3",
		);
	});

	it("parses the local name, the TX power and the service lists", () => {
		const parsed = parseAdvertisementData(
			ad(
				[0x09, Buffer.from("ATC_123456").toString("hex")],
				[0x0a, "fc"],
				[0x03, "1a180f18"],
				[0x02, "1a18"],
			),
		);
		expect(parsed.localName).to.equal("ATC_123456");
		expect(parsed.txPowerLevel).to.equal(-4);
		// without duplicates
		expect(parsed.serviceUuids).to.deep.equal(["181a", "180f"]);
	});

	it("parses 128 bit UUIDs without dashes", () => {
		const uuidLE = "fb349b5f8000008000100000d2fc0000";
		const parsed = parseAdvertisementData(
			ad([0x07, uuidLE], [0x21, uuidLE + "0102"]),
		);
		expect(parsed.serviceUuids).to.deep.equal([
			"0000fcd200001000800000805f9b34fb",
		]);
		expect(parsed.serviceData).to.deep.equal([
			{
				uuid: "0000fcd200001000800000805f9b34fb",
				data: Buffer.from("0102", "hex"),
			},
		]);
	});

	it("parses several service data entries, e.g. advertisement + scan response", () => {
		const parsed = parseAdvertisementData(
			ad([0x16, "95fe7020"], [0x16, "d2fc4000"]),
		);
		expect(parsed.serviceData!.map((s) => s.uuid)).to.deep.equal([
			"fe95",
			"fcd2",
		]);
	});

	it("stops at the padding at the end", () => {
		const raw = Buffer.concat([ad([0x16, "d2fc40"]), Buffer.alloc(5)]);
		expect(parseAdvertisementData(raw).serviceData).to.have.length(1);
	});

	it("keeps what was parsed when the payload is cut off", () => {
		const raw = Buffer.concat([
			ad([0x16, "d2fc40"]),
			// claims 10 bytes, but only 2 follow
			Buffer.from([0x0a, 0x16, 0x95, 0xfe]),
		]);
		expect(parseAdvertisementData(raw).serviceData).to.deep.equal([
			{ uuid: "fcd2", data: Buffer.from("40", "hex") },
		]);
	});

	it("ignores service data that is too short for its UUID", () => {
		expect(parseAdvertisementData(ad([0x16, "d2"])).serviceData).to.be
			.empty;
	});
});

describe("lib/advertisement => normalizeAddress()", () => {
	it("returns the form used for the device IDs", () => {
		expect(normalizeAddress("A4:C1:38:12:34:56")).to.equal(
			"a4:c1:38:12:34:56",
		);
		expect(normalizeAddress("a4-c1-38-12-34-56")).to.equal(
			"a4:c1:38:12:34:56",
		);
		expect(normalizeAddress("A4C138123456")).to.equal("a4:c1:38:12:34:56");
	});

	it("rejects everything else", () => {
		expect(normalizeAddress("a4:c1:38:12:34")).to.be.undefined;
		expect(normalizeAddress("a4:c1:38:12:34:5g")).to.be.undefined;
		expect(normalizeAddress("")).to.be.undefined;
		expect(normalizeAddress(undefined)).to.be.undefined;
		expect(normalizeAddress(0xa4c138123456)).to.be.undefined;
	});
});
