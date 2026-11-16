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
var scan_errors_exports = {};
__export(scan_errors_exports, {
  classifyScanError: () => classifyScanError
});
module.exports = __toCommonJS(scan_errors_exports);
function classifyScanError(err) {
  var _a;
  const message = (_a = err == null ? void 0 : err.message) != null ? _a : "";
  if (/compatible USB Bluetooth/.test(message) || /LIBUSB_ERROR_NOT_SUPPORTED/.test(message)) {
    return "no-hardware";
  } else if (/NODE_MODULE_VERSION/.test(message)) {
    return "rebuild-required";
  } else if (message.includes(`The value of "offset" is out of range`)) {
    return "ignorable";
  } else if (message.includes("EAFNOSUPPORT")) {
    return "address-family-not-supported";
  } else if (/Cannot find module/.test(message)) {
    return "driver-missing";
  }
  return "unknown";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  classifyScanError
});
//# sourceMappingURL=scan-errors.js.map
