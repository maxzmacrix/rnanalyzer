// Analyzer view: synchronized videos + two configurable chart/map/table panels with a shared cursor.

import {
  state, on, ensureSelectedSamples, lapColor, displayDriver, displayVehicle, setCursor, updateSettings,
  speedFactor, speedUnitLabel, distFactor, distUnitLabel, customSplits, setCustomSplits, videoKeyFor, MAX_VIDEOS, lapLabel,
} from '../state.js';
import { t, fmtDate } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast, sheet, switchEl, segmented, confirmDialog, promptDialog } from '../ui.js';
import { buildXlsx } from '../xlsx.js';
import { shareFiles } from '../share.js';
import { LineChart } from '../chart.js';
import { TrackMap, nearestSample, providerFor } from '../map.js';
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
  const d0 = divider(0);
  const keys = Number(state.settings.panelCount) === 3 ? ['A', 'B', 'C'] : ['A', 'B'];
  panels = {};
  const colChildren = [];
  keys.forEach((k, i) => { panels[k] = createPanel(k); if (i) colChildren.push(divider(i)); colChildren.push(panels[k].el); });
  rightCol = h('div.right-col', ...colChildren);
  root = h('div.analyzer', playBar, videoPanel, d0, rightCol);
  main.appendChild(root);
  applyRatios();

  unsub.push(
    on('selection', load), on('laps', load), on('settings', onSettings), on('cursor', onCursor),
    on('player', (e) => { playBtn.innerHTML = e.playing ? icons.pause : icons.play; }),
    on('sectors', () => refreshPanels()),
    on('theme', () => { for (const p of Object.values(panels)) { if (p.chart) p.chart.requestDraw(); if (p.map) p.map.requestDraw(); } }),
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
  if (root) { root.remove(); root = null; }
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
  if ('mapStyle' in patch || 'customTileUrl' in patch) for (const p of Object.values(panels)) if (p.map) p.map.setProvider(providerFor(state.settings));
  if ('panelCount' in patch) { const main = root.parentElement; unmount(); mount(main); return; }
  const keys = ['panelA', 'panelA2', 'panelB', 'panelB2', 'panelC', 'panelC2', 'xMode', 'sectors', 'units', 'colorblind', 'language'];
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
function panelSetting(key) { return { comp: state.settings[`panel${key}`] || (key === 'A' ? 'speed' : key === 'B' ? 'map' : 'glat'), comp2: state.settings[`panel${key}2`] || null }; }

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
  for (const p of Object.values(panels)) configurePanel(p);
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
        provider: providerFor(state.settings),
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
      if (p.map) {
        p.map.setCursors(cursorPositions());
        if (state.settings.followCursor && data.length && p.map.zoom > (p.map.fitZoom || 0) + 0.3) {
          const pos = positionAt(data[0].samples, state.cursor, xMode());
          p.map.centerOn(pos.lat, pos.lng);
        }
      }
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
    row(t('opt_panels'), segmented([{ value: 2, label: '2' }, { value: 3, label: '3' }], Number(s0.panelCount) === 3 ? 3 : 2, (v) => { s.close(); updateSettings({ panelCount: v }); })),
    row(t('opt_follow'), switchEl(s0.followCursor, (v) => updateSettings({ followCursor: v }))),
    row(t('map_style'), segmented([{ value: 'osm', label: t('map_osm') }, { value: 'satellite', label: t('map_satellite') }, ...(s0.customTileUrl ? [{ value: 'custom', label: t('map_custom') }] : [])], s0.mapStyle || 'osm', (v) => updateSettings({ mapStyle: v }))),
    row(t('map_tiles'), switchEl(s0.mapTiles, (v) => updateSettings({ mapTiles: v }))),
    h('div.item', { on: { click: () => { s.close(); openProfiles(); } } }, h('div.lbl', t('profiles')), h('span', { html: icons.fwd, style: { display: 'inline-flex' } })),
    h('div.item', { on: { click: () => { s.close(); openExcelExport(); } } }, h('div.lbl', t('export_excel')), h('span', { html: icons.fwd, style: { display: 'inline-flex' } })),
  ]);
}

// ------------------------------------------------------------------ layout profiles (Windows "user profiles")
const PROFILE_KEYS = ['panelA', 'panelA2', 'panelB', 'panelB2', 'panelC', 'panelC2', 'panelCount', 'panelRatios', 'xMode', 'sectors'];
function openProfiles() {
  const body = h('div');
  const build = () => {
    clear(body);
    const list = state.settings.profiles || [];
    if (!list.length) body.appendChild(h('div.empty', t('no_profiles')));
    list.forEach((pr, i) => body.appendChild(h('div.item', { on: { click: async () => { s.close(); const patch = {}; for (const k of PROFILE_KEYS) if (k in pr) patch[k] = pr[k]; await updateSettings(patch); toast(t('profile_applied', { n: pr.name })); } } },
      h('span.lbl', pr.name),
      h('button.tbtn', { html: icons.trash, on: { click: async (e) => { e.stopPropagation(); await updateSettings({ profiles: list.filter((_, j) => j !== i) }); build(); } } }))));
    body.appendChild(h('div', { style: { padding: '10px 16px' } }, h('button.btn.block', { on: { click: async () => {
      const r = await promptDialog(t('save_profile'), [{ key: 'name', label: t('profile_name'), value: '' }]);
      if (!r || !r.name.trim()) return;
      const pr = { name: r.name.trim() };
      for (const k of PROFILE_KEYS) pr[k] = state.settings[k];
      await updateSettings({ profiles: [...(state.settings.profiles || []).filter((x) => x.name !== pr.name), pr] });
      build();
    } } }, t('save_profile'))));
  };
  build();
  const s = sheet(t('profiles'), [h('div.small.muted', { style: { padding: '6px 16px' } }, t('profiles_hint')), body]);
}

// ------------------------------------------------------------------ Excel export (Windows "Excel Export": lap list + data by distance step)
function openExcelExport() {
  if (!data.length) { toast(t('select_laps_first')); return; }
  const available = ['speed', 'glon', 'glat', 'gvert', 'gcomb', 'dev', 'alt', 'hdg', 'gyrY', 'gyrP', 'gyrR', ...['rpm', 'thr', 'wt', 'ot', 'os'].filter((id) => data.some((d) => d.lap.channels[CHANNELS[id].avail]))];
  const custom = new Set(); for (const d of data) for (const c of d.lap.channels.custom || []) custom.add('custom:' + c.name);
  available.push(...custom);
  const chosen = new Set(['speed', 'glon', 'glat', 'gcomb', 'alt']);
  const step = h('input.input', { type: 'number', min: 1, max: 500, step: 1, value: 10, inputmode: 'numeric' });
  const rows = available.map((id) => {
    const info = chanInfo(id);
    const cb = h('div.check', { class: chosen.has(id) ? 'on' : '', html: chosen.has(id) ? icons.check : '' });
    return h('div.item', { on: { click: () => { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); cb.classList.toggle('on', chosen.has(id)); cb.innerHTML = chosen.has(id) ? icons.check : ''; } } }, h('span.lbl', `${info.label}${info.unit ? ' [' + info.unit + ']' : ''}`), cb);
  });
  const s = sheet(t('export_excel'), [
    h('div.small.muted', { style: { padding: '6px 16px' } }, t('excel_hint', { n: data.length })),
    h('div.field', { style: { padding: '6px 16px' } }, h('label', t('excel_step')), step),
    h('div.group', t('excel_channels')),
    ...rows,
    h('div', { style: { padding: '12px 16px 16px' } }, h('button.btn.accent.block', { on: { click: async () => {
      const st = Math.max(1, Number(step.value) || 10);
      s.close();
      toast(t('generating'), 20000);
      try {
        const blob = buildLapsWorkbook([...chosen], st);
        const name = `RN-Analyzer-${fmtDate(Date.now())}-${data.length}laps.xlsx`;
        const res = await shareFiles([new File([blob], name, { type: blob.type })], name);
        toast(res === 'downloaded' ? t('share_unsupported') : t('done'), 3000);
      } catch (e) { toast(t('action_failed', { e: e.message || e }), 5000); }
    } } }, t('generate'))),
  ]);
}
function buildLapsWorkbook(channelIds, step) {
  const lapList = [['No', t('driver'), t('vehicle'), t('lap_time'), t('lap_number'), t('track'), t('event'), t('start_time'), t('device')]];
  data.forEach((d, i) => lapList.push([i + 1, displayDriver(d.lap), displayVehicle(d.lap), fmtLapTime(d.lap.lapTimeMs), d.lap.lapNumber, d.lap.track.name, d.lap.event.name, fmtDate(d.lap.startMs), d.lap.source.device]));
  const header = [`${t('distance')} [${distUnitLabel()}]`];
  for (const d of data) {
    header.push(`L${d.lap.lapNumber} ${displayDriver(d.lap)}: ${t('lap_time')} [s]`);
    for (const id of channelIds) { const info = chanInfo(id); header.push(`L${d.lap.lapNumber} ${displayDriver(d.lap)}: ${info.label}${info.unit ? ' [' + info.unit + ']' : ''}`); }
  }
  const rowsOut = [header];
  const dmax = Math.max(...data.map((d) => d.samples.d[d.samples.n - 1] || 0));
  for (let dist = 0; dist <= dmax + 1e-6; dist += step) {
    const row = [Math.round(dist * distFactor() * 100) / 100];
    for (const d of data) {
      const end = d.samples.d[d.samples.n - 1];
      if (dist > end) { row.push(null); for (let k = 0; k < channelIds.length; k++) row.push(null); continue; }
      row.push(Math.round(timeAtDistance(d.samples, dist) * 1000) / 1000);
      for (const id of channelIds) { const v = valueAt(d.samples, id, dist, 'distance') * scaleFor(id); row.push(Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null); }
    }
    rowsOut.push(row);
  }
  return buildXlsx([{ name: 'Lap list', rows: lapList, widths: [5, 18, 22, 12, 8, 18, 22, 12, 14] }, { name: 'Data', rows: rowsOut, widths: [12, ...Array(header.length - 1).fill(20)] }]);
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
function ratios() { const r = [...(state.settings.panelRatios || [30, 35, 35, 35])]; while (r.length < 4) r.push(35); return r; }
/** idx 0 = between videos and the panel column; idx >= 1 = between panel idx-1 and panel idx */
function divider(idx) {
  const el = h('div.divider', { class: idx === 0 ? 'd0' : 'd' + idx });
  let startY = 0, startRatios = null, rootH = 0, aH = 0, bH = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    startY = e.clientY; startRatios = ratios(); rootH = root.clientHeight;
    const keys = Object.keys(panels);
    if (idx > 0) { aH = panels[keys[idx - 1]].el.clientHeight; bH = panels[keys[idx]].el.clientHeight; }
  });
  el.addEventListener('pointermove', (e) => {
    if (!startRatios) return;
    const dy = e.clientY - startY;
    const r = [...startRatios];
    if (idx === 0) r[0] = Math.max(10, Math.min(70, startRatios[0] + (dy / Math.max(1, rootH)) * 100));
    else {
      const na = Math.max(40, aH + dy), nb = Math.max(40, bH - dy);
      const sum = startRatios[idx] + startRatios[idx + 1];
      r[idx] = (na / (na + nb)) * sum; r[idx + 1] = sum - r[idx];
    }
    state.settings.panelRatios = r;
    applyRatios();
  });
  const end = () => { if (startRatios) { startRatios = null; updateSettings({ panelRatios: state.settings.panelRatios }); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return el;
}
function applyRatios() {
  const r = ratios();
  videoPanel.style.flex = `0 0 ${r[0]}%`;
  Object.keys(panels).forEach((k, i) => { panels[k].el.style.flex = `${r[i + 1]} 1 0px`; });
}
