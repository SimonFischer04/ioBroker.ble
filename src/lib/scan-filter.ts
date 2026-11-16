import type { PeripheralInfo } from "./scanProcessInterface";

/** Match services or manufacturer data while preserving an unfiltered scan. */
export function matchesScanFilter(
	peripheral: PeripheralInfo,
	services: readonly string[],
	manufacturerIds: readonly number[],
): boolean {
	if (services.length === 0) return true;

	const advertisement = peripheral.advertisement;
	if (!advertisement) return false;
	if (
		advertisement.serviceUuids?.some((uuid) => services.includes(uuid)) ||
		advertisement.serviceData?.some(({ uuid }) => services.includes(uuid))
	) {
		return true;
	}

	const data = advertisement.manufacturerData;
	return (
		data != null &&
		data.length >= 2 &&
		manufacturerIds.includes(data.readUInt16LE(0))
	);
}
