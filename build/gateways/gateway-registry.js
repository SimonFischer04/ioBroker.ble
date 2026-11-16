"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var gateway_registry_exports = {};
__export(gateway_registry_exports, {
  GatewayRegistry: () => GatewayRegistry
});
module.exports = __toCommonJS(gateway_registry_exports);
const defaultOptions = {
  remoteTimeoutMs: 6e4,
  lastAdvertisementIntervalMs: 1e4
};
class GatewayRegistry {
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.options = { ...defaultOptions, ...options };
  }
  options;
  gateways = /* @__PURE__ */ new Map();
  timer;
  anyConnected = false;
  disposed = false;
  async init() {
    const states = await this.adapter.getStatesAsync(
      `${this.adapter.namespace}.gateways.*`
    );
    for (const [id, state] of Object.entries(states != null ? states : {})) {
      if (id.endsWith(".connected") && (state == null ? void 0 : state.val) === true) {
        await this.adapter.setStateAsync(id, false, true);
      }
    }
    await this.adapter.setStateAsync("info.connection", false, true);
    const interval = Math.max(
      250,
      Math.min(5e3, this.options.remoteTimeoutMs / 4)
    );
    this.timer = setInterval(() => this.checkTimeouts(), interval);
  }
  dispose() {
    this.disposed = true;
    if (this.timer)
      clearInterval(this.timer);
    this.timer = void 0;
  }
  list() {
    return [...this.gateways.values()].map(
      ({ objectId, queue, lastAdvertisementWritten, ...info }) => info
    );
  }
  setConnected(description, connected) {
    const gateway = this.getOrCreate(description);
    this.updateConnected(gateway, connected);
  }
  recordAdvertisements(description, count, now = Date.now()) {
    const gateway = this.getOrCreate(description);
    gateway.advertisements += count;
    gateway.lastAdvertisement = now;
    this.updateConnected(gateway, true);
    if (now - gateway.lastAdvertisementWritten >= this.options.lastAdvertisementIntervalMs) {
      gateway.lastAdvertisementWritten = now;
      this.enqueue(
        gateway,
        () => this.adapter.setStateAsync(
          `${gateway.objectId}.lastAdvertisement`,
          now,
          true
        )
      );
    }
  }
  recordDuplicate(gatewayId) {
    const gateway = this.gateways.get(gatewayId);
    if (gateway)
      gateway.duplicates++;
  }
  senderOffline(sender) {
    for (const gateway of this.gateways.values()) {
      if (gateway.sender === sender) {
        this.updateConnected(gateway, false);
      }
    }
  }
  checkTimeouts(now = Date.now()) {
    var _a;
    for (const gateway of this.gateways.values()) {
      if (gateway.type === "remote" && gateway.connected && now - ((_a = gateway.lastAdvertisement) != null ? _a : 0) > this.options.remoteTimeoutMs) {
        this.adapter.log.info(
          `Gateway ${gateway.id} is offline: no advertisements for ${Math.round(
            this.options.remoteTimeoutMs / 1e3
          )} seconds`
        );
        this.updateConnected(gateway, false);
      }
    }
  }
  getOrCreate(description) {
    let gateway = this.gateways.get(description.id);
    if (!gateway) {
      gateway = {
        ...description,
        connected: false,
        advertisements: 0,
        duplicates: 0,
        objectId: `gateways.${this.toObjectId(description.id)}`,
        queue: Promise.resolve(),
        lastAdvertisementWritten: 0
      };
      this.gateways.set(description.id, gateway);
      if (description.type === "remote") {
        this.adapter.log.info(`New gateway ${description.id}`);
      }
      this.enqueue(gateway, () => this.createObjects(gateway));
    }
    return gateway;
  }
  updateConnected(gateway, connected) {
    if (gateway.connected === connected)
      return;
    gateway.connected = connected;
    this.enqueue(
      gateway,
      () => this.adapter.setStateAsync(
        `${gateway.objectId}.connected`,
        connected,
        true
      )
    );
    const anyConnected = [...this.gateways.values()].some(
      (g) => g.connected
    );
    if (anyConnected !== this.anyConnected) {
      this.anyConnected = anyConnected;
      this.adapter.setState("info.connection", anyConnected, true);
    }
  }
  toObjectId(gatewayId) {
    return gatewayId.replace(this.adapter.FORBIDDEN_CHARS, "_").replace(/[.:\s]/g, "_");
  }
  async createObjects(gateway) {
    await this.adapter.setObjectNotExistsAsync(gateway.objectId, {
      type: "channel",
      common: { name: gateway.id },
      native: {
        id: gateway.id,
        type: gateway.type,
        sender: gateway.sender
      }
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
          def: false
        },
        native: {}
      }
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
          write: false
        },
        native: {}
      }
    );
  }
  enqueue(gateway, task) {
    gateway.queue = gateway.queue.then(async () => {
      if (!this.disposed)
        await task();
    }).catch((e) => {
      this.adapter.log.warn(
        `Could not update the states of gateway ${gateway.id}: ${e.message}`
      );
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GatewayRegistry
});
//# sourceMappingURL=gateway-registry.js.map
