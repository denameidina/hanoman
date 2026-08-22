import { describe, it, expect } from "vitest";
import { guardSettings } from "../src/settings";

describe("guardSettings", () => {
  it("tanpa decisionFile: tak ada hook (guardrail dicabut, ADR-0037)", () => {
    expect(guardSettings().hooks).toEqual({});
  });
  // SPEC-898 · ADR-0141 · hook menulis STEMPEL, dan hanya bila marker masih kosong. `echo waiting >>`
  // yang lama mencap ulang mtime tiap notifikasi idle, jadi umur "menunggu" tak pernah tumbuh.
  it("Notification menulis epoch sekali saja; marker terisi tak ditimpa", () => {
    const cmd = (guardSettings("/tmp/dec") as any).hooks.Notification[0].hooks[0].command as string;
    expect(cmd).toContain("[ -s '/tmp/dec' ]");
    expect(cmd).toContain("date +%s > '/tmp/dec'");
    expect(cmd).not.toContain("echo waiting");
  });
  it("UserPromptSubmit tetap mengosongkan marker (episode berikutnya dapat stempel baru)", () => {
    const cmd = (guardSettings("/tmp/dec") as any).hooks.UserPromptSubmit[0].hooks[0].command as string;
    expect(cmd).toBe(": > '/tmp/dec'");
  });

  it("dengan decisionFile: Notification + UserPromptSubmit menunjuk berkasnya", () => {
    const s = guardSettings("/repo/.worktrees/.decisions/sess1") as any;
    expect(Object.keys(s.hooks).sort()).toEqual(["Notification", "UserPromptSubmit"]);
    expect(s.hooks.Notification[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.Notification[0].hooks[0].command).toMatch(/grep/);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
  });

  // SPEC-332 · ADR-0073 · mode goal: Stop hook bertipe `prompt` — mesin yang sama dipasang `/goal`.
  it("tanpa goal: tak ada hook Stop sama sekali", () => {
    const s = guardSettings("/tmp/dec") as any;
    expect(s.hooks.Stop).toBeUndefined();
    expect(s.hooks.Notification).toBeDefined();      // marker keputusan SPEC-184 tetap
    expect(s.hooks.UserPromptSubmit).toBeDefined();
  });
  it("dengan goal: Stop hook bertipe prompt berisi kondisinya", () => {
    const s = guardSettings("/tmp/dec", "berhenti hanya bila X") as any;
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: "prompt", prompt: "berhenti hanya bila X" }] }]);
    expect(s.hooks.Notification).toBeDefined();      // tak merusak hook yang sudah ada
  });
  it("goal boleh berdiri tanpa decisionFile", () => {
    const s = guardSettings(undefined, "kondisi") as any;
    expect(s.hooks.Stop[0].hooks[0].prompt).toBe("kondisi");
    expect(s.hooks.Notification).toBeUndefined();
  });
  it("goal kosong tidak memasang hook", () => {
    expect((guardSettings("/tmp/dec", "") as any).hooks.Stop).toBeUndefined();
  });
});
