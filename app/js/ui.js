// Small DOM helpers: element factory, top bar, toasts, sheets, confirm dialogs.

import { t } from './i18n.js';

/** h('div.cls#id', {attrs, on:{}}, ...children) */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) { if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1); }
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (attrs !== undefined) children.unshift(attrs);
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const icons = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 10.8 12l4.6 4.6L14 18l-6-6 6-6z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7zM9 4h6l1 2H8z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3l4 4h-3v8h-2V7H8zM5 11h2v8h10v-8h2v10H5z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M3 17.3V21h3.7L17.8 9.9l-3.7-3.7zm17.7-10.2a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z"/></svg>',
  video: '<svg viewBox="0 0 24 24"><path d="M4 5h12a2 2 0 0 1 2 2v2.5l4-2.5v10l-4-2.5V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4L15.2 10.6l-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 0 0 4.3 10h2.1a6 6 0 0 1 9.8-2.2L14 10h6V4zM6.4 17.6A8 8 0 0 0 19.7 14h-2.1a6 6 0 0 1-9.8 2.2L10 14H4v6z"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 4l5 5h-3v6h-4V9H7zM4 17h16v3H4z"/></svg>',
  laps: '<svg viewBox="0 0 24 24"><path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z"/></svg>',
  options: '<svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm14 0h4v2h-4zM3 11h4v2H3zm6 0h12v2H9zM3 16h10v2H3zm12 0h6v2h-6z"/></svg>',
};

export function setTitle(text) { document.getElementById('top-title').textContent = text; }
export function setTopButtons(left = [], right = []) {
  const l = clear(document.getElementById('top-left'));
  const r = clear(document.getElementById('top-right'));
  append(l, left); append(r, right);
}
export function tbtn(label, onClick, opts = {}) {
  return h('button.tbtn', { class: opts.class || '', on: { click: onClick }, title: opts.title || '', 'aria-label': opts.title || label || '' },
    opts.icon ? h('span', { html: icons[opts.icon] || opts.icon, style: { display: 'inline-flex' } }) : null,
    label ? h('span', label) : null);
}

let toastTimer = 0;
export function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((e) => e.remove());
  const el = h('div.toast', msg);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

/** Bottom sheet. Returns {el, close}. */
export function sheet(title, bodyNodes, opts = {}) {
  const overlay = document.getElementById('overlay');
  const body = h('div.body', bodyNodes);
  const closeBtn = h('button.tbtn', { html: icons.close, 'aria-label': t('close'), on: { click: () => close() } });
  const header = h('header', h('h2', title), opts.headerRight || null, closeBtn);
  const box = h('div.sheet', header, body);
  const back = h('div.sheet-backdrop', { on: { click: (e) => { if (e.target === back) close(); } } }, box);
  overlay.appendChild(back);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { back.remove(); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(); }
  return { el: back, body, close };
}

export function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const s = sheet(opts.title || t('warning'), [
      h('div', { style: { padding: '12px 16px', lineHeight: '1.45' } }, message),
      h('div.row', { style: { padding: '8px 16px 16px', justifyContent: 'flex-end' } },
        h('button.btn.ghost', { on: { click: () => { s.close(); resolve(false); } } }, t('cancel')),
        h('button.btn', { class: opts.danger ? 'danger' : '', on: { click: () => { s.close(); resolve(true); } } }, opts.okLabel || t('ok'))),
    ], { onClose: () => resolve(false) });
  });
}

export function promptDialog(title, fields) {
  // fields: [{key,label,value,type}]
  return new Promise((resolve) => {
    const inputs = {};
    const nodes = fields.map((f) => {
      const inp = f.type === 'textarea' ? h('textarea.input', { rows: 3 }) : h('input.input', { type: f.type || 'text' });
      inp.value = f.value || '';
      inputs[f.key] = inp;
      return h('div.field', { style: { padding: '6px 16px' } }, h('label', f.label), inp);
    });
    const s = sheet(title, [
      ...nodes,
      h('div.row', { style: { padding: '12px 16px 16px', justifyContent: 'flex-end' } },
        h('button.btn.ghost', { on: { click: () => { s.close(); resolve(null); } } }, t('cancel')),
        h('button.btn', { on: { click: () => { const out = {}; for (const k of Object.keys(inputs)) out[k] = inputs[k].value; s.close(); resolve(out); } } }, t('save'))),
    ], { onClose: () => resolve(null) });
    setTimeout(() => { const first = Object.values(inputs)[0]; first && first.focus(); }, 50);
  });
}

export function switchEl(on, onChange) {
  const b = h('button.switch', { class: on ? 'on' : '', role: 'switch', 'aria-checked': on ? 'true' : 'false' });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', v ? 'true' : 'false'); onChange(v); });
  return b;
}
export function segmented(options, value, onChange) {
  const seg = h('div.seg');
  for (const o of options) {
    const b = h('button', { class: o.value === value ? 'on' : '', on: { click: () => { seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(o.value); } } }, o.label);
    seg.appendChild(b);
  }
  return seg;
}
export function initials(name) {
  return (name || '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
}
