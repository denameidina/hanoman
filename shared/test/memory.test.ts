import { describe, expect, it } from "vitest";
import {
  MEMORY_CONTENT_MAX, decodeRepoHeader, encodeRepoHeader, zMemoryPropose,
} from "../src/memory";

const repo = { remote: "git@github.com:a/b.git", rootCommit: "a".repeat(40), head: "b".repeat(40) };

describe("DTO memori", () => {
  it("header repo bolak-balik tanpa kehilangan isi", () => {
    expect(decodeRepoHeader(encodeRepoHeader(repo))).toEqual(repo);
  });

  it("header rusak / bukan string → null, tak pernah melempar", () => {
    for (const v of [undefined, 42, "", "%%%", Buffer.from("{}").toString("base64url")])
      expect(decodeRepoHeader(v)).toBeNull();
  });

  it("propose menolak content kosong dan > batas", () => {
    const base = { kind: "fact", scopePaths: [], anchors: [] };
    expect(zMemoryPropose.safeParse({ ...base, content: "" }).success).toBe(false);
    expect(zMemoryPropose.safeParse({ ...base, content: "x".repeat(MEMORY_CONTENT_MAX + 1) }).success).toBe(false);
    expect(zMemoryPropose.safeParse({ ...base, content: "satu fakta" }).success).toBe(true);
  });

  it("propose menolak kind di luar katalog dan field project", () => {
    expect(zMemoryPropose.safeParse({ kind: "rule", content: "x", scopePaths: [], anchors: [] }).success).toBe(false);
    // strict: field tak dikenal (mis. projectId dari model) ditolak, bukan diabaikan diam-diam
    expect(zMemoryPropose.safeParse({ kind: "fact", content: "x", scopePaths: [], anchors: [], projectId: "p" }).success).toBe(false);
  });
});
