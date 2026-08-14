import { prisma } from "../db";
import { upsertLocal, isEntity } from "./sync";
import { clearOutbox } from "./outbox";

// SPEC-270 · ADR-0067 · store konflik dua-sisi (LOCAL-only) + resolusi manusia.
type Side = { version: number; data: Record<string, unknown> };
export type ConflictView = {
  entity: string; recordId: string;
  localData: unknown; localVersion: number; localUpdatedAt: string;
  serverData: unknown; serverVersion: number; serverUpdatedAt: string; detectedAt: string;
};
type PushResult = { ok?: boolean; version?: number; conflict?: boolean; server?: { version: number } };
type PushFn = (records: unknown[]) => Promise<{ results: PushResult[] }>;

function stamp(d: Record<string, unknown>): Date {
  const v = d.updatedAt;
  return typeof v === "string" ? new Date(v) : new Date(0);
}

// Catat/segarkan konflik (idempoten per entity+recordId).
//
// Sebuah resolusi adalah keputusan manusia atas SEPASANG versi tertentu. Selama pasangan itu tak
// berubah, tick sync berikutnya (~15 detik) tak boleh membukanya kembali: dulu payload `update`
// membawa `resolvedAt: null` tanpa syarat, jadi setiap keputusan terhapus sebelum operator sempat
// melihat efeknya — dari sisi mereka tombolnya sekadar "tak berfungsi". Divergensi BARU (salah satu
// sisi bergerak sesudah keputusan) tetap membuka konflik lagi; itu memang konflik yang lain.
export async function recordConflict(entity: string, recordId: string, local: Side, server: Side): Promise<void> {
  const row = {
    entity, recordId,
    localData: local.data as object, localVersion: local.version, localUpdatedAt: stamp(local.data),
    serverData: server.data as object, serverVersion: server.version, serverUpdatedAt: stamp(server.data),
  };
  const prev = await prisma.syncConflict.findUnique({ where: { entity_recordId: { entity, recordId } } });
  if (prev?.resolvedAt && prev.localVersion === local.version && prev.serverVersion === server.version) return;
  await prisma.syncConflict.upsert({
    where: { entity_recordId: { entity, recordId } },
    create: { ...row, resolvedAt: null },
    update: { ...row, resolvedAt: null, detectedAt: new Date() },
  });
}

export async function listConflicts(): Promise<ConflictView[]> {
  const rows = await prisma.syncConflict.findMany({ where: { resolvedAt: null }, orderBy: { detectedAt: "asc" } });
  return rows.map((r) => ({
    entity: r.entity, recordId: r.recordId,
    localData: r.localData, localVersion: r.localVersion, localUpdatedAt: r.localUpdatedAt.toISOString(),
    serverData: r.serverData, serverVersion: r.serverVersion, serverUpdatedAt: r.serverUpdatedAt.toISOString(),
    detectedAt: r.detectedAt.toISOString(),
  }));
}

// Selesaikan satu konflik. `local` → force-push data lokal ke hub (baseVersion = versi server yang
// tercatat). `server` → adopsi data server ke DB lokal. `push` disuntik (transport hub) agar teruji.
export async function resolveConflict(
  entity: string, recordId: string, choice: "local" | "server", push: PushFn,
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "still-conflict" }> {
  if (!isEntity(entity)) return { ok: false, reason: "not-found" };
  const c = await prisma.syncConflict.findUnique({ where: { entity_recordId: { entity, recordId } } });
  if (!c || c.resolvedAt) return { ok: false, reason: "not-found" };

  if (choice === "server") {
    await upsertLocal(entity, recordId, c.serverVersion, c.serverData as Record<string, unknown>);
  } else {
    // `c.serverVersion` adalah versi hub SAAT konflik terdeteksi. Hub bergerak sendiri (monitor VPS
    // menulis health-nya tiap beberapa menit), jadi angka itu sering sudah basi begitu operator
    // sempat mengklik — dan push ditolak selamanya walau tombolnya menjanjikan force-push. Tolakan
    // hub membawa snapshot terkininya; sekali coba ulang dengan versi itu membuat "Pakai Lokal"
    // benar-benar menang. Sekali saja: kalau hub bergeser lagi di sela itu, konfliknya memang hidup
    // dan operator berhak melihatnya lagi, bukan kita loop diam-diam melawan penulis lain.
    let r = (await push([{ entity, id: recordId, baseVersion: c.serverVersion, data: c.localData }])).results?.[0];
    if (!r?.ok && r?.conflict && typeof r.server?.version === "number" && r.server.version !== c.serverVersion) {
      r = (await push([{ entity, id: recordId, baseVersion: r.server.version, data: c.localData }])).results?.[0];
    }
    if (!r?.ok) {
      if (r?.conflict) return { ok: false, reason: "still-conflict" }; // hub bergeser lagi
      return { ok: false, reason: "not-found" };
    }
  }
  await prisma.syncConflict.update({
    where: { entity_recordId: { entity, recordId } }, data: { resolvedAt: new Date() },
  });
  await clearOutbox(entity, recordId);
  return { ok: true };
}
