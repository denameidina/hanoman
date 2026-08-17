import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  entryKind, createEntry, renameEntry, deleteEntry, saveUpload, joinRel,
  EntryExistsError, EntryMissingError, EntryTargetInsideError,
} from "../src/services/repo-fs";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "hanoman-repofs-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "satu\n");
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
});

describe("entryKind", () => {
  it("membedakan berkas, folder, dan yang tak ada", async () => {
    expect(await entryKind(repo, "src/a.ts")).toBe("file");
    expect(await entryKind(repo, "src")).toBe("dir");
    expect(await entryKind(repo, "src/hantu.ts")).toBe(null);
    // induk yang belum ada bukan error — ini jalur "boleh dibuat"
    expect(await entryKind(repo, "belum/ada/x.ts")).toBe(null);
  });
});

describe("createEntry", () => {
  it("membuat berkas kosong berikut folder induknya", async () => {
    await createEntry(repo, "src/ds/Baru.tsx", "file");
    expect(readFileSync(join(repo, "src/ds/Baru.tsx"), "utf8")).toBe("");
  });
  it("folder lahir dengan .gitkeep supaya terlihat git", async () => {
    await createEntry(repo, "src/kosong", "dir");
    expect(existsSync(join(repo, "src/kosong/.gitkeep"))).toBe(true);
  });
  it("path yang sudah ada ditolak tanpa menyentuh isinya", async () => {
    await expect(createEntry(repo, "src/a.ts", "file")).rejects.toBeInstanceOf(EntryExistsError);
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("satu\n");
  });
});

describe("renameEntry", () => {
  it("memindahkan berkas beserta induk baru", async () => {
    await renameEntry(repo, "src/a.ts", "lib/b.ts");
    expect(existsSync(join(repo, "src/a.ts"))).toBe(false);
    expect(readFileSync(join(repo, "lib/b.ts"), "utf8")).toBe("satu\n");
  });
  it("tujuan yang sudah ada → EntryExistsError", async () => {
    writeFileSync(join(repo, "src/b.ts"), "dua\n");
    await expect(renameEntry(repo, "src/a.ts", "src/b.ts")).rejects.toBeInstanceOf(EntryExistsError);
  });
  it("sumber tak ada → EntryMissingError", async () => {
    await expect(renameEntry(repo, "src/hantu.ts", "src/z.ts")).rejects.toBeInstanceOf(EntryMissingError);
  });
  it("folder tak boleh dipindah ke dalam dirinya sendiri", async () => {
    await expect(renameEntry(repo, "src", "src/dalam")).rejects.toBeInstanceOf(EntryTargetInsideError);
  });
});

describe("deleteEntry", () => {
  it("menghapus berkas", async () => {
    expect(await deleteEntry(repo, "src/a.ts")).toEqual({ path: "src/a.ts", kind: "file" });
    expect(existsSync(join(repo, "src/a.ts"))).toBe(false);
  });
  it("menghapus folder berikut isinya", async () => {
    expect(await deleteEntry(repo, "src")).toEqual({ path: "src", kind: "dir" });
    expect(existsSync(join(repo, "src"))).toBe(false);
  });
  it("path tak ada → EntryMissingError", async () => {
    await expect(deleteEntry(repo, "src/hantu.ts")).rejects.toBeInstanceOf(EntryMissingError);
  });
});

describe("penjaga path", () => {
  const jahat = ["../keluar.ts", "/etc/passwd", ".git/HEAD", ".git/hooks/pre-commit", "", "src/../../x"];
  it("menolak traversal, absolut, dan .git di semua operasi", async () => {
    for (const p of jahat) {
      await expect(entryKind(repo, p)).rejects.toBeTruthy();
      await expect(createEntry(repo, p, "file")).rejects.toBeTruthy();
      await expect(deleteEntry(repo, p)).rejects.toBeTruthy();
    }
    expect(readFileSync(join(repo, ".git/HEAD"), "utf8")).toContain("refs/heads/main");
  });
  it("menolak komponen symlink", async () => {
    symlinkSync(tmpdir(), join(repo, "keluar"));
    await expect(deleteEntry(repo, "keluar/apa.ts")).rejects.toBeTruthy();
  });
});

describe("saveUpload", () => {
  const src = (s: string) => Readable.from([Buffer.from(s)]);
  it("menulis berkas baru berikut induknya", async () => {
    expect(await saveUpload(repo, "aset/img/a.txt", src("halo"))).toEqual({ status: "written" });
    expect(readFileSync(join(repo, "aset/img/a.txt"), "utf8")).toBe("halo");
  });
  it("tanpa overwrite, berkas yang sudah ada dilewati utuh", async () => {
    expect(await saveUpload(repo, "src/a.ts", src("baru"))).toEqual({ status: "exists" });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("satu\n");
  });
  it("dengan overwrite, isinya diganti", async () => {
    expect(await saveUpload(repo, "src/a.ts", src("baru"), { overwrite: true })).toEqual({ status: "written" });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("baru");
  });
  it("berkas ter-truncate tak pernah mendarat & tak meninggalkan .tmp", async () => {
    const r = await saveUpload(repo, "src/a.ts", src("potong"), { overwrite: true, isTruncated: () => true });
    expect(r).toEqual({ status: "too-large" });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("satu\n");
    expect(readdirSync(join(repo, "src")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("joinRel", () => {
  it("menggabungkan folder tujuan dengan path relatif berkas", () => {
    expect(joinRel("", "a.ts")).toBe("a.ts");
    expect(joinRel("src/ds", "sub/b.ts")).toBe("src/ds/sub/b.ts");
    expect(joinRel("/src/", "/b.ts")).toBe("src/b.ts");
    expect(() => joinRel("src", "   ")).toThrow();
  });
});
