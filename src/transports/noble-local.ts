import { fork, type ChildProcess } from "child_process";
import * as path from "path";
import type { GatewayDescription } from "../gateways/gateway-registry";
import {
	ScanExitCodes,
	getMessageReviver,
	type ScanMessage,
} from "../lib/scanProcessInterface";
import { classifyScanError } from "./scan-errors";
import type { Transport, TransportContext } from "./transport";

export interface NobleLocalOptions {
	/** Which BLE services to scan for. Empty = all. */
	services: string[];
	/** Index of the HCI device to use */
	hciDevice?: number;
}

const HUB_HINT =
	"The adapter keeps running and accepts advertisements from external gateways.";

/**
 * Scans with the Bluetooth adapter of this host. The Bluetooth driver (noble) runs in a
 * child process, so its native code is only loaded when the local scanner is used and
 * cannot bring down the adapter.
 */
export class NobleLocalTransport implements Transport {
	public constructor(
		private readonly ctx: TransportContext,
		private readonly options: NobleLocalOptions,
	) {}

	public static readonly gateway: GatewayDescription = {
		id: "local",
		type: "local",
	};

	private scanProcess: ChildProcess | undefined;
	/** Whether the scanner was stopped for good */
	private stopped = false;

	public start(): void {
		if (this.stopped) return;
		const { adapter } = this.ctx;

		const args: string[] = ["-s", ...this.options.services];
		if (this.options.hciDevice) {
			args.push("-d", this.options.hciDevice.toString());
		}
		adapter.log.info("starting scanner process...");
		this.scanProcess = fork(
			path.join(__dirname, "..", "scanProcess"),
			args,
			{
				stdio: ["pipe", "pipe", "pipe", "ipc"],
			},
		).on("exit", (code, signal) => {
			this.ctx.gateways.setConnected(NobleLocalTransport.gateway, false);
			if (
				!this.stopped &&
				!signal &&
				code !== 0 &&
				code !== ScanExitCodes.RequireNobleFailed
			) {
				adapter.log.warn("scanner process crashed, restarting...");
				setImmediate(() => this.start());
			} else {
				this.scanProcess = undefined;
			}
		});
		this.scanProcess.on(
			"message",
			getMessageReviver<ScanMessage>((message) =>
				this.handleMessage(message),
			),
		);
	}

	public stop(): void {
		this.stopped = true;
		try {
			this.scanProcess?.kill();
		} catch {}
	}

	private handleMessage(message: ScanMessage): void {
		const { adapter, gateways } = this.ctx;
		switch (message.type) {
			case "connected":
				gateways.setConnected(NobleLocalTransport.gateway, true);
				break;
			case "disconnected":
				gateways.setConnected(NobleLocalTransport.gateway, false);
				break;
			case "discover":
				if (message.peripheral == null) break;
				gateways.recordAdvertisements(NobleLocalTransport.gateway, 1);
				this.ctx.onAdvertisement({
					...message.peripheral,
					gatewayId: NobleLocalTransport.gateway.id,
				});
				break;
			case "driverState":
				adapter.setState("info.driverState", message.driverState, true);
				break;
			case "error": // fall through
			case "fatal":
				this.handleError(message.error);
				break;
			case "log":
				adapter.log[message.level ?? "info"](message.message);
				break;
		}
	}

	/**
	 * A problem with the local Bluetooth adapter must not stop the adapter:
	 * it may still receive advertisements from external gateways.
	 */
	private handleError(err: Error): void {
		const { adapter } = this.ctx;
		switch (classifyScanError(err)) {
			case "no-hardware":
				adapter.log.error(
					`No compatible BLE 4.0 hardware found! The local Bluetooth adapter is not used. ${HUB_HINT}`,
				);
				this.stop();
				break;
			case "address-family-not-supported":
				adapter.log.error(
					`Unsupported Address Family (EAFNOSUPPORT). If ioBroker is running in a Docker container, make sure that the container uses host mode networking. The local Bluetooth adapter is not used. ${HUB_HINT}`,
				);
				this.stop();
				break;
			case "driver-missing":
				// The scanner process exits by itself in this case
				adapter.log.error(
					`The Bluetooth driver (noble) is not installed: ${err.message}. The local Bluetooth adapter is not used. ${HUB_HINT}`,
				);
				break;
			case "rebuild-required":
				if (adapter.supportsFeature?.("CONTROLLER_NPM_AUTO_REBUILD")) {
					adapter.log.error(
						"Terminating because a dependency requires a rebuild.",
					);
					this.stop();
					adapter.terminate?.("A dependency requires a rebuild.", 13);
					process.exit(13);
				}
				adapter.log.error(err.message);
				break;
			default:
				// This is something unexpected. We don't want to bring down the main process, so just log it
				adapter.log.error(err.message);
				break;
		}
	}
}
