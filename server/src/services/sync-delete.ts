import { snapshot, deleteRow, type Entity } from "./sync";
import { writeTombstone, findTombstone } from "./tombstone";
import { notifyDeleted } from "./sync-notify";
import { listOutbox } from "./outbox";

// SPEC-799 · ADR-0119 · SATU panggilan untuk menghapus record tersync: baca versi + snapshot
// (sesudah delete barisnya tak ada lagi, jadi urutannya bukan selera), hapus, tulis tombstone,
// terbitkan sadar-peran. Memecahnya jadi tiga langkah berarti setiap call site baru harus
// mengingat ketiganya BERIKUT urutannya — kelas bug yang sudah menggigit repo ini empat kali
// (SPEC-431/448/475/481) dan pelajaran `releaseWorktree()` di ADR-0116.
export async function deleteSynced(entity: Entity, id: string, deviceId?: string): Promise<boolean> {
  const snap = await snapshot(entity, id);
  if (!snap) return false;
  await deleteRow(entity, id); // cascade tingkat-DB merambat ke anak; penerima melakukan hal sama
  await writeTombstone(entity, id, snap.version + 1, snap.data, deviceId);
  await notifyDeleted(entity, id);
  return true;
}

// SPEC-799 · penghapusan yang masih menunggu jendela online: entri outbox yang barisnya sudah tak
// ada TAPI tombstone-nya ada. Tanpa umpan balik ini operator membaca "hapusnya gagal" lalu
// mengulanginya, dan penghapusan yang tak terlihat efeknya adalah penghapusan yang dikira gagal.
//
// Entri outbox ber-tombstone SELALU berarti "delete menunggu": `deleteSynced` menghapus barisnya
// lebih dulu, dan id yang dibuat ulang sudah kehilangan tombstone-nya lewat
// `consumeTombstoneOnRecreate` di `notifySynced`.
export async function listPendingDeletes(): Promise<{ entity: string; recordId: string; deletedAt: string }[]> {
  const out: { entity: string; recordId: string; deletedAt: string }[] = [];
  for (const item of await listOutbox()) {
    const tomb = await findTombstone(item.entity, item.recordId);
    if (!tomb) continue;
    out.push({ entity: item.entity, recordId: item.recordId, deletedAt: tomb.deletedAt.toISOString() });
  }
  return out;
}
