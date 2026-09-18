// Race Navigator remote control (the former "RN Connect" functionality) over the device's HTTP API.
// Works inside the native app (Capacitor HTTP, no CORS). Protocol reconstructed from RNConnect/RNDataHandler:
//   GET  http://<ip>:8080/resources/currentstatus                       → JSON status (polled every 4 s)
//   GET  …/resources/rarequest/{type}/{uuid}/{dt1}/{dt2}/{int1}/{int2}/{int3}/{str1}/{str2}/{str3}/{status}
//        → JSON { status: <requestId> }   (empty ints = -1, empty strings = "a", dates yyyyMMddHHmmssSSS)
//   GET  …/resources/rarequest/{type}/{uuid}/{int}                      → short form (camera preview open/close)
//   GET  …/resources/rarequest/{uuid}/{type}                            → JSON { rarequest: [ {id,type,status,intParam1..3,stringParam1..3} ] }
//   request status: 0 received, 1 processing, 2 finished OK, 3 failed, 4 unknown

import { deviceHost } from './deviceNative.js';

export const REQ = {
  VideoSplitting: 1, CableDownload: 2, SetTrackVariant: 3, SetRecordingState: 4, SetTypeOfRecording: 5, ChangeEventType: 6, ManageEvents: 7,
  ModifyLap: 8, ModifyDriver: 9, ChangeDriver: 10, ModifyVehicle: 11, ChangeVehicle: 12, LapDataCleanup: 13, ChangeVideoBitrate: 14,
  Shutdown: 15, FactoryReset: 16, SetupTime: 17, RequestLogDownload: 18, RequestCameraPreview: 19, RequestCameraPreviewFlip: 20,
  RequestVideoLayoutChange: 21, RequestPitlaneDefinition: 22, SetPitlaneDefinition: 23, ExportToMemoryStick: 24, RequestCanProtocol: 25,
  SetCanProtocol: 26, ModifyWiFiPassword: 27,
};
export const PARAM = { Create: 1, Edit: 2, Delete: 3 };
export const RECORDING_MODE = { Manual: 1, Auto20: 2, Auto40: 3, StandingStart: 4, AutoRPM: 5 }; // MTRNRecordingStateType (Invalid = 0)
export const VIDEO_QUALITY = { SD: 1, HD: 2, FullHD: 3, HD3D: 4 };
export const EVENT_TYPES = { 1: 'Trackday', 2: 'Track race', 3: 'Endurance', 4: 'Rally', 5: 'Drift training', 6: 'Driver training', 7: 'Drag race', 8: 'Street race', 9: 'Taxi', 10: 'RCN', 11: 'Auto managed' };
export const DEVICE_STATUS_FLAGS = [
  { bit: 1, key: 'st_gps_unavailable', level: 'error' }, { bit: 2, key: 'st_usb_camera', level: 'error' }, { bit: 4, key: 'st_omx_camera', level: 'error' },
  { bit: 8, key: 'st_temp_warn', level: 'warn' }, { bit: 16, key: 'st_temp_high', level: 'warn' }, { bit: 32, key: 'st_temp_critical', level: 'error' }, { bit: 64, key: 'st_recorder_error', level: 'error' },
];

let analyzerId = null;
function uuid() {
  if (analyzerId) return analyzerId;
  try { analyzerId = localStorage.getItem('rn-analyzer-id'); } catch { /* ignore */ }
  if (!analyzerId) {
    analyzerId = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); })).toUpperCase();
    try { localStorage.setItem('rn-analyzer-id', analyzerId); } catch { /* ignore */ }
  }
  return analyzerId;
}
function serverDate(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}
/** The last requests and device answers, for diagnosing the protocol against a real device (Control → Protocol log). */
export const protocolLog = [];
const LOG_MAX = 60;
function logEntry(url, status, body) {
  const path = url.replace(/^https?:\/\/[^/]+\/resources\//, '');
  protocolLog.push({ t: new Date().toISOString().slice(11, 23), path, status, body: String(body ?? '').replace(/\s+/g, ' ').slice(0, 400) });
  if (protocolLog.length > LOG_MAX) protocolLog.splice(0, protocolLog.length - LOG_MAX);
}
export function protocolLogText() { return protocolLog.map((e) => `${e.t} ${e.status} ${e.path}\n    ${e.body}`).join('\n'); }
async function getJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text().catch(() => '');
    if (!/currentstatus$/.test(url)) logEntry(url, res.status, text);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { return xmlToObj(text); }
  } catch (e) { if (!/currentstatus$/.test(url) && !(e.message || '').startsWith('HTTP ')) logEntry(url, 'ERR', e.message || e); throw e; }
  finally { clearTimeout(tm); }
}
// Fallback when the device answers XML: flatten first-level children to an object (lists → arrays)
function xmlToObj(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror')[0]) throw new Error('Unexpected device response');
  const conv = (el) => {
    const kids = Array.from(el.children);
    if (!kids.length) return el.textContent.trim();
    const o = {};
    for (const k of kids) { const v = conv(k); if (k.localName in o) { if (!Array.isArray(o[k.localName])) o[k.localName] = [o[k.localName]]; o[k.localName].push(v); } else o[k.localName] = v; }
    for (const a of el.attributes) o['@' + a.name] = a.value;
    return o;
  };
  return conv(root);
}

export class DeviceControl {
  constructor(input) {
    const { host, base } = deviceHost(input);
    this.host = host; this.base = base;
    this.status = null;
    this.listeners = new Set();
    this.timer = 0;
  }
  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Poll /currentstatus every `ms` milliseconds. */
  startPolling(ms = 4000) {
    this.stopPolling();
    const tick = async () => {
      try { this.status = normalizeStatus(await getJson(this.base + 'currentstatus', 6000)); this.error = null; }
      catch (e) { this.error = e; }
      for (const fn of this.listeners) { try { fn(this.status, this.error); } catch (err) { console.error(err); } }
    };
    tick();
    this.timer = setInterval(tick, ms);
  }
  stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = 0; }
  async refresh() { this.status = normalizeStatus(await getJson(this.base + 'currentstatus', 6000)); for (const fn of this.listeners) fn(this.status, null); return this.status; }

  /** Send an action and wait until the device reports it finished. Resolves with the final request item. */
  async action(type, { int1 = null, int2 = null, int3 = null, str1 = null, str2 = null, str3 = null, dt1 = null, dt2 = null, timeoutMs = 60000 } = {}) {
    const enc = (s) => encodeURIComponent(String(s));
    const uri = `rarequest/${type}/${uuid()}/${serverDate(dt1 || new Date())}/${serverDate(dt2 || new Date())}/${int1 ?? -1}/${int2 ?? -1}/${int3 ?? -1}/${str1 ? enc(str1) : 'a'}/${str2 ? enc(str2) : 'a'}/${str3 ? enc(str3) : 'a'}/0`;
    const res = await getJson(this.base + uri, 15000);
    const requestId = Number(res && (res.status ?? res.rarequestStatus ?? res.id));
    if (!Number.isFinite(requestId) || requestId < 0) throw new Error('Device rejected the request');
    return this.waitFor(type, requestId, timeoutMs);
  }
  /** Short form used for camera preview open(1)/close(2). */
  async shortAction(type, value, wait = true) {
    const res = await getJson(`${this.base}rarequest/${type}/${uuid()}/${value}`, 15000);
    const requestId = Number(res && (res.status ?? res.id));
    if (!wait) return requestId;
    return this.waitFor(type, requestId, 30000);
  }
  async waitFor(type, requestId, timeoutMs) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 700));
      let list;
      try { list = await getJson(`${this.base}rarequest/${uuid()}/${type}`, 8000); } catch { continue; }
      let items = list && list.rarequest ? list.rarequest : list;
      if (!Array.isArray(items)) items = items ? [items] : [];
      const item = items.find((i) => Number(i.id) === requestId) || items[items.length - 1];
      if (!item) continue;
      last = item;
      const st = Number(item.status);
      if (st === 2) return item;
      if (st === 3) throw new Error(item.errorDescription || item.stringParam3 || 'Device reported an error');
      if (st === 4) throw new Error('Device: unknown request status');
    }
    throw new Error('Timeout waiting for the device' + (last ? ` (status ${last.status})` : ''));
  }

  /** Try several parameter layouts until the device accepts one (a "not found" answer is harmless). */
  async actionVariants(type, variants) {
    let lastErr = null;
    for (const v of variants) {
      try { return await this.action(type, v); }
      catch (e) { lastErr = e; if (!/not found|invalid|unknown|rejected/i.test(e.message || '')) throw e; }
    }
    throw lastErr;
  }
  // ---- convenience wrappers (parameter layout as in RN Connect) ----
  // Recording off: the device treats 0 as "invalid" (MTRNRecordingStateType.Invalid); its on/off style parameters
  // elsewhere use 1 = on/open and 2 = off/close (camera preview), so stop is sent as 2.
  setRecording(on) { return this.action(REQ.SetRecordingState, { int1: on ? 1 : 2 }); }
  setRecordingMode(mode) { return this.action(REQ.SetTypeOfRecording, { int1: mode }); }
  setTimeFromPhone() { const d = new Date(); return this.action(REQ.SetupTime, { int1: -d.getTimezoneOffset() * 60, str1: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', dt1: d, dt2: d }); }
  changeEventType(type) { return this.action(REQ.ChangeEventType, { int1: type }); }
  startNewEvent() { return this.action(REQ.ManageEvents, { int1: PARAM.Create }); }
  selectDriver(id) { return this.actionVariants(REQ.ChangeDriver, [{ int1: id, int2: id }, { int1: -1, int2: id }, { int1: id, str1: String(id) }, { str1: String(id) }]); }
  selectVehicle(id) { return this.actionVariants(REQ.ChangeVehicle, [{ int1: id, int2: id }, { int1: -1, int2: id }, { int1: id, str1: String(id) }, { str1: String(id) }]); }
  modifyDriver(param, id, name) { return this.action(REQ.ModifyDriver, { int1: param, int2: id, str1: name }); }
  modifyVehicle(param, id, model, number) { return this.action(REQ.ModifyVehicle, { int1: param, int2: id, int3: number, str1: model }); }
  setTrackVariant(variantId) { return this.action(REQ.SetTrackVariant, { str1: variantId }); }
  setVideoQuality(q) { return this.action(REQ.ChangeVideoBitrate, { int1: q }); }
  setVideoLayout(layoutId, fullHd) { return this.action(REQ.RequestVideoLayoutChange, { int1: fullHd ? 1 : 0, str1: layoutId }); }
  setWifiPassword(pw) { return this.action(REQ.ModifyWiFiPassword, { str1: pw || 'a' }); }
  shutdown() { return this.action(REQ.Shutdown, { int1: 1, timeoutMs: 15000 }).catch(() => null); }
  exportToMemoryStick(lapId) { return this.action(REQ.ExportToMemoryStick, { int1: lapId, timeoutMs: 600000 }); }
  cleanupLaps(keepTopThree) { return this.action(REQ.LapDataCleanup, { int1: keepTopThree ? 2 : 1, timeoutMs: 600000 }); }
  splitVideo(lapId) { return this.action(REQ.VideoSplitting, { int1: lapId, timeoutMs: 600000 }); }

  /** Opens the camera preview; resolves { cameras, firstPort } (MJPEG over raw TCP, one port per camera). */
  async openCameraPreview() {
    const item = await this.shortAction(REQ.RequestCameraPreview, 1);
    return { cameras: Number(item.intParam1) || 1, firstPort: Number(item.intParam2) };
  }
  closeCameraPreview() { return this.shortAction(REQ.RequestCameraPreview, 2, false).catch(() => null); }
  flipCamera(index) { return this.action(REQ.RequestCameraPreviewFlip, { int1: index }); }

  // ---- lists (XML API) ----
  async listXml(uri, tag) {
    const res = await fetch(this.base + uri, { headers: { Accept: 'application/xml' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    return Array.from(doc.getElementsByTagName(tag)).map((el) => { const o = {}; for (const c of el.children) o[c.localName] = c.textContent.trim(); for (const a of el.attributes) o['@' + a.name] = a.value; return o; });
  }
  drivers() { return this.listXml('drivers', 'driver'); }
  vehicles() { return this.listXml('vehicles', 'vehicle'); }
  trackVariants() { return this.listXml('trackvariants', 'trackvariantid'); }
  tracks() { return this.listXml('tracks', 'trackid'); }
  trackVariant(id) { return this.listXml(`trackvariants/${id}`, 'trackVariant').then((l) => l[0]); }
  track(id) { return this.listXml(`tracks/${id}`, 'track').then((l) => l[0]); }
  videoLayouts() { return this.listXml('availablevideolayouts', 'AvailableVideoLayout'); }
}

export function normalizeStatus(j) {
  if (!j) return null;
  const n = (k, d = 0) => { const v = Number(j[k]); return Number.isFinite(v) ? v : d; };
  const b = (k) => j[k] === true || j[k] === 'true' || j[k] === 1 || j[k] === '1';
  const ct = String(j.currenttime || '');
  return {
    raw: j,
    eventType: n('eventtype'), recordingMode: n('autostartmode'), rpmLimit: n('autostartrpmlimit'),
    cameraRecording: b('iscamerarecordingon'), dataRecording: b('isdatarecordingon'), videoProcessing: b('isvideoprocessing'),
    layoutId: j.currentvideolayout || '', videoQuality: n('videoquality'), availableQualities: n('availablevideoquality'), availableEventTypes: n('availableeventtypes'),
    currentTime: ct, batteryLevel: n('batterylevel'), gpsSignal: n('gpssignal'),
    trackVariantId: j.trackvariantid || '', driverId: n('driverid'), vehicleId: n('vehicleid'),
    freeSpaceMB: n('freespaceleft'), fullHdTimeLeftS: n('fhdtimeleft'), hdTimeLeftS: n('hdtimeleft'), sdTimeLeftS: n('sdtimeleft'),
    deviceStatus: n('devicestatus'), videoBitrate: n('videobitrate'),
  };
}
