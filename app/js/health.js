// Heart rate from Apple Health (native iOS app): read HealthKit samples for the lap window, resample onto the lap's
// time base and store them as channel `hr` next to speed/g-force. Android Health Connect follows later.

import { ensureSamples, reloadLaps } from './state.js';
import { db } from './db.js';
import { isNative } from './deviceNative.js';

export function healthAvailable() { return isNative() && /iPhone|iPad|iPod/.test(navigator.userAgent); }
function plugin() { const C = window.Capacitor; return (C.Plugins && C.Plugins.RnDevice) || C.registerPlugin('RnDevice'); }

/** Loads heart rate for one lap. Returns the number of HealthKit samples used (0 = none in that time window). */
export async function loadHeartRate(lap) {
  const s = await ensureSamples(lap.id);
  if (!s) throw new Error('no samples');
  const end = Number.isFinite(lap.endMs) ? lap.endMs : lap.startMs + (lap.lapTimeMs || 0);
  const res = await plugin().healthHeartRate({ from: lap.startMs - 90000, to: end + 90000 });
  const pts = (res.samples || []).map((p) => ({ t: (Number(p.t) - lap.startMs) / 1000, v: Number(p.bpm) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 20 && p.v < 260).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return 0;
  const out = new Float32Array(s.n);
  let j = 0;
  for (let i = 0; i < s.n; i++) {
    const tt = s.t[i];
    while (j < pts.length - 2 && pts[j + 1].t <= tt) j++;
    if (tt <= pts[0].t) out[i] = pts[0].v;
    else if (tt >= pts[pts.length - 1].t) out[i] = pts[pts.length - 1].v;
    else { const f = (tt - pts[j].t) / ((pts[j + 1].t - pts[j].t) || 1); out[i] = pts[j].v + (pts[j + 1].v - pts[j].v) * f; }
  }
  s.hr = out;
  await db.putSamples(lap.id, s);
  lap.channels = { ...(lap.channels || {}), hr: true, hrSamples: pts.length };
  await db.updateLap(lap);
  await reloadLaps();
  return pts.length;
}
