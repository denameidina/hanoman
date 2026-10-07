import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { startSpecSession } from "../src/services/session-launch";
import { agentTempDir, killAll, killSession } from "../src/services/pty";

const clean = async () => {
  killAll();
  await prisma.memoryLocalState.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.setting.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany();
};
beforeEach(clean); afterAll(clean);

const argvOf = async (id: string): Promise<string> => {
  const read = () => execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman", "-f", "/dev/null",
    "capture-pane", "-p", "-J", "-S", "-2000", "-t", "hanoman-" + id], { encoding: "utf8" }).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
  return read();
};
async function seed(id: string, withMemory: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-mem-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "root"], { env });
  await prisma.project.create({ data: { id: "pm", name: "PM", desc: "", kind: "existing", repoDir: dir } });
  if (withMemory) await prisma.projectMemory.create({ data: { projectId: "pm", kind: "gotcha", content: "MEMORI-UJI-123",
    scopePaths: [], anchors: [], status: "active", sourceRuntime: "human" } });
  return prisma.spec.create({ data: { id, projectId: "pm", title: "t", source: "brief", stage: "planned", author: "a",
    priority: "sedang", objective: "o", launchApprovedAt: new Date(), launchApprovedBy: "test" } });
}

describe("memori tersuntik saat sesi backlog lahir", () => {
  it("claude: --append-system-prompt-file menunjuk berkas berisi memori", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const r = await startSpecSession(await seed("SPEC-MEM1", true), { flow: "feature" });
    const file = join(agentTempDir(r.id), "memory.md");
    expect(await argvOf(r.id)).toContain(`--append-system-prompt-file ${file}`);
    expect(readFileSync(file, "utf8")).toContain("MEMORI-UJI-123");
    killSession(r.id);
  });

  it("codex: -c developer_instructions dari memory.toml (sudah di-expand shell)", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const r = await startSpecSession(await seed("SPEC-MEM2", true), { flow: "feature", agent: "codex" });
    const argv = await argvOf(r.id);
    expect(argv).toContain("-c developer_instructions='''");
    expect(argv).toContain("MEMORI-UJI-123");
    killSession(r.id);
  });

  it("tanpa memori → tanpa flag", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const r = await startSpecSession(await seed("SPEC-MEM3", false), { flow: "feature" });
    expect(await argvOf(r.id)).not.toContain("append-system-prompt-file");
    killSession(r.id);
  });
});
