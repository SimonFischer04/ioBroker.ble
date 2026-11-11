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
var service_filter_exports = {};
__export(service_filter_exports, {
  fixServiceName: () => fixServiceName,
  matchesServiceFilter: () => matchesServiceFilter
});
module.exports = __toCommonJS(service_filter_exports);
function fixServiceName(name) {
  if (name == null)
    return "";
  name = name.trim();
  for (const char of ["\r", "\n", "	", " "]) {
    name = name.replace(char, "");
  }
  name = name.replace(/^0x/, "");
  return name.toLowerCase();
}
function matchesServiceFilter(peripheral, services) {
  var _a;
  if (services.length === 0)
    return true;
  const { serviceUuids, serviceData } = (_a = peripheral.advertisement) != null ? _a : {};
  return !!(serviceUuids == null ? void 0 : serviceUuids.some((uuid) => services.includes(uuid))) || !!(serviceData == null ? void 0 : serviceData.some((entry) => services.includes(entry.uuid)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fixServiceName,
  matchesServiceFilter
});
//# sourceMappingURL=service-filter.js.map
