import { describe, expect, it } from "vitest";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";
import { zMarkSpecReviewed } from "./dto";

const tool = () => MCP_TOOLS.find((t) => t.name === "hanoman_backlog_mark_reviewed")!;

// ADR-0218 · tool penanda "sudah ditinjau". Mode `write` (bukan `danger`): ia membalik satu penanda
// yang bisa dibatalkan dan tak membuang kerja, cermin `hanoman_backlog_mark_done`.
describe("ADR-0218 · hanoman_backlog_mark_reviewed", () => {
  it("bermode write dengan capability backlog:write, tanpa danger", () => {
    expect(tool().mode).toBe("write");
    expect(tool().capability).toBe("backlog:write");
    expect(mcpToolsFor("default").map((t) => t.name)).toContain("hanoman_backlog_mark_reviewed");
  });

  it("POST /specs/:id/reviewed sebagai contoh rute (dicocokkan gerbang cakupan)", () => {
    expect(tool().sampleMethod).toBe("POST");
    expect(tool().samplePath).toBe("/specs/SPEC-1/reviewed");
  });

  it("spec wajib; reviewed opsional dan default-nya menandai", () => {
    expect(tool().inputSchema.required).toEqual(["spec"]);
    expect(tool().inputSchema.properties.reviewed?.type).toBe("boolean");
    expect(tool().build({ spec: "SPEC-7" })).toMatchObject({
      method: "POST", path: "/specs/SPEC-7/reviewed", body: { reviewed: true },
    });
  });

  it("reviewed:false mengirim false (pembatalan), bukan diabaikan", () => {
    expect(tool().build({ spec: "SPEC-7", reviewed: false })!.body).toEqual({ reviewed: false });
  });
});

describe("ADR-0218 · zMarkSpecReviewed", () => {
  it("body kosong sah; reviewed harus boolean bila ada", () => {
    expect(zMarkSpecReviewed.safeParse({}).success).toBe(true);
    expect(zMarkSpecReviewed.safeParse({ reviewed: false }).success).toBe(true);
    expect(zMarkSpecReviewed.safeParse({ reviewed: "ya" }).success).toBe(false);
  });
});
