# pvvx-Thermometer: GATT-Protokoll für Zeit und Firmware-Update

Stand 2026-11-17 · Grundlage für die Phasen 3 und 4 in `docs/plan-bluetooth-infrastructure.md`

Dieses Dokument beschreibt, wie man mit Geräten spricht, auf denen die Firmware [pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer) läuft: Uhrzeit lesen und setzen, Version und Modell ermitteln, Firmware aktualisieren. Es ist aus dem Quellcode abgeleitet. **Nichts davon ist in diesem Projekt an einem echten Gerät ausprobiert.** Was aus dem Quellcode nicht eindeutig hervorgeht, steht in Abschnitt 9.

## 1. Quellen

| Quelle | Stand | Wofür |
|---|---|---|
| Firmware, `pvvx/ATC_MiThermometer` | Commit `b02b513` (2026-11-02), Version 5.9 | maßgeblich für alles, was das Gerät tut |
| `src/cmd_parser.c`, `src/cmd_parser.h` | | Befehle auf `0x1F1F`, Antworten |
| `src/app_att.c` | | Services, Characteristics, Rechte |
| `src/ble.c`, `src/ext_ota.c` | | Update-Start, Timeout, erweitertes Update |
| `SDK/components/stack/ble/service/ble_ll_ota.h` | | Befehle und Fehlercodes des Telink-Updates |
| `utils/ble_ota.py` | | Referenz-Client für das Update, in Python, vom Firmware-Repo selbst |
| `firmware.json` | | aktuelle Version und Image pro Modell |
| Web-Flasher `TelinkMiFlasher.html`, `pvvx/pvvx.github.io` | Commit `1c349c8` (2026-11-12) | Referenz-Client für alles, in JavaScript |

Wo Firmware und Clients sich unterscheiden, gilt die Firmware. Die beiden Clients sind die Belege dafür, was in der Praxis funktioniert.

## 2. Services und Characteristics

| Zweck | Service | Characteristic | Eigenschaften |
|---|---|---|---|
| Befehle | `00001f10-0000-1000-8000-00805f9b34fb` | `00001f1f-0000-1000-8000-00805f9b34fb` | Read, Write Without Response, Notify |
| Firmware-Update (Telink OTA) | `00010203-0405-0607-0809-0a0b0c0d1912` | `00010203-0405-0607-0809-0a0b0c0d2b12` | Read, Write Without Response |

Regeln:

1. **Sprich Characteristics immer über ihre UUID an.** Die Handles hängen vom Modell und von der Firmware-Variante ab.
2. Beide Characteristics deklarieren nur „Write Without Response“. Der Web-Flasher schreibt entsprechend ohne Antwort. `ble_ota.py` schreibt mit Antwort (`response=True`), und das funktioniert laut dieser Referenz ebenfalls. Welche Art über einen ESPHome-Proxy zuverlässig ist, ist offen (Abschnitt 9).
3. **Geräte mit gesetztem PIN-Code sind nicht erreichbar.** Ist ein PIN-Code gesetzt, verlangen beide Characteristics eine verschlüsselte Verbindung mit Pairing (`ATT_PERMISSIONS_SECURE_CONN_RDWR` in `my_att_init`). Das kann unser Weg über Gateways nicht. Ein Driver muss den Fehler sauber melden.
4. Die Geräte senden verbindbare Advertisements (`ADV_TYPE_CONNECTABLE_UNDIRECTED`). Ihr Sendeintervall liegt je nach Einstellung zwischen 62,5 ms und 10 s, ein Verbindungsaufbau kann deshalb mehrere Sekunden dauern.

## 3. Der Befehlskanal `0x1F1F`

### Rahmen

- **Anfrage:** ein Write auf `0x1F1F`. Byte 0 ist die Befehlsnummer, danach folgen die Daten des Befehls.
- **Antwort:** eine Notification auf `0x1F1F`. Byte 0 ist wieder die Befehlsnummer, danach folgen die Daten der Antwort.
- Alle Mehrbyte-Werte sind Little Endian.
- Eine Antwort ist höchstens 20 Bytes lang.

### Regeln für einen Client

1. **Schalte zuerst die Notifications für `0x1F1F` ein**, dann schreibe den Befehl. Beide Referenz-Clients tun das. Ohne Abo geht die Antwort verloren.
2. **Ordne Antworten über Byte 0 zu.** Das Gerät kann jederzeit von sich aus Notifications senden, vor allem Messwerte mit der Befehlsnummer `0x33` (immer dann, wenn in der Geräte-Konfiguration „Messwerte bei Verbindung senden“ gesetzt ist). Verwirf alles, dessen Byte 0 nicht zum erwarteten Befehl passt.
3. **Ein Befehl ohne Daten liest, ein Befehl mit Daten schreibt.** Das gilt für `0x23` (Zeit) und auch für `0x55` (Konfiguration): `55` allein liest die Konfiguration, `55` mit weiteren Bytes **überschreibt** sie. Schicke zum Lesen genau ein Byte.
4. Auf einen unbekannten Befehl antwortet das Gerät mit `[Befehl] ff`.
5. Warte auf eine Antwort höchstens 10 s (Wert aus `ble_ota.py`).

### Befehle, die für uns wichtig sind

| Nr. | Name | Anfrage | Antwort |
|---|---|---|---|
| `0x55` | Konfiguration lesen | `55` | 13 Bytes, siehe 4.1 |
| `0x00` | Geräte-ID | `00` | 12 Bytes, siehe 4.2 |
| `0x23` | Zeit lesen oder setzen | `23` oder `23` + 4 Bytes | 5 oder 9 Bytes, siehe 5 |
| `0x24` | Gangkorrektur der Uhr | – | nicht benutzen, siehe 5.4 |
| `0x73` | Erweitertes Update vorbereiten | – | nicht benutzen, siehe 6.7 |

Die vollständige Liste steht in `src/cmd_parser.h` der Firmware. Benutze keinen Befehl, der in diesem Dokument nicht beschrieben ist.

## 4. Version und Modell ermitteln

Für ein Update braucht man die installierte Version und die **Hardware-ID**. Sie bestimmt, welches Image zum Gerät passt.

### 4.1 Konfiguration (`0x55`), der Weg der Referenz

`ble_ota.py` und der Web-Flasher lesen beides aus der Antwort auf `55`:

| Offset | Größe | Inhalt |
|---|---|---|
| 0 | 1 | `0x55` |
| 1 | 1 | Firmware-Version, BCD: `0x59` = Version 5.9 |
| 2–9 | 8 | Einstellungen (Flags, Intervalle, Sendeleistung). Für uns ohne Bedeutung. |
| 10 | 1 | Einstellung des Displays. Bei sehr alter Firmware steckt hier ein Teil der Hardware-ID (siehe unten). |
| 11 | 1 | Hardware-Version (`hw_ver`), nur lesbar |
| 12 | 1 | Mittelung der Messwerte |

Die Antwort kann bei alter Firmware kürzer sein. So wird daraus die Hardware-ID (Funktion `parse_cfg` in `ble_ota.py`, gleichwertig zu `CustomBlkParse` im Web-Flasher):

```
ver = antwort[1]
wenn Länge < 12:             Hardware-ID unbekannt
hver = antwort[11]
wenn ver < 0x36:             hver = hver & 0x87
wenn ver >= 0x48:            Hardware-ID = hver
sonst:                       id = hver & 0x0F
                             wenn id == 0x0F: Hardware-ID = 16 + (antwort[10] & 0x7F)
                             sonst:           Hardware-ID = id
```

Eine Antwort mit weniger als 10 Bytes oder mit Byte 0 ≠ `0x55` ist ungültig.

### 4.2 Geräte-ID (`0x00`)

Neuere Firmware beantwortet zusätzlich `00`:

| Offset | Größe | Inhalt |
|---|---|---|
| 0 | 1 | `0x00` |
| 1 | 1 | Revision des Protokolls, `0` |
| 2 | 2 | Hardware-ID |
| 4 | 2 | Software-Version, unteres Byte ist die Version in BCD |
| 6 | 2 | Sensortypen |
| 8 | 4 | Bitmaske der Fähigkeiten: Bit 0 Update, Bit 1 erweitertes Update, Bit 2 PIN-Code, Bit 12 Gangkorrektur der Uhr, Bit 13 eingebaute Echtzeituhr |

Ab welcher Firmware-Version es diesen Befehl gibt, geht aus dem Quellcode nicht hervor. Nimm deshalb `0x55` als Hauptweg und `0x00` höchstens als Ergänzung.

### 4.3 Ein pvvx-Gerät erkennen

Sicher erkennt man die Firmware nur über eine Verbindung: Das Gerät hat den Service `0x1F10` und beantwortet `55` mit einer gültigen Antwort.

Aus den Advertisements allein geht es nur ungefähr:

- Die Firmware sendet je nach Einstellung in einem von vier Formaten: atc1441 und pvvx-Custom (beide Service-Daten `0x181A`), Xiaomi (`0xFE95`) oder BTHome (`0xFCD2`). BTHome-Pakete eines pvvx-Geräts sehen aus wie die jedes anderen BTHome-Geräts.
- Der Gerätename steht in der Scan-Response. Ab Werk ist er `ATC_` plus die letzten drei Bytes der MAC als Hex-Zahl (bei anderen Modellen `MHO_`, `CGG_`, `CGD_`, `BTH_` und weitere). Der Name lässt sich ändern. Scan-Responses kommen nur an, wenn der Empfänger aktiv scannt.

Ein Driver sollte Geräte deshalb nicht automatisch behandeln, sondern nur solche, die der Benutzer ausgewählt hat, und sie beim ersten Verbinden über `55` prüfen.

## 5. Uhrzeit (`0x23`)

### 5.1 Bedeutung des Werts

Das Gerät führt einen Sekundenzähler (`wrk.utc_time_sec`, 32 Bit ohne Vorzeichen) und zählt ihn jede Sekunde um eins hoch. Die Anzeige rechnet daraus direkt Stunden und Minuten (`show_clock`: `min = wert / 60 % 60`, `std = wert / 3600 % 24`). **Das Gerät kennt keine Zeitzone und keine Sommerzeit.**

Damit das Display die lokale Zeit zeigt, muss der Wert die lokale Zeit sein, ausgedrückt als Unix-Zeit:

```
wert = Unix-Zeit in Sekunden (UTC) + Abstand der lokalen Zeit zu UTC in Sekunden
```

Für Wien im Winter ist der Abstand +3600, im Sommer +7200. Beide Referenz-Clients rechnen so:

- Web-Flasher: `Date.now() / 1000 - new Date().getTimezoneOffset() * 60`
- Python: `calendar.timegm(time.localtime(time.time()))`

In JavaScript, wie im Web-Flasher (ganzzahlig gemacht):

```ts
const now = new Date();
const value = Math.floor(now.getTime() / 1000) - now.getTimezoneOffset() * 60;
```

`getTimezoneOffset()` liefert Minuten und hat das umgekehrte Vorzeichen (Wien im Winter: `-60`). Maßgeblich ist die Zeitzone des Prozesses, in dem der Adapter läuft.

**Folge für die Zeitumstellung:** Bei jeder Umstellung zwischen Sommer- und Winterzeit ändert sich der Abstand, die Uhr des Geräts läuft aber einfach weiter. Danach geht sie genau eine Stunde falsch, bis jemand die Zeit neu setzt.

### 5.2 Zeit setzen

Anfrage, 5 Bytes:

| Offset | Größe | Inhalt |
|---|---|---|
| 0 | 1 | `0x23` |
| 1 | 4 | `wert`, Little Endian |

Schicke immer genau 4 Datenbytes. Das Gerät übernimmt auch weniger Bytes und überschreibt dann nur einen Teil des Zählers.

Das Gerät antwortet wie beim Lesen (5.3), mit dem neuen Wert. Geräte mit Gangkorrektur merken sich den gesetzten Wert zusätzlich als „zuletzt gesetzt“.

### 5.3 Zeit lesen

Anfrage: `23` (ein Byte).

Antwort:

| Offset | Größe | Inhalt |
|---|---|---|
| 0 | 1 | `0x23` |
| 1 | 4 | aktueller Zählerstand, Little Endian |
| 5 | 4 | Zählerstand beim letzten Setzen. **Nur vorhanden bei Geräten mit Gangkorrektur** (Fähigkeit Bit 12), die Antwort hat dann 9 statt 5 Bytes. |

Ein Client muss beide Längen annehmen. Eine Antwort mit weniger als 5 Bytes ist ungültig.

Abweichung der Uhr in Sekunden:

```
abweichung = zählerstand - (Unix-Zeit jetzt + Abstand zu UTC jetzt)
```

Positiv heißt: Die Uhr des Geräts geht vor. Nach einer Zeitumstellung, die das Gerät verpasst hat, ist die Abweichung ungefähr +3600 (Herbst) oder −3600 (Frühjahr).

Rechne mit Zahlen ohne Vorzeichen. Der Zählerstand überschreitet im Jahr 2038 die Grenze von 31 Bit, das Gerät rechnet mit 32 Bit ohne Vorzeichen.

### 5.4 Was ein Driver nicht tun soll

- **Keine Gangkorrektur (`0x24`).** Der Web-Flasher kann aus der gemessenen Abweichung den Takt der Uhr nachstellen und schreibt das Ergebnis dauerhaft ins Gerät. Das setzt voraus, dass seit dem letzten Setzen keine Zeitumstellung lag. Ein automatischer Zeitsync soll das nicht anfassen.
- **Keine Annahme über die Zeit nach einem Neustart des Geräts.** Nach einem Batteriewechsel beginnt der Zähler neu, bei Geräten mit Messwertspeicher beim Zeitstempel des letzten gespeicherten Eintrags (`logger.c`). Lies die Zeit, statt sie zu schätzen.

## 6. Firmware-Update (Telink OTA)

### 6.1 Überblick

Das Update schreibt das neue Image in einen freien Bereich des Flash-Speichers. Erst wenn alles übertragen und geprüft ist, startet das Gerät neu und benutzt die neue Firmware. Laut README der Firmware bleibt bei einem abgebrochenen Update die alte Firmware erhalten, und ein Update dauert etwa 4 Minuten.

Alle Pakete gehen als Write an die Update-Characteristic (`…2b12`). Das Image wird in Blöcken zu 16 Bytes übertragen.

### 6.2 Image prüfen, bevor irgendetwas gesendet wird

Ein Image ist nur gültig, wenn alle Punkte zutreffen (Funktion `testOTAFirmware` im Web-Flasher):

1. Es ist mindestens 1024 Bytes groß.
2. Es ist höchstens `0x20000` Bytes (128 KiB) groß. Größere Images brauchen das erweiterte Update (6.7).
3. Bytes 8 bis 11 sind `4b 4e 4c 54` (ASCII `KNLT`).
4. Der 32-Bit-Wert bei Offset `0x18` (Little Endian) ist die Länge `n` des Images. Es gilt `n` ≤ Dateigröße und `n & 0x0f == 4`.
5. Die letzten 4 Bytes des Images (Offset `n − 4`, Little Endian) sind die Prüfsumme über die Bytes `0` bis `n − 5`. Die Prüfsumme ist CRC-32 mit dem Polynom `0xEDB88320` und dem Startwert `0xFFFFFFFF`, **ohne** das abschließende Invertieren. Das entspricht `crc32(daten) XOR 0xFFFFFFFF` der üblichen Bibliotheken (zlib, Node.js `zlib.crc32`).

Beginnt die Datei mit `1e f1 ee 0b`, ist es ein Zigbee-Image. Solche Images lehnen wir ab.

### 6.3 Das richtige Image auswählen

`firmware.json` im Stamm des Firmware-Repos (`https://raw.githubusercontent.com/pvvx/ATC_MiThermometer/master/firmware.json`) enthält:

- `version`: die aktuelle Version als Zahl. `89` ist `0x59`, also 5.9.
- `custom`: eine Liste von Pfaden, **der Index ist die Hardware-ID**. `"?"` heißt: Für dieses Modell gibt es kein BLE-Image.

Regeln (so macht es `ble_ota.py`):

1. Hardware-ID unbekannt, außerhalb der Liste oder Eintrag endet nicht auf `.bin` → kein Update.
2. Installierte Version ≥ `version` → nichts zu tun.
3. Sonst das Image unter `https://raw.githubusercontent.com/pvvx/ATC_MiThermometer/master/<Pfad>` laden und nach 6.2 prüfen.

Die Listen `original` und `signed` enthalten die Original-Firmware des Herstellers. **Die spielen wir nie ein.**

Stand der Tabelle beim Schreiben dieses Dokuments (maßgeblich ist immer die aktuelle `firmware.json`):

| ID | Modell | Image |
|---|---|---|
| 0, 3, 4, 5, 10, 14 | LYWSD03MMC (verschiedene Hardware-Revisionen) | `bin/ATC_v59.bin` |
| 1 | MHO-C401 (alt) | `bin/MHO_C401_v59.bin` |
| 8 | MHO-C401 (2022) | `bin/MHO_C401N_v59.bin` |
| 2 | CGG1-M (2020, 2021) | `bin/CGG1_v59.bin` |
| 7 | CGG1-M (2022) | `bin/CGG1M_v59.bin` |
| 6 | CGDK2 | `bin/CGDK2_v59.bin` |
| 9 | MJWSD05MMC (ch) | `bin/BTH_v59.bin` |
| 12 | MJWSD05MMC (en) | `bin/BTE_v59.bin` |
| 13 | MJWSD06MMC | `bin/MJ6_v59.bin` |
| 11 | MHO-C122 | `bin/MHO_C122_v59.bin` |
| 49 | LYWSD02MMC | `bin/LYWSD02MMC_v59.bin` |

Die Liste hat 60 Einträge, darunter weitere Modelle (Tuya, Zigbee-Hardware mit BLE-Firmware). Für 23 IDs steht `"?"`.

### 6.4 Ablauf

Das Image wird zuerst mit `0xFF` auf ein Vielfaches von 16 Bytes aufgefüllt. `N` ist die Zahl der Blöcke.

| Schritt | Paket (hex) | Bedeutung |
|---|---|---|
| 1 | `00 ff` | Versionsabfrage (`CMD_OTA_FW_VERSION`) |
| 2 | `01 ff` | Start (`CMD_OTA_START`). Das Gerät zeigt den Update-Bildschirm und erwartet ab jetzt Blöcke. |
| 3 | 300 ms warten | Wert aus beiden Referenzen |
| 4 | `N` Datenpakete, Index `0` bis `N − 1`, in dieser Reihenfolge | siehe 6.5 |
| 5 | `02 ff` + letzter Index + invertierter letzter Index | Ende (`CMD_OTA_END`), siehe 6.5 |

Nach Schritt 5 prüft das Gerät das Image und startet neu. **Auf das Ende-Paket kommt keine Antwort**, die Verbindung bricht ab. Das ist der Erfolgsfall. `ble_ota.py` schreibt dieses Paket deshalb ohne Antwort.

Erfolg stellt man danach über die Advertisements oder eine neue Verbindung fest: Das Gerät meldet sich wieder, und `55` liefert die neue Version.

### 6.5 Paketformate

Datenpaket, 20 Bytes:

| Offset | Größe | Inhalt |
|---|---|---|
| 0 | 2 | Index des Blocks, Little Endian, beginnend bei 0 |
| 2 | 16 | Daten des Blocks |
| 18 | 2 | CRC-16 über die Bytes 0 bis 17, Little Endian |

CRC-16: Modbus-Variante. Startwert `0xFFFF`, Polynom `0xA001` (gespiegelt), kein abschließendes Invertieren. Prüfwert: Die ASCII-Zeichen `123456789` ergeben `0x4B37`.

Ende-Paket, 6 Bytes:

| Offset | Größe | Inhalt |
|---|---|---|
| 0 | 2 | `02 ff` |
| 2 | 2 | Index des letzten Blocks (`N − 1`), Little Endian |
| 4 | 2 | derselbe Wert bitweise invertiert (`~(N − 1) & 0xFFFF`), Little Endian |

### 6.6 Flusskontrolle, Status und Zeitlimit

- **Status lesen:** Ein Read auf die Update-Characteristic liefert ein Byte mit dem Stand des Updates. Beide Referenzen lesen ihn nach jedem achten Datenpaket (nach den Paketen mit Index 7, 15, 23, …) und brechen ab, wenn er nicht `0` ist.

    | Wert | Bedeutung |
    |---|---|
    | 0 | kein Fehler |
    | 1 | ein oder mehrere Pakete verloren |
    | 2 | CRC-Fehler in einem Paket |
    | 3 | Fehler beim Schreiben in den Flash |
    | 4 | die letzten Pakete fehlen |
    | 5 | Zeitlimit überschritten |
    | 6 | Prüfung des Images fehlgeschlagen |

- **Zeitlimit zwischen Paketen: 16 s.** Die Firmware setzt das Limit beim Start auf 16 s und startet es bei jedem empfangenen Paket neu (`otaWritePre` in `ble.c`). Kommt 16 s lang nichts, bricht das Gerät das Update ab.
- **Reihenfolge:** Die Pakete müssen lückenlos in aufsteigender Reihenfolge ankommen. Ein verlorenes Paket führt zu Status 1. Es gibt kein Wiederholen einzelner Pakete: Nach einem Fehler beginnt man das Update von vorn, mit einer neuen Verbindung.
- **Schreibart:** Der Web-Flasher schreibt die Datenpakete ohne Antwort und nutzt das Lesen des Status als Bremse. `ble_ota.py` schreibt jedes Datenpaket mit Antwort. Beides ist belegt.
- **Batterie:** Das README verlangt für LYWSD03MMC mehr als 40 % Batterie für ein zuverlässiges Update. Die Firmware selbst prüft das nicht. Der Batteriestand steht in den Advertisements.

### 6.7 Erweitertes Update: nicht benutzen

Images über 128 KiB brauchen vorher den Befehl `0x73` auf dem Befehlskanal. Er löscht einen zusätzlichen Flash-Bereich und damit **die Xiaomi-Schlüssel und den Messwertspeicher** des Geräts. Der Web-Flasher fragt dafür ausdrücklich nach.

Die aktuellen BLE-Images sind rund 86 KiB groß und brauchen das nicht. Ein Driver lehnt Images über `0x20000` Bytes ab und sendet `0x73` nie.

## 7. Testvektoren

Alle Werte sind mit den Algorithmen aus Abschnitt 5 und 6 berechnet. Die Vektoren zum Image stammen aus der echten Datei `bin/ATC_v59.bin` des Firmware-Repos.

### 7.1 Zeit setzen, Zeitzone Europe/Vienna

| Zeitpunkt (UTC) | Unix-Zeit | Abstand | lokale Zeit | `wert` | Paket |
|---|---|---|---|---|---|
| 2026-01-15 12:00:00 | 1768478400 | +3600 | 13:00:00 | 1768482000 (`0x6968E4D0`) | `23 d0 e4 68 69` |
| 2026-07-01 10:00:00 | 1782900000 | +7200 | 12:00:00 | 1782907200 (`0x6A450140`) | `23 40 01 45 6a` |
| 2026-10-25 00:59:59 | 1792889999 | +7200 | 02:59:59 | 1792897199 (`0x6ADD70AF`) | `23 af 70 dd 6a` |
| 2026-10-25 01:00:00 | 1792890000 | +3600 | 02:00:00 | 1792893600 (`0x6ADD62A0`) | `23 a0 62 dd 6a` |
| 2027-03-28 00:59:59 | 1806195599 | +3600 | 01:59:59 | 1806199199 (`0x6BA8699F`) | `23 9f 69 a8 6b` |
| 2027-03-28 01:00:00 | 1806195600 | +7200 | 03:00:00 | 1806202800 (`0x6BA877B0`) | `23 b0 77 a8 6b` |

Die Zeilen 3 und 4 sind die Umstellung auf Winterzeit: Eine Sekunde später ist `wert` um 3599 kleiner. Ein Gerät, das um 00:59:59 UTC gesetzt wurde und weiterläuft, zeigt danach eine Abweichung von +3600.

### 7.2 Zeit lesen

| Antwort | Ergebnis |
|---|---|
| `23 d0 e4 68 69` | Zählerstand 1768482000, kein „zuletzt gesetzt“ |
| `23 d0 e4 68 69 40 01 45 6a` | Zählerstand 1768482000, zuletzt gesetzt 1782907200 |
| `23 d0 e4 68` | ungültig (zu kurz) |
| `33 …` | keine Antwort auf `23`, verwerfen |

### 7.3 Konfiguration (aus dem Selbsttest von `ble_ota.py`)

| Antwort | Version | Hardware-ID |
|---|---|---|
| `55 59 00 00 00 00 0a 04 8b 00 37 00` | `0x59` (5.9) | 0 |
| `55 40 00 00 00 00 00 00 00 00 83 0f` | `0x40` (4.0) | 19 (= 16 + 3, alte Firmware mit erweiterter ID) |
| `55 59` | ungültig | – |

### 7.4 Image `bin/ATC_v59.bin`

| Eigenschaft | Wert |
|---|---|
| Größe | 86308 Bytes (`0x15124`) |
| SHA-256 | `85c4104071174535c162a8eb72781f3f52cb776998119fb2cba6c24ca5758994` |
| Bytes 0–31 | `2680013099995d024b4e4c545b078800868041110a0200002451010000000000` |
| Kennung, Bytes 8–11 | `4b 4e 4c 54` |
| Länge bei Offset `0x18` | `24 51 01 00` = 86308 |
| Prüfsumme, letzte 4 Bytes | `58 a0 4c 6f` = `0x6F4CA058` |
| Auffüllung | 12 Bytes `0xFF` |
| Blöcke `N` | 5395 |

| Paket | Bytes |
|---|---|
| Datenpaket 0 | `0000 2680013099995d024b4e4c545b078800 bdb5` |
| Datenpaket 1 | `0100 868041110a0200002451010000000000 6e75` |
| Datenpaket 5394 (letztes) | `1215 58a04c6fffffffffffffffffffffffff dc2d` |
| Ende-Paket | `02ff 1215 edea` |

Die Leerzeichen trennen nur die Felder. Im letzten Datenpaket stehen die 4 Bytes der Prüfsumme des Images, danach die Auffüllung.

### 7.5 Kleines Beispiel ohne Datei (aus dem Selbsttest von `ble_ota.py`)

Ein „Image“ aus 20 Bytes `0x01` ergibt 2 Blöcke. Block 1 enthält 4 Bytes `0x01` und 12 Bytes `0xFF`. Das Ende-Paket ist `02 ff 01 00 fe ff`.

## 8. Hinweise für die Spezifikationen von Phase 3 und 4

Das sind Folgerungen aus dem Protokoll, keine Vorgaben. Die Spezifikationen legen fest, wie es gebaut wird.

- **Zeitsync ist klein:** eine Verbindung, Notifications einschalten, ein Write, eine Notification abwarten. Mit dem Lesen vorher sind es zwei Befehle. Das passt ohne Änderung auf die Session aus Phase 2.
- **Antworten filtern:** Der Driver braucht eine Hilfsfunktion „Befehl senden und auf die Notification mit derselben Befehlsnummer warten“, die fremde Notifications überspringt.
- **Ein Update hat etwa 5400 Pakete und 675 Statusabfragen.** Jedes Paket einzeln per `sendTo` an den Lieferanten zu schicken, sind über 6000 Hin- und Rückwege durch die States-DB. Dafür ist `gatt:writeSequence` gedacht. Ein natürlicher Zuschnitt wäre: 8 Pakete schreiben, dann einmal lesen.
- **Das Zeitlimit von 16 s** gilt zwischen zwei Paketen. Eine hängende Sammeloperation darf nie länger dauern.
- **Kein Wiederaufsetzen:** Nach einem Fehler wird neu verbunden und von vorn begonnen. Die Zahl der Versuche muss begrenzt sein.
- **Erfolg prüfen** kann der Driver erst nach dem Neustart des Geräts, über eine neue Verbindung und `55`.
- **Vor dem Update prüfen:** Image gültig (6.2), passt zur Hardware-ID (6.3), Version neuer, Batterie über 40 %, Empfang am gewählten Gateway gut genug.

## 9. Offene Punkte, an Hardware zu klären

1. **Schreibart über einen ESPHome-Proxy.** Beide Characteristics deklarieren nur „Write Without Response“. Zu klären ist, ob Writes mit Antwort über den Proxy ankommen (wie in `ble_ota.py` über BlueZ) und welche Art für das Update schneller und zuverlässiger ist.
2. **Kommen Antworten auch ohne aktivierte Notifications im Gerät an?** Die Firmware prüft das Abo nur für Messwerte. Beide Clients schalten Notifications vorher ein, also tun wir das auch.
3. **Dauer und Zuverlässigkeit eines Updates über einen Proxy.** Die 4 Minuten aus dem README gelten für eine direkte Verbindung.
4. **Verhalten bei gesetztem PIN-Code:** welcher Fehler am Proxy ankommt.
5. **Seit welcher Version** es den Befehl `0x00` gibt.
6. **Zähler nach Batteriewechsel:** Startwert bei Geräten ohne Messwertspeicher.
7. **Status nach dem letzten Datenpaket:** Ob ein Lesen des Status zwischen letztem Datenpaket und Ende-Paket sinnvoll ist, wenn `N` kein Vielfaches von 8 ist. Die Referenzen lesen dort nicht.
