import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAccountIdentity, RuntimeAccountStatus } from "@hanoman/shared";
import { agentBin } from "../pty";

export type LoginProbe = { loggedIn: boolean; identity: RuntimeAccountIdentity | null };
export type ExecOut = (bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

const NONE: LoginProbe = { loggedIn: false, identity: null };

// `claude auth status` bisa keluar non-nol saat belum login sambil tetap mencetak JSON — stdout dipakai
// bila ada, apa pun kode keluarnya.
const execOut: ExecOut = (bin, args, env) => new Promise((res, rej) => {
  execFile(bin, args, { env, encoding: "utf8", timeout: 15_000 }, (err, stdout) => (stdout ? res(stdout) : rej(err)));
});

/**
 * ADR-0234 · status login claude lewat CLI-nya sendiri (`claude auth status --json`, claude ≥ 2.1.316).
 * Untuk akun non-bawaan (`homeDir` diisi) token env dilepas supaya status mencerminkan login DIREKTORI
 * itu, bukan `CLAUDE_CODE_OAUTH_TOKEN` warisan. Akun bawaan memakai env server apa adanya.
 */
export async function probeClaudeLogin(homeDir: string | null, run: ExecOut = execOut, bin: string = agentBin("claude")): Promise<LoginProbe> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (homeDir) {
    env.CLAUDE_CONFIG_DIR = homeDir;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }
  try {
    const j = JSON.parse(await run(bin, ["auth", "status", "--json"], env)) as { loggedIn?: unknown; email?: unknown; subscriptionType?: unknown };
    if (j.loggedIn !== true) return NONE;
    return { loggedIn: true, identity: {
      ...(typeof j.email === "string" && j.email ? { email: j.email } : {}),
      ...(typeof j.subscriptionType === "string" && j.subscriptionType ? { plan: j.subscriptionType } : {}),
    } };
  } catch { return NONE; }
}

export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** ADR-0234 · status login codex dari `auth.json` di CODEX_HOME — lokal, tanpa jaringan. */
export function probeCodexLogin(codexHome: string): LoginProbe {
  let j: { tokens?: { access_token?: unknown; id_token?: unknown } | null };
  try { j = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8")); } catch { return NONE; }
  const access = j.tokens?.access_token;
  if (typeof access !== "string" || !access) return NONE;
  const claims = typeof j.tokens?.id_token === "string" ? decodeJwtClaims(j.tokens.id_token) : null;
  const auth = claims?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: unknown } | undefined;
  return { loggedIn: true, identity: {
    ...(typeof claims?.email === "string" ? { email: claims.email } : {}),
    ...(typeof auth?.chatgpt_plan_type === "string" ? { plan: auth.chatgpt_plan_type } : {}),
  } };
}

export function nextStatus(loggedIn: boolean, everLoggedIn: boolean): RuntimeAccountStatus {
  return loggedIn ? "aktif" : everLoggedIn ? "perlu-login-ulang" : "belum-login";
}
