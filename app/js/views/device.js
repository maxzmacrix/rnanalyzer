// Race Navigator tab: everything about the device on one page – connection, control (former RN Connect)
// and lap/video import. The web version shows the notice that direct device access is a native-app feature.

import { t } from '../i18n.js';
import { h, clear, setTitle, setTopButtons, tbtn } from '../ui.js';
import { isNative } from '../deviceNative.js';
import * as devices from './devices.js';
import * as control from './control.js';

const ANDROID_APK = 'https://github.com/maxzmacrix/rnanalyzer/releases/latest/download/RN-Analyzer.apk';
const IS_ANDROID = /Android/i.test(navigator.userAgent);
let root, connSlot, ctlSlot, lapsSlot;

export function mount(main) {
  setTitle(t('nav_device'));
  if (!isNative()) {
    setTopButtons([], []);
    root = h('div.view.scroll.device-page',
      h('div.card', { style: { borderColor: 'var(--accent)' } },
        h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, t('native_required_title')),
        h('div.small', { style: { lineHeight: '1.5', color: 'var(--text-dim)' } }, t('native_required_text')),
        h('div.row', { style: { marginTop: '10px', flexWrap: 'wrap' } },
          h('button.btn.accent', { on: { click: () => { location.hash = '#/laps'; } } }, t('go_import')),
          IS_ANDROID ? h('a.btn.ghost', { href: ANDROID_APK, target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, t('android_download')) : null),
        IS_ANDROID ? h('div.small.muted', { style: { marginTop: '8px', lineHeight: '1.5' } }, t('android_hint')) : null),
      h('div.card',
        h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, t('device_section_control')),
        h('div.small', { style: { lineHeight: '1.5', color: 'var(--text-dim)' } }, t('control_native_only'))));
    main.appendChild(root);
    return;
  }
  root = h('div.view.scroll.device-page',
    (connSlot = h('div')),
    h('h3', t('device_section_control')),
    (ctlSlot = h('div')),
    h('h3', t('device_section_import')),
    (lapsSlot = h('div')),
  );
  main.appendChild(root);
  mountSubs();
  setTopButtons([], [tbtn('', reload, { icon: 'refresh', title: t('connect') })]);
}

function mountSubs() {
  devices.mount(root, { connection: connSlot, laps: lapsSlot });
  control.mount(ctlSlot);
}
function reload() {
  unmountSubs();
  clear(connSlot); clear(ctlSlot); clear(lapsSlot);
  mountSubs();
}
function unmountSubs() {
  try { control.unmount(); } catch (e) { console.error(e); }
  try { devices.unmount(); } catch (e) { console.error(e); }
}
export function unmount() { if (isNative()) unmountSubs(); }
