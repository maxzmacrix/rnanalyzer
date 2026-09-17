#!/usr/bin/env node
// Mock "Race Navigator" device HTTP API for testing the RN Analyzer device import.
// It exposes the folder with .rnz/.mp4 files exactly like the API the web app expects:
//
//   GET /api/info            → { deviceName, deviceType, driver, car, version, apiVersion }
//   GET /api/laps            → [ { id, lapNumber, driver, car, track, event, eventStartTime, startTime, lapTimeMs,
//                                  complete, dataFile, dataSize, videoFile, videoSize } ]
//   GET /files/<name>        → file bytes (Content-Length set, Range supported)
//
// All responses carry CORS headers so a browser app served from another origin can call it.
// Usage: node tools/mock-device-server.mjs [port] [folder]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8090);
const folder = path.resolve(process.argv[3] || path.join(__dirname, '..', 'Example files'));
const deviceName = process.env.RN_DEVICE_NAME || 'RNONE-228';

function readZipComment(file) {
  // The .rnz ZIP archive comment carries key=value metadata (see RN file format spec §5)
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 70000);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        const clen = buf.readUInt16LE(i + 20);
        return buf.subarray(i + 22, i + 22 + clen).toString('utf8');
      }
    }
  } finally { fs.closeSync(fd); }
  return '';
}
function parseKv(text) {
  const o = {};
  for (const line of text.split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return o;
}
function lapTimeMs(s) { const m = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(s || ''); return m ? ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + Number((m[4] || '0').padEnd(3, '0').slice(0, 3))) : null; }

// Fallback: read the lap XML inside the rnz when the comment is missing
function readRnXmlMeta(file) {
  try {
    const buf = fs.readFileSync(file);
    // find first local header
    if (buf.readUInt32LE(0) !== 0x04034b50) return {};
    const method = buf.readUInt16LE(8); const csize = buf.readUInt32LE(18); const nlen = buf.readUInt16LE(26); const elen = buf.readUInt16LE(28);
    const start = 30 + nlen + elen; const comp = buf.subarray(start, start + csize);
    const xml = (method === 8 ? zlib.inflateRawSync(comp) : comp).toString('utf8');
    const g = (tag) => { const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml); return m ? m[1] : ''; };
    return { EventName: (/<event>[\s\S]*?<name>([^<]*)</.exec(xml) || [])[1] || '', Driver: g('driverName'), LapNumber: g('lapNumber'), LapStartTime: g('startTime'), VehicleModel: g('vehicleModel'), VehicleNumber: g('vehicleNumber'), IsStartLineCrossed: g('isStartLineCrossed') === '1' ? 'true' : 'false', IsEndLineCrossed: g('isEndLineCrossed') === '1' ? 'true' : 'false', VideoLocationType_0: g('fileName'), TrackName: (/<track>[\s\S]*?<name>([^<]*)</.exec(xml) || [])[1] || '' , SourceLapId: g('sourceLapId') };
  } catch { return {}; }
}

function listLaps() {
  const files = fs.readdirSync(folder);
  const laps = [];
  for (const f of files) {
    if (!/\.rnz$/i.test(f)) continue;
    const full = path.join(folder, f);
    let meta = parseKv(readZipComment(full));
    if (!meta.LapNumber) meta = { ...readRnXmlMeta(full), ...meta };
    const videoFile = meta.VideoLocationType_0 && files.find((x) => x.toLowerCase() === meta.VideoLocationType_0.toLowerCase());
    const videoSize = videoFile ? fs.statSync(path.join(folder, videoFile)).size : 0;
    laps.push({
      id: `${meta.SourceDeviceName || deviceName}_${meta.SourceLapId || f}`,
      lapNumber: Number(meta.LapNumber || 0),
      driver: meta.Driver || '',
      car: meta.VehicleModel || '',
      carNumber: meta.VehicleNumber || '',
      track: meta.TrackName || '',
      event: meta.EventName || '',
      eventStartTime: meta.EventStartTime || '',
      startTime: meta.LapStartTime || '',
      lapTimeMs: lapTimeMs(meta.LapTime),
      complete: meta.IsStartLineCrossed === 'true' && meta.IsEndLineCrossed === 'true',
      dataFile: f,
      dataSize: fs.statSync(full).size,
      videoFile: videoFile || null,
      videoSize,
    });
  }
  laps.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  return laps;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const json = (obj, code = 200) => { const b = JSON.stringify(obj); res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
  if (url.pathname === '/api/info') {
    const laps = listLaps();
    return json({ deviceName, deviceType: 'RN ONE', driver: laps.at(-1)?.driver || '', car: laps.at(-1)?.car || '', version: '1.37.00', apiVersion: 1, lapCount: laps.length });
  }
  if (url.pathname === '/api/laps') return json(listLaps());
  if (url.pathname.startsWith('/files/')) {
    const name = decodeURIComponent(url.pathname.slice(7));
    const file = path.join(folder, path.basename(name));
    if (!fs.existsSync(file)) { res.writeHead(404, CORS); return res.end('not found'); }
    const st = fs.statSync(file);
    const type = /\.mp4$/i.test(file) ? 'video/mp4' : /\.rnz$/i.test(file) ? 'application/zip' : 'application/octet-stream';
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]); const end = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { ...CORS, 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...CORS, 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  json({ error: 'unknown endpoint', endpoints: ['/api/info', '/api/laps', '/files/<name>'] }, 404);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mock RN device "${deviceName}" → http://localhost:${port}   (folder: ${folder})`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === 'IPv4' && !n.internal) console.log(`   on this network: http://${n.address}:${port}`);
});
