// Diagnostics log: one place for everything support needs when something on a customer's phone does not work.
// Device requests (HTTP-XML API, control protocol), FTP downloads, imports and unhandled errors record here; the
// sheet shows the log with app, platform and device header and hands it to the share sheet or a support mail.
// Nothing is sent automatically. Kept in memory only (last 200 entries).

import { t } from './i18n.js';
import { h, sheet, toast } from './ui.js';
import { shareFiles, canShareFiles } from './share.js';

// main.js hands the version over at boot (importing main.js here would pull the whole app shell into the data modules)
let APP_VERSION = '';
export function setAppVersion(v) { APP_VERSION = v; }

export const SUPPORT_MAIL = 'info@rn-vision.com';
export const entries = [];
const MAX = 200;

/** @param {'http'|'xml'|'ftp'|'import'|'error'|'info'} kind */
export function record(kind, msg, detail) {
  entries.push({ t: new Date().toISOString().slice(11, 23), kind, msg: String(msg ?? '').slice(0, 200), detail: detail == null ? '' : String(detail).replace(/\s+/g, ' ').slice(0, 400) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export function diagText(headerLines = []) {
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const head = [`RN Analyzer ${APP_VERSION} · ${native ? 'app' : 'web'} · ${navigator.userAgent}`, ...headerLines, `Time: ${new Date().toISOString()}`, ''];
  const body = entries.length ? entries.map((e) => `${e.t} [${e.kind}] ${e.msg}${e.detail ? '\n    ' + e.detail : ''}`).join('\n') : t('protocol_log_empty');
  return head.join('\n') + body;
}

export function installGlobalErrorLog() {
  window.addEventListener('error', (e) => record('error', e.message || 'error', `${e.filename || ''}:${e.lineno || ''}`));
  window.addEventListener('unhandledrejection', (e) => record('error', 'unhandled rejection', e.reason && (e.reason.stack || e.reason.message || e.reason)));
}

async function sendToSupport(text) {
  const subject = `RN Analyzer ${APP_VERSION} – diagnostics`;
  if (canShareFiles()) {
    try { const r = await shareFiles([new File([text], 'rn-analyzer-diagnostics.txt', { type: 'text/plain' })], subject); if (r === 'shared') return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  // mailto: keeps the body short – mail clients cap the URL length
  location.href = `mailto:${SUPPORT_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text.slice(0, 1800))}`;
}

/** Diagnostics sheet; headerLines add context such as the connected device. */
export function showDiagnostics(headerLines = []) {
  const text = diagText(headerLines);
  const pre = h('pre.diag-pre', text);
  sheet(t('protocol_log'), [
    h('div.small.muted', { style: { padding: '6px 16px' } }, t('protocol_log_hint')),
    pre,
    h('div.row', { style: { padding: '8px 16px 16px', justifyContent: 'flex-end', gap: '8px' } },
      h('button.btn.ghost', { on: { click: async () => { try { await navigator.clipboard.writeText(text); toast(t('copied'), 1500); } catch { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast(t('copy_manually'), 3000); } } } }, t('copy')),
      h('button.btn', { on: { click: () => sendToSupport(text) } }, t('send_support'))),
  ]);
}
