import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { sandboxArgv } from "../src/services/session-sandbox";
import { prisma } from "../src/db";

describe("SPEC-843 · mount lampiran di sandbox sesi", () => {
  const base = {
    command: "claude", worktree: "/w", credentialDir: "/cred",
    image: "img", network: "net", proxy: "http://p",
  };
  it("memasang direktori lampiran read-only bila ada", () => {
    const argv = sandboxArgv({ ...base, attachmentsDir: "/repo/.worktrees/.attachments/spec-1" });
    expect(argv.join(" ")).toContain(
      "/repo/.worktrees/.attachments/spec-1:/repo/.worktrees/.attachments/spec-1:ro");
  });
  it("tanpa lampiran argv tak berubah", () => {
    expect(sandboxArgv(base).join(" ")).not.toContain(".attachments");
  });
});

// Bukti bahwa daftar lampiran benar-benar SAMPAI ke prompt fase (AC-7). Digerbangi di titik
// `createSession` — di situlah prompt yang jadi argv sesi lahir — supaya tak perlu menyalakan tmux:
// socket tmux test dipakai bersama seluruh worktree di mesin ini, dan `killAll()` sesi tetangga
// membunuh sesi kita di tengah run.
const created: { prompt?: string; attachmentsDir?: string }[] = [];
vi.mock("../src/services/pty", async () => {
  const { sessionIdForSpec } = await import("../src/services/session-id");
  return {
    sessionIdForSpec,
    getSession: () => undefined,
    getSessionAsync: async () => undefined,
    listPanesAsync: async () => [],
    killSession: () => {},
    createSession: (_projectId: string, _cwd: string, opts: { prompt?: string; attachmentsDir?: string }) => {
      created.push({ prompt: opts.prompt, attachmentsDir: opts.attachmentsDir });
      return { id: "spec-9400" };
    },
  };
});

const { startSpecSession } = await import("../src/services/session-launch");

const uploads = mkdtempSync(join(tmpdir(), "hanoman-up-launch-"));
process.env.HANOMAN_UPLOAD_DIR = uploads;

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.localBinding.deleteMany();
};

function seedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-repo-launch-"));
  const env = {
    ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  };
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "root"], { env });
  return dir;
}

beforeEach(async () => { created.length = 0; await clean(); });
afterAll(clean);

describe("SPEC-843 · lampiran sampai ke prompt sesi", () => {
  it("prompt sesi memuat path absolut lampiran, dan sesi menerima direktorinya", async () => {
    const repoDir = seedRepo();
    await prisma.project.create({ data: { id: "pl", name: "PL", desc: "", kind: "existing", repoDir } });
    const spec = await prisma.spec.create({ data: {
      id: "SPEC-9400", projectId: "pl", title: "t", source: "brief", stage: "planned",
      author: "a", priority: "sedang", objective: "o",
      launchApprovedAt: new Date(), launchApprovedBy: "test",
    } });
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, "kk.log"), "boom\n");
    await prisma.specAttachment.create({ data: {
      specId: spec.id, projectId: "pl", filename: "error.log",
      mimeType: "text/plain", size: 5, storageKey: "kk.log",
    } });

    await startSpecSession(spec, { flow: "feature" });

    const expected = join(repoDir, ".worktrees", ".attachments", "spec-9400", "error.log");
    expect(created).toHaveLength(1);
    expect(created[0]!.prompt).toContain(expected);
    expect(created[0]!.prompt).toContain("AWAL SETIAP FASE");
    expect(created[0]!.attachmentsDir).toBe(join(repoDir, ".worktrees", ".attachments", "spec-9400"));
  });

  it("tanpa lampiran, sesi lahir tanpa direktori lampiran dan prompt tak menyebutnya", async () => {
    const repoDir = seedRepo();
    await prisma.project.create({ data: { id: "pl2", name: "PL2", desc: "", kind: "existing", repoDir } });
    const spec = await prisma.spec.create({ data: {
      id: "SPEC-9401", projectId: "pl2", title: "t", source: "brief", stage: "planned",
      author: "a", priority: "sedang", objective: "o",
      launchApprovedAt: new Date(), launchApprovedBy: "test",
    } });

    await startSpecSession(spec, { flow: "feature" });

    expect(created[0]!.attachmentsDir).toBeUndefined();
    expect(created[0]!.prompt).not.toContain("LAMPIRAN");
  });
});
