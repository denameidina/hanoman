import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EngineFields } from "../src/screens/settings/fields";
vi.mock("../src/api/client", () => ({ api: { getAntigravityVersion: vi.fn().mockResolvedValue({ version: "1.3.4", error: null }) } }));

describe("shared engine runtime selection", () => {
  it("selects Antigravity defaults through the shared engine save contract", async () => {
    const surface = "shared engine";
    const serialized: object[] = [];
    render(<EngineFields engine={{ enabled: true, agent: "claude", model: "claude-opus-5", effort: "medium" }}
      labels={{ agentTitle: surface, agentDesc: "Runtime sesi", effortDesc: "Effort", aria: { agent: `Runtime ${surface}`, model: `Model ${surface}`, effort: `Effort ${surface}` }, msg: { agent: "Runtime", model: "Model", effort: "Effort" } }}
      defaults={{ claude: { model: "claude-opus-5", effort: "medium" }, codex: { model: "gpt-5.6-sol", effort: "high" }, antigravity: { model: "gemini-3.8-flash-high", effort: "high" } }} codexVer={null}
      save={async (patch) => { serialized.push(JSON.parse(JSON.stringify(patch))); return true; }} />);
    fireEvent.change(screen.getByRole("combobox", { name: `Runtime ${surface}` }), { target: { value: "antigravity" } });
    await waitFor(() => expect(serialized).toContainEqual({ agent: "antigravity", model: "gemini-3.8-flash-high", effort: "high" }));
    expect(screen.getByTestId("antigravity-version-note")).toHaveTextContent("Antigravity CLI");
  });
});
