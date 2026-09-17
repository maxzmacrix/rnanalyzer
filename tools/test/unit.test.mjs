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
  for (const f of [...idx.laps, ...idx.videos]) assert.ok(existsSync(join(APP, 'demo', f)), `demo file ${f}`);
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
  assert.match(ios, /MARKETING_VERSION: '2\.0\.0'/);
  assert.match(android, /MARKETING_VERSION: '2\.0\.0'/);
  assert.equal(pkg.version, '2.0.0');
  assert.match(rd('app/js/main.js'), /APP_VERSION = '2\.0\.0'/);
  assert.match(ios, /runs-on: macos-26/);
  assert.match(ios, /MIN_IOS: '16\.4'/);
});
