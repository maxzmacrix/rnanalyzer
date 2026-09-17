// Sharing helper: Web Share API with files (iOS share sheet → Instagram, YouTube, WhatsApp, Mail, AirDrop …),
// falls back to browser downloads when file sharing is not available.

export async function shareFiles(files, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: title || files.map((f) => f.name).join(', ') });
      return 'shared';
    }
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
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] })); } catch { return false; }
}
