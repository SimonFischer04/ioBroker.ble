# Older changes

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
