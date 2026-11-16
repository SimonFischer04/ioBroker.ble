import { exec } from "child_process";
import type { DeviceRegistry } from "../devices/device-registry";
import type { GatewayRegistry } from "../gateways/gateway-registry";
import { GatewayCommands } from "../lib/gateway-protocol";
import type { RemoteGatewayTransport } from "../transports/remote-gateway";

export interface MessageHandlerContext {
	adapter: ioBroker.Adapter;
	gateways: GatewayRegistry;
	devices: DeviceRegistry;
	remoteGateway: RemoteGatewayTransport;
}

/** Creates the handler for the messages other adapters and the admin UI send to this adapter */
export function createMessageHandler(
	ctx: MessageHandlerContext,
): (obj: ioBroker.Message) => void {
	const { adapter } = ctx;

	return (obj) => {
		if (!obj) return;

		// responds to the adapter that sent the original message
		function respond(response: any): void {
			if (obj.callback)
				adapter.sendTo(obj.from, obj.command, response, obj.callback);
		}

		switch (obj.command) {
			case "getHCIPorts":
				exec("hciconfig | grep hci", (error, stdout, _stderr) => {
					// hci1:   Type: BR/EDR  Bus: USB
					// hci0:   Type: BR/EDR  Bus: UART
					if (error != null) {
						respond({ error });
						return;
					}
					// parse index and bus type
					const ports: { index: number; bus: string }[] = [];
					const regex = /^hci(\d+)\:.+Bus\:\s(\w+)$/gm;
					let result: RegExpExecArray | null;

					while (true) {
						result = regex.exec(stdout);
						if (!(result && result.length)) break;
						const port = { index: +result[1], bus: result[2] };
						ports.push(port);
					}
					respond({ error: null, result: ports });
				});
				return;

			case GatewayCommands.advertisements: {
				// "system.adapter.esphome.0" -> "esphome.0"
				const sender = obj.from.replace(/^system\.adapter\./, "");
				respond(
					ctx.remoteGateway.handleAdvertisements(sender, obj.message),
				);
				return;
			}

			case GatewayCommands.getGateways:
				respond({ error: null, result: ctx.gateways.list() });
				return;

			case GatewayCommands.getDevices:
				respond({ error: null, result: ctx.devices.getDevices() });
				return;

			default:
				respond({ error: "Unknown command!" });
				return;
		}
	};
}
