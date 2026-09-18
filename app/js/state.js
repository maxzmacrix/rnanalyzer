// Central application state + tiny event bus.

import { db } from './db.js';
import { setLanguage, detectLanguage } from './i18n.js';

export const MAX_LAPS = 10;
export const MAX_VIDEOS = 4;

// Lap colours: bright set for the dark theme, darker set (≥ 4.5:1 on white) for the light theme – both used as text colours too.
export const PALETTES = {
  dark: ['#ff9a1f', '#3fd162', '#4aa3ff', '#ff4d4d', '#c77dff', '#ffe14d', '#33e0e0', '#ff7ad1', '#b6ff3f', '#d2a679'],
  light: ['#c2410c', '#15803d', '#1d4ed8', '#b91c1c', '#7e22ce', '#8a5406', '#0f766e', '#be185d', '#4d7c0f', '#8d5524'],
};

// Web version: English by default. Native app (Capacitor): follow the device language.
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const DEFAULT_SETTINGS = {
  language: detectLanguage(), // device language everywhere (Settings can override)
  units: 'metric', // metric | imperial
  colorblind: false,
  mapTiles: true,
  autoplaySpeed: 1,
  sectors: 'default', // default | custom | none
  syncZoom: true,
  allTracks: true,
  xMode: 'distance', // distance | time
  panelA: 'timeslip', // the answer first: gap to the fastest lap, speed as second curve
  panelA2: 'speed',
  panelB: 'map',
  panelB2: null,
  deviceAddresses: [],
  lastDevice: '',
  panelRatios: [30, 35, 35, 35],
  panelCount: 2,
  panelC: 'glat',
  panelC2: null,
  followCursor: false,
  mapStyle: 'osm', // osm | satellite | custom
  customTileUrl: '',
  profiles: [],
  theme: 'system', // light | dark | system – follows the phone, light by day at the track
  weather: true, // session weather from Open-Meteo
  settingsVersion: 2,
};

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  const set = listeners.get(evt);
  if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error('listener error', evt, e); } }
}

export const state = {
  laps: [],
  lapsById: new Map(),
  videoNames: new Set(),
  videoNamesLower: new Map(),
  selected: [],
  samplesCache: new Map(),
  cursor: 0, // in x-mode units (m or s)
  playing: false,
  settings: { ...DEFAULT_SETTINGS },
  customSectors: new Map(),
  videoSizes: new Map(),
  online: navigator.onLine,
};

export async function initState() {
  const saved = await db.getSetting('settings', null);
  state.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (saved && (Number(saved.settingsVersion) || 1) < 2) {
    // 2.0 redesign: answer-first defaults for existing installs
    Object.assign(state.settings, { theme: 'system', language: detectLanguage(), panelA: 'timeslip', panelA2: 'speed', panelB: 'map', autoplaySpeed: 1, settingsVersion: 2 });
    await db.setSetting('settings', state.settings);
  }
  setLanguage(state.settings.language);
  const sel = await db.getSetting('selected', []);
  await reloadLaps();
  state.selected = (sel || []).filter((id) => state.lapsById.has(id));
  window.addEventListener('online', () => { state.online = true; emit('online', true); });
  window.addEventListener('offline', () => { state.online = false; emit('online', false); });
}

export async function reloadLaps() {
  const laps = await db.allLaps();
  state.laps = laps;
  state.lapsById = new Map(laps.map((l) => [l.id, l]));
  const names = await db.videoNames();
  state.videoNames = new Set(names);
  state.videoNamesLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  try { state.videoSizes = new Map((await db.videoInfos()).map((v) => [v.fileName, v.size || 0])); } catch { state.videoSizes = new Map(); }
  state.selected = state.selected.filter((id) => state.lapsById.has(id));
  // preload custom sectors for known tracks
  const trackIds = new Set(laps.map((l) => l.track.id).filter(Boolean));
  for (const tid of trackIds) {
    if (!state.customSectors.has(tid)) state.customSectors.set(tid, await db.getCustomSectors(tid));
  }
  emit('laps');
}

export function videoKeyFor(lap) {
  if (!lap || !lap.video || !lap.video.fileName) return null;
  const fn = lap.video.fileName;
  if (state.videoNames.has(fn)) return fn;
  const ci = state.videoNamesLower.get(fn.toLowerCase());
  if (ci) return ci;
  // fuzzy: same device + lap number in file name
  const m = /_Lap_(\d+)_/i.exec(fn);
  if (m) {
    const re = new RegExp(`_Lap_${m[1]}_`, 'i');
    for (const n of state.videoNames) if (re.test(n) && n.toLowerCase().includes((lap.source.device || '').toLowerCase())) return n;
  }
  // last resort: a stored video whose size matches the device's record (file renamed by AirDrop/WhatsApp/Files)
  const kb = lap.video.sizeKB;
  if (Number.isFinite(kb) && kb > 0 && state.videoSizes) {
    const target = kb * 1024;
    for (const [n, size] of state.videoSizes) if (size && Math.abs(size - target) / target < 0.0005) return n;
  }
  return null;
}
export function hasVideo(lap) { return !!videoKeyFor(lap); }

export function isDarkTheme() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
export function palette() { return isDarkTheme() ? PALETTES.dark : PALETTES.light; }
export function lapColor(id) {
  const i = state.selected.indexOf(id);
  const p = palette();
  return i >= 0 ? p[i % p.length] : (isDarkTheme() ? '#9aa4b8' : '#6b7380');
}
/** The reference for every comparison: the fastest complete lap of the selection (tap order does not matter). */
export function refLapId() {
  let best = null;
  for (const id of state.selected) {
    const l = state.lapsById.get(id);
    if (!l) continue;
    if (!best || (l.complete && l.lapTimeMs > 0 && (!best.complete || l.lapTimeMs < best.lapTimeMs))) best = l;
  }
  return best ? best.id : (state.selected[0] || null);
}
export function selectedLaps() {
  return state.selected.map((id) => state.lapsById.get(id)).filter(Boolean);
}
export function isSelected(id) { return state.selected.includes(id); }

export async function toggleSelect(id) {
  const i = state.selected.indexOf(id);
  if (i >= 0) state.selected.splice(i, 1);
  else {
    if (state.selected.length >= MAX_LAPS) return false;
    state.selected.push(id);
  }
  await db.setSetting('selected', state.selected);
  emit('selection');
  return true;
}
export async function clearSelection() {
  state.selected = [];
  await db.setSetting('selected', []);
  emit('selection');
}
export async function setSelection(ids) {
  state.selected = ids.slice(0, MAX_LAPS);
  await db.setSetting('selected', state.selected);
  emit('selection');
}

export async function ensureSamples(id) {
  if (state.samplesCache.has(id)) return state.samplesCache.get(id);
  const s = await db.getSamples(id);
  if (s) {
    state.samplesCache.set(id, s);
    if (state.samplesCache.size > 24) {
      // evict entries that are not selected
      for (const k of state.samplesCache.keys()) {
        if (!state.selected.includes(k)) { state.samplesCache.delete(k); if (state.samplesCache.size <= 24) break; }
      }
    }
  }
  return s;
}
export async function ensureSelectedSamples() {
  const out = [];
  for (const id of state.selected) {
    const s = await ensureSamples(id);
    if (s) out.push({ lap: state.lapsById.get(id), samples: s, color: lapColor(id) });
  }
  return out;
}

export function setCursor(x, source) {
  if (!Number.isFinite(x)) return;
  state.cursor = Math.max(0, x);
  emit('cursor', { x: state.cursor, source });
}

export async function updateSettings(patch) {
  Object.assign(state.settings, patch);
  if (patch.language) setLanguage(patch.language);
  await db.setSetting('settings', state.settings);
  emit('settings', patch);
}

export function speedFactor() { return state.settings.units === 'imperial' ? 2.2369363 : 3.6; }
export function speedUnitLabel() { return state.settings.units === 'imperial' ? 'mph' : 'km/h'; }
export function distFactor() { return state.settings.units === 'imperial' ? 3.2808399 : 1; }
export function distUnitLabel() { return state.settings.units === 'imperial' ? 'ft' : 'm'; }

/** Custom sector splits for a track id */
export function customSplits(trackId) { return state.customSectors.get(trackId) || []; }
export async function setCustomSplits(trackId, splits) {
  const clean = [...new Set(splits.map((x) => Math.round(x)).filter((x) => x > 0))].sort((a, b) => a - b);
  state.customSectors.set(trackId, clean);
  await db.setCustomSectors(trackId, clean);
  emit('sectors', trackId);
}

/** Best lap per driver within the same event → set of lap ids */
export function bestLapIds(laps) {
  const best = new Map();
  for (const l of laps) {
    if (!l.complete || !(l.lapTimeMs > 0)) continue;
    const key = `${l.event.id}|${l.track.id}|${l.driver.name}`;
    const cur = best.get(key);
    if (!cur || l.lapTimeMs < cur.lapTimeMs) best.set(key, l);
  }
  return new Set([...best.values()].map((l) => l.id));
}

/** Display helpers honouring user overrides (Edit lap). */
export function displayDriver(lap) { return (lap.driverOverride || lap.driver.name || '').trim() || '–'; }
export function displayVehicle(lap) {
  const model = (lap.vehicleOverride || lap.vehicle.model || '').trim();
  const num = lap.vehicleNumberOverride || lap.vehicle.number;
  return (num ? `#${num} ` : '') + model;
}
export function lapLabel(lap) { return `L${lap.lapNumber} ${displayDriver(lap)}`; }
