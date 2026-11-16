<img src="admin/ble.png" height="48" /> ioBroker.ble
=================

![Build Status](https://action-badges.now.sh/AlCalzone/ioBroker.tradfri)

Monitor Bluetooth Low Energy (BLE) beacons and record their information. 
Currently, only recording *advertised* service data is supported. You can monitor which services are advertised by using the nRF Connect app (service data UUIDs).
Connecting and reading/writing service chararcteristics will be supported in a future version.

## Installation
![Number of Installations](http://iobroker.live/badges/ble-installed.svg?break_cache=1) ![Number of Installations](http://iobroker.live/badges/ble-stable.svg?break_cache=1)

This adapter needs additional libraries to compile. See https://github.com/sandeepmistry/noble#prerequisites for detailed instructions.
On Raspberry Pi and similar, this should do it: `sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev libcap2-bin`

If the adapter starts but won't connect to your bluetooth hardware, please check the `info.driverState` state in ioBroker. If it is `unauthorized`, you need to give `node` additional permissions. For Linux, this is as simple as
```bash
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```
which requires `libcap2-bin` to be installed.

## Configuration
If you have multiple bluetooth devices on your system, select the one to use from the dropdown.
In the textbox below, enter all UUIDs of the advertised services you want to record (as found in the nRF Connect app).

### Running without Bluetooth hardware
The Bluetooth adapter of the host is optional. Disable **Use the Bluetooth adapter of this host** in the settings to run the adapter as a hub that only handles the advertisements other adapters deliver (see below). In this mode the Bluetooth driver is not loaded, so neither Bluetooth hardware, nor the `setcap` command above, nor host mode networking in Docker are needed.

If the option is enabled but the Bluetooth adapter cannot be used (no hardware, missing permissions, driver not installed), the adapter logs an error and keeps running, so it can still receive advertisements from other adapters.

## Receiving advertisements from other adapters
Other adapters can deliver the BLE advertisements they receive, e.g. from ESPHome Bluetooth proxies distributed in the house. They are handled exactly like the ones received by the local Bluetooth adapter: the same plugins, the same objects and states. The device ID is the MAC address in lowercase, no matter which receiver delivered the advertisement.

```js
const response = await adapter.sendToAsync("ble.0", "gateway:advertisements", {
	// Identifies the receiver within the sending instance
	gatewayId: "proxy-og",
	items: [
		{
			address: "a4:c1:38:12:34:56",
			rssi: -67,
			// The raw payload of the advertisement (the AD structures), base64 encoded
			data: "AgEGDhbS/EAApQFkAsQJA78T",
			// optional: addressType ("public" | "random"), connectable
		},
	],
});
// => { error: null, result: { accepted: 1, rejected: 0 } }
// or { error: { code: "INVALID_PAYLOAD", message: "..." } }
```

* There is no registration. A gateway is created with the first message, its ID is `<sender>:<gatewayId>`, e.g. `esphome.0:proxy-og`.
* Deliver the advertisements in batches (at most 500 per message), a few times per second at most.
* A gateway is offline when it delivered nothing for 60 seconds, or when the delivering instance is stopped. An empty batch is enough to keep it online.
* When several gateways receive the same packet, it is decoded once. The `rssi` state of a device is the signal strength measured by the gateway that receives it best.
* The monitored services from the settings also apply to delivered advertisements, and new devices are only recorded while **Accept new devices** is enabled.

The types of the interface are defined in [`src/lib/gateway-protocol.ts`](src/lib/gateway-protocol.ts). The file has no dependencies and can be copied.

| Command | Result |
|---|---|
| `gateway:advertisements` | Delivers advertisements, see above |
| `getGateways` | All sources of advertisements: `[{ id, type, sender, connected, lastAdvertisement, advertisements, duplicates }]` |
| `getDevices` | The devices received in the last 10 minutes: `[{ address, name, gateways: [{ id, rssi, lastSeen }] }]`, strongest gateway first |

For every gateway the states `gateways.<id>.connected` and `gateways.<id>.lastAdvertisement` are created. `info.connection` is `true` while at least one source of advertisements is active.

## Plugin system
The adapter supports extension via plugins. Those define which advertised services should be listened to and how to translate the data. The plugin structure is defined in https://github.com/AlCalzone/ioBroker.ble/blob/master/src/plugins/plugin.ts and an example of a working plugin is defined here https://github.com/AlCalzone/ioBroker.ble/blob/master/src/plugins/_default.ts

If you have any device transmitting specially encoded information via advertisements, feel free to create a PR with a new plugin for that.

### Supported plugins
* `"xiaomi"`: All xiaomi bluetooth sensors, including 
  * [Flower Care plant sensor](https://xiaomi-mi.com/sockets-and-sensors/xiaomi-huahuacaocao-flower-care-smart-monitor/)
  * [Mijia Temperature and Humidity sensor](https://www.banggood.com/Xiaomi-Mijia-Bluetooth-Thermometer-Hygrometer-with-LCD-Screen-Magnetic-Suction-Wall-Stickers-p-1232396.html?cur_warehouse=USA)
  * [Mosquito Repellent](https://www.aliexpress.com/item/32883859984.html)
* `"mi-flora"`: Original plugin for the flower care plant sensor, now aliased to `"xiaomi"`
* `"ruuvi-tag"`: [Ruuvi Tag](https://tag.ruuvi.com/) multisensor with firmware versions v1 and v2. **Untested, please give feedback!** 
* `"bthome"`: Sensors using the [BTHome](https://bthome.io) protocol. For now this is limited to the `v2` revision of the protocol and does not support encrypted packets.

## Changelog
<!--
	Placeholder for next release:
	### __WORK IN PROGRESS__
-->
### __WORK IN PROGRESS__
* Other adapters can deliver BLE advertisements they received, e.g. from ESPHome Bluetooth proxies (`gateway:advertisements`). Several receivers can be used at the same time.
* The adapter can run without Bluetooth hardware: the Bluetooth adapter of the host can be disabled in the settings, and the Bluetooth driver is an optional dependency now
* A problem with the Bluetooth adapter of the host no longer terminates the adapter
* The connection to a remote scan server is re-established when it was lost

### 0.14.1 (2025-02-09)
* Fixed compatibility issues with newer OS and Node.js versions (#874)

### 0.14.0 (2023-12-11)
* **BREAKING:** Dropped support for Node.js 16 and below
* Add support for the BTHome v2 protocol (unencrypted packets only)

### 0.13.4 (2023-07-06)
* Very experimental support for scanning on a remote host (#793)
* Another attempt at updating `noble`. Hopefully this version works now...

### 0.13.3 (2023-02-05)
* Updated `noble` again. This should fix the automatic rebuild after Node.js upgrades and the previous performance issues.

### 0.13.2 (2023-01-02)
* Downgraded the `noble` dependency again because of performance issues

### 0.13.1 (2022-12-19)
* Updated the `noble` dependency. This should fix the automatic rebuild after Node.js upgrades.

### 0.13.0 (2022-04-27)
* The option to allow recording new devices is now available in the config dialog. When the adapter starts, it will be disabled, and when enabled, it will be automatically disabled after 5 minutes (#730, #729)
* Fix: RSSI will now be updated, even if it was unchanged (#493)
* Dependency updates, lots of dependency updates...

### 0.12.0 (2020-10-29)
* Scanning is now done in a separate process, so uncatchable errors in `noble` no longer bring down the main process

### 0.11.8 (2020-08-25)
* The pressure value reported by Ruuvi Tags is now parsed with two decimal places

### 0.11.7 (2020-08-20)
* Added a more helpful error message if the adapter terminates with error `EAFNOSUPPORT`

### 0.11.6 (2020-05-07)
* Ignore unhandled out of range error somewhere in `noble`

### 0.11.4 (2020-04-23)
* Utilize JS-Controller's auto module rebuild if possible

### 0.11.3 (2020-04-22)
* Fixed a crash that happens when `noble` can not be loaded.

### 0.11.2 (2020-04-19)
* Avoid setting `undefined` as a state value to be compatible with JS-Controller 3.0

### 0.11.1 (2020-04-11)
* Fixed typo in Ruuvi Tag plugin: `motionCounter` -> `movementCounter`

### 0.11.0 (2020-03-25)
* Removed compact support. `noble` sometimes throws errors in callbacks that cannot be handled and would bring the whole compact group down.
* Added support for the Xiaomi Kettle
* Encrypted packets are no longer decoded (for now) to avoid creating thousands of `unknown (0xabcd)` states

### 0.10.1 (2019-10-13)
* Fixed crash in JS-Controller 2.0

### 0.10.0 (2019-09-26)
* `xiaomi` plugin: test the received data instead of relying on MAC prefixes

### 0.9.2 (2019-09-26)
* Add `e7:2e:00` as an alternative mac prefix for MiTemperature

### 0.9.1 (2019-09-22)
* Fix compact mode crashes

### 0.9.0 (2019-09-04)
* Devices without service data but with manufacturer data are no longer treated as empty
* `_default` plugin: Create states for manufacturer data
* `ruuvi-tag` plugin: Set `"Ruuvi Tag"` as the default name for the device object

### 0.8.4 (2019-09-03)
* `ruuvi-tag` plugin: Fix parsing of data format 3 and 5

### 0.8.3 (2019-08-26)
* Add `80:ea:ca` as an alternative mac prefix for FlowerCare

### 0.8.2 (2019-08-14)
* Add `3f:5b:7d` as an alternative mac prefix for the Xiaomi watch

### 0.8.1 (2019-07-26)
* Added support for the Xiaomi Mosquito Repellent (read-only!)

### 0.7.4 (2019-07-03)
* Removed dependency to admin instance on slaves
* Several dependency updates

### 0.7.3 (2019-04-05)
* Add MiTemperature watch with E-Ink display

### 0.7.2 (2019-04-05)
* Add `58:2d:34` as an alternative mac prefix for MiTemperature

### 0.7.0 (2019-02-05)
* Support MaterializeCSS (Admin v3)
* Support compact mode
* Use @iobroker/testing for tests

### 0.6.0 (2018-12-23)
* Add NodeJS 10 support
* Add an option to disallow new devices

### 0.5.5 (2018-11-29)
* Bugfix: Preserving object properties works again

### 0.5.3 (2018-11-23)
* Cache objects for a short while instead of retrieving them from ioBroker all the time
* Support negative temperatures from Xiaomi devices

### 0.5.2 (2018-03-28)
* Fixed `isHandling` for the `ruuvi-tag` plugin

### 0.5.1 (2018-03-28)
* Restored accidentally deleted `mi-flora` plugin.

### 0.5.0 (2018-03-27)
* (JonasR & AlCalzone) Added support for the Ruuvi Tag with the `ruuvi-tag` plugin

### 0.4.2 (2018-03-27)
* Fixed the parsing of temperature+humidity packets from the Xiaomi temperature sensor

### 0.4.1 (2018-03-24)
* Forgot to load legacy `mi-flora` plugin
* Fixed an error when a plugin defines no objects

### 0.4.0 (2018-03-24)
* (zuvielx9 & AlCalzone) Support for all Xiaomi bluetooth sensors using the `xiaomi` plugin
* reworked plugin system slightly

### 0.3.5 (2018-03-18)
* Bugfix: Next attempt at preserving object properties like history and name

### 0.3.4 (2018-01-01)
* Bugfix: Keep `history` settings by not overriding existing objects
* Bugfix: When plugins return `undefined`, ignore the packet

### 0.3.3 (2017-11-24)
* Enable logging of RSSI

### 0.3.2 (2017-09-27)
* Add * wildcard for "all services"

### 0.3.1 (2017-09-27)
* Bugfix: don't throw error when RSSI state doens't exist

### 0.3.0 (2017-09-27)
* Support throttling of RSSI updates

### 0.2.2 (2017-09-27)
* Bugfix: Only monitor services from _enabled_ plugins

### 0.2.1 (2017-09-27)
* Bugfix: last patch broke the service filtering

### 0.2.0 (2017-09-26)
* Modularized the adapter code into a plugin system
* Added Mi-Flora plugin

### 0.1.0 (2017-09-06)
* Support selection of bluetooth devices

### 0.0.2 (2017-09-06)
* Store more information, improved object structure.

### 0.0.1
* initial release

## License
The MIT License (MIT)

Copyright (c) 2017-2025 AlCalzone <d.griesel@gmx.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
