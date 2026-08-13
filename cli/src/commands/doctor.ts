// SPEC-398 · ADR-0087 · `hanoman doctor` melaporkan prasyarat yang TIDAK bisa dibawa npm: git,
// tmux, dan CLI agen. Menyembunyikannya akan membuat kegagalan muncul jauh nanti, di dalam pane
// tmux yang tak dibaca siapa pun. Keputusannya murni (probes → laporan) supaya bisa dites.
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveHome, resolveDbUrl, dbFilePath, dbUrlNotice, scanAgentSkills } from "@hanoman/runner";
import { DEFAULT_METHOD, METHODS, methodStatus, zAgent, type MethodSkillStatus } from "@hanoman/shared";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir } from "./start";

export type Probes = {
  node: string; git: string | null; tmux: string | null;
  claude: string | null; codex: string | null;
  gh: string | null;   // SPEC-471 · opsional: tanpa gh, tarik issue lewat REST + GITHUB_TOKEN
  homeWritable: boolean; web: boolean; db: string;
  // SPEC-739 · ADR-0114 · kesiapan metode DEFAULT untuk tiap agen yang CLI-nya benar-benar ada.
  // Kosong = tak ada yang dilaporkan (mis. tak ada CLI agen sama sekali).
  methods: MethodSkillStatus[];
};

export function doctorReport(p: Probes): { lines: string[]; ok: boolean } {
  const major = Number(/^v?(\d+)/.exec(p.node)?.[1] ?? 0);
  const rows: Array<{ mark: string; text: string; fatal: boolean }> = [
    { mark: major >= 20 ? "✓" : "✗", text: `node ${p.node} (butuh ≥ 20)`, fatal: major < 20 },
    { mark: p.git ? "✓" : "✗", text: p.git ?? "git — TAK ADA (wajib: worktree per sesi)", fatal: !p.git },
    { mark: p.tmux ? "✓" : "✗", text: p.tmux ?? "tmux — TAK ADA (wajib: sesi agen hidup di tmux)", fatal: !p.tmux },
    { mark: p.claude ? "✓" : "·", text: p.claude ? `claude ${p.claude}` : "claude — tak ada", fatal: false },
    { mark: p.codex ? "✓" : "·", text: p.codex ? `codex ${p.codex}` : "codex — tak ada", fatal: false },
    // SPEC-471 · ADR-0095 · `gh` opsional: tanpa dia tarik issue jatuh ke HTTPS + GITHUB_TOKEN.
    { mark: p.gh ? "✓" : "·",
      text: p.gh ? `gh ${p.gh}` : "gh — tak ada (tarik issue akan lewat HTTP + GITHUB_TOKEN)",
      fatal: false },
    { mark: p.homeWritable ? "✓" : "✗", text: `data dir ${p.homeWritable ? "bisa ditulis" : "TAK bisa ditulis"}`, fatal: !p.homeWritable },
    { mark: p.web ? "✓" : "!", text: p.web ? "aset dashboard ada" : "aset dashboard tak ada — API jalan, dashboard tidak", fatal: false },
    { mark: "·", text: `db ${p.db}`, fatal: false },
  ];
  // SPEC-739 · ADR-0114 · NON-FATAL, sejajar dengan cara aset dashboard yang hilang dilaporkan:
  // skill yang kurang tak mematikan sesi, ia hanya menghapus gerbang yang disebut prompt.
  for (const m of p.methods) {
    const agent = m.agent === "codex" ? "Codex CLI" : "Claude Code";
    rows.push({
      mark: m.ready ? "✓" : "!",
      text: m.ready
        ? `metode ${m.method} · ${agent} — siap`
        : `metode ${m.method} · ${agent} — belum siap: `
          + [...m.missingPackages, ...m.missingSkills].join(", ")
          + m.install.map((c) => `\n      ${c}`).join(""),
      fatal: false,
    });
  }
  if (!p.claude && !p.codex) {
    rows.push({ mark: "✗", text: "tak ada CLI agen (claude ATAU codex wajib ada)", fatal: true });
  }
  return { lines: rows.map((r) => `  ${r.mark} ${r.text}`), ok: !rows.some((r) => r.fatal) };
}

function version(bin: string, args: string[]): string | null {
  try { return execFileSync(bin, args, { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] ?? null; }
  catch { return null; }
}

export default async function doctor(_argv: string[], ctx: Ctx): Promise<number> {
  let layout: ReturnType<typeof resolveLayout>;
  let db: string;
  try {
    layout = resolveLayout(distDir(), existsSync);
    db = dbFilePath(resolveDbUrl(ctx.env, dirname(layout.schema)));
  } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }

  const home = resolveHome(ctx.env);
  let homeWritable = false;
  try { accessSync(existsSync(home) ? home : dirname(home), constants.W_OK); homeWritable = true; }
  catch { /* tetap false */ }

  const claude = version(ctx.env.HANOMAN_CLAUDE_BIN ?? "claude", ["--version"]);
  const codex = version(ctx.env.HANOMAN_CODEX_BIN ?? "codex", ["--version"]);
  // SPEC-739 · ADR-0114 · hanya agen yang CLI-nya ADA yang dilaporkan: kesiapan metode codex di
  // mesin tanpa codex cuma derau. Metode DEFAULT saja — itu yang dipakai sesi tanpa pilihan.
  const method = METHODS[DEFAULT_METHOD]!;
  const methods = zAgent.options
    .filter((a) => (a === "codex" ? codex : claude) !== null)
    .map((a) => {
      const s = scanAgentSkills(a, ctx.env);
      return methodStatus(method, a, { skills: s.skills.map((k) => k.id), packages: s.packages });
    });

  const r = doctorReport({
    node: process.version,
    git: version("git", ["--version"]),
    tmux: version("tmux", ["-V"]),
    claude, codex,
    gh: version(ctx.env.HANOMAN_GH_BIN ?? "gh", ["--version"]),
    homeWritable, web: layout.web !== null, db, methods,
  });
  ctx.stdout(`hanoman doctor\n${r.lines.join("\n")}\n`);
  // Justru di doctor ini paling berguna: ia menjelaskan kenapa `db …` menunjuk berkas default
  // padahal env punya DATABASE_URL yang lain.
  const notice = dbUrlNotice(ctx.env);
  if (notice) ctx.stdout(`\n${notice}\n`);
  if (!r.ok) ctx.stderr("\nada prasyarat yang belum terpenuhi — hanoman tak akan bisa menjalankan sesi\n");
  return r.ok ? 0 : 1;
}
