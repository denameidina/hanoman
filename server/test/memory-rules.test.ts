import { describe, expect, it } from "vitest";
import {
  canTransition, findSecret, globMatch, isNearDuplicate, mergeStatus, normalizeRemote,
  reviewReason, safeRepoPath, scopeMatches,
} from "../src/services/memory/rules";

describe("normalizeRemote", () => {
  it("scp, https, ssh, dengan/tanpa .git → bentuk sama", () => {
    const want = "github.com/denameidina/hanoman";
    for (const u of [
      "git@github.com:denameidina/hanoman.git",
      "https://github.com/denameidina/hanoman",
      "https://github.com/DenaMeidina/Hanoman.git/",
      "ssh://git@github.com/denameidina/hanoman.git",
      "https://user:pass@github.com/denameidina/hanoman.git",
    ]) expect(normalizeRemote(u), u).toBe(want);
  });
  it("host berbeda → hasil berbeda (tak pernah salah cocok lintas host)", () => {
    expect(normalizeRemote("git@gitlab.com:denameidina/hanoman.git")).not.toBe(normalizeRemote("git@github.com:denameidina/hanoman.git"));
  });
  it("path lokal / file:// / sampah → null", () => {
    for (const u of ["/srv/repo", "file:///srv/repo", "", "nonsense"]) expect(normalizeRemote(u), u).toBeNull();
  });
});

describe("lattice status", () => {
  it("hanya naik", () => {
    expect(canTransition("proposed", "active")).toBe(true);
    expect(canTransition("active", "invalidated")).toBe(true);
    expect(canTransition("proposed", "rejected")).toBe(true);
    expect(canTransition("active", "proposed")).toBe(false);
    expect(canTransition("invalidated", "active")).toBe(false);
    expect(canTransition("rejected", "invalidated")).toBe(false);
    expect(canTransition("active", "active")).toBe(false);
  });
  it("merge: yang lebih tinggi menang, seri → yang pertama", () => {
    expect(mergeStatus("active", "invalidated")).toBe("invalidated");
    expect(mergeStatus("invalidated", "active")).toBe("invalidated");
    expect(mergeStatus("rejected", "invalidated")).toBe("rejected");
    expect(mergeStatus("proposed", "active")).toBe("active");
  });
});

describe("reviewReason", () => {
  const ok = { kind: "fact" as const, anchorsCount: 1, anchorsVerified: true, trusted: true };
  it("semua syarat terpenuhi → null (auto-aktif)", () => expect(reviewReason(ok)).toBeNull());
  it("urutan alasan", () => {
    expect(reviewReason({ ...ok, kind: "decision" })).toBe("decision");
    expect(reviewReason({ ...ok, anchorsCount: 0 })).toBe("no-anchor");
    expect(reviewReason({ ...ok, anchorsVerified: false })).toBe("anchor-unverified");
    expect(reviewReason({ ...ok, trusted: false })).toBe("untrusted-source");
  });
});

describe("isNearDuplicate", () => {
  it("beda kapitalisasi/tanda baca → duplikat", () => {
    expect(isNearDuplicate("Test server wajib --no-file-parallelism.", "test server WAJIB --no-file-parallelism")).toBe(true);
  });
  it("fakta berbeda → bukan duplikat", () => {
    expect(isNearDuplicate("Test server wajib --no-file-parallelism", "Migration butuh ADR baru")).toBe(false);
  });
});

describe("findSecret", () => {
  it("mendeteksi pola kredensial umum", () => {
    expect(findSecret("token hnm_agt_" + "a".repeat(48))).toBe("hanoman-token");
    expect(findSecret("ghp_" + "A".repeat(36))).toBe("github-token");
    expect(findSecret("AKIA" + "B".repeat(16))).toBe("aws-key");
    expect(findSecret("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe("private-key");
    expect(findSecret("sk-ant-" + "x".repeat(30))).toBe("api-key");
  });
  it("teks biasa → null", () => expect(findSecret("pakai pnpm vitest --run")).toBeNull());
});

describe("path & glob", () => {
  it("safeRepoPath menolak absolut dan ..", () => {
    expect(safeRepoPath("server/src/a.ts")).toBe(true);
    for (const p of ["/etc/passwd", "../x", "a/../../b", "a\\b", ""]) expect(safeRepoPath(p), p).toBe(false);
  });
  it("globMatch: ** lintas segmen, * dalam segmen", () => {
    expect(globMatch("server/src/**", "server/src/services/pty.ts")).toBe(true);
    expect(globMatch("server/*/x.ts", "server/src/x.ts")).toBe(true);
    expect(globMatch("server/*/x.ts", "server/src/a/x.ts")).toBe(false);
    expect(globMatch("src/**/*.tsx", "src/src/screens/A.tsx")).toBe(true);
  });
  it("scopeMatches: scope kosong = seluruh project", () => {
    expect(scopeMatches([], ["anything"])).toBe(true);
    expect(scopeMatches(["server/**"], ["src/a.ts"])).toBe(false);
    expect(scopeMatches(["server/**"], ["src/a.ts", "server/b.ts"])).toBe(true);
  });
});
