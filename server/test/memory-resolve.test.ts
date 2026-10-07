import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encodeRepoHeader } from "@hanoman/shared";
import { prisma } from "../src/db";
import { resolveMemoryScope } from "../src/services/memory/resolve";

let dir = ""; let root = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const hdr = (o: Partial<{ remote: string; rootCommit: string; head: string }> = {}) =>
  encodeRepoHeader({ remote: "git@github.com:acme/alpha.git", rootCommit: root, head, ...o });
const agent = (projectIds: string[] | null) => ({ kind: "agent" as const, tokenId: "t1", projectIds });

const clean = async () => {
  await prisma.localBinding.deleteMany({ where: { projectId: { in: ["mr-a", "mr-b", "mr-c"] } } });
  await prisma.project.deleteMany({ where: { id: { in: ["mr-a", "mr-b", "mr-c"] } } });
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-res-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "a"), "1"); g("add", "."); g("commit", "-qm", "1");
  root = g("rev-parse", "HEAD"); head = root;
});
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "mr-a", name: "a", desc: "", kind: "app", gitRemote: "https://github.com/acme/alpha", repoDir: dir } });
  await prisma.project.create({ data: { id: "mr-b", name: "b", desc: "", kind: "app", gitRemote: "https://github.com/acme/beta" } });
});
afterAll(clean);

describe("resolveMemoryScope · agent token", () => {
  it("remote cocok + diizinkan → scope dengan head terverifikasi", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr() });
    expect(r).toEqual({ ok: true, scope: { projectId: "mr-a", repoDir: dir, head, headVerified: true } });
  });
  it("agent mengirim projectId → 400", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr(), projectId: "mr-a" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it("token tanpa allowlist → 403 need projectIds", async () => {
    for (const ids of [null, []]) {
      const r = await resolveMemoryScope(agent(ids), { repoHeader: hdr() });
      expect(r).toMatchObject({ ok: false, status: 403, body: { need: "projectIds" } });
    }
  });
  it("tanpa header / header rusak → 400", async () => {
    expect(await resolveMemoryScope(agent(["mr-a"]), {})).toMatchObject({ ok: false, status: 400 });
    expect(await resolveMemoryScope(agent(["mr-a"]), { repoHeader: "rusak" })).toMatchObject({ ok: false, status: 400 });
  });
  it("ANTI-BOCOR: token untuk A dengan remote B → 403, bukan scope B", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ remote: "git@github.com:acme/beta.git" }) });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it("remote tak dikenal → 404", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ remote: "git@github.com:acme/zzz.git" }) });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
  it("root commit beda dari checkout project → 404 (remote dipalsukan)", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ rootCommit: "c".repeat(40) }) });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
  it("head tak ada di checkout server → headVerified false", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ head: "d".repeat(40) }) });
    expect(r).toMatchObject({ ok: true, scope: { headVerified: false } });
  });
  it("project tanpa checkout → scope tanpa repoDir, headVerified false", async () => {
    const r = await resolveMemoryScope(agent(["mr-b"]), { repoHeader: hdr({ remote: "git@github.com:acme/beta.git" }) });
    expect(r).toEqual({ ok: true, scope: { projectId: "mr-b", repoDir: null, head, headVerified: false } });
  });
  it("dua project se-remote yang sama-sama diizinkan → 409", async () => {
    await prisma.project.create({ data: { id: "mr-c", name: "c", desc: "", kind: "app", gitRemote: "git@github.com:acme/alpha.git" } });
    const r = await resolveMemoryScope(agent(["mr-a", "mr-c"]), { repoHeader: hdr() });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("resolveMemoryScope · cookie", () => {
  it("projectId wajib", async () => {
    expect(await resolveMemoryScope({ kind: "user", userId: "u" }, {})).toMatchObject({ ok: false, status: 400 });
  });
  it("project tak ada → 404", async () => {
    expect(await resolveMemoryScope({ kind: "user", userId: "u" }, { projectId: "nope" })).toMatchObject({ ok: false, status: 404 });
  });
  it("head diambil dari checkout project", async () => {
    const r = await resolveMemoryScope({ kind: "user", userId: "u" }, { projectId: "mr-a" });
    expect(r).toEqual({ ok: true, scope: { projectId: "mr-a", repoDir: dir, head, headVerified: true } });
  });
});
