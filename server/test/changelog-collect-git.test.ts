import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { listTags, collectCommits, collectVersions } from "../src/services/changelog/collect";
import { makeRepoWithTags, makeRepoWithBranches } from "./factory";

const sha = (dir: string, rev: string) =>
  spawnSync("git", ["rev-parse", rev], { cwd: dir, encoding: "utf8" }).stdout.trim();

describe("listTags", () => {
  it("memulangkan tag terbaru lebih dulu", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"] });
    const r = await listTags(dir);
    expect(r.tags).toEqual(["v1.1.0", "v1.0.0"]);
    expect(r.reason).toBeNull();
  });

  it("repo tanpa tag = alasan yang jelas, bukan lemparan", async () => {
    const r = await listTags(makeRepoWithBranches());
    expect(r.tags).toEqual([]);
    expect(r.reason).toMatch(/belum punya tag/i);
  });

  it("repo belum ditautkan = alasan yang jelas", async () => {
    const r = await listTags(null);
    expect(r.tags).toEqual([]);
    expect(r.reason).toMatch(/belum ditautkan/i);
  });
});

describe("collectCommits", () => {
  it("mengambil commit di antara dua revisi, terbaru lebih dulu", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua", "fitur tiga"] });
    const r = await collectCommits(dir, sha(dir, "v1.0.0"), sha(dir, "v1.1.0"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["fitur tiga", "fitur dua"]);
    expect(r.input.mode).toBe("commit");
  });

  it("revisi tak dikenal = alasan menyebut revisinya", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const r = await collectCommits(dir, "zzzzzzz", sha(dir, "v1.0.0"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("zzzzzzz");
  });

  it("repo belum ditautkan = alasan yang jelas", async () => {
    const r = await collectCommits(null, "a", "b");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/belum ditautkan/i);
  });

  it("rentang tanpa commit = alasan, bukan changelog kosong", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const s = sha(dir, "v1.0.0");
    const r = await collectCommits(dir, s, s);
    expect(r.ok).toBe(false);
  });
});

describe("collectVersions", () => {
  it("satu tag = perubahan sejak tag SEBELUMNYA", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"] });
    const r = await collectVersions(dir, undefined, "v1.1.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["fitur dua"]);
    expect(r.input.title).toBe("v1.1.0");
    expect(r.input.mode).toBe("version");
  });

  it("dua tag = rentang antar keduanya", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"], "v1.2.0": ["fitur tiga"] });
    const r = await collectVersions(dir, "v1.0.0", "v1.2.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["fitur tiga", "fitur dua"]);
    expect(r.input.title).toBe("v1.0.0 → v1.2.0");
  });

  it("tag pertama = seluruh riwayat sampai tag itu", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const r = await collectVersions(dir, undefined, "v1.0.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toContain("fitur satu");
  });

  it("tag tak ada = alasan menyebut tagnya", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"] });
    const r = await collectVersions(dir, undefined, "v9.9.9");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("v9.9.9");
  });

  it("repo tanpa tag = alasan yang jelas", async () => {
    const r = await collectVersions(makeRepoWithBranches(), undefined, "v1.0.0");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/belum punya tag/i);
  });
});
