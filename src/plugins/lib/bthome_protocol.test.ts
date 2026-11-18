import { expect } from "chai";
import { BTHomeAdvertisement } from "./bthome_protocol";

function assertMultilevelSensor(
	packet: BTHomeAdvertisement,
	label: string,
	value: number,
) {
	const sensor = packet.multilevelSensors.find((s) => s.label === label);
	expect(sensor).to.exist;
	expect(sensor!.value).to.equal(value);
}

function assertBinarySensor(
	packet: BTHomeAdvertisement,
	label: string,
	value: boolean,
) {
	const sensor = packet.binarySensors.find((s) => s.label === label);
	expect(sensor).to.exist;
	expect(sensor!.value).to.equal(value);
}

describe("bthome protocol => ", () => {
	describe("additional BTHome v2 measurements", () => {
		// Examples from https://bthome.io/format/ (little-endian payloads).
		const examples = [
			{ hex: "59ea", label: "count", value: -22 },
			{ hex: "5aeaea", label: "count", value: -5398 },
			{ hex: "5bea0234ea", label: "count", value: -365690134 },
			{ hex: "5c02fbffff", label: "power", value: -12.78, unit: "W" },
			{
				hex: "5587562a01",
				label: "volume storage",
				value: 19551.879,
				unit: "L",
			},
			{ hex: "5e9f8c", label: "direction", value: 359.99, unit: "°" },
		];
		for (const { hex, label, value, unit } of examples) {
			it(`decodes the specification example for 0x${hex.slice(0, 2)}`, () => {
				const parsed = new BTHomeAdvertisement(
					Buffer.from(`40${hex}`, "hex"),
				);
				expect(parsed.multilevelSensors).to.have.length(1);
				expect(parsed.multilevelSensors[0].label).to.equal(label);
				expect(parsed.multilevelSensors[0].value).to.be.closeTo(
					value,
					0.000001,
				);
				expect(parsed.multilevelSensors[0].unit).to.equal(unit);
			});
			it(`rejects truncated payloads for 0x${hex.slice(0, 2)}`, () => {
				expect(
					() =>
						new BTHomeAdvertisement(
							Buffer.from(`40${hex.slice(0, -2)}`, "hex"),
						),
				).to.throw();
			});
		}
		for (const [hex, value] of [
			["5980", -128],
			["597f", 127],
			["5900", 0],
			["5a0080", -32768],
			["5aff7f", 32767],
			["5b00000080", -2147483648],
			["5bffffff7f", 2147483647],
		] as const) {
			it(`preserves the signed counter value ${value}`, () => {
				expect(
					new BTHomeAdvertisement(Buffer.from(`40${hex}`, "hex"))
						.multilevelSensors[0].value,
				).to.equal(value);
			});
		}
		it("keeps objects following the added measurements aligned", () => {
			const parsed = new BTHomeAdvertisement(
				Buffer.from(
					"4059015a02005b030000005c6400000055e80300005e10270164",
					"hex",
				),
			);
			expect(parsed.multilevelSensors.map((s) => s.value)).to.deep.equal([
				1, 2, 3, 1, 1, 100, 100,
			]);
		});
	});
	describe("packets should be parsed correctly => ", () => {
		it("incomplete packet", () => {
			function create(hex: string) {
				return new BTHomeAdvertisement(Buffer.from(hex, "hex"));
			}
			expect(() => create("")).to.throw("1 byte");
		});

		it("Test 1", () => {
			const frame = Buffer.from("44009801640558020021013a01", "hex");
			const parsed = new BTHomeAdvertisement(frame);

			parsed.packetId!.should.equal(0x98);
			assertMultilevelSensor(parsed, "battery", 100);
			assertMultilevelSensor(parsed, "illuminance", 6);
			assertBinarySensor(parsed, "motion", true);

			parsed.events.should.deep.equal([
				{
					type: "button",
					event: "press",
				},
			]);
		});
	});
});
