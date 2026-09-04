// ADR-0160 · pemetaan path ⇄ section adalah fungsi murni; App hanya menyambungkannya ke router.
import { describe, expect, it } from "vitest";
import { parseRoute, routePath, absoluteRouteUrl, type Route } from "../src/routes";
import { NAV_KEYS } from "../src/ds/shell";

describe("routes · parseRoute", () => {
  it("setiap key HN_NAV punya path /<key> yang kembali ke section yang sama", () => {
    for (const k of NAV_KEYS) expect(parseRoute(`/${k}`, NAV_KEYS)).toEqual({ section: k });
  });

  it("/ dan path tak dikenal = null (App mengalihkan ke halaman tersimpan)", () => {
    expect(parseRoute("/", NAV_KEYS)).toBeNull();
    expect(parseRoute("/runs", NAV_KEYS)).toBeNull();          // key mati SPEC-162
    expect(parseRoute("/backlog/a/b", NAV_KEYS)).toBeNull();
    expect(parseRoute("/review/x/y", NAV_KEYS)).toBeNull();     // kind tak dikenal
  });

  it("section transien membawa id-nya di URL", () => {
    expect(parseRoute("/projects/toko-mekar", NAV_KEYS)).toEqual({ section: "project", projectId: "toko-mekar" });
    expect(parseRoute("/backlog/SPEC-12", NAV_KEYS)).toEqual({ section: "backlog", specId: "SPEC-12" });
    expect(parseRoute("/changelog/p1", NAV_KEYS)).toEqual({ section: "changelog", projectId: "p1", changelogId: null });
    expect(parseRoute("/changelog/p1/cl-9", NAV_KEYS)).toEqual({ section: "changelog", projectId: "p1", changelogId: "cl-9" });
    expect(parseRoute("/review/spec/SPEC-3", NAV_KEYS)).toEqual({ section: "review", kind: "spec", id: "SPEC-3" });
    expect(parseRoute("/review/session/abc", NAV_KEYS)).toEqual({ section: "review", kind: "session", id: "abc" });
  });

  it("id ber-karakter khusus di-encode di path dan pulih utuh", () => {
    const r: Route = { section: "project", projectId: "a b/c" };
    expect(routePath(r)).toBe("/projects/a%20b%2Fc");
    expect(parseRoute(routePath(r), NAV_KEYS)).toEqual(r);
  });
});

describe("routes · routePath", () => {
  it("adalah kebalikan persis parseRoute untuk semua bentuk", () => {
    const all: Route[] = [
      { section: "overview" }, { section: "settings" },
      { section: "project", projectId: "p1" },
      { section: "backlog", specId: "SPEC-1" },
      { section: "changelog", projectId: "p1", changelogId: null },
      { section: "changelog", projectId: "p1", changelogId: "c1" },
      { section: "review", kind: "spec", id: "SPEC-2" },
    ];
    for (const r of all) expect(parseRoute(routePath(r), NAV_KEYS)).toEqual(r);
  });

  it("URL absolut memakai origin yang diberikan", () => {
    expect(absoluteRouteUrl({ section: "backlog", specId: "SPEC-1" }, { origin: "https://hm.example" }))
      .toBe("https://hm.example/backlog/SPEC-1");
  });
});
