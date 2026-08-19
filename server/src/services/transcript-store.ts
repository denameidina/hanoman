// SPEC-362 · ADR-0079 · transkrip layar sesi yang sudah ditutup. Berkas hidup di
// HANOMAN_TRANSCRIPT_DIR — server-local, DI LUAR repoDir, TAK disync (cermin services/uploads.ts
// dan Vps.keyPath). DB hanya memegang nama berkasnya.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
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

export async function deleteTranscript(key: string): Promise<void> {
  if (!key) return;
  await unlink(join(transcriptDir(), basename(key))).catch(() => { /* sudah tak ada */ });
}
