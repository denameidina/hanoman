import { createRequire } from "node:module";

export interface Ctx {
  cwd: string; env: Record<string, string | undefined>;
  stdout(s: string): void; stderr(s: string): void; readStdin?(): Promise<string>;
}

// SPEC-398 · ADR-0087 · versi = versi paket npm (sumber tunggal: package.json paket ini), bukan
// konstanta yang mudah basi. Dari bundle `dist/hanoman.js`, `../package.json` benar di paket npm
// maupun di checkout (cli/package.json).
export function currentVersion(): string {
  try { return (createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0.0.0"; }
  catch { return "0.0.0"; }
}

// Perintah alur (execute/spec/plan/qa/scaffold/reverse) menjalankan runner headless dan
// hilang bersamanya (SPEC-162). Pekerjaan kini dimulai dari dashboard, sebagai sesi claude
// interaktif. Guardrail hook pretooluse dicabut (SPEC-197, ADR-0037).
const HELP = `hanoman <command>

  (tanpa argumen) | start                   jalankan hanoman (migrasi + server + dashboard)
    --port <n> --host <h> --db <file> --no-migrate
  doctor                                    periksa prasyarat: node, git, tmux, CLI agen, data dir
  update [--check]                          bandingkan versi dengan registry npm; pasang yang terbaru
  provision [--with=a,b] [--probe]          pasang komponen di MESIN INI (hanoman, caddy, claude,
    [--profile=lab|production]              codex, gh, …). --probe hanya melaporkan apa yang ada.
    [--domain=<d>] [--dry-run] [--yes]
  mcp [--read-only] [--host <url>]          MCP server stdio untuk klien AI (Claude Code/Desktop,
    [--max-bytes <n>]                       Codex, Cursor, Copilot). Token dari HANOMAN_AGENT_TOKEN.
  migrate-from-postgres --from <url>        pindahkan data Postgres lama ke SQLite
    [--to <file>] [--dry-run] [--force]
  docs scan [--json]                        coverage + laporan per-kategori
  docs index --check | --fix                integritas index
  docs link <path> [--category c]           tambahkan doc ke index
  --version | --help`;

/**
 * Keputusan routing, dipisah dari eksekusinya supaya bisa dites tanpa mem-boot server.
 *
 * SPEC-398 · `hanoman` MENJALANKAN hanoman (dulu argv kosong mencetak help) — itu inti objective
 * SPEC-398. Termasuk bentuk telanjang-ber-flag `hanoman --port 8899`: tanpa aturan itu ia jatuh ke
 * "unknown command", dan itulah cara paling wajar orang memanggilnya (terukur saat smoke boot).
 */
export function route(argv: string[]): { cmd: string; args: string[] } {
  if (argv.includes("--version")) return { cmd: "version", args: [] };
  if (argv.includes("--help")) return { cmd: "help", args: [] };
  const [group, sub, ...rest] = argv;
  if (group === undefined || group.startsWith("--")) return { cmd: "start", args: argv };
  // SPEC-482 · ADR-0099 · `mcp` = MCP server stdio (klien REST hanoman), bukan sub-flag `start`.
  if (group === "start" || group === "doctor" || group === "update" || group === "mcp"
    || group === "provision")
    return { cmd: group, args: argv.slice(1) };
  if (group === "migrate-from-postgres") return { cmd: "migrate-pg", args: argv.slice(1) };
  if (group === "docs" && (sub === "scan" || sub === "index" || sub === "link")) {
    return { cmd: `docs:${sub}`, args: rest };
  }
  // SPEC-398 · perintah rilis, sengaja TAK muncul di --help (hanya berguna di checkout repo).
  if (group === "__pack") return { cmd: "__pack", args: argv.slice(1) };
  if (group === "__verify") return { cmd: "__verify", args: argv.slice(1) };
  return { cmd: "unknown", args: argv };
}

export async function run(argv: string[], ctx: Ctx): Promise<number> {
  const { cmd, args } = route(argv);
  if (cmd === "version") { ctx.stdout(currentVersion() + "\n"); return 0; }
  if (cmd === "help") { ctx.stdout(HELP + "\n"); return 0; }
  if (cmd === "start")  return (await import("./commands/start")).default(args, ctx);
  if (cmd === "doctor") return (await import("./commands/doctor")).default(args, ctx);
  if (cmd === "update") return (await import("./commands/update")).default(args, ctx);
  if (cmd === "mcp")    return (await import("./commands/mcp")).default(args, ctx);
  if (cmd === "provision") return (await import("./commands/provision")).default(args, ctx);
  if (cmd === "migrate-pg") return (await import("./commands/migrate-pg")).default(args, ctx);
  if (cmd === "docs:scan")  return (await import("./commands/docs-scan")).default(args, ctx);
  if (cmd === "docs:index") return (await import("./commands/docs-index")).default(args, ctx);
  if (cmd === "docs:link")  return (await import("./commands/docs-link")).default(args, ctx);
  if (cmd === "__pack")     return (await import("./commands/pack")).default(args, ctx);
  if (cmd === "__verify")   return (await import("./commands/verify-packed")).default(args, ctx);
  ctx.stderr(`unknown command: ${argv.join(" ")}\n\n${HELP}\n`);
  return 1;
}
