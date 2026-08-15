import { prisma } from "../db";
import { renameProjectCore } from "./rename-project";
import { findTombstone, writeTombstone, clearTombstone } from "./tombstone";

// SPEC-213 · ADR-0045 · mesin sync record: version-stamp optimistic concurrency + change-feed
// SyncLog (seq = kursor global). Isi file dokumen TIDAK lewat sini (git 3-way merge, ADR-0043).

// SPEC-268 · ADR-0066 · ticket masuk record-sync (metadata tiket). SPEC-384 · ADR-0092 ·
// `errorGroup` dicabut bersama error monitoring — kind ini tak lagi dikenal `isEntity()`, jadi
// push dari klien versi lama yang masih membawanya ditolak sebagai record tak dikenal.
// SPEC-450 · ADR-0094 · `customAgent` ikut menyeberang: katalog persona adalah pengetahuan
// bersama, bukan setelan mesin. Id-nya deterministik ("<scope>:<name>") justru supaya dua mesin
// yang membuat nama sama bertemu sebagai SATU baris di sini, bukan dua yang saling menelan.
// SPEC-471 · ADR-0095 · `githubIssue` ikut menyeberang: cermin issue adalah pengetahuan
// bersama tim, bukan setelan mesin. Id-nya deterministik ("<projectId>:<slug>#<n>") justru
// supaya dua mesin yang menarik repo yang sama bertemu sebagai SATU baris di sini.
export const SYNCED = ["project", "spec", "vps", "sessionResult", "ticket", "ticketAttachment", "customAgent", "githubIssue"] as const;
export type Entity = (typeof SYNCED)[number];

type Delegate = {
  findUnique: (args: { where: { id: string }; select?: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
  upsert: (args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};
const DELEGATE: Record<Entity, Delegate> = {
  project: prisma.project as unknown as Delegate,
  spec: prisma.spec as unknown as Delegate,
  vps: prisma.vps as unknown as Delegate,
  sessionResult: prisma.sessionResult as unknown as Delegate,
  ticket: prisma.ticket as unknown as Delegate,
  ticketAttachment: prisma.ticketAttachment as unknown as Delegate,
  customAgent: prisma.customAgent as unknown as Delegate,
  githubIssue: prisma.githubIssue as unknown as Delegate,
};

// Whitelist field bisnis per entitas — SENGAJA mengecualikan never-sync (Project.repoDir,
// Vps.keyPath) dan kolom lokal (createdAt server, dst). Hanya field di sini yang menyeberang.
// SPEC-270 · ADR-0067 · `updatedAt` ikut menyeberang sebagai jam LWW (default modal rekonsil).
const FIELDS: Record<Entity, string[]> = {
  project: ["name", "desc", "kind", "stack", "gitRemote", "updatedAt"],
  // SPEC-408 · ADR-0090 · createdAt/startedAt ikut menyeberang — sejajar baseSha/headSha. Tanpa
  // ini spec asal-hub mendapat createdAt lokal palsu di tiap client (kolom NOT NULL ber-default).
  // SPEC-447 · ADR-0093 · dependsOn ikut juga: tanpa itu client tak tahu urutannya dan akan
  // meluncurkan pekerjaan yang di hub terblokir. Bukan DATE_FIELDS — nilainya array string.
  // SPEC-516 · ADR-0105 · doneAt ikut menyeberang — cermin createdAt/startedAt. Tanpa ini spec
  // asal-hub mendarat di tiap client dengan doneAt null tanpa satu pun error, dan changelog
  // mode backlog di client itu selamanya kosong.
  // SPEC-546 · ADR-0109 · sourceHistory ikut menyeberang: jejak konversi type adalah bagian
  // keadaan yang harus dilihat sama oleh semua mesin. `upsert` yang tak menyebut sebuah kolom
  // TETAP berhasil, jadi kolom yang terlewat di sini mendarat sebagai null palsu di tiap client
  // tanpa satu pun error (kelas gagal-senyap ADR-0090/0093/0094/0105). BUKAN DATE_FIELDS —
  // `at` hidup di dalam JSON-nya, kolomnya sendiri bukan DateTime.
  // SPEC-804 · ADR-0120 · manualDone ikut menyeberang: "item ini ditandai selesai manusia" adalah
  // bagian keadaan yang harus dilihat sama oleh semua mesin — di antaranya gerbang auto-merge.
  // BUKAN DATE_FIELDS, alasan yang sama dengan sourceHistory.
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha", "dependsOn", "sourceHistory", "manualDone", "createdAt", "startedAt", "doneAt", "updatedAt"],
  vps: ["name", "host", "port", "user", "health", "audit", "hardened", "lastSeenAt", "lastAuditAt", "updatedAt"],
  sessionResult: ["projectId", "specId", "oldStage", "newStage", "commitSha", "branch", "prUrl", "status", "deviceId", "author", "createdAt", "updatedAt"],
  // SPEC-268 · ADR-0066 · metadata tiket (lampiran biner tak disync). accessKeyHash wajib
  // (kolom required @unique tanpa default); kunci plaintext tak pernah menyeberang.
  ticket: ["projectId", "number", "category", "title", "detail", "reporterEmail", "status", "accessKeyHash", "specId", "createdAt", "updatedAt"],
  // SPEC-272 · ADR-0068 · metadata lampiran (byte tak disync; ditarik lazy dari hub saat dibuka).
  ticketAttachment: ["ticketId", "projectId", "filename", "mimeType", "size", "storageKey", "createdAt", "updatedAt"],
  // SPEC-450 · ADR-0094 · SELURUH kolom bermakna ikut menyeberang. `enabled` & `mentions` wajib
  // ada: `upsert` yang tak menyebut kolom ber-default TETAP berhasil, jadi kolom yang terlewat
  // mendarat sebagai default palsu di tiap client tanpa satu pun error (kelas ADR-0090/0093).
  // `version` tak pernah masuk FIELDS — ia stempel mekanisme sync itu sendiri.
  // SPEC-484 · ADR-0101 · `runtime` ikut: ia menentukan sesi mesin mana yang memakai persona ini,
  // dan kolom yang terlewat di sini mendarat sebagai default palsu (= "warisi") di setiap mesin
  // lain tanpa satu pun error.
  customAgent: ["projectId", "name", "description", "instructions", "tools", "model", "mentions", "runtime", "enabled", "createdAt", "updatedAt"],
  // SPEC-471 · ADR-0095 · SELURUH kolom bermakna ikut. `status`/`specId` termasuk: keputusan
  // triase adalah bagian keadaan yang harus dilihat sama oleh semua mesin — tanpa itu satu
  // mesin bisa menerima ulang issue yang di mesin lain sudah jadi backlog.
  githubIssue: ["projectId", "repoSlug", "number", "title", "body", "authorLogin", "labels", "url",
    "issueState", "status", "specId", "issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"],
};
// Field yang JSONB-nya string ISO tapi kolomnya DateTime — dikonversi balik saat menulis.
const DATE_FIELDS: Record<Entity, string[]> = {
  project: ["updatedAt"], spec: ["createdAt", "startedAt", "doneAt", "updatedAt"], vps: ["lastSeenAt", "lastAuditAt", "updatedAt"],
  sessionResult: ["createdAt", "updatedAt"],
  ticket: ["createdAt", "updatedAt"],
  ticketAttachment: ["createdAt", "updatedAt"],
  customAgent: ["createdAt", "updatedAt"],
  githubIssue: ["issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"],
};

// SPEC-799 · ADR-0119 · relasi FK antar entitas SYNCED. Dipakai penerima untuk MEMBUANG record anak
// yang datang bagi induk yang sudah bertombstone — dulu jatuh ke `console.warn("induk absen?")`,
// yaitu tebakan, bukan keputusan. Peta ini KONTRAK yang disalin dari skema dan karena itu basi
// diam-diam begitu FK baru lahir; `sync-parents-dmmf.test.ts` menegakkannya (preseden PG_ORDER).
//
// `sessionResult` sengaja ABSEN: `projectId`-nya kolom polos TANPA @relation, jadi menghapus project
// memang tak merambat ke sana. `ticketAttachment.projectId` juga bukan FK (denormal untuk query
// murah) — yang FK hanyalah `ticketId`.
export const PARENTS: Partial<Record<Entity, { field: string; entity: Entity }[]>> = {
  spec: [{ field: "projectId", entity: "project" }],
  ticket: [{ field: "projectId", entity: "project" }],
  ticketAttachment: [{ field: "ticketId", entity: "ticket" }],
  customAgent: [{ field: "projectId", entity: "project" }],
  githubIssue: [{ field: "projectId", entity: "project" }],
};

// Ekspor test-only: kontrak "setiap kolom bermakna ikut menyeberang" hanya bisa diuji dari
// luar bila petanya terlihat. Bukan API publik — tak ada kode produksi yang mengimpornya.
export const __FIELDS = FIELDS;
export const __DATE_FIELDS = DATE_FIELDS;

const NUMBER_FIELDS = new Set([
  "vps:port", "ticket:number", "ticketAttachment:size", "githubIssue:number",
]);
const BOOLEAN_FIELDS = new Set(["vps:hardened", "customAgent:enabled"]);
const JSON_FIELDS = new Set([
  "spec:payload", "spec:dependsOn", "spec:sourceHistory", "spec:manualDone",
  "vps:health", "vps:audit",
  "customAgent:tools", "customAgent:mentions",
  "githubIssue:labels",
]);
export const __JSON_FIELDS = JSON_FIELDS;

export function validateSyncData(
  entity: Entity, data: Record<string, unknown>, options: { allowProjectRename?: boolean } = {},
): void {
  const allowed = new Set(FIELDS[entity]);
  if (entity === "project" && options.allowProjectRename) allowed.add("renamedFrom");

  for (const [field, value] of Object.entries(data)) {
    if (!allowed.has(field)) throw new Error(`sync field tak dikenal: ${entity}.${field}`);
    const key = `${entity}:${field}`;
    if (DATE_FIELDS[entity].includes(field)) {
      if (value !== null && (typeof value !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        || Number.isNaN(Date.parse(value)))) {
        throw new Error(`sync tanggal invalid: ${entity}.${field}`);
      }
      continue;
    }
    if (NUMBER_FIELDS.has(key)) {
      if (!Number.isSafeInteger(value)) throw new Error(`sync tipe invalid: ${entity}.${field}`);
      continue;
    }
    if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== "boolean") throw new Error(`sync tipe invalid: ${entity}.${field}`);
      continue;
    }
    if (JSON_FIELDS.has(key)) {
      if (value === undefined) throw new Error(`sync tipe invalid: ${entity}.${field}`);
      try { JSON.stringify(value); } catch { throw new Error(`sync tipe invalid: ${entity}.${field}`); }
      continue;
    }
    if (value !== null && typeof value !== "string") {
      throw new Error(`sync tipe invalid: ${entity}.${field}`);
    }
  }
}

export function isEntity(e: string): e is Entity {
  return (SYNCED as readonly string[]).includes(e);
}

// Objek JSON-bersih: Date → ISO string, null tetap null. Cocok untuk kolom JSONB SyncLog + wire.
function jsonSafe<T>(v: T): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

// Ambil field whitelist dari `data` klien, konversi field tanggal ISO→Date untuk Prisma.
function coerce(entity: Entity, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[entity]) {
    if (!(f in data)) continue;
    let v = data[f];
    if (DATE_FIELDS[entity].includes(f) && typeof v === "string") v = new Date(v);
    out[f] = v;
  }
  return out;
}

export type Snapshot = { version: number; data: Record<string, unknown> };

export async function snapshot(entity: Entity, id: string): Promise<Snapshot | null> {
  const row = await DELEGATE[entity].findUnique({ where: { id } });
  if (!row) return null;
  const data: Record<string, unknown> = {};
  for (const f of FIELDS[entity]) data[f] = jsonSafe(row[f]);
  return { version: Number(row.version), data };
}

export type SyncOp = "upsert" | "delete";

export type PushResult =
  | { ok: true; version: number }
  // SPEC-799 · `deleted` menerangkan MENGAPA ia konflik: id-nya sudah bertombstone di hub, dan
  // `server` karena itu null. Kedua field aditif — client versi lama mengabaikannya dan sekadar
  // mengulang push tanpa efek (tak ada yang rusak, tak ada yang mandek).
  | { ok: false; conflict: true; deleted?: boolean; deletedVersion?: number; server: Snapshot | null };

// Terapkan satu push ber-optimistic-concurrency. Insert (id absen TANPA tombstone) diterima → version 1.
// Update diterima hanya bila baseVersion === version server; else konflik (server tak ditimpa).
// SPEC-799 · ADR-0119 · `op:"delete"` = TOMBSTONE, dan ia menang TANPA SYARAT (tak melihat
// baseVersion sama sekali) — itulah yang membuat hasil hapus-vs-edit independen urutan tiba.
export async function applyPush(
  entity: Entity, id: string, baseVersion: number, data: Record<string, unknown>,
  deviceId?: string, op: SyncOp = "upsert",
): Promise<PushResult> {
  validateSyncData(entity, data, { allowProjectRename: true });

  if (op === "delete") {
    // Idempoten: tombstone yang sudah ada BUKAN error dan BUKAN baris feed kedua. Tanpa gerbang ini
    // push berulang menaikkan version tanpa ujung dan setiap client berputar menariknya.
    const already = await findTombstone(entity, id);
    if (already) return { ok: true, version: already.version };
    const snap = await snapshot(entity, id);
    const version = (snap?.version ?? baseVersion) + 1;
    if (snap) await DELEGATE[entity].delete({ where: { id } }); // cascade DB merambat ke anak
    await writeTombstone(entity, id, version, snap?.data ?? data, deviceId);
    await publishDelete(entity, id);
    return { ok: true, version };
  }

  // SPEC-255 · ADR-0064 · operasi rename project via penanda kontrol data.renamedFrom (bukan kolom;
  // coerce() mengabaikannya). Rename struktural → lewati optimistic-concurrency biasa.
  if (entity === "project" && typeof data.renamedFrom === "string" && data.renamedFrom && data.renamedFrom !== id) {
    const oldId = data.renamedFrom;
    // SPEC-799 · ADR-0119 · rename BUKAN hapus, dan keduanya tak boleh saling menelan: id tujuan
    // yang sudah bertombstone tak boleh dihidupkan lewat pintu rename yang memang MELEWATI
    // optimistic-concurrency biasa. Ditolak dengan alasan yang sama seperti upsert, dan project
    // asalnya sengaja dibiarkan utuh — rename yang gagal tak boleh menghilangkan apa pun.
    const destTomb = await findTombstone("project", id);
    if (destTomb) {
      return { ok: false, conflict: true, deleted: true, deletedVersion: destTomb.version, server: null };
    }
    const already = await DELEGATE.project.findUnique({ where: { id }, select: { version: true } });
    if (already) return { ok: true, version: Number(already.version) }; // sudah diterapkan (idempoten)
    const old = await DELEGATE.project.findUnique({ where: { id: oldId }, select: { version: true } });
    if (old) {
      const newVersion = Number(old.version) + 1;
      await prisma.$transaction(async (tx) => {
        await renameProjectCore(tx, oldId, id);
        const writeData = coerce("project", data);
        await tx.project.update({ where: { id }, data: { ...writeData, version: newVersion, updatedAt: new Date() } });
      });
      const snap = await snapshot("project", id);
      const logData = { ...(snap?.data ?? {}), renamedFrom: oldId }; // penerima ikut rename
      const log = await prisma.syncLog.create({
        data: { entity: "project", recordId: id, version: newVersion, op: "upsert", data: logData as object, deviceId: deviceId ?? null },
      });
      onAccepted?.({ entity: "project", recordId: id, version: newVersion, op: "upsert", data: logData, seq: String(log.seq) });
      return { ok: true, version: newVersion };
    }
    // oldId tak ada → fall-through ke insert normal di bawah (konvergensi).
  }
  // SPEC-799 · ADR-0119 · "versi record saat ini" kini datang dari BARIS ATAU TOMBSTONE — keduanya
  // saling eksklusif. Dengan begitu penolakan kebangkitan jatuh dari aturan optimistic-concurrency
  // yang sudah ada, tanpa cabang khusus: id yang mati di version 6 hanya bisa dihidupkan oleh
  // tulisan yang TAHU tentang version 6.
  const tomb = await findTombstone(entity, id);
  const existing = await DELEGATE[entity].findUnique({ where: { id }, select: { version: true } });
  const currentVersion = existing ? Number(existing.version) : tomb ? tomb.version : null;
  if (currentVersion !== null && currentVersion !== baseVersion) {
    return {
      ok: false, conflict: true, server: await snapshot(entity, id),
      ...(tomb && !existing ? { deleted: true, deletedVersion: tomb.version } : {}),
    };
  }
  const newVersion = (currentVersion ?? 0) + 1;
  const writeData = coerce(entity, data);
  // SPEC-270 · pertahankan updatedAt asal (jam LWW) bila dikirim; else stempel now.
  const stamp = (writeData.updatedAt as Date | undefined) ?? new Date();
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version: newVersion, updatedAt: stamp },
    update: { ...writeData, version: newVersion, updatedAt: stamp },
  });
  if (tomb) await clearTombstone(entity, id); // pembuatan ulang yang sah menang atas tombstone
  const snap = await snapshot(entity, id);
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: newVersion, op: "upsert", data: (snap?.data ?? {}) as object, deviceId: deviceId ?? null },
  });
  onAccepted?.({ entity, recordId: id, version: newVersion, op: "upsert", data: snap?.data ?? {}, seq: String(log.seq) });
  return { ok: true, version: newVersion };
}

export type PulledRecord = { entity: string; recordId: string; version: number; op: SyncOp; data: unknown };

export async function pull(sinceCursor: string, limit = 500): Promise<{ cursor: string; records: PulledRecord[] }> {
  // SPEC-398 · ADR-0086 · `SyncLog.seq` kini `Int` (SQLite hanya meng-auto-isi alias rowid ber-tipe
  // deklarasi tepat `INTEGER`). Kursor tetap STRING di wire — jangan ubah bentuk itu.
  const since = Number(sinceCursor || "0");
  const rows = await prisma.syncLog.findMany({
    where: { seq: { gt: since } }, orderBy: { seq: "asc" }, take: limit,
  });
  const cursor = rows.length ? String(rows[rows.length - 1]!.seq) : sinceCursor || "0";
  return {
    cursor,
    records: rows.map((r) => ({
      entity: r.entity, recordId: r.recordId, version: r.version,
      op: r.op === "delete" ? "delete" : "upsert", data: r.data,
    })),
  };
}

// SPEC-268 · ADR-0066 · publish write LOKAL-asal ke change-feed (SyncLog) + siar. Melengkapi
// applyPush (yang menangani write asal client-push): membuat write asal-hub (tiket
// Help) menjadi bagian feed yang bisa di-pull client. Menaikkan version → optimistic-concurrency
// tetap konsisten. Dipakai lewat notifySynced() (peran hub).
export async function publishLocal(entity: Entity, id: string): Promise<void> {
  const snap = await snapshot(entity, id);
  if (!snap) return;
  const newVersion = snap.version + 1;
  await DELEGATE[entity].update({ where: { id }, data: { version: newVersion } });
  const log = await prisma.syncLog.create({
    data: { entity, recordId: id, version: newVersion, op: "upsert", data: (snap.data ?? {}) as object, deviceId: null },
  });
  onAccepted?.({ entity, recordId: id, version: newVersion, op: "upsert", data: snap.data ?? {}, seq: String(log.seq) });
}

// SPEC-799 · ADR-0119 · penghapusan baris tersync lewat satu pintu, supaya `deleteSynced` (dan hanya
// ia) tak perlu tahu delegate Prisma mana yang dipakai entitas mana.
export async function deleteRow(entity: Entity, id: string): Promise<void> {
  await DELEGATE[entity].delete({ where: { id } });
}

// SPEC-799 · ADR-0119 · publish TOMBSTONE ke change-feed + siar (peran hub). Cermin publishLocal,
// bedanya barisnya sudah tak ada — snapshot terakhirnya datang dari tombstone.
//
// `data` sengaja tetap snapshot yang SAH, bukan objek kosong atau berpenanda: client versi lama
// memvalidasinya lalu menerapkannya sebagai upsert biasa, jadi delete "hanya" tak menyeberang ke
// sana. Bentuk apa pun yang gagal `validateSyncData` di sana justru menyalakan `feedHole` dan
// menahan kursornya SELAMANYA — mandek total, bukan sekadar melewatkan tombstone.
export async function publishDelete(entity: Entity, id: string): Promise<void> {
  const tomb = await findTombstone(entity, id);
  if (!tomb) return;
  const log = await prisma.syncLog.create({
    data: {
      entity, recordId: id, version: tomb.version, op: "delete",
      data: tomb.data as object, deviceId: tomb.deviceId,
    },
  });
  onAccepted?.({ entity, recordId: id, version: tomb.version, op: "delete", data: tomb.data, seq: String(log.seq) });
}

// SPEC-799 · ADR-0119 · id bertombstone yang barisnya ada lagi = seseorang membuatnya ulang. Id
// `customAgent` ("<scope>:<name>") dan `githubIssue` ("<projectId>:<slug>#<n>") DETERMINISTIK, jadi
// pemakaian ulang id yang sama persis adalah keadaan nyata, bukan hipotesis.
//
// Versi baris diangkat ke versi tombstone karena baris baru lahir di `version = 0`: tanpa itu push
// berikutnya membawa `baseVersion = 0` melawan tombstone hub di versi jauh lebih tinggi, dan
// pembuatan ulang yang sah ditolak SELAMANYA tanpa satu pun jalan keluar dari UI.
export async function consumeTombstoneOnRecreate(entity: Entity, id: string): Promise<boolean> {
  const tomb = await findTombstone(entity, id);
  if (!tomb) return false;
  const row = await DELEGATE[entity].findUnique({ where: { id }, select: { version: true } });
  if (!row) return false;
  await clearTombstone(entity, id);
  if (Number(row.version) < tomb.version) {
    await DELEGATE[entity].update({ where: { id }, data: { version: tomb.version } });
  }
  return true;
}

// SPEC-270 · ADR-0067 · reconciler boot HUB: publish tiap row SYNCED yang belum terwakili di
// feed pada version terkininya (mencakup semua version=0 pra-entitas-tersync). Idempoten:
// row yang sudah punya SyncLog untuk version-nya dilewati. Kembalikan jumlah yang dipublish.
export async function backfillFeed(): Promise<number> {
  let published = 0;
  for (const entity of SYNCED) {
    const rows = await (DELEGATE[entity] as unknown as {
      findMany: (a: { select: { id: true; version: true } }) => Promise<{ id: string; version: number }[]>;
    }).findMany({ select: { id: true, version: true } });
    for (const row of rows) {
      const has = await prisma.syncLog.findFirst({
        where: { entity, recordId: row.id, version: Number(row.version) }, select: { seq: true },
      });
      if (has) continue;
      await publishLocal(entity, row.id);
      published++;
    }
  }
  // SPEC-799 · ADR-0119 · tombstone juga bagian keadaan. Instance yang dulu berperan CLIENT punya
  // tombstone TANPA baris feed (peran client mengantre outbox, tak pernah menulis SyncLog); tanpa
  // sapuan ini, promosi jadi hub membuat penghapusan itu tak pernah menyeberang ke siapa pun.
  for (const t of await prisma.syncTombstone.findMany({ select: { entity: true, recordId: true, version: true } })) {
    if (!isEntity(t.entity)) continue;
    const has = await prisma.syncLog.findFirst({
      where: { entity: t.entity, recordId: t.recordId, version: t.version, op: "delete" }, select: { seq: true },
    });
    if (has) continue;
    await publishDelete(t.entity, t.recordId);
    published++;
  }
  return published;
}

// Terapkan record dari server ke DB LOKAL (server-authoritative): set version/data apa adanya,
// TANPA menulis SyncLog/outbox (bukan write lokal). Dipakai sync-client saat pull/WS (Fase 4).
export async function upsertLocal(entity: Entity, id: string, version: number, data: Record<string, unknown>): Promise<void> {
  // SPEC-255 · ADR-0064 · penerima rename: bila renamedFrom di-set & row lama ada (row baru belum),
  // rename in-place (bukan insert row baru yang meninggalkan yatim). Else upsert biasa.
  if (entity === "project" && typeof data.renamedFrom === "string" && data.renamedFrom && data.renamedFrom !== id) {
    const oldId = data.renamedFrom;
    const exists = await DELEGATE.project.findUnique({ where: { id }, select: { version: true } });
    const old = exists ? null : await DELEGATE.project.findUnique({ where: { id: oldId }, select: { version: true } });
    if (!exists && old) {
      const writeData = coerce("project", data);
      await prisma.$transaction(async (tx) => {
        await renameProjectCore(tx, oldId, id);
        await tx.project.update({ where: { id }, data: { ...writeData, version, updatedAt: new Date() } });
      });
      return;
    }
    // else: fall-through ke upsert biasa (row baru sudah ada, atau tak ada oldId → insert).
  }
  const writeData = coerce(entity, data);
  // SPEC-270 · pertahankan updatedAt asal (jam LWW) bila dikirim; else stempel now.
  const stamp = (writeData.updatedAt as Date | undefined) ?? new Date();
  await DELEGATE[entity].upsert({
    where: { id },
    create: { id, ...writeData, version, updatedAt: stamp },
    update: { ...writeData, version, updatedAt: stamp },
  });
}

// Hook siar changefeed (di-set oleh sync-hub, Fase 4). Nol dependency di service ini.
export type AcceptedHook = (row: {
  entity: string; recordId: string; version: number; op: SyncOp; data: unknown; seq: string;
}) => void;
let onAccepted: AcceptedHook | undefined;
export function setAcceptedHook(hook: AcceptedHook | undefined): void { onAccepted = hook; }

// SPEC-447 · whitelist field adalah KONTRAK (spec kehilangan kolom saat menyeberang = bug senyap).
// Diekspor agar test bisa menegakkannya tanpa menebak dari perilaku end-to-end.
export const __FIELDS_FOR_TEST = FIELDS;
