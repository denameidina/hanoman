import { beforeEach, describe, expect, it } from "vitest";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { leadAgentDefaults } from "../src/services/lead/config";
import { makeSetting, resetDb } from "./factory";

beforeEach(resetDb);

describe("Antigravity lead defaults", () => {
  it("inherits the global parent runtime/model/effort when its engine override is disabled", async () => {
    await makeSetting({ agent: "antigravity", antigravity: { model: "future-parent", effort: "low" } });
    expect(await leadAgentDefaults()).toEqual({ agent: "antigravity", model: "future-parent", effort: "low" });
  });

  it("preserves the explicit Antigravity engine triple rather than returning Claude", async () => {
    await makeSetting({ agent: "codex", lead: { ...LEAD_DEFAULTS,
      engine: { ...LEAD_DEFAULTS.engine, enabled: true, agent: "antigravity", model: "custom-parent", effort: "medium" } } });
    expect(await leadAgentDefaults()).toEqual({ agent: "antigravity", model: "custom-parent", effort: "medium" });
  });
});
