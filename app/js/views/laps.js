// Laps view: import, list grouped by event, selection for comparison, per-lap actions.

import { state, on, toggleSelect, clearSelection, isSelected, lapColor, bestLapIds, hasVideo, videoKeyFor, MAX_LAPS, reloadLaps, displayDriver, displayVehicle, setSelection } from '../state.js';
import { t, fmtDateTime, fmtDate, fmtTimeOfDay, fmtBytes } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast, sheet, confirmDialog, promptDialog, initials } from '../ui.js';
import { importFiles } from '../import.js';
import { db } from '../db.js';
import { shareFiles } from '../share.js';

let root, listEl, selEl, unsub = [];
const collapsed = new Set();
let query = '';

export function mount(main) {
  setTitle(t('nav_laps'));
  const fileInput = h('input', {
    type: 'file', multiple: true,
    accept: '.rnz,.rn,.cdrn,.mp4,.mov,.m4v,.zip,video/mp4,application/zip,application/octet-stream',
    style: { display: 'none' },
    on: { change: (e) => { const files = [...e.target.files]; e.target.value = ''; runImport(files); } },
  });
  setTopButtons([], [tbtn(t('import_files'), () => fileInput.click(), { icon: 'upload', class: 'primary' })]);
  const search = h('input.input', { type: 'search', placeholder: t('search'), value: query, on: { input: (e) => { query = e.target.value; renderList(); } } });
  root = h('div.view',
    h('div.laps-toolbar', search, fileInput),
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
  if (!laps.length) {
    listEl.appendChild(h('div.empty', state.laps.length ? t('search') + ': 0' : t('no_laps')));
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
    const isCollapsed = collapsed.has(g.key);
    const head = h('div.event-head', { class: isCollapsed ? 'collapsed' : '', on: { click: () => { if (collapsed.has(g.key)) collapsed.delete(g.key); else collapsed.add(g.key); renderList(); } } },
      h('span.chev', { html: icons.chev, style: { display: 'inline-flex' } }),
      h('div.grow',
        h('div.title', l0.track.name || l0.event.name || '–'),
        h('div.sub', `${l0.event.name && l0.event.name !== l0.track.name ? l0.event.name + ' · ' : ''}${fmtDate(l0.event.startMs || l0.startMs)} · ${l0.source.device} · ${t('laps_count', { n: g.laps.length })}`)),
    );
    listEl.appendChild(head);
    if (isCollapsed) continue;
    g.laps.sort((a, b) => a.startMs - b.startMs);
    for (const l of g.laps) listEl.appendChild(lapRow(l, best.has(l.id)));
  }
}

function lapRow(l, isBest) {
  const sel = isSelected(l.id);
  const color = lapColor(l.id);
  const hv = hasVideo(l);
  const row = h('div.lap-row', {
    class: `${sel ? 'selected' : ''} ${l.complete ? '' : 'incomplete'} ${isBest ? 'best' : ''}`,
    style: { '--lap-color': color },
    on: { click: async (e) => { if (e.target.closest('.more')) return; const ok = await toggleSelect(l.id); if (!ok) toast(t('max_selected', { n: MAX_LAPS })); } },
  },
    h('div.bar'),
    h('div.avatar', l.driver.photo ? h('img', { src: l.driver.photo, alt: '' }) : initials(displayDriver(l))),
    h('div.info',
      h('div.time.mono', fmtLapTime(l.lapTimeMs)),
      h('div.l1', `${displayDriver(l)} · ${displayVehicle(l)}`),
      h('div.l2', `${t('lap_n', { n: l.lapNumber })} · ${fmtTimeOfDay(l.startMs)}${l.note ? ' · ' + l.note : ''}`)),
    h('div.right',
      hv ? h('span.badge.video', t('video')) : (l.video ? h('span.badge', t('no_video')) : null),
      isBest ? h('span.badge.best', t('best_lap')) : null),
    h('button.more', { html: icons.more, 'aria-label': t('options'), on: { click: (e) => { e.stopPropagation(); lapMenu(l); } } }),
  );
  return row;
}

async function lapMenu(l) {
  const hv = hasVideo(l);
  const item = (icon, label, fn, cls = '') => h('div.item', { class: cls, on: { click: () => { s.close(); fn(); } } }, h('span', { html: icons[icon], style: { display: 'inline-flex', width: '22px' } }), h('span.lbl', label));
  const s = sheet(`${t('lap_n', { n: l.lapNumber })} · ${displayDriver(l)} · ${fmtLapTime(l.lapTimeMs)}`, [
    h('div', { style: { padding: '6px 16px 10px', fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.5' } },
      `${l.track.name} · ${l.event.name}`, h('br'), `${fmtDateTime(l.startMs)} · ${l.source.device} · ${l.sampleCount} samples`, h('br'),
      l.video ? `${t('video')}: ${l.video.fileName} ${hv ? '✓' : '(' + t('video_missing') + ')'}` : t('no_video')),
    item('edit', t('edit_lap'), () => editLap(l)),
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
