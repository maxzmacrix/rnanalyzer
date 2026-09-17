#!/usr/bin/env node
// rn-bridge – lets the RN Analyzer web app import laps from an UNMODIFIED Race Navigator.
//
// The device exposes only PostgreSQL (db "rtts") and FTP (video files). Browsers cannot speak either,
// so this small program runs on a laptop / Raspberry Pi in the Race Navigator's WiFi and
//   1. serves the web app itself over HTTP (same origin → no CORS / mixed-content problems),
//   2. implements the app's device API:  GET /api/info, GET /api/laps, GET /files/<name>
//      – .rnz files are generated on the fly from the device database (same XML as the device export),
//      – .mp4 files are streamed from the device's FTP server.
//
// Usage:
//   npm install                       (once, inside tools/rn-bridge)
//   node rn-bridge.mjs --device 192.168.1.161 [--port 8080] [--app ../../app]
//   node rn-bridge.mjs --device 192.168.1.161 --discover     ← prints the device's DB schema + FTP listing
//
// Environment overrides: RN_PG_USER, RN_PG_PASSWORD, RN_PG_DB, RN_PG_PORT, RN_FTP_USER, RN_FTP_PASSWORD, RN_FTP_DIR
//
// The table/column names below mirror the schema the old iPad app replicated locally. If the device uses
// different names, run --discover and adapt the SCHEMA block – everything else stays the same.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------- CLI
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const DEVICE = opt('device', process.env.RN_DEVICE || '');
const PORT = Number(opt('port', process.env.PORT || 8080));
const APP_DIR = path.resolve(__dirname, String(opt('app', '../../app')));
const DISCOVER = !!opt('discover', false);
const PG = {
  host: DEVICE, port: Number(process.env.RN_PG_PORT || 5432),
  user: process.env.RN_PG_USER || 'rtts', password: process.env.RN_PG_PASSWORD || 'rtts8888', database: process.env.RN_PG_DB || 'rtts',
  connectionTimeoutMillis: 8000, statement_timeout: 60000,
};
const FTP = { host: DEVICE, user: process.env.RN_FTP_USER || 'anonymous', password: process.env.RN_FTP_PASSWORD || 'anonymous@', dir: process.env.RN_FTP_DIR || '/' };
if (!DEVICE) { console.error('Missing --device <ip>. Try --help.'); process.exit(2); }

// ----------------------------------------------------------------------------- schema mapping
// Adapt here after `--discover` if the device differs.
const SCHEMA = {
  lap:         { table: 'lap',         id: 'id', start: 'start', end: 'end', number: 'lapnumber', driver: 'driverid', vehicle: 'vehicleid', event: 'eventid', vehicleNumber: 'vehiclenumber', vehicleModel: 'vehiclemodel', startCrossed: 'isstartlinecrossed', endCrossed: 'isendlinecrossed', flags: 'flags' },
  driver:      { table: 'driver',      id: 'id', name: 'name', surname: 'surname', photo: 'thumb' },
  vehicle:     { table: 'vehicle',     id: 'id', model: 'model', number: 'vehiclenumber' },
  event:       { table: 'event',       id: 'id', name: 'name', start: 'start', end: 'end', variant: 'trackvariantid', deleted: 'isdeleted', type: 'type' },
  trackvariant:{ table: 'trackvariant', id: 'id', name: 'name', xml: 'trackdataxml', track: 'trackid', distance: 'distance', width: 'width', historical: 'ishistorical', preinstalled: 'ispreinstalled' },
  track:       { table: 'track',       id: 'id', name: 'name', distance: 'distance', width: 'width', modified: 'definitionmodificationdate', deleted: 'isdeleted', tzContinent: 'timezonecontinent', tzCity: 'timezonecity', type: 'tracktype' },
  lapdata:     { table: 'lapdata',     id: 'id', lap: 'lapid', time: 'measurementtime', xaccel: 'xaccel', yaccel: 'yaccel', zaccel: 'zaccel', distance: 'distanceinlap', lat: 'latitude', lng: 'longitude', rpm: 'rpmvalue', speed: 'speed', pitch: 'pitch', roll: 'roll', yaw: 'yaw', alt: 'alt', direction: 'direction', deviation: 'positiondeviation', obdSpeed: 'obd2speed', oilTemp: 'oiltemp', waterTemp: 'watertemp', valid: 'validmeasurements', gear: 'gearnumber' },
  lapsector:   { table: 'lapsector',   id: 'id', lap: 'lapid', number: 'sectornumber', start: 'start', end: 'end' },
  video:       { table: 'video',       id: 'id', name: 'videoname', start: 'start', end: 'end', status: 'status', quality: 'quality', size: 'filesize', parent: 'parentid' },
  lapVideo:    { table: 'lap_video',   lap: 'lapid', video: 'videoid' },
  deviceNameQuery: null, // optional SQL returning one row with column "name" (device name); null → derived from hostname/IP
};

// ----------------------------------------------------------------------------- deps (lazy, with a friendly error)
let pgMod, ftpMod;
async function deps() {
  try {
    pgMod = pgMod || (await import('pg'));
    ftpMod = ftpMod || (await import('basic-ftp'));
  } catch (e) {
    console.error('Dependencies missing. Run:  npm install   (inside tools/rn-bridge)\n', e.message);
    process.exit(2);
  }
}

// timestamps: keep the device's wall-clock digits (no timezone conversion)
function setupPgTypes(pg) {
  const raw = (s) => s;
  pg.types.setTypeParser(1114, raw); // timestamp without time zone
  pg.types.setTypeParser(1184, raw); // timestamptz (kept as text)
  pg.types.setTypeParser(20, (s) => Number(s)); // int8
  pg.types.setTypeParser(1700, (s) => Number(s)); // numeric
}

let pool;
async function db() {
  await deps();
  if (!pool) { setupPgTypes(pgMod.default || pgMod); const Pool = (pgMod.default || pgMod).Pool; pool = new Pool(PG); }
  return pool;
}
async function q(sql, params = []) { const p = await db(); const r = await p.query(sql, params); return r.rows; }
const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// ----------------------------------------------------------------------------- helpers
function fmtTime(v) {
  // → "YYYY-MM-DD HH:MM:SS.mmm"
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '');
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) { // epoch seconds
    const d = new Date(Number(s) * 1000); return d.toISOString().replace('T', ' ').replace('Z', '');
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/.exec(s);
  if (m) return `${m[1]} ${m[2]}.${(m[3] || '0').padEnd(3, '0').slice(0, 3)}`;
  return s;
}
function ms(v) { const s = fmtTime(v); const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : NaN; }
function lapTimeStr(msv) { if (!Number.isFinite(msv)) return ''; const h = Math.floor(msv / 3600000), m = Math.floor(msv / 60000) % 60, s = Math.floor(msv / 1000) % 60, mil = msv % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function n(v, def = 0) { const x = Number(v); return Number.isFinite(x) ? x : def; }
function bool01(v) { return v === true || v === 1 || v === '1' || v === 't' || v === 'true' ? 1 : 0; }
function compactStamp(t) { const s = fmtTime(t); return s.replace(/[-: ]/g, '').replace('.', ''); }
function lapFileBase(lap, deviceName) {
  const dur = ms(lap.end) - ms(lap.start);
  const secs = Math.round(dur / 1000);
  return `${compactStamp(lap.start)}_${deviceName}_LAP_${lap.lapnumber}_${Math.floor(secs / 60)}min${String(secs % 60).padStart(2, '0')}sec`;
}

// ----------------------------------------------------------------------------- device info
let deviceNameCache = null;
async function deviceName() {
  if (deviceNameCache) return deviceNameCache;
  if (SCHEMA.deviceNameQuery) { try { const r = await q(SCHEMA.deviceNameQuery); if (r[0] && r[0].name) return (deviceNameCache = String(r[0].name)); } catch { /* ignore */ } }
  try { const r = await q('select inet_server_addr() as a'); deviceNameCache = 'RN-' + String(r[0].a || DEVICE).replace(/[^0-9a-z]/gi, ''); } catch { deviceNameCache = 'RN-' + DEVICE.replace(/\W/g, ''); }
  return deviceNameCache;
}

// ----------------------------------------------------------------------------- laps list
const L = SCHEMA.lap, D = SCHEMA.driver, V = SCHEMA.vehicle, E = SCHEMA.event, TV = SCHEMA.trackvariant, T = SCHEMA.track, S = SCHEMA.lapdata, SEC = SCHEMA.lapsector, VID = SCHEMA.video, LV = SCHEMA.lapVideo;

async function lapRows() {
  const sql = `
    select l.${ident(L.id)} as id, l.${ident(L.start)} as start, l.${ident(L.end)} as "end", l.${ident(L.number)} as lapnumber,
           l.${ident(L.vehicleNumber)} as vehiclenumber, l.${ident(L.vehicleModel)} as vehiclemodel,
           l.${ident(L.startCrossed)} as startcrossed, l.${ident(L.endCrossed)} as endcrossed,
           l.${ident(L.driver)} as driverid, l.${ident(L.vehicle)} as vehicleid, l.${ident(L.event)} as eventid,
           d.${ident(D.name)} as drivername, d.${ident(D.surname)} as driversurname,
           v.${ident(V.model)} as vmodel,
           e.${ident(E.name)} as eventname, e.${ident(E.start)} as eventstart, e.${ident(E.end)} as eventend, e.${ident(E.variant)} as variantid,
           tv.${ident(TV.name)} as variantname, tv.${ident(TV.track)} as trackid, t.${ident(T.name)} as trackname
    from ${ident(L.table)} l
    left join ${ident(D.table)} d on d.${ident(D.id)} = l.${ident(L.driver)}
    left join ${ident(V.table)} v on v.${ident(V.id)} = l.${ident(L.vehicle)}
    left join ${ident(E.table)} e on e.${ident(E.id)} = l.${ident(L.event)}
    left join ${ident(TV.table)} tv on tv.${ident(TV.id)} = e.${ident(E.variant)}
    left join ${ident(T.table)} t on t.${ident(T.id)} = tv.${ident(TV.track)}
    order by l.${ident(L.start)}`;
  return q(sql);
}
async function videosForLaps(lapIds) {
  if (!lapIds.length) return new Map();
  let rows;
  try {
    rows = await q(`select lv.${ident(LV.lap)} as lapid, vd.* from ${ident(LV.table)} lv join ${ident(VID.table)} vd on vd.${ident(VID.id)} = lv.${ident(LV.video)} where lv.${ident(LV.lap)} = any($1)`, [lapIds]);
  } catch (e) {
    // fallback: videos referencing the lap directly via parentid
    rows = await q(`select vd.${ident(VID.parent)} as lapid, vd.* from ${ident(VID.table)} vd where vd.${ident(VID.parent)} = any($1)`, [lapIds]);
  }
  const map = new Map();
  for (const r of rows) { if (!map.has(r.lapid)) map.set(r.lapid, []); map.get(r.lapid).push(r); }
  return map;
}

const fileIndex = new Map(); // generated file name → lap id
async function apiLaps() {
  const dev = await deviceName();
  const laps = await lapRows();
  const vids = await videosForLaps(laps.map((l) => l.id));
  const ftpNames = await ftpFileNames().catch(() => new Map());
  const out = [];
  for (const l of laps) {
    const startMs = ms(l.start), endMs = ms(l.end);
    const base = lapFileBase(l, dev);
    const dataFile = base + '.rnz';
    fileIndex.set(dataFile, l.id);
    const vlist = (vids.get(l.id) || []).filter((v) => v[VID.name]);
    const primary = vlist.find((v) => ftpNames.has(String(v[VID.name]).toLowerCase())) || vlist[0] || null;
    const videoFile = primary ? String(primary[VID.name]).split(/[\\/]/).pop() : null;
    out.push({
      id: `${dev}_${l.id}`,
      lapNumber: n(l.lapnumber), driver: [l.drivername, l.driversurname].filter(Boolean).join(' '), car: l.vmodel || l.vehiclemodel || '', carNumber: l.vehiclenumber ?? '',
      track: l.trackname || '', event: l.eventname || '', eventStartTime: fmtTime(l.eventstart), startTime: fmtTime(l.start),
      lapTimeMs: Number.isFinite(endMs - startMs) ? endMs - startMs : null,
      complete: bool01(l.startcrossed) === 1 && bool01(l.endcrossed) === 1,
      dataFile, dataSize: 0,
      videoFile, videoSize: primary ? n(primary[VID.size]) * (n(primary[VID.size]) < 10_000_000 ? 1024 : 1) : 0,
      videoOnDevice: videoFile ? ftpNames.has(videoFile.toLowerCase()) : false,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------- rnz generation
async function buildRnz(lapId) {
  const dev = await deviceName();
  const [l] = await q(`select l.*, d.${ident(D.name)} as drivername, d.${ident(D.surname)} as driversurname, d.${ident(D.photo)} as driverphoto,
                              v.${ident(V.model)} as vmodel, v.${ident(V.id)} as vid,
                              e.${ident(E.name)} as eventname, e.${ident(E.start)} as eventstart, e.${ident(E.end)} as eventend, e.${ident(E.variant)} as variantid, e.${ident(E.deleted)} as eventdeleted
                       from ${ident(L.table)} l
                       left join ${ident(D.table)} d on d.${ident(D.id)} = l.${ident(L.driver)}
                       left join ${ident(V.table)} v on v.${ident(V.id)} = l.${ident(L.vehicle)}
                       left join ${ident(E.table)} e on e.${ident(E.id)} = l.${ident(L.event)}
                       where l.${ident(L.id)} = $1`, [lapId]);
  if (!l) throw new Error('lap not found: ' + lapId);
  const [tv] = l.variantid ? await q(`select * from ${ident(TV.table)} where ${ident(TV.id)} = $1`, [l.variantid]) : [null];
  const [tr] = tv && tv[TV.track] ? await q(`select * from ${ident(T.table)} where ${ident(T.id)} = $1`, [tv[TV.track]]) : [null];
  const sm = await q(`select * from ${ident(S.table)} where ${ident(S.lap)} = $1 order by ${ident(S.time)}, ${ident(S.id)}`, [lapId]);
  const sectors = await q(`select * from ${ident(SEC.table)} where ${ident(SEC.lap)} = $1 order by ${ident(SEC.number)}`, [lapId]).catch(() => []);
  const vids = (await videosForLaps([lapId])).get(lapId) || [];

  const lapStart = l[L.start], lapEnd = l[L.end];
  const startCrossed = bool01(l[L.startCrossed]), endCrossed = bool01(l[L.endCrossed]);
  const now = fmtTime(new Date());
  const photo = l.driverphoto ? Buffer.from(l.driverphoto).toString('base64') : '';
  const trackDataXml = tv && tv[TV.xml] ? String(tv[TV.xml]).replace(/^\s*<\?xml[^>]*>\s*/, '') : '';

  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<lapData xmlns="http://macrix.eu/racenavigator/LapDataSchema" exportDeviceName="rn-bridge" exportDeviceVersion="0.1.0" exportDeviceTime="${now}" exportDataVersion="5" lastExportRnDeviceName="${esc(dev)}" sourceDeviceName="${esc(dev)}">\n`;
  x += `  <lap>\n    <id>${l[L.id]}</id>\n    <lapNumber>${n(l[L.number])}</lapNumber>\n    <type>0</type>\n    <sourceLapId>${l[L.id]}</sourceLapId>\n    <startTime>${fmtTime(lapStart)}</startTime>\n    <endTime>${fmtTime(lapEnd)}</endTime>\n    <vehicleNumber>${esc(l[L.vehicleNumber] ?? '')}</vehicleNumber>\n    <vehicleModel>${esc(l.vmodel || l[L.vehicleModel] || '')}</vehicleModel>\n    <isStartLineCrossed>${startCrossed}</isStartLineCrossed>\n    <isEndLineCrossed>${endCrossed}</isEndLineCrossed>\n    <streetModeTreshold1>-1</streetModeTreshold1>\n    <streetModeTreshold2>-1</streetModeTreshold2>\n    <streetModeCutStart></streetModeCutStart>\n    <streetModeCutEnd></streetModeCutEnd>\n  </lap>\n`;
  x += `  <driver>\n    <id>${l[L.driver] ?? ''}</id>\n    <driverName>${esc(l.drivername || '')}</driverName>\n    <photo>${photo}</photo>\n    <driverSurname>${esc(l.driversurname || '')}</driverSurname>\n  </driver>\n`;
  x += `  <vehicle>\n    <id>${l.vid ?? l[L.vehicle] ?? ''}</id>\n    <vehicleNumber>${esc(l[L.vehicleNumber] ?? '')}</vehicleNumber>\n    <vehicleModel>${esc(l.vmodel || l[L.vehicleModel] || '')}</vehicleModel>\n  </vehicle>\n`;
  x += `  <event>\n    <id>${l[L.event] ?? ''}</id>\n    <name>${esc(l.eventname || '')}</name>\n    <type>1</type>\n    <startTime>${fmtTime(l.eventstart)}</startTime>\n    <endTime>${fmtTime(l.eventend)}</endTime>\n    <isDeleted>${bool01(l.eventdeleted)}</isDeleted>\n  </event>\n`;
  if (tr) x += `  <track>\n    <id>${esc(tr[T.id])}</id>\n    <name>${esc(tr[T.name] || '')}</name>\n    <distance>${n(tr[T.distance])}</distance>\n    <width>${n(tr[T.width])}</width>\n    <definitionModificationDate>${fmtTime(tr[T.modified])}</definitionModificationDate>\n    <isDeleted>${bool01(tr[T.deleted])}</isDeleted>\n    <timeZoneContinent>${esc(tr[T.tzContinent] || '')}</timeZoneContinent>\n    <timeZoneCity>${esc(tr[T.tzCity] || '')}</timeZoneCity>\n    <trackType>${n(tr[T.type])}</trackType>\n  </track>\n`;
  if (tv) x += `  <trackVariant>\n    <id>${esc(tv[TV.id])}</id>\n    <name>${esc(tv[TV.name] || '')}</name>\n    <trackDataXml>\n${trackDataXml}\n    </trackDataXml>\n    <distance>${n(tv[TV.distance])}</distance>\n    <width>${n(tv[TV.width])}</width>\n    <isHistorical>${bool01(tv[TV.historical])}</isHistorical>\n    <isPreinstalled>${bool01(tv[TV.preinstalled])}</isPreinstalled>\n  </trackVariant>\n`;
  x += '  <measurements>\n';
  let mn = 0;
  for (const r of sm) {
    mn++;
    const valid = n(r[S.valid], 1);
    x += `   <sm id="${r[S.id]}" mt="${fmtTime(r[S.time])}" la="${n(r[S.xaccel])}" lo="${n(r[S.yaccel])}" za="${n(r[S.zaccel])}" ds="${n(r[S.distance])}" lt="${r[S.lat] ?? 0}" lg="${r[S.lng] ?? 0}" rp="${n(r[S.rpm], -1)}" gs="${n(r[S.speed])}" gd="0" ph="${n(r[S.pitch])}" rl="${n(r[S.roll])}" ya="${n(r[S.yaw])}" al="${n(r[S.alt])}" dr="${n(r[S.direction])}" df="${n(r[S.deviation])}" os="${n(r[S.obdSpeed])}" ot="${n(r[S.oilTemp])}" wt="${n(r[S.waterTemp])}" tp="-1" mn="${mn}" ga="100" igpsv="${valid ? 1 : 0}" igyrv="1" iobdv="${n(r[S.rpm], -1) > 0 ? 1 : 0}" ipc="0">\n`;
  }
  x += '  </measurements>\n  <lapSectors>\n';
  for (const s of sectors) x += `    <lapsector>\n      <id>${s[SEC.id]}</id>\n      <sectorNumber>${n(s[SEC.number])}</sectorNumber>\n      <startTime>${fmtTime(s[SEC.start])}</startTime>\n      <endTime>${fmtTime(s[SEC.end])}</endTime>\n    </lapsector>\n`;
  x += '  </lapSectors>\n  <videos>\n';
  for (const v of vids) {
    const name = String(v[VID.name] || '').split(/[\\/]/).pop();
    if (!name) continue;
    x += `    <video locationType="0" uri="${esc(name)}">\n      <id>${v[VID.id]}</id>\n      <fileName>${esc(name)}</fileName>\n      <startTime>${fmtTime(v[VID.start])}</startTime>\n      <endTime>${fmtTime(v[VID.end])}</endTime>\n      <status>${n(v[VID.status], 3)}</status>\n      <videoQuality>${n(v[VID.quality])}</videoQuality>\n      <videoFileSize>${n(v[VID.size])}</videoFileSize>\n      <parentId>${v[VID.parent] ?? lapId}</parentId>\n    </video>\n`;
  }
  x += '  </videos>\n</lapData>\n';

  const base = lapFileBase({ start: lapStart, end: lapEnd, lapnumber: n(l[L.number]) }, dev);
  const firstVideo = vids.length ? String(vids[0][VID.name]).split(/[\\/]/).pop() : '';
  const comment = [
    `EventName=${l.eventname || ''}`, `EventStartTime=${fmtTime(l.eventstart)}`, `Driver=${l.drivername || ''}`, `LapTime=${lapTimeStr(ms(lapEnd) - ms(lapStart))}`,
    `LapNumber=${n(l[L.number])}`, `LapStartTime=${fmtTime(lapStart)}`, `VehicleModel=${l.vmodel || l[L.vehicleModel] || ''}`, `VehicleNumber=${l[L.vehicleNumber] ?? ''}`,
    `SourceDeviceName=${dev}`, `SourceLapId=${l[L.id]}`, `ExportDeviceName=rn-bridge`, `ExportDeviceVersion=0.1.0`, `ExportDataVersion=5`, `ExportDeviceTime=${now}`,
    `IsStartLineCrossed=${startCrossed ? 'true' : 'false'}`, `IsEndLineCrossed=${endCrossed ? 'true' : 'false'}`, `TrackVariantId=${tv ? tv[TV.id] : ''}`, `VideoLocationType_0=${firstVideo}`, `LapType=0`, `EventType=1`, '',
  ].join('\n');
  return { name: base + '.rnz', data: zip([{ name: base + '.rn', data: Buffer.from(x, 'utf8') }], comment) };
}

/** Minimal ZIP writer (deflate) with archive comment. */
function zip(files, comment = '') {
  const parts = [], central = [];
  let offset = 0;
  const crc32 = zlib.crc32 ? (b) => zlib.crc32(b) : crc32Fallback;
  for (const f of files) {
    const nameB = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameB, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameB);
    offset += lh.length + nameB.length + comp.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const commentB = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(commentB.length, 20);
  return Buffer.concat([...parts, ...central, eocd, commentB]);
}
let crcTable;
function crc32Fallback(buf) {
  if (!crcTable) { crcTable = new Int32Array(256); for (let n2 = 0; n2 < 256; n2++) { let c = n2; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n2] = c; } }
  let crc = -1; for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return (crc ^ -1) >>> 0;
}

// ----------------------------------------------------------------------------- FTP
async function ftpClient() {
  await deps();
  const Client = (ftpMod.default || ftpMod).Client;
  const c = new Client(30000);
  await c.access({ host: FTP.host, user: FTP.user, password: FTP.password, secure: false });
  return c;
}
let ftpListCache = { at: 0, map: new Map() };
async function ftpFileNames() {
  if (Date.now() - ftpListCache.at < 20000) return ftpListCache.map;
  const c = await ftpClient();
  try {
    const map = new Map();
    const walk = async (dir, depth) => {
      const list = await c.list(dir);
      for (const e of list) {
        const full = (dir.endsWith('/') ? dir : dir + '/') + e.name;
        if (e.isDirectory && depth < 2) await walk(full, depth + 1);
        else if (e.isFile) map.set(e.name.toLowerCase(), { path: full, size: e.size });
      }
    };
    await walk(FTP.dir, 0);
    ftpListCache = { at: Date.now(), map };
    return map;
  } finally { c.close(); }
}
async function streamFtpFile(name, req, res) {
  const names = await ftpFileNames();
  const entry = names.get(name.toLowerCase());
  if (!entry) { res.writeHead(404, CORS); return res.end('video not on device: ' + name); }
  const c = await ftpClient();
  try {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const total = entry.size;
    const headers = { ...CORS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
    if (range) { const end = range[2] ? Number(range[2]) : total - 1; headers['Content-Range'] = `bytes ${start}-${end}/${total}`; headers['Content-Length'] = end - start + 1; res.writeHead(206, headers); }
    else { headers['Content-Length'] = total; res.writeHead(200, headers); }
    if (req.method === 'HEAD') return res.end();
    req.on('close', () => { try { c.close(); } catch { /* ignore */ } });
    await c.downloadTo(res, entry.path, start);
  } finally { try { c.close(); } catch { /* ignore */ } }
}

// ----------------------------------------------------------------------------- discovery
async function discover() {
  console.log(`\n== Race Navigator ${DEVICE} – PostgreSQL ${PG.user}@${PG.database}:${PG.port}`);
  try {
    const tables = await q(`select table_name from information_schema.tables where table_schema='public' order by table_name`);
    for (const t of tables) {
      const cols = await q(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t.table_name]);
      let count = '?';
      try { count = (await q(`select count(*)::int as c from ${ident(t.table_name)}`))[0].c; } catch { /* ignore */ }
      console.log(`\n${t.table_name}  (${count} rows)`);
      console.log('   ' + cols.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
    }
    for (const t of ['lap', 'lapdata', 'video', 'lap_video', 'event', 'driver']) {
      try { const r = await q(`select * from ${ident(t)} order by 1 desc limit 2`); console.log(`\nsample ${t}:`, JSON.stringify(r, (k, v) => (v && v.type === 'Buffer' ? `<blob ${v.data.length}>` : v)).slice(0, 1200)); } catch { /* table may not exist */ }
    }
  } catch (e) { console.error('PostgreSQL failed:', e.message); }
  console.log(`\n== FTP ${FTP.user}@${DEVICE}${FTP.dir}`);
  try {
    const c = await ftpClient();
    const list = await c.list(FTP.dir);
    for (const e of list.slice(0, 60)) console.log(`   ${e.isDirectory ? '[dir] ' : ''}${e.name}  ${e.size}`);
    if (list.length > 60) console.log(`   … ${list.length - 60} more`);
    c.close();
  } catch (e) { console.error('FTP failed:', e.message); }
  console.log('\nSend this output to adapt the SCHEMA mapping if anything looks different.');
}

// ----------------------------------------------------------------------------- HTTP server
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const json = (res, obj, code = 200) => { const b = JSON.stringify(obj); res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if (url.pathname === '/api/info') {
      const laps = await apiLaps();
      const last = laps[laps.length - 1];
      return json(res, { deviceName: await deviceName(), deviceType: 'RN (bridge)', driver: last ? last.driver : '', car: last ? last.car : '', version: 'rn-bridge 0.1.0', apiVersion: 1, lapCount: laps.length, bridge: true });
    }
    if (url.pathname === '/api/laps') return json(res, await apiLaps());
    if (url.pathname.startsWith('/files/')) {
      const name = decodeURIComponent(url.pathname.slice(7));
      if (/\.rnz$/i.test(name)) {
        if (!fileIndex.has(name)) await apiLaps();
        const lapId = fileIndex.get(name);
        if (lapId === undefined) { res.writeHead(404, CORS); return res.end('unknown lap file'); }
        const { data } = await buildRnz(lapId);
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/zip', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${name}"` });
        return res.end(data);
      }
      return streamFtpFile(name, req, res);
    }
    // static app
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(APP_DIR, p));
    if (!file.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(req.url, e.message);
    if (!res.headersSent) json(res, { error: e.message, hint: 'Run with --discover to inspect the device schema.' }, 500);
    else res.end();
  }
}

if (DISCOVER) {
  discover().then(() => process.exit(0));
} else {
  http.createServer(handle).listen(PORT, '0.0.0.0', () => {
    console.log(`rn-bridge → Race Navigator ${DEVICE} (PostgreSQL ${PG.database}, FTP ${FTP.dir})`);
    console.log(`Open the RN Analyzer on your phone:`);
    const nets = os.networkInterfaces();
    for (const k of Object.keys(nets)) for (const a of nets[k]) if (a.family === 'IPv4' && !a.internal) console.log(`   http://${a.address}:${PORT}   → Devices tab → address http://${a.address}:${PORT}`);
    console.log(`serving app from ${APP_DIR}`);
  });
}
