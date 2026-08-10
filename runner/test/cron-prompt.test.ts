import { describe, it, expect } from "vitest";
import { cronPrompt } from "../src/prompt";
import { CODE_STYLE_CLAUSE } from "../src/code-style";

const project = { id: "p1", name: "Nafanesia", desc: "CRM", stack: "TS" };

describe("cronPrompt", () => {
  it("memuat instruksi operator APA ADANYA", () => {
    const p = cronPrompt(project, { name: "Cek pagi", prompt: "Periksa error produksi 24 jam terakhir." });
    expect(p).toContain("Periksa error produksi 24 jam terakhir.");
  });
  it("menyebut nama cron dan project", () => {
    const p = cronPrompt(project, { name: "Cek pagi", prompt: "x" });
    expect(p).toContain("Cek pagi");
    expect(p).toContain("p1");
  });
  it("mengarahkan temuan ke backlog lewat POST /api/specs", () => {
    const p = cronPrompt(project, { name: "c", prompt: "x" });
    expect(p).toContain("POST /api/specs");
  });
  it("membawa klausa gaya kode (ADR-0108)", () => {
    expect(cronPrompt(project, { name: "c", prompt: "x" })).toContain(CODE_STYLE_CLAUSE);
  });
  it("menyebut worktree detached supaya agen tak bingung", () => {
    expect(cronPrompt(project, { name: "c", prompt: "x" })).toContain("detached HEAD");
  });
});
