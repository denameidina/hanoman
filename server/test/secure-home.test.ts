import { describe, expect, it } from "vitest";
import { lstat, mkdtemp, mkdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HomePermissionError, secureHanomanHome } from "../src/services/secure-home";

describe("HANOMAN_HOME permissions", () => {
  it("repairs private directory and sensitive file modes idempotently", async () => {
    const parent = await mkdtemp(join(tmpdir(), "hanoman-home-parent-"));
    const home = join(parent, "home");
    await mkdir(home, { mode: 0o755 });
    const db = join(home, "hanoman.db");
    await writeFile(db, "db", { mode: 0o644 });
    const uploads = join(home, "uploads");
    await mkdir(uploads, { mode: 0o755 });
    await secureHanomanHome({ home, files: [db], directories: [uploads] });
    await secureHanomanHome({ home, files: [db], directories: [uploads] });
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(uploads)).mode & 0o777).toBe(0o700);
    expect((await stat(db)).mode & 0o777).toBe(0o600);
  });

  it("rejects a symlink at every managed boundary", async () => {
    const parent = await mkdtemp(join(tmpdir(), "hanoman-home-link-"));
    const target = join(parent, "target");
    await mkdir(target);
    const home = join(parent, "home");
    await symlink(target, home);
    await expect(secureHanomanHome({ home })).rejects.toBeInstanceOf(HomePermissionError);
    expect((await lstat(home)).isSymbolicLink()).toBe(true);
  });
});
