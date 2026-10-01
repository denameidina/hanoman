import { deflateRawSync, inflateRawSync } from "node:zlib";

// Workspace QA · ZIP minimal tanpa dependensi baru. Menulis: metode 0 (stored) atau 8 (deflate);
// membaca: kedua metode itu, DIPAGARI (jumlah entri, total ukuran terdekompresi, nama entri) karena
// berkasnya datang dari luar — zip-slip dan zip-bomb adalah ancaman nyata di jalur impor.

export class ZipError extends Error {}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = 0x21; // 1980-01-01 — nilai tetap, keluaran deterministik

export function writeZip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const packed = e.deflate && e.data.length ? deflateRawSync(e.data) : e.data;
    const method = packed === e.data ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, name, packed);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

export function readZip(buf: Buffer, o: { maxEntries?: number; maxTotalBytes?: number } = {}): Map<string, Buffer> {
  const maxEntries = o.maxEntries ?? 200;
  const maxTotal = o.maxTotalBytes ?? 150 * 1024 * 1024;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("bukan berkas ZIP yang valid");
  const total = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (total > maxEntries) throw new ZipError(`terlalu banyak entri (maks ${maxEntries})`);

  const out = new Map<string, Buffer>();
  let p = cdOff;
  let sum = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("direktori pusat ZIP rusak");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const next = p + 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p = next;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new ZipError("ZIP terenkripsi tidak didukung");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new ZipError(`nama entri tak aman: ${name}`);
    sum += usize;
    if (sum > maxTotal) throw new ZipError("ukuran terdekompresi melebihi batas");
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new ZipError(`header lokal rusak: ${name}`);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw new ZipError(`entri terpotong: ${name}`);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = usize === 0 ? Buffer.alloc(0) : inflateRawSync(raw, { maxOutputLength: usize });
    else throw new ZipError(`metode kompresi ${method} tidak didukung`);
    if (data.length !== usize || crc32(data) !== crc) throw new ZipError(`entri rusak: ${name}`);
    out.set(name, data);
  }
  return out;
}
