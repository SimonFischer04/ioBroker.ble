# Spezifikation Phase 3: Zeitsync für pvvx-Thermometer

Stand 2026-11-19 · gehört zu `docs/plan-bluetooth-infrastructure.md` (Phase 3 in Abschnitt 7)

Dieses Dokument ist die verbindliche Arbeitsanweisung für Phase 3. Arbeite es von oben nach unten ab. Wo es eine Frage nicht beantwortet, hör auf und frag nach. Rate nicht.

Lies vorher:

- `AGENTS.md` in diesem Repo,
- `docs/pvvx-protocol.md`, Abschnitte 2 bis 5 und 7. Es beschreibt das Protokoll der Geräte. Dieses Dokument wiederholt davon nur, was du für die Umsetzung brauchst.

---

## 1. Ziel und Abgrenzung

### Voraussetzung

**Phase 2 muss fertig sein** (`docs/spec-phase-2-gatt.md`). Phase 3 benutzt daraus `ConnectionManager.withSession()`, `GattSession`, `GatewayError` und für die Integrationstests den `FakeGattGateway`. Prüfe vor dem ersten Schritt, dass diese Teile existieren und ihre Tests bestehen. Fehlt etwas, hör auf.

### Ziel

`ble` stellt die Uhr von pvvx-Thermometern automatisch, über die Gateways aus Phase 2:

- beim Start des Adapters,
- in einem einstellbaren Intervall,
- sofort nach jeder Zeitumstellung (Sommer-/Winterzeit),
- auf Knopfdruck.

Dabei liest `ble` Firmware-Version und Hardware-ID der Geräte und zeigt an, wie weit ihre Uhr vor dem Stellen abwich.

Abnahme am Ende der Phase:

1. Ein Gerät aus der Liste in den Einstellungen bekommt über einen entfernten Proxy die lokale Zeit des ioBroker-Hosts.
2. Ändert sich der Abstand der lokalen Zeit zu UTC, werden alle Geräte innerhalb von 2 Minuten neu gestellt.
3. Ist ein Gerät nicht erreichbar, versucht `ble` es nach 5, 15 und 60 Minuten erneut und danach erst wieder im normalen Intervall.

### Nicht Teil dieser Phase

Baue nichts davon, auch nicht vorbereitend:

- Firmware-Update, Image-Auswahl, `firmware.json` (Phase 4).
- Die Gangkorrektur der Uhr (Befehl `0x24`). Sende ihn nie.
- Irgendeinen anderen Befehl als `0x55` und `0x23`.
- Ein allgemeines Driver-Interface für mehrere Gerätetypen. Es gibt in dieser Phase genau einen Driver. Das Interface kommt, wenn der zweite dazukommt.
- Automatisches Erkennen von pvvx-Geräten. Behandelt werden nur Geräte, die der Benutzer einträgt.
- Ein Decoder für das pvvx-eigene Advertisement-Format.
- Löschen von Objekten, wenn ein Gerät aus der Liste entfernt wird.

---

## 2. Verhalten aus Sicht des Benutzers

### Einstellungen

| Einstellung (`native`) | Typ | Standard | Bedeutung |
|---|---|---|---|
| `pvvxDevices` | string | `""` | MAC-Adressen der pvvx-Geräte, getrennt durch Komma, Semikolon, Leerzeichen oder Zeilenumbruch |
| `pvvxSyncInterval` | number | `24` | Stunden zwischen zwei Zeitsyncs eines Geräts. `0` = kein regelmäßiger Sync, nur Start, Zeitumstellung und Knopf |

Leere Liste: Der Driver tut nichts, legt keine Objekte an und startet keinen Timer.

### Objekte pro Gerät

Unter dem Gerät `ble.0.<mac>` (Adresse in Kleinbuchstaben mit Doppelpunkten, wie alle Geräte-IDs):

| ID | Typ | Rolle | Schreibbar | Inhalt |
|---|---|---|---|---|
| `<mac>.pvvx` | channel | – | – | Name `"pvvx firmware"` |
| `<mac>.pvvx.syncTime` | boolean | `button` | ja | Stellt die Uhr sofort |
| `<mac>.pvvx.lastTimeSync` | number | `date` | nein | Zeitpunkt (ms) des letzten erfolgreichen Syncs |
| `<mac>.pvvx.timeDeviation` | number | `value` | nein | Abweichung der Uhr vor dem Stellen, in Sekunden, Einheit `s`. Positiv = Uhr ging vor |
| `<mac>.pvvx.firmwareVersion` | string | `info.firmware` | nein | z. B. `"5.9"` |
| `<mac>.pvvx.hardwareId` | number | `value` | nein | Hardware-ID aus `0x55`. Kein Wert, wenn das Gerät keine meldet |
| `<mac>.pvvx.lastError` | string | `text` | nein | `""` nach Erfolg, sonst `"<CODE>: <Meldung>"` |

Für alle gilt `read: true`, außer `syncTime` (`read: false`).

---

## 3. Das Protokoll in Kürze

Alles läuft über eine einzige Characteristic:

- Service `00001f10-0000-1000-8000-00805f9b34fb`, Characteristic `00001f1f-0000-1000-8000-00805f9b34fb`.
- **Anfrage:** Write ohne Antwort (`withResponse: false`). Byte 0 ist die Befehlsnummer.
- **Antwort:** Notification mit derselben Befehlsnummer in Byte 0.
- Das Gerät schickt auch unaufgefordert Notifications, vor allem Messwerte mit Byte 0 = `0x33`. Die müssen übersprungen werden.

| Schritt | Anfrage | Antwort |
|---|---|---|
| Konfiguration lesen | `55` | ≥ 10 Bytes, Byte 1 = Version, Hardware-ID nach Formel (B1) |
| Zeit lesen | `23` | 5 oder 9 Bytes, Bytes 1–4 = Zählerstand, Little Endian |
| Zeit setzen | `23` + 4 Bytes Wert, Little Endian | wie „Zeit lesen“, mit dem neuen Wert |

Der Wert für die Uhr ist die **lokale Zeit als Unix-Sekunden**:

```
wert = floor(jetzt_ms / 1000) − timezoneOffset_minuten(jetzt) × 60
```

`timezoneOffset_minuten` ist `new Date(jetzt_ms).getTimezoneOffset()`: Minuten, umgekehrtes Vorzeichen (Wien im Winter `−60`).

Die Schreibart `withResponse: false` folgt der Firmware, die nur „Write Without Response“ deklariert. Ob über einen ESPHome-Proxy auch Writes mit Antwort funktionieren, ist offen (`docs/pvvx-protocol.md`, 9.1). Definiere die Schreibart deshalb als **eine** Konstante in `protocol.ts`, damit ein Hardwaretest sie an einer Stelle ändern kann.

---

## Teil B: Umsetzung

Reihenfolge B1 bis B8. Nach jedem Schritt müssen die dort genannten Tests bestehen und `npm run check` sowie `npm run lint` sauber sein. Mach nach jedem Schritt einen Commit.

Neue Dateien liegen in `src/drivers/pvvx/`. Unit-Tests liegen daneben.

> **Testpfad:** `npm run test:ts` übergibt das Muster in Anführungszeichen an mocha, Tests in `src/drivers/pvvx/` werden also gefunden. Prüfe nach dem ersten neuen Test trotzdem, dass er in der Ausgabe von `npm run test:ts` auftaucht.

### B1. Protokoll

Neue Datei `src/drivers/pvvx/protocol.ts`. Nur reine Funktionen, keine Imports aus dem Adapter.

```ts
export const PVVX_SERVICE = "00001f10-0000-1000-8000-00805f9b34fb";
export const PVVX_COMMAND_CHARACTERISTIC = "00001f1f-0000-1000-8000-00805f9b34fb";
/** How commands are written. The firmware declares "write without response" only, see docs/pvvx-protocol.md 9.1 */
export const PVVX_WRITE_WITH_RESPONSE = false;

export const CMD_CONFIG = 0x55;
export const CMD_TIME = 0x23;

/** Value for the device clock: local time as Unix seconds, unsigned 32 bit */
export function localClockValue(nowMs: number, timezoneOffsetMinutes: number): number;
/** Request to read (no value) or set (value) the clock */
export function encodeTimeRequest(value?: number): Buffer;
/** Answer to CMD_TIME. undefined if it is not one. */
export function parseTimeResponse(data: Buffer): { clock: number; lastSet?: number } | undefined;
/** Request to read the configuration: exactly one byte, more bytes would overwrite it */
export function encodeConfigRequest(): Buffer;
/** Answer to CMD_CONFIG. undefined if it is not one. */
export function parseConfigResponse(data: Buffer): { version: number; hardwareId?: number } | undefined;
/** 0x59 -> "5.9" */
export function formatVersion(version: number): string;
/** Seconds the device clock is ahead (positive) or behind (negative) */
export function clockDeviation(deviceClock: number, expectedValue: number): number;
```

Regeln:

1. `localClockValue`: `(Math.floor(nowMs / 1000) - timezoneOffsetMinutes * 60) >>> 0`.
2. `encodeTimeRequest()` → `Buffer.from([0x23])`. `encodeTimeRequest(v)` → 5 Bytes, `0x23` und `v >>> 0` als `writeUInt32LE`.
3. `parseTimeResponse`: `undefined`, wenn kürzer als 5 Bytes oder Byte 0 ≠ `0x23`. `clock` = `readUInt32LE(1)`. `lastSet` = `readUInt32LE(5)` nur bei mindestens 9 Bytes.
4. `parseConfigResponse`: `undefined`, wenn kürzer als 10 Bytes oder Byte 0 ≠ `0x55`. `version` = Byte 1. Hardware-ID:

    ```
    wenn Länge < 12:      keine
    hver = Byte 11
    wenn version < 0x36:  hver = hver & 0x87
    wenn version >= 0x48: hardwareId = hver
    sonst:                id = hver & 0x0F
                          wenn id == 0x0F: hardwareId = 16 + (Byte 10 & 0x7F)
                          sonst:           hardwareId = id
    ```

5. `formatVersion`: `${v >> 4}.${v & 0x0f}`.
6. `clockDeviation`: Differenz zweier vorzeichenloser 32-Bit-Zahlen, als vorzeichenbehaftete 32-Bit-Zahl: `(deviceClock - expectedValue) | 0`. So bleibt das Ergebnis über den Überlauf im Jahr 2106 richtig.

Tests in `src/drivers/pvvx/protocol.test.ts`, mit den Vektoren aus `docs/pvvx-protocol.md`, Abschnitt 7:

- `localClockValue` und `encodeTimeRequest` für alle sechs Zeilen von 7.1. Den Abstand gibst du als Zahl vor (Wien Sommer `−120`, Winter `−60`), nicht über die Zeitzone des Testprozesses.
- `parseTimeResponse` für die vier Zeilen von 7.2.
- `parseConfigResponse` für die drei Zeilen von 7.3, dazu: eine 10-Byte-Antwort ohne Hardware-ID; Version `0x30` mit `hver = 0xff` ergibt `0x87 & 0x0F = 7`.
- `formatVersion(0x59) === "5.9"`, `formatVersion(0x4a) === "4.10"`.
- `clockDeviation(1792897199, 1792893600) === 3599`, `clockDeviation(1792893600, 1792897199) === -3599`, `clockDeviation(5, 0xfffffffb) === 10`.

### B2. Simuliertes Gerät für Unit-Tests

Neue Datei `src/drivers/pvvx/fake-pvvx-device.ts` (nur für Tests, wird von keinem Produktivcode importiert). Klasse `FakePvvxDevice`, implementiert `GattLink` aus `src/connections/gatt-link.ts`.

- `getServices()` liefert den Service `PVVX_SERVICE` mit Handle 30 und darin die Characteristic `PVVX_COMMAND_CHARACTERISTIC`, Handle 32, `properties: 0x16` (Read, Write Without Response, Notify), Descriptor `00002902-…` Handle 33.
- `subscribe(32, listener)` merkt sich den Listener.
- `write(32, data, withResponse)` hält jedes Write fest (`writes: { data: Buffer; withResponse: boolean }[]`) und antwortet, wenn ein Listener da ist, über den Listener, **asynchron** (`setImmediate`):
    - `55` → `configResponse` (einstellbar, Standard `55 59 00 00 00 00 0a 04 8b 00 37 00`).
    - `23` → `23` + `clock` (4 Bytes LE). Mit `timeAdjust: true` zusätzlich `lastSet` (4 Bytes).
    - `23` + 4 Bytes → `clock` und `lastSet` übernehmen, antworten wie beim Lesen.
    - Alles andere → `[cmd, 0xff]`.
- Einstellbar: `clock` (Zahl, der Test setzt ihn direkt), `timeAdjust`, `configResponse`, `silentCommands: number[]` (auf diese Befehle nicht antworten), `beforeEachAnswer: Buffer[]` (Notifications, die vor jeder Antwort gesendet werden, z. B. `33 …`), `failWrite: GatewayError | undefined`.
- `ignoreSetTime: true`: `23` + 4 Bytes ändert `clock` nicht, die Antwort enthält den alten Wert.
- `read()` liefert die Konfigurationsantwort. `disconnect()` merkt sich den Aufruf.

Dazu `createFakeSession(device): GattSession`, die eine echte `GattSession` über dem Fake erzeugt.

Kein eigener Test für den Fake, er wird in B3 und B4 benutzt.

### B3. Befehlskanal

Neue Datei `src/drivers/pvvx/command-channel.ts`:

```ts
export class PvvxCommandChannel {
	public constructor(session: GattSession, timers: { setTimeout(cb: () => void, ms: number): unknown; clearTimeout(t: any): void });
	/** Enables notifications of the command characteristic. Must be called once, before request(). */
	public open(): Promise<void>;
	/**
	 * Writes the request and resolves with the first notification whose first byte equals the first byte of the request.
	 * Other notifications are skipped. Rejects with GatewayError("TIMEOUT") after timeoutMs.
	 * Only one request at a time: a second call while one is running rejects with GatewayError("GATT_ERROR").
	 */
	public request(data: Buffer, timeoutMs?: number): Promise<Buffer>;
}
```

Regeln:

1. `open()` ruft `session.subscribe(PVVX_SERVICE, PVVX_COMMAND_CHARACTERISTIC, listener)`.
2. `request` registriert die Erwartung **bevor** es schreibt, dann `session.write(PVVX_SERVICE, PVVX_COMMAND_CHARACTERISTIC, data, PVVX_WRITE_WITH_RESPONSE)`. Wirft das Write, wird der Timer gelöscht und der Fehler durchgereicht.
3. Standard-Timeout 10000 ms. Meldung: `"No answer to command 0x<nn> within <n> ms"`.
4. Notifications ohne laufende Anfrage und solche mit anderem Byte 0 werden ignoriert.

Tests in `src/drivers/pvvx/command-channel.test.ts` mit `FakePvvxDevice` und echten Timern:

1. Antwort auf `55` kommt an.
2. Eine vorher gesendete `33`-Notification wird übersprungen, die Antwort kommt trotzdem.
3. Kein Antwort (`silentCommands: [0x55]`), Timeout 50 ms → `TIMEOUT`.
4. Geschrieben wird mit `withResponse === PVVX_WRITE_WITH_RESPONSE`.
5. Zwei gleichzeitige `request` → der zweite lehnt mit `GATT_ERROR` ab, der erste kommt an.
6. `failWrite` → derselbe Fehler, kein offener Timer (prüfe mit Fake-Timern, dass `clearTimeout` aufgerufen wurde).

### B4. Ablauf eines Zeitsyncs

Neue Datei `src/drivers/pvvx/time-sync.ts`:

```ts
export interface Clock {
	/** Current time in ms */
	now(): number;
	/** Minutes as Date.prototype.getTimezoneOffset() returns them, for the given time */
	timezoneOffset(atMs: number): number;
}
export const systemClock: Clock; // Date.now() and new Date(atMs).getTimezoneOffset()

export interface TimeSyncResult {
	version: number;
	hardwareId?: number;
	/** Seconds the device clock was ahead before it was set */
	deviation: number;
	/** The value that was set */
	value: number;
}

/** Thrown when the device does not answer like a pvvx firmware */
export class PvvxProtocolError extends Error {
	public readonly code = "UNEXPECTED_ANSWER";
}

export async function syncTime(channel: PvvxCommandChannel, clock: Clock): Promise<TimeSyncResult>;
```

Ablauf, genau in dieser Reihenfolge:

1. `request(encodeConfigRequest())` → `parseConfigResponse`. `undefined` → `PvvxProtocolError("The device did not answer like a pvvx firmware")`.
2. `request(encodeTimeRequest())` → `parseTimeResponse`. `undefined` → `PvvxProtocolError("Invalid answer to reading the time")`. Sofort danach `now = clock.now()` und `deviation = clockDeviation(clock, localClockValue(now, clock.timezoneOffset(now)))`.
3. Neu `now = clock.now()`, `value = localClockValue(now, clock.timezoneOffset(now))`, `request(encodeTimeRequest(value))` → `parseTimeResponse`. `undefined` oder `|clockDeviation(antwort.clock, value)| > 2` → `PvvxProtocolError("The device did not take the time")`.
4. Ergebnis zurückgeben.

Tests in `src/drivers/pvvx/time-sync.test.ts` mit `FakePvvxDevice`, `PvvxCommandChannel` und einer Fake-Uhr (`now` fest, `timezoneOffset` liefert `-120`):

1. Erfolg: die drei Writes sind genau `55`, `23`, `23` + Wert. Der Wert ist `localClockValue(now, -120)`. Das Gerät hat danach diesen Wert als `clock`. Ergebnis hat `version 0x59`, `hardwareId 0`.
2. Abweichung: Gerät steht auf `wert - 3600` → `deviation === -3600`. Gerät steht auf `wert + 5` → `5`.
3. Antwort auf `55` mit Byte 0 = `0x55`, aber nur 3 Bytes → `PvvxProtocolError`, `23` wurde nicht geschrieben.
4. Gerät antwortet auf `23` mit 9 Bytes (`timeAdjust: true`) → funktioniert gleich.
5. Gerät übernimmt die Zeit nicht (`ignoreSetTime: true`, alter Wert weit vom neuen entfernt) → `PvvxProtocolError`.
6. Die Zeitzone kommt aus `clock.timezoneOffset(now)`: Fake-Uhr mit `-60` ergibt einen um 3600 kleineren Wert als mit `-120`.

### B5. Liste der Geräte

In `src/drivers/pvvx/pvvx-driver.ts` (wird in B6 fertig) zuerst:

```ts
/** Parses the setting pvvxDevices. Invalid entries are returned separately, duplicates are removed. */
export function parseDeviceList(setting: unknown): { addresses: string[]; invalid: string[] };
```

Regeln: Kein String → leer. Trennen an `/[\s,;]+/`, leere Teile verwerfen, jeden Teil mit `normalizeAddress()` prüfen. Reihenfolge der ersten Nennung bleibt.

Tests in `src/drivers/pvvx/pvvx-driver.test.ts`: gemischte Trenner und Groß-/Kleinschreibung; Bindestrich-Schreibweise; Duplikat; ungültiger Eintrag landet in `invalid`; `undefined` und `""` → leer.

### B6. Der Driver

`src/drivers/pvvx/pvvx-driver.ts`, Klasse `PvvxDriver`.

```ts
export interface PvvxDriverContext {
	adapter: Pick<ioBroker.Adapter, "namespace" | "log" | "setObjectNotExistsAsync" | "setStateAsync">;
	connections: Pick<ConnectionManager, "withSession">;
	clock: Clock;
	setTimeout(cb: () => void, ms: number): unknown;
	clearTimeout(t: any): void;
	setInterval(cb: () => void, ms: number): unknown;
	clearInterval(t: any): void;
}

export interface PvvxDriverOptions {
	addresses: string[];
	/** Hours, 0 = no periodic sync */
	syncIntervalHours: number;
}

export class PvvxDriver {
	public constructor(ctx: PvvxDriverContext, options: PvvxDriverOptions);
	/** Creates the objects and starts the timer. Does nothing without addresses. */
	public start(): Promise<void>;
	/** Runs all syncs that are due. Called by the timer, public for tests. Resolves when they are done. */
	public tick(): Promise<void>;
	/** Handles the button. Returns true if the state belongs to this driver. */
	public handleStateChange(id: string, state: ioBroker.State | null | undefined): boolean;
	public dispose(): void;
}
```

Konstanten im Modul (exportiert, damit Tests sie benutzen können):

| Name | Wert | Bedeutung |
|---|---|---|
| `TICK_INTERVAL_MS` | 60000 | Abstand der Prüfungen |
| `START_DELAY_MS` | 60000 | Erster Sync nach dem Start, damit Gateways sich melden und Geräte empfangen werden |
| `RETRY_DELAYS_MS` | `[5, 15, 60]` Minuten in ms | Wiederholungen nach Fehlern |
| `FALLBACK_INTERVAL_MS` | 24 h | Nach dem letzten Wiederholversuch, wenn `syncIntervalHours` 0 ist |
| `SESSION_TIMEOUT_MS` | 45000 | `timeoutMs` für `withSession` |

**Zustand pro Gerät:** `nextDue` (ms), `failures` (Zahl aufeinanderfolgender Fehler), `running` (boolean).

**`start()`:**

1. Ohne Adressen: sofort zurück.
2. Für jedes Gerät: Device-Objekt `<mac>` mit `setObjectNotExistsAsync` (`type: "device"`, `common.name` = Adresse, `native.address` = Adresse), dann den Channel und die States aus Abschnitt 2 mit `setObjectNotExistsAsync`. Bestehende Objekte werden nicht verändert.
3. `nextDue = clock.now() + START_DELAY_MS` für jedes Gerät, `failures = 0`.
4. `lastOffset = clock.timezoneOffset(clock.now())` merken.
5. `setInterval(() => void this.tick(), TICK_INTERVAL_MS)`.
6. Log `info`: `"pvvx time sync for <n> devices"`.

**`tick()`:**

1. Läuft schon ein `tick`, sofort zurück (Merker).
2. `now = clock.now()`. Weicht `clock.timezoneOffset(now)` von `lastOffset` ab: neuen Wert merken, Log `info` `"The UTC offset changed, setting the clock of all pvvx devices"`, für alle Geräte `nextDue = now` und `failures = 0`.
3. Fällige Geräte (`nextDue <= now`), aufsteigend nach `nextDue`, **nacheinander** abarbeiten (immer nur ein Sync gleichzeitig, wegen der wenigen Verbindungsplätze der Proxies). Nach `dispose()` sofort aufhören.
4. Ein Sync:

    ```ts
    const result = await ctx.connections.withSession(address, async (session) => {
    	const channel = new PvvxCommandChannel(session, ctx);
    	await channel.open();
    	return syncTime(channel, ctx.clock);
    }, { timeoutMs: SESSION_TIMEOUT_MS });
    ```

5. **Erfolg:**
    - States schreiben (alle mit `ack: true`): `lastTimeSync` = `clock.now()`, `timeDeviation` = `result.deviation`, `firmwareVersion` = `formatVersion(result.version)`, `hardwareId` nur wenn vorhanden, `lastError` = `""`.
    - `failures = 0`.
    - `nextDue = now + syncIntervalHours × 3600000`, bei `0` → `Infinity`.
    - Log `info`: `"Set the clock of <mac>, it was <deviation> s off"`.
6. **Fehler:**
    - `failures++`. Ist `failures <= RETRY_DELAYS_MS.length`: `nextDue = now + RETRY_DELAYS_MS[failures - 1]`. Sonst: `nextDue = now + (syncIntervalHours × 3600000 || FALLBACK_INTERVAL_MS)` und `failures = 0`.
    - `lastError` = `"<code>: <message>"`. `code` ist `error.code`, wenn der Fehler eines hat (`GatewayError`, `PvvxProtocolError`), sonst `"ERROR"`.
    - Log: `info` bei `failures` 1 und 2, `warn` beim dritten Fehler in Folge, jeweils mit Adresse und `lastError`.
    - Ein Fehler darf `tick()` nie abbrechen: das nächste fällige Gerät kommt trotzdem dran.
7. Fehler beim Schreiben der States: mit `log.warn` protokollieren, nicht weiterwerfen.

**`handleStateChange(id, state)`:**

1. Gehört `id` nicht zu `<namespace>.<mac>.pvvx.syncTime` eines konfigurierten Geräts → `false`.
2. `state` fehlt, `state.ack === true` oder Wert nicht wahr → `true` zurück, sonst nichts.
3. `setStateAsync(id, false, true)` (Fehler ignorieren), für dieses Gerät `nextDue = 0`, `failures = 0`, `void this.tick()`. Läuft gerade ein `tick`, kommt das Gerät beim nächsten dran (höchstens 60 s). → `true`.

**`dispose()`:** Intervall löschen, Merker setzen, danach keine States mehr schreiben. Ein laufender Sync wird nicht abgewartet (den bricht `ConnectionManager.dispose()` ab).

Tests in `src/drivers/pvvx/pvvx-driver.test.ts`. Kein echter Timer: Fake-Kontext, dessen `setInterval` den Callback nur speichert, Fake-Uhr mit einstellbarem `now` und `timezoneOffset`, Fake-`connections`, dessen `withSession` pro Adresse ein einstellbares Ergebnis liefert (Erfolg mit `FakePvvxDevice`-Session oder `GatewayError`). Rufe `tick()` direkt auf.

1. Leere Liste: `start()` legt nichts an und registriert kein Intervall.
2. `start()` legt Device, Channel und alle sieben States an, `syncTime` mit `write: true, read: false`.
3. Vor Ablauf von `START_DELAY_MS` wird nicht verbunden, danach schon.
4. Erfolg schreibt alle States mit den Werten aus dem Ergebnis und `lastError: ""`.
5. Nächster Sync erst nach `syncIntervalHours`. Mit `0` nie wieder (außer Knopf und Zeitumstellung).
6. Fehler: Wiederholungen nach 5, 15 und 60 Minuten, danach im Intervall; `lastError` hat die Form `"NO_GATEWAY: …"`; Log `warn` genau beim dritten Fehler.
7. `syncIntervalHours: 0` und drei Fehler → nächster Versuch nach 24 h.
8. Zeitumstellung: Fake-Uhr ändert den Offset von `-120` auf `-60` → beim nächsten `tick()` werden alle Geräte gestellt, auch solche mit `nextDue` weit in der Zukunft und solche mit laufenden Wiederholungen.
9. Geräte laufen nacheinander: Zwei fällige Geräte, `withSession` für das erste wird erst aufgelöst, wenn der Test es sagt → das zweite startet erst danach.
10. Ein Fehler beim ersten Gerät verhindert den Sync des zweiten nicht.
11. Knopf: `handleStateChange` mit `ack: false, val: true` → `true`, Gerät sofort gestellt, State quittiert (`false`, `ack: true`). Mit `ack: true` → `true`, nichts passiert. Fremde ID → `false`.
12. Ein zweiter `tick()`, während einer läuft, tut nichts.
13. Nach `dispose()` schreibt ein noch laufender Sync keine States mehr.

### B7. Einbau in den Adapter

**Einstellungen:**

- `io-package.json`, `native`: `"pvvxDevices": ""`, `"pvvxSyncInterval": 24`.
- `src/lib/adapter-config.d.ts`: beide als optional, mit Kommentar.
- `admin/src/index.tsx`: ein mehrzeiliges Textfeld „pvvx thermometers (MAC addresses)“ mit Hilfetext und ein Zahlenfeld „Time sync interval [h]“ (`min: 0`). Aufbau wie die bestehenden Felder `services` und `rssiThrottle`. Texte in allen 10 Dateien unter `admin/src/i18n/`.

    Hilfetexte (englisch):
    - `"The clock of these devices is set to the local time: at start, in this interval, after each change between summer and winter time, and with the button pvvx.syncTime. Needs a gateway that can connect, e.g. an ESPHome Bluetooth proxy."`
    - `"0 = only at start, after a time change and with the button."`

**`src/main.ts`:**

1. Nach dem Anlegen des `ConnectionManager`: `parseDeviceList(adapter.config.pvvxDevices)`. Für jeden ungültigen Eintrag `log.warn("Ignoring the invalid pvvx device address \"<eintrag>\"")`.
2. `syncIntervalHours`: `adapter.config.pvvxSyncInterval`, wenn eine Zahl ≥ 0, sonst `24`.
3. `new PvvxDriver({ adapter, connections, clock: systemClock, setTimeout: …, clearTimeout: …, setInterval: …, clearInterval: … }, { addresses, syncIntervalHours })`. Timer über die Adapter-Methoden (`adapter.setTimeout` usw.), wie im übrigen Code. Prüfe, ob `@iobroker/adapter-core` 3 sie hat; wenn nicht, die globalen Funktionen.
4. `await pvvx.start()` als letzter Schritt von `ready`, nach dem Start der Transporte.
5. `stateChange`: `if (pvvx?.handleStateChange(id, state)) return;` vor dem Aufruf von `remoteGateway?.handleStateChange`.
6. `unload`: `pvvx?.dispose()` als Erstes, vor `connections.dispose()`.

### B8. Integrationstests

Erweitere `test/integrationTests/fakeGattGateway.js` (aus Phase 2, B9):

1. `properties` der Characteristic `0x1f1f` von `0x1a` auf `0x16` ändern (Read, Write Without Response, Notify, wie die echte Firmware). Die Tests von Phase 2 müssen danach unverändert bestehen.
2. Neue Methode `setWriteHandler(handler)`. `handler(address, handle, dataHex)` liefert ein Array von Hex-Strings oder `undefined`. Nach dem Beantworten von `gatt:write` schickt der Fake jede zurückgelieferte Payload als Notification an `ble.0`, **nur** wenn für diese Verbindung vorher `gatt:subscribe` auf dieses Handle kam:

    ```js
    client.push("system.adapter.ble.0", {
    	command: "gateway:notification",
    	message: { gatewayId, address, handle, data: <Base64> },
    	from: "system.adapter.test.0",
    });
    ```

    (ohne `callback`).

Neue Datei `test/integrationTests/fakePvvxThermometer.js`: eine Funktion `createPvvxHandler(options)`, die einen Write-Handler für `setWriteHandler` baut und dasselbe Verhalten hat wie `FakePvvxDevice` aus B2 (Konfiguration, Zeit lesen, Zeit setzen, unbekannter Befehl). Sie hält `clock` und alle Writes fest.

`test/integrationTests/helpers.js`: `startAdapter(harness, native, env)` bekommt einen dritten Parameter `env` (Standard `{}`) und reicht ihn an `harness.startAdapterAndWait(false, env)` durch.

Neue Datei `test/integrationTests/pvvx_time_sync_tests.js`, in `index.js` registrieren. Alle Suiten starten den Adapter mit `env: { TZ: "Etc/GMT-3" }`. Das ist eine feste Zeitzone **UTC+3 ohne Sommerzeit** (das Vorzeichen ist in POSIX umgekehrt). Der erwartete Wert ist damit `Math.floor(Date.now() / 1000) + 10800`, unabhängig von der Zeitzone des Testprozesses. Die Sommerzeit ist durch die Unit-Tests abgedeckt.

Adresse des Thermometers: `a4:c1:38:12:34:56`. Vorbereitung jeder Suite: `announce` für `proxy-og` mit `connect: true, freeSlots: 3, slotLimit: 3`, dann `deliver()` eines Advertisements des Thermometers über `proxy-og`.

Suite `pvvx - setting the clock` (Konfiguration `{ plugins: "bthome", pvvxDevices: "A4:C1:38:12:34:56", pvvxSyncInterval: 24 }`):

1. `creates the states of a configured device`: alle sieben Objekte existieren, `lastError` hat noch keinen Wert, es kam noch kein `gatt:connect` (Start-Verzögerung).
2. `sets the clock when the button is pressed`: Gerät steht auf `erwartet − 3600`. `syncTime` auf `true` (`ack: false`) setzen. Dann:
    - Die Writes an Handle 32 sind in dieser Reihenfolge `55`, `23` und `23` + 4 Bytes. Alle mit `withResponse: false`.
    - Der gesetzte Wert liegt höchstens 2 s neben `Math.floor(Date.now() / 1000) + 10800`.
    - `timeDeviation` ist `−3600` (± 2), `firmwareVersion` ist `"5.9"`, `hardwareId` ist `0`, `lastError` ist `""`, `lastTimeSync` liegt höchstens 30 s zurück.
    - `syncTime` ist danach `false` mit `ack: true`.
    - Die Verbindung wurde mit `gatt:disconnect` beendet.
3. `skips measurements the device sends in between`: Handler so einstellen, dass er vor jeder Antwort zusätzlich `33 0b 0c 2e 09 f4 13 64` zurückgibt. Knopf → Erfolg wie in 2.
4. `reports a device that does not answer like a pvvx firmware`: Handler antwortet auf `55` mit `55 ff`. Knopf → `lastError` beginnt mit `"UNEXPECTED_ANSWER: "`, `23` wurde nicht geschrieben.

Suite `pvvx - device not reachable` (Konfiguration wie oben, aber das Thermometer wird nur über ein Gateway geliefert, das **kein** `announce` gemacht hat):

1. `reports that no gateway can connect`: Knopf → `lastError` beginnt mit `"NO_GATEWAY: "`, kein `gatt:connect`.

Suite `pvvx - invalid configuration` (Konfiguration `{ plugins: "bthome", pvvxDevices: "a4:c1:38:12:34:56, not-a-mac" }`):

1. `ignores invalid addresses and keeps running`: Objekte für `a4:c1:38:12:34:56` existieren, der Adapter läuft.

Suite `pvvx - no devices configured` (Standardkonfiguration):

1. `creates no pvvx objects`: Keine Objekte mit `.pvvx` in der ID.

---

## 4. Dokumentation

- `README.md`: Neuer Abschnitt „Setting the clock of pvvx thermometers“ nach „Receiving advertisements from other adapters“. Inhalt: wozu, die zwei Einstellungen, die States, dass ein Gateway mit Verbindungen nötig ist (ESPHome-Proxy mit `bluetooth_proxy: active: true`), dass Geräte mit PIN-Code nicht gehen, dass die Uhr die lokale Zeit des ioBroker-Hosts bekommt. Changelog-Zeile.
- `AGENTS.md`: `src/drivers/pvvx/` im Abschnitt „Layout“ eintragen.
- `docs/plan-bluetooth-infrastructure.md`: nur die Statuszeile, die Statustabelle und die Zeile von Phase 3 in Abschnitt 7.

Fertig, wenn alle Befehle aus `AGENTS.md` (Abschnitt „Commands“) bestehen und `build/` neu gebaut und eingecheckt ist.

## 5. Abschlussbericht

Schreibe am Ende in deiner Antwort (nicht in eine Datei):

- welche Schritte umgesetzt sind, mit der Zahl der bestandenen und fehlgeschlagenen Tests (Unit und Integration),
- jede Abweichung von diesem Dokument, mit Grund,
- was nicht an Hardware geprüft ist. Das ist mindestens: der ganze Ablauf mit einem echten Thermometer über einen echten Proxy, und ob `withResponse: false` dort funktioniert (`docs/pvvx-protocol.md`, 9.1).
