import { describe, it, expect } from "vitest";
import { zLead } from "@hanoman/shared";
import { askViaFor, leadDecides } from "../src/services/lead/ask-via";

// ADR-0231 · cara bertanya sesi claude mengikuti siapa yang menjawab project-nya saat sesi lahir.
const on = { ...zLead.parse({}), enabled: true, paused: false, pausedProjects: [] as string[] };
const deps = (cfg = on, optIn = ["p1"]) => ({ cfg: async () => cfg, optIn: async () => optIn });

describe("leadDecides", () => {
  it("lead aktif + project opt-in + tak dijeda → lead yang menjawab", () => {
    expect(leadDecides(on, ["p1"], "p1")).toBe(true);
  });
  it("lead mati, dijeda global, project dijeda, atau tak opt-in → manusia", () => {
    expect(leadDecides({ ...on, enabled: false }, ["p1"], "p1")).toBe(false);
    expect(leadDecides({ ...on, paused: true }, ["p1"], "p1")).toBe(false);
    expect(leadDecides({ ...on, pausedProjects: ["p1"] }, ["p1"], "p1")).toBe(false);
    expect(leadDecides(on, ["p2"], "p1")).toBe(false);
  });
});

describe("askViaFor", () => {
  it("claude: text bila lead menjawab, tool bila tidak", async () => {
    expect(await askViaFor("p1", "claude", deps())).toBe("text");
    expect(await askViaFor("p1", undefined, deps())).toBe("text");
    expect(await askViaFor("p1", "claude", deps({ ...on, enabled: false }))).toBe("tool");
    expect(await askViaFor("p1", "claude", deps(on, []))).toBe("tool");
  });
  it("codex & antigravity tak memakai askVia", async () => {
    expect(await askViaFor("p1", "codex", deps())).toBeUndefined();
    expect(await askViaFor("p1", "antigravity", deps())).toBeUndefined();
  });
  it("galat membaca konfigurasi → tool (manusia memutuskan)", async () => {
    expect(await askViaFor("p1", "claude", { cfg: async () => { throw new Error("db"); }, optIn: async () => [] }))
      .toBe("tool");
  });
});
