// Numeric helpers: interpolation, channel access, time slip, sector times.

/** First index i in sorted xs[0..n) with xs[i] >= x. */
export function lowerBound(xs, x, n = xs.length) {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Linear interpolation of ys over monotonic xs at x (clamped to ends). */
export function interpAt(xs, ys, x, n = xs.length) {
  if (n === 0) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = lowerBound(xs, x, n);
  if (i <= 0) return ys[0];
  if (i >= n) return ys[n - 1];
  const x0 = xs[i - 1], x1 = xs[i];
  if (x1 === x0) return ys[i];
  const f = (x - x0) / (x1 - x0);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * f;
}

/** Index of sample nearest to x along xs (monotonic). */
export function nearestIndex(xs, x, n = xs.length) {
  if (n === 0) return -1;
  let i = lowerBound(xs, x, n);
  if (i <= 0) return 0;
  if (i >= n) return n - 1;
  return (x - xs[i - 1]) < (xs[i] - x) ? i - 1 : i;
}

export function timeAtDistance(s, d) { return interpAt(s.d, s.t, d, s.n); }
export function distanceAtTime(s, t) { return interpAt(s.t, s.d, t, s.n); }

/** Channel definitions (key → accessor). Derived channels are computed lazily and cached on the samples object. */
export const CHANNELS = {
  speed:   { key: 'v',    label: 'ch_speed', unit: 'speed', decimals: 1, kind: 'number' },
  glon:    { key: 'gLon', label: 'ch_glon',  unit: 'g', decimals: 2, kind: 'number' },
  glat:    { key: 'gLat', label: 'ch_glat',  unit: 'g', decimals: 2, kind: 'number' },
  gvert:   { key: 'gVert', label: 'ch_gvert', unit: 'g', decimals: 2, kind: 'number' },
  gcomb:   { key: 'gComb', label: 'ch_gcomb', unit: 'g', decimals: 2, kind: 'number', derived: true },
  dev:     { key: 'dev',  label: 'ch_dev',   unit: 'm', decimals: 2, kind: 'number' },
  alt:     { key: 'alt',  label: 'ch_alt',   unit: 'm', decimals: 1, kind: 'number' },
  hdg:     { key: 'hdg',  label: 'ch_hdg',   unit: 'deg', decimals: 0, kind: 'number' },
  gyrY:    { key: 'gyrY', label: 'ch_gyrY',  unit: 'raw', decimals: 2, kind: 'number', group: 'gyro' },
  gyrP:    { key: 'gyrP', label: 'ch_gyrP',  unit: 'raw', decimals: 2, kind: 'number', group: 'gyro' },
  gyrR:    { key: 'gyrR', label: 'ch_gyrR',  unit: 'raw', decimals: 2, kind: 'number', group: 'gyro' },
  rpm:     { key: 'rpm',  label: 'ch_rpm',   unit: 'rpm', decimals: 0, kind: 'number', group: 'obd', avail: 'rpm' },
  thr:     { key: 'thr',  label: 'ch_thr',   unit: '%', decimals: 0, kind: 'number', group: 'obd', avail: 'throttle' },
  wt:      { key: 'wt',   label: 'ch_wt',    unit: '°C', decimals: 0, kind: 'number', group: 'obd', avail: 'waterTemp' },
  ot:      { key: 'ot',   label: 'ch_ot',    unit: '°C', decimals: 0, kind: 'number', group: 'obd', avail: 'oilTemp' },
  os:      { key: 'os',   label: 'ch_os',    unit: 'speed', decimals: 1, kind: 'number', group: 'obd', avail: 'obdSpeed' },
  hr:      { key: 'hr',   label: 'ch_hr',    unit: 'bpm', decimals: 0, kind: 'number', group: 'health', avail: 'hr' },
  timeslip:{ key: null,   label: 'ch_timeslip', unit: 's', decimals: 2, kind: 'timeslip' },
  map:     { key: null,   label: 'ch_map',      kind: 'map' },
  gforce:  { key: null,   label: 'ch_gforce',   kind: 'scatter' },
  coach:   { key: null,   label: 'ch_coach',    kind: 'coach' },
  highlights: { key: null, label: 'ch_highlights', kind: 'highlights' },
  strips:  { key: null,   label: 'ch_strips',    kind: 'strips' },
  detail:  { key: null,   label: 'ch_detail',   kind: 'detail' },
  overview:{ key: null,   label: 'ch_overview', kind: 'overview' },
  sections:{ key: null,   label: 'ch_sections', kind: 'sections' },
};

export function channelArray(s, chId) {
  if (typeof chId === 'string' && chId.startsWith('custom:')) {
    const name = chId.slice(7);
    return (s.custom && s.custom[name]) || null;
  }
  const ch = CHANNELS[chId];
  if (!ch || !ch.key) return null;
  if (ch.derived) {
    if (chId === 'gcomb') {
      if (!s.gComb) {
        const a = new Float32Array(s.n);
        for (let i = 0; i < s.n; i++) a[i] = Math.hypot(s.gLon[i], s.gLat[i]);
        s.gComb = a;
      }
      return s.gComb;
    }
  }
  return s[ch.key] || null;
}

/** X array for the given mode. */
export function xArray(s, xMode) { return xMode === 'time' ? s.t : s.d; }

/** Value of channel at x (distance m or time s) */
export function valueAt(s, chId, x, xMode) {
  const ys = channelArray(s, chId);
  if (!ys) return NaN;
  return interpAt(xArray(s, xMode), ys, x, s.n);
}

/** Position (lat,lng) at x. */
export function positionAt(s, x, xMode) {
  const xs = xArray(s, xMode);
  return { lat: interpAt(xs, s.lat, x, s.n), lng: interpAt(xs, s.lng, x, s.n) };
}

/** Time slip of lap s vs. reference ref, sampled every `step` metres. Positive = lap is slower (behind). */
export function timeSlipSeries(s, ref, step = 5) {
  const dmax = Math.min(s.d[s.n - 1], ref.d[ref.n - 1]);
  const m = Math.max(2, Math.floor(dmax / step) + 1);
  const x = new Float32Array(m);
  const y = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const d = Math.min(i * step, dmax);
    x[i] = d;
    y[i] = timeAtDistance(s, d) - timeAtDistance(ref, d);
  }
  return { x, y, n: m };
}

/** Time slip in time mode: distance difference vs reference at equal time (metres ahead, positive = ahead). */
export function distanceGapSeries(s, ref, step = 0.5) {
  const tmax = Math.min(s.t[s.n - 1], ref.t[ref.n - 1]);
  const m = Math.max(2, Math.floor(tmax / step) + 1);
  const x = new Float32Array(m);
  const y = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const t = Math.min(i * step, tmax);
    x[i] = t;
    y[i] = distanceAtTime(s, t) - distanceAtTime(ref, t);
  }
  return { x, y, n: m };
}

/** Sector boundary distances (m) from the device-recorded sector times. Returns splits excluding 0 and lap end. */
export function deviceSplits(lap, s) {
  if (!lap.sectors || lap.sectors.length < 2 || !s) return [];
  const out = [];
  for (let i = 0; i < lap.sectors.length - 1; i++) out.push(distanceAtTime(s, lap.sectors[i].endS));
  return out;
}

/** Sector times (s) from device data. */
export function deviceSectorTimes(lap) {
  if (!lap.sectors || !lap.sectors.length) return [];
  return lap.sectors.map((sec) => sec.endS - sec.startS);
}

/** Sector times (s) from distance splits (m). */
export function sectorTimesFromSplits(s, splits, lapTimeS) {
  const bounds = [0, ...splits.filter((x) => x > 0 && x < s.d[s.n - 1]).sort((a, b) => a - b), Infinity];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const t0 = bounds[i] === 0 ? 0 : timeAtDistance(s, bounds[i]);
    const t1 = bounds[i + 1] === Infinity ? lapTimeS : timeAtDistance(s, bounds[i + 1]);
    out.push(t1 - t0);
  }
  return out;
}

/** Best theoretical (sum of best sectors) and best continuous (best single lap) from rows of sector times. */
export function bestTimes(rows) {
  if (!rows.length) return { theoretical: NaN, continuous: NaN, bestPerSector: [] };
  const k = Math.min(...rows.map((r) => r.length));
  const best = [];
  for (let j = 0; j < k; j++) best.push(Math.min(...rows.map((r) => r[j])));
  const theoretical = best.reduce((a, b) => a + b, 0);
  const continuous = Math.min(...rows.map((r) => r.slice(0, k).reduce((a, b) => a + b, 0)));
  return { theoretical, continuous, bestPerSector: best };
}

/** Segment intersection test in local planar coordinates. */
function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Distances (m) at which the GPS trace crosses each sector line of the track definition. */
export function geometricSplits(s, trackDef) {
  if (!trackDef || !trackDef.sectors || !s || s.n < 2) return [];
  const lat0 = s.lat[0];
  const k = Math.cos((lat0 * Math.PI) / 180);
  const out = [];
  for (const sec of trackDef.sectors) {
    const pts = sec.points;
    if (!pts || pts.length < 2) continue;
    let found = NaN;
    outer: for (let i = 1; i < s.n; i++) {
      if (!s.gpsOk[i] && !s.gpsOk[i - 1]) continue;
      const ax = s.lng[i - 1] * k, ay = s.lat[i - 1], bx = s.lng[i] * k, by = s.lat[i];
      for (let j = 1; j < pts.length; j++) {
        const cx = pts[j - 1].lng * k, cy = pts[j - 1].lat, dx = pts[j].lng * k, dy = pts[j].lat;
        if (segIntersect(ax, ay, bx, by, cx, cy, dx, dy)) { found = (s.d[i - 1] + s.d[i]) / 2; break outer; }
      }
    }
    if (Number.isFinite(found)) out.push(found);
  }
  return out.sort((a, b) => a - b);
}

/** Nice tick step for a range and desired tick count. */
export function niceStep(range, count) {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  let nf = 1;
  if (f > 5) nf = 10; else if (f > 2) nf = 5; else if (f > 1) nf = 2;
  return nf * pow;
}
