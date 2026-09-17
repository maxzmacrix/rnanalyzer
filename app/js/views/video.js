// Video player view: one lap video with data HUD (speed, lap time) synchronized to the shared cursor.

import { state, on, ensureSamples, selectedLaps, videoKeyFor, hasVideo, displayDriver, displayVehicle, setCursor, speedFactor, speedUnitLabel, lapColor } from '../state.js';
import { t } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, sheet, toast } from '../ui.js';
import { db } from '../db.js';
import { valueAt, timeAtDistance, distanceAtTime } from '../analysis.js';
import { openLapPicker } from './laps.js';
import { player } from '../sync.js';

let root, stage, videoEl, hud, slider, posLbl, speedLbl, playBtn, unsub = [], url = null, lap = null, samples = null, rate = 1, raf = 0, muted = true;

export function mount(main) {
  setTitle(t('video_title'));
  speedLbl = h('span.pos', `${t('speed')} ${rate}×`);
  setTopButtons(
    [tbtn(t('choose_lap'), chooseLap, { icon: 'video' })],
    [tbtn(t('laps_btn'), () => openLapPicker(() => pickDefault(true)), { icon: 'laps' })],
  );
  stage = h('div.stage');
  hud = h('div.hud');
  slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, on: { input: () => { if (!videoEl) return; const d = videoEl.duration || 0; videoEl.currentTime = (slider.value / 1000) * d; syncCursorFromVideo(); } } });
  posLbl = h('div.row.between.small.muted', h('span.mono#vpos', '00:00.000'), h('span#vlap', ''), h('span.mono#vdur', ''));
  playBtn = h('button.rbtn.big', { html: icons.play, on: { click: togglePlay } });
  const controls = h('div.controls',
    slider, posLbl,
    h('div.row', { style: { justifyContent: 'center', gap: '18px' } },
      h('button.rbtn', { html: icons.back, on: { click: () => step(-1) }, title: t('step_back') }),
      playBtn,
      h('button.rbtn', { html: icons.fwd, on: { click: () => step(1) }, title: t('step_fwd') }),
      h('button.rbtn', { html: icons.mute, title: t('sound'), on: { click: (e) => { muted = !muted; if (videoEl) videoEl.muted = muted; e.currentTarget.innerHTML = muted ? icons.mute : icons.sound; } } })),
    h('div.row', { style: { justifyContent: 'center', gap: '10px', marginTop: '4px' } },
      h('button.rbtn.small', { html: icons.minus, title: '−', on: { click: () => setRate(rate - 0.25) } }), speedLbl, h('button.rbtn.small', { html: icons.plus, title: '+', on: { click: () => setRate(rate + 0.25) } })),
  );
  root = h('div.view.player', stage, controls);
  main.appendChild(root);
  unsub.push(on('selection', () => pickDefault(false)), on('laps', () => pickDefault(false)));
  pickDefault(true);
}
export function unmount() {
  unsub.forEach((u) => u()); unsub = [];
  if (raf) cancelAnimationFrame(raf); raf = 0;
  if (videoEl) { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); }
  if (url) URL.revokeObjectURL(url); url = null; videoEl = null; lap = null;
}

function candidates() { return selectedLaps().filter(hasVideo); }

async function pickDefault(force) {
  const c = candidates();
  if (!c.length) { showEmpty(); return; }
  if (!force && lap && c.some((l) => l.id === lap.id)) return;
  await loadLap(c[0]);
}
function showEmpty() {
  clear(stage);
  if (videoEl) { videoEl.pause(); }
  videoEl = null; lap = null;
  stage.appendChild(h('div.empty', state.selected.length ? t('no_video_laps') : t('select_laps_first')));
}
function chooseLap() {
  const c = candidates();
  if (!c.length) { toast(t('no_video_laps')); return; }
  const s = sheet(t('choose_lap'), c.map((l) => h('div.item', { class: lap && lap.id === l.id ? 'selected' : '', style: { boxShadow: `inset 4px 0 0 ${lapColor(l.id)}` }, on: { click: () => { s.close(); loadLap(l); } } },
    h('div.lbl', h('div.mono', { style: { fontWeight: 700 } }, fmtLapTime(l.lapTimeMs)), h('div.small.muted', `${t('lap_n', { n: l.lapNumber })} · ${displayDriver(l)} · ${displayVehicle(l)}`)))));
}

async function loadLap(l) {
  const key = videoKeyFor(l);
  const rec = key ? await db.getVideo(key) : null;
  if (!rec) { showEmpty(); return; }
  if (url) URL.revokeObjectURL(url);
  lap = l; samples = await ensureSamples(l.id);
  url = URL.createObjectURL(rec.blob);
  clear(stage);
  videoEl = h('video', { playsinline: true, 'webkit-playsinline': true, preload: 'auto', src: url, muted, controls: false });
  videoEl.playbackRate = rate;
  videoEl.addEventListener('loadedmetadata', () => { root.querySelector('#vdur').textContent = fmtLapTime(videoEl.duration * 1000); seekToCursor(); });
  videoEl.addEventListener('play', () => { playBtn.innerHTML = icons.pause; loop(); });
  videoEl.addEventListener('pause', () => { playBtn.innerHTML = icons.play; if (raf) cancelAnimationFrame(raf); raf = 0; updateHud(); });
  videoEl.addEventListener('ended', () => { playBtn.innerHTML = icons.play; });
  videoEl.addEventListener('click', togglePlay);
  stage.append(videoEl, hud);
  root.querySelector('#vlap').textContent = `${t('lap_n', { n: l.lapNumber })} · ${displayDriver(l)} · ${fmtLapTime(l.lapTimeMs)}`;
  updateHud();
}

function seekToCursor() {
  if (!videoEl || !samples || !lap) return;
  const tLap = state.settings.xMode === 'time' ? state.cursor : timeAtDistance(samples, state.cursor);
  const target = Math.max(0, (tLap || 0) - (lap.video ? lap.video.offsetS : 0));
  if (Number.isFinite(target) && Number.isFinite(videoEl.duration)) videoEl.currentTime = Math.min(target, videoEl.duration - 0.05);
  updateHud();
}
function syncCursorFromVideo() {
  if (!videoEl || !samples || !lap) return;
  const tLap = videoEl.currentTime + (lap.video ? lap.video.offsetS : 0);
  setCursor(state.settings.xMode === 'time' ? tLap : distanceAtTime(samples, tLap), 'video');
  updateHud();
}
function loop() {
  if (!videoEl || videoEl.paused) return;
  raf = requestAnimationFrame(loop);
  syncCursorFromVideo();
}
function updateHud() {
  if (!videoEl || !samples || !lap) return;
  const tLap = videoEl.currentTime + (lap.video ? lap.video.offsetS : 0);
  const d = distanceAtTime(samples, tLap);
  const v = valueAt(samples, 'speed', d, 'distance') * speedFactor();
  clear(hud);
  hud.append(h('div', h('b', Number.isFinite(v) ? v.toFixed(0) : '–'), ` ${speedUnitLabel()}`), h('div', h('b.mono', fmtLapTime(tLap * 1000))));
  const dur = videoEl.duration || 0;
  if (dur) slider.value = Math.round((videoEl.currentTime / dur) * 1000);
  root.querySelector('#vpos').textContent = fmtLapTime(videoEl.currentTime * 1000);
}
function togglePlay() {
  if (!videoEl) return;
  if (videoEl.paused) videoEl.play().catch((e) => toast(String(e.message || e))); else videoEl.pause();
}
function step(s) { if (!videoEl) return; videoEl.currentTime = Math.max(0, Math.min((videoEl.duration || 0) - 0.05, videoEl.currentTime + s)); syncCursorFromVideo(); }
function setRate(r) {
  rate = Math.max(0.25, Math.min(2, Math.round(r * 4) / 4));
  if (videoEl) videoEl.playbackRate = rate;
  speedLbl.textContent = `${t('speed')} ${rate}×`;
}
