// Race Navigator tab (native app): one connection state for the whole page. Reachable → connection card, control
// (former RN Connect) and lap/video import. Not reachable → one calm card with the two steps and "Search again".
// The web version has no device tab; the store hint lives in the empty lap list and in Settings.

import { state, updateSettings } from '../state.js';
import { t } from '../i18n.js';
import { h, clear, setTitle, setTopButtons, tbtn, promptDialog } from '../ui.js';
import { isNative, nativeInfo, nativeDiscover } from '../deviceNative.js';
import { normalizeBase } from '../device.js';
import * as devices from './devices.js';
import * as control from './control.js';

let root, connSlot, ctlSlot, lapsSlot, subsMounted = false, probing = false;

export function mount(main) {
  setTitle(t('nav_device'));
  root = h('div.view.scroll.device-page');
  main.appendChild(root);
  if (!isNative()) { root.appendChild(storeCard()); setTopButtons([], []); return; }
  setTopButtons([], [tbtn('', () => probe(), { icon: 'refresh', title: t('search_again') })]);
  probe();
}

export function storeCard() {
  return h('div.card', { style: { borderColor: 'var(--accent)' } },
    h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, t('native_required_title')),
    h('div.small', { style: { lineHeight: '1.5', color: 'var(--text-dim)' } }, t('native_required_text')));
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function probe() {
  if (probing || !root) return;
  probing = true;
  unmountSubs();
  clear(root);
  root.appendChild(h('div.card', h('div.empty', t('device_searching'))));
  let host = state.settings.lastDevice || '';
  try {
    if (!host) { const devs = await nativeDiscover(3500); if (devs.length) host = devs[0].host; }
    if (!host) throw new Error('no device');
    await withTimeout(nativeInfo(host), 6000);
    if (host !== state.settings.lastDevice) await updateSettings({ lastDevice: host });
    if (!root) return;
    clear(root);
    root.append(
      (connSlot = h('div')),
      h('h3', t('device_section_control')),
      (ctlSlot = h('div')),
      h('h3', t('device_section_import')),
      (lapsSlot = h('div')),
    );
    devices.mount(root, { connection: connSlot, laps: lapsSlot });
    control.mount(ctlSlot);
    subsMounted = true;
  } catch (e) {
    if (!root) return;
    console.warn('device probe', e && e.message);
    clear(root);
    root.appendChild(h('div.card',
      h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, t('device_not_found')),
      h('div.small', { style: { lineHeight: '1.5', color: 'var(--text-dim)' } }, t('device_help')),
      h('div.row', { style: { marginTop: '12px', flexWrap: 'wrap' } },
        h('button.btn.accent', { on: { click: () => { if (state.settings.lastDevice) updateSettings({ lastDevice: '' }).then(probe); else probe(); } } }, t('search_again')),
        h('button.btn.ghost', { on: { click: enterAddress } }, t('enter_address')))));
  } finally { probing = false; }
}

async function enterAddress() {
  const r = await promptDialog(t('enter_address'), [{ key: 'host', label: t('device_address'), value: state.settings.lastDevice || '' }]);
  if (!r || !r.host.trim()) return;
  const host = normalizeBase(r.host.trim()) || r.host.trim();
  await updateSettings({ lastDevice: host });
  probe();
}

function unmountSubs() {
  if (!subsMounted) return;
  try { control.unmount(); } catch (e) { console.error(e); }
  try { devices.unmount(); } catch (e) { console.error(e); }
  subsMounted = false;
}
export function unmount() { unmountSubs(); root = null; }
