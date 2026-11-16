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
var message_handler_exports = {};
__export(message_handler_exports, {
  createMessageHandler: () => createMessageHandler
});
module.exports = __toCommonJS(message_handler_exports);
var import_child_process = require("child_process");
var import_gateway_protocol = require("../lib/gateway-protocol");
function createMessageHandler(ctx) {
  const { adapter } = ctx;
  return (obj) => {
    if (!obj)
      return;
    function respond(response) {
      if (obj.callback)
        adapter.sendTo(obj.from, obj.command, response, obj.callback);
    }
    switch (obj.command) {
      case "getHCIPorts":
        (0, import_child_process.exec)("hciconfig | grep hci", (error, stdout, _stderr) => {
          if (error != null) {
            respond({ error });
            return;
          }
          const ports = [];
          const regex = /^hci(\d+)\:.+Bus\:\s(\w+)$/gm;
          let result;
          while (true) {
            result = regex.exec(stdout);
            if (!(result && result.length))
              break;
            const port = { index: +result[1], bus: result[2] };
            ports.push(port);
          }
          respond({ error: null, result: ports });
        });
        return;
      case import_gateway_protocol.GatewayCommands.advertisements: {
        const sender = obj.from.replace(/^system\.adapter\./, "");
        respond(
          ctx.remoteGateway.handleAdvertisements(sender, obj.message)
        );
        return;
      }
      case import_gateway_protocol.GatewayCommands.getGateways:
        respond({ error: null, result: ctx.gateways.list() });
        return;
      case import_gateway_protocol.GatewayCommands.getDevices:
        respond({ error: null, result: ctx.devices.getDevices() });
        return;
      default:
        respond({ error: "Unknown command!" });
        return;
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createMessageHandler
});
//# sourceMappingURL=message-handler.js.map
