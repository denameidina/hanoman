import { describe, expect, it } from "vitest";
import { resolveMcpConfig } from "../src/mcp/config";

const noFile = () => null;

describe("resolveMcpConfig", () => {
  it("membaca host & token dari env", () => {
    const c = resolveMcpConfig([], { HANOMAN_HOST: "http://localhost:8787", HANOMAN_AGENT_TOKEN: "hnm_agt_x" }, noFile);
    expect(c).toMatchObject({ host: "http://localhost:8787", token: "hnm_agt_x", level: "default", problems: [] });
  });

  it("flag --host mengalahkan env", () => {
    const c = resolveMcpConfig(["--host", "https://a.example"], { HANOMAN_HOST: "http://b", HANOMAN_AGENT_TOKEN: "t" }, noFile);
    expect(c.host).toBe("https://a.example");
  });

  it("membuang garis miring di ujung host supaya path tak jadi ganda", () => {
    expect(resolveMcpConfig([], { HANOMAN_HOST: "http://x:8787/", HANOMAN_AGENT_TOKEN: "t" }, noFile).host).toBe("http://x:8787");
  });

  it("token TIDAK PERNAH dari flag — ARGV terbaca ps", () => {
    const c = resolveMcpConfig(["--token", "hnm_agt_rahasia"], { HANOMAN_HOST: "http://x" }, noFile);
    expect(c.token).toBe("");
    expect(c.problems.join(" ")).toContain("HANOMAN_AGENT_TOKEN");
    expect(c.problems.join(" ")).not.toContain("hnm_agt_rahasia");
  });

  it("jatuh ke berkas token bila env kosong", () => {
    const c = resolveMcpConfig([], { HANOMAN_HOST: "http://x" }, () => "  hnm_agt_dariberkas\n");
    expect(c.token).toBe("hnm_agt_dariberkas");
    expect(c.problems).toEqual([]);
  });

  it("host kosong jadi KELUHAN, bukan default diam-diam — token per-instance", () => {
    const c = resolveMcpConfig([], { HANOMAN_AGENT_TOKEN: "t" }, noFile);
    expect(c.host).toBe("");
    expect(c.problems.join(" ")).toContain("HANOMAN_HOST");
  });

  it("host tanpa skema ditolak dengan kalimat, bukan diperbaiki diam-diam", () => {
    const c = resolveMcpConfig([], { HANOMAN_HOST: "localhost:8787", HANOMAN_AGENT_TOKEN: "t" }, noFile);
    expect(c.problems.join(" ")).toMatch(/http:\/\/ atau https:\/\//);
  });

  // ADR-0155 · TIGA tingkat. Yang lebih sempit selalu menang, apa pun urutan argumen: memilih yang
  // lebih longgar diam-diam adalah cara paling mudah membuat seseorang menyalakan permukaan
  // berbahaya tanpa sadar.
  const base = { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t" };
  const lvl = (argv: string[], env: Record<string, string> = {}) =>
    resolveMcpConfig(argv, { ...base, ...env }, noFile).level;

  it("mode baca-saja dari flag maupun env", () => {
    expect(lvl(["--read-only"])).toBe("read-only");
    expect(lvl([], { HANOMAN_MCP_READ_ONLY: "1" })).toBe("read-only");
    expect(lvl([], { HANOMAN_MCP_READ_ONLY: "0" })).toBe("default");
  });

  it("tingkat danger dari flag maupun env", () => {
    expect(lvl([])).toBe("default");
    expect(lvl(["--danger"])).toBe("danger");
    expect(lvl([], { HANOMAN_MCP_DANGER: "1" })).toBe("danger");
    expect(lvl([], { HANOMAN_MCP_DANGER: "true" })).toBe("danger");
    expect(lvl([], { HANOMAN_MCP_DANGER: "0" })).toBe("default");
  });

  it("read-only MENANG atas danger, apa pun urutannya, lewat flag maupun env", () => {
    expect(lvl(["--danger", "--read-only"])).toBe("read-only");
    expect(lvl(["--read-only", "--danger"])).toBe("read-only");
    expect(lvl(["--read-only"], { HANOMAN_MCP_DANGER: "1" })).toBe("read-only");
    expect(lvl(["--danger"], { HANOMAN_MCP_READ_ONLY: "1" })).toBe("read-only");
  });

  it("keduanya sekaligus MENGELUH, bukan diam", () => {
    const c = resolveMcpConfig(["--danger", "--read-only"], base, noFile);
    expect(c.problems.join(" ")).toMatch(/--danger diabaikan/i);
    // Tingkat yang lebih sempit tetap berlaku; keluhan bukan galat.
    expect(c.level).toBe("read-only");
  });

  it("maxBytes bisa disetel, nilai ngawur jatuh ke default", () => {
    expect(resolveMcpConfig(["--max-bytes", "4096"], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t" }, noFile).maxBytes).toBe(4096);
    expect(resolveMcpConfig([], { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "t", HANOMAN_MCP_MAX_BYTES: "abc" }, noFile).maxBytes).toBe(24 * 1024);
  });
});
