import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";
const envelope = (items: unknown[]) => new Response(
  JSON.stringify({ items, total: items.length, page: 1, pageSize: 20 }),
  { status: 200, headers: { "content-type": "application/json" } });
const PROJECT = { id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
  docStatus: "ok", coverage: 94, createdAt: new Date().toISOString(), backlog: 2, topStage: "execute",
  run: { status: "running", phase: "Execute", kind: "feature" }, activity: "x", commit: "y" };
beforeEach(() => { globalThis.fetch = vi.fn(async () => envelope([PROJECT])) as any; });
describe("api client", () => {
  it("listProjects hits /api/projects and returns an envelope", async () => {
    const ps = await api.listProjects();
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects");
    expect(ps.items[0]!.backlog).toBe(2);
    expect(ps.total).toBe(1);
  });
  // SPEC-198 · params → query string; respons envelope.
  it("listSpecs builds a query string and returns an envelope", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    const r = await api.listSpecs({ project: "p1", q: "x", stage: "planned", page: 2, limit: 20 });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/specs?");
    expect(url).toContain("project=p1");
    expect(url).toContain("stage=planned");
    expect(url).toContain("page=2");
    expect(r.total).toBe(0);
    expect(Array.isArray(r.items)).toBe(true);
  });
  // SPEC-408 · ADR-0090 · tiga param filter tanggal harus sampai ke query string apa adanya.
  it("listSpecs mengirim dateField/from/to (SPEC-408)", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listSpecs({ project: "p", dateField: "started", from: "2026-07-01", to: "2026-07-31" });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("dateField=started");
    expect(url).toContain("from=2026-07-01");
    expect(url).toContain("to=2026-07-31");
  });
  it("listSpecs membuang param tanggal kosong (SPEC-408)", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listSpecs({ project: "p", from: "", to: "" });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");
  });
  it("listProjects passes q as a query param", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listProjects({ q: "arta" });
    expect((globalThis.fetch as any).mock.calls[0][0]).toContain("/api/projects?q=arta");
  });
  it("deleteDoc issues DELETE to the doc path", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as any;
    await api.deleteDoc("p1", "internal/docs/x.md");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/projects/p1/docs/internal/docs/x.md");
    expect(init.method).toBe("DELETE");
  });
  // SPEC-519 · kotak cari halaman Changelog mengirim `q` ke endpoint yang sudah ada.
  it("listChangelogs mengirim q/page/limit ke query string", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listChangelogs("p1", { q: "laporan", page: 2, limit: 12 });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/projects/p1/changelog?");
    expect(url).toContain("q=laporan");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=12");
  });
  it("listChangelogs membuang q kosong", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listChangelogs("p1", { q: "" });
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects/p1/changelog");
  });
  // SPEC-519 · deep-link `#changelog=<p>&cl=<id>` bisa menunjuk rilis yang tak ada di halaman 1.
  it("getChangelog mengambil satu rilis lewat endpoint item", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "c1" }),
      { status: 200, headers: { "content-type": "application/json" } })) as any;
    const r = await api.getChangelog("p1", "c1");
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects/p1/changelog/c1");
    expect(r.id).toBe("c1");
  });
});
