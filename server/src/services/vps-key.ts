import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDataDirs } from "@hanoman/runner";
import { effectiveStr } from "../config";

// Identitas hanoman sendiri, bukan ~/.ssh milik pengguna: akses hanoman bisa dicabut
// per-mesin (hapus satu baris di authorized_keys) tanpa menyentuh key pribadi.
//
// SPEC-846 · lokasinya turun dari `resolveDataDirs()` — dulu dari `homedir()`, sehingga instance
// ber-`HANOMAN_HOME` menyimpan identitasnya DI LUAR batas backup yang dijanjikan runbook dan dua
// instance yang dipisah `HANOMAN_HOME` diam-diam berbagi satu key.
export const keyDir = (): string => effectiveStr("HANOMAN_SSH_KEY_DIR") ?? resolveDataDirs().sshKeys;

export type HanomanKey = { privPath: string; pubPath: string; pub: string };

const KEY_FILES = ["id_ed25519", "id_ed25519.pub"] as const;

/**
 * Memindahkan key dari lokasi pra-SPEC-846 (`~/.hanoman`) ke lokasi kanonik. Tanpa ini, memindah
 * default saja akan membuat instance yang sudah berjalan MELAHIRKAN identitas baru — dan setiap VPS
 * yang sudah di-bootstrap menolaknya diam-diam, tanpa jalan pulih selain bootstrap ulang.
 *
 * Dipindah (salin lalu hapus), bukan disalin: dua salinan kunci privat di disk membuat batas backup
 * tetap separuh benar. Override eksplisit tak pernah disentuh — di situ niat operator sudah jelas.
 */
function adoptLegacyKey(dir: string): void {
  if (effectiveStr("HANOMAN_SSH_KEY_DIR")) return;
  const legacy = join(homedir(), ".hanoman");
  if (legacy === dir) return;
  // Butuh keduanya: priv tanpa pub adalah setengah keadaan yang lebih baik dilahirkan ulang.
  if (!KEY_FILES.every((f) => existsSync(join(legacy, f)))) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of KEY_FILES) {
    copyFileSync(join(legacy, f), join(dir, f));
    chmodSync(join(dir, f), 0o600);
  }
  for (const f of KEY_FILES) unlinkSync(join(legacy, f));
  console.log(`vps: key SSH dipindah dari ${legacy} ke ${dir} (SPEC-846 — satu batas backup)`);
}

export function ensureHanomanKey(): HanomanKey {
  const dir = keyDir();
  const privPath = join(dir, KEY_FILES[0]);
  const pubPath = `${privPath}.pub`;
  if (!existsSync(privPath)) adoptLegacyKey(dir);
  if (!existsSync(privPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // -N "" : tanpa passphrase — tak ada manusia yang bisa mengetikkannya saat audit
    // terjadwal jam 3 pagi. Kunci privatnya lahir 0600 dari ssh-keygen sendiri.
    execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "hanoman", "-f", privPath],
      { stdio: ["ignore", "ignore", "pipe"] });
  }
  return { privPath, pubPath, pub: readFileSync(pubPath, "utf8").trim() };
}
