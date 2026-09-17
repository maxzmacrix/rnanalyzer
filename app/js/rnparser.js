// Parser for Race Navigator ".rn" lap files (XML, namespace http://macrix.eu/racenavigator/LapDataSchema)
// as contained in ".rnz" archives. Produces a compact, typed lap record used by the whole app.

import { unzip } from './zip.js';

/** Parse "2017-12-19 10:29:03.432" (device local time) into milliseconds (treated as UTC to avoid DST jumps). */
export function parseDeviceTime(s) {
  if (!s) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s.trim());
  if (!m) return NaN;
  const ms = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
}

function text(parent, tag, def = '') {
  if (!parent) return def;
  for (const el of parent.children) if (el.localName === tag) return el.textContent.trim();
  return def;
}
function num(parent, tag, def = NaN) {
  const v = text(parent, tag, null);
  if (v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function child(parent, tag) {
  if (!parent) return null;
  for (const el of parent.children) if (el.localName === tag) return el;
  return null;
}
function children(parent, tag) {
  const out = [];
  if (!parent) return out;
  for (const el of parent.children) if (el.localName === tag) out.push(el);
  return out;
}
function refPoints(container) {
  const out = [];
  if (!container) return out;
  const rps = container.getElementsByTagName('referencePoint');
  for (const rp of rps) {
    const lat = Number(rp.getAttribute('latitude'));
    const lng = Number(rp.getAttribute('longitude'));
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({ lat, lng, dir: Number(rp.getAttribute('direction')) || 0, desc: rp.getAttribute('description') || '' });
    }
  }
  return out;
}

/**
 * Parse an .rnz (zip) or .rn (xml) file.
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @returns {Promise<{lap:object, samples:object, raw:Uint8Array}>}
 */
export async function parseRnzBuffer(buffer, fileName) {
  const u8 = new Uint8Array(buffer);
  let xmlText;
  let raw;
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (isZip) {
    const files = await unzip(buffer);
    const rn = files.find((f) => /\.rn$/i.test(f.name)) || files.find((f) => /\.xml$/i.test(f.name)) || files[0];
    if (!rn) throw new Error('Archive contains no .rn file');
    xmlText = new TextDecoder('utf-8').decode(rn.data);
    raw = u8;
    const parsed = parseRnXml(xmlText, fileName);
    parsed.raw = raw;
    // Extended channels (*.cdrn – CSV: id;measurementtime;lapid;name;unit;value)
    const cd = files.find((f) => /\.cdrn$/i.test(f.name));
    if (cd) {
      try { attachCustomChannels(parsed, new TextDecoder('utf-8').decode(cd.data)); } catch (e) { console.warn('cdrn parse failed', e); }
    }
    return parsed;
  }
  xmlText = new TextDecoder('utf-8').decode(u8);
  raw = u8;
  const parsed = parseRnXml(xmlText, fileName);
  parsed.raw = raw;
  return parsed;
}

/**
 * Parse the XML text of an .rn file.
 */
export function parseRnXml(xmlText, fileName = '') {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('XML parse error: ' + perr.textContent.slice(0, 200));
  const root = doc.documentElement;
  if (root.localName !== 'lapData') throw new Error('Not a Race Navigator lap file (root <' + root.localName + '>)');

  const lapEl = child(root, 'lap');
  const driverEl = child(root, 'driver');
  const vehicleEl = child(root, 'vehicle');
  const eventEl = child(root, 'event');
  const trackEl = child(root, 'track');
  const variantEl = child(root, 'trackVariant');
  const measEl = child(root, 'measurements');
  const sectorsEl = child(root, 'lapSectors');
  const videosEl = child(root, 'videos');

  const startMs = parseDeviceTime(text(lapEl, 'startTime'));
  const endMs = parseDeviceTime(text(lapEl, 'endTime'));
  const sourceDevice = root.getAttribute('sourceDeviceName') || root.getAttribute('lastExportRnDeviceName') || 'RN';
  const lapId = text(lapEl, 'id') || text(lapEl, 'sourceLapId') || String(startMs);

  // ---- measurements -------------------------------------------------------
  const smEls = measEl ? children(measEl, 'sm') : [];
  const n = smEls.length;
  const t = new Float32Array(n); // seconds since lap start
  const d = new Float32Array(n); // metres since lap start
  const v = new Float32Array(n); // m/s (GPS)
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const gLat = new Float32Array(n); // g (lateral, positive = left – RN convention)
  const gLon = new Float32Array(n); // g (positive = accelerating)
  const gVert = new Float32Array(n); // g
  const alt = new Float32Array(n); // m
  const hdg = new Float32Array(n); // degrees
  const dev = new Float32Array(n); // GPS deviation, m
  const rpm = new Float32Array(n);
  const thr = new Float32Array(n); // throttle %
  const wt = new Float32Array(n); // water temp
  const ot = new Float32Array(n); // oil temp
  const os = new Float32Array(n); // OBD speed
  const gyrP = new Float32Array(n);
  const gyrR = new Float32Array(n);
  const gyrY = new Float32Array(n);
  const gpsOk = new Uint8Array(n);
  const obdOk = new Uint8Array(n);
  let anyRpm = false, anyThr = false, anyWt = false, anyOt = false, anyOs = false, anyObd = false;
  let lastT = -Infinity, lastD = -Infinity;
  const startRef = Number.isFinite(startMs) ? startMs : (n ? parseDeviceTime(smEls[0].getAttribute('mt')) : 0);
  for (let i = 0; i < n; i++) {
    const s = smEls[i];
    const g = (k, def = 0) => { const a = s.getAttribute(k); if (a === null || a === '') return def; const x = Number(a); return Number.isFinite(x) ? x : def; };
    let ti = (parseDeviceTime(s.getAttribute('mt')) - startRef) / 1000;
    if (!Number.isFinite(ti)) ti = lastT > -Infinity ? lastT : 0;
    if (ti < lastT) ti = lastT; // enforce monotonic time
    lastT = ti;
    let di = g('ds') / 1000;
    if (di < lastD) di = lastD; // enforce monotonic distance
    lastD = di;
    t[i] = ti; d[i] = di;
    v[i] = g('gs') / 1000;
    lat[i] = g('lt'); lng[i] = g('lg');
    gLon[i] = g('la') / 1000; gLat[i] = g('lo') / 1000; gVert[i] = g('za') / 1000; // la = longitudinal (x), lo = lateral (y)
    alt[i] = g('al'); hdg[i] = g('dr'); dev[i] = g('df') / 1000;
    const r = g('rp', -1); rpm[i] = r; if (r > 0) anyRpm = true;
    const tp = g('tp', -1); thr[i] = tp; if (tp >= 0) anyThr = true;
    const iob = g('iobdv', 0); obdOk[i] = iob ? 1 : 0; if (iob) anyObd = true;
    wt[i] = g('wt'); ot[i] = g('ot'); os[i] = g('os');
    if (iob && wt[i] !== 0) anyWt = true;
    if (iob && ot[i] !== 0) anyOt = true;
    if (iob && os[i] !== 0) anyOs = true;
    gyrP[i] = g('ph') / 1000; gyrR[i] = g('rl') / 1000; gyrY[i] = g('ya') / 1000;
    gpsOk[i] = g('igpsv', 1) ? 1 : 0;
  }

  // ---- sectors (device-computed) ------------------------------------------
  const sectors = children(sectorsEl, 'lapsector').map((se) => ({
    n: num(se, 'sectorNumber', 0),
    startS: (parseDeviceTime(text(se, 'startTime')) - startMs) / 1000,
    endS: (parseDeviceTime(text(se, 'endTime')) - startMs) / 1000,
  })).filter((s) => Number.isFinite(s.startS) && Number.isFinite(s.endS)).sort((a, b) => a.n - b.n);

  // ---- video ---------------------------------------------------------------
  const videos = [];
  for (const vEl of children(videosEl, 'video')) {
    const vs = parseDeviceTime(text(vEl, 'startTime'));
    const ve = parseDeviceTime(text(vEl, 'endTime'));
    const fn = text(vEl, 'fileName') || vEl.getAttribute('uri') || '';
    if (!fn) continue;
    videos.push({
      fileName: fn.split(/[\/]/).pop(),
      uri: vEl.getAttribute('uri') || fn,
      locationType: Number(vEl.getAttribute('locationType') || 0),
      offsetS: Number.isFinite(vs) && Number.isFinite(startMs) ? (vs - startMs) / 1000 : 0, // video t=0 is at lap time offsetS
      endS: Number.isFinite(ve) && Number.isFinite(startMs) ? (ve - startMs) / 1000 : NaN,
      sizeKB: num(vEl, 'videoFileSize', NaN),
      quality: num(vEl, 'videoQuality', NaN),
    });
  }
  videos.sort((a, b) => a.locationType - b.locationType);
  const video = videos[0] || null;

  // ---- track definition ----------------------------------------------------
  let trackDef = null;
  const defEl = variantEl ? variantEl.getElementsByTagName('definition')[0] : null;
  if (defEl) {
    trackDef = {
      startLine: refPoints(child(defEl, 'startLine')),
      endLine: refPoints(child(defEl, 'endLine')),
      sectors: children(child(defEl, 'sectors'), 'sector').map((s) => ({ name: s.getAttribute('description') || '', points: refPoints(s) })),
      curves: children(child(defEl, 'curves'), 'curve').map((c) => ({ name: c.getAttribute('description') || '', points: refPoints(c) })),
      picture: null,
    };
    const pic = child(defEl, 'picture');
    if (pic) {
      const sw = child(pic, 'southWestReferencePoint');
      const ne = child(pic, 'northEastReferencePoint');
      if (sw && ne) {
        trackDef.picture = {
          sw: { lat: Number(sw.getAttribute('latitude')), lng: Number(sw.getAttribute('longitude')) },
          ne: { lat: Number(ne.getAttribute('latitude')), lng: Number(ne.getAttribute('longitude')) },
        };
      }
    }
  }

  const complete = text(lapEl, 'isStartLineCrossed') === '1' && text(lapEl, 'isEndLineCrossed') === '1';
  const lapTimeMs = Number.isFinite(endMs) && Number.isFinite(startMs) ? endMs - startMs : (n ? Math.round(t[n - 1] * 1000) : 0);

  const photo = text(driverEl, 'photo') || '';

  const lap = {
    id: `${sourceDevice}_${lapId}_${Number.isFinite(startMs) ? startMs : 0}`,
    lapNumber: num(lapEl, 'lapNumber', 0),
    type: num(lapEl, 'type', 0),
    startMs,
    endMs,
    lapTimeMs,
    complete,
    driver: {
      id: text(driverEl, 'id'),
      name: text(driverEl, 'driverName'),
      surname: text(driverEl, 'driverSurname'),
      photo: photo && photo.length > 100 ? 'data:image/jpeg;base64,' + photo : null,
    },
    vehicle: {
      number: text(vehicleEl, 'vehicleNumber') || text(lapEl, 'vehicleNumber'),
      model: text(vehicleEl, 'vehicleModel') || text(lapEl, 'vehicleModel'),
    },
    event: {
      id: text(eventEl, 'id'),
      name: text(eventEl, 'name'),
      startMs: parseDeviceTime(text(eventEl, 'startTime')),
      endMs: parseDeviceTime(text(eventEl, 'endTime')),
    },
    track: {
      id: text(trackEl, 'id'),
      name: text(trackEl, 'name'),
      distance: num(trackEl, 'distance', NaN),
      width: num(trackEl, 'width', NaN),
      timeZone: [text(trackEl, 'timeZoneContinent'), text(trackEl, 'timeZoneCity')].filter(Boolean).join('/'),
      variantId: text(variantEl, 'id'),
      variantName: text(variantEl, 'name'),
    },
    trackDef,
    sectors,
    video,
    videos,
    channels: { rpm: anyRpm, throttle: anyThr, waterTemp: anyWt, oilTemp: anyOt, obdSpeed: anyOs, obd: anyObd, custom: [] },
    source: {
      fileName,
      device: sourceDevice,
      exportDevice: root.getAttribute('exportDeviceName') || '',
      exportVersion: root.getAttribute('exportDeviceVersion') || '',
      dataVersion: root.getAttribute('exportDataVersion') || '',
      exportTime: root.getAttribute('exportDeviceTime') || '',
    },
    note: '',
    importedAt: Date.now(),
    sampleCount: n,
  };

  const samples = { n, t, d, v, lat, lng, gLat, gLon, gVert, alt, hdg, dev, rpm, thr, wt, ot, os, gyrP, gyrR, gyrY, gpsOk, obdOk };
  lap.stats = computeStats(samples, lap);
  return { lap, samples };
}

/** Summary statistics used by the Laps Overview table and the lap list. */
export function computeStats(s, lap) {
  const n = s.n;
  let vmax = -Infinity, vmin = Infinity, vsum = 0, vcnt = 0;
  let accMax = 0, brkMax = 0, leftMax = 0, rightMax = 0, vertMax = 0, combMax = 0, altMin = Infinity, altMax = -Infinity, rpmMax = 0;
  for (let i = 0; i < n; i++) {
    const vi = s.v[i];
    if (vi > vmax) vmax = vi;
    if (vi < vmin) vmin = vi;
    vsum += vi; vcnt++;
    const lo = s.gLon[i], la = s.gLat[i], za = s.gVert[i];
    if (lo > accMax) accMax = lo;
    if (-lo > brkMax) brkMax = -lo;
    if (la > leftMax) leftMax = la; // positive lateral = left (RN convention)
    if (-la > rightMax) rightMax = -la;
    const c = Math.hypot(lo, la);
    if (c > combMax) combMax = c;
    if (Math.abs(za) > vertMax) vertMax = Math.abs(za);
    if (s.alt[i] < altMin) altMin = s.alt[i];
    if (s.alt[i] > altMax) altMax = s.alt[i];
    if (s.rpm[i] > rpmMax) rpmMax = s.rpm[i];
  }
  return {
    distance: n ? s.d[n - 1] : 0,
    vmax: n ? vmax : 0,
    vmin: n ? vmin : 0,
    vavg: vcnt ? vsum / vcnt : 0,
    accMax, brkMax, leftMax, rightMax, vertMax, combMax,
    altMin: n ? altMin : 0, altMax: n ? altMax : 0,
    rpmMax,
  };
}

/** Format milliseconds as m:ss.mmm (or h:mm:ss.mmm). */
export function fmtLapTime(ms, withMillis = true) {
  if (!Number.isFinite(ms)) return '--:--.---';
  const neg = ms < 0; ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const mil = Math.floor(ms % 1000);
  const core = `${h ? h + ':' : ''}${h ? String(m).padStart(2, '0') : String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` + (withMillis ? `.${String(mil).padStart(3, '0')}` : '');
  return (neg ? '-' : '') + core;
}

/**
 * Parse a .cdrn CSV (id;measurementtime;lapid;name;unit;value) and attach the channels to the parsed lap.
 * Each channel is resampled onto the main sample time base (linear interpolation, hold outside range).
 */
export function attachCustomChannels(parsed, csvText) {
  const { lap, samples } = parsed;
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return;
  const header = lines[0].toLowerCase().split(';').map((h) => h.trim());
  const iTime = header.indexOf('measurementtime');
  const iName = header.indexOf('name');
  const iUnit = header.indexOf('unit');
  const iVal = header.indexOf('value');
  if (iTime < 0 || iName < 0 || iVal < 0) return;
  const byName = new Map();
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const cols = line.split(';');
    if (cols.length <= Math.max(iTime, iName, iVal)) continue;
    const tms = parseDeviceTime(cols[iTime]);
    const val = Number(String(cols[iVal]).replace(',', '.'));
    if (!Number.isFinite(tms) || !Number.isFinite(val)) continue;
    const name = cols[iName].trim();
    let ch = byName.get(name);
    if (!ch) { ch = { name, unit: iUnit >= 0 ? (cols[iUnit] || '').trim() : '', t: [], v: [] }; byName.set(name, ch); }
    ch.t.push((tms - lap.startMs) / 1000); ch.v.push(val);
  }
  samples.custom = {};
  lap.channels.custom = [];
  for (const ch of byName.values()) {
    if (ch.t.length < 2) continue;
    const idx = ch.t.map((_, i) => i).sort((a, b) => ch.t[a] - ch.t[b]);
    const ts = idx.map((i) => ch.t[i]); const vs = idx.map((i) => ch.v[i]);
    const out = new Float32Array(samples.n);
    let j = 0;
    for (let i = 0; i < samples.n; i++) {
      const tt = samples.t[i];
      while (j < ts.length - 2 && ts[j + 1] <= tt) j++;
      if (tt <= ts[0]) out[i] = vs[0];
      else if (tt >= ts[ts.length - 1]) out[i] = vs[vs.length - 1];
      else { const f = (tt - ts[j]) / (ts[j + 1] - ts[j] || 1); out[i] = vs[j] + (vs[j + 1] - vs[j]) * f; }
    }
    samples.custom[ch.name] = out;
    lap.channels.custom.push({ name: ch.name, unit: ch.unit, count: ts.length });
  }
}
