import type { GatewayInfo } from "../lib/gateway-protocol";

export interface GatewayRegistryOptions {
	/** A remote gateway is offline when it delivered nothing for this long */
	remoteTimeoutMs: number;
	/** How often the timestamp of the last advertisement is written to the states DB */
	lastAdvertisementIntervalMs: number;
}

const defaultOptions: GatewayRegistryOptions = {
	remoteTimeoutMs: 60000,
	lastAdvertisementIntervalMs: 10000,
};

interface GatewayEntry extends GatewayInfo {
	/** ID of the channel object, relative to the adapter namespace */
	objectId: string;
	/** Serializes the DB writes for this gateway, so they arrive in order */
	queue: Promise<void>;
	lastAdvertisementWritten: number;
}

export type GatewayDescription = Pick<GatewayInfo, "id" | "type" | "sender">;

/**
 * Knows all sources of advertisements (the local Bluetooth adapter, the remote scan server
 * and the gateways other adapters deliver advertisements for) and whether they are active.
 * Mirrors that to the states `gateways.<id>.*` and `info.connection`.
 */
export class GatewayRegistry {
	public constructor(
		private readonly adapter: ioBroker.Adapter,
		options: Partial<GatewayRegistryOptions> = {},
	) {
		this.options = { ...defaultOptions, ...options };
	}

	private readonly options: GatewayRegistryOptions;
	private readonly gateways = new Map<string, GatewayEntry>();
	private timer: NodeJS.Timeout | undefined;
	private anyConnected = false;
	private disposed = false;

	/** Must be called once before gateways are reported */
	public async init(): Promise<void> {
		// Gateways from the last run are offline until they deliver something again
		const states = await this.adapter.getStatesAsync(
			`${this.adapter.namespace}.gateways.*`,
		);
		for (const [id, state] of Object.entries(states ?? {})) {
			if (id.endsWith(".connected") && state?.val === true) {
				await this.adapter.setStateAsync(id, false, true);
			}
		}
		await this.adapter.setStateAsync("info.connection", false, true);

		const interval = Math.max(
			250,
			Math.min(5000, this.options.remoteTimeoutMs / 4),
		);
		this.timer = setInterval(() => this.checkTimeouts(), interval);
	}

	public dispose(): void {
		this.disposed = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	/** Lists all gateways that were active since the adapter started */
	public list(): GatewayInfo[] {
		return [...this.gateways.values()].map(
			({ objectId, queue, lastAdvertisementWritten, ...info }) => info,
		);
	}

	/** Reports whether a gateway is active */
	public setConnected(
		description: GatewayDescription,
		connected: boolean,
	): void {
		const gateway = this.getOrCreate(description);
		this.updateConnected(gateway, connected);
	}

	/** Reports that a gateway received advertisements. This also marks it as active. */
	public recordAdvertisements(
		description: GatewayDescription,
		count: number,
		now: number = Date.now(),
	): void {
		const gateway = this.getOrCreate(description);
		gateway.advertisements += count;
		gateway.lastAdvertisement = now;
		this.updateConnected(gateway, true);

		if (
			now - gateway.lastAdvertisementWritten >=
			this.options.lastAdvertisementIntervalMs
		) {
			gateway.lastAdvertisementWritten = now;
			this.enqueue(gateway, () =>
				this.adapter.setStateAsync(
					`${gateway.objectId}.lastAdvertisement`,
					now,
					true,
				),
			);
		}
	}

	/** Reports that an advertisement was skipped because another gateway delivered it first */
	public recordDuplicate(gatewayId: string): void {
		const gateway = this.gateways.get(gatewayId);
		if (gateway) gateway.duplicates++;
	}

	/** Marks all gateways of an instance as offline, e.g. because that instance was stopped */
	public senderOffline(sender: string): void {
		for (const gateway of this.gateways.values()) {
			if (gateway.sender === sender) {
				this.updateConnected(gateway, false);
			}
		}
	}

	private checkTimeouts(now: number = Date.now()): void {
		for (const gateway of this.gateways.values()) {
			if (
				gateway.type === "remote" &&
				gateway.connected &&
				now - (gateway.lastAdvertisement ?? 0) >
					this.options.remoteTimeoutMs
			) {
				this.adapter.log.info(
					`Gateway ${gateway.id} is offline: no advertisements for ${Math.round(
						this.options.remoteTimeoutMs / 1000,
					)} seconds`,
				);
				this.updateConnected(gateway, false);
			}
		}
	}

	private getOrCreate(description: GatewayDescription): GatewayEntry {
		let gateway = this.gateways.get(description.id);
		if (!gateway) {
			gateway = {
				...description,
				connected: false,
				advertisements: 0,
				duplicates: 0,
				objectId: `gateways.${this.toObjectId(description.id)}`,
				queue: Promise.resolve(),
				lastAdvertisementWritten: 0,
			};
			this.gateways.set(description.id, gateway);
			if (description.type === "remote") {
				this.adapter.log.info(`New gateway ${description.id}`);
			}
			this.enqueue(gateway, () => this.createObjects(gateway!));
		}
		return gateway;
	}

	private updateConnected(gateway: GatewayEntry, connected: boolean): void {
		if (gateway.connected === connected) return;
		gateway.connected = connected;
		this.enqueue(gateway, () =>
			this.adapter.setStateAsync(
				`${gateway.objectId}.connected`,
				connected,
				true,
			),
		);

		const anyConnected = [...this.gateways.values()].some(
			(g) => g.connected,
		);
		if (anyConnected !== this.anyConnected) {
			this.anyConnected = anyConnected;
			this.adapter.setState("info.connection", anyConnected, true);
		}
	}

	private toObjectId(gatewayId: string): string {
		return gatewayId
			.replace(this.adapter.FORBIDDEN_CHARS, "_")
			.replace(/[.:\s]/g, "_");
	}

	private async createObjects(gateway: GatewayEntry): Promise<void> {
		await this.adapter.setObjectNotExistsAsync(gateway.objectId, {
			type: "channel",
			common: { name: gateway.id },
			native: {
				id: gateway.id,
				type: gateway.type,
				sender: gateway.sender,
			},
		});
		await this.adapter.setObjectNotExistsAsync(
			`${gateway.objectId}.connected`,
			{
				type: "state",
				common: {
					name: "Gateway is active",
					role: "indicator.reachable",
					type: "boolean",
					read: true,
					write: false,
					def: false,
				},
				native: {},
			},
		);
		await this.adapter.setObjectNotExistsAsync(
			`${gateway.objectId}.lastAdvertisement`,
			{
				type: "state",
				common: {
					name: "Last received advertisement",
					role: "date",
					type: "number",
					read: true,
					write: false,
				},
				native: {},
			},
		);
	}

	private enqueue(gateway: GatewayEntry, task: () => Promise<unknown>): void {
		gateway.queue = gateway.queue
			.then(async () => {
				if (!this.disposed) await task();
			})
			.catch((e) => {
				this.adapter.log.warn(
					`Could not update the states of gateway ${gateway.id}: ${
						(e as Error).message
					}`,
				);
			});
	}
}
