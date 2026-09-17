// Minimal ZIP reader (stored + deflate) built on the native DecompressionStream.
// No third‑party dependencies – works in Safari 16.4+, Chrome 103+, Firefox 113+.

const SIG_EOCD = 0x06054b50;
const SIG_CDIR = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * Unzip an ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{name:string,data:Uint8Array}>>}
 */
export async function unzip(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Locate End Of Central Directory record (search backwards, comment may be up to 64 KiB)
  let eocd = -1;
  const minPos = Math.max(0, u8.length - 22 - 65536);
  for (let i = u8.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(off, true) !== SIG_CDIR) throw new Error('Corrupt ZIP central directory');
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = decoder.decode(u8.subarray(off + 46, off + 46 + nlen));
    entries.push({ name, method, csize, usize, lho });
    off += 46 + nlen + elen + clen;
  }

  const out = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue; // directory
    if (dv.getUint32(e.lho, true) !== SIG_LOCAL) throw new Error('Corrupt ZIP local header');
    const lnlen = dv.getUint16(e.lho + 26, true);
    const lelen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + lnlen + lelen;
    const comp = u8.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) data = comp.slice();
    else if (e.method === 8) data = await inflateRaw(comp);
    else throw new Error('Unsupported ZIP compression method ' + e.method);
    out.push({ name: e.name, data });
  }
  return out;
}

async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser lacks DecompressionStream (needs iOS 16.4+ / Safari 16.4+).');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Create a ZIP archive (stored, no compression) – used for exporting .rnz files.
 * @param {Array<{name:string,data:Uint8Array}>} files
 * @returns {Blob}
 */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, SIG_LOCAL, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF‑8 names
    lh.setUint16(8, 0, true); // stored
    lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, nameBytes, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, SIG_CDIR, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);
    offset += 30 + nameBytes.length + f.data.length;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.byteLength;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, SIG_EOCD, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...central, eocd.buffer], { type: 'application/zip' });
}

let crcTable = null;
function crc32(u8) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < u8.length; i++) crc = crcTable[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
