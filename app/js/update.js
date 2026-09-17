// Update notice for the side-loaded Android app: compares the build number baked into the APK (build.json,
// written by the Android workflow) with the latest GitHub release (latest.json, published with every release)
// and shows a banner that opens the APK download. Does nothing in the web version or on iOS.

import { t } from './i18n.js';
import { isNative } from './deviceNative.js';

const LATEST_URL = 'https://github.com/maxzmacrix/rnanalyzer/releases/latest/download/latest.json';
const DISMISS_KEY = 'rn-update-dismissed';

export function updateCheckAvailable() { return isNative() && /Android/i.test(navigator.userAgent); }

let lastCheck = 0;
/**
 * @param {{manual?: boolean}} [opts] manual = ignore the dismissed flag and the throttle
 * @returns {Promise<'unsupported'|'unknown'|'current'|'available'|'error'>}
 */
export async function checkForAppUpdate(opts = {}) {
  if (!updateCheckAvailable()) return 'unsupported';
  if (!opts.manual && Date.now() - lastCheck < 20 * 60 * 1000) return 'unknown';
  lastCheck = Date.now();
  let mine;
  try { mine = await (await fetch('./build.json', { cache: 'no-store' })).json(); } catch { return 'unknown'; }
  if (!mine || mine.platform !== 'android' || !(mine.build > 0)) return 'unknown';
  let latest;
  try {
    // native fetch (CapacitorHttp) – no CORS, follows the release redirect
    const res = await fetch(`${LATEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return 'error';
    latest = typeof res.json === 'function' ? await res.json() : JSON.parse(await res.text());
    if (typeof latest === 'string') latest = JSON.parse(latest);
  } catch (e) { console.warn('update check failed', e); return 'error'; }
  if (!latest || !latest.apk || !(latest.build > 0)) return 'error';
  if (!(latest.build > mine.build)) return 'current';
  if (!opts.manual) {
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch {}
    if (dismissed >= latest.build) return 'available';
  }
  showBanner(latest);
  return 'available';
}

/** Boot hook: check now and whenever the app comes back to the foreground. */
export function installUpdateChecks() {
  if (!updateCheckAvailable()) return;
  setTimeout(() => checkForAppUpdate().catch(() => {}), 2500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForAppUpdate().catch(() => {}); });
  setInterval(() => { if (document.visibilityState === 'visible') checkForAppUpdate().catch(() => {}); }, 21 * 60 * 1000); // running apps learn about a release within ~20 min
}

function showBanner(latest) {
  const b = document.getElementById('update-banner');
  if (!b) return;
  b.textContent = '';
  const label = document.createElement('span');
  label.textContent = t('update_android', { v: `${latest.version} (${latest.build})` });
  const close = document.createElement('button');
  close.className = 'banner-close'; close.setAttribute('aria-label', 'close'); close.textContent = '×';
  close.onclick = (e) => { e.stopPropagation(); try { localStorage.setItem(DISMISS_KEY, String(latest.build)); } catch {} b.classList.add('hidden'); };
  b.append(label, close);
  b.classList.remove('hidden');
  b.onclick = () => { window.open(latest.apk, '_blank'); };
}
