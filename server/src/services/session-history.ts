// SPEC-362 · ADR-0079 · riwayat sesi terminal. Satu-satunya tempat yang menyentuh tabel
// SessionHistory; pty.ts tetap bebas DB dan hanya menembakkan peristiwa ke sini.
import { randomUUID } from "node:crypto";
import type { Paginated, SessionEndReason, SessionHistoryView } from "@hanoman/shared";
import { prisma } from "../db";
import { registerSessionHooks, type SessionBirth, type SessionDeath } from "./pty";
import { saveTranscript, readTranscript, deleteTranscript } from "./transcript-store";

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

export async function purgeHistory(q: { projectId?: string; before?: Date }): Promise<number> {
  const where = {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.before ? { startedAt: { lt: q.before } } : {}),
  };
  // Berkas transkrip dihapus lebih dulu: baris yang hilang tanpa berkasnya akan meninggalkan
  // sampah di disk yang tak seorang pun bisa menemukan lagi.
  const doomed = await prisma.sessionHistory.findMany({ where, select: { transcriptKey: true } });
  for (const d of doomed) if (d.transcriptKey) await deleteTranscript(d.transcriptKey);
  const { count } = await prisma.sessionHistory.deleteMany({ where });
  return count;
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
