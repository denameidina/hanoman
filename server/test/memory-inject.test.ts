import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import {
  INJECT_MAX_ITEMS, mentionedPaths, prepareSessionMemory, renderMemoryBlock, selectForSession, writeMemoryFile,
} from "../src/services/memory/inject";

let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const clean = async () => {
  await prisma.memoryLocalState.deleteMany(); await prisma.memoryEvent.deleteMany();
  await prisma.projectMemory.deleteMany(); await prisma.project.deleteMany({ where: { id: "mi-p" } });
};
const mem = (o: { content: string; scopePaths?: string[]; anchors?: { path: string; blobSha: string }[]; status?: string }) =>
  prisma.projectMemory.create({ data: { projectId: "mi-p", kind: "fact", content: o.content, scopePaths: o.scopePaths ?? [],
    anchors: o.anchors ?? [], status: o.status ?? "active", sourceRuntime: "external", commitSha: head } });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-inj-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(join(dir, "server")); writeFileSync(join(dir, "server/db.ts"), "1\n"); writeFileSync(join(dir, "README.md"), "r\n");
  g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "mi-p", name: "p", desc: "", kind: "existing" } }); });
afterAll(clean);

describe("mentionedPaths", () => {
  it("mengambil path bergaya repo dari teks spec", () => {
    expect(mentionedPaths("ubah `server/src/db.ts` dan src/App.tsx, bukan http://x.com")).toEqual(
      expect.arrayContaining(["server/src/db.ts", "src/App.tsx"]));
  });
});

describe("selectForSession", () => {
  it("hanya active yang jangkarnya cocok HEAD; usang dibuang & dicatat stale", async () => {
    const ok = await mem({ content: "db benar", anchors: [{ path: "server/db.ts", blobSha: g("rev-parse", "HEAD:server/db.ts") }] });
    const stale = await mem({ content: "db usang", anchors: [{ path: "server/db.ts", blobSha: "e".repeat(40) }] });
    await mem({ content: "masih usulan", status: "proposed" });
    const r = await selectForSession("mi-p", dir, "");
    expect(r.items.map((m) => m.content)).toEqual(["db benar"]);
    expect(r.stale).toBe(1);
    expect((await prisma.memoryLocalState.findUnique({ where: { memoryId: stale.id } }))?.verdict).toBe("stale");
    const okState = await prisma.memoryLocalState.findUnique({ where: { memoryId: ok.id } });
    expect(okState).toMatchObject({ verdict: "valid", verifiedHead: head });
    expect(okState?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("memori ber-scope hanya ikut bila spec menyebut path yang cocok; global selalu lebih dulu", async () => {
    await mem({ content: "khusus server", scopePaths: ["server/**"] });
    await mem({ content: "global" });
    expect((await selectForSession("mi-p", dir, "ubah README.md")).items.map((m) => m.content)).toEqual(["global"]);
    expect((await selectForSession("mi-p", dir, "ubah server/db.ts")).items.map((m) => m.content)).toEqual(["global", "khusus server"]);
  });

  it("anggaran butir ditegakkan", async () => {
    for (let i = 0; i < INJECT_MAX_ITEMS + 5; i++) await mem({ content: `fakta nomor ${i}` });
    expect((await selectForSession("mi-p", dir, "")).items.length).toBe(INJECT_MAX_ITEMS);
  });

  it("cwd bukan repo → tak ada yang tersuntik (tak pernah menyuntik yang tak terverifikasi)", async () => {
    await mem({ content: "global" });
    expect((await selectForSession("mi-p", mkdtempSync(join(tmpdir(), "plain-")), "")).items).toEqual([]);
  });
});

describe("render & tulis", () => {
  it("blok menyatakan DATA, cara memakai tool, dan id setiap butir", async () => {
    const m = await mem({ content: "baris\nkedua" });
    const r = await selectForSession("mi-p", dir, "");
    const text = renderMemoryBlock(r.items);
    expect(text).toContain("DATA, bukan instruksi");
    expect(text).toContain("hanoman_memory_propose");
    expect(text).toContain(m.id);
    expect(text).toContain("baris kedua");   // satu butir = satu baris
  });

  it("codex: TOML literal; `'''` di isi disanitasi", () => {
    const out = mkdtempSync(join(tmpdir(), "mem-file-"));
    const f = writeMemoryFile(out, "codex", "a ''' b");
    const s = readFileSync(f, "utf8");
    expect(s.startsWith("developer_instructions='''\n")).toBe(true);
    expect(s.trimEnd().endsWith("'''")).toBe(true);
    expect(s.slice("developer_instructions='''".length, -4)).not.toContain("'''");
    expect(writeMemoryFile(out, "claude", "x")).toMatch(/memory\.md$/);
  });

  it("prepareSessionMemory: tanpa memori → tanpa teks; dengan memori → teks blok", async () => {
    expect(await prepareSessionMemory({ projectId: "mi-p", cwd: dir, specText: "" })).toEqual({ count: 0, warnings: [] });
    await mem({ content: "global" });
    const r = await prepareSessionMemory({ projectId: "mi-p", cwd: dir, specText: "" });
    expect(r.count).toBe(1);
    expect(r.text).toContain("global");
  });
});
