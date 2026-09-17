// Tiny i18n layer – English (default) and German.

const dict = {
  en: {
    app: 'RN Analyzer',
    nav_laps: 'Laps', nav_analyzer: 'Analyzer', nav_gforce: 'G‑Force', nav_video: 'Video', nav_devices: 'Devices', nav_settings: 'Settings',
    nav_analyze: 'Analyze', nav_device: 'Race Navigator', seg_charts: 'Charts', seg_gforce: 'G‑Force', seg_video: 'Video',
    device_section_control: 'Control', device_section_import: 'Import laps and videos',
    filter_complete: 'Complete', filter_outliers: 'No outliers', filter_video: 'With video', sort_session: 'Session order', sort_time: 'Lap time',
    all_drivers: 'All drivers', all_vehicles: 'All cars', outlier: 'outlier', best_sector: 'Best sector of the session',
    theoretical_short: 'Theoretical', clean_laps: '{c} of {n} clean laps', suggest_compare: 'Suggest comparison',
    suggest_done: '{n} laps selected: best lap, laps with a best sector, typical lap. Open Analyze to compare.',
    storage_protected: 'Protected against automatic clean-up by the system', storage_unprotected: 'Not protected: the system may delete laps and videos when storage runs low. Add the app to the home screen, then tap Protect.', protect: 'Protect',
    android_download: 'Download the Android app', android_hint: 'The Android app connects to the Race Navigator directly. After downloading, open the file and allow the installation.',
    import_files: 'Import files', import_hint: 'Select .rnz lap files and the matching .mp4 videos from your local storage (Files app, USB stick, iCloud).',
    importing: 'Importing…', imported: '{n} file(s) imported', import_error: 'Import failed: {e}',
    no_laps: 'No laps yet. Import .rnz files or download them from a Race Navigator device.',
    search: 'Search', laps_count: '{n} laps', lap: 'Lap', lap_n: 'Lap {n}', driver: 'Driver', vehicle: 'Vehicle', track: 'Track', event: 'Event', device: 'Device', start_time: 'Start time', lap_time: 'Lap time',
    selected: '{n} selected', deselect_all: 'Deselect all', select_hint: 'Tap a lap to select it for comparison (max {n}).', max_selected: 'You can compare at most {n} laps.',
    video: 'Video', no_video: 'no video', video_missing: 'Video file not imported', video_present: 'Video available',
    delete: 'Delete', edit: 'Edit', export: 'Export', share: 'Share', cancel: 'Cancel', save: 'Save', ok: 'OK', close: 'Close', done: 'Done', add: 'Add',
    confirm_delete_lap: 'Delete this lap and its video from this device?', confirm_delete_video: 'Delete the video of this lap?', delete_video: 'Delete video',
    note: 'Note', edit_lap: 'Edit lap',
    play: 'Play', pause: 'Pause', options: 'Options', laps_btn: 'Laps', speed: 'Speed', x_axis: 'X axis', distance: 'Distance', time: 'Time',
    component: 'Component', select_component: 'Select component', secondary_hint: 'Tap the checkbox to show a secondary graph',
    ch_speed: 'Speed', ch_glon: 'Long. G‑Force', ch_glat: 'Lat. G‑Force', ch_gvert: 'Vertical G‑Force', ch_gcomb: 'Combined G‑Force', ch_dev: 'GPS Deviation', ch_alt: 'Altitude', ch_hdg: 'Heading',
    ch_timeslip: 'Time Slip', ch_map: 'Track Runs', ch_detail: 'Detail Data', ch_overview: 'Laps Overview', ch_sections: 'Section Times',
    ch_gyrY: 'Gyroscope Yaw', ch_gyrP: 'Gyroscope Pitch', ch_gyrR: 'Gyroscope Roll', ch_rpm: 'RPM', ch_thr: 'Throttle Position', ch_wt: 'Water Temperature', ch_ot: 'Oil Temperature', ch_os: 'OBD Speed',
    group_basic: 'Data channels', group_views: 'Views', group_gyro: 'Gyroscope', group_obd: 'OBD‑II / CAN',
    opt_sync_zoom: 'Synchronize distance line (zoom)', opt_autoplay: 'Autoplay speed', opt_sectors: 'Display sectors', sectors_default: 'Default', sectors_custom: 'Custom', sectors_none: 'None',
    opt_all_tracks: 'Show laps from all tracks in lap list', opt_edit_sectors: 'Edit custom sectors', opt_x_mode: 'X axis',
    custom_sectors_hint: 'Custom sector splits are positions (m) along the lap. Add a split at the current cursor position.', add_split_at_cursor: 'Add split at cursor ({d} m)', no_splits: 'No custom splits yet.',
    best_theoretical: 'Best Theoretical Lap Time', best_continuous: 'Best Continuous Lap Time', sector: 'Sector', lap_number: 'Lap Number',
    ov_laptime: 'Lap Time [m:s.ms]', ov_distance: 'Distance [{u}]', ov_vmax: 'Max Speed [{u}]', ov_vmin: 'Min Speed [{u}]', ov_vavg: 'Avg Speed [{u}]', ov_acc: 'Max Acceleration [g]', ov_brake: 'Max Braking Force [g]', ov_left: 'Max Left Acceleration [g]', ov_right: 'Max Right Acceleration [g]', ov_comb: 'Max Combined G [g]', ov_rpm: 'Max RPM',
    select_laps_first: 'Select one or more laps in the Laps view first.', select_two_for_timeslip: 'Select at least two laps to see the time slip (reference = first selected lap).',
    reference: 'Reference', vs_reference: 'vs. reference',
    devices_title: 'RN Devices', device_address: 'Device address', connect: 'Connect', disconnect: 'Disconnect', download_data: 'Download data', download: 'Download', downloading: 'Downloading…', waiting: 'Waiting', downloaded: 'Downloaded', failed: 'Failed', data: 'Data',
    device_help: 'Put the Race Navigator into SETTINGS › NETWORK › INTERNET › ANALYZER MODE and join the WiFi network "<device>_AP" on this phone. Then enter the device address and connect.',
    mixed_content_warning: 'This app is served over HTTPS, so the browser blocks plain HTTP connections to the device. Serve the app over HTTP for device access, or give the device an HTTPS endpoint.',
    connection_failed: 'Could not connect to the device: {e}', laps_on_device: 'Laps on device', already_imported: 'imported', sort_by: 'Sort by', sort_start: 'Start time', sort_driver: 'Driver', sort_laptime: 'Lap time',
    settings_title: 'Settings', language: 'Language', speed_units: 'Speed units', metric: 'Metric (km/h)', imperial: 'Imperial (mph)', colorblind: 'Use colorblind‑friendly palette', map_tiles: 'Load map tiles when online (OpenStreetMap)',
    storage: 'Storage', storage_used: '{used} used of {quota}', persist_storage: 'Request persistent storage', persisted: 'Storage is persistent', not_persisted: 'Storage may be evicted by the system',
    delete_all_videos: 'Delete all videos', clear_all: 'Clear all data', confirm_clear_all: 'Delete ALL laps and videos from this device? This cannot be undone.', confirm_delete_videos: 'Delete ALL downloaded videos? Lap data is kept.',
    about: 'About', version: 'Version', install_hint_ios: 'To install on iPhone: open this page in Safari, tap Share and choose "Add to Home Screen". The app then runs offline.',
    offline: 'Offline', online: 'Online', update_available: 'A new version is available – tap to reload.',
    gforce_title: 'G‑Force', lat_g: 'Lateral g‑force [g]', lon_g: 'Longitudinal g‑force [g]',
    video_title: 'Video Player', choose_lap: 'Choose a lap', no_video_laps: 'None of the selected laps has an imported video.', step_back: '−1 s', step_fwd: '+1 s',
    complete: 'complete', incomplete: 'incomplete', best_lap: 'best lap',
    videos_link_hint: '{n} video(s) linked to laps', unlinked_videos: '{n} video(s) without a matching lap',
    at_cursor: 'Values at cursor', channel: 'Channel',
    fit: 'Fit', reset_zoom: 'Reset zoom', map_offline: 'Map tiles unavailable offline – showing GPS track only.',
    sec: 's', m: 'm', ft: 'ft', kmh: 'km/h', mph: 'mph', g: 'g', deg: '°',
    files_stored: '{n} lap(s), {v} video(s)', file_type_unknown: 'Skipped {f}: unknown file type',
    yes: 'Yes', no: 'No', warning: 'Warning', info: 'Info',
    remove_from_selection: 'Remove from selection', videos_limit_hint: 'Videos are shown for the first {n} selected laps.',
    sound: 'Sound', muted: 'Muted',
    native_required_title: 'Direct connection to the Race Navigator',
    native_required_text: 'Downloading laps and videos directly from the Race Navigator over WiFi is available in the native RN Analyzer app for iPhone and iPad. In this web version, import your .rnz and .mp4 files from the Files app – for example from the USB stick exported on the device via SETTINGS › EXPORT VIDEO.',
    go_import: 'Import files instead',
    nav_control: 'Control', control_title: 'Race Navigator', control_native_only: 'Controlling the Race Navigator (recording, driver, car, track, video settings, camera previews) is available in the native RN Analyzer app for iPhone and iPad.',
    control_no_device: 'No Race Navigator connected', control_no_device_hint: 'Enter the device address above or search for it – the controls appear as soon as the device is connected.',
    recording: 'Recording', rec_on: 'REC', rec_off: 'OFF', recording_running: 'Recording is running', recording_standby: 'Ready – tap to start recording', video_processing: 'Processing video…',
    recording_mode: 'Mode', mode_manual: 'Manual', mode_auto20: 'Auto 20 km/h', mode_auto40: 'Auto 40 km/h',
    device_status: 'Device status', battery: 'Battery', free_space: 'free', device_time: 'Device time', time_differs: 'differs by {s} s', sync_time: 'Set time from phone', time_synced: 'Time synchronized',
    event_type: 'Event type', video_quality: 'Video quality', video_layout: 'Video layout', camera_previews: 'Camera previews', camera_previews_sub: 'Live image of all connected cameras', flip_camera: 'Flip',
    start_new_event: 'Start new event', start_new_event_sub: 'Closes the current event and begins a new one',
    cleanup_laps: 'Clean up laps', cleanup_laps_sub: 'Remove incomplete laps or keep the top three per driver', cleanup_hint: 'Deletes laps on the Race Navigator. This cannot be undone.', cleanup_incomplete: 'Remove all incomplete laps', cleanup_top3: 'Keep only the best three laps per driver', cleanup_incomplete_confirm: 'Remove all incomplete laps from the device?', cleanup_top3_confirm: 'Remove all laps except the best three full laps of each driver?',
    wifi_password: 'Access point password', wifi_password_sub: 'Change the WiFi password of the Race Navigator', wifi_password_label: 'New password (empty = open network)', wifi_password_short: 'Use at least 8 characters.', wifi_password_done: 'Password changed – reconnect to the new network.',
    shutdown: 'Shut down', shutdown_sub: 'Switch the Race Navigator off', shutdown_confirm: 'Shut down the Race Navigator now?', shutdown_sent: 'Shutdown sent',
    changing: 'Changing…', starting: 'Starting…', stopping: 'Stopping…', loading: 'Loading…', loading_tracks: 'Loading tracks from the device…', no_results: 'No results', action_failed: 'Failed: {e}', pick_hint: 'Tap to select. Pencil = edit.',
    add_driver: 'Add driver', edit_driver: 'Edit driver', add_vehicle: 'Add car', edit_vehicle: 'Edit car',
    st_gps_unavailable: 'GPS device unavailable', st_usb_camera: 'USB camera error', st_omx_camera: 'Camera error', st_temp_warn: 'Temperature warning', st_temp_high: 'Temperature high', st_temp_critical: 'Temperature critical', st_recorder_error: 'Video recorder error',
    opt_panels: 'Chart panels', opt_follow: 'Map follows the cursor when zoomed in', map_style: 'Map style', map_osm: 'Street map', map_satellite: 'Satellite', map_custom: 'Custom',
    custom_tile_url: 'Custom tile URL ({z}/{x}/{y} placeholders, e.g. your Mapbox/Google key)', satellite_hint: 'Satellite imagery: Esri World Imagery',
    export_excel: 'Export to Excel (.xlsx)', excel_hint: 'Exports {n} selected lap(s): sheet “Lap list” and sheet “Data” with one row per distance step.', excel_channels: 'Channels', excel_step: 'Distance step [m]', generate: 'Generate', generating: 'Generating…',
    share_lap_data: 'Share lap data (.rnz)', share_video: 'Share video (.mp4)', share_both: 'Share data + video', share_hint: 'The share sheet offers Instagram, YouTube, WhatsApp, Mail, AirDrop and the Files app.', share_unsupported: 'Sharing files is not available here – the file was downloaded instead.',
    profiles: 'Layout profiles', profiles_hint: 'A profile stores the panel components, panel sizes, X axis and sector mode. Tap to apply.', save_profile: 'Save current layout as…', profile_name: 'Profile name', no_profiles: 'No profiles yet.', profile_applied: 'Profile “{n}” applied',
    theme: 'Appearance', theme_light: 'Light', theme_dark: 'Dark', theme_system: 'System',
    discover: 'Search', no_devices_found: 'No Race Navigator found in this WiFi. Enable ANALYZER MODE on the device and join its network.',
  },
  de: {
    app: 'RN Analyzer',
    nav_laps: 'Runden', nav_analyzer: 'Analyzer', nav_gforce: 'G‑Kraft', nav_video: 'Video', nav_devices: 'Geräte', nav_settings: 'Einstellungen',
    nav_analyze: 'Analyse', nav_device: 'Race Navigator', seg_charts: 'Diagramme', seg_gforce: 'G‑Kraft', seg_video: 'Video',
    device_section_control: 'Steuerung', device_section_import: 'Runden und Videos importieren',
    filter_complete: 'Vollständig', filter_outliers: 'Ohne Ausreißer', filter_video: 'Mit Video', sort_session: 'Reihenfolge', sort_time: 'Rundenzeit',
    all_drivers: 'Alle Fahrer', all_vehicles: 'Alle Fahrzeuge', outlier: 'Ausreißer', best_sector: 'Bester Sektor der Session',
    theoretical_short: 'Theoretisch', clean_laps: '{c} von {n} sauberen Runden', suggest_compare: 'Vergleich vorschlagen',
    suggest_done: '{n} Runden ausgewählt: beste Runde, Runden mit bestem Sektor, typische Runde. Zum Vergleichen Analyse öffnen.',
    storage_protected: 'Vor automatischer Löschung durch das System geschützt', storage_unprotected: 'Nicht geschützt: Das System darf Runden und Videos bei Speichermangel löschen. App zum Home-Bildschirm hinzufügen, dann auf Schützen tippen.', protect: 'Schützen',
    android_download: 'Android-App herunterladen', android_hint: 'Die Android-App verbindet sich direkt mit dem Race Navigator. Nach dem Download die Datei öffnen und die Installation erlauben.',
    import_files: 'Dateien importieren', import_hint: 'Wähle .rnz-Rundendateien und die passenden .mp4-Videos aus dem lokalen Speicher (Dateien-App, USB-Stick, iCloud).',
    importing: 'Importiere…', imported: '{n} Datei(en) importiert', import_error: 'Import fehlgeschlagen: {e}',
    no_laps: 'Noch keine Runden. Importiere .rnz-Dateien oder lade sie von einem Race Navigator herunter.',
    search: 'Suchen', laps_count: '{n} Runden', lap: 'Runde', lap_n: 'Runde {n}', driver: 'Fahrer', vehicle: 'Fahrzeug', track: 'Strecke', event: 'Event', device: 'Gerät', start_time: 'Startzeit', lap_time: 'Rundenzeit',
    selected: '{n} ausgewählt', deselect_all: 'Auswahl aufheben', select_hint: 'Tippe eine Runde an, um sie zum Vergleich auszuwählen (max. {n}).', max_selected: 'Es können höchstens {n} Runden verglichen werden.',
    video: 'Video', no_video: 'kein Video', video_missing: 'Videodatei nicht importiert', video_present: 'Video vorhanden',
    delete: 'Löschen', edit: 'Bearbeiten', export: 'Exportieren', share: 'Teilen', cancel: 'Abbrechen', save: 'Speichern', ok: 'OK', close: 'Schließen', done: 'Fertig', add: 'Hinzufügen',
    confirm_delete_lap: 'Diese Runde und ihr Video von diesem Gerät löschen?', confirm_delete_video: 'Das Video dieser Runde löschen?', delete_video: 'Video löschen',
    note: 'Notiz', edit_lap: 'Runde bearbeiten',
    play: 'Abspielen', pause: 'Pause', options: 'Optionen', laps_btn: 'Runden', speed: 'Tempo', x_axis: 'X-Achse', distance: 'Distanz', time: 'Zeit',
    component: 'Komponente', select_component: 'Komponente wählen', secondary_hint: 'Checkbox antippen für den Sekundärgraphen',
    ch_speed: 'Geschwindigkeit', ch_glon: 'Längs-G', ch_glat: 'Quer-G', ch_gvert: 'Vertikal-G', ch_gcomb: 'Kombinierte G', ch_dev: 'GPS-Abweichung', ch_alt: 'Höhe', ch_hdg: 'Kurs',
    ch_timeslip: 'Time Slip', ch_map: 'Streckenverlauf', ch_detail: 'Detaildaten', ch_overview: 'Rundenübersicht', ch_sections: 'Sektorzeiten',
    ch_gyrY: 'Gyroskop Gier', ch_gyrP: 'Gyroskop Nick', ch_gyrR: 'Gyroskop Roll', ch_rpm: 'Drehzahl', ch_thr: 'Gaspedal', ch_wt: 'Wassertemperatur', ch_ot: 'Öltemperatur', ch_os: 'OBD-Geschwindigkeit',
    group_basic: 'Datenkanäle', group_views: 'Ansichten', group_gyro: 'Gyroskop', group_obd: 'OBD‑II / CAN',
    opt_sync_zoom: 'Distanzachse synchronisieren (Zoom)', opt_autoplay: 'Autoplay-Tempo', opt_sectors: 'Sektoren anzeigen', sectors_default: 'Standard', sectors_custom: 'Eigene', sectors_none: 'Keine',
    opt_all_tracks: 'Runden aller Strecken in der Liste anzeigen', opt_edit_sectors: 'Eigene Sektoren bearbeiten', opt_x_mode: 'X-Achse',
    custom_sectors_hint: 'Eigene Sektorgrenzen sind Positionen (m) entlang der Runde. Füge eine Grenze an der aktuellen Cursorposition hinzu.', add_split_at_cursor: 'Grenze am Cursor hinzufügen ({d} m)', no_splits: 'Noch keine eigenen Grenzen.',
    best_theoretical: 'Beste theoretische Rundenzeit', best_continuous: 'Beste zusammenhängende Rundenzeit', sector: 'Sektor', lap_number: 'Runde',
    ov_laptime: 'Rundenzeit [m:s.ms]', ov_distance: 'Distanz [{u}]', ov_vmax: 'Max. Geschw. [{u}]', ov_vmin: 'Min. Geschw. [{u}]', ov_vavg: 'Ø Geschw. [{u}]', ov_acc: 'Max. Beschleunigung [g]', ov_brake: 'Max. Bremsverzögerung [g]', ov_left: 'Max. Querbeschl. links [g]', ov_right: 'Max. Querbeschl. rechts [g]', ov_comb: 'Max. kombinierte G [g]', ov_rpm: 'Max. Drehzahl',
    select_laps_first: 'Wähle zuerst eine oder mehrere Runden in der Rundenliste.', select_two_for_timeslip: 'Wähle mindestens zwei Runden für den Time Slip (Referenz = erste gewählte Runde).',
    reference: 'Referenz', vs_reference: 'zur Referenz',
    devices_title: 'RN-Geräte', device_address: 'Geräteadresse', connect: 'Verbinden', disconnect: 'Trennen', download_data: 'Daten laden', download: 'Herunterladen', downloading: 'Lade…', waiting: 'Wartet', downloaded: 'Geladen', failed: 'Fehler', data: 'Daten',
    device_help: 'Stelle den Race Navigator auf SETTINGS › NETWORK › INTERNET › ANALYZER MODE und verbinde dieses Telefon mit dem WLAN "<Gerätename>_AP". Dann Geräteadresse eingeben und verbinden.',
    mixed_content_warning: 'Diese App wird über HTTPS ausgeliefert, daher blockiert der Browser reine HTTP-Verbindungen zum Gerät. Liefere die App über HTTP aus oder gib dem Gerät einen HTTPS-Endpunkt.',
    connection_failed: 'Verbindung zum Gerät fehlgeschlagen: {e}', laps_on_device: 'Runden auf dem Gerät', already_imported: 'importiert', sort_by: 'Sortieren nach', sort_start: 'Startzeit', sort_driver: 'Fahrer', sort_laptime: 'Rundenzeit',
    settings_title: 'Einstellungen', language: 'Sprache', speed_units: 'Geschwindigkeitseinheit', metric: 'Metrisch (km/h)', imperial: 'Imperial (mph)', colorblind: 'Farbenblind-freundliche Palette', map_tiles: 'Kartenkacheln laden, wenn online (OpenStreetMap)',
    storage: 'Speicher', storage_used: '{used} von {quota} belegt', persist_storage: 'Dauerhaften Speicher anfordern', persisted: 'Speicher ist dauerhaft', not_persisted: 'Speicher kann vom System geräumt werden',
    delete_all_videos: 'Alle Videos löschen', clear_all: 'Alle Daten löschen', confirm_clear_all: 'ALLE Runden und Videos von diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.', confirm_delete_videos: 'ALLE heruntergeladenen Videos löschen? Rundendaten bleiben erhalten.',
    about: 'Über', version: 'Version', install_hint_ios: 'Installation auf dem iPhone: Seite in Safari öffnen, „Teilen“ antippen und „Zum Home-Bildschirm“ wählen. Die App läuft dann offline.',
    offline: 'Offline', online: 'Online', update_available: 'Eine neue Version ist verfügbar – antippen zum Neuladen.',
    gforce_title: 'G‑Kraft', lat_g: 'Querbeschleunigung [g]', lon_g: 'Längsbeschleunigung [g]',
    video_title: 'Videoplayer', choose_lap: 'Runde wählen', no_video_laps: 'Keine der gewählten Runden hat ein importiertes Video.', step_back: '−1 s', step_fwd: '+1 s',
    complete: 'vollständig', incomplete: 'unvollständig', best_lap: 'beste Runde',
    videos_link_hint: '{n} Video(s) mit Runden verknüpft', unlinked_videos: '{n} Video(s) ohne passende Runde',
    at_cursor: 'Werte am Cursor', channel: 'Kanal',
    fit: 'Einpassen', reset_zoom: 'Zoom zurücksetzen', map_offline: 'Kartenkacheln offline nicht verfügbar – nur GPS-Spur.',
    sec: 's', m: 'm', ft: 'ft', kmh: 'km/h', mph: 'mph', g: 'g', deg: '°',
    files_stored: '{n} Runde(n), {v} Video(s)', file_type_unknown: '{f} übersprungen: unbekannter Dateityp',
    yes: 'Ja', no: 'Nein', warning: 'Warnung', info: 'Info',
    remove_from_selection: 'Aus Auswahl entfernen', videos_limit_hint: 'Videos werden für die ersten {n} gewählten Runden angezeigt.',
    sound: 'Ton', muted: 'Stumm',
    native_required_title: 'Direkte Verbindung zum Race Navigator',
    native_required_text: 'Runden und Videos direkt per WLAN vom Race Navigator laden – das gibt es in der nativen RN Analyzer App für iPhone und iPad. In dieser Web-Version importierst Du Deine .rnz- und .mp4-Dateien aus der Dateien-App, zum Beispiel vom USB-Stick, den Du am Gerät über SETTINGS › EXPORT VIDEO exportierst.',
    go_import: 'Stattdessen Dateien importieren',
    nav_control: 'Steuerung', control_title: 'Race Navigator', control_native_only: 'Die Steuerung des Race Navigators (Aufnahme, Fahrer, Fahrzeug, Strecke, Videoeinstellungen, Kameravorschau) gibt es in der nativen RN Analyzer App für iPhone und iPad.',
    control_no_device: 'Kein Race Navigator verbunden', control_no_device_hint: 'Gib oben die Geräteadresse ein oder suche das Gerät – die Steuerung erscheint, sobald es verbunden ist.',
    recording: 'Aufnahme', rec_on: 'REC', rec_off: 'AUS', recording_running: 'Aufnahme läuft', recording_standby: 'Bereit – antippen zum Starten', video_processing: 'Video wird verarbeitet…',
    recording_mode: 'Modus', mode_manual: 'Manuell', mode_auto20: 'Auto 20 km/h', mode_auto40: 'Auto 40 km/h',
    device_status: 'Gerätestatus', battery: 'Akku', free_space: 'frei', device_time: 'Gerätezeit', time_differs: 'weicht {s} s ab', sync_time: 'Zeit vom Telefon setzen', time_synced: 'Zeit synchronisiert',
    event_type: 'Event-Typ', video_quality: 'Videoqualität', video_layout: 'Video-Layout', camera_previews: 'Kameravorschau', camera_previews_sub: 'Livebild aller angeschlossenen Kameras', flip_camera: 'Drehen',
    start_new_event: 'Neues Event starten', start_new_event_sub: 'Schließt das aktuelle Event und beginnt ein neues',
    cleanup_laps: 'Runden aufräumen', cleanup_laps_sub: 'Unvollständige Runden entfernen oder nur die besten drei je Fahrer behalten', cleanup_hint: 'Löscht Runden auf dem Race Navigator. Das kann nicht rückgängig gemacht werden.', cleanup_incomplete: 'Alle unvollständigen Runden entfernen', cleanup_top3: 'Nur die besten drei Runden je Fahrer behalten', cleanup_incomplete_confirm: 'Alle unvollständigen Runden vom Gerät entfernen?', cleanup_top3_confirm: 'Alle Runden außer den besten drei vollständigen Runden jedes Fahrers entfernen?',
    wifi_password: 'Access-Point-Passwort', wifi_password_sub: 'WLAN-Passwort des Race Navigators ändern', wifi_password_label: 'Neues Passwort (leer = offenes Netz)', wifi_password_short: 'Mindestens 8 Zeichen verwenden.', wifi_password_done: 'Passwort geändert – bitte neu mit dem WLAN verbinden.',
    shutdown: 'Ausschalten', shutdown_sub: 'Race Navigator herunterfahren', shutdown_confirm: 'Race Navigator jetzt ausschalten?', shutdown_sent: 'Ausschalten gesendet',
    changing: 'Wird geändert…', starting: 'Startet…', stopping: 'Stoppt…', loading: 'Lädt…', loading_tracks: 'Strecken werden vom Gerät geladen…', no_results: 'Keine Treffer', action_failed: 'Fehlgeschlagen: {e}', pick_hint: 'Antippen zum Auswählen. Stift = bearbeiten.',
    add_driver: 'Fahrer hinzufügen', edit_driver: 'Fahrer bearbeiten', add_vehicle: 'Fahrzeug hinzufügen', edit_vehicle: 'Fahrzeug bearbeiten',
    st_gps_unavailable: 'GPS-Empfänger nicht verfügbar', st_usb_camera: 'USB-Kamera-Fehler', st_omx_camera: 'Kamerafehler', st_temp_warn: 'Temperaturwarnung', st_temp_high: 'Temperatur hoch', st_temp_critical: 'Temperatur kritisch', st_recorder_error: 'Fehler im Videorekorder',
    opt_panels: 'Diagramm-Panels', opt_follow: 'Karte folgt dem Cursor, wenn hineingezoomt', map_style: 'Kartenstil', map_osm: 'Straßenkarte', map_satellite: 'Satellit', map_custom: 'Eigene',
    custom_tile_url: 'Eigene Kachel-URL ({z}/{x}/{y}-Platzhalter, z. B. mit eigenem Mapbox/Google-Schlüssel)', satellite_hint: 'Satellitenbilder: Esri World Imagery',
    export_excel: 'Nach Excel exportieren (.xlsx)', excel_hint: 'Exportiert {n} gewählte Runde(n): Blatt „Lap list“ und Blatt „Data“ mit einer Zeile pro Distanzschritt.', excel_channels: 'Kanäle', excel_step: 'Distanzschritt [m]', generate: 'Erzeugen', generating: 'Wird erzeugt…',
    share_lap_data: 'Rundendaten teilen (.rnz)', share_video: 'Video teilen (.mp4)', share_both: 'Daten + Video teilen', share_hint: 'Im Teilen-Menü erscheinen Instagram, YouTube, WhatsApp, Mail, AirDrop und die Dateien-App.', share_unsupported: 'Dateien teilen ist hier nicht verfügbar – die Datei wurde stattdessen heruntergeladen.',
    profiles: 'Layout-Profile', profiles_hint: 'Ein Profil speichert die Panel-Komponenten, Panelgrößen, X-Achse und Sektormodus. Antippen zum Anwenden.', save_profile: 'Aktuelles Layout speichern als…', profile_name: 'Profilname', no_profiles: 'Noch keine Profile.', profile_applied: 'Profil „{n}“ angewendet',
    theme: 'Darstellung', theme_light: 'Hell', theme_dark: 'Dunkel', theme_system: 'System',
    discover: 'Suchen', no_devices_found: 'Kein Race Navigator in diesem WLAN gefunden. Am Gerät ANALYZER MODE aktivieren und dessen Netz beitreten.',
  },
};

let lang = 'en';

export function setLanguage(l) {
  lang = dict[l] ? l : 'en';
  document.documentElement.lang = lang;
}
export function getLanguage() { return lang; }
export function detectLanguage() {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return dict[nav] ? nav : 'en';
}

/** Translate key with {placeholders}. */
export function t(key, params) {
  let s = (dict[lang] && dict[lang][key]) || dict.en[key] || key;
  if (params) for (const k of Object.keys(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
  return s;
}

export function fmtDateTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  // Device times are stored as "UTC" placeholders – show the wall‑clock digits as recorded.
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
export function fmtDate(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
export function fmtTimeOfDay(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export function fmtBytes(b) {
  if (!Number.isFinite(b)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}
