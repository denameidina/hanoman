import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./mcp";
const tool = (name: string) => MCP_TOOLS.find(t => t.name === name)!;

describe("Antigravity existing agents MCP tools", () => {
  it.each(["hanoman_agent_create", "hanoman_agent_update"])("extends %s runtime with unchanged write capability", (name) => {
    const t = tool(name);
    expect(t.inputSchema.properties.runtime?.enum).toContain("antigravity");
    expect(t.mode).toBe("write");
    expect(t.capability).toBe("agents:write");
    expect(t.build({ agent: "global:child", name: "child", description: "d", instructions: "i", runtime: "antigravity", model: "flash" })?.body).toMatchObject({ runtime: "antigravity", model: "flash" });
    expect(t.inputSchema.properties.model?.description).toContain("inherit|flash|pro");
  });
  it("filters list availability for the requested parent runtime", () => {
    const t = tool("hanoman_agents_list");
    expect(t.inputSchema.properties.runtime?.enum).toContain("antigravity");
    expect(t.build({ runtime: "antigravity", project: "p1" })?.query).toEqual({ runtime: "antigravity", projectId: "p1" });
    expect(t.mode).toBe("read");
    expect(t.capability).toBe("agents:read");
  });
});
