# RN Analyzer 2.0 – Web App (PWA)

Reimplementation of the Race Navigator **RN Analyzer** (previously iPad-only, Objective-C, 2013–2020) as an
installable, offline-capable web app for iPhone, iPad, Android and desktop.

> **Specification:** vision, product scope, architecture, data model, interfaces and decisions live in
> [`docs/SPEC.md`](docs/SPEC.md). This README is the how-to for setting up, building and publishing.

* **No dependencies, no build step** – plain HTML/CSS/ES-module JavaScript in the `app/` folder.
* **Offline** – the service worker caches the app shell; all laps, videos and settings live locally in IndexedDB.
* **RNZ + MP4 from local storage** – import via the file dialog (iOS Files app, USB stick, iCloud Drive).
* **Import interface to the RN device** – HTTP API client (`app/js/device.js`) including a mock server; the direct connection to the unmodified device needs the native app (see below).

---

## Quick start (locally on a PC)

```bash
node tools/serve.mjs 8080
```

Then open `http://localhost:8080`. To test the device interface, additionally start the mock RN
(serves the `Example files` folder like a Race Navigator):

```bash
node tools/mock-device-server.mjs 8090 "Example files"
```

In the app under **Devices** enter the address `http://localhost:8090` → Connect → select laps/videos → Download.

> While developing, append `?nosw=1` to the URL so the service worker does not cache.

## Running on the iPhone

A service worker (offline operation, home-screen app) needs **HTTPS** (exception: `localhost`).
Two ways:

1. **Static hosting** (recommended): put the `app/` folder on any HTTPS static host
   (GitHub Pages, Cloudflare Pages, Netlify, your own nginx/IIS). No server logic needed.
2. **Wi-Fi testing only (without offline)**: start `node tools/serve.mjs 8080` on the PC and open the displayed
   address `http://<PC-IP>:8080` in Safari on the iPhone. The app runs completely, only the service worker
   (offline cache) is not registered without HTTPS.

Installation: in Safari **Share → Add to Home Screen**. The app then starts like a native app
(full screen, own icon) and works without network. The iOS system requirement is **iOS 16.4+**
(because of `DecompressionStream` for unzipping the RNZ files).

Storage: iOS grants installed web apps generous IndexedDB storage (videos of 70–80 MB are no
problem). **Setup → Storage** shows the usage; "Request persistent storage" prevents automatic
clean-up by the system.

## Feature scope (checked against the quick-start manual)

| Area | Implementation |
|---|---|
| Lap list | Grouped by event/track/device, colour codes (white = complete, grey = incomplete, yellow = best lap per driver), search, driver photo, video badge, edit (driver/vehicle/note), export (share `.rnz`), delete |
| Analyzer | Up to 10 laps, up to 4 synchronised videos, two freely assignable panels (primary + secondary chart), red cursor synchronous across charts/map/videos, pinch zoom & pan, zoom synchronisation, distance or time axis, play at 0.5×/1×/2×/4× |
| Data channels | Speed, longitudinal/lateral/vertical/combined g, GPS deviation, altitude, heading, gyroscope (yaw/pitch/roll), OBD/CAN (RPM, throttle, water/oil temperature, OBD speed – only when present in the file), custom CAN channels from `.cdrn` |
| Views | Time slip (Δt to the reference lap over distance, Δs in time mode), track map (OSM tiles online, GPS trace offline, start/sector lines, corner numbers), detail data at the cursor, lap overview (min/max, best values circled), sector times (best theoretical / contiguous lap time) |
| Sectors | Device sectors from the RNZ, geometric fallback via the track definition, custom sectors (long press in the chart or Options → Custom sectors) |
| G-force | Scatter plot lateral vs. longitudinal acceleration of all selected laps, cursor marker |
| Video player | Single video with data overlay (speed, lap time), ±1 s, speed 0.25–2×, sound |
| Devices | Connection to the RN via HTTP API, lap list with sorting, data/video selection, download queue with progress/speed |
| Settings | Language (DE/EN), km/h ↔ mph, colour-blind-friendly palette, map tiles, storage management, delete everything |
| Not carried over | Cloud storage (Google), Facebook/YouTube sharing, e-mail, "synchronise measurements from different track variants" |

## File format (RNZ)

Implemented per *Race Navigator Files Format Specification rev 1.1* and verified against the example files:

* `.rnz` = ZIP archive; the ZIP comment contains `key=value` metadata; inside `*.rn` (XML, schema
  `http://macrix.eu/racenavigator/LapDataSchema`) and optionally `*.cdrn` (CSV with additional channels).
* Sample points `<sm …/>` (10 Hz) – attribute mapping (`app/js/rnparser.js`):

| Attribute | Meaning | Unit in file | App |
|---|---|---|---|
| `mt` | Measurement time (device local time) | timestamp | s since lap start |
| `ds` | Distance in the lap | mm | m |
| `gs` | GPS speed | mm/s | m/s → km/h/mph |
| `la` | **Longitudinal** acceleration (xAccel) | mg | g (+ = accelerating) |
| `lo` | **Lateral** acceleration (yAccel) | mg | g (+ = left, RN convention) |
| `za` | Vertical acceleration | mg | g |
| `lt`/`lg` | Latitude/longitude | ° | ° |
| `al` | Altitude | m | m |
| `dr` | Heading | ° | ° |
| `gd` | GPS position deviation | mm | m |
| `df` | Distance offset | mm | – |
| `ph`/`rl`/`ya` | Gyroscope pitch/roll/yaw | raw (÷1000 like the old app) | – |
| `rp`, `tp`, `wt`, `ot`, `os`, `iobdv` | OBD/CAN | –1/0 = not present | only when present |
| `igpsv` | GPS valid | 0/1 | filter for the map |

The mapping `la` = longitudinal / `lo` = lateral was verified physically (correlation with dv/dt 0.94 and with
v·yaw rate 0.98) and matches the old code (`xAccel` = Longitudinal, `yAccel > 0` = Max Left).

Video synchronisation: `videos/video/startTime` is the timestamp of video second 0 → offset to the lap start
(`lap.video.offsetS`).

## Device interface – state of affairs

From the source code of the old app and the `RNDataHandler` library (`Old RN Analyzer/rndatahandler-master`) it
follows what the **unmodified Race Navigator** offers in its Wi-Fi ("Analyzer Mode", network `<device>_AP`):

| Service | Details |
|---|---|
| **HTTP REST/XML** | `http://<ip>:8080/resources/<uri>`, `Accept: application/xml`. URIs: `deviceinfo`, `drivers`, `vehicles`, `events`, `events/<id>`, `laps/<date>/from`, `laps/byeventid/<id>`, `lapsectors`, `videoinfos`, `videoinfos/<date>/from`, `videoinfos/bylapid/<id>`, `lapstovideos/<date>/from`, `lapstovideos/bylapid/<id>`, `sensormeasurements/<from>/<to>` (sample points `<sm …/>` with the same attributes as in the RNZ, yaw rate here `yw`), `sensormeasurements/<date>/count`, `…/next`, `tracks`, `tracks/<id>`, `trackvariants`, `trackvariants/<id>`, `trackvariantimages/<id>/<type>`, `availablevideolayouts`, `rarequest/…` (actions such as video split). Date format `yyyyMMddHHmmssSSS`. |
| **FTP** | Video files `.mp4` and `.idx` in the root directory, login `rtts` / `rtts8888`. |
| **PostgreSQL** | Database `rtts`, login `rtts` / `rtts8888`, table `sensorsmeasurements` (columns `longitudinalaccel`, `lateralaccel`, `gpsspeed`, `gpspositiondeviation`, …). Used by the old app only as a supplement. |
| **Discovery** | Bonjour `_racenav._tcp`; default test IPs `192.168.1.158`/`.161`. |

**Why the web app cannot use this directly:** Safari blocks every `http://` access from an HTTPS page
(mixed content), the device server sends no CORS headers, and FTP/PostgreSQL are fundamentally unreachable for
browsers. The web version therefore shows only the hint to the **native app** in the **Race Navigator** tab (no connection dialog);
the file import (USB stick from SETTINGS › EXPORT VIDEO, iCloud, AirDrop) works completely in the
web version.

### Native app (recommended path for customers) – included in the repository

The Capacitor iOS shell is included and is built **without a Mac** on GitHub Actions macOS runners
(`.github/workflows/ios.yml`). Components:

* `capacitor.config.json`, `package.json` – Capacitor project, `webDir` = `app/` (unmodified web app).
* `native/rn-device/` – Capacitor plugin (Swift): Bonjour search `_racenav._tcp`, FTP download (`rtts`/`rtts8888`)
  into the app cache, PostgreSQL query (PostgresClientKit) as a fallback for measurement data.
* `app/js/deviceNative.js` – device client in the app: fetches `deviceinfo`, `laps`, `drivers`, `vehicles`, `events`,
  `videoinfos`, `lapstovideos`, `lapsectors`, `trackvariants`, `tracks` and `sensormeasurements` over the
  HTTP-XML API (`fetch` runs natively in the app, i.e. without CORS/mixed content), assembles the `.rn` XML from
  them and hands it to the normal RNZ import pipeline; videos arrive via FTP through the plugin.
  In the app, the **Race Navigator** tab shows connection (address, "Search" via Bonjour), the device control
  (formerly RN Connect) and the lap/video import on one page instead of the hint.

**Set up build & TestFlight (once, about 15 minutes, no Mac needed):**

1. In App Store Connect → *Users and Access* → *Integrations* → *App Store Connect API* create a key with the role
   **App Manager** (or Admin). Note: **Key ID**, **Issuer ID**, download the file `AuthKey_<KEYID>.p8`.
2. In the GitHub repository → *Settings → Secrets and variables → Actions* create three secrets:
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (complete content of the .p8 file). They are used for the TestFlight upload.
3. Generate the signing material once locally (Windows/Linux is enough, needs Node and the openssl from Git for Windows):

   ```bash
   node tools/ios-signing-setup.mjs --key "<path>\AuthKey_<KEYID>.p8" --key-id <KEYID> --issuer <ISSUER-UUID>
   ```

   Via the App Store Connect API the script creates an **Apple Distribution certificate** and an **App Store provisioning profile**
   for the bundle ID (Apple allows at most 3 distribution certificates per team; if necessary revoke an old one under
   developer.apple.com → Certificates – apps in the store are not affected) and writes a password-protected `.p12`,
   the profile and `github-secrets.txt` to `Integration/ios-signing/` (git-ignored).
   From these create three more secrets: `IOS_P12_BASE64`, `IOS_P12_PASSWORD`, `IOS_PROFILE_BASE64`.
   Certificate and profile are valid for one year; to renew, run the script again and update the secrets.
   (Apple's "cloud signing" using only the API key does not work reliably on throwaway runners, because the certificate
   created in one run has no private key in the next run – hence the fixed certificate.)
4. Optionally as *Variables*: `APPLE_TEAM_ID` (default `Z2LYJ5597T`, Macrix Software GmbH) and `IOS_BUNDLE_ID`
   (default `com.macrix.RN-Analyzer`, the bundle ID of the previous app – the build then appears as version 2.1.0
   in the existing App Store entry). If the developer account belongs to a different team, set both variables and
   create an app with this bundle ID once in App Store Connect.
5. Start the workflow **"iOS app → TestFlight"** under *Actions* via *Run workflow* (or push a tag `ios-v2.1.0-bN`).
   Without signing secrets only the compile check runs (with a warning); with secrets, archive, export and
   TestFlight upload run automatically. Errors appear as annotations in the run overview.
   Minimum iOS is 16.4 (`MIN_IOS` in the workflow; the RNZ import needs `DecompressionStream`), device family iPhone + iPad.
   App icon and launch screen come from `native/ios-assets/` (generated with `tools/make-icons.py` from the RN logo PDF).
6. In App Store Connect → TestFlight invite testers; later *Submit for review* as usual.

The compile check also runs on every push that changes `native/**` or the Capacitor configuration.

### Interaction concept 2.0 ("answer first")

* **One way to the comparison:** tap a lap → red button "Compare with best lap (+0.391)" (or "Compare" with several) →
  analysis. "Suggest comparison" and the device download jump straight ahead.
* **The reference is always the fastest complete lap** of the selection (`refLapId()` in `state.js`), regardless of tap order.
* **The analysis opens with the answer:** Panel A = "Gap to the fastest lap" with speed as the second curve, Panel B = map
  on which the fastest lap is painted red/green where the compared lap loses/gains. In the play bar (bottom, thumb zone)
  the gaps per lap run along as numbers; "5 s back", speed 0.25–2×.
* **One analysis screen:** no more mode switch. Videos side by side with speed/lap-time overlay, tap = large,
  speaker = sound; g-force is a panel component like map or sector times.
* **Fewer options:** options sheet = sectors, axis, Excel. The channel picker shows five main rows, the rest under "More channels".
  Layout profiles, panel count (now automatic) and zoom buttons (pinch/double tap) are gone.
* **Plain words:** "Gap", "Map", "Values at cursor", "Sector times", "Best possible" instead of telemetry terms; session header without σ.
* **Ergonomics:** tap targets ≥ 40 px, landscape with a side rail, two-finger zoom no longer moves the cursor.
* **Race Navigator (app):** one connection state – reachable → connection, control, import; otherwise a calm card with
  "Search again"/"Enter address". The web version has no device tab; the store hint lives in the empty start screen and under Settings.
* **Import:** zipped folders are unpacked, renamed videos are matched by file size, errors in one sentence.
* **Defaults:** appearance "System", device language; existing installations are migrated once (`settingsVersion`).

### Tests

* `npm test` – Node tests (`tools/test/unit.test.mjs`): language files (key parity, placeholders, all keys used in the
  app), analysis functions, ZIP/XLSX round trip, service worker precache list, tabs ↔ routes, demo data, workflow versions,
  specification currency.
* **Self-test in the app**: open the web version with `?selftest` (e.g. `http://localhost:8080/?nosw&selftest`). `app/js/selftest.js`
  drives the running app through all views, buttons, sheets and dialogs (import of the demo data, filters, sorting, search,
  comparison suggestion, selection, lap menu, edit, confirm, analyzer controls, options, component picker, custom sectors,
  Excel, lap picker, g-force, video, Race Navigator tab, settings, tour, delete, delete everything) and shows result and
  errors in a panel, in the console and in `window.__selftest`. Run both before every release.

### Heart rate (Apple Health / Health Connect)

In the native app the lap menu ("Load heart rate from Apple Health" or "… from Health Connect") loads the heart rate
of a watch for the lap's time window, resamples it to the time base of the measurement data and stores it as channel `hr`
(`app/js/health.js`, channel "Heart rate" in the analyzer, ♥ badge in the list). iOS: HealthKit in the Swift plugin; the
workflow sets entitlement and usage strings; the App ID needs the HealthKit capability (`tools/ios-signing-setup.mjs --renew-profile
--capabilities HEALTHKIT`). Android: Health Connect via `RnHealth.kt` (Kotlin, connect-client), permission
`READ_HEART_RATE` and rationale activity in the plugin manifest; on Android 9–13 the Health Connect app must be installed.

### Corner coach and AI explanation

`app/js/coach.js` explains deterministically where and why a lap loses against the fastest one: corners from the track definition
(fallback: lateral-acceleration peaks), per corner braking point (longitudinal g < −0.25 g), apex (minimum speed), throttle point
(longitudinal g > 0.12 g), exit speed and lateral line offset to the reference; time lost per corner from the gap curve, split into
braking and exit. Differences below sensor tolerance (8 m braking point, 1 m/s apex, 1.5 m line, 0.05 s) are not
mentioned. Patterns across corners ("you brake earlier in 5 of 16 corners") are added. In the analyzer the coach is a
panel component (default in the third panel on large screens): summary, corner list by time lost, the tip follows the
cursor to the corner, the current corner is highlighted.

`app/js/ai.js` optionally turns the facts into three to four sentences with a language model **on the device**: iOS 26 via Apple
Foundation Models (Swift plugin, `aiGenerate`), Android via Gemini Nano with the ML Kit GenAI Prompt API (`RnAi.kt`, only on
supported devices such as Pixel 9 / Galaxy S25). Without a model the template text remains. Switchable under *Settings →
On-device AI explanation*. Nothing leaves the phone.

### Weather per session

Below every session the lap list shows the weather of the driving hours (`app/js/weather.js`): symbol and condition, temperature,
wind with direction, precipitation or "dry". Source is Open-Meteo (free, no key, CC BY 4.0; archive API for older
days, forecast API with `past_days` for the last few days). Position from the track definition of the lap, date from the first
lap; one request per session, result cached in IndexedDB, units follow the setting (°C/km/h or °F/mph).
Switchable under *Settings → Show session weather*; the attribution is in the subtitle there.

### Guided tour with sample data

On first start (empty lap list) and under *Settings → Guided tour* the app drives itself once through the most important
features (`app/js/tour.js`): three Guadix sample laps (`app/demo/`, drivers anonymised, two 20-second clips of 1 MB each)
are imported, then lap list, session analysis, comparison suggestion, analysis with a running cursor, g-force, video,
Race Navigator tab and Settings are shown with spotlight and explanatory text. At the end the sample data can be kept or
removed (also later under Settings). The demo data is generated by `tools/make-demo.py` from `Example files/` (needs ffmpeg).

### Android app – included in the repository

The same web app as a Capacitor Android shell, built on GitHub Actions Linux runners (`.github/workflows/android.yml`).
The plugin `native/rn-device/android` (Java) offers the same interface as the iOS variant: mDNS search
(`NsdManager`), FTP download, camera MJPEG over TCP and PostgreSQL (pgjdbc) as a fallback. Minimum Android 8 (API 26).

1. Generate the signing key once (no Android Studio needed):

   ```bash
   node tools/android-keystore-setup.mjs
   ```

   Create the three printed values as secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`.
   Back up the folder `Integration/android-signing/` – updates must be signed with the same key.
2. Push a tag, e.g. `android-v2.1.0-b1`. The workflow builds `RN-Analyzer.apk` (direct installation) and `RN-Analyzer.aab`
   (Play Store) and publishes both as a GitHub release. Fixed download link for customers:
   `https://github.com/maxzmacrix/rnanalyzer/releases/latest/download/RN-Analyzer.apk` – the web version shows it on
   Android devices in the **Race Navigator** tab.
3. Optionally Play Store: developer account (one-off 25 USD, preferably under RN Vision), create the app, upload `RN-Analyzer.aab`.
   Without keystore secrets the workflow builds a debug APK for testing.

### Other paths

| Path | Prerequisite | Status |
|---|---|---|
| **USB stick** (SETTINGS › EXPORT VIDEO, stick via adapter to the iPhone/iPad, import in the app) | nothing | works today |
| **rn-bridge** (`tools/rn-bridge`, Node on a laptop/Raspberry in the RN Wi-Fi, serves app + HTTP API, generates `.rnz` from the DB, streams videos via FTP) | one computer in the Wi-Fi | complete, untested against a real device (`--discover` first); for workshop/support |
| **Host the app on the device** (static files in the RN's HTTP server, same origin → no CORS/mixed-content problems) | update package for the device | option for future firmware; no offline cache without HTTPS |
| **Firmware HTTP API with CORS** (`/api/info`, `/api/laps`, `/files/<name>`; reference `tools/mock-device-server.mjs`) | change on the device | future devices only |


## RN Connect – integrated into the app ("Control" tab, native app)

The features of the old RN Connect app (manual `Specification/RN-Connect-manual.pdf`) are implemented as the **Control** tab
in the same app (`app/js/views/control.js`, protocol in `app/js/deviceControl.js`). Everything runs over the
device's HTTP API; in the web version the tab shows only the hint to the native app.

| RN Connect | RN Analyzer 2.0 |
|---|---|
| Device list / pairing | **Race Navigator** tab (Bonjour search `_racenav._tcp`, address) |
| Download, sort, search laps | **Race Navigator** tab → Import section with progress; **Laps** tab |
| Watch, share videos | **Video** / **Analyzer** tab; share as `.rnz` via the iOS share sheet |
| Basic data: recording on/off, recording mode (manual, auto 20/40 km/h) | **Control** → REC button, mode |
| Manage drivers / vehicles (select, create, rename) | **Control** → Driver, Vehicle |
| Change track (search) | **Control** → Track (names are loaded once from the device and cached) |
| Event type, new event | **Control** → Event type, Start new event |
| Video settings, layout, Full HD | **Control** → Video quality, Video layout |
| Device status (GPS, battery, storage, remaining time, set time, warnings) | **Control** → Status card (refreshed every 4 s) |
| Camera preview (MJPEG, switch camera, rotate) | **Control** → Camera preview (plugin `cameraStart`) |
| Clean up laps, AP password, power off | **Control** → Actions |
| Pit-lane definition, export to memory stick | not implemented yet (`REQ.SetPitlaneDefinition`, `REQ.ExportToMemoryStick` are prepared in the client) |
| RN software update (cvs.macrix.eu → FTP → SSH/SCP `root` onto the device) | not implemented yet – needs an SSH plugin (libssh2/NMSSH); updater service and procedure are documented in `Old RN Analyzer/rnconnect-master` |
| Facebook/YouTube upload, Google login | deliberately not carried over |

Protocol (reconstructed from RNConnect/RNDataHandler): `GET …/resources/currentstatus` (JSON), actions as
`GET …/resources/rarequest/{type}/{uuid}/{dt1}/{dt2}/{int1}/{int2}/{int3}/{str1}/{str2}/{str3}/0` → `{status: <requestId>}`,
polling `GET …/resources/rarequest/{uuid}/{type}` → `{rarequest:[{id,status,intParam1..3,stringParam1..3}]}` with
status 0 received, 1 in progress, 2 done, 3 failed. Camera preview: `rarequest/19/{uuid}/1` returns the
number of cameras (`intParam1`) and the first TCP port (`intParam2`); a raw MJPEG stream arrives there.


## Comparison with RN Analyzer for Windows

Source: `Specification/Quickstart-Guide-RN-Analyzer-for-Windows-EN-29-09-21.pdf` and `Old RN Analyzer/rnanalyzerwindows-master`.

| Windows feature | RN Analyzer 2.0 |
|---|---|
| Zoom on the Y axis, pan in both directions | Spread two fingers vertically = Y zoom, horizontally = X zoom, two-finger drag = pan; mouse: scroll wheel over the Y axis (or Shift) = Y zoom; double tap = reset |
| Up to 10 laps, 5 videos | 10 laps, 4 videos at once |
| Any number of components, resizable | Video + 2 or 3 panels (Options → Chart panels), sizes via handle |
| User profiles (components, order, sizes) | Options → Layout profiles (save, apply, delete) |
| Excel export (lap list + data with distance step) | Options → Export to Excel: choose channels, step in m; `.xlsx` generated without a library (`app/js/xlsx.js`), output via share menu/download |
| Export of laps as RNZ + video (folder) | Laps → ⋯ → share lap data / video / both (Files app, AirDrop, Mail, Instagram, YouTube, WhatsApp) |
| Import from folder | Laps → Import files (multi-select) |
| "Follow" (map follows the cursor) | Options → Map follows the cursor |
| Bing aerial imagery | Map style: street map (OSM) or satellite (Esri World Imagery) |
| Dark charts | Default |
| Notes per lap, lap filter/search | Edit → Note; search across driver, vehicle, track, event, lap time |
| RN Remote Control (VNC viewer, password `RNRemote`) | not carried over (no VNC in the browser; the control in the "Control" tab covers driver/vehicle/track/recording/video) |
| Print screen | System feature (Share → Print / screenshot) |
| Samples sheet in the Excel export | not implemented yet |

### Sharing to Instagram / YouTube

The app uses the iOS share menu (Web Share API with files). As soon as Instagram, YouTube, WhatsApp etc. are installed,
they appear there automatically for `.mp4` videos; a dedicated upload dialog with login (like the former
YouTube upload in RN Connect) is therefore unnecessary. Where sharing files is not available (desktop browser),
the file is downloaded.

### Satellite imagery

`Settings → Map style`: **Satellite** uses Esri World Imagery (attribution shown). Tiles loaded once
are cached for offline use.

## Folder structure

```
app/
  index.html            App shell (4 tabs: Laps · Analyze [charts | g-force | video] · Race Navigator · Settings)
  manifest.webmanifest  PWA manifest, icons/ PNG+SVG
  sw.js                 Service worker (precache + OSM tile cache)
  css/app.css
  js/
    main.js             Routing, SW registration
    state.js            State, selection, settings, event bus
    db.js               IndexedDB (laps, samples, raw, videos, settings, sectors)
    zip.js              ZIP reader/writer (DecompressionStream)
    rnparser.js         RNZ/RN/CDRN parser → typed arrays
    analysis.js         Interpolation, time slip, sectors, channels
    chart.js            Canvas line chart + scatter plot
    map.js              Canvas map (Web Mercator, OSM tiles)
    sync.js             Playback engine (cursor ↔ videos)
    device.js           HTTP client to the RN device
    import.js           Import pipeline
    deviceNative.js     Device client for the native app (HTTP-XML API + plugin)
    deviceControl.js    Device control (RN Connect protocol: currentstatus, rarequest)
    xlsx.js             XLSX writer (Excel export), share.js  Web Share helper
    views/              laps, analyzer, gforce, video, devices, control, settings
native/rn-device/       Capacitor plugin (Swift): Bonjour, FTP, PostgreSQL
capacitor.config.json   Capacitor project (iOS shell), build via .github/workflows/ios.yml
tools/
  serve.mjs             Static dev server
  mock-device-server.mjs Mock Race Navigator (API reference)
  rn-bridge/            Bridge Race Navigator (PostgreSQL+FTP) → HTTP API, with --discover
```

## Known limitations

* iOS does not open `.rnz` attachments from Mail directly in a web app (no file handler for PWAs). Workaround:
  save the attachment in Files and import it in the app.
* Videos play with `playbackRate ≤ 2`; at 4× the cursor is clock-driven and the videos jump after it.
* Map tiles come from OpenStreetMap (no satellite imagery). Tiles viewed online once are cached
  for offline use.
