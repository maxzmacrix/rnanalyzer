// Highlight markers: moments of a lap worth jumping to, detected from telemetry alone. Pure data module – no DOM,
// no i18n. Units: distances in metres, speeds in m/s, times in seconds, accelerations in g.
//
//   const events = detectHighlights(lap, ref)   // lap = { lap, samples }, ref optional (the fastest lap)
//   events[i] = { kind, d, t, value }           // kind: 'gpeak' | 'loss' | 'gain' | 'offtrack'; d/t on the lap itself
//
// gpeak    the three hardest moments of the lap (combined lateral + longitudinal g), at least 100 m apart
// loss     the lap loses ≥ 0.25 s against the reference within 50 m (up to three, the largest)
// gain     the same for time gained
// offtrack the lap runs more than half the track width (+2 m) away from the reference line for at least a second

import { lowerBound, timeSlipSeries, interpAt } from './analysis.js';

export const H = { gMin: 0.8, gSepM: 100, slipWinM: 50, slipMinS: 0.25, slipSepM: 100, offMarginM: 2, offHalfDefaultM: 5, offSustain: 10, maxPer: 3 };
const M_PER_DEG = 111320;

/** Local maxima of an array over ±k samples, values ≥ min, returned as indices. */
function peaks(arr, n, k, min) {
  const out = [];
  for (let i = 1; i < n - 1; i++) {
    const v = arr[i];
    if (!(v >= min)) continue;
    let ok = true;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (arr[j] > v) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
/** Keep the strongest events at least sepM apart, at most maxN. */
function suppress(events, sepM, maxN) {
  const sorted = [...events].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const kept = [];
  for (const e of sorted) { if (kept.every((k) => Math.abs(k.d - e.d) >= sepM)) kept.push(e); if (kept.length >= maxN) break; }
  return kept;
}

export function gPeaks(s) {
  const g = new Float32Array(s.n);
  for (let i = 0; i < s.n; i++) g[i] = Math.hypot(s.gLat[i] || 0, s.gLon[i] || 0);
  return suppress(peaks(g, s.n, 10, H.gMin).map((i) => ({ kind: 'gpeak', d: s.d[i], t: s.t[i], value: g[i] })), H.gSepM, H.maxPer);
}

export function slipEvents(s, ref) {
  const slip = timeSlipSeries(s, ref, 5);
  if (!slip || slip.n < 3) return [];
  const w = H.slipWinM, end = Math.min(s.d[s.n - 1], ref.d[ref.n - 1]) - w;
  const loss = [], gain = [];
  for (let d = 0; d < end; d += 5) {
    const dv = interpAt(slip.x, slip.y, d + w, slip.n) - interpAt(slip.x, slip.y, d, slip.n);
    if (!Number.isFinite(dv)) continue;
    const mid = d + w / 2;
    if (dv >= H.slipMinS) loss.push({ kind: 'loss', d: mid, t: interpAt(s.d, s.t, mid, s.n), value: dv });
    else if (dv <= -H.slipMinS) gain.push({ kind: 'gain', d: mid, t: interpAt(s.d, s.t, mid, s.n), value: dv });
  }
  return [...suppress(loss, H.slipSepM, H.maxPer), ...suppress(gain, H.slipSepM, H.maxPer)];
}

export function offTrack(s, ref, trackWidthM) {
  const half = Number.isFinite(trackWidthM) && trackWidthM > 6 ? trackWidthM / 2 : H.offHalfDefaultM;
  const limit = half + H.offMarginM;
  const out = [];
  let run = 0, maxI = -1, maxDev = 0;
  const dMax = ref.d[ref.n - 1] - 20; // beyond the reference's last samples there is no line to compare with
  for (let i = 0; i < s.n; i++) {
    if (!(Math.abs(s.lat[i]) > 0.0001) || s.d[i] > dMax) { run = 0; continue; }
    const k = Math.cos((s.lat[i] * Math.PI) / 180);
    const j0 = lowerBound(ref.d, s.d[i], ref.n);
    let best = Infinity;
    for (let j = Math.max(0, j0 - 15); j <= Math.min(ref.n - 1, j0 + 15); j++) {
      if (!(Math.abs(ref.lat[j]) > 0.0001)) continue;
      const dy = (s.lat[i] - ref.lat[j]) * M_PER_DEG, dx = (s.lng[i] - ref.lng[j]) * M_PER_DEG * k;
      const dist = Math.hypot(dx, dy);
      if (dist < best) best = dist;
    }
    if (best > limit) { run++; if (best > maxDev) { maxDev = best; maxI = i; } }
    else { if (run >= H.offSustain) out.push({ kind: 'offtrack', d: s.d[maxI], t: s.t[maxI], value: maxDev }); run = 0; maxDev = 0; maxI = -1; }
  }
  if (run >= H.offSustain && maxI >= 0) out.push({ kind: 'offtrack', d: s.d[maxI], t: s.t[maxI], value: maxDev });
  return out.slice(0, H.maxPer);
}

/**
 * All highlights of one lap, sorted by distance. With a reference lap, time loss/gain and off-line moments are added.
 * @param {{lap:object, samples:object}} lap
 * @param {{lap:object, samples:object}} [ref]  the fastest lap (omit or pass the same lap for a single-lap view)
 */
export function detectHighlights(lap, ref) {
  const s = lap.samples;
  if (!s || !s.n) return [];
  const events = gPeaks(s);
  if (ref && ref.samples && ref.lap.id !== lap.lap.id) {
    events.push(...slipEvents(s, ref.samples));
    events.push(...offTrack(s, ref.samples, lap.lap.track && lap.lap.track.width));
  }
  return events.sort((a, b) => a.d - b.d);
}
