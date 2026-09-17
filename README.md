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
unerreichbar. Die Web‑Version zeigt im Tab **Race Navigator** deshalb nur den Hinweis auf die **native App** (kein Verbindungsdialog);
der Datei‑Import (USB‑Stick aus SETTINGS › EXPORT VIDEO, iCloud, AirDrop) funktioniert in der
Web‑Version vollständig.

### Native App (empfohlener Weg für Kunden) – im Repository enthalten

Die Capacitor‑iOS‑Hülle liegt bei und wird **ohne Mac** auf GitHub‑Actions‑macOS‑Runnern gebaut
(`.github/workflows/ios.yml`). Bestandteile:

* `capacitor.config.json`, `package.json` – Capacitor‑Projekt, `webDir` = `app/` (unveränderte Web‑App).
* `native/rn-device/` – Capacitor‑Plugin (Swift): Bonjour‑Suche `_racenav._tcp`, FTP‑Download (`rtts`/`rtts8888`)
  in den App‑Cache, PostgreSQL‑Abfrage (PostgresClientKit) als Fallback für Messdaten.
* `app/js/deviceNative.js` – Geräteclient in der App: holt `deviceinfo`, `laps`, `drivers`, `vehicles`, `events`,
  `videoinfos`, `lapstovideos`, `lapsectors`, `trackvariants`, `tracks` und `sensormeasurements` über die
  HTTP‑XML‑API (`fetch` läuft in der App nativ, also ohne CORS/Mixed‑Content), setzt daraus die `.rn`‑XML
  zusammen und übergibt sie der normalen RNZ‑Import‑Pipeline; Videos kommen per FTP über das Plugin.
  Der Tab **Race Navigator** zeigt in der App auf einer Seite Verbindung (Adresse, „Suchen“ per Bonjour), die Gerätesteuerung
  (ehemals RN Connect) und den Runden-/Video‑Import statt des Hinweises.

**Build & TestFlight einrichten (einmalig, ca. 15 Minuten, kein Mac nötig):**

1. In App Store Connect → *Users and Access* → *Integrations* → *App Store Connect API* einen Schlüssel mit Rolle
   **App Manager** (oder Admin) erzeugen. Notieren: **Key ID**, **Issuer ID**, Datei `AuthKey_<KEYID>.p8` laden.
2. Im GitHub‑Repository → *Settings → Secrets and variables → Actions* drei Secrets anlegen:
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (kompletter Inhalt der .p8‑Datei). Sie werden für den TestFlight‑Upload benutzt.
3. Signatur‑Material einmalig lokal erzeugen (Windows/Linux reicht, braucht Node und das openssl aus Git for Windows):

   ```bash
   node tools/ios-signing-setup.mjs --key "<Pfad>\AuthKey_<KEYID>.p8" --key-id <KEYID> --issuer <ISSUER‑UUID>
   ```

   Das Skript legt über die App‑Store‑Connect‑API ein **Apple‑Distribution‑Zertifikat** und ein **App‑Store‑Provisioning‑Profil**
   für die Bundle‑ID an (Apple erlaubt max. 3 Distribution‑Zertifikate pro Team; bei Bedarf ein altes unter
   developer.apple.com → Certificates widerrufen – Apps im Store sind davon nicht betroffen) und schreibt nach
   `Integration/ios-signing/` (git‑ignoriert) eine passwortgeschützte `.p12`, das Profil und `github-secrets.txt`.
   Daraus drei weitere Secrets anlegen: `IOS_P12_BASE64`, `IOS_P12_PASSWORD`, `IOS_PROFILE_BASE64`.
   Zertifikat und Profil gelten ein Jahr; zum Erneuern das Skript erneut ausführen und die Secrets aktualisieren.
   (Apples „Cloud‑Signing“ nur über den API‑Schlüssel funktioniert auf Wegwerf‑Runnern nicht zuverlässig, weil das in
   einem Lauf erzeugte Zertifikat im nächsten Lauf ohne privaten Schlüssel dasteht – daher das feste Zertifikat.)
4. Optional als *Variables*: `APPLE_TEAM_ID` (Standard `Z2LYJ5597T`, Macrix Software GmbH) und `IOS_BUNDLE_ID`
   (Standard `com.macrix.RN-Analyzer`, die Bundle‑ID der bisherigen App – der Build erscheint dann als Version 2.0.0
   im bestehenden App‑Store‑Eintrag). Gehört der Developer‑Account einem anderen Team, beide Variablen setzen und
   in App Store Connect einmal eine App mit dieser Bundle‑ID anlegen.
5. Workflow **„iOS app → TestFlight“** unter *Actions* per *Run workflow* starten (oder Tag `ios-v2.0.0-bN` pushen).
   Ohne Signatur‑Secrets läuft nur der Kompilier‑Check (mit Warnung); mit Secrets werden Archiv, Export und
   TestFlight‑Upload automatisch ausgeführt. Fehler erscheinen als Annotationen in der Run‑Übersicht.
   Mindest‑iOS ist 16.4 (`MIN_IOS` im Workflow; der RNZ‑Import braucht `DecompressionStream`), Gerätefamilie iPhone + iPad.
   App‑Icon und Startbildschirm kommen aus `native/ios-assets/` (erzeugt mit `tools/make-icons.py` aus dem RN‑Logo‑PDF).
6. In App Store Connect → TestFlight Tester einladen; später *Zur Prüfung einreichen* wie gewohnt.

Der Kompilier‑Check läuft außerdem bei jedem Push, der `native/**` oder die Capacitor‑Konfiguration ändert.

### Android App – im Repository enthalten

Dieselbe Web‑App als Capacitor‑Android‑Hülle, gebaut auf GitHub‑Actions‑Linux‑Runnern (`.github/workflows/android.yml`).
Das Plugin `native/rn-device/android` (Java) bietet dieselbe Schnittstelle wie die iOS‑Variante: mDNS‑Suche
(`NsdManager`), FTP‑Download, Kamera‑MJPEG über TCP und PostgreSQL (pgjdbc) als Fallback. Mindestens Android 8 (API 26).

1. Signaturschlüssel einmalig erzeugen (kein Android Studio nötig):

   ```bash
   node tools/android-keystore-setup.mjs
   ```

   Die drei ausgegebenen Werte als Secrets anlegen: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`.
   Den Ordner `Integration/android-signing/` sichern – Updates müssen mit demselben Schlüssel signiert sein.
2. Tag pushen, z. B. `android-v2.0.0-b1`. Der Workflow baut `RN-Analyzer.apk` (direkte Installation) und `RN-Analyzer.aab`
   (Play Store) und veröffentlicht beides als GitHub‑Release. Fester Download‑Link für Kunden:
   `https://github.com/maxzmacrix/rnanalyzer/releases/latest/download/RN-Analyzer.apk` – die Web‑Version zeigt ihn auf
   Android‑Geräten im Tab **Race Navigator** an.
3. Optional Play Store: Entwicklerkonto (einmalig 25 USD, am besten auf RN Vision), App anlegen, `RN-Analyzer.aab` hochladen.
   Ohne Keystore‑Secrets baut der Workflow eine Debug‑APK zum Testen.

### Weitere Wege

| Weg | Voraussetzung | Status |
|---|---|---|
| **USB‑Stick** (SETTINGS › EXPORT VIDEO, Stick per Adapter ans iPhone/iPad, Import in der App) | nichts | funktioniert heute |
| **rn-bridge** (`tools/rn-bridge`, Node auf Laptop/Raspberry im RN‑WLAN, liefert App + HTTP‑API, erzeugt `.rnz` aus der DB, streamt Videos per FTP) | ein Rechner im WLAN | fertig, ungetestet gegen ein echtes Gerät (`--discover` zuerst); für Werkstatt/Support |
| **App auf dem Gerät hosten** (statische Dateien im HTTP‑Server des RN, gleicher Origin → keine CORS/Mixed‑Content‑Probleme) | Update‑Paket für das Gerät | Option für künftige Firmware; ohne HTTPS kein Offline‑Cache |
| **Firmware‑HTTP‑API mit CORS** (`/api/info`, `/api/laps`, `/files/<name>`; Referenz `tools/mock-device-server.mjs`) | Änderung am Gerät | nur für künftige Geräte |


## RN Connect – in die App integriert (Tab „Steuerung“, native App)

Die Funktionen der alten RN‑Connect‑App (Handbuch `Specification/RN-Connect-manual.pdf`) sind als Tab **Steuerung**
in derselben App umgesetzt (`app/js/views/control.js`, Protokoll in `app/js/deviceControl.js`). Alles läuft über die
HTTP‑API des Geräts; in der Web‑Version zeigt der Tab nur den Hinweis auf die native App.

| RN Connect | RN Analyzer 2.0 |
|---|---|
| Geräteliste / Pairing | Tab **Race Navigator** (Bonjour‑Suche `_racenav._tcp`, Adresse) |
| Laps herunterladen, sortieren, suchen | Tab **Race Navigator** → Abschnitt Import mit Fortschritt; Tab **Runden** |
| Videos ansehen, teilen | Tab **Video** / **Analyzer**; Teilen als `.rnz` über das iOS‑Share‑Sheet |
| Basic Data: Aufnahme an/aus, Aufnahmemodus (manuell, Auto 20/40 km/h) | **Steuerung** → REC‑Taste, Modus |
| Fahrer / Fahrzeug verwalten (wählen, anlegen, umbenennen) | **Steuerung** → Fahrer, Fahrzeug |
| Strecke wechseln (Suche) | **Steuerung** → Strecke (Namen werden einmalig vom Gerät geladen und gecacht) |
| Event‑Typ, neues Event | **Steuerung** → Event‑Typ, Neues Event starten |
| Videoeinstellungen, Layout, Full HD | **Steuerung** → Videoqualität, Video‑Layout |
| Gerätestatus (GPS, Akku, Speicher, Restzeit, Zeit setzen, Warnungen) | **Steuerung** → Statuskarte (alle 4 s aktualisiert) |
| Kameravorschau (MJPEG, Kamera wechseln, drehen) | **Steuerung** → Kameravorschau (Plugin `cameraStart`) |
| Runden aufräumen, AP‑Passwort, Ausschalten | **Steuerung** → Aktionen |
| Pit‑Lane‑Definition, Export auf Memory‑Stick | noch nicht umgesetzt (`REQ.SetPitlaneDefinition`, `REQ.ExportToMemoryStick` sind im Client vorbereitet) |
| RN‑Software‑Update (cvs.macrix.eu → FTP → SSH/SCP `root` auf das Gerät) | noch nicht umgesetzt – braucht ein SSH‑Plugin (libssh2/NMSSH); Updater‑Service und Ablauf sind in `Old RN Analyzer/rnconnect-master` dokumentiert |
| Facebook/YouTube‑Upload, Google‑Login | bewusst nicht übernommen |

Protokoll (aus RNConnect/RNDataHandler rekonstruiert): `GET …/resources/currentstatus` (JSON), Aktionen als
`GET …/resources/rarequest/{typ}/{uuid}/{dt1}/{dt2}/{int1}/{int2}/{int3}/{str1}/{str2}/{str3}/0` → `{status: <requestId>}`,
Abfrage `GET …/resources/rarequest/{uuid}/{typ}` → `{rarequest:[{id,status,intParam1..3,stringParam1..3}]}` mit
Status 0 empfangen, 1 in Arbeit, 2 fertig, 3 fehlgeschlagen. Kameravorschau: `rarequest/19/{uuid}/1` liefert die
Anzahl Kameras (`intParam1`) und den ersten TCP‑Port (`intParam2`); dort kommt ein roher MJPEG‑Strom.


## Abgleich mit RN Analyzer für Windows

Quelle: `Specification/Quickstart-Guide-RN-Analyzer-for-Windows-EN-29-09-21.pdf` und `Old RN Analyzer/rnanalyzerwindows-master`.

| Windows‑Funktion | RN Analyzer 2.0 |
|---|---|
| Zoom auf der Y‑Achse, Pan in beide Richtungen | Zwei Finger vertikal spreizen = Y‑Zoom, horizontal = X‑Zoom, zwei Finger ziehen = Pan; Maus: Scrollrad über der Y‑Achse (oder Shift) = Y‑Zoom; Doppeltipp = Reset |
| Bis zu 10 Runden, 5 Videos | 10 Runden, 4 Videos gleichzeitig |
| Beliebig viele Komponenten, Größe anpassbar | Video + 2 oder 3 Panels (Optionen → Diagramm‑Panels), Größen per Griff |
| User Profiles (Komponenten, Reihenfolge, Größen) | Optionen → Layout‑Profile (speichern, anwenden, löschen) |
| Excel‑Export (Lap list + Data mit Distanzschritt) | Optionen → Nach Excel exportieren: Kanäle wählen, Schritt in m; `.xlsx` ohne Bibliothek erzeugt (`app/js/xlsx.js`), Ausgabe über Teilen‑Menü/Download |
| Export der Laps als RNZ + Video (Ordner) | Runden → ⋯ → Rundendaten / Video / beides teilen (Dateien‑App, AirDrop, Mail, Instagram, YouTube, WhatsApp) |
| Import aus Ordner | Runden → Dateien importieren (Mehrfachauswahl) |
| „Follow“ (Karte folgt dem Cursor) | Optionen → Karte folgt dem Cursor |
| Bing‑Luftbild | Kartenstil: Straßenkarte (OSM) oder Satellit (Esri World Imagery) |
| Dark Charts | Standard |
| Notizen je Runde, Lap‑Filter/Suche | Bearbeiten → Notiz; Suche über Fahrer, Fahrzeug, Strecke, Event, Rundenzeit |
| RN Remote Control (VNC‑Viewer, Passwort `RNRemote`) | nicht übernommen (kein VNC im Browser; die Steuerung im Tab „Steuerung“ deckt Fahrer/Fahrzeug/Strecke/Aufnahme/Video ab) |
| Print Screen | Systemfunktion (Teilen → Drucken / Screenshot) |
| Messpunkte‑Blatt im Excel‑Export | noch nicht umgesetzt |

### Teilen zu Instagram / YouTube

Die App nutzt das iOS‑Teilen‑Menü (Web Share API mit Dateien). Sobald Instagram, YouTube, WhatsApp usw. installiert
sind, erscheinen sie dort automatisch für `.mp4`‑Videos; ein eigener Upload‑Dialog mit Login (wie früher der
YouTube‑Upload in RN Connect) ist damit überflüssig. Wo das Teilen von Dateien nicht verfügbar ist (Desktop‑Browser),
wird die Datei heruntergeladen.

### Satellitenbilder

`Einstellungen → Kartenstil`: **Satellit** nutzt Esri World Imagery (Attribution eingeblendet). Einmal geladene Kacheln
werden für den Offline‑Betrieb gecacht.

## Ordnerstruktur

```
app/
  index.html            App‑Shell (4 Tabs: Runden · Analyse [Diagramme | G‑Kraft | Video] · Race Navigator · Einstellungen)
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
    deviceNative.js     Geräteclient für die native App (HTTP‑XML‑API + Plugin)
    deviceControl.js    Gerätesteuerung (RN‑Connect‑Protokoll: currentstatus, rarequest)
    xlsx.js             XLSX‑Writer (Excel‑Export), share.js  Web‑Share‑Helfer
    views/              laps, analyzer, gforce, video, devices, control, settings
native/rn-device/       Capacitor‑Plugin (Swift): Bonjour, FTP, PostgreSQL
capacitor.config.json   Capacitor‑Projekt (iOS‑Hülle), Build per .github/workflows/ios.yml
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
