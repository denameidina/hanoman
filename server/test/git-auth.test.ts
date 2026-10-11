import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { gitAuthEnv, httpsRemote, isGithubHttps } from "../src/services/git-auth";

describe("httpsRemote", () => {
  it("mengubah remote SSH GitHub ke HTTPS", () => {
    expect(httpsRemote("git@github.com:acme/app.git")).toBe("https://github.com/acme/app.git");
    expect(httpsRemote("ssh://git@github.com/acme/app.git")).toBe("https://github.com/acme/app.git");
  });
  it("membiarkan remote lain apa adanya", () => {
    expect(httpsRemote("https://github.com/acme/app.git")).toBe("https://github.com/acme/app.git");
    expect(httpsRemote("git@gitlab.com:acme/app.git")).toBe("git@gitlab.com:acme/app.git");
    expect(httpsRemote("/tmp/lokal/repo")).toBe("/tmp/lokal/repo");
  });
});

describe("isGithubHttps", () => {
  it("hanya true untuk https://github.com/", () => {
    expect(isGithubHttps("https://github.com/acme/app.git")).toBe(true);
    expect(isGithubHttps("https://evil.example/github.com/x.git")).toBe(false);
    expect(isGithubHttps("git@github.com:acme/app.git")).toBe(false);
  });
});

describe("gitAuthEnv", () => {
  it("askpass menjawab username dan token, tanpa menulis token ke disk", () => {
    const env = gitAuthEnv("tok_123");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    const run = (prompt: string) =>
      spawnSync(env.GIT_ASKPASS!, [prompt], { env: { HANOMAN_GIT_TOKEN: "tok_123" }, encoding: "utf8" }).stdout;
    expect(run("Username for 'https://github.com': ")).toBe("x-access-token\n");
    expect(run("Password for 'https://x-access-token@github.com': ")).toBe("tok_123\n");
    const script = spawnSync("cat", [env.GIT_ASKPASS!], { encoding: "utf8" }).stdout;
    expect(script).not.toContain("tok_123");
  });
});
