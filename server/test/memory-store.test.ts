import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import type { MemoryScope } from "../src/services/memory/resolve";
import {
  getMemory, invalidateMemory, proposeMemory, reverifyMemory, reviewMemory, searchMemories, supersedeMemory,
} from "../src/services/memory/store";

let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const actor = { kind: "token" as const, id: "tok1" };
let scope: MemoryScope;
const unverified = (): MemoryScope => ({ ...scope, repoDir: null, headVerified: false });
const base = { kind: "gotcha" as const, scopePaths: [] as string[], anchors: [] as { path: string; blobSha?: string }[] };

const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: { in: ["ms-a", "ms-b"] } } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-store-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(join(dir, "server")); writeFileSync(join(dir, "server/db.ts"), "x\n");
  g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "ms-a", name: "a", desc: "", kind: "app", repoDir: dir } });
  await prisma.project.create({ data: { id: "ms-b", name: "b", desc: "", kind: "app" } });
  scope = { projectId: "ms-a", repoDir: dir, head, headVerified: true };
});
afterAll(clean);

const anchored = { ...base, anchors: [{ path: "server/db.ts" }] };

describe("proposeMemory", () => {
  it("jangkar terverifikasi server → langsung active, blobSha diisi server, event propose+activate", async () => {
    const r = await proposeMemory(scope, actor, { ...anchored, content: "DB test dihapus global-setup tiap run" });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.memory.status).toBe("active");
    expect(r.memory.anchors[0]!.blobSha).toBe(g("rev-parse", `${head}:server/db.ts`));
    expect(r.memory.source).toMatchObject({ runtime: "external", tokenId: "tok1", commitSha: head });
    const ev = await prisma.memoryEvent.findMany({ where: { memoryId: r.memory.id }, orderBy: { createdAt: "asc" } });
    // propose & activate lahir dalam satu transaksi → createdAt bisa seri; urutan tak dijanjikan.
    expect(ev.map((e) => e.op).sort()).toEqual(["activate", "propose"]);
  });

  it("tanpa jangkar → proposed, reviewReason no-anchor", async () => {
    const r = await proposeMemory(scope, actor, { ...base, content: "fakta tanpa jangkar" });
    expect(r).toMatchObject({ ok: true, memory: { status: "proposed", reviewReason: "no-anchor" } });
  });

  it("decision selalu review walau jangkar valid", async () => {
    const r = await proposeMemory(scope, actor, { ...anchored, kind: "decision", content: "pakai SQLite" });
    expect(r).toMatchObject({ ok: true, memory: { status: "proposed", reviewReason: "decision" } });
  });

  it("jangkar path tak ada → 422, tak tersimpan", async () => {
    const r = await proposeMemory(scope, actor, { ...base, anchors: [{ path: "nope.ts" }], content: "x y z" });
    expect(r).toMatchObject({ ok: false, status: 422, body: { anchor: "nope.ts" } });
    expect(await prisma.projectMemory.count()).toBe(0);
  });

  it("blobSha dari klien tak cocok dengan server → 422", async () => {
    const r = await proposeMemory(scope, actor, { ...base, anchors: [{ path: "server/db.ts", blobSha: "e".repeat(40) }], content: "a b c" });
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("server tak bisa memverifikasi: blobSha klien wajib, hasil proposed anchor-unverified", async () => {
    expect(await proposeMemory(unverified(), actor, { ...anchored, content: "a b c" })).toMatchObject({ ok: false, status: 422 });
    const r = await proposeMemory(unverified(), actor, { ...base, anchors: [{ path: "server/db.ts", blobSha: "e".repeat(40) }], content: "a b c" });
    expect(r).toMatchObject({ ok: true, memory: { status: "proposed", reviewReason: "anchor-unverified" } });
  });

  it("secret / path berbahaya → 422", async () => {
    expect(await proposeMemory(scope, actor, { ...base, content: "token ghp_" + "A".repeat(36) })).toMatchObject({ ok: false, status: 422 });
    expect(await proposeMemory(scope, actor, { ...base, scopePaths: ["../x"], content: "a b" })).toMatchObject({ ok: false, status: 422 });
  });

  it("duplikat memori active di project sama → 409 duplicateOf; di project lain boleh", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "Test server wajib no-file-parallelism" });
    if (!a.ok) throw new Error("setup");
    const dup = await proposeMemory(scope, actor, { ...anchored, content: "test server WAJIB no-file-parallelism." });
    expect(dup).toMatchObject({ ok: false, status: 409, body: { duplicateOf: a.memory.id } });
    const other = await proposeMemory({ projectId: "ms-b", repoDir: null, head, headVerified: false }, actor,
      { ...base, content: "Test server wajib no-file-parallelism" });
    expect(other.ok).toBe(true);
  });
});

describe("koreksi & review", () => {
  it("supersede: pengganti active → lama invalidated dengan event supersede", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "port default 8787" });
    if (!a.ok) throw new Error("setup");
    const b = await supersedeMemory(scope, actor, a.memory.id, { ...anchored, content: "port default 8787 kecuali PORT di-set" });
    expect(b).toMatchObject({ ok: true, memory: { status: "active", supersedesId: a.memory.id } });
    expect((await prisma.projectMemory.findUnique({ where: { id: a.memory.id } }))?.status).toBe("invalidated");
  });

  it("supersede yang masuk review: lama tetap active sampai pengganti disetujui manusia", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "fakta lama sekali" });
    if (!a.ok) throw new Error("setup");
    const b = await supersedeMemory(scope, actor, a.memory.id, { ...base, content: "fakta baru tanpa jangkar" });
    if (!b.ok) throw new Error("setup b");
    expect(b.memory.status).toBe("proposed");
    expect((await prisma.projectMemory.findUnique({ where: { id: a.memory.id } }))?.status).toBe("active");
    await reviewMemory("ms-a", "u1", b.memory.id, "activate");
    expect((await prisma.projectMemory.findUnique({ where: { id: a.memory.id } }))?.status).toBe("invalidated");
  });

  it("reverify membuat baris baru berisi sama dengan jangkar segar", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "isi yang sama" });
    if (!a.ok) throw new Error("setup");
    const r = await reverifyMemory(scope, actor, a.memory.id, [{ path: "server/db.ts" }]);
    expect(r).toMatchObject({ ok: true, memory: { content: "isi yang sama", supersedesId: a.memory.id, status: "active" } });
  });

  it("invalidate: alasan tercatat; tak bisa diulang (409)", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "akan salah" });
    if (!a.ok) throw new Error("setup");
    expect(await invalidateMemory(scope, actor, a.memory.id, "salah sejak SPEC-1")).toMatchObject({ ok: true, memory: { status: "invalidated" } });
    expect(await invalidateMemory(scope, actor, a.memory.id, "lagi")).toMatchObject({ ok: false, status: 409 });
  });

  it("review hanya untuk proposed; reject wajib alasan", async () => {
    const p = await proposeMemory(scope, actor, { ...base, content: "butuh review" });
    if (!p.ok) throw new Error("setup");
    expect(await reviewMemory("ms-a", "u1", p.memory.id, "reject")).toMatchObject({ ok: false, status: 422 });
    expect(await reviewMemory("ms-a", "u1", p.memory.id, "reject", "tak relevan")).toMatchObject({ ok: true, memory: { status: "rejected" } });
    expect(await reviewMemory("ms-a", "u1", p.memory.id, "activate")).toMatchObject({ ok: false, status: 409 });
  });

  it("ANTI-BOCOR: id milik project lain → 404 di semua operasi", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "rahasia project a" });
    if (!a.ok) throw new Error("setup");
    const sb: MemoryScope = { projectId: "ms-b", repoDir: null, head, headVerified: false };
    expect(await getMemory("ms-b", a.memory.id)).toMatchObject({ ok: false, status: 404 });
    expect(await invalidateMemory(sb, actor, a.memory.id, "x")).toMatchObject({ ok: false, status: 404 });
    expect(await supersedeMemory(sb, actor, a.memory.id, { ...base, content: "y" })).toMatchObject({ ok: false, status: 404 });
    expect(await reviewMemory("ms-b", "u1", a.memory.id, "activate")).toMatchObject({ ok: false, status: 404 });
    expect((await searchMemories("ms-b", {})).items).toEqual([]);
  });
});

describe("get & search", () => {
  it("get mengembalikan riwayat event", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "punya riwayat" });
    if (!a.ok) throw new Error("setup");
    const r = await getMemory("ms-a", a.memory.id);
    if (!r.ok) throw new Error("get");
    expect(r.events.map((e) => e.op).sort()).toEqual(["activate", "propose"]);
  });

  it("search: default active, token query, filter path", async () => {
    await proposeMemory(scope, actor, { ...anchored, scopePaths: ["server/**"], content: "prisma migrate butuh ADR" });
    await proposeMemory(scope, actor, { ...anchored, scopePaths: ["src/**"], content: "komponen react pakai design system" });
    await proposeMemory(scope, actor, { ...base, content: "prisma usulan belum direview" });
    expect((await searchMemories("ms-a", { q: "prisma" })).items.map((m) => m.content)).toEqual(["prisma migrate butuh ADR"]);
    expect((await searchMemories("ms-a", { paths: ["src/x.tsx"] })).items.map((m) => m.content)).toEqual(["komponen react pakai design system"]);
    expect((await searchMemories("ms-a", { status: "proposed" })).total).toBe(1);
  });
});
