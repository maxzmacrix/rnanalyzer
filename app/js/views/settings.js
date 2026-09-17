// Settings view.

import { state, updateSettings, reloadLaps, clearSelection } from '../state.js';
import { t, fmtBytes } from '../i18n.js';
import { h, setTitle, setTopButtons, switchEl, segmented, confirmDialog, toast } from '../ui.js';
import { db } from '../db.js';
import { APP_VERSION } from '../main.js';

export function mount(main) {
  setTitle(t('settings_title'));
  setTopButtons([], []);
  const s = state.settings;
  const item = (label, control, sub) => h('div.item', h('div.lbl', h('div', label), sub ? h('div.sub', sub) : null), control);
  const root = h('div.view.scroll.settings');

  root.append(
    h('h3', t('settings_title')),
    item(t('theme'), segmented([{ value: 'light', label: t('theme_light') }, { value: 'dark', label: t('theme_dark') }, { value: 'system', label: t('theme_system') }], s.theme || 'light', (v) => updateSettings({ theme: v }))),
    item(t('language'), segmented([{ value: 'en', label: 'English' }, { value: 'de', label: 'Deutsch' }], s.language, (v) => updateSettings({ language: v }))),
    item(t('speed_units'), segmented([{ value: 'metric', label: 'km/h' }, { value: 'imperial', label: 'mph' }], s.units, (v) => updateSettings({ units: v }))),
    item(t('colorblind'), switchEl(s.colorblind, (v) => updateSettings({ colorblind: v }))),
    item(t('map_tiles'), switchEl(s.mapTiles, (v) => updateSettings({ mapTiles: v }))),
    item(t('map_style'), segmented([{ value: 'osm', label: t('map_osm') }, { value: 'satellite', label: t('map_satellite') }, { value: 'custom', label: t('map_custom') }], s.mapStyle || 'osm', (v) => updateSettings({ mapStyle: v })), t('satellite_hint')),
    h('div.item', h('div.lbl', h('div', t('custom_tile_url')), h('input.input', { type: 'url', value: s.customTileUrl || '', placeholder: 'https://…/{z}/{x}/{y}.png', autocapitalize: 'off', spellcheck: false, on: { change: (e) => updateSettings({ customTileUrl: e.target.value.trim() }) } }))),
    item(t('opt_autoplay'), segmented([0.5, 1, 2, 4].map((x) => ({ value: x, label: x + '×' })), Number(s.autoplaySpeed), (v) => updateSettings({ autoplaySpeed: v }))),
    item(t('opt_all_tracks'), switchEl(s.allTracks, (v) => updateSettings({ allTracks: v }))),
  );

  // storage
  const storageInfo = h('div.sub', '…');
  const persistBtn = h('button.btn.ghost', { on: { click: async () => { const ok = await db.persist(); toast(ok ? t('persisted') : t('not_persisted')); refreshStorage(); } } }, t('persist_storage'));
  root.append(
    h('h3', t('storage')),
    h('div.item', h('div.lbl', h('div', t('storage')), storageInfo), persistBtn),
    h('div.item', h('div.lbl', h('div', t('delete_all_videos'))), h('button.btn.danger', { on: { click: async () => {
      if (!(await confirmDialog(t('confirm_delete_videos'), { danger: true, okLabel: t('delete') }))) return;
      await db.deleteAllVideos(); await reloadLaps(); refreshStorage(); toast(t('done'));
    } } }, t('delete'))),
    h('div.item', h('div.lbl', h('div', t('clear_all'))), h('button.btn.danger', { on: { click: async () => {
      if (!(await confirmDialog(t('confirm_clear_all'), { danger: true, okLabel: t('delete') }))) return;
      await db.clearAll(); await clearSelection(); await reloadLaps(); refreshStorage(); toast(t('done'));
    } } }, t('delete'))),
  );

  // about
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  root.append(...[
    h('h3', t('about')),
    h('div.item', h('div.lbl', h('div', 'RN Analyzer'), h('div.sub', `${t('version')} ${APP_VERSION} · ${standalone ? 'PWA' : 'Browser'} · ${navigator.onLine ? t('online') : t('offline')}`))),
    isIOS && !standalone ? h('div.item', h('div.lbl', h('div.sub', t('install_hint_ios')))) : null,
    h('div.item', h('div.lbl', h('div.sub', 'Race Navigator · RN Vision GmbH · race-navigator.com'))),
  ].filter(Boolean));
  main.appendChild(root);

  async function refreshStorage() {
    const est = await db.estimate();
    const laps = state.laps.length;
    const vids = await db.videoInfos();
    const vbytes = vids.reduce((a, v) => a + (v.size || 0), 0);
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    storageInfo.textContent = `${t('files_stored', { n: laps, v: vids.length })} (${fmtBytes(vbytes)} video)` + (est ? ` · ${t('storage_used', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota) })}` : '') + ` · ${persisted ? t('persisted') : t('not_persisted')}`;
    persistBtn.classList.toggle('hidden', persisted);
  }
  refreshStorage();
}
export function unmount() {}
