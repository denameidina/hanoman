// ADR-0199 · ADR-0200 · katalog `sync` (permukaan UI), `instance` (pasang pembaruan/restart), dan
// panduan agen. Yang diuji bukan "tool-nya ada" (gerbang cakupan server menjaga itu) melainkan yang
// hanya bisa salah DI KATALOG: bentuk permintaan, tingkat bahaya, dan apa yang BOCOR di hasil.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog sync & instance", () => {
  it("ketujuh tool ada; hanya tool read yang tampil di read-only, danger hanya di tingkat danger", () => {
    const names = ["hanoman_sync_conflicts", "hanoman_sync_pending", "hanoman_sync_now",
      "hanoman_sync_conflict_resolve", "hanoman_update_apply", "hanoman_instance_restart", "hanoman_agent_guide"];
    for (const n of names) expect(byName(n), n).toBeDefined();
    const ro = new Set(mcpToolsFor("read-only").map((t) => t.name));
    expect([...ro].filter((n) => names.includes(n)).sort())
      .toEqual(["hanoman_agent_guide", "hanoman_sync_conflicts", "hanoman_sync_pending"]);
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    expect(def.has("hanoman_sync_now")).toBe(true);
    for (const n of ["hanoman_sync_conflict_resolve", "hanoman_update_apply", "hanoman_instance_restart"])
      expect(def.has(n), n).toBe(false);
  });

  it("capability tiap tool persis seperti yang dijanjikan ADR", () => {
    expect(byName("hanoman_sync_conflicts").capability).toBe("sync:read");
    expect(byName("hanoman_sync_pending").capability).toBe("sync:read");
    expect(byName("hanoman_sync_now").capability).toBe("sync:write");
    expect(byName("hanoman_sync_conflict_resolve").capability).toBe("sync:resolve");
    expect(byName("hanoman_update_apply").capability).toBe("instance:admin");
    expect(byName("hanoman_instance_restart").capability).toBe("instance:admin");
    expect(byName("hanoman_agent_guide").capability).toBeNull();
    for (const n of ["hanoman_sync_conflict_resolve", "hanoman_update_apply", "hanoman_instance_restart"])
      expect(byName(n).mode, n).toBe("danger");
  });

  it("confirm wajib di skema update/restart, dan false dikirim APA ADANYA (laporan, bukan eksekusi)", () => {
    for (const n of ["hanoman_update_apply", "hanoman_instance_restart"]) {
      const t = byName(n);
      expect(t.inputSchema.required, n).toContain("confirm");
      expect(t.build({ confirm: true })!.body, n).toEqual({ confirm: true });
      expect(t.build({ confirm: false })!.body, n).toEqual({ confirm: false });
      // nilai yang bukan boolean true TIDAK boleh lolos jadi eksekusi
      expect(t.build({ confirm: "true" })!.body, n).toEqual({ confirm: false });
      expect(t.build({})!.body, n).toEqual({ confirm: false });
    }
    expect(byName("hanoman_update_apply").build({ confirm: true })).toMatchObject({ method: "POST", path: "/update/apply" });
    expect(byName("hanoman_instance_restart").build({ confirm: true })).toMatchObject({ method: "POST", path: "/restart" });
  });

  it("resolve: id di-encode ke path dan choice diteruskan; hint menjelaskan ok:false", () => {
    const t = byName("hanoman_sync_conflict_resolve");
    expect(t.inputSchema.required).toEqual(["entity", "recordId", "choice"]);
    const req = t.build({ entity: "spec", recordId: "a/b c", choice: "server" })!;
    expect(req).toMatchObject({ method: "POST", body: { choice: "server" } });
    expect(req.path).toBe("/sync/conflicts/spec/a%2Fb%20c/resolve");
    expect(t.shape({ ok: true }, {})).toEqual({ ok: true });
    expect(t.shape({ ok: false, reason: "still-conflict" }, {})).toMatchObject({ ok: false, reason: "still-conflict", hint: expect.stringContaining("hidup kembali") });
  });

  it("sync_now mengirim full hanya bila true", () => {
    const t = byName("hanoman_sync_now");
    expect(t.build({})!.body).toEqual({ full: false });
    expect(t.build({ full: true })!.body).toEqual({ full: true });
  });

  it("konflik diringkas: hanya field yang berbeda, nilai dipotong, accessKeyHash tak bocor", () => {
    const long = "x".repeat(1000);
    const raw = {
      conflicts: [{
        entity: "ticket", recordId: "t1", localVersion: 3, serverVersion: 4,
        localUpdatedAt: "2026-01-01T00:00:00.000Z", serverUpdatedAt: "2026-01-02T00:00:00.000Z", detectedAt: "2026-01-03T00:00:00.000Z",
        localData: { title: "A", detail: long, status: "open", accessKeyHash: "sha-lokal" },
        serverData: { title: "B", detail: long + "y", status: "open", accessKeyHash: "sha-hub" },
      }],
    };
    const out = byName("hanoman_sync_conflicts").shape(raw, {}) as { items: { differs: { field: string; local: string; server: string }[] }[]; total: number };
    expect(out.total).toBe(1);
    const d = out.items[0]!.differs;
    expect(d.map((x) => x.field).sort()).toEqual(["detail", "title"]);   // status sama, accessKeyHash disembunyikan
    expect(d.find((x) => x.field === "detail")!.local.length).toBeLessThan(400);
    expect(JSON.stringify(out)).not.toContain("sha-lokal");
    expect(JSON.stringify(out)).not.toContain("sha-hub");
    // bentuk lain (server menjawab kosong) tidak melempar
    expect((byName("hanoman_sync_conflicts").shape({ conflicts: [] }, {}) as { total: number }).total).toBe(0);
    expect((byName("hanoman_sync_conflicts").shape(null, {}) as { total: number }).total).toBe(0);
  });

  it("pending dipaginasi dari field `deletes`", () => {
    const raw = { deletes: [{ entity: "spec", recordId: "s1", deletedAt: "x" }, { entity: "spec", recordId: "s2", deletedAt: "y" }], total: 2 };
    const out = byName("hanoman_sync_pending").shape(raw, { limit: 1 }) as { items: unknown[]; total: number };
    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(2);
  });

  it("panduan agen dibaca berpotongan dan nextOffset berakhir null", () => {
    const t = byName("hanoman_agent_guide");
    const text = "a".repeat(25000);
    const p1 = t.shape(text, {}) as { text: string; nextOffset: number | null; total: number };
    expect(p1.text).toHaveLength(10000);
    expect(p1.nextOffset).toBe(10000);
    expect(p1.total).toBe(25000);
    const p3 = t.shape(text, { offset: 20000 }) as { text: string; nextOffset: number | null };
    expect(p3.text).toHaveLength(5000);
    expect(p3.nextOffset).toBeNull();
    expect((t.shape(text, { limit: 99999 }) as { text: string }).text).toHaveLength(12000);   // plafon
    expect(t.build({})).toMatchObject({ method: "GET", path: "/agent-integration.md" });
  });
});
