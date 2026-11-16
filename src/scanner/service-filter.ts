import type { PeripheralInfo } from "../lib/advertisement";

/** Brings a configured service name into the form used in advertisements */
export function fixServiceName(name: string | null | undefined): string {
	if (name == null) return "";
	name = name.trim();
	// No whitespace
	for (const char of ["\r", "\n", "\t", " "]) {
		name = name.replace(char, "");
	}
	// No leading 0x
	name = name.replace(/^0x/, "");
	// lowerCase
	return name.toLowerCase();
}

/**
 * Whether an advertisement contains one of the monitored services, either in its list of
 * services or as service data. An empty list of monitored services matches everything.
 *
 * The local scanner applies this filter while scanning. Advertisements from other gateways
 * arrive unfiltered, so the same rule has to be applied to them here.
 */
export function matchesServiceFilter(
	peripheral: PeripheralInfo,
	services: string[],
): boolean {
	if (services.length === 0) return true;
	const { serviceUuids, serviceData } = peripheral.advertisement ?? {};
	return (
		!!serviceUuids?.some((uuid) => services.includes(uuid)) ||
		!!serviceData?.some((entry) => services.includes(entry.uuid))
	);
}
