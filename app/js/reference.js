// Context-aware reference choice: which lap is the most useful comparison partner for a given lap?
// Pure data module – no DOM, no i18n. The caller supplies the candidate laps and, optionally, a function that says
// whether a lap's session was wet (true), dry (false) or unknown (null) so that similar conditions are preferred.
//
//   const { lap, reasons, sameSession } = pickReference(lap, laps, { wet })   // or null when nothing fits
//   reasons: subset of ['same_driver', 'same_car', 'same_weather'] – for the hint in the UI

const vehicleKey = (l) => `${(l.vehicleOverride || l.vehicle.model || '').trim().toLowerCase()}|${l.vehicleNumberOverride || l.vehicle.number || ''}`;
const driverKey = (l) => (l.driverOverride || l.driver.name || '').trim().toLowerCase();
export const sessionKey = (l) => `${l.event.id}|${l.track.id}|${l.source.device}`;

/**
 * @param {object} lap        the lap to compare
 * @param {object[]} laps     all laps known to the app
 * @param {{wet?: (lap: object) => (boolean|null)}} [ctx]
 */
export function pickReference(lap, laps, ctx = {}) {
  if (!lap || !lap.track) return null;
  const wetOf = typeof ctx.wet === 'function' ? ctx.wet : () => null;
  const myWet = wetOf(lap);
  const session = sessionKey(lap), drv = driverKey(lap), car = vehicleKey(lap);
  let best = null;
  for (const o of laps) {
    if (o.id === lap.id || !o.complete || !(o.lapTimeMs > 0) || o.track.id !== lap.track.id) continue;
    const reasons = [];
    let score = 0;
    const sameSession = sessionKey(o) === session;
    if (sameSession) score += 8;
    if (drv && driverKey(o) === drv) { score += 4; reasons.push('same_driver'); }
    if (car !== '|' && vehicleKey(o) === car) { score += 3; reasons.push('same_car'); }
    const oWet = wetOf(o);
    if (myWet !== null && oWet !== null) { if (oWet === myWet) { score += 2; reasons.push('same_weather'); } else score -= 4; }
    if (o.track.variantId && o.track.variantId === lap.track.variantId) score += 1;
    if (o.lapTimeMs < lap.lapTimeMs) score += 1; // a faster lap is the natural reference
    const cand = { lap: o, score, reasons, sameSession };
    if (!best || score > best.score || (score === best.score && o.lapTimeMs < best.lap.lapTimeMs)) best = cand;
  }
  return best;
}
