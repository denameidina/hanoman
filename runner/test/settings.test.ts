import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardSettings, EVENT_HOOK_COMMAND } from "../src/settings";

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

// SPEC-909 · ADR-0146 · hook pengirim event. Pintu deteksi lead tak lagi memindai; ia menunggu ini.
describe("SPEC-909 · hook pengirim event", () => {
  it("memasang PreToolUse ber-matcher AskUserQuestion", () => {
    const h = guardSettings("/w/.decisions/s1", undefined, true).hooks as Record<string, any[] | undefined>;
    expect(h.PreToolUse).toHaveLength(1);
    expect(h.PreToolUse![0].matcher).toBe("AskUserQuestion");
    expect(h.PreToolUse![0].hooks[0]).toEqual({ type: "command", command: EVENT_HOOK_COMMAND });
    expect(h.SubagentStart![0].hooks[0]).toEqual({ type: "command", command: EVENT_HOOK_COMMAND });
    expect(h.SubagentStop![0].hooks[0]).toEqual({ type: "command", command: EVENT_HOOK_COMMAND });
  });

  it("SELALU exit 0 — PreToolUse berkode 2 memblokir tool-nya", () => {
    expect(EVENT_HOOK_COMMAND.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("membuang stdout — keluaran hook command dibaca claude sebagai kendali izin", () => {
    expect(EVENT_HOOK_COMMAND).toContain(">/dev/null 2>&1");
  });

  it("membatasi tunggu supaya server mati tak menggantungkan agen", () => {
    expect(EVENT_HOOK_COMMAND).toContain("-m 2");
  });

  it("menulis satu payload atomik ke spool saat berjalan di sandbox", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-event-hook-"));
    const payload = JSON.stringify({ hook_event_name: "SubagentStart", agent_id: "sub-1" });
    execFileSync("/bin/sh", ["-c", EVENT_HOOK_COMMAND], {
      input: payload, env: { ...process.env, HANOMAN_EVENT_DIR: dir },
    });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, files[0]!), "utf8")).toBe(payload);
  });

  it("tanpa eventHook, settings byte-identik seperti sebelum SPEC-909", () => {
    expect(guardSettings("/w/.decisions/s1")).toEqual(guardSettings("/w/.decisions/s1", undefined, false));
    expect((guardSettings("/w/.decisions/s1").hooks as Record<string, unknown>).PreToolUse).toBeUndefined();
  });

  it("penulis & pengosong marker TIDAK berubah (ADR-0141/0143)", () => {
    const h = guardSettings("/w/.decisions/s1", undefined, true).hooks as Record<string, any[] | undefined>;
    expect(h.Notification![0].hooks[0].command).toContain("date +%s >");
    expect(h.UserPromptSubmit![0].hooks[0].command).toContain(": >");
  });
});
