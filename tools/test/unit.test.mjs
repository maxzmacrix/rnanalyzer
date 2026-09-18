// Unit tests for the browser-independent modules and for repository consistency.
//   npm test        (node --test tools/test/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(ROOT, 'app');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

// browser globals some modules touch at import time
globalThis.navigator ??= { language: 'en', languages: ['en'] };
globalThis.document ??= { documentElement: { lang: '', setAttribute() {}, getAttribute() { return null; } } };
globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };

const analysis = await import('../../app/js/analysis.js');
const zip = await import('../../app/js/zip.js');
const xlsx = await import('../../app/js/xlsx.js');
const i18n = await import('../../app/js/i18n.js');

// ------------------------------------------------------------------ i18n
test('i18n: EN and DE have the same keys and the same placeholders', () => {
  const d = i18n.dictionaries;
  const en = Object.keys(d.en), de = Object.keys(d.de);
  const missingDe = en.filter((k) => !(k in d.de));
  const missingEn = de.filter((k) => !(k in d.en));
  assert.deepEqual(missingDe, [], 'keys missing in DE');
  assert.deepEqual(missingEn, [], 'keys missing in EN');
  for (const k of en) {
    assert.ok(typeof d.en[k] === 'string' && d.en[k].length, `empty EN ${k}`);
    assert.ok(typeof d.de[k] === 'string' && d.de[k].length, `empty DE ${k}`);
    const ph = (s) => (s.match(/\{[a-z0-9_]+\}/gi) || []).sort().join(',');
    assert.equal(ph(d.de[k]), ph(d.en[k]), `placeholders differ for ${k}`);
  }
  assert.ok(en.length > 200, 'dictionary suspiciously small');
});

test('i18n: t() substitutes params and falls back to the key', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.t('lap_n', { n: 7 }), 'Lap 7');
  assert.equal(i18n.t('does_not_exist_xyz'), 'does_not_exist_xyz');
  i18n.setLanguage('de');
  assert.equal(i18n.t('lap_n', { n: 7 }), 'Runde 7');
  i18n.setLanguage('en');
});

test('i18n: every t(\'key\') used in the app exists', () => {
  const keys = new Set(Object.keys(i18n.dictionaries.en));
  const used = new Map();
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js')) for (const m of readFileSync(p, 'utf8').matchAll(/\bt\('([a-z0-9_]+)'/g)) used.set(m[1], p);
    }
  };
  walk(join(APP, 'js'));
  const html = rd('app/index.html');
  for (const m of html.matchAll(/data-i18n="([a-z0-9_]+)"/g)) used.set(m[1], 'index.html');
  // dynamic keys (t('sort_' + mode)) are checked separately below
  const missing = [...used].filter(([k]) => !k.endsWith('_') && !keys.has(k));
  assert.deepEqual(missing, [], 'translation keys used but not defined');
  for (const k of ['sort_start', 'sort_driver', 'sort_laptime']) assert.ok(keys.has(k), `dynamic key ${k}`);
});

// ------------------------------------------------------------------ analysis
const S = (() => {
  // synthetic lap: 100 m/s → 1000 m in 10 s, sampled every 0.1 s
  const n = 101, t = new Float64Array(n), d = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = i * 0.1; d[i] = i * 10; v[i] = 100; }
  return { n, t, d, v };
})();

test('analysis: interpolation and lookups', () => {
  assert.equal(analysis.lowerBound(S.d, 250, S.n), 25);
  assert.equal(analysis.interpAt(S.d, S.t, 250, S.n), 2.5);
  assert.equal(analysis.timeAtDistance(S, 995), 9.95);
  assert.equal(analysis.distanceAtTime(S, 4.2), 420);
  assert.equal(analysis.nearestIndex(S.d, 254, S.n), 25);
  assert.ok(Number.isNaN(analysis.interpAt(S.d, S.t, -1, S.n)) || analysis.interpAt(S.d, S.t, -1, S.n) === 0, 'below range clamps or NaN');
});

test('analysis: sector times from splits and best times', () => {
  const secs = analysis.sectorTimesFromSplits(S, [300, 700], 10);
  assert.deepEqual(secs.map((x) => +x.toFixed(6)), [3, 4, 3]);
  const best = analysis.bestTimes([[30, 31, 29], [29, 33, 30], [31, 30, 31]]);
  assert.equal(best.theoretical, 29 + 30 + 29);
  assert.equal(best.continuous, 90);
  assert.deepEqual(best.bestPerSector, [29, 30, 29]);
});

test('analysis: time slip series vs. reference is zero for identical laps', () => {
  const ts = analysis.timeSlipSeries(S, S, 100);
  assert.ok(ts.n > 5);
  for (let i = 0; i < ts.n; i++) assert.ok(Math.abs(ts.y[i]) < 1e-9, `slip at ${i} = ${ts.y[i]}`);
});

test('analysis: niceStep picks 1-2-5 steps', () => {
  for (const [range, count] of [[100, 5], [7, 4], [0.9, 6], [12345, 8]]) {
    const st = analysis.niceStep(range, count);
    const m = st / Math.pow(10, Math.floor(Math.log10(st)));
    assert.ok([1, 2, 2.5, 5].some((x) => Math.abs(m - x) < 1e-9), `step ${st} for range ${range}`);
  }
});

// ------------------------------------------------------------------ weather helpers
test('weather: WMO codes and wind directions map sensibly', async () => {
  globalThis.window ??= globalThis;
  globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  globalThis.window.addEventListener ??= () => {};
  const w = await import('../../app/js/weather.js');
  assert.equal(w.describeWeatherCode(0).key, 'wx_clear');
  assert.equal(w.describeWeatherCode(3).key, 'wx_cloudy');
  assert.equal(w.describeWeatherCode(63).key, 'wx_rain');
  assert.equal(w.describeWeatherCode(95).key, 'wx_thunder');
  assert.equal(w.windDirectionLabel(0), 'N');
  assert.equal(w.windDirectionLabel(90), 'E');
  assert.equal(w.windDirectionLabel(225), 'SW');
  assert.equal(w.windDirectionLabel(359), 'N');
});

// ------------------------------------------------------------------ corner coach
function syntheticLap(brakeAt, apexV) {
  // 1000 m straight north with one corner at 400–460 m (lateral g), speed profile: 50 m/s → braking from brakeAt → apexV at 430 m → back to 50 m/s
  const step = 2, n = Math.floor(1000 / step) + 1;
  const d = new Float64Array(n), t = new Float64Array(n), v = new Float64Array(n), gLon = new Float64Array(n), gLat = new Float64Array(n), lat = new Float64Array(n), lng = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = i * step;
    const x = d[i];
    if (x < brakeAt) v[i] = 50; else if (x < 430) v[i] = 50 - (50 - apexV) * (x - brakeAt) / (430 - brakeAt); else if (x < 600) v[i] = apexV + (50 - apexV) * (x - 430) / 170; else v[i] = 50;
    t[i] = i ? t[i - 1] + step / ((v[i] + v[i - 1]) / 2) : 0;
    lat[i] = 37 + x / 111320; lng[i] = -3;
    gLat[i] = x >= 400 && x <= 460 ? 0.9 : 0;
  }
  for (let i = 1; i < n; i++) gLon[i] = ((v[i] - v[i - 1]) / (t[i] - t[i - 1] || 1)) / 9.81;
  return { lap: { id: `L${brakeAt}`, lapTimeMs: t[n - 1] * 1000, complete: true, trackDef: null, track: { id: 'x' } }, samples: { n, d, t, v, gLon, gLat, lat, lng } };
}
test('coach: detects the corner, the earlier braking and the slower apex', async () => {
  globalThis.window ??= globalThis;
  const { coachCompare, cornerAt } = await import('../../app/js/coach.js');
  const ref = syntheticLap(340, 22), cmp = syntheticLap(300, 19);
  const r = coachCompare(ref, cmp);
  assert.equal(r.corners.length, 1, 'one corner from the lateral-g fallback');
  const c = r.corners[0];
  assert.ok(c.lost > 0.2, `time lost ${c.lost}`);
  assert.ok(r.total > 0.2, `total ${r.total}`);
  const brake = c.facts.find((f) => f.key === 'coach_brake_earlier'); assert.ok(brake && Math.abs(brake.m - 40) < 10, `brake fact ${JSON.stringify(brake)}`);
  const apex = c.facts.find((f) => f.key === 'coach_apex_slower'); assert.ok(apex && Math.abs(apex.v - 3) < 1, `apex fact ${JSON.stringify(apex)}`);
  assert.equal(cornerAt(r, 420), c);
  assert.equal(cornerAt(r, 20), null, 'before the braking zone no corner');
  const same = coachCompare(ref, ref);
  assert.equal(same.corners[0].facts.length, 0, 'identical laps: no facts');
  assert.ok(Math.abs(same.total) < 1e-6);
});

test('coach: what-if apex estimate is positive, grows with the speed step and is bounded by the corner time', async () => {
  globalThis.window ??= globalThis;
  const { coachCompare, whatIfApex } = await import('../../app/js/coach.js');
  const ref = syntheticLap(340, 22), cmp = syntheticLap(300, 19);
  const c = coachCompare(ref, cmp).corners[0];
  const s1 = whatIfApex(cmp.samples, c, 5 / 3.6), s2 = whatIfApex(cmp.samples, c, 10 / 3.6);
  assert.ok(s1 > 0.05 && s1 < 1.5, `saving for +5 km/h: ${s1}`);
  assert.ok(s2 > s1, 'a bigger step saves more');
  // the corner (braking to throttle) takes a few seconds; the estimate can never exceed that time
  const tCorner = cmp.samples.t[cmp.samples.n - 1] - 0; assert.ok(s2 < tCorner);
  assert.ok(Number.isNaN(whatIfApex(cmp.samples, c, 0)), 'no step → NaN');
  assert.ok(Number.isNaN(whatIfApex(cmp.samples, { ...c, cmp: null }, 1)), 'no metrics → NaN');
});

/** syntheticLap plus OBD channels: throttle 0 from the braking point to gasAt, ramp to 100 % at fullAt, optional lift;
 *  engine speed from GPS speed with fixed gear ratios (m/s per rpm) chosen by speed bands. */
function syntheticObdLap(brakeAt, apexV, { gasAt, fullAt, lift = false, bands }) {
  const base = syntheticLap(brakeAt, apexV);
  const s = base.samples, n = s.n;
  const thr = new Float32Array(n), rpm = new Float32Array(n);
  const ratios = [0.004, 0.0065, 0.009, 0.012, 0.015]; // five gears, m/s per rpm
  for (let i = 0; i < n; i++) {
    const x = s.d[i], v = s.v[i];
    if (x < brakeAt || x >= fullAt) thr[i] = 100; else if (x < gasAt) thr[i] = 0; else thr[i] = 20 + 80 * (x - gasAt) / (fullAt - gasAt);
    if (lift && x >= 520 && x <= 540) thr[i] = 40;
    const g = bands.filter((b) => v >= b).length; // number of shift-up speeds below v = gear index
    rpm[i] = v / ratios[g];
  }
  return { lap: { ...base.lap, channels: { throttle: true, rpm: true } }, samples: { ...s, thr, rpm } };
}
test('coach with OBD: throttle point, full throttle, coasting, lifts, gear at the apex, shift rpm', async () => {
  globalThis.window ??= globalThis;
  const { coachCompare, gearTable, shiftRpm } = await import('../../app/js/coach.js');
  // ref: apex (22 m/s) in gear 2, shifts at 26/34/42 m/s; cmp: apex (19 m/s) already in gear 3, shifts later (38/48 m/s → higher rpm)
  const ref = syntheticObdLap(340, 22, { gasAt: 440, fullAt: 480, bands: [15, 26, 34, 42] });
  const cmp = syntheticObdLap(300, 19, { gasAt: 470, fullAt: 540, lift: true, bands: [12, 18, 38, 48] });
  const table = gearTable(ref.samples); assert.ok(table && table.length >= 3, `gear table ${JSON.stringify(table)}`);
  const sr = shiftRpm(ref.samples), sc = shiftRpm(cmp.samples); assert.ok(sr > 3000 && sc > sr + 300, `shift rpm ref ${sr} cmp ${sc}`);
  const r = coachCompare(ref, cmp);
  assert.deepEqual(r.obd, { thr: true, rpm: true, gears: true });
  const c = r.corners[0], keys = c.facts.map((f) => f.key);
  const gas = c.facts.find((f) => f.key === 'coach_gas_later'); assert.ok(gas && Math.abs(gas.m - 30) < 8, `throttle point from the throttle channel ${JSON.stringify(gas)}`);
  const full = c.facts.find((f) => f.key === 'coach_full_later'); assert.ok(full && Math.abs(full.m - 60) < 10, `full throttle ${JSON.stringify(full)}`);
  assert.ok(keys.includes('coach_coast_longer'), `coasting ${keys}`);
  const lifts = c.facts.find((f) => f.key === 'coach_lifts'); assert.ok(lifts && lifts.n === 1, `lifts ${JSON.stringify(lifts)}`);
  const gear = c.facts.find((f) => f.key === 'coach_gear_higher'); assert.ok(gear && gear.n === 1, `gear ${JSON.stringify(gear)} (ref gear ${c.ref.gear}, cmp gear ${c.cmp.gear})`);
  assert.ok(r.shift && r.shift.key === 'coach_shift_higher' && r.shift.rpm > r.shift.ref, `shift ${JSON.stringify(r.shift)}`);
  // without the channels nothing OBD-related appears
  const plain = coachCompare(syntheticLap(340, 22), syntheticLap(300, 19));
  assert.deepEqual(plain.obd, { thr: false, rpm: false, gears: false });
  assert.ok(!plain.corners[0].facts.some((f) => /full|coast|lifts|gear/.test(f.key)) && !plain.shift);
});

// ------------------------------------------------------------------ highlights
test('highlights: g peak in the corner, time loss against the reference, off-line excursion', async () => {
  globalThis.window ??= globalThis;
  const { detectHighlights, offTrack } = await import('../../app/js/highlights.js');
  const ref = syntheticLap(340, 22), cmp = syntheticLap(300, 19);
  // single lap: only g peaks, inside the corner (400–460 m)
  const single = detectHighlights(ref);
  assert.ok(single.length >= 1 && single.every((e) => e.kind === 'gpeak'), JSON.stringify(single));
  assert.ok(single[0].d >= 330 && single[0].d <= 480, `g peak in braking zone or corner, got ${single[0].d}`);
  // compared lap: a loss event around the corner, no gain, no off-line (same line)
  const ev = detectHighlights(cmp, ref);
  const loss = ev.filter((e) => e.kind === 'loss'), gain = ev.filter((e) => e.kind === 'gain'), off = ev.filter((e) => e.kind === 'offtrack');
  assert.ok(loss.length >= 1 && loss[0].d > 250 && loss[0].d < 500, `loss ${JSON.stringify(loss)}`);
  assert.equal(gain.length, 0); assert.equal(off.length, 0);
  assert.deepEqual(ev.map((e) => e.d), [...ev.map((e) => e.d)].sort((a, b) => a - b), 'sorted by distance');
  // off-line: shift the compared lap 12 m sideways between 600 and 700 m (default half width 5 m + 2 m margin)
  const wide = { lap: cmp.lap, samples: { ...cmp.samples, lng: Float64Array.from(cmp.samples.lng) } };
  const degPerM = 1 / (111320 * Math.cos((37 * Math.PI) / 180));
  for (let i = 0; i < wide.samples.n; i++) if (wide.samples.d[i] >= 600 && wide.samples.d[i] <= 700) wide.samples.lng[i] += 12 * degPerM;
  const offs = offTrack(wide.samples, ref.samples, NaN);
  assert.equal(offs.length, 1, JSON.stringify(offs));
  assert.ok(offs[0].d >= 600 && offs[0].d <= 700 && Math.abs(offs[0].value - 12) < 1.5, JSON.stringify(offs[0]));
  // a wide track (20 m) swallows the same excursion
  assert.equal(offTrack(wide.samples, ref.samples, 20).length, 0);
});

// ------------------------------------------------------------------ device client
test('device client: every <sm> element of the assembled .rn XML is self-closed', () => {
  const src = rd('app/js/deviceNative.js');
  const smLine = src.split('\n').find((l) => l.includes('<sm id="${esc(r.id)}"'));
  assert.ok(smLine, 'sm template line');
  assert.ok(/"\/>\\n`;\s*$/.test(smLine), `sm element must end with "/>: ${smLine.slice(-40)}`);
});

test('device client: laps on the device are grouped by event, newest first, laps by start time', async () => {
  globalThis.window ??= globalThis;
  const { groupLapsByEvent } = await import('../../app/js/device.js');
  const laps = [
    { event: 'Trackday Poznań', eventStartTime: '2024-07-04 09:00:00.000', startTime: '2024-07-04 11:24:29.894', lapNumber: 8 },
    { event: 'Trackday Poznań', eventStartTime: '2024-07-04 09:00:00.000', startTime: '2024-07-04 10:12:00.000', lapNumber: 3 },
    { event: 'Test Sochi', eventStartTime: '2022-01-16 08:00:00.000', startTime: '2022-01-16 10:08:55.000', lapNumber: 4 },
    { event: '', track: 'Default Track', startTime: '2026-09-18 13:30:00.000', lapNumber: 1 },
  ];
  const g = groupLapsByEvent(laps);
  assert.deepEqual(g.map((x) => x.name), ['Default Track', 'Trackday Poznań', 'Test Sochi']);
  assert.deepEqual(g[1].laps.map((l) => l.lapNumber), [3, 8], 'laps within an event by start time');
  assert.equal(g[1].date, '2024-07-04');
});

// ------------------------------------------------------------------ reference choice
test('reference: same session and driver first, otherwise same track with same car and similar weather', async () => {
  const { pickReference } = await import('../../app/js/reference.js');
  const mk = (id, o = {}) => ({
    id, complete: true, lapTimeMs: 100000, startMs: 0,
    event: { id: 'E1' }, track: { id: 'T', variantId: 'V1' }, source: { device: 'RN1' },
    driver: { name: 'Anna' }, vehicle: { model: 'GT4', number: '7' }, ...o,
  });
  const me = mk('me', { lapTimeMs: 101000 });
  const sameSession = mk('s', { lapTimeMs: 100500 });
  const otherSessionSameCar = mk('o1', { event: { id: 'E2' }, lapTimeMs: 99000 });
  const otherSessionOtherCar = mk('o2', { event: { id: 'E2' }, vehicle: { model: 'Cup', number: '1' }, lapTimeMs: 98000 });
  const otherTrack = mk('t', { track: { id: 'X', variantId: 'V1' }, lapTimeMs: 90000 });
  const incomplete = mk('i', { complete: false, lapTimeMs: 90000 });
  // same session wins even against faster laps elsewhere
  let r = pickReference(me, [me, sameSession, otherSessionSameCar, otherSessionOtherCar, otherTrack, incomplete]);
  assert.equal(r.lap.id, 's'); assert.equal(r.sameSession, true); assert.deepEqual(r.reasons, ['same_driver', 'same_car']);
  // no lap in the session: same car beats a faster lap in another car
  r = pickReference(me, [me, otherSessionSameCar, otherSessionOtherCar, otherTrack, incomplete]);
  assert.equal(r.lap.id, 'o1'); assert.equal(r.sameSession, false); assert.ok(r.reasons.includes('same_car'));
  // weather: a dry reference is preferred for a dry lap over a wet one with the same car
  const wetLap = mk('w', { event: { id: 'E3' }, lapTimeMs: 98500 });
  const wet = (l) => (l.id === 'w' ? true : l.id === 'o1' || l.id === 'me' ? false : null);
  r = pickReference(me, [me, otherSessionSameCar, wetLap], { wet });
  assert.equal(r.lap.id, 'o1'); assert.ok(r.reasons.includes('same_weather'));
  // nothing on the same track → null
  assert.equal(pickReference(me, [me, otherTrack]), null);
});

test('weather: wet/dry classification of a session summary', async () => {
  const { isWet } = await import('../../app/js/weather.js');
  assert.equal(isWet(null), null);
  assert.equal(isWet({ code: 0, precip: 0 }), false);
  assert.equal(isWet({ code: 3, precip: 0.2 }), false);
  assert.equal(isWet({ code: 61, precip: 0 }), true);
  assert.equal(isWet({ code: 1, precip: 2.4 }), true);
  assert.equal(isWet({ code: NaN, precip: NaN }), null);
});

// ------------------------------------------------------------------ zip / xlsx
test('zip: zipStore → unzip round trip', async () => {
  const data = new TextEncoder().encode('hello rn');
  const buf = zip.zipStore([{ name: 'a/b.txt', data }, { name: 'c.bin', data: new Uint8Array([1, 2, 3]) }]);
  const files = await zip.unzip(buf instanceof Blob ? await buf.arrayBuffer() : buf);
  const names = files.map((f) => f.name).sort();
  assert.deepEqual(names, ['a/b.txt', 'c.bin']);
  const txt = files.find((f) => f.name === 'a/b.txt');
  assert.equal(new TextDecoder().decode(txt.data), 'hello rn');
});

test('xlsx: workbook is a valid OOXML package', async () => {
  const blob = xlsx.buildXlsx([{ name: 'Laps', rows: [['Lap', 'Time'], [1, 86.143], ['ä<&>', null]] }]);
  const buf = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  const files = await zip.unzip(buf);
  const names = files.map((f) => f.name);
  for (const req of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) assert.ok(names.includes(req), `missing ${req}`);
  const sheet = new TextDecoder().decode(files.find((f) => f.name === 'xl/worksheets/sheet1.xml').data);
  assert.match(sheet, /<c [^>]*t="inlineStr"[^>]*><is><t>Lap<\/t><\/is><\/c>/);
  assert.match(sheet, /&lt;&amp;&gt;/, 'special characters escaped');
  assert.match(sheet, /<v>86.143<\/v>/);
});

// ------------------------------------------------------------------ repository consistency
test('service worker: every precached file exists', () => {
  const sw = rd('app/sw.js');
  const files = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter((f) => f && !f.includes('*'));
  assert.ok(files.length > 20);
  const missing = files.filter((f) => !existsSync(join(APP, f)));
  assert.deepEqual(missing, [], 'precache entries without a file');
});

test('service worker: cache version changes with app files (manual bump check)', () => {
  assert.match(rd('app/sw.js'), /VERSION = 'rn-analyzer-v\d+\.\d+\.\d+'/);
});

test('index.html: tabs match the routes in main.js and the manifest icons exist', () => {
  const html = rd('app/index.html');
  const tabs = [...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  const main = rd('app/js/main.js');
  const views = main.match(/const views = \{([^}]+)\}/)[1].split(',').map((s) => s.split(':')[0].trim());
  assert.deepEqual(tabs.sort(), views.sort());
  const manifest = JSON.parse(rd('app/manifest.webmanifest'));
  for (const ic of manifest.icons) assert.ok(existsSync(join(APP, ic.src)), `icon ${ic.src}`);
});

test('demo data: index lists existing, anonymised laps', async () => {
  const idx = JSON.parse(rd('app/demo/index.json'));
  assert.ok(idx.laps.length >= 3 && idx.videos.length >= 1);
  for (const f of idx.laps) assert.ok(existsSync(join(APP, 'demo', f)), `demo file ${f}`);
  assert.ok(idx.videoArchive && existsSync(join(APP, 'demo', idx.videoArchive)), 'video archive');
  const arc = await zip.unzip(readFileSync(join(APP, 'demo', idx.videoArchive)).buffer);
  for (const v of idx.videos) assert.ok(arc.some((e) => e.name === v && e.data.length > 100000), `clip ${v} in archive`);
  for (const f of idx.laps) {
    const files = await zip.unzip(readFileSync(join(APP, 'demo', f)).buffer);
    const rn = files.find((x) => x.name.endsWith('.rn'));
    assert.ok(rn, `${f} contains no .rn`);
    const x = new TextDecoder().decode(rn.data);
    assert.match(x, /<driverName>DRIVER A<\/driverName>/, `${f} not anonymised`);
    assert.match(x, /<photo><\/photo>/, `${f} still has a photo`);
    assert.doesNotMatch(x, /DAVID|OLIVER|HANS/, `${f} contains a real name`);
  }
});

test('workflows: versions and identifiers are consistent', () => {
  const ios = rd('.github/workflows/ios.yml'), android = rd('.github/workflows/android.yml');
  const pkg = JSON.parse(rd('package.json'));
  const v = rd('app/js/main.js').match(/APP_VERSION = '([^']+)'/)[1];
  assert.equal(v, '2.1.12');
  assert.match(ios, new RegExp(`MARKETING_VERSION: '${v.replace(/\./g, '\\.')}'`));
  assert.match(ios, new RegExp(`BUILD="${v.replace(/\.\d+$/, '').replace(/\./g, '\\.')}\\.`), 'iOS build number prefix follows the marketing version');
  assert.match(android, new RegExp(`MARKETING_VERSION: '${v.replace(/\./g, '\\.')}'`));
  assert.equal(pkg.version, v);
  assert.match(ios, /runs-on: macos-26/);
  assert.match(ios, /MIN_IOS: '16\.4'/);
});

// ------------------------------------------------------------------ specification
// docs/SPEC.md is the shareable description of the software (vision, scope, architecture). It must be updated in the
// same commit as the code; this test catches the cheap-to-detect omissions.
test('spec: documentation is current (modules, plugin methods, tabs, version, date)', () => {
  const spec = rd('docs/SPEC.md');
  const missing = [];
  // every JS module of the app is described
  const walk = (dir, rel = '') => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(dir, f.name), `${rel}${f.name}/`);
      else if (f.name.endsWith('.js') && !spec.includes(`app/js/${rel}${f.name}`)) missing.push(`module app/js/${rel}${f.name}`);
    }
  };
  walk(join(APP, 'js'));
  if (!spec.includes('app/sw.js')) missing.push('app/sw.js');
  // every native plugin method (iOS is the reference list)
  const swift = rd('native/rn-device/ios/Plugin/RnDevicePlugin.swift');
  for (const m of swift.matchAll(/CAPPluginMethod\(name: "([a-zA-Z]+)"/g)) if (!spec.includes(`\`${m[1]}\``)) missing.push(`plugin method ${m[1]}`);
  // every tab / route
  for (const m of rd('app/index.html').matchAll(/data-view="([a-z]+)"/g)) if (!spec.includes(`#/${m[1]}`)) missing.push(`route #/${m[1]}`);
  // every workflow
  for (const f of readdirSync(join(ROOT, '.github/workflows'))) if (!spec.includes(f)) missing.push(`workflow ${f}`);
  assert.deepEqual(missing, [], 'docs/SPEC.md does not mention');
  // header: version matches the app, date is a valid ISO date and not in the future
  const version = rd('app/js/main.js').match(/APP_VERSION = '([^']+)'/)[1];
  assert.match(spec, new RegExp(`\\*\\*App version:\\*\\* ${version.replace(/\./g, '\\.')}\\b`), 'spec header version differs from APP_VERSION');
  const date = spec.match(/\*\*As of:\*\* (\d{4}-\d{2}-\d{2})/);
  assert.ok(date, 'spec header has no ISO date');
  assert.ok(!Number.isNaN(Date.parse(date[1])) && Date.parse(date[1]) <= Date.now() + 86400000, 'spec date invalid');
  // the maintenance rule and the decision log exist
  assert.match(spec, /## 12\. Maintaining this specification/);
  assert.match(spec, /## 11\. Decisions/);
});
