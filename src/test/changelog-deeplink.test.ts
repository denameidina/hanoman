import { describe, it, expect } from "vitest";
import { parseChangelogHash, changelogDeepLink, parseSpecHash } from "../src/screens/deeplink";

const loc = { origin: "https://hanoman.test", pathname: "/" };

describe("SPEC-519 · deep-link changelog", () => {
  it("membaca projectId tanpa cl", () => {
    expect(parseChangelogHash("#changelog=arta")).toEqual({ projectId: "arta", changelogId: null });
  });

  it("membaca projectId + cl", () => {
    expect(parseChangelogHash("#changelog=arta&cl=c123"))
      .toEqual({ projectId: "arta", changelogId: "c123" });
  });

  it("meng-decode id yang ter-encode", () => {
    expect(parseChangelogHash("#changelog=a%2Fb")).toEqual({ projectId: "a/b", changelogId: null });
  });

  it("hash lain = null", () => {
    expect(parseChangelogHash("#spec=SPEC-9")).toBeNull();
    expect(parseChangelogHash("")).toBeNull();
  });

  // Dua parser hidup di berkas yang sama dan dibaca efek mount yang sama: kalau saling
  // menangkap, satu tautan membuka dua layar sekaligus.
  it("tak saling menangkap dengan #spec=", () => {
    expect(parseSpecHash("#changelog=arta&cl=c1")).toBeNull();
    expect(parseChangelogHash("#spec=SPEC-9")).toBeNull();
  });

  it("builder simetris dengan parser", () => {
    expect(changelogDeepLink("arta", null, loc)).toBe("https://hanoman.test/#changelog=arta");
    expect(changelogDeepLink("arta", "c1", loc)).toBe("https://hanoman.test/#changelog=arta&cl=c1");
    const url = changelogDeepLink("a/b", "c 1", loc);
    expect(parseChangelogHash(url.slice(url.indexOf("#"))))
      .toEqual({ projectId: "a/b", changelogId: "c 1" });
  });
});
