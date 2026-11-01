import { builtinAccountId, isBuiltinAccountId, type Agent, type RuntimeName } from "@hanoman/shared";
import type { SessionAccount } from "../pty";
import { sessionSandboxOn } from "../session-sandbox";
import { prisma } from "../../db";
import { prepareAccountHome } from "./home";
import { AccountError, accountSnapshot } from "./registry";

/** Env yang membuat CLI memakai login akun. Token env claude dilepas: ia mengalahkan config dir. */
export function accountEnv(runtime: RuntimeName, homeDir: string): { env: Record<string, string>; unset: string[] } {
  if (runtime === "claude") return { env: { CLAUDE_CONFIG_DIR: homeDir }, unset: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] };
  if (runtime === "codex") return { env: { CODEX_HOME: homeDir }, unset: [] };
  return { env: {}, unset: [] };
}

type ResolveDeps = { sandbox: boolean; warn: (m: string) => void };
const prodDeps = (): ResolveDeps => ({ sandbox: sessionSandboxOn(), warn: (m) => console.warn(m) });

/**
 * ADR-0234 · resolver SINKRON untuk pty.createSession. null = akun bawaan (perilaku lama, nol env
 * tambahan). `requested` diisi pemanggil manusia (sudah divalidasi `assertLaunchAccount`) atau
 * auto-resume; absen = default runtime. Default yang tak lagi `aktif` jatuh ke bawaan + peringatan,
 * supaya sesi otomatis (scheduler/lead) tak mati karena satu akun kedaluwarsa.
 */
export function resolveLaunchAccount(agent: Agent, requested?: string, deps: ResolveDeps = prodDeps()): SessionAccount | null {
  if (deps.sandbox) return null;
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
    return;
  }
  const row = await prisma.runtimeAccount.findUnique({ where: { id: requested } });
  if (!row) throw new AccountError("account-not-found", 404, `akun ${requested} tak ditemukan`);
  if (row.runtime !== agent) throw new AccountError("account-runtime-mismatch", 409, `akun "${row.label}" milik ${row.runtime}, bukan ${agent}`);
  if (sandbox) throw new AccountError("account-sandbox-unsupported", 409, "sandbox sesi hanya mendukung akun bawaan");
  if (row.status !== "aktif") throw new AccountError("account-not-logged-in", 409, `akun "${row.label}" belum login`);
}
