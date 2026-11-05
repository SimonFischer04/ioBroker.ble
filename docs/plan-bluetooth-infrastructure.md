# Plan: zentrale Bluetooth-Infrastruktur in `ioBroker.ble`

Status: Entwurf · Stand 2026-11-05

Ziel: `ioBroker.ble` wird die zentrale BLE-Schicht für ioBroker. Er stellt mehrere Empfänger (ESPHome-Bluetooth-Proxies, lokaler Dongle) bereit, macht aktive GATT-Verbindungen möglich und bietet anderen Adaptern eine API. Der konkrete Anlass sind pvvx-Thermometer ([ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer)), deren Uhrzeit automatisch synchronisiert werden soll (inklusive Sommer-/Winterzeit) und auf die Firmware-Updates ausgerollt werden sollen.

Grundsätze aus der Vorab-Diskussion:

- **Ein Adapter.** Wir trennen logisch im Code, nicht physisch in mehrere Adapter.
- **Transport und Protokoll bleiben getrennt.** Die Transportschicht weiß nicht, was ein pvvx-Thermometer ist.
- **Ausschließlich für ioBroker.** Es gibt keinen externen Daemon und kein eigenes Netzwerkprotokoll.
- **Kein eigenes ESP32-Protokoll.** Wir verwenden die ESPHome Native API.

---

## 1. Ist-Zustand im Code

| Datei | Aufgabe heute | Bewertung für den Umbau |
|---|---|---|
| `src/scanProcess.ts` | Startet `noble` in einem Kindprozess und schickt `discover` per IPC. Alternativ läuft er als eigenständiger TCP-Server (`blerp`, Option `server`). | Das ist schon eine einfache Transport-Abstraktion, aber nur für Scanning und nur für eine Quelle. |
| `src/lib/scanProcessInterface.ts` | Definiert das Nachrichtenformat (`ScanMessage`, `InboundMessage`) und `PeripheralInfo` als Pick aus dem noble-Typ `Peripheral`. | `PeripheralInfo` ist an noble gekoppelt. Das wird das neutrale Advertisement-Modell. |
| `src/main.ts` (544 Zeilen) | Enthält alles: Konfiguration, Prozessstart, TCP-Client, `onDiscover`, Plugin-Auswahl, Objekt- und State-Anlage, RSSI-Drosselung, `allowNewDevices` und `message` (nur `getHCIPorts`). | Muss in Module zerlegt werden. Das ist der größte Refactoring-Block. |
| `src/plugins/*` | Decoder mit dem Interface `isHandling`, `createContext`, `defineObjects` und `getValues`. Sie arbeiten rein auf `PeripheralInfo`. | Bleiben unverändert, solange `PeripheralInfo` gleich aussieht. |
| `admin/src/index.tsx` | React-Konfigurations-UI (iobroker-react). | Braucht eine Liste der Gateways (Proxies). |

Wichtige Beobachtungen:

- Die Geräte-ID ist `peripheral.address`, also die MAC-Adresse in Kleinbuchstaben mit Doppelpunkten. Neue Transporte **müssen genau dieses Format liefern**, damit bestehende Objekte erhalten bleiben.
- Wenn mehrere Empfänger dasselbe Advertisement sehen, wird es heute mehrfach dekodiert. Bei einer einzelnen Quelle fällt das nicht auf, bei Proxies schon.
- `noble` läuft bewusst in einem eigenen Prozess, weil es dort Probleme beim Wechsel zwischen Scanning und Verbindungen gab und native Abstürze den Adapter nicht mitreißen sollen.

---

## 2. Zielarchitektur

```
                       ┌───────────────────────── ioBroker.ble ─────────────────────────┐
 Andere Adapter ──sendTo──► api/            (RPC + Push-Abos, Leases)                   │
                       │     │                                                          │
                       │  drivers/          aktive Geräteprotokolle (pvvx: Zeit, OTA)   │
                       │  plugins/          passive Decoder (bestehend, unverändert)    │
                       │     │                                                          │
                       │  devices/          Registry: Gerät ↔ Gateways, RSSI, lastSeen  │
                       │  connections/      GATT-Sessions, Queue, Locks, Slots, Timeouts│
                       │  scanner/          Advertisement-Fan-out, Dedupe, Drosselung   │
                       │     │                                                          │
                       │  transports/       Transport-Interface                         │
                       │   ├─ esphome/      ESPHome Native API (N Proxies)              │
                       │   ├─ noble-local/  bestehender Kindprozess (Scan)              │
                       │   └─ noble-remote/ bestehender TCP-Client (`server`)           │
                       └────────────────────────────────────────────────────────────────┘
```

### 2.1 Kernentscheidungen

**E1: Transport-Interface statt eines festen Scanners.**
Jede Quelle implementiert dasselbe Interface (siehe Abschnitt 3). Die bisherigen Varianten „lokaler Kindprozess“ und „TCP-Server“ werden die ersten beiden Implementierungen, ohne Funktionsänderung. ESPHome kommt als dritte hinzu. Mehrere Transporte können gleichzeitig aktiv sein, zum Beispiel ein lokaler Dongle und drei Proxies.

**E2: Ein neutrales Advertisement-Modell, die Decoder bleiben unverändert.**
`PeripheralInfo` wird ein eigener Typ, nicht mehr ein `Pick<noble.Peripheral>`. Er hat dieselben Felder (`address`, `addressType`, `rssi`, `advertisement.{localName, serviceData[], manufacturerData, serviceUuids}`) plus `gatewayId`. ESPHome liefert Advertisements je nach Modus als Rohdaten. Dafür braucht es einen **AD-Struktur-Parser** (`transports/esphome/ad-parser.ts`), der dieselbe Form erzeugt wie noble. Damit funktionieren Xiaomi, BTHome, Ruuvi und `_default` ohne Änderung.

**E3: Device Registry mit Mehrfach-Empfang.**
Pro MAC-Adresse speichert die Registry `{ gateways: Map<gatewayId, { rssi, lastSeen }> }`. Daraus ergeben sich:
- **Bester Gateway** für Verbindungen: der stärkste RSSI der letzten N Sekunden, mit Hysterese, damit nicht ständig gewechselt wird.
- **Dedupe für Decoder:** Ein identischer Payload innerhalb eines kurzen Fensters (zum Beispiel 1 s) wird nur einmal dekodiert. Der `rssi`-State zeigt den besten Wert.
- Optional ein State `<device>.gateway`, der zeigt, welcher Proxy das Gerät am besten empfängt. Das ist nützlich für Anwesenheit und Fehlersuche.

**E4: Connection Manager als einzige Stelle für aktive Verbindungen.**
- Pro Gerät gibt es höchstens **eine Session** (exklusive Lease). Weitere Anfragen landen in einer FIFO-Queue mit Priorität. Ein OTA-Update hat Vorrang und blockiert den Zeitsync, nicht umgekehrt.
- Pro Gateway werden **Slots gezählt**. ESPHome meldet die freien Verbindungsslots, typischerweise 3.
- Timeouts gibt es für Verbindungsaufbau, einzelne Operationen und Leerlauf. Ein Fehler auf Gateway A führt zu einem erneuten Versuch auf dem nächstbesten Gateway.
- Ein Session-Objekt kapselt `discoverServices`, `read`, `write(withResponse)`, `subscribe(notify)` und `close`. Wer es nutzt, sieht nie, welcher Transport dahintersteht.

**E5: Gerätelogik läuft im Adapter (`drivers/`). Die externe API ist zusätzlich da, nicht der Hauptweg.**
Ein pvvx-OTA-Update dauert laut pvvx etwa 4 Minuten und besteht aus Tausenden kleinen Writes. Das geht nicht über `sendTo`, weil jeder Aufruf einmal durch die States-DB läuft. Deshalb kommt die Gerätelogik als **Driver** in den Adapter, analog zu den Decoder-Plugins. Die `sendTo`-API (Abschnitt 4) bleibt für Fremdadapter mit einfachen GATT-Operationen gedacht. Das passt zum Ergebnis der Diskussion: keine künstliche Aufteilung.

**E6: ESPHome ist das erste neue Backend. Lokale GATT-Verbindungen kommen später.**
Ein zentraler Dongle reicht nicht, also bringen die Proxies den Hauptnutzen. Lokales GATT (BlueZ über D-Bus oder noble im Kindprozess) ist eine eigene Phase. noble greift über den rohen HCI-Socket an `bluetoothd` vorbei zu. Für Connect neben dem Scannen ist BlueZ über D-Bus meist robuster. Das entscheiden wir erst in Phase 6.

**E7: Als ESPHome-Client zuerst `@2colors/esphome-native-api` prüfen.**
Die Bibliothek bietet `subscribeBluetoothAdvertisementService`, `connectBluetoothDeviceService(address, addressType, useCache)`, `listBluetoothGATTServicesService`, `read…`, `write…(…, response)`, `notify…` und Verschlüsselung per `encryptionKey` (Noise). Vor der Festlegung ist zu prüfen (Spike in Phase 1):
1. Gibt es Raw-Advertisements, also gebündelte Pakete, oder nur einzelne `ble`-Events? Das ist bei vielen Geräten für die Performance wichtig.
2. Mit welchem Event kommen Notify-Daten an?
3. Werden die Antworten zu freien Slots und zum Verbindungsstatus (MTU) weitergereicht?

Fehlt etwas Wesentliches, gibt es zwei Wege: ein Upstream-PR oder ein schlanker eigener Client nur für den Bluetooth-Teil der API (Protobuf über TCP plus Noise). Abhängigkeiten ohne nativen Code sind ein Vorteil, denn der ESPHome-Transport kann im Hauptprozess laufen.

---

## 3. Interne Schnittstellen (Skizze)

```ts
// transports/transport.ts
export interface Transport extends EventEmitter {
	readonly id: string;                      // "esphome:proxy-og", "local:hci0"
	readonly capabilities: { scan: boolean; connect: boolean; maxConnections?: number };
	start(): Promise<void>;
	stop(): Promise<void>;
	// events: "advertisement"(Advertisement), "state"(TransportState), "slots"(free:number)

	connect?(address: string, opts: ConnectOptions): Promise<GattLink>;
}

export interface Advertisement {           // ersetzt Pick<noble.Peripheral>
	address: string;                        // "a4:c1:38:xx:xx:xx" (lowercase, wie heute)
	addressType: "public" | "random" | "unknown";
	rssi: number;
	gatewayId: string;
	connectable?: boolean;
	advertisement: {
		localName?: string;
		serviceUuids?: string[];
		serviceData?: { uuid: string; data: Buffer }[];
		manufacturerData?: Buffer;
	};
}

// connections/gatt-session.ts – was Driver und API nutzen
export interface GattSession {
	readonly address: string;
	readonly gatewayId: string;
	readonly mtu: number;
	services(): Promise<GattService[]>;          // gecacht pro Gerät
	read(svc: string, chr: string): Promise<Buffer>;
	write(svc: string, chr: string, data: Buffer, withResponse?: boolean): Promise<void>;
	subscribe(svc: string, chr: string, cb: (data: Buffer) => void): Promise<() => Promise<void>>;
	close(): Promise<void>;
}

export interface ConnectionManager {
	withSession<T>(
		address: string,
		fn: (s: GattSession) => Promise<T>,
		opts?: { priority?: number; timeoutMs?: number; preferGateway?: string; owner?: string },
	): Promise<T>;                              // Queue + Lease + Retry + garantiertes close()
}

// drivers/driver.ts – aktive Geräteprotokolle
export interface Driver {
	name: string;
	matches(adv: Advertisement): boolean;       // z. B. pvvx-Custom-Format / BTHome mit pvvx-Kennung
	defineObjects(address: string): StateObjectDefinition[];   // Buttons, Statusanzeigen
	onStateChange?(address: string, stateId: string, val: unknown, ctx: DriverContext): Promise<void>;
	onSchedule?(ctx: DriverContext): Promise<void>;            // periodisch / Ereignisse
}
```

Ein UUID-Mapping wird zentral normalisiert: kurze 16-Bit-UUIDs (`1f10`) werden in beide Richtungen in die volle 128-Bit-Form umgerechnet. ESPHome arbeitet mit Handles, der Session-Layer löst UUIDs über `services()` in Handles auf.

---

## 4. API für andere Adapter (`sendTo`)

Request/Response über `sendToAsync("ble.0", command, payload)`:

| Befehl | Payload → Ergebnis |
|---|---|
| `getGateways` | → `[{ id, type, connected, freeSlots }]` |
| `getDevices` | `{ filter? }` → `[{ address, name, gateways: [{ id, rssi, lastSeen }] }]` |
| `connect` | `{ address, timeoutMs?, preferGateway? }` → `{ sessionId, gatewayId, mtu }` |
| `disconnect` | `{ sessionId }` |
| `getServices` | `{ sessionId }` → Services/Characteristics/Properties |
| `read` | `{ sessionId, service, characteristic }` → `{ data: base64 }` |
| `write` | `{ sessionId, service, characteristic, data: base64, withResponse? }` |
| `subscribe` / `unsubscribe` | `{ sessionId, service, characteristic }` |
| `subscribeAdvertisements` / `unsubscribeAdvertisements` | `{ filter: { addresses?, serviceUuids?, manufacturerIds? } }` → `{ subscriptionId }` |

Push-Richtung (Notifications, Advertisements): `ble` schickt `sendTo(<abonnierende Instanz>, "ble:notify" | "ble:advertisement", payload)`.

- **Leases mit Ablaufzeit:** Sessions und Abos verfallen ohne `keepalive` nach etwa 30 s. Das verhindert verwaiste Verbindungen, wenn der aufrufende Adapter abstürzt. Zusätzlich hört `ble` auf `system.adapter.<x>.alive` und räumt auf, sobald der Abonnent stirbt.
- **Advertisements werden gebündelt** (zum Beispiel alle 500 ms ein Array) und nur gefiltert ausgeliefert. Ein „alles abonnieren“ ohne Filter wird abgelehnt oder stark gedrosselt.
- Die Fehlercodes werden einheitlich: `NOT_FOUND`, `NO_GATEWAY`, `TIMEOUT`, `BUSY`, `GATT_ERROR`, `SESSION_EXPIRED`.
- Die API wird in `docs/api.md` dokumentiert, mit Beispiel-Code für Fremdadapter.

---

## 5. pvvx-Driver (erster Anwendungsfall)

Protokoll-Grundlage laut pvvx-README: Service `0x1F10`, Characteristic `0x1F1F`. Befehle sind ein Byte plus Payload, zum Beispiel `0x23` Get/Set Time, `0x55` Config, `0x01` Name, `0x10` MAC.
**Noch zu verifizieren** (aus `TelinkMiFlasher.html` bzw. `utils/ble_ota.py`):
- das Byte-Layout von `0x23`,
- ob die Firmware die lokale Zeit oder UTC plus Offset erwartet,
- die Telink-OTA-Service- und Characteristic-UUIDs, das Paketformat (Index und CRC), das Pacing und die Start/End-Befehle.

### 5.1 Zeitsynchronisierung

States pro Gerät:
- `time.sync` (Button)
- `time.lastSync` (ts)
- `time.drift` (s, read)
- `time.autoSync` (bool)

Auslöser:
1. Adapterstart (gestaffelt, nicht alle Geräte gleichzeitig).
2. Intervall (konfigurierbar, Standard 24 h).
3. **Änderung des UTC-Offsets.** Ein Timer wird auf den nächsten DST-Übergang gesetzt. Zusätzlich wird jede Minute `new Date().getTimezoneOffset()` geprüft, als Absicherung gegen Änderungen der Systemzeit. Ändert sich der Offset, werden alle Geräte zeitnah synchronisiert, gestaffelt über den Connection Manager.
4. Drift über einem Schwellwert. Dazu wird vor dem Setzen die Zeit gelesen.

Alles läuft als `withSession(address, …, { priority: low })`. Ein laufendes OTA-Update blockiert, ein Sync wartet.

### 5.2 Firmware-Updates (OTA)

States:
- `firmware.version` (read, über Befehl / Device-Info)
- `firmware.available`
- `firmware.update` (Button)
- `firmware.progress` (%)
- `firmware.status`

Dazu kommt instanzweit `firmware.updateAll`.

- **Quelle der Firmware:** Die Dateien liegen im ioBroker-Dateispeicher (`ble.0/firmware/…`), per Admin hochgeladen, oder werden optional aus den GitHub-Releases von pvvx geholt. Das Modell (`LYWSD03MMC`, `MHO-C401`, …) bestimmt das Image.
- **Vorab-Prüfungen:**
  - Modell bzw. Hardwareversion passt zum Image,
  - Akku über 40 % (laut pvvx-Hinweis für LYWSD03MMC),
  - Image ≤ 128 KB,
  - RSSI des besten Gateways über einem Schwellwert.
- **Rollout:** streng seriell, ein Gerät nach dem anderen. Pro Gerät eine Session mit hoher Priorität und langem Timeout. Bricht ein Gerät ab, wird das gemeldet und der Rollout läuft weiter. Ein abgebrochenes OTA lässt laut pvvx die alte Firmware intakt.
- Nach dem Update wird auf das erste Advertisement mit neuer Version gewartet, danach die Zeit synchronisiert.

---

## 6. Konfiguration, Objekte, Admin

- **Konfiguration (`native`):**
  - `gateways: [{ id, type: "esphome", host, port: 6053, encryptionKey, enabled }]`
  - lokaler Scanner `enabled` und `hciDevice` (wie heute)
  - `server` (wie heute, wird zum Transport `noble-remote`)
  - pvvx-Driver: `autoTimeSync`, `timeSyncIntervalH`, `minBatteryForOta`
- **Migration:** Bestehende Konfigurationen bleiben gültig. Ohne `gateways` verhält sich der Adapter exakt wie heute.
- **Neue Instanz-Objekte:**
  - `gateways.<id>.connected`
  - `gateways.<id>.freeSlots`
  - `gateways.<id>.lastAdvertisement`
  - `info.connection` = mindestens ein Transport aktiv
- **Geräteobjekte:** unverändert. Neu kommen optional `<device>.gateway` und die Driver-States hinzu.
- **Admin:** Die React-UI bekommt eine Tabelle für die Gateways mit „Verbindung testen“ über `sendTo`. Langfristig lohnt sich ein Umstieg auf `jsonConfig`, das ist aber nicht Teil dieses Vorhabens.
- `io-package.json`: Die Mindestversion von `js-controller` sollte realistisch angehoben werden (heute `>=1.4.2`). Die Beschreibung wird angepasst, weil der Adapter nicht mehr nur ein Beacon-Monitor ist.

---

## 7. Umsetzung in Phasen

Jede Phase ist für sich releasefähig.

| Phase | Inhalt | Ergebnis / Abnahme | Größe |
|---|---|---|---|
| **0: Refactoring ohne Verhaltensänderung** | Aus `main.ts` werden `scanner/` (Dedupe, Drosselung, Plugin-Dispatch) und `transports/noble-local`, `noble-remote` extrahiert. `PeripheralInfo` wird ein eigener Typ. Dazu Unit-Tests für den Dispatch mit einem Fake-Transport. | Bestehende Tests sind grün, und identische Objekte und States entstehen im manuellen Test mit einem echten Dongle. | M |
| **1: ESPHome passiv** | Spike mit `@2colors/esphome-native-api` (E7) plus Transport `esphome`, AD-Parser (mit Unit-Tests gegen echte Pakete), mehrere Proxies gleichzeitig, Registry mit Gateway pro Gerät, Dedupe, Gateway-Konfiguration im Admin. | pvvx-/BTHome-Sensoren aus drei Stockwerken landen mit korrekter MAC in den bestehenden Objekten, ohne doppelte Dekodierung. | L |
| **2: GATT-Kern** | `connections/`: Session, Queue, Leases, Slots, Timeouts, Retry über ein anderes Gateway. Dazu Debug-Befehle über `sendTo` (`connect`/`read`/`write`) für den PoC. | Ein Characteristic eines Thermometers wird über einen entfernten Proxy gelesen und geschrieben, und das Verhalten bei parallelen Anfragen ist getestet. | L |
| **3: pvvx-Zeitsync** | `drivers/pvvx` mit Zeit lesen und setzen, Drift, Auslösern und DST-Erkennung. | Eine simulierte DST-Umstellung (Offset gemockt) synchronisiert alle Geräte gestaffelt, und `time.drift` ist danach ≈ 0. | M |
| **4: pvvx-OTA** | Firmware-Verwaltung, Vorab-Prüfungen, serieller Rollout, Fortschritt. | Ein Testgerät wird über einen Proxy erfolgreich geflasht, und ein absichtlicher Abbruch lässt das Gerät funktionsfähig. | L |
| **5: Externe API** | Vollständige `sendTo`-API (Abschnitt 4) mit Leases, Advertisement-Abos und Doku. | Ein Beispieladapter oder -skript liest per API ein Characteristic und erhält Notifications. | M |
| **6 (optional): Lokales GATT** | BlueZ über D-Bus oder noble als Connect-fähiger Transport. | Der lokale Dongle kann als Gateway für Sessions dienen. | M–L |
| **später** | Verschlüsselte BTHome-Pakete (Bindkey pro Gerät), Identitätsauflösung für rotierende Adressen (IRK). | n/a | n/a |

Den PoC aus der Diskussion („ESPHome-Proxy, GATT-Verbindung über `sendToAsync`, lesen und schreiben“) decken die Phasen 1 und 2 ab. Phase 0 lohnt sich trotzdem vorab: Sie ist klein und verhindert, dass der Umbau in den 544 Zeilen von `main.ts` landet.

### Teststrategie

- **Unit:**
  - AD-Parser,
  - UUID-Normalisierung,
  - Dedupe und Gateway-Auswahl (Hysterese),
  - Connection-Manager-Queue (Fake-Transport mit kontrollierbaren Latenzen und Fehlern),
  - pvvx-Befehle kodieren und dekodieren,
  - DST-Trigger (gemockte Zeit).
- **Integration:**
  - ein **Fake-ESPHome-Server** (Protobuf/TCP), der Advertisements einspielt und GATT-Antworten simuliert, damit CI ohne Hardware auskommt,
  - der bestehende `test/integration` bleibt erhalten.
- **Hardware:** ein Proxy und ein Thermometer als Mindest-Setup für die Phasen 2 bis 4.

---

## 8. Risiken und offene Punkte

1. **Nur ein Bluetooth-Abonnent pro ESPHome-Proxy.** Der Bluetooth-Proxy von ESPHome bedient Advertisements und Verbindungen sehr wahrscheinlich nur für einen API-Client gleichzeitig. Läuft parallel der ioBroker-`esphome`-Adapter auf demselben Gerät, kann es Konflikte geben. Das muss in Phase 1 verifiziert und dokumentiert werden. Eine mögliche Empfehlung: dedizierte Proxies für `ble`, oder Bluetooth im `esphome`-Adapter für diese Geräte abschalten.
2. **Aktive Verbindungen am ESP32.** Es gibt nur wenige Slots (typisch 3). Das ESPHome-Setup braucht `bluetooth_proxy: active: true`. Coexistence von WLAN und BLE kann bei OTA (lange Verbindung, viele Writes) die Stabilität drücken. Ethernet-ESP32 (zum Beispiel Olimex POE) sind deshalb zu bevorzugen und zu dokumentieren.
3. **pvvx-Protokolldetails.** Payloads für Zeit und OTA sind im README nicht spezifiziert und müssen aus `TelinkMiFlasher.html` und `ble_ota.py` übernommen werden. Ein Risiko sind Unterschiede zwischen Firmwareversionen. Deshalb Version auslesen und gegen eine bekannte Liste prüfen.
4. **Lasten bei vielen Proxies.** Jedes Advertisement kommt N-fach an. Dedupe muss vor dem Decoder und vor allen DB-Zugriffen passieren (der heutige `onDiscover` macht pro Paket mehrere `getStateAsync`/`objectExists`).
5. **Verhältnis zu Upstream.** Das Repo ist ein Fork von `AlCalzone/ioBroker.ble`. Vor Phase 1 sollte geklärt werden, ob die Änderungen upstream gehen (dann Phase 0 als eigenen PR anbieten) oder der Fork eigenständig released wird.
6. **Rechte und Plattform.** Der ESPHome-Transport braucht keine nativen Module und keine `cap_net_raw`-Rechte. Ein reines Proxy-Setup (ohne lokales Bluetooth) muss also auch in Docker ohne Host-Networking laufen. Dafür muss `noble` lazy bzw. optional geladen werden.

---

## 9. Nächste konkrete Schritte

1. Phase 0 umsetzen: Refactoring `main.ts` → `scanner/` + `transports/noble-*`, eigener `Advertisement`-Typ.
2. Parallel den ESPHome-Spike durchführen: kleines Skript mit `@2colors/esphome-native-api` gegen einen echten Proxy, das prüft:
   - Raw-Advertisements,
   - Notify-Events,
   - freie Slots,
   - Verhalten bei einem zweiten API-Client.
3. Das pvvx-Protokoll für `0x23` und Telink-OTA aus dem Flasher-Quellcode extrahieren und als Spezifikation in `docs/pvvx-protocol.md` festhalten.
