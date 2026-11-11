import * as utils from "@iobroker/adapter-core";
import { createMessageHandler } from "./api/message-handler";
import { DeviceRegistry } from "./devices/device-registry";
import { GatewayRegistry } from "./gateways/gateway-registry";
import type { PeripheralInfo } from "./lib/advertisement";
import { Global as _ } from "./lib/global";
import { ObjectCache } from "./lib/object-cache";
// Load all registered plugins
import plugins from "./plugins";
import { AdvertisementProcessor } from "./scanner/advertisement-processor";
import { fixServiceName, matchesServiceFilter } from "./scanner/service-filter";
import { NobleLocalTransport } from "./transports/noble-local";
import { NobleRemoteTransport } from "./transports/noble-remote";
import { RemoteGatewayTransport } from "./transports/remote-gateway";
import type { Transport, TransportContext } from "./transports/transport";

let processor: AdvertisementProcessor | undefined;
let gateways: GatewayRegistry | undefined;
let remoteGateway: RemoteGatewayTransport | undefined;
let handleMessage: ((obj: ioBroker.Message) => void) | undefined;
/** The sources of advertisements that are in use */
const transports: Transport[] = [];

// Adapter-Objekt erstellen
const adapter = utils.adapter({
	name: "ble",
	// is called when databases are connected and adapter received configuration.
	// start here!
	ready: async () => {
		// Adapter-Instanz global machen
		_.adapter = adapter;

		// Cache objects for 1 minute
		_.objectCache = new ObjectCache(60000);

		// Workaround für fehlende InstanceObjects nach update
		await _.ensureInstanceObjects();

		// Plugins laden
		_.adapter.log.info(
			`loaded plugins: ${plugins.map((p) => p.name).join(", ")}`,
		);
		const enabledPluginNames: string[] = (
			(adapter.config.plugins as string) || ""
		)
			.split(",")
			.map((p: string) => p.trim().toLowerCase())
			.concat("_default");
		const enabledPlugins = plugins.filter(
			(p) => enabledPluginNames.indexOf(p.name.toLowerCase()) > -1,
		);
		_.adapter.log.info(
			`enabled plugins: ${enabledPlugins.map((p) => p.name).join(", ")}`,
		);

		// Bring the monitored service names into the correct form
		let services: string[] = [];
		if (adapter.config.services === "*") {
			_.adapter.log.info(`monitoring all services`);
		} else {
			services = ((adapter.config.services as string) || "")
				.split(",") // get manually defined services
				.concat(...enabledPlugins.map((p) => p.advertisedServices)) // concat with plugin-defined ones
				.reduce((acc, s) => acc.concat(s), [] as string[]) // flatten the arrays
				.map((s) => fixServiceName(s)) // cleanup the names
				.filter((s) => s !== "")
				.reduce((acc: any[], s) => {
					// filter out duplicates
					if (acc.indexOf(s) === -1) acc.push(s);
					return acc;
				}, []);
			_.adapter.log.info(`monitored services: ${services.join(", ")}`);
		}

		// Limit RSSI updates
		let rssiUpdateInterval = 0;
		if (adapter.config.rssiThrottle != null) {
			rssiUpdateInterval = Math.max(
				0,
				Math.min(10000, adapter.config.rssiThrottle),
			);
		}

		// The gateways are the sources of advertisements: the local Bluetooth adapter,
		// a remote scan server, and those other adapters deliver advertisements for
		const gatewayTimeout =
			typeof adapter.config.gatewayTimeout === "number" &&
			adapter.config.gatewayTimeout > 0
				? adapter.config.gatewayTimeout
				: 60;
		gateways = new GatewayRegistry(adapter, {
			remoteTimeoutMs: gatewayTimeout * 1000,
		});
		await gateways.init();

		const devices = new DeviceRegistry();
		processor = new AdvertisementProcessor(
			{
				plugins: enabledPlugins,
				allowEmptyDevices: !!adapter.config.allowEmptyDevices,
				rssiUpdateInterval,
			},
			devices,
			gateways,
		);
		const handleAdvertisement = (peripheral: PeripheralInfo): void => {
			processor!.process(peripheral).catch((e) => {
				adapter.log.error(
					`Could not handle the advertisement of ${peripheral.address}: ${
						(e as Error).message
					}`,
				);
			});
		};
		const transportContext: TransportContext = {
			adapter,
			gateways,
			onAdvertisement: handleAdvertisement,
		};

		// monitor our own states and objects
		adapter.subscribeStates("*");
		adapter.subscribeObjects("*");

		// Beim Start des Adapters sicher stellen, dass keine neuen Geräte erfasst werden,
		// bis der User es explizit erlaubt.
		await adapter.setStateAsync("options.allowNewDevices", false, true);

		// Other adapters can always deliver advertisements. The local scanner applies the
		// service filter while scanning, for those advertisements we have to do it here.
		remoteGateway = new RemoteGatewayTransport({
			...transportContext,
			onAdvertisement: (peripheral) => {
				if (matchesServiceFilter(peripheral, services)) {
					handleAdvertisement(peripheral);
				}
			},
		});
		transports.push(remoteGateway);
		handleMessage = createMessageHandler({
			adapter,
			gateways,
			devices,
			remoteGateway,
		});

		// And start scanning
		if (adapter.config.server) {
			transports.push(
				new NobleRemoteTransport(
					transportContext,
					adapter.config.server,
				),
			);
		} else if (adapter.config.localScanner !== false) {
			transports.push(
				new NobleLocalTransport(transportContext, {
					services,
					hciDevice: adapter.config.hciDevice,
				}),
			);
		} else {
			adapter.log.info(
				"The local Bluetooth adapter is not used, waiting for advertisements from external gateways",
			);
		}
		for (const transport of transports) transport.start();
	},

	// is called when adapter shuts down - callback has to be called under any circumstances!
	unload: (callback) => {
		try {
			for (const transport of transports) transport.stop();
			processor?.dispose();
			gateways?.dispose();
		} catch {}
		callback();
	},

	// is called if a subscribed object changes
	objectChange: (id, obj) => {
		if (!!obj) {
			// it has just been changed, so update the cached object
			_.objectCache.updateObject(obj);
		} else {
			// it has been deleted, so delete it from the cache
			_.objectCache.invalidateObject(id);
		}
	},

	// is called if a subscribed state changes
	stateChange: (id, state) => {
		if (
			/options\.allowNewDevices$/.test(id) &&
			id.startsWith(adapter.namespace) &&
			state != undefined &&
			!state.ack
		) {
			if (typeof state.val === "boolean") {
				// ACK the state change
				_.adapter.setState(id, state.val, true);
				processor?.setAllowNewDevices(state.val);
			}
			return;
		}

		// When an instance that delivers advertisements stops, its gateways are offline
		remoteGateway?.handleStateChange(id, state);
	},

	message: (obj) => {
		if (handleMessage) {
			handleMessage(obj);
		} else if (obj?.callback) {
			// The adapter is still starting
			adapter.sendTo(
				obj.from,
				obj.command,
				{ error: "The adapter is not ready yet" },
				obj.callback,
			);
		}
	},
});
