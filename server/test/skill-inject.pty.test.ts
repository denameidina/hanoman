import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, killSession, agentTempDir } from "../src/services/pty";

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
});
afterEach(() => {
  for (const id of ids.splice(0)) { try { killSession(id); } catch { /* sudah mati */ } }
  if (prevHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = prevHome;
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
});
