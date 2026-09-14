import { describe, it, expect } from "vitest";
import {
  startPrompt, continuePrompt, resumePrompt, startGoalPrompt, startProjectPrompt,
  startPrdPrompt, startBreakdownPrompt, startScaffoldPrompt,
} from "../src/prompt";

// ADR-0164 · AC-2 · jaring byte-identitas. Berkas __golden__ ditulis SEKALI dari kode sebelum
// orkestrasi, lalu setiap perubahan prompt.ts wajib tetap menghasilkan byte yang sama untuk jalur
// tanpa rencana fase. JANGAN memperbarui snapshot ini (`-u`) untuk membuat test hijau.
const spec = { id: "SPEC-1151", title: "Orkestrasi", source: "brief", priority: "tinggi",
  objective: "Fase dikerjakan subagent", payload: { context: "c", outcome: "o" } };
const qa = { ...spec, source: "qa", payload: { fromAudit: "SPEC-1100", steps: "s" } };
const goal = { ...spec, source: "goal", payload: { goal: "Hijau", done: "test lulus", constraints: "tanpa migrasi" } };
const attachments = { dir: "/att", items: [{ filename: "a.md", mimeType: "text/markdown", size: 3, path: "/att/a.md" }] };
const project = { id: "p1", name: "P1", desc: "ide", stack: "ts" };
const resume = { recorded: ["Audit done"], next: "Spec", worktreeKept: false };
const file = (name: string) => `./__golden__/${name}.txt`;

describe("golden prompt mode sesi tunggal (ADR-0164)", () => {
  it("startPrompt feature", async () => {
    await expect(startPrompt("feature", spec, "hanoman/spec-1151", undefined, "changed", "superpowers", attachments))
      .toMatchFileSnapshot(file("start-feature"));
  });
  it("startPrompt qa full-control matt", async () => {
    await expect(startPrompt("qa", qa, "b", "full-control", "full", "matt")).toMatchFileSnapshot(file("start-qa-matt"));
  });
  it("startPrompt audit", async () => {
    await expect(startPrompt("audit", spec, "b")).toMatchFileSnapshot(file("start-audit"));
  });
  it("continuePrompt", async () => {
    await expect(continuePrompt("feature", spec, "b", undefined, "changed")).toMatchFileSnapshot(file("continue-feature"));
  });
  it("resumePrompt qa", async () => {
    await expect(resumePrompt("qa", qa, "b", resume, undefined, "changed", "superpowers", attachments))
      .toMatchFileSnapshot(file("resume-qa"));
  });
  it("startGoalPrompt goal", async () => {
    await expect(startGoalPrompt("goal", goal, "b", { verifyScope: "changed" })).toMatchFileSnapshot(file("goal"));
  });
  it("startGoalPrompt no_effort resume", async () => {
    await expect(startGoalPrompt("no_effort", goal, "b", { resume })).toMatchFileSnapshot(file("no-effort-resume"));
  });
  it("startProjectPrompt reverse", async () => {
    await expect(startProjectPrompt("reverse", project, "reverse-docs")).toMatchFileSnapshot(file("reverse"));
  });
  it("startScaffoldPrompt", async () => {
    await expect(startScaffoldPrompt(project, "scaffold-docs")).toMatchFileSnapshot(file("scaffold"));
  });
  it("startPrdPrompt dengan audit", async () => {
    await expect(startPrdPrompt(project, { title: "T", context: "c", outcome: "o", constraints: "k" }, "prd/t",
      { id: "SPEC-1", path: "internal/docs/research/audit-spec-1-x.md", content: "isi audit" }))
      .toMatchFileSnapshot(file("prd-audit"));
  });
  it("startBreakdownPrompt", async () => {
    await expect(startBreakdownPrompt(project, { title: "PRD", path: "docs/prd/p.md", content: "# PRD\nisi" }, "breakdown/p"))
      .toMatchFileSnapshot(file("breakdown"));
  });
});
