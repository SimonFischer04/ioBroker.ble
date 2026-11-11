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
var noble_remote_exports = {};
__export(noble_remote_exports, {
  NobleRemoteTransport: () => NobleRemoteTransport
});
module.exports = __toCommonJS(noble_remote_exports);
var import_net = require("net");
var import_scanProcessInterface = require("../lib/scanProcessInterface");
const RECONNECT_INTERVAL_MS = 1e4;
class NobleRemoteTransport {
  constructor(ctx, server) {
    this.ctx = ctx;
    this.server = server;
  }
  static gateway = {
    id: "server",
    type: "server"
  };
  socket;
  stopped = false;
  reconnectTimer;
  start() {
    this.stopped = false;
    this.connect();
  }
  connect() {
    const { adapter, gateways } = this.ctx;
    this.socket = new import_net.Socket();
    const reviver = (0, import_scanProcessInterface.getMessageReviver)(
      (message) => this.handleMessage(message)
    );
    let receiveBuffer = "";
    this.socket.on("close", () => {
      adapter.log.info("Disconnected from BLE server");
      gateways.setConnected(NobleRemoteTransport.gateway, false);
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          RECONNECT_INTERVAL_MS
        );
      }
    }).on("error", (e) => {
      adapter.log.error(`BLE server connection failed: ${e.message}`);
    }).on("connect", () => {
      adapter.log.info("Connected to BLE server");
      gateways.setConnected(NobleRemoteTransport.gateway, true);
    }).on("data", (data) => {
      receiveBuffer += data.toString();
      let newlineIndex;
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
      port: +port
    });
  }
  stop() {
    var _a;
    this.stopped = true;
    if (this.reconnectTimer)
      clearTimeout(this.reconnectTimer);
    try {
      (_a = this.socket) == null ? void 0 : _a.destroy();
    } catch {
    }
  }
  handleMessage(message) {
    var _a;
    const { adapter, gateways } = this.ctx;
    switch (message.type) {
      case "connected":
        gateways.setConnected(NobleRemoteTransport.gateway, true);
        break;
      case "disconnected":
        gateways.setConnected(NobleRemoteTransport.gateway, false);
        break;
      case "discover":
        if (message.peripheral == null)
          break;
        gateways.recordAdvertisements(NobleRemoteTransport.gateway, 1);
        this.ctx.onAdvertisement({
          ...message.peripheral,
          gatewayId: NobleRemoteTransport.gateway.id
        });
        break;
      case "driverState":
        adapter.setState("info.driverState", message.driverState, true);
        break;
      case "error":
      case "fatal":
        adapter.log.error(message.error.message);
        break;
      case "log":
        adapter.log[(_a = message.level) != null ? _a : "info"](message.message);
        break;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NobleRemoteTransport
});
//# sourceMappingURL=noble-remote.js.map
