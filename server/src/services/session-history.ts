// SPEC-362 · ADR-0079 · riwayat sesi terminal. Satu-satunya tempat yang menyentuh tabel
// SessionHistory; pty.ts tetap bebas DB dan hanya menembakkan peristiwa ke sini.
import { randomUUID } from "node:crypto";
import type { Paginated, SessionHistoryView } from "@hanoman/shared";
import { prisma } from "../db";
import { registerSessionHooks, type SessionBirth, type SessionDeath } from "./pty";
import { saveTranscript, readTranscript, deleteTranscript } from "./transcript-store";

type Row = {
  id: string; sessionId: string; projectId: string; specId: string | null; title: string | null;
  kind: string; flow: string | null; agent: string; model: string | null; effort: string | null;
  branch: string | null; cwd: string; startedAt: Date; endedAt: Date | null; exitCode: number | null;
  transcriptKey: string | null; transcriptBytes: number | null;
};

const view = (r: Row): SessionHistoryView => ({
  id: r.id, sessionId: r.sessionId, projectId: r.projectId, specId: r.specId, title: r.title,
  kind: r.kind, flow: r.flow, agent: r.agent, model: r.model, effort: r.effort, branch: r.branch,
  cwd: r.cwd, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
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
  // SPEC-846 · transkrip adalah I/O OPSIONAL; `endedAt`/`exitCode` tidak. Disk penuh atau
  // `$HANOMAN_HOME` read-only tak boleh membatalkan penutupan baris — hook `onDeath` menelan
  // lemparan, jadi sesi mati akan terbaca "berjalan" sampai boot berikutnya. Cermin
  // `dropSessionUploads` yang best-effort karena alasan yang sama.
  let t = { key: "", bytes: 0 };
  if (d.transcript) {
    try { t = await saveTranscript(d.transcript); }
    catch (e) { console.error("riwayat sesi (transkrip tak tersimpan):", e); }
  }
  await prisma.sessionHistory.update({
    where: { id: open.id },
    data: {
      endedAt: new Date(), exitCode: d.exitCode,
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
export async function reconcileHistory(liveSessionIds: string[]): Promise<number> {
  const open = await prisma.sessionHistory.findMany({
    where: { endedAt: null }, select: { id: true, sessionId: true, updatedAt: true },
  });
  const live = new Set(liveSessionIds);
  let closed = 0;
  for (const r of open) {
    if (live.has(r.sessionId)) continue;
    // updatedAt = waktu terbaik yang tersedia; exitCode tetap null karena memang tak diketahui.
    await prisma.sessionHistory.update({ where: { id: r.id }, data: { endedAt: r.updatedAt } });
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
