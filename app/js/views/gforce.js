// G-Force view: scatter plot of lateral vs longitudinal acceleration for the selected laps.

import { state, on, ensureSelectedSamples, displayDriver, displayVehicle } from '../state.js';
import { t } from '../i18n.js';
import { h, clear, setTitle, setTopButtons, tbtn } from '../ui.js';
import { ScatterChart } from '../chart.js';
import { valueAt } from '../analysis.js';
import { openLapPicker } from './laps.js';

let chart, canvas, legend, unsub = [], data = [], raf = 0;

export function mount(main) {
  setTitle(t('gforce_title'));
  setTopButtons([], [tbtn(t('laps_btn'), () => openLapPicker(), { icon: 'laps' })]);
  const wrap = h('div.view');
  const body = h('div.grow', { style: { position: 'relative', minHeight: 0 } });
  canvas = h('canvas', { style: { position: 'absolute', inset: 0 } });
  legend = h('div.legend');
  body.appendChild(canvas);
  wrap.append(body, legend);
  main.appendChild(wrap);
  chart = new ScatterChart(canvas);
  unsub.push(on('selection', load), on('laps', load), on('settings', load), on('cursor', onCursor));
  load();
}
export function unmount() { unsub.forEach((u) => u()); unsub = []; if (chart) chart.destroy(); chart = null; if (raf) cancelAnimationFrame(raf); }

async function load() {
  data = await ensureSelectedSamples();
  if (!chart) return;
  clear(legend);
  if (!data.length) {
    chart.setData([], t('lat_g'), t('lon_g'));
    legend.appendChild(h('span.muted', t('select_laps_first')));
    return;
  }
  for (const d of data) legend.appendChild(h('span', h('i', { style: { background: d.color } }), `L${d.lap.lapNumber} ${displayDriver(d.lap)} · ${displayVehicle(d.lap)}`));
  draw();
}
function draw() {
  if (!chart) return;
  chart.setData(data.map((d) => ({
    x: d.samples.gLat, y: d.samples.gLon, n: d.samples.n, color: d.color,
    highlight: { x: valueAt(d.samples, 'glat', state.cursor, state.settings.xMode), y: valueAt(d.samples, 'glon', state.cursor, state.settings.xMode) },
  })), t('lat_g'), t('lon_g'));
}
function onCursor() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
