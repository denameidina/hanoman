import { effectiveStr } from "../config";
import { enqueueOutbox } from "./outbox";
import { publishLocal, publishDelete, consumeTombstoneOnRecreate, isEntity } from "./sync";

// SPEC-268 · ADR-0066 · sebarkan write LOKAL ke peer, sadar-peran:
//  - client (SYNC_SERVER_URL ada) → enqueueOutbox → syncOnce push ke hub (perilaku lama).
//  - hub (SYNC_SERVER_URL kosong) → publishLocal → masuk change-feed sendiri → client pull.
// Best-effort: kegagalan TIDAK menggagalkan write utama (cermin enqueueOutbox).
export async function notifySynced(entity: string, id: string): Promise<void> {
  try {
    if (!isEntity(entity)) return;
    // SPEC-799 · ADR-0119 · id bertombstone yang barisnya ada lagi = seseorang membuatnya ulang.
    // Lapisnya duduk DI SINI, choke point yang sudah dipanggil setiap tulisan lokal — menaruhnya
    // di tiap jalur `create` adalah kelas bug SPEC-431/448/475/481.
    await consumeTombstoneOnRecreate(entity, id);
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);
    else await publishLocal(entity, id);
  } catch { /* jangan blok write utama */ }
}

// SPEC-799 · ADR-0119 · cermin persis notifySynced untuk penghapusan. Tombstone-nya sudah ditulis
// pemanggil (`deleteSynced`) — yang di sini murni penyebarannya, supaya kedua peran punya bentuk
// yang sama dan tak ada satu pun call site yang harus tahu ia sedang berperan apa.
export async function notifyDeleted(entity: string, id: string): Promise<void> {
  try {
    if (!isEntity(entity)) return;
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);
    else await publishDelete(entity, id);
  } catch { /* jangan blok write utama */ }
}
