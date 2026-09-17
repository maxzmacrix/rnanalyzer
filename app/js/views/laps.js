// Laps view: import, list grouped by event, selection for comparison, per-lap actions.

import { state, on, toggleSelect, clearSelection, isSelected, lapColor, bestLapIds, hasVideo, videoKeyFor, MAX_LAPS, reloadLaps, displayDriver, displayVehicle, setSelection } from '../state.js';
import { t, fmtDateTime, fmtDate, fmtTimeOfDay, fmtBytes } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast, sheet, confirmDialog, promptDialog, initials } from '../ui.js';
import { importFiles } from '../import.js';
import { db } from '../db.js';
import { shareFiles } from '../share.js';
import { startTour } from '../tour.js';
import { getSessionWeather } from '../weather.js';
import { healthAvailable, loadHeartRate } from '../health.js';

let root, listEl, selEl, filterEl, unsub = [];
const collapsed = new Set();
let query = '';
// session analysis filters (kept while the app runs)
const filters = { complete: false, outliers: false, video: false, driver: '', vehicle: '', sort: 'session' };
const OUTLIER_PCT = 5; // laps slower than best + 5 % count as outliers (traffic, mistakes, in/out laps)

export function mount(main) {
  setTitle(t('nav_laps'));
  const fileInput = h('input', {
    type: 'file', multiple: true,
    // Android's chooser filters by MIME type and hides unknown extensions such as .rnz – no filter there
    accept: /Android/i.test(navigator.userAgent) ? '*/*' : '.rnz,.rn,.cdrn,.mp4,.mov,.m4v,.zip,video/mp4,application/zip,application/octet-stream',
    style: { display: 'none' },
    on: { change: (e) => { const files = [...e.target.files]; e.target.value = ''; runImport(files); } },
  });
  setTopButtons([], [tbtn(t('import_files'), () => fileInput.click(), { icon: 'upload', class: 'primary' })]);
  const search = h('input.input', { type: 'search', placeholder: t('search'), value: query, on: { input: (e) => { query = e.target.value; renderList(); } } });
  root = h('div.view',
    h('div.laps-toolbar', search, fileInput),
    (filterEl = h('div.filter-bar')),
    (selEl = h('div.sel-summary')),
    (listEl = h('div.scroll.grow')),
  );
  main.appendChild(root);
  unsub.push(on('laps', render), on('selection', render), on('settings', render));
  render();
}
export function unmount() { unsub.forEach((u) => u()); unsub = []; }
export function update() { render(); }

export async function runImport(files) {
  if (!files.length) return;
  toast(t('importing'), 60000);
  const res = await importFiles(files, (p) => { if (p.phase === 'start') toast(`${t('importing')} ${p.index + 1}/${p.total}: ${p.name}`, 60000); });
  const msgs = [t('imported', { n: res.laps + res.videos })];
  if (res.skipped.length) msgs.push(t('file_type_unknown', { f: res.skipped.join(', ') }));
  if (res.errors.length) msgs.push(t('import_error', { e: res.errors.map((e) => `${e.name}: ${e.error}`).join('; ') }));
  toast(msgs.join(' · '), 5000);
}

function render() {
  renderSelection();
  renderList();
}

function renderSelection() {
  clear(selEl);
  const n = state.selected.length;
  if (!n) { selEl.appendChild(h('span', t('select_hint', { n: MAX_LAPS }))); return; }
  const dots = h('div.dots', state.selected.map((id) => h('i', { style: { background: lapColor(id) } })));
  selEl.append(dots, h('span.grow', t('selected', { n })), h('button.tbtn', { on: { click: () => clearSelection() } }, t('deselect_all')));
}

function groupKey(l) { return `${l.event.id}|${l.track.id}|${l.source.device}`; }

function matches(l, q) {
  if (!q) return true;
  const hay = [displayDriver(l), displayVehicle(l), l.track.name, l.event.name, l.source.device, `L${l.lapNumber}`, l.lapNumber, fmtLapTime(l.lapTimeMs), l.note].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function renderList() {
  clear(listEl);
  let laps = state.laps;
  if (!state.settings.allTracks && state.selected.length) {
    const ref = state.lapsById.get(state.selected[0]);
    if (ref) laps = laps.filter((l) => l.track.id === ref.track.id);
  }
  const q = query.trim();
  laps = laps.filter((l) => matches(l, q));
  renderFilterBar(laps);
  if (filters.driver) laps = laps.filter((l) => displayDriver(l) === filters.driver);
  if (filters.vehicle) laps = laps.filter((l) => displayVehicle(l) === filters.vehicle);
  if (filters.complete) laps = laps.filter((l) => l.complete && l.lapTimeMs > 0);
  if (filters.video) laps = laps.filter((l) => hasVideo(l));
  if (!laps.length) {
    if (state.laps.length) listEl.appendChild(h('div.empty', t('search') + ': 0'));
    else listEl.appendChild(h('div.empty.tour-offer', h('div', t('no_laps')),
      h('button.btn.accent', { on: { click: () => startTour() } }, t('tour_start')), h('div.small.muted', t('tour_start_hint'))));
    return;
  }
  const best = bestLapIds(state.laps);
  const groups = new Map();
  for (const l of laps) {
    const k = groupKey(l);
    if (!groups.has(k)) groups.set(k, { key: k, laps: [], first: l });
    groups.get(k).laps.push(l);
  }
  const sorted = [...groups.values()].sort((a, b) => (b.first.event.startMs || b.first.startMs) - (a.first.event.startMs || a.first.startMs));
  for (const g of sorted) {
    const l0 = g.first;
    const an = analyzeSession(g.laps);
    const isCollapsed = collapsed.has(g.key);
    const head = h('div.event-head', { class: isCollapsed ? 'collapsed' : '', on: { click: () => { if (collapsed.has(g.key)) collapsed.delete(g.key); else collapsed.add(g.key); renderList(); } } },
      h('span.chev', { html: icons.chev, style: { display: 'inline-flex' } }),
      h('div.grow',
        h('div.title', l0.track.name || l0.event.name || '–'),
        h('div.sub', `${l0.event.name && l0.event.name !== l0.track.name ? l0.event.name + ' · ' : ''}${fmtDate(l0.event.startMs || l0.startMs)} · ${l0.source.device} · ${t('laps_count', { n: g.laps.length })}`),
        an.clean.size >= 2 ? h('div.stats', { html: sessionStatsHtml(an) }) : null,
        weatherLine(g.laps)),
      an.clean.size >= 2 ? h('button.chip.suggest', { on: { click: (e) => { e.stopPropagation(); suggestComparison(an); } } }, t('suggest_compare')) : null,
    );
    listEl.appendChild(head);
    if (isCollapsed) continue;
    let rows = g.laps;
    if (filters.outliers) rows = rows.filter((l) => !an.outliers.has(l.id));
    sortLaps(rows, an);
    for (const l of rows) listEl.appendChild(lapRow(l, best.has(l.id), an));
  }
}

function lapRow(l, isBest, an) {
  const sel = isSelected(l.id);
  const color = lapColor(l.id);
  const hv = hasVideo(l);
  const secs = sectorTimes(l);
  const isOutlier = an && an.outliers.has(l.id);
  const dBest = an && an.bestByDriver.get(displayDriver(l));
  const delta = an && l.complete && l.lapTimeMs > 0 && dBest > 0 && l.lapTimeMs !== dBest ? (l.lapTimeMs - dBest) / 1000 : NaN;
  const row = h('div.lap-row', {
    class: `${sel ? 'selected' : ''} ${l.complete ? '' : 'incomplete'} ${isBest ? 'best' : ''} ${isOutlier ? 'outlier' : ''}`,
    style: { '--lap-color': color },
    on: { click: async (e) => { if (e.target.closest('.more')) return; const ok = await toggleSelect(l.id); if (!ok) toast(t('max_selected', { n: MAX_LAPS })); } },
  },
    h('div.bar'),
    h('div.avatar', l.driver.photo ? h('img', { src: l.driver.photo, alt: '' }) : initials(displayDriver(l))),
    h('div.info',
      h('div.time-row', h('div.time.mono', fmtLapTime(l.lapTimeMs)), Number.isFinite(delta) ? h('span.delta.mono', `+${delta.toFixed(3)}`) : null, isOutlier ? h('span.badge', t('outlier')) : null),
      h('div.l1', `${displayDriver(l)} · ${displayVehicle(l)}`),
      h('div.l2', `${t('lap_n', { n: l.lapNumber })} · ${fmtTimeOfDay(l.startMs)}${l.note ? ' · ' + l.note : ''}`),
      secs.length ? h('div.secs', secs.map((s, j) => h('span.sec.mono', { class: an && an.bestSecLap[j] === l.id ? 'best' : '', title: an && an.bestSecLap[j] === l.id ? t('best_sector') : '' }, h('b', `S${j + 1}`), fmtSec(s)))) : null),
    h('div.right',
      sel ? h('span.selmark', { style: { background: color }, html: icons.check, title: t('selected', { n: state.selected.indexOf(l.id) + 1 }) }) : null,
      hv ? h('span.badge.video', t('video')) : (l.video ? h('span.badge', t('no_video')) : null),
      isBest ? h('span.badge.best', t('best_lap')) : null,
      l.demo ? h('span.badge', t('demo_badge')) : null,
      l.channels && l.channels.hr ? h('span.badge.hr', { title: t('ch_hr') }, '♥') : null),
    h('button.more', { html: icons.more, 'aria-label': t('options'), on: { click: (e) => { e.stopPropagation(); lapMenu(l); } } }),
  );
  row.style.setProperty('--lap-color', color); // custom properties need setProperty (the style map ignores them)
  return row;
}

// ------------------------------------------------------------------ session weather (Open-Meteo, cached)
const weatherCache = new Map(); // group key -> summary | null
function weatherLine(laps) {
  if (state.settings.weather === false) return null;
  const key = groupKey(laps[0]);
  const el = h('div.weather', { title: t('weather_hint') });
  const show = (w) => { if (w && w.text) el.textContent = w.text; else el.remove(); };
  if (weatherCache.has(key)) { show(weatherCache.get(key)); return el; }
  el.textContent = '…';
  getSessionWeather(laps).then((w) => { weatherCache.set(key, w); show(w); }).catch(() => el.remove());
  return el;
}

// ------------------------------------------------------------------ session analysis
function sectorTimes(l) { return (l.sectors || []).map((s) => s.endS - s.startS).filter((x) => Number.isFinite(x) && x > 0); }
function fmtSec(s) { return s < 60 ? s.toFixed(3) : fmtLapTime(s * 1000); }

/** Best lap, outliers, best sector per index, theoretical best and consistency for the laps of one session. */
function analyzeSession(laps) {
  const complete = laps.filter((l) => l.complete && l.lapTimeMs > 0);
  const bestMs = complete.length ? Math.min(...complete.map((l) => l.lapTimeMs)) : NaN;
  const bestLap = complete.find((l) => l.lapTimeMs === bestMs);
  // outliers and deltas are judged per driver (a slower driver's laps are not outliers of the faster one)
  const bestByDriver = new Map();
  for (const l of complete) { const d = displayDriver(l); if (!bestByDriver.has(d) || l.lapTimeMs < bestByDriver.get(d)) bestByDriver.set(d, l.lapTimeMs); }
  const isOutlier = (l) => l.lapTimeMs > bestByDriver.get(displayDriver(l)) * (1 + OUTLIER_PCT / 100);
  const cleanLaps = complete.filter((l) => !isOutlier(l));
  const outliers = new Set(complete.filter(isOutlier).map((l) => l.id));
  // sector count = most common count among clean laps that carry device sectors
  const counts = new Map();
  for (const l of cleanLaps) { const n = sectorTimes(l).length; if (n) counts.set(n, (counts.get(n) || 0) + 1); }
  const nSec = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  const withSec = cleanLaps.filter((l) => sectorTimes(l).length === nSec);
  const bestSec = [], bestSecLap = [];
  for (let j = 0; j < nSec; j++) {
    let bl = null, bt = Infinity;
    for (const l of withSec) { const v = sectorTimes(l)[j]; if (v < bt) { bt = v; bl = l; } }
    bestSec.push(bt); bestSecLap.push(bl ? bl.id : null);
  }
  const theoreticalMs = nSec ? bestSec.reduce((a, b) => a + b, 0) * 1000 : NaN;
  const times = cleanLaps.map((l) => l.lapTimeMs / 1000);
  const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  const sigma = times.length > 1 ? Math.sqrt(times.reduce((a, x) => a + (x - mean) ** 2, 0) / times.length) : NaN;
  const picked = new Set([bestLap ? bestLap.id : null, ...bestSecLap].filter(Boolean));
  const rest = [...cleanLaps].filter((l) => !picked.has(l.id)).sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const byTime = rest.length ? rest : [...cleanLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const typical = byTime[Math.floor(byTime.length / 2)] || null; // median of the remaining laps = "typical" pace
  return { total: laps.length, bestMs, bestByDriver, bestLapId: bestLap ? bestLap.id : null, clean: new Set(cleanLaps.map((l) => l.id)), outliers, nSec, bestSec, bestSecLap, theoreticalMs, sigma, typicalId: typical ? typical.id : null };
}
function sessionStatsHtml(an) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const parts = [];
  if (Number.isFinite(an.theoreticalMs)) parts.push(`${esc(t('theoretical_short'))} <b>${fmtLapTime(an.theoreticalMs)}</b> (−${((an.bestMs - an.theoreticalMs) / 1000).toFixed(3)})`);
  if (Number.isFinite(an.sigma)) parts.push(`σ <b>${an.sigma.toFixed(3)} s</b>`);
  parts.push(esc(t('clean_laps', { c: an.clean.size, n: an.total })));
  return parts.join(' · ');
}
function sortLaps(rows, an) {
  const sec = /^s(\d+)$/.exec(filters.sort);
  if (filters.sort === 'time') rows.sort((a, b) => ((a.complete && a.lapTimeMs > 0) ? a.lapTimeMs : Infinity) - ((b.complete && b.lapTimeMs > 0) ? b.lapTimeMs : Infinity) || a.startMs - b.startMs);
  else if (sec) { const j = Number(sec[1]) - 1; rows.sort((a, b) => (sectorTimes(a)[j] ?? Infinity) - (sectorTimes(b)[j] ?? Infinity) || a.startMs - b.startMs); }
  else rows.sort((a, b) => a.startMs - b.startMs);
}
async function suggestComparison(an) {
  const ids = [];
  const add = (id) => { if (id && !ids.includes(id) && ids.length < MAX_LAPS) ids.push(id); };
  add(an.bestLapId);
  for (const id of an.bestSecLap) add(id);
  add(an.typicalId);
  if (!ids.length) return;
  await setSelection(ids);
  toast(t('suggest_done', { n: ids.length }), 4000);
}
function renderFilterBar(laps) {
  clear(filterEl);
  if (!state.laps.length) return;
  const chip = (label, on, fn, cls = '') => h('button.chip', { class: `${on ? 'on' : ''} ${cls}`, on: { click: () => { fn(); renderList(); } } }, label);
  const maxSec = Math.max(0, ...laps.map((l) => sectorTimes(l).length));
  filterEl.append(
    chip(t('filter_complete'), filters.complete, () => { filters.complete = !filters.complete; }),
    chip(t('filter_outliers'), filters.outliers, () => { filters.outliers = !filters.outliers; }, ''),
    chip(t('filter_video'), filters.video, () => { filters.video = !filters.video; }),
    h('span.sep'),
    chip(t('sort_session'), filters.sort === 'session', () => { filters.sort = 'session'; }),
    chip(t('sort_time'), filters.sort === 'time', () => { filters.sort = 'time'; }),
    ...Array.from({ length: Math.min(maxSec, 8) }, (_, j) => chip(`S${j + 1}`, filters.sort === `s${j + 1}`, () => { filters.sort = `s${j + 1}`; })),
  );
  const drivers = [...new Set(laps.map(displayDriver))].filter((d) => d && d !== '–');
  const vehicles = [...new Set(laps.map(displayVehicle))].filter((v) => v && v !== '–');
  if (drivers.length > 1 || filters.driver) {
    filterEl.append(h('span.sep'), chip(t('all_drivers'), !filters.driver, () => { filters.driver = ''; }), ...drivers.map((d) => chip(d, filters.driver === d, () => { filters.driver = filters.driver === d ? '' : d; })));
  }
  if (vehicles.length > 1 || filters.vehicle) {
    filterEl.append(h('span.sep'), chip(t('all_vehicles'), !filters.vehicle, () => { filters.vehicle = ''; }), ...vehicles.map((v) => chip(v, filters.vehicle === v, () => { filters.vehicle = filters.vehicle === v ? '' : v; })));
  }
}

async function lapMenu(l) {
  const hv = hasVideo(l);
  const item = (icon, label, fn, cls = '') => h('div.item', { class: cls, on: { click: () => { s.close(); fn(); } } }, h('span', { html: icons[icon], style: { display: 'inline-flex', width: '22px' } }), h('span.lbl', label));
  const s = sheet(`${t('lap_n', { n: l.lapNumber })} · ${displayDriver(l)} · ${fmtLapTime(l.lapTimeMs)}`, [
    h('div', { style: { padding: '6px 16px 10px', fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.5' } },
      `${l.track.name} · ${l.event.name}`, h('br'), `${fmtDateTime(l.startMs)} · ${l.source.device} · ${l.sampleCount} samples`, h('br'),
      l.video ? `${t('video')}: ${l.video.fileName} ${hv ? '✓' : '(' + t('video_missing') + ')'}` : t('no_video')),
    item('edit', t('edit_lap'), () => editLap(l)),
    healthAvailable() ? item('pulse', t('health_load'), async () => {
      toast(t('health_loading'), 20000);
      try { const n = await loadHeartRate(l); toast(n ? t('health_loaded', { n }) : t('health_none'), 4000); }
      catch (e) { toast(t('health_failed', { e: e.message || e }), 5000); }
    }) : null,
    item('share', t('share_lap_data'), () => shareLap(l, 'data')),
    hv ? item('share', t('share_video'), () => shareLap(l, 'video')) : null,
    hv ? item('share', t('share_both'), () => shareLap(l, 'both')) : null,
    h('div.small.muted', { style: { padding: '4px 16px 8px' } }, t('share_hint')),
    hv ? item('trash', t('delete_video'), () => deleteVideo(l)) : null,
    item('trash', t('delete'), () => deleteLap(l), 'danger'),
  ]);
}

async function editLap(l) {
  const r = await promptDialog(t('edit_lap'), [
    { key: 'driver', label: t('driver'), value: l.driverOverride || l.driver.name },
    { key: 'vehicle', label: t('vehicle'), value: l.vehicleOverride || l.vehicle.model },
    { key: 'number', label: '#', value: l.vehicleNumberOverride || l.vehicle.number || '' },
    { key: 'note', label: t('note'), value: l.note || '', type: 'textarea' },
  ]);
  if (!r) return;
  l.driverOverride = r.driver.trim() !== (l.driver.name || '').trim() ? r.driver.trim() : '';
  l.vehicleOverride = r.vehicle.trim() !== (l.vehicle.model || '').trim() ? r.vehicle.trim() : '';
  l.vehicleNumberOverride = r.number.trim() !== (l.vehicle.number || '').trim() ? r.number.trim() : '';
  l.note = r.note.trim();
  await db.updateLap(l);
  await reloadLaps();
}

async function shareLap(l, what) {
  const files = [];
  if (what === 'data' || what === 'both') {
    const raw = await db.getRaw(l.id);
    if (raw) files.push(new File([raw.data], raw.fileName && /\.rnz$/i.test(raw.fileName) ? raw.fileName : `${l.source.device}_Lap_${l.lapNumber}.rnz`, { type: 'application/zip' }));
  }
  if (what === 'video' || what === 'both') {
    const vk = videoKeyFor(l);
    const rec = vk ? await db.getVideo(vk) : null;
    if (rec) files.push(new File([rec.blob], vk, { type: rec.type || 'video/mp4' }));
  }
  if (!files.length) { toast(t('failed')); return; }
  const res = await shareFiles(files, `${l.track.name} – ${t('lap_n', { n: l.lapNumber })} ${displayDriver(l)} ${fmtLapTime(l.lapTimeMs)}`);
  if (res === 'downloaded') toast(t('share_unsupported'), 4000);
}

async function deleteLap(l) {
  if (!(await confirmDialog(t('confirm_delete_lap'), { danger: true, okLabel: t('delete') }))) return;
  const vk = videoKeyFor(l);
  await db.deleteLap(l.id);
  if (vk) { const others = state.laps.some((o) => o.id !== l.id && videoKeyFor(o) === vk); if (!others) await db.deleteVideo(vk); }
  if (isSelected(l.id)) await setSelection(state.selected.filter((id) => id !== l.id));
  await reloadLaps();
}
async function deleteVideo(l) {
  if (!(await confirmDialog(t('confirm_delete_video'), { danger: true, okLabel: t('delete') }))) return;
  const vk = videoKeyFor(l);
  if (vk) await db.deleteVideo(vk);
  await reloadLaps();
}

/** Lap picker sheet reused by Analyzer / G-Force / Video views. */
export function openLapPicker(onChange) {
  const body = h('div');
  const best = bestLapIds(state.laps);
  const build = () => {
    clear(body);
    if (!state.laps.length) { body.appendChild(h('div.empty', t('no_laps'))); return; }
    const groups = new Map();
    for (const l of state.laps) { const k = groupKey(l); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    for (const [, laps] of [...groups.entries()].sort((a, b) => b[1][0].startMs - a[1][0].startMs)) {
      const l0 = laps[0];
      body.appendChild(h('div.group', `${l0.track.name} · ${fmtDate(l0.event.startMs || l0.startMs)} · ${l0.source.device}`));
      for (const l of laps.sort((a, b) => a.startMs - b.startMs)) {
        const sel = isSelected(l.id);
        body.appendChild(h('div.item', { class: sel ? 'selected' : '', style: sel ? { boxShadow: `inset 4px 0 0 ${lapColor(l.id)}` } : {}, on: { click: async () => { const ok = await toggleSelect(l.id); if (!ok) toast(t('max_selected', { n: MAX_LAPS })); build(); onChange && onChange(); } } },
          h('div.check', { class: sel ? 'on' : '', html: sel ? icons.check : '' }),
          h('div.lbl',
            h('div', { class: 'mono', style: { fontWeight: 700, color: best.has(l.id) ? 'var(--yellow)' : (l.complete ? '' : 'var(--grey)') } }, fmtLapTime(l.lapTimeMs)),
            h('div.small.muted', `${t('lap_n', { n: l.lapNumber })} · ${displayDriver(l)} · ${displayVehicle(l)} · ${fmtTimeOfDay(l.startMs)}`)),
          hasVideo(l) ? h('span.badge.video', t('video')) : null));
      }
    }
  };
  build();
  const s = sheet(t('laps_btn'), [body], { headerRight: h('button.tbtn', { on: { click: async () => { await clearSelection(); build(); onChange && onChange(); } } }, t('deselect_all')) });
  return s;
}
