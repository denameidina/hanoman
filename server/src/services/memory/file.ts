// ADR-0179 · berkas memori sesi. Murni fs, TANPA DB: dipakai pty.ts, yang sengaja nol-DB (SPEC-362).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** claude: markdown untuk `--append-system-prompt-file`. codex: TOML literal untuk `-c` (spike 2026-10-07). */
export function writeMemoryFile(dir: string, agent: "claude" | "codex", text: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (agent === "claude") {
    const f = join(dir, "memory.md");
    writeFileSync(f, text, { mode: 0o600 });
    return f;
  }
  // String literal TOML tak punya escape: satu-satunya urutan terlarang adalah `'''`.
  const safe = text.replace(/'''/g, "'' '");
  const f = join(dir, "memory.toml");
  writeFileSync(f, `developer_instructions='''\n${safe}\n'''\n`, { mode: 0o600 });
  return f;
}
