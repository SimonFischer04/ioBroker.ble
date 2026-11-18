/*!
 * Alias for Xiaomi plugin
 */

import { alias, type Plugin } from "./plugin";
import xiaomi = require("./xiaomi");
const plugin: Plugin = alias("mi-flora", xiaomi);
export = plugin;
