// Native device access (Capacitor iOS app): talks to an UNMODIFIED Race Navigator.
//   • lap/driver/vehicle/event/video/track data: the device's HTTP XML API  http://<ip>:8080/resources/<uri>
//     (fetch() is routed through Capacitor's native HTTP layer, so neither CORS nor mixed content apply)
//   • measurements: HTTP  sensormeasurements/<from>/<to>  – falls back to PostgreSQL (rtts) via the RnDevice plugin
//   • videos: FTP (rtts/rtts8888) via the RnDevice plugin, then read into a Blob through the WebView file scheme
//   • discovery: Bonjour _racenav._tcp via the RnDevice plugin
// The lap is assembled into the same .rn XML the device exports, so the normal RNZ import pipeline handles it.

import { record } from './diag.js';
import { zipStore } from './zip.js';
import { orderSamples } from './rnparser.js';

export const RN_HTTP_PORT = 8080;
const FTP_USER = 'rtts';
const FTP_PASSWORD = 'rtts8888';
const EPOCH = '19700101000000000';

export function isNative() {
  const C = window.Capacitor;
  try {
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return true;
    if (C && typeof C.getPlatform === 'function' && C.getPlatform() !== 'web') return true;
  } catch { /* fall through */ }
  // belt and braces: the shells' own origins (iOS: capacitor://localhost, Android: https://localhost with the bridge object)
  if (location.protocol === 'capacitor:') return true;
  if (location.hostname === 'localhost' && (window.androidBridge || (C && C.Plugins && C.Plugins.RnDevice))) return true;
  return false;
}
function plugin() {
  const C = window.Capacitor;
  if (!C) throw new Error('Capacitor not available');
  if (C.Plugins && C.Plugins.RnDevice) return C.Plugins.RnDevice;
  if (C.registerPlugin) { const p = C.registerPlugin('RnDevice'); if (C.Plugins) C.Plugins.RnDevice = p; return p; }
  throw new Error('RnDevice plugin not available');
}

/** "http://192.168.1.158:8080" | "192.168.1.158" → { host, base } */
export function deviceHost(input) {
  let s = String(input || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const host = s.replace(/:\d+$/, '');
  return { host, base: `http://${host}:${RN_HTTP_PORT}/resources/` };
}

async function getXml(base, uri, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + uri, { headers: { Accept: 'application/xml' }, signal: ctrl.signal, cache: 'no-store' });
    const text = res.ok ? await res.text() : '';
    record('xml', `${res.status} ${uri}`, res.ok ? `${text.length} chars` : '');
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${uri}`);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror')[0]) { record('xml', `invalid XML ${uri}`, text.slice(0, 300)); throw new Error('Invalid XML from ' + uri); }
    return doc;
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? `timeout after ${Math.round(timeoutMs / 1000)} s` : (e.message || e);
    if (!(e.message || '').startsWith('HTTP ') && !(e.message || '').startsWith('Invalid XML')) record('xml', `ERR ${uri}`, msg);
    throw e;
  }
  finally { clearTimeout(tm); }
}
const els = (doc, name) => Array.from(doc.getElementsByTagName(name));
function txt(el, name, def = '') {
  for (const c of el.children) if (c.localName === name) return c.textContent.trim();
  return def;
}
const bool = (v) => v === '1' || v === 'true' || v === 'True';
// device times: "yyyy-MM-dd HH:mm:ss.SSS" (GMT digits as recorded)
function ms(s) { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Number((m[7] || '0').padEnd(3, '0'))) : NaN; }
function fmtFull(msv) { const d = new Date(msv); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`; }
function fmtServer(msv) { return fmtFull(msv).replace(/[-: .]/g, ''); } // yyyyMMddHHmmssSSS
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function lapFileBase(dev, lapNumber, startMs, endMs) {
  const secs = Math.round((endMs - startMs) / 1000);
  return `${fmtServer(startMs).slice(0, 8)}_${fmtServer(startMs).slice(8)}_${dev}_LAP_${lapNumber}_${Math.floor(secs / 60)}min${String(secs % 60).padStart(2, '0')}sec`;
}

const cache = new Map(); // host → { info, laps: Map(dataFile → bundle) }

export async function nativeInfo(input) {
  const { host, base } = deviceHost(input);
  const doc = await getXml(base, 'deviceinfo', 8000);
  const root = doc.documentElement;
  const type = txt(root, 'devicetype', '');
  const info = {
    deviceName: txt(root, 'deviceidentification') || txt(root, 'hostname') || host,
    deviceType: type === '1' ? 'RN PRO' : type === '2' ? 'RN LITE' : 'RN ONE',
    driver: txt(root, 'drivername'), car: txt(root, 'vehiclename'),
    version: txt(root, 'rnversion'), systemVersion: txt(root, 'systemversion'), hostname: txt(root, 'hostname'),
    apiVersion: 'rn-http', native: true,
  };
  cache.set(host, { ...(cache.get(host) || {}), info });
  return info;
}

export async function nativeLaps(input) {
  const { host, base } = deviceHost(input);
  const info = (cache.get(host) && cache.get(host).info) || (await nativeInfo(input));
  const dev = info.deviceName;
  const [lapsDoc, driversDoc, vehiclesDoc, eventsDoc, videosDoc, l2vDoc] = await Promise.all([
    getXml(base, `laps/${EPOCH}/from`, 60000), getXml(base, 'drivers'), getXml(base, 'vehicles'), getXml(base, 'events'),
    getXml(base, `videoinfos/${EPOCH}/from`, 60000).catch(() => null), getXml(base, `lapstovideos/${EPOCH}/from`, 60000).catch(() => null),
  ]);
  const drivers = new Map(els(driversDoc, 'driver').map((e) => [txt(e, 'id'), e]));
  const vehicles = new Map(els(vehiclesDoc, 'vehicle').map((e) => [txt(e, 'id'), e]));
  const events = new Map(els(eventsDoc, 'event').map((e) => [txt(e, 'id'), e]));
  const videos = new Map(videosDoc ? els(videosDoc, 'videoInfo').map((e) => [txt(e, 'id'), e]) : []);
  const l2v = new Map(); // lapId → [lapToVideo]
  if (l2vDoc) for (const e of els(l2vDoc, 'lapToVideo')) { const id = txt(e, 'lapId'); if (!l2v.has(id)) l2v.set(id, []); l2v.get(id).push(e); }
  const byLapVideo = new Map(); // fallback: videoInfo.lapId → videoInfo
  for (const v of videos.values()) { const lid = txt(v, 'lapId'); if (lid) { if (!byLapVideo.has(lid)) byLapVideo.set(lid, []); byLapVideo.get(lid).push(v); } }

  const laps = new Map();
  const out = [];
  for (const lapEl of els(lapsDoc, 'lap')) {
    const id = txt(lapEl, 'id');
    const startMs = ms(txt(lapEl, 'startTime')), endMs = ms(txt(lapEl, 'endTime'));
    if (!Number.isFinite(startMs)) continue;
    const drv = drivers.get(txt(lapEl, 'driverId'));
    const veh = vehicles.get(txt(lapEl, 'vehicleId'));
    const evt = events.get(txt(lapEl, 'eventId'));
    const lapNumber = Number(txt(lapEl, 'lapNumber')) || 0;
    // videos of this lap
    const vlist = [];
    for (const m of l2v.get(id) || []) {
      const vi = videos.get(txt(m, 'videoId'));
      const fileName = (vi ? txt(vi, 'fileName') : txt(m, 'fileName')) || '';
      if (!fileName) continue;
      vlist.push({
        id: txt(m, 'videoId'), fileName: fileName.split(/[\\/]/).pop(),
        startTime: vi ? txt(vi, 'startTime') : '', endTime: vi ? txt(vi, 'endTime') : '',
        status: (vi && txt(vi, 'status')) || txt(m, 'status') || '3', quality: (vi && txt(vi, 'videoQuality')) || txt(m, 'videoQuality') || '0',
        sizeKB: Number((vi && txt(vi, 'videoFileSize')) || txt(m, 'videoFileSize') || 0), parentId: id,
      });
    }
    if (!vlist.length) for (const vi of byLapVideo.get(id) || []) {
      const fileName = txt(vi, 'fileName'); if (!fileName) continue;
      vlist.push({ id: txt(vi, 'id'), fileName: fileName.split(/[\\/]/).pop(), startTime: txt(vi, 'startTime'), endTime: txt(vi, 'endTime'), status: txt(vi, 'status') || '3', quality: txt(vi, 'videoQuality') || '0', sizeKB: Number(txt(vi, 'videoFileSize') || 0), parentId: id });
    }
    const dataFile = lapFileBase(dev, lapNumber, startMs, Number.isFinite(endMs) ? endMs : startMs) + '.rnz';
    const bundle = { id, lapEl, drv, veh, evt, videos: vlist, startMs, endMs, lapNumber, dev, dataFile };
    laps.set(dataFile, bundle);
    const complete = bool(txt(lapEl, 'isStartLineCrossed')) && bool(txt(lapEl, 'isEndLineCrossed'));
    out.push({
      id: `${dev}_${id}`, lapNumber,
      driver: drv ? [txt(drv, 'driverName'), txt(drv, 'driverSurname')].filter(Boolean).join(' ') : '',
      car: (veh && txt(veh, 'vehicleModel')) || txt(lapEl, 'vehicleModel'), carNumber: (veh && txt(veh, 'vehicleNumber')) || txt(lapEl, 'vehicleNumber'),
      track: '', event: evt ? txt(evt, 'name') : '', eventStartTime: evt ? txt(evt, 'startTime') : '',
      startTime: fmtFull(startMs), lapTimeMs: Number.isFinite(endMs) ? endMs - startMs : null, complete,
      dataFile, dataSize: 0,
      videoFile: vlist.length ? vlist[0].fileName : null, videoSize: vlist.length ? vlist[0].sizeKB * 1024 : 0,
    });
  }
  cache.set(host, { info, laps });
  return out;
}

/** The device returns rows in storage order, not necessarily by time; sort by `mt` and log how many moved. */
function chronological(rows, what) {
  const { els, unordered } = orderSamples(rows.map((r) => ({ row: r, getAttribute: (k) => r[k] })));
  if (unordered) record('info', `${what}: ${unordered} of ${rows.length} samples out of time order, sorted`);
  return els.map((e) => e.row);
}

/** Measurements via HTTP; PostgreSQL through the plugin as fallback. Returns array of attribute maps using RNZ names. */
async function measurements(host, base, bundle) {
  const from = fmtServer(bundle.startMs), to = fmtServer(Number.isFinite(bundle.endMs) ? bundle.endMs : bundle.startMs + 3600000);
  try {
    const doc = await getXml(base, `sensormeasurements/${from}/${to}`, 120000);
    const rows = els(doc, 'sm').map((e) => {
      const a = (k) => e.getAttribute(k);
      return { id: a('id'), mt: a('mt'), la: a('la'), lo: a('lo'), za: a('za'), ds: a('ds'), lt: a('lt'), lg: a('lg'), rp: a('rp') ?? '-1', gs: a('gs'), gd: a('gd') ?? '0', ph: a('ph') ?? '0', rl: a('rl') ?? '0', ya: a('ya') ?? a('yw') ?? '0', al: a('al') ?? '0', dr: a('dr') ?? '0', df: a('df') ?? '0', os: a('os') ?? '0', ot: a('ot') ?? '0', wt: a('wt') ?? '0', tp: a('tp') ?? '-1', ga: a('ga') ?? '100', igpsv: a('igpsv') ?? '1', igyrv: a('igyrv') ?? '1', iobdv: a('iobdv') ?? '0', ipc: a('ipc') ?? '0', ld: a('ld') };
    }).filter((r) => !r.ld || r.ld === bundle.id);
    if (rows.length) return chronological(rows, `sensormeasurements ${bundle.id}`);
  } catch (e) { console.warn('HTTP measurements failed, trying PostgreSQL', e); }
  const res = await plugin().pgQuery({ host, database: 'rtts', user: 'rtts', password: 'rtts8888', sql: `select * from sensorsmeasurements where lapid = ${Number(bundle.id)} order by measurementtime, id` });
  return chronological((res.rows || []).map((r) => ({
    id: r.id, mt: String(r.measurementtime || '').replace('T', ' ').slice(0, 23), la: r.longitudinalaccel, lo: r.lateralaccel, za: r.zaccel, ds: r.distanceinlap, lt: r.latitude, lg: r.longitude,
    rp: r.rpmvalue ?? '-1', gs: r.gpsspeed, gd: r.gpspositiondeviation ?? '0', ph: r.pitch ?? '0', rl: r.roll ?? '0', ya: r.yaw ?? '0', al: r.altitude ?? '0', dr: r.direction ?? '0', df: r.distanceoffset ?? '0',
    os: r.obdspeed ?? '0', ot: r.oiltemp ?? '0', wt: r.watertemp ?? '0', tp: '-1', ga: '100', igpsv: r.isgpsvalid === false || r.isgpsvalid === 'f' || r.isgpsvalid === '0' ? '0' : '1', igyrv: r.isgyroaccelvalid === false || r.isgyroaccelvalid === 'f' ? '0' : '1', iobdv: r.isobdvalid === true || r.isobdvalid === 't' || r.isobdvalid === '1' ? '1' : '0', ipc: '0',
  })), `postgres lap ${bundle.id}`);
}

/** Build the .rnz for a lap listed by nativeLaps(). */
export async function nativeBuildRnz(input, dataFile) {
  const { host, base } = deviceHost(input);
  let c = cache.get(host);
  if (!c || !c.laps || !c.laps.has(dataFile)) { await nativeLaps(input); c = cache.get(host); }
  const b = c && c.laps.get(dataFile);
  if (!b) throw new Error('Unknown lap ' + dataFile);
  const [sm, sectorsDoc, variantDoc] = await Promise.all([
    measurements(host, base, b),
    getXml(base, 'lapsectors', 60000).catch(() => null),
    b.evt && txt(b.evt, 'trackVariantId') ? getXml(base, `trackvariants/${txt(b.evt, 'trackVariantId')}`).catch(() => null) : Promise.resolve(null),
  ]);
  const variant = variantDoc ? (els(variantDoc, 'trackVariant')[0] || variantDoc.documentElement) : null;
  const trackId = variant ? txt(variant, 'trackId') : '';
  const trackDoc = trackId ? await getXml(base, `tracks/${trackId}`).catch(() => null) : null;
  const track = trackDoc ? (els(trackDoc, 'track')[0] || trackDoc.documentElement) : null;
  const sectors = sectorsDoc ? els(sectorsDoc, 'lapsector').filter((e) => txt(e, 'lapId') === b.id) : [];
  const now = fmtFull(Date.now());
  const L = b.lapEl, D = b.drv, V = b.veh, E = b.evt;
  const startCrossed = bool(txt(L, 'isStartLineCrossed')) ? 1 : 0, endCrossed = bool(txt(L, 'isEndLineCrossed')) ? 1 : 0;

  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<lapData xmlns="http://macrix.eu/racenavigator/LapDataSchema" exportDeviceName="RN Analyzer 2" exportDeviceVersion="2.1" exportDeviceTime="${now}" exportDataVersion="5" lastExportRnDeviceName="${esc(b.dev)}" sourceDeviceName="${esc(txt(L, 'deviceName') || b.dev)}">\n`;
  x += `  <lap>\n    <id>${esc(b.id)}</id>\n    <lapNumber>${b.lapNumber}</lapNumber>\n    <type>${esc(txt(L, 'type') || '0')}</type>\n    <sourceLapId>${esc(txt(L, 'sourceLapId') || b.id)}</sourceLapId>\n    <startTime>${fmtFull(b.startMs)}</startTime>\n    <endTime>${Number.isFinite(b.endMs) ? fmtFull(b.endMs) : ''}</endTime>\n    <vehicleNumber>${esc(txt(L, 'vehicleNumber') || (V ? txt(V, 'vehicleNumber') : ''))}</vehicleNumber>\n    <vehicleModel>${esc(txt(L, 'vehicleModel') || (V ? txt(V, 'vehicleModel') : ''))}</vehicleModel>\n    <isStartLineCrossed>${startCrossed}</isStartLineCrossed>\n    <isEndLineCrossed>${endCrossed}</isEndLineCrossed>\n    <streetModeTreshold1>${esc(txt(L, 'streetModeTreshold1') || '-1')}</streetModeTreshold1>\n    <streetModeTreshold2>${esc(txt(L, 'streetModeTreshold2') || '-1')}</streetModeTreshold2>\n    <streetModeCutStart>${esc(txt(L, 'streetModeCutStart'))}</streetModeCutStart>\n    <streetModeCutEnd>${esc(txt(L, 'streetModeCutEnd'))}</streetModeCutEnd>\n  </lap>\n`;
  x += `  <driver>\n    <id>${esc(txt(L, 'driverId'))}</id>\n    <driverName>${esc(D ? txt(D, 'driverName') : '')}</driverName>\n    <photo>${D ? txt(D, 'photo') : ''}</photo>\n    <driverSurname>${esc(D ? txt(D, 'driverSurname') : '')}</driverSurname>\n  </driver>\n`;
  x += `  <vehicle>\n    <id>${esc(txt(L, 'vehicleId'))}</id>\n    <vehicleNumber>${esc(V ? txt(V, 'vehicleNumber') : txt(L, 'vehicleNumber'))}</vehicleNumber>\n    <vehicleModel>${esc(V ? txt(V, 'vehicleModel') : txt(L, 'vehicleModel'))}</vehicleModel>\n  </vehicle>\n`;
  x += `  <event>\n    <id>${esc(txt(L, 'eventId'))}</id>\n    <name>${esc(E ? txt(E, 'name') : '')}</name>\n    <type>${esc(E ? (txt(E, 'type') || '1') : '1')}</type>\n    <startTime>${esc(E ? txt(E, 'startTime') : '')}</startTime>\n    <endTime>${esc(E ? txt(E, 'endTime') : '')}</endTime>\n    <isDeleted>0</isDeleted>\n  </event>\n`;
  if (track) x += `  <track>\n    <id>${esc(txt(track, 'id') || trackId)}</id>\n    <name>${esc(txt(track, 'name'))}</name>\n    <distance>${esc(txt(track, 'distance') || '0')}</distance>\n    <width>${esc(txt(track, 'width') || '0')}</width>\n    <definitionModificationDate>${esc(txt(track, 'definitionModificationTime'))}</definitionModificationDate>\n    <isDeleted>${bool(txt(track, 'isDeleted')) ? 1 : 0}</isDeleted>\n    <timeZoneContinent>${esc(txt(track, 'timeZoneContinent'))}</timeZoneContinent>\n    <timeZoneCity>${esc(txt(track, 'timeZoneCity'))}</timeZoneCity>\n    <trackType>${esc(txt(track, 'type') || '0')}</trackType>\n  </track>\n`;
  if (variant) {
    const raw = txt(variant, 'trackDataXml').replace(/^\s*<\?xml[^>]*>\s*/, '');
    x += `  <trackVariant>\n    <id>${esc(txt(variant, 'id') || txt(E, 'trackVariantId'))}</id>\n    <name>${esc(txt(variant, 'name'))}</name>\n    <trackDataXml>\n${raw}\n    </trackDataXml>\n    <distance>${esc(txt(variant, 'distance') || '0')}</distance>\n    <width>${esc(txt(variant, 'width') || '0')}</width>\n    <isHistorical>${bool(txt(variant, 'isHistorical')) ? 1 : 0}</isHistorical>\n    <isPreinstalled>${bool(txt(variant, 'isPreinstalled')) ? 1 : 0}</isPreinstalled>\n  </trackVariant>\n`;
  }
  x += '  <measurements>\n';
  let mn = 0;
  for (const r of sm) {
    mn++;
    x += `   <sm id="${esc(r.id)}" mt="${esc(r.mt)}" la="${esc(r.la)}" lo="${esc(r.lo)}" za="${esc(r.za)}" ds="${esc(r.ds)}" lt="${esc(r.lt)}" lg="${esc(r.lg)}" rp="${esc(r.rp)}" gs="${esc(r.gs)}" gd="${esc(r.gd)}" ph="${esc(r.ph)}" rl="${esc(r.rl)}" ya="${esc(r.ya)}" al="${esc(r.al)}" dr="${esc(r.dr)}" df="${esc(r.df)}" os="${esc(r.os)}" ot="${esc(r.ot)}" wt="${esc(r.wt)}" tp="${esc(r.tp)}" mn="${mn}" ga="${esc(r.ga)}" igpsv="${esc(r.igpsv)}" igyrv="${esc(r.igyrv)}" iobdv="${esc(r.iobdv)}" ipc="${esc(r.ipc)}"/>\n`;
  }
  record('info', `built ${dataFile}`, `${mn} samples, ${sectors.length} sectors, ${b.videos.length} videos`);
  x += '  </measurements>\n  <lapSectors>\n';
  for (const s of sectors) x += `    <lapsector>\n      <id>${esc(txt(s, 'id'))}</id>\n      <sectorNumber>${esc(txt(s, 'sectorNumber'))}</sectorNumber>\n      <startTime>${esc(txt(s, 'startTime'))}</startTime>\n      <endTime>${esc(txt(s, 'endTime'))}</endTime>\n    </lapsector>\n`;
  x += '  </lapSectors>\n  <videos>\n';
  for (const v of b.videos) x += `    <video locationType="0" uri="${esc(v.fileName)}">\n      <id>${esc(v.id)}</id>\n      <fileName>${esc(v.fileName)}</fileName>\n      <startTime>${esc(v.startTime)}</startTime>\n      <endTime>${esc(v.endTime)}</endTime>\n      <status>${esc(v.status)}</status>\n      <videoQuality>${esc(v.quality)}</videoQuality>\n      <videoFileSize>${v.sizeKB}</videoFileSize>\n      <parentId>${esc(v.parentId)}</parentId>\n    </video>\n`;
  x += '  </videos>\n</lapData>\n';
  const base64 = dataFile.replace(/\.rnz$/i, '');
  return zipStore([{ name: base64 + '.rn', data: new TextEncoder().encode(x) }]);
}

/** Download a video via FTP through the native plugin; returns a Blob. */
export async function nativeDownloadVideo(input, fileName, onProgress) {
  const { host } = deviceHost(input);
  const p = plugin();
  let handle = null;
  if (onProgress && p.addListener) {
    handle = await p.addListener('ftpProgress', (e) => { if (!e || (e.fileName && e.fileName !== fileName)) return; onProgress(Number(e.loaded) || 0, Number(e.total) || 0, Number(e.bps) || 0); });
  }
  try {
    record('ftp', `download ${fileName}`, host);
    const res = await p.ftpDownload({ host, port: 21, user: FTP_USER, password: FTP_PASSWORD, path: fileName, fileName }).catch((e) => { record('ftp', `ERR ${fileName}`, e.message || e); throw e; });
    const src = window.Capacitor.convertFileSrc(res.path);
    const blob = await (await fetch(src)).blob();
    p.deleteFile && p.deleteFile({ path: res.path }).catch(() => {});
    onProgress && onProgress(blob.size, blob.size, 0);
    return blob.type ? blob : new Blob([blob], { type: 'video/mp4' });
  } finally { if (handle && handle.remove) handle.remove(); }
}

/** Unified download entry used by device.js */
export async function nativeDownload(input, name, onProgress) {
  if (/\.rnz$/i.test(name)) { const blob = await nativeBuildRnz(input, name); onProgress && onProgress(blob.size, blob.size, 0); return blob; }
  return nativeDownloadVideo(input, name, onProgress);
}

/** Bonjour discovery → [{ name, host, port }] */
export async function nativeDiscover(timeoutMs = 3000) {
  const res = await plugin().discover({ timeout: timeoutMs, type: '_racenav._tcp.' });
  return (res && res.devices) || [];
}
