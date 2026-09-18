# RN Analyzer 2.0 – Specification

**As of:** 2026-09-18 · **App version:** 2.1.20 · **Repository:** github.com/maxzmacrix/rnanalyzer

This document is the authoritative description of the software: vision, scope, architecture, data model, interfaces,
build and quality assurance. It is written so that a person without access to the code or to internal conversations can
understand and evaluate the software. It is updated in the same commit as every functional or architectural change
(section 12). Instructions for building, signing and publishing live in `README.md`; this document does not repeat them.

---

## 1. Vision

**After a session, a driver should know within a minute where they lose time and why.**

RN Analyzer 2.0 replaces the iPad app maintained from 2013 to 2020 (Objective-C) with software that

1. runs on every device the customer owns (iPhone, iPad, Android, desktop browser) without Macrix maintaining one
   codebase per platform;
2. works without a server, an account or a cloud, including in the pit lane without network coverage;
3. shows the answer first (gap to the fastest lap, where on the track, why in the corner) instead of leaving the user
   alone with telemetry channels;
4. keeps serving the unmodified Race Navigator in the field (import and control over its Wi-Fi), because the devices are
   at the customer's and a firmware change must not be a prerequisite.

### Guiding principles (the basis for resolving conflicting goals)

| Principle | What it means in practice |
|---|---|
| **Data stays on the device** | No accounts, no backend, no telemetry to Macrix. External calls only for map tiles, weather and the Android update check, all switchable or free of personal data. AI texts are generated on the device. |
| **Zero dependencies, no build step** | `app/` can be served as is. No frameworks, no bundler, no npm package at runtime. Capacitor is needed only for the native shells. |
| **Answer first** | Every view starts with the result (gap, time lost, tip); details are one tap away. Plain words instead of jargon. |
| **One way, not three** | One analysis screen, one comparison gesture, one connection state to the device. Options are removed when a default can replace them. |
| **Usable with gloves on** | Tap targets at least 40 px, play bar in the thumb zone, landscape with a side rail on touch devices, system theme (light by day). |
| **Deterministic before generative** | The coach computes traceably from measured data. A language model at most rephrases the computed facts and invents none. |

### Non-goals

Deliberately not part of this product (reasons in section 11): cloud storage, user accounts, community features (chat,
teams, leaderboards, event marketplace), subscription model, Facebook/YouTube upload with login, e-mail from the app,
VNC remote control, synchronisation of measurements across track variants.

---

## 2. Target users and situations

| User | Situation | What the app must deliver |
|---|---|---|
| Driver (track day, tourist drive, race) | In the pits between two turns, phone in hand, often offline | Fetch laps from the device, "Compare with best lap", map painted red/green, coach tip, video with overlay |
| Driver at home | Tablet or PC, time for details | Up to 10 laps, 4 videos, channel choice, sector times, g-force plot, Excel export |
| Coach / instructor | Customer data, other people's devices | Import from files (USB, AirDrop, WhatsApp), compare other drivers' laps, share as `.rnz` |
| Workshop / support | Check the device, clean up laps, software state | Race Navigator tab: status, recording, driver/vehicle/track, camera preview, actions |
| Prospect without a device | Store or web link | Guided tour with sample data, hint to the native app |

---

## 3. Product scope

The app has four tabs. The web version has no Race Navigator tab because the browser cannot reach the device
(section 7.1); the hint to the native app then lives in the empty lap list and in Settings.

### 3.1 Laps (`#/laps`)

* List of all imported laps, grouped by event, track and device. Colour codes: white = complete, grey = incomplete,
  yellow = best lap per driver in the event. Badges for video, heart rate, demo data.
* Session header with the weather of the driving hours (Open-Meteo, cached, switchable).
* Filters (complete, with video, outliers, driver, vehicle), sort by time, search across driver, vehicle, track, event, lap time.
  The chip bar scrolls horizontally on touch devices and wraps into rows on mouse devices.
* Selection of up to 10 laps. The red "Compare with best lap (+0.391)" button opens the analysis. "Suggest comparison"
  picks exactly two laps of the session, the fastest clean lap and the typical lap (median time of the other clean laps,
  laps with video preferred so both videos run side by side), explains the choice in a sheet and opens the analysis
  only after confirmation.
* **Context-aware comparison partner** (`reference.js`): for a single selected lap the partner is the best complete lap of
  the same session and driver. When the session has none, the closest match from another session on the same track is
  taken, ranked by same driver, same car, similar weather (dry/wet from the cached session weather), same track variant
  and being faster. A partner from another session is announced under the button with its date and the reasons.
* Session header: "Delete session" removes all laps of the session and the videos only they use, after one
  confirmation that names the counts. Data on the device is not touched.
* Lap menu: Edit (driver, vehicle, note; overrides device data for display only), Share (lap data `.rnz`, video `.mp4`,
  both), load heart rate from Apple Health / Health Connect (native app), Delete (lap, video).
* Import via the file dialog: `.rnz`, `.rn`, `.xml`, `.mp4`/`.mov`/`.m4v`, and `.zip` folders, which are unpacked.
  Renamed videos are matched to their lap by file size. Errors are reported in one sentence.

### 3.2 Analyze (`#/analyze`)

One screen, no mode switch. Top to bottom: videos (up to 4, side by side, tap enlarges, speaker toggles sound), two panels
(three on large screens), play bar at the bottom. Every video cell is exactly 16:9 and centred in its grid area (sized by
`fitVideoCells()` on every resize), so no letterbox bars appear inside the cell; the cell background is graphite, not
black, and only shows while a frame loads.

* **Reference** is always the fastest complete lap of the selection, regardless of tap order.
* **Panel components** (freely assignable; defaults Panel A = gap with speed as second curve, Panel B = map, Panel C =
  coach): gap to the fastest lap (time mode: distance gap), channel line chart, map (fastest lap painted red/green by the
  compared lap's time lost, Esri satellite by default or OSM streets, start and sector lines, corner numbers, optional "map follows the
  cursor"), g-force (scatter lateral vs. longitudinal), values at the cursor, lap overview (min/max, best values
  marked), sector times (device sectors, geometric fallback, custom sectors; best possible and fastest contiguous lap),
  corner coach (section 3.5), highlights (section 3.8), channel strips (below).
* **Channel strips** (`StripChart` in `chart.js`): the classic time-distance view of desktop telemetry tools. The chosen
  channels are stacked as strips with their own y range each, over one shared x axis, zoom and cursor; a band on top
  numbers the corners of the fastest lap (from `detectCorners`, section 3.5) and shades every other corner window; sector
  lines and highlight markers run through all strips. Each strip shows its label, unit and the values of every lap at the
  cursor. Channels are chosen in the component sheet ("Choose channels…", setting `stripChannels`, default speed,
  longitudinal g, lateral g, yaw, RPM, throttle); channels the selected laps do not carry are skipped. The strips keep a
  minimum height, so the panel scrolls when many channels are chosen (one finger up/down scrolls, sideways moves the
  cursor, `touch-action: pan-y`). The y axis does not zoom in this view.
* **Channels**: speed, longitudinal / lateral / vertical / combined acceleration, GPS deviation, altitude, heading,
  gyroscope (yaw/pitch/roll), OBD/CAN (RPM, throttle, water and oil temperature, OBD speed, only when present in the
  file), heart rate, custom CAN channels from `.cdrn`.
* **Component sheet**: one flat list of views, alphabetical in the current language, no groups: gap, channel, channel
  strips, coach, g-force, highlights, lap summary, map, sector times, values at the cursor. Channels are never chosen
  there: the three channel-based views show a "Channels" chip next to the panel title that opens the one channel
  picker, grouped by data channels, gyroscope, OBD, health and CAN. For the channel chart a tap sets the main curve and a
  checkbox adds a second curve; for the gap chart it picks the curve laid over the gap; for the strips it is a
  multi-select with Done.
* **Maximise**: every panel has a maximise button next to its title; videos, dividers and the other panels step aside
  until it is tapped again. The state is a setting (`maxPanel`), so it survives tab switches and restarts. Dividers are
  24 px wide on touch devices. The title chips float over the first 40 px of a panel; charts start their plot below
  that band and keep the cursor values in it, marker labels sit at the bottom of the plot.
* **Cursor** in red, synchronous across charts, map, videos and values. X axis distance or time. Pinch = zoom
  (horizontal X, vertical Y), two-finger drag = pan, double tap = reset, zoom synchronised across panels.
* **Play bar**: play/pause, 5 s back, speed 0.25 to 2× (videos up to 2×, above that clock-driven), live gaps per lap. The
  reference video drives the cursor only while the lap time lies inside its clip; before and after (clips can be short
  cuts of a lap) the clock drives and the videos wait on their first or last frame.
* **Options sheet**: sectors (device, custom, none), axis, chart panels, layout profiles, Excel export (channels,
  distance step, `.xlsx` without a library).
* Custom sectors: long press in the chart or Options → Custom sectors, stored per track.

### 3.3 Race Navigator (`#/device`, native app only)

One connection state: device reachable → connection card, control and import on one page; not reachable → one calm
card with "Search again" (Bonjour `_racenav._tcp`) and "Enter address".

* **Import**: lap list from the device grouped by event (newest first, only the newest event unfolded, per-event
  "Data"/"Video" selection), sorting by driver or lap time as flat lists, data/video selection, download queue with
  progress and speed, jump into the comparison after the download.
* While the device answers, the page shows device data only (name, type, firmware, lap count); IP addresses appear
  only when the connection fails or behind "Change device".
* **Control** (formerly RN Connect): recording on/off and mode (manual, auto 20/40 km/h, standing start, auto RPM),
  driver and vehicle (select, create, rename), change track (search, names cached), event type and new event, video
  quality and layout, status card every 4 s (GPS, battery, storage, remaining time, set time, warnings), camera preview
  (MJPEG, switch camera, rotate), actions (clean up laps, AP password, power off).
* Diagnostics (also under Settings → About): the app-wide log (section 3.7) with the connected device in the header.
* Not implemented yet: pit-lane definition, export to memory stick (requests prepared in the client), RN software
  update (needs an SSH plugin).

### 3.4 Settings (`#/settings`)

Language (device, DE, EN), units km/h or mph, appearance (system, light, dark), colour-blind-friendly palette, load map
tiles, map style (satellite by default, streets), floating tab bar, session weather, on-device AI explanation, storage (usage,
request persistent storage, delete all videos, delete everything), check for update (Android APK), start the guided
tour and remove demo data, reset settings (all settings back to defaults after confirmation; laps, videos and custom
sectors stay), diagnostics (section 3.7), version and notices.

### 3.5 Corner coach and AI explanation

`coach.js` explains deterministically where and why a lap loses against the reference:

* Corners from the track definition; fallback: peaks of lateral acceleration.
* Per corner: braking point (longitudinal g < −0.25 g), apex (the interior local speed minimum nearest to the corner
  anchor; fallback the window minimum), throttle point (longitudinal g > 0.12 g),
  exit speed, lateral line offset to the reference, time lost from the gap curve, split into braking and exit.
* Differences below sensor tolerance are not mentioned: 8 m braking point, 1 m/s apex, 1.5 m line, 0.05 s.
* **With OBD/CAN data** (only when both laps carry the channel): the throttle point comes from the throttle channel
  (≥ 15 %) instead of longitudinal g; additional facts for full throttle (≥ 90 %) reached later or earlier, longer
  coasting between brake release and throttle, throttle lifts on the exit (drops of 25 points or more), and the gear at
  the apex, estimated from the speed/rpm ratio clusters of the fastest lap (gear ratios are a property of the car).
  Lap level: the median upshift rpm of both laps when they differ by 300 rpm or more. Water and oil temperature are
  not used by the coach.
* Patterns across corners ("you brake earlier in 5 of 16 corners", "full throttle later in 4 of 16").
* **What-if per corner** (`whatIfApex`): "+5 km/h at the apex ≈ −0.12 s" (imperial: +3 mph). Deterministic estimate on
  the compared lap's own samples: the extra speed is applied as a triangle peaking at the apex and fading to zero at the
  braking and throttle points, same line assumed. Marked as an estimate; shown per corner and handed to the narration.
  It is not a simulation: no tyre, fuel or weather modelling.
* Shown as a panel: head with both laps and the sentence "The facts describe what L13 does differently from L62",
  summary, corner list by time lost with the what-if line, the tip follows the cursor, the current corner is highlighted.

`ai.js` optionally turns the facts into three to four sentences with a language model **on the device**: iOS 26 via
Apple Foundation Models, Android via Gemini Nano (ML Kit GenAI Prompt API, supported devices only). Without a model the
template text remains. Nothing leaves the phone.

### 3.8 Highlights (moments worth jumping to)

`highlights.js` finds, from telemetry alone, the moments of the compared lap (or the only lap) worth looking at, and
shows them as a panel list and as labelled markers on the charts. A tap moves the cursor and seeks the videos there.

* **g peak**: the three hardest moments (combined lateral and longitudinal g ≥ 0.8 g, local maximum over ±1 s), at least
  100 m apart.
* **loss / gain**: the lap loses or gains at least 0.25 s against the fastest lap within 50 m; up to three of each, the
  largest, at least 100 m apart.
* **off line**: the lap runs more than half the track width plus 2 m away from the fastest lap's line for at least one
  second (default half width 5 m when the track definition has none). One event per excursion, at its widest point.

Rows are labelled with the corner from the coach when the moment lies in one. The panel head says why this lap is shown
(by default the slowest lap of the selection, measured against the fastest) and offers a chip per selected lap to look at
another one. Sign convention as in the coach: plus and red = time lost. Video clips are not cut or exported.

### 3.6 Guided tour

On first start (empty list) and from Settings: two anonymised Guadix sample laps, each with a 20-second clip, are imported,
then the app drives itself through the lap list, the comparison, the analysis with a running cursor, g-force, video, the
Race Navigator tab and Settings. During the analysis scenes the tour sets the default panels (gap + speed, map, coach) so
the texts match what is shown, and restores the user's own layout when it ends. At the end the demo data can be kept or
removed.

### 3.7 Cross-cutting

* **Languages**: English, German, Italian and French; key parity is tested. Web: device language, otherwise English. A new language is
  one more dictionary in `i18n.js`.
* **Offline**: app shell in the service worker precache, map tiles cache-first with a bounded cache, all data in IndexedDB.
* **Updates**: web/PWA via the service worker banner; iOS via App Store/TestFlight; the Android APK compares `build.json`
  with `latest.json` of the newest GitHub release (on start, on resume, every 20 minutes, manually).
* **Sharing**: Web Share API with files (iOS share sheet: Files, AirDrop, WhatsApp, YouTube, Instagram). The Android
  WebView has no Web Share API: the plugin methods `fileBegin`/`fileAppend` stage the file in the app cache in 4 MB
  chunks and `share` opens the Android share sheet through the app's FileProvider content URI (the Capacitor
  template's `${applicationId}.fileprovider`, whose cache path covers the staging folder). Otherwise download.
* **Diagnostics**: `diag.js` records device XML requests, control protocol exchanges, FTP downloads, import results and
  unhandled errors (last 200 entries, memory only). Settings → About → Diagnostics shows the log with app version and
  platform; "Send to support" opens the share sheet with the log as a text file, falling back to a prefilled mail to
  info@rn-vision.com. Nothing is sent automatically.

---

## 4. Architecture

### 4.1 Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  app/  (plain web app, no build)                                             │
│                                                                              │
│  index.html ── main.js (routing, tabs, SW, theme) ── views/                  │
│                                                       laps · analyzer ·      │
│                    state.js (state, selection,        device(devices,control)│
│                    settings, event bus)               · settings             │
│                        │                                                     │
│   Domain:    rnparser · analysis · coach · sync · chart · map · xlsx · zip   │
│   Services:  import · db (IndexedDB) · i18n · ui · share · tour · update     │
│   External:  weather (Open-Meteo) · device (HTTP API) · deviceNative ·       │
│              deviceControl · health · ai  ──► window.Capacitor.RnDevice      │
│                                                                              │
│  sw.js (precache + tile cache)       demo/ (tour data)      css/app.css      │
└──────────────────────────────────────────────────────────────────────────────┘
        │ identical webDir                                │ plugin calls
┌───────┴───────────────────┐                ┌────────────┴───────────────────┐
│ Capacitor shell iOS       │                │ native/rn-device (plugin)      │
│ Capacitor shell Android   │                │ Swift · Java · Kotlin          │
│ (generated in CI, not     │                │ Bonjour/NSD · FTP · PostgreSQL │
│  committed)               │                │ MJPEG · HealthKit/Health Conn. │
└───────────────────────────┘                │ Foundation Models / Gemini Nano│
                                             └────────────────────────────────┘
```

Layers: views (`views/`) render DOM from the state and react to bus events; domain logic consists of pure functions over
typed arrays and runs in the Node tests without a browser; services wrap browser APIs; native capabilities go through a
single Capacitor plugin `RnDevice` that the app registers at runtime.

### 4.2 Modules

| File | Responsibility |
|---|---|
| `app/js/main.js` | Bootstrap, hash routing (`#/laps`, `#/analyze`, `#/device`, `#/settings`, aliases for old routes), theme, language, service worker registration, `APP_VERSION` |
| `app/js/state.js` | Central state (laps, selection, cursor, settings, sample cache with eviction), event bus `on`/`emit`, reference lap `refLapId()`, palettes, units, `settingsVersion` migration |
| `app/js/db.js` | IndexedDB access (section 5.4), storage estimate, persistent storage |
| `app/js/zip.js` | Read ZIP (`DecompressionStream`) and write ZIP (store), no library |
| `app/js/rnparser.js` | `.rnz`/`.rn`/`.cdrn` → lap record and sample arrays (section 5) |
| `app/js/import.js` | Import pipeline: laps before videos, unpack zipped folders, duplicates keep note and overrides |
| `app/js/analysis.js` | Interpolation, channel definitions `CHANNELS`, gap (time slip / distance gap), sector times, geometric sectors, axis steps |
| `app/js/coach.js` | Corner detection, corner metrics, comparison, tolerances `T`, patterns, what-if estimate `whatIfApex` |
| `app/js/highlights.js` | Highlight detection `detectHighlights` (g peaks, time loss/gain within 50 m, off-line excursions), thresholds `H` |
| `app/js/reference.js` | Context-aware comparison partner `pickReference` (session, driver, car, weather, variant, pace) |
| `app/js/ai.js` | Availability and invocation of the on-device language model via the plugin |
| `app/js/sync.js` | Playback engine `player`: cursor from the reference video or a clock, videos synchronised by distance/time, drift tolerance 0.35 s |
| `app/js/chart.js` | Canvas line chart, stacked channel strips (`StripChart`) and scatter plot, zoom/pan, cursor, sector lines |
| `app/js/map.js` | Canvas map in Web Mercator, tile providers (OSM, Esri, custom), traces, painting by time lost, nearest sample |
| `app/js/xlsx.js` | OOXML workbook without a library |
| `app/js/share.js` | Web Share API with files; on Android (WebView without Web Share) files are staged through the plugin (`fileBegin`/`fileAppend`) and handed to the native share sheet (`share`); download fallback |
| `app/js/i18n.js` | Dictionaries DE/EN, `t()`, language detection, date/byte formatting |
| `app/js/ui.js` | DOM helper `h()`, icons, header, toast, sheet, confirm and prompt dialogs, switch, segmented control |
| `app/js/tabbar.js` | Tab bar with press-and-slide and highlight pill; switches the view on pointer release itself (pointer capture keeps the click from reaching the link) |
| `app/js/tour.js` | Load/remove demo data, guided tour |
| `app/js/update.js` | Android update check against the newest GitHub release |
| `app/js/weather.js` | Session weather from Open-Meteo, WMO codes, wind direction, wet/dry classification `isWet`, cache |
| `app/js/health.js` | Heart rate from Apple Health / Health Connect resampled to the lap's time base, channel `hr` |
| `app/js/device.js` | HTTP client for the simple device API (`/api/info`, `/api/laps`, `/files/<name>`), mixed-content detection |
| `app/js/deviceNative.js` | Device client of the native app: Race Navigator HTTP-XML API (port 8080), assembles `.rn` XML, videos via FTP through the plugin, Bonjour discovery |
| `app/js/deviceControl.js` | RN Connect protocol: `currentstatus`, `rarequest` actions, constants (recording modes, video quality, event types, status flags) |
| `app/js/diag.js` | Diagnostics log (`record`, last 200 entries: device XML requests, control protocol, FTP, imports, unhandled errors), sheet with copy and "Send to support" (share sheet, mail fallback) |
| `app/js/views/laps.js` | Lap list, filters, selection, lap menu, import, sharing |
| `app/js/views/analyzer.js` | Analysis screen, panels, component picker, options, Excel export, custom sectors |
| `app/js/views/device.js` | Race Navigator page (connection state), embeds `devices.js` and `control.js` |
| `app/js/views/devices.js` | Lap list from the device, selection, download queue |
| `app/js/views/control.js` | Device control (status, recording, driver, vehicle, track, event, video, camera, actions) |
| `app/js/views/settings.js` | Settings, storage, tour, update, about |
| `app/js/selftest.js` | Self-test inside the running app (`?selftest`), not precached |
| `app/sw.js` | Service worker: precache list `ASSETS`, cache version, stale-while-revalidate for the shell, cache-first for tiles (max. 1500) |

### 4.3 State and data flow

1. `initState()` loads settings (with migration), all lap metadata and the stored selection from IndexedDB.
2. Views subscribe to bus events: `laps`, `selection`, `cursor`, `settings`, `sectors`, `theme`, `resize`, `online`.
3. Sample arrays are loaded on demand (`ensureSamples`) and kept in a cache of at most 24 entries; laps that are not
   selected are evicted first.
4. The cursor is a number in X units (m or s). `setCursor(x, source)` emits `cursor`; the playback engine ignores its
   own events and re-seeks the videos on external cursor moves.
5. All changes to laps go through `db` followed by `reloadLaps()`, which emits `laps`.

### 4.4 Native shell and plugin

The native projects (`ios/`, `android/`) are generated in CI with `npx cap add` and are not committed; committed are
`capacitor.config.json`, icons and splash under `native/ios-assets/` and `native/android-res/`, and the plugin
`native/rn-device/`. The app detects the native environment via `Capacitor.isNativePlatform()`; `fetch` runs natively
through `CapacitorHttp` there, so there are no CORS or mixed-content problems towards the device.

Plugin `RnDevice`, identical methods on iOS (Swift) and Android (Java, Kotlin for health and AI):

| Method | Purpose |
|---|---|
| `discover` | Bonjour/NSD search for `_racenav._tcp` |
| `ftpDownload` | Video from the device (FTP, credentials from the old app) into the app cache, with progress |
| `pgQuery` | PostgreSQL query on the device as a fallback for measurement data |
| `deleteFile` | Remove a file from the app cache |
| `cameraStart` / `cameraStop` | MJPEG stream of the device camera over TCP |
| `healthAvailable` / `healthHeartRate` | HealthKit or Health Connect: heart rate for a time window |
| `aiAvailable` / `aiGenerate` | On-device language model (Apple Foundation Models, Gemini Nano) |

Minimum versions: iOS 16.4 (because of `DecompressionStream`), Android 8 (API 26). Permissions and usage strings (local
network, Bonjour, HealthKit, cleartext HTTP to the device) are set by the respective workflow.

### 4.5 External services

| Service | Purpose | Personal data | Switchable |
|---|---|---|---|
| tile.openstreetmap.org, Esri World Imagery | Map tiles | Tile coordinates only | Yes (load map tiles) |
| api.open-meteo.com, archive-api.open-meteo.com | Weather per session, position from the track definition | No | Yes |
| github.com/…/releases/latest | Android update check (`latest.json`) | No | Android APK only, can be triggered manually |
| Race Navigator in the local Wi-Fi | Import and control | Local | Native app only |

There is no Macrix server, no analytics, no crash reporting.

---

## 5. Data model

### 5.1 Input format RNZ

Per *Race Navigator Files Format Specification rev 1.1*: `.rnz` is a ZIP archive whose comment carries `key=value`
metadata; inside, `*.rn` (XML, namespace `http://macrix.eu/racenavigator/LapDataSchema`) and optionally `*.cdrn`
(CSV `id;measurementtime;lapid;name;unit;value` with additional channels). Sample points `<sm …/>` at 10 Hz. The
attribute mapping and units are tabulated in `README.md` (section "File format"); physically verified: `la` =
longitudinal, `lo` = lateral acceleration (positive = left). Video synchronisation: `videos/video/startTime` is video
second 0.

### 5.2 Lap (metadata, store `laps`)

```
id            "<device>_<lapId>_<startMs>"     unique across devices
lapNumber, type, startMs, endMs, lapTimeMs, complete
driver   { id, name, surname, photo }          vehicle { number, model }
event    { id, name, startMs, endMs }          track   { id, name, distance, width, timeZone, variantId, variantName }
trackDef { startLine[], endLine[], sectors[{name, points[]}], curves[{name, points[]}], picture{sw, ne} }
sectors  [ { n, timeMs } ]                     device sectors
video    { fileName, offsetS, sizeKB }, videos[]   link to the MP4 (first video by locationType)
channels { rpm, throttle, waterTemp, oilTemp, obdSpeed, obd, custom[], hr }   availability per channel
source   { fileName, device, exportDevice, exportVersion, dataVersion, exportTime }
note, driverOverride, vehicleOverride, vehicleNumberOverride, importedAt, demo
```

### 5.3 Samples (store `samples`)

One object per lap with `n` and typed arrays of equal length: `t` (s since lap start), `d` (m), `v` (m/s), `lat`/`lng`
(Float64), `gLat`, `gLon`, `gVert` (g), `alt` (m), `hdg` (°), `dev` (m), `rpm`, `thr`, `wt`, `ot`, `os`, `gyrP`, `gyrR`,
`gyrY`, `gpsOk`, `obdOk` (Uint8), optionally `hr` (bpm) and named custom channels. All analyses (interpolation, gap,
sectors, coach) operate on these arrays and are testable without a DOM.

### 5.4 Persistence (IndexedDB `rn-analyzer`, version 1)

| Store | Key | Content |
|---|---|---|
| `laps` | `id` (indexes `startMs`, `track.id`) | Lap metadata |
| `samples` | `id` | Sample arrays |
| `raw` | `id` | Original `.rnz` bytes (for sharing/export) |
| `videos` | `fileName` | MP4 as Blob, size, type, timestamp |
| `settings` | `key` | `settings` (object with `settingsVersion`), `selected` (lap selection), weather cache |
| `sectors` | `trackId` | Custom sector splits in m |

Videos of 70 to 80 MB are expected; the app requests persistent storage so the system does not evict anything.

---

## 6. Analysis functions (domain definitions)

* **Gap (time slip)**: Δt = t_cmp(d) − t_ref(d) over distance in 5 m steps; in time mode Δs = d_cmp(t) − d_ref(t).
* **Reference**: the fastest complete lap of the selection; without a complete lap, the first selected one.
* **Comparison partner for one lap** (lap list): score = same session 8, same driver 4, same car 3, same wet/dry state 2
  (different state −4), same track variant 1, faster 1; ties go to the faster lap. Only complete laps on the same track.
* **What-if per corner**: Δt = Σ dd · (1/v − 1/(v + Δv·w)) over the compared lap from braking to throttle point, with
  w rising linearly from 0 at the braking point to 1 at the apex and back to 0 at the throttle point; Δv = 5 km/h
  (3 mph). Reported only when ≥ 0.01 s.
* **Sectors**: device sectors from the RNZ; otherwise geometric from the sector lines of the track definition (nearest
  sample to the line); custom splits override both. Best possible lap = sum of the best sectors; fastest contiguous lap
  = best sequence of real sectors.
* **Best lap per driver** per event and track for the yellow marker.
* **Corner coach**: section 3.5. A corner is a region of the reference with |lateral g| above threshold, bounded by the
  track definition.
* **Highlights**: section 3.8; thresholds in `H` of `highlights.js`. Off-line distance = distance from a sample to the
  nearest reference sample within ±15 samples of the same lap distance.
* **Video sync**: the reference video provides the time; other videos are seeked to the time at which their lap reached
  the same distance (or time); re-seek from 0.35 s drift.

---

## 7. Interfaces to the Race Navigator

### 7.1 What the unmodified device offers

Wi-Fi "Analyzer Mode" (network `<device>_AP`), Bonjour `_racenav._tcp`:

* **HTTP REST/XML** `http://<ip>:8080/resources/<uri>` (`deviceinfo`, `drivers`, `vehicles`, `events`, `laps/…`,
  `lapsectors`, `videoinfos`, `lapstovideos`, `sensormeasurements/<from>/<to>`, `tracks`, `trackvariants`,
  `rarequest/…`). Date format `yyyyMMddHHmmssSSS`.
* **FTP** with `.mp4`/`.idx` in the root directory. **PostgreSQL** database `rtts`. Credentials are in `README.md`.
* **Control** (RN Connect): `GET …/resources/currentstatus` (JSON) and actions as
  `rarequest/{type}/{uuid}/{dt1}/{dt2}/{int1}/{int2}/{int3}/{str1}/{str2}/{str3}/0`, polled via `rarequest/{uuid}/{type}`
  with status 0 received, 1 in progress, 2 done, 3 failed. Camera preview: `rarequest/19/{uuid}/1` returns the number of
  cameras and the TCP port of the MJPEG stream.

The browser cannot use this directly (mixed content from HTTPS, no CORS headers, no FTP/PostgreSQL). Hence: the native
app as the customer path, file import as the universal path.

### 7.2 Simple device API (web version, reference for future firmware)

`GET /api/info`, `GET /api/laps`, `GET /files/<name>` with CORS headers and Range support. Reference implementation
`tools/mock-device-server.mjs` (serves a folder of `.rnz`/`.mp4`), production bridge `tools/rn-bridge/` (Node on a laptop
or Raspberry Pi in the device Wi-Fi; generates `.rnz` from the device database, streams videos via FTP, serves the app).
The bridge is complete but not tested against a real device.

---

## 8. Platforms, build and release

| Target | Source | Mechanism | Trigger |
|---|---|---|---|
| Web/PWA | `app/` | GitHub Pages (`pages.yml`), static, HTTPS | Push to `main` |
| iOS (iPhone, iPad) | Capacitor + `native/rn-device` | `ios.yml` on a macOS runner: generate project, Info.plist, signing from secrets, archive, TestFlight upload | Tag `ios-v*`, push to `main` (compile check), manual |
| Android | Capacitor + `native/rn-device` | `android.yml`: generate project, minSdk 26, keystore from secrets, APK + AAB, GitHub release with `latest.json` | Tag `android-v*`, or a manual run with `release: true` (creates the tag itself); push to `main` builds without publishing |

Versions: `APP_VERSION` in `main.js`, `version` in `package.json` and `MARKETING_VERSION` in both workflows must be
equal (tested). Build number = GitHub run number. The service worker cache version `rn-analyzer-vX.Y.Z` in `sw.js` is
bumped with every change to app files, otherwise installed PWAs do not see the change. iOS bundle ID
`com.macrix.RN-Analyzer` (existing store entry), Android package `com.macrix.rnanalyzer`.

Not committed (`.gitignore`): example files, old source code, specification PDFs, generated native projects, signing
material. Whoever shares the software shares this repository plus the store and Pages links.

### Version history

| Version | Date | Contents |
|---|---|---|
| 2.1.20 | 2026-09-18 | Android build fix: the share sheet uses the app template's FileProvider instead of declaring a second one (manifest merge conflict in 2.1.19, whose Android build failed) |
| 2.1.19 | 2026-09-18 | Android: native share sheet for diagnostics, lap data and videos through the plugin (the WebView has no Web Share API, the mail fallback cut the log at 1800 characters); device timeouts are logged as such |
| 2.1.18 | 2026-09-18 | Satellite imagery is the default map style; existing installs on the old default follow (settings migration 4) |
| 2.1.17 | 2026-09-18 | Italian and French added (full dictionaries, language picker, parity test for all languages) |
| 2.1.16 | 2026-09-18 | Playback: the reference video drives the cursor only inside its clip, the clock takes over before and after (short demo clips play from any cursor position); demo data reduced to the two laps with video; landscape side rail keeps its width beside the notch |
| 2.1.15 | 2026-09-18 | Video cells exactly 16:9 and centred (no letterbox bars), graphite cell background; channel strips scroll by touch |
| 2.1.14 | 2026-09-18 | Charts start below the title chips, marker labels at the plot bottom (no overlaps); maximised panel remembered across tab switches |
| 2.1.13 | 2026-09-18 | Component sheet is a flat alphabetical list of views; channels are chosen through a "Channels" chip in the panel title |
| 2.1.12 | 2026-09-18 | Component sheet lists views only, one channel picker for chart, gap overlay and strips; maximise button per panel; wider dividers on touch devices |
| 2.1.11 | 2026-09-18 | Channel strips panel: stacked channels over one distance/time axis with corner band, shared zoom and cursor, channel chooser |
| 2.1.10 | 2026-09-18 | Diagnostics log for the whole app (device XML requests, control protocol, FTP downloads, imports, unhandled errors) under Settings → About and in the control page, with copy and "Send to support" |
| 2.1.9 | 2026-09-18 | Race Navigator page: device data instead of IP addresses while connected (address controls behind "Change device", shown again on failure); laps on the device grouped by event, newest first, per-event selection |
| 2.1.8 | 2026-09-18 | First test against a real device (Android, RN PRO 1.60): fix for data downloads (the assembled measurements XML did not self-close its sample elements, so every .rnz failed to parse); recording off is sent as 2 instead of 0; driver and vehicle change try several parameter layouts; new protocol log in the control page with "Send to support" (share sheet or mail to info@rn-vision.com) |
| 2.1.7 | 2026-09-18 | Landscape phone layout (video rail left, side tab rail) applies only on touch devices with a coarse pointer; a zoomed desktop window with a mouse keeps the stacked layout at any zoom level |
| 2.1.6 | 2026-09-18 | Fix: with the floating tab bar, mouse clicks on the tabs did not switch the view in the browser (pointer capture swallowed the click); the bar now switches on release for taps and slides alike |
| 2.1.5 | 2026-09-18 | "Reset settings" in Settings: all settings back to defaults after confirmation, data untouched |
| 2.1.4 | 2026-09-18 | Coach uses OBD/CAN when both laps have it: throttle point, full-throttle point, coasting, throttle lifts, gear at the apex, shift rpm |
| 2.1.3 | 2026-09-18 | Import button shows an arrow into the tray (files come in), not the upload arrow |
| 2.1.2 | 2026-09-18 | Landscape side-rail layout only when the viewport is clearly wider than tall (aspect ≥ 4:3), so a zoomed squarish desktop window keeps the stacked layout; videos in the side rail stack vertically. Lap times of both compared laps shown in the coach head, on the video labels and next to the reference in the play bar. "Delete session" button in the session header (laps and their videos, with confirmation). Panel title chip no longer covers the coach head. Guided tour: shows the default panels (gap, map, coach) during the analysis scenes and restores the user's layout afterwards; selects two laps itself instead of clicking through the new suggestion sheet; the card no longer stretches to full height with the floating tab bar on phones |
| 2.1.1 | 2026-09-18 | Highlights panel explains the lap choice and lets the user switch laps; sign convention aligned with the coach. Coach panel names whose behaviour the facts describe. Component sheet stays open while checkboxes are toggled. "Suggest comparison" picks two laps (fastest and typical, video preferred) and explains the choice before opening the analysis. Fix: after enlarging a video and changing the laps, the video grid stayed in the enlarged mode with every cell hidden. Filter chips in the lap list wrap on mouse devices instead of scrolling with a hidden scrollbar. Android release from a manual workflow run |
| 2.1.0 | 2026-09-18 | Context-aware comparison partner, what-if per corner, highlights panel and chart markers, interior apex detection; specification in the repository; documentation in English |
| 2.0.x | 2026-09-17 | Rewrite as offline web app with native shells: answer-first analysis, corner coach with on-device AI, session weather, heart rate, guided tour, RN Connect control, Android and iOS builds |

---

## 9. Quality assurance

* **`npm test`** (`tools/test/unit.test.mjs`, Node ≥ 22): language files (key parity, placeholders, all used keys),
  analysis functions, coach on synthetic laps, weather codes, ZIP and XLSX round trips, precache list complete, cache
  version present, tabs ↔ routes ↔ manifest icons, demo data anonymised, versions consistent, **specification current**
  (section 12).
* **Self-test in the app** (`?selftest`): drives the running app through all views, buttons, sheets and dialogs and
  reports the result in a panel, the console and `window.__selftest`.
* **CI compile check** of the native shells on every push that changes `native/**` or the Capacitor configuration.
* Before every release: `npm test`, self-test in the web version, TestFlight or APK build on a real device.

---

## 10. Known limitations

* iOS does not open `.rnz` attachments from Mail directly in a web app; save to Files and import. The native app could be
  registered as a file handler (not implemented yet).
* Videos play at 2× at most; above that the picture jumps after the clock-driven cursor.
* Map tiles offline only as far as they were loaded online before.
* AI explanation only on devices with Apple Intelligence (iOS 26) or Gemini Nano; otherwise template text.
* rn-bridge and the PostgreSQL fallback are not verified against a real device. The control protocol was
  reconstructed from the old apps; the parameter layout of some commands (recording off, driver and vehicle change) is
  being confirmed against a real device, see the protocol log.
* Samples sheet in the Excel export is missing (the Windows app had it).
* Corner windows are the midpoints between the corner anchors of the track definition. For fast kinks and closely spaced
  corners the speed minimum can fall on a window boundary; such corners get no braking/apex facts and no what-if line.
  Windows derived from the speed profile itself would be the fix (candidate).

---

## 11. Decisions and evaluated ideas

Short form of the architecture decisions. New decisions are appended here, never overwritten.

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09 | Web app without framework or build instead of a native rewrite per platform | One codebase for four platforms; no tooling that is obsolete in five years; delivery as static files |
| 2026-09 | Capacitor shells only for device access and store presence | The browser cannot do FTP/PostgreSQL/Bonjour; the old app's store entry is continued |
| 2026-09 | IndexedDB instead of a file system | The only cross-platform large storage in the browser; Blobs for videos |
| 2026-09 | Cloud storage, Facebook/YouTube upload and e-mail from the old app not carried over | The system share sheet covers sharing; no backend; no login maintenance |
| 2026-09 | "Answer first" interaction concept, one analysis screen | Users are drivers in the pits, not data analysts |
| 2026-09 | Coach deterministic, language model only on the device and only for wording | Traceability, no hallucinations, the privacy promise holds |
| 2026-09 | Weather from Open-Meteo, automatic best-lap reference, heart rate from health apps | Context without personal data; reference choice was a source of errors; watches are common among drivers |
| 2026-09 | **"RN Plattform"** (requirements document from March 2023: accounts, subscription, chat, events, coach marketplace, teams, leaderboards, live) **not as an extension of this product** | It is a second product with a backend, running costs, moderation and GDPR duties, and it reverses the principle "data stays on the device". Network effect across the RN device base unclear; the 2023 market claim unverified. Instead, without a backend: compare other drivers' laps via file, track directory with "open in Maps", coaching package as an export. A leaderboard experiment only as a separate, small undertaking. |

| 2026-09-18 | From the AI ideas paper ("AI-Powered Innovation for the Next-Gen Race Navigator", 14 features) **only two adopted**: context-aware comparison partner (Smart Lap Comparison, without tyre/fuel data) and what-if per corner (from Predictive Lap Modeling, as an estimate, not a simulation). Not adopted for this app: coach read-aloud, driver fingerprint, session summary sharing, NL telemetry Q&A, telemetry+video fusion, leaderboards, community coach, setup optimizer, pit/tyre strategy, maintenance predictor, AR/VR, real-time coaching | Both adopted features run on the data in the RNZ, offline and deterministically. The rest needs a cloud, other users' data, vehicle sensors the Race Navigator does not record (tyre and brake temperatures, oil pressure), or belongs to RN Loop/RN Line per the portfolio boundaries. |
| 2026-09-18 | **Highlights adopted** as the third feature from the AI ideas paper (owner decision): markers and a jump list from telemetry (g peaks, time loss/gain, off-line excursions). Automatic video cutting and export stay out | Detection is deterministic on RNZ data and reuses the synchronised video for the jump; cutting clips in the browser is expensive and fragile and adds nothing the jump does not already give |
| 2026-09-18 | Portfolio positioning (RN Line, RN Cloud spine) and the three bridges (deep link to lap and time, per-lap aggregate export, import from URL) **not adopted for now** | Decision by the owner on 2026-09-18: only the two features above. The bridges remain listed as candidates. |

Open candidates (not decided): deep link to lap and timestamp, per-lap aggregate export (JSON), import from an HTTPS link, file handler for `.rnz` in the native app, samples sheet in the Excel export, pit-lane
definition and memory-stick export in the control tab, RN software update over SSH, hosting the app on the device (same
origin), firmware API with CORS for future devices.

---

## 12. Maintaining this specification

* Every change that touches scope, architecture, data model, interfaces, build or non-goals updates this document
  **in the same commit**. Adjust the date in the header, record the decision in section 11.
* `README.md` remains the how-to (setup, build, signing, publishing); `docs/SPEC.md` is the what and why.
* The test "spec: documentation is current" in `tools/test/unit.test.mjs` fails when a module under `app/js`, a plugin
  method, a tab, a workflow or the app version is missing here or the header does not match the version. It does not
  replace reading: whoever changes a feature checks the corresponding section.
* The project language is English: this document, the README, code comments, commit messages and pull requests.
* To share the software, this document plus `README.md` is enough; PDFs and example files deliberately live outside the
  repository.
