import { builtinAccountId, isBuiltinAccountId, type Agent, type RuntimeName } from "@hanoman/shared";
import type { SessionAccount } from "../pty";
import { sessionSandboxOn } from "../session-sandbox";
import { prisma } from "../../db";
import { prepareAccountHome } from "./home";
import { AccountError, accountSnapshot } from "./registry";
import { activateAgyAccount, activeAgyAccount, liveAgySessions } from "./antigravity-swap";

/** Env yang membuat CLI memakai login akun. Token env claude dilepas: ia mengalahkan config dir. */
export function accountEnv(runtime: RuntimeName, homeDir: string): { env: Record<string, string>; unset: string[] } {
  if (runtime === "claude") return { env: { CLAUDE_CONFIG_DIR: homeDir }, unset: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] };
  if (runtime === "codex") return { env: { CODEX_HOME: homeDir }, unset: [] };
  return { env: {}, unset: [] };
}

type ResolveDeps = {
  sandbox: boolean; warn: (m: string) => void;
  /** Mode tukar agy (macOS). Absen = tak ada penukaran (test, platform lain). */
  activateAgy?: (accountId: string) => void;
};
const prodDeps = (): ResolveDeps => ({
  sandbox: sessionSandboxOn(), warn: (m) => console.warn(m),
  ...(process.platform === "darwin" ? { activateAgy: (id: string) => activateAgyAccount(id) } : {}),
});

const AGY_BUILTIN = builtinAccountId("antigravity");

/**
 * ADR-0234 · agy: mode tukar eksklusif. Tanpa akun agy terdaftar → perilaku lama (nol sentuhan
 * Keychain). Dengan akun terdaftar, akun BAWAAN pun perlu ditukar balik bila akun lain sedang aktif.
 * `activateAgy` melempar AccountError busy bila sesi agy lain masih hidup — sebelum tmux menyentuh apa pun.
 */
function resolveAgy(requested: string | undefined, deps: ResolveDeps): SessionAccount | null {
  const snap = accountSnapshot();
  const rows = snap.rows.filter((r) => r.runtime === "antigravity");
  if (!rows.length || !deps.activateAgy) return null;
  const target = requested ?? snap.defaults.antigravity ?? AGY_BUILTIN;
  const row = rows.find((r) => r.id === target);
  if (!isBuiltinAccountId(target) && !row) deps.warn(`hanoman: akun Antigravity ${target} tak ditemukan — memakai akun bawaan`);
  if (row && !requested && row.status !== "aktif")
    deps.warn(`hanoman: akun default Antigravity "${row.label}" berstatus ${row.status} — sesi memakai akun bawaan`);
  const id = row && (requested || row.status === "aktif") ? row.id : AGY_BUILTIN;
  deps.activateAgy(id);
  return id === AGY_BUILTIN ? null : { id, env: {}, unset: [] };
}

/**
 * ADR-0234 · resolver SINKRON untuk pty.createSession. null = akun bawaan (perilaku lama, nol env
 * tambahan). `requested` diisi pemanggil manusia (sudah divalidasi `assertLaunchAccount`) atau
 * auto-resume; absen = default runtime. Default yang tak lagi `aktif` jatuh ke bawaan + peringatan,
 * supaya sesi otomatis (scheduler/lead) tak mati karena satu akun kedaluwarsa.
 */
export function resolveLaunchAccount(agent: Agent, requested?: string, deps: ResolveDeps = prodDeps()): SessionAccount | null {
  if (deps.sandbox) return null;
  if (agent === "antigravity") return resolveAgy(requested, deps);
  const snap = accountSnapshot();
  const id = requested ?? snap.defaults[agent];
  if (!id || isBuiltinAccountId(id)) return null;
  const row = snap.rows.find((r) => r.id === id && r.runtime === agent);
  if (!row) { deps.warn(`hanoman: akun runtime ${id} tak ditemukan untuk ${agent} — memakai akun bawaan`); return null; }
  if (!requested && row.status !== "aktif") {
    deps.warn(`hanoman: akun default ${agent} "${row.label}" berstatus ${row.status} — sesi memakai akun bawaan`);
    return null;
  }
  try { prepareAccountHome(agent, row.homeDir); }
  catch (e) { deps.warn(`hanoman: menyiapkan home akun "${row.label}" gagal: ${(e as Error).message}`); }
  return { id: row.id, ...accountEnv(agent, row.homeDir) };
}

/** Validasi pilihan akun EKSPLISIT sebelum launch (route). Melempar AccountError. */
export async function assertLaunchAccount(agent: Agent, requested: string | undefined, sandbox: boolean = sessionSandboxOn()): Promise<void> {
  if (!requested) return;
  if (isBuiltinAccountId(requested)) {
    if (requested !== builtinAccountId(agent))
      throw new AccountError("account-runtime-mismatch", 409, `${requested} bukan akun bawaan ${agent}`);
    assertAgyFree(agent, requested);
    return;
  }
  const row = await prisma.runtimeAccount.findUnique({ where: { id: requested } });
  if (!row) throw new AccountError("account-not-found", 404, `akun ${requested} tak ditemukan`);
  if (row.runtime !== agent) throw new AccountError("account-runtime-mismatch", 409, `akun "${row.label}" milik ${row.runtime}, bukan ${agent}`);
  if (sandbox) throw new AccountError("account-sandbox-unsupported", 409, "sandbox sesi hanya mendukung akun bawaan");
  if (row.status !== "aktif") throw new AccountError("account-not-logged-in", 409, `akun "${row.label}" belum login`);
  assertAgyFree(agent, requested);
}

/** agy mode tukar: memilih akun selain yang aktif ditolak selama ada sesi agy hidup. */
function assertAgyFree(agent: Agent, requested: string): void {
  if (agent !== "antigravity" || process.platform !== "darwin") return;
  if (!accountSnapshot().rows.some((r) => r.runtime === "antigravity")) return;
  if (activeAgyAccount() === requested) return;
  if (liveAgySessions().length > 0)
    throw new AccountError("antigravity-account-busy", 409, "masih ada sesi Antigravity yang berjalan dengan akun lain — tutup dulu sesinya");
}
