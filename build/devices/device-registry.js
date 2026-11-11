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
var device_registry_exports = {};
__export(device_registry_exports, {
  DeviceRegistry: () => DeviceRegistry
});
module.exports = __toCommonJS(device_registry_exports);
const defaultOptions = {
  dedupeWindowMs: 1e3,
  rssiMaxAgeMs: 3e4,
  deviceMaxAgeMs: 10 * 6e4
};
const UNKNOWN_GATEWAY = "unknown";
class DeviceRegistry {
  constructor(options = {}) {
    this.options = { ...defaultOptions, ...options };
  }
  options;
  devices = /* @__PURE__ */ new Map();
  lastPrune = 0;
  observe(peripheral, now = Date.now()) {
    var _a;
    const gatewayId = (_a = peripheral.gatewayId) != null ? _a : UNKNOWN_GATEWAY;
    let device = this.devices.get(peripheral.address);
    if (!device) {
      device = {
        address: peripheral.address,
        gateways: /* @__PURE__ */ new Map(),
        lastSeen: now,
        processedAt: 0
      };
      this.devices.set(peripheral.address, device);
    }
    device.lastSeen = now;
    if (peripheral.advertisement.localName) {
      device.name = peripheral.advertisement.localName;
    }
    device.gateways.set(gatewayId, {
      rssi: peripheral.rssi,
      lastSeen: now
    });
    const fingerprint = getFingerprint(peripheral);
    const duplicate = device.processedFingerprint === fingerprint && device.processedGateway !== gatewayId && now - device.processedAt < this.options.dedupeWindowMs;
    if (!duplicate) {
      device.processedFingerprint = fingerprint;
      device.processedGateway = gatewayId;
      device.processedAt = now;
    }
    let bestRssi = peripheral.rssi;
    let bestGateway = gatewayId;
    for (const [id, reception] of device.gateways) {
      if (now - reception.lastSeen <= this.options.rssiMaxAgeMs && reception.rssi > bestRssi) {
        bestRssi = reception.rssi;
        bestGateway = id;
      }
    }
    if (now - this.lastPrune > 6e4)
      this.prune(now);
    return { duplicate, bestRssi, bestGateway };
  }
  getDevices(now = Date.now()) {
    this.prune(now);
    return [...this.devices.values()].map((device) => ({
      address: device.address,
      name: device.name,
      gateways: [...device.gateways].map(([id, { rssi, lastSeen }]) => ({ id, rssi, lastSeen })).sort((a, b) => b.rssi - a.rssi)
    }));
  }
  prune(now = Date.now()) {
    this.lastPrune = now;
    for (const [address, device] of this.devices) {
      if (now - device.lastSeen > this.options.deviceMaxAgeMs) {
        this.devices.delete(address);
        continue;
      }
      for (const [id, reception] of device.gateways) {
        if (now - reception.lastSeen > this.options.deviceMaxAgeMs) {
          device.gateways.delete(id);
        }
      }
    }
  }
}
function getFingerprint(peripheral) {
  var _a;
  const { serviceData, manufacturerData } = peripheral.advertisement;
  const parts = [];
  for (const entry of serviceData != null ? serviceData : []) {
    parts.push(`${entry.uuid}=${entry.data.toString("hex")}`);
  }
  parts.push(`m=${(_a = manufacturerData == null ? void 0 : manufacturerData.toString("hex")) != null ? _a : ""}`);
  return parts.join("|");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeviceRegistry
});
//# sourceMappingURL=device-registry.js.map
