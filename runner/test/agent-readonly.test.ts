import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readOnlyDecision, writeReadOnlyHook } from "../src/agent-readonly";

const payload = (tool_name: string, command?: string) => ({
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input: command === undefined ? {} : { command },
});

describe("readOnlyDecision", () => {
  it.each([
    ["Bash", "rg -n customAgent server/src"],
    ["Bash", "git diff --no-ext-diff --no-textconv --stat HEAD~1"],
    ["Bash", "sed -n '1,80p' README.md"],
    ["Read", undefined],
    ["Glob", undefined],
  ])("allows an observable read: %s %s", (tool, command) => {
    expect(readOnlyDecision(payload(tool!, command))).toEqual({ allowed: true });
  });

  it.each([
    ["apply_patch", "*** Begin Patch"],
    ["Write", undefined],
    ["Edit", undefined],
    ["Task", undefined],
    ["mcp__db__write", undefined],
    ["Bash", "printf x > probe.txt"],
    ["Bash", "rg x . | tee out.txt"],
    ["Bash", "git reset --hard HEAD"],
    ["Bash", "sed -i '' s/x/y/ file"],
    ["Bash", "sed -i.bak s/x/y/ file"],
    ["Bash", "sed --in-place s/x/y/ file"],
    ["Bash", "rg $(touch probe) ."],
    ["Bash", "git diff --no-ext-diff --no-textconv --output=/tmp/owned HEAD"],
    ["Bash", "git show --no-ext-diff --no-textconv --output /tmp/owned HEAD"],
    ["Bash", "git diff --stat HEAD"],
    ["Bash", "rg --pre touch pattern ."],
    ["Bash", "rg --pre=touch pattern ."],
    ["Bash", "sed -n '1w /tmp/owned' README.md"],
    ["Bash", "sed -e '1e touch /tmp/owned' README.md"],
    ["Bash", "git diff $HANOMAN_UNTRUSTED_OPTION"],
    ["Bash", "./rg pattern ."],
    ["Bash", "/tmp/git status"],
  ])("denies mutation before execution: %s %s", (tool, command) => {
    const decision = readOnlyDecision(payload(tool!, command));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected read-only denial");
    expect(decision.reason).toContain("read-only");
  });

  it("denies malformed or unknown payloads instead of silently allowing them", () => {
    expect(readOnlyDecision({ tool_name: "Bash", tool_input: {} }).allowed).toBe(false);
    expect(readOnlyDecision({ tool_name: "unknown", tool_input: {} }).allowed).toBe(false);
    expect(readOnlyDecision(null).allowed).toBe(false);
  });

  it("denies rg when an inherited config can inject a preprocessor", () => {
    const decision = readOnlyDecision(
      payload("Bash", "rg pattern ."),
      { RIPGREP_CONFIG_PATH: "/tmp/hostile-ripgreprc" },
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected read-only denial");
    expect(decision.reason).toMatch(/RIPGREP_CONFIG_PATH/);
  });
});

describe("generated read-only hook", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("runs the same policy for Claude and Codex payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-readonly-"));
    dirs.push(dir);
    const hook = writeReadOnlyHook(dir);
    expect(hook.command).toBe(`node '${hook.path}'`);
    const allowed = spawnSync(process.execPath, [hook.path], {
      input: JSON.stringify(payload("Bash", "git status --short")), encoding: "utf8",
    });
    expect(allowed.status).toBe(0);

    const denied = spawnSync(process.execPath, [hook.path], {
      input: JSON.stringify({ ...payload("apply_patch", "*** Begin Patch"), turn_id: "t1" }),
      encoding: "utf8",
    });
    expect(denied.status).toBe(2);
    expect(denied.stderr).toContain("read-only");

    const hiddenPreprocessor = spawnSync(process.execPath, [hook.path], {
      input: JSON.stringify(payload("Bash", "rg pattern .")), encoding: "utf8",
      env: { ...process.env, RIPGREP_CONFIG_PATH: "/tmp/hostile-ripgreprc" },
    });
    expect(hiddenPreprocessor.status).toBe(2);
    expect(hiddenPreprocessor.stderr).toContain("RIPGREP_CONFIG_PATH");
  });
});
