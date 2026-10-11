// ADR-0212 · tool `hanoman_projects_list` menerima `sort` dan `attention` (keduanya opsional). Yang
// diuji di sini hanya yang bisa salah DI KATALOG: skema, dan bentuk permintaan hasil build().
// Balasan server (urutan & penyaringan) diuji di server/test/projects-sort.route.test.ts.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./mcp";

const list = MCP_TOOLS.find((t) => t.name === "hanoman_projects_list")!;
const build = (args: Record<string, unknown>) => list.build(args as never);

describe("hanoman_projects_list · sort & attention (ADR-0212)", () => {
  it("skema: kedua param ada, opsional, dan sort hanya menerima 'attention'", () => {
    const props = list.inputSchema.properties as Record<string, { type: string; enum?: string[] }>;
    expect(props.sort).toMatchObject({ type: "string", enum: ["attention"] });
    expect(props.attention).toMatchObject({ type: "boolean" });
    expect(list.inputSchema.required ?? []).toEqual([]);
  });

  it("tanpa argumen: permintaan tetap GET /projects tanpa query (backward compatible)", () => {
    const r = build({}) as { method: string; path: string; query?: Record<string, string> };
    expect(r.method).toBe("GET");
    expect(r.path).toBe("/projects");
    expect(r.query ?? {}).toEqual({});
  });

  it("sort=attention diteruskan sebagai query", () => {
    expect((build({ sort: "attention" }) as { query: Record<string, string> }).query).toEqual({ sort: "attention" });
  });

  it("attention=true menjadi 'true'; attention=false menghilangkan parameternya, tak pernah 'false'", () => {
    expect((build({ attention: true }) as { query: Record<string, string> }).query).toEqual({ attention: "true" });
    expect((build({ attention: false }) as { query: Record<string, string> }).query ?? {}).not.toHaveProperty("attention");
  });
});
