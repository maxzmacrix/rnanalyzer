// Playback engine: drives the shared cursor from the reference lap's video (or a clock) and keeps
// all other videos synchronized by distance (or time) with the cursor.

import { state, setCursor, on, emit, ensureSamples, refLapId } from './state.js';
import { timeAtDistance, distanceAtTime } from './analysis.js';

const DRIFT_TOLERANCE = 0.35; // seconds

class Player {
  constructor() {
    this.playing = false;
    this.videos = new Map(); // lapId -> { el, offsetS }
    this.raf = 0;
    this.lastTs = 0;
    this.clockT = 0; // reference lap time (s) in clock mode
    this.lastSyncCheck = 0;
    on('cursor', (e) => { if (e && e.source !== 'player') this.onExternalCursor(); });
    on('selection', () => { if (!state.selected.length) this.pause(); });
  }

  get speed() { return Number(state.settings.autoplaySpeed) || 1; }
  get refId() { return refLapId(); }

  registerVideo(lapId, el, offsetS) {
    this.videos.set(lapId, { el, offsetS: offsetS || 0 });
    el.playbackRate = Math.min(2, this.speed);
    if (this.playing) this.seekVideo(lapId, true);
  }
  unregisterVideo(lapId) {
    const v = this.videos.get(lapId);
    if (v) { try { v.el.pause(); } catch { /* ignore */ } }
    this.videos.delete(lapId);
  }
  clearVideos() { for (const id of [...this.videos.keys()]) this.unregisterVideo(id); }

  /** Lap time (s) of the given lap at the current cursor. */
  lapTimeAtCursor(samples) {
    if (!samples) return NaN;
    return state.settings.xMode === 'time' ? state.cursor : timeAtDistance(samples, state.cursor);
  }
  cursorFromRefTime(refSamples, tRef) {
    return state.settings.xMode === 'time' ? tRef : distanceAtTime(refSamples, tRef);
  }

  async toggle() { if (this.playing) this.pause(); else await this.play(); }

  async play() {
    if (!this.refId) return;
    const ref = await ensureSamples(this.refId);
    if (!ref) return;
    this.playing = true;
    // start from cursor
    const tRef = this.lapTimeAtCursor(ref);
    this.clockT = Number.isFinite(tRef) ? tRef : 0;
    if (this.clockT >= ref.t[ref.n - 1] - 0.05) { this.clockT = 0; setCursor(0, 'player'); }
    for (const [id, v] of this.videos) {
      v.el.playbackRate = Math.min(2, this.speed);
      this.seekVideo(id, true);
      if (this.videoInClip(id)) v.el.play().catch(() => {});
    }
    this.lastTs = performance.now();
    this.loop();
    emit('player', { playing: true });
  }

  pause() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const v of this.videos.values()) { try { v.el.pause(); } catch { /* ignore */ } }
    emit('player', { playing: false });
  }

  setSpeed(sp) {
    for (const v of this.videos.values()) v.el.playbackRate = Math.min(2, sp);
  }

  loop() {
    if (!this.playing) return;
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastTs) / 1000);
    this.lastTs = now;
    const ref = state.samplesCache.get(this.refId);
    if (!ref) return;
    const refVideo = this.videos.get(this.refId);
    let tRef;
    // the reference video drives the cursor only while the lap time lies inside its clip (a clip can be a 20 s cut of
    // the lap); before and after, the clock runs and the video waits on its first or last frame
    const videoDriven = refVideo && this.speed <= 2 && refVideo.el.readyState >= 2 && !refVideo.el.seeking && this.inClip(refVideo, this.clockT);
    if (videoDriven) {
      tRef = refVideo.el.currentTime + refVideo.offsetS;
      if (refVideo.el.paused && !refVideo.el.ended) refVideo.el.play().catch(() => {});
    } else {
      this.clockT += dt * this.speed;
      tRef = this.clockT;
      if (refVideo && !refVideo.el.paused && !this.inClip(refVideo, tRef)) refVideo.el.pause();
    }
    const tEnd = ref.t[ref.n - 1];
    if (tRef >= tEnd) { setCursor(this.cursorFromRefTime(ref, tEnd), 'player'); this.pause(); return; }
    this.clockT = tRef;
    setCursor(this.cursorFromRefTime(ref, tRef), 'player');
    // keep other videos in sync (drift check ~4x per second)
    if (now - this.lastSyncCheck > 250) {
      this.lastSyncCheck = now;
      for (const [id, v] of this.videos) {
        if (videoDriven && id === this.refId) continue;
        this.seekVideo(id, false);
        if (!this.videoInClip(id)) { if (!v.el.paused) v.el.pause(); continue; }
        if (v.el.paused && !v.el.ended && v.el.readyState >= 2) v.el.play().catch(() => {});
      }
    }
  }

  /** Does lap time tLap lie inside the video's clip? Unknown duration counts as inside. */
  inClip(v, tLap) {
    const dur = v.el.duration;
    if (!Number.isFinite(dur) || dur <= 0) return true;
    return tLap >= v.offsetS && tLap < v.offsetS + dur - 0.05;
  }
  videoInClip(lapId) {
    const v = this.videos.get(lapId); const s = state.samplesCache.get(lapId);
    if (!v || !s) return false;
    const tLap = this.lapTimeAtCursor(s);
    return Number.isFinite(tLap) && this.inClip(v, tLap);
  }

  /** Seek a lap's video to the time corresponding to the current cursor. */
  seekVideo(lapId, force) {
    const v = this.videos.get(lapId);
    if (!v) return;
    const s = state.samplesCache.get(lapId);
    if (!s) return;
    const tLap = this.lapTimeAtCursor(s);
    if (!Number.isFinite(tLap)) return;
    const target = Math.max(0, tLap - v.offsetS);
    const dur = v.el.duration;
    const clamped = Number.isFinite(dur) && dur > 0 ? Math.min(target, Math.max(0, dur - 0.05)) : target;
    if (force || Math.abs(v.el.currentTime - clamped) > DRIFT_TOLERANCE) {
      try { v.el.currentTime = clamped; } catch { /* not ready yet */ }
    }
  }

  onExternalCursor() {
    // user scrubbed: move all videos, keep play state
    if (this._seekTimer) return;
    this._seekTimer = setTimeout(() => {
      this._seekTimer = 0;
      for (const id of this.videos.keys()) this.seekVideo(id, true);
      const ref = state.samplesCache.get(this.refId);
      if (ref) { const tRef = this.lapTimeAtCursor(ref); if (Number.isFinite(tRef)) this.clockT = tRef; }
    }, 60);
  }
}

export const player = new Player();
