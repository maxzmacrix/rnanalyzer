// Update notice for the side-loaded Android app: compares the build number baked into the APK (build.json,
// written by the Android workflow) with the latest GitHub release (latest.json, published with every release)
// and shows a banner that opens the APK download. Does nothing in the web version or on iOS.

import { t } from './i18n.js';
import { isNative } from './deviceNative.js';

const LATEST_URL = 'https://github.com/maxzmacrix/rnanalyzer/releases/latest/download/latest.json';
const DISMISS_KEY = 'rn-update-dismissed';

export async function checkForAppUpdate() {
  if (!isNative() || !/Android/i.test(navigator.userAgent)) return;
  let mine;
  try { mine = await (await fetch('./build.json', { cache: 'no-store' })).json(); } catch { return; }
  if (!mine || mine.platform !== 'android' || !(mine.build > 0)) return;
  let latest;
  try {
    // native fetch (CapacitorHttp) – no CORS, follows the release redirect
    const res = await fetch(`${LATEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    latest = await res.json();
  } catch { return; }
  if (!latest || !(latest.build > mine.build) || !latest.apk) return;
  let dismissed = 0;
  try { dismissed = Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch {}
  if (dismissed >= latest.build) return;
  showBanner(latest);
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
