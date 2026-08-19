// SPEC-843 · ADR-0124 · materialisasi lampiran backlog ke direktori yang terjangkau sesi.
//
// KENAPA bukan menunjuk langsung ke HANOMAN_UPLOAD_DIR: sandbox sesi produksi hanya mem-mount
// worktree + phase file + prompt file (`services/session-sandbox.ts`), jadi upload dir TAK
// terjangkau dari dalam sesi — path ke sana bekerja di dev dan mati senyap di produksi. Di samping
// itu ia akan membuka SELURUH upload dir (termasuk lampiran tiket project lain) ke sesi mana pun.
//
// KENAPA di luar worktree: `git add -A` milik agen akan men-stage lampiran ke branch sesi. Letaknya
// sekamar dengan `.phases`/`.decisions` di dalam `.worktrees` yang sudah `.gitignore` — dan karena
// itu ia juga selamat saat worktree dibangun ulang untuk melanjutkan sesi (ADR-0084).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../db";
import { resolveRepoDir } from "./local-binding";
import { sessionIdForSpec } from "./session-id";
import { uploadDir } from "./uploads";

export const specAttachmentsDir = (repoDir: string, sessionId: string): string =>
  join(repoDir, ".worktrees", ".attachments", sessionId);

export type MaterializedAttachment = {
  filename: string; mimeType: string; size: number; path: string;
};

const INDEX = "INDEX.md";

const humanSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// Nama materialisasi diturunkan dari `filename` supaya terbaca manusia DAN agen di prompt. Dua
// lampiran boleh punya nama asli yang sama, jadi tabrakan disuffiks — menimpa berarti satu lampiran
// hilang dari pandangan agen tanpa jejak.
function uniqueName(taken: Set<string>, filename: string): string {
  if (!taken.has(filename)) { taken.add(filename); return filename; }
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
}

function renderIndex(specId: string, items: MaterializedAttachment[]): string {
  const rows = items.map((a) =>
    `- \`${a.path}\` — **${a.filename}** (${a.mimeType}, ${humanSize(a.size)})`).join("\n");
  return [
    `# Lampiran ${specId}`,
    "",
    "Berkas di bawah dilampirkan manusia ke backlog item ini sebagai konteks kerja. Manifest ini",
    "ditulis ulang server setiap kali daftar lampiran berubah — baca ulang di awal setiap fase.",
    "",
    rows || "_Tak ada lampiran._",
    "",
  ].join("\n");
}

/**
 * Rekonsiliasi PENUH direktori materialisasi terhadap baris DB: yang baru disalin, yang barisnya
 * sudah hilang DIBUANG. Tambal-saja akan membuat lampiran yang dihapus operator tetap terbaca agen
 * — "hapus" yang hanya berarti "hilang dari dashboard".
 *
 * `[]` bila project belum di-bind ke checkout lokal: tak ada repoDir berarti tak ada tempat sah
 * untuk menaruhnya, dan itu bukan galat — sesi pun tak bisa lahir di keadaan itu.
 */
export async function syncSpecAttachmentsDir(
  specId: string, projectId: string,
): Promise<MaterializedAttachment[]> {
  const repoDir = await resolveRepoDir(projectId);
  if (!repoDir) return [];
  const dir = specAttachmentsDir(repoDir, sessionIdForSpec(specId));
  const rows = await prisma.specAttachment.findMany({
    where: { specId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* sudah tak ada */ });
    return [];
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const taken = new Set<string>();
  const items: MaterializedAttachment[] = [];
  for (const a of rows) {
    let bytes: Buffer;
    try { bytes = await readFile(join(uploadDir(), a.storageKey)); }
    catch { continue; }   // byte hilang dari upload dir — jangan sebut lampiran yang tak bisa dibaca
    const filename = uniqueName(taken, a.filename);
    const path = join(dir, filename);
    await writeFile(path, bytes, { mode: 0o600 });
    items.push({ filename, mimeType: a.mimeType, size: a.size, path });
  }
  await writeFile(join(dir, INDEX), renderIndex(specId, items), { mode: 0o600 });

  const keep = new Set([INDEX, ...items.map((a) => a.filename)]);
  for (const name of await readdir(dir)) {
    if (!keep.has(name)) await rm(join(dir, name), { recursive: true, force: true }).catch(() => {});
  }
  return items;
}

export async function dropSpecAttachmentsDir(specId: string, projectId: string): Promise<void> {
  const repoDir = await resolveRepoDir(projectId);
  if (!repoDir) return;
  await rm(specAttachmentsDir(repoDir, sessionIdForSpec(specId)), { recursive: true, force: true })
    .catch(() => { /* sudah tak ada */ });
}
