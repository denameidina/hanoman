// SPEC-884 · ADR-0138 · menulis jawaban wizard ke $HANOMAN_HOME/config.env lewat allowlist.
import { readConfigEnv, resolveHardening, writeConfigEnv } from "@hanoman/runner";

type Env = Record<string, string | undefined>;

/**
 * Berkas ini BUKAN pintu belakang untuk menyuntik env sembarang ke proses sesi: kunci di luar
 * daftar ini ditolak. Setiap penambahan wajib punya alasan di ADR-0138.
 */
export const SETUP_ALLOWED_KEYS = [
  "HANOMAN_DEPLOYMENT", "HANOMAN_HARDENING", "HANOMAN_SETUP_DONE", "HANOMAN_SESSION_SANDBOX",
  "HANOMAN_SESSION_NETWORK", "HANOMAN_EGRESS_PROXY", "HANOMAN_AGENT_CREDENTIAL_DIR",
  "HANOMAN_CONTROL_ORIGINS", "HANOMAN_PUBLIC_ORIGINS", "HANOMAN_SINGLE_ORIGIN",
  "HANOMAN_TRUST_PROXY", "HANOMAN_UPLOAD_SCANNER",
] as const;

/**
 * Penanda DURABLE bahwa wizard sudah dijawab. Tanpa ini wizard muncul lagi setiap restart selama
 * akun pertama belum dibuat — dan operator terjebak lingkaran wizard → restart → wizard, karena
 * `needed` diturunkan dari "belum ada user" yang memang masih benar pada saat itu.
 */
export function setupDone(home: string): boolean {
  return readConfigEnv(home).HANOMAN_SETUP_DONE === "1";
}

/**
 * Hardening yang menyala karena sesuatu DI LUAR berkas (systemd, shell) tak boleh dimatikan dari
 * dashboard. Sesudah CLI menggabungkan berkas ke `process.env`, keduanya tak bisa dibedakan lagi —
 * jadi perbedaannya dihitung dengan membaca berkasnya sendiri.
 */
export function hardeningLocked(home: string, env: Env): boolean {
  return resolveHardening(env) && !resolveHardening(readConfigEnv(home));
}

/** Menimpa berkas dengan jawaban wizard; mengembalikan nilai yang benar-benar ditulis. */
export function applySetup(
  home: string, input: { deployment: "local" | "public"; hardening: boolean },
): Record<string, string> {
  const existing = readConfigEnv(home);
  const next: Record<string, string> = {};
  for (const key of SETUP_ALLOWED_KEYS) if (existing[key]) next[key] = existing[key]!;
  next.HANOMAN_DEPLOYMENT = input.deployment;
  next.HANOMAN_SETUP_DONE = "1";
  if (input.hardening) next.HANOMAN_HARDENING = "1";
  else delete next.HANOMAN_HARDENING;
  writeConfigEnv(home, next);
  return next;
}
