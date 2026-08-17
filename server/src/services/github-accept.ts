import { sourceForLabels } from "@hanoman/shared";
import type { GithubIssue, Spec } from "@prisma/client";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";

// SPEC-471 · ADR-0095 · jembatan issue GitHub → backlog item. Cermin services/ticket-accept.ts
// (ADR-0062): idempoten lewat back-pointer, pemetaan asal → source, retry P2002 di sekitar
// nextSpecId. Ini call site prisma.spec.create KEEMPAT di server — ketiganya yang lain adalah
// POST /specs, POST /specs/batch, dan acceptTicket.

const backlinkOf = (i: GithubIssue) => `Dari GitHub issue ${i.repoSlug}#${i.number} (${i.url}).`;

export async function acceptGithubIssue(
  issue: GithubIssue,
  opts: { author: string; priority?: "tinggi" | "sedang" | "rendah"; source?: "qa" | "brief" | "audit" },
): Promise<{ spec: Spec; created: boolean }> {
  // Idempoten: issue yang sudah tertaut mengembalikan Spec-nya, tak pernah membuat yang kedua.
  if (issue.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: issue.specId } });
    if (spec) return { spec, created: false };
  }
  const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : [];
  const source = opts.source ?? sourceForLabels(labels);
  const priority = opts.priority ?? "sedang";
  const backlink = backlinkOf(issue);
  const detail = `${issue.body}\n\nPelapor: @${issue.authorLogin}\n`
    + `Label: ${labels.length ? labels.join(", ") : "(tanpa label)"}\n${backlink}`;

  // Bentuk payload WAJIB cocok dengan source — zCreateSpec.superRefine menuntutnya (SPEC-197).
  // `priority` ikut di payload brief karena zBriefPayload MEWAJIBKANNYA (zQaPayload tidak);
  // cermin POST /specs/batch. Tanpa itu payload-nya ditolak di boundary mana pun yang memvalidasi.
  const payload = source === "qa"
    ? { severity: "major" as const,
        steps: "Reproduksi dari deskripsi issue.",
        expected: "Perilaku yang diharapkan pelapor issue.",
        actual: detail, env: "", constraints: "" }
    : { context: detail, outcome: "", constraints: "", priority };

  const repoDir = await resolveRepoDir(issue.projectId).catch(() => null);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin ketiga call site lain.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: issue.projectId, title: issue.title, source,
          stage: "brainstorming", priority, author: `GitHub · ${opts.author}`,
          objective: `${issue.title}. ${backlink}`,
          payload,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.githubIssue.update({
    where: { id: issue.id }, data: { status: "accepted", specId: spec!.id } });
  await notifySynced("spec", spec!.id);
  await notifySynced("githubIssue", issue.id);
  return { spec: spec!, created: true };
}
