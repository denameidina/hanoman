import { describe, expect, it } from "vitest";
import { parseRoute, routePath } from "./routes";

const KEYS = ["overview", "projects", "backlog", "skills", "qa", "settings"];

describe("routes · skills", () => {
  it("/skills = semua grup, /skills/<projectId> = satu project", () => {
    expect(parseRoute("/skills", KEYS)).toEqual({ section: "skills" });
    expect(parseRoute("/skills/p1", KEYS)).toEqual({ section: "skills", projectId: "p1" });
  });
  it("routePath kebalikan persis parseRoute, termasuk id ber-karakter khusus", () => {
    expect(routePath({ section: "skills" })).toBe("/skills");
    expect(routePath({ section: "skills", projectId: "p 1" })).toBe("/skills/p%201");
    expect(parseRoute(routePath({ section: "skills", projectId: "p 1" }), KEYS)).toEqual({ section: "skills", projectId: "p 1" });
  });
  it("rute lama tak berubah", () => {
    expect(parseRoute("/projects/p1", KEYS)).toEqual({ section: "project", projectId: "p1" });
    expect(parseRoute("/skills/a/b", KEYS)).toBeNull();
  });
});

describe("routes · qa", () => {
  it("/qa = tanpa project, /qa/<projectId> = satu project; round-trip dengan encoding", () => {
    expect(parseRoute("/qa", KEYS)).toEqual({ section: "qa" });
    expect(parseRoute("/qa/p1", KEYS)).toEqual({ section: "qa", projectId: "p1" });
    expect(routePath({ section: "qa" })).toBe("/qa");
    expect(routePath({ section: "qa", projectId: "p 1" })).toBe("/qa/p%201");
    expect(parseRoute(routePath({ section: "qa", projectId: "p 1" }), KEYS)).toEqual({ section: "qa", projectId: "p 1" });
    expect(parseRoute("/qa/a/b", KEYS)).toBeNull();
  });
});
