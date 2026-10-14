import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, getSession, killSession, agentTempDir } from "../src/services/pty";

// Skills library · kontrak ARGV penyuntikan skill global. Diperiksa lewat argv pane tmux — pola
// custom-agents.pty.test.ts: bentuk respons bisa lulus palsu, argv pane tidak.

let cwd: string, home: string;
const prevHome = process.env.HANOMAN_HOME;
const ids: string[] = [];
const born = (id: string): string => { ids.push(id); return id; };
const paneCmd = (id: string): string =>
  execFileSync("tmux", [
    "-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman", "-f", "/dev/null",
    "list-panes", "-t", `hanoman-${id}`, "-F", "#{pane_start_command}",
  ], { encoding: "utf8" });

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "hnm-si-"));
  home = mkdtempSync(join(tmpdir(), "hnm-si-home-"));
  process.env.HANOMAN_HOME = home;
  vi.stubEnv("HOME", home);
  vi.stubEnv("HANOMAN_TMUX_SOCKET", `task4-si-${process.pid}`);
  const fake = join(home, "fake-agent");
  writeFileSync(fake, `#!${process.execPath}\nprocess.stdin.resume();\n`, { mode: 0o700 });
  vi.stubEnv("HANOMAN_CLAUDE_BIN", fake); vi.stubEnv("HANOMAN_ANTIGRAVITY_BIN", fake);
});
afterEach(() => {
  for (const id of ids.splice(0)) { try { killSession(id); } catch { /* sudah mati */ } }
  if (prevHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = prevHome;
  vi.unstubAllEnvs();
});

describe("createSession · skill global", () => {
  it("claude: --add-dir ke skills-root sesi berisi symlink skill global", () => {
    mkdirSync(join(home, "skills/bersama"), { recursive: true });
    writeFileSync(join(home, "skills/bersama/SKILL.md"), "---\nname: bersama\ndescription: d\n---\n");
    const s = createSession("p1", cwd, { id: born("si-claude-1"), agent: "claude", prompt: "halo" });
    const root = join(agentTempDir(s.id), "skills-root");
    // `--add-dir` variadik → harus argumen TERAKHIR (tak menelan argumen lain), path di-`sq`.
    expect(paneCmd(s.id).trimEnd()).toMatch(new RegExp(`--add-dir '${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'"?$`));
    expect(readlinkSync(join(root, ".claude/skills/bersama"))).toBe(join(home, "skills/bersama"));
  });
  it("tanpa skill global: argv tak memuat --add-dir", () => {
    const s = createSession("p1", cwd, { id: born("si-claude-2"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--add-dir");
  });
  it("Antigravity launch trusts actual cwd, injects workspace skills and cleans on kill", () => {
    execFileSync("git", ["init", "-q"], { cwd });
    mkdirSync(join(home, "skills/bersama"), { recursive: true });
    writeFileSync(join(home, "skills/bersama/SKILL.md"), "---\nname: bersama\ndescription: d\n---\n");
    const s = createSession("p1", cwd, { id: born("si-agy-1"), agent: "antigravity", prompt: "halo" });
    expect(JSON.parse(readFileSync(join(home, ".gemini/antigravity-cli/settings.json"), "utf8")).trustedWorkspaces).toContain(execFileSync("pwd", ["-P"], { cwd, encoding: "utf8" }).trim());
    expect(readlinkSync(join(cwd, ".agents/skills/bersama"))).toBe(join(home, "skills/bersama"));
    expect(paneCmd(s.id)).not.toContain("--add-dir");
    killSession(s.id); expect(existsSync(join(cwd, ".agents/skills/bersama"))).toBe(false);
  });
  it("trust preparation fails before pane/config side effects, raw command bypasses trust", () => {
    const config = join(home, ".gemini/antigravity-cli/settings.json");
    mkdirSync(join(home, ".gemini/antigravity-cli"), { recursive: true }); writeFileSync(config, "corrupt");
    expect(() => createSession("p1", cwd, { id: "si-agy-fail", agent: "antigravity" })).toThrow(expect.objectContaining({ statusCode: 500, code: "antigravity-config-failed", message: "Persiapan konfigurasi Antigravity CLI gagal; periksa konfigurasi lokal." }));
    expect(getSession("si-agy-fail")).toBeUndefined(); expect(existsSync(agentTempDir("si-agy-fail"))).toBe(false);
    const s = createSession("p1", cwd, { id: born("si-agy-shell"), agent: "antigravity", command: ["/bin/cat"] });
    expect(s.id).toBe("si-agy-shell"); expect(readFileSync(config, "utf8")).toBe("corrupt");
  });
});
