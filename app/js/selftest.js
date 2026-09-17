// In-app self-test: drives the live app through every view, button and dialog and checks the results.
// Open the web app with ?selftest (e.g. http://localhost:8080/?nosw&selftest). Results appear in a panel,
// in the console and in window.__selftest. Uses the demo laps (app/demo) as data.

import { state, clearSelection, setSelection, reloadLaps, updateSettings } from './state.js';
import { t } from './i18n.js';
import { db } from './db.js';
import { player } from './sync.js';
import { buildXlsx } from './xlsx.js';
import { parseRnzBuffer } from './rnparser.js';
import { confirmDialog, promptDialog } from './ui.js';
import { loadDemoData, removeDemoData, startTour, stopTour } from './tour.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const byText = (sel, text, root = document) => $$(sel, root).find((e) => e.textContent.trim() === text);
const byTextIncl = (sel, text, root = document) => $$(sel, root).find((e) => e.textContent.includes(text));
async function waitFor(fn, timeout = 5000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { const v = fn(); if (v) return v; } catch { /* retry */ } await wait(60); }
  throw new Error(`timeout waiting for ${label || fn.toString().slice(0, 80)}`);
}
async function go(hash, settle = 600) { if (location.hash !== hash) location.hash = hash; await wait(settle); }
function click(el, what = 'element') { if (!el) throw new Error(`${what} not found`); el.click(); }
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg = 'values differ') { if (a !== b) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
const sheet = () => $('#overlay .sheet');
async function closeSheet() { const b = $('#overlay .sheet-backdrop'); if (b) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(200); } }
async function answerConfirm(yes) { const s = await waitFor(sheet, 3000, 'confirm sheet'); const btns = $$('button.btn', s); click(yes ? btns[btns.length - 1] : btns[0], 'confirm button'); await wait(300); }

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String((e.reason && e.reason.message) || e.reason)));

const results = [];
let panel;
async function step(name, fn) {
  const t0 = performance.now();
  try { await fn(); results.push({ name, ok: true, ms: Math.round(performance.now() - t0) }); }
  catch (e) { results.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: String((e && e.message) || e) }); console.error('[selftest] FAIL', name, e); }
  render();
  await closeSheet(); // never leave a dialog open between steps
}
function render() {
  if (!panel) { panel = document.createElement('div'); panel.id = 'selftest-panel'; panel.style.cssText = 'position:fixed;right:8px;bottom:70px;z-index:200;max-width:360px;max-height:45vh;overflow:auto;background:rgba(20,22,27,.96);color:#fff;font:12px/1.4 monospace;padding:8px 10px;border-radius:10px;pointer-events:none;'; document.body.appendChild(panel); }
  const fails = results.filter((r) => !r.ok);
  panel.innerHTML = `<b>selftest ${results.filter((r) => r.ok).length}/${results.length} ok</b>` + fails.map((f) => `<div style="color:#ff8a80">✗ ${f.name}: ${f.error}</div>`).join('') + (running ? '<div>…</div>' : '<div style="color:#8f8">done</div>');
}
let running = true;

// ------------------------------------------------------------------ the suite
export async function run() {
  await wait(300);
  const demoLaps = () => state.laps.filter((l) => l.demo);

  await step('routes mount without errors', async () => {
    for (const r of ['#/laps', '#/analyze/charts', '#/analyze/gforce', '#/analyze/video', '#/device', '#/settings']) {
      const n0 = errors.length; await go(r, 500);
      assert($('#main').children.length > 0, `${r} rendered nothing`);
      assert(errors.length === n0, `${r} raised ${errors.slice(n0).join('; ')}`);
      assert($(`#tabbar a.active`) && r.startsWith(`#/${$('#tabbar a.active').dataset.view}`), `${r}: tab not active`);
    }
  });

  await step('old routes redirect', async () => {
    for (const [from, to] of [['#/analyzer', '#/analyze'], ['#/gforce', '#/analyze/gforce'], ['#/video', '#/analyze/video'], ['#/devices', '#/device'], ['#/control', '#/device']]) {
      await go(from, 400); eq(location.hash, to, `${from} redirect`);
    }
  });

  await step('demo data import (3 laps, 2 videos)', async () => {
    await loadDemoData(() => {});
    assert(demoLaps().length >= 3, `demo laps: ${demoLaps().length}`);
    const vids = [...state.videoNames].filter((n) => /^demo-/.test(n));
    eq(vids.length, 2, 'demo videos');
  });

  await step('parser: demo .rnz → samples, sectors, lap time', async () => {
    const buf = await (await fetch('./demo/demo-lap6.rnz')).arrayBuffer();
    const r = await parseRnzBuffer(buf, 'demo-lap6.rnz');
    const lap = r.lap || r, s = r.samples || lap.samples;
    assert(lap.lapTimeMs > 60000 && lap.lapTimeMs < 120000, `lap time ${lap.lapTimeMs}`);
    eq((lap.sectors || []).length, 3, 'device sectors');
    assert(s && s.n > 500, `samples n=${s && s.n}`);
    assert(s.d[s.n - 1] > 2000, `lap length ${s.d && s.d[s.n - 1]}`);
    eq(lap.driver.name, 'DRIVER A', 'anonymised driver');
  });

  await step('lap list: rows, session stats, sector cells, best sector', async () => {
    await go('#/laps'); await clearSelection(); await wait(300);
    assert($$('.lap-row').length >= 3, 'rows');
    assert($('.event-head .stats'), 'session stats');
    assert($$('.lap-row .sec').length >= 9, 'sector cells');
    assert($$('.lap-row .sec.best').length >= 1, 'best sector highlight');
    assert(byText('.badge', t('demo_badge')), 'demo badge');
  });

  await step('lap list: filter chips toggle and restore', async () => {
    const n = $$('.lap-row').length;
    for (const key of ['filter_complete', 'filter_outliers', 'filter_video']) {
      const chip = byText('.filter-bar .chip', t(key)); click(chip, key); await wait(150);
      assert(byText('.filter-bar .chip', t(key)).classList.contains('on'), `${key} on`);
      click(byText('.filter-bar .chip', t(key))); await wait(150);
    }
    eq($$('.lap-row').length, n, 'row count restored');
  });

  await step('lap list: sort by lap time and by sector', async () => {
    click(byText('.filter-bar .chip', t('sort_time')), 'sort_time'); await wait(200);
    const times = $$('.lap-row .time').map((e) => e.textContent);
    const sorted = [...times].sort(); eq(JSON.stringify(times.slice(0, demoLaps().length)), JSON.stringify(sorted.slice(0, demoLaps().length)), 'ascending by time');
    click(byText('.filter-bar .chip', 'S2'), 'S2'); await wait(200);
    const s2 = $$('.lap-row').map((r) => $$('.sec', r)[1]).filter(Boolean).map((e) => parseFloat(e.textContent.replace(/^S2/, '')));
    for (let i = 1; i < s2.length; i++) assert(s2[i] >= s2[i - 1], 'ascending by S2');
    click(byText('.filter-bar .chip', t('sort_session')), 'sort_session'); await wait(150);
  });

  await step('lap list: search narrows the list', async () => {
    const inp = $('.laps-toolbar input'); inp.value = 'L62'; inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(200);
    eq($$('.lap-row').length, 1, 'search L62');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(200);
    assert($$('.lap-row').length >= 3, 'search cleared');
  });

  await step('suggest comparison selects laps; deselect all clears', async () => {
    click($('.event-head .suggest'), 'suggest button'); await wait(500);
    assert(state.selected.length >= 2, `selected ${state.selected.length}`);
    assert($$('.lap-row.selected .selmark').length === state.selected.length, 'selection marks');
    click(byText('.sel-summary button', t('deselect_all')), 'deselect all'); await wait(300);
    eq(state.selected.length, 0, 'cleared');
  });

  await step('row tap selects, colours applied', async () => {
    for (const row of $$('.lap-row').slice(0, 3)) { row.click(); await wait(150); }
    eq(state.selected.length, 3, 'three selected');
    const row = $('.lap-row.selected');
    assert(row.style.getPropertyValue('--lap-color'), 'lap colour variable');
    assert(getComputedStyle($('.bar', row)).backgroundColor !== 'rgba(0, 0, 0, 0)', 'colour bar visible');
  });

  await step('lap menu opens and closes', async () => {
    click($('.lap-row .more'), 'more button'); const s = await waitFor(sheet, 2000, 'lap menu');
    assert($$('.item', s).length >= 4, 'menu items');
    await closeSheet(); assert(!sheet(), 'closed');
  });

  await step('edit lap: prompt saves the note', async () => {
    const lap = demoLaps()[0];
    const row = $$('.lap-row').find((r) => r.textContent.includes(t('lap_n', { n: lap.lapNumber })));
    click($('.more', row), 'more'); const s = await waitFor(sheet, 2000, 'menu');
    click(byTextIncl('.item', t('edit_lap'), s), 'edit item');
    const p = await waitFor(() => sheet() && $('textarea.input', sheet()) && sheet(), 3000, 'prompt');
    $('textarea.input', p).value = 'selftest note';
    click(byText('button.btn', t('save'), p), 'save'); await wait(600);
    eq(state.lapsById.get(lap.id).note, 'selftest note', 'note saved');
    assert($$('.lap-row .l2').some((e) => e.textContent.includes('selftest note')), 'note shown');
  });

  await step('confirm dialog: cancel → false, ok → true', async () => {
    let p = confirmDialog('selftest?'); await wait(100); await answerConfirm(false); eq(await p, false, 'cancel');
    p = confirmDialog('selftest?', { danger: true, okLabel: 'Yes' }); await wait(100); await answerConfirm(true); eq(await p, true, 'ok');
    p = promptDialog('selftest', [{ key: 'a', label: 'A', value: 'x' }]); await wait(100);
    const s = await waitFor(sheet); $('input.input', s).value = 'changed'; click(byText('button.btn', t('save'), s)); const r = await p; eq(r && r.a, 'changed', 'prompt value');
  });

  await step('analyzer: play/pause moves the cursor', async () => {
    await go('#/analyze/charts', 900);
    await waitFor(() => $('.play-bar'), 3000, 'play bar');
    const playBtn = $('.play-bar .tbtn.primary'); click(playBtn, 'play');
    await wait(900); assert(player.playing, 'playing'); assert(state.cursor > 0, `cursor moved ${state.cursor}`);
    click(playBtn); await wait(200); assert(!player.playing, 'paused');
  });

  await step('analyzer: speed chip cycles, x-mode toggles', async () => {
    const chip = $('.play-bar .chip'); const before = chip.textContent; click(chip); await wait(200); assert(chip.textContent !== before, 'speed changed');
    while ($('.play-bar .chip').textContent !== '1×') { click($('.play-bar .chip')); await wait(120); }
    const x0 = state.settings.xMode; click($$('#top-right button')[0], 'x-mode'); await wait(300); assert(state.settings.xMode !== x0, 'x-mode toggled');
    click($$('#top-right button')[0]); await wait(300); eq(state.settings.xMode, x0, 'x-mode restored');
  });

  await step('analyzer: options sheet – panel count, sectors, map style', async () => {
    // changing the panel count re-mounts the analyzer (and closes the sheet) – reopen as needed
    const open = async () => { await closeSheet(); click($$('#top-right button').pop(), 'options'); return waitFor(sheet, 2000, 'options sheet'); };
    const ensure = async () => sheet() || open();
    let s = await open();
    click(byText('.seg button', '3', s), 'panel count 3'); await wait(800); eq($$('.right-col .panel').length, 3, 'three panels');
    s = await open();
    click(byText('.seg button', '2', s), 'panel count 2'); await wait(800); eq($$('.right-col .panel').length, 2, 'two panels');
    s = await open();
    click(byText('.seg button', t('sectors_none'), s), 'sectors none'); await wait(250); eq(state.settings.sectors, 'none', 'sectors none');
    s = await ensure(); click(byText('.seg button', t('sectors_default'), s), 'sectors default'); await wait(250); eq(state.settings.sectors, 'default', 'sectors default');
    s = await ensure(); click(byText('.seg button', t('map_satellite'), s), 'satellite'); await wait(250); eq(state.settings.mapStyle, 'satellite', 'satellite');
    s = await ensure(); click(byText('.seg button', t('map_osm'), s), 'osm'); await wait(250); eq(state.settings.mapStyle, 'osm', 'osm');
    s = await ensure(); const follow = $$('.switch', s)[0]; if (follow) { const v = follow.classList.contains('on'); follow.click(); await wait(200); assert(follow.classList.contains('on') !== v, 'follow switch'); follow.click(); await wait(200); }
    await closeSheet();
  });

  await step('analyzer: component sheet changes the panel', async () => {
    const chip = $('.right-col .panel .panel-title .chip'); const before = chip.textContent;
    click(chip, 'panel title'); const s = await waitFor(sheet, 2000, 'component sheet');
    const items = $$('.item', s).filter((i) => i.textContent.trim() && !i.textContent.includes(before));
    click(items[1] || items[0], 'component item'); await wait(500);
    assert($('.right-col .panel .panel-title .chip').textContent !== before, 'panel title changed');
    click($('.right-col .panel .panel-title .chip')); await waitFor(sheet); click(byTextIncl('.item', before, sheet()) || $$('.item', sheet())[0]); await wait(400);
  });

  await step('analyzer: custom sectors sheet adds a split', async () => {
    click($$('#top-right button').pop(), 'options'); const s = await waitFor(sheet, 2000, 'options');
    click(byTextIncl('.item, button', t('opt_edit_sectors'), s), 'edit sectors'); await wait(500);
    const cs = await waitFor(() => sheet() && sheet().textContent.includes(t('opt_edit_sectors').split(' ')[0]) && sheet(), 3000, 'custom sectors sheet');
    const n0 = $$('.item', cs).length; click($('.btn.accent', cs), 'add split'); await wait(500);
    assert($$('.item', sheet()).length >= n0, 'split list updated');
    await closeSheet(); await updateSettings({ sectors: 'default' });
  });

  await step('excel export builds a workbook', async () => {
    const blob = buildXlsx([{ name: 'Laps', rows: [['a', 1], ['b', 2]] }]);
    const buf = new Uint8Array(await blob.arrayBuffer()); assert(buf.length > 800 && buf[0] === 0x50 && buf[1] === 0x4b, 'zip signature');
  });

  await step('lap picker toggles a lap', async () => {
    click($$('#top-left button')[0], 'laps button'); const s = await waitFor(sheet, 2000, 'picker');
    const n = state.selected.length; click($$('.item', s)[0], 'picker item'); await wait(400);
    assert(state.selected.length !== n, 'selection toggled'); click($$('.item', sheet())[0]); await wait(400); eq(state.selected.length, n, 'toggled back');
    await closeSheet();
  });

  await step('g-force view: canvas and legend', async () => {
    await go('#/analyze/gforce', 900); assert($('#main canvas'), 'canvas'); eq($$('#main .legend span').length, state.selected.length, 'legend entries');
  });

  await step('video view: player, play, rate, mute, choose lap', async () => {
    await go('#/analyze/video', 900); assert($('.player'), 'player view');
    await waitFor(() => $('.player video'), 5000, 'video element');
    click($('.player .rbtn.big'), 'play'); await wait(1500); assert(!$('.player video').paused, 'video playing');
    click($('.player .rbtn.big')); await wait(200); assert($('.player video').paused, 'video paused');
    const lbl = $('.player .pos'); const before = lbl.textContent; click($$('.player .rbtn.small')[1], 'rate +'); await wait(150); assert(lbl.textContent !== before, 'rate changed'); click($$('.player .rbtn.small')[0]); await wait(150);
    const mute = $$('.player .rbtn').find((b) => b.title === t('sound')); const h0 = mute.innerHTML; click(mute); await wait(100); assert(mute.innerHTML !== h0, 'mute toggled'); click(mute);
    click($$('#top-left button')[0], 'choose lap'); const s = await waitFor(sheet, 2000, 'choose lap sheet'); assert($$('.item', s).length >= 1, 'lap items'); await closeSheet();
  });

  await step('race navigator tab (web): notice and import link', async () => {
    await go('#/device', 500); assert($$('#main .card').length >= 2, 'cards');
    click(byText('#main button', t('go_import')), 'go import'); await wait(400); eq(location.hash, '#/laps', 'navigated to laps');
  });

  await step('settings: theme, language, units, switches, autoplay, map style', async () => {
    await go('#/settings', 600);
    click(byText('#main .seg button', t('theme_light')), 'light'); await wait(200); eq(document.documentElement.getAttribute('data-theme'), null, 'light theme');
    click(byText('#main .seg button', t('theme_dark')), 'dark'); await wait(200); eq(document.documentElement.getAttribute('data-theme'), 'dark', 'dark theme');
    click(byText('#main .seg button', 'Deutsch'), 'de'); await wait(500); eq($('#tabbar a[data-view="laps"] span').textContent, 'Runden', 'German tabs');
    click(byText('#main .seg button', 'English'), 'en'); await wait(500); eq($('#tabbar a[data-view="laps"] span').textContent, 'Laps', 'English tabs');
    click(byText('#main .seg button', 'mph'), 'mph'); await wait(200); eq(state.settings.units, 'imperial'); click(byText('#main .seg button', 'km/h')); await wait(200); eq(state.settings.units, 'metric');
    const sw = $$('#main .switch'); for (const s of sw) { const v0 = s.classList.contains('on'); s.click(); await wait(150); assert(s.classList.contains('on') !== v0, 'switch toggled'); s.click(); await wait(150); }
    click(byText('#main .seg button', '2×'), '2x'); await wait(200); eq(Number(state.settings.autoplaySpeed), 2); click(byText('#main .seg button', '1×')); await wait(200); eq(Number(state.settings.autoplaySpeed), 1);
    click(byText('#main .seg button', t('map_satellite'))); await wait(200); eq(state.settings.mapStyle, 'satellite'); click(byText('#main .seg button', t('map_osm'))); await wait(200); eq(state.settings.mapStyle, 'osm');
    assert(!$$('#main .sub').some((e) => e.textContent === '…'), 'storage info loaded');
  });

  await step('tour starts and can be closed', async () => {
    await startTour(); await waitFor(() => $('.tour-root .tour-text') && $('.tour-text').textContent.length > 10, 12000, 'tour text');
    stopTour(); await wait(200); assert(!$('.tour-root'), 'tour closed');
  });

  await step('delete video of a lap (menu → confirm)', async () => {
    await go('#/laps', 600); await clearSelection(); await wait(200);
    const lap = demoLaps().find((l) => l.video && [...state.videoNames].includes(l.video.fileName));
    assert(lap, 'a demo lap with video');
    const row = $$('.lap-row').find((r) => r.textContent.includes(t('lap_n', { n: lap.lapNumber })));
    click($('.more', row), 'more'); const s = await waitFor(sheet, 2000, 'menu');
    click(byTextIncl('.item', t('delete_video'), s), 'delete video'); await answerConfirm(true); await wait(500);
    assert(![...state.videoNames].includes(lap.video.fileName), 'video removed');
  });

  await step('delete a lap (menu → confirm)', async () => {
    const n = state.laps.length; const row = $('.lap-row');
    click($('.more', row), 'more'); const s = await waitFor(sheet, 2000, 'menu');
    click(byTextIncl('.item.danger, .item', t('delete'), s), 'delete lap'); await answerConfirm(true); await wait(600);
    eq(state.laps.length, n - 1, 'lap count');
  });

  await step('settings: delete all videos and clear all data (confirm flows)', async () => {
    await go('#/settings', 600);
    const del = $$('#main .btn.danger'); click(del[0], 'delete all videos'); await answerConfirm(true); await wait(600);
    eq([...state.videoNames].length, 0, 'no videos left');
    click($$('#main .btn.danger')[1], 'clear all'); await answerConfirm(true); await wait(800);
    eq(state.laps.length, 0, 'no laps left');
  });

  await step('empty state offers the tour; demo re-import and removal work', async () => {
    await go('#/laps', 600); assert($('.tour-offer'), 'tour offer');
    await loadDemoData(() => {}); eq(demoLaps().length, 3, 're-imported');
    await removeDemoData(); eq(state.laps.length, 0, 'removed');
    await loadDemoData(() => {}); eq(demoLaps().length, 3, 'imported again for manual testing');
  });

  await step('no uncaught errors during the run', async () => { assert(errors.length === 0, errors.join(' | ')); });

  running = false; render();
  window.__selftest = results;
  console.table(results.map((r) => ({ test: r.name, ok: r.ok, ms: r.ms, error: r.error || '' })));
  return results;
}
