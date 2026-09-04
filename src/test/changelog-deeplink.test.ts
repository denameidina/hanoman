import { describe, it, expect } from "vitest";
import { parseChangelogHash, changelogDeepLink, parseSpecHash } from "../src/screens/deeplink";
import { parseRoute } from "../src/routes";
import { NAV_KEYS } from "../src/ds/shell";

const loc = { origin: "https://hanoman.test" };

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

  // ADR-0160 · builder memakai path router; parser hash di atas tinggal untuk link lama.
  it("builder simetris dengan parser rute", () => {
    expect(changelogDeepLink("arta", null, loc)).toBe("https://hanoman.test/changelog/arta");
    expect(changelogDeepLink("arta", "c1", loc)).toBe("https://hanoman.test/changelog/arta/c1");
    const url = changelogDeepLink("a/b", "c 1", loc);
    expect(parseRoute(new URL(url).pathname, NAV_KEYS))
      .toEqual({ section: "changelog", projectId: "a/b", changelogId: "c 1" });
  });
});
