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
var scan_filter_exports = {};
__export(scan_filter_exports, {
  matchesScanFilter: () => matchesScanFilter
});
module.exports = __toCommonJS(scan_filter_exports);
function matchesScanFilter(peripheral, services, manufacturerIds) {
  var _a, _b;
  if (services.length === 0)
    return true;
  const advertisement = peripheral.advertisement;
  if (!advertisement)
    return false;
  if (((_a = advertisement.serviceUuids) == null ? void 0 : _a.some((uuid) => services.includes(uuid))) || ((_b = advertisement.serviceData) == null ? void 0 : _b.some(({ uuid }) => services.includes(uuid)))) {
    return true;
  }
  const data = advertisement.manufacturerData;
  return data != null && data.length >= 2 && manufacturerIds.includes(data.readUInt16LE(0));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  matchesScanFilter
});
//# sourceMappingURL=scan-filter.js.map
