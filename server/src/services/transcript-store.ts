// SPEC-362 · ADR-0079 · transkrip layar sesi yang sudah ditutup. Berkas hidup di
// HANOMAN_TRANSCRIPT_DIR — server-local, DI LUAR repoDir, TAK disync (cermin services/uploads.ts
// dan Vps.keyPath). DB hanya memegang nama berkasnya.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, readdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { effectiveStr } from "../config";
import { resolveDataDirs } from "@hanoman/runner";

// Sesi berhari-hari bisa meninggalkan puluhan MB scrollback. 1 MiB menampung ribuan baris —
// cukup untuk membaca ulang apa yang terjadi, tanpa menjadikan riwayat pengisi disk diam-diam.
export const MAX_TRANSCRIPT_BYTES = 1024 * 1024;

// SPEC-846 · fallback-nya `resolveDataDirs()`, bukan turunan sendiri: satu penurun lokasi data
// untuk server & CLI. `.trim()` menjaga override berisi spasi (EnvironmentFile ceroboh) tidak
// menjadi direktori di bawah cwd lewat `resolve()`.
export function transcriptDir(): string {
  return resolve(effectiveStr("HANOMAN_TRANSCRIPT_DIR")?.trim() || resolveDataDirs().transcripts);
}

// Memangkas KEPALA, menyimpan EKOR: saat membaca ulang sesi, yang dicari hampir selalu apa yang
// terjadi menjelang akhir. Potongan disejajarkan ke newline pertama supaya tak memulai di tengah
// karakter multi-byte (dan tak menyisakan setengah baris yang membingungkan).
function clamp(text: string): { body: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= MAX_TRANSCRIPT_BYTES) return { body: text, truncated: false };
  const cut = buf.byteLength - MAX_TRANSCRIPT_BYTES;
  let tail = buf.subarray(cut).toString("utf8");
  const nl = tail.indexOf("\n");
  if (nl >= 0) tail = tail.slice(nl + 1);
  return { body: `… ${cut} byte awal dipangkas (batas ${MAX_TRANSCRIPT_BYTES} byte) …\n${tail}`, truncated: true };
}

export async function saveTranscript(text: string): Promise<{ key: string; bytes: number; truncated: boolean }> {
  if (!text.trim()) return { key: "", bytes: 0, truncated: false };
  const { body, truncated } = clamp(text);
  const dir = transcriptDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const key = `${randomUUID()}.log`;
  await writeFile(join(dir, key), body, { encoding: "utf8", mode: 0o600 });
  return { key, bytes: Buffer.byteLength(body, "utf8"), truncated };
}

// key selalu dari saveTranscript (uuid+ext, bukan input pengguna); basename tetap dipasang sebagai
// jaring pengaman agar nilai DB yang rusak pun tak pernah keluar dari transcriptDir().
export async function readTranscript(key: string): Promise<string | null> {
  if (!key) return null;
  try { return await readFile(join(transcriptDir(), basename(key)), "utf8"); }
  catch { return null; }
}

// SPEC-845 · ADR-0126 · HANYA `ENOENT` yang ditelan — itulah yang membuat penghapusan idempoten,
// dan purge memang berhak menemui berkas yang sudah lenyap. Galat lain (EACCES, EIO, EROFS) wajib
// bersuara: purge melaporkan kegagalan sebagian, dan diam di sini membuatnya melaporkan sukses
// penuh atas berkas yang sebenarnya masih ada di disk.
export async function deleteTranscript(key: string): Promise<void> {
  if (!key) return;
  try { await unlink(join(transcriptDir(), basename(key))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}

// Isi direktori apa adanya, untuk mark & sweep ADR-0126: manifes berkas hidup adalah kolom
// `transcriptKey`, jadi yang dibutuhkan pemanggil cuma nama + umur tiap berkas. Disaring ke `.log`
// (satu-satunya bentuk yang saveTranscript hasilkan) supaya berkas asing yang kebetulan mendarat di
// direktori ini tak pernah ikut tersapu.
export async function listTranscripts(): Promise<{ key: string; mtimeMs: number }[]> {
  const dir = transcriptDir();
  let names: string[];
  try { names = await readdir(dir); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const rows: { key: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    // Berkas bisa lenyap antara readdir dan stat (purge paralel); ia bukan kandidat sapuan lagi.
    try { rows.push({ key: name, mtimeMs: (await stat(join(dir, name))).mtimeMs }); } catch { /* lenyap */ }
  }
  return rows;
}
