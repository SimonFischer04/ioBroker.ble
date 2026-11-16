import { Socket } from "net";
import type { GatewayDescription } from "../gateways/gateway-registry";
import {
	getMessageReviver,
	type ScanMessage,
} from "../lib/scanProcessInterface";
import type { Transport, TransportContext } from "./transport";

const RECONNECT_INTERVAL_MS = 10000;

/**
 * Receives advertisements from a scanner process that runs on another host
 * and serves them via TCP (option "server").
 */
export class NobleRemoteTransport implements Transport {
	public constructor(
		private readonly ctx: TransportContext,
		/** The address of the server as "host:port" */
		private readonly server: string,
	) {}

	public static readonly gateway: GatewayDescription = {
		id: "server",
		type: "server",
	};

	private socket: Socket | undefined;
	private stopped = false;
	private reconnectTimer: NodeJS.Timeout | undefined;

	public start(): void {
		this.stopped = false;
		this.connect();
	}

	private connect(): void {
		const { adapter, gateways } = this.ctx;
		this.socket = new Socket();

		const reviver = getMessageReviver<ScanMessage>((message) =>
			this.handleMessage(message),
		);
		let receiveBuffer = "";

		this.socket
			.on("close", () => {
				adapter.log.info("Disconnected from BLE server");
				gateways.setConnected(NobleRemoteTransport.gateway, false);
				// Try again later, the server may be restarting
				if (!this.stopped) {
					this.reconnectTimer = setTimeout(
						() => this.connect(),
						RECONNECT_INTERVAL_MS,
					);
				}
			})
			.on("error", (e) => {
				adapter.log.error(`BLE server connection failed: ${e.message}`);
			})
			.on("connect", () => {
				adapter.log.info("Connected to BLE server");
				gateways.setConnected(NobleRemoteTransport.gateway, true);
			})
			.on("data", (data) => {
				// Each message ends with a newline. We might receive multiple messages at once,
				// and we might also receive incomplete messages.
				receiveBuffer += data.toString();
				let newlineIndex: number;
				while ((newlineIndex = receiveBuffer.indexOf("\n")) > -1) {
					const line = receiveBuffer.slice(0, newlineIndex);
					receiveBuffer = receiveBuffer.slice(newlineIndex + 1);
					try {
						const msg = JSON.parse(line);
						reviver(msg);
					} catch (e) {
						console.error(e);
						console.error("data was: " + line);
					}
				}
			});

		const [host, port] = this.server.split(":", 2);

		adapter.log.info("connecting to BLE server...");
		this.socket.connect({
			host,
			port: +port,
		});
	}

	public stop(): void {
		this.stopped = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		try {
			this.socket?.destroy();
		} catch {}
	}

	private handleMessage(message: ScanMessage): void {
		const { adapter, gateways } = this.ctx;
		switch (message.type) {
			case "connected":
				gateways.setConnected(NobleRemoteTransport.gateway, true);
				break;
			case "disconnected":
				gateways.setConnected(NobleRemoteTransport.gateway, false);
				break;
			case "discover":
				if (message.peripheral == null) break;
				gateways.recordAdvertisements(NobleRemoteTransport.gateway, 1);
				this.ctx.onAdvertisement({
					...message.peripheral,
					gatewayId: NobleRemoteTransport.gateway.id,
				});
				break;
			case "driverState":
				adapter.setState("info.driverState", message.driverState, true);
				break;
			case "error": // fall through
			case "fatal":
				// A problem on the server must not stop the adapter
				adapter.log.error(message.error.message);
				break;
			case "log":
				adapter.log[message.level ?? "info"](message.message);
				break;
		}
	}
}
