import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS } from "@hanoman/shared";

// ADR-0164 · baris subagent di TUI claude memperlihatkan fase · model · effort. stdin
// `subagentStatusLine` tak membawa nama agen — `label` adalah deskripsi pemanggilan, dan
// orchestrator diwajibkan mengisinya `Fase <Nama Fase>`. Model & effort dibaca dari task itu
// sendiri (nilai yang benar-benar dipakai runtime), bukan dari roster.
// Fail-open: galat apa pun = tak ada keluaran = claude memakai baris bawaannya.
export const SUBAGENT_STATUSLINE_SCRIPT = [
  "const fs = require(\"node:fs\");",
  "const labelsPath = process.argv[2];",
  "let raw = \"\";",
  "process.stdin.setEncoding(\"utf8\");",
  "process.stdin.on(\"data\", (c) => { raw += c; });",
  "process.stdin.on(\"end\", () => {",
  "  try {",
  "    const labels = JSON.parse(fs.readFileSync(labelsPath, \"utf8\"));",
  "    const tasks = JSON.parse(raw).tasks || [];",
  "    const rows = [];",
  "    for (const t of tasks) {",
  "      if (!t || typeof t.id !== \"string\" || typeof t.model !== \"string\") continue;",
  "      const parts = [t.label || t.description || \"subagent\", labels[t.model] || t.model];",
  "      if (typeof t.effort === \"string\") parts.push(t.effort);",
  "      if (typeof t.startTime === \"number\") {",
  "        const s = Math.max(0, Math.round((Date.now() - t.startTime) / 1000));",
  "        parts.push(s >= 60 ? Math.floor(s / 60) + \"m\" + String(s % 60).padStart(2, \"0\") + \"s\" : s + \"s\");",
  "      }",
  "      if (typeof t.tokenCount === \"number\" && t.tokenCount > 0) parts.push(Math.round(t.tokenCount / 1000) + \"k tok\");",
  "      rows.push(JSON.stringify({ id: t.id, content: parts.join(\" · \") }));",
  "    }",
  "    if (rows.length) process.stdout.write(rows.join(\"\\n\") + \"\\n\");",
  "  } catch {}",
  "});",
].join("\n");

/** Tulis skrip + peta label model ke `dir` (temp dir sesi, di luar worktree) dan kembalikan command-nya. */
export function writeSubagentStatusline(dir: string): string {
  const script = join(dir, "subagent-statusline.cjs");
  const labels = join(dir, "subagent-models.json");
  writeFileSync(script, SUBAGENT_STATUSLINE_SCRIPT, { mode: 0o600 });
  // stdin membawa id TERPATOK yang dipakai runtime (`claude-opus-5`), sedangkan katalog berkunci alias
  // (`opus`) sejak 1a5a0981 — petakan keduanya.
  const entries = MODELS.flatMap((m) => [[m.id, m.label], ...(m.resolved ? [[m.resolved, m.label]] : [])]);
  writeFileSync(labels, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
  return `node ${JSON.stringify(script)} ${JSON.stringify(labels)}`;
}
