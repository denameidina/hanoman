import { chmod, lstat, mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export class HomePermissionError extends Error {
  readonly code = "HOME_SYMLINK";
}

async function assertNoSymlink(path: string, allowMissing: boolean): Promise<void> {
  try {
    const info = await lstat(resolve(path));
    if (info.isSymbolicLink()) throw new HomePermissionError(`symlink ditolak: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) return;
    throw error;
  }
}

export async function secureHanomanHome(opts: {
  home: string; files?: string[]; directories?: string[];
}): Promise<void> {
  if (!isAbsolute(opts.home)) throw new HomePermissionError("HANOMAN_HOME harus absolut");
  await assertNoSymlink(opts.home, true);
  await mkdir(opts.home, { recursive: true, mode: 0o700 });
  await assertNoSymlink(opts.home, false);
  await chmod(opts.home, 0o700);
  for (const directory of opts.directories ?? []) {
    await assertNoSymlink(directory, true);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertNoSymlink(directory, false);
    await chmod(directory, 0o700);
  }
  for (const file of opts.files ?? []) {
    await assertNoSymlink(file, true);
    try { await chmod(file, 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
