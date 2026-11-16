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
var remote_gateway_exports = {};
__export(remote_gateway_exports, {
  RemoteGatewayTransport: () => RemoteGatewayTransport,
  parseGatewayMessage: () => parseGatewayMessage
});
module.exports = __toCommonJS(remote_gateway_exports);
var import_ad_parser = require("../lib/ad-parser");
var import_advertisement = require("../lib/advertisement");
var import_gateway_protocol = require("../lib/gateway-protocol");
const GATEWAY_ID_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_DATA_LENGTH = 1650;
const ALIVE_REGEX = /^system\.adapter\.(.+)\.alive$/;
function invalid(message) {
  return { error: { code: "INVALID_PAYLOAD", message } };
}
function parseGatewayMessage(sender, payload) {
  if (payload == null || typeof payload !== "object") {
    return invalid("The message must be an object");
  }
  const { gatewayId, items } = payload;
  if (typeof gatewayId !== "string" || !GATEWAY_ID_REGEX.test(gatewayId)) {
    return invalid(
      `"gatewayId" must consist of 1 to 64 letters, digits, "_", "-" or "."`
    );
  }
  if (!Array.isArray(items)) {
    return invalid(`"items" must be an array`);
  }
  if (items.length > import_gateway_protocol.MAX_ADVERTISEMENTS_PER_MESSAGE) {
    return invalid(
      `"items" must not contain more than ${import_gateway_protocol.MAX_ADVERTISEMENTS_PER_MESSAGE} advertisements`
    );
  }
  const fullGatewayId = `${sender}:${gatewayId}`;
  const peripherals = [];
  let rejected = 0;
  for (const item of items) {
    const peripheral = parseItem(item, fullGatewayId);
    if (peripheral) {
      peripherals.push(peripheral);
    } else {
      rejected++;
    }
  }
  return { gatewayId: fullGatewayId, peripherals, rejected };
}
function parseItem(item, gatewayId) {
  if (item == null || typeof item !== "object")
    return;
  const { address, addressType, rssi, data, connectable } = item;
  const normalizedAddress = (0, import_advertisement.normalizeAddress)(address);
  if (!normalizedAddress)
    return;
  if (typeof rssi !== "number" || !Number.isFinite(rssi))
    return;
  if (typeof data !== "string" || data.length > Math.ceil(MAX_DATA_LENGTH / 3) * 4 || !BASE64_REGEX.test(data)) {
    return;
  }
  const id = normalizedAddress.replace(/:/g, "");
  return {
    id,
    uuid: id,
    address: normalizedAddress,
    addressType: addressType === "public" || addressType === "random" ? addressType : "unknown",
    connectable: typeof connectable === "boolean" ? connectable : void 0,
    advertisement: (0, import_ad_parser.parseAdvertisementData)(Buffer.from(data, "base64")),
    rssi,
    gatewayId
  };
}
class RemoteGatewayTransport {
  constructor(ctx) {
    this.ctx = ctx;
  }
  senders = /* @__PURE__ */ new Set();
  start() {
  }
  stop() {
  }
  handleAdvertisements(sender, payload) {
    const parsed = parseGatewayMessage(sender, payload);
    if ("error" in parsed)
      return parsed;
    this.watchSender(sender);
    this.ctx.gateways.recordAdvertisements(
      { id: parsed.gatewayId, type: "remote", sender },
      parsed.peripherals.length
    );
    for (const peripheral of parsed.peripherals) {
      this.ctx.onAdvertisement(peripheral);
    }
    return {
      error: null,
      result: {
        accepted: parsed.peripherals.length,
        rejected: parsed.rejected
      }
    };
  }
  watchSender(sender) {
    if (this.senders.has(sender))
      return;
    this.senders.add(sender);
    this.ctx.adapter.subscribeForeignStates(
      `system.adapter.${sender}.alive`
    );
  }
  handleStateChange(id, state) {
    var _a;
    const sender = (_a = ALIVE_REGEX.exec(id)) == null ? void 0 : _a[1];
    if (!sender || !this.senders.has(sender))
      return;
    if ((state == null ? void 0 : state.val) === false) {
      this.ctx.adapter.log.info(
        `${sender} was stopped, its gateways are offline`
      );
      this.ctx.gateways.senderOffline(sender);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RemoteGatewayTransport,
  parseGatewayMessage
});
//# sourceMappingURL=remote-gateway.js.map
