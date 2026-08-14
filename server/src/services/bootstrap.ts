import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TTL_MS = 15 * 60_000;
export const SETUP_TOKEN_FILE = "setup.token";

export class BootstrapError extends Error {
  readonly code = "BOOTSTRAP_PROOF";
}

type Stored = { token: string; expiresAt: number };
const tokenPath = (home: string) => join(home, SETUP_TOKEN_FILE);

async function readStored(home: string): Promise<Stored> {
  try {
    const info = await lstat(tokenPath(home));
    if (info.isSymbolicLink() || !info.isFile()) throw new BootstrapError("invalid setup proof");
    const [token, expires] = (await readFile(tokenPath(home), "utf8")).trim().split("\n");
    const expiresAt = Date.parse(expires ?? "");
    if (!token || !Number.isFinite(expiresAt)) throw new BootstrapError("invalid setup proof");
    return { token, expiresAt };
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError("invalid setup proof");
  }
}

export async function ensureSetupToken(home: string, now = Date.now()): Promise<{ path: string; expiresAt: number }> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const homeInfo = await lstat(home);
  if (homeInfo.isSymbolicLink() || !homeInfo.isDirectory()) throw new BootstrapError("invalid setup home");
  await chmod(home, 0o700);
  try {
    const existing = await readStored(home);
    if (existing.expiresAt > now) {
      await chmod(tokenPath(home), 0o600);
      return { path: tokenPath(home), expiresAt: existing.expiresAt };
    }
    await unlink(tokenPath(home));
  } catch (error) {
    if (!(error instanceof BootstrapError)) throw error;
    await unlink(tokenPath(home)).catch(() => {});
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + TTL_MS;
  try {
    await writeFile(tokenPath(home), `${token}\n${new Date(expiresAt).toISOString()}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return ensureSetupToken(home, now);
    throw error;
  }
  return { path: tokenPath(home), expiresAt };
}

export async function verifySetupToken(candidate: string, home: string, now = Date.now()): Promise<void> {
  const stored = await readStored(home);
  const got = createHash("sha256").update(candidate).digest();
  const want = createHash("sha256").update(stored.token).digest();
  if (stored.expiresAt <= now || !timingSafeEqual(got, want)) throw new BootstrapError("invalid setup proof");
}

export async function consumeSetupToken(home: string): Promise<void> {
  await unlink(tokenPath(home)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
