// Canvas track map: GPS traces of the selected laps, track definition (start line, sectors, curves),
// cursor markers, and optional OpenStreetMap raster tiles (Web Mercator) when online.

const TILE = 256;

/** Raster tile providers. `{z}/{x}/{y}` placeholders. */
export const PROVIDERS = {
  osm: { id: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 },
  satellite: { id: 'satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, Maxar, Earthstar Geographics', maxZoom: 19 },
  custom: { id: 'custom', url: '', attribution: '', maxZoom: 20 },
};
/** Provider from settings ({mapStyle, customTileUrl}). */
export function providerFor(settings) {
  if (settings.mapStyle === 'custom' && settings.customTileUrl) return { ...PROVIDERS.custom, url: settings.customTileUrl };
  if (settings.mapStyle === 'satellite') return PROVIDERS.satellite;
  return PROVIDERS.osm;
}
function tileUrl(p, z, x, y) { return p.url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a'); }

function lngToWorld(lng) { return ((lng + 180) / 360) * TILE; }
function latToWorld(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE;
}

export class TrackMap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{tiles?:boolean,onTap?:(lat:number,lng:number)=>void}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.tilesEnabled = opts.tiles !== false;
    this.provider = opts.provider || PROVIDERS.osm;
    this.fitZoom = 1;
    this.tracks = []; this.def = null; this.cursors = []; this.showSectors = true; this.customSplits = [];
    this.center = { x: TILE / 2, y: TILE / 2 }; this.zoom = 1; // world coords at zoom 0 + fractional zoom
    this.tileCache = new Map(); this.pending = new Set();
    this.pointers = new Map(); this.gesture = null; this.raf = 0;
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.fitted = false;
    this._bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
    this.resize();
  }
  destroy() { this.ro.disconnect(); this._unbind(); if (this.raf) cancelAnimationFrame(this.raf); }
  resize() {
    const p = this.canvas.parentElement || this.canvas;
    this.w = Math.max(50, p.clientWidth); this.h = Math.max(50, p.clientHeight);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    if (!this.fitted) this.fit(); else this.requestDraw();
  }
  setTiles(on) { this.tilesEnabled = !!on; this.requestDraw(); }
  setProvider(p) { if (!p || (this.provider && p.url === this.provider.url)) return; this.provider = p; this.tileCache.clear(); this.requestDraw(); }
  /** Center the view on a coordinate (used by "follow cursor"). */
  centerOn(lat, lng) { if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; this.center = { x: lngToWorld(lng), y: latToWorld(lat) }; this.requestDraw(); }

  /** tracks: [{lat,lng,n,color}], def: trackDef, cursors: [{lat,lng,color}] */
  setData({ tracks, def, cursors, showSectors, splitPositions, legend }) {
    this.legend = legend || '';
    const changed = !this.tracks.length || tracks.length !== this.tracks.length || (this.def !== def);
    this.tracks = tracks || []; this.def = def || null; this.cursors = cursors || [];
    this.showSectors = showSectors !== false; this.splitPositions = splitPositions || [];
    if (changed || !this.fitted) this.fit(); else this.requestDraw();
  }
  setCursors(cursors) { this.cursors = cursors || []; this.requestDraw(); }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of this.tracks) {
      for (let i = 0; i < t.n; i += 2) {
        if (!(Math.abs(t.lat[i]) > 0.0001)) continue;
        const x = lngToWorld(t.lng[i]), y = latToWorld(t.lat[i]);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX) && this.def && this.def.startLine && this.def.startLine.length) {
      for (const p of this.def.startLine) { const x = lngToWorld(p.lng), y = latToWorld(p.lat); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }
  fit() {
    const b = this.bounds();
    if (!b) { this.requestDraw(); return; }
    const pad = 24;
    const spanX = Math.max(1e-9, b.maxX - b.minX), spanY = Math.max(1e-9, b.maxY - b.minY);
    const zx = Math.log2((this.w - 2 * pad) / spanX), zy = Math.log2((this.h - 2 * pad) / spanY);
    this.zoom = Math.max(1, Math.min(20, Math.min(zx, zy)));
    this.center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    this.fitZoom = this.zoom;
    this.fitted = true;
    this.requestDraw();
  }
  scale() { return Math.pow(2, this.zoom); }
  toPx(lat, lng) {
    const s = this.scale();
    return { x: (lngToWorld(lng) - this.center.x) * s + this.w / 2, y: (latToWorld(lat) - this.center.y) * s + this.h / 2 };
  }
  worldToPx(wx, wy) { const s = this.scale(); return { x: (wx - this.center.x) * s + this.w / 2, y: (wy - this.center.y) * s + this.h / 2 }; }
  pxToWorld(px, py) { const s = this.scale(); return { x: (px - this.w / 2) / s + this.center.x, y: (py - this.h / 2) / s + this.center.y }; }

  requestDraw() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

  draw() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const css = getComputedStyle(this.canvas);
    ctx.fillStyle = css.getPropertyValue('--map-bg').trim() || '#0d2140';
    ctx.fillRect(0, 0, this.w, this.h);
    let tilesDrawn = false;
    if (this.tilesEnabled && navigator.onLine !== false || (this.tilesEnabled && this.tileCache.size)) tilesDrawn = this._drawTiles(ctx);
    // tracks
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const t of this.tracks) {
      if (!t.n) continue;
      ctx.strokeStyle = tilesDrawn ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)'; ctx.lineWidth = 5;
      this._tracePath(ctx, t); ctx.stroke();
    }
    for (const t of this.tracks) {
      if (!t.n) continue;
      if (t.colors) { this._traceColored(ctx, t); continue; }
      ctx.strokeStyle = t.color; ctx.lineWidth = 2.5;
      this._tracePath(ctx, t); ctx.stroke();
    }
    if (this.legend) {
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(this.legend).width + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(6, this.h - 24, tw, 18, 5) : ctx.rect(6, this.h - 24, tw, 18); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(this.legend, 12, this.h - 9);
    }
    // track definition
    if (this.def) {
      const sectorColor = css.getPropertyValue('--sector-default').trim() || '#6be5f6';
      const drawLine = (pts, color, width, dash) => {
        if (!pts || pts.length < 2) return;
        ctx.beginPath();
        pts.forEach((p, i) => { const q = this.toPx(p.lat, p.lng); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
        // dark halo so the line is readable on light street tiles as well as on satellite imagery
        ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = width + 2.5; ctx.stroke();
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
      };
      drawLine(this.def.startLine, '#ffffff', 3);
      if (this.showSectors) {
        (this.def.sectors || []).forEach((s, i) => {
          drawLine(s.points, sectorColor, 2, [5, 4]);
          if (s.points && s.points.length) { const q = this.toPx(s.points[0].lat, s.points[0].lng); this._label(ctx, `S${i + 1}`, q.x, q.y - 10, '#ffffff', true); }
        });
      }
      (this.def.curves || []).forEach((c) => {
        if (!c.points || !c.points.length) return;
        const mid = c.points[Math.floor(c.points.length / 2)];
        const q = this.toPx(mid.lat, mid.lng);
        const num = (c.name || '').replace(/\D+/g, '') || c.name;
        this._label(ctx, num, q.x, q.y, 'rgba(255,255,255,0.75)', true);
      });
    }
    // custom split markers (positions along the reference track)
    for (const sp of this.splitPositions || []) {
      const q = this.toPx(sp.lat, sp.lng);
      ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - 9); ctx.lineTo(q.x + 6, q.y); ctx.lineTo(q.x, q.y + 9); ctx.lineTo(q.x - 6, q.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (sp.label) this._label(ctx, sp.label, q.x, q.y - 18, '#ffe14d', true);
    }
    // cursors
    for (const c of this.cursors) {
      if (!Number.isFinite(c.lat) || !(Math.abs(c.lat) > 0.0001)) continue;
      const q = this.toPx(c.lat, c.lng);
      ctx.fillStyle = c.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // attribution
    if (tilesDrawn) {
      ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      const txt = this.provider.attribution || '';
      const tw = ctx.measureText(txt).width + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(this.w - tw, this.h - 14, tw, 14);
      ctx.fillStyle = '#222'; ctx.fillText(txt, this.w - 4, this.h - 2);
    }
  }
  _label(ctx, text, x, y, color, boxed) {
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (boxed) {
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 8, w, 16, 4) : ctx.rect(x - w / 2, y - 8, w, 16); ctx.fill();
    }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  /** Track drawn in runs of equal colour (t.colors[i] per sample) – e.g. red where time is lost, green where gained. */
  _traceColored(ctx, t) {
    ctx.lineWidth = 4;
    let i = 0;
    while (i < t.n) {
      const col = t.colors[i];
      ctx.strokeStyle = col; ctx.beginPath();
      let started = false, j = i;
      for (; j < t.n && t.colors[j] === col; j++) {
        if (!(Math.abs(t.lat[j]) > 0.0001)) { started = false; continue; }
        const q = this.toPx(t.lat[j], t.lng[j]);
        if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
      }
      // overlap one sample into the next run so there are no gaps
      if (j < t.n && Math.abs(t.lat[j]) > 0.0001 && started) { const q = this.toPx(t.lat[j], t.lng[j]); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
      i = j;
    }
  }
  _tracePath(ctx, t) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < t.n; i++) {
      if (!(Math.abs(t.lat[i]) > 0.0001)) { started = false; continue; }
      const q = this.toPx(t.lat[i], t.lng[i]);
      if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
    }
  }
  _drawTiles(ctx) {
    if (!this.provider.url) return false;
    const z = Math.max(0, Math.min(this.provider.maxZoom || 19, Math.floor(this.zoom)));
    const n = Math.pow(2, z);
    const scaleTile = Math.pow(2, this.zoom - z); // on-screen px per tile px
    const tl = this.pxToWorld(0, 0), br = this.pxToWorld(this.w, this.h);
    const tx0 = Math.floor((tl.x / TILE) * n), tx1 = Math.floor((br.x / TILE) * n);
    const ty0 = Math.max(0, Math.floor((tl.y / TILE) * n)), ty1 = Math.min(n - 1, Math.floor((br.y / TILE) * n));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) return false;
    let any = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const wrapped = ((tx % n) + n) % n;
        const key = `${z}/${wrapped}/${ty}`;
        const img = this._tile(z, wrapped, ty, key);
        const p = this.worldToPx((tx / n) * TILE, (ty / n) * TILE);
        const size = TILE * scaleTile;
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, p.x, p.y, size + 0.5, size + 0.5);
          any = true;
        } else {
          // try a parent tile as placeholder
          const parent = this._parentTile(z, wrapped, ty);
          if (parent) {
            const { img: pimg, sx, sy, sw } = parent;
            ctx.drawImage(pimg, sx, sy, sw, sw, p.x, p.y, size + 0.5, size + 0.5);
            any = true;
          }
        }
      }
    }
    return any;
  }
  _tile(z, x, y, key) {
    let img = this.tileCache.get(key);
    if (img) return img;
    if (navigator.onLine === false && !this.tileCache.size) { /* still try: SW cache may have it */ }
    img = new Image();
    img.decoding = 'async';
    img.onload = () => this.requestDraw();
    img.onerror = () => { img.failed = true; };
    img.src = tileUrl(this.provider, z, x, y);
    this.tileCache.set(key, img);
    if (this.tileCache.size > 400) { const first = this.tileCache.keys().next().value; this.tileCache.delete(first); }
    return img;
  }
  _parentTile(z, x, y) {
    for (let dz = 1; dz <= 3 && z - dz >= 0; dz++) {
      const pz = z - dz, px = x >> dz, py = y >> dz;
      const img = this.tileCache.get(`${pz}/${px}/${py}`);
      if (img && img.complete && img.naturalWidth) {
        const f = Math.pow(2, dz); const sw = TILE / f;
        return { img, sx: (x - px * f) * sw, sy: (y - py * f) * sw, sw };
      }
    }
    return null;
  }

  // ---- gestures ------------------------------------------------------------------------
  _bind() {
    const c = this.canvas;
    this._onDown = (e) => {
      c.setPointerCapture && c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 1) this.gesture = { type: 'pan', last: { x: e.offsetX, y: e.offsetY }, start: { x: e.offsetX, y: e.offsetY }, moved: false };
      else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
    };
    this._onMove = (e) => {
      if (!this.pointers.has(e.pointerId) || !this.gesture) return;
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.gesture.type === 'pan') {
        const dx = e.offsetX - this.gesture.last.x, dy = e.offsetY - this.gesture.last.y;
        if (Math.abs(e.offsetX - this.gesture.start.x) > 4 || Math.abs(e.offsetY - this.gesture.start.y) > 4) this.gesture.moved = true;
        const s = this.scale();
        this.center.x -= dx / s; this.center.y -= dy / s;
        this.gesture.last = { x: e.offsetX, y: e.offsetY };
        this.requestDraw();
      } else if (this.gesture.type === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this._zoomAt(Math.log2(dist / this.gesture.dist), this.gesture.center);
        const s = this.scale();
        this.center.x -= (center.x - this.gesture.center.x) / s; this.center.y -= (center.y - this.gesture.center.y) / s;
        this.gesture.dist = dist; this.gesture.center = center;
        this.requestDraw();
      }
    };
    this._onUp = (e) => {
      const wasTap = this.gesture && this.gesture.type === 'pan' && !this.gesture.moved && this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (wasTap && this.opts.onTap) {
        const w = this.pxToWorld(e.offsetX, e.offsetY);
        const lng = (w.x / TILE) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * w.y) / TILE))) * 180) / Math.PI;
        this.opts.onTap(lat, lng);
      }
      if (this.pointers.size === 0) this.gesture = null;
      else if (this.pointers.size === 1) { const [p] = [...this.pointers.values()]; this.gesture = { type: 'pan', last: { ...p }, start: { ...p }, moved: true }; }
    };
    this._onWheel = (e) => { e.preventDefault(); this._zoomAt(-e.deltaY * 0.0025, { x: e.offsetX, y: e.offsetY }); this.requestDraw(); };
    this._onDbl = () => this.fit();
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
  _zoomAt(dz, px) {
    const before = this.pxToWorld(px.x, px.y);
    this.zoom = Math.max(1, Math.min(21, this.zoom + dz));
    const after = this.pxToWorld(px.x, px.y);
    this.center.x += before.x - after.x; this.center.y += before.y - after.y;
  }
}

/** Nearest sample index on a track to a lat/lng (planar approx.) */
export function nearestSample(s, lat, lng) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1, bd = Infinity;
  for (let i = 0; i < s.n; i++) {
    const dx = (s.lng[i] - lng) * k, dy = s.lat[i] - lat;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return { index: best, distDeg: Math.sqrt(bd) };
}
