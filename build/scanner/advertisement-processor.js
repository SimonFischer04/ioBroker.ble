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
var advertisement_processor_exports = {};
__export(advertisement_processor_exports, {
  AdvertisementProcessor: () => AdvertisementProcessor
});
module.exports = __toCommonJS(advertisement_processor_exports);
var import_objects = require("alcalzone-shared/objects");
var import_global = require("../lib/global");
var import_iobroker_objects = require("../lib/iobroker-objects");
const ALLOW_NEW_DEVICES_TIMEOUT = 5 * 6e4;
class AdvertisementProcessor {
  constructor(options, devices, gateways) {
    this.options = options;
    this.devices = devices;
    this.gateways = gateways;
  }
  allowNewDevices = false;
  resetAllowNewDevicesTimeout;
  ignoredNewDeviceIDs = /* @__PURE__ */ new Set();
  dispose() {
    if (this.resetAllowNewDevicesTimeout) {
      clearTimeout(this.resetAllowNewDevicesTimeout);
    }
  }
  setAllowNewDevices(allow) {
    if (allow === this.allowNewDevices)
      return;
    this.allowNewDevices = allow;
    import_global.Global.adapter.log.info(
      allow ? "Now accepting new devices" : "No longer accepting new devices"
    );
    if (allow) {
      this.ignoredNewDeviceIDs.clear();
      this.autoResetAllowNewDevices();
    }
  }
  autoResetAllowNewDevices() {
    if (this.resetAllowNewDevicesTimeout) {
      clearTimeout(this.resetAllowNewDevicesTimeout);
    }
    this.resetAllowNewDevicesTimeout = setTimeout(() => {
      this.allowNewDevices = false;
      import_global.Global.adapter.setState("options.allowNewDevices", false, true);
      this.resetAllowNewDevicesTimeout = void 0;
      import_global.Global.adapter.log.info(
        "No longer accepting new devices (automatic timeout)"
      );
    }, ALLOW_NEW_DEVICES_TIMEOUT);
  }
  async process(peripheral) {
    if (peripheral == null)
      return;
    let serviceDataIsNotEmpty = false;
    let manufacturerDataIsNotEmpty = false;
    import_global.Global.adapter.log.debug(
      `discovered peripheral ${peripheral.address}${peripheral.gatewayId ? ` via ${peripheral.gatewayId}` : ""}`
    );
    import_global.Global.adapter.log.debug(
      `  has advertisement: ${peripheral.advertisement != null}`
    );
    if (peripheral.advertisement != null) {
      import_global.Global.adapter.log.debug(
        `  has serviceData: ${peripheral.advertisement.serviceData != null}`
      );
      if (peripheral.advertisement.serviceData != null) {
        import_global.Global.adapter.log.debug(
          `  serviceData = ${JSON.stringify(
            peripheral.advertisement.serviceData
          )}`
        );
        serviceDataIsNotEmpty = peripheral.advertisement.serviceData.length > 0;
      }
      import_global.Global.adapter.log.debug(
        `  has manufacturerData: ${peripheral.advertisement.manufacturerData != null}`
      );
      if (peripheral.advertisement.manufacturerData != null) {
        import_global.Global.adapter.log.debug(
          `  manufacturerData = ${peripheral.advertisement.manufacturerData.toString(
            "hex"
          )}`
        );
        manufacturerDataIsNotEmpty = peripheral.advertisement.manufacturerData.length > 0;
      }
    } else {
      return;
    }
    const observation = this.devices.observe(peripheral);
    if (observation.duplicate) {
      import_global.Global.adapter.log.debug(
        `  skipped, another gateway already delivered this packet`
      );
      if (peripheral.gatewayId) {
        this.gateways.recordDuplicate(peripheral.gatewayId);
      }
      return;
    }
    if (!this.options.allowEmptyDevices && !serviceDataIsNotEmpty && !manufacturerDataIsNotEmpty) {
      return;
    }
    const deviceId = peripheral.address;
    let plugin;
    for (const p of this.options.plugins) {
      if (p.isHandling(peripheral)) {
        import_global.Global.adapter.log.debug(`plugin ${p.name} is handling ${deviceId}`);
        plugin = p;
        break;
      }
    }
    if (!plugin) {
      import_global.Global.adapter.log.warn(
        `no handling plugin found for peripheral ${peripheral.id}`
      );
      return;
    }
    if (!this.allowNewDevices) {
      if (this.ignoredNewDeviceIDs.has(deviceId))
        return;
      if (!await import_global.Global.objectCache.objectExists(
        `${import_global.Global.adapter.namespace}.${deviceId}.rssi`
      )) {
        this.ignoredNewDeviceIDs.add(deviceId);
        return;
      }
    }
    await (0, import_iobroker_objects.extendState)(`${deviceId}.rssi`, {
      id: "rssi",
      common: {
        role: "value.rssi",
        name: "signal strength (RSSI)",
        desc: "Signal strength of the device",
        type: "number",
        read: true,
        write: false
      },
      native: {}
    });
    const rssiState = await import_global.Global.adapter.getStateAsync(`${deviceId}.rssi`);
    if (rssiState == null || rssiState.ts + this.options.rssiUpdateInterval < Date.now()) {
      import_global.Global.adapter.log.debug(`updating rssi state for ${deviceId}`);
      await import_global.Global.adapter.setStateAsync(
        `${deviceId}.rssi`,
        observation.bestRssi,
        true
      );
    }
    const context = plugin.createContext(peripheral);
    const objects = plugin.defineObjects(context);
    const values = plugin.getValues(context);
    if (objects == null)
      return;
    await (0, import_iobroker_objects.extendDevice)(deviceId, peripheral, objects.device);
    if (objects.channels != null && objects.channels.length > 0) {
      await Promise.all(
        objects.channels.map(
          (c) => (0, import_iobroker_objects.extendChannel)(deviceId + "." + c.id, c)
        )
      );
    }
    await Promise.all(
      objects.states.map((s) => (0, import_iobroker_objects.extendState)(deviceId + "." + s.id, s))
    );
    if (values != null) {
      import_global.Global.adapter.log.debug(
        `${deviceId} > got values: ${JSON.stringify(values)}`
      );
      for (let [stateId, value] of (0, import_objects.entries)(values)) {
        stateId = stateId.replace(/[\(\)]+/g, "").replace(" ", "_");
        const iobStateId = `${import_global.Global.adapter.namespace}.${deviceId}.${stateId}`;
        if (await import_global.Global.objectCache.getObject(iobStateId) != null) {
          import_global.Global.adapter.log.debug(`setting state ${iobStateId}`);
          await import_global.Global.adapter.setStateChangedAsync(
            iobStateId,
            value != null ? value : null,
            true
          );
        } else {
          import_global.Global.adapter.log.warn(
            `skipping state ${iobStateId} because the object does not exist`
          );
        }
      }
    } else {
      import_global.Global.adapter.log.debug(`${deviceId} > got no values`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AdvertisementProcessor
});
//# sourceMappingURL=advertisement-processor.js.map
