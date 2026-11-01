import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeKeychainService, readClaudeKeychainToken } from "../src/services/runtime-accounts/keychain";
import { decodeJwtClaims, nextStatus, probeClaudeLogin, probeCodexLogin } from "../src/services/runtime-accounts/identity";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

describe("keychain claude", () => {
  it("service = Claude Code-credentials-<sha256(dir) 8 hex>", () => {
    const dir = "/Users/x/.hanoman/accounts/claude/a1b2c3d4";
    const h = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(claudeKeychainService(dir)).toBe(`Claude Code-credentials-${h}`);
  });

  it("akun user macOS dulu, lalu tanpa -a; token kosong dilewati", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args.includes("-a")) return JSON.stringify({ claudeAiOauth: { accessToken: "" } });
      return JSON.stringify({ claudeAiOauth: { accessToken: "tok-2" } });
    };
    expect(readClaudeKeychainToken("svc", run, "dena")).toBe("tok-2");
    expect(calls[0]).toEqual(["find-generic-password", "-s", "svc", "-a", "dena", "-w"]);
  });

  it("entri tak ada → null", () => {
    expect(readClaudeKeychainToken("svc", () => { throw new Error("44"); }, "dena")).toBeNull();
  });
});

describe("probeClaudeLogin", () => {
  it("loggedIn true → identitas email + plan; env config dir & tanpa token env", async () => {
    let seen: NodeJS.ProcessEnv = {};
    const run = async (_b: string, args: string[], env: NodeJS.ProcessEnv) => {
      seen = env;
      expect(args).toEqual(["auth", "status", "--json"]);
      return JSON.stringify({ loggedIn: true, email: "ops@x.id", subscriptionType: "max" });
    };
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "bocor";
    try {
      expect(await probeClaudeLogin("/h/acct", run, "claude")).toEqual({ loggedIn: true, identity: { email: "ops@x.id", plan: "max" } });
    } finally { delete process.env.CLAUDE_CODE_OAUTH_TOKEN; }
    expect(seen.CLAUDE_CONFIG_DIR).toBe("/h/acct");
    expect(seen.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("loggedIn false / keluaran rusak → tak login", async () => {
    expect(await probeClaudeLogin("/h", async () => JSON.stringify({ loggedIn: false }), "claude")).toEqual({ loggedIn: false, identity: null });
    expect(await probeClaudeLogin("/h", async () => "bukan json", "claude")).toEqual({ loggedIn: false, identity: null });
  });
});

describe("probeCodexLogin", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ra-codex-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("auth.json ChatGPT → email + plan dari klaim id_token", () => {
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: {
      access_token: "a", id_token: jwt({ email: "c@x.id", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }) } }));
    expect(probeCodexLogin(dir)).toEqual({ loggedIn: true, identity: { email: "c@x.id", plan: "pro" } });
  });

  it("auth.json absen / tanpa access_token → tak login", () => {
    expect(probeCodexLogin(dir)).toEqual({ loggedIn: false, identity: null });
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokens: null }));
    expect(probeCodexLogin(dir)).toEqual({ loggedIn: false, identity: null });
  });

  it("decodeJwtClaims tahan token rusak", () => {
    expect(decodeJwtClaims("x")).toBeNull();
    expect(decodeJwtClaims("a.!!!.c")).toBeNull();
  });
});

describe("nextStatus", () => {
  it("login → aktif; belum pernah → belum-login; pernah lalu hilang → perlu-login-ulang", () => {
    expect(nextStatus(true, false)).toBe("aktif");
    expect(nextStatus(false, false)).toBe("belum-login");
    expect(nextStatus(false, true)).toBe("perlu-login-ulang");
  });
});
