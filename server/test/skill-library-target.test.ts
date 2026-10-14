import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { targetParent } from "../src/services/skill-library";
import { methodStatusReport } from "../src/services/method-status";

let home: string | undefined;
afterEach(() => { vi.unstubAllEnvs(); if (home) rmSync(home, { recursive: true, force: true }); });
it("native Antigravity source is allowed only for user and rejects traversal", async () => {
  home = mkdtempSync(join(tmpdir(), "agy-source-")); vi.stubEnv("HOME", home);
  await expect(targetParent("user", ".gemini/antigravity-cli", undefined)).resolves.toBe(join(home, ".gemini/antigravity-cli/skills"));
  await expect(targetParent("project", ".gemini/antigravity-cli", "p1")).rejects.toThrow("source project");
  await expect(targetParent("user", ".gemini/antigravity-cli/../../outside", undefined)).rejects.toThrow("source user");
});
it("method status observes native installed skills while installation remains unavailable", () => {
  home = mkdtempSync(join(tmpdir(), "agy-status-")); vi.stubEnv("HOME", home);
  const skill = join(home, ".gemini/antigravity-cli/skills/native"); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: native\ndescription: Native skill\n---\n");
  const report = methodStatusReport({});
  expect(report.agents.find((agent) => agent.agent === "antigravity")).toMatchObject({ home: join(home, ".gemini/antigravity-cli"), skills: 1 });
  expect(report.methods.filter((method) => method.agent === "antigravity").every((method) => method.available === false && !method.ready && !method.install.length)).toBe(true);
});
