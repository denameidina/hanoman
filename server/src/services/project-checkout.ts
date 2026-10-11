import { execFile, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { realGit, resolveHome } from "@hanoman/runner";
import { prisma } from "../db";
import { gitAuthEnv, httpsRemote, isGithubHttps } from "./git-auth";
import { resolveGitToken } from "./git-token";
import { setBinding } from "./local-binding";

const execFileAsync = promisify(execFile);

// ADR-0203 · checkout otomatis. Clone ASINKRON (execFile, bukan spawnSync): clone repo besar bisa
// berjalan menit, dan spawnSync akan membekukan event loop server — kelas bug yang sama dengan
// SPEC-742 (ADR-0116) pada penghapusan worktree.
export type CheckoutErrorKind = "not-found" | "no-remote" | "auth" | "clone" | "occupied";
export class CheckoutError extends Error {
  constructor(message: string, readonly kind: CheckoutErrorKind, readonly detail?: string) { super(message); }
}

const CLONE_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 2 * 60_000;
const AUTH_RE = /Authentication failed|could not read (Username|Password)|Invalid username or password|HTTP 40[13]|returned error: 40[13]|Repository not found|Permission denied \(publickey\)/i;

export const checkoutRoot = (): string => join(resolveHome(), "projects");
const slug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
const sameRemote = (a: string, b: string): boolean => {
  const norm = (u: string) => httpsRemote(u).replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
};
const redact = (text: string, token: string | null): string => (token ? text.split(token).join("***") : text);

type RunResult = { ok: true } | { ok: false; stderr: string };
async function runGit(args: string[], o: { cwd?: string; token: string | null; timeout: number }): Promise<RunResult> {
  // `credential.helper=` (kosong) mereset daftar helper: keychain mesin tak boleh menjawab lebih dulu
  // dan membuat token hanoman diam-diam tidak terpakai.
  const full = o.token ? ["-c", "credential.helper=", ...args] : args;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(o.token ? gitAuthEnv(o.token) : {}) };
  try {
    await execFileAsync("git", full, { cwd: o.cwd, env, timeout: o.timeout, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, stderr: redact(String(err.stderr || err.message || "git gagal"), o.token) };
  }
}

const isEmptyDir = (dir: string): boolean => { try { return readdirSync(dir).length === 0; } catch { return false; } };
function originOf(dir: string): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function doClone(projectId: string, opts: { dir?: string; token?: string | null }): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new CheckoutError(`project "${projectId}" tidak ada`, "not-found");
  if (!project.gitRemote) throw new CheckoutError(`project "${projectId}" tidak punya gitRemote untuk di-clone`, "no-remote");
  const remote = project.gitRemote;
  const dest = opts.dir ?? join(checkoutRoot(), slug(project.id));

  if (existsSync(dest) && !isEmptyDir(dest)) {
    const origin = originOf(dest);
    if (origin && sameRemote(origin, remote)) { await setBinding(projectId, dest); return dest; }
    throw new CheckoutError(`folder ${dest} sudah berisi hal lain, tidak ditimpa`, "occupied");
  }

  const url = httpsRemote(remote);
  const token = opts.token !== undefined ? opts.token : await resolveGitToken();
  const useAuth = !!token && isGithubHttps(url);
  const res = await runGit(["clone", "--", useAuth ? url : remote, dest], {
    token: useAuth ? token : null, timeout: CLONE_TIMEOUT_MS,
  });
  if (!res.ok) {
    rmSync(dest, { recursive: true, force: true }); // hanya mungkin absen/kosong di titik ini
    const auth = AUTH_RE.test(res.stderr);
    throw new CheckoutError(
      auth
        ? (useAuth
          ? `token GitHub ditolak atau tanpa akses ke ${remote}`
          : `akses ke ${remote} ditolak: isi GITHUB_TOKEN di Settings atau hubungkan instance ini ke hub`)
        : `git clone ${remote} gagal`,
      auth ? "auth" : "clone", res.stderr.trim().slice(0, 2000),
    );
  }
  await setBinding(projectId, dest);
  return dest;
}

const inflight = new Map<string, Promise<string>>();
/** Clone (atau pakai ulang) checkout project di mesin ini lalu pasang binding. Satu clone per project. */
export function cloneProjectCheckout(projectId: string, opts: { dir?: string; token?: string | null } = {}): Promise<string> {
  const running = inflight.get(projectId);
  if (running) return running;
  const p = doClone(projectId, opts).finally(() => inflight.delete(projectId));
  inflight.set(projectId, p);
  return p;
}

/**
 * Branch dasar sebuah spec bisa hanya ada di device lain. Bila ref tak ada lokal maupun di
 * `origin/*`, ambil dari origin. Best-effort: gagal tidak melempar — `addWorktree` yang
 * menyebut revisi mana yang tak resolve (ADR-0009), dan tak ada fallback diam-diam ke HEAD.
 */
export async function fetchRefIfMissing(repoDir: string, rev: string | null | undefined, token?: string | null): Promise<void> {
  if (!rev) return;
  if (realGit.revParse(repoDir, rev) || realGit.revParse(repoDir, `origin/${rev}`)) return;
  const origin = originOf(repoDir);
  if (!origin) return;
  const t = token !== undefined ? token : await resolveGitToken();
  const useAuth = !!t && isGithubHttps(httpsRemote(origin));
  await runGit(["fetch", "origin"], { cwd: repoDir, token: useAuth ? t : null, timeout: FETCH_TIMEOUT_MS });
}
