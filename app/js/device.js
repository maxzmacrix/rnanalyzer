// Client for the Race Navigator device HTTP API (see tools/mock-device-server.mjs and README for the contract).
//
//   GET {base}/api/info   → { deviceName, deviceType, driver, car, version, apiVersion }
//   GET {base}/api/laps   → [ { id, lapNumber, driver, car, track, event, startTime, lapTimeMs, complete,
//                               dataFile, dataSize, videoFile, videoSize } ]
//   GET {base}/files/{n}  → file bytes
//
// The original iPad app talked to the device through Bonjour discovery, direct PostgreSQL queries and FTP.
// None of those are reachable from a browser, so the device (or a small bridge next to it) must offer this HTTP API.

export function normalizeBase(input) {
  let s = (input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

export function mixedContentBlocked(base) {
  return location.protocol === 'https:' && /^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(base);
}

async function getJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(tm); }
}

export async function fetchDeviceInfo(base) {
  return getJson(`${base}/api/info`);
}
export async function fetchDeviceLaps(base) {
  const laps = await getJson(`${base}/api/laps`, 20000);
  if (!Array.isArray(laps)) throw new Error('Unexpected /api/laps response');
  return laps;
}

/**
 * Download a file with progress. Returns a Blob.
 * @param {string} base
 * @param {string} name
 * @param {(loaded:number,total:number,bps:number)=>void} onProgress
 * @param {AbortSignal} [signal]
 */
export async function downloadFile(base, name, onProgress, signal) {
  const url = `${base}/files/${encodeURIComponent(name)}`;
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const type = res.headers.get('Content-Type') || (/\.mp4$/i.test(name) ? 'video/mp4' : 'application/octet-stream');
  if (!res.body || !res.body.getReader) {
    const b = await res.blob();
    onProgress && onProgress(b.size, b.size, 0);
    return b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  const t0 = performance.now();
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (onProgress && now - lastReport > 120) {
      lastReport = now;
      onProgress(loaded, total, loaded / Math.max(0.001, (now - t0) / 1000));
    }
  }
  onProgress && onProgress(loaded, total || loaded, loaded / Math.max(0.001, (performance.now() - t0) / 1000));
  return new Blob(chunks, { type });
}
