import type BTHomeModule = require("./bthome");
import { expect } from "chai";
import * as proxyquireModule from "proxyquire";
import { createGlobalMock } from "../../test/mocks/global";
import type { PeripheralInfo } from "../lib/scanProcessInterface";

const plugin = proxyquireModule.noPreserveCache()<typeof BTHomeModule>(
	"./bthome",
	{ "../lib/global": createGlobalMock({}) },
);

describe("BTHome plugin measurements", () => {
	it("creates matching objects and values for the added sensor types", () => {
		const peripheral = {
			advertisement: {
				serviceData: [
					{
						uuid: "fcd2",
						data: Buffer.from(
							"4055e803000059ff5afeff5bfdffffff5c02fbffff5e1027",
							"hex",
						),
					},
				],
			},
		} as PeripheralInfo;
		expect(plugin.isHandling(peripheral)).to.be.true;
		const context = plugin.createContext(peripheral)!;
		expect(context).to.exist;
		const objects = plugin.defineObjects(context)!;
		const values = plugin.getValues(context)!;
		expect(values).to.include({
			volume_storage: 1,
			count: -1,
			count_2: -2,
			count_3: -3,
			direction: 100,
		});
		expect(values.power).to.be.closeTo(-12.78, 0.000001);
		expect(objects.states.map((s) => s.id)).to.deep.equal(
			Object.keys(values),
		);
		expect(
			objects.states.find((s) => s.id === "volume_storage")!.common!.unit,
		).to.equal("L");
		expect(
			objects.states.find((s) => s.id === "power")!.common!.unit,
		).to.equal("W");
		expect(
			objects.states.find((s) => s.id === "direction")!.common!.unit,
		).to.equal("°");
	});
});
