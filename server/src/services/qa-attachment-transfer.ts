import { effectiveStr } from "../config";
import { prisma } from "../db";
import { listOutbox } from "./outbox";
import { QA_STORAGE_KEY, QA_SYNC_MAX_BYTES, storeQaBytes, verifyQaBytes } from "./qa-attachment-sync";
import { safeRequest } from "./safe-outbound-request";
import { readUpload } from "./uploads";

// Workspace QA · bagian 3 · transfer BYTE lampiran dari sisi client (kebalikan endpoint di routes/sync.ts).
//   readQaAttachmentBytes  — baca lokal; bila belum ada dan instance ini client sync: tarik dari hub (lazy,
//                            saat lampiran dibuka/diekspor), verifikasi, cache ke storageKey. Mewarisi pola
//                            `readUploadOrFetch` (ADR-0068) tetapi per-id, ber-verifikasi sha256, dan batas 10 MB.
//   uploadPendingQaBytes   — dorong byte lampiran buatan mesin ini ke hub (dipanggil di akhir siklus sync).
// Hub/standalone (tanpa SYNC_SERVER_URL) tak melakukan jaringan apa pun di sini.

const hubOf = (): { base: string; token: string } | null => {
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  return base && token ? { base: base.replace(/\/$/, ""), token } : null;
};
const endpoint = (hub: { base: string }, id: string) => new URL(`/api/sync/qa-attachments/${encodeURIComponent(id)}`, `${hub.base}/`);
const isLoopback = (u: URL) => ["localhost", "127.0.0.1", "::1"].includes(u.hostname);

const inflight = new Map<string, Promise<Buffer | null>>();

/** SATU pintu baca byte lampiran QA (ekspor, penyajian, salin ke backlog). null = tak tersedia di mesin ini. */
export function readQaAttachmentBytes(id: string): Promise<Buffer | null> {
  const running = inflight.get(id);
  if (running) return running;      // lima <img> serentak → satu unduhan
  const p = fetchThrough(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function fetchThrough(id: string): Promise<Buffer | null> {
  const row = await prisma.qaAttachment.findUnique({ where: { id } });
  if (!row || !QA_STORAGE_KEY.test(row.storageKey)) return null;
  const local = await readUpload(row.storageKey).catch(() => null);
  if (local) return local;
  const hub = hubOf();
  if (!hub) return null;
  try {
    const url = endpoint(hub, id);
    const res = await safeRequest({
      url, method: "GET", headers: { authorization: `Bearer ${hub.token}` },
      allowPrivate: process.env.NODE_ENV !== "production" && isLoopback(url),
      connectMs: 5_000, totalMs: 60_000, maxResponseBytes: QA_SYNC_MAX_BYTES + 1024,
    });
    if (res.status !== 200) return null;
    // Hub bisa salah/jahat: byte yang tak cocok metadata (yang sudah menyeberang lewat feed) TIDAK dipakai & TIDAK di-cache.
    if (!(await verifyQaBytes(row, res.body)).ok) { console.warn(`qa: byte lampiran ${id} dari hub tak cocok metadata — dibuang`); return null; }
    await storeQaBytes(row.storageKey, res.body);
    await prisma.qaAttachment.update({ where: { id }, data: { syncState: "available" } });
    return res.body;
  } catch { return null; }
}

const UPLOAD_BATCH = 5;

/**
 * Unggah byte lampiran yang lahir di mesin ini (`syncState = local-only`). Dipanggil di akhir `syncOnce`, SESUDAH
 * outbox dikuras: hub menolak PUT tanpa baris metadata (404), jadi yang metadatanya masih antre dilewati.
 * Hasil per lampiran: 200 → available · 404/5xx/galat jaringan → tetap local-only (dicoba lagi siklus berikutnya) ·
 * 400/415 (hub MENOLAK isinya, permanen) atau byte lokal hilang → failed (jangan diulang selamanya).
 */
export async function uploadPendingQaBytes(): Promise<{ uploaded: number; failed: number }> {
  const out = { uploaded: 0, failed: 0 };
  const hub = hubOf();
  if (!hub) return out;
  const queued = new Set((await listOutbox()).filter((o) => o.entity === "qaAttachment").map((o) => o.recordId));
  const rows = await prisma.qaAttachment.findMany({ where: { syncState: "local-only" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: UPLOAD_BATCH + queued.size });
  for (const a of rows.filter((r) => !queued.has(r.id)).slice(0, UPLOAD_BATCH)) {
    const bytes = QA_STORAGE_KEY.test(a.storageKey) ? await readUpload(a.storageKey).catch(() => null) : null;
    if (!bytes) { await prisma.qaAttachment.update({ where: { id: a.id }, data: { syncState: "failed" } }); out.failed++; continue; }
    try {
      const url = endpoint(hub, a.id);
      const res = await safeRequest({
        url, method: "PUT", headers: { authorization: `Bearer ${hub.token}`, "content-type": "application/octet-stream" }, body: bytes,
        allowPrivate: process.env.NODE_ENV !== "production" && isLoopback(url),
        connectMs: 5_000, totalMs: 120_000, maxResponseBytes: 64 * 1024,
      });
      if (res.status >= 200 && res.status < 300) { await prisma.qaAttachment.update({ where: { id: a.id }, data: { syncState: "available" } }); out.uploaded++; }
      else if (res.status === 400 || res.status === 413 || res.status === 415) { await prisma.qaAttachment.update({ where: { id: a.id }, data: { syncState: "failed" } }); out.failed++; }
      // 401/404/5xx: tak diubah — hub belum siap / token salah / metadata belum sampai; siklus berikutnya mencoba lagi
    } catch { /* jaringan: coba lagi nanti */ }
  }
  return out;
}
