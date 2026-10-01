import { stat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../db";
import { uploadDir } from "./uploads";

// Workspace QA · bagian 3 · state byte lampiran PER MESIN (`QaAttachment.syncState`, kolom LOCAL — tak ikut
// FIELDS). Dipanggil sync.ts tepat setelah record lampiran BARU diterima dari peer (push ke hub / pull ke
// client): lahir "local-only" karena default kolom, padahal byte-nya belum tentu ada di sini.
// Record yang SUDAH ada TIDAK disentuh: client yang menarik balik gema record miliknya sendiri tetap
// "local-only" (byte-nya memang belum diunggah ke hub) — menyentuhnya akan menghentikan unggahan selamanya.
export const QA_STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

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
