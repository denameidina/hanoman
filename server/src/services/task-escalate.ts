import { payloadShapeFor, severityFromPriority } from "@hanoman/shared";
import type { EscalateSource, Priority } from "@hanoman/shared";
import type { Member, Spec, Task } from "@prisma/client";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";

// SPEC-947 · jembatan kartu papan tim → backlog item. Cermin services/ticket-accept.ts (ADR-0062)
// dan services/github-accept.ts (ADR-0095): idempoten lewat back-pointer, bentuk payload mengikuti
// source, retry P2002 di sekitar nextSpecId. Ini call site prisma.spec.create KELIMA di server.
//
// Dipisah dari routes/tasks.ts dengan alasan yang sama seperti acceptTicket: ia inti yang bisa
// dipanggil jalur non-HTTP (scheduler, lead) tanpa menyalin satu barisnya.

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Konteks yang dipunyai KARTU dan tak dipunyai `Spec`. Tanpa penanda `UNTRUSTED_*`: pembungkus itu
 * ada karena tiket Help Center datang dari publik, sementara kartu tim ditulis anggota tim di
 * dalam dashboard ber-auth (route ini COOKIE_ONLY dua arah). Memperlakukannya sebagai racun
 * melatih agen mengabaikan konteks yang justru sengaja diberikan.
 */
function contextOf(task: Task, member: Member | null, backlink: string): string {
  const lines = [
    task.detail?.trim() || "(kartu tanpa detail)",
    "",
    backlink,
    `Kolom papan: ${task.status} · prioritas kartu: ${task.priority}`,
    `Ditugaskan: ${member ? `${member.name} <${member.email}>` : "belum ditugaskan"}`,
  ];
  const from = day(task.startDate);
  const to = day(task.dueDate);
  if (from || to) lines.push(`Jadwal kartu: ${from ?? "—"} → ${to ?? "—"}`);
  return lines.join("\n");
}

export async function escalateTask(
  task: Task,
  opts: {
    projectId: string; source: EscalateSource; priority: Priority;
    author: string; launchApprovedBy?: string | null;
  },
): Promise<{ spec: Spec; task: Task; created: boolean }> {
  if (task.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: task.specId } });
    // `specId` terisi TANPA Spec = tautan putus (ADR-0150 keputusan 5) — jatuh ke pembuatan baru,
    // cermin acceptGithubIssue. `spec!` seperti acceptTicket akan mengembalikan undefined sebagai
    // Spec dan meledak di pemanggil, bukan di sini.
    if (spec) {
      // Kartu tertaut yang projectnya kosong hanya bisa lahir dari sync atau dari baris sebelum
      // gerbang PATCH ada. Dipulihkan ke project SPEC-nya — BUKAN ke project yang diminta
      // pemanggil: tautannya sudah menetapkan jawabannya, dan memakai `opts.projectId` di sini
      // akan memindahkan kartu ke project yang Spec-nya tak pernah tinggali.
      if (task.projectId === spec.projectId) return { spec, task, created: false };
      const repaired = await prisma.task.update({
        where: { id: task.id }, data: { projectId: spec.projectId },
      });
      await notifySynced("task", task.id);
      return { spec, task: repaired, created: false };
    }
  }

  const member = task.memberId
    ? await prisma.member.findUnique({ where: { id: task.memberId } })
    : null;
  const backlink = `Dari kartu papan tim hanoman "${task.title}" (kartu ${task.id}, project ${opts.projectId}).`;
  const context = contextOf(task, member, backlink);

  // Bentuk payload WAJIB cocok dengan source — zCreateSpec.superRefine menuntutnya (SPEC-197/546).
  // `priority` ikut di payload brief karena zBriefPayload MEWAJIBKANNYA (zQaPayload tidak);
  // `severity` diturunkan dari prioritas yang baru saja dipilih operator di dialog yang sama,
  // bukan dihardcode "major" seperti dua call site lama yang tak punya nilai itu (ADR-0109).
  const payload = payloadShapeFor(opts.source) === "qa"
    ? { severity: severityFromPriority(opts.priority), steps: "Reproduksi dari isi kartu.",
        expected: "Perilaku yang diharapkan penulis kartu.", actual: context,
        env: "", constraints: "" }
    : { context, outcome: "", constraints: "", priority: opts.priority };

  const repoDir = await resolveRepoDir(opts.projectId);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin keempat call site lain.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: opts.projectId, title: task.title, source: opts.source,
          stage: "brainstorming", priority: opts.priority, author: `Tim · ${opts.author}`,
          objective: `${task.title}. ${backlink}`, payload,
          launchApprovedAt: opts.launchApprovedBy ? new Date() : null,
          launchApprovedBy: opts.launchApprovedBy ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }

  // `projectId` ikut ditulis: kartu yang mengaku "tanpa project" sambil menunjuk Spec di dalam
  // sebuah project adalah kebenaran kedua yang langsung drift — papan menyaring per-project, dan
  // kartu itu takkan muncul di papan project yang backlog item-nya sedang dikerjakan.
  const updated = await prisma.task.update({
    where: { id: task.id }, data: { specId: spec!.id, projectId: opts.projectId },
  });
  await notifySynced("spec", spec!.id);
  await notifySynced("task", task.id);
  return { spec: spec!, task: updated, created: true };
}
