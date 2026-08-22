import { prisma } from "../db";
import {
  pull as _pull, snapshot, upsertLocal, deleteRow, isEntity, validateSyncData,
  PARENTS, type Entity, type SyncOp,
} from "./sync";
import { findTombstone, writeTombstone, clearTombstone } from "./tombstone";
import { recordSyncDelete } from "./notifications";
import { recordConflict } from "./conflicts";
import { listOutbox, clearOutbox } from "./outbox";
import { RENAME_SEP } from "./rename-project";
import { effectiveStr, effectiveInt } from "../config";
import { safeRequest } from "./safe-outbound-request";

// SPEC-213 · ADR-0043 · sisi CLIENT: instance lokal menyinkron (server-to-server) ke hub.
// Disiplin pull-before-push (AC-18): tarik dulu (server-authoritative), lalu push antre lokal.
// Konflik dibiarkan di outbox untuk pull-rebase manusia (AC-13); tak ada write yang korup (AC-19).

export type Transport = (
  method: "GET" | "POST", path: string, body?: unknown,
) => Promise<{ status: number; body: any }>;

const MAX_SYNC_RECORD_BYTES = 1024 * 1024;

// SPEC-799 · ADR-0119 · `op` dibaca dari TOP-LEVEL record dan TIDAK pernah dari `data` — allowlist
// `validateSyncData` akan menolak penanda di sana, dan penolakan itu menyalakan `feedHole` yang
// menahan kursor selamanya. Jenis yang tak dikenal (hub lebih baru) mengembalikan `null` supaya
// pemanggil MELEWATINYA; melempar di sini berarti hub yang lebih baru bisa mematikan client lama.
export function validateIncomingRecord(input: unknown): {
  entity: Entity; recordId: string; version: number; data: Record<string, unknown>; op: SyncOp | null;
} {
  if (!input || typeof input !== "object") throw new Error("sync record harus object");
  const row = input as Record<string, unknown>;
  if (typeof row.entity !== "string" || !isEntity(row.entity)) throw new Error("sync entity tak dikenal");
  if (typeof row.recordId !== "string" || !row.recordId || row.recordId.length > 256) throw new Error("sync recordId invalid");
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new Error("sync version invalid");
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error("sync data invalid");
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_SYNC_RECORD_BYTES) throw new Error("sync record terlalu besar");
  validateSyncData(row.entity, row.data as Record<string, unknown>, { allowProjectRename: true });
  const op: SyncOp | null = row.op === undefined || row.op === null || row.op === "upsert" ? "upsert"
    : row.op === "delete" ? "delete" : null;
  return {
    entity: row.entity, recordId: row.recordId, version: Number(row.version),
    data: row.data as Record<string, unknown>, op,
  };
}

// Kursor pull terakhir (SyncState singleton, LOCAL-only).
export async function getCursor(): Promise<string> {
  const s = await prisma.syncState.findUnique({ where: { id: 1 } });
  return s?.cursor ?? "0";
}
export async function setCursor(cursor: string): Promise<void> {
  await prisma.syncState.upsert({ where: { id: 1 }, create: { id: 1, cursor }, update: { cursor } });
}

// Terapkan satu record dari server ke DB lokal (server-authoritative), tanpa menulis feed/outbox.
//
// SPEC-799 · ADR-0119 · "dropped" = dibuang SENGAJA (bukan gagal): upsert basi atas id bertombstone,
// atau record anak bagi induk yang sudah bertombstone. Membedakannya dari lemparan itu yang membuat
// `syncOnce` tahu mana yang layak ditunda dan mana yang memang sudah selesai urusannya.
export async function applyRemote(
  entity: string, recordId: string, version: number, data: Record<string, unknown>, op: SyncOp = "upsert",
): Promise<"applied" | "dropped"> {
  if (!isEntity(entity)) return "dropped";
  if (op === "delete") { await applyRemoteDelete(entity, recordId, version, data); return "applied"; }

  const tomb = await findTombstone(entity, recordId);
  if (tomb) {
    if (version <= tomb.version) return "dropped";   // replay feed lama — inilah konvergensi full-pull
    await clearTombstone(entity, recordId);          // hub memakai ulang id-nya secara sah
  }
  if (await parentTombstoned(entity, data)) return "dropped";
  await upsertLocal(entity, recordId, version, data);
  return "applied";
}

// Idempoten by construction: tombstone untuk baris yang sudah tak ada = no-op SUKSES. Kalau ia
// melempar, kursor tertahan di depannya (feedHole) dan seluruh sync client mandek — kegagalan lama
// yang ditutup ADR-0082, jangan dibuka lagi lewat pintu ini.
async function applyRemoteDelete(
  entity: Entity, recordId: string, version: number, data: Record<string, unknown>,
): Promise<void> {
  const existing = await snapshot(entity, recordId);
  await writeTombstone(entity, recordId, version, existing?.data ?? data);
  if (existing) await deleteRow(entity, recordId);
  const pending = await prisma.syncOutbox.findFirst({ where: { entity, recordId } });
  if (!pending) return;
  await clearOutbox(entity, recordId);
  if (existing) {
    await recordSyncDelete(entity, recordId, version,
      `Dihapus di peer: ${entity} ${recordId} — suntingan lokal yang belum tersinkron dibuang`);
  }
}

// SPEC-799 · ADR-0119 · anak yatim BUKAN anomali: induknya memang dihapus, dan penerima sudah punya
// keadaan itu. Dulu ia jatuh ke `console.warn("induk absen?")` — sebuah tebakan yang tak bisa
// dibedakan dari kegagalan sungguhan.
async function parentTombstoned(entity: Entity, data: Record<string, unknown>): Promise<boolean> {
  for (const p of PARENTS[entity] ?? []) {
    const v = data[p.field];
    if (typeof v !== "string" || !v) continue;
    if (await findTombstone(p.entity, v)) return true;
  }
  return false;
}

// SPEC-382 · feed memuat record BERELASI (`ticketAttachment.ticketId` → `Ticket.id`, FK) yang bisa
// tiba sebelum induknya. Sebuah record yang belum bisa diterapkan harus DITUNDA, bukan dibuang dan
// bukan pula dibiarkan meledak ke luar siklus. `feedHole` menandai "ada record yang belum masuk":
// selama menyala, frame WS tak boleh memajukan kursor melewatinya — kalau maju, baris itu tertinggal
// di belakang kursor dan tak akan pernah ditarik lagi (akar hilangnya lampiran, audit SPEC-382).
let feedHole = false;

// Terapkan satu frame changefeed WS. `false` = belum bisa diterapkan (kursor ditahan, tunggu pull).
export async function applyFeedFrame(msg: {
  entity?: string; recordId?: string; version?: number; op?: string;
  data?: Record<string, unknown>; seq?: string | number;
}): Promise<boolean> {
  if (!msg.entity || !msg.recordId) return true; // bukan frame record — tak ada yang bisa hilang
  try {
    const record = validateIncomingRecord({ ...msg, version: Number(msg.version ?? 0), data: msg.data ?? {} });
    // SPEC-799 · `op` tak dikenal = frame dari hub yang lebih baru. Dilewati, TIDAK menahan kursor:
    // menahannya berarti satu jenis peristiwa masa depan cukup untuk mematikan client ini.
    if (record.op) await applyRemote(record.entity, record.recordId, record.version, record.data, record.op);
  } catch {
    feedHole = true;
    return false;
  }
  if (msg.seq && !feedHole) await setCursor(String(msg.seq));
  return true;
}

export type SyncStats = { pulled: number; pushed: number; conflicts: number; deleted: number; dropped: number };

type IncomingRecord = ReturnType<typeof validateIncomingRecord>;

// SPEC-885 · ADR-0138 · jaring pengaman lingkaran drain, BUKAN kuota. Feed hub produksi 3.637
// baris; batas ini hanya mencegah lingkaran tak berujung bila kursor gagal maju.
const MAX_DRAIN_PAGES = 500;

// Satu pass atas record tertunda; kembalikan yang MASIH belum bisa diterapkan. Sengaja TIDAK
// membuang apa pun.
//
// Sesudah retensi ADR-0131 memangkas baris penciptaan induk, "tak bisa diterapkan di halaman ini"
// berhenti menjadi bukti yatim: yang tersisa di feed hanyalah baris TERAKHIR tiap record, dan
// baris terakhir sebuah project bisa ber-`seq` jauh lebih besar daripada baris spec anaknya. Di
// hub produksi itu berlaku untuk 510 dari 728 spec, 508 di antaranya di halaman berbeda. Kode
// lama membuangnya di sini dan tetap memajukan kursor — jadi 70% spec hilang tanpa satu pun error.
async function retryDeferred(rest: IncomingRecord[], stats: SyncStats): Promise<IncomingRecord[]> {
  while (rest.length) {
    const still: IncomingRecord[] = [];
    for (const rec of rest) {
      try {
        const r = await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op ?? "upsert");
        if (r === "dropped") stats.dropped++;
        else if (rec.op === "delete") stats.deleted++;
        else stats.pulled++;
      } catch { still.push(rec); }
    }
    // Satu putaran penuh tanpa kemajuan: induknya belum tiba. Tunggu halaman berikutnya, jangan
    // buang — pembuangan hanya sah setelah SELURUH feed habis.
    if (still.length === rest.length) return still;
    rest = still;
  }
  return [];
}

// Satu siklus sync: kuras feed sampai habis (pull-apply berulang), lalu drain outbox sekali.
//
// SPEC-885 · ADR-0138 · dulu ia menarik SATU halaman per panggilan, dan pemanggilnya adalah tick
// 15 detik — jadi laju tarik client dipatok 500 baris / 15 detik oleh timer, bukan oleh jaringan
// maupun CPU, yang menganggur hampir sepanjang waktu itu.
export async function syncOnce(transport: Transport): Promise<SyncStats> {
  const stats: SyncStats = { pulled: 0, pushed: 0, conflicts: 0, deleted: 0, dropped: 0 };

  const outbox = await listOutbox();
  const pending = new Set(outbox.map((o) => `${o.entity}:${o.recordId}`));
  // SPEC-270 · dedupe hitungan konflik per record (feed bisa punya banyak baris satu recordId).
  const conflicted = new Set<string>();
  const markConflict = async (entity: string, recordId: string, local: { version: number; data: Record<string, unknown> },
    server: { version: number; data: Record<string, unknown> }) => {
    await recordConflict(entity, recordId, local, server);
    const key = `${entity}:${recordId}`;
    if (!conflicted.has(key)) { conflicted.add(key); stats.conflicts++; }
  };

  let deferred: IncomingRecord[] = [];
  for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
    const cursor = await getCursor();
    const pullRes = await transport("GET", `/api/sync/pull?since=${cursor}`);
    const rawRecords: unknown[] = Array.isArray(pullRes.body?.records) ? pullRes.body.records : [];
    const records = rawRecords.map(validateIncomingRecord);

    for (const rec of records) {
      if (!isEntity(rec.entity)) continue;
      // SPEC-799 · jenis peristiwa dari hub yang lebih baru — dilewati, bukan ditunda & bukan melempar.
      if (!rec.op) { stats.dropped++; continue; }
      // SPEC-270 · anti-clobber HANYA untuk upsert. SPEC-799: delete menang tanpa syarat, jadi edit
      // lokal pending justru bukan alasan menundanya — di situlah keputusannya harus berlaku.
      if (rec.op === "upsert" && pending.has(`${rec.entity}:${rec.recordId}`)) {
        const local = await snapshot(rec.entity as Entity, rec.recordId);
        if (local && JSON.stringify(local.data) !== JSON.stringify(rec.data)) {
          await markConflict(rec.entity, rec.recordId,
            { version: local.version, data: local.data }, { version: rec.version, data: rec.data });
        }
        continue;
      }
      try {
        const r = await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op);
        if (r === "dropped") stats.dropped++;
        else if (rec.op === "delete") stats.deleted++;
        else stats.pulled++;
      } catch { deferred.push(rec); }
    }

    // Induk yang menyusul di halaman ini membuka anaknya yang tertunda dari halaman SEBELUMNYA.
    deferred = await retryDeferred(deferred, stats);

    const next = pullRes.body?.cursor ? String(pullRes.body.cursor) : cursor;
    if (next !== cursor) await setCursor(next);
    // Pull sudah melewati rentang yang menahan kursor WS → lubangnya tertambal (atau sengaja dilewati).
    feedHole = false;

    // Hub lama tak mengirim `hasMore` → "mungkin masih ada" selama halamannya tak kosong. Itu
    // menutup kombinasi client-baru/hub-lama tanpa memaksa hub naik versi lebih dulu.
    const more = (pullRes.body?.hasMore as boolean | undefined) ?? records.length > 0;
    // Kursor yang tak maju berarti menarik lagi hanya mengulang halaman yang sama.
    if (!more || next === cursor) break;
  }

  // Feed habis. Yang masih tak bisa diterapkan di sini memang yatim — dan kini kalimat itu jujur,
  // bukan artefak paginasi. Dilewati dengan jejak, bukan didiamkan: menahan kursor di sini =
  // livelock (ADR-0082), dan induknya justru ada di halaman berikutnya yang takkan pernah ditarik.
  for (const rec of deferred) {
    console.warn(`sync: record ${rec.entity}:${rec.recordId} tak bisa diterapkan — dilewati`);
    stats.dropped++;
  }

  for (const item of outbox) {
    // SPEC-255 · ADR-0064 · operasi rename project: recordId = "<oldId> <newId>". Push satu record
    // project ber-penanda renamedFrom agar hub merename in-place (bukan insert baru).
    if (item.entity === "projectRename") {
      const [oldId, newId] = item.recordId.split(RENAME_SEP);
      const snap = newId ? await snapshot("project", newId) : null;
      if (!oldId || !newId || !snap) { await clearOutbox(item.entity, item.recordId); continue; }
      const res = await transport("POST", "/api/sync/push", {
        records: [{ entity: "project", id: newId, baseVersion: 0, data: { ...snap.data, renamedFrom: oldId } }],
      });
      const r = res.body?.results?.[0];
      if (r?.ok) { await clearOutbox(item.entity, item.recordId); stats.pushed++; }
      else if (r?.conflict) { stats.conflicts++; }
      continue;
    }
    if (!isEntity(item.entity)) { await clearOutbox(item.entity, item.recordId); continue; }
    const snap = await snapshot(item.entity, item.recordId);
    // SPEC-799 · ADR-0119 · baris tak ada TAPI tombstone ada = penghapusan lokal menunggu jendela
    // online. Dulu cabang ini sekadar `clearOutbox` ("record hilang lokal") — di situlah setiap
    // penghapusan client mati tanpa jejak.
    if (!snap) {
      const tomb = await findTombstone(item.entity, item.recordId);
      if (!tomb) { await clearOutbox(item.entity, item.recordId); continue; } // hilang tanpa jejak
      // `baseVersion` = versi SEBELUM dihapus & `data` = snapshot terakhir: hub versi LAMA membuang
      // `op` sebagai field tak dikenal dan memperlakukannya sebagai update biasa — record sekadar
      // hidup di sana (status quo), bukan 500 di tiap siklus push karena create tanpa kolom required.
      const res = await transport("POST", "/api/sync/push", {
        records: [{
          entity: item.entity, id: item.recordId,
          baseVersion: Math.max(tomb.version - 1, 0), op: "delete", data: tomb.data,
        }],
      });
      if (res.body?.results?.[0]?.ok) { await clearOutbox(item.entity, item.recordId); stats.pushed++; }
      continue;
    }
    const res = await transport("POST", "/api/sync/push", {
      records: [{ entity: item.entity, id: item.recordId, baseVersion: snap.version, data: snap.data }],
    });
    const r = res.body?.results?.[0];
    // SPEC-880 · hub yang menolak record (500, atau `{ok:false,error}` per-record) dulu tak
    // meninggalkan jejak apa pun: item tetap di outbox dan diulang tiap siklus SELAMANYA tanpa
    // satu baris log. Gejala paling mungkin: hub lebih tua dari client, belum punya kolom yang
    // dikirim `snapshot()`. Non-destruktif & sembuh sendiri begitu hub naik versi — tapi ia harus
    // bisa didiagnosis, bukan ditebak.
    if (!r) {
      console.warn(`sync: push ${item.entity}:${item.recordId} tak dijawab hub (status ${res.status})`
        + " — tetap di outbox; periksa apakah hub lebih tua dari client ini");
    }
    if (r?.ok) {
      // SPEC-270 · naikkan versi lokal = versi hub agar tak nyimpang di edit berikutnya.
      if (typeof r.version === "number") {
        const delegate = (prisma as unknown as Record<string, { update: (a: unknown) => Promise<unknown> } | undefined>)[item.entity];
        await delegate?.update({ where: { id: item.recordId }, data: { version: r.version } }).catch(() => {});
      }
      await clearOutbox(item.entity, item.recordId); stats.pushed++;
    } else if (r?.conflict) {
      // SPEC-799 · ADR-0119 · hub sudah menghapusnya. Delete menang: adopsi tombstone-nya, buang
      // edit lokal, berhenti mendorong. Tanpa lapis ini record bertombstone di-push selamanya.
      if (r.deleted) {
        await applyRemote(item.entity, item.recordId,
          Number(r.deletedVersion ?? snap.version + 1), snap.data, "delete");
        await clearOutbox(item.entity, item.recordId);
        stats.deleted++;
        continue;
      }
      // SPEC-270 · hub menolak → catat konflik dua-sisi bila datanya beda; else konvergen (adopsi hub).
      const server = r.server as { version: number; data: Record<string, unknown> } | null;
      if (server && JSON.stringify(server.data) !== JSON.stringify(snap.data)) {
        await markConflict(item.entity, item.recordId,
          { version: snap.version, data: snap.data }, { version: server.version, data: server.data });
      } else if (server) {
        await applyRemote(item.entity, item.recordId, server.version, server.data);
        await clearOutbox(item.entity, item.recordId);
      }
    }
  }
  return stats;
}

// Transport HTTP nyata ke hub remote (server-to-server): Bearer device token.
export function fetchTransport(base: string, token: string): Transport {
  return async (method, path, body) => {
    const url = new URL(path, `${base.replace(/\/$/, "")}/`);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const res = await safeRequest({
      url, method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: Buffer.from(JSON.stringify(body)) } : {}),
      allowPrivate: process.env.NODE_ENV !== "production" && loopback,
      connectMs: 5_000, totalMs: 15_000,
      // SPEC-885 · ADR-0138 · cap ini dulu 2 MB, dan halaman feed 2,51 MB di hub produksi
      // membuat setiap client baru MANDEK di situ selamanya — bukan lambat, mandek, dan tanpa
      // satu baris log. Hub yang sudah membawa anggaran byte memotong halamannya di 1 MB, jadi
      // cap ini tak akan tersentuh olehnya. Ia dinaikkan justru untuk hub yang BELUM naik versi,
      // yang tetap mengirim 500 baris apa adanya — kombinasi yang dialami tiap
      // `npm i -g hanoman` sebelum hub-nya diperbarui (urutan rilis hub-duluan, ADR-0135).
      maxResponseBytes: 8 * 1024 * 1024,
    });
    let parsed: any = null;
    try { parsed = JSON.parse(res.body.toString("utf8")); } catch { /* body kosong */ }
    return { status: res.status, body: parsed };
  };
}

// SPEC-268 · ADR-0066 · pemicu manual (tombol UI): satu siklus syncOnce memakai config efektif.
// null bila instance bukan client (tak ada hub tujuan) → endpoint/tombol melapor "not-configured".
// SPEC-382 · `full` → tarik ulang feed dari awal (pemulihan baris yang terlanjur dilompati kursor);
// aman karena pull server-authoritative dan upsert idempoten.
// SPEC-885 · ADR-0138 · lingkaran 200-halaman yang dulu berdiri di sini sudah pindah ke `syncOnce`,
// yang kini menguras sampai habis dengan sendirinya — jadi `full` tinggal "mundurkan kursor lalu
// jalankan", dan penjumlahan stats antar-putaran tak lagi punya alasan untuk ada.
export async function syncNow(opts?: { full?: boolean }): Promise<SyncStats | null> {
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (!base || !token) return null;
  const transport = fetchTransport(base, token);
  if (opts?.full) await setCursor("0");
  return syncOnce(transport);
}

let timer: NodeJS.Timeout | undefined;
let ws: import("ws").WebSocket | undefined;
let started = false;

// SPEC-215 · status sync client aktif (indikator UI di GET /api/config).
export function syncStatus(): { running: boolean; connected: boolean } {
  return { running: started, connected: ws?.readyState === 1 /* OPEN */ };
}

// SPEC-885 · ADR-0138 · kegagalan pull dulu ditelan `catch { }` tanpa satu baris pun. Itulah yang
// membuat mandek total (halaman 2,51 MB melewati cap byte) tak bisa dibedakan dari sepi, dan
// karena itu insiden ini butuh investigasi penuh untuk sekadar DIKENALI. Digerbangi flag: tick
// berjalan tiap 15 detik, jadi log per-kegagalan akan jadi hujan log saat hub tak terjangkau —
// yang dicatat adalah TRANSISI, pola yang sama dengan siar dashboard di ADR-0131 §3.
let pullSehat = true;
export function __resetSyncHealth(): void { pullSehat = true; }

export async function syncTick(transport: Transport): Promise<void> {
  try {
    await syncOnce(transport);
    if (!pullSehat) { console.info("sync: pull pulih"); pullSehat = true; }
  } catch (e) {
    if (pullSehat) {
      console.warn(`sync: pull gagal — ${(e as Error).message}`);
      pullSehat = false;
    }
  }
}

// Jalankan client sync: syncOnce awal + WS siar (apply + drain saat frame) + reconnect backoff +
// tick fallback berkala (drain outbox yang lahir saat offline). Dipanggil dari server.ts bila
// SYNC_SERVER_URL + SYNC_DEVICE_TOKEN di-set.
export async function startSyncClient(base: string, token: string, tickMs?: number): Promise<void> {
  started = true;
  const transport = fetchTransport(base, token);
  const tick = () => syncTick(transport);

  const connectWs = async () => {
    const { WebSocket } = await import("ws");
    const wsUrl = base.replace(/^http/, "ws").replace(/\/$/, "") + "/api/sync/ws";
    ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${token}` } });
    ws.on("open", () => { void tick(); });
    ws.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.t !== "sync") return;
        // SPEC-382 · frame yang belum bisa diterapkan menahan kursor lalu ditambal lewat pull —
        // dulu kegagalan ditelan diam-diam dan frame berikutnya memajukan kursor melewatinya.
        if (!(await applyFeedFrame(msg))) void tick();
      } catch { /* frame rusak — abaikan */ }
    });
    const reconnect = () => { setTimeout(() => { void connectWs(); }, 3000); };
    ws.on("close", reconnect);
    ws.on("error", () => { try { ws?.close(); } catch { /* noop */ } });
  };

  await tick();               // drain awal + pull awal
  void connectWs();           // realtime
  // Fallback tick: drain outbox yang lahir saat WS putus. Prod 15s; smoke/test bisa turunkan.
  const ms = tickMs && tickMs > 0 ? tickMs : 15_000;
  timer = setInterval(() => { void tick(); }, ms);
  timer.unref?.();
}

export function stopSyncClient(): void {
  started = false;
  if (timer) { clearInterval(timer); timer = undefined; }
  try { ws?.close(); } catch { /* noop */ }
  ws = undefined;
}

// SPEC-215 · re-init live saat config sync berubah. Kosong → hanya stop (jadi HUB murni).
export async function applySyncConfig(): Promise<void> {
  stopSyncClient();
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (base && token) await startSyncClient(base, token, effectiveInt("SYNC_TICK_MS"));
}
