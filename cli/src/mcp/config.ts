// SPEC-482 · ADR-0099 · resolusi konfigurasi `hanoman mcp`. Murni: argv + env + pembaca berkas
// disuntikkan, jadi seluruh percabangan bisa diuji tanpa filesystem.
import { DEFAULT_MAX_BYTES, type McpLevel } from "@hanoman/shared";

export type McpConfig = {
  host: string;
  token: string;
  /** ADR-0155 · tingkat mode. Yang lebih sempit selalu menang, apa pun urutan argumen. */
  level: McpLevel;
  maxBytes: number;
  /** Keluhan konfigurasi. Non-kosong = setiap panggilan tool menjawab dengan kalimat ini. */
  problems: string[];
};

const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

export function resolveMcpConfig(
  argv: string[],
  env: Record<string, string | undefined>,
  readTokenFile: () => string | null,
): McpConfig {
  const problems: string[] = [];

  const host = (flagValue(argv, "--host") ?? env.HANOMAN_HOST ?? "").trim().replace(/\/+$/, "");
  if (!host) {
    problems.push(
      'HANOMAN_HOST belum diisi. Instance hanoman harus disebut eksplisit di konfigurasi klien MCP ini — agent token diterbitkan PER-INSTANCE, jadi tak ada default yang aman. Contoh: "HANOMAN_HOST": "http://localhost:8787".',
    );
  } else if (!/^https?:\/\//.test(host)) {
    problems.push(`HANOMAN_HOST "${host}" tak punya skema. Tulis lengkap dengan http:// atau https://.`);
  }

  // Token TIDAK PERNAH dari flag: seluruh ARGV proses ini terbaca `ps` oleh siapa pun di mesin
  // yang sama (SPEC-402 — prompt sesi hanoman hidup di ARGV, dan itulah cara ia bocor).
  const token = (env.HANOMAN_AGENT_TOKEN ?? readTokenFile() ?? "").trim();
  if (!token) {
    problems.push(
      'HANOMAN_AGENT_TOKEN belum diisi. Buat token di dashboard hanoman → Settings → Akses AI Agent, lalu pasang di blok "env" konfigurasi klien MCP ini (bukan sebagai argumen baris perintah).',
    );
  }
  if (argv.includes("--token")) {
    problems.push(
      "Token tak boleh diberikan lewat --token: argumen baris perintah terbaca proses lain di mesin ini. Pakai variabel lingkungan HANOMAN_AGENT_TOKEN.",
    );
  }

  // ADR-0155 · TIGA tingkat. `--danger` MENAMPILKAN tool berbahaya di tools/list; ia BUKAN
  // gerbang keamanan — yang menahan sungguhan adalah capability pada agent token. Yang lebih
  // sempit selalu menang: memilih yang lebih longgar diam-diam adalah cara paling mudah membuat
  // seseorang menyalakan permukaan berbahaya tanpa sadar.
  const flagOrEnv = (flag: string, v: string | undefined) =>
    argv.includes(flag) || v === "1" || v === "true";
  const readOnly = flagOrEnv("--read-only", env.HANOMAN_MCP_READ_ONLY);
  const danger = flagOrEnv("--danger", env.HANOMAN_MCP_DANGER);
  if (readOnly && danger) {
    problems.push("--danger diabaikan karena mode baca-saja juga aktif. Tingkat yang lebih sempit selalu menang.");
  }
  const level: McpLevel = readOnly ? "read-only" : danger ? "danger" : "default";

  const rawMax = flagValue(argv, "--max-bytes") ?? env.HANOMAN_MCP_MAX_BYTES;
  const parsed = rawMax === undefined ? NaN : Number(rawMax);
  const maxBytes = Number.isFinite(parsed) && parsed >= 512 ? Math.floor(parsed) : DEFAULT_MAX_BYTES;

  return { host, token, level, maxBytes, problems };
}
