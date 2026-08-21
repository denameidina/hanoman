import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, killSession, registerCustomAgentSource, agentsFilePath, promptFilePath,
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
});
afterAll(() => { registerCustomAgentSource(() => []); });

/** argv pane tmux — satu-satunya bukti yang tak bisa lulus palsu. */
const paneCmd = (id: string): string =>
  execFileSync("tmux", [
    "-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman", "-f", "/dev/null",
    "list-panes", "-t", `hanoman-${id}`, "-F", "#{pane_start_command}",
  ], { encoding: "utf8" });

describe("createSession · claude", () => {
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
  it("TIDAK memasang --agents, tapi menempelkan roster ke prompt", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-codex-1"), agent: "codex", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt.startsWith("halo")).toBe(true);
    expect(prompt).toContain("@rev");
    expect(prompt).toContain("kamu peninjau");
  });

  it("tanpa custom agent, prompt codex byte-identik dengan sebelumnya", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-codex-2"), agent: "codex", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
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
  it("sumber menerima agen sesi sebagai argumen KEDUA", () => {
    const seen: string[] = [];
    registerCustomAgentSource((_p, agent) => { seen.push(agent); return []; });
    createSession("p1", cwd, { id: born("ca-rt-1"), agent: "codex", prompt: "halo" });
    expect(seen).toContain("codex");
  });

  it("agen yang lolos saring untuk claude masuk --agents", () => {
    registerCustomAgentSource((_p, agent) =>
      agent === "claude"
        ? [{ name: "cl", description: "d", instructions: "i", tools: null, model: null, mentions: [] }]
        : []);
    const s = createSession("p1", cwd, { id: born("ca-rt-2"), agent: "claude", prompt: "halo" });
    expect(existsSync(agentsFilePath(s.id))).toBe(true);
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toContain('"cl"');
  });

  it("katalog kosong untuk agen itu → --agents TIDAK dipasang sama sekali", () => {
    registerCustomAgentSource((_p, agent) =>
      agent === "codex"
        ? [{ name: "cx", description: "d", instructions: "i", tools: null, model: null, mentions: [] }]
        : []);
    const s = createSession("p1", cwd, { id: born("ca-rt-3"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });

  // Penyaring wajib mengenai KEDUA permukaan materialisasi — roster codex punya jalur sendiri
  // (prompt, bukan argv), jadi menyaring hanya di jalur claude meninggalkan separuh bug.
  it("roster codex hanya memuat agen yang lolos saring untuk codex", () => {
    registerCustomAgentSource((_p, agent) =>
      agent === "codex"
        ? [{ name: "cx", description: "d", instructions: "khusus codex", tools: null, model: null, mentions: [] }]
        : [{ name: "cl", description: "d", instructions: "khusus claude", tools: null, model: null, mentions: [] }]);
    const s = createSession("p1", cwd, { id: born("ca-rt-4"), agent: "codex", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("@cx");
    expect(prompt).not.toContain("@cl");
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
    expect(prompt).toContain("- **rev** — tinjau");
    expect(prompt).toContain("- **tes** — uji");
  });

  // Invarian ADR-0094: katalog kosong → prompt byte-identik dengan sebelum fitur ini.
  it("sesi claude tanpa custom agent menerima prompt byte-identik", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-klausa-2"), agent: "claude", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });

  // Codex mengadopsi peran INLINE lewat roster (ADR-0094 keputusan 4) — ia tak punya subagent untuk
  // didelegasi, jadi klausa claude di sana akan menyuruhnya memanggil yang tak ada.
  it("sesi codex tetap menerima roster, bukan klausa", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-klausa-3"), agent: "codex", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("## Custom agent hanoman");
    expect(prompt).not.toContain("## Subagent yang tersedia");
  });
});
