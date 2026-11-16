# Spezifikation Phase 2: GATT-Verbindungen über Gateways

Stand 2026-11-17 · gehört zu `docs/plan-bluetooth-infrastructure.md` (Phase 2 in Abschnitt 7)

Dieses Dokument ist die verbindliche Arbeitsanweisung für Phase 2. Es ist so geschrieben, dass du es von oben nach unten abarbeiten kannst. Wo es eine Frage nicht beantwortet, hör auf und frag nach. Rate nicht.

Lies vorher `AGENTS.md` in diesem Repo und, für Teil C, `AGENTS.md` in `ioBroker.esphome`.

---

## 1. Ziel und Abgrenzung

### Ziel

`ble` kann über ein Gateway eines anderen Adapters eine Verbindung zu einem BLE-Gerät aufbauen, Characteristics lesen und schreiben und Notifications empfangen. Das erste Gateway ist ein ESPHome-Bluetooth-Proxy, angebunden über `ioBroker.esphome`.

Abnahme am Ende der Phase:

1. `sendTo("ble.0", "readCharacteristic", { address, service, characteristic })` liefert den Wert einer Characteristic eines Geräts, das nur ein entfernter Proxy erreicht.
2. Zwei gleichzeitige Anfragen an dasselbe Gerät laufen nacheinander, nicht parallel.
3. Stoppt `ble` während einer offenen Verbindung, trennt `esphome` sie am Proxy.

### Zwei Repos

| Teil | Repo | Branch |
|---|---|---|
| A (Protokoll) und B (`ble`) | `SimonFischer04/ioBroker.ble` | der Branch, auf dem dieses Dokument liegt |
| C (`esphome`) | `DrozmotiX/ioBroker.esphome` | `ccr-ble-gateway-forwarding` (basiert auf `v2`), dort weiterarbeiten |

Arbeite zuerst Teil A und B komplett ab, dann Teil C. Teil B ist ohne Teil C vollständig testbar.

### Nicht Teil dieser Phase

Baue nichts davon, auch nicht „schon mal vorbereitend“:

- Geräte-Driver (pvvx-Zeitsync, Firmware-Update). Das sind Phase 3 und 4.
- `gatt:writeSequence` (Phase 4).
- Lesen und Schreiben von Descriptors als eigene Befehle.
- Eine Session-API für andere Adapter mit `connect`/`disconnect` und Leases (Phase 5). In Phase 2 gibt es nur die drei Einzelbefehle aus B7.
- GATT über den lokalen Bluetooth-Adapter (`noble`). Das lokale Gateway kann in Phase 2 keine Verbindungen.
- Änderungen an den Decoder-Plugins und an der Admin-UI.

---

## 2. Begriffe

| Begriff | Bedeutung |
|---|---|
| Lieferant | Adapter-Instanz, die Gateways bereitstellt, zum Beispiel `esphome.0` |
| Gateway | Ein Empfänger, zum Beispiel ein ESP32-Proxy. Lokale ID beim Lieferanten: `proxy-og`. Volle ID in `ble`: `esphome.0:proxy-og` |
| Link | Eine offene GATT-Verbindung zu einem BLE-Gerät über genau ein Gateway |
| Session | Die Nutzung eines Links durch genau einen Auftraggeber in `ble`, vom Verbinden bis zum Trennen |
| Handle | Nummer einer Characteristic oder eines Descriptors auf dem Gerät. Über die Leitung gehen immer Handles, nie UUIDs |
| Kanonische UUID | 128 Bit, Kleinbuchstaben, mit Bindestrichen: `00001f10-0000-1000-8000-00805f9b34fb` |

---

## Teil A: Protokoll (`ble-gateway/1`, Stufe 2)

Alle Befehle laufen über `sendTo`. Jede Antwort hat die Form `{ error: null, result }` oder `{ error: { code, message } }`. Das gilt in beide Richtungen.

### A1. Befehle des Lieferanten an `ble`

| Befehl | Payload | Antwort |
|---|---|---|
| `gateway:advertisements` | unverändert, siehe `gateway-protocol.ts` | unverändert |
| `gateway:announce` | `GatewayAnnounceMessage` | `GatewayAnnounceResult` |
| `gateway:connectionState` | `GatewayConnectionStateMessage` | keine (ohne Callback gesendet) |
| `gateway:notification` | `GatewayNotificationMessage` | keine (ohne Callback gesendet) |

Regeln für `gateway:announce`:

1. Der Lieferant sendet es, sobald ein Gateway bereit ist, bei jeder Änderung von `freeSlots` und zusätzlich alle 30 s. Es enthält immer **alle** seine aktuell erreichbaren Gateways.
2. `protocol` muss exakt `"ble-gateway/1"` sein. Sonst antwortet `ble` mit dem Fehler `UNSUPPORTED_PROTOCOL` und übernimmt nichts.
3. Jedes gemeldete Gateway zählt als Lebenszeichen, genau wie ein Batch Advertisements: Es wird angelegt, falls unbekannt, und als online geführt.
4. `connect: true` heißt: Über dieses Gateway kann `ble` Verbindungen aufbauen.
5. Die Antwort enthält `epoch`: den Zeitpunkt (`Date.now()`), zu dem `ble` gestartet ist. Er bleibt bis zum nächsten Start gleich.

Regeln für `gateway:connectionState`:

1. Der Lieferant sendet es **nur**, wenn eine bestehende Verbindung endet, ohne dass `ble` sie mit `gatt:disconnect` beendet hat. `connected` ist dann immer `false`.
2. Kennt `ble` keinen offenen Link zu `gatewayId` und `address`, ignoriert es die Nachricht.

### A2. Befehle von `ble` an den Lieferanten

`ble` schickt sie an die Instanz, die das Gateway gemeldet hat. `gatewayId` ist dabei die **lokale** ID (`proxy-og`), nicht die volle.

| Befehl | Payload | `result` | Timeout in `ble` |
|---|---|---|---|
| `gatt:connect` | `GattConnectRequest` | `GattConnectResult` | 25 s |
| `gatt:disconnect` | `GattTarget` | `{}` | 10 s |
| `gatt:getServices` | `GattTarget` | `GattGetServicesResult` | 15 s |
| `gatt:read` | `GattReadRequest` | `GattReadResult` | 10 s |
| `gatt:write` | `GattWriteRequest` | `{}` | 10 s |
| `gatt:subscribe` | `GattSubscribeRequest` | `{}` | 10 s |

Regeln:

1. Alle Befehle außer `gatt:connect` setzen eine offene Verbindung voraus. Ohne sie antwortet der Lieferant mit `NOT_CONNECTED`.
2. `gatt:subscribe` schaltet Notifications (oder Indications) für eine Characteristic ein. Der Lieferant ist dafür zuständig, dass sie wirklich ankommen, also auch für den CCCD-Descriptor, falls sein Gateway das verlangt. Ausschalten gibt es nicht, das Abo endet mit der Verbindung.
3. `gatt:write` mit `withResponse: false` wird beantwortet, sobald der Schreibbefehl ans Gateway abgeschickt ist.
4. Daten (`data`) sind immer Base64.
5. UUIDs in `GattGetServicesResult` sind immer kanonisch (siehe Abschnitt 2).
6. `epoch` in `gatt:connect`: Der Lieferant merkt sich den zuletzt gesehenen Wert. Sieht er einen anderen Wert als den gemerkten, wurde `ble` neu gestartet. Dann trennt er zuerst alle Verbindungen, die er für `ble` offen hat, und bearbeitet erst danach die Anfrage. Dasselbe gilt für `epoch` aus der Antwort auf `gateway:announce`.

### A3. Fehlercodes

| Code | Bedeutung | Wer erzeugt ihn |
|---|---|---|
| `INVALID_PAYLOAD` | Die Nachricht hat nicht die verlangte Form | beide |
| `UNSUPPORTED_PROTOCOL` | `protocol` in `gateway:announce` ist unbekannt | `ble` |
| `UNKNOWN_GATEWAY` | Der Lieferant kennt `gatewayId` nicht oder das Gateway ist offline | Lieferant |
| `NO_FREE_SLOT` | Das Gateway hat keinen freien Verbindungsplatz | Lieferant |
| `CONNECT_FAILED` | Der Verbindungsaufbau ist fehlgeschlagen | Lieferant |
| `NOT_CONNECTED` | Es gibt keine Verbindung (mehr) zu diesem Gerät | beide |
| `GATT_ERROR` | Das Gerät oder das Gateway hat die Operation abgelehnt, oder eine Characteristic wurde nicht gefunden | beide |
| `TIMEOUT` | Keine Antwort in der vorgesehenen Zeit | beide |
| `NO_GATEWAY` | Kein verbindungsfähiges Gateway empfängt das Gerät | `ble` |

### A4. Typen

Ergänze `src/lib/gateway-protocol.ts` um genau diese Definitionen. Bestehende Definitionen bleiben, wie sie sind, bis auf die zwei gekennzeichneten Erweiterungen. Die Datei bekommt weiterhin keine Imports.

```ts
// --- in GatewayCommands ergänzen ---
export const GatewayCommands = {
	advertisements: "gateway:advertisements",
	/** Announces the gateways of an instance and what they can do */
	announce: "gateway:announce",
	/** Reports that a connection ended without being asked to */
	connectionState: "gateway:connectionState",
	/** Delivers a notification of a subscribed characteristic */
	notification: "gateway:notification",
	getGateways: "getGateways",
	getDevices: "getDevices",
	/** Lists the services of a device */
	discoverServices: "discoverServices",
	/** Reads a characteristic of a device */
	readCharacteristic: "readCharacteristic",
	/** Writes a characteristic of a device */
	writeCharacteristic: "writeCharacteristic",
} as const;

/** The commands this adapter sends to the instance that announced a gateway */
export const GattCommands = {
	connect: "gatt:connect",
	disconnect: "gatt:disconnect",
	getServices: "gatt:getServices",
	read: "gatt:read",
	write: "gatt:write",
	subscribe: "gatt:subscribe",
} as const;

/** A gateway in "gateway:announce" */
export interface GatewayAnnouncement {
	/** Identifies the gateway within the sending instance, same rules as in "gateway:advertisements" */
	gatewayId: string;
	/** Whether connections to devices can be opened through this gateway */
	connect: boolean;
	/** How many more connections the gateway can open right now. Omit if unknown. */
	freeSlots?: number;
	/** How many connections the gateway can have at the same time. Omit if unknown. */
	slotLimit?: number;
}

/** Payload of "gateway:announce" */
export interface GatewayAnnounceMessage {
	/** Must be GATEWAY_PROTOCOL */
	protocol: string;
	/** All gateways of the sending instance that are reachable right now, at most 100 */
	gateways: GatewayAnnouncement[];
}

/** Result of "gateway:announce" */
export interface GatewayAnnounceResult {
	protocol: typeof GATEWAY_PROTOCOL;
	/** When this adapter was started (ms since 1970). A new value means it was restarted. */
	epoch: number;
}

/** Identifies a device behind a gateway. gatewayId is the ID within the instance that owns the gateway. */
export interface GattTarget {
	gatewayId: string;
	/** MAC address in lowercase with colons */
	address: string;
}

/** Payload of "gateway:connectionState" */
export interface GatewayConnectionStateMessage extends GattTarget {
	connected: false;
	/** Error code of the gateway, if it reported one */
	error?: number;
}

/** Payload of "gateway:notification" */
export interface GatewayNotificationMessage extends GattTarget {
	/** Handle of the characteristic */
	handle: number;
	/** The value, base64 encoded */
	data: string;
}

/** Payload of "gatt:connect" */
export interface GattConnectRequest extends GattTarget {
	addressType: "public" | "random";
	/** See GatewayAnnounceResult.epoch */
	epoch: number;
}

/** Result of "gatt:connect" */
export interface GattConnectResult {
	/** Negotiated MTU. 23 if the gateway does not report one. */
	mtu: number;
}

export interface GattDescriptorInfo {
	/** 128 bit, lowercase, with dashes */
	uuid: string;
	handle: number;
}

export interface GattCharacteristicInfo {
	/** 128 bit, lowercase, with dashes */
	uuid: string;
	handle: number;
	/** Bit mask: 0x02 read, 0x04 write without response, 0x08 write, 0x10 notify, 0x20 indicate */
	properties: number;
	descriptors: GattDescriptorInfo[];
}

export interface GattServiceInfo {
	/** 128 bit, lowercase, with dashes */
	uuid: string;
	handle: number;
	characteristics: GattCharacteristicInfo[];
}

/** Result of "gatt:getServices" and of "discoverServices" */
export interface GattGetServicesResult {
	services: GattServiceInfo[];
}

/** Payload of "gatt:read" and "gatt:subscribe" */
export interface GattReadRequest extends GattTarget {
	/** Handle of the characteristic */
	handle: number;
}
export type GattSubscribeRequest = GattReadRequest;

/** Result of "gatt:read" and of "readCharacteristic" */
export interface GattReadResult {
	/** The value, base64 encoded */
	data: string;
}

/** Payload of "gatt:write" */
export interface GattWriteRequest extends GattTarget {
	/** Handle of the characteristic */
	handle: number;
	/** The value, base64 encoded */
	data: string;
	/** true = wait for the device to confirm the write */
	withResponse: boolean;
}

/** Payload of "discoverServices" */
export interface DiscoverServicesMessage {
	/** MAC address of the device, upper case and "-" are accepted */
	address: string;
}

/** Payload of "readCharacteristic" */
export interface ReadCharacteristicMessage extends DiscoverServicesMessage {
	/** UUID of the service: "1f10", "0x1f10" or the full UUID with or without dashes */
	service: string;
	/** UUID of the characteristic, same forms */
	characteristic: string;
}

/** Payload of "writeCharacteristic" */
export interface WriteCharacteristicMessage extends ReadCharacteristicMessage {
	/** The value, base64 encoded */
	data: string;
	/** Defaults to true */
	withResponse?: boolean;
}

// --- GatewayInfo erweitern (drei neue Felder am Ende) ---
//	/** Whether connections to devices can be opened through this gateway */
//	connect: boolean;
//	/** Free connection slots, if the gateway reported them */
//	freeSlots?: number;
//	/** Maximum number of connections, if the gateway reported it */
//	slotLimit?: number;

// --- GatewayErrorCode ersetzen ---
export type GatewayErrorCode =
	| "INVALID_PAYLOAD"
	| "UNSUPPORTED_PROTOCOL"
	| "UNKNOWN_GATEWAY"
	| "NO_FREE_SLOT"
	| "CONNECT_FAILED"
	| "NOT_CONNECTED"
	| "GATT_ERROR"
	| "TIMEOUT"
	| "NO_GATEWAY";
```

Ergänze außerdem den Kommentar am Anfang der Datei um einen Absatz, der die Befehle aus A1 und A2 in zwei Sätzen nennt.

---

## Teil B: Umsetzung in `ioBroker.ble`

Reihenfolge: B1 bis B9. Nach jedem Schritt müssen die dort genannten Tests bestehen und `npm run check` sowie `npm run lint` sauber sein. Mach nach jedem Schritt einen Commit.

### B1. Protokoll-Typen

Datei: `src/lib/gateway-protocol.ts`. Setze A4 um.

`GatewayInfo.connect` ist ein Pflichtfeld. Dadurch meldet `tsc` Fehler in `src/gateways/gateway-registry.ts`. Behebe sie so: `getOrCreate()` setzt `connect: false`. Mehr ändert sich in diesem Schritt nicht.

Fertig, wenn: `npm run check` sauber ist und alle bestehenden Tests bestehen.

### B2. UUIDs normalisieren

Neue Datei `src/lib/uuid.ts`:

```ts
/** The canonical form of a UUID: 128 bit, lowercase, with dashes. undefined if the input is not a UUID. */
export function normalizeUuid(uuid: unknown): string | undefined;
```

Regeln, in dieser Reihenfolge:

1. Kein String → `undefined`.
2. Leerzeichen am Rand entfernen, in Kleinbuchstaben wandeln, ein führendes `0x` entfernen.
3. Genau 4 Hex-Zeichen → `0000xxxx-0000-1000-8000-00805f9b34fb`.
4. Genau 8 Hex-Zeichen → `xxxxxxxx-0000-1000-8000-00805f9b34fb`.
5. Genau 32 Hex-Zeichen → Bindestriche nach den Zeichen 8, 12, 16 und 20 einfügen.
6. Form `8-4-4-4-12` aus Hex-Zeichen → unverändert zurückgeben.
7. Alles andere → `undefined`.

Tests in `src/lib/uuid.test.ts`:

| Eingabe | Ergebnis |
|---|---|
| `"1f10"`, `"1F10"`, `"0x1f10"`, `" 1f10 "` | `"00001f10-0000-1000-8000-00805f9b34fb"` |
| `"0000fcd2"` | `"0000fcd2-0000-1000-8000-00805f9b34fb"` |
| `"00001f1000001000800000805f9b34fb"` | `"00001f10-0000-1000-8000-00805f9b34fb"` |
| `"00001F10-0000-1000-8000-00805F9B34FB"` | `"00001f10-0000-1000-8000-00805f9b34fb"` |
| `""`, `"1f1"`, `"xyz1"`, `"1f10-0000"`, `undefined`, `0x1f10` (Zahl) | `undefined` |

### B3. Fehlerklasse und Anfrage mit Timeout

Neue Datei `src/lib/gateway-error.ts`:

```ts
import type { GatewayErrorCode, GatewayResponse } from "./gateway-protocol";

/** An error with one of the codes of the gateway interface */
export class GatewayError extends Error {
	public constructor(public readonly code: GatewayErrorCode, message: string);
}

/** The answer to send for an error. Anything that is not a GatewayError becomes GATT_ERROR. */
export function toErrorResponse(error: unknown): GatewayResponse<never>;
```

`toErrorResponse(new GatewayError("TIMEOUT", "x"))` ergibt `{ error: { code: "TIMEOUT", message: "x" } }`. `toErrorResponse(new Error("boom"))` ergibt `{ error: { code: "GATT_ERROR", message: "boom" } }`.

Neue Datei `src/lib/send-request.ts`:

```ts
/** What sendRequest needs from the adapter */
export interface RequestSender {
	sendTo(instance: string, command: string, message: unknown, callback: (response: unknown) => void): void;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(timer: any): void;
}

/**
 * Sends a command to another instance and resolves with the `result` of its answer.
 * Rejects with a GatewayError: the error of the answer, TIMEOUT if none arrived in time,
 * GATT_ERROR if the answer has an unknown form.
 */
export function sendRequest<T>(
	adapter: RequestSender,
	instance: string,
	command: string,
	message: unknown,
	timeoutMs: number,
): Promise<T>;
```

Regeln:

1. Der Timer läuft über `adapter.setTimeout`, nicht über das globale `setTimeout`.
2. Das Promise wird genau einmal erfüllt oder abgelehnt. Eine Antwort nach dem Timeout wird ignoriert.
3. Antwort `{ error: null, result }` → mit `result` erfüllen.
4. Antwort `{ error: { code, message } }` mit String-`code` → mit `new GatewayError(code, message)` ablehnen.
5. Jede andere Antwort (auch `undefined`, ein `Error`-Objekt oder `{ error: "Unknown command!" }`) → `GatewayError("GATT_ERROR", "Unexpected answer to <command>")`.
6. Wirft `adapter.sendTo`, wird mit `GatewayError("GATT_ERROR", <Meldung>)` abgelehnt.

Tests in `src/lib/send-request.test.ts` mit einem Fake-Adapter, der Callback und Timer festhält: je ein Test für die Regeln 2 bis 6 und einer dafür, dass der Timer nach einer Antwort gelöscht ist.

### B4. Geräteverwaltung erweitern

Datei `src/devices/device-registry.ts`.

Heute sieht die Registry nur Advertisements, die den Service-Filter passiert haben. Für Verbindungen muss sie **alle** empfangenen Geräte kennen, auch solche, die `ble` nicht dekodiert.

1. Neue Methode `track(peripheral, now = Date.now()): void`. Sie macht den ersten Teil von `observe()`: Gerät anlegen, `lastSeen`, `name`, Empfang pro Gateway. Zusätzlich merkt sie sich `addressType`, wenn er nicht `"unknown"` ist.
2. `observe()` ruft als Erstes `track()` auf und macht danach wie bisher die Duplikat-Erkennung. Ihr Ergebnis ändert sich nicht.
3. Neue Methode:

    ```ts
    /** The gateways that received the device within rssiMaxAgeMs, strongest signal first */
    public getReceivers(address: string, now: number = Date.now()): { gatewayId: string; rssi: number }[];
    ```

4. Neue Methode `getAddressType(address: string): "public" | "random"`. Sie liefert den gemerkten Typ, und `"public"`, wenn das Gerät unbekannt ist oder nie einen Typ gemeldet hat.
5. In `src/main.ts`: Im `onAdvertisement` des `RemoteGatewayTransport` wird `devices.track(peripheral)` **vor** dem Service-Filter aufgerufen.

Folge: `getDevices` listet jetzt auch Geräte, die der Service-Filter aussortiert. Passe den Integrationstest `only handles advertisements of the monitored services` in `test/integrationTests/gateway_advertisement_tests.js` an: Die Prüfung, dass die Objekte **nicht** angelegt werden, bleibt. Die Prüfung der `getDevices`-Liste erwartet jetzt alle vier Adressen (`otherService`, `manufacturerDataOnly`, `marker`, `known`). Benenne den Kommentar darüber passend um.

Neue Unit-Tests in `src/devices/device-registry.test.ts`:

- `track()` allein macht kein Paket zum Duplikat: `track(a)`, dann `observe(a)` mit demselben Gateway → `duplicate: false`.
- `getReceivers()` sortiert nach RSSI und lässt Gateways weg, deren Empfang älter als `rssiMaxAgeMs` ist.
- `getReceivers()` für ein unbekanntes Gerät → `[]`.
- `getAddressType()`: gemerkter Typ; `"unknown"` überschreibt einen gemerkten Typ nicht; unbekanntes Gerät → `"public"`.

### B5. Gateways melden sich an

Dateien: `src/gateways/gateway-registry.ts`, `src/transports/remote-gateway.ts`, `src/api/message-handler.ts`, `src/main.ts`.

**Gateway-Registry:**

1. `GatewayEntry` bekommt ein privates Feld `lastMessage: number`. `recordAdvertisements()` setzt es auf `now`. `checkTimeouts()` rechnet mit `lastMessage` statt mit `lastAdvertisement`.
2. Neue Methode:

    ```ts
    /** Reports what a gateway can do. This also marks it as active. */
    public announce(
    	description: GatewayDescription,
    	capabilities: { connect: boolean; freeSlots?: number; slotLimit?: number },
    	now: number = Date.now(),
    ): void;
    ```

    Sie legt das Gateway an, falls nötig, setzt `connect`, `freeSlots`, `slotLimit` (fehlende Werte werden zu `undefined`, nicht beibehalten), setzt `lastMessage` und ruft `updateConnected(gateway, true)`.
3. Hat ein Gateway `freeSlots`, gibt es den State `gateways.<id>.freeSlots` (`type: "number"`, `role: "value"`, `read: true`, `write: false`, Name `"Free connection slots"`). Er wird beim ersten `announce` mit `freeSlots` angelegt und nur geschrieben, wenn sich der Wert ändert. Nutze dafür `enqueue()` wie bei den anderen States.
4. Neue Methode `get(id: string): GatewayInfo | undefined` (volle ID). `get()` und `list()` geben nur die Felder von `GatewayInfo` heraus, also weder `lastMessage` noch die anderen internen Felder.
5. Geht ein Gateway offline (`updateConnected(gateway, false)`), ruft die Registry den Callback `onGatewayOffline(id)` auf, falls einer gesetzt ist. Füge dafür ein öffentliches Feld `public onGatewayOffline?: (gatewayId: string) => void` hinzu.

**Transport `remote-gateway.ts`:**

1. Neue exportierte Funktion `parseAnnounceMessage(sender, payload)`. Sie liefert entweder `{ gateways: { id: string /* volle ID */; connect: boolean; freeSlots?: number; slotLimit?: number }[] }` oder einen Fehler wie `parseGatewayMessage`. Prüfungen:
    - Payload ist ein Objekt, sonst `INVALID_PAYLOAD`.
    - `protocol === GATEWAY_PROTOCOL`, sonst `UNSUPPORTED_PROTOCOL`.
    - `gateways` ist ein Array mit höchstens 100 Einträgen, sonst `INVALID_PAYLOAD`.
    - Jeder Eintrag: `gatewayId` passt auf `GATEWAY_ID_REGEX`, `connect` ist ein Boolean, `freeSlots` und `slotLimit` sind, falls vorhanden, ganze Zahlen ≥ 0. Ein einziger ungültiger Eintrag macht die ganze Nachricht zu `INVALID_PAYLOAD`.
2. Neue Methode `handleAnnounce(sender, payload): GatewayResponse<GatewayAnnounceResult>`. Sie ruft `watchSender(sender)`, dann für jedes Gateway `gateways.announce({ id, type: "remote", sender }, …)` und antwortet mit `{ protocol: GATEWAY_PROTOCOL, epoch }`. `epoch` bekommt der Transport über den Konstruktor (zweiter Parameter `epoch: number`).

**`main.ts`:** `const epoch = Date.now()` einmal in `ready`, an `RemoteGatewayTransport` übergeben.

**`message-handler.ts`:** `case GatewayCommands.announce:` → `respond(ctx.remoteGateway.handleAnnounce(sender, obj.message))`.

Tests:

- Unit in `src/transports/remote-gateway.test.ts` für `parseAnnounceMessage`: gültige Nachricht; volle ID ist `<sender>:<gatewayId>`; falsches Protokoll; kein Array; 101 Einträge; je ein ungültiges Feld.
- Integration: neue Datei `test/integrationTests/gateway_announce_tests.js` (in `index.js` registrieren), Suite `Gateway interface - announcing gateways`, Konfiguration `{ plugins: "bthome", gatewayTimeout: 2 }`:
    1. `answers with the protocol and the start time`: Antwort ist `{ error: null, result: { protocol: "ble-gateway/1", epoch } }`, `epoch` liegt höchstens 60 s zurück. Ein zweiter Aufruf liefert denselben `epoch`.
    2. `lists an announced gateway with what it can do`: nach `gateway:announce` mit `{ gatewayId: "proxy-og", connect: true, freeSlots: 3, slotLimit: 3 }` zeigt `getGateways` das Gateway `test.0:proxy-og` mit `connected: true, connect: true, freeSlots: 3, slotLimit: 3`. States `gateways.test_0_proxy-og.connected` = `true` und `.freeSlots` = `3`.
    3. `updates the free slots`: erneutes `announce` mit `freeSlots: 2` → State `2`.
    4. `keeps a gateway online that only announces itself`: 3 s lang alle 500 ms `announce`, danach ist `connected` immer noch `true`.
    5. `marks an announced gateway offline when it goes silent`: danach nichts senden → `connected` wird innerhalb von 8 s `false`.
    6. `rejects an unknown protocol`: `protocol: "ble-gateway/2"` → `error.code === "UNSUPPORTED_PROTOCOL"`, das dort genannte Gateway taucht in `getGateways` nicht auf.
    7. `rejects invalid announcements`: drei ungültige Payloads → `INVALID_PAYLOAD`.
    8. `lists a gateway that only delivers advertisements as not able to connect`: nach `deliver()` für ein neues Gateway hat es `connect: false`.

### B6. Link, Session und Connection Manager

Neue Dateien unter `src/connections/`.

**`gatt-link.ts`** (nur Typen):

```ts
import type { GattServiceInfo } from "../lib/gateway-protocol";

/** An open connection to a device through one gateway. All methods reject with a GatewayError. */
export interface GattLink {
	/** Full ID of the gateway, e.g. "esphome.0:proxy-og" */
	readonly gatewayId: string;
	readonly address: string;
	readonly mtu: number;
	getServices(): Promise<GattServiceInfo[]>;
	read(handle: number): Promise<Buffer>;
	write(handle: number, data: Buffer, withResponse: boolean): Promise<void>;
	/** Enables notifications of a characteristic. The listener is called for every notification. */
	subscribe(handle: number, listener: (data: Buffer) => void): Promise<void>;
	/** Ends the connection. Never rejects. */
	disconnect(): Promise<void>;
	/** The listener is called once when the connection ended without disconnect() being called */
	onDisconnect(listener: () => void): void;
}

/** Opens links through gateways */
export interface GattLinkProvider {
	/** @param gatewayId Full ID of the gateway */
	connect(gatewayId: string, address: string, addressType: "public" | "random"): Promise<GattLink>;
}
```

**`gatt-session.ts`:**

```ts
export class GattSession {
	public constructor(link: GattLink);
	public readonly address: string;
	public readonly gatewayId: string;
	public readonly mtu: number;
	/** Whether the session can still be used */
	public get closed(): boolean;
	/** The services of the device. Fetched once per session. */
	public getServices(): Promise<GattServiceInfo[]>;
	public read(service: string, characteristic: string): Promise<Buffer>;
	public write(service: string, characteristic: string, data: Buffer, withResponse?: boolean): Promise<void>;
	public subscribe(service: string, characteristic: string, listener: (data: Buffer) => void): Promise<void>;
	/** Ends the connection. Can be called several times. */
	public close(): Promise<void>;
}
```

Regeln:

1. `read`, `write` und `subscribe` wandeln beide UUIDs mit `normalizeUuid()` um. Ungültige UUID → `GatewayError("INVALID_PAYLOAD", …)`.
2. Sie holen die Services über `getServices()` (einmal pro Session, das Promise wird zwischengespeichert). Gesucht wird der erste Service mit der UUID und darin die erste Characteristic mit der UUID. Nicht gefunden → `GatewayError("GATT_ERROR", "Characteristic <uuid> of service <uuid> not found")`.
3. `withResponse` ist standardmäßig `true`.
4. Nach `close()` oder nach dem `onDisconnect` des Links ist `closed` `true`. Jede Methode außer `close()` lehnt dann sofort mit `GatewayError("NOT_CONNECTED", "The connection to <address> is closed")` ab.
5. `close()` ruft `link.disconnect()` höchstens einmal auf.

**`connection-manager.ts`:**

```ts
export interface SessionOptions {
	/** High priority jobs for a device run before normal ones. Default: "normal" */
	priority?: "normal" | "high";
	/** After this time the session is closed and the job fails with TIMEOUT. Default: 60000 */
	timeoutMs?: number;
	/** Full ID of the gateway to try first */
	preferGateway?: string;
}

export interface ConnectionManagerContext {
	log: Pick<ioBroker.Logger, "debug" | "info" | "warn">;
	devices: DeviceRegistry;
	gateways: GatewayRegistry;
	provider: GattLinkProvider;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(timer: any): void;
}

export class ConnectionManager {
	public constructor(ctx: ConnectionManagerContext);
	/** Connects to the device, runs the job and disconnects again, whatever happens */
	public withSession<T>(address: string, job: (session: GattSession) => Promise<T>, options?: SessionOptions): Promise<T>;
	/** Closes all sessions and fails all waiting jobs. To be called when the adapter stops. */
	public dispose(): void;
}
```

Regeln für `withSession`:

1. `address` wird mit `normalizeAddress()` geprüft. Ungültig → `GatewayError("INVALID_PAYLOAD", …)`.
2. **Pro Gerät läuft höchstens ein Job.** Weitere Jobs für dieselbe Adresse warten. Aus den wartenden wird als Nächstes ein Job mit `priority: "high"` genommen, sonst der älteste. Ein laufender Job wird nie unterbrochen. Jobs für verschiedene Geräte laufen parallel.
3. Start eines Jobs, Auswahl der Gateways:
    - `devices.getReceivers(address)` liefert die Kandidaten, stärkstes Signal zuerst.
    - Es bleiben nur Gateways, für die `gateways.get(id)` Folgendes liefert: `connected === true`, `connect === true` und `freeSlots !== 0`.
    - Steht `preferGateway` in der Liste, rückt es an die erste Stelle.
    - Leere Liste → `GatewayError("NO_GATEWAY", "No gateway that can connect receives <address>")`.
4. Verbinden: `provider.connect(gatewayId, address, devices.getAddressType(address))` für den ersten Kandidaten. Schlägt es fehl, wird der Fehler mit `log.debug` protokolliert und der nächste Kandidat versucht. Sind alle fehlgeschlagen, wird der Job mit dem **letzten** Fehler abgelehnt.
5. Danach läuft `job(session)`. Das Ergebnis von `withSession` ist das Ergebnis des Jobs, bei einem Fehler dessen Fehler.
6. Zeitlimit: Ein Timer über `ctx.setTimeout` mit `timeoutMs` startet, bevor verbunden wird. Läuft er ab, wird die Session geschlossen (falls vorhanden) und `withSession` lehnt mit `GatewayError("TIMEOUT", "Session with <address> took longer than <n> ms")` ab. Ein späteres Ergebnis des Jobs wird ignoriert.
7. **Immer**, also bei Erfolg, Fehler und Timeout: Timer löschen, `session.close()` abwarten (höchstens 10 s, Fehler ignorieren), erst dann den nächsten wartenden Job für das Gerät starten.
8. `dispose()`: Wartende Jobs werden mit `GatewayError("NOT_CONNECTED", "The adapter is stopping")` abgelehnt, laufende Sessions mit `close()` beendet, ohne darauf zu warten. Danach lehnt `withSession` sofort mit demselben Fehler ab.

Unit-Tests in `src/connections/gatt-session.test.ts` und `src/connections/connection-manager.test.ts`. Baue dafür in `src/connections/test-fakes.ts` einen `FakeLink` (hält fest, was aufgerufen wurde, Services und Werte sind einstellbar, `simulateDisconnect()`) und einen `FakeProvider` (pro Gateway einstellbar: Erfolg, Fehler mit Code oder ein Promise, das der Test selbst auflöst). `DeviceRegistry` und `GatewayRegistry` werden echt verwendet; die `GatewayRegistry` bekommt einen minimalen Fake-Adapter (`namespace`, `log`, `FORBIDDEN_CHARS`, `setState`, `setStateAsync`, `setObjectNotExistsAsync`, `getStatesAsync`), `init()` wird in den Tests nicht aufgerufen.

Pflichtfälle `gatt-session.test.ts`:

1. `read` löst UUIDs in Kurz- und Langform auf dasselbe Handle auf.
2. Die Services werden bei mehreren Operationen nur einmal geholt.
3. Unbekannte Characteristic → `GATT_ERROR`, der Link wurde nicht zum Lesen aufgerufen.
4. Ungültige UUID → `INVALID_PAYLOAD`.
5. `write` reicht Daten und `withResponse` durch, Standard ist `true`.
6. `subscribe` reicht Notifications an den Listener weiter.
7. Nach `close()` lehnen alle Operationen mit `NOT_CONNECTED` ab, `disconnect()` wurde genau einmal aufgerufen, auch bei zweimaligem `close()`.
8. Nach `simulateDisconnect()` lehnen alle Operationen mit `NOT_CONNECTED` ab.

Pflichtfälle `connection-manager.test.ts`:

1. Erfolg: verbindet über das Gateway mit dem besten RSSI, liefert das Ergebnis des Jobs, trennt danach.
2. Ein Fehler im Job wird durchgereicht, getrennt wird trotzdem.
3. Zwei Jobs für dasselbe Gerät laufen nacheinander: Der zweite verbindet erst, nachdem der erste getrennt hat.
4. Jobs für zwei verschiedene Geräte laufen gleichzeitig.
5. Ein wartender Job mit `priority: "high"` läuft vor einem früher eingereihten normalen.
6. Schlägt das beste Gateway fehl, wird das nächste benutzt.
7. Schlagen alle fehl, kommt der Fehler des letzten.
8. Gateways mit `connect: false`, mit `connected: false` und mit `freeSlots: 0` werden nicht versucht.
9. `preferGateway` wird zuerst versucht, auch mit schlechterem RSSI.
10. Kein Kandidat → `NO_GATEWAY`, ohne Verbindungsversuch.
11. Zeitlimit: Der Job hängt → `TIMEOUT`, die Session wird getrennt, der nächste wartende Job läuft.
12. Ungültige Adresse → `INVALID_PAYLOAD`.
13. `dispose()` lehnt wartende Jobs ab und trennt die laufende Session.

### B7. Links über gelieferte Gateways

Datei `src/transports/remote-gateway.ts`. `RemoteGatewayTransport` implementiert zusätzlich `GattLinkProvider`.

1. Der Transport braucht `RequestSender` (für `sendRequest`). Der Adapter aus dem `TransportContext` erfüllt das.
2. `connect(gatewayId, address, addressType)`:
    - Volle ID am **ersten** Doppelpunkt trennen: `esphome.0:proxy-og` → Absender `esphome.0`, lokale ID `proxy-og`.
    - `sendRequest(adapter, sender, "gatt:connect", { gatewayId: <lokal>, address, addressType, epoch }, 25000)`.
    - Bei Erfolg einen `RemoteGattLink` anlegen und unter dem Schlüssel `<volle gatewayId>|<address>` in einer `Map` ablegen.
3. `RemoteGattLink` (eigene Klasse in derselben Datei oder in `src/transports/remote-gatt-link.ts`):

    | Methode | Befehl | Timeout |
    |---|---|---|
    | `getServices()` | `gatt:getServices` → `result.services` | 15 s |
    | `read(handle)` | `gatt:read` → `Buffer.from(result.data, "base64")` | 10 s |
    | `write(handle, data, withResponse)` | `gatt:write` mit `data` als Base64 | 10 s |
    | `subscribe(handle, listener)` | Listener unter dem Handle merken, dann `gatt:subscribe`. Schlägt der Befehl fehl, den Listener wieder entfernen. | 10 s |
    | `disconnect()` | Link aus der `Map` entfernen, dann `gatt:disconnect`. Fehler nur mit `log.debug` protokollieren. | 10 s |

    Nach `disconnect()` oder nach einem gemeldeten Verbindungsende lehnen alle Methoden außer `disconnect()` mit `NOT_CONNECTED` ab, ohne etwas zu senden.
4. `handleConnectionState(sender, payload)`: Payload prüfen (`gatewayId`, gültige `address`). Link suchen. Gibt es ihn: aus der `Map` entfernen, als beendet markieren, **alle gerade laufenden Anfragen dieses Links sofort mit `NOT_CONNECTED` ablehnen** (nicht erst nach ihrem Timeout), `onDisconnect`-Listener aufrufen. Gibt es ihn nicht: nichts tun. Ungültige Payload: mit `log.debug` protokollieren, nichts tun.
5. `handleNotification(sender, payload)`: Payload prüfen (`handle` ganze Zahl, `data` Base64). Link suchen, Listener für das Handle aufrufen. Unbekannt oder ungültig: nichts tun.
6. Geht ein Gateway offline (`gateways.onGatewayOffline`, in `main.ts` verdrahten), werden alle Links dieses Gateways wie in Punkt 4 beendet. Es wird **kein** `gatt:disconnect` gesendet.
7. `stop()` beendet alle Links wie in Punkt 4.

`message-handler.ts`: `connectionState` und `notification` rufen die beiden Methoden auf. Hat die Nachricht einen Callback, antworte mit `{ error: null, result: {} }`.

Unit-Tests in `src/transports/remote-gateway.test.ts` mit einem Fake-Adapter, dessen `sendTo` die Anfragen festhält und den der Test antworten lässt:

1. `connect` schickt `gatt:connect` an den Absender, mit lokaler Gateway-ID, Adresse, Adresstyp und `epoch`.
2. Jede Link-Methode schickt den Befehl aus der Tabelle mit der richtigen Payload; `read` liefert einen `Buffer`.
3. Ein Fehler des Lieferanten kommt als `GatewayError` mit demselben Code an.
4. `gateway:notification` erreicht den Listener des richtigen Handles und nur den.
5. `gateway:connectionState` ruft `onDisconnect` auf, danach lehnt `read` mit `NOT_CONNECTED` ab und sendet nichts. Ein `read`, das beim Eintreffen der Meldung noch auf Antwort wartet, wird sofort mit `NOT_CONNECTED` abgelehnt.
6. Eine Notification oder ein Verbindungsende für einen unbekannten Link wirft nicht.
7. `disconnect()` lehnt nie ab, auch wenn der Lieferant nicht antwortet (Timer des Fake-Adapters auslösen).
8. Geht das Gateway offline, enden seine Links, andere bleiben.

### B8. Befehle für andere Adapter

Datei `src/api/message-handler.ts`, `MessageHandlerContext` bekommt `connections: ConnectionManager`.

| Befehl | Ablauf | `result` |
|---|---|---|
| `discoverServices` | `withSession(address, s => s.getServices())` | `{ services }` |
| `readCharacteristic` | `withSession(address, s => s.read(service, characteristic))` | `{ data: <Base64> }` |
| `writeCharacteristic` | `withSession(address, s => s.write(service, characteristic, <Buffer>, withResponse ?? true))` | `{}` |

Regeln:

1. Payload prüfen, bevor verbunden wird: Objekt; `address` gültig; `service` und `characteristic` gültige UUIDs (`normalizeUuid`); `data` ist ein Base64-String (derselbe Regex wie in `remote-gateway.ts`, exportiere ihn von dort); `withResponse` fehlt oder ist ein Boolean. Sonst `INVALID_PAYLOAD`.
2. Fehler werden mit `toErrorResponse()` beantwortet.
3. Der Handler darf nie eine unbehandelte Ablehnung erzeugen.

`main.ts`: `ConnectionManager` nach `devices` und `remoteGateway` anlegen (`provider: remoteGateway`), an den Message-Handler übergeben, in `unload` `connections.dispose()` **vor** dem Stoppen der Transporte aufrufen.

### B9. Integrationstests für Verbindungen

Neue Datei `test/integrationTests/gatt_tests.js`, in `index.js` registrieren.

Der Test spielt den Lieferanten. Dafür gibt es in `helpers.js` den `MessageClient`: `getMessageClient(harness).onRequest((command, message) => antwort)` beantwortet die `gatt:*`-Befehle, die `ble` an `test.0` schickt. Gibt die Funktion `undefined` zurück, bleibt die Anfrage unbeantwortet. `client.received` enthält alle empfangenen Befehle.

> Der Teil `request()` des `MessageClient` wird von allen bestehenden Suiten benutzt. `onRequest()` ist aus dem Quelltext des js-controller abgeleitet, lief aber noch nie, weil `ble` bisher keine Anfragen verschickt. Kommt in deinem ersten Test keine Antwort bei `ble` an, prüfe zuerst diese Stelle in `helpers.js`.

Baue in `test/integrationTests/fakeGattGateway.js` eine Klasse `FakeGattGateway`, die sich als Handler bei `onRequest` einhängt. Sie simuliert ein Gerät mit diesen Services:

```js
// Service 0x1f10 with one characteristic 0x1f1f (read, write, notify), like the pvvx thermometers
const SERVICES = [
	{
		uuid: "00001f10-0000-1000-8000-00805f9b34fb",
		handle: 30,
		characteristics: [
			{
				uuid: "00001f1f-0000-1000-8000-00805f9b34fb",
				handle: 32,
				properties: 0x1a,
				descriptors: [{ uuid: "00002902-0000-1000-8000-00805f9b34fb", handle: 33 }],
			},
		],
	},
];
```

Die Klasse hält fest: offene Verbindungen (Menge aus `gatewayId|address`), die höchste Zahl gleichzeitig offener Verbindungen pro Adresse, den Wert jedes Handles (Schreiben ändert ihn, Lesen liefert ihn), alle Befehle in Reihenfolge. Einstellbar pro Gateway: `failConnect` (Fehlercode) und `connectDelayMs`, pro Befehl: `silent` (nicht antworten). `gatt:read` ohne offene Verbindung antwortet `NOT_CONNECTED`.

Vorbereitung jeder Suite: Adapter mit `{ plugins: "bthome" }` starten, `announce` für die Gateways, ein Advertisement des Geräts pro Gateway mit `deliver()` (damit `ble` weiß, welches Gateway das Gerät empfängt).

Suite `GATT - reading and writing through a gateway` (Gateways `proxy-og` mit RSSI -55 und `proxy-keller` mit RSSI -85, beide `connect: true`):

1. `reads a characteristic`: Handle 32 hat den Wert `2301020304`. `readCharacteristic` mit `service: "1f10"`, `characteristic: "1f1f"` → `{ error: null, result: { data: <Base64 davon> } }`. Reihenfolge der Befehle beim Lieferanten: `gatt:connect`, `gatt:getServices`, `gatt:read`, `gatt:disconnect`. `gatt:connect` ging an `proxy-og` mit `addressType: "public"` und dem `epoch` aus der Antwort auf `announce`.
2. `accepts the full UUID as well`: dieselbe Anfrage mit vollen UUIDs in Großbuchstaben → dasselbe Ergebnis.
3. `writes a characteristic`: `writeCharacteristic` mit `data` → `{ error: null, result: {} }`, der Wert des Handles ist danach der geschriebene, `withResponse` war `true`. Ein zweiter Aufruf mit `withResponse: false` kommt beim Lieferanten mit `false` an.
4. `lists the services of a device`: `discoverServices` → `result.services` ist genau `SERVICES`.
5. `runs two requests for the same device one after the other`: zwei `readCharacteristic` gleichzeitig abschicken (`Promise.all`), `connectDelayMs: 300`. Beide liefern den Wert. Die höchste Zahl gleichzeitig offener Verbindungen zu der Adresse ist 1.
6. `disconnects when the characteristic does not exist`: `characteristic: "2a00"` → `error.code === "GATT_ERROR"`, danach ist keine Verbindung mehr offen.
7. `rejects invalid requests without connecting`: ungültige Adresse, ungültige UUID, `data` kein Base64 → jeweils `INVALID_PAYLOAD`, der Lieferant hat kein `gatt:connect` bekommen.

Suite `GATT - choosing a gateway`:

1. `uses the next gateway when the best one cannot connect`: `proxy-og` mit `failConnect: "CONNECT_FAILED"` → Lesen gelingt, `gatt:connect` ging erst an `proxy-og`, dann an `proxy-keller`.
2. `does not use a gateway without free slots`: `announce` mit `freeSlots: 0` für `proxy-og` → `gatt:connect` geht nur an `proxy-keller`.
3. `does not use a gateway that cannot connect`: Gerät nur über ein Gateway empfangen, das `connect: false` gemeldet hat → `error.code === "NO_GATEWAY"`.
4. `reports a device nobody receives`: unbekannte Adresse → `NO_GATEWAY`.

Suite `GATT - when things go wrong` (Standard-Konfiguration; setze hier **nicht** `gatewayTimeout` herunter, sonst geht das Gateway während des Tests offline und der Fehler heißt `NOT_CONNECTED` statt `TIMEOUT`):

1. `fails when the gateway does not answer`: `gatt:read` ist `silent` → nach etwa 10 s `error.code === "TIMEOUT"`, danach wurde `gatt:disconnect` gesendet. Test-Timeout 40 s.
2. `fails pending requests when the connection is lost`: `gatt:read` ist `silent`; 500 ms nach dem Eintreffen von `gatt:read` schickt der Test `gateway:connectionState` mit `connected: false` → `readCharacteristic` antwortet innerhalb von 3 s mit `error.code === "NOT_CONNECTED"`.
3. `can connect again afterwards`: danach gelingt ein normales Lesen.

Fertig mit Teil B, wenn alle Befehle aus `AGENTS.md` (Abschnitt „Commands“) bestehen, `build/` neu gebaut und eingecheckt ist, das README die drei neuen Befehle in der Tabelle unter „Receiving advertisements from other adapters“ nennt und der Changelog eine Zeile bekommen hat.

---

## Teil C: Umsetzung in `ioBroker.esphome`

Branch `ccr-ble-gateway-forwarding`. Bestehender Code, auf dem du aufbaust: `src/lib/bleForwarder.ts` (Weiterleitung der Advertisements), `test/integrationTests/fakeBluetoothProxy.js` und `ble_forwarding_tests.js`.

### C0. Was du über die Bibliothek wissen musst

Geprüft an `@2colors/esphome-native-api` 1.3.6. Halte dich daran, die Methoden der Bibliothek sind für GATT **nicht** verwendbar:

1. **Die GATT-Methoden der Bibliothek ordnen Antworten nur über den Nachrichtentyp zu**, nicht über Adresse und Handle (`sendMessageAwaitResponse` in `lib/connection.js`). Bei zwei BLE-Geräten am selben Proxy bekäme eine Anfrage die Antwort der anderen. Benutze deshalb `connectBluetoothDeviceService`, `readBluetoothGATTCharacteristicService` und die anderen `…Service`-Methoden für GATT **nicht**.
2. Stattdessen: Nachricht mit `client.connection.sendMessage(message)` schicken und auf `client.connection.on('message.<Typ>', listener)` warten. Die Nachrichtenklassen kommen aus `require('@2colors/esphome-native-api/lib/utils/messages').pb`.
3. Antworten haben diese Form (nach dem Mapping der Bibliothek):

    | Typ | Felder |
    |---|---|
    | `BluetoothDeviceConnectionResponse` | `address` (Zahl), `connected`, `mtu`, `error` |
    | `BluetoothGATTGetServicesResponse` | `address`, `servicesList: [{ uuid, shortUuid, handle, characteristicsList: [{ uuid, shortUuid, handle, properties, descriptorsList: [{ uuid, shortUuid, handle }] }] }]` |
    | `BluetoothGATTGetServicesDoneResponse` | `address` |
    | `BluetoothGATTReadResponse` | `address`, `handle`, `data` (Base64) |
    | `BluetoothGATTWriteResponse` | `address`, `handle` |
    | `BluetoothGATTNotifyResponse` | `address`, `handle` |
    | `BluetoothGATTNotifyDataResponse` | `address`, `handle`, `data` (Base64) |
    | `BluetoothGATTErrorResponse` | `address`, `handle`, `error` |
    | `BluetoothConnectionsFreeResponse` | `free`, `limit` |

    `uuid` ist bereits eine UUID mit Bindestrichen, **oder ein leerer String**, wenn das Gerät stattdessen `shortUuid` (Zahl) gesetzt hat. Dann gilt: kanonische UUID = `shortUuid` als 8-stellige Hex-Zahl + `-0000-1000-8000-00805f9b34fb`.
4. Anfragen (Konstruktor mit Array, wie in `lib/connection.js`):

    | Zweck | Nachricht |
    |---|---|
    | Verbinden | `new pb.BluetoothDeviceRequest([address, pb.BluetoothDeviceRequestType.BLUETOOTH_DEVICE_REQUEST_TYPE_CONNECT_V3_WITHOUT_CACHE])`, danach `setHasAddressType(true)` und `setAddressType(0 oder 1)` |
    | Trennen | `new pb.BluetoothDeviceRequest([address, pb.BluetoothDeviceRequestType.BLUETOOTH_DEVICE_REQUEST_TYPE_DISCONNECT])` |
    | Services | `new pb.BluetoothGATTGetServicesRequest([address])` |
    | Lesen | `new pb.BluetoothGATTReadRequest([address, handle])` |
    | Schreiben | `new pb.BluetoothGATTWriteRequest([address, handle, withResponse, bytes])`, `bytes` ist ein `Uint8Array` |
    | Notify | `new pb.BluetoothGATTNotifyRequest([address, handle, true])` |
    | Descriptor schreiben | `new pb.BluetoothGATTWriteDescriptorRequest([address, handle, bytes])` |
    | Freie Plätze abonnieren | `new pb.SubscribeBluetoothConnectionsFreeRequest()` |

5. `address` ist in der API eine Zahl: `parseInt("a4c138123456", 16)`. Für die Rückrichtung gibt es `macFromAddress()` in `bleForwarder.ts`.
6. Feature-Flags in `deviceInfo.bluetoothProxyFeatureFlags`: Bit 1 (`1 << 1`) = der Proxy kann Verbindungen aufbauen. Bit 5 (`1 << 5`) = Raw-Advertisements (schon in `bleForwarder.ts`).
7. **Nicht an Hardware geprüft:** Bei Verbindungen vom Typ V3 muss der Client nach dem `BluetoothGATTNotifyRequest` selbst den CCCD-Descriptor (`00002902-…`) der Characteristic schreiben, so macht es die Referenz `bleak-esphome` (`client.py`, `start_notify`). Setze das wie in C3 beschrieben um und vermerke im Abschlussbericht, dass es mit einem echten ESP32 zu prüfen ist.

Ergänze `src/lib/esphome-native-api.d.ts` um die Typen, die du dafür brauchst (`Connection.sendMessage`, `Connection.on` für `message.*`, das Modul `…/lib/utils/messages`). Kein `any` in `src/` außerhalb dieser Datei.

### C1. Zugriff auf die Gateways des Forwarders

`BleForwarder` kennt bereits jedes abonnierte Gerät mit seiner Gateway-ID. Ergänze zwei öffentliche Methoden und sonst nichts:

```ts
/** The devices that currently forward advertisements, with what the GATT bridge needs */
public listGateways(): { gatewayId: string; host: string; client: Client }[];
/** The device with this gateway ID, undefined if it is not connected */
public findGateway(gatewayId: string): { gatewayId: string; host: string; client: Client } | undefined;
```

Beide liefern nur Geräte mit `subscribed === true`. Unit-Tests dafür in `bleForwarder.test.ts`.

### C2. `BleGattBridge`

Neue Datei `src/lib/bleGattBridge.ts`, Klasse `BleGattBridge`. Sie ist nur aktiv, wenn die Weiterleitung eingeschaltet ist (`forwarder.enabled`).

Konstruktor: `new BleGattBridge(adapter, forwarder)`. Das Ziel ist `forwarder.target`. `adapter` ist ein eigenes kleines Interface wie `BleForwarderAdapter` (Log, `sendTo` mit optionalem Callback, `setTimeout`/`clearTimeout`, `setInterval`/`clearInterval`, `subscribeForeignStates`). In `main.ts` wird die Bridge an denselben zwei Stellen angelegt wie der Forwarder: im Konstruktor mit dem deaktivierten Forwarder, in `onReady` direkt nach dem echten Forwarder neu.

Zustand pro Proxy (Schlüssel: Host): `connect` (kann Verbindungen), `freeSlots`, `slotLimit`, offene Verbindungen (`Map` Adresse → `{ services? }`). Zustand insgesamt: `epoch` (zuletzt gesehen, anfangs `undefined`).

Öffentliche Methoden und wann `main.ts` sie aufruft:

| Methode | Aufruf in `main.ts` |
|---|---|
| `initialized(host, deviceInfo)` | im `initialized`-Event, **nach** `bleForwarder.initialized()` |
| `disconnected(host)` | im `disconnected`-Event, nach `bleForwarder.disconnected()` |
| `handleMessage(obj)` | in `onMessage`, wenn `obj.command` mit `gatt:` beginnt, vor allen anderen Zweigen |
| `handleStateChange(id, state): boolean` | am Anfang von `onStateChange`. Gibt sie `true` zurück, gehört der State der Bridge, und `onStateChange` kehrt sofort zurück. |
| `stop()` | in `onUnload`, **vor** `bleForwarder.stop()` |

Verhalten:

1. `initialized`: Kann der Proxy Verbindungen (Bit 1) und leitet er weiter (`forwarder.findGateway` findet ihn), dann: Listener für `message.BluetoothConnectionsFreeResponse`, `message.BluetoothDeviceConnectionResponse`, `message.BluetoothGATTNotifyDataResponse` registrieren (einmal pro `client`, nicht bei jedem Reconnect erneut), `SubscribeBluetoothConnectionsFreeRequest` senden, `announce()` aufrufen.
2. `announce()`: sendet `gateway:announce` an das Ziel, mit **allen** Gateways aus `forwarder.listGateways()`. `connect` ist `true` für Proxies mit Bit 1. `freeSlots`/`slotLimit` nur, wenn bekannt. Mit Callback: Enthält die Antwort `result.epoch`, wird `seenEpoch(epoch)` aufgerufen. Antwortet `ble` mit `UNSUPPORTED_PROTOCOL`, einmal eine Warnung loggen. Zusätzlich läuft ein Intervall von 30 s (`adapter.setInterval`), das `announce()` aufruft, solange es Gateways gibt.
3. `BluetoothConnectionsFreeResponse`: Werte merken. Haben sie sich geändert, `announce()`.
4. `seenEpoch(epoch)`: Ist ein Wert gemerkt und der neue weicht ab, alle offenen Verbindungen aller Proxies trennen (Trenn-Nachricht senden, nicht auf Antwort warten, Zustand sofort leeren). Dann den neuen Wert merken.
5. `handleStateChange`: Die Bridge abonniert beim Start `system.adapter.<Ziel>.alive` (`subscribeForeignStates`). Wird der State `false`, alle offenen Verbindungen trennen wie in Punkt 4.
6. `disconnected(host)`: Für jede offene Verbindung dieses Proxys `gateway:connectionState` mit `connected: false` an das Ziel senden, Zustand des Proxys leeren, wartende Anfragen mit `NOT_CONNECTED` beenden.
7. `stop()`: Intervall beenden, alle offenen Verbindungen trennen wie in Punkt 4.
8. Unverlangtes Verbindungsende: `BluetoothDeviceConnectionResponse` mit `connected: false` für eine Adresse, die als offen geführt wird und für die gerade kein `gatt:disconnect` läuft → aus dem Zustand entfernen, `gateway:connectionState` senden, wartende Anfragen dieser Adresse mit `NOT_CONNECTED` beenden.
9. `BluetoothGATTNotifyDataResponse` für eine offene Verbindung → `gateway:notification` mit `gatewayId`, `address` (als MAC), `handle`, `data` senden. Für unbekannte Adressen: ignorieren.

### C3. Die `gatt:*`-Befehle

`handleMessage(obj)` antwortet immer mit `adapter.sendTo(obj.from, obj.command, antwort, obj.callback)`, wenn `obj.callback` gesetzt ist.

Prüfungen in dieser Reihenfolge, der erste Treffer bestimmt die Antwort:

1. `obj.from !== "system.adapter." + ziel` → `INVALID_PAYLOAD` („Only <ziel> may use the Bluetooth proxies“).
2. Payload kein Objekt, `gatewayId` kein String, `address` keine MAC in Kleinbuchstaben mit Doppelpunkten, `handle` (wo verlangt) keine ganze Zahl ≥ 0, `data` kein Base64, `withResponse` kein Boolean, `addressType` nicht `public`/`random`, `epoch` keine Zahl → `INVALID_PAYLOAD`.
3. `forwarder.findGateway(gatewayId)` findet nichts → `UNKNOWN_GATEWAY`.
4. Der Proxy kann keine Verbindungen (Bit 1 fehlt) → `UNKNOWN_GATEWAY`.
5. Alle Befehle außer `gatt:connect`: Adresse nicht als offen geführt → `NOT_CONNECTED`.

Gemeinsamer Baustein, als private Methode:

```ts
/**
 * Sends a message to the proxy and waits for the answer that belongs to it.
 * Rejects with GATT_ERROR when the proxy reports an error for this address (and handle),
 * with NOT_CONNECTED when the connection to the BLE device ends, with TIMEOUT otherwise.
 */
private request<T>(
    client: Client,
    message: unknown,
    responseType: string,
    matches: (response: any) => boolean,
    errorMatches: (error: { address: number; handle: number }) => boolean,
    timeoutMs: number,
): Promise<T>;
```

Sie registriert die Listener, **bevor** sie sendet, und entfernt sie in jedem Fall wieder. Timer über `adapter.setTimeout`.

| Befehl | Ablauf |
|---|---|
| `gatt:connect` | 1. `seenEpoch(epoch)`. 2. Ist die Adresse an diesem Proxy schon als offen geführt: Trenn-Nachricht senden, aus dem Zustand entfernen, nicht warten. 3. `freeSlots === 0` → `NO_FREE_SLOT`. 4. Verbinden senden, auf `BluetoothDeviceConnectionResponse` mit derselben Adresse warten, 20 s. 5. `connected === true` → Adresse als offen führen, Antwort `{ mtu: mtu \|\| 23 }`. 6. `connected === false` → `CONNECT_FAILED` mit dem Fehlercode in der Meldung. 7. Timeout → Trenn-Nachricht senden (aufräumen), `TIMEOUT`. |
| `gatt:disconnect` | Adresse aus dem Zustand entfernen und als „wird getrennt“ merken. Trennen senden, auf `BluetoothDeviceConnectionResponse` mit `connected: false` warten, 5 s. Antwort ist immer `{}`, auch nach einem Timeout. |
| `gatt:getServices` | Senden. Alle `BluetoothGATTGetServicesResponse` mit derselben Adresse sammeln, bis `BluetoothGATTGetServicesDoneResponse` mit derselben Adresse kommt, 10 s. In `GattServiceInfo[]` umwandeln (UUIDs nach C0 Punkt 3), am Zustand der Verbindung merken, antworten. |
| `gatt:read` | Senden, auf `BluetoothGATTReadResponse` mit Adresse und Handle warten, 8 s → `{ data }` unverändert. |
| `gatt:write` | `withResponse: true`: senden, auf `BluetoothGATTWriteResponse` mit Adresse und Handle warten, 8 s → `{}`. `withResponse: false`: senden und sofort `{}` antworten. |
| `gatt:subscribe` | 1. Sind die Services dieser Verbindung noch nicht gemerkt, zuerst wie bei `gatt:getServices` holen. 2. Notify senden, auf `BluetoothGATTNotifyResponse` mit Adresse und Handle warten, 8 s. 3. Die Characteristic mit diesem Handle suchen. Hat sie einen Descriptor mit der UUID `00002902-0000-1000-8000-00805f9b34fb`: Descriptor schreiben mit den Bytes `[1, 0]`, wenn `properties & 0x10`, sonst `[2, 0]`. Nicht auf Antwort warten. Kein solcher Descriptor: nichts schreiben. 4. `{}` antworten. |

Die Zeiten sind bewusst kürzer als die Timeouts in `ble` (Teil A2), damit `ble` die genauere Fehlermeldung des Lieferanten bekommt.

### C4. Unit-Tests

`src/lib/bleGattBridge.test.ts`. Fake-Verbindung: ein `EventEmitter` mit `sendMessage`, das die Nachrichten festhält (prüfe mit `message.constructor.type` und `message.toObject()`), und einer Methode, mit der der Test Antworten einspielt. Baue Antworten mit den `pb`-Klassen wie in `bleForwarder.test.ts`.

Pflichtfälle:

1. Ein Proxy mit Bit 1 wird mit `connect: true` gemeldet, einer ohne mit `connect: false`, mit `protocol: "ble-gateway/1"`.
2. `BluetoothConnectionsFreeResponse` landet in `freeSlots`/`slotLimit` der nächsten Meldung; eine Änderung löst sofort eine Meldung aus, derselbe Wert nicht.
3. Das Intervall meldet erneut.
4. `gatt:connect`: richtige Nachricht (Adresse als Zahl, Typ `CONNECT_V3_WITHOUT_CACHE`, Adresstyp gesetzt), Antwort mit `mtu`.
5. `gatt:connect`: `connected: false` → `CONNECT_FAILED`; keine Antwort → `TIMEOUT` und eine Trenn-Nachricht wurde gesendet; `freeSlots: 0` → `NO_FREE_SLOT`, nichts gesendet.
6. **Zuordnung:** Zwei BLE-Geräte sind verbunden, für beide läuft `gatt:read` auf demselben Handle. Die Antworten kommen in umgekehrter Reihenfolge. Jede Anfrage bekommt ihre eigenen Daten.
7. `gatt:read`: `BluetoothGATTErrorResponse` für Adresse und Handle → sofort `GATT_ERROR`, nicht erst nach dem Timeout.
8. `gatt:write`: mit Antwort wird gewartet, ohne Antwort sofort beantwortet; die Bytes kommen unverändert an.
9. `gatt:getServices`: zwei Teilantworten werden zusammengeführt; `uuid` leer und `shortUuid: 0x1f10` → `00001f10-0000-1000-8000-00805f9b34fb`.
10. `gatt:subscribe`: Notify-Nachricht, danach Descriptor-Schreiben auf das Handle des `2902`-Descriptors mit `[1, 0]`; bei einer Characteristic nur mit Indicate `[2, 0]`; ohne Descriptor kein Schreiben.
11. Eine Notification wird als `gateway:notification` mit MAC-Adresse weitergegeben, für eine nicht verbundene Adresse nicht.
12. Unverlangtes Verbindungsende → `gateway:connectionState`, laufendes `gatt:read` → `NOT_CONNECTED`. Nach `gatt:disconnect` wird **kein** `gateway:connectionState` gesendet.
13. Befehl von einer anderen Instanz als dem Ziel → `INVALID_PAYLOAD`, nichts gesendet.
14. Unbekanntes Gateway → `UNKNOWN_GATEWAY`; Befehl ohne Verbindung → `NOT_CONNECTED`; je eine ungültige Payload pro Feld → `INVALID_PAYLOAD`.
15. Neuer `epoch` in `gatt:connect` trennt die bestehenden Verbindungen zuerst. Derselbe `epoch` trennt nichts.
16. `alive` des Ziels wird `false` → alle Verbindungen getrennt.
17. Der Proxy verliert die Verbindung → `gateway:connectionState` für jede offene Verbindung.
18. `stop()` trennt alles und beendet das Intervall.

### C5. Integrationstests

Erweitere `test/integrationTests/fakeBluetoothProxy.js` um GATT: `SubscribeBluetoothConnectionsFreeRequest` (antwortet mit `free`/`limit`, einstellbar, Standard 3/3), `BluetoothDeviceRequest` (Verbinden und Trennen, zählt `free` mit und meldet Änderungen), `BluetoothGATTGetServicesRequest` (die Services aus B9, danach `BluetoothGATTGetServicesDoneResponse`), Lesen, Schreiben, Notify, Descriptor-Schreiben (festhalten).

**Falle bei den Services:** Baue `BluetoothGATTGetServicesResponse` nicht mit `setUuidList()` und `serializeBinary()`. Das schreibt die UUID gepackt, und die installierte Kombination aus Bibliothek und `google-protobuf` 4.0.3 kann das nicht lesen (`reader.readPackedUint64 is not a function`, die Verbindung zum Proxy bricht dann ab). Echte Geräte senden die zwei Hälften der UUID einzeln, nicht gepackt. Benutze deshalb diesen geprüften Encoder und schicke seine Bytes als Nachricht vom Typ `pb.BluetoothGATTGetServicesResponse.id`:

```js
const { BinaryWriter } = require('google-protobuf');

/** Writes a UUID as ESPHome does: two uint64 (high and low half), one field each, not packed */
function writeUuid(writer, field, uuid) {
    const hex = uuid.replace(/-/g, '');
    writer.writeUint64String(field, BigInt(`0x${hex.slice(0, 16)}`).toString());
    writer.writeUint64String(field, BigInt(`0x${hex.slice(16)}`).toString());
}

/**
 * @param {number} address - Address of the BLE device as number
 * @param {object[]} services - Services in the form of GattServiceInfo
 * @returns {Uint8Array} An encoded BluetoothGATTGetServicesResponse
 */
function encodeServicesResponse(address, services) {
    const response = new BinaryWriter();
    response.writeUint64(1, address);
    for (const service of services) {
        const s = new BinaryWriter();
        writeUuid(s, 1, service.uuid);
        s.writeUint32(2, service.handle);
        for (const characteristic of service.characteristics) {
            const c = new BinaryWriter();
            writeUuid(c, 1, characteristic.uuid);
            c.writeUint32(2, characteristic.handle);
            c.writeUint32(3, characteristic.properties);
            for (const descriptor of characteristic.descriptors) {
                const d = new BinaryWriter();
                writeUuid(d, 1, descriptor.uuid);
                d.writeUint32(2, descriptor.handle);
                c.writeBytes(4, d.getResultBuffer());
            }
            s.writeBytes(3, c.getResultBuffer());
        }
        response.writeBytes(2, s.getResultBuffer());
    }
    return response.getResultBuffer();
}
```

Die Bibliothek liefert daraus `uuid: "00001f10-0000-1000-8000-00805f9b34fb"` (geprüft). Setze aus demselben Grund in `BluetoothConnectionsFreeResponse` nur `free` und `limit`, nicht die Liste `allocated`. Im Unit-Test für die Kurzform (C4, Fall 9) kannst du `setShortUuid(0x1f10)` benutzen, das ist kein gepacktes Feld. Dazu Methoden für den Test: `setValue(handle, hex)`, `notify(address, handle, hex)`, `dropBleConnection(address)` (sendet `BluetoothDeviceConnectionResponse` mit `connected: false`), `failNextConnect(error)`. Die bestehenden Tests in `ble_forwarding_tests.js` müssen unverändert bestehen.

Neue Datei `test/integrationTests/ble_gatt_tests.js`, in `index.js` registrieren. Der Test spielt `ble.0`: Er schickt Befehle mit `from: "system.adapter.ble.0"` über `harness.dbConnection.pushMessage("system.adapter.esphome.0", { command, message, from, callback: { message, id, ack: false, time } })` und liest Antworten und Meldungen aus `messagebox.system.adapter.ble.0` (wie `BleInbox`). Eine Antwort erkennst du an `callback.ack === true` und der `callback.id` deiner Anfrage. Auf `gateway:announce` antwortet der Test mit `{ error: null, result: { protocol: "ble-gateway/1", epoch } }` (dieselbe Nachricht zurück an `obj.from`, `callback.ack` auf `true`).

Suite `BLE GATT - connections through a Bluetooth proxy`:

1. `announces the proxy with its free connection slots`: `gateway:announce` mit `{ gatewayId: "proxy-og", connect: true, freeSlots: 3, slotLimit: 3 }`.
2. `connects to a BLE device`: `gatt:connect` → `{ error: null, result: { mtu } }`; der Fake-Proxy hat eine Verbindung zu der Adresse; danach meldet der Adapter `freeSlots: 2`.
3. `lists the services`: `gatt:getServices` → die Services aus B9 mit kanonischen UUIDs.
4. `reads and writes a characteristic`: Wert setzen, lesen, schreiben, erneut lesen.
5. `forwards notifications`: `gatt:subscribe`, der Proxy hat den CCCD-Descriptor (Handle 33) mit `0100` geschrieben bekommen; `proxy.notify()` → `gateway:notification` mit Adresse, Handle und Daten.
6. `reports a connection the BLE device closed`: `proxy.dropBleConnection()` → `gateway:connectionState` mit `connected: false`; `gatt:read` danach → `NOT_CONNECTED`.
7. `disconnects`: neu verbinden, `gatt:disconnect` → `{}`; der Fake-Proxy hat keine Verbindung mehr; es kam **kein** `gateway:connectionState`.
8. `refuses commands from other instances`: `gatt:connect` mit `from: "system.adapter.test.0"` → `INVALID_PAYLOAD`.
9. `reports a failed connection`: `proxy.failNextConnect(133)` → `CONNECT_FAILED`.

Suite `BLE GATT - cleaning up`:

1. `closes the connections when ioBroker.ble stops`: verbinden, dann den State `system.adapter.ble.0.alive` auf `false` setzen → der Fake-Proxy hat innerhalb von 5 s keine Verbindung mehr.
2. `closes the connections when ioBroker.ble was restarted`: verbinden, dann `gatt:connect` für ein zweites Gerät mit einem anderen `epoch` → die erste Verbindung ist getrennt, die zweite steht.
3. `closes the connections when the adapter stops`: verbinden, `harness.stopAdapter()` → der Fake-Proxy hat eine Trenn-Nachricht bekommen.

### C6. Dokumentation

- `README.md`, Abschnitt „Bluetooth proxies“: den Satz „Only passive reception is forwarded so far“ ersetzen. Neu: Verbindungen zu BLE-Geräten sind möglich, wenn der Proxy `bluetooth_proxy: active: true` hat; ein ESP32 hat meist 3 Verbindungsplätze.
- Changelog-Zeile unter `### **WORK IN PROGRESS**`.
- `AGENTS.md`, Abschnitt „Bluetooth proxies (BLE forwarding)“: `bleGattBridge.ts` beschreiben, den Punkt „Not implemented yet“ entfernen, die Erkenntnisse aus C0 (Punkte 1, 3 und 7) aufnehmen.

Fertig mit Teil C, wenn `./node_modules/.bin/eslint --max-warnings 0 .`, `npm run check`, `npm run build`, `npm test` und `npm run test:integration` bestehen.

---

## 3. Gegenprobe über beide Repos

Wenn A, B und C fertig sind, prüfe einmal von Hand, dass beide Seiten dieselbe Sprache sprechen. Schreibe ein Wegwerf-Skript (nicht einchecken), das:

1. einen `BleGattBridge` (aus `build/` von `esphome`) mit einer Fake-Verbindung aufbaut,
2. einen `RemoteGatewayTransport` (aus `build/` von `ble`) so mit ihm verbindet, dass dessen `sendTo` direkt `bridge.handleMessage()` aufruft und die Antwort zurückgibt,
3. `connect`, `getServices`, `read`, `write`, `subscribe`, `disconnect` über den Link ausführt und die Ergebnisse ausgibt.

Halte das Ergebnis im Abschlussbericht fest.

## 4. Abschlussbericht

Schreibe am Ende in deiner Antwort (nicht in eine Datei):

- welche Schritte umgesetzt sind und welche Tests dafür laufen (Anzahl bestanden/fehlgeschlagen pro Repo),
- jede Stelle, an der du von diesem Dokument abgewichen bist, mit Grund,
- was nicht an Hardware geprüft ist. Das ist mindestens: der ganze Weg mit einem echten ESP32, und der CCCD-Descriptor aus C0 Punkt 7.

Aktualisiere danach in `docs/plan-bluetooth-infrastructure.md` nur die Statuszeile am Anfang und die Zeile von Phase 2 in der Tabelle in Abschnitt 7.
