import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { builtinAccountId, isBuiltinAccountId, type LimitsDTO } from "@hanoman/shared";
import { decryptSecret, encryptSecret } from "../secret-box";
import { defaultProject, EXPIRY_SKEW_MS, fetchAgyWindows, parseAgyToken } from "../antigravity-limits";
import { listSessions } from "../pty";
import { securityRun, type SecurityRun } from "./keychain";
import { accountsRoot } from "./paths";
import { AccountError, accountSnapshot } from "./registry";
import type { LoginProbe } from "./identity";

// ADR-0234 · agy menyimpan login di Keychain ber-nama TETAP (`gemini`/`antigravity`) dan bisa jatuh ke
// berkas `~/.gemini/antigravity-cli/antigravity-oauth-token`. Spike ADR-0234: `--gemini_dir` /
// `ANTIGRAVITY_GEMINI_DIR` hanya memindahkan DATA, login tetap dari Keychain bersama — tak ada isolasi per
// direktori. Multi-akun karena itu = MENUKAR isi keduanya: satu akun aktif per mesin. Slot tiap akun =
// `<akar>/<id>/slot.enc` (secret-box, 0600). Akun bawaan punya slot di `<akar>/default/`. Akun aktif
// dicatat di `<akar>/active`.
export type AgySlot = { keychain: string | null; file: string | null };
export type AgyIo = {
  run: SecurityRun;
  readFile: (p: string) => string | null;
  writeFile: (p: string, s: string) => void;
  removeFile: (p: string) => void;
  tokenFile: string;
  accountsDir: string;
  liveAgyAccountIds: () => string[];
};

const BUILTIN = builtinAccountId("antigravity");

// Sesi terminal login agy (`acct-login-<id>`, lihat login.ts) adalah sesi PERINTAH, bukan sesi agen —
// tanpa ini ia tak terhitung "sesi agy hidup", dan Start agy akun lain bisa menukar Keychain di tengah
// login. Id ditulis ulang di sini (bukan impor login.ts) supaya tak ada siklus impor resolver↔swap↔login.
const isAgyLoginSession = (sessionId: string): boolean =>
  sessionId === "acct-login-default-antigravity"
  || accountSnapshot().rows.some((r) => r.runtime === "antigravity" && sessionId === `acct-login-${r.id}`);

/** Sesi hidup yang memegang Keychain agy: sesi agen agy + sesi login agy. */
export const liveAgySessions = () =>
  listSessions().filter((s) => !s.exited && (s.agent === "antigravity" || isAgyLoginSession(s.id)));

export const fsAgyIo = (): AgyIo => ({
  run: securityRun,
  readFile: (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } },
  writeFile: (p, s) => { writeFileSync(p, s, { mode: 0o600 }); chmodSync(p, 0o600); },
  removeFile: (p) => rmSync(p, { force: true }),
  tokenFile: join(homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token"),
  accountsDir: join(accountsRoot(), "antigravity"),
  // Sesi agy hidup memakai akun yang AKTIF saat ini (satu Keychain), apa pun @hanoman_account-nya.
  liveAgyAccountIds: () => liveAgySessions().map((s) => s.accountId ?? BUILTIN),
});

const slotDir = (io: AgyIo, id: string) => join(io.accountsDir, isBuiltinAccountId(id) ? "default" : id);
const activeFile = (io: AgyIo) => join(io.accountsDir, "active");

export function activeAgyAccount(io: AgyIo = fsAgyIo()): string {
  return io.readFile(activeFile(io))?.trim() || BUILTIN;
}

// Slot SELALU di disk nyata di bawah `io.accountsDir`; `io.readFile/writeFile` hanya untuk berkas token
// agy dan penanda `active`.
export function readSlot(accountId: string, io: AgyIo = fsAgyIo()): AgySlot | null {
  let raw: string;
  try { raw = readFileSync(join(slotDir(io, accountId), "slot.enc"), "utf8"); } catch { return null; }
  const plain = decryptSecret(raw);
  if (!plain) return null;
  try { return JSON.parse(plain) as AgySlot; } catch { return null; }
}

function writeSlot(accountId: string, slot: AgySlot, io: AgyIo): void {
  const d = slotDir(io, accountId);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const p = join(d, "slot.enc");
  writeFileSync(p, encryptSecret(JSON.stringify(slot)), { mode: 0o600 });
  chmodSync(p, 0o600);
}

function readKeychain(io: AgyIo): string | null {
  try { return io.run(["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"]).trim() || null; }
  catch { return null; }
}

// Rahasia lewat STDIN `security -i`, bukan argv (argv terbaca `ps` proses lain).
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
function writeKeychain(value: string | null, io: AgyIo): void {
  try { io.run(["delete-generic-password", "-s", "gemini", "-a", "antigravity"]); } catch { /* belum ada */ }
  if (value) io.run(["-i"], `add-generic-password -U -s gemini -a antigravity -w ${shq(value)}\n`);
}

/** Simpan login yang sedang aktif ke slot akun aktif (menangkap token hasil refresh agy). */
export function captureActiveSlot(io: AgyIo = fsAgyIo()): void {
  writeSlot(activeAgyAccount(io), { keychain: readKeychain(io), file: io.readFile(io.tokenFile) }, io);
}

/**
 * Jadikan `targetId` akun agy aktif. Ditolak bila ada sesi agy hidup (semuanya memakai akun aktif
 * sekarang). Urutan: tangkap slot aktif → pulihkan slot target (kosong = belum login) → catat aktif.
 */
export function activateAgyAccount(targetId: string, io: AgyIo = fsAgyIo()): void {
  if (activeAgyAccount(io) === targetId) return;
  if (io.liveAgyAccountIds().length > 0)
    throw new AccountError("antigravity-account-busy", 409, "masih ada sesi Antigravity yang berjalan dengan akun lain — tutup dulu sesinya");
  captureActiveSlot(io);
  const slot = readSlot(targetId, io) ?? { keychain: null, file: null };
  writeKeychain(slot.keychain, io);
  if (slot.file) io.writeFile(io.tokenFile, slot.file); else io.removeFile(io.tokenFile);
  mkdirSync(io.accountsDir, { recursive: true, mode: 0o700 });
  io.writeFile(activeFile(io), targetId);
}

function emailOf(raw: string): string | undefined {
  try {
    let s = raw.trim();
    const prefix = "go-keyring-base64:";
    if (s.startsWith(prefix)) s = Buffer.from(s.slice(prefix.length), "base64").toString("utf8");
    const e = (JSON.parse(s) as { id_token_email?: unknown }).id_token_email;
    return typeof e === "string" && e ? e : undefined;
  } catch { return undefined; }
}

/** Login mentah akun: Keychain langsung bila akun itu yang aktif, selain itu dari slotnya. */
function rawLogin(accountId: string, io: AgyIo): string | null {
  if (activeAgyAccount(io) === accountId) return readKeychain(io) ?? io.readFile(io.tokenFile);
  const s = readSlot(accountId, io);
  return s?.keychain ?? s?.file ?? null;
}

/** Status login dari slot (atau Keychain langsung bila akun itu yang aktif). */
export function probeAgyLogin(accountId: string, io: AgyIo = fsAgyIo()): LoginProbe {
  const raw = rawLogin(accountId, io);
  if (!raw || !parseAgyToken(raw)) return { loggedIn: false, identity: null };
  const email = emailOf(raw);
  return { loggedIn: true, identity: email ? { email } : {} };
}

const UNAVAILABLE: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };

/** Limit satu akun agy dari token login-nya (tanpa refresh): token kedaluwarsa → unavailable. */
export async function agyAccountLimits(accountId: string, io: AgyIo = fsAgyIo()): Promise<LimitsDTO> {
  if (process.platform !== "darwin") return UNAVAILABLE;
  const raw = rawLogin(accountId, io);
  const tok = raw ? parseAgyToken(raw) : null;
  if (!tok || (tok.expiry !== null && tok.expiry - EXPIRY_SKEW_MS <= Date.now())) return UNAVAILABLE;
  const windows = await fetchAgyWindows(tok, defaultProject(), fetch);
  return windows ? { status: "ok", windows, fetchedAt: new Date().toISOString() } : UNAVAILABLE;
}
