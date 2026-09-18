// Canvas line chart with multi-lap series, secondary axis, shared cursor, touch pinch-zoom/pan on both axes.

import { interpAt, niceStep } from './analysis.js';

const PAD = { left: 46, right: 12, top: 30, bottom: 30 };
const FONT = '11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const FONT_BOLD = '600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export class LineChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onCursor?:(x:number)=>void,onView?:(x0:number,x1:number)=>void,onLongPress?:(x:number)=>void}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.series = [];
    this.series2 = [];
    this.markers = [];
    this.xLabel = ''; this.yLabel = ''; this.y2Label = '';
    this.xMax = 1;
    this.view = null;   // [x0,x1] or null = full
    this.yView = null;  // [y0,y1] or null = auto
    this.cursor = 0;
    this.yRange = null; this.y2Range = null;
    this.zeroLine = false;
    this.pointers = new Map();
    this.gesture = null;
    this.raf = 0;
    this.reserveRight = 0;
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this._bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
    this.resize();
  }

  destroy() { this.ro.disconnect(); if (this.raf) cancelAnimationFrame(this.raf); this._unbind(); }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const w = Math.max(50, parent.clientWidth), h = Math.max(50, parent.clientHeight);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.requestDraw();
  }

  setData(d) {
    this.series = d.series || [];
    this.series2 = d.series2 || [];
    this.markers = d.markers || [];
    this.xMax = Math.max(1e-6, d.xMax || 1);
    this.xLabel = d.xLabel || ''; this.yLabel = d.yLabel || ''; this.y2Label = d.y2Label || '';
    this.fmt = d.fmt || ((v) => (Number.isFinite(v) ? v.toFixed(1) : '–'));
    this.fmt2 = d.fmt2 || this.fmt;
    this.fmtX = d.fmtX || ((v) => Math.round(v).toString());
    this.zeroLine = !!d.zeroLine;
    this.yRange = d.yRange || null; this.y2Range = d.y2Range || null;
    this.empty = d.empty || '';
    if (d.resetY) this.yView = null;
    if (this.view) {
      const [a, b] = this.view;
      if (a >= this.xMax || b - a < 1e-6) this.view = null;
      else this.view = [Math.max(0, a), Math.min(this.xMax, b)];
    }
    this.requestDraw();
  }

  setCursor(x) { this.cursor = x; this.requestDraw(); }
  setReserveRight(px) { this.reserveRight = Math.max(0, px || 0); this.requestDraw(); }
  getView() { return this.view ? [...this.view] : [0, this.xMax]; }
  setView(x0, x1, silent = false) {
    if (x1 - x0 >= this.xMax - 1e-9 || x1 - x0 <= 0) this.view = null;
    else this.view = [Math.max(0, x0), Math.min(this.xMax, x1)];
    this.requestDraw();
    if (!silent && this.opts.onView) { const v = this.getView(); this.opts.onView(v[0], v[1]); }
  }
  resetView() { this.yView = null; this.setView(0, this.xMax); }
  zoomBy(factor, centerX) {
    const [a, b] = this.getView();
    const c = Number.isFinite(centerX) ? centerX : (a + b) / 2;
    const span = (b - a) * factor;
    if (span < this.xMax * 0.01) return;
    const f = (c - a) / (b - a);
    let na = c - span * f; let nb = na + span;
    if (na < 0) { nb -= na; na = 0; }
    if (nb > this.xMax) { na -= nb - this.xMax; nb = this.xMax; na = Math.max(0, na); }
    this.setView(na, nb);
  }
  /** Zoom the primary y axis by factor around value cy (auto range when factor >= 1 and back to full). */
  zoomYBy(factor, cy) {
    const yr = this.currentYRange();
    const c = Number.isFinite(cy) ? cy : (yr[0] + yr[1]) / 2;
    const auto = this.computeYRange(this.series, this.yRange);
    let span = (yr[1] - yr[0]) * factor;
    const autoSpan = auto[1] - auto[0];
    if (span >= autoSpan * 0.999) { this.yView = null; this.requestDraw(); return; }
    if (span < autoSpan * 0.02) span = autoSpan * 0.02;
    const f = (c - yr[0]) / (yr[1] - yr[0]);
    this.yView = [c - span * f, c - span * f + span];
    this.requestDraw();
  }
  panY(dy) {
    if (!this.yView) return;
    this.yView = [this.yView[0] + dy, this.yView[1] + dy];
    this.requestDraw();
  }
  currentYRange() { return this.yView || this.computeYRange(this.series, this.yRange); }

  requestDraw() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

  // ---- geometry helpers ------------------------------------------------------------
  plotRect() {
    const right = this.series2.length ? 46 : PAD.right;
    return { x: PAD.left, y: PAD.top, w: Math.max(10, this.w - PAD.left - right), h: Math.max(10, this.h - PAD.top - PAD.bottom) };
  }
  xToPx(x, r, v) { return r.x + ((x - v[0]) / (v[1] - v[0])) * r.w; }
  pxToX(px, r, v) { return v[0] + ((px - r.x) / r.w) * (v[1] - v[0]); }
  pyToY(py, r, yr) { return yr[1] - ((py - r.y) / r.h) * (yr[1] - yr[0]); }

  computeYRange(list, forced) {
    if (forced) return forced;
    let lo = Infinity, hi = -Infinity;
    for (const s of list) for (let i = 0; i < s.n; i++) { const y = s.y[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { hi = lo + 1; lo = lo - 1; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  // ---- drawing ------------------------------------------------------------------------
  draw() {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const r = this.plotRect();
    const v = this.getView();
    const css = getComputedStyle(this.canvas);
    const colGrid = css.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.12)';
    const colText = css.getPropertyValue('--chart-text').trim() || '#c9d3e6';
    const colAxis = css.getPropertyValue('--chart-axis').trim() || 'rgba(255,255,255,0.35)';
    const colCursor = css.getPropertyValue('--chart-cursor').trim() || '#ff3b30';
    const colMarker = css.getPropertyValue('--chart-marker').trim() || '#6be5f6';

    ctx.fillStyle = css.getPropertyValue('--chart-bg').trim() || 'rgba(0,0,0,0.15)';
    ctx.fillRect(r.x, r.y, r.w, r.h);

    if (!this.series.length && !this.series2.length) {
      ctx.fillStyle = colText; ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.empty || '', r.x + r.w / 2, r.y + r.h / 2);
      this._drawXAxis(ctx, r, v, colGrid, colText, colAxis);
      return;
    }

    const yr = this.currentYRange();
    const yr2 = this.series2.length ? this.computeYRange(this.series2, this.y2Range) : null;
    const yToPx = (y) => r.y + r.h - ((y - yr[0]) / (yr[1] - yr[0])) * r.h;
    const y2ToPx = (y) => r.y + r.h - ((y - yr2[0]) / (yr2[1] - yr2[0])) * r.h;

    // grid + y axes
    ctx.font = FONT; ctx.fillStyle = colText; ctx.strokeStyle = colGrid; ctx.lineWidth = 1;
    const ystep = niceStep(yr[1] - yr[0], Math.max(2, Math.floor(r.h / 40)));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yr[0] / ystep) * ystep; y <= yr[1] + 1e-9; y += ystep) {
      const py = yToPx(y);
      ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
      ctx.fillText(formatTick(y, ystep), r.x - 6, py);
    }
    if (yr2) {
      const ystep2 = niceStep(yr2[1] - yr2[0], Math.max(2, Math.floor(r.h / 40)));
      ctx.textAlign = 'left';
      for (let y = Math.ceil(yr2[0] / ystep2) * ystep2; y <= yr2[1] + 1e-9; y += ystep2) ctx.fillText(formatTick(y, ystep2), r.x + r.w + 6, y2ToPx(y));
    }
    this._drawXAxis(ctx, r, v, colGrid, colText, colAxis);
    if (this.yView) { // zoomed-y indicator
      ctx.fillStyle = colMarker; ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('⤢', r.x + 3, r.y + r.h - 2);
    }

    // axis labels
    ctx.save(); ctx.translate(12, r.y + r.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = FONT; ctx.fillStyle = colText; ctx.fillText(this.yLabel, 0, 0); ctx.restore();
    if (yr2) { ctx.save(); ctx.translate(this.w - 8, r.y + r.h / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = FONT; ctx.fillStyle = colText; ctx.fillText(this.y2Label, 0, 0); ctx.restore(); }

    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    if (this.zeroLine && yr[0] < 0 && yr[1] > 0) {
      ctx.strokeStyle = colAxis; ctx.lineWidth = 1; ctx.beginPath(); const py = yToPx(0); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
    }
    for (const m of this.markers) {
      if (m.x < v[0] || m.x > v[1]) continue;
      const px = this.xToPx(m.x, r, v);
      ctx.strokeStyle = m.color || colMarker; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke(); ctx.setLineDash([]);
      if (m.label) { ctx.fillStyle = m.color || colMarker; ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(m.label, px + 3, r.y + 3); }
    }
    const drawSeries = (list, toPx, width) => {
      for (const s of list) {
        if (!s.n) continue;
        ctx.strokeStyle = s.color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        let started = false;
        let i0 = 0; while (i0 < s.n - 1 && s.x[i0 + 1] < v[0]) i0++;
        const stepPx = r.w / Math.max(1, s.n);
        let lastPx = -Infinity;
        for (let i = i0; i < s.n; i++) {
          const x = s.x[i];
          if (x > v[1]) { if (started) { const y = s.y[i]; if (Number.isFinite(y)) ctx.lineTo(this.xToPx(x, r, v), toPx(y)); } break; }
          const y = s.y[i];
          if (!Number.isFinite(y)) { started = false; continue; }
          const px = this.xToPx(x, r, v);
          if (stepPx < 0.5 && px - lastPx < 0.5 && i < s.n - 1) continue;
          lastPx = px;
          const py = toPx(y);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    };
    if (yr2) drawSeries(this.series2, y2ToPx, 1.2);
    drawSeries(this.series, yToPx, 2.2);
    if (Number.isFinite(this.cursor) && this.cursor >= v[0] && this.cursor <= v[1]) {
      const px = this.xToPx(this.cursor, r, v);
      ctx.strokeStyle = colCursor; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
      for (const s of this.series) {
        const y = interpAt(s.x, s.y, this.cursor, s.n);
        if (!Number.isFinite(y)) continue;
        ctx.fillStyle = s.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, yToPx(y), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();

    // cursor value labels
    if (Number.isFinite(this.cursor)) {
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      const maxX = this.w - this.reserveRight - 4;
      const vals = this.series.map((s) => ({ c: s.color, t: this.fmt(interpAt(s.x, s.y, this.cursor, s.n)), bold: true }));
      const vals2 = this.series2.map((s) => ({ c: s.color, t: this.fmt2(interpAt(s.x, s.y, this.cursor, s.n)), bold: false }));
      let cx = r.x + 4, row = 0;
      const rowsY = [2, 16];
      for (const vv of [...vals, ...vals2]) {
        ctx.font = vv.bold ? FONT_BOLD : FONT;
        const w = ctx.measureText(vv.t).width;
        if (cx + w > maxX) { row++; cx = r.x + 4; if (row >= rowsY.length) break; }
        ctx.fillStyle = vv.c; ctx.fillText(vv.t, cx, rowsY[row]); cx += w + 10;
      }
      const px = this.xToPx(this.cursor, r, v);
      if (px >= r.x && px <= r.x + r.w) {
        ctx.font = FONT_BOLD; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const txt = this.fmtX(this.cursor);
        const tw = ctx.measureText(txt).width + 8;
        ctx.fillStyle = colCursor;
        ctx.fillRect(Math.min(Math.max(px - tw / 2, r.x), r.x + r.w - tw), r.y + r.h + 1, tw, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(txt, Math.min(Math.max(px, r.x + tw / 2), r.x + r.w - tw / 2), r.y + r.h + 2);
      }
    }
  }

  _drawXAxis(ctx, r, v, colGrid, colText, colAxis) {
    ctx.font = FONT; ctx.fillStyle = colText; ctx.strokeStyle = colGrid; ctx.lineWidth = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xstep = niceStep(v[1] - v[0], Math.max(2, Math.floor(r.w / 70)));
    for (let x = Math.ceil(v[0] / xstep) * xstep; x <= v[1] + 1e-9; x += xstep) {
      const px = this.xToPx(x, r, v);
      ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
      ctx.fillText(formatTick(x, xstep), px, r.y + r.h + 4);
    }
    ctx.strokeStyle = colAxis;
    ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(this.xLabel, r.x + r.w, this.h - 1);
  }

  // ---- interaction --------------------------------------------------------------------
  // one finger: cursor · long press: callback · two fingers: pinch (x and/or y) + pan · wheel: zoom x (over y axis: zoom y) · double tap: reset
  _bind() {
    const c = this.canvas;
    this._onDown = (e) => {
      c.setPointerCapture && c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 1) {
        // the cursor follows on move or on release (tap) – not on touch-down, so the first finger of a pinch does not jump it
        this.gesture = { type: 'cursor', startX: e.offsetX, startY: e.offsetY, moved: false };
        this._longPressTimer = setTimeout(() => {
          if (this.gesture && this.gesture.type === 'cursor' && !this.gesture.moved && this.opts.onLongPress) {
            this.opts.onLongPress(this._pxToXClamped(e.offsetX));
            if (navigator.vibrate) navigator.vibrate(20);
          }
        }, 600);
      } else if (this.pointers.size === 2) {
        clearTimeout(this._longPressTimer);
        const [a, b] = [...this.pointers.values()];
        this.gesture = {
          type: 'pinch', dx0: Math.abs(a.x - b.x) || 1, dy0: Math.abs(a.y - b.y) || 1,
          cx0: (a.x + b.x) / 2, cy0: (a.y + b.y) / 2, view0: this.getView(), yview0: this.currentYRange(),
        };
      }
    };
    this._onMove = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (!this.gesture) return;
      if (this.gesture.type === 'cursor') {
        if (Math.abs(e.offsetX - this.gesture.startX) > 4 || Math.abs(e.offsetY - this.gesture.startY) > 4) { this.gesture.moved = true; clearTimeout(this._longPressTimer); }
        this._cursorFromPx(e.offsetX);
      } else if (this.gesture.type === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const g = this.gesture;
        const r = this.plotRect();
        const dx = Math.abs(a.x - b.x) || 1, dy = Math.abs(a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const horizontal = g.dx0 > 40 || g.dx0 >= g.dy0; // fingers spread horizontally → x zoom
        const vertical = g.dy0 > 40 && g.dy0 > g.dx0 * 0.6; // spread vertically → y zoom
        // x
        const [v0, v1] = g.view0; const span0 = v1 - v0;
        let span = horizontal ? Math.min(this.xMax, Math.max(this.xMax * 0.01, span0 * (g.dx0 / dx))) : span0;
        const f = (g.cx0 - r.x) / r.w;
        const xAtStart = v0 + f * span0;
        let na = xAtStart - span * f - ((cx - g.cx0) / r.w) * span;
        na = Math.max(0, Math.min(this.xMax - span, na));
        this.setView(na, na + span);
        // y
        if (vertical || this.yView) {
          const [y0, y1] = g.yview0; const yspan0 = y1 - y0;
          const yspan = vertical ? yspan0 * (g.dy0 / dy) : yspan0;
          const fy = (r.y + r.h - g.cy0) / r.h;
          const yAtStart = y0 + fy * yspan0;
          const ny0 = yAtStart - yspan * fy + ((cy - g.cy0) / r.h) * yspan;
          const auto = this.computeYRange(this.series, this.yRange);
          if (yspan >= (auto[1] - auto[0]) * 0.999 && Math.abs(ny0 - auto[0]) < (auto[1] - auto[0]) * 0.02) this.yView = null;
          else this.yView = [ny0, ny0 + yspan];
          this.requestDraw();
        }
      }
    };
    this._onUp = (e) => {
      if (this.gesture && this.gesture.type === 'cursor' && !this.gesture.moved && this.pointers.size === 1) this._cursorFromPx(e.offsetX); // tap
      this.pointers.delete(e.pointerId);
      clearTimeout(this._longPressTimer);
      if (this.pointers.size === 0) this.gesture = null;
      else if (this.pointers.size === 1) { const [p] = [...this.pointers.values()]; this.gesture = { type: 'cursor', startX: p.x, startY: p.y, moved: true }; }
    };
    this._onWheel = (e) => {
      e.preventDefault();
      const r = this.plotRect();
      const v = this.getView();
      const overYAxis = e.offsetX < r.x;
      if (overYAxis || e.shiftKey) {
        this.zoomYBy(Math.exp(e.deltaY * 0.0015), this.pyToY(e.offsetY, r, this.currentYRange()));
      } else if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this.zoomBy(Math.exp(e.deltaY * 0.0015), this.pxToX(e.offsetX, r, v));
      } else {
        const dx = (e.deltaX / r.w) * (v[1] - v[0]);
        let na = v[0] + dx, nb = v[1] + dx;
        if (na < 0) { nb -= na; na = 0; } if (nb > this.xMax) { na -= nb - this.xMax; nb = this.xMax; }
        this.setView(na, nb);
      }
    };
    this._onDbl = () => this.resetView();
    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointermove', this._onMove);
    c.addEventListener('pointerup', this._onUp);
    c.addEventListener('pointercancel', this._onUp);
    c.addEventListener('wheel', this._onWheel, { passive: false });
    c.addEventListener('dblclick', this._onDbl);
  }
  _unbind() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown); c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp); c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('wheel', this._onWheel); c.removeEventListener('dblclick', this._onDbl);
  }
  _pxToXClamped(px) { const r = this.plotRect(); const v = this.getView(); return Math.max(v[0], Math.min(v[1], this.pxToX(px, r, v))); }
  _cursorFromPx(px) { const x = this._pxToXClamped(px); this.cursor = x; this.requestDraw(); if (this.opts.onCursor) this.opts.onCursor(x); }
}

function formatTick(v, step) {
  const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  const s = v.toFixed(dec);
  return s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s;
}

/** Scatter plot (G‑force): x = lateral, y = longitudinal. Pinch/wheel zoom. */
export class ScatterChart {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.series = []; this.range = 2.5; this.zoom = 1;
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
    this._onWheel = (e) => { e.preventDefault(); this.zoom = Math.max(1, Math.min(6, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.draw(); };
    this._pointers = new Map(); this._d0 = 0; this._z0 = 1;
    this._onDown = (e) => { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); this._pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); if (this._pointers.size === 2) { const [a, b] = [...this._pointers.values()]; this._d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; this._z0 = this.zoom; } };
    this._onMove = (e) => { if (!this._pointers.has(e.pointerId)) return; this._pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); if (this._pointers.size === 2) { const [a, b] = [...this._pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; this.zoom = Math.max(1, Math.min(6, this._z0 * (d / this._d0))); this.draw(); } };
    this._onUp = (e) => { this._pointers.delete(e.pointerId); };
    this._onDbl = () => { this.zoom = 1; this.draw(); };
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this._onDown); canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp); canvas.addEventListener('pointercancel', this._onUp); canvas.addEventListener('dblclick', this._onDbl);
    this.resize();
  }
  destroy() { this.ro.disconnect(); const c = this.canvas; c.removeEventListener('wheel', this._onWheel); c.removeEventListener('pointerdown', this._onDown); c.removeEventListener('pointermove', this._onMove); c.removeEventListener('pointerup', this._onUp); c.removeEventListener('pointercancel', this._onUp); c.removeEventListener('dblclick', this._onDbl); }
  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    this.w = Math.max(50, parent.clientWidth); this.h = Math.max(50, parent.clientHeight);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    this.draw();
  }
  setData(series, xLabel, yLabel) {
    this.series = series; this.xLabel = xLabel; this.yLabel = yLabel;
    let m = 1;
    for (const s of series) for (let i = 0; i < s.n; i++) { const a = Math.abs(s.x[i]), b = Math.abs(s.y[i]); if (a > m) m = a; if (b > m) m = b; }
    this.range = Math.ceil(m * 2) / 2 + 0.5;
    this.draw();
  }
  draw() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const css = getComputedStyle(this.canvas);
    const colGrid = css.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.12)';
    const colText = css.getPropertyValue('--chart-text').trim() || '#c9d3e6';
    const colAxis = css.getPropertyValue('--chart-axis').trim() || 'rgba(255,255,255,0.4)';
    const pad = { l: 40, r: 12, t: 12, b: 34 };
    const w = this.w - pad.l - pad.r, h = this.h - pad.t - pad.b;
    const size = Math.min(w, h);
    const ox = pad.l + (w - size) / 2, oy = pad.t + (h - size) / 2;
    const R = this.range / this.zoom;
    const X = (x) => ox + ((x + R) / (2 * R)) * size;
    const Y = (y) => oy + size - ((y + R) / (2 * R)) * size;
    ctx.fillStyle = css.getPropertyValue('--chart-bg').trim() || 'rgba(0,0,0,0.15)';
    ctx.fillRect(ox, oy, size, size);
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, size, size); ctx.clip();
    ctx.strokeStyle = colGrid; ctx.lineWidth = 1; ctx.font = FONT; ctx.fillStyle = colText;
    const step = R > 3 ? 1 : R > 1.2 ? 0.5 : 0.25;
    for (let v = -Math.floor(R / step) * step; v <= R + 1e-9; v += step) {
      ctx.beginPath(); ctx.moveTo(X(v), oy); ctx.lineTo(X(v), oy + size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, Y(v)); ctx.lineTo(ox + size, Y(v)); ctx.stroke();
    }
    ctx.strokeStyle = colAxis; ctx.beginPath(); ctx.moveTo(X(0), oy); ctx.lineTo(X(0), oy + size); ctx.moveTo(ox, Y(0)); ctx.lineTo(ox + size, Y(0)); ctx.stroke();
    ctx.strokeStyle = colGrid; ctx.setLineDash([3, 4]);
    for (let g = step; g <= R * 1.5; g += step) { ctx.beginPath(); ctx.arc(X(0), Y(0), (g / (2 * R)) * size, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const s of this.series) { ctx.fillStyle = s.color; for (let i = 0; i < s.n; i++) { ctx.beginPath(); ctx.arc(X(s.x[i]), Y(s.y[i]), 1.8, 0, Math.PI * 2); ctx.fill(); } }
    for (const s of this.series) if (s.highlight && Number.isFinite(s.highlight.x)) { ctx.fillStyle = s.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(s.highlight.x), Y(s.highlight.y), 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = colText; ctx.font = FONT;
    for (let v = -Math.floor(R / step) * step; v <= R + 1e-9; v += step) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(v.toFixed(step < 0.5 ? 2 : 1), X(v), oy + size + 4);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(v.toFixed(step < 0.5 ? 2 : 1), ox - 4, Y(v));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(this.xLabel || '', ox + size / 2, this.h - 2);
    ctx.save(); ctx.translate(10, oy + size / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(this.yLabel || '', 0, 0); ctx.restore();
  }
}
