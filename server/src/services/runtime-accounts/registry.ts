import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import {
  BUILTIN_ACCOUNT_LABEL, builtinAccountId, isBuiltinAccountId, runtimeOfBuiltin, zAgent,
  type AccountErrorCode, type RuntimeAccountDTO, type RuntimeAccountDefaults, type RuntimeAccountIdentity,
  type RuntimeAccountStatus, type RuntimeName,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { getSetting } from "../settings";
import { ensureAccountHome, inspectAccountHome } from "./home";
import { accountHomeDir, baseHome, insideAccountsRoot } from "./paths";
import { claudeKeychainService, deleteClaudeKeychainEntry } from "./keychain";
import { nextStatus, probeClaudeLogin, probeCodexLogin, type LoginProbe } from "./identity";

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode, readonly status: 404 | 409, message: string) { super(message); }
}

export type AccountRow = {
  id: string; runtime: RuntimeName; label: string; homeDir: string; identity: RuntimeAccountIdentity | null;
  status: RuntimeAccountStatus; createdAt: Date; lastLoginAt: Date | null;
};
type BuiltinState = { status: RuntimeAccountStatus; identity: RuntimeAccountIdentity | null };
type Snapshot = { rows: AccountRow[]; defaults: RuntimeAccountDefaults; builtin: Partial<Record<RuntimeName, BuiltinState>> };

export type Probes = {
  claude: (home: string | null) => Promise<LoginProbe>;
  codex: (home: string) => Promise<LoginProbe>;
  antigravity: (home: string | null, accountId: string) => Promise<LoginProbe>;
};
const probes: Probes = {
  claude: (home) => probeClaudeLogin(home),
  codex: async (home) => probeCodexLogin(home),
  // Mode tukar agy (antigravity-swap.ts) memasang probe slot-nya lewat setProbe saat boot.
  antigravity: async () => ({ loggedIn: false, identity: null }),
};
export function setProbe<K extends keyof Probes>(runtime: K, fn: Probes[K]): void { probes[runtime] = fn; }

export const RUNTIMES: readonly RuntimeName[] = zAgent.options;

// ADR-0234 · snapshot memori untuk resolver SINKRON di pty.createSession (Prisma asinkron). Diperbarui
// setiap mutasi lewat refreshSnapshot(); dibaca boot SEBELUM sesi apa pun bisa lahir (install.ts).
let snapshot: Snapshot = { rows: [], defaults: {}, builtin: {} };
export const accountSnapshot = (): Snapshot => snapshot;
/** Test-only. */
export function _setAccountSnapshot(s: Partial<Snapshot>): void { snapshot = { ...snapshot, ...s }; }

type DbRow = {
  id: string; runtime: string; label: string; homeDir: string; identity: Prisma.JsonValue | null;
  status: string; createdAt: Date; lastLoginAt: Date | null;
};
const toRow = (r: DbRow): AccountRow => ({
  id: r.id, runtime: zAgent.parse(r.runtime), label: r.label, homeDir: r.homeDir,
  identity: r.identity && typeof r.identity === "object" && !Array.isArray(r.identity) ? (r.identity as RuntimeAccountIdentity) : null,
  status: r.status === "aktif" || r.status === "perlu-login-ulang" ? r.status : "belum-login",
  createdAt: r.createdAt, lastLoginAt: r.lastLoginAt,
});

export async function refreshSnapshot(): Promise<void> {
  const [rows, setting] = await Promise.all([
    prisma.runtimeAccount.findMany({ orderBy: { createdAt: "asc" } }), getSetting(),
  ]);
  snapshot = { ...snapshot, rows: rows.map(toRow), defaults: setting.accounts ?? {} };
}

const defaultOf = (runtime: RuntimeName): string => snapshot.defaults[runtime] ?? builtinAccountId(runtime);

export function accountExists(id: string): boolean {
  return isBuiltinAccountId(id) ? runtimeOfBuiltin(id) !== null : snapshot.rows.some((r) => r.id === id);
}

export function listAccountDTOs(): RuntimeAccountDTO[] {
  const out: RuntimeAccountDTO[] = [];
  for (const runtime of RUNTIMES) {
    const def = defaultOf(runtime);
    const b = snapshot.builtin[runtime];
    out.push({
      id: builtinAccountId(runtime), runtime, label: BUILTIN_ACCOUNT_LABEL, builtin: true,
      isDefault: def === builtinAccountId(runtime),
      // Belum diprobe = anggap aktif: akun bawaan adalah perilaku hanoman selama ini.
      status: b?.status ?? "aktif", identity: b?.identity ?? null, drift: [], createdAt: null, lastLoginAt: null,
    });
    for (const r of snapshot.rows.filter((x) => x.runtime === runtime)) {
      out.push({
        id: r.id, runtime, label: r.label, builtin: false, isDefault: def === r.id, status: r.status,
        identity: r.identity, drift: inspectAccountHome(runtime, r.homeDir),
        createdAt: r.createdAt.toISOString(), lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      });
    }
  }
  return out;
}

const dtoOf = (id: string): RuntimeAccountDTO => {
  const d = listAccountDTOs().find((a) => a.id === id);
  if (!d) throw new AccountError("account-not-found", 404, `akun ${id} tak ditemukan`);
  return d;
};

const labelTaken = (runtime: RuntimeName, label: string) =>
  new AccountError("account-label-taken", 409, `label "${label}" sudah dipakai di ${runtime}`);
const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === "P2002";

export async function createAccount(runtime: RuntimeName, label: string): Promise<RuntimeAccountDTO> {
  if (label.toLowerCase() === BUILTIN_ACCOUNT_LABEL.toLowerCase()) throw labelTaken(runtime, label);
  const id = randomUUID().replace(/-/g, "").slice(0, 8);
  const homeDir = accountHomeDir(runtime, id);
  try {
    await prisma.runtimeAccount.create({ data: { id, runtime, label, homeDir, status: "belum-login" } });
  } catch (e) {
    if (isUniqueViolation(e)) throw labelTaken(runtime, label);
    throw e;
  }
  ensureAccountHome(runtime, homeDir, baseHome(runtime));
  await refreshSnapshot();
  return dtoOf(id);
}

async function rowOrThrow(id: string): Promise<AccountRow> {
  const r = await prisma.runtimeAccount.findUnique({ where: { id } });
  if (!r) throw new AccountError("account-not-found", 404, `akun ${id} tak ditemukan`);
  return toRow(r);
}

export async function renameAccount(id: string, label: string): Promise<RuntimeAccountDTO> {
  const row = await rowOrThrow(id);
  if (label.toLowerCase() === BUILTIN_ACCOUNT_LABEL.toLowerCase()) throw labelTaken(row.runtime, label);
  try { await prisma.runtimeAccount.update({ where: { id }, data: { label } }); }
  catch (e) {
    if (isUniqueViolation(e)) throw labelTaken(row.runtime, label);
    throw e;
  }
  await refreshSnapshot();
  return dtoOf(id);
}

async function writeDefaults(accounts: RuntimeAccountDefaults): Promise<void> {
  const s = await getSetting();
  const data = { ...s, accounts } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}

export async function deleteAccount(id: string, liveAccountIds: () => string[]): Promise<void> {
  const row = await rowOrThrow(id);
  if (liveAccountIds().includes(id)) throw new AccountError("account-in-use", 409, `akun "${row.label}" masih dipakai sesi yang hidup`);
  await prisma.runtimeAccount.delete({ where: { id } });
  const s = await getSetting();
  if (s.accounts?.[row.runtime] === id) {
    const next = { ...s.accounts };
    delete next[row.runtime];
    await writeDefaults(next);
  }
  if (row.runtime === "claude" && process.platform === "darwin") deleteClaudeKeychainEntry(claudeKeychainService(row.homeDir));
  // fs.rmSync rekursif meng-unlink symlink tanpa mengikutinya — aset bersama di home bawaan aman
  // (dikunci test "menghapus home akun TIDAK menghapus target symlink").
  if (insideAccountsRoot(row.homeDir)) rmSync(row.homeDir, { recursive: true, force: true });
  await refreshSnapshot();
}

export async function setDefaultAccount(runtime: RuntimeName, accountId: string, sandbox: boolean): Promise<void> {
  if (isBuiltinAccountId(accountId)) {
    if (accountId !== builtinAccountId(runtime))
      throw new AccountError("account-runtime-mismatch", 409, `${accountId} bukan akun bawaan ${runtime}`);
  } else {
    const row = await rowOrThrow(accountId);
    if (row.runtime !== runtime) throw new AccountError("account-runtime-mismatch", 409, `akun "${row.label}" milik ${row.runtime}, bukan ${runtime}`);
    if (sandbox) throw new AccountError("account-sandbox-unsupported", 409, "sandbox sesi hanya mendukung akun bawaan");
  }
  const s = await getSetting();
  const next: RuntimeAccountDefaults = { ...(s.accounts ?? {}) };
  if (isBuiltinAccountId(accountId)) delete next[runtime]; else next[runtime] = accountId;
  await writeDefaults(next);
  await refreshSnapshot();
}

async function probeBuiltin(runtime: RuntimeName, use: Probes = probes): Promise<void> {
  const p = runtime === "claude" ? await use.claude(null)
    : runtime === "codex" ? await use.codex(baseHome("codex"))
    : await use.antigravity(null, builtinAccountId("antigravity"));
  snapshot = { ...snapshot, builtin: { ...snapshot.builtin, [runtime]: {
    status: nextStatus(p.loggedIn, true), identity: p.identity,
  } } };
}

export async function checkAccount(id: string, override?: Probes): Promise<RuntimeAccountDTO> {
  const use = override ?? probes;
  const builtin = runtimeOfBuiltin(id);
  if (builtin) {
    await probeBuiltin(builtin, use);
    return dtoOf(id);
  }
  const row = await rowOrThrow(id);
  const p = row.runtime === "claude" ? await use.claude(row.homeDir)
    : row.runtime === "codex" ? await use.codex(row.homeDir)
    : await use.antigravity(row.homeDir, row.id);
  const ever = row.lastLoginAt !== null || row.status !== "belum-login";
  await prisma.runtimeAccount.update({ where: { id }, data: {
    status: nextStatus(p.loggedIn, ever),
    ...(p.loggedIn ? { identity: (p.identity ?? {}) as Prisma.InputJsonValue } : {}),
    ...(p.loggedIn && row.status !== "aktif" ? { lastLoginAt: new Date() } : {}),
  } });
  await refreshSnapshot();
  return dtoOf(id);
}

/** Boot: perbarui status semua akun (berurutan — probe claude men-spawn CLI). Gagal satu tak menghentikan sisanya. */
export async function refreshAllStatuses(): Promise<void> {
  for (const runtime of RUNTIMES) {
    try { await probeBuiltin(runtime); } catch (e) { console.error(`akun runtime (status ${runtime} bawaan):`, e); }
  }
  for (const r of snapshot.rows) {
    try { await checkAccount(r.id); } catch (e) { console.error(`akun runtime (status ${r.label}):`, e); }
  }
}
