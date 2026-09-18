// Guided tour: loads the demo laps (app/demo/), then drives the real app step by step – a spotlight on the
// element in question, a short explanation, automatic advance (pausable). Demo laps are flagged `demo: true`
// so they can be removed again with one tap.

import { state, setSelection, clearSelection, reloadLaps, videoKeyFor, hasVideo, MAX_LAPS } from './state.js';
import { importFiles } from './import.js';
import { db } from './db.js';
import { player } from './sync.js';
import { t } from './i18n.js';
import { h, clear, icons, toast } from './ui.js';
import { isNative } from './deviceNative.js';
import { unzip } from './zip.js';

const DEMO_BASE = './demo/';
const DEMO_DRIVER = 'DRIVER A';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let els = null, idx = 0, timer = 0, tick = 0, paused = false, running = false, currentTarget = null;

export function hasDemoData() { return state.laps.some((l) => l.demo); }

export async function removeDemoData() {
  for (const l of state.laps.filter((l) => l.demo)) {
    const vk = videoKeyFor(l);
    await db.deleteLap(l.id);
    if (vk && !state.laps.some((o) => o.id !== l.id && videoKeyFor(o) === vk)) await db.deleteVideo(vk);
  }
  await clearSelection();
  await reloadLaps();
}

export async function loadDemoData(onProgress = () => {}) {
  const index = await (await fetch(DEMO_BASE + 'index.json', { cache: 'no-cache' })).json();
  const names = [...index.laps, ...(index.videoArchive ? [index.videoArchive] : index.videos)];
  const files = [];
  for (let i = 0; i < names.length; i++) {
    onProgress(i + 1, names.length);
    const r = await fetch(DEMO_BASE + names[i]);
    if (!r.ok) throw new Error(`${names[i]} (HTTP ${r.status})`);
    const buf = await r.arrayBuffer();
    if (names[i] === index.videoArchive) {
      // clips travel inside one stored zip so the native shells serve them like any other file
      for (const e of await unzip(buf)) if (/\.mp4$/i.test(e.name)) files.push(new File([e.data], e.name.split('/').pop(), { type: 'video/mp4' }));
    } else {
      files.push(new File([buf], names[i], { type: /\.mp4$/i.test(names[i]) ? 'video/mp4' : 'application/zip' }));
    }
  }
  await importFiles(files);
  await reloadLaps();
  for (const l of state.laps) {
    if (!l.demo && (l.driver.name || '').toUpperCase() === DEMO_DRIVER) { l.demo = true; await db.updateLap(l); }
  }
  await reloadLaps();
}

// ------------------------------------------------------------------ steps
const ALL_STEPS = [
  { key: 'tour_welcome', center: true, dur: 0, before: async (setText) => {
    setText(t('tour_loading', { i: 0, n: '…' }));
    await loadDemoData((i, n) => setText(t('tour_loading', { i, n })));
    await clearSelection();
    setText(t('tour_welcome'));
    await wait(1800);
  } },
  { key: 'tour_session', route: '#/laps', target: '.event-head', dur: 8000 },
  { key: 'tour_sectors', route: '#/laps', target: '.lap-row .secs', dur: 8000 },
  { key: 'tour_filters', route: '#/laps', target: '.filter-bar', dur: 6500 },
  { key: 'tour_suggest', route: '#/laps', target: '.sel-summary', dur: 7000, before: async () => {
    const b = document.querySelector('.event-head .suggest'); if (b) b.click(); await wait(600);
    location.hash = '#/laps'; await wait(500); // the suggestion opens the comparison – the tour explains the selection first
    // the video scenes need two laps with clips – add demo laps with video if the suggestion did not include them
    const withVideo = state.laps.filter((l) => l.demo && hasVideo(l)).map((l) => l.id);
    const ids = [...state.selected]; for (const id of withVideo) if (!ids.includes(id) && ids.length < MAX_LAPS) ids.push(id);
    if (ids.length !== state.selected.length) { await setSelection(ids); await wait(300); }
  } },
  { key: 'tour_play', route: '#/analyze', target: '.play-bar', dur: 8000, before: async () => { await wait(900); await player.play(); } },
  { key: 'tour_chart', route: '#/analyze', target: () => document.querySelectorAll('.right-col .panel')[0], dur: 8000 },
  { key: 'tour_map', route: '#/analyze', target: () => { const p = document.querySelectorAll('.right-col .panel'); return p[p.length - 1]; }, dur: 7000 },
  { key: 'tour_video', route: '#/analyze', target: '.videos', dur: 8000, before: async () => {
    const c = document.querySelector('.vcell'); if (c) { c.click(); await wait(400); }
  } },
  { key: 'tour_video_back', route: '#/analyze', target: '.videos', dur: 4000, before: async () => { const c = document.querySelector('.vcell.big'); if (c) { c.click(); await wait(300); } } },
  { key: 'tour_device', route: '#/device', target: '#main .card', dur: 7000, nativeOnly: true, before: async () => { player.pause(); } },
  { key: 'native_required_text', center: true, dur: 7000, webOnly: true, before: async () => { player.pause(); } },
  { key: 'tour_settings', route: '#/settings', target: '#main .settings', dur: 6000 },
  { key: 'tour_done', route: '#/laps', center: true, dur: 0, final: true },
];

const STEPS = ALL_STEPS.filter((s) => (!s.nativeOnly || isNative()) && (!s.webOnly || !isNative()));

// ------------------------------------------------------------------ engine
export async function startTour() {
  if (running) return;
  running = true; paused = false; idx = 0;
  buildUi();
  tick = setInterval(placeSpot, 250);
  await show(0);
}

export function stopTour() {
  running = false;
  clearTimeout(timer); clearInterval(tick); timer = 0; tick = 0;
  if (els) { els.root.remove(); els = null; }
  currentTarget = null;
  player.pause();
}

function buildUi() {
  const root = h('div.tour-root');
  const block = h('div.tour-block', { on: { click: () => { /* swallow – the bot is driving */ } } });
  const spot = h('div.tour-spot');
  const text = h('div.tour-text');
  const dots = h('div.tour-dots');
  const prev = h('button.tbtn', { html: icons.back, title: t('tour_prev'), on: { click: () => running && show(Math.max(0, idx - 1)) } });
  const pause = h('button.tbtn', { html: icons.pause, title: t('tour_pause'), on: { click: () => {
    paused = !paused; pause.innerHTML = paused ? icons.play : icons.pause;
    if (paused) clearTimeout(timer); else scheduleNext();
  } } });
  const next = h('button.tbtn.primary', { on: { click: () => running && show(Math.min(STEPS.length - 1, idx + 1)) } }, t('tour_next'));
  const close = h('button.tbtn', { html: icons.close, title: t('tour_close'), on: { click: () => stopTour() } });
  const actions = h('div.tour-actions', prev, pause, next);
  const card = h('div.tour-card', h('div.tour-head', dots, close), text, actions);
  root.append(block, spot, card);
  document.body.appendChild(root);
  els = { root, block, spot, card, text, dots, prev, pause, next, actions };
}

function scheduleNext() {
  clearTimeout(timer);
  const s = STEPS[idx];
  if (!s || !s.dur || paused) return;
  timer = setTimeout(() => { if (running) show(Math.min(STEPS.length - 1, idx + 1)); }, s.dur);
}

async function show(i) {
  if (!els) return;
  clearTimeout(timer);
  idx = i;
  const s = STEPS[i];
  clear(els.dots);
  STEPS.forEach((_, j) => els.dots.appendChild(h('i', { class: j === i ? 'on' : j < i ? 'done' : '' })));
  els.prev.disabled = i === 0;
  els.next.classList.toggle('hidden', !!s.final);
  els.pause.classList.toggle('hidden', !s.dur);
  els.card.classList.toggle('center', !!s.center);
  currentTarget = null; els.spot.classList.add('hidden');
  const setText = (txt) => { els.text.textContent = txt; };
  try {
    if (s.route && !location.hash.startsWith(s.route)) { location.hash = s.route; await wait(700); }
    if (s.before) await s.before(setText);
    if (!running || idx !== i) return;
    if (!s.before || s.key !== 'tour_welcome') setText(t(s.key));
    if (s.final) renderFinal();
    else if (s.center) { /* text only */ }
    else { currentTarget = s.target; await wait(150); placeSpot(); }
    if (s.key === 'tour_welcome') { show(1); return; }
    scheduleNext();
  } catch (e) {
    console.error('tour step failed', e);
    toast(t('tour_failed', { e: e.message || e }), 5000);
    stopTour();
  }
}

function placeSpot() {
  if (!els || !currentTarget) return;
  const el = typeof currentTarget === 'function' ? currentTarget() : document.querySelector(currentTarget);
  if (!el) { els.spot.classList.add('hidden'); return; }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) { els.spot.classList.add('hidden'); return; }
  const pad = 6;
  Object.assign(els.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  els.spot.classList.remove('hidden');
  // card goes to the half of the screen the target is not in
  els.card.classList.toggle('top', r.top + r.height / 2 > window.innerHeight / 2);
}

function renderFinal() {
  els.text.textContent = t('tour_done');
  clear(els.actions);
  els.actions.append(
    h('button.tbtn', { on: { click: async () => { stopTour(); await removeDemoData(); toast(t('tour_removed')); } } }, t('tour_remove')),
    h('button.tbtn.primary', { on: { click: () => stopTour() } }, t('tour_keep')),
  );
}
