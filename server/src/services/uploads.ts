// SPEC-253 · ADR-0062 · kapabilitas penyimpanan berkas (lampiran tiket Help Center).
// Berkas hidup di HANOMAN_UPLOAD_DIR — server-local, DI LUAR repoDir, TAK disync (cermin Vps.keyPath
// yang juga berkas di server, tak pernah di DB). Nama berkas opaque (uuid+ext); nama asli metadata saja.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { effectiveStr } from "../config";
import { safeRequest } from "./safe-outbound-request";
import { resolveHome } from "@hanoman/runner";

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
export function extFor(mimeType: string): string {
  return EXT[mimeType] ?? ".bin";
}

export function uploadDir(): string {
  return resolve(effectiveStr("HANOMAN_UPLOAD_DIR") ?? join(resolveHome(), "uploads"));
}

export async function saveUpload(buf: Buffer, mimeType: string): Promise<{ storageKey: string; size: number }> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const storageKey = `${randomUUID()}${extFor(mimeType)}`;
  await writeFile(join(dir, storageKey), buf, { mode: 0o600 });
  return { storageKey, size: buf.length };
}

// SPEC-816 · lampiran gambar sesi terminal. Kepemilikan berkas dicatat SUBDIREKTORI per sesi —
// tanpa tabel, tanpa migration. `sessionId` datang dari parameter URL (beda dari `storageKey`
// yang selalu lahir dari saveUpload), jadi ia divalidasi sebelum menyentuh disk. Bentuknya
// diturunkan dari kedua pabrik id: `randomUUID().slice(0,8)` dan `sessionIdForSpec`
// (lowercase + `_`/`-`, session-id.ts).
const SESSION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function sessionUploadDir(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error(`sessionId tak sah: ${sessionId}`);
  return join(uploadDir(), "terminal", sessionId);
}

export async function saveSessionUpload(
  sessionId: string, buf: Buffer, mimeType: string,
): Promise<{ path: string; size: number }> {
  const dir = sessionUploadDir(sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${randomUUID()}${extFor(mimeType)}`);
  await writeFile(path, buf, { mode: 0o600 });
  return { path, size: buf.length };
}

// Best-effort: kegagalan menghapus TAK boleh menahan penutupan sesi (alasan yang sama seperti
// emitDeath menelan galatnya sendiri). `rm` async, bukan `rmSync` — rmSync memblokir seluruh
// event loop (SPEC-742/ADR-0116).
export async function dropSessionUploads(sessionId: string): Promise<void> {
  let dir: string;
  try { dir = sessionUploadDir(sessionId); } catch { return; }
  await rm(dir, { recursive: true, force: true }).catch(() => { /* sudah tak ada */ });
}

// storageKey selalu dari saveUpload (uuid+ext, bukan input user) → tanpa traversal; basename-kan
// sebagai jaring pengaman ekstra sebelum menyentuh disk.
export async function readUpload(storageKey: string): Promise<Buffer> {
  const safe = storageKey.replace(/[/\\]/g, "");
  return readFile(join(uploadDir(), safe));
}

// SPEC-272 · ADR-0068 · fetch-through lampiran: baca lokal; bila absen & instance ini CLIENT sync
// (SYNC_SERVER_URL+SYNC_DEVICE_TOKEN), tarik byte dari hub lalu cache ke upload dir. Di hub
// (SYNC_SERVER_URL kosong) tak ada fetch → perilaku sama seperti readUpload.
export async function readUploadOrFetch(storageKey: string): Promise<Buffer> {
  const safe = storageKey.replace(/[/\\]/g, "");
  const target = join(uploadDir(), safe);
  try {
    return await readFile(target);
  } catch {
    const base = effectiveStr("SYNC_SERVER_URL");
    const token = effectiveStr("SYNC_DEVICE_TOKEN");
    if (!base || !token) throw new Error(`lampiran ${safe} tak ada lokal & bukan client sync`);
    const url = new URL(`/api/sync/attachments/${encodeURIComponent(safe)}`, `${base.replace(/\/$/, "")}/`);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const res = await safeRequest({
      url, method: "GET", headers: { authorization: `Bearer ${token}` },
      allowPrivate: process.env.NODE_ENV !== "production" && loopback,
      connectMs: 5_000, totalMs: 15_000, maxResponseBytes: 5 * 1024 * 1024,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`fetch lampiran hub gagal: ${res.status}`);
    const buf = res.body;
    await mkdir(uploadDir(), { recursive: true, mode: 0o700 });
    await writeFile(target, buf, { mode: 0o600 }); // cache lokal untuk pembukaan berikutnya
    return buf;
  }
}
export async function deleteUpload(storageKey: string): Promise<void> {
  const safe = storageKey.replace(/[/\\]/g, "");
  await unlink(join(uploadDir(), safe)).catch(() => { /* sudah tak ada */ });
}
