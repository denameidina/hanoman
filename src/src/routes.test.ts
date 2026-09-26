import { describe, expect, it } from "vitest";
import { parseRoute, routePath } from "./routes";

const KEYS = ["overview", "projects", "backlog", "skills", "settings"];

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
