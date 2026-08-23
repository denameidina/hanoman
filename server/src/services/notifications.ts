import { prisma } from "../db";
import { liveDecisions, markerFilled } from "./pty";
import type { DriftItem } from "../vps/drift";

// SPEC-221 · notifikasi drift kepatuhan VPS (AC-19). Satu notif AGREGAT per audit (bukan per item —
// patuh "instrument panel yang tenang"). Dedup `key: drift:<vpsId>:<snapshotId>` idempoten: re-derive
// snapshot yang sama tak dobel. Drift kosong = tak ada notif.
export async function recordDrift(
  vpsId: string, vpsName: string, drift: DriftItem[], snapshotId: string): Promise<void> {
  if (drift.length === 0) return;
  const ids = drift.map((d) => d.itemId);
  const shown = ids.slice(0, 5).join(", ") + (ids.length > 5 ? `, +${ids.length - 5} lagi` : "");
  const title = `Drift di "${vpsName}": ${drift.length} item regresi (${shown})`;
  await prisma.notification.create({
    data: { type: "drift", key: `drift:${vpsId}:${snapshotId}`, title, projectId: null },
  }).catch(() => { /* P2002: sudah ada untuk snapshot ini */ });
}

// SPEC-180 · dipanggil tepat saat stage backlog masuk `done`. specId @unique membuat ini
// idempoten: poll write-through 3s dan advanceStage yang balapan hanya menyisakan satu baris —
// insert kedua kena P2002 dan diabaikan.
// ponytail: reopen backlog (SPEC-167/172) lalu selesai lagi TIDAK menotifikasi ulang karena
// barisnya sudah ada. Upgrade bila perlu: drop @unique + guard transisi via updateMany count.
export async function recordCompletion(specId: string, title: string, projectId: string | null): Promise<void> {
  // SPEC-516 · ADR-0105 · stempel selesai. Ditulis DI SINI, bukan di ketiga call site yang
  // mempersist `stage = "done"` (advanceStage · scheduler/reconcile · live-specs): efek samping
  // yang disalin ke banyak call site adalah kelas bug yang sudah menggigit repo ini tiga kali
  // (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`, SPEC-475 `headSha`), dan efek samping tak
  // punya tipe yang memaksanya konsisten. `updateMany` ber-guard `doneAt: null` membuatnya
  // TULIS-SEKALI sekaligus tak melempar bila spec-nya sudah dihapus operator.
  await prisma.spec.updateMany({ where: { id: specId, doneAt: null }, data: { doneAt: new Date() } })
    .catch(() => { /* spec bisa saja sudah dihapus */ });
  // SPEC-184 · dedup pindah ke `key` (specId tak lagi @unique — kini menampung juga notif decision).
  // sessionId turunan = idFor(specId) (pty.ts): id sesi tmux backlog dapat ditebak dari spec-nya,
  // jadi aksi "Buka" pada notif bisa mengecek apakah sesinya masih hidup.
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "done", key: `done:${specId}`, specId, sessionId, title, projectId },
  }).catch(() => { /* P2002: sudah ada */ });
}

// SPEC-799 · ADR-0119 · delete menang TANPA SYARAT atas edit lokal yang belum sempat ter-push.
// Menang bukan berarti diam: tanpa baris ini suntingan operator lenyap tanpa satu pun jejak, dan
// "hilang tanpa sebab" adalah persis keluhan yang melahirkan spec ini. `key` memuat versi tombstone
// supaya penghapusan BERIKUTNYA atas id yang sudah dibuat ulang tetap punya suaranya sendiri.
export async function recordSyncDelete(
  entity: string, recordId: string, version: number, title: string,
): Promise<void> {
  await prisma.notification.create({
    data: { type: "sync", key: `sync-delete:${entity}:${recordId}:${version}`, title, projectId: null },
  }).catch(() => { /* P2002: sudah ada */ });
}

// SPEC-298 · notif saat sesi scheduler gagal / kena limit (rekonsiliasi akhir sesi, reconcile.ts).
// Dedup `key:fail:<specId>` idempoten (insert kedua kena P2002, diabaikan). sessionId turunan =
// idFor(specId) → aksi "Buka" bisa memutar ulang pane mati (log gagal). TANPA retry (PRD non-goal).
export async function recordFailure(specId: string, title: string, projectId: string | null, reason: string): Promise<void> {
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "fail", key: `fail:${specId}`, specId, sessionId, title: `Gagal: ${title} — ${reason}`, projectId },
  }).catch(() => { /* P2002: sudah ada */ });
}

// SPEC-486 · ADR-0103 · hasil auto-merge sebuah backlog item. Baris ini merangkap DUA peran:
// laporan ke operator DAN penanda idempotensi durable — `key` unik membuat sweep berikutnya
// (dan sweep sesudah restart) tak pernah mencoba item yang sama dua kali. Pola yang sama dipakai
// `recordCompletion`; ADR-0091 sudah menetapkan idempotensi lewat jejak DB, bukan `Set` memori.
export async function recordAutoMerge(
  specId: string, projectId: string | null, title: string,
): Promise<void> {
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: { type: "automerge", key: `automerge:${specId}`, specId, sessionId, title, projectId },
  }).catch(() => { /* P2002: sudah ada — sweep lain sudah menyelesaikannya */ });
}

// SPEC-742 · ADR-0116 · worktree yang gagal dibersihkan penyapu latar. Tanpa baris ini kegagalannya
// hilang senyap: sesinya sudah lenyap dari daftar, dan yang tersisa cuma direktori yang tak seorang
// pun cari. `key` berkunci ENTRI trash (unik per pemindahan) → satu baris per sampah, bukan satu per
// tick; sapuan berikutnya tetap mencoba lagi tanpa menambah kebisingan.
export async function recordCleanupFailure(
  sessionId: string, projectId: string | null, entry: string, reason: string,
): Promise<void> {
  await prisma.notification.create({
    data: {
      type: "cleanup", key: `cleanup:${entry}`, sessionId, projectId,
      title: `Worktree sesi ${sessionId} gagal dibersihkan — ${reason}`,
    },
  }).catch(() => { /* P2002: sudah dilaporkan untuk entri ini */ });
}

// SPEC-546 · ADR-0109 · konversi type sebuah backlog item. Dedup lewat `key` berurutan
// `source:<specId>:<n>` (n = panjang `sourceHistory` sesudah append): unik & deterministik, jadi
// dua permintaan konversi yang balapan hanya menyisakan satu baris — pola `recordCompletion`.
export async function recordSourceChange(
  specId: string, projectId: string | null, title: string,
  from: string, to: string, seq: number,
): Promise<void> {
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: {
      type: "spec-source", key: `source:${specId}:${seq}`, specId, sessionId,
      title: `${specId} · type ${from} → ${to} — ${title}`, projectId,
    },
  }).catch(() => { /* P2002: konversi yang sama sudah tercatat */ });
}

// SPEC-253 · ADR-0062 · notif saat tiket Help Center baru masuk. Dedup `key: ticket:<ticketId>`
// idempoten (insert kedua kena P2002, diabaikan). Setiap tiket baru menotifikasi — volume
// manusiawi, dijaga rate-limit di endpoint publik.
export async function recordNewTicket(
  ticketId: string, projectId: string, projectName: string, category: string, title: string,
): Promise<void> {
  const short = title.length > 80 ? title.slice(0, 77) + "…" : title;
  const t = `Keluhan baru di "${projectName}": ${category}: ${short}`;
  await prisma.notification.create({
    data: { type: "ticket", key: `ticket:${ticketId}`, projectId, title: t },
  }).catch(() => { /* P2002: sudah ada untuk tiket ini */ });
}

// SPEC-409 · ADR-0091 · notif keputusan hanoman-lead. MEMBERI TAHU, bukan meminta izin (AC-25):
// tak ada pekerjaan yang menunggu ini dibaca. Dedup `key: lead:<decisionId>` — satu baris jejak
// paling banyak satu notif; insert kedua kena P2002 dan diabaikan.
export async function recordLeadDecision(
  decisionId: string, title: string, projectId: string | null,
  specId: string | null, sessionId: string | null,
): Promise<void> {
  await prisma.notification.create({
    data: { type: "lead", key: `lead:${decisionId}`, specId, sessionId, projectId, title },
  }).catch(() => { /* P2002: sudah ada untuk keputusan ini */ });
}

// SPEC-909 · ADR-0146 · sesi yang lahir SEBELUM pembaruan tak punya hook event, dan pemindainya
// sudah dicabut — jadi hanoman-lead tak akan menjawabnya. Menyisakan pemindai "hanya untuk sesi
// lama" berarti mempertahankan persis biaya yang dicabut SPEC ini, untuk populasi yang menyusut
// sendiri. Yang tak boleh terjadi adalah sesi menggantung tanpa siapa pun tahu.
//
// `key` unik → P2002 mendedup SEKALI SEUMUR SESI, termasuk lintas restart server. Itu sebabnya
// dedupnya di DB, bukan `Set` di memori: pane mati bertahan berhari-hari di tmux sementara `Set`
// memori kosong tepat sesudah restart (gotcha 2 ADR-0091).
export async function recordLegacySession(
  sessionId: string, projectId: string | null, specId: string | null,
): Promise<void> {
  await prisma.notification.create({
    data: {
      type: "lead", key: `lead-legacy:${sessionId}`, sessionId, specId, projectId,
      title: `Sesi ${sessionId} tak punya jalur event ke server — hanoman-lead tak akan menjawabnya. Sebabnya salah satu dari dua: ia lahir sebelum pembaruan (mulai ulang sesinya), atau ia berjalan di dalam sandbox yang tak bisa menjangkau server (ADR-0146). Jawab dari panel pet atau terminal.`,
    },
  }).catch(() => { /* P2002: sudah pernah diberitahukan untuk sesi ini */ });
}

// SPEC-646 · ADR-0112 · hasil satu eksekusi cron. `key` diturunkan dari (cronId, dueAt) — stempel
// yang STABIL lintas restart, jadi tick berulang tak bisa menduplikasinya (P2002 diabaikan, pola
// recordCompletion). `skipped` ikut dinotifikasi dengan sengaja: "cek pagi tak jalan karena cap
// penuh" justru yang paling perlu dibaca operator, dan diam adalah kegagalan yang tak terlihat.
export async function recordCronRun(
  cronId: string, cronName: string, projectId: string, dueAt: Date,
  status: "launched" | "skipped" | "failed", note: string | null,
): Promise<void> {
  const verb = status === "launched" ? "berjalan" : status === "skipped" ? "dilewati" : "gagal";
  const title = `Cron "${cronName}" ${verb}${note ? ` — ${note}` : ""}`;
  await prisma.notification.create({
    data: { type: "cron", key: `cron:${cronId}:${dueAt.toISOString()}`, title, projectId },
  }).catch(() => { /* P2002: sudah ada untuk jatuh tempo ini */ });
}

type DecisionSession = {
  id: string; specId?: string; projectId: string; decisionFile: string;
  // SPEC-903 · ADR-0143 · bit "sedang menunggu" yang sama dengan pil terminal & pose pet.
  waiting: boolean;
};

// SPEC-184 · episode per-sesi. Di-rebuild tiap scan dari kondisi marker: sesi mati hilang dari
// liveDecisions() → otomatis ter-prune. Transisi kosong→terisi = satu notif; idle Claude yang
// berulang menambah baris tapi id sudah di set → tak dobel. Restart server: paling banter satu
// notif ulang untuk keputusan yang masih terbuka. ponytail: single-process; pindahkan dedup ke
// kolom DB bila server jadi multi-worker.
let awaiting = new Set<string>();
export function __resetAwaiting(): void { awaiting = new Set(); } // test-only

export async function scanDecisions(read: () => DecisionSession[] = liveDecisions): Promise<void> {
  const next = new Set<string>();
  const fresh: DecisionSession[] = [];
  for (const s of read()) {
    if (!markerFilled(s.decisionFile)) continue;
    // SPEC-903 · ADR-0143 · dua peran dipisah. KAPAN menotifikasi memakai bit turunan: marker codex
    // dipasang di tiap akhir turn, jadi sesi yang melanjutkan sendiri tak boleh menotifikasi.
    // BERAPA KALI tetap dikunci pada marker terisi — manusia yang mengetik jawabannya membuat pane
    // berisik sebentar-sebentar, dan tiap kedipan akan melahirkan notifikasi kedua untuk pertanyaan
    // yang sama. Id keluar dari set hanya saat markernya kosong atau sesinya hilang.
    if (awaiting.has(s.id)) { next.add(s.id); continue; }
    if (!s.waiting) continue;
    next.add(s.id);
    fresh.push(s);
  }
  awaiting = next;
  for (const s of fresh) {
    const title = s.specId
      ? (await prisma.spec.findUnique({ where: { id: s.specId }, select: { title: true } }))?.title ?? s.specId
      : s.id;
    await prisma.notification.create({
      data: { type: "decision", specId: s.specId ?? null, sessionId: s.id, projectId: s.projectId || null, title },
    });
  }
}

// SPEC-523 · plafon feed siar. Frame WebSocket `notifications` (services/events.ts) lahir tiap 3
// detik; menyiarkan seluruh riwayat tiap kali adalah regresi biaya, bukan perbaikan. Jadi
// "tanpa limit" TETAP 50 di sini — berbeda dari paginate() (ADR-0038) yang tanpa limit berarti
// seluruh item. Yang ditambahkan SPEC-523 adalah `total`: 50 tak lagi berpura-pura jadi semuanya.
export const DEFAULT_FEED_TAKE = 50;

// SPEC-199 · cermin GET /notifications: scan marker dulu, lalu daftar + hitungan unread.
// Dipakai route HTTP dan hub siar (services/events.ts). Tipe di-infer (baris Prisma, tanggal
// Date) — sama seperti route lain; JSON serialize Date→string sesuai wire type shared.
// SPEC-523 · `skip`/`take` di query DB SAH di sini: larangan ADR-0038 mengikat GET /specs yang
// overlay stage live-nya bergantung set penuh. Notifikasi adalah baris mati tanpa overlay.
export async function notificationsFeed(p: { page?: string; limit?: string } = {}) {
  await scanDecisions();
  const pageSize = p.limit ? Math.max(1, Math.floor(+p.limit) || 1) : DEFAULT_FEED_TAKE;
  const page = p.page ? Math.max(1, Math.floor(+p.page) || 1) : 1;
  const total = await prisma.notification.count();
  const items = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  // `unread` selalu dihitung dari SELURUH baris, tak pernah dari halaman yang diminta —
  // lencana bell yang mengecil saat operator membuka halaman 2 adalah kebohongan.
  const unread = await prisma.notification.count({ where: { readAt: null } });
  return { items, unread, total, page, pageSize };
}
