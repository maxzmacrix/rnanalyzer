// Devices view: connect to a Race Navigator over WiFi (HTTP API) and download lap data + videos.

import { state, updateSettings } from '../state.js';
import { t, fmtBytes } from '../i18n.js';
import { fmtLapTime } from '../rnparser.js';
import { h, clear, icons, setTitle, setTopButtons, tbtn, toast } from '../ui.js';
import { normalizeBase, mixedContentBlocked, fetchDeviceInfo, fetchDeviceLaps, downloadFile } from '../device.js';
import { nativeDiscover } from '../deviceNative.js';
import { importFiles } from '../import.js';

let root, deviceArea, lapsArea, queueArea;
let base = '', info = null, deviceLaps = [], selected = new Map(); // dataFile -> {data:bool, video:bool}
let queue = [], running = false, sortMode = 'start';

export function mount(main) {
  setTitle(t('devices_title'));
  setTopButtons([], [tbtn('', () => connect(), { icon: 'refresh', title: t('connect') })]);
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const addr = h('input.input', { type: 'url', placeholder: isNative ? '192.168.1.158' : 'http://192.168.1.1:8080', value: state.settings.lastDevice || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, inputmode: 'url' });
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(addr.value); });
  const known = (state.settings.deviceAddresses || []);
  const datalist = h('datalist#device-addrs', known.map((a) => h('option', { value: a })));
  addr.setAttribute('list', 'device-addrs');
  if (!isNative) {
    // Web version: direct device access is a feature of the native app – show the notice only.
    setTopButtons([], []);
    root = h('div.view.scroll',
      h('div.card', { style: { borderColor: 'var(--accent)' } },
        h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, t('native_required_title')),
        h('div.small', { style: { lineHeight: '1.5', color: 'var(--text-dim)' } }, t('native_required_text')),
        h('div.row', { style: { marginTop: '10px' } }, h('button.btn.accent', { on: { click: () => { location.hash = '#/laps'; } } }, t('go_import')))));
    main.appendChild(root);
    return;
  }
  const found = h('div.row', { style: { marginTop: '8px', flexWrap: 'wrap' } });
  const discoverBtn = h('button.btn.ghost', { on: { click: async () => {
    discoverBtn.disabled = true; clear(found);
    try {
      const devs = await nativeDiscover(4000);
      if (!devs.length) toast(t('no_devices_found'));
      for (const d of devs) found.appendChild(h('button.chip', { on: { click: () => { addr.value = d.host; connect(d.host); } } }, `${d.name || d.host} · ${d.host}`));
      if (devs.length === 1) { addr.value = devs[0].host; connect(devs[0].host); }
    } catch (e) { toast(String(e.message || e)); }
    discoverBtn.disabled = false;
  } } }, t('discover'));
  root = h('div.view.scroll',
    h('div.card',
      h('div.small.muted', { style: { marginBottom: '8px', lineHeight: '1.45' } }, t('device_help')),
      h('div.row', h('div.field.grow', h('label', t('device_address')), addr, datalist), discoverBtn, h('button.btn.accent', { on: { click: () => connect(addr.value) } }, t('connect'))),
      found,
      known.length ? h('div.row', { style: { marginTop: '8px', flexWrap: 'wrap' } }, known.map((a) => h('button.chip', { on: { click: () => { addr.value = a; connect(a); } } }, a))) : null,
    ),
    (deviceArea = h('div')),
    (queueArea = h('div')),
    (lapsArea = h('div')),
  );
  main.appendChild(root);
  if (state.settings.lastDevice) connect(state.settings.lastDevice);
  else discoverBtn.click();
}
export function unmount() {}

async function connect(input) {
  const b = normalizeBase(input || state.settings.lastDevice);
  if (!b) return;
  base = b;
  clear(deviceArea); clear(lapsArea);
  if (mixedContentBlocked(base)) deviceArea.appendChild(h('div.card', { style: { borderColor: 'var(--red)' } }, h('div.small', t('mixed_content_warning'))));
  deviceArea.appendChild(h('div.card', h('div.muted', `${t('connect')}… ${base}`)));
  try {
    info = await fetchDeviceInfo(base);
    deviceLaps = await fetchDeviceLaps(base);
    const list = [base, ...(state.settings.deviceAddresses || []).filter((a) => a !== base)].slice(0, 6);
    await updateSettings({ lastDevice: base, deviceAddresses: list });
    renderDevice(); renderLaps();
  } catch (e) {
    clear(deviceArea);
    deviceArea.appendChild(h('div.card', { style: { borderColor: 'var(--red)' } }, h('div', t('connection_failed', { e: e.message || e })),
      mixedContentBlocked(base) ? h('div.small.muted', { style: { marginTop: '6px' } }, t('mixed_content_warning')) : null));
  }
}

function renderDevice() {
  clear(deviceArea);
  deviceArea.appendChild(h('div.card.device-card',
    h('div.logo', h('img', { src: 'icons/logo.svg', alt: 'RN' }), h('span', (info.deviceType || '').replace(/^RN\s*/i, '') || 'ONE')),
    h('div.kv',
      h('div.k', t('device')), h('div', info.deviceName || base),
      h('div.k', t('driver')), h('div', info.driver || '–'),
      h('div.k', t('vehicle')), h('div', info.car || '–'),
      h('div.k', t('version')), h('div', `${info.version || ''} · ${deviceLaps.length} ${t('nav_laps').toLowerCase()}`)),
    h('button.btn', { on: { click: () => { lapsArea.scrollIntoView({ behavior: 'smooth' }); } } }, t('download_data'))));
}

function importedState(dl) {
  const lap = state.laps.find((l) => l.source.fileName === dl.dataFile || (dl.lapNumber && l.lapNumber === dl.lapNumber && l.startMs && dl.startTime && Math.abs(l.startMs - Date.parse(dl.startTime.replace(' ', 'T') + 'Z')) < 1500));
  const hasVid = dl.videoFile ? state.videoNames.has(dl.videoFile) : false;
  return { data: !!lap, video: hasVid };
}

function renderLaps() {
  clear(lapsArea);
  if (!deviceLaps.length) { lapsArea.appendChild(h('div.empty', t('no_laps'))); return; }
  const sorted = [...deviceLaps];
  if (sortMode === 'driver') sorted.sort((a, b) => (a.driver || '').localeCompare(b.driver || '') || (a.startTime || '').localeCompare(b.startTime || ''));
  else if (sortMode === 'laptime') sorted.sort((a, b) => (a.lapTimeMs || 1e12) - (b.lapTimeMs || 1e12));
  else sorted.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  const bestByDriver = new Map();
  for (const l of deviceLaps) if (l.complete && l.lapTimeMs) { const c = bestByDriver.get(l.driver); if (!c || l.lapTimeMs < c.lapTimeMs) bestByDriver.set(l.driver, l); }

  const header = h('div.row.between', { style: { padding: '10px 12px 4px' } },
    h('div', { style: { fontWeight: 700 } }, t('laps_on_device')),
    h('div.seg', ['start', 'driver', 'laptime'].map((m) => h('button', { class: m === sortMode ? 'on' : '', on: { click: () => { sortMode = m; renderLaps(); } } }, t('sort_' + m)))));
  const allData = h('button.chip', { on: { click: () => { for (const l of deviceLaps) { const st = sel(l); st.data = !importedState(l).data; } renderLaps(); } } }, `${t('data')} ✓`);
  const allVideo = h('button.chip', { on: { click: () => { for (const l of deviceLaps) { const st = sel(l); st.video = !!l.videoFile && !importedState(l).video; } renderLaps(); } } }, `${t('video')} ✓`);
  const dlBtn = h('button.btn.accent', { on: { click: startDownloads } }, t('download'));
  lapsArea.append(header, h('div.row', { style: { padding: '4px 12px 8px', gap: '8px' } }, allData, allVideo, h('div.grow'), dlBtn));

  for (const l of sorted) {
    const st = sel(l); const imp = importedState(l);
    const best = bestByDriver.get(l.driver) === l;
    const cb = (on, disabled, onChange) => h('div.check', { class: `${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`, html: on ? icons.check : '', on: { click: (e) => { e.stopPropagation(); if (disabled) return; onChange(!on); renderLaps(); } } });
    lapsArea.appendChild(h('div.dl-row', { on: { click: () => { if (!imp.data) st.data = !st.data; else if (l.videoFile && !imp.video) st.video = !st.video; renderLaps(); } } },
      h('div',
        h('div.t', { style: { color: best ? 'var(--yellow)' : (l.complete ? '' : 'var(--grey)') } }, `${fmtLapTime(l.lapTimeMs)}  `, h('span.small.muted', `${t('lap_n', { n: l.lapNumber })}`)),
        h('div.s', `${l.driver || '–'} · ${l.car || ''} · ${l.event || l.track || ''} · ${(l.startTime || '').slice(0, 16)}`),
        h('div.s', `${t('data')}: ${fmtBytes(l.dataSize)}${imp.data ? ' · ' + t('already_imported') : ''}` + (l.videoFile ? ` · ${t('video')}: ${fmtBytes(l.videoSize)}${imp.video ? ' · ' + t('already_imported') : ''}` : ` · ${t('no_video')}`))),
      h('div', { style: { textAlign: 'center' } }, h('div.small.muted', t('data')), cb(st.data || imp.data, imp.data, (v) => { st.data = v; })),
      h('div', { style: { textAlign: 'center' } }, h('div.small.muted', t('video')), cb(st.video || imp.video, !l.videoFile || imp.video, (v) => { st.video = v; })),
    ));
  }
}
function sel(l) { if (!selected.has(l.dataFile)) selected.set(l.dataFile, { data: false, video: false }); return selected.get(l.dataFile); }

function startDownloads() {
  for (const l of deviceLaps) {
    const st = sel(l); const imp = importedState(l);
    if (st.data && !imp.data) queue.push({ lap: l, name: l.dataFile, size: l.dataSize, kind: 'data', status: 'waiting', progress: 0 });
    if (st.video && l.videoFile && !imp.video) queue.push({ lap: l, name: l.videoFile, size: l.videoSize, kind: 'video', status: 'waiting', progress: 0 });
    st.data = false; st.video = false;
  }
  // data first, then videos
  queue.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'data' ? -1 : 1));
  renderQueue();
  runQueue();
}

async function runQueue() {
  if (running) return;
  running = true;
  while (queue.some((q) => q.status === 'waiting')) {
    const item = queue.find((q) => q.status === 'waiting');
    item.status = 'downloading';
    renderQueue();
    try {
      const blob = await downloadFile(base, item.name, (loaded, total, bps) => { item.progress = total ? loaded / total : 0; item.speed = bps; item.loaded = loaded; renderQueueItem(item); });
      const res = await importFiles([{ blob, name: item.name }]);
      item.status = res.errors.length ? 'failed' : 'downloaded';
      if (res.errors.length) item.error = res.errors[0].error;
    } catch (e) {
      item.status = 'failed'; item.error = e.message || String(e);
    }
    renderQueue(); renderLaps();
  }
  running = false;
  toast(t('done'));
}

function renderQueue() {
  clear(queueArea);
  if (!queue.length) return;
  const done = queue.filter((q) => q.status === 'downloaded').length;
  const card = h('div.card', { style: { padding: 0, overflow: 'hidden' } },
    h('div.row.between', { style: { padding: '10px 12px' } }, h('b', `${t('download')} ${done}/${queue.length}`), h('button.tbtn', { on: { click: () => { queue = queue.filter((q) => q.status === 'downloading'); renderQueue(); } } }, t('close'))));
  for (const item of queue) card.appendChild(queueRow(item));
  queueArea.appendChild(card);
}
function queueRow(item) {
  const row = h('div.dl-row', { 'data-name': item.name });
  fillQueueRow(row, item);
  return row;
}
function fillQueueRow(row, item) {
  clear(row);
  const statusTxt = item.status === 'downloading' ? `${t('downloading')} ${Math.round(item.progress * 100)}%${item.speed ? ' · ' + fmtBytes(item.speed) + '/s' : ''}` : t(item.status) + (item.error ? ': ' + item.error : '');
  row.append(
    h('div', h('div.t', `${fmtLapTime(item.lap.lapTimeMs)} · ${t('lap_n', { n: item.lap.lapNumber })} · ${item.lap.driver || ''}`), h('div.s', `${item.kind === 'video' ? t('video') : t('data')} · ${item.name} · ${fmtBytes(item.size)}`)),
    h('div.s', { style: { gridColumn: '2 / 4', textAlign: 'right' } }, statusTxt),
    h('div.progress', h('div', { style: { width: `${Math.round((item.status === 'downloaded' ? 1 : item.progress) * 100)}%`, background: item.status === 'failed' ? 'var(--red)' : '' } })),
  );
}
function renderQueueItem(item) {
  const row = queueArea.querySelector(`[data-name="${CSS.escape(item.name)}"]`);
  if (row) fillQueueRow(row, item);
}
