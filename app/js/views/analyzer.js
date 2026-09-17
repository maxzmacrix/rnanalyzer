// Analyzer view: synchronized videos + two configurable chart/map/table panels with a shared cursor.

import {
  state, on, ensureSelectedSamples, lapColor, displayDriver, displayVehicle, setCursor, updateSettings,
  speedFactor, speedUnitLabel, distFactor, distUnitLabel, customSplits, setCustomSplits, videoKeyFor, MAX_VIDEOS, lapLabel,
} from '../state.js';
import { t } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast, sheet, switchEl, segmented, confirmDialog } from '../ui.js';
import { LineChart } from '../chart.js';
import { TrackMap, nearestSample } from '../map.js';
import {
  CHANNELS, channelArray, xArray, valueAt, positionAt, timeSlipSeries, distanceGapSeries, deviceSplits, deviceSectorTimes,
  sectorTimesFromSplits, bestTimes, geometricSplits, timeAtDistance, distanceAtTime,
} from '../analysis.js';
import { db } from '../db.js';
import { player } from '../sync.js';
import { openLapPicker } from './laps.js';

let root, rightCol, videoPanel, videoGrid, playBtn, speedChip, posLbl, refLbl, xModeBtn;
let data = []; // [{lap, samples, color}]
let panels = {};
let unsub = [];
const videoObjs = new Map(); // lapId -> { el, url, cell, key }
const scaledCache = new Map();
let cursorRaf = 0;

// ------------------------------------------------------------------ mount / unmount
export function mount(main) {
  setTitle(t('nav_analyzer'));
  xModeBtn = tbtn(xModeLabel(), toggleXMode, { title: t('x_axis') });
  setTopButtons(
    [tbtn(t('laps_btn'), () => openLapPicker(), { icon: 'laps' })],
    [xModeBtn, tbtn(t('options'), openOptions, { icon: 'options' })],
  );

  playBtn = h('button.tbtn.primary', { html: icons.play, 'aria-label': t('play'), on: { click: () => player.toggle() } });
  speedChip = h('button.chip', { on: { click: cycleSpeed } }, `${Number(state.settings.autoplaySpeed) || 1}×`);
  posLbl = h('span.pos.grow', '');
  refLbl = h('span.small', '');
  const playBar = h('div.play-bar', playBtn, speedChip, posLbl, refLbl);

  videoGrid = h('div.videos');
  videoPanel = h('div.panel.video-panel', videoGrid);
  const d0 = divider('d0');
  panels = { A: createPanel('A'), B: createPanel('B') };
  const d1 = divider('d1');
  rightCol = h('div.right-col', panels.A.el, d1, panels.B.el);
  root = h('div.analyzer', playBar, videoPanel, d0, rightCol);
  main.appendChild(root);
  applyRatios();

  unsub.push(
    on('selection', load), on('laps', load), on('settings', onSettings), on('cursor', onCursor),
    on('player', (e) => { playBtn.innerHTML = e.playing ? icons.pause : icons.play; }),
    on('sectors', () => refreshPanels()),
  );
  playBtn.innerHTML = player.playing ? icons.pause : icons.play;
  load();
}

export function unmount() {
  unsub.forEach((u) => u()); unsub = [];
  for (const p of Object.values(panels)) destroyPanelContent(p);
  panels = {};
  player.pause();
  player.clearVideos();
  for (const v of videoObjs.values()) { try { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); } catch { /* ignore */ } URL.revokeObjectURL(v.url); }
  videoObjs.clear();
  scaledCache.clear();
  if (cursorRaf) cancelAnimationFrame(cursorRaf); cursorRaf = 0;
}

// ------------------------------------------------------------------ loading
async function load() {
  data = await ensureSelectedSamples();
  scaledCache.clear();
  updateRefLabel();
  await updateVideos();
  refreshPanels();
  updatePos();
}

function updateRefLabel() {
  clear(refLbl);
  if (!data.length) { refLbl.textContent = t('select_laps_first'); return; }
  refLbl.append(h('span', { style: { color: data[0].color, fontWeight: 700 } }, `${t('reference')}: ${lapLabel(data[0].lap)}`));
}

function xMode() { return state.settings.xMode === 'time' ? 'time' : 'distance'; }
function xModeLabel() { return xMode() === 'time' ? t('time') : t('distance'); }
async function toggleXMode() {
  const ref = data[0];
  const cur = state.cursor;
  const next = xMode() === 'time' ? 'distance' : 'time';
  await updateSettings({ xMode: next });
  xModeBtn.querySelector('span') ? (xModeBtn.querySelector('span').textContent = xModeLabel()) : (xModeBtn.textContent = xModeLabel());
  if (ref) setCursor(next === 'time' ? timeAtDistance(ref.samples, cur) : distanceAtTime(ref.samples, cur), 'analyzer');
}
function cycleSpeed() {
  const opts = [0.5, 1, 2, 4];
  const cur = Number(state.settings.autoplaySpeed) || 1;
  const next = opts[(opts.indexOf(cur) + 1) % opts.length];
  updateSettings({ autoplaySpeed: next });
}
function onSettings(patch) {
  if (!patch) return;
  if ('autoplaySpeed' in patch) { speedChip.textContent = `${patch.autoplaySpeed}×`; player.setSpeed(Number(patch.autoplaySpeed)); }
  if ('mapTiles' in patch) for (const p of Object.values(panels)) if (p.map) p.map.setTiles(patch.mapTiles);
  const keys = ['panelA', 'panelA2', 'panelB', 'panelB2', 'xMode', 'sectors', 'units', 'colorblind', 'language'];
  if (keys.some((k) => k in patch)) { scaledCache.clear(); data = data.map((d) => ({ ...d, color: lapColor(d.lap.id) })); updateRefLabel(); refreshPanels(); updateVideoColors(); }
}

// ------------------------------------------------------------------ videos
async function updateVideos() {
  const withVideo = data.filter((d) => videoKeyFor(d.lap)).slice(0, MAX_VIDEOS);
  const keep = new Set(withVideo.map((d) => d.lap.id));
  for (const [id, v] of videoObjs) {
    if (!keep.has(id)) {
      player.unregisterVideo(id);
      try { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); } catch { /* ignore */ }
      URL.revokeObjectURL(v.url); v.cell.remove(); videoObjs.delete(id);
    }
  }
  for (const d of withVideo) {
    if (videoObjs.has(d.lap.id)) continue;
    const key = videoKeyFor(d.lap);
    const rec = await db.getVideo(key);
    if (!rec) continue;
    const url = URL.createObjectURL(rec.blob);
    const el = h('video', { playsinline: true, 'webkit-playsinline': true, preload: 'auto', muted: true, src: url });
    el.muted = true;
    const label = h('div.vlabel', h('b', `L${d.lap.lapNumber}`), ` ${displayDriver(d.lap)}`);
    const cell = h('div.vcell', { style: { '--lap-color': d.color } }, el, label);
    cell.addEventListener('click', () => {
      // tap = toggle sound for this video (only one unmuted)
      const wasMuted = el.muted;
      for (const o of videoObjs.values()) o.el.muted = true;
      el.muted = !wasMuted;
      toast(el.muted ? t('muted') : `${t('sound')}: ${lapLabel(d.lap)}`, 1200);
    });
    videoGrid.appendChild(cell);
    videoObjs.set(d.lap.id, { el, url, cell, key });
    player.registerVideo(d.lap.id, el, d.lap.video ? d.lap.video.offsetS : 0);
    el.addEventListener('loadedmetadata', () => player.seekVideo(d.lap.id, true));
  }
  // order cells like selection
  for (const d of withVideo) { const v = videoObjs.get(d.lap.id); if (v) videoGrid.appendChild(v.cell); }
  videoGrid.classList.toggle('one', videoObjs.size === 1);
  const has = videoObjs.size > 0;
  root.classList.toggle('has-video', has);
  videoPanel.classList.toggle('hidden', !has);
  root.querySelector('.divider.d0').classList.toggle('hidden', !has);
  if (data.filter((d) => videoKeyFor(d.lap)).length > MAX_VIDEOS) toast(t('videos_limit_hint', { n: MAX_VIDEOS }), 2500);
}
function updateVideoColors() { for (const [id, v] of videoObjs) v.cell.style.setProperty('--lap-color', lapColor(id)); }

// ------------------------------------------------------------------ panels
function createPanel(key) {
  const body = h('div.panel-body');
  const titleChip = h('button.chip', { on: { click: () => openComponentSheet(key) } }, '…');
  const tools = h('div.panel-tools');
  const el = h('div.panel', body, h('div.panel-title', titleChip), tools);
  return { key, el, body, titleChip, tools, kind: null, chart: null, map: null, table: null, compId: null, comp2Id: null };
}
function destroyPanelContent(p) {
  if (p.chart) { p.chart.destroy(); p.chart = null; }
  if (p.map) { p.map.destroy(); p.map = null; }
  p.table = null; p.kind = null;
  clear(p.body); clear(p.tools);
}
function panelSetting(key) { return { comp: state.settings[`panel${key}`] || (key === 'A' ? 'speed' : 'map'), comp2: state.settings[`panel${key}2`] || null }; }

function kindOf(id) {
  if (!id) return null;
  if (id.startsWith('custom:')) return 'number';
  const c = CHANNELS[id];
  return c ? c.kind : null;
}
function chanInfo(id) {
  if (id.startsWith('custom:')) {
    const name = id.slice(7);
    const def = data.map((d) => (d.lap.channels.custom || []).find((c) => c.name === name)).find(Boolean);
    return { id, label: name, unit: def ? def.unit : '', decimals: 2, kind: 'number' };
  }
  const c = CHANNELS[id];
  if (!c) return null;
  const unit = c.unit === 'speed' ? speedUnitLabel() : c.unit === 'm' ? distUnitLabel() : c.unit === 'raw' ? '' : c.unit === 'deg' ? '°' : (c.unit || '');
  return { id, label: t(c.label), unit, decimals: c.decimals, kind: c.kind, avail: c.avail, group: c.group };
}
function scaleFor(id) {
  const c = CHANNELS[id];
  if (c && c.unit === 'speed') return speedFactor();
  if (c && c.unit === 'm') return distFactor();
  return 1;
}
function yArr(d, id) {
  const arr = channelArray(d.samples, id);
  if (!arr) return null;
  const k = scaleFor(id);
  if (k === 1) return arr;
  const key = `${d.lap.id}|${id}|${k}`;
  let out = scaledCache.get(key);
  if (!out) { out = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = arr[i] * k; scaledCache.set(key, out); }
  return out;
}
function fmtNum(dec) { return (v) => (Number.isFinite(v) ? v.toFixed(dec) : '–'); }
function fmtX(x) { return xMode() === 'time' ? fmtLapTime(x * 1000) : `${Math.round(x * distFactor())} ${distUnitLabel()}`; }
function xLabelText() { return xMode() === 'time' ? `${t('time')} [s]` : `${t('distance')} [${distUnitLabel()}]`; }

/** Sector split positions (in current x units) of the reference lap, according to settings. */
function sectorMarkers() {
  const mode = state.settings.sectors;
  if (mode === 'none' || !data.length) return [];
  const ref = data[0];
  let splitsD = [];
  if (mode === 'custom') splitsD = customSplits(ref.lap.track.id);
  else {
    splitsD = deviceSplits(ref.lap, ref.samples);
    if (!splitsD.length) splitsD = geometricSplits(ref.samples, ref.lap.trackDef);
  }
  const color = mode === 'custom' ? '#ffe14d' : '#6be5f6';
  return splitsD.map((d, i) => ({ x: xMode() === 'time' ? timeAtDistance(ref.samples, d) : d, label: `S${i + 1}`, color, d }));
}

function refreshPanels() {
  for (const key of ['A', 'B']) configurePanel(panels[key]);
}

function configurePanel(p) {
  const { comp, comp2 } = panelSetting(p.key);
  const kind = kindOf(comp) || 'number';
  if (p.kind !== kind) {
    destroyPanelContent(p);
    p.kind = kind;
    if (kind === 'number' || kind === 'timeslip') {
      const canvas = h('canvas');
      p.body.appendChild(canvas);
      p.chart = new LineChart(canvas, {
        onCursor: (x) => setCursor(x, `panel${p.key}`),
        onView: (x0, x1) => { if (state.settings.syncZoom) for (const o of Object.values(panels)) if (o !== p && o.chart) o.chart.setView(x0, x1, true); },
        onLongPress: (x) => addSplitAt(x),
      });
      p.tools.append(
        h('button', { html: icons.minus, title: '−', on: { click: () => p.chart.zoomBy(1.6) } }),
        h('button', { html: icons.plus, title: '+', on: { click: () => p.chart.zoomBy(1 / 1.6, state.cursor) } }),
        h('button', { html: icons.fit, title: t('reset_zoom'), on: { click: () => p.chart.resetView() } }),
      );
    } else if (kind === 'map') {
      const canvas = h('canvas');
      p.body.appendChild(canvas);
      p.map = new TrackMap(canvas, {
        tiles: state.settings.mapTiles,
        onTap: (lat, lng) => {
          if (!data.length) return;
          const ref = data[0];
          const { index, distDeg } = nearestSample(ref.samples, lat, lng);
          if (index < 0 || distDeg > 0.0015) return;
          setCursor(xMode() === 'time' ? ref.samples.t[index] : ref.samples.d[index], 'map');
        },
      });
      p.tools.append(h('button', { html: icons.fit, title: t('fit'), on: { click: () => p.map.fit() } }));
    } else {
      p.table = h('div.table-wrap');
      p.body.appendChild(p.table);
    }
  }
  p.compId = comp; p.comp2Id = kind === 'number' ? comp2 : null;
  const info = chanInfo(comp) || { label: comp };
  const info2 = p.comp2Id ? chanInfo(p.comp2Id) : null;
  p.titleChip.textContent = info2 ? `${info.label} + ${info2.label}` : info.label;
  if (p.chart) requestAnimationFrame(() => { if (p.chart) p.chart.setReserveRight(p.titleChip.offsetWidth + 20); });
  renderPanel(p);
}

function renderPanel(p) {
  if (!p.kind) return;
  if (p.kind === 'number') renderNumber(p);
  else if (p.kind === 'timeslip') renderTimeSlip(p);
  else if (p.kind === 'map') renderMap(p);
  else if (p.kind === 'detail') renderDetail(p);
  else if (p.kind === 'overview') renderOverview(p);
  else if (p.kind === 'sections') renderSections(p);
}

function xMaxAll() { let m = 1; for (const d of data) { const xs = xArray(d.samples, xMode()); if (d.samples.n) m = Math.max(m, xs[d.samples.n - 1]); } return m; }

function renderNumber(p) {
  const info = chanInfo(p.compId); const info2 = p.comp2Id ? chanInfo(p.comp2Id) : null;
  const series = [], series2 = [];
  for (const d of data) {
    const y = yArr(d, p.compId);
    if (y) series.push({ x: xArray(d.samples, xMode()), y, n: d.samples.n, color: d.color, label: lapLabel(d.lap) });
    if (info2) { const y2 = yArr(d, p.comp2Id); if (y2) series2.push({ x: xArray(d.samples, xMode()), y: y2, n: d.samples.n, color: d.color }); }
  }
  p.chart.setData({
    series, series2, markers: sectorMarkers(), xMax: xMaxAll(),
    xLabel: xLabelText(), yLabel: `${info.label}${info.unit ? ' [' + info.unit + ']' : ''}`, y2Label: info2 ? `${info2.label}${info2.unit ? ' [' + info2.unit + ']' : ''}` : '',
    fmt: fmtNum(info.decimals), fmt2: info2 ? fmtNum(info2.decimals) : null, fmtX,
    zeroLine: /^g/.test(p.compId) || p.compId.startsWith('gyr'),
    empty: data.length ? '' : t('select_laps_first'),
  });
  p.chart.setCursor(state.cursor);
}

function renderTimeSlip(p) {
  const series = [];
  if (data.length >= 2) {
    const ref = data[0];
    for (const d of data.slice(1)) {
      const s = xMode() === 'time' ? distanceGapSeries(d.samples, ref.samples) : timeSlipSeries(d.samples, ref.samples);
      series.push({ ...s, color: d.color, label: lapLabel(d.lap) });
    }
  }
  const timeMode = xMode() === 'time';
  p.chart.setData({
    series, markers: sectorMarkers(), xMax: xMaxAll(), xLabel: xLabelText(),
    yLabel: timeMode ? `Δ ${t('distance')} [m] ${t('vs_reference')}` : `${t('ch_timeslip')} [s] ${t('vs_reference')}`,
    fmt: (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) : '–'), fmtX, zeroLine: true,
    empty: data.length < 2 ? t('select_two_for_timeslip') : '',
  });
  p.chart.setCursor(state.cursor);
}

function renderMap(p) {
  const tracks = data.map((d) => ({ lat: d.samples.lat, lng: d.samples.lng, n: d.samples.n, color: d.color }));
  const def = data.length ? data[0].lap.trackDef : null;
  let splitPositions = [];
  if (state.settings.sectors === 'custom' && data.length) {
    const ref = data[0];
    splitPositions = customSplits(ref.lap.track.id).map((dm, i) => ({ ...positionAt(ref.samples, dm, 'distance'), label: `S${i + 1}` }));
  }
  p.map.setData({ tracks, def, cursors: cursorPositions(), showSectors: state.settings.sectors === 'default', splitPositions });
  if (!data.length) { /* nothing */ }
}
function cursorPositions() { return data.map((d) => ({ ...positionAt(d.samples, state.cursor, xMode()), color: d.color })); }

function lapHeaderCells() {
  return data.map((d) => h('th', { style: { color: d.color, textAlign: 'right' } }, h('div', `L${d.lap.lapNumber}`), h('div.small', { style: { fontWeight: 400 } }, displayDriver(d.lap))));
}

function detailRows() {
  const rows = [];
  const base = ['speed', 'glon', 'glat', 'gvert', 'gcomb', 'dev', 'alt', 'hdg', 'gyrY', 'gyrP', 'gyrR'];
  for (const id of base) rows.push(id);
  for (const id of ['rpm', 'thr', 'wt', 'ot', 'os']) if (data.some((d) => d.lap.channels[CHANNELS[id].avail])) rows.push(id);
  const custom = new Set(); for (const d of data) for (const c of d.lap.channels.custom || []) custom.add(c.name);
  for (const name of custom) rows.push('custom:' + name);
  return rows;
}
function renderDetail(p) {
  clear(p.table);
  if (!data.length) { p.table.appendChild(h('div.empty', t('select_laps_first'))); return; }
  const tbl = h('table.data');
  tbl.appendChild(h('thead', h('tr', h('th', t('at_cursor')), ...lapHeaderCells())));
  const tb = h('tbody');
  const xm = xMode();
  tb.appendChild(h('tr', h('th', t('lap_time')), ...data.map((d) => h('td.mono', fmtLapTime((xm === 'time' ? state.cursor : timeAtDistance(d.samples, state.cursor)) * 1000)))));
  tb.appendChild(h('tr', h('th', `${t('distance')} [${distUnitLabel()}]`), ...data.map((d) => h('td.mono', ((xm === 'time' ? distanceAtTime(d.samples, state.cursor) : state.cursor) * distFactor()).toFixed(0)))));
  for (const id of detailRows()) {
    const info = chanInfo(id);
    tb.appendChild(h('tr', h('th', `${info.label}${info.unit ? ' [' + info.unit + ']' : ''}`), ...data.map((d) => {
      const v = valueAt(d.samples, id, state.cursor, xm) * scaleFor(id);
      return h('td.mono', Number.isFinite(v) ? v.toFixed(info.decimals) : '–');
    })));
  }
  tbl.appendChild(tb);
  p.table.appendChild(tbl);
}

function renderOverview(p) {
  clear(p.table);
  if (!data.length) { p.table.appendChild(h('div.empty', t('select_laps_first'))); return; }
  const sf = speedFactor(), su = speedUnitLabel(), df = distFactor(), du = distUnitLabel();
  const rows = [
    { label: t('ov_laptime'), vals: data.map((d) => d.lap.lapTimeMs), fmt: (v) => fmtLapTime(v), best: 'min' },
    { label: t('ov_distance', { u: du }), vals: data.map((d) => d.lap.stats.distance * df), fmt: (v) => v.toFixed(0) },
    { label: t('ov_vmax', { u: su }), vals: data.map((d) => d.lap.stats.vmax * sf), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_vmin', { u: su }), vals: data.map((d) => d.lap.stats.vmin * sf), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_vavg', { u: su }), vals: data.map((d) => d.lap.stats.vavg * sf), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_acc'), vals: data.map((d) => d.lap.stats.accMax), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_brake'), vals: data.map((d) => d.lap.stats.brkMax), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_left'), vals: data.map((d) => d.lap.stats.leftMax), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_right'), vals: data.map((d) => d.lap.stats.rightMax), fmt: (v) => v.toFixed(2), best: 'max' },
    { label: t('ov_comb'), vals: data.map((d) => d.lap.stats.combMax), fmt: (v) => v.toFixed(2), best: 'max' },
  ];
  if (data.some((d) => d.lap.channels.rpm)) rows.push({ label: t('ov_rpm'), vals: data.map((d) => d.lap.stats.rpmMax), fmt: (v) => v.toFixed(0), best: 'max' });
  rows.push({ label: t('driver'), vals: data.map((d) => displayDriver(d.lap)), fmt: (v) => v });
  rows.push({ label: t('vehicle'), vals: data.map((d) => displayVehicle(d.lap)), fmt: (v) => v });
  const tbl = h('table.data');
  tbl.appendChild(h('thead', h('tr', h('th', ''), ...lapHeaderCells())));
  const tb = h('tbody');
  for (const r of rows) {
    let bestIdx = -1;
    if (r.best && data.length > 1) {
      const nums = r.vals.map((v) => (Number.isFinite(v) ? v : (r.best === 'min' ? Infinity : -Infinity)));
      const target = r.best === 'min' ? Math.min(...nums) : Math.max(...nums);
      bestIdx = nums.indexOf(target);
    }
    tb.appendChild(h('tr', h('th', r.label), ...r.vals.map((v, i) => h('td.mono', { style: { color: data[i].color } }, h('span.v', { class: i === bestIdx ? 'best' : '' }, r.fmt(v))))));
  }
  tbl.appendChild(tb);
  p.table.appendChild(tbl);
}

function sectorTimesFor(d, ref) {
  const mode = state.settings.sectors;
  if (mode === 'custom') return sectorTimesFromSplits(d.samples, customSplits(ref.lap.track.id), d.lap.lapTimeMs / 1000);
  const dev = deviceSectorTimes(d.lap);
  if (dev.length) return dev;
  let splits = deviceSplits(ref.lap, ref.samples);
  if (!splits.length) splits = geometricSplits(ref.samples, ref.lap.trackDef);
  return sectorTimesFromSplits(d.samples, splits, d.lap.lapTimeMs / 1000);
}
function renderSections(p) {
  clear(p.table);
  if (!data.length) { p.table.appendChild(h('div.empty', t('select_laps_first'))); return; }
  const ref = data[0];
  const rows = data.map((d) => sectorTimesFor(d, ref));
  const k = Math.min(...rows.map((r) => r.length));
  const best = bestTimes(rows.map((r) => r.slice(0, k)));
  const lapTimes = data.map((d) => d.lap.lapTimeMs);
  const bestLapIdx = lapTimes.indexOf(Math.min(...lapTimes.filter(Number.isFinite)));
  const wrap = h('div');
  wrap.appendChild(h('div', { style: { padding: '8px 12px 4px', fontSize: '13px' } },
    h('div', h('span', { style: { color: 'var(--blue-soft)' } }, '● '), `${t('best_theoretical')}: `, h('b.mono', fmtLapTime(best.theoretical * 1000))),
    h('div', h('span', { style: { color: 'var(--red)' } }, '● '), `${t('best_continuous')}: `, h('b.mono', fmtLapTime(best.continuous * 1000)))));
  const tbl = h('table.data');
  const head = h('tr', h('th', t('lap_number')), h('th', { style: { textAlign: 'right' } }, t('lap_time')));
  for (let j = 0; j < k; j++) head.appendChild(h('th', { style: { textAlign: 'right' } }, `${t('sector')} ${j + 1}`));
  tbl.appendChild(h('thead', head));
  const tb = h('tbody');
  data.forEach((d, i) => {
    const tr = h('tr', h('th', { style: { color: d.color } }, `L${d.lap.lapNumber} ${displayDriver(d.lap)}`),
      h('td.mono', { style: { color: d.color } }, h('span.v', { class: i === bestLapIdx && data.length > 1 ? 'best' : '' }, fmtLapTime(d.lap.lapTimeMs))));
    for (let j = 0; j < k; j++) {
      const v = rows[i][j];
      const isBest = data.length > 1 && Math.abs(v - best.bestPerSector[j]) < 1e-6;
      tr.appendChild(h('td.mono', { style: { color: d.color } }, h('span.v', { class: isBest ? 'best2' : '' }, fmtLapTime(v * 1000))));
    }
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
  p.table.appendChild(wrap);
}

// ------------------------------------------------------------------ cursor
function onCursor(e) {
  const src = e && e.source;
  for (const p of Object.values(panels)) {
    if (p.chart && src !== `panel${p.key}`) p.chart.setCursor(state.cursor);
  }
  if (cursorRaf) return;
  cursorRaf = requestAnimationFrame(() => {
    cursorRaf = 0;
    for (const p of Object.values(panels)) {
      if (p.map) p.map.setCursors(cursorPositions());
      if (p.kind === 'detail') renderDetail(p);
    }
    updatePos();
  });
}
function updatePos() {
  if (!data.length) { posLbl.textContent = ''; return; }
  const ref = data[0];
  const tRef = xMode() === 'time' ? state.cursor : timeAtDistance(ref.samples, state.cursor);
  const dRef = xMode() === 'time' ? distanceAtTime(ref.samples, state.cursor) : state.cursor;
  posLbl.textContent = `${Math.round(dRef * distFactor())} ${distUnitLabel()} · ${fmtLapTime(tRef * 1000)}`;
}

// ------------------------------------------------------------------ component sheet
function openComponentSheet(key) {
  const cur = panelSetting(key);
  const items = [];
  const numRow = (id) => {
    const info = chanInfo(id);
    if (!info) return null;
    const isPrimary = cur.comp === id;
    const isSecondary = cur.comp2 === id;
    const cb = h('div.check', { class: `${isSecondary ? 'on' : ''} ${isPrimary ? 'disabled' : ''}`, html: isSecondary ? icons.check : '' });
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isPrimary) return;
      await updateSettings({ [`panel${key}2`]: isSecondary ? null : id });
      s.close();
    });
    return h('div.item', { class: isPrimary ? 'selected' : '', on: { click: async () => { await updateSettings({ [`panel${key}`]: id, [`panel${key}2`]: cur.comp2 === id ? null : cur.comp2 }); s.close(); } } },
      h('span.lbl', `${info.label}${info.unit ? ' [' + info.unit + ']' : ''}`), cb);
  };
  const viewRow = (id) => h('div.item', { class: cur.comp === id ? 'selected' : '', on: { click: async () => { await updateSettings({ [`panel${key}`]: id, [`panel${key}2`]: null }); s.close(); } } }, h('span.lbl', t(CHANNELS[id].label)));

  items.push(h('div.small.muted', { style: { padding: '6px 16px' } }, t('secondary_hint')));
  items.push(h('div.group', t('group_basic')));
  for (const id of ['speed', 'glon', 'glat', 'gvert', 'gcomb', 'dev', 'alt', 'hdg']) items.push(numRow(id));
  items.push(h('div.group', t('group_views')));
  for (const id of ['timeslip', 'map', 'detail', 'overview', 'sections']) items.push(viewRow(id));
  items.push(h('div.group', t('group_gyro')));
  for (const id of ['gyrY', 'gyrP', 'gyrR']) items.push(numRow(id));
  const obd = ['rpm', 'thr', 'wt', 'ot', 'os'].filter((id) => data.some((d) => d.lap.channels[CHANNELS[id].avail]));
  if (obd.length) { items.push(h('div.group', t('group_obd'))); for (const id of obd) items.push(numRow(id)); }
  const custom = new Set(); for (const d of data) for (const c of d.lap.channels.custom || []) custom.add(c.name);
  if (custom.size) { items.push(h('div.group', 'Custom CAN')); for (const name of custom) items.push(numRow('custom:' + name)); }
  const s = sheet(t('select_component'), items);
}

// ------------------------------------------------------------------ options sheet
function openOptions() {
  const s0 = state.settings;
  const row = (label, control, sub) => h('div.item', h('div.lbl', h('div', label), sub ? h('div.small.muted', sub) : null), control);
  const s = sheet(t('options'), [
    row(t('opt_x_mode'), segmented([{ value: 'distance', label: t('distance') }, { value: 'time', label: t('time') }], xMode(), async (v) => { if (v !== xMode()) await toggleXMode(); })),
    row(t('opt_sync_zoom'), switchEl(s0.syncZoom, (v) => updateSettings({ syncZoom: v }))),
    row(t('opt_autoplay'), segmented([0.5, 1, 2, 4].map((x) => ({ value: x, label: x + '×' })), Number(s0.autoplaySpeed) || 1, (v) => updateSettings({ autoplaySpeed: v }))),
    row(t('opt_sectors'), segmented([{ value: 'default', label: t('sectors_default') }, { value: 'custom', label: t('sectors_custom') }, { value: 'none', label: t('sectors_none') }], s0.sectors, (v) => updateSettings({ sectors: v }))),
    h('div.item', { on: { click: () => { s.close(); openCustomSectors(); } } }, h('div.lbl', t('opt_edit_sectors')), h('span', { html: icons.fwd, style: { display: 'inline-flex' } })),
    row(t('opt_all_tracks'), switchEl(s0.allTracks, (v) => updateSettings({ allTracks: v }))),
    row(t('map_tiles'), switchEl(s0.mapTiles, (v) => updateSettings({ mapTiles: v }))),
  ]);
}

function cursorDistance() {
  if (!data.length) return NaN;
  return xMode() === 'time' ? distanceAtTime(data[0].samples, state.cursor) : state.cursor;
}
async function addSplitAt(x) {
  if (!data.length) return;
  const ref = data[0];
  const dm = xMode() === 'time' ? distanceAtTime(ref.samples, x) : x;
  if (!Number.isFinite(dm) || dm <= 0) return;
  const ok = await confirmDialog(t('add_split_at_cursor', { d: Math.round(dm) }), { title: t('opt_edit_sectors'), okLabel: t('add') });
  if (!ok) return;
  await setCustomSplits(ref.lap.track.id, [...customSplits(ref.lap.track.id), dm]);
  if (state.settings.sectors !== 'custom') await updateSettings({ sectors: 'custom' });
}
function openCustomSectors() {
  if (!data.length) { toast(t('select_laps_first')); return; }
  const trackId = data[0].lap.track.id;
  const body = h('div');
  const build = () => {
    clear(body);
    const splits = customSplits(trackId);
    body.appendChild(h('div.small.muted', { style: { padding: '6px 16px' } }, t('custom_sectors_hint')));
    const d = cursorDistance();
    body.appendChild(h('div', { style: { padding: '6px 16px' } }, h('button.btn.accent.block', { on: { click: async () => { await setCustomSplits(trackId, [...splits, d]); if (state.settings.sectors !== 'custom') await updateSettings({ sectors: 'custom' }); build(); } } }, t('add_split_at_cursor', { d: Math.round(d) }))));
    if (!splits.length) body.appendChild(h('div.empty', t('no_splits')));
    splits.forEach((sp, i) => body.appendChild(h('div.item', h('span.lbl', `S${i + 1} → ${sp} m`), h('button.tbtn', { html: icons.trash, on: { click: async () => { await setCustomSplits(trackId, splits.filter((_, j) => j !== i)); build(); } } }))));
  };
  build();
  sheet(t('opt_edit_sectors'), [body]);
}

// ------------------------------------------------------------------ layout: dividers & ratios
function divider(cls) {
  const el = h('div.divider', { class: cls });
  let startY = 0, startRatios = null, rootH = 0, aH = 0, bH = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    startY = e.clientY; startRatios = [...(state.settings.panelRatios || [30, 35, 35])];
    rootH = root.clientHeight; aH = panels.A.el.clientHeight; bH = panels.B.el.clientHeight;
  });
  el.addEventListener('pointermove', (e) => {
    if (!startRatios) return;
    const dy = e.clientY - startY;
    const r = [...startRatios];
    if (cls === 'd0') {
      r[0] = Math.max(10, Math.min(70, startRatios[0] + (dy / Math.max(1, rootH)) * 100));
    } else {
      const na = Math.max(40, aH + dy), nb = Math.max(40, bH - dy);
      r[1] = (na / (na + nb)) * (startRatios[1] + startRatios[2]);
      r[2] = startRatios[1] + startRatios[2] - r[1];
    }
    state.settings.panelRatios = r;
    applyRatios();
  });
  const end = () => { if (startRatios) { startRatios = null; updateSettings({ panelRatios: state.settings.panelRatios }); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return el;
}
function applyRatios() {
  const [r0, r1, r2] = state.settings.panelRatios || [30, 35, 35];
  videoPanel.style.flex = `0 0 ${r0}%`;
  panels.A.el.style.flex = `${r1} 1 0px`;
  panels.B.el.style.flex = `${r2} 1 0px`;
}
