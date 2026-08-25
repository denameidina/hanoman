import { describe, expect, it } from "vitest";
import { MCP_TOOLS, MCP_TOOL_SCHEMA_VERSION, mcpToolsFor, MCP_INSTRUCTIONS } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog tool MCP", () => {
  it("17 tool, semuanya berprefix hanoman_ dan namanya unik", () => {
    expect(MCP_TOOLS).toHaveLength(17);
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(17);
    for (const t of MCP_TOOLS) expect(t.name).toMatch(/^hanoman_[a-z0-9_]+$/);
  });

  it("mode baca-saja MENGHILANGKAN tool tulis, bukan menolaknya saat dipanggil", () => {
    const ro = mcpToolsFor("read-only");
    expect(ro.every((t) => t.mode === "read")).toBe(true);
    expect(ro).toHaveLength(13);
    expect(mcpToolsFor("default")).toHaveLength(17);
    expect(ro.map((t) => t.name)).not.toContain("hanoman_backlog_create");
  });

  it("tak ada tool yang mengeksekusi: /terminal hanya GET, /vps tak ada sama sekali", () => {
    for (const t of MCP_TOOLS) {
      expect(t.samplePath, t.name).not.toMatch(/^\/vps/);
      if (t.samplePath.startsWith("/terminal")) expect(t.sampleMethod, t.name).toBe("GET");
    }
    const paths = MCP_TOOLS.map((t) => t.samplePath);
    expect(paths.some((p) => p.includes("integrate"))).toBe(false);
  });

  it("tak ada tool yang menyentuh route cookie-only", () => {
    for (const t of MCP_TOOLS)
      expect(t.samplePath, t.name).not.toMatch(/^\/(auth|agent-tokens|device-tokens|sync)\b/);
  });

  it("setiap tool punya deskripsi yang menyebut apa yang dikembalikan", () => {
    for (const t of MCP_TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.title.length, t.name).toBeGreaterThan(0);
    }
  });

  it("startable diekspos sebagai BOOLEAN — jebakan `startable=1` diabaikan senyap tak bisa terjadi", () => {
    const t = byName("hanoman_backlog_search");
    expect(t.inputSchema.properties.startable?.type).toBe("boolean");
    expect(t.build({ startable: true })?.query).toMatchObject({ startable: "true" });
    expect(t.build({ startable: false })?.query?.startable).toBeUndefined();
    expect(t.build({})?.query?.startable).toBeUndefined();
  });

  it("q dinyatakan tak menyentuh payload", () => {
    expect(byName("hanoman_backlog_search").inputSchema.properties.q?.description).toMatch(/payload/i);
  });

  it("backlog_create mengikat source ke bentuk payload lewat allOf", () => {
    const t = byName("hanoman_backlog_create");
    expect(t.inputSchema.allOf).toHaveLength(3);
    expect(t.inputSchema.properties.stage).toBeUndefined();  // stage selalu lahir brainstorming
    expect(t.inputSchema.properties.id).toBeUndefined();     // id diturunkan server
  });

  it("backlog_update hanya konten — tak ada stage/confirmDelete yang bisa menghapus artefak", () => {
    const t = byName("hanoman_backlog_update");
    expect(Object.keys(t.inputSchema.properties).sort())
      .toEqual(["dependsOn", "payload", "priority", "spec", "title"]);
  });

  it("backlog_get mencocokkan id PERSIS, bukan substring q", () => {
    const t = byName("hanoman_backlog_get");
    const raw = { items: [{ id: "SPEC-4820", stage: "done" }, { id: "SPEC-482", stage: "planned" }], total: 2, page: 1, pageSize: 50 };
    expect((t.shape(raw, { spec: "SPEC-482" }) as { id: string }).id).toBe("SPEC-482");
    expect(t.shape({ items: [], total: 0, page: 1, pageSize: 50 }, { spec: "SPEC-999" }))
      .toMatchObject({ error: expect.stringContaining("SPEC-999") });
  });

  it("versi skema tool ada dan disebut di instructions", () => {
    expect(MCP_TOOL_SCHEMA_VERSION).toBe(1);
    expect(MCP_INSTRUCTIONS).toContain(String(MCP_TOOL_SCHEMA_VERSION));
  });

  it("SNAPSHOT KONTRAK — nama tool + parameter wajib. Berubah = klien lama patah = WAJIB naik versi", () => {
    const snapshot = MCP_TOOLS.map((t) => `${t.name}(${[...(t.inputSchema.required ?? [])].sort().join(",")})`).sort();
    expect(snapshot).toEqual([
      "hanoman_about()",
      "hanoman_backlog_create(payload,priority,project,source,title)",
      "hanoman_backlog_doc_read(path,spec)",
      "hanoman_backlog_docs_list(spec)",
      "hanoman_backlog_get(spec)",
      "hanoman_backlog_search()",
      "hanoman_backlog_update(spec)",
      "hanoman_github_issues_list(project)",
      "hanoman_lead_ask(project,question)",
      "hanoman_lead_decisions_list()",
      "hanoman_notifications_list()",
      "hanoman_notifications_mark_read()",
      "hanoman_project_get(project)",
      "hanoman_projects_list()",
      "hanoman_sessions_list()",
      "hanoman_ticket_get(ticket)",
      "hanoman_tickets_list()",
    ]);
  });
});

// SPEC-485 · ADR-0102 · tambahan ADITIF pada `hanoman_lead_ask`: agen bisa menyatakan bahwa opsinya
// TIDAK saling eksklusif. Protokol berantai sengaja TIDAK dibuka lewat MCP — ia butuh beberapa
// panggilan berurutan + submit, dan tanpa pintu submit yang lahir hanyalah alur menggantung.
describe("SPEC-485 · lead_ask menerima pilihan jamak", () => {
  const tool = () => MCP_TOOLS.find((t) => t.name === "hanoman_lead_ask")!;

  it("punya parameter multi/minChoices/maxChoices", () => {
    expect(Object.keys(tool().inputSchema.properties)).toEqual(
      expect.arrayContaining(["multi", "minChoices", "maxChoices"]));
  });

  it("default TETAP single — permintaan lama tak berubah satu bit pun", () => {
    expect(tool().build({ project: "p", question: "q" })!.body).not.toHaveProperty("select");
  });

  it("multi merakit blok select yang dimengerti server", () => {
    expect(tool().build({
      project: "p", question: "q", options: ["a", "b"], multi: true, minChoices: 1, maxChoices: 2,
    })!.body).toMatchObject({ select: { mode: "multi", min: 1, max: 2 } });
  });

  it("maxChoices yang tak disebut jadi null (sebanyak opsinya)", () => {
    expect(tool().build({ project: "p", question: "q", options: ["a", "b"], multi: true })!.body)
      .toMatchObject({ select: { mode: "multi", min: 0, max: null } });
  });

  it("tak ada tool baru untuk rantai — permukaannya tetap 17", () => {
    expect(MCP_TOOLS.filter((t) => t.name.includes("flow"))).toHaveLength(0);
  });
});

// ADR-0155 · tingkat mode ketiga. Tiga sifat dikunci: yang lebih sempit MENGHILANGKAN tool (bukan
// menolaknya saat dipanggil — ADR-0099 §5), `danger` memuat semuanya, dan instruksi menyatakan
// terang-terangan bahwa tingkat ini BUKAN kontrol keamanan. Yang terakhir bukan kosmetik: menyebut
// `--danger` sebagai gerbang keamanan di dokumen mana pun adalah kekeliruan yang menular.
describe("tingkat mode", () => {
  it("read-only hanya tool baca", () => {
    expect(mcpToolsFor("read-only").every((t) => t.mode === "read")).toBe(true);
  });

  it("default menyembunyikan danger tapi menyimpan write", () => {
    const t = mcpToolsFor("default");
    expect(t.some((x) => x.mode === "danger")).toBe(false);
    expect(t.some((x) => x.mode === "write")).toBe(true);
  });

  it("danger memuat semuanya", () => {
    expect(mcpToolsFor("danger")).toHaveLength(MCP_TOOLS.length);
  });

  it("tingkat yang lebih longgar tak pernah MENGHILANGKAN tool yang lebih sempit sudah punya", () => {
    const names = (l: Parameters<typeof mcpToolsFor>[0]) => new Set(mcpToolsFor(l).map((t) => t.name));
    const ro = names("read-only"), def = names("default"), dg = names("danger");
    for (const n of ro) expect(def.has(n), n).toBe(true);
    for (const n of def) expect(dg.has(n), n).toBe(true);
  });

  it("instruksi menyatakan tingkat ini BUKAN kontrol keamanan", () => {
    expect(MCP_INSTRUCTIONS).toMatch(/bukan kontrol keamanan/i);
  });
});
