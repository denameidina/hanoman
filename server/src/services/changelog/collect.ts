import { prisma } from "../../db";
import { dayStart, dayEnd, inDayRange } from "../date-range";
import { scrubSubject, scrubBody } from "./scrub";
import type { ChangelogInput, ChangelogItem } from "./render";

// SPEC-516 · ADR-0105 · kumpulkan bahan changelog per mode. Keadaan SAH yang bukan galat
// (rentang kosong, repo belum ditautkan, tanpa tag, revisi tak dikenal) dipulangkan sebagai
// `{ ok:false, reason }` berbahasa manusia — route menerjemahkannya ke 422, bukan 500.
// Constraint eksplisit brief: "bukan error 500".
export type CollectResult = { ok: true; input: ChangelogInput } | { ok: false; reason: string };

const toItem = (label: string, detail: string): ChangelogItem | null => {
  const l = scrubSubject(label);
  return l ? { label: l, detail: scrubBody(detail) } : null;
};

/** Mode 1 — backlog yang SELESAI dalam rentang tanggal. Stempelnya `Spec.doneAt` (ADR-0105);
 *  `updatedAt` sengaja tak dipakai — mesin sync mem-bump `version` dan overlay stage-live menulis
 *  tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia (ADR-0090). */
export async function collectBacklog(projectId: string, from: string, to: string): Promise<CollectResult> {
  const f = dayStart(from), t = dayEnd(to);
  const rows = await prisma.spec.findMany({
    where: { projectId, stage: "done" },
    select: { title: true, objective: true, doneAt: true },
    orderBy: [{ doneAt: "asc" }, { id: "asc" }],
  });
  const stampless = rows.filter((r) => r.doneAt === null).length;
  const hit = rows.filter((r) => inDayRange(r.doneAt, f, t));
  const items = hit.map((r) => toItem(r.title, r.objective ?? "")).filter((x): x is ChangelogItem => x !== null);
  if (items.length === 0)
    return { ok: false, reason: `tak ada backlog yang selesai antara ${from} dan ${to}` };
  const notes: string[] = [];
  if (stampless > 0)
    notes.push(`${stampless} item selesai tanpa stempel waktu (selesai sebelum stempel ini ada) dan tak ikut dihitung.`);
  return { ok: true, input: { mode: "backlog", title: `${from} – ${to}`, items, notes } };
}
