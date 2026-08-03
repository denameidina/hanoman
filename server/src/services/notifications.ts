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

type DecisionSession = { id: string; specId?: string; projectId: string; decisionFile: string };

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
    next.add(s.id);
    if (!awaiting.has(s.id)) fresh.push(s);
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

// SPEC-199 · cermin GET /notifications: scan marker dulu, lalu daftar + hitungan unread.
// Dipakai route HTTP dan hub siar (services/events.ts). Tipe di-infer (baris Prisma, tanggal
// Date) — sama seperti route lain; JSON serialize Date→string sesuai wire type shared.
export async function notificationsFeed() {
  await scanDecisions();
  const items = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const unread = await prisma.notification.count({ where: { readAt: null } });
  return { items, unread };
}
