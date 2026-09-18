// Settings view.

import { state, updateSettings, reloadLaps, clearSelection, resetSettings } from '../state.js';
import { showDiagnostics } from '../diag.js';
import { t, fmtBytes } from '../i18n.js';
import { h, setTitle, setTopButtons, switchEl, segmented, confirmDialog, toast } from '../ui.js';
import { db } from '../db.js';
import { APP_VERSION } from '../main.js';
import { isNative as isNativeApp_ } from '../deviceNative.js';
import { startTour, hasDemoData, removeDemoData } from '../tour.js';
import { checkForAppUpdate, updateCheckAvailable } from '../update.js';
import { resetAiStatus } from '../ai.js';
let isNativeApp = false; // evaluated at mount – the shell's bridge object may not exist at module load

export function mount(main) {
  isNativeApp = isNativeApp_();
  setTitle(t('settings_title'));
  setTopButtons([], []);
  const s = state.settings;
  const item = (label, control, sub) => h('div.item', h('div.lbl', h('div', label), sub ? h('div.sub', sub) : null), control);
  const root = h('div.view.scroll.settings');

  root.append(...[
    h('h3', t('settings_title')),
    item(t('theme'), segmented([{ value: 'light', label: t('theme_light') }, { value: 'dark', label: t('theme_dark') }, { value: 'system', label: t('theme_system') }], s.theme || 'dark', (v) => updateSettings({ theme: v }))),
    item(t('glass_bar'), switchEl(s.glassBar !== false, (v) => updateSettings({ glassBar: v })), t('glass_bar_hint')),
    item(t('language'), segmented([{ value: 'en', label: 'English' }, { value: 'de', label: 'Deutsch' }, { value: 'it', label: 'Italiano' }, { value: 'fr', label: 'Français' }], s.language, (v) => updateSettings({ language: v }))),
    item(t('speed_units'), segmented([{ value: 'metric', label: 'km/h' }, { value: 'imperial', label: 'mph' }], s.units, (v) => updateSettings({ units: v }))),
    item(t('map_tiles'), switchEl(s.mapTiles, (v) => updateSettings({ mapTiles: v }))),
    item(t('weather_setting'), switchEl(s.weather !== false, (v) => updateSettings({ weather: v })), t('weather_hint')),
    isNativeApp ? item(t('ai_coach_setting'), switchEl(s.aiCoach !== false, (v) => { updateSettings({ aiCoach: v }); resetAiStatus(); }), t('ai_coach_hint')) : null,
    item(t('map_style'), segmented([{ value: 'osm', label: t('map_osm') }, { value: 'satellite', label: t('map_satellite') }], s.mapStyle === 'satellite' ? 'satellite' : 'osm', (v) => updateSettings({ mapStyle: v })), t('satellite_hint')),
    item(t('opt_all_tracks'), switchEl(s.allTracks, (v) => updateSettings({ allTracks: v }))),
  ].filter(Boolean));

  // storage
  const storageInfo = h('div.sub', '…');
  const persistInfo = h('div.sub', { style: { marginTop: '4px' } }, '…');
  const persistBtn = h('button.btn.ghost', { on: { click: async () => { const ok = await db.persist(); toast(ok ? t('persisted') : t('not_persisted')); refreshStorage(); refreshPersist(); } } }, t('protect'));
  async function refreshPersist() {
    if (isNativeApp) {
      // native shell: data lives in the app's own container – nothing to request, nothing to add to a home screen
      persistInfo.textContent = '✓ ' + t('storage_protected_native'); persistInfo.style.color = 'var(--green)'; persistBtn.classList.add('hidden'); return;
    }
    let p = false;
    try { p = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch { p = false; }
    persistInfo.textContent = p ? '✓ ' + t('storage_protected') : t('storage_unprotected');
    persistInfo.style.color = p ? 'var(--green)' : '';
    persistBtn.classList.toggle('hidden', !!p);
  }
  refreshPersist();
  root.append(
    h('h3', t('storage')),
    h('div.item', h('div.lbl', h('div', t('storage')), storageInfo, persistInfo), persistBtn),
    h('div.item', h('div.lbl', h('div', t('delete_all_videos'))), h('button.btn.danger', { on: { click: async () => {
      if (!(await confirmDialog(t('confirm_delete_videos'), { danger: true, okLabel: t('delete') }))) return;
      await db.deleteAllVideos(); await reloadLaps(); refreshStorage(); toast(t('done'));
    } } }, t('delete'))),
    h('div.item', h('div.lbl', h('div', t('reset_settings')), h('div.small.muted', t('reset_settings_hint'))), h('button.btn.ghost.reset-settings', { on: { click: async () => {
      if (!(await confirmDialog(t('confirm_reset_settings'), { title: t('reset_settings'), okLabel: t('reset_settings_btn') }))) return;
      await resetSettings(); toast(t('settings_reset_done'), 3000);
    } } }, t('reset_settings_btn'))),
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
    h('div.item', h('div.lbl', h('div', t('protocol_log')), h('div.small.muted', t('protocol_log_sub'))), h('button.btn.ghost.diagnostics', { on: { click: () => showDiagnostics([]) } }, t('show'))),
    h('div.item.about-row', h('img.about-logo', { src: 'icons/logo.svg', alt: 'RN' }), h('div.lbl', h('div', 'RN Analyzer'), h('div.sub', `${t('version')} ${APP_VERSION} · ${isNativeApp ? 'App' : standalone ? 'PWA' : 'Browser'} · ${navigator.onLine ? t('online') : t('offline')}`))),
    h('div.item', h('div.lbl', h('div', t('tour_start')), h('div.sub', t('tour_start_hint'))), h('button.btn.ghost', { on: { click: () => startTour() } }, t('tour_start_btn'))),
    hasDemoData() ? h('div.item', h('div.lbl', h('div', t('tour_remove')), h('div.sub', t('demo_data_hint'))), h('button.btn.danger', { on: { click: async () => { await removeDemoData(); toast(t('tour_removed')); main.innerHTML = ''; mount(main); } } }, t('delete'))) : null,
    isIOS && !standalone && !isNativeApp ? h('div.item', h('div.lbl', h('div.sub', t('install_hint_ios')))) : null,
    isNativeApp ? null : h('div.item', h('div.lbl', h('div', t('native_required_title')), h('div.sub', t('native_required_text')))),
    updateCheckAvailable() ? h('div.item', h('div.lbl', h('div', t('check_update')), h('div.sub', t('check_update_hint'))), h('button.btn.ghost', { on: { click: async (e) => {
      const btn = e.currentTarget; btn.disabled = true; const r = await checkForAppUpdate({ manual: true }); btn.disabled = false;
      toast(r === 'available' ? t('update_found') : r === 'current' ? t('update_none') : t('update_error'), 4000);
    } } }, t('check_update_btn'))) : null,
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
