"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var noble_local_exports = {};
__export(noble_local_exports, {
  NobleLocalTransport: () => NobleLocalTransport
});
module.exports = __toCommonJS(noble_local_exports);
var import_child_process = require("child_process");
var path = __toESM(require("path"));
var import_scanProcessInterface = require("../lib/scanProcessInterface");
var import_scan_errors = require("./scan-errors");
const HUB_HINT = "The adapter keeps running and accepts advertisements from external gateways.";
class NobleLocalTransport {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options;
  }
  static gateway = {
    id: "local",
    type: "local"
  };
  scanProcess;
  stopped = false;
  start() {
    if (this.stopped)
      return;
    const { adapter } = this.ctx;
    const args = ["-s", ...this.options.services];
    if (this.options.hciDevice) {
      args.push("-d", this.options.hciDevice.toString());
    }
    adapter.log.info("starting scanner process...");
    this.scanProcess = (0, import_child_process.fork)(
      path.join(__dirname, "..", "scanProcess"),
      args,
      {
        stdio: ["pipe", "pipe", "pipe", "ipc"]
      }
    ).on("exit", (code, signal) => {
      this.ctx.gateways.setConnected(NobleLocalTransport.gateway, false);
      if (!this.stopped && !signal && code !== 0 && code !== import_scanProcessInterface.ScanExitCodes.RequireNobleFailed) {
        adapter.log.warn("scanner process crashed, restarting...");
        setImmediate(() => this.start());
      } else {
        this.scanProcess = void 0;
      }
    });
    this.scanProcess.on(
      "message",
      (0, import_scanProcessInterface.getMessageReviver)(
        (message) => this.handleMessage(message)
      )
    );
  }
  stop() {
    var _a;
    this.stopped = true;
    try {
      (_a = this.scanProcess) == null ? void 0 : _a.kill();
    } catch {
    }
  }
  handleMessage(message) {
    var _a;
    const { adapter, gateways } = this.ctx;
    switch (message.type) {
      case "connected":
        gateways.setConnected(NobleLocalTransport.gateway, true);
        break;
      case "disconnected":
        gateways.setConnected(NobleLocalTransport.gateway, false);
        break;
      case "discover":
        if (message.peripheral == null)
          break;
        gateways.recordAdvertisements(NobleLocalTransport.gateway, 1);
        this.ctx.onAdvertisement({
          ...message.peripheral,
          gatewayId: NobleLocalTransport.gateway.id
        });
        break;
      case "driverState":
        adapter.setState("info.driverState", message.driverState, true);
        break;
      case "error":
      case "fatal":
        this.handleError(message.error);
        break;
      case "log":
        adapter.log[(_a = message.level) != null ? _a : "info"](message.message);
        break;
    }
  }
  handleError(err) {
    var _a, _b;
    const { adapter } = this.ctx;
    switch ((0, import_scan_errors.classifyScanError)(err)) {
      case "no-hardware":
        adapter.log.error(
          `No compatible BLE 4.0 hardware found! The local Bluetooth adapter is not used. ${HUB_HINT}`
        );
        this.stop();
        break;
      case "address-family-not-supported":
        adapter.log.error(
          `Unsupported Address Family (EAFNOSUPPORT). If ioBroker is running in a Docker container, make sure that the container uses host mode networking. The local Bluetooth adapter is not used. ${HUB_HINT}`
        );
        this.stop();
        break;
      case "driver-missing":
        adapter.log.error(
          `The Bluetooth driver (noble) is not installed: ${err.message}. The local Bluetooth adapter is not used. ${HUB_HINT}`
        );
        break;
      case "rebuild-required":
        if ((_a = adapter.supportsFeature) == null ? void 0 : _a.call(adapter, "CONTROLLER_NPM_AUTO_REBUILD")) {
          adapter.log.error(
            "Terminating because a dependency requires a rebuild."
          );
          this.stop();
          (_b = adapter.terminate) == null ? void 0 : _b.call(adapter, "A dependency requires a rebuild.", 13);
          process.exit(13);
        }
        adapter.log.error(err.message);
        break;
      default:
        adapter.log.error(err.message);
        break;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NobleLocalTransport
});
//# sourceMappingURL=noble-local.js.map
