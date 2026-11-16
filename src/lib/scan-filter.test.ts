import { expect } from "chai";
import { matchesScanFilter } from "./scan-filter";
import type { PeripheralInfo } from "./scanProcessInterface";

describe("scan filter", () => {
	const services = ["feaa", "fe95"];
	const manufacturerIds = [0x0499];
	const peripheral = (
		advertisement: Partial<PeripheralInfo["advertisement"]>,
	) => ({ advertisement }) as PeripheralInfo;

	it("includes Ruuvi manufacturer data without any service UUIDs", () => {
		expect(
			matchesScanFilter(
				peripheral({
					manufacturerData: Buffer.from(
						"990403581b08baa8ffc3004303f90bb3",
						"hex",
					),
				}),
				services,
				manufacturerIds,
			),
		).to.be.true;
	});

	it("keeps matching advertised services and service data", () => {
		for (const advertisement of [
			{ serviceUuids: ["feaa"] },
			{ serviceData: [{ uuid: "fe95", data: Buffer.from([1]) }] },
		]) {
			expect(
				matchesScanFilter(
					peripheral(advertisement),
					services,
					manufacturerIds,
				),
			).to.be.true;
		}
	});

	it("excludes unrelated manufacturers and services", () => {
		expect(
			matchesScanFilter(
				peripheral({
					serviceUuids: ["180f"],
					manufacturerData: Buffer.from("4c000215", "hex"),
				}),
				services,
				manufacturerIds,
			),
		).to.be.false;
	});

	it("does not accept manufacturer data for a disabled plugin", () => {
		expect(
			matchesScanFilter(
				peripheral({ manufacturerData: Buffer.from("990403", "hex") }),
				services,
				[],
			),
		).to.be.false;
	});

	it("ignores absent or truncated manufacturer data", () => {
		for (const manufacturerData of [
			undefined,
			Buffer.alloc(0),
			Buffer.from([0x99]),
		]) {
			expect(
				matchesScanFilter(
					peripheral({ manufacturerData }),
					services,
					manufacturerIds,
				),
			).to.be.false;
		}
	});

	it("preserves wildcard scans", () => {
		expect(matchesScanFilter(peripheral({}), [], manufacturerIds)).to.be
			.true;
		expect(matchesScanFilter(peripheral({}), [], [])).to.be.true;
	});
});
