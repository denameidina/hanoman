// SPEC-362 · ADR-0079 · riwayat sesi terminal. Satu-satunya tempat yang menyentuh tabel
// SessionHistory; pty.ts tetap bebas DB dan hanya menembakkan peristiwa ke sini.
import { randomUUID } from "node:crypto";
import type { Paginated, SessionEndReason, SessionHistoryView } from "@hanoman/shared";
import { prisma } from "../db";
import { registerSessionHooks, type SessionBirth, type SessionDeath } from "./pty";
import { saveTranscript, readTranscript, deleteTranscript, listTranscripts } from "./transcript-store";

type Row = {
  id: string; sessionId: string; projectId: string; specId: string | null; title: string | null;
  kind: string; flow: string | null; agent: string; model: string | null; effort: string | null;
  branch: string | null; cwd: string; startedAt: Date; endedAt: Date | null; exitCode: number | null;
  endedReason: string | null; reconciledAt: Date | null;
  transcriptKey: string | null; transcriptBytes: number | null;
};

// Kosakata `endedReason` hidup di @hanoman/shared bersama pembacanya (`sessionOutcome`): penulis
// dan pembaca yang tak sepakat adalah kelas bug SPEC-431/448.
const CLOSED: SessionEndReason = "closed";
const RECONCILED: SessionEndReason = "reconciled";

const view = (r: Row): SessionHistoryView => ({
  id: r.id, sessionId: r.sessionId, projectId: r.projectId, specId: r.specId, title: r.title,
  kind: r.kind, flow: r.flow, agent: r.agent, model: r.model, effort: r.effort, branch: r.branch,
  cwd: r.cwd, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
  endedReason: r.endedReason, reconciledAt: r.reconciledAt?.toISOString() ?? null,
  exitCode: r.exitCode, transcriptBytes: r.transcriptBytes,
});

// Judul spec ikut disalin sebagai SNAPSHOT: riwayat harus tetap terbaca setelah spec-nya dihapus,
// dan judul saat sesi berjalan itulah konteks yang benar — bukan judul hari ini.
async function titleFor(specId?: string): Promise<string | null> {
  if (!specId) return null;
  const s = await prisma.spec.findUnique({ where: { id: specId }, select: { title: true } });
  return s?.title ?? null;
}

export async function beginSession(b: SessionBirth): Promise<void> {
  await prisma.sessionHistory.create({
    data: {
      id: randomUUID(), sessionId: b.sessionId, projectId: b.projectId, specId: b.specId ?? null,
      title: await titleFor(b.specId), kind: b.kind, flow: b.flow ?? null, agent: b.agent,
      model: b.model ?? null, effort: b.effort ?? null, branch: b.branch ?? null, cwd: b.cwd,
    },
  });
}

export async function finishSession(d: SessionDeath): Promise<void> {
  // Baris BERJALAN terbaru untuk sessionId itu. Sesi spec memakai id deterministik yang berulang,
  // jadi mencocokkan hanya lewat sessionId akan menimpa riwayat lama.
  const open = await prisma.sessionHistory.findFirst({
    where: { sessionId: d.sessionId, endedAt: null }, orderBy: { startedAt: "desc" },
  });
  if (!open) return;  // sesi lahir sebelum fitur ini ada, atau sudah direkonsiliasi
  const t = d.transcript ? await saveTranscript(d.transcript) : { key: "", bytes: 0 };
  await prisma.sessionHistory.update({
    where: { id: open.id },
    data: {
      endedAt: new Date(), endedReason: CLOSED, exitCode: d.exitCode,
      transcriptKey: t.key || null, transcriptBytes: t.key ? t.bytes : null,
    },
  });
}

export async function listHistory(q: {
  projectId?: string; specId?: string; kind?: string; q?: string; page?: string; limit?: string;
}): Promise<Paginated<SessionHistoryView>> {
  const term = q.q?.trim();
  const where = {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.specId ? { specId: q.specId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(term
      ? {
        // SPEC-398 · ADR-0086 · SQLite tak punya `mode: "insensitive"`; `LIKE`-nya sudah
        // case-insensitive untuk ASCII, jadi pencarian ini tetap berperilaku sama.
        OR: [
          { sessionId: { contains: term } },
          { specId: { contains: term } },
          { title: { contains: term } },
          { branch: { contains: term } },
        ],
      }
      : {}),
  };
  const total = await prisma.sessionHistory.count({ where });
  // skip/take di query DB SAH di sini: berbeda dari GET /specs (ADR-0038) yang butuh set penuh untuk
  // overlay stage live + write-through, riwayat adalah baris mati tanpa overlay apa pun.
  const pageSize = q.limit ? Math.min(Math.max(Math.floor(+q.limit) || 1, 1), 200) : (total || 1);
  const page = Math.max(Math.floor(+(q.page ?? 1)) || 1, 1);
  const rows = await prisma.sessionHistory.findMany({
    where, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { items: rows.map(view), total, page, pageSize };
}

export async function getHistory(id: string): Promise<(SessionHistoryView & { hasTranscript: boolean }) | null> {
  const r = await prisma.sessionHistory.findUnique({ where: { id } });
  return r ? { ...view(r), hasTranscript: !!r.transcriptKey } : null;
}

export async function transcriptOf(id: string): Promise<{ text: string; bytes: number } | null> {
  const r = await prisma.sessionHistory.findUnique({ where: { id }, select: { transcriptKey: true } });
  if (!r?.transcriptKey) return null;
  const text = await readTranscript(r.transcriptKey);
  return text === null ? null : { text, bytes: Buffer.byteLength(text, "utf8") };
}

export type PurgeReport = { purged: number; transcriptsDeleted: number; transcriptsFailed: number };

// Potongan sekaligus menjaga panjang klausa `IN` dan durasi kunci tulis SQLite tetap wajar.
const PURGE_BATCH = 200;

// SPEC-845 · ADR-0126 · berkas transkrip dihapus SESUDAH penghapusan barisnya commit. Dari dua
// urutan yang mungkin hanya urutan ini yang sisanya bisa dipulihkan: berkas yatim ditemukan kembali
// oleh reconcileTranscripts (selisih isi disk vs kolom transcriptKey), sedangkan byte yang telanjur
// di-unlink untuk baris yang penghapusannya GAGAL hilang selamanya. Urutan sebaliknya pun tak pernah
// benar-benar mencegah yatim: `deleteMany({ where })` menurunkan ulang himpunannya saat dieksekusi,
// jadi sesi yang ditutup di antara snapshot dan penghapusan tetap kehilangan berkasnya.
export async function purgeHistory(q: { projectId?: string; before?: Date }): Promise<PurgeReport> {
  const where = {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.before ? { startedAt: { lt: q.before } } : {}),
  };
  const doomed = await prisma.sessionHistory.findMany({ where, select: { id: true, transcriptKey: true } });
  const report: PurgeReport = { purged: 0, transcriptsDeleted: 0, transcriptsFailed: 0 };
  // Penghapusan menyebut himpunan id EKSPLISIT, bukan `where` lagi: tak ada baris yang boleh
  // terhapus tanpa kuncinya dikenal. Crash di tengah menyisakan potongan yang sudah selesai, satu
  // potongan berkas yatim, dan sisa baris yang tinggal di-purge ulang — purge idempoten.
  for (let i = 0; i < doomed.length; i += PURGE_BATCH) {
    const batch = doomed.slice(i, i + PURGE_BATCH);
    const { count } = await prisma.sessionHistory.deleteMany({ where: { id: { in: batch.map((d) => d.id) } } });
    report.purged += count;
    for (const d of batch) {
      if (!d.transcriptKey) continue;
      try { await deleteTranscript(d.transcriptKey); report.transcriptsDeleted++; }
      catch { report.transcriptsFailed++; }  // yatim yang dipungut reconcileTranscripts nanti
    }
  }
  return report;
}

// Tenggang sapuan. `saveTranscript` menulis berkas SEBELUM `finishSession` menulis
// `transcriptKey`-nya, jadi selalu ada jendela berisi berkas hidup yang belum dirujuk baris mana
// pun; menyapu tanpa tenggang akan menghancurkannya — cacat yang sama dengan yang ADR-0126
// perbaiki, dilahirkan kembali oleh perbaikannya sendiri. Satu jam jauh melampaui jendela nyata.
export const TRANSCRIPT_GC_GRACE_MS = 60 * 60_000;

// SPEC-845 · ADR-0126 · mark & sweep dua arah antara tabel dan direktori transkrip. Manifesnya
// kolom `transcriptKey` itu sendiri — tak ada tabel, kolom, atau direktori staging baru (cermin
// `.trash` worktree ADR-0116: isinya sampah menurut konstruksi). Dipanggil dari sweep retensi,
// bukan timer sendiri (ADR-0024).
export async function reconcileTranscripts(
  opts: { graceMs?: number; dryRun?: boolean } = {},
): Promise<{ orphans: number; dangling: number; failed: number }> {
  const rows = await prisma.sessionHistory.findMany({
    where: { transcriptKey: { not: null } }, select: { id: true, transcriptKey: true },
  });
  const referenced = new Set(rows.map((r) => r.transcriptKey!));
  const onDisk = await listTranscripts();
  const present = new Set(onDisk.map((f) => f.key));
  const cutoff = Date.now() - (opts.graceMs ?? TRANSCRIPT_GC_GRACE_MS);
  const report = { orphans: 0, dangling: 0, failed: 0 };

  for (const f of onDisk) {
    if (referenced.has(f.key) || f.mtimeMs > cutoff) continue;
    if (opts.dryRun) { report.orphans++; continue; }
    try { await deleteTranscript(f.key); report.orphans++; }
    catch { report.failed++; }
  }
  // Arah sebaliknya: baris yang menunjuk berkas hilang. Tanpa ini `hasTranscript` tetap `true`
  // sementara endpoint transkripnya 404 — persis gejala yang dilaporkan SPEC-845.
  for (const r of rows) {
    if (present.has(r.transcriptKey!)) continue;
    if (opts.dryRun) { report.dangling++; continue; }
    try {
      await prisma.sessionHistory.update({
        where: { id: r.id }, data: { transcriptKey: null, transcriptBytes: null },
      });
      report.dangling++;
    } catch { report.failed++; }
  }
  return report;
}

// tmux bisa mati di luar hanoman (kill-server, reboot). Tanpa ini, baris tanpa pane akan selamanya
// terbaca "berjalan". Dipanggil sekali saat boot — cermin backfillFeed saat hub boot (ADR-0067).
// SPEC-844 · ADR-0125 · barisnya ditandai `reconciled`: `exitCode` null DI SINI berarti "hasil tak
// diketahui", sementara `exitCode` null di jalur `finishSession` berarti "agen masih hidup saat
// ditutup" — dua keadaan yang dulu tak terbedakan dan sama-sama dirender hijau "selesai".
export async function reconcileHistory(liveSessionIds: string[]): Promise<number> {
  const open = await prisma.sessionHistory.findMany({
    where: { endedAt: null }, select: { id: true, sessionId: true, updatedAt: true },
  });
  const live = new Set(liveSessionIds);
  // Satu stempel untuk seluruh sapuan: semua baris yang ditemukan mati oleh boot yang sama memang
  // ditemukan pada saat yang sama.
  const at = new Date();
  let closed = 0;
  for (const r of open) {
    if (live.has(r.sessionId)) continue;
    // `updatedAt` = kapan baris ini TERAKHIR disentuh, dan service ini hanya menulis saat lahir &
    // tutup — jadi untuk baris berjalan ia sama dengan waktu lahirnya. Ia dipakai apa adanya
    // sebagai batas BAWAH ("terakhir diketahui hidup"), `reconciledAt` batas atasnya; memindahkan
    // `endedAt` ke `at` akan mengarang klaim bahwa sesinya hidup selama seluruh downtime. UI tak
    // merender durasi baris ini sama sekali (SPEC-844).
    await prisma.sessionHistory.update({
      where: { id: r.id },
      data: { endedAt: r.updatedAt, endedReason: RECONCILED, reconciledAt: at },
    });
    closed++;
  }
  return closed;
}

// Dipanggil server.ts sebelum request pertama. Hook fire-and-forget di pty menelan error, jadi
// promise yang gagal di sini tak boleh menggantung sebagai unhandled rejection.
export function installSessionHistory(): void {
  registerSessionHooks({
    onBirth: (b) => { void beginSession(b).catch((e) => console.error("riwayat sesi (lahir):", e)); },
    onDeath: (d) => { void finishSession(d).catch((e) => console.error("riwayat sesi (tutup):", e)); },
  });
}
