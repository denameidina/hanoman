// SPEC-884 · ADR-0138 · jawaban wizard setup awal hidup di berkas ini, BUKAN di `RuntimeConfig`.
// Resolver config server presedensinya DB → env (`server/src/config.ts:31`), jadi lewat sana siapa
// pun yang bisa menulis config bisa MEMATIKAN hardening — jebakan yang sama yang sudah dihindari
// ADR-0088 untuk `HANOMAN_SUPERVISOR`. Berkas ini sebaliknya digabung PALING LEMAH saat CLI
// men-spawn server (lihat `cli/src/commands/start.ts`), sehingga env systemd/shell selalu menang.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_ENV_FILE = "config.env";

export function configEnvPath(home: string): string {
  return join(home, CONFIG_ENV_FILE);
}

/** Murni. Format `KEY=value` per baris; `#` komentar; baris tanpa `=` diabaikan diam-diam. */
export function parseConfigEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    // Hanya pemisah PERTAMA yang dipotong — nilai boleh memuat '=' (URL proxy ber-query).
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Murni. Nilai kosong dibuang: "ada tapi kosong" tak pernah berarti apa pun di sini. */
export function formatConfigEnv(values: Record<string, string>): string {
  const lines = Object.entries(values)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => `${k}=${v.trim()}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Berkas absen bukan kegagalan — instalasi yang belum pernah menjalankan wizard normal. */
export function readConfigEnv(home: string): Record<string, string> {
  try { return parseConfigEnv(readFileSync(configEnvPath(home), "utf8")); }
  catch { return {}; }
}

/** Menimpa, bukan menambah: berkas ini adalah snapshot jawaban wizard terakhir. */
export function writeConfigEnv(home: string, values: Record<string, string>): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = configEnvPath(home);
  writeFileSync(path, formatConfigEnv(values), { mode: 0o600 });
  chmodSync(path, 0o600);   // umask bisa melonggarkan mode saat berkas sudah ada sebelumnya
}
