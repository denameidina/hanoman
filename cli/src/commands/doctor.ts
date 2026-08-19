// SPEC-398 · ADR-0087 · `hanoman doctor` melaporkan prasyarat yang TIDAK bisa dibawa npm: git,
// tmux, dan CLI agen. Menyembunyikannya akan membuat kegagalan muncul jauh nanti, di dalam pane
// tmux yang tak dibaca siapa pun. Keputusannya murni (probes → laporan) supaya bisa dites.
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveDataDirs, resolveDbUrl, dbFilePath, dbUrlNotice, scanAgentSkills } from "@hanoman/runner";
import { DEFAULT_METHOD, METHODS, methodStatus, zAgent, type MethodSkillStatus } from "@hanoman/shared";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir } from "./start";

// SPEC-846 · satu direktori data efektif beserta izin tulisnya. Operator tak bisa mendefinisikan
// batas backup/restore selama perintah kesehatan tak pernah menyebut direktori mana yang dipakai.
export type DirProbe = { label: string; path: string; writable: boolean; fatal: boolean };

export type Probes = {
  node: string; git: string | null; tmux: string | null;
  claude: string | null; codex: string | null;
  gh: string | null;   // SPEC-471 · opsional: tanpa gh, tarik issue lewat REST + GITHUB_TOKEN
  dirs: DirProbe[]; web: boolean; db: string;
  podman: string | null; sandboxRequired: boolean; sandboxReady: boolean;
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
    // Direktori turunan lahir saat dipakai, jadi izin tulis yang belum ada di situ adalah
    // peringatan — bukan alasan menyatakan hanoman tak bisa menjalankan sesi. Home tetap fatal.
    ...p.dirs.map((d) => ({
      mark: d.writable ? "✓" : d.fatal ? "✗" : "!",
      text: `${d.label} ${d.path}${d.writable ? "" : " — TAK bisa ditulis"}`,
      fatal: d.fatal && !d.writable,
    })),
    { mark: p.web ? "✓" : "!", text: p.web ? "aset dashboard ada" : "aset dashboard tak ada — API jalan, dashboard tidak", fatal: false },
    { mark: "·", text: `db ${p.db}`, fatal: false },
    { mark: p.sandboxReady ? "✓" : p.sandboxRequired ? "✗" : "!",
      text: p.sandboxReady
        ? `sandbox sesi rootless siap (${p.podman})`
        : `sandbox sesi belum siap${p.podman ? ` (${p.podman})` : " — podman tak ada"}`,
      fatal: p.sandboxRequired && !p.sandboxReady },
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

// Direktori data dibuat saat dipakai, jadi yang bisa diperiksa hari ini adalah leluhur terdekat
// yang sudah ada — bukan path yang belum lahir. Override boleh menunjuk beberapa level ke depan.
function writable(path: string): boolean {
  for (let p = resolve(path); ; ) {
    if (existsSync(p)) {
      try { accessSync(p, constants.W_OK); return true; } catch { return false; }
    }
    const up = dirname(p);
    if (up === p) return false;
    p = up;
  }
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

  const d = resolveDataDirs(ctx.env);
  const dirs: DirProbe[] = [
    { label: "data dir", path: d.home, writable: writable(d.home), fatal: true },
    { label: "transkrip", path: d.transcripts, writable: writable(d.transcripts), fatal: false },
    { label: "upload", path: d.uploads, writable: writable(d.uploads), fatal: false },
    { label: "key SSH", path: d.sshKeys, writable: writable(d.sshKeys), fatal: false },
  ];

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
  const podman = version("podman", ["--version"]);
  const sandboxRequired = ctx.env.NODE_ENV === "production" || !!ctx.env.HANOMAN_PUBLIC_ORIGINS;
  const rootless = podman ? version("podman", ["info", "--format", "{{.Host.Security.Rootless}}"] ) === "true" : false;
  const credentialDir = ctx.env.HANOMAN_AGENT_CREDENTIAL_DIR;
  let credentialsReadable = false;
  if (credentialDir) {
    try { accessSync(credentialDir, constants.R_OK); credentialsReadable = true; } catch { /* tetap false */ }
  }
  const network = ctx.env.HANOMAN_SESSION_NETWORK ?? "hanoman-egress";
  const networkReady = podman ? version("podman", ["network", "exists", network]) !== null : false;
  const sandboxReady = ctx.env.HANOMAN_SESSION_SANDBOX === "podman" && rootless
    && credentialsReadable && !!ctx.env.HANOMAN_EGRESS_PROXY && networkReady;

  const r = doctorReport({
    node: process.version,
    git: version("git", ["--version"]),
    tmux: version("tmux", ["-V"]),
    claude, codex,
    gh: version(ctx.env.HANOMAN_GH_BIN ?? "gh", ["--version"]),
    dirs, web: layout.web !== null, db, methods,
    podman, sandboxRequired, sandboxReady,
  });
  ctx.stdout(`hanoman doctor\n${r.lines.join("\n")}\n`);
  // Justru di doctor ini paling berguna: ia menjelaskan kenapa `db …` menunjuk berkas default
  // padahal env punya DATABASE_URL yang lain.
  const notice = dbUrlNotice(ctx.env);
  if (notice) ctx.stdout(`\n${notice}\n`);
  if (!r.ok) ctx.stderr("\nada prasyarat yang belum terpenuhi — hanoman tak akan bisa menjalankan sesi\n");
  return r.ok ? 0 : 1;
}
