// Analyzer view: synchronized videos + two configurable chart/map/table panels with a shared cursor.

import {
  state, on, ensureSelectedSamples, lapColor, displayDriver, displayVehicle, setCursor, updateSettings,
  speedFactor, speedUnitLabel, distFactor, distUnitLabel, customSplits, setCustomSplits, videoKeyFor, MAX_VIDEOS, lapLabel, refLapId, isDarkTheme,
} from '../state.js';
import { t, fmtDate } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast, sheet, switchEl, segmented, confirmDialog, promptDialog } from '../ui.js';
import { buildXlsx } from '../xlsx.js';
import { shareFiles } from '../share.js';
import { LineChart, ScatterChart, StripChart } from '../chart.js';
import { coachCompare, cornerAt, whatIfApex, detectCorners } from '../coach.js';
import { detectHighlights } from '../highlights.js';

import { aiStatus, aiNarrate } from '../ai.js';
import { getLanguage } from '../i18n.js';
import { TrackMap, nearestSample, providerFor } from '../map.js';
import {
  CHANNELS, channelArray, xArray, valueAt, positionAt, timeSlipSeries, distanceGapSeries, deviceSplits, deviceSectorTimes,
  sectorTimesFromSplits, bestTimes, geometricSplits, timeAtDistance, distanceAtTime, interpAt,
} from '../analysis.js';
import { db } from '../db.js';
import { player } from '../sync.js';
import { openLapPicker } from './laps.js';

let root, rightCol, videoPanel, videoGrid, playBtn, speedChip, posLbl, refLbl, gapLbl;
let data = []; // [{lap, samples, color}]
let panels = {};
let unsub = [];
const videoObjs = new Map(); // lapId -> { el, url, cell, key }
const scaledCache = new Map();
let cursorRaf = 0;

// ------------------------------------------------------------------ mount / unmount
export function mount(main) {
  setTitle(t('nav_analyze'));
  setTopButtons(
    [tbtn(t('change_laps'), () => openLapPicker(), { icon: 'edit' })],
    [tbtn(t('options'), openOptions, { icon: 'options' })],
  );

  playBtn = h('button.tbtn.primary', { html: icons.play, 'aria-label': t('play'), on: { click: () => player.toggle() } });
  const rewindBtn = h('button.tbtn.rewind', { title: t('rewind_5'), 'aria-label': t('rewind_5'), on: { click: rewind5 } }, h('span.ticon', { html: icons.back }), h('span', '5 s'));
  speedChip = h('button.chip', { on: { click: cycleSpeed } }, `${Number(state.settings.autoplaySpeed) || 1}×`);
  posLbl = h('span.pos', '');
  gapLbl = h('span.gaps.grow', '');
  refLbl = h('span.small', '');
  const playBar = h('div.play-bar', rewindBtn, playBtn, speedChip, posLbl, gapLbl, refLbl);

  videoGrid = h('div.videos');
  videoRo = new ResizeObserver(() => fitVideoCells()); videoRo.observe(videoGrid);
  videoPanel = h('div.panel.video-panel', videoGrid);
  const d0 = divider(0);
  const keys = autoPanelCount() === 3 ? ['A', 'B', 'C'] : ['A', 'B'];
  panels = {};
  const colChildren = [];
  keys.forEach((k, i) => { panels[k] = createPanel(k); if (i) colChildren.push(divider(i)); colChildren.push(panels[k].el); });
  rightCol = h('div.right-col', ...colChildren);
  root = h('div.analyzer', videoPanel, d0, rightCol, playBar);
  main.appendChild(root);
  applyRatios();
  if (state.settings.maxPanel) applyMaxPanel(state.settings.maxPanel);

  unsub.push(
    on('selection', load), on('laps', load), on('settings', onSettings), on('cursor', onCursor),
    on('player', (e) => { playBtn.innerHTML = e.playing ? icons.pause : icons.play; }),
    on('sectors', () => refreshPanels()),
    on('theme', () => onSettings({ theme: true })),
    on('theme', () => { for (const p of Object.values(panels)) { if (p.chart) p.chart.requestDraw(); if (p.map) p.map.requestDraw(); } }),
    on('resize', () => sizeBigVideo()),
  );
  playBtn.innerHTML = player.playing ? icons.pause : icons.play;
  load();
}

export function unmount() {
  unsub.forEach((u) => u()); unsub = [];
  for (const p of Object.values(panels)) destroyPanelContent(p);
  panels = {}; maxPanelKey = null;
  player.pause();
  player.clearVideos();
  for (const v of videoObjs.values()) { try { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); } catch { /* ignore */ } URL.revokeObjectURL(v.url); }
  videoObjs.clear(); bigVideo = null;
  if (videoRo) { videoRo.disconnect(); videoRo = null; }
  scaledCache.clear();
  if (cursorRaf) cancelAnimationFrame(cursorRaf); cursorRaf = 0;
  if (root) { root.remove(); root = null; }
}

// ------------------------------------------------------------------ loading
async function load() {
  const d = await ensureSelectedSamples();
  if (!root) return; // view was left while samples were loading
  const refId = refLapId();
  data = [...d].sort((a, b) => (a.lap.id === refId ? -1 : b.lap.id === refId ? 1 : 0));
  if (hlLapId && !data.some((x) => x.lap.id === hlLapId)) hlLapId = null;
  scaledCache.clear();
  refreshSlips();
  updateRefLabel();
  await updateVideos();
  if (!root) return;
  refreshPanels();
  updatePos();
}
/** Gap series of every compared lap vs. the fastest lap (positive = losing time), for the play bar and the map. */
function refreshSlips() {
  const ref = data[0];
  for (const d of data) d.slip = null;
  if (!ref) return;
  for (const d of data.slice(1)) d.slip = xMode() === 'time' ? distanceGapSeries(d.samples, ref.samples) : timeSlipSeries(d.samples, ref.samples);
}
function autoPanelCount() { return window.innerHeight >= 900 && window.innerWidth >= 700 ? 3 : 2; }

function updateRefLabel() {
  clear(refLbl);
  if (!data.length) { refLbl.textContent = t('select_laps_first'); return; }
  refLbl.append(h('span', { style: { color: data[0].color, fontWeight: 700 } }, `${t('reference')}: ${lapLabel(data[0].lap)}`), h('span.mono.small.muted', ` ${fmtLapTime(data[0].lap.lapTimeMs)}`));
  refLbl.classList.toggle('hidden', data.length < 2);
}

function xMode() { return state.settings.xMode === 'time' ? 'time' : 'distance'; }
function xModeLabel() { return xMode() === 'time' ? t('time') : t('distance'); }
async function toggleXMode() {
  const ref = data[0];
  const cur = state.cursor;
  const next = xMode() === 'time' ? 'distance' : 'time';
  await updateSettings({ xMode: next });
  refreshSlips();
  if (ref) setCursor(next === 'time' ? timeAtDistance(ref.samples, cur) : distanceAtTime(ref.samples, cur), 'analyzer');
}
function rewind5() {
  if (!data.length) return;
  const ref = data[0];
  const tRef = xMode() === 'time' ? state.cursor : timeAtDistance(ref.samples, state.cursor);
  const tNew = Math.max(0, tRef - 5);
  setCursor(xMode() === 'time' ? tNew : distanceAtTime(ref.samples, tNew), 'analyzer');
  for (const id of videoObjs.keys()) player.seekVideo(id, true);
}
function cycleSpeed() {
  const opts = [0.25, 0.5, 1, 2]; // 4× makes the videos unwatchable; slow motion is what a driver needs in a corner
  const cur = Number(state.settings.autoplaySpeed) || 1;
  const next = opts[(opts.indexOf(cur) + 1) % opts.length];
  updateSettings({ autoplaySpeed: next });
}
function onSettings(patch) {
  if (!patch) return;
  if ('autoplaySpeed' in patch) { speedChip.textContent = `${patch.autoplaySpeed}×`; player.setSpeed(Number(patch.autoplaySpeed)); }
  if ('mapTiles' in patch) for (const p of Object.values(panels)) if (p.map) p.map.setTiles(patch.mapTiles);
  if ('mapStyle' in patch || 'customTileUrl' in patch) for (const p of Object.values(panels)) if (p.map) p.map.setProvider(providerFor(state.settings));
  if ('maxPanel' in patch && (patch.maxPanel || null) !== maxPanelKey) applyMaxPanel(patch.maxPanel); // changed from outside (guided tour)
  const keys = ['panelA', 'panelA2', 'panelB', 'panelB2', 'panelC', 'panelC2', 'stripChannels', 'xMode', 'sectors', 'units', 'theme', 'language'];
  if (keys.some((k) => k in patch)) { scaledCache.clear(); data = data.map((d) => ({ ...d, color: lapColor(d.lap.id) })); if ('xMode' in patch) refreshSlips(); updateRefLabel(); refreshPanels(); updateVideoColors(); updatePos(); }
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
    const label = h('div.vlabel', h('b', `L${d.lap.lapNumber}`), ` ${displayDriver(d.lap)}`, h('span.mono.vtime', ` · ${fmtLapTime(d.lap.lapTimeMs)}`));
    const hud = h('div.vhud.mono');
    const sound = h('button.vsound', { html: icons.mute, title: t('sound'), on: { click: (e) => {
      e.stopPropagation();
      const wasMuted = el.muted;
      for (const o of videoObjs.values()) { o.el.muted = true; o.sound.innerHTML = icons.mute; }
      el.muted = !wasMuted; sound.innerHTML = el.muted ? icons.mute : icons.sound;
    } } });
    const cell = h('div.vcell', { style: { '--lap-color': d.color } }, el, label, hud, sound);
    // tap = this video large (others hidden, video panel grows), tap again = back to the grid
    cell.addEventListener('click', () => toggleBigVideo(cell));
    videoGrid.appendChild(cell);
    const vo = { el, url, cell, key, hud, sound, ratio: DEFAULT_RATIO };
    videoObjs.set(d.lap.id, vo);
    player.registerVideo(d.lap.id, el, d.lap.video ? d.lap.video.offsetS : 0);
    el.addEventListener('loadedmetadata', () => {
      // the cell takes the picture's own shape (RN recordings are 5:3, phone clips 16:9 or portrait)
      if (el.videoWidth > 0 && el.videoHeight > 0) { vo.ratio = el.videoWidth / el.videoHeight; cell.style.aspectRatio = String(vo.ratio); fitVideoCells(); if (cell === bigVideo) sizeBigVideo(); }
      player.seekVideo(d.lap.id, true);
    });
  }
  // the enlarged video's lap left the selection: back to the grid, otherwise every remaining cell stays hidden
  if (bigVideo && ![...videoObjs.values()].some((v) => v.cell === bigVideo)) {
    bigVideo = null;
    videoGrid.classList.remove('max'); root.classList.remove('video-max');
    sizeBigVideo();
  }
  // order cells like selection
  for (const d of withVideo) { const v = videoObjs.get(d.lap.id); if (v) videoGrid.appendChild(v.cell); }
  videoGrid.classList.toggle('one', videoObjs.size === 1);
  const has = videoObjs.size > 0;
  root.classList.toggle('has-video', has);
  videoPanel.classList.toggle('hidden', !has);
  root.querySelector('.divider.d0').classList.toggle('hidden', !has);
  if (data.filter((d) => videoKeyFor(d.lap)).length > MAX_VIDEOS) toast(t('videos_limit_hint', { n: MAX_VIDEOS }), 2500);
  fitVideoCells();
}
let videoRo = null;
const DEFAULT_RATIO = 16 / 9; // until the video's metadata says otherwise
/** Every video cell has its video's own aspect ratio and is centred in its grid area: no letterbox bars inside the cell, the app background shows around it instead. */
function fitVideoCells() {
  if (!videoGrid) return;
  if (videoGrid.classList.contains('max')) { for (const v of videoObjs.values()) { v.cell.style.width = ''; v.cell.style.height = ''; } return; }
  const n = videoObjs.size;
  if (!n) return;
  const cols = Math.max(1, getComputedStyle(videoGrid).gridTemplateColumns.split(' ').filter(Boolean).length);
  const rows = Math.ceil(n / cols);
  const gap = 4, pad = 4;
  const cw = (videoGrid.clientWidth - 2 * pad - gap * (cols - 1)) / cols, ch = (videoGrid.clientHeight - 2 * pad - gap * (rows - 1)) / rows;
  for (const v of videoObjs.values()) {
    const w = Math.max(40, Math.min(cw, ch * v.ratio));
    v.cell.style.width = `${Math.floor(w)}px`; v.cell.style.height = `${Math.floor(w / v.ratio)}px`;
  }
}
function updateVideoColors() { for (const [id, v] of videoObjs) v.cell.style.setProperty('--lap-color', lapColor(id)); }
let bigVideo = null;
function toggleBigVideo(cell) {
  const makeBig = bigVideo !== cell;
  bigVideo = makeBig ? cell : null;
  for (const v of videoObjs.values()) v.cell.classList.toggle('big', v.cell === bigVideo);
  videoGrid.classList.toggle('max', !!bigVideo);
  root.classList.toggle('video-max', !!bigVideo);
  sizeBigVideo();
  fitVideoCells();
  requestAnimationFrame(() => { for (const p of Object.values(panels)) { if (p.chart) p.chart.requestDraw(); if (p.map) p.map.requestDraw(); if (p.scatter) p.scatter.draw(); } });
}
/** The enlarged video takes the panel width in its own aspect ratio, but never more than 60 % of the height – panels and play bar stay visible. */
function sizeBigVideo() {
  if (!root) return;
  if (!bigVideo) { applyRatios(); return; }
  const avail = root.clientHeight || window.innerHeight;
  const w = videoPanel.clientWidth || root.clientWidth;
  const big = [...videoObjs.values()].find((v) => v.cell === bigVideo);
  const h = Math.min(avail * 0.6, w / (big ? big.ratio : DEFAULT_RATIO) + 8);
  videoPanel.style.flex = `0 0 ${Math.round(h)}px`;
}
function updateVideoHud() {
  for (const [id, v] of videoObjs) {
    const d = data.find((x) => x.lap.id === id);
    if (!d || !v.hud) continue;
    const tLap = xMode() === 'time' ? state.cursor : timeAtDistance(d.samples, state.cursor);
    const sp = valueAt(d.samples, 'speed', state.cursor, xMode()) * speedFactor();
    v.hud.textContent = `${Number.isFinite(sp) ? sp.toFixed(0) : '–'} ${speedUnitLabel()} · ${fmtLapTime(tLap * 1000)}`;
  }
}

// ------------------------------------------------------------------ panels
function createPanel(key) {
  const body = h('div.panel-body');
  const titleChip = h('button.chip', { on: { click: () => openComponentSheet(key) } }, '…');
  // one panel can take the whole screen: videos, the other panels and the dividers step aside until the button is tapped again
  const maxBtn = h('button.chip.icon.max', { title: t('panel_maximize'), 'aria-label': t('panel_maximize'), html: icons.expand, on: { click: () => toggleMaxPanel(key) } });
  // views that draw channels get a "Channels" chip: the one place where channels are chosen
  const chanBtn = h('button.chip.chan.hidden', { on: { click: () => { const k = panels[key].kind; openChannelPicker(key, k === 'strips' ? 'strips' : k === 'timeslip' ? 'second' : 'chart'); } } }, t('channels_btn'));
  const el = h('div.panel', body, h('div.panel-title', titleChip, chanBtn, maxBtn));
  return { key, el, body, titleChip, chanBtn, maxBtn, kind: null, chart: null, map: null, table: null, compId: null, comp2Id: null };
}
let maxPanelKey = null;
/** One panel takes the screen. Stored in the settings, so the state survives tab switches and restarts. */
function toggleMaxPanel(key) {
  applyMaxPanel(maxPanelKey === key ? null : key);
  updateSettings({ maxPanel: maxPanelKey });
}
function applyMaxPanel(key) {
  maxPanelKey = key && panels[key] ? key : null;
  root.classList.toggle('panel-max', !!maxPanelKey);
  for (const [k, p] of Object.entries(panels)) {
    p.el.classList.toggle('hidden', !!maxPanelKey && k !== maxPanelKey);
    p.maxBtn.innerHTML = maxPanelKey === k ? icons.shrink : icons.expand;
    p.maxBtn.title = p.maxBtn.ariaLabel = maxPanelKey === k ? t('panel_restore') : t('panel_maximize');
  }
  requestAnimationFrame(() => { for (const p of Object.values(panels)) { if (p.chart) p.chart.resize(); if (p.map) p.map.requestDraw(); if (p.scatter) p.scatter.draw(); } });
}
function destroyPanelContent(p) {
  if (p.chart) { p.chart.destroy(); p.chart = null; }
  if (p.scatter) { p.scatter.destroy(); p.scatter = null; }
  if (p.map) { p.map.destroy(); p.map = null; }
  p.table = null; p.kind = null;
  p.body.classList.remove('scroll-y');
  clear(p.body);
}
function panelSetting(key) {
  let comp = state.settings[`panel${key}`] || (key === 'A' ? 'timeslip' : key === 'B' ? 'map' : 'glat');
  let comp2 = state.settings[`panel${key}2`] || null;
  // the gap needs two laps – with one lap the panel shows speed until a second lap is selected
  if (comp === 'timeslip' && data.length < 2) { comp = comp2 && kindOf(comp2) === 'number' ? comp2 : 'speed'; comp2 = null; }
  return { comp, comp2 };
}

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
  const css = getComputedStyle(document.documentElement);
  const color = (mode === 'custom' ? css.getPropertyValue('--sector-custom') : css.getPropertyValue('--sector-default')).trim() || '#6be5f6';
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
        onView: (x0, x1) => { for (const o of Object.values(panels)) if (o !== p && o.chart) o.chart.setView(x0, x1, true); }, // always in sync
        onLongPress: (x) => addSplitAt(x),
      });
    } else if (kind === 'strips') {
      // the stacked channels can be taller than the panel: the body scrolls, the canvas grows with the strip count
      const canvas = h('canvas');
      p.body.classList.add('scroll-y');
      p.body.appendChild(canvas);
      p.chart = new StripChart(canvas, {
        onCursor: (x) => setCursor(x, `panel${p.key}`),
        onView: (x0, x1) => { for (const o of Object.values(panels)) if (o !== p && o.chart) o.chart.setView(x0, x1, true); },
        onLongPress: (x) => addSplitAt(x),
      });
    } else if (kind === 'scatter') {
      const canvas = h('canvas');
      p.body.appendChild(canvas);
      p.scatter = new ScatterChart(canvas);
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
    } else {
      p.table = h('div.table-wrap');
      p.body.appendChild(p.table);
    }
  }
  p.compId = comp; p.comp2Id = (kind === 'number' || kind === 'timeslip') && kindOf(comp2) === 'number' ? comp2 : null;
  const info = chanInfo(comp) || { label: comp };
  const info2 = p.comp2Id ? chanInfo(p.comp2Id) : null;
  p.titleChip.textContent = info2 ? `${info.label} + ${info2.label}` : info.label;
  p.chanBtn.classList.toggle('hidden', !(kind === 'number' || kind === 'timeslip' || kind === 'strips'));
  requestAnimationFrame(() => { if (p.chart) p.chart.setReserveRight(p.titleChip.parentElement.offsetWidth + 20); });
  renderPanel(p);
  syncChartGutters();
}
/** Charts stacked in the column share one right gutter: a second curve's axis in one panel must not shift its plot against the others. */
function syncChartGutters() {
  const list = Object.values(panels).filter((o) => o.chart);
  const wide = list.some((o) => o.chart.series2 && o.chart.series2.length);
  for (const o of list) o.chart.setRightGutter(wide ? 46 : 0);
}

function renderPanel(p) {
  if (!p.kind) return;
  if (p.kind === 'number') renderNumber(p);
  else if (p.kind === 'timeslip') renderTimeSlip(p);
  else if (p.kind === 'strips') renderStrips(p);
  else if (p.kind === 'map') renderMap(p);
  else if (p.kind === 'scatter') renderScatter(p);
  else if (p.kind === 'coach') renderCoach(p);
  else if (p.kind === 'highlights') renderHighlights(p);
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
    series, series2, markers: [...sectorMarkers(), ...highlightMarkers()], xMax: xMaxAll(),
    xLabel: xLabelText(), yLabel: `${info.label}${info.unit ? ' [' + info.unit + ']' : ''}`, y2Label: info2 ? `${info2.label}${info2.unit ? ' [' + info2.unit + ']' : ''}` : '',
    fmt: fmtNum(info.decimals), fmt2: info2 ? fmtNum(info2.decimals) : null, fmtX,
    zeroLine: /^g/.test(p.compId) || p.compId.startsWith('gyr'),
    empty: data.length ? '' : t('select_laps_first'),
  });
  p.chart.setCursor(state.cursor);
}

function renderTimeSlip(p) {
  const series = [], series2 = [];
  const info2 = p.comp2Id ? chanInfo(p.comp2Id) : null;
  if (data.length >= 2) {
    for (const d of data.slice(1)) if (d.slip) series.push({ ...d.slip, color: d.color, label: lapLabel(d.lap) });
  }
  if (info2) for (const d of data) { const y2 = yArr(d, p.comp2Id); if (y2) series2.push({ x: xArray(d.samples, xMode()), y: y2, n: d.samples.n, color: d.color }); }
  const timeMode = xMode() === 'time';
  p.chart.setData({
    series, series2, markers: [...sectorMarkers(), ...highlightMarkers()], xMax: xMaxAll(), xLabel: xLabelText(),
    yLabel: timeMode ? `Δ ${t('distance')} [m]` : `${t('ch_timeslip')} [s]`,
    y2Label: info2 ? `${info2.label}${info2.unit ? ' [' + info2.unit + ']' : ''}` : '',
    fmt: (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) : '–'), fmt2: info2 ? fmtNum(info2.decimals) : null, fmtX, zeroLine: true,
    empty: data.length < 2 ? t('select_two_for_timeslip') : '',
  });
  p.chart.setCursor(state.cursor);
}

// ------------------------------------------------------------------ channel strips (time-distance view)
const DEFAULT_STRIPS = ['speed', 'glon', 'glat', 'gyrY', 'rpm', 'thr'];
/** Channels the strip panel shows: the user's choice, reduced to what the selected laps carry; never empty while laps are selected. */
function stripChannels() {
  const wanted = Array.isArray(state.settings.stripChannels) && state.settings.stripChannels.length ? state.settings.stripChannels : DEFAULT_STRIPS;
  // OBD/health channels count only when the lap really carries them (the file holds -1 placeholders otherwise)
  const have = (id) => { const c = CHANNELS[id]; if (c && c.avail && !data.some((d) => d.lap.channels[c.avail])) return false; return chanInfo(id) && kindOf(id) === 'number' && data.some((d) => yArr(d, id)); };
  const list = wanted.filter(have);
  return list.length || !data.length ? list : ['speed', 'glon', 'glat'].filter(have);
}
let cornerCache = { key: '', corners: [] };
/** Corner windows of the reference lap in the current x units, for the band on top of the strips. */
function stripCorners() {
  if (!data.length) return [];
  const ref = data[0];
  const key = `${ref.lap.id}|${xMode()}`;
  if (cornerCache.key !== key) {
    const toX = (d) => (xMode() === 'time' ? timeAtDistance(ref.samples, d) : d);
    cornerCache = { key, corners: detectCorners(ref).map((c) => ({ num: c.num, start: toX(c.start), end: toX(c.end) })) };
  }
  return cornerCache.corners;
}
function renderStrips(p) {
  const strips = [];
  for (const id of stripChannels()) {
    const info = chanInfo(id);
    const series = [];
    for (const d of data) { const y = yArr(d, id); if (y) series.push({ x: xArray(d.samples, xMode()), y, n: d.samples.n, color: d.color, label: lapLabel(d.lap) }); }
    strips.push({ label: info.label, unit: info.unit, series, fmt: fmtNum(info.decimals), zeroLine: /^g/.test(id) || id.startsWith('gyr') });
  }
  p.chart.setData({
    strips, corners: stripCorners(), markers: [...sectorMarkers(), ...highlightMarkers()], xMax: xMaxAll(), xLabel: xLabelText(), fmtX,
    empty: data.length ? '' : t('select_laps_first'),
  });
  p.chart.setCursor(state.cursor);
}
/** Channels the selected laps offer, grouped for the picker: basic, gyroscope, OBD, health, custom CAN. */
function channelGroups() {
  const has = (id) => data.some((d) => d.lap.channels[CHANNELS[id].avail]);
  const groups = [
    { label: t('group_basic'), ids: ['speed', 'glon', 'glat', 'gvert', 'gcomb', 'dev', 'alt', 'hdg'] },
    { label: t('group_gyro'), ids: ['gyrY', 'gyrP', 'gyrR'] },
    { label: t('group_obd'), ids: ['rpm', 'thr', 'wt', 'ot', 'os'].filter(has) },
    { label: t('group_health'), ids: ['hr'].filter(has) },
  ];
  const custom = new Set(); for (const d of data) for (const c of d.lap.channels.custom || []) custom.add('custom:' + c.name);
  groups.push({ label: 'CAN', ids: [...custom] });
  return groups.filter((g) => g.ids.length);
}
function chanTitle(id) { const info = chanInfo(id); return info ? `${info.label}${info.unit ? ' [' + info.unit + ']' : ''}` : id; }
/**
 * The one place where channels are chosen. mode 'chart': tap = main curve, checkbox = second curve (panel `key`);
 * 'second': the extra curve over the gap chart; 'strips': the channels of the strip panel (multi-select, Done).
 */
function openChannelPicker(key, mode) {
  const container = h('div');
  let s = null;
  const cur = panelSetting(key);
  const chosen = new Set(mode === 'strips' ? stripChannels() : []);
  const build = () => {
    clear(container);
    if (mode === 'chart') container.appendChild(h('div.small.muted', { style: { padding: '6px 16px' } }, t('picker_hint_chart')));
    if (mode === 'strips') container.appendChild(h('div.small.muted', { style: { padding: '6px 16px' } }, t('strips_hint')));
    if (mode === 'second') {
      const none = !cur.comp2;
      container.appendChild(h('div.item', { class: none ? 'selected' : '', on: { click: async () => { await updateSettings({ [`panel${key}2`]: null }); s.close(); } } }, h('span.lbl', t('second_curve_none'))));
    }
    for (const g of channelGroups()) {
      container.appendChild(h('div.group', g.label));
      for (const id of g.ids) {
        if (mode === 'strips') {
          const cb = h('div.check', { class: chosen.has(id) ? 'on' : '', html: chosen.has(id) ? icons.check : '' });
          container.appendChild(h('div.item', { on: { click: () => { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); cb.classList.toggle('on', chosen.has(id)); cb.innerHTML = chosen.has(id) ? icons.check : ''; } } }, h('span.lbl', chanTitle(id)), cb));
        } else if (mode === 'second') {
          container.appendChild(h('div.item', { class: cur.comp2 === id ? 'selected' : '', on: { click: async () => { await updateSettings({ [`panel${key}2`]: cur.comp2 === id ? null : id }); s.close(); } } }, h('span.lbl', chanTitle(id))));
        } else {
          const isPrimary = cur.comp === id, isSecondary = cur.comp2 === id;
          const cb = h('div.check', { class: `${isSecondary ? 'on' : ''} ${isPrimary ? 'disabled' : ''}`, html: isSecondary ? icons.check : '' });
          cb.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isPrimary) return;
            await updateSettings({ [`panel${key}2`]: isSecondary ? null : id });
            Object.assign(cur, panelSetting(key)); build(); // the sheet stays open: a checkbox is a quick toggle
          });
          container.appendChild(h('div.item', { class: isPrimary ? 'selected' : '', on: { click: async () => { await updateSettings({ [`panel${key}`]: id, [`panel${key}2`]: cur.comp2 === id ? null : cur.comp2 }); s.close(); } } }, h('span.lbl', chanTitle(id)), cb));
        }
      }
    }
    if (mode === 'strips') {
      const all = channelGroups().flatMap((g) => g.ids);
      container.appendChild(h('div', { style: { padding: '10px 16px' } }, h('button.btn.accent.block', { on: { click: async () => { await updateSettings({ stripChannels: all.filter((id) => chosen.has(id)) }); s.close(); } } }, t('done'))));
    }
  };
  build();
  s = sheet(mode === 'strips' ? t('ch_strips') : mode === 'second' ? t('second_curve') : t('pick_channel'), [container]);
}

// ------------------------------------------------------------------ corner coach
let coachCache = { key: '', result: null, cmp: null, aiText: '', aiPending: false, aiFailed: false };
function coachTarget() { return data.length < 2 ? null : data.slice(1).reduce((a, b) => (b.lap.lapTimeMs > a.lap.lapTimeMs ? b : a)); }
function coachResult() {
  const cmp = coachTarget();
  if (!cmp) return null;
  const key = `${data[0].lap.id}|${cmp.lap.id}|${state.settings.units}|${getLanguage()}`;
  if (coachCache.key !== key) coachCache = { key, result: coachCompare(data[0], cmp), cmp, aiText: '', aiPending: false, aiFailed: false };
  return coachCache;
}
function cornerLabel(c) { const m = /(\d+)/.exec(c.name || ''); return m ? t('corner', { n: m[1] }) : (c.name || t('corner', { n: c.num })); }
function fmtGap(s) { return `${s > 0 ? '+' : s < 0 ? '−' : ''}${Math.abs(s).toFixed(2)} s`; }
function factText(f) {
  const imp = state.settings.units === 'imperial';
  const dist = (m) => ({ m: Math.round(imp ? m * 3.28084 : m), u: imp ? 'ft' : 'm' });
  const spd = (v) => ({ v: Math.round(v * speedFactor()), u: speedUnitLabel() });
  if ('m' in f) return t(f.key, dist(f.m));
  if ('v' in f) return t(f.key, spd(f.v));
  return t(f.key, f);
}
/** What-if step: +5 km/h (metric) or +3 mph (imperial) at the apex, as m/s and as a label. */
function whatIfStep() { return state.settings.units === 'imperial' ? { dv: 3 / 2.2369363, v: 3, u: 'mph' } : { dv: 5 / 3.6, v: 5, u: 'km/h' }; }
/** "+5 km/h at the apex ≈ −0.12 s" for one corner, or '' when the estimate is below the reporting threshold. */
function whatIfText(cmp, c) {
  const st = whatIfStep();
  const s = whatIfApex(cmp.samples, c, st.dv);
  return Number.isFinite(s) && s >= 0.01 ? t('coach_whatif', { v: st.v, u: st.u, s: s.toFixed(2) }) : '';
}
/** The coach facts as plain lines – shown as template text and handed to the on-device model. */
function coachLines(cc) {
  const { result, cmp } = cc, ref = data[0];
  const lines = [t('coach_vs', { lap: lapLabel(cmp.lap), ref: lapLabel(ref.lap), gap: fmtGap(result.total) })];
  for (const c of result.ranked.slice(0, 6)) {
    const wi = whatIfText(cmp, c);
    lines.push(`${cornerLabel(c)}: ${fmtGap(c.lost)}${c.facts.length ? ' – ' + c.facts.map(factText).join(', ') : ''}${wi ? ' – ' + wi : ''}`);
  }
  for (const p of result.patterns) lines.push(t(p.key, p));
  return lines;
}
function templateNarrative(cc) {
  const { result } = cc;
  const parts = [];
  if (result.ranked.length) parts.push(t('coach_summary_top', { list: result.ranked.slice(0, 3).map((c) => `${cornerLabel(c)} (${fmtGap(c.lost)})`).join(', ') }));
  else parts.push(t('coach_summary_none'));
  for (const p of result.patterns) parts.push(t(p.key, p));
  return parts.join(' ');
}
function renderCoach(p) {
  clear(p.table);
  if (data.length < 2) { p.table.appendChild(h('div.empty', t('coach_select_two'))); return; }
  const cc = coachResult();
  const { result, cmp } = cc, ref = data[0];
  const wrap = h('div.coach');
  wrap.appendChild(h('div.coach-head',
    h('span', { style: { color: cmp.color, fontWeight: 800 } }, lapLabel(cmp.lap)), h('span.mono.small.muted', fmtLapTime(cmp.lap.lapTimeMs)),
    ` ${t('coach_vs_short')} `,
    h('span', { style: { color: ref.color, fontWeight: 800 } }, lapLabel(ref.lap)), h('span.mono.small.muted', fmtLapTime(ref.lap.lapTimeMs)),
    h('b.mono.gap', { class: result.total > 0 ? 'lost' : 'gained' }, fmtGap(result.total))));
  wrap.appendChild(h('div.small.muted', t('coach_subject', { lap: lapLabel(cmp.lap), ref: lapLabel(ref.lap) }) + (result.obd && (result.obd.thr || result.obd.rpm) ? ' ' + t('coach_obd_note', { ch: [result.obd.thr ? t('ch_thr') : null, result.obd.rpm ? t('ch_rpm') : null].filter(Boolean).join(', ') }) : '')));
  const narr = h('div.coach-narrative', cc.aiText || templateNarrative(cc));
  const note = h('div.coach-note.small.muted', cc.aiText ? t('coach_ai_on_device') : '');
  wrap.append(narr, note);
  if (!cc.aiText && !cc.aiPending && !cc.aiFailed) {
    cc.aiPending = true;
    aiStatus().then((st) => {
      if (!st.available) { cc.aiPending = false; return; }
      note.textContent = t('coach_ai_thinking');
      return aiNarrate(coachLines(cc)).then((text) => { cc.aiText = text; cc.aiPending = false; if (coachCache === cc) { narr.textContent = text; note.textContent = t('coach_ai_on_device'); } })
        .catch((e) => { console.warn('ai', e); cc.aiPending = false; cc.aiFailed = true; if (coachCache === cc) note.textContent = ''; });
    }).catch(() => { cc.aiPending = false; });
  }
  const list = h('div.coach-list');
  const rows = result.ranked.length ? result.ranked : result.corners.slice(0, 1);
  for (const c of rows) {
    const row = h('div.coach-row', { 'data-start': c.start, 'data-end': c.end, on: { click: () => {
      const x = xMode() === 'time' ? timeAtDistance(ref.samples, c.ref.dApex) : c.ref.dApex;
      setCursor(x, 'coach'); for (const id of videoObjs.keys()) player.seekVideo(id, true);
    } } },
      h('div.row.between', h('b', cornerLabel(c)), h('span.mono', { class: c.lost > 0 ? 'lost' : 'gained' }, fmtGap(c.lost))),
      h('div.small.muted', c.facts.length ? c.facts.map(factText).join(' · ') : t('coach_no_diff')));
    const wi = whatIfText(cmp, c);
    if (wi) row.appendChild(h('div.small.whatif', wi));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  p.table.appendChild(wrap);
  highlightCoach(p);
}
// ------------------------------------------------------------------ highlights (moments worth jumping to)
let hlCache = { key: '', events: [], target: null };
let hlLapId = null; // lap chosen by the user in the panel head; null = default (the slowest lap of the selection)
/** The lap whose highlights are shown: the user's choice, otherwise the compared (slowest) lap, or the only lap. */
function highlightTarget() {
  if (hlLapId) { const d = data.find((x) => x.lap.id === hlLapId); if (d) return d; hlLapId = null; }
  return data.length < 2 ? data[0] || null : coachTarget();
}
function highlightEvents() {
  const tgt = highlightTarget();
  if (!tgt) return hlCache = { key: '', events: [], target: null };
  const key = `${data[0].lap.id}|${tgt.lap.id}`;
  if (hlCache.key !== key) hlCache = { key, events: detectHighlights(tgt, data[0]), target: tgt };
  return hlCache;
}
const HL_COLORS = { gpeak: '#ff9a1f', loss: '#ff4d4d', gain: '#3fd162', offtrack: '#ffe14d' };
function hlValueText(e) {
  const imp = state.settings.units === 'imperial';
  if (e.kind === 'gpeak') return t('hl_gpeak', { g: e.value.toFixed(1) });
  if (e.kind === 'loss') return t('hl_loss', { s: e.value.toFixed(2) });
  if (e.kind === 'gain') return t('hl_gain', { s: Math.abs(e.value).toFixed(2) });
  return t('hl_offtrack', { m: Math.round(imp ? e.value * 3.28084 : e.value), u: imp ? 'ft' : 'm' });
}
function hlShort(e) {
  if (e.kind === 'gpeak') return `${e.value.toFixed(1)}g`;
  if (e.kind === 'loss') return `+${e.value.toFixed(1)}`; // same convention as the coach: + = time lost
  if (e.kind === 'gain') return `−${Math.abs(e.value).toFixed(1)}`;
  return '⇢';
}
/** Chart markers for the highlights, in the current x units of the target lap. */
function highlightMarkers() {
  const { events } = highlightEvents();
  return events.map((e) => ({ x: xMode() === 'time' ? e.t : e.d, label: hlShort(e), color: HL_COLORS[e.kind], d: e.d }));
}
function renderHighlights(p) {
  clear(p.table);
  const { events, target } = highlightEvents();
  if (!target) { p.table.appendChild(h('div.empty', t('coach_select_two'))); return; }
  const wrap = h('div.coach');
  wrap.appendChild(h('div.coach-head', h('span', { style: { color: target.color, fontWeight: 800 } }, lapLabel(target.lap))));
  // why this lap, and a chip per selected lap to look at another one
  const ref = data[0];
  const why = data.length < 2 ? t('hl_single_hint') : target === ref ? t('hl_why_ref') : hlLapId ? t('hl_why_chosen', { ref: lapLabel(ref.lap) }) : t('hl_why_slowest', { ref: lapLabel(ref.lap) });
  wrap.appendChild(h('div.small.muted', why));
  if (data.length >= 2) {
    wrap.appendChild(h('div.chips', data.map((d) => h('button.chip', { class: d === target ? 'on' : '', style: d === target ? {} : { color: d.color }, on: { click: () => { hlLapId = d.lap.id; renderHighlights(p); refreshPanels(); } } }, lapLabel(d.lap)))));
  }
  if (!events.length) { wrap.appendChild(h('div.empty', t('hl_none'))); p.table.appendChild(wrap); return; }
  const cc = data.length >= 2 ? coachResult() : null;
  const list = h('div.coach-list');
  const imp = state.settings.units === 'imperial';
  for (const e of events) {
    const corner = cc ? cornerAt(cc.result, e.d) : null;
    const where = corner ? cornerLabel(corner) : `${Math.round(e.d * (imp ? 3.28084 : 1))} ${imp ? 'ft' : 'm'}`;
    const row = h('div.coach-row', { 'data-d': e.d, on: { click: () => {
      const x = xMode() === 'time' ? e.t : e.d;
      setCursor(x, 'highlights'); for (const id of videoObjs.keys()) player.seekVideo(id, true);
    } } },
      h('div.row.between', h('b', where), h('span.mono', { style: { color: HL_COLORS[e.kind] } }, hlValueText(e))),
      h('div.small.muted', t(`hl_kind_${e.kind}`)));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  p.table.appendChild(wrap);
}
function highlightCoach(p) {
  if (!p.table || data.length < 2) return;
  const cc = coachCache.result ? coachCache : null; if (!cc) return;
  const d = xMode() === 'time' ? distanceAtTime(data[0].samples, state.cursor) : state.cursor;
  const cur = cornerAt(cc.result, d);
  for (const row of p.table.querySelectorAll('.coach-row')) row.classList.toggle('current', !!cur && Number(row.dataset.start) === cur.start);
}

function renderScatter(p) {
  p.scatter.setData(data.map((d) => ({
    x: d.samples.gLat, y: d.samples.gLon, n: d.samples.n, color: d.color,
    highlight: { x: valueAt(d.samples, 'glat', state.cursor, xMode()), y: valueAt(d.samples, 'glon', state.cursor, xMode()) },
  })), t('lat_g'), t('lon_g'));
}
function renderMap(p) {
  const tracks = data.map((d) => ({ lat: d.samples.lat, lng: d.samples.lng, n: d.samples.n, color: d.color }));
  let legend = '';
  if (data.length >= 2 && xMode() !== 'time') {
    // slowest compared lap vs. the fastest: slope of the gap per ~20 m decides the colour of the fastest lap's line
    const cmp = data.slice(1).reduce((a, b) => (b.lap.lapTimeMs > a.lap.lapTimeMs ? b : a));
    if (cmp.slip && cmp.slip.n > 2) {
      const ref = data[0], s = ref.samples, sl = cmp.slip, half = 10;
      const dark = isDarkTheme();
      const RED = dark ? '#ff4d4d' : '#c62828', GREEN = dark ? '#3fd162' : '#1b8f3a', GREY = dark ? 'rgba(255,255,255,0.55)' : 'rgba(40,44,52,0.55)';
      const colors = new Array(s.n);
      for (let i = 0; i < s.n; i++) {
        const dd = s.d[i];
        const a = interpAt(sl.x, sl.y, Math.max(0, dd - half), sl.n), b = interpAt(sl.x, sl.y, dd + half, sl.n);
        const slope = (b - a); // seconds lost over ~20 m
        colors[i] = !Number.isFinite(slope) ? GREY : slope > 0.02 ? RED : slope < -0.02 ? GREEN : GREY;
      }
      tracks[0] = { ...tracks[0], colors };
      legend = t('map_legend', { lap: `L${cmp.lap.lapNumber}` });
    }
  }
  const def = data.length ? data[0].lap.trackDef : null;
  let splitPositions = [];
  if (state.settings.sectors === 'custom' && data.length) {
    const ref = data[0];
    splitPositions = customSplits(ref.lap.track.id).map((dm, i) => ({ ...positionAt(ref.samples, dm, 'distance'), label: `S${i + 1}` }));
  }
  p.map.setData({ tracks, def, cursors: cursorPositions(), showSectors: state.settings.sectors === 'default', splitPositions, legend });
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
  for (const id of ['rpm', 'thr', 'wt', 'ot', 'os', 'hr']) if (data.some((d) => d.lap.channels[CHANNELS[id].avail])) rows.push(id);
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
        if (data.length && p.map.zoom > (p.map.fitZoom || 0) + 0.3) {
          const pos = positionAt(data[0].samples, state.cursor, xMode());
          p.map.centerOn(pos.lat, pos.lng);
        }
      }
      if (p.kind === 'detail') renderDetail(p);
      if (p.kind === 'scatter') renderScatter(p);
      if (p.kind === 'coach') highlightCoach(p);
    }
    updatePos();
  });
}
function updatePos() {
  if (!data.length) { posLbl.textContent = ''; clear(gapLbl); return; }
  const ref = data[0];
  const tRef = xMode() === 'time' ? state.cursor : timeAtDistance(ref.samples, state.cursor);
  const dRef = xMode() === 'time' ? distanceAtTime(ref.samples, state.cursor) : state.cursor;
  posLbl.textContent = `${Math.round(dRef * distFactor())} ${distUnitLabel()} · ${fmtLapTime(tRef * 1000)}`;
  updateVideoHud();
  clear(gapLbl);
  for (const d of data.slice(1)) {
    if (!d.slip) continue;
    const v = interpAt(d.slip.x, d.slip.y, state.cursor, d.slip.n);
    if (!Number.isFinite(v)) continue;
    const txt = xMode() === 'time' ? `${v > 0 ? '+' : ''}${v.toFixed(0)} m` : `${v > 0 ? '+' : ''}${v.toFixed(2)} s`;
    gapLbl.appendChild(h('span.gap.mono', { style: { color: d.color }, title: `${lapLabel(d.lap)} ${t('vs_reference')}` }, txt));
  }
}

// ------------------------------------------------------------------ component sheet
function openComponentSheet(key) {
  const cur = panelSetting(key);
  const chartKind = kindOf(cur.comp) === 'number';
  let s = null;
  // one flat list of views, alphabetical in the current language; channels are chosen in the panel itself ("Channels" chip)
  const views = ['timeslip', 'coach', 'highlights', 'chart', 'strips', 'map', 'gforce', 'sections', 'detail', 'overview']
    .map((id) => ({ id, label: t(id === 'chart' ? 'ch_chart' : CHANNELS[id].label) }))
    .sort((a, b) => a.label.localeCompare(b.label, getLanguage()));
  const rows = views.map((v) => {
    const selected = v.id === 'chart' ? chartKind : cur.comp === v.id;
    return h('div.item', { class: selected ? 'selected' : '', on: { click: async () => {
      if (v.id === 'chart') { if (!chartKind) await updateSettings({ [`panel${key}`]: 'speed', [`panel${key}2`]: null }); }
      else await updateSettings({ [`panel${key}`]: v.id, [`panel${key}2`]: v.id === 'timeslip' ? cur.comp2 : null });
      s.close();
    } } }, h('span.lbl', v.label));
  });
  s = sheet(t('select_component'), rows);
}

// ------------------------------------------------------------------ options sheet
function openOptions() {
  const s0 = state.settings;
  const row = (label, control, sub) => h('div.item', h('div.lbl', h('div', label), sub ? h('div.small.muted', sub) : null), control);
  const s = sheet(t('options'), [
    row(t('opt_sectors'), segmented([{ value: 'default', label: t('sectors_default') }, { value: 'custom', label: t('sectors_custom') }, { value: 'none', label: t('sectors_none') }], s0.sectors, (v) => updateSettings({ sectors: v }))),
    h('div.item', { on: { click: () => { s.close(); openCustomSectors(); } } }, h('div.lbl', t('opt_edit_sectors')), h('span', { html: icons.fwd, style: { display: 'inline-flex' } })),
    row(t('opt_x_mode'), segmented([{ value: 'distance', label: t('distance') }, { value: 'time', label: t('time') }], xMode(), async (v) => { if (v !== xMode()) await toggleXMode(); })),
    h('div.item', { on: { click: () => { s.close(); openExcelExport(); } } }, h('div.lbl', t('export_excel')), h('span', { html: icons.fwd, style: { display: 'inline-flex' } })),
  ]);
}

// ------------------------------------------------------------------ Excel export (Windows "Excel Export": lap list + data by distance step)
function openExcelExport() {
  if (!data.length) { toast(t('select_laps_first')); return; }
  const available = ['speed', 'glon', 'glat', 'gvert', 'gcomb', 'dev', 'alt', 'hdg', 'gyrY', 'gyrP', 'gyrR', ...['rpm', 'thr', 'wt', 'ot', 'os', 'hr'].filter((id) => data.some((d) => d.lap.channels[CHANNELS[id].avail]))];
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
