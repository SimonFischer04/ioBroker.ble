"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_message_handler = require("./api/message-handler");
var import_device_registry = require("./devices/device-registry");
var import_gateway_registry = require("./gateways/gateway-registry");
var import_global = require("./lib/global");
var import_object_cache = require("./lib/object-cache");
var import_plugins = __toESM(require("./plugins"));
var import_advertisement_processor = require("./scanner/advertisement-processor");
var import_service_filter = require("./scanner/service-filter");
var import_noble_local = require("./transports/noble-local");
var import_noble_remote = require("./transports/noble-remote");
var import_remote_gateway = require("./transports/remote-gateway");
let processor;
let gateways;
let remoteGateway;
let handleMessage;
const transports = [];
const adapter = utils.adapter({
  name: "ble",
  ready: async () => {
    import_global.Global.adapter = adapter;
    import_global.Global.objectCache = new import_object_cache.ObjectCache(6e4);
    await import_global.Global.ensureInstanceObjects();
    import_global.Global.adapter.log.info(
      `loaded plugins: ${import_plugins.default.map((p) => p.name).join(", ")}`
    );
    const enabledPluginNames = (adapter.config.plugins || "").split(",").map((p) => p.trim().toLowerCase()).concat("_default");
    const enabledPlugins = import_plugins.default.filter(
      (p) => enabledPluginNames.indexOf(p.name.toLowerCase()) > -1
    );
    import_global.Global.adapter.log.info(
      `enabled plugins: ${enabledPlugins.map((p) => p.name).join(", ")}`
    );
    let services = [];
    if (adapter.config.services === "*") {
      import_global.Global.adapter.log.info(`monitoring all services`);
    } else {
      services = (adapter.config.services || "").split(",").concat(...enabledPlugins.map((p) => p.advertisedServices)).reduce((acc, s) => acc.concat(s), []).map((s) => (0, import_service_filter.fixServiceName)(s)).filter((s) => s !== "").reduce((acc, s) => {
        if (acc.indexOf(s) === -1)
          acc.push(s);
        return acc;
      }, []);
      import_global.Global.adapter.log.info(`monitored services: ${services.join(", ")}`);
    }
    let rssiUpdateInterval = 0;
    if (adapter.config.rssiThrottle != null) {
      rssiUpdateInterval = Math.max(
        0,
        Math.min(1e4, adapter.config.rssiThrottle)
      );
    }
    const gatewayTimeout = typeof adapter.config.gatewayTimeout === "number" && adapter.config.gatewayTimeout > 0 ? adapter.config.gatewayTimeout : 60;
    gateways = new import_gateway_registry.GatewayRegistry(adapter, {
      remoteTimeoutMs: gatewayTimeout * 1e3
    });
    await gateways.init();
    const devices = new import_device_registry.DeviceRegistry();
    processor = new import_advertisement_processor.AdvertisementProcessor(
      {
        plugins: enabledPlugins,
        allowEmptyDevices: !!adapter.config.allowEmptyDevices,
        rssiUpdateInterval
      },
      devices,
      gateways
    );
    const handleAdvertisement = (peripheral) => {
      processor.process(peripheral).catch((e) => {
        adapter.log.error(
          `Could not handle the advertisement of ${peripheral.address}: ${e.message}`
        );
      });
    };
    const transportContext = {
      adapter,
      gateways,
      onAdvertisement: handleAdvertisement
    };
    adapter.subscribeStates("*");
    adapter.subscribeObjects("*");
    await adapter.setStateAsync("options.allowNewDevices", false, true);
    remoteGateway = new import_remote_gateway.RemoteGatewayTransport({
      ...transportContext,
      onAdvertisement: (peripheral) => {
        if ((0, import_service_filter.matchesServiceFilter)(peripheral, services)) {
          handleAdvertisement(peripheral);
        }
      }
    });
    transports.push(remoteGateway);
    handleMessage = (0, import_message_handler.createMessageHandler)({
      adapter,
      gateways,
      devices,
      remoteGateway
    });
    if (adapter.config.server) {
      transports.push(
        new import_noble_remote.NobleRemoteTransport(
          transportContext,
          adapter.config.server
        )
      );
    } else if (adapter.config.localScanner !== false) {
      transports.push(
        new import_noble_local.NobleLocalTransport(transportContext, {
          services,
          hciDevice: adapter.config.hciDevice
        })
      );
    } else {
      adapter.log.info(
        "The local Bluetooth adapter is not used, waiting for advertisements from external gateways"
      );
    }
    for (const transport of transports)
      transport.start();
  },
  unload: (callback) => {
    try {
      for (const transport of transports)
        transport.stop();
      processor == null ? void 0 : processor.dispose();
      gateways == null ? void 0 : gateways.dispose();
    } catch {
    }
    callback();
  },
  objectChange: (id, obj) => {
    if (!!obj) {
      import_global.Global.objectCache.updateObject(obj);
    } else {
      import_global.Global.objectCache.invalidateObject(id);
    }
  },
  stateChange: (id, state) => {
    if (/options\.allowNewDevices$/.test(id) && id.startsWith(adapter.namespace) && state != void 0 && !state.ack) {
      if (typeof state.val === "boolean") {
        import_global.Global.adapter.setState(id, state.val, true);
        processor == null ? void 0 : processor.setAllowNewDevices(state.val);
      }
      return;
    }
    remoteGateway == null ? void 0 : remoteGateway.handleStateChange(id, state);
  },
  message: (obj) => {
    if (handleMessage) {
      handleMessage(obj);
    } else if (obj == null ? void 0 : obj.callback) {
      adapter.sendTo(
        obj.from,
        obj.command,
        { error: "The adapter is not ready yet" },
        obj.callback
      );
    }
  }
});
//# sourceMappingURL=main.js.map
