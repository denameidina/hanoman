import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
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

describe("guardSettings · subagentStatusLine (ADR-0164)", () => {
  it("tanpa command: bentuk lama persis — hanya kunci hooks", () => {
    expect(Object.keys(guardSettings("/m", undefined, true))).toEqual(["hooks"]);
  });
  it("dengan command: kunci subagentStatusLine bertipe command", () => {
    expect(guardSettings(undefined, undefined, true, 'node "/t/s.cjs" "/t/m.json"').subagentStatusLine)
      .toEqual({ type: "command", command: 'node "/t/s.cjs" "/t/m.json"' });
  });

  // T3 · audit 2026-09-23 (claude 2.1.280), diukur di tmux terpisah dengan hook perekam: penghitung
  // baris lama (`echo 1 >>` di SubagentStart, `sed '$d'` di SubagentStop) turun ke 0 saat subagent
  // fase MASIH bekerja, karena (c) SubagentStop "hantu" ber-`agent_type` kosong tanpa SubagentStart
  // menembak ±5 dtk sesudah tiap Stop orchestrator; dan (a) notifikasi selesainya task latar tiba
  // sebagai UserPromptSubmit `<task-notification>` yang ikut mengosongkannya. Notification idle
  // 60 dtk kemudian lalu mengisi marker → pil "Menunggu keputusan" palsu. Urutan payload di bawah
  // adalah urutan yang terekam (dipangkas ke field yang dibaca hook).
  const replay = (f: string, goal?: string) => {
    const h = guardSettings(f, goal, true).hooks as Record<string, any[]>;
    return (event: string, payload: Record<string, unknown>) => {
      for (const group of h[event] ?? []) {
        for (const hook of group.hooks) {
          if (hook.type !== "command" || hook.command === EVENT_HOOK_COMMAND) continue;
          try {
            execFileSync("sh", ["-c", hook.command], { input: JSON.stringify({ hook_event_name: event, ...payload }) });
          } catch { /* exit != 0 */ }
        }
      }
    };
  };
  const idle = { message: "Claude is waiting for your input", notification_type: "idle_prompt" };
  const running = (...ids: string[]) => ({
    background_tasks: ids.map((id) => ({ id, type: "subagent", status: "running", description: "Fase", agent_type: "hanoman-fase-plan" })),
  });

  it("T3 · subagent latar masih jalan: SubagentStop hantu & task-notification tak membuat idle menandai", () => {
    const f = join(mkdtempSync(join(tmpdir(), "dec-")), "s1");
    const fire = replay(f);
    fire("UserPromptSubmit", { prompt: "mulai" });
    fire("SubagentStart", { agent_id: "a6399a31", agent_type: "hanoman-fase-plan" });
    fire("Stop", { stop_hook_active: false, ...running("a6399a31") });
    fire("SubagentStop", { agent_id: "a6b18ac5", agent_type: "", ...running("a6399a31") }); // hantu
    fire("Notification", idle);
    expect(existsSync(f) ? readFileSync(f, "utf8") : "").toBe("");
    // izin/needs-input tetap menandai walau subagent jalan
    fire("Notification", { message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" });
    expect(readFileSync(f, "utf8").length).toBeGreaterThan(0);
  });

  it("T3 · dua subagent paralel: task-notification yang pertama tak mengosongkan yang kedua", () => {
    const f = join(mkdtempSync(join(tmpdir(), "dec-")), "s1");
    const fire = replay(f);
    fire("UserPromptSubmit", { prompt: "mulai" });
    fire("Stop", running("A", "B"));
    fire("SubagentStop", { agent_id: "A", agent_type: "hanoman-fase-plan", ...running("A", "B") });
    fire("UserPromptSubmit", { prompt: "<task-notification>\n<task-id>A</task-id>" });
    fire("Stop", running("B"));
    fire("Notification", idle);
    expect(existsSync(f) ? readFileSync(f, "utf8") : "").toBe("");
  });

  it("T3 · semua subagent selesai: idle kembali menandai", () => {
    const f = join(mkdtempSync(join(tmpdir(), "dec-")), "s1");
    const fire = replay(f);
    fire("Stop", running("A"));
    fire("SubagentStop", { agent_id: "A", agent_type: "hanoman-fase-plan", ...running("A") });
    fire("UserPromptSubmit", { prompt: "<task-notification>\n<task-id>A</task-id>" });
    fire("Stop", { background_tasks: [] });
    fire("Notification", idle);
    expect(readFileSync(f, "utf8")).toMatch(/^\d+\n$/);
  });

  it("T3 · task latar non-subagent (shell) tak menahan idle; payload rusak gagal-terbuka", () => {
    const f = join(mkdtempSync(join(tmpdir(), "dec-")), "s1");
    const fire = replay(f);
    fire("Stop", { background_tasks: [{ id: "b1", type: "shell", status: "running" }] });
    fire("Notification", idle);
    expect(readFileSync(f, "utf8").length).toBeGreaterThan(0);
    const g = join(mkdtempSync(join(tmpdir(), "dec-")), "s2");
    const h = guardSettings(g, undefined, true).hooks as Record<string, any[]>;
    execFileSync("sh", ["-c", h.Stop![0].hooks[0].command], { input: "bukan json" });
    replay(g)("Notification", idle);
    expect(readFileSync(g, "utf8").length).toBeGreaterThan(0);
  });

  it("T3 · Stop snapshot hidup berdampingan dengan Stop hook mode goal", () => {
    const h = guardSettings("/w/.decisions/s1", "kondisi goal", true).hooks as Record<string, any[]>;
    expect(h.Stop).toHaveLength(2);
    expect(h.Stop![1]).toEqual({ hooks: [{ type: "prompt", prompt: "kondisi goal" }] });
    expect(h.Stop![0].hooks[0].command).toContain("background_tasks");
  });
});
