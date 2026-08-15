import { describe, expect, it } from "vitest";
import { assertRuntimeBoundary, sandboxArgv } from "../src/services/session-sandbox";

describe("production session sandbox", () => {
  it("fails closed for root, missing sandbox, or public bind without ingress", () => {
    const base = { NODE_ENV: "production", HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_PUBLIC_ORIGINS: "https://help.example", HANOMAN_CONTROL_ORIGINS: "https://admin.example",
      HANOMAN_TRUST_PROXY: "127.0.0.1/32" };
    expect(() => assertRuntimeBoundary(base, { uid: 0, host: "127.0.0.1" })).toThrow(/non-root/);
    expect(() => assertRuntimeBoundary({ ...base, HANOMAN_SESSION_SANDBOX: undefined }, { uid: 1000, host: "127.0.0.1" })).toThrow(/SESSION_SANDBOX/);
    expect(() => assertRuntimeBoundary({ NODE_ENV: "production", HANOMAN_SESSION_SANDBOX: "podman" }, { uid: 1000, host: "0.0.0.0" })).toThrow(/origin/);
  });

  // SPEC-805 · single-origin hanya boleh lewat pengakuan eksplisit, bukan dengan mengosongkan env.
  it("accepts single origin only when acknowledged explicitly (SPEC-805)", () => {
    const single = { NODE_ENV: "production", HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_CONTROL_ORIGINS: "https://admin.example", HANOMAN_TRUST_PROXY: "127.0.0.1/32" };
    expect(() => assertRuntimeBoundary(single, { uid: 1000, host: "127.0.0.1" })).toThrow(/origin/);
    expect(() => assertRuntimeBoundary({ ...single, HANOMAN_SINGLE_ORIGIN: "1" }, { uid: 1000, host: "127.0.0.1" }))
      .not.toThrow();
    // pengakuan itu tak menghapus syarat lain, dan control origin tetap wajib
    expect(() => assertRuntimeBoundary({ ...single, HANOMAN_SINGLE_ORIGIN: "1", HANOMAN_CONTROL_ORIGINS: undefined },
      { uid: 1000, host: "127.0.0.1" })).toThrow(/origin/);
    expect(() => assertRuntimeBoundary({ ...single, HANOMAN_SINGLE_ORIGIN: "1", HANOMAN_TRUST_PROXY: undefined },
      { uid: 1000, host: "127.0.0.1" })).toThrow(/proxy/);
  });

  it("builds a rootless, narrow-mount, internal-network Podman invocation", () => {
    const argv = sandboxArgv({
      command: "claude --dangerously-skip-permissions", worktree: "/srv/repo/.worktrees/spec-1",
      phaseFile: "/srv/state/phases/spec-1", promptFile: "/srv/state/prompts/spec-1",
      credentialDir: "/srv/state/credentials/spec-1", image: "hanoman-agent:1",
      network: "hanoman-egress", proxy: "http://egress.internal:3128",
    });
    expect(argv).toEqual(expect.arrayContaining([
      "podman", "run", "--rm", "--read-only", "--cap-drop=ALL", "--userns=keep-id",
      "--network", "hanoman-egress", "--pids-limit", "512",
    ]));
    expect(argv.join(" ")).toContain("/workspace:rw");
    expect(argv.join(" ")).not.toContain("/Users/");
    expect(argv.at(-3)).toBe("/bin/sh");
    expect(argv.at(-1)).toContain("claude --dangerously-skip-permissions");
  });
});
