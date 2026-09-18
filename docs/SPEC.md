# RN Analyzer 2.0 – Spezifikation

**Stand:** 2026-09-18 · **App-Version:** 2.0.0 · **Repository:** github.com/maxzmacrix/rnanalyzer

Dieses Dokument ist die gültige Beschreibung der Software: Vision, Umfang, Architektur, Datenmodell, Schnittstellen,
Build und Qualitätssicherung. Es ist so geschrieben, dass eine Person ohne Zugang zum Code oder zu internen Gesprächen die
Software versteht und bewerten kann. Es wird mit jeder fachlichen oder architektonischen Änderung im selben Commit
aktualisiert (siehe Abschnitt 12). Die Anleitung zum Bauen, Signieren und Veröffentlichen steht im `README.md`; dieses
Dokument wiederholt sie nicht.

*English summary:* RN Analyzer 2.0 is the successor of the Race Navigator iPad app: a dependency-free, offline-first web app
(HTML/CSS/ES modules) for importing, comparing and explaining motorsport laps recorded by Race Navigator devices. It runs in
the browser, as an installable PWA and, wrapped in Capacitor shells, as native iOS and Android apps that talk to the
unmodified device over its local Wi-Fi. All data stays on the user's device. This document is the living specification.

---

## 1. Vision

**Ein Fahrer soll nach der Session in unter einer Minute wissen, wo er Zeit verliert und warum.**

Der RN Analyzer 2.0 ersetzt die 2013 bis 2020 gepflegte iPad-App (Objective-C) durch eine Software, die

1. auf jedem Gerät des Kunden läuft (iPhone, iPad, Android, Desktop-Browser), ohne dass Macrix pro Plattform eine eigene
   Codebasis pflegt;
2. ohne Server, Konto und Cloud funktioniert, auch in der Boxengasse ohne Netz;
3. die Antwort zuerst zeigt (Abstand zur schnellsten Runde, wo auf der Strecke, warum in der Kurve) statt den Nutzer mit
   Telemetrie-Kanälen allein zu lassen;
4. den unveränderten Race Navigator im Feld weiter bedient (Import und Steuerung über sein WLAN), weil die Geräte beim Kunden
   stehen und keine Firmware-Änderung vorausgesetzt werden darf.

### Leitprinzipien (Entscheidungsgrundlage bei Zielkonflikten)

| Prinzip | Bedeutung in der Praxis |
|---|---|
| **Daten bleiben auf dem Gerät** | Keine Konten, kein Backend, keine Telemetrie an Macrix. Externe Aufrufe nur für Kartenkacheln, Wetter und die Android-Update-Prüfung, alle abschaltbar oder ohne Personenbezug. KI-Texte entstehen auf dem Gerät. |
| **Null Abhängigkeiten, kein Build-Schritt** | `app/` ist direkt auslieferbar. Keine Frameworks, kein Bundler, kein npm-Paket zur Laufzeit. Capacitor wird nur für die nativen Hüllen gebraucht. |
| **Antwort zuerst** | Jede Ansicht beginnt mit dem Ergebnis (Abstand, Zeitverlust, Tipp), Details sind einen Tipp entfernt. Klartext statt Fachbegriffe. |
| **Ein Weg, nicht drei** | Ein Analyse-Bildschirm, eine Vergleichsgeste, ein Verbindungszustand zum Gerät. Optionen werden entfernt, wenn sie eine Voreinstellung ersetzen kann. |
| **Bedienbar mit Handschuhen** | Tippziele mindestens 40 px, Play-Leiste in der Daumenzone, Querformat mit Seitenleiste, Systemthema (hell am Tag). |
| **Deterministisch vor generativ** | Der Coach rechnet nachvollziehbar aus Messdaten. Ein Sprachmodell formuliert höchstens die berechneten Fakten um und erfindet keine. |

### Nicht-Ziele

Bewusst nicht Teil dieses Produkts (Begründungen in Abschnitt 11): Cloud-Speicher, Nutzerkonten, Community-Funktionen
(Chat, Teams, Ranglisten, Event-Marktplatz), Abo-Modell, Facebook/YouTube-Upload mit Login, E-Mail-Versand aus der App,
VNC-Fernsteuerung, Synchronisation von Messungen über verschiedene Streckenvarianten.

---

## 2. Zielgruppen und Nutzungssituationen

| Nutzer | Situation | Was die App liefern muss |
|---|---|---|
| Fahrer (Trackday, Tourenfahrt, Rennen) | In der Box zwischen zwei Turns, Handy in der Hand, oft ohne Netz | Runden vom Gerät holen, „Mit Bestzeit vergleichen“, Karte rot/grün, Coach-Tipp, Video mit Overlay |
| Fahrer zu Hause | Tablet oder PC, Zeit für Details | Bis zu 10 Runden, 4 Videos, Kanalwahl, Sektorzeiten, G-Diagramm, Excel-Export |
| Coach / Instruktor | Kundendaten, fremde Geräte | Import aus Dateien (USB, AirDrop, WhatsApp), Vergleich fremder Runden, Teilen als `.rnz` |
| Werkstatt / Support | Gerät prüfen, Runden aufräumen, Software-Stand | Tab Race Navigator: Status, Aufnahme, Fahrer/Fahrzeug/Strecke, Kameravorschau, Aktionen |
| Interessent ohne Gerät | Store oder Web-Link | Geführte Tour mit Beispieldaten, Hinweis auf die native App |

---

## 3. Produktumfang

Die App hat vier Tabs. In der Web-Version fehlt der Tab Race Navigator, weil der Browser das Gerät nicht erreichen kann
(Abschnitt 7.1); der Hinweis auf die native App steht dann in der leeren Rundenliste und unter Einstellungen.

### 3.1 Runden (`#/laps`)

* Liste aller importierten Runden, gruppiert nach Event, Strecke und Gerät. Farbcodes: weiß = vollständig, grau =
  unvollständig, gelb = beste Runde je Fahrer im Event. Badges für Video, Puls, Demodaten.
* Session-Kopf mit Wetter der Fahrstunden (Open-Meteo, gecacht, abschaltbar).
* Filter (vollständig, mit Video, Ausreißer), Sortierung nach Zeit, Suche über Fahrer, Fahrzeug, Strecke, Event, Rundenzeit.
* Auswahl von bis zu 10 Runden. Roter Knopf „Mit Bestzeit vergleichen (+0,391)“ öffnet die Analyse; „Vergleich vorschlagen“
  wählt eine typische Runde gegen die Bestzeit.
* Rundenmenü: Bearbeiten (Fahrer, Fahrzeug, Notiz, überschreibt die Gerätedaten nur zur Anzeige), Teilen (Rundendaten `.rnz`,
  Video `.mp4`, beides), Puls aus Apple Health / Health Connect laden (native App), Löschen (Runde, Video).
* Import über den Dateidialog: `.rnz`, `.rn`, `.xml`, `.mp4`/`.mov`/`.m4v`, sowie `.zip`-Ordner, die entpackt werden.
  Umbenannte Videos werden über die Dateigröße der Runde zugeordnet. Fehler werden in einem Satz gemeldet.

### 3.2 Analyse (`#/analyze`)

Ein Bildschirm, kein Modus-Umschalter. Aufbau von oben nach unten: Videos (bis zu 4, nebeneinander, Tipp vergrößert,
Lautsprecher schaltet Ton), zwei Panels (drei auf großen Bildschirmen), Play-Leiste unten.

* **Referenz** ist immer die schnellste vollständige Runde der Auswahl, unabhängig von der Tipp-Reihenfolge.
* **Panel-Komponenten** (frei belegbar, Standard Panel A = Abstand mit Geschwindigkeit als zweiter Kurve, Panel B = Karte,
  Panel C = Coach): Abstand zur schnellsten Runde (Zeitmodus: Distanzabstand), Kanal-Linienchart, Karte (schnellste Runde
  rot/grün nach Zeitverlust der verglichenen Runde eingefärbt, OSM oder Esri-Satellit, Start- und Sektorlinien,
  Kurvennummern, optional „Karte folgt dem Cursor“), G-Kraft (Streudiagramm Quer gegen Längs), Werte am Cursor,
  Rundenübersicht (Min/Max, Bestwerte markiert), Sektorzeiten (Gerätesektoren, geometrischer Fallback, eigene Sektoren;
  bestmögliche und zusammenhängend schnellste Runde), Kurven-Coach (Abschnitt 3.5).
* **Kanäle**: Geschwindigkeit, Längs-/Quer-/Vertikal-/kombinierte Beschleunigung, GPS-Abweichung, Höhe, Kurs, Gyroskop
  (Gier/Nick/Roll), OBD/CAN (Drehzahl, Gas, Wasser- und Öltemperatur, OBD-Geschwindigkeit, nur wenn im File vorhanden),
  Herzfrequenz, Custom-CAN-Kanäle aus `.cdrn`. Fünf Hauptzeilen sichtbar, Rest unter „Mehr Kanäle“.
* **Cursor** rot, synchron über Charts, Karte, Videos und Werte. X-Achse Distanz oder Zeit. Pinch = Zoom (horizontal X,
  vertikal Y), zwei Finger ziehen = Pan, Doppeltipp = Reset, Zoom-Synchronisation über Panels.
* **Play-Leiste**: Play/Pause, 5 s zurück, Tempo 0,25 bis 2× (Videos bis 2×, darüber taktgesteuert), laufende Abstände je Runde.
* **Optionen-Blatt**: Sektoren (Gerät, eigene, keine), Achse, Diagramm-Panels, Layout-Profile, Excel-Export (Kanäle,
  Distanzschritt, `.xlsx` ohne Bibliothek).
* Eigene Sektoren: langes Drücken im Chart oder Optionen → Eigene Sektoren, je Strecke gespeichert.

### 3.3 Race Navigator (`#/device`, nur native App)

Ein Verbindungszustand: Gerät erreichbar → Verbindungskarte, Steuerung und Import auf einer Seite; nicht erreichbar → ruhige
Karte mit „Erneut suchen“ (Bonjour `_racenav._tcp`) und „Adresse eingeben“.

* **Import**: Rundenliste vom Gerät mit Sortierung, Daten/Video-Auswahl, Download-Queue mit Fortschritt und Geschwindigkeit,
  Sprung in den Vergleich nach dem Download.
* **Steuerung** (ehemals RN Connect): Aufnahme an/aus und Modus (manuell, Auto 20/40 km/h, stehender Start, Auto-Drehzahl),
  Fahrer und Fahrzeug (wählen, anlegen, umbenennen), Strecke wechseln (Suche, Namen gecacht), Event-Typ und neues Event,
  Videoqualität und -layout, Statuskarte alle 4 s (GPS, Akku, Speicher, Restzeit, Zeit setzen, Warnungen), Kameravorschau
  (MJPEG, Kamera wechseln, drehen), Aktionen (Runden aufräumen, AP-Passwort, Ausschalten).
* Noch nicht umgesetzt: Pit-Lane-Definition, Export auf Memory-Stick (Requests im Client vorbereitet), RN-Software-Update
  (braucht SSH-Plugin).

### 3.4 Einstellungen (`#/settings`)

Sprache (Gerät, DE, EN), Einheiten km/h oder mph, Darstellung (System, hell, dunkel), farbenblind-freundliche Palette,
Kartenkacheln laden, Kartenstil (Straße, Satellit), schwebende Tab-Leiste, Wetter der Session, KI-Erklärung auf dem Gerät,
Speicher (Belegung, dauerhaften Speicher anfordern, alle Videos löschen, alles löschen), Update prüfen (Android-APK),
geführte Tour starten und Demodaten entfernen, Version und Hinweise.

### 3.5 Kurven-Coach und KI-Erklärung

`coach.js` erklärt deterministisch, wo und warum eine Runde gegen die Referenz verliert:

* Kurven aus der Streckendefinition, Fallback: Spitzen der Querbeschleunigung.
* Je Kurve: Bremspunkt (Längs-g < −0,25 g), Scheitel (Minimalgeschwindigkeit), Gaspunkt (Längs-g > 0,12 g), Ausgangstempo,
  seitlicher Linienversatz zur Referenz, Zeitverlust aus der Abstandskurve, aufgeteilt in Anbremsen und Ausgang.
* Toleranzen unterhalb der Sensorgenauigkeit werden nicht genannt: 8 m Bremspunkt, 1 m/s Scheitel, 1,5 m Linie, 0,05 s.
* Muster über mehrere Kurven („in 5 von 16 Kurven bremst du früher“).
* Darstellung als Panel: Zusammenfassung, Kurvenliste nach Zeitverlust, Tipp springt mit dem Cursor, aktuelle Kurve hervorgehoben.

`ai.js` formt die Fakten optional mit einem Sprachmodell auf dem Gerät zu drei bis vier Sätzen: iOS 26 über Apple Foundation
Models, Android über Gemini Nano (ML Kit GenAI Prompt API, nur unterstützte Geräte). Ohne Modell bleibt der Vorlagentext.
Es verlassen keine Daten das Telefon.

### 3.6 Geführte Tour

Beim ersten Start (leere Liste) und aus den Einstellungen: drei anonymisierte Guadix-Beispielrunden und zwei 20-Sekunden-Clips
werden importiert, dann fährt die App selbst durch Rundenliste, Vergleich, Analyse mit laufendem Cursor, G-Kraft, Video,
Race-Navigator-Tab und Einstellungen. Am Ende Demodaten behalten oder entfernen.

### 3.7 Querschnitt

* **Sprachen**: Deutsch und Englisch, Schlüsselparität wird getestet. Web: Gerätesprache, sonst Englisch. Neue Sprache =
  ein weiteres Wörterbuch in `i18n.js`.
* **Offline**: App-Shell im Service-Worker-Precache, Kartenkacheln cache-first mit begrenzter Größe, alle Daten in IndexedDB.
* **Update**: Web/PWA über Service-Worker-Banner; iOS über App Store/TestFlight; Android-APK vergleicht `build.json` mit
  `latest.json` des neuesten GitHub-Releases (beim Start, beim Fortsetzen, alle 20 Minuten, manuell).
* **Teilen**: Web Share API mit Dateien (iOS/Android Share-Sheet: Dateien, AirDrop, WhatsApp, YouTube, Instagram), sonst Download.

---

## 4. Architektur

### 4.1 Überblick

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  app/  (reine Web-App, kein Build)                                           │
│                                                                              │
│  index.html ── main.js (Routing, Tabs, SW, Theme) ── views/                  │
│                                                       laps · analyzer ·      │
│                    state.js (Zustand, Auswahl,        device(devices,control)│
│                    Einstellungen, Event-Bus)          · settings             │
│                        │                                                     │
│   Fachlogik: rnparser · analysis · coach · sync · chart · map · xlsx · zip   │
│   Dienste:   import · db (IndexedDB) · i18n · ui · share · tour · update     │
│   Extern:    weather (Open-Meteo) · device (HTTP-API) · deviceNative ·       │
│              deviceControl · health · ai  ──► window.Capacitor.RnDevice      │
│                                                                              │
│  sw.js (Precache + Kachel-Cache)     demo/ (Tour-Daten)     css/app.css      │
└──────────────────────────────────────────────────────────────────────────────┘
        │ identischer webDir                              │ Plugin-Aufrufe
┌───────┴───────────────────┐                ┌────────────┴───────────────────┐
│ Capacitor-Hülle iOS       │                │ native/rn-device (Plugin)      │
│ Capacitor-Hülle Android   │                │ Swift · Java · Kotlin          │
│ (in CI erzeugt, nicht     │                │ Bonjour/NSD · FTP · PostgreSQL │
│  eingecheckt)             │                │ MJPEG · HealthKit/Health Conn. │
└───────────────────────────┘                │ Foundation Models / Gemini Nano│
                                             └────────────────────────────────┘
```

Schichten: Ansichten (`views/`) rendern DOM aus dem Zustand und reagieren auf Bus-Ereignisse; Fachlogik ist reine Funktion
über typisierte Arrays und im Node-Test ohne Browser lauffähig; Dienste kapseln Browser-APIs; native Fähigkeiten laufen
über ein einziges Capacitor-Plugin `RnDevice`, das die App zur Laufzeit registriert.

### 4.2 Module

| Datei | Verantwortung |
|---|---|
| `app/js/main.js` | Bootstrap, Hash-Routing (`#/laps`, `#/analyze`, `#/device`, `#/settings`, Aliase alter Routen), Thema, Sprache, Service-Worker-Registrierung, `APP_VERSION` |
| `app/js/state.js` | Zentraler Zustand (Runden, Auswahl, Cursor, Einstellungen, Sample-Cache mit Verdrängung), Event-Bus `on`/`emit`, Referenzrunde `refLapId()`, Paletten, Einheiten, Migration `settingsVersion` |
| `app/js/db.js` | IndexedDB-Zugriff (Abschnitt 5.3), Speicherabschätzung, dauerhafter Speicher |
| `app/js/zip.js` | ZIP lesen (`DecompressionStream`) und schreiben (Store), ohne Bibliothek |
| `app/js/rnparser.js` | `.rnz`/`.rn`/`.cdrn` → Rundendatensatz und Sample-Arrays (Abschnitt 5) |
| `app/js/import.js` | Import-Pipeline: Reihenfolge Runden vor Videos, Zip-Ordner entpacken, Dubletten behalten Notiz und Overrides |
| `app/js/analysis.js` | Interpolation, Kanaldefinitionen `CHANNELS`, Abstand (Time Slip / Distanzabstand), Sektorzeiten, geometrische Sektoren, Achsenschritte |
| `app/js/coach.js` | Kurvenerkennung, Kurvenkennzahlen, Vergleich, Toleranzen `T`, Muster |
| `app/js/ai.js` | Verfügbarkeit und Aufruf des Sprachmodells auf dem Gerät über das Plugin |
| `app/js/sync.js` | Wiedergabe-Engine `player`: Cursor aus Referenzvideo oder Uhr, Videos nach Distanz/Zeit synchron, Drift-Toleranz 0,35 s |
| `app/js/chart.js` | Canvas-Linienchart und Streudiagramm, Zoom/Pan, Cursor, Sektorlinien |
| `app/js/map.js` | Canvas-Karte in Web Mercator, Kachelanbieter (OSM, Esri, eigener), Spuren, Einfärbung nach Zeitverlust, nächster Messpunkt |
| `app/js/xlsx.js` | OOXML-Arbeitsmappe ohne Bibliothek |
| `app/js/share.js` | Web Share API mit Dateien, Fallback Download |
| `app/js/i18n.js` | Wörterbücher DE/EN, `t()`, Spracherkennung, Datums-/Byte-Formatierung |
| `app/js/ui.js` | DOM-Helfer `h()`, Icons, Kopfzeile, Toast, Blatt, Bestätigungs- und Eingabedialog, Schalter, Segmentwahl |
| `app/js/tabbar.js` | Tab-Leiste mit Drücken-und-Ziehen und Hervorhebungs-Pill |
| `app/js/tour.js` | Demodaten laden/entfernen, geführte Tour |
| `app/js/update.js` | Android-Update-Prüfung gegen das neueste GitHub-Release |
| `app/js/weather.js` | Session-Wetter von Open-Meteo, WMO-Codes, Windrichtung, Cache |
| `app/js/health.js` | Herzfrequenz aus Apple Health / Health Connect auf die Zeitbasis der Runde, Kanal `hr` |
| `app/js/device.js` | HTTP-Client zur einfachen Geräte-API (`/api/info`, `/api/laps`, `/files/<name>`), Mixed-Content-Erkennung |
| `app/js/deviceNative.js` | Geräteclient der nativen App: HTTP-XML-API des Race Navigator (Port 8080), setzt `.rn`-XML zusammen, Videos per FTP über das Plugin, Bonjour-Suche |
| `app/js/deviceControl.js` | RN-Connect-Protokoll: `currentstatus`, `rarequest`-Aktionen, Konstanten (Aufnahmemodi, Videoqualität, Event-Typen, Statusflags) |
| `app/js/views/laps.js` | Rundenliste, Filter, Auswahl, Rundenmenü, Import, Teilen |
| `app/js/views/analyzer.js` | Analyse-Bildschirm, Panels, Komponentenwahl, Optionen, Excel-Export, eigene Sektoren |
| `app/js/views/device.js` | Race-Navigator-Seite (Verbindungszustand), bindet `devices.js` und `control.js` ein |
| `app/js/views/devices.js` | Rundenliste vom Gerät, Auswahl, Download-Queue |
| `app/js/views/control.js` | Gerätesteuerung (Status, Aufnahme, Fahrer, Fahrzeug, Strecke, Event, Video, Kamera, Aktionen) |
| `app/js/views/settings.js` | Einstellungen, Speicher, Tour, Update, Über |
| `app/js/selftest.js` | Selbsttest in der laufenden App (`?selftest`), nicht im Precache |
| `app/sw.js` | Service Worker: Precache-Liste `ASSETS`, Cache-Version, stale-while-revalidate für die Shell, cache-first für Kacheln (max. 1500) |

### 4.3 Zustands- und Datenfluss

1. `initState()` lädt Einstellungen (mit Migration), alle Runden-Metadaten und die gespeicherte Auswahl aus IndexedDB.
2. Ansichten abonnieren Bus-Ereignisse: `laps`, `selection`, `cursor`, `settings`, `sectors`, `theme`, `resize`, `online`.
3. Sample-Arrays werden erst bei Bedarf geladen (`ensureSamples`) und in einem Cache mit höchstens 24 Einträgen gehalten;
   nicht ausgewählte Runden werden verdrängt.
4. Der Cursor ist eine Zahl in X-Einheiten (m oder s). `setCursor(x, source)` sendet `cursor`; die Wiedergabe-Engine ignoriert
   ihre eigenen Ereignisse und zieht bei fremden Cursorbewegungen die Videos nach.
5. Alle Änderungen an Runden laufen über `db` und danach `reloadLaps()`, das `laps` sendet.

### 4.4 Native Hülle und Plugin

Die nativen Projekte (`ios/`, `android/`) werden in der CI mit `npx cap add` erzeugt und sind nicht eingecheckt; eingecheckt
sind `capacitor.config.json`, Icons und Splash unter `native/ios-assets/` und `native/android-res/` sowie das Plugin
`native/rn-device/`. Die App erkennt die native Umgebung über `Capacitor.isNativePlatform()`; `fetch` läuft dort über
`CapacitorHttp` nativ, deshalb gibt es weder CORS- noch Mixed-Content-Probleme gegenüber dem Gerät.

Plugin `RnDevice`, Methoden identisch auf iOS (Swift) und Android (Java, Kotlin für Health und KI):

| Methode | Zweck |
|---|---|
| `discover` | Bonjour/NSD-Suche nach `_racenav._tcp` |
| `ftpDownload` | Video vom Gerät (FTP, Zugang aus der alten App) in den App-Cache, mit Fortschritt |
| `pgQuery` | PostgreSQL-Abfrage auf dem Gerät als Fallback für Messdaten |
| `deleteFile` | Datei aus dem App-Cache entfernen |
| `cameraStart` / `cameraStop` | MJPEG-Strom der Gerätekamera über TCP |
| `healthAvailable` / `healthHeartRate` | HealthKit bzw. Health Connect: Herzfrequenz für ein Zeitfenster |
| `aiAvailable` / `aiGenerate` | Sprachmodell auf dem Gerät (Apple Foundation Models, Gemini Nano) |

Mindestversionen: iOS 16.4 (wegen `DecompressionStream`), Android 8 (API 26). Berechtigungen und Nutzungstexte
(lokales Netz, Bonjour, HealthKit, Cleartext-HTTP zum Gerät) setzt der jeweilige Workflow.

### 4.5 Externe Dienste

| Dienst | Zweck | Personenbezug | Abschaltbar |
|---|---|---|---|
| tile.openstreetmap.org, Esri World Imagery | Kartenkacheln | Nur Kachelkoordinaten | Ja (Kartenkacheln laden) |
| api.open-meteo.com, archive-api.open-meteo.com | Wetter je Session, Position aus der Streckendefinition | Nein | Ja |
| github.com/…/releases/latest | Android-Update-Prüfung (`latest.json`) | Nein | Nur Android-APK, manuell auslösbar |
| Race Navigator im lokalen WLAN | Import und Steuerung | Lokal | Nur native App |

Es gibt keinen Macrix-Server, kein Analytics, kein Crash-Reporting.

---

## 5. Datenmodell

### 5.1 Eingabeformat RNZ

Nach *Race Navigator Files Format Specification rev 1.1*: `.rnz` ist ein ZIP-Archiv, dessen Kommentar `key=value`-Metadaten
trägt; darin `*.rn` (XML, Namensraum `http://macrix.eu/racenavigator/LapDataSchema`) und optional `*.cdrn`
(CSV `id;measurementtime;lapid;name;unit;value` mit Zusatzkanälen). Messpunkte `<sm …/>` mit 10 Hz. Attribut-Mapping und
Einheiten stehen tabellarisch im `README.md` (Abschnitt „Dateiformat“); physikalisch verifiziert: `la` = Längs-, `lo` =
Querbeschleunigung (positiv = links). Video-Synchronisation: `videos/video/startTime` ist Video-Sekunde 0.

### 5.2 Runde (Metadaten, Store `laps`)

```
id            "<Gerät>_<lapId>_<startMs>"      eindeutig über Geräte hinweg
lapNumber, type, startMs, endMs, lapTimeMs, complete
driver   { id, name, surname, photo }          vehicle { number, model }
event    { id, name, startMs, endMs }          track   { id, name, distance, width, timeZone, variantId, variantName }
trackDef { startLine[], endLine[], sectors[{name, points[]}], curves[{name, points[]}], picture{sw, ne} }
sectors  [ { n, timeMs } ]                     Gerätesektoren
video    { fileName, offsetS, sizeKB }, videos[]   Zuordnung zum MP4 (erstes Video nach locationType)
channels { rpm, throttle, waterTemp, oilTemp, obdSpeed, obd, custom[], hr }   Verfügbarkeit je Kanal
source   { fileName, device, exportDevice, exportVersion, dataVersion, exportTime }
note, driverOverride, vehicleOverride, vehicleNumberOverride, importedAt, demo
```

### 5.3 Messdaten (Store `samples`)

Ein Objekt je Runde mit `n` und typisierten Arrays gleicher Länge: `t` (s seit Rundenstart), `d` (m), `v` (m/s), `lat`/`lng`
(Float64), `gLat`, `gLon`, `gVert` (g), `alt` (m), `hdg` (°), `dev` (m), `rpm`, `thr`, `wt`, `ot`, `os`, `gyrP`, `gyrR`, `gyrY`,
`gpsOk`, `obdOk` (Uint8), optional `hr` (bpm) und benannte Custom-Kanäle. Alle Analysen (Interpolation, Abstand, Sektoren,
Coach) arbeiten auf diesen Arrays und sind ohne DOM testbar.

### 5.4 Persistenz (IndexedDB `rn-analyzer`, Version 1)

| Store | Schlüssel | Inhalt |
|---|---|---|
| `laps` | `id` (Indizes `startMs`, `track.id`) | Rundenmetadaten |
| `samples` | `id` | Messdaten-Arrays |
| `raw` | `id` | Original-`.rnz` als Bytes (für Teilen/Export) |
| `videos` | `fileName` | MP4 als Blob, Größe, Typ, Zeitpunkt |
| `settings` | `key` | `settings` (Objekt mit `settingsVersion`), `selected` (Rundenauswahl), Wetter-Cache |
| `sectors` | `trackId` | eigene Sektor-Splits in m |

Videos von 70 bis 80 MB sind vorgesehen; die App fordert dauerhaften Speicher an, damit das System nichts verdrängt.

---

## 6. Analysefunktionen (fachliche Definitionen)

* **Abstand (Time Slip)**: Δt = t_cmp(d) − t_ref(d) über die Distanz in 5-m-Schritten; im Zeitmodus Δs = d_cmp(t) − d_ref(t).
* **Referenz**: schnellste vollständige Runde der Auswahl; ohne vollständige Runde die erste gewählte.
* **Sektoren**: Gerätesektoren aus dem RNZ; sonst geometrisch aus den Sektorlinien der Streckendefinition (nächster Messpunkt an
  der Linie); eigene Splits überschreiben beides. Bestmögliche Runde = Summe der besten Sektoren; zusammenhängend schnellste
  Runde = beste Folge realer Sektoren.
* **Beste Runde je Fahrer** je Event und Strecke für die gelbe Markierung.
* **Kurven-Coach**: Abschnitt 3.5. Kurve = Bereich der Referenz mit |Quer-g| über Schwelle, begrenzt aus der Streckendefinition.
* **Video-Sync**: Referenzvideo liefert die Zeit; andere Videos werden auf die Zeit gesetzt, zu der ihre Runde dieselbe
  Distanz (oder Zeit) erreicht hat; Nachziehen ab 0,35 s Drift.

---

## 7. Schnittstellen zum Race Navigator

### 7.1 Was das unveränderte Gerät anbietet

WLAN „Analyzer Mode“ (Netz `<Gerät>_AP`), Bonjour `_racenav._tcp`:

* **HTTP-REST/XML** `http://<ip>:8080/resources/<uri>` (`deviceinfo`, `drivers`, `vehicles`, `events`, `laps/…`,
  `lapsectors`, `videoinfos`, `lapstovideos`, `sensormeasurements/<von>/<bis>`, `tracks`, `trackvariants`, `rarequest/…`).
  Datumsformat `yyyyMMddHHmmssSSS`.
* **FTP** mit `.mp4`/`.idx` im Wurzelverzeichnis. **PostgreSQL** Datenbank `rtts`. Zugangsdaten stehen im `README.md`.
* **Steuerung** (RN Connect): `GET …/resources/currentstatus` (JSON) und Aktionen als
  `rarequest/{typ}/{uuid}/{dt1}/{dt2}/{int1}/{int2}/{int3}/{str1}/{str2}/{str3}/0`, Abfrage `rarequest/{uuid}/{typ}` mit Status
  0 empfangen, 1 in Arbeit, 2 fertig, 3 fehlgeschlagen. Kameravorschau: `rarequest/19/{uuid}/1` liefert Kameraanzahl und
  TCP-Port des MJPEG-Stroms.

Der Browser kann das nicht direkt nutzen (Mixed Content aus HTTPS, keine CORS-Header, kein FTP/PostgreSQL). Deshalb:
native App als Kundenweg, Datei-Import als universeller Weg.

### 7.2 Einfache Geräte-API (Web-Version, Referenz für künftige Firmware)

`GET /api/info`, `GET /api/laps`, `GET /files/<name>` mit CORS-Headern und Range-Unterstützung. Referenzimplementierung
`tools/mock-device-server.mjs` (serviert einen Ordner mit `.rnz`/`.mp4`), produktive Brücke `tools/rn-bridge/` (Node auf
Laptop oder Raspberry im Geräte-WLAN, erzeugt `.rnz` aus der Gerätedatenbank, streamt Videos per FTP, liefert die App aus).
Die Brücke ist fertig, aber nicht gegen ein echtes Gerät getestet.

---

## 8. Plattformen, Build und Release

| Ziel | Quelle | Mechanik | Auslöser |
|---|---|---|---|
| Web/PWA | `app/` | GitHub Pages (`pages.yml`), statisch, HTTPS | Push auf `main` |
| iOS (iPhone, iPad) | Capacitor + `native/rn-device` | `ios.yml` auf macOS-Runner: Projekt erzeugen, Info.plist, Signatur aus Secrets, Archiv, TestFlight-Upload | Tag `ios-v*`, Push auf `main` (Kompilier-Check), manuell |
| Android | Capacitor + `native/rn-device` | `android.yml`: Projekt erzeugen, minSdk 26, Keystore aus Secrets, APK + AAB, GitHub-Release mit `latest.json` | Tag `android-v*`, Push auf `main` |

Versionen: `APP_VERSION` in `main.js`, `version` in `package.json` und `MARKETING_VERSION` in beiden Workflows müssen
gleich sein (Test). Build-Nummer = GitHub-Run-Nummer. Die Service-Worker-Cache-Version `rn-analyzer-vX.Y.Z` in `sw.js` wird
bei jeder Änderung an App-Dateien erhöht, sonst sehen installierte PWAs die Änderung nicht. Bundle-ID iOS
`com.macrix.RN-Analyzer` (bestehender Store-Eintrag), Android-Paket `com.macrix.rnanalyzer`.

Nicht eingecheckt (`.gitignore`): Beispieldateien, alter Quellcode, Spezifikations-PDFs, erzeugte native Projekte,
Signaturmaterial. Wer die Software teilt, teilt dieses Repository plus die Store- bzw. Pages-Links.

---

## 9. Qualitätssicherung

* **`npm test`** (`tools/test/unit.test.mjs`, Node ≥ 22): Sprachdateien (Schlüsselparität, Platzhalter, alle benutzten
  Schlüssel), Analysefunktionen, Coach an synthetischen Runden, Wetter-Codes, ZIP- und XLSX-Roundtrip, Precache-Liste
  vollständig, Cache-Version vorhanden, Tabs ↔ Routen ↔ Manifest-Icons, Demodaten anonymisiert, Versionen konsistent,
  **Spezifikation aktuell** (Abschnitt 12).
* **Selbsttest in der App** (`?selftest`): fährt die laufende App durch alle Ansichten, Knöpfe, Blätter und Dialoge und meldet
  Ergebnis in Panel, Konsole und `window.__selftest`.
* **CI-Kompilier-Check** der nativen Hüllen bei jedem Push, der `native/**` oder die Capacitor-Konfiguration ändert.
* Vor jedem Release: `npm test`, Selbsttest in der Web-Version, TestFlight- bzw. APK-Build auf einem echten Gerät.

---

## 10. Bekannte Grenzen

* iOS öffnet `.rnz`-Anhänge aus Mail nicht direkt in einer Web-App; in „Dateien“ sichern und importieren. Die native App kann
  als Datei-Handler registriert werden (noch nicht umgesetzt).
* Videos laufen höchstens mit 2×; darüber springt das Bild dem taktgesteuerten Cursor nach.
* Kartenkacheln offline nur, soweit sie online schon einmal geladen wurden.
* KI-Erklärung nur auf Geräten mit Apple Intelligence (iOS 26) bzw. Gemini Nano; sonst Vorlagentext.
* rn-bridge und PostgreSQL-Fallback sind gegen kein echtes Gerät verifiziert.
* Messpunkte-Blatt im Excel-Export fehlt (Windows-App hatte es).

---

## 11. Entscheidungen und bewertete Ideen

Kurzform der Architekturentscheidungen. Neue Entscheidungen werden hier angehängt, nicht überschrieben.

| Datum | Entscheidung | Begründung |
|---|---|---|
| 2026-09 | Web-App ohne Framework und Build statt nativer Neuentwicklung je Plattform | Eine Codebasis für vier Plattformen; kein Werkzeug, das in fünf Jahren veraltet ist; Auslieferung als statische Dateien |
| 2026-09 | Capacitor-Hüllen nur für Gerätezugriff und Store-Präsenz | Browser kann FTP/PostgreSQL/Bonjour nicht; Store-Eintrag der alten App wird weitergeführt |
| 2026-09 | IndexedDB statt Dateisystem | Einzige plattformübergreifende, große Speicherung im Browser; Blobs für Videos |
| 2026-09 | Cloud Storage, Facebook/YouTube-Upload, E-Mail aus der alten App nicht übernommen | System-Share-Sheet deckt Teilen ab; kein Backend; Login-Pflege entfällt |
| 2026-09 | Bedienkonzept „Antwort zuerst“, ein Analyse-Bildschirm | Nutzer sind Fahrer in der Box, keine Datenanalysten |
| 2026-09 | Coach deterministisch, Sprachmodell nur auf dem Gerät und nur zur Formulierung | Nachvollziehbarkeit, keine Halluzinationen, Datenschutzversprechen bleibt |
| 2026-09 | Wetter von Open-Meteo, Bestzeit-Referenz automatisch, Puls aus Health-Apps | Kontext ohne Personenbezug; Referenzwahl war Fehlerquelle; Uhren sind bei Fahrern verbreitet |
| 2026-09 | **„RN Plattform“** (Anforderungsdokument vom März 2023: Konten, Abo, Chat, Events, Coach-Marktplatz, Teams, Ranglisten, Live) **nicht als Erweiterung dieses Produkts** | Es ist ein zweites Produkt mit Backend, laufenden Kosten, Moderations- und DSGVO-Pflichten und kehrt das Prinzip „Daten bleiben auf dem Gerät“ um. Netzwerkeffekt bei der RN-Gerätebasis unklar; Marktbehauptung von 2023 nicht geprüft. Stattdessen ohne Backend: Vergleich fremder Runden per Datei, Streckenverzeichnis mit „In Karten öffnen“, Coaching-Paket als Export. Ein Rangliste-Experiment nur als eigenes, kleines Vorhaben. |

Offene Kandidaten (nicht beschlossen): Datei-Handler für `.rnz` in der nativen App, Messpunkte-Blatt im Excel-Export,
Pit-Lane-Definition und Memory-Stick-Export in der Steuerung, RN-Software-Update über SSH, App auf dem Gerät hosten
(gleicher Origin), Firmware-API mit CORS für künftige Geräte.

---

## 12. Pflege dieser Spezifikation

* Jede Änderung, die Funktionsumfang, Architektur, Datenmodell, Schnittstellen, Build oder Nicht-Ziele berührt, aktualisiert
  dieses Dokument **im selben Commit**. Datum in der Kopfzeile anpassen, Entscheidung in Abschnitt 11 eintragen.
* `README.md` bleibt die Anleitung (Einrichten, Bauen, Signieren, Veröffentlichen); `docs/SPEC.md` ist das Was und Warum.
* Der Test „spec: documentation is current“ in `tools/test/unit.test.mjs` schlägt fehl, wenn ein Modul unter `app/js`, eine
  Plugin-Methode, ein Tab oder die App-Version hier nicht vorkommt oder die Kopfzeile nicht zur Version passt.
  Er ersetzt nicht das Lesen: Wer eine Funktion ändert, prüft den zugehörigen Abschnitt.
* Zum Teilen genügt dieses Dokument plus `README.md`; PDFs und Beispieldateien liegen bewusst außerhalb des Repositories.
