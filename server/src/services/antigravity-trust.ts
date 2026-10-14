import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function safeOwned(path: string, directory: boolean): void {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile())
    || (process.getuid && st.uid !== process.getuid())) throw new Error("unsafe path");
}

export function ensureAntigravityTrust(cwd: string, home: string = homedir()): void {
  let temp: string | undefined;
  let fd: number | undefined;
  try {
    const canonical = realpathSync(cwd);
    mkdirSync(home, { recursive: true });
    const root = realpathSync(home);
    for (const dir of [join(root, ".gemini"), join(root, ".gemini", "antigravity-cli")]) {
      if (!lstatSync(dir, { throwIfNoEntry: false })) mkdirSync(dir, { mode: 0o700 });
      safeOwned(dir, true);
    }
    const file = join(root, ".gemini", "antigravity-cli", "settings.json");
    const original = lstatSync(file, { throwIfNoEntry: false });
    let settings: Record<string, unknown> = {};
    if (original) {
      safeOwned(file, false);
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid settings");
      settings = parsed as Record<string, unknown>;
    }
    const trusted = settings.trustedWorkspaces;
    if (trusted !== undefined && (!Array.isArray(trusted) || trusted.some((value) => typeof value !== "string")))
      throw new Error("invalid trustedWorkspaces");
    const workspaces = (trusted ?? []) as string[];
    if (workspaces.includes(canonical)) return;
    const candidate = `${file}.${randomUUID()}.tmp`;
    fd = openSync(candidate, "wx", 0o600);
    temp = candidate; // Only an exclusive-created file belongs to this preparation.
    writeFileSync(fd, `${JSON.stringify({ ...settings, trustedWorkspaces: [...workspaces, canonical] }, null, 2)}\n`);
    closeSync(fd); fd = undefined;
    const latest = lstatSync(file, { throwIfNoEntry: false });
    if (original ? !latest || latest.ino !== original.ino || latest.mtimeMs !== original.mtimeMs : latest)
      throw new Error("settings changed during preparation");
    renameSync(temp, file); temp = undefined;
  } catch {
    // Settings may contain provider credentials; do not relay filesystem/parser details.
    throw new Error("antigravity-trust-preparation-failed");
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
    if (temp) try { unlinkSync(temp); } catch { /* cleanup best effort */ }
  }
}
