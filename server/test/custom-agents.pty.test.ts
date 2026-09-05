import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, getSession, killSession, registerCustomAgentSource, agentsFilePath, promptFilePath,
  agentTempDir, registerCodexNativeAgentSupport, sessionEventDir,
} from "../src/services/pty";
import type { AgentDef } from "@hanoman/runner";

// SPEC-450 · ADR-0094 keputusan 7 · kontrak ARGV. Diperiksa lewat argv pane tmux + isi berkas,
// BUKAN lewat bentuk respons — assert bentuk respons LULUS PALSU (pelajaran `sessionModel()`).

const defs: AgentDef[] = [
  { name: "rev", description: "tinjau", instructions: "kamu peninjau", tools: null, model: null, mentions: ["tes"] },
  { name: "tes", description: "uji", instructions: "kamu penguji", tools: null, model: null, mentions: [] },
];

let cwd: string;
const ids: string[] = [];
const born = (id: string): string => { ids.push(id); return id; };

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "hnm-ca-")); });
afterEach(() => {
  for (const id of ids.splice(0)) { try { killSession(id); } catch { /* sudah mati */ } }
  registerCustomAgentSource(() => []);
  registerCodexNativeAgentSupport(() => ({ version: "0.151.0", ok: true }));
});
afterAll(() => {
  registerCustomAgentSource(() => []);
  registerCodexNativeAgentSupport(() => ({ version: "0.151.0", ok: true }));
});

/** argv pane tmux — satu-satunya bukti yang tak bisa lulus palsu. */
const paneCmd = (id: string): string =>
  execFileSync("tmux", [
    "-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman", "-f", "/dev/null",
    "list-panes", "-t", `hanoman-${id}`, "-F", "#{pane_start_command}",
  ], { encoding: "utf8" });

describe("createSession · claude", () => {
  it("snapshots the inherited session model in the invocation roster", () => {
    registerCustomAgentSource(() => defs);
    const a = createSession("p1", cwd, {
      id: born("ca-inherit-a"), agent: "claude", prompt: "halo", model: "sonnet",
    });
    const b = createSession("p1", cwd, {
      id: born("ca-inherit-b"), agent: "claude", prompt: "halo", model: "opus",
    });
    expect(getSession(a.id)!.agentRoster![0]!.model).toBe("sonnet");
    expect(getSession(b.id)!.agentRoster![0]!.model).toBe("opus");
    expect(getSession(a.id)!.agentRoster![0]!.definitionHash)
      .not.toBe(getSession(b.id)!.agentRoster![0]!.definitionHash);
  });
  it("memasang --agents dari BERKAS, bukan JSON inline (tmux membatasi satu command ~16 KB)", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-1"), agent: "claude", prompt: "halo" });
    const cmd = paneCmd(s.id);
    expect(cmd).toContain("--agents");
    // Command substitution harus UTUH: `sh -c` yang melahirkan sesi yang meng-expand-nya.
    // (tmux meng-escape `"` di `#{pane_start_command}`, jadi yang dibandingkan bagian dalamnya.)
    expect(cmd).toContain(`$(cat '${agentsFilePath(s.id)}')`);
    expect(cmd).not.toContain('"description"'); // JSON tak pernah inline di command tmux
  });

  it("GOTCHA ADR-0094 #4 · --agents TIDAK boleh ikut ter-`sq` seperti flag lain", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-sq"), agent: "claude", prompt: "halo" });
    const cmd = paneCmd(s.id);
    // Di-`sq` sekali saja, claude menerima literal `$(cat /tmp/…)` sebagai definisi agen — dan
    // JSON tak sah DIABAIKAN tanpa pesan, exit 0, NOL agen (kegagalan-senyap M3).
    expect(cmd).not.toContain("'--agents'");
    expect(cmd).not.toContain(`'--agents "$(cat`);
  });

  it("berkasnya berisi JSON yang benar, dan agen daun TIDAK punya Task", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-2"), agent: "claude", prompt: "halo" });
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(Object.keys(j).sort()).toEqual(["rev", "tes"]);
    expect(j.rev.tools).toContain("Task");
    expect(j.tes.tools).not.toContain("Task");
  });

  it("memasang hook hard read-only dan membuang tool mutasi dari agen read-only", () => {
    registerCustomAgentSource(() => [{
      ...defs[0]!, workspacePolicy: "read-only", tools: ["Read", "Write", "Bash"],
    }]);
    const s = createSession("p1", cwd, { id: born("ca-claude-ro"), agent: "claude", prompt: "halo" });
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(j.rev.tools).toEqual(["Read", "Bash"]);
    expect(j.rev.permissionMode).toBe("plan");
    expect(j.rev.hooks.PreToolUse[0].hooks[0].command).toContain("custom-agent-readonly.cjs");
  });

  it("tanpa custom agent, argv TIDAK memuat --agents dan berkasnya tak dibuat", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-claude-3"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });

  // SPEC-881 · ADR-0136 · dipersempit dengan sengaja. Dulu berbunyi `toBe("halo")`; sejak spec ini
  // claude menerima KLAUSA delegasi pendek di prompt-nya. Yang tetap dijaga di sini adalah maksud
  // asli test-nya: blok roster codex — nama, deskripsi, DAN seluruh prosa instruksi tiap agen —
  // tak pernah bocor ke jalur claude, yang memang menerima definisinya native lewat `--agents`.
  it("prompt claude TIDAK ditempeli roster codex (claude memakai jalur native)", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-4"), agent: "claude", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("halo");
    expect(prompt).not.toContain("## Custom agent hanoman");
    expect(prompt).not.toContain("kamu peninjau");   // instruksi agen, hanya ada di roster codex
  });
});

describe("createSession · codex", () => {
  it("warns and omits native registry on an unsupported client, without inline fallback", () => {
    registerCustomAgentSource(() => defs);
    registerCodexNativeAgentSupport(() => ({ version: "0.150.0", ok: false }));
    const writes: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk)); return true;
    }) as typeof process.stderr.write;
    try {
      const s = createSession("p1", cwd, {
        id: born("ca-codex-old"), agent: "codex", prompt: "halo",
      });
      const cmd = paneCmd(s.id);
      expect(cmd).not.toContain("agents.enabled=true");
      expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
      expect(getSession(s.id)?.agentRoster).toEqual([]);
      expect(writes.join("")).toMatch(/0\.151\.0/);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("memasang registry subagent native dan hanya klausa delegasi ringkas di prompt", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-codex-1"), agent: "codex", prompt: "halo" });
    const cmd = paneCmd(s.id);
    expect(cmd).not.toContain("--agents");
    expect(cmd).toContain('agents.\\"rev\\".description');
    expect(cmd).toContain('agents.\\"rev\\".config_file');
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt.startsWith("halo")).toBe(true);
    expect(prompt).toContain("spawn_agent");
    expect(prompt).toContain("**rev**");
    expect(prompt).not.toContain("kamu peninjau");
    expect(existsSync(join(agentTempDir(s.id), "00-rev.toml"))).toBe(true);
    expect(getSession(s.id)?.agentRoster).toEqual([
      { name: "rev", definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { name: "tes", definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
  });

  it("memasang sandbox, hook, dan trust satu-sesi untuk agen read-only", () => {
    registerCustomAgentSource(() => [{ ...defs[0]!, workspacePolicy: "read-only" }]);
    const s = createSession("p1", cwd, { id: born("ca-codex-ro"), agent: "codex", prompt: "halo" });
    const cmd = paneCmd(s.id);
    const toml = readFileSync(join(agentTempDir(s.id), "00-rev.toml"), "utf8");
    expect(cmd.match(/--dangerously-bypass-hook-trust/g)).toHaveLength(1);
    expect(toml).toContain('sandbox_mode = "read-only"');
    expect(toml).toContain("[[hooks.PreToolUse]]");
  });

  it("tanpa custom agent, prompt codex byte-identik dengan sebelumnya", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-codex-2"), agent: "codex", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });

  it("mounts native configs and hook read-only into the production sandbox", () => {
    const keys = [
      "HANOMAN_SESSION_SANDBOX", "HANOMAN_AGENT_CREDENTIAL_DIR", "HANOMAN_EGRESS_PROXY",
      "HANOMAN_SESSION_IMAGE", "HANOMAN_SESSION_NETWORK",
    ] as const;
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_AGENT_CREDENTIAL_DIR: "/srv/hanoman/credentials",
      HANOMAN_EGRESS_PROXY: "http://egress.internal:3128",
      HANOMAN_SESSION_IMAGE: "hanoman-agent:test",
      HANOMAN_SESSION_NETWORK: "hanoman-egress",
    });
    try {
      registerCustomAgentSource(() => [{ ...defs[0]!, workspacePolicy: "read-only" }]);
      const s = createSession("p1", cwd, {
        id: born("ca-codex-sandbox"), agent: "codex", prompt: "halo",
      });
      expect(paneCmd(s.id)).toContain(
        `${agentTempDir(s.id)}:${agentTempDir(s.id)}:ro`,
      );
      expect(paneCmd(s.id)).toContain(
        `${sessionEventDir(s.id)}:${sessionEventDir(s.id)}:rw`,
      );
      expect(getSession(s.id)?.eventHook).toBe(true);
    } finally {
      for (const key of keys) {
        const value = before[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("sesi shell mentah (opts.command)", () => {
  it("tak menerima apa pun — tak ada agen di sana", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-shell-1"), command: ["/bin/sh", "-c", "sleep 30"] });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });
});

describe("sumber yang melempar", () => {
  it("tak menggagalkan kelahiran sesi (katalog agen opsional)", () => {
    registerCustomAgentSource(() => { throw new Error("DB mati"); });
    const s = createSession("p1", cwd, { id: born("ca-throw-1"), agent: "claude", prompt: "halo" });
    expect(s.id).toBe("ca-throw-1");
    expect(paneCmd(s.id)).not.toContain("--agents");
  });
});

// SPEC-484 · ADR-0101 keputusan 2 · `runtime` adalah PENYARING: ia menyaring apa yang masuk
// roster sesi, bukan proses mana yang dijalankan. Diperiksa lewat argv & isi berkas, bukan
// bentuk respons (pelajaran `sessionModel()`).
describe("penyaring runtime (SPEC-484 · ADR-0101)", () => {
  it("sumber menerima seluruh konteks sesi dan changed files satu kali", () => {
    execFileSync("git", ["init", "-q"], { cwd });
    writeFileSync(join(cwd, "package.json"), "{}\n");
    const seen: string[] = [];
    registerCustomAgentSource((context) => {
      seen.push(context.projectId, context.runtime, context.flow ?? "", context.cwd,
        context.prompt ?? "", ...context.changedFiles);
      return [];
    });
    createSession("p1", cwd, {
      id: born("ca-rt-1"), agent: "codex", flow: "feature", prompt: "halo",
    });
    expect(seen).toEqual(["p1", "codex", "feature", cwd, "halo", "package.json"]);
  });

  it("agen yang lolos saring untuk claude masuk --agents", () => {
    registerCustomAgentSource((context) =>
      context.runtime === "claude"
        ? [{ name: "cl", description: "d", instructions: "i", tools: null, model: null, mentions: [] }]
        : []);
    const s = createSession("p1", cwd, { id: born("ca-rt-2"), agent: "claude", prompt: "halo" });
    expect(existsSync(agentsFilePath(s.id))).toBe(true);
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toContain('"cl"');
  });

  it("katalog kosong untuk agen itu → --agents TIDAK dipasang sama sekali", () => {
    registerCustomAgentSource((context) =>
      context.runtime === "codex"
        ? [{ name: "cx", description: "d", instructions: "i", tools: null, model: null, mentions: [] }]
        : []);
    const s = createSession("p1", cwd, { id: born("ca-rt-3"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });

  it("registry codex hanya memuat agen yang lolos saring untuk codex", () => {
    registerCustomAgentSource((context) =>
      context.runtime === "codex"
        ? [{ name: "cx", description: "d", instructions: "khusus codex", tools: null, model: null, mentions: [] }]
        : [{ name: "cl", description: "d", instructions: "khusus claude", tools: null, model: null, mentions: [] }]);
    const s = createSession("p1", cwd, { id: born("ca-rt-4"), agent: "codex", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    const cmd = paneCmd(s.id);
    expect(cmd).toContain('agents.\\"cx\\".config_file');
    expect(cmd).not.toContain('agents.\\"cl\\".config_file');
    expect(prompt).toContain("**cx**");
    expect(prompt).not.toContain("**cl**");
  });
});

// SPEC-881 · ADR-0136 · klausa delegasi. Diperiksa lewat ISI BERKAS PROMPT, bukan bentuk respons —
// alasan yang sama dengan kontrak argv di atas.
describe("klausa delegasi di prompt", () => {
  it("sesi claude menerima klausa yang menyebut agen di roster", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-klausa-1"), agent: "claude", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("## Subagent yang tersedia");
    expect(prompt).toContain("- **rev** (always) — tinjau");
    expect(prompt).toContain("- **tes** (always) — uji");
  });

  // Invarian ADR-0094: katalog kosong → prompt byte-identik dengan sebelum fitur ini.
  it("sesi claude tanpa custom agent menerima prompt byte-identik", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-klausa-2"), agent: "claude", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });

  it("sesi codex menerima klausa subagent native, bukan roster inline lama", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-klausa-3"), agent: "codex", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("## Subagent yang tersedia");
    expect(prompt).toContain("spawn_agent");
    expect(prompt).not.toContain("## Custom agent hanoman");
  });
});

describe("lifecycle materialisasi", () => {
  it("menghapus direktori agen milik sesi yang ditutup", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-cleanup"), agent: "codex", prompt: "halo" });
    expect(existsSync(agentTempDir(s.id))).toBe(true);
    expect(killSession(s.id)).toBe(true);
    ids.splice(ids.indexOf(s.id), 1);
    expect(existsSync(agentTempDir(s.id))).toBe(false);
  });
});
