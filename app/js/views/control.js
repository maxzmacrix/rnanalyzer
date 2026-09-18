// Device control view (former RN Connect): live status, recording, driver/car/track/event, video settings,
// camera previews and maintenance actions – all through the Race Navigator HTTP API (native app).

import { state, on, updateSettings } from '../state.js';
import { t, fmtBytes } from '../i18n.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast, sheet, confirmDialog, promptDialog, segmented, switchEl, initials } from '../ui.js';
import { isNative, nativeInfo } from '../deviceNative.js';
import { shareFiles, canShareFiles } from '../share.js';
import { APP_VERSION } from '../main.js';
import { DeviceControl, REQ, PARAM, RECORDING_MODE, VIDEO_QUALITY, EVENT_TYPES, DEVICE_STATUS_FLAGS, protocolLogText } from '../deviceControl.js';

let root, ctrl = null, unsubStatus = null, unsub = [], info = null, busy = false;
let drivers = [], vehicles = [], variantNames = new Map();
const els = {};

export function mount(main) {
  if (!isNative()) {
    root = h('div.view.scroll', h('div.card', { style: { borderColor: 'var(--accent)' } },
      h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, t('control_title')),
      h('div.small', { style: { lineHeight: '1.5', color: 'var(--text-dim)' } }, t('control_native_only'))));
    main.appendChild(root);
    return;
  }
  root = h('div.view.scroll.control');
  main.appendChild(root);
  unsub.push(on('settings', (p) => { if (p && 'lastDevice' in p) connect(); }));
  connect();
}
export function unmount() {
  unsub.forEach((u) => u()); unsub = [];
  if (ctrl) { ctrl.stopPolling(); if (unsubStatus) unsubStatus(); ctrl = null; }
  stopCamera();
}

async function connect() {
  clear(root);
  const dev = state.settings.lastDevice;
  if (!dev) {
    root.appendChild(h('div.card', h('div', { style: { fontWeight: 700 } }, t('control_no_device')), h('div.small.muted', { style: { marginTop: '6px' } }, t('control_no_device_hint'))));
    return;
  }
  if (ctrl) { ctrl.stopPolling(); if (unsubStatus) unsubStatus(); }
  ctrl = new DeviceControl(dev);
  root.appendChild(h('div.empty', t('connect') + '…'));
  try { info = await nativeInfo(dev); } catch (e) { clear(root); root.appendChild(h('div.card', { style: { borderColor: 'var(--red)' } }, t('connection_failed', { e: e.message || e }))); return; }
  buildLayout();
  unsubStatus = ctrl.onStatus(renderStatus);
  ctrl.startPolling(4000);
  loadLists();
}

// ------------------------------------------------------------------ layout
function buildLayout() {
  clear(root);
  const head = h('div.card.ctl-head',
    h('div.row', h('div.logo-rn', h('img', { src: 'icons/logo.svg', alt: 'RN' })), h('div.grow', h('div', { style: { fontWeight: 700, fontSize: '16px' } }, info.deviceName), h('div.small.muted', `${info.deviceType} · ${t('version')} ${info.version}`)), (els.online = h('span.badge', '…'))));
  els.recBtn = h('button.rec-btn', { on: { click: toggleRecording } }, h('span.rec-dot'), h('span.rec-label', t('rec_off')));
  els.recSub = h('div.small.muted', '');
  els.mode = segmented([{ value: RECORDING_MODE.Manual, label: t('mode_manual') }, { value: RECORDING_MODE.Auto20, label: t('mode_auto20') }, { value: RECORDING_MODE.Auto40, label: t('mode_auto40') }], RECORDING_MODE.Manual, (v) => run(() => ctrl.setRecordingMode(v), t('changing')));
  const recCard = h('div.card.ctl-rec', h('div.row', els.recBtn, h('div.grow', h('div', { style: { fontWeight: 700 } }, t('recording')), els.recSub)), h('div.row', { style: { marginTop: '10px' } }, h('span.small.muted', t('recording_mode')), els.mode));
  els.chips = h('div.chips');
  els.flags = h('div');
  const statusCard = h('div.card', h('div.small.muted', { style: { marginBottom: '6px' } }, t('device_status')), els.chips, els.flags,
    h('div.row', { style: { marginTop: '8px' } }, (els.time = h('span.small.muted.grow', '')), (els.syncBtn = h('button.btn.ghost', { on: { click: () => run(() => ctrl.setTimeFromPhone(), t('changing'), t('time_synced')) } }, t('sync_time')))));
  const row = (icon, label, valueEl, onClick) => h('div.ctl-row', { on: { click: onClick } }, h('span.ctl-icon', { html: icons[icon] || '' }), h('div.grow', h('div.small.muted', label), valueEl), h('span', { html: icons.fwd, style: { display: 'inline-flex', color: 'var(--text-muted)' } }));
  els.driver = h('div', '–'); els.vehicle = h('div', '–'); els.track = h('div', '–'); els.event = h('div', '–'); els.quality = h('div', '–'); els.layout = h('div', '–');
  const setupCard = h('div.card', { style: { padding: 0, overflow: 'hidden' } },
    row('laps', t('driver'), els.driver, () => pickDriver()),
    row('video', t('vehicle'), els.vehicle, () => pickVehicle()),
    row('fit', t('track'), els.track, () => pickTrack()),
    row('options', t('event_type'), els.event, () => pickEventType()),
    row('sound', t('video_quality'), els.quality, () => pickQuality()),
    row('more', t('video_layout'), els.layout, () => pickLayout()),
  );
  const actionsCard = h('div.card', { style: { padding: 0, overflow: 'hidden' } },
    row('video', t('camera_previews'), h('div', t('camera_previews_sub')), () => openCamera()),
    row('plus', t('start_new_event'), h('div', t('start_new_event_sub')), () => run(() => ctrl.startNewEvent(), t('changing'), t('done'), true)),
    row('trash', t('cleanup_laps'), h('div', t('cleanup_laps_sub')), () => cleanup()),
    row('edit', t('wifi_password'), h('div', t('wifi_password_sub')), () => wifiPassword()),
    row('close', t('shutdown'), h('div', t('shutdown_sub')), () => shutdown()),
    row('edit', t('protocol_log'), h('div', t('protocol_log_sub')), () => showProtocolLog()),
  );
  root.append(head, recCard, statusCard, setupCard, actionsCard);
}

function fmtDur(s) { if (!Number.isFinite(s) || s <= 0) return '–'; const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return hh ? `${hh} h ${mm} min` : `${mm} min`; }

function renderStatus(st, err) {
  if (!els.online) return;
  if (err || !st) { els.online.textContent = t('offline'); els.online.style.background = 'rgba(255,59,48,0.3)'; return; }
  els.online.textContent = t('online'); els.online.style.background = 'rgba(63,209,98,0.25)';
  const rec = st.cameraRecording || st.dataRecording;
  els.recBtn.classList.toggle('on', rec);
  els.recBtn.querySelector('.rec-label').textContent = rec ? t('rec_on') : t('rec_off');
  els.recSub.textContent = st.videoProcessing ? t('video_processing') : (rec ? t('recording_running') : t('recording_standby'));
  // mode
  els.mode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', [RECORDING_MODE.Manual, RECORDING_MODE.Auto20, RECORDING_MODE.Auto40][i] === st.recordingMode));
  // chips
  clear(els.chips);
  const chip = (label, val, warn) => h('span.chip.stat', { class: warn ? 'warn' : '' }, h('b', val), ' ', label);
  els.chips.append(
    chip('GPS', st.gpsSignal, st.gpsSignal < 10),
    chip(t('battery'), `${st.batteryLevel}%`, st.batteryLevel > 0 && st.batteryLevel < 15),
    chip(t('free_space'), st.freeSpaceMB > 0 ? fmtBytes(st.freeSpaceMB * 1024 * 1024) : '–', st.freeSpaceMB > 0 && st.freeSpaceMB < 2048),
    chip('Full HD', fmtDur(st.fullHdTimeLeftS), st.fullHdTimeLeftS > 0 && st.fullHdTimeLeftS < 3600),
    chip('HD', fmtDur(st.hdTimeLeftS), false),
  );
  clear(els.flags);
  for (const f of DEVICE_STATUS_FLAGS) if (st.deviceStatus & f.bit) els.flags.appendChild(h('div.small', { style: { color: f.level === 'error' ? 'var(--red)' : 'var(--yellow)', marginTop: '4px' } }, '⚠ ' + t(f.key)));
  // time
  const devTime = parseDeviceTime(st.currentTime);
  const drift = Number.isFinite(devTime) ? Math.round((devTime - Date.now()) / 1000) : NaN;
  els.time.textContent = `${t('device_time')}: ${st.currentTime || '–'}` + (Number.isFinite(drift) && Math.abs(drift) > 60 ? ` · ${t('time_differs', { s: Math.abs(drift) })}` : '');
  els.syncBtn.classList.toggle('hidden', !(Number.isFinite(drift) && Math.abs(drift) > 60));
  // current selections
  const d = drivers.find((x) => Number(x.id) === st.driverId); els.driver.textContent = d ? [d.driverName, d.driverSurname].filter(Boolean).join(' ') : `#${st.driverId}`;
  const v = vehicles.find((x) => Number(x.id) === st.vehicleId); els.vehicle.textContent = v ? `${v.vehicleNumber ? '#' + v.vehicleNumber + ' ' : ''}${v.vehicleModel}` : `#${st.vehicleId}`;
  els.track.textContent = variantNames.get(st.trackVariantId) || (st.trackVariantId ? st.trackVariantId.slice(0, 8) + '…' : '–');
  els.event.textContent = EVENT_TYPES[st.eventType] || `#${st.eventType}`;
  els.quality.textContent = ({ 1: 'SD', 2: 'HD', 3: 'Full HD', 4: '3D HD' })[st.videoQuality] || `#${st.videoQuality}`;
  els.layout.textContent = st.layoutId || '–';
}
function parseDeviceTime(s) {
  // "yyyy-MM-dd HH:mm:ss.SSS ±HHMM" or similar – take the leading date/time and treat as local
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN;
}

async function loadLists() {
  try { drivers = await ctrl.drivers(); vehicles = await ctrl.vehicles(); } catch (e) { console.warn(e); }
  if (ctrl && ctrl.status) renderStatus(ctrl.status, null);
  loadVariantNames();
}
async function loadVariantNames() {
  const key = 'rn-variants-' + ctrl.host;
  try { const cached = JSON.parse(localStorage.getItem(key) || 'null'); if (cached) variantNames = new Map(Object.entries(cached)); } catch { /* ignore */ }
  try {
    const list = await ctrl.trackVariants();
    const missing = list.map((v) => v['@id']).filter((id) => id && !variantNames.has(id));
    for (let i = 0; i < missing.length; i += 6) {
      const batch = missing.slice(i, i + 6);
      await Promise.all(batch.map(async (id) => { try { const tv = await ctrl.trackVariant(id); if (tv) variantNames.set(id, tv.name || id); } catch { /* skip */ } }));
      try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(variantNames))); } catch { /* ignore */ }
    }
    if (ctrl && ctrl.status) renderStatus(ctrl.status, null);
  } catch (e) { console.warn('track variants', e); }
}

// ------------------------------------------------------------------ actions
async function run(fn, busyMsg, doneMsg, refreshLists) {
  if (busy) return;
  busy = true;
  toast(busyMsg || t('changing'), 30000);
  try {
    await fn();
    toast(doneMsg || t('done'), 1500);
    await ctrl.refresh();
    if (refreshLists) loadLists();
  } catch (e) { toast(t('action_failed', { e: e.message || e }), 5000); }
  busy = false;
}
function toggleRecording() {
  const st = ctrl && ctrl.status;
  if (!st) return;
  const rec = st.cameraRecording || st.dataRecording;
  run(() => ctrl.setRecording(!rec), rec ? t('stopping') : t('starting'));
}

const SUPPORT_MAIL = 'info@rn-vision.com';
/** Header for support: app version, platform, device identity and firmware as far as known. */
function supportHeader() {
  const st = ctrl && ctrl.status;
  return [`RN Analyzer ${APP_VERSION} · ${isNative() ? 'app' : 'web'} · ${navigator.userAgent}`,
    `Device: ${(info && info.deviceName) || '-'} · ${(info && info.deviceType) || '-'} · firmware ${(info && info.version) || '-'} · ${ctrl ? ctrl.host : '-'}`,
    st ? `Status: recording ${st.cameraRecording || st.dataRecording ? 'on' : 'off'} · mode ${st.recordingMode} · driver ${st.driverId} · vehicle ${st.vehicleId}` : 'Status: -',
    `Time: ${new Date().toISOString()}`, ''].join('\n');
}
async function sendToSupport(text) {
  const body = supportHeader() + text;
  const subject = `RN Analyzer ${APP_VERSION} – protocol log`;
  if (canShareFiles()) {
    try { const r = await shareFiles([new File([body], 'rn-analyzer-log.txt', { type: 'text/plain' })], subject); if (r === 'shared') return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  // mailto: keeps the body short – mail clients cap the URL length
  location.href = `mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
}
function showProtocolLog() {
  const text = protocolLogText() || t('protocol_log_empty');
  const pre = h('pre', { style: { margin: 0, padding: '8px 16px', fontSize: '11px', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '55vh', overflow: 'auto', userSelect: 'text' } }, text);
  const s = sheet(t('protocol_log'), [
    h('div.small.muted', { style: { padding: '6px 16px' } }, t('protocol_log_hint')),
    pre,
    h('div.row', { style: { padding: '8px 16px 16px', justifyContent: 'flex-end', gap: '8px' } },
      h('button.btn.ghost', { on: { click: async () => { try { await navigator.clipboard.writeText(supportHeader() + text); toast(t('copied'), 1500); } catch { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast(t('copy_manually'), 3000); } } } }, t('copy')),
      h('button.btn', { on: { click: () => sendToSupport(text) } }, t('send_support'))),
  ]);
}

function pickDriver() {
  const s = sheet(t('driver'), [
    h('div.small.muted', { style: { padding: '6px 16px' } }, t('pick_hint')),
    ...drivers.map((d) => h('div.item', { class: Number(d.id) === (ctrl.status && ctrl.status.driverId) ? 'selected' : '', on: { click: () => { s.close(); run(() => ctrl.selectDriver(Number(d.id)), t('changing')); } } },
      h('div.avatar-sm', d.photo && d.photo.length > 100 ? h('img', { src: 'data:image/jpeg;base64,' + d.photo }) : initials(d.driverName)),
      h('span.lbl', [d.driverName, d.driverSurname].filter(Boolean).join(' ')),
      h('button.tbtn', { html: icons.edit, on: { click: (e) => { e.stopPropagation(); s.close(); editDriver(d); } } }))),
    h('div', { style: { padding: '10px 16px' } }, h('button.btn.block', { on: { click: () => { s.close(); editDriver(null); } } }, t('add_driver'))),
  ]);
}
async function editDriver(d) {
  const r = await promptDialog(d ? t('edit_driver') : t('add_driver'), [{ key: 'name', label: t('driver'), value: d ? d.driverName : '' }]);
  if (!r || !r.name.trim()) return;
  if (d) run(() => ctrl.modifyDriver(PARAM.Edit, Number(d.id), r.name.trim()), t('changing'), t('done'), true);
  else run(() => ctrl.modifyDriver(PARAM.Create, Math.max(0, ...drivers.map((x) => Number(x.id) || 0)) + 1, r.name.trim()), t('changing'), t('done'), true);
}
function pickVehicle() {
  const s = sheet(t('vehicle'), [
    h('div.small.muted', { style: { padding: '6px 16px' } }, t('pick_hint')),
    ...vehicles.map((v) => h('div.item', { class: Number(v.id) === (ctrl.status && ctrl.status.vehicleId) ? 'selected' : '', on: { click: () => { s.close(); run(() => ctrl.selectVehicle(Number(v.id)), t('changing')); } } },
      h('span.lbl', `${v.vehicleNumber ? '#' + v.vehicleNumber + ' ' : ''}${v.vehicleModel}`),
      h('button.tbtn', { html: icons.edit, on: { click: (e) => { e.stopPropagation(); s.close(); editVehicle(v); } } }))),
    h('div', { style: { padding: '10px 16px' } }, h('button.btn.block', { on: { click: () => { s.close(); editVehicle(null); } } }, t('add_vehicle'))),
  ]);
}
async function editVehicle(v) {
  const r = await promptDialog(v ? t('edit_vehicle') : t('add_vehicle'), [{ key: 'model', label: t('vehicle'), value: v ? v.vehicleModel : '' }, { key: 'number', label: '#', value: v ? v.vehicleNumber : '', type: 'number' }]);
  if (!r || !r.model.trim()) return;
  const num = Number(r.number) || 0;
  if (v) run(() => ctrl.modifyVehicle(PARAM.Edit, Number(v.id), r.model.trim(), num), t('changing'), t('done'), true);
  else run(() => ctrl.modifyVehicle(PARAM.Create, Math.max(0, ...vehicles.map((x) => Number(x.id) || 0)) + 1, r.model.trim(), num), t('changing'), t('done'), true);
}
function pickTrack() {
  const list = h('div');
  const search = h('input.input', { type: 'search', placeholder: t('search'), on: { input: () => build(search.value) } });
  const build = (q) => {
    clear(list);
    const entries = [...variantNames.entries()].filter(([, n]) => !q || n.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a[1].localeCompare(b[1]));
    if (!entries.length) list.appendChild(h('div.empty', variantNames.size ? t('no_results') : t('loading_tracks')));
    for (const [id, name] of entries) list.appendChild(h('div.item', { class: id === (ctrl.status && ctrl.status.trackVariantId) ? 'selected' : '', on: { click: () => { s.close(); run(() => ctrl.setTrackVariant(id), t('changing'), t('done')); } } }, h('span.lbl', name)));
  };
  build('');
  const s = sheet(t('track'), [h('div', { style: { padding: '6px 16px' } }, search), list]);
}
function pickEventType() {
  const avail = ctrl.status ? ctrl.status.availableEventTypes : 0;
  const s = sheet(t('event_type'), Object.entries(EVENT_TYPES).map(([k, name]) => {
    const type = Number(k);
    const enabled = !avail || (avail & (1 << (type - 1))) || type === 1;
    return h('div.item', { class: `${ctrl.status && ctrl.status.eventType === type ? 'selected' : ''}`, style: enabled ? {} : { opacity: 0.4 }, on: { click: () => { if (!enabled) return; s.close(); run(() => ctrl.changeEventType(type), t('changing')); } } }, h('span.lbl', name));
  }));
}
function pickQuality() {
  const s = sheet(t('video_quality'), Object.entries(VIDEO_QUALITY).map(([name, q]) => h('div.item', { class: ctrl.status && ctrl.status.videoQuality === q ? 'selected' : '', on: { click: () => { s.close(); run(() => ctrl.setVideoQuality(q), t('changing')); } } }, h('span.lbl', name.replace('FullHD', 'Full HD').replace('HD3D', '3D HD')))));
}
async function pickLayout() {
  toast(t('loading') , 5000);
  let layouts = [];
  try { layouts = await ctrl.videoLayouts(); } catch (e) { toast(t('action_failed', { e: e.message || e })); return; }
  let fullHd = ctrl.status && ctrl.status.videoQuality === VIDEO_QUALITY.FullHD;
  const s = sheet(t('video_layout'), [
    h('div.item', h('span.lbl', 'Full HD'), switchEl(fullHd, (v) => { fullHd = v; })),
    ...layouts.map((l) => h('div.item', { class: l.id === (ctrl.status && ctrl.status.layoutId) ? 'selected' : '', style: l.isavailable === 'false' ? { opacity: 0.4 } : {}, on: { click: () => { s.close(); run(() => ctrl.setVideoLayout(l.id, fullHd && l.isfullhdsupported !== 'false'), t('changing')); } } },
      h('span.lbl', l.name || l.id), h('span.small.muted', [l.ishdsupported !== 'false' ? 'HD' : '', l.isfullhdsupported !== 'false' ? 'Full HD' : ''].filter(Boolean).join(' · ')))),
  ]);
}
async function cleanup() {
  const s = sheet(t('cleanup_laps'), [
    h('div.small.muted', { style: { padding: '6px 16px' } }, t('cleanup_hint')),
    h('div.item', { on: { click: async () => { s.close(); if (await confirmDialog(t('cleanup_incomplete_confirm'), { danger: true, okLabel: t('delete') })) run(() => ctrl.cleanupLaps(false), t('changing')); } } }, h('span.lbl', t('cleanup_incomplete'))),
    h('div.item', { on: { click: async () => { s.close(); if (await confirmDialog(t('cleanup_top3_confirm'), { danger: true, okLabel: t('delete') })) run(() => ctrl.cleanupLaps(true), t('changing')); } } }, h('span.lbl', t('cleanup_top3'))),
  ]);
}
async function wifiPassword() {
  const r = await promptDialog(t('wifi_password'), [{ key: 'pw', label: t('wifi_password_label'), value: '' }]);
  if (!r) return;
  if (r.pw && r.pw.length < 8) { toast(t('wifi_password_short')); return; }
  run(() => ctrl.setWifiPassword(r.pw), t('changing'), t('wifi_password_done'));
}
async function shutdown() {
  if (!(await confirmDialog(t('shutdown_confirm'), { danger: true, okLabel: t('shutdown') }))) return;
  run(() => ctrl.shutdown(), t('changing'), t('shutdown_sent'));
}

// ------------------------------------------------------------------ camera preview (MJPEG over TCP via plugin)
let cam = null;
function plugin() { const C = window.Capacitor; return (C.Plugins && C.Plugins.RnDevice) || C.registerPlugin('RnDevice'); }
async function openCamera() {
  toast(t('loading'), 8000);
  let prev;
  try { prev = await ctrl.openCameraPreview(); } catch (e) { toast(t('action_failed', { e: e.message || e })); return; }
  if (!Number.isFinite(prev.firstPort) || prev.firstPort <= 0) { toast(t('action_failed', { e: 'no camera port' })); return; }
  cam = { index: 0, cameras: Math.max(1, prev.cameras), firstPort: prev.firstPort, img: h('img.cam-img', { alt: '' }), listener: null, frames: 0 };
  const label = h('span.small.muted', `1 / ${cam.cameras}`);
  const s = sheet(t('camera_previews'), [
    h('div.cam-stage', cam.img, h('div.cam-empty', t('loading'))),
    h('div.row', { style: { padding: '10px 16px', justifyContent: 'center', gap: '16px' } },
      h('button.rbtn', { html: icons.back, on: { click: () => switchCam(-1, label) } }),
      h('button.btn.ghost', { on: { click: () => run(() => ctrl.flipCamera(cam.index), t('changing')) } }, t('flip_camera')),
      h('button.rbtn', { html: icons.fwd, on: { click: () => switchCam(1, label) } }),
      label),
  ], { onClose: () => stopCamera(true) });
  startCamStream();
}
async function startCamStream() {
  if (!cam) return;
  const p = plugin();
  if (cam.listener) { cam.listener.remove(); cam.listener = null; }
  cam.listener = await p.addListener('cameraFrame', (e) => {
    if (!cam || !e || !e.jpeg) return;
    cam.img.src = 'data:image/jpeg;base64,' + e.jpeg;
    if (cam.frames++ === 0) { const empty = cam.img.parentElement && cam.img.parentElement.querySelector('.cam-empty'); if (empty) empty.remove(); }
  });
  try { await p.cameraStart({ host: ctrl.host, port: cam.firstPort + cam.index }); } catch (e) { toast(t('action_failed', { e: e.message || e })); }
}
function switchCam(dir, label) {
  if (!cam) return;
  cam.index = (cam.index + dir + cam.cameras) % cam.cameras;
  label.textContent = `${cam.index + 1} / ${cam.cameras}`;
  plugin().cameraStop().catch(() => {}).then(() => startCamStream());
}
function stopCamera(closeOnDevice) {
  if (!cam) return;
  try { plugin().cameraStop(); } catch { /* ignore */ }
  if (cam.listener) cam.listener.remove();
  if (closeOnDevice && ctrl) ctrl.closeCameraPreview();
  cam = null;
}
