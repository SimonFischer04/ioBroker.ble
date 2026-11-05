# Plan: zentrale Bluetooth-Infrastruktur in `ioBroker.ble`

Status: Entwurf · Stand 2026-11-05

Ziel: `ioBroker.ble` wird die zentrale BLE-Schicht für ioBroker. Er stellt mehrere Empfänger (ESPHome-Bluetooth-Proxies, lokaler Dongle) bereit, macht aktive GATT-Verbindungen möglich und bietet anderen Adaptern eine API. Der konkrete Anlass sind pvvx-Thermometer ([ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer)), deren Uhrzeit automatisch synchronisiert werden soll (inklusive Sommer-/Winterzeit) und auf die Firmware-Updates ausgerollt werden sollen.

Grundsätze aus der Vorab-Diskussion:

- **Ein Adapter.** Wir trennen logisch im Code, nicht physisch in mehrere Adapter.
- **Transport und Protokoll bleiben getrennt.** Die Transportschicht weiß nicht, was ein pvvx-Thermometer ist.
- **Ausschließlich für ioBroker.** Es gibt keinen externen Daemon und kein eigenes Netzwerkprotokoll.
- **Kein eigenes ESP32-Protokoll.** Wir verwenden die ESPHome Native API.
- **Der Adapter [`ioBroker.esphome`](https://github.com/DrozmotiX/ioBroker.esphome) hält die Verbindung zum ESP.** Er hat die API-Verbindung (inklusive Verschlüsselungs-Key, Discovery und Reconnect) und **leitet den Bluetooth-Proxy-Teil an `ble` weiter**. `ble` spricht selbst keine ESPHome Native API.

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
                       │   ├─ esphome-bridge/ Bridge zu esphome.X (sendTo, s. §4a)      │
                       │   ├─ noble-local/  bestehender Kindprozess (Scan)              │
                       │   └─ noble-remote/ bestehender TCP-Client (`server`)           │
                       └──────────────┬─────────────────────────────────────────────────┘
                                      │ sendTo  (Vertrag „ble-bridge/1“, §4a)
                       ┌──────────────▼──────── ioBroker.esphome ───────────────────────┐
                       │  bluetooth-bridge/  Abo-Verwaltung, Weiterleitung, Leases      │
                       │  bestehend:         Geräteverwaltung, Keys, Reconnect          │
                       │                     @2colors/esphome-native-api                │
                       └──────────────┬─────────────────────────────────────────────────┘
                                      │ ESPHome Native API (eine Verbindung pro ESP)
                               ESP32 Bluetooth-Proxies
```

### 2.1 Kernentscheidungen

**E1: Transport-Interface statt eines festen Scanners.**
Jede Quelle implementiert dasselbe Interface (siehe Abschnitt 3). Die bisherigen Varianten „lokaler Kindprozess“ und „TCP-Server“ werden die ersten beiden Implementierungen, ohne Funktionsänderung. Die Bridge zum `esphome`-Adapter kommt als dritte hinzu. Jeder weitergeleitete ESP erscheint dabei als **eigenes Gateway** (`esphome.0:proxy-og`), damit Registry und Connection Manager einzelne Proxies unterscheiden können. Mehrere Transporte können gleichzeitig aktiv sein, zum Beispiel ein lokaler Dongle und drei Proxies.

**E2: Ein neutrales Advertisement-Modell, die Decoder bleiben unverändert.**
`PeripheralInfo` wird ein eigener Typ, nicht mehr ein `Pick<noble.Peripheral>`. Er hat dieselben Felder (`address`, `addressType`, `rssi`, `advertisement.{localName, serviceData[], manufacturerData, serviceUuids}`) plus `gatewayId`. Der `esphome`-Adapter leitet die **rohen AD-Bytes** weiter, ohne sie zu interpretieren. Das Parsen übernimmt `ble` mit einem **AD-Struktur-Parser** (`lib/ad-parser.ts`), der dieselbe Form erzeugt wie noble. Damit funktionieren Xiaomi, BTHome, Ruuvi und `_default` ohne Änderung, und das Bluetooth-Wissen bleibt in `ble`.

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
Ein pvvx-OTA-Update dauert laut pvvx etwa 4 Minuten und besteht aus Tausenden kleinen Writes. Die Gerätelogik kommt deshalb als **Driver** in `ble`, analog zu den Decoder-Plugins, und nicht in Fremdadapter, die jeden Schritt per `sendTo` anstoßen. Weil der Weg zum ESP jetzt aber selbst über `sendTo` zum `esphome`-Adapter führt, braucht die Bridge eine **Sammel-Schreiboperation** (`bt:writeSequence`, siehe 4a). Damit läuft nicht jeder 20-Byte-Write einzeln durch die States-DB. Die `sendTo`-API (Abschnitt 4) bleibt für Fremdadapter mit einfachen GATT-Operationen gedacht.

**E6: ESPHome-Proxies sind das erste neue Backend. Lokale GATT-Verbindungen kommen später.**
Ein zentraler Dongle reicht nicht, also bringen die Proxies den Hauptnutzen. Lokales GATT (BlueZ über D-Bus oder noble im Kindprozess) ist eine eigene Phase. noble greift über den rohen HCI-Socket an `bluetoothd` vorbei zu. Für Connect neben dem Scannen ist BlueZ über D-Bus meist robuster. Das entscheiden wir erst in Phase 6.

**E7: Der `esphome`-Adapter hält die ESP-Verbindung, `ble` bekommt die Bluetooth-Daten weitergereicht.**
Hier lohnt sich die Trennung in zwei Adapter, weil es konkrete Gründe gibt:
- **Eine API-Verbindung pro ESP.** Der Bluetooth-Proxy in ESPHome bedient Advertisements und GATT voraussichtlich nur für *einen* API-Client. Würden `esphome` und `ble` sich beide verbinden, käme es zum Konflikt.
- **Keine doppelte Konfiguration.** Host, Verschlüsselungs-Key, Discovery und Reconnect pflegt der `esphome`-Adapter ohnehin. `ble` bekommt keine eigene ESP-Liste.
- **Der Client existiert schon.** `ioBroker.esphome` nutzt bereits `@2colors/esphome-native-api` (^1.3.6). Die Bibliothek bietet `subscribeBluetoothAdvertisementService`, `connectBluetoothDeviceService(address, addressType, useCache)`, `listBluetoothGATTServicesService`, `read…`, `write…(…, response)`, `notify…`, Descriptor-Zugriffe und `encryptionKey`. `ble` braucht dafür keine neue Abhängigkeit.
- **Aufteilung der Zuständigkeiten:** `esphome` ist reine *Weiterleitung* und weiß nichts über Decoder, Gateway-Auswahl oder Queues. Diese Logik liegt komplett in `ble`. Bei mehreren Abonnenten kann `esphome` Advertisements an alle verteilen. GATT-Verbindungen bleiben über `ble` koordiniert.

Im Spike zu Phase 1 ist in `@2colors/esphome-native-api` zu prüfen:
1. Gibt es Raw-Advertisements, also gebündelte AD-Bytes, oder nur geparste einzelne `ble`-Events? Bei vielen Geräten ist das für die Performance wichtig.
2. Mit welchem Event kommen Notify-Daten an?
3. Werden die Meldungen zu freien Verbindungsslots und zum Verbindungsstatus (MTU, Disconnect-Grund) bereitgestellt?

Fehlt etwas, wird es per Upstream-PR in der Bibliothek ergänzt. `ble` hat keinen eigenen Client als Ausweg mehr.

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

## 4a. Bridge-Vertrag `esphome` ↔ `ble` (`ble-bridge/1`)

Beide Adapter kommunizieren ausschließlich über `sendTo`/`sendToAsync`. Der Vertrag wird in beiden Repos als Typdatei gepflegt (`bridge-protocol.ts`, identischer Inhalt) und hat eine Versionsnummer. Ein eigenes npm-Paket lohnt sich erst, wenn ein dritter Teilnehmer dazukommt.

### Ablauf

1. **Finden:** `ble` sucht alle Instanzen mit `common.name === "esphome"` (Objekt-View `system/instance`) und beobachtet deren `system.adapter.esphome.X.alive`.
2. **Handshake:** `bt:hello` → Protokollversion und Liste der Bluetooth-fähigen ESPs. Bei unbekannter Major-Version schreibt `ble` eine Warnung ins Log und deaktiviert die Bridge zu dieser Instanz.
3. **Abo:** `bt:subscribe` mit Lease. `ble` schickt alle 10 s `bt:keepalive`. Läuft die Lease ab, weil `ble` gestoppt oder abgestürzt ist, beendet `esphome` alle für diesen Abonnenten geöffneten GATT-Verbindungen und kündigt das Advertisement-Abo am ESP, wenn es keinen weiteren Abonnenten gibt.
4. **Neustart:** Startet `esphome` neu (`alive` false → true) oder antwortet auf `keepalive` mit `UNKNOWN_SUBSCRIPTION`, beginnt `ble` wieder bei `bt:hello`.

`esphome` abonniert die Advertisements am ESP **nur, solange mindestens ein Abonnent existiert**. Ohne `ble` ändert sich am heutigen Verhalten also nichts.

### Anfragen `ble` → `esphome.X`

| Befehl | Payload → Ergebnis |
|---|---|
| `bt:hello` | `{ protocol: "ble-bridge/1", subscriber: "ble.0" }` → `{ protocol, proxies: [{ proxyId, name, mac, featureFlags, connected, freeSlots, slotLimit }] }` |
| `bt:subscribe` / `bt:keepalive` / `bt:unsubscribe` | `{ subscriber, leaseMs }` → `{ subscriptionId }` |
| `bt:connect` | `{ proxyId, address, addressType, useCache }` → `{ mtu }` |
| `bt:disconnect` | `{ proxyId, address }` |
| `bt:getServices` | `{ proxyId, address }` → `[{ uuid, handle, characteristics: [{ uuid, handle, properties, descriptors }] }]` |
| `bt:read` / `bt:readDescriptor` | `{ proxyId, address, handle }` → `{ data: base64 }` |
| `bt:write` / `bt:writeDescriptor` | `{ proxyId, address, handle, data: base64, withResponse }` |
| `bt:writeSequence` | `{ proxyId, address, handle, chunks: base64[], withResponse, delayMs? }` → `{ written }`. Maximal ca. 256 Chunks pro Aufruf. Gedacht für OTA, siehe E5. |
| `bt:setNotify` | `{ proxyId, address, handle, enable }` |

### Push `esphome.X` → Abonnent (`ble.0`)

| Befehl | Payload |
|---|---|
| `bt:advertisements` | `{ proxyId, items: [{ address, addressType, rssi, data: base64 }] }`. Die AD-Rohdaten werden gebündelt: ein Batch des ESP, höchstens ca. alle 250 ms. |
| `bt:proxyState` | `{ proxyId, connected, freeSlots, slotLimit }` |
| `bt:connectionState` | `{ proxyId, address, connected, mtu?, error? }`. Auch ungeplante Disconnects werden gemeldet. |
| `bt:notification` | `{ proxyId, address, handle, data: base64 }` |

### Regeln

- **Adressen** werden als MAC-String in Kleinbuchstaben mit Doppelpunkten übertragen, genau wie heute im `ble`-Adapter. Die Umrechnung aus dem `uint64` der ESPHome-API übernimmt `esphome`.
- **`esphome` interpretiert keine Bluetooth-Inhalte.** Es gibt kein Parsing von AD-Daten, keine UUID-Logik und keine Gateway-Auswahl. Ausnahme ist die Liste der Services mit Handles, weil sie 1:1 aus der API kommt.
- **GATT-Verbindungen gehören dem Abonnenten**, der sie geöffnet hat. Advertisements gehen an alle Abonnenten.
- **Fehler** haben die Form `{ error: { code, message } }`. Die Codes sind `NOT_CONNECTED`, `NO_FREE_SLOT`, `TIMEOUT`, `GATT_ERROR`, `UNKNOWN_PROXY`, `UNKNOWN_SUBSCRIPTION`.
- **Größenordnung:** 3 Proxies × 60 Geräte × ca. 1 Advertisement/s ergeben ca. 180 Advertisements/s. Gebündelt sind das nur ca. 4–12 `sendTo`/s, das ist für die States-DB unkritisch. GATT-Einzeloperationen kosten zwei Wege durch die DB (einige ms). Für Zeitsync ist das irrelevant, OTA läuft über `bt:writeSequence`.

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

- **Konfiguration `ble` (`native`):**
  - `esphomeBridge: { enabled, instances: "auto" | string[] }`. Es gibt keine Hosts und keine Keys, die pflegt der `esphome`-Adapter.
  - lokaler Scanner `enabled` und `hciDevice` (wie heute)
  - `server` (wie heute, wird zum Transport `noble-remote`)
  - pvvx-Driver: `autoTimeSync`, `timeSyncIntervalH`, `minBatteryForOta`
- **Konfiguration `esphome`:** pro Gerät eine Option „Bluetooth-Proxy für andere Adapter freigeben“. Der Standard ist an, wenn das Gerät Bluetooth-Proxy-Feature-Flags meldet.
- **Migration:** Bestehende Konfigurationen bleiben gültig. Ohne aktivierte Bridge verhält sich der Adapter exakt wie heute.
- **Neue Instanz-Objekte in `ble`:**
  - `gateways.<instanz>_<proxyId>.connected`
  - `gateways.<instanz>_<proxyId>.freeSlots`
  - `gateways.<instanz>_<proxyId>.lastAdvertisement`
  - `info.connection` = mindestens ein Transport aktiv
- **Geräteobjekte:** unverändert. Neu kommen optional `<device>.gateway` und die Driver-States hinzu.
- **Admin `ble`:** Die React-UI zeigt die gefundenen `esphome`-Instanzen und ihre Proxies (über `bt:hello`) nur lesend an. Langfristig lohnt sich ein Umstieg auf `jsonConfig`, das ist aber nicht Teil dieses Vorhabens.
- **Abhängigkeit:** Die Bridge braucht eine `esphome`-Version mit `ble-bridge/1`. Sie wird **nicht** als harte Abhängigkeit in `io-package.json` eingetragen, weil der Adapter auch rein lokal nutzbar bleiben soll. Stattdessen prüft `bt:hello` zur Laufzeit die Version, und das README dokumentiert die Mindestversion.
- `io-package.json`: Die Mindestversion von `js-controller` sollte realistisch angehoben werden (heute `>=1.4.2`). Die Beschreibung wird angepasst, weil der Adapter nicht mehr nur ein Beacon-Monitor ist.

---

## 7. Umsetzung in Phasen

Jede Phase ist für sich releasefähig.

| Phase | Inhalt | Ergebnis / Abnahme | Größe |
|---|---|---|---|
| **0: Refactoring ohne Verhaltensänderung** | Aus `main.ts` werden `scanner/` (Dedupe, Drosselung, Plugin-Dispatch) und `transports/noble-local`, `noble-remote` extrahiert. `PeripheralInfo` wird ein eigener Typ. Dazu Unit-Tests für den Dispatch mit einem Fake-Transport. | Bestehende Tests sind grün, und identische Objekte und States entstehen im manuellen Test mit einem echten Dongle. | M |
| **1a: `esphome` passive Weiterleitung** (PR in `ioBroker.esphome`) | Spike in `@2colors/esphome-native-api` (E7), `bridge-protocol.ts`, `bt:hello`/`subscribe`/`keepalive`, Weiterleitung von `bt:advertisements` und `bt:proxyState`, Lease-Ablauf, Option pro Gerät. | Ein Testskript abonniert `esphome.0` und bekommt gebündelte Roh-Advertisements. Ohne Abonnenten verhält sich der Adapter wie bisher. | M |
| **1b: `ble` passiv über die Bridge** | Transport `esphome-bridge`, AD-Parser (mit Unit-Tests gegen echte Pakete), Erkennung der Instanzen und `alive`-Überwachung, Registry mit Gateway pro Gerät, Dedupe. | pvvx-/BTHome-Sensoren aus drei Stockwerken landen mit korrekter MAC in den bestehenden Objekten, ohne doppelte Dekodierung. Ein Neustart von `esphome` wird automatisch überbrückt. | L |
| **2: GATT-Kern** | `esphome`: `bt:connect`/`disconnect`/`getServices`/`read`/`write`/`setNotify`, Push von `connectionState` und `notification`, Aufräumen beim Lease-Ablauf. `ble`: `connections/` mit Session, Queue, Leases, Slots, Timeouts, Retry über ein anderes Gateway, plus Debug-Befehle über `sendTo` für den PoC. | Ein Characteristic eines Thermometers wird über einen entfernten Proxy gelesen und geschrieben, und das Verhalten bei parallelen Anfragen ist getestet. Stirbt `ble`, baut `esphome` die Verbindungen ab. | L |
| **3: pvvx-Zeitsync** | `drivers/pvvx` mit Zeit lesen und setzen, Drift, Auslösern und DST-Erkennung. | Eine simulierte DST-Umstellung (Offset gemockt) synchronisiert alle Geräte gestaffelt, und `time.drift` ist danach ≈ 0. | M |
| **4: pvvx-OTA** | `esphome`: `bt:writeSequence`. `ble`: Firmware-Verwaltung, Vorab-Prüfungen, serieller Rollout, Fortschritt. | Ein Testgerät wird über einen Proxy erfolgreich geflasht, und ein absichtlicher Abbruch lässt das Gerät funktionsfähig. | L |
| **5: Externe API** | Vollständige `sendTo`-API (Abschnitt 4) mit Leases, Advertisement-Abos und Doku. | Ein Beispieladapter oder -skript liest per API ein Characteristic und erhält Notifications. | M |
| **6 (optional): Lokales GATT** | BlueZ über D-Bus oder noble als Connect-fähiger Transport. | Der lokale Dongle kann als Gateway für Sessions dienen. | M–L |
| **später** | Verschlüsselte BTHome-Pakete (Bindkey pro Gerät), Identitätsauflösung für rotierende Adressen (IRK). | n/a | n/a |

Den PoC aus der Diskussion („ESPHome-Proxy, GATT-Verbindung über `sendToAsync`, lesen und schreiben“) decken die Phasen 1 und 2 ab. Phase 0 lohnt sich trotzdem vorab: Sie ist klein und verhindert, dass der Umbau in den 544 Zeilen von `main.ts` landet.

Die Phasen 0 und 1a hängen nicht voneinander ab und können parallel laufen, weil sie in verschiedenen Repos liegen. Der Vertrag (§4a) sollte vor 1a/1b als Typdatei feststehen, Phase 1 braucht davon nur den passiven Teil.

### Teststrategie

- **Unit:**
  - AD-Parser,
  - UUID-Normalisierung,
  - Dedupe und Gateway-Auswahl (Hysterese),
  - Connection-Manager-Queue (Fake-Transport mit kontrollierbaren Latenzen und Fehlern),
  - pvvx-Befehle kodieren und dekodieren,
  - DST-Trigger (gemockte Zeit).
- **Integration:**
  - In `ble` wird eine **Fake-Bridge** getestet: ein gemocktes `sendTo`, das den Vertrag aus §4a spielt, Advertisements einspielt, GATT-Antworten und Abbrüche simuliert und auch einen `esphome`-Neustart nachstellt. Damit kommt die CI ohne Hardware aus.
  - In `esphome` wird die Bridge-Schicht gegen eine gemockte `esphome-native-api`-Verbindung getestet (Weiterleitung, Lease-Ablauf, Aufräumen).
  - Der bestehende `test/integration` bleibt erhalten.
- **Hardware:** ein Proxy und ein Thermometer als Mindest-Setup für die Phasen 2 bis 4.

---

## 8. Risiken und offene Punkte

1. **Verträge zwischen zwei Adaptern.** Die Release-Zyklen von `ble` und `esphome` sind gekoppelt. Gegenmittel:
   - ein versioniertes Protokoll (`ble-bridge/1`) mit Prüfung beim Handshake,
   - nur erweiternde Änderungen innerhalb einer Major-Version,
   - die Typdatei in beiden Repos, die per CI-Check auf Gleichheit geprüft wird.

   Mit den Maintainern von `ioBroker.esphome` (DrozmotiX) sollte früh abgestimmt werden, dass die Bridge dort hineinkommt.
2. **Lebenszyklus über Adaptergrenzen.** Verwaiste GATT-Verbindungen am ESP belegen Slots. Dagegen helfen die Lease mit Keepalive, die Überwachung von `alive` auf beiden Seiten und das Aufräumen in `esphome`, wenn eine Lease abläuft. Das muss explizit getestet werden: Prozess-Kill von `ble` während eines laufenden OTA.
3. **Ein Bluetooth-Client pro ESPHome-Proxy.** Mit diesem Design ist der Konflikt aufgelöst, weil nur `esphome` verbunden ist. Andere Systeme (zum Beispiel ein parallel laufendes Home Assistant am selben Proxy) können weiterhin kollidieren. Das gehört ins README.
2. **Aktive Verbindungen am ESP32.** Es gibt nur wenige Slots (typisch 3). Das ESPHome-Setup braucht `bluetooth_proxy: active: true`. Coexistence von WLAN und BLE kann bei OTA (lange Verbindung, viele Writes) die Stabilität drücken. Ethernet-ESP32 (zum Beispiel Olimex POE) sind deshalb zu bevorzugen und zu dokumentieren.
3. **pvvx-Protokolldetails.** Payloads für Zeit und OTA sind im README nicht spezifiziert und müssen aus `TelinkMiFlasher.html` und `ble_ota.py` übernommen werden. Ein Risiko sind Unterschiede zwischen Firmwareversionen. Deshalb Version auslesen und gegen eine bekannte Liste prüfen.
4. **Lasten bei vielen Proxies.** Jedes Advertisement kommt N-fach an. Dedupe muss vor dem Decoder und vor allen DB-Zugriffen passieren (der heutige `onDiscover` macht pro Paket mehrere `getStateAsync`/`objectExists`).
5. **Verhältnis zu Upstream.** Das Repo ist ein Fork von `AlCalzone/ioBroker.ble`. Vor Phase 1 sollte geklärt werden, ob die Änderungen upstream gehen (dann Phase 0 als eigenen PR anbieten) oder der Fork eigenständig released wird.
6. **Rechte und Plattform.** Die Bridge braucht in `ble` keine nativen Module und keine `cap_net_raw`-Rechte. Ein reines Proxy-Setup (ohne lokales Bluetooth) muss also auch in Docker ohne Host-Networking laufen. Dafür muss `noble` lazy bzw. optional geladen werden.

---

## 9. Nächste konkrete Schritte

1. Phase 0 umsetzen: Refactoring `main.ts` → `scanner/` + `transports/noble-*`, eigener `Advertisement`-Typ.
2. Parallel den Spike in `ioBroker.esphome` durchführen: Über die vorhandene `@2colors/esphome-native-api`-Verbindung gegen einen echten Proxy prüfen, ob Folgendes erreichbar ist:
   - Raw-Advertisements,
   - Notify-Events,
   - freie Slots,
   - MTU und Disconnect-Gründe.

   Lücken werden als PR an die Bibliothek gemeldet.
3. `bridge-protocol.ts` (§4a) als Typdatei festlegen und mit den Maintainern von `ioBroker.esphome` abstimmen, zum Beispiel per Issue oder Draft-PR.
4. Das pvvx-Protokoll für `0x23` und Telink-OTA aus dem Flasher-Quellcode extrahieren und als Spezifikation in `docs/pvvx-protocol.md` festhalten.
