# <img src="admin/ble2.png" height="48" /> ioBroker.ble2

[![Test and Release](https://github.com/SimonFischer04/ioBroker.ble2/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/SimonFischer04/ioBroker.ble2/actions/workflows/test-and-release.yml)
[![npm version](https://img.shields.io/npm/v/iobroker.ble2.svg)](https://www.npmjs.com/package/iobroker.ble2)

This is SimonFischer04's maintained fork of [ioBroker.ble](https://github.com/AlCalzone/ioBroker.ble), published independently as `iobroker.ble2`. The original authors and MIT license are retained.

Monitor Bluetooth Low Energy (BLE) beacons and record their information. 
Currently, only recording *advertised* service data is supported. You can monitor which services are advertised by using the nRF Connect app (service data UUIDs).
Connecting and reading/writing service chararcteristics will be supported in a future version.

## Installation

Requires Node.js 22.19 or newer, js-controller 7.2.2 or newer, and admin 7.6.20 or newer.

![Number of Installations](http://iobroker.live/badges/ble2-installed.svg?break_cache=1) ![Number of Installations](http://iobroker.live/badges/ble2-stable.svg?break_cache=1)

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

### Moving from ble to ble2

Install `iobroker.ble2` and create a new `ble2` instance. Copy your settings from the old `ble` instance. If both instances use the same Bluetooth device or remote scanner, disable the old instance before starting the new one.

The new adapter creates its own objects and states under `ble2.<instance>.*`. Existing `ble.<instance>.*` objects and history are not renamed or deleted. Enable **Accept new devices** in the new instance to discover your sensors, then update scripts, aliases, and dashboards to use the new state IDs.

Remote scanner command-line flags and the TCP protocol are unchanged. For scanner configuration supplied through environment variables, rename the `IOB_BLE_` prefix to `IOB_BLE2_`.

## Plugin system
Build the adapter from source with `npm ci` followed by `npm run build`. The generated backend `build/` directory is not tracked in Git. Published npm packages include the generated files; installation directly from Git is disabled with `common.nogit`.

For a standalone remote scanner, `npm run build:server` generates `bin/blerp.js`. This generated bundle is also ignored by Git; it loads the installed `@stoprocent/noble` driver at runtime.

The admin interface is provided by ioBroker JSONConfig (`admin/jsonConfig.json`) and requires admin 7.6.20 or newer. It has no separate frontend build. Existing instance settings retain the same names and types; **Accept new devices** controls the live `options.allowNewDevices` state and still resets after five minutes.

Run `npm run lint` to check the adapter, tests, and JavaScript helpers using the shared ioBroker ESLint configuration. Use `npm run lint -- --fix` to apply automatic fixes.

The adapter supports extension via plugins. Those define which advertised services should be listened to and how to translate the data. The plugin structure is defined in https://github.com/SimonFischer04/ioBroker.ble2/blob/master/src/plugins/plugin.ts and an example of a working plugin is defined here https://github.com/SimonFischer04/ioBroker.ble2/blob/master/src/plugins/_default.ts

Plugins can also declare `manufacturerIds`, an optional list of Bluetooth company identifiers, to receive manufacturer data from devices that do not advertise a matching service. The Ruuvi Tag plugin uses company identifier `0x0499`. When running a remote scanner, include `--manufacturerIds 1177` alongside its service filters to receive these packets.

If you have any device transmitting specially encoded information via advertisements, feel free to create a PR with a new plugin for that.

### Supported plugins
* `"xiaomi"`: All xiaomi bluetooth sensors, including 
  * [Flower Care plant sensor](https://xiaomi-mi.com/sockets-and-sensors/xiaomi-huahuacaocao-flower-care-smart-monitor/)
  * [Mijia Temperature and Humidity sensor](https://www.banggood.com/Xiaomi-Mijia-Bluetooth-Thermometer-Hygrometer-with-LCD-Screen-Magnetic-Suction-Wall-Stickers-p-1232396.html?cur_warehouse=USA)
  * [Mosquito Repellent](https://www.aliexpress.com/item/32883859984.html)
* `"mi-flora"`: Original plugin for the flower care plant sensor, now aliased to `"xiaomi"`
* `"ruuvi-tag"`: [Ruuvi Tag](https://tag.ruuvi.com/) multisensor with firmware versions v1 and v2. **Untested, please give feedback!** 
* `"bthome"`: Sensors using the [BTHome](https://bthome.io) protocol. For now this is limited to the `v2` revision of the protocol and does not support encrypted packets.

## Publishing releases

The npm package is `iobroker.ble2`; its ioBroker adapter name is `ble2`. The GitHub repository is `SimonFischer04/ioBroker.ble2`.

For the first publication of this new package, sign in to npm with your own account and build and verify the package locally:

```sh
npm login
npm ci
npm run build
npm test
npm run test:integration
npm publish --access public
```

This creates `iobroker.ble2` under the publishing account. Publishing a new package is subject to npm's package-name availability checks; no access to `iobroker.ble` is required.

After that initial publication, configure a GitHub Actions trusted publisher in the npm settings for `iobroker.ble2`. Subsequent releases use [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) through `ioBroker/testing-action-deploy@v1`:

| npm setting | Value for this fork |
| --- | --- |
| Organization or user | `SimonFischer04` |
| Repository | `ioBroker.ble2` |
| Workflow filename | `test-and-release.yml` |
| Environment | Leave blank |

The npm account configuring this must have publish rights for `iobroker.ble2`. The package's `repository.url` must match the repository running the release workflow; update both the npm publisher settings and this field if publishing from another repository.

For an intended release, update `package.json` and `io-package.json` to the new version, merge the release changes, and push the matching `v<version>` tag to run the checks, build, and publish jobs. The Git tag does not rewrite the version in these files. Use `npm version <version> --no-git-tag-version` to update `package.json` and `package-lock.json`, then set `common.version` in `io-package.json` to the same value before committing. Each npm version must be new; changing the npm dist-tag does not allow an existing version to be published again. The deploy action uses Node.js 24 and updates npm to version 11 for OIDC authentication. It builds the adapter before publication and includes JSONConfig and its translations in the npm package. Pre-release tags such as `v1.0.0-beta.0` publish under the npm `next` dist-tag.

No `NPM_TOKEN` secret is needed. The deploy job has `id-token: write` for npm authentication and `contents: write` for creating the GitHub release. Pull requests run the checks and tests and skip publishing. Verify the first intended release succeeds before removing any old npm publish token.

## Changelog
<!--
	Placeholder for next release:
	### __WORK IN PROGRESS__
* **BREAKING:** Require js-controller 7.2.2 or newer; update adapter-core and release tools, repository metadata, and Dependabot configuration.
-->
### __WORK IN PROGRESS__
* Replace the custom React settings page with responsive native JSONConfig (requires admin 7.6.20 or newer), preserving settings and the live discovery switch.
* **BREAKING:** Rename the maintained fork to `iobroker.ble2` with the `ble2` adapter namespace.
* **BREAKING:** Require Node.js 22.19 or newer; test Node.js 22, 24, and 26 on Linux, Windows, and macOS.
* Added BTHome signed counters, signed power, volume storage, and direction measurements.
* Fixed discovery and decoding of Ruuvi Tag manufacturer-only advertisements, including packets received after empty or unrelated frames.
* Ignore invalid Mi Flora soil moisture readings above 100% to preserve the last valid measurement.

### 0.14.2-beta.1 (2026-11-21)
* Prepare a fresh prerelease version to verify npm Trusted Publishing.

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

Older entries are available in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## License
The MIT License (MIT)

Copyright (c) 2026 SimonFischer04 <simi.fischa@gmail.com>; 2017-2025 AlCalzone <d.griesel@gmx.net>

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
