import { expect } from "chai";
import type { PeripheralInfo } from "../lib/advertisement";
import { fixServiceName, matchesServiceFilter } from "./service-filter";

function peripheral(
	advertisement: PeripheralInfo["advertisement"],
): PeripheralInfo {
	return {
		id: "a4c138123456",
		uuid: "a4c138123456",
		address: "a4:c1:38:12:34:56",
		addressType: "public",
		rssi: -60,
		advertisement,
	};
}

describe("scanner/service-filter => matchesServiceFilter()", () => {
	const bthome = peripheral({
		serviceData: [{ uuid: "fcd2", data: Buffer.from("4000", "hex") }],
	});

	it("matches everything when no services are monitored", () => {
		expect(matchesServiceFilter(bthome, [])).to.be.true;
		expect(matchesServiceFilter(peripheral({}), [])).to.be.true;
	});

	it("matches service data of a monitored service", () => {
		expect(matchesServiceFilter(bthome, ["fe95", "fcd2"])).to.be.true;
		expect(matchesServiceFilter(bthome, ["fe95"])).to.be.false;
	});

	it("matches a monitored service in the list of services", () => {
		const p = peripheral({ serviceUuids: ["feaa"] });
		expect(matchesServiceFilter(p, ["feaa"])).to.be.true;
		expect(matchesServiceFilter(p, ["fcd2"])).to.be.false;
	});

	it("does not match advertisements with manufacturer data only", () => {
		const p = peripheral({ manufacturerData: Buffer.from("9904", "hex") });
		expect(matchesServiceFilter(p, ["feaa"])).to.be.false;
	});
});

describe("scanner/service-filter => fixServiceName()", () => {
	it("brings configured names into the form used in advertisements", () => {
		expect(fixServiceName(" 0xFCD2\n")).to.equal("fcd2");
		expect(fixServiceName("fe95")).to.equal("fe95");
		expect(fixServiceName(undefined)).to.equal("");
	});
});
