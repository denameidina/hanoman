import { describe, it, expect } from "vitest";
import { startPrompt, resumePrompt, continuePrompt, startGoalPrompt } from "./prompt";

const spec = { id: "SPEC-1", title: "T", source: "brief", priority: "tinggi", objective: "O" };
const attachments = {
  dir: "/repo/.worktrees/.attachments/spec-1",
  items: [
    { filename: "layar.png", mimeType: "image/png", size: 2048, path: "/repo/.worktrees/.attachments/spec-1/layar.png" },
    { filename: "error.log", mimeType: "text/plain", size: 4096, path: "/repo/.worktrees/.attachments/spec-1/error.log" },
  ],
};

describe("SPEC-843 · klausa lampiran di prompt sesi", () => {
  it("startPrompt menyebut path absolut tiap lampiran + manifest", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, attachments);
    expect(p).toContain("/repo/.worktrees/.attachments/spec-1/layar.png");
    expect(p).toContain("/repo/.worktrees/.attachments/spec-1/error.log");
    expect(p).toContain("/repo/.worktrees/.attachments/spec-1/INDEX.md");
  });

  it("menyuruh membaca ulang manifest di awal SETIAP fase", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, attachments);
    expect(p).toMatch(/AWAL SETIAP FASE/i);
  });

  it("tanpa lampiran prompt tak berubah sedikit pun", () => {
    const bare = startPrompt("feature", spec, "hanoman/spec-1");
    expect(startPrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, { dir: "/x", items: [] }))
      .toBe(bare);
    expect(bare).not.toContain("LAMPIRAN");
  });

  it("resume, continue, dan goal membawa klausa yang sama", () => {
    const resume = resumePrompt("feature", spec, "hanoman/spec-1",
      { recorded: ["Brainstorm done"], next: "Objective", worktreeKept: true },
      undefined, undefined, undefined, attachments);
    expect(resume).toContain("/repo/.worktrees/.attachments/spec-1/layar.png");

    const cont = continuePrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, attachments);
    expect(cont).toContain("/repo/.worktrees/.attachments/spec-1/error.log");

    const goal = startGoalPrompt("goal", { ...spec, source: "goal", payload: { goal: "G", done: "" } },
      "hanoman/spec-1", { attachments });
    expect(goal).toContain("/repo/.worktrees/.attachments/spec-1/layar.png");
  });
});
