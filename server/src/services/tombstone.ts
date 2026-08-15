import { prisma } from "../db";

// SPEC-799 · ADR-0119 · satu-satunya pemilik tabel SyncTombstone. Nol dependency selain `db` supaya
// sync.ts (hub) dan sync-client.ts (client) sama-sama bisa memakainya tanpa siklus impor.
//
// Ide intinya: tombstone BUKAN mekanisme kedua di samping version-stamp — ia versi record itu
// sendiri, berkeadaan "dihapus". Karena itu ia selalu membawa `version`, dan `writeTombstone`
// monoton: keadaan yang lebih tua tak boleh menimpa yang lebih baru walau tiba belakangan (replay
// full-pull memutar ulang feed dari awal, jadi kedatangan tak berurutan adalah keadaan normal).
export type Tombstone = {
  entity: string; recordId: string; version: number;
  data: Record<string, unknown>; deletedAt: Date; deviceId: string | null;
};

const view = (r: {
  entity: string; recordId: string; version: number; data: unknown; deletedAt: Date; deviceId: string | null;
}): Tombstone => ({
  entity: r.entity, recordId: r.recordId, version: r.version,
  data: (r.data ?? {}) as Record<string, unknown>, deletedAt: r.deletedAt, deviceId: r.deviceId,
});

export async function findTombstone(entity: string, recordId: string): Promise<Tombstone | null> {
  const row = await prisma.syncTombstone.findUnique({ where: { entity_recordId: { entity, recordId } } });
  return row ? view(row) : null;
}

export async function writeTombstone(
  entity: string, recordId: string, version: number,
  data: Record<string, unknown>, deviceId?: string,
): Promise<Tombstone> {
  const prev = await findTombstone(entity, recordId);
  if (prev && prev.version >= version) return prev;
  const row = await prisma.syncTombstone.upsert({
    where: { entity_recordId: { entity, recordId } },
    create: { entity, recordId, version, data: data as object, deviceId: deviceId ?? null },
    update: { version, data: data as object, deviceId: deviceId ?? null, deletedAt: new Date() },
  });
  return view(row);
}

// Dipakai saat sebuah id yang bertombstone sengaja dibuat ulang. Id `customAgent`
// ("<scope>:<name>") dan `githubIssue` ("<projectId>:<slug>#<n>") deterministik, jadi pemakaian
// ulang id yang sama persis adalah keadaan nyata, bukan hipotesis.
export async function clearTombstone(entity: string, recordId: string): Promise<void> {
  await prisma.syncTombstone.deleteMany({ where: { entity, recordId } });
}
