// Sharing helper: Web Share API with files (iOS share sheet → Instagram, YouTube, WhatsApp, Mail, AirDrop …).
// The Android WebView has no Web Share API: there the files are staged through the RnDevice plugin in chunks and
// handed to the Android share sheet. Browser downloads are the last fallback.

const CHUNK = 4 * 1024 * 1024; // bytes per bridge call while staging a file natively

function nativePlugin() {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  try { return (C.Plugins && C.Plugins.RnDevice) || (C.registerPlugin ? C.registerPlugin('RnDevice') : null); } catch { return null; }
}
/** Android: the WebView lacks navigator.share, the plugin's share sheet stands in. */
function nativeShareAvailable() {
  const C = window.Capacitor;
  return !!nativePlugin() && !(navigator.canShare && navigator.share) && C.getPlatform && C.getPlatform() === 'android';
}
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(blob);
  });
}
async function nativeShareFiles(files, title) {
  const p = nativePlugin();
  const paths = [];
  for (const f of files) {
    const { path } = await p.fileBegin({ name: f.name });
    for (let off = 0; off < f.size; off += CHUNK) await p.fileAppend({ path, base64: await toBase64(f.slice(off, Math.min(f.size, off + CHUNK))) });
    if (f.size === 0) await p.fileAppend({ path, base64: '' });
    paths.push(path);
  }
  const types = new Set(files.map((f) => f.type || 'application/octet-stream'));
  await p.share({ paths, mime: types.size === 1 ? [...types][0] : '*/*', title: title || files.map((f) => f.name).join(', ') });
  return 'shared';
}

export async function shareFiles(files, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: title || files.map((f) => f.name).join(', ') });
      return 'shared';
    }
    if (nativeShareAvailable()) return await nativeShareFiles(files, title);
  } catch (e) {
    if (e && e.name === 'AbortError') return 'aborted';
    console.warn('share failed, falling back to download', e);
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  return 'downloaded';
}

export function canShareFiles() {
  try { return nativeShareAvailable() || !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] })); } catch { return false; }
}
