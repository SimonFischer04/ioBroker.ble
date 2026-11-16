import type { AdvertisementData, ServiceData } from "./advertisement";

/**
 * Parses the raw payload of a BLE advertisement (a sequence of AD structures, see
 * Bluetooth Core Specification Supplement, Part A) into the shape `noble` produces,
 * so the decoder plugins work the same for advertisements from any source.
 *
 * The payload may be the advertisement and the scan response concatenated.
 * Malformed trailing data is ignored, everything parsed up to that point is returned.
 */
export function parseAdvertisementData(raw: Buffer): AdvertisementData {
	const serviceUuids: string[] = [];
	const serviceData: ServiceData[] = [];
	const ret: AdvertisementData = { serviceUuids, serviceData };

	let offset = 0;
	while (offset < raw.length) {
		const length = raw[offset];
		// A length of 0 marks the end of the significant part
		if (length === 0) break;
		// The structure must fit into the remaining data
		if (offset + 1 + length > raw.length) break;

		const type = raw[offset + 1];
		const data = raw.subarray(offset + 2, offset + 1 + length);
		offset += 1 + length;

		switch (type) {
			case 0x02: // Incomplete list of 16 bit service UUIDs
			case 0x03: // Complete list of 16 bit service UUIDs
				addUuids(serviceUuids, data, 2);
				break;
			case 0x04: // Incomplete list of 32 bit service UUIDs
			case 0x05: // Complete list of 32 bit service UUIDs
				addUuids(serviceUuids, data, 4);
				break;
			case 0x06: // Incomplete list of 128 bit service UUIDs
			case 0x07: // Complete list of 128 bit service UUIDs
				addUuids(serviceUuids, data, 16);
				break;

			case 0x08: // Shortened local name
			case 0x09: // Complete local name
				ret.localName = data.toString("utf8");
				break;

			case 0x0a: // TX power level
				if (data.length >= 1) ret.txPowerLevel = data.readInt8(0);
				break;

			case 0x16: // Service data, 16 bit UUID
				addServiceData(serviceData, data, 2);
				break;
			case 0x20: // Service data, 32 bit UUID
				addServiceData(serviceData, data, 4);
				break;
			case 0x21: // Service data, 128 bit UUID
				addServiceData(serviceData, data, 16);
				break;

			case 0xff: // Manufacturer specific data
				// Copy, so the result does not keep the whole input alive
				ret.manufacturerData = Buffer.from(data);
				break;
		}
	}

	return ret;
}

/** UUIDs are transmitted in little endian, the string form is big endian */
function uuidToString(bytes: Buffer): string {
	return Buffer.from(bytes).reverse().toString("hex");
}

function addUuids(target: string[], data: Buffer, uuidLength: number): void {
	for (let i = 0; i + uuidLength <= data.length; i += uuidLength) {
		const uuid = uuidToString(data.subarray(i, i + uuidLength));
		if (!target.includes(uuid)) target.push(uuid);
	}
}

function addServiceData(
	target: ServiceData[],
	data: Buffer,
	uuidLength: number,
): void {
	if (data.length < uuidLength) return;
	target.push({
		uuid: uuidToString(data.subarray(0, uuidLength)),
		data: Buffer.from(data.subarray(uuidLength)),
	});
}
