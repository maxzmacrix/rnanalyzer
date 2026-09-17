# RN Analyzer 2.0 – Web App (PWA)

Neuimplementierung des Race Navigator **RN Analyzer** (bisher iPad‑only, Objective‑C, 2013–2020) als
installierbare, offline‑fähige Web‑App für iPhone, iPad, Android und Desktop.

* **Keine Abhängigkeiten, kein Build‑Schritt** – reines HTML/CSS/ES‑Modul‑JavaScript im Ordner `app/`.
* **Offline** – Service Worker cached die App‑Shell; alle Runden, Videos und Einstellungen liegen lokal in IndexedDB.
* **RNZ + MP4 aus dem lokalen Speicher** – Import über den Dateidialog (iOS „Dateien“‑App, USB‑Stick, iCloud Drive).
* **Import‑Schnittstelle zum RN‑Gerät** – HTTP‑API‑Client (`app/js/device.js`) inkl. Mock‑Server; die direkte Verbindung zum unveränderten Gerät braucht die native App (siehe unten).

---

## Schnellstart (lokal am PC)

```bash
node tools/serve.mjs 8080
```

Dann `http://localhost:8080` öffnen. Für den Test der Geräte‑Schnittstelle zusätzlich den Mock‑RN starten
(serviert den Ordner `Example files` wie ein Race Navigator):

```bash
node tools/mock-device-server.mjs 8090 "Example files"
```

In der App unter **Geräte** die Adresse `http://localhost:8090` eintragen → Verbinden → Runden/Videos auswählen → Herunterladen.

> Beim Entwickeln `?nosw=1` an die URL hängen, damit der Service Worker nicht cached.

## Auf dem iPhone starten

Ein Service Worker (Offline‑Betrieb, Home‑Screen‑App) braucht **HTTPS** (Ausnahme: `localhost`).
Zwei Wege:

1. **Statisches Hosting** (empfohlen): Den Ordner `app/` auf einen beliebigen HTTPS‑Static‑Host legen
   (GitHub Pages, Cloudflare Pages, Netlify, eigener nginx/IIS). Keine Server‑Logik nötig.
2. **Nur im WLAN testen (ohne Offline)**: `node tools/serve.mjs 8080` auf dem PC starten, auf dem iPhone die
   angezeigte Adresse `http://<PC‑IP>:8080` in Safari öffnen. Die App läuft komplett, nur der Service Worker
   (Offline‑Cache) wird ohne HTTPS nicht registriert.

Installation: In Safari **Teilen → Zum Home‑Bildschirm**. Danach startet die App wie eine native App
(Vollbild, eigenes Icon) und funktioniert ohne Netz. Die iOS‑Systemvoraussetzung ist **iOS 16.4+**
(wegen `DecompressionStream` für das ZIP‑Entpacken der RNZ‑Dateien).

Speicher: iOS gewährt installierten Web‑Apps großzügigen IndexedDB‑Speicher (Videos à 70–80 MB sind kein
Problem). Unter **Setup → Speicher** wird die Belegung angezeigt; „Dauerhaften Speicher anfordern“ verhindert
das automatische Aufräumen durch das System.

## Funktionsumfang (Abgleich mit dem Quickstart‑Handbuch)

| Bereich | Umsetzung |
|---|---|
| Runden‑Liste | Gruppiert nach Event/Strecke/Gerät, Farbcodes (weiß = vollständig, grau = unvollständig, gelb = beste Runde je Fahrer), Suche, Fahrerfoto, Video‑Badge, Bearbeiten (Fahrer/Fahrzeug/Notiz), Export (.rnz teilen), Löschen |
| Analyzer | Bis zu 10 Runden, bis zu 4 synchronisierte Videos, zwei frei belegbare Panels (Primär‑ + Sekundärgraph), roter Cursor synchron über Charts/Karte/Videos, Pinch‑Zoom & Pan, Zoom‑Synchronisation, Distanz‑ oder Zeitachse, Play mit 0,5×/1×/2×/4× |
| Datenkanäle | Geschwindigkeit, Längs‑/Quer‑/Vertikal‑/kombinierte G, GPS‑Abweichung, Höhe, Kurs, Gyroskop (Gier/Nick/Roll), OBD/CAN (RPM, Gas, Wasser‑/Öltemp., OBD‑Speed – nur wenn im File vorhanden), Custom‑CAN‑Kanäle aus `.cdrn` |
| Ansichten | Time Slip (Δt zur Referenzrunde über Distanz, Δs im Zeitmodus), Streckenverlauf (Karte mit OSM‑Kacheln online, GPS‑Spur offline, Start‑/Sektorlinien, Kurvennummern), Detaildaten am Cursor, Rundenübersicht (Min/Max, Bestwerte eingekreist), Sektorzeiten (beste theoretische / zusammenhängende Rundenzeit) |
| Sektoren | Geräte‑Sektoren aus dem RNZ, geometrischer Fallback über die Streckendefinition, eigene Sektoren (langes Drücken im Chart oder Optionen → Eigene Sektoren) |
| G‑Kraft | Streudiagramm Quer‑ vs. Längsbeschleunigung aller gewählten Runden, Cursor‑Marker |
| Videoplayer | Einzelvideo mit Datenoverlay (Speed, Rundenzeit), ±1 s, Tempo 0,25–2×, Ton |
| Geräte | Verbindung zum RN über HTTP‑API, Rundenliste mit Sortierung, Daten/Video‑Auswahl, Download‑Queue mit Fortschritt/Geschwindigkeit |
| Einstellungen | Sprache (DE/EN), km/h ↔ mph, farbenblind‑freundliche Palette, Kartenkacheln, Speicherverwaltung, alles löschen |
| Nicht übernommen | Cloud Storage (Google), Facebook/YouTube‑Sharing, E‑Mail‑Versand, „Measurements from different track variants synchronisieren“ |

## Dateiformat (RNZ)

Umgesetzt nach *Race Navigator Files Format Specification rev 1.1* und verifiziert an den Beispieldateien:

* `.rnz` = ZIP‑Archiv; ZIP‑Kommentar enthält `key=value`‑Metadaten; darin `*.rn` (XML, Schema
  `http://macrix.eu/racenavigator/LapDataSchema`) und optional `*.cdrn` (CSV mit Zusatzkanälen).
* Messpunkte `<sm …/>` (10 Hz) – Attribut‑Mapping (`app/js/rnparser.js`):

| Attribut | Bedeutung | Einheit im File | App |
|---|---|---|---|
| `mt` | Messzeit (Gerätelokalzeit) | Timestamp | s seit Rundenstart |
| `ds` | Distanz in der Runde | mm | m |
| `gs` | GPS‑Geschwindigkeit | mm/s | m/s → km/h/mph |
| `la` | **Längs**beschleunigung (xAccel) | mg | g (+ = beschleunigen) |
| `lo` | **Quer**beschleunigung (yAccel) | mg | g (+ = links, RN‑Konvention) |
| `za` | Vertikalbeschleunigung | mg | g |
| `lt`/`lg` | Breite/Länge | ° | ° |
| `al` | Höhe | m | m |
| `dr` | Kurs | ° | ° |
| `gd` | GPS‑Positionsabweichung | mm | m |
| `df` | Distanz‑Offset | mm | – |
| `ph`/`rl`/`ya` | Gyroskop Nick/Roll/Gier | roh (÷1000 wie alte App) | – |
| `rp`, `tp`, `wt`, `ot`, `os`, `iobdv` | OBD/CAN | –1/0 = nicht vorhanden | nur wenn vorhanden |
| `igpsv` | GPS gültig | 0/1 | Filter für Karte |

Die Zuordnung `la` = längs / `lo` = quer wurde physikalisch geprüft (Korrelation mit dv/dt 0,94 bzw. mit
v·Gierrate 0,98) und entspricht dem alten Code (`xAccel` = Longitudinal, `yAccel > 0` = Max Left).

Video‑Synchronisation: `videos/video/startTime` ist der Zeitstempel von Video‑Sekunde 0 → Offset zum
Rundenstart (`lap.video.offsetS`).

## Geräte‑Schnittstelle – Stand der Dinge

Aus dem Quellcode der alten App und der Bibliothek `RNDataHandler` (`Old RN Analyzer/rndatahandler-master`) ergibt
sich, was der **unveränderte Race Navigator** in seinem WLAN („Analyzer Mode“, Netz `<Gerät>_AP`) anbietet:

| Dienst | Details |
|---|---|
| **HTTP‑REST/XML** | `http://<ip>:8080/resources/<uri>`, `Accept: application/xml`. URIs: `deviceinfo`, `drivers`, `vehicles`, `events`, `events/<id>`, `laps/<datum>/from`, `laps/byeventid/<id>`, `lapsectors`, `videoinfos`, `videoinfos/<datum>/from`, `videoinfos/bylapid/<id>`, `lapstovideos/<datum>/from`, `lapstovideos/bylapid/<id>`, `sensormeasurements/<von>/<bis>` (Messpunkte `<sm …/>` mit denselben Attributen wie im RNZ, Gierrate hier `yw`), `sensormeasurements/<datum>/count`, `…/next`, `tracks`, `tracks/<id>`, `trackvariants`, `trackvariants/<id>`, `trackvariantimages/<id>/<typ>`, `availablevideolayouts`, `rarequest/…` (Aktionen wie Video‑Split). Datumsformat `yyyyMMddHHmmssSSS`. |
| **FTP** | Videodateien `.mp4` und `.idx` im Wurzelverzeichnis, Login `rtts` / `rtts8888`. |
| **PostgreSQL** | Datenbank `rtts`, Login `rtts` / `rtts8888`, Tabelle `sensorsmeasurements` (Spalten `longitudinalaccel`, `lateralaccel`, `gpsspeed`, `gpspositiondeviation`, …). Von der alten App nur ergänzend genutzt. |
| **Discovery** | Bonjour `_racenav._tcp`; Standard‑IP der Tests `192.168.1.158`/`.161`. |

**Warum die Web‑App das nicht direkt nutzen kann:** Safari blockiert aus einer HTTPS‑Seite jeden `http://`‑Zugriff
(Mixed Content), der Geräte‑Server sendet keine CORS‑Header, und FTP/PostgreSQL sind für Browser grundsätzlich
unerreichbar. Die App zeigt deshalb im Tab **Geräte** den Hinweis, dass für die direkte Verbindung die **native
App** nötig ist; der Datei‑Import (USB‑Stick aus SETTINGS › EXPORT VIDEO, iCloud, AirDrop) funktioniert in der
Web‑Version vollständig.

### Native App (empfohlener Weg für Kunden)

Capacitor‑Hülle um genau diese Web‑App (`app/` unverändert), plus:

* **HTTP zum Gerät** über das Capacitor‑HTTP‑Plugin (läuft nativ, kein CORS/Mixed Content) gegen die oben
  genannten `:8080/resources/*`‑URIs. Die XML‑Antworten liefern dieselben `<sm>`‑Attribute, die `app/js/rnparser.js`
  bereits versteht; aus Lap/Driver/Vehicle/Event/Track/Sectors/Videoinfos lässt sich das `.rnz` clientseitig
  zusammensetzen (Vorlage: `buildRnz()` in `tools/rn-bridge/rn-bridge.mjs`, ZIP‑Writer in `app/js/zip.js`).
* **Videos per FTP** (`rtts`/`rtts8888`) über ein kleines natives Plugin (Swift, z. B. FilesProvider/NIO‑FTP),
  das die Datei in den App‑Container lädt und der Web‑App als Blob übergibt.
* In `app/js/device.js` werden nur die drei Funktionen `fetchDeviceInfo`, `fetchDeviceLaps`, `downloadFile`
  auf das Plugin umgestellt; `app/js/views/devices.js` erkennt die native Umgebung (`window.Capacitor`) und blendet
  den Hinweis aus.

### Weitere Wege

| Weg | Voraussetzung | Status |
|---|---|---|
| **USB‑Stick** (SETTINGS › EXPORT VIDEO, Stick per Adapter ans iPhone/iPad, Import in der App) | nichts | funktioniert heute |
| **rn-bridge** (`tools/rn-bridge`, Node auf Laptop/Raspberry im RN‑WLAN, liefert App + HTTP‑API, erzeugt `.rnz` aus der DB, streamt Videos per FTP) | ein Rechner im WLAN | fertig, ungetestet gegen ein echtes Gerät (`--discover` zuerst); für Werkstatt/Support |
| **App auf dem Gerät hosten** (statische Dateien im HTTP‑Server des RN, gleicher Origin → keine CORS/Mixed‑Content‑Probleme) | Update‑Paket für das Gerät | Option für künftige Firmware; ohne HTTPS kein Offline‑Cache |
| **Firmware‑HTTP‑API mit CORS** (`/api/info`, `/api/laps`, `/files/<name>`; Referenz `tools/mock-device-server.mjs`) | Änderung am Gerät | nur für künftige Geräte |

## Ordnerstruktur

```
app/
  index.html            App‑Shell (Tabs: Runden, Analyzer, G‑Kraft, Video, Geräte, Setup)
  manifest.webmanifest  PWA‑Manifest, icons/ PNG+SVG
  sw.js                 Service Worker (Precache + OSM‑Kachel‑Cache)
  css/app.css
  js/
    main.js             Routing, SW‑Registrierung
    state.js            Zustand, Auswahl, Einstellungen, Event‑Bus
    db.js               IndexedDB (laps, samples, raw, videos, settings, sectors)
    zip.js              ZIP‑Reader/-Writer (DecompressionStream)
    rnparser.js         RNZ/RN/CDRN‑Parser → typisierte Arrays
    analysis.js         Interpolation, Time Slip, Sektoren, Kanäle
    chart.js            Canvas‑Linienchart + Streudiagramm
    map.js              Canvas‑Karte (Web Mercator, OSM‑Kacheln)
    sync.js             Wiedergabe‑Engine (Cursor ↔ Videos)
    device.js           HTTP‑Client zum RN‑Gerät
    import.js           Import‑Pipeline
    views/              laps, analyzer, gforce, video, devices, settings
tools/
  serve.mjs             Statischer Dev‑Server
  mock-device-server.mjs Mock‑Race‑Navigator (API‑Referenz)
  rn-bridge/            Brücke Race Navigator (PostgreSQL+FTP) → HTTP‑API, mit --discover
```

## Bekannte Grenzen

* iOS öffnet `.rnz`‑Anhänge aus Mail nicht direkt in einer Web‑App (kein File‑Handler für PWAs). Workaround:
  Anhang in „Dateien“ sichern und in der App importieren.
* Videos werden mit `playbackRate ≤ 2` abgespielt; bei 4× läuft der Cursor taktgesteuert und die Videos
  springen nach.
* Kartenkacheln stammen von OpenStreetMap (kein Satellitenbild). Einmal online betrachtete Kacheln werden
  für den Offline‑Betrieb gecacht.
