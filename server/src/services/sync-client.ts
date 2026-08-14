import { prisma } from "../db";
import { pull as _pull, snapshot, upsertLocal, isEntity, validateSyncData, type Entity } from "./sync";
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
export function validateIncomingRecord(input: unknown): {
  entity: Entity; recordId: string; version: number; data: Record<string, unknown>;
} {
  if (!input || typeof input !== "object") throw new Error("sync record harus object");
  const row = input as Record<string, unknown>;
  if (typeof row.entity !== "string" || !isEntity(row.entity)) throw new Error("sync entity tak dikenal");
  if (typeof row.recordId !== "string" || !row.recordId || row.recordId.length > 256) throw new Error("sync recordId invalid");
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new Error("sync version invalid");
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error("sync data invalid");
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_SYNC_RECORD_BYTES) throw new Error("sync record terlalu besar");
  validateSyncData(row.entity, row.data as Record<string, unknown>, { allowProjectRename: true });
  return { entity: row.entity, recordId: row.recordId, version: Number(row.version), data: row.data as Record<string, unknown> };
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
export async function applyRemote(entity: string, recordId: string, version: number, data: Record<string, unknown>): Promise<void> {
  if (!isEntity(entity)) return;
  await upsertLocal(entity, recordId, version, data);
}

// SPEC-382 · feed memuat record BERELASI (`ticketAttachment.ticketId` → `Ticket.id`, FK) yang bisa
// tiba sebelum induknya. Sebuah record yang belum bisa diterapkan harus DITUNDA, bukan dibuang dan
// bukan pula dibiarkan meledak ke luar siklus. `feedHole` menandai "ada record yang belum masuk":
// selama menyala, frame WS tak boleh memajukan kursor melewatinya — kalau maju, baris itu tertinggal
// di belakang kursor dan tak akan pernah ditarik lagi (akar hilangnya lampiran, audit SPEC-382).
let feedHole = false;

// Terapkan satu frame changefeed WS. `false` = belum bisa diterapkan (kursor ditahan, tunggu pull).
export async function applyFeedFrame(msg: {
  entity?: string; recordId?: string; version?: number; data?: Record<string, unknown>; seq?: string | number;
}): Promise<boolean> {
  if (!msg.entity || !msg.recordId) return true; // bukan frame record — tak ada yang bisa hilang
  try {
    const record = validateIncomingRecord({ ...msg, version: Number(msg.version ?? 0), data: msg.data ?? {} });
    await applyRemote(record.entity, record.recordId, record.version, record.data);
  } catch {
    feedHole = true;
    return false;
  }
  if (msg.seq && !feedHole) await setCursor(String(msg.seq));
  return true;
}

export type SyncStats = { pulled: number; pushed: number; conflicts: number };

// Satu siklus sync: pull (skip record yang punya edit lokal pending agar tak menimpanya),
// lalu drain outbox dengan baseVersion = versi lokal saat ini.
export async function syncOnce(transport: Transport): Promise<SyncStats> {
  let pulled = 0, pushed = 0, conflicts = 0;

  const cursor = await getCursor();
  const outbox = await listOutbox();
  const pending = new Set(outbox.map((o) => `${o.entity}:${o.recordId}`));
  // SPEC-270 · dedupe hitungan konflik per record (feed bisa punya banyak baris satu recordId).
  const conflicted = new Set<string>();
  const markConflict = async (entity: string, recordId: string, local: { version: number; data: Record<string, unknown> },
    server: { version: number; data: Record<string, unknown> }) => {
    await recordConflict(entity, recordId, local, server);
    const key = `${entity}:${recordId}`;
    if (!conflicted.has(key)) { conflicted.add(key); conflicts++; }
  };

  const pullRes = await transport("GET", `/api/sync/pull?since=${cursor}`);
  const rawRecords: unknown[] = Array.isArray(pullRes.body?.records) ? pullRes.body.records : [];
  const records = rawRecords.map(validateIncomingRecord);
  // SPEC-382 · record yang gagal diterapkan (umumnya anak mendahului induknya → FK) ditunda, bukan
  // dilempar. Dulu satu record bermasalah membatalkan SELURUH siklus: `setCursor` di bawah tak
  // pernah tercapai, jadi client mandek di kursor itu selamanya (bukan cuma lampiran yang hilang).
  const deferred: typeof records = [];
  for (const rec of records) {
    if (!isEntity(rec.entity)) continue;
    if (pending.has(`${rec.entity}:${rec.recordId}`)) {
      // SPEC-270 · ada edit lokal pending — klasifikasi: data sama → biarkan (push nanti),
      // beda → catat konflik untuk keputusan manusia. Jangan clobber edit lokal.
      const local = await snapshot(rec.entity as Entity, rec.recordId);
      if (local && JSON.stringify(local.data) !== JSON.stringify(rec.data)) {
        await markConflict(rec.entity, rec.recordId,
          { version: local.version, data: local.data }, { version: rec.version, data: rec.data });
      }
      continue;
    }
    try { await applyRemote(rec.entity, rec.recordId, rec.version, rec.data); pulled++; }
    catch { deferred.push(rec); }
  }
  // Pass ulang selama masih ada kemajuan: induk yang menyusul di batch yang sama membuka anaknya
  // (rantai berapa pun dalam). Berhenti saat satu putaran penuh tak menerapkan apa pun.
  let rest = deferred;
  while (rest.length) {
    const still: typeof rest = [];
    for (const rec of rest) {
      try { await applyRemote(rec.entity, rec.recordId, rec.version, rec.data); pulled++; }
      catch { still.push(rec); }
    }
    if (still.length === rest.length) {
      // Betul-betul yatim (induknya sudah dihapus di hub — feed append-only tanpa tombstone,
      // ADR-0068). Dilewati dengan jejak, bukan didiamkan: menahan kursor di sini = livelock.
      for (const rec of still) {
        console.warn(`sync: record ${rec.entity}:${rec.recordId} tak bisa diterapkan (induk absen?) — dilewati`);
      }
      break;
    }
    rest = still;
  }
  if (pullRes.body?.cursor) await setCursor(String(pullRes.body.cursor));
  // Pull sudah melewati rentang yang menahan kursor WS → lubangnya tertambal (atau sengaja dilewati).
  feedHole = false;

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
      if (r?.ok) { await clearOutbox(item.entity, item.recordId); pushed++; }
      else if (r?.conflict) { conflicts++; }
      continue;
    }
    if (!isEntity(item.entity)) { await clearOutbox(item.entity, item.recordId); continue; }
    const snap = await snapshot(item.entity, item.recordId);
    if (!snap) { await clearOutbox(item.entity, item.recordId); continue; } // record hilang lokal
    const res = await transport("POST", "/api/sync/push", {
      records: [{ entity: item.entity, id: item.recordId, baseVersion: snap.version, data: snap.data }],
    });
    const r = res.body?.results?.[0];
    if (r?.ok) {
      // SPEC-270 · naikkan versi lokal = versi hub agar tak nyimpang di edit berikutnya.
      if (typeof r.version === "number") {
        const delegate = (prisma as unknown as Record<string, { update: (a: unknown) => Promise<unknown> } | undefined>)[item.entity];
        await delegate?.update({ where: { id: item.recordId }, data: { version: r.version } }).catch(() => {});
      }
      await clearOutbox(item.entity, item.recordId); pushed++;
    } else if (r?.conflict) {
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
  return { pulled, pushed, conflicts };
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
      connectMs: 5_000, totalMs: 15_000, maxResponseBytes: 2 * 1024 * 1024,
    });
    let parsed: any = null;
    try { parsed = JSON.parse(res.body.toString("utf8")); } catch { /* body kosong */ }
    return { status: res.status, body: parsed };
  };
}

// SPEC-268 · ADR-0066 · pemicu manual (tombol UI): satu siklus syncOnce memakai config efektif.
// null bila instance bukan client (tak ada hub tujuan) → endpoint/tombol melapor "not-configured".
// SPEC-382 · `full` → tarik ulang feed dari awal: kursor balik ke 0 lalu drain halaman demi halaman
// (pull ber-`limit`, jadi satu siklus saja tak cukup). Ini satu-satunya jalan pulang bagi baris yang
// terlanjur dilompati kursor sebelum kontrak apply diperbaiki; aman karena pull server-authoritative
// dan upsert idempoten. Batas putaran = jaring pengaman, bukan kuota.
const FULL_PULL_MAX_PAGES = 200;
export async function syncNow(opts?: { full?: boolean }): Promise<SyncStats | null> {
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (!base || !token) return null;
  const transport = fetchTransport(base, token);
  if (!opts?.full) return syncOnce(transport);
  await setCursor("0");
  const total: SyncStats = { pulled: 0, pushed: 0, conflicts: 0 };
  let seen = "0";
  for (let page = 0; page < FULL_PULL_MAX_PAGES; page++) {
    const s = await syncOnce(transport);
    total.pulled += s.pulled; total.pushed += s.pushed; total.conflicts += s.conflicts;
    const now = await getCursor();
    if (now === seen) break; // kursor berhenti bergerak → feed habis
    seen = now;
  }
  return total;
}

let timer: NodeJS.Timeout | undefined;
let ws: import("ws").WebSocket | undefined;
let started = false;

// SPEC-215 · status sync client aktif (indikator UI di GET /api/config).
export function syncStatus(): { running: boolean; connected: boolean } {
  return { running: started, connected: ws?.readyState === 1 /* OPEN */ };
}

// Jalankan client sync: syncOnce awal + WS siar (apply + drain saat frame) + reconnect backoff +
// tick fallback berkala (drain outbox yang lahir saat offline). Dipanggil dari server.ts bila
// SYNC_SERVER_URL + SYNC_DEVICE_TOKEN di-set.
export async function startSyncClient(base: string, token: string, tickMs?: number): Promise<void> {
  started = true;
  const transport = fetchTransport(base, token);
  const tick = async () => { try { await syncOnce(transport); } catch { /* offline — coba lagi nanti */ } };

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
