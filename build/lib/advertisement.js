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
var advertisement_exports = {};
__export(advertisement_exports, {
  normalizeAddress: () => normalizeAddress
});
module.exports = __toCommonJS(advertisement_exports);
const MAC_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
function normalizeAddress(address) {
  if (typeof address !== "string")
    return void 0;
  let ret = address.trim().toLowerCase().replace(/-/g, ":");
  if (/^[0-9a-f]{12}$/.test(ret)) {
    ret = ret.match(/.{2}/g).join(":");
  }
  return MAC_REGEX.test(ret) ? ret : void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  normalizeAddress
});
//# sourceMappingURL=advertisement.js.map
