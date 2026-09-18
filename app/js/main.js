// App shell: routing, view lifecycle, service worker registration.

import { initState, state, on, emit } from './state.js';
import { t, getLanguage } from './i18n.js';
import { setTitle, setTopButtons, toast } from './ui.js';
import * as lapsView from './views/laps.js';
import * as analyzeView from './views/analyzer.js';
import * as deviceView from './views/device.js';
import * as settingsView from './views/settings.js';
import { installUpdateChecks } from './update.js';

export const APP_VERSION = '2.0.0';

const views = { laps: lapsView, analyze: analyzeView, device: deviceView, settings: settingsView };
const nativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// old routes (bookmarks, home-screen icons from v2.0.0–2.0.6)
const ALIASES = { analyzer: 'analyze', gforce: 'analyze', video: 'analyze', devices: 'device', control: 'device' };
if (!nativeApp) { ALIASES.device = 'laps'; ALIASES.devices = 'laps'; ALIASES.control = 'laps'; delete views.device; }
let current = null;
let currentName = '';

function route() {
  const hash = location.hash || '#/laps';
  const name = (hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || 'laps';
  if (ALIASES[name]) { location.replace('#/' + ALIASES[name]); return; }
  const view = views[name] || views.laps;
  if (current && currentName === name) { current.update && current.update(); return; }
  if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
  const main = document.getElementById('main');
  main.innerHTML = '';
  setTopButtons([], []);
  current = view; currentName = name;
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  try { view.mount(main); } catch (e) { console.error('mount failed', e); main.innerHTML = `<div class="empty">${e.message}</div>`; }
}

export function applyTheme() {
  const pref = state.settings.theme || 'dark';
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
  document.documentElement.toggleAttribute('data-glass', state.settings.glassBar !== false);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#07080a' : '#ffffff');
  emit('theme', dark ? 'dark' : 'light');
}
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((state.settings.theme || 'dark') === 'system') applyTheme(); });

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.title = t('app');
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (/[?&]nosw/.test(location.search)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const b = document.getElementById('update-banner');
          b.textContent = t('update_available');
          b.classList.remove('hidden');
          b.onclick = () => { nw.postMessage({ type: 'SKIP_WAITING' }); };
        }
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; refreshing = true; location.reload(); });
  } catch (e) { console.warn('SW registration failed', e); }
}

async function boot() {
  await initState();
  applyTheme();
  applyI18n();
  if (!nativeApp) { const a = document.querySelector('#tabbar a[data-view="device"]'); if (a) a.remove(); }
  on('settings', (patch) => { if (patch && ('theme' in patch || 'glassBar' in patch)) applyTheme(); if (patch && patch.language) { applyI18n(); if (current && current.unmount) current.unmount(); current = null; route(); } });
  window.addEventListener('hashchange', route);
  route();
  registerSW();
  installUpdateChecks();
  if (/[?&]selftest(=|&|$)/.test(location.search)) import('./selftest.js').then((m) => m.run()).catch((e) => console.error('selftest failed to start', e));
  // ask for persistent storage once (silently) so iOS/Chrome don't evict lap data
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
  }
  // keep screen orientation free; re-layout on rotation
  window.addEventListener('orientationchange', () => setTimeout(() => emit('resize'), 250));
  window.addEventListener('resize', () => emit('resize'));
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('main').innerHTML = `<div class="empty">Startup failed: ${e.message}</div>`;
});
