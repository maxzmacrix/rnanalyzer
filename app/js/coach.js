// Corner coach: deterministic, corner-by-corner explanation of where and why one lap loses time against the
// fastest lap. Pure data module – no DOM, no i18n. Units: distances in metres, speeds in m/s, times in seconds.
//
//   const result = coachCompare(ref, cmp)     // ref/cmp = { lap, samples }
//   result.corners[i] = { name, num, d, start, end, lost, lostEntry, lostExit, facts: [{ key, ...params }], ref, cmp }
//   result.patterns   = [{ key, n, total }]    // recurring differences across corners
//   result.total      = time the compared lap loses over the whole lap (s, positive = slower)
//   cornerAt(result, distance) → the corner whose window contains the distance

import { lowerBound, timeSlipSeries, interpAt } from './analysis.js';

// thresholds above GPS/sensor noise – differences below these are not reported
export const T = { brakeM: 8, apexMs: 1.0, gasM: 8, lineM: 1.5, lostS: 0.05, exitMs: 1.0 };
const BRAKE_G = -0.25, GAS_G = 0.12, SUSTAIN = 3, LAT_G = 0.45;

const M_PER_DEG = 111320;
function toXY(lat, lng, lat0) { const k = Math.cos((lat0 * Math.PI) / 180); return { x: lng * M_PER_DEG * k, y: lat * M_PER_DEG }; }

function nearestSampleTo(s, lat, lng) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < s.n; i++) {
    if (!(Math.abs(s.lat[i]) > 0.0001)) continue;
    const dl = s.lat[i] - lat, dg = (s.lng[i] - lng) * Math.cos((lat * Math.PI) / 180);
    const d = dl * dl + dg * dg;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Corner anchors on the reference lap: from the track definition, or from lateral-g peaks when there is none. */
export function detectCorners(ref) {
  const s = ref.samples;
  const anchors = [];
  const curves = (ref.lap.trackDef && ref.lap.trackDef.curves) || [];
  for (const c of curves) {
    if (!c.points || !c.points.length) continue;
    const mid = c.points[Math.floor(c.points.length / 2)];
    const i = nearestSampleTo(s, mid.lat, mid.lng);
    if (i < 0) continue;
    const m = /(\d+)/.exec(c.name || '');
    anchors.push({ name: c.name || '', num: m ? Number(m[1]) : anchors.length + 1, d: s.d[i] });
  }
  if (!anchors.length) {
    // fallback: sustained lateral g → one anchor at the peak of each region
    let inTurn = false, peak = 0, peakI = -1, n = 0;
    for (let i = 0; i < s.n; i++) {
      const g = Math.abs(s.gLat[i] || 0);
      if (g > LAT_G) { if (!inTurn) { inTurn = true; peak = 0; } if (g > peak) { peak = g; peakI = i; } }
      else if (inTurn) { inTurn = false; n++; anchors.push({ name: `Turn ${n}`, num: n, d: s.d[peakI] }); }
    }
  }
  anchors.sort((a, b) => a.d - b.d);
  // merge anchors closer than 40 m (chicanes) and build windows: braking zone belongs to the corner, exit too
  const merged = [];
  for (const a of anchors) { const last = merged[merged.length - 1]; if (last && a.d - last.d < 40) continue; merged.push(a); }
  const end = s.d[s.n - 1];
  return merged.map((a, i) => {
    const prev = i > 0 ? merged[i - 1].d : 0, next = i < merged.length - 1 ? merged[i + 1].d : end;
    return { ...a, start: i > 0 ? (prev + a.d) / 2 : Math.max(0, a.d - 350), end: i < merged.length - 1 ? (a.d + next) / 2 : end };
  });
}

function sustained(arr, i, n, pred) { for (let k = 0; k < SUSTAIN; k++) if (i + k >= n || !pred(arr[i + k])) return false; return true; }

/** Braking point, apex, throttle point, entry/exit speed of one lap inside a corner window (distances on that lap). */
export function cornerMetrics(s, w) {
  const i0 = Math.max(0, lowerBound(s.d, w.start, s.n)), i1 = Math.min(s.n - 1, lowerBound(s.d, w.end, s.n));
  if (i1 <= i0 + 2) return null;
  let apexI = i0; for (let i = i0; i <= i1; i++) if (s.v[i] < s.v[apexI]) apexI = i;
  let brakeI = -1; for (let i = i0; i <= apexI; i++) if (sustained(s.gLon, i, s.n, (g) => g < BRAKE_G)) { brakeI = i; break; }
  let gasI = -1; for (let i = apexI; i <= i1; i++) if (sustained(s.gLon, i, s.n, (g) => g > GAS_G)) { gasI = i; break; }
  let gLatMax = 0; for (let i = i0; i <= i1; i++) gLatMax = Math.max(gLatMax, Math.abs(s.gLat[i] || 0));
  return {
    dBrake: brakeI >= 0 ? s.d[brakeI] : NaN, vEntry: brakeI >= 0 ? s.v[brakeI] : s.v[i0],
    dApex: s.d[apexI], vApex: s.v[apexI], apexI,
    dGas: gasI >= 0 ? s.d[gasI] : NaN, vExit: s.v[i1], gLatMax,
    apexLat: s.lat[apexI], apexLng: s.lng[apexI], turnLeft: (s.gLat[apexI] || 0) > 0,
  };
}

/** Lateral offset (m) of the compared lap's apex from the reference line; positive = wider (outside), negative = tighter. */
function lineOffset(ref, refM, cmpM) {
  if (!Number.isFinite(cmpM.apexLat) || !(Math.abs(cmpM.apexLat) > 0.0001)) return NaN;
  const s = ref.samples, i = refM.apexI, lat0 = s.lat[i];
  const p = toXY(cmpM.apexLat, cmpM.apexLng, lat0);
  let best = Infinity, bi = i;
  for (let k = Math.max(1, i - 40); k < Math.min(s.n - 1, i + 40); k++) {
    const q = toXY(s.lat[k], s.lng[k], lat0);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best) { best = d; bi = k; }
  }
  const a = toXY(s.lat[bi - 1], s.lng[bi - 1], lat0), b = toXY(s.lat[bi + 1], s.lng[bi + 1], lat0), q = toXY(s.lat[bi], s.lng[bi], lat0);
  const hx = b.x - a.x, hy = b.y - a.y; // heading of the reference
  const cross = hx * (p.y - q.y) - hy * (p.x - q.x); // > 0: compared lap is to the left of the reference
  const left = cross > 0;
  const inside = refM.turnLeft ? left : !left;
  return inside ? -best : best;
}

/** Full comparison of a slower lap against the reference (fastest) lap. */
export function coachCompare(ref, cmp) {
  const corners = detectCorners(ref);
  const slip = timeSlipSeries(cmp.samples, ref.samples, 5);
  const at = (d) => interpAt(slip.x, slip.y, d, slip.n);
  const out = [];
  for (const w of corners) {
    const rm = cornerMetrics(ref.samples, w), cm = cornerMetrics(cmp.samples, w);
    if (!rm || !cm) continue;
    const lost = at(w.end) - at(w.start), lostEntry = at(rm.dApex) - at(w.start), lostExit = at(w.end) - at(rm.dApex);
    const facts = [];
    if (Number.isFinite(rm.dBrake) && Number.isFinite(cm.dBrake)) {
      const dm = cm.dBrake - rm.dBrake; // negative = compared lap brakes earlier
      if (dm <= -T.brakeM) facts.push({ key: 'coach_brake_earlier', m: -dm }); else if (dm >= T.brakeM) facts.push({ key: 'coach_brake_later', m: dm });
    }
    const dv = cm.vApex - rm.vApex;
    if (dv <= -T.apexMs) facts.push({ key: 'coach_apex_slower', v: -dv }); else if (dv >= T.apexMs) facts.push({ key: 'coach_apex_faster', v: dv });
    if (Number.isFinite(rm.dGas) && Number.isFinite(cm.dGas)) {
      const dg = cm.dGas - rm.dGas; // positive = later on the power
      if (dg >= T.gasM) facts.push({ key: 'coach_gas_later', m: dg }); else if (dg <= -T.gasM) facts.push({ key: 'coach_gas_earlier', m: -dg });
    }
    const off = lineOffset(ref, rm, cm);
    if (Number.isFinite(off)) { if (off >= T.lineM) facts.push({ key: 'coach_line_wider', m: off }); else if (off <= -T.lineM) facts.push({ key: 'coach_line_tighter', m: -off }); }
    const dvx = cm.vExit - rm.vExit;
    if (dvx <= -T.exitMs && !facts.some((f) => f.key === 'coach_apex_slower')) facts.push({ key: 'coach_exit_slower', v: -dvx });
    // no measurable cause but time lost: at least say whether it happens on the way in or on the way out
    if (!facts.length && Number.isFinite(lost) && lost >= T.lostS && Number.isFinite(lostEntry) && Number.isFinite(lostExit)) {
      if (lostEntry >= 0.7 * lost) facts.push({ key: 'coach_lost_entry' }); else if (lostExit >= 0.7 * lost) facts.push({ key: 'coach_lost_exit' });
    }
    out.push({ ...w, lost: Number.isFinite(lost) ? lost : 0, lostEntry, lostExit, facts, ref: rm, cmp: cm });
  }
  const total = out.length ? at(Math.min(cmp.samples.d[cmp.samples.n - 1], ref.samples.d[ref.samples.n - 1])) : NaN;
  const patterns = [];
  const count = (k) => out.filter((c) => c.facts.some((f) => f.key === k)).length;
  const need = Math.max(3, Math.ceil(out.length / 2));
  for (const [k, pk] of [['coach_brake_earlier', 'coach_pattern_brake'], ['coach_apex_slower', 'coach_pattern_apex'], ['coach_gas_later', 'coach_pattern_gas'], ['coach_line_wider', 'coach_pattern_line']]) {
    const n = count(k); if (n >= need) patterns.push({ key: pk, n, total: out.length });
  }
  return { corners: out, patterns, total, ranked: [...out].filter((c) => c.lost >= T.lostS).sort((a, b) => b.lost - a.lost) };
}

export function cornerAt(result, d) {
  if (!result) return null;
  return result.corners.find((c) => d >= c.start && d < c.end) || null;
}
