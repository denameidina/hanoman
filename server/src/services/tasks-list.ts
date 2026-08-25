import type { Task } from "@prisma/client";
import type { Paginated, TaskSpecMirror, TaskStatus, TaskView } from "@hanoman/shared";
import { prisma } from "../db";
import { paginate } from "./paginate";

// SPEC-945 · ADR-0150 · satu definisi untuk GET /tasks dan topik siar `tasks`. Menyalinnya ke hub
// berarti dua serializer yang bisa berselisih diam-diam (pelajaran SPEC-908 · tickets-list.ts).

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const taskView = (t: Task, spec: TaskSpecMirror | null): TaskView => ({
  id: t.id, projectId: t.projectId, title: t.title, detail: t.detail,
  status: t.status as TaskStatus, priority: t.priority, memberId: t.memberId,
  startDate: iso(t.startDate), dueDate: iso(t.dueDate), order: t.order,
  // `specId` tetap disajikan meski `spec` null: bedanya itulah yang membedakan "tak pernah
  // dieskalasi" dari "tautannya putus", dan yang kedua harus terlihat, bukan diam.
  specId: t.specId, spec,
  createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
});

export type TasksFilter = {
  projectId?: string; status?: string; memberId?: string; page?: number; limit?: number;
};

// `?:` di sini adalah bug yang terukur di tickets-list.ts: route menyerahkan `Number(limit)`, jadi
// `limit=abc` (NaN) dan `limit=0` sama-sama falsy dan akan terbaca "tanpa limit".
const str = (v: number | undefined): string | undefined => (v === undefined ? undefined : String(v));

export async function buildTasksPage(f: TasksFilter): Promise<Paginated<TaskView>> {
  const where: { projectId?: string; status?: string; memberId?: string } = {};
  if (f.projectId) where.projectId = f.projectId;
  if (f.status) where.status = f.status;
  if (f.memberId) where.memberId = f.memberId;
  // `order` menaik = urutan dalam kolom; `id` memecah seri supaya dua mesin yang menulis nilai
  // yang sama tetap menghasilkan urutan yang identik di mana pun.
  const rows = await prisma.task.findMany({ where, orderBy: [{ order: "asc" }, { id: "asc" }] });

  // `specId` TANPA FK, jadi tak ada `include` Prisma yang bisa dipakai. Satu query untuk seluruh
  // himpunan — bukan satu per kartu (N+1) — lalu dipetakan di memori.
  const specIds = [...new Set(rows.map((t) => t.specId).filter((s): s is string => !!s))];
  const specs = specIds.length
    ? await prisma.spec.findMany({
        where: { id: { in: specIds } }, select: { id: true, stage: true, priority: true },
      })
    : [];
  const byId = new Map(specs.map((s) => [s.id, s as TaskSpecMirror]));

  return paginate(
    rows.map((t) => taskView(t, t.specId ? byId.get(t.specId) ?? null : null)),
    str(f.page), str(f.limit),
  );
}
