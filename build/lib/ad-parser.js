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
var ad_parser_exports = {};
__export(ad_parser_exports, {
  parseAdvertisementData: () => parseAdvertisementData
});
module.exports = __toCommonJS(ad_parser_exports);
function parseAdvertisementData(raw) {
  const serviceUuids = [];
  const serviceData = [];
  const ret = { serviceUuids, serviceData };
  let offset = 0;
  while (offset < raw.length) {
    const length = raw[offset];
    if (length === 0)
      break;
    if (offset + 1 + length > raw.length)
      break;
    const type = raw[offset + 1];
    const data = raw.subarray(offset + 2, offset + 1 + length);
    offset += 1 + length;
    switch (type) {
      case 2:
      case 3:
        addUuids(serviceUuids, data, 2);
        break;
      case 4:
      case 5:
        addUuids(serviceUuids, data, 4);
        break;
      case 6:
      case 7:
        addUuids(serviceUuids, data, 16);
        break;
      case 8:
      case 9:
        ret.localName = data.toString("utf8");
        break;
      case 10:
        if (data.length >= 1)
          ret.txPowerLevel = data.readInt8(0);
        break;
      case 22:
        addServiceData(serviceData, data, 2);
        break;
      case 32:
        addServiceData(serviceData, data, 4);
        break;
      case 33:
        addServiceData(serviceData, data, 16);
        break;
      case 255:
        ret.manufacturerData = Buffer.from(data);
        break;
    }
  }
  return ret;
}
function uuidToString(bytes) {
  return Buffer.from(bytes).reverse().toString("hex");
}
function addUuids(target, data, uuidLength) {
  for (let i = 0; i + uuidLength <= data.length; i += uuidLength) {
    const uuid = uuidToString(data.subarray(i, i + uuidLength));
    if (!target.includes(uuid))
      target.push(uuid);
  }
}
function addServiceData(target, data, uuidLength) {
  if (data.length < uuidLength)
    return;
  target.push({
    uuid: uuidToString(data.subarray(0, uuidLength)),
    data: Buffer.from(data.subarray(uuidLength))
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseAdvertisementData
});
//# sourceMappingURL=ad-parser.js.map
