import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAccountHome, inspectAccountHome, mirrorClaudeJson } from "../src/services/runtime-accounts/home";

let root: string, base: string, acct: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ra-home-"));
  base = join(root, "base"); acct = join(root, "acct");
  mkdirSync(join(base, "skills"), { recursive: true });
  writeFileSync(join(base, "settings.json"), "{}");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("ensureAccountHome", () => {
  it("membuat home 0700 dan symlink entri bersama yang ADA di home bawaan", () => {
    const r = ensureAccountHome("claude", acct, base);
    expect(statSync(acct).mode & 0o777).toBe(0o700);
    expect(r.linked.sort()).toEqual(["settings.json", "skills"]);
    expect(readlinkSync(join(acct, "skills"))).toBe(join(base, "skills"));
    expect(existsSync(join(acct, "plugins"))).toBe(false);   // target belum ada → dilewati
  });

  it("idempoten: panggilan kedua tak memasang apa pun", () => {
    ensureAccountHome("claude", acct, base);
    expect(ensureAccountHome("claude", acct, base)).toEqual({ linked: [], drift: [] });
  });

  it("target yang baru muncul dipasang di panggilan berikutnya", () => {
    ensureAccountHome("claude", acct, base);
    mkdirSync(join(base, "plugins"));
    expect(ensureAccountHome("claude", acct, base).linked).toEqual(["plugins"]);
  });

  it("berkas biasa yang menggantikan symlink = drift, TIDAK ditimpa", () => {
    ensureAccountHome("claude", acct, base);
    unlinkSync(join(acct, "settings.json"));
    writeFileSync(join(acct, "settings.json"), '{"milik":"cli"}');
    const r = ensureAccountHome("claude", acct, base);
    expect(r.drift).toEqual(["settings.json"]);
    expect(readFileSync(join(acct, "settings.json"), "utf8")).toBe('{"milik":"cli"}');
    expect(inspectAccountHome("claude", acct, base)).toEqual(["settings.json"]);
  });

  it("symlink ke tempat lain = drift", () => {
    mkdirSync(acct, { recursive: true });
    symlinkSync(join(root, "lain"), join(acct, "skills"));
    expect(ensureAccountHome("claude", acct, base).drift).toEqual(["skills"]);
    expect(lstatSync(join(acct, "skills")).isSymbolicLink()).toBe(true);
  });

  it("codex memakai daftar entrinya sendiri", () => {
    writeFileSync(join(base, "config.toml"), "");
    expect(ensureAccountHome("codex", acct, base).linked.sort()).toEqual(["config.toml", "skills"]);
  });

  it("menghapus home akun TIDAK menghapus target symlink di home bawaan", () => {
    ensureAccountHome("claude", acct, base);
    rmSync(acct, { recursive: true, force: true });
    expect(existsSync(join(base, "skills"))).toBe(true);
    expect(existsSync(join(base, "settings.json"))).toBe(true);
  });
});

describe("mirrorClaudeJson", () => {
  it("menyalin kunci bersama dan mempertahankan kunci milik akun", () => {
    const baseJson = join(root, "base.claude.json");
    writeFileSync(baseJson, JSON.stringify({ mcpServers: { a: { command: "x" } }, hasCompletedOnboarding: true, oauthAccount: { emailAddress: "bawaan@x" } }));
    mkdirSync(acct, { recursive: true });
    writeFileSync(join(acct, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "akun@x" } }));
    mirrorClaudeJson(acct, baseJson);
    const got = JSON.parse(readFileSync(join(acct, ".claude.json"), "utf8"));
    expect(got.mcpServers).toEqual({ a: { command: "x" } });
    expect(got.hasCompletedOnboarding).toBe(true);
    expect(got.oauthAccount).toEqual({ emailAddress: "akun@x" });
    expect(statSync(join(acct, ".claude.json")).mode & 0o777).toBe(0o600);
  });

  it("berkas bawaan tak terbaca → tak menulis apa pun", () => {
    mkdirSync(acct, { recursive: true });
    mirrorClaudeJson(acct, join(root, "tidak-ada.json"));
    expect(existsSync(join(acct, ".claude.json"))).toBe(false);
  });
});
