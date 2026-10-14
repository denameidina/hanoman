import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { createAntigravityEnvBootstrap, cleanupAntigravityEnvBootstrap } from "../src/services/antigravity-env-bootstrap";

describe("Antigravity private launch bootstrap", () => {
  it("executes with current secrets without including them in the command and consumes private state", () => {
    const bootstrap = createAntigravityEnvBootstrap('/usr/bin/printf "%s" "$GEMINI_API_KEY"', { GEMINI_API_KEY: "fixture'\n`$()value", GOOGLE_GEMINI_BASE_URL: "https://fixture.invalid" });
    expect(bootstrap.command.includes("fixture")).toBe(false);
    expect(lstatSync(bootstrap.directory).mode & 0o777).toBe(0o700);
    expect(lstatSync(bootstrap.path).mode & 0o777).toBe(0o600);
    const output = execFileSync("/bin/sh", ["-c", bootstrap.command], { encoding: "utf8" });
    expect(output === "fixture'\n`$()value").toBe(true);
    expect(existsSync(bootstrap.directory)).toBe(false);
    cleanupAntigravityEnvBootstrap(bootstrap.receipt);
  });
  it("cleans a failed spawn using persisted identity after restart", () => {
    const bootstrap = createAntigravityEnvBootstrap("exit 0", { GEMINI_API_KEY: "fixture" });
    cleanupAntigravityEnvBootstrap(JSON.parse(JSON.stringify(bootstrap.receipt)));
    expect(existsSync(bootstrap.directory)).toBe(false);
  });
  it("preserves operator replacement and rejects unsafe cleanup receipts", () => {
    const bootstrap = createAntigravityEnvBootstrap("exit 0", { GEMINI_API_KEY: "fixture" });
    const old = `${bootstrap.path}.old`; renameSync(bootstrap.path, old); writeFileSync(bootstrap.path, "operator", { mode: 0o600 });
    cleanupAntigravityEnvBootstrap(bootstrap.receipt);
    expect(readFileSync(bootstrap.path, "utf8")).toBe("operator");
    unlinkSync(old); rmSync(bootstrap.directory, { recursive: true });
    cleanupAntigravityEnvBootstrap({ directory: "/", ino: 1, dev: 1 });
  });
});

it("consumes launch state despite a stale tmux TMPDIR", () => {
  const bootstrap = createAntigravityEnvBootstrap("/usr/bin/printf ready", {});
  try {
    expect(execFileSync("/bin/sh", ["-c", bootstrap.command], { encoding: "utf8", env: { ...process.env, TMPDIR: "/tmp/stale-daemon" } })).toBe("ready");
    expect(existsSync(bootstrap.directory)).toBe(false);
  } finally { cleanupAntigravityEnvBootstrap(bootstrap.receipt); }
});
