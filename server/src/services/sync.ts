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
// SPEC-945 · ADR-0150 · `member` & `task` ikut menyeberang: papan kerja tim adalah pengetahuan
// bersama, bukan setelan mesin. `Member.id` deterministik (email ternormalisasi) justru supaya dua
// mesin yang mencatat orang yang sama bertemu sebagai SATU baris di sini.
export const SYNCED = ["project", "spec", "vps", "sessionResult", "ticket", "ticketAttachment", "customAgent", "githubIssue", "member", "task"] as const;
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
  member: prisma.member as unknown as Delegate,
  task: prisma.task as unknown as Delegate,
};

// Whitelist field bisnis per entitas — SENGAJA mengecualikan never-sync (Project.repoDir,
// Vps.keyPath) dan kolom lokal (createdAt server, dst). Hanya field di sini yang menyeberang.
// SPEC-270 · ADR-0067 · `updatedAt` ikut menyeberang sebagai jam LWW (default modal rekonsil).
const FIELDS: Record<Entity, string[]> = {
  // SPEC-880 · ADR-0135 · `handledBy` ikut menyeberang: "project ini dipegang mesin yang mana"
  // adalah pernyataan bersama, bukan setelan mesin — dan justru menyeberangnya nilai itu yang
  // jadi inti spec-nya. SENGAJA bukan cermin `repoDir`/`schedulerOptIn`/`autoMerge` yang LOCAL-only
  // (mereka properti checkout mesin ini). Tiap entri membawa `name` karena `DeviceToken` TIDAK
  // ikut SYNCED: penerima tak punya baris device untuk di-join. BUKAN DATE_FIELDS.
  project: ["name", "desc", "kind", "stack", "gitRemote", "handledBy", "updatedAt"],
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
  // SPEC-945 · ADR-0150 · SELURUH kolom bermakna ikut menyeberang. `active` wajib ada: `upsert`
  // yang tak menyebut kolom ber-default TETAP berhasil, jadi anggota nonaktif akan hidup lagi di
  // setiap mesin lain tanpa satu pun error (kelas ADR-0090/0093/0105). `email` ikut meski id sudah
  // diturunkan darinya — id menyimpan bentuk ternormalisasi, kolom ini yang diketik operator.
  member: ["name", "email", "role", "active", "createdAt", "updatedAt"],
  // `specId` ikut: tautan eskalasi adalah bagian keadaan yang harus dilihat sama oleh semua mesin —
  // tanpa itu satu mesin bisa mengeskalasi ulang kartu yang di mesin lain sudah jadi backlog
  // (cermin githubIssue.specId). `order` ikut supaya urutan kolom tidak acak di mesin lain.
  task: ["projectId", "title", "detail", "status", "priority", "memberId", "startDate", "dueDate",
    "order", "specId", "createdAt", "updatedAt"],
};
// Field yang JSONB-nya string ISO tapi kolomnya DateTime — dikonversi balik saat menulis.
const DATE_FIELDS: Record<Entity, string[]> = {
  project: ["updatedAt"], spec: ["createdAt", "startedAt", "doneAt", "updatedAt"], vps: ["lastSeenAt", "lastAuditAt", "updatedAt"],
  sessionResult: ["createdAt", "updatedAt"],
  ticket: ["createdAt", "updatedAt"],
  ticketAttachment: ["createdAt", "updatedAt"],
  customAgent: ["createdAt", "updatedAt"],
  githubIssue: ["issueCreatedAt", "issueUpdatedAt", "pulledAt", "createdAt", "updatedAt"],
  member: ["createdAt", "updatedAt"],
  task: ["startDate", "dueDate", "createdAt", "updatedAt"],
};

// SPEC-799 · ADR-0119 · relasi FK antar entitas SYNCED. Dipakai penerima untuk MEMBUANG record anak
// yang datang bagi induk yang sudah bertombstone — dulu jatuh ke `console.warn("induk absen?")`,
// yaitu tebakan, bukan keputusan. Peta ini KONTRAK yang disalin dari skema dan karena itu basi
// diam-diam begitu FK baru lahir; `sync-parents-dmmf.test.ts` menegakkannya (preseden PG_ORDER).
//
// `sessionResult` sengaja ABSEN: `projectId`-nya kolom polos TANPA @relation, jadi menghapus project
// memang tak merambat ke sana. `ticketAttachment.projectId` juga bukan FK (denormal untuk query
// murah) — yang FK hanyalah `ticketId`.
//
// SPEC-945 · ADR-0150 · `onDelete` ikut dicatat karena tak semua FK berarti hal yang sama saat
// induknya bertombstone. `cascade` = anak ikut lenyap, jadi record yang datang untuknya memang
// harus DIBUANG. `setNull` = anak SELAMAT dengan kolom itu dikosongkan — membuangnya membuat
// kartu yang assignee-nya pernah dihapus tak pernah mendarat di mesin yang belum memilikinya,
// senyap, melanggar kontrak yang ditulis route-nya sendiri.
export type ParentRef = { field: string; entity: Entity; onDelete: "cascade" | "setNull" };
export const PARENTS: Partial<Record<Entity, ParentRef[]>> = {
  spec: [{ field: "projectId", entity: "project", onDelete: "cascade" }],
  ticket: [{ field: "projectId", entity: "project", onDelete: "cascade" }],
  ticketAttachment: [{ field: "ticketId", entity: "ticket", onDelete: "cascade" }],
  customAgent: [{ field: "projectId", entity: "project", onDelete: "cascade" }],
  githubIssue: [{ field: "projectId", entity: "project", onDelete: "cascade" }],
  // SPEC-945 · ADR-0150 · DUA induk. `projectId` nullable (cermin customAgent) dan `memberId`
  // nullable juga — `parentTombstoned` melewati nilai kosong, jadi nullable aman apa adanya.
  // `member` sendiri sengaja ABSEN: direktori orang global, tanpa satu pun FK keluar.
  task: [
    { field: "projectId", entity: "project", onDelete: "cascade" },
    { field: "memberId", entity: "member", onDelete: "setNull" },
  ],
};

// Ekspor test-only: kontrak "setiap kolom bermakna ikut menyeberang" hanya bisa diuji dari
// luar bila petanya terlihat. Bukan API publik — tak ada kode produksi yang mengimpornya.
export const __FIELDS = FIELDS;
export const __DATE_FIELDS = DATE_FIELDS;

const NUMBER_FIELDS = new Set([
  "vps:port", "ticket:number", "ticketAttachment:size", "githubIssue:number",
]);
// SPEC-945 · ADR-0150 · TERPISAH dari NUMBER_FIELDS, yang menuntut `Number.isSafeInteger`.
// `Task.order` adalah Float, dan pecahan itu justru ALASAN keberadaannya: drop di antara dua kartu
// menulis titik tengah tetangganya. Menaruhnya di NUMBER_FIELDS lolos selama nilainya masih 0
// (default), lalu kartu PERTAMA yang benar-benar diseret menjatuhkan seluruh sync client —
// `validateIncomingRecord` melempar di LUAR try/catch per-record (`sync-client.ts`), kursor tak
// pernah maju, dan `pullSehat` membungkam log ulangannya. Terukur sebelum perbaikan ini.
const FLOAT_FIELDS = new Set(["task:order"]);
const BOOLEAN_FIELDS = new Set(["vps:hardened", "customAgent:enabled", "member:active"]);
const JSON_FIELDS = new Set([
  "project:handledBy",
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
    if (FLOAT_FIELDS.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`sync tipe invalid: ${entity}.${field}`);
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

// SPEC-885 · ADR-0138 · anggaran byte satu halaman pull. Sebelum ini `pull` memotong per JUMLAH
// baris (`limit`) sementara client memotong per BYTE (`maxResponseBytes` di `fetchTransport`), dan
// dua satuan itu tak pernah bisa sepakat: baris feed berkisar 100 B–29 KB, jadi halaman 500-baris
// bisa 0,2 MB atau 2,5 MB tergantung komposisinya. Di hub produksi halaman KEDUA berukuran 2,51 MB
// (348 jendela 500-baris melewati 2 MB) → response di-destroy client → pull melempar → `tick()`
// menelannya tanpa log → halaman yang sama diulang tiap 15 detik selamanya. Client baru berhenti
// di 500 dari 3.637 record tanpa satu pun jejak.
export const PULL_MAX_BYTES = 1024 * 1024;

// Ukuran record persis seperti yang akan dikirim. Sengaja men-serialize dua kali (di sini dan oleh
// Fastify): anggaran yang ditaksir tidak menjaga apa pun, dan biayanya ~ms untuk halaman 1 MB.
export function recordBytes(rec: PulledRecord): number {
  return Buffer.byteLength(JSON.stringify(rec));
}

export async function pull(
  sinceCursor: string, limit = 500, maxBytes = PULL_MAX_BYTES,
): Promise<{ cursor: string; records: PulledRecord[]; hasMore: boolean }> {
  // SPEC-398 · ADR-0086 · `SyncLog.seq` kini `Int` (SQLite hanya meng-auto-isi alias rowid ber-tipe
  // deklarasi tepat `INTEGER`). Kursor tetap STRING di wire — jangan ubah bentuk itu.
  const since = Number(sinceCursor || "0");
  const rows = await prisma.syncLog.findMany({
    where: { seq: { gt: since } }, orderBy: { seq: "asc" }, take: limit,
  });

  const records: PulledRecord[] = [];
  let bytes = 0;
  let trimmed = false;
  for (const r of rows) {
    const rec: PulledRecord = {
      entity: r.entity, recordId: r.recordId, version: r.version,
      op: r.op === "delete" ? "delete" : "upsert", data: r.data,
    };
    const size = recordBytes(rec);
    // Minimal satu baris SELALU dikirim: satu record raksasa tak boleh membekukan feed di
    // tempatnya. Cap `MAX_SYNC_RECORD_BYTES` (1 MB) di sisi client yang menjaga batas atasnya.
    if (records.length && bytes + size > maxBytes) { trimmed = true; break; }
    bytes += size;
    records.push(rec);
  }

  // Kursor menunjuk baris terakhir yang BENAR-BENAR dikirim — bukan baris terakhir yang dibaca.
  // Kalau ia menunjuk lebih jauh, baris yang tak terkirim tertinggal di belakang kursor dan tak
  // akan pernah ditarik lagi (akar hilangnya lampiran, audit SPEC-382).
  const cursor = records.length ? String(rows[records.length - 1]!.seq) : sinceCursor || "0";
  // `rows.length === limit` = mungkin masih ada di balik batas baris. Melebihkan `hasMore` hanya
  // memicu satu pull kosong; mengurangkannya membuat client berhenti di tengah feed.
  return { cursor, records, hasMore: trimmed || rows.length === limit };
}

// SPEC-885 · ADR-0138 · urutan dependensi topologis, diturunkan dari `PARENTS`. Induk selalu
// mendahului anaknya, jadi penerima tak pernah perlu menunda satu record pun — urutan FK benar
// BY CONSTRUCTION, bukan diperbaiki oleh retry. `vps` dan `sessionResult` tak punya induk
// (`sessionResult.projectId` kolom polos TANPA @relation, lihat catatan di `PARENTS`), jadi
// letaknya bebas — tapi mereka tetap WAJIB ADA.
//
// Daftar ini adalah SALINAN dari `SYNCED` yang diurutkan ulang, dan karena itu ia basi diam-diam
// begitu entitas baru lahir: entitas yang terlewat tidak menghasilkan satu pun error, ia hanya
// TIDAK IKUT ke client baru. `sync-bootstrap.test.ts` menegakkan cakupannya (preseden PARENTS ×
// DMMF di `sync-parents-dmmf.test.ts`).
export const BOOTSTRAP_ORDER: Entity[] = [
  "project", "spec", "ticket", "customAgent", "githubIssue", "ticketAttachment",
  // SPEC-945 · ADR-0150 · `member` WAJIB mendahului `task` (FK memberId). Urutan yang salah
  // bootstrap SUKSES tanpa error tapi assignee kosong — kelas SPEC-885 "lupa vps".
  "member", "task",
  "vps", "sessionResult",
];

export type BootstrapPage = {
  cursor: string; records: PulledRecord[]; hasMore: boolean; next: string | null;
};

// SPEC-885 · ADR-0138 · KEADAAN, bukan sejarah. Client dengan kursor 0 yang menarik lewat feed
// harus memutar ulang setiap versi antara yang masih tersimpan: di hub produksi 3.637 baris /
// 7,9 MB, hanya untuk mendarat jadi 889 record / ~2,5 MB. Membaca tabel langsung menghapus
// kemubaziran itu SEKALIGUS masalah urutan yang ditinggalkan retensi ADR-0131.
export async function bootstrapSnapshot(
  after: string | null, maxBytes = PULL_MAX_BYTES,
): Promise<BootstrapPage> {
  // Kursor DULU, sebelum satu tabel pun dibaca — dan urutan ini yang harus dipertahankan.
  //
  // Akibatnya baris yang dibaca sesudah ini boleh LEBIH BARU daripada kursornya, sehingga client
  // yang memutar ulang feed `> cursor` bisa sesaat menulis versi lama di atas versi baru
  // (`upsertLocal` menulis apa adanya, tak melihat urutan versi). Itu konvergen: seluruh baris
  // diputar berurutan dan berakhir di puncak yang benar.
  //
  // Kebalikannya TIDAK aman. Kursor yang diambil SESUDAH membaca membuat tulisan yang masuk di
  // sela pembacaan ber-`seq` lebih kecil daripada kursor — jadi ia tak pernah ditarik, dan
  // hilangnya permanen.
  const tip = await prisma.syncLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
  const cursor = tip ? String(tip.seq) : "0";

  const sep = after ? after.indexOf(":") : -1;
  const afterEntity = sep > 0 ? after!.slice(0, sep) : null;
  const afterId = sep > 0 ? after!.slice(sep + 1) : null;
  const startAt = afterEntity ? BOOTSTRAP_ORDER.indexOf(afterEntity as Entity) : 0;
  if (startAt < 0) throw new Error("bootstrap cursor tak dikenal");

  const records: PulledRecord[] = [];
  let bytes = 0;
  let last: string | null = null;

  for (let i = startAt; i < BOOTSTRAP_ORDER.length; i++) {
    const entity = BOOTSTRAP_ORDER[i]!;
    // Hanya entitas tempat kursor berhenti yang melanjutkan dari id tertentu; sesudahnya penuh.
    const gt = i === startAt && afterId ? afterId : null;
    const rows = await (DELEGATE[entity] as unknown as {
      findMany: (a: object) => Promise<{ id: string }[]>;
    }).findMany({
      ...(gt ? { where: { id: { gt } } } : {}),
      orderBy: { id: "asc" }, select: { id: true },
    });
    for (const row of rows) {
      // Lewat `snapshot()` yang sama dengan feed: satu-satunya jalur proyeksi `FIELDS`, jadi tak
      // ada bentuk kedua yang bisa menyimpang diam-diam saat kolom baru ikut menyeberang.
      const snap = await snapshot(entity, row.id);
      if (!snap) continue;
      const rec: PulledRecord = {
        entity, recordId: row.id, version: snap.version, op: "upsert", data: snap.data,
      };
      const size = recordBytes(rec);
      if (records.length && bytes + size > maxBytes) {
        return { cursor, records, hasMore: true, next: last };
      }
      bytes += size;
      records.push(rec);
      last = `${entity}:${row.id}`;
    }
  }
  // Paginasi ini sengaja BUKAN snapshot berkonsistensi: record yang lahir di antara dua halaman
  // dan ber-id lebih kecil dari kursor memang terlewat di sini. Ia tetap ada di feed pada
  // `seq > cursor`, jadi drain sesudah bootstrap yang menjemputnya. Konvergensi tidak bergantung
  // pada bootstrap yang lengkap — hanya pada kursornya yang tidak pernah melewati kenyataan.
  return { cursor, records, hasMore: false, next: null };
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
