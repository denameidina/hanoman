import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { prisma } from "../db";
import { uploadDir } from "./uploads";

// Workspace QA · bagian 3 · state byte lampiran PER MESIN (`QaAttachment.syncState`, kolom LOCAL — tak ikut
// FIELDS). Dipanggil sync.ts tepat setelah record lampiran BARU diterima dari peer (push ke hub / pull ke
// client): lahir "local-only" karena default kolom, padahal byte-nya belum tentu ada di sini.
// Record yang SUDAH ada TIDAK disentuh: client yang menarik balik gema record miliknya sendiri tetap
// "local-only" (byte-nya memang belum diunggah ke hub) — menyentuhnya akan menghentikan unggahan selamanya.
export const QA_STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const QA_SYNC_MAX_BYTES = 10 * 1024 * 1024;

export async function qaBytesPresent(storageKey: string): Promise<boolean> {
  if (!QA_STORAGE_KEY.test(storageKey)) return false;
  try { return (await stat(join(uploadDir(), storageKey))).isFile(); } catch { return false; }
}

export async function settleNewQaAttachment(id: string): Promise<void> {
  const row = await prisma.qaAttachment.findUnique({ where: { id }, select: { storageKey: true } });
  if (!row) return;
  await prisma.qaAttachment.update({
    where: { id }, data: { syncState: (await qaBytesPresent(row.storageKey)) ? "available" : "remote" },
  });
}

// Tipe yang punya magic bytes; sisanya teks polos (cermin SNIFFABLE di upload-pipeline.ts).
const SNIFFABLE = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const isUtf8Text = (b: Buffer): boolean => {
  if (b.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(b); return true; } catch { return false; }
};

export type QaBytesVerdict = { ok: true } | { ok: false; status: 400 | 415; error: "size" | "sha256" | "type" };

/**
 * Byte yang datang dari peer harus cocok dengan METADATA yang sudah menyeberang: ukuran persis, sha256 persis, dan isi
 * sesuai tipe yang diklaim. Hub TIDAK menjalankan ulang pipeline unggahan (normalisasi gambar mengubah byte → sha256
 * tak lagi cocok); byte sudah dinormalisasi & dipindai di mesin asalnya, jadi di sini cukup integritas + tipe.
 */
export async function verifyQaBytes(
  meta: { mimeType: string; size: number; sha256: string }, buf: Buffer,
): Promise<QaBytesVerdict> {
  if (buf.length !== meta.size || buf.length === 0 || buf.length > QA_SYNC_MAX_BYTES) return { ok: false, status: 400, error: "size" };
  if (createHash("sha256").update(buf).digest("hex") !== meta.sha256) return { ok: false, status: 400, error: "sha256" };
  if (SNIFFABLE.has(meta.mimeType)) {
    if ((await fileTypeFromBuffer(buf))?.mime !== meta.mimeType) return { ok: false, status: 415, error: "type" };
  } else if (!isUtf8Text(buf)) return { ok: false, status: 415, error: "type" };
  return { ok: true };
}

/** Tulis atomik (tmp + rename) ke `storageKey` — kunci SUDAH divalidasi QA_STORAGE_KEY oleh pemanggil. */
export async function storeQaBytes(storageKey: string, buf: Buffer): Promise<void> {
  if (!QA_STORAGE_KEY.test(storageKey)) throw new Error("storageKey tak sah");
  const dir = uploadDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `${storageKey}.tmp-${randomUUID()}`);
  await writeFile(tmp, buf, { mode: 0o600 });
  await rename(tmp, join(dir, storageKey));
  await chmod(join(dir, storageKey), 0o600).catch(() => {});
}

