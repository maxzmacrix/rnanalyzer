// File import pipeline: .rnz/.rn lap files and .mp4 videos → IndexedDB.

import { unzip } from './zip.js';
import { parseRnzBuffer } from './rnparser.js';
import { db } from './db.js';
import { reloadLaps } from './state.js';
import { record } from './diag.js';

/**
 * Import a list of File/Blob objects.
 * @param {Array<File|{blob:Blob,name:string}>} files
 * @param {(info:{index:number,total:number,name:string,phase:string})=>void} [onProgress]
 * @returns {Promise<{laps:number,videos:number,skipped:string[],errors:Array<{name:string,error:string}>}>}
 */
export async function importFiles(files, onProgress) {
  const result = { laps: 0, videos: 0, skipped: [], errors: [] };
  const list = Array.from(files).map((f) => (f instanceof Blob ? { blob: f, name: f.name } : f));
  // Import lap data first, then videos (so linking works immediately).
  list.sort((a, b) => rank(a.name) - rank(b.name));
  for (let i = 0; i < list.length; i++) {
    const { blob, name } = list[i];
    onProgress && onProgress({ index: i, total: list.length, name, phase: 'start' });
    try {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (ext === 'rnz' || ext === 'rn' || ext === 'zip' || ext === 'xml') {
        const buf = await blob.arrayBuffer();
        if (ext === 'zip') {
          // a zipped folder of exports: unpack its .rnz/.mp4 entries into the queue instead of treating it as one lap
          const entries = await unzip(buf);
          const inner = entries.filter((f) => /\.(rnz|rn|mp4|mov|m4v)$/i.test(f.name) && !f.name.startsWith('__MACOSX'));
          const isLapArchive = entries.some((f) => /\.rn$/i.test(f.name) && !f.name.includes('/'));
          if (inner.length && !isLapArchive) {
            for (const f of inner) list.push({ blob: new Blob([f.data], { type: /\.(mp4|mov|m4v)$/i.test(f.name) ? 'video/mp4' : 'application/zip' }), name: f.name.split('/').pop() });
            onProgress && onProgress({ index: i + 1, total: list.length, name, phase: 'done' });
            continue;
          }
        }
        const { lap, samples, raw } = await parseRnzBuffer(buf, name);
        if (samples.reordered) record('import', `${name}: ${samples.reordered} of ${samples.n} samples were out of time order, sorted`);
        const existing = await db.getLap(lap.id);
        if (existing) { lap.note = existing.note || ''; lap.importedAt = existing.importedAt; if (existing.driverOverride) lap.driverOverride = existing.driverOverride; if (existing.vehicleOverride) lap.vehicleOverride = existing.vehicleOverride; }
        await db.putLap(lap, samples, raw);
        result.laps++;
      } else if (ext === 'mp4' || ext === 'mov' || ext === 'm4v' || (blob.type && blob.type.startsWith('video/'))) {
        const typed = blob.type ? blob : new Blob([blob], { type: 'video/mp4' });
        await db.putVideo(name, typed);
        result.videos++;
      } else {
        result.skipped.push(name);
      }
    } catch (e) {
      console.error('import failed', name, e);
      record('import', `ERR ${name}`, e && e.message ? e.message : String(e));
      result.errors.push({ name, error: e && e.message ? e.message : String(e) });
    }
    onProgress && onProgress({ index: i + 1, total: list.length, name, phase: 'done' });
  }
  await reloadLaps();
  record('import', `${result.laps} laps, ${result.videos} videos`, result.skipped.length ? `skipped ${result.skipped.join(', ')}` : '');
  return result;
}

function rank(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext === 'rnz' || ext === 'rn' || ext === 'zip' || ext === 'xml' ? 0 : 1;
}
