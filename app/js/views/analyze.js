// Analyze tab: one tab, three modes of the same lap selection – charts (analyzer), g-force scatter, video player.
// The mode is chosen with a segmented control in the top bar; routes: #/analyze, #/analyze/gforce, #/analyze/video.

import { t } from '../i18n.js';
import { segmented, setTitleEl, setTopButtons } from '../ui.js';
import * as analyzer from './analyzer.js';
import * as gforce from './gforce.js';
import * as video from './video.js';

const SUBS = { charts: analyzer, gforce, video };
let sub = null, subName = '', mainEl = null, lastSub = 'charts';

function wanted() {
  const seg = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[1]) || '';
  return SUBS[seg] ? seg : lastSub;
}

export function mount(main) { mainEl = main; show(wanted()); }
export function update() { const w = wanted(); if (w !== subName) show(w); else if (sub && sub.update) sub.update(); }
export function unmount() { if (sub && sub.unmount) sub.unmount(); sub = null; subName = ''; }

function show(name) {
  if (sub && sub.unmount) { try { sub.unmount(); } catch (e) { console.error(e); } }
  mainEl.innerHTML = '';
  setTopButtons([], []);
  sub = SUBS[name]; subName = name; lastSub = name;
  sub.mount(mainEl);
  const seg = segmented([
    { value: 'charts', label: t('seg_charts') },
    { value: 'gforce', label: t('seg_gforce') },
    { value: 'video', label: t('seg_video') },
  ], name, (v) => { location.hash = `#/analyze/${v}`; });
  seg.classList.add('title-seg');
  setTitleEl(seg);
}
