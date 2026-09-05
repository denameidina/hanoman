import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { sessionEventSpoolRoot } from "../src/services/session-event-spool";

describe("session event spool ownership", () => {
  it("separates installations by HANOMAN_HOME, including temporary smoke servers", () => {
    const a = sessionEventSpoolRoot({ HANOMAN_HOME: "/tmp/hanoman-a" });
    const b = sessionEventSpoolRoot({ HANOMAN_HOME: "/tmp/hanoman-b" });
    expect(a).toBe(join("/tmp/hanoman-a", "session-events"));
    expect(b).toBe(join("/tmp/hanoman-b", "session-events"));
    expect(a).not.toBe(b);
  });
});
