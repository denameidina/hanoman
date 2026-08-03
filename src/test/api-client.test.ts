import { describe, it, expect, vi } from "vitest";
import { paths } from "@hanoman/shared";
import { api } from "../src/api/client";

// SPEC-162 · SSE run dan control run sudah tak ada; yang tersisa satu POST yang membuka sesi.
describe("api client · sesi backlog", () => {
  it("startSession mem-POST spec + flow ke path sesi terminal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "spec-1" }), { status: 201, headers: { "content-type": "application/json" } }));
    const res = await api.startSession({ spec: "SPEC-1", flow: "feature" });
    expect(res.id).toBe("spec-1");
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalSessions, expect.objectContaining({
      method: "POST", body: JSON.stringify({ spec: "SPEC-1", flow: "feature" }),
    }));
  });

  it("DELETE sesi mengembalikan undefined pada 204, bukan melempar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteTerminal("spec-1")).resolves.toBeUndefined();
  });

  // SPEC-170 · dokumen backlog item
  it("getSpecDocs & getSpecDocFile menuju path dokumen spec", async () => {
    // Response baru tiap panggilan: body hanya bisa dibaca sekali.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.getSpecDocs("SPEC-170");
    expect(fetchMock).toHaveBeenCalledWith(paths.specDocs("SPEC-170"), expect.anything());
    await api.getSpecDocFile("SPEC-170", "docs/superpowers/plans/x.md");
    expect(fetchMock).toHaveBeenCalledWith(paths.specDocFile("SPEC-170", "docs/superpowers/plans/x.md"), expect.anything());
  });

  // SPEC-273 · breakdown PRD → backlog
  it("getBreakdown memanggil endpoint breakdown ber-query prd", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], live: false }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.getBreakdown("p1", "docs/prd/x.md");
    expect(fetchMock).toHaveBeenCalledWith(paths.breakdown("p1", "docs/prd/x.md"), expect.anything());
  });
  it("startBreakdown mem-POST flow breakdown + prdPath ke sesi terminal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "breakdown-x" }), { status: 201, headers: { "content-type": "application/json" } }));
    await api.startBreakdown("p1", "docs/prd/x.md");
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalSessions, expect.objectContaining({
      method: "POST", body: JSON.stringify({ project: "p1", flow: "breakdown", prdPath: "docs/prd/x.md" }),
    }));
  });
  // SPEC-517 · runtime opsional untuk terminal agen biasa. Tanpa opts body HARUS tetap {project}:
  // pemanggil lama (restart riwayat, tombol lama) tak boleh berubah artinya.
  it("createTerminal tanpa opts mengirim body {project} apa adanya", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "t1" }), { status: 201, headers: { "content-type": "application/json" } }));
    await api.createTerminal("p1");
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalSessions, expect.objectContaining({
      method: "POST", body: JSON.stringify({ project: "p1" }),
    }));
  });

  it("createTerminal meneruskan agent/model/effort saat diberikan", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "t2" }), { status: 201, headers: { "content-type": "application/json" } }));
    await api.createTerminal("p1", { agent: "codex", model: "gpt-5.6-sol", effort: "high" });
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalSessions, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ project: "p1", agent: "codex", model: "gpt-5.6-sol", effort: "high" }),
    }));
  });

  it("createSpecsBatch mem-POST ke /api/specs/batch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ created: [] }), { status: 201, headers: { "content-type": "application/json" } }));
    await api.createSpecsBatch({ project: "p1", items: [{ title: "A", context: "", outcome: "", priority: "sedang" }] });
    expect(fetchMock).toHaveBeenCalledWith(paths.specsBatch, expect.objectContaining({ method: "POST" }));
  });
});

// SPEC-299 · panel scheduler
describe("api client · scheduler (SPEC-299)", () => {
  it("getSchedulerState menuju path state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ config: {}, cap: 2, liveCount: 0, sources: [], queue: [], sessions: [] }),
        { status: 200, headers: { "content-type": "application/json" } }));
    await api.getSchedulerState();
    expect(fetchMock).toHaveBeenCalledWith(paths.schedulerState, expect.anything());
  });
  it("putSchedulerConfig mem-PUT blok config ke path config", async () => {
    const cfg = { enabled: true, paused: true, maxConcurrent: 3, autonomy: "full-control",
      sources: { backlog: { enabled: true, everyMin: 15 }, triase: { enabled: false, everyMin: 30 } } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(cfg), { status: 200, headers: { "content-type": "application/json" } }));
    await api.putSchedulerConfig(cfg as never);
    expect(fetchMock).toHaveBeenCalledWith(paths.schedulerConfig, expect.objectContaining({
      method: "PUT", body: JSON.stringify(cfg) }));
  });
  it("updateProject mem-PATCH schedulerOptIn", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "a" }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.updateProject("a", { schedulerOptIn: true });
    expect(fetchMock).toHaveBeenCalledWith(paths.project("a"), expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ schedulerOptIn: true }) }));
  });
});

// SPEC-385 · URL unduh untuk pratinjau di Review & pane diff IDE (ADR-0078: query di endpoint
// yang sudah ada, bukan endpoint ekspor baru).
describe("URL unduh pratinjau review & diff (SPEC-385)", () => {
  it("review backlog & review sesi", () => {
    expect(api.specReviewFileDownloadUrl("SPEC-385", "docs/a.md", "md"))
      .toBe("/api/specs/SPEC-385/review/docs/a.md?download=md");
    expect(api.sessionReviewFileDownloadUrl("sess1", "docs/a.md", "pdf"))
      .toBe("/api/terminal/sessions/sess1/review/docs/a.md?download=pdf");
  });

  it("diff working tree: query download digabung dengan query yang sudah ada", () => {
    expect(api.ideFileDiffDownloadUrl("p1", "docs/a.md", false, "md"))
      .toBe("/api/projects/p1/file-diff?path=docs%2Fa.md&download=md");
    expect(api.ideFileDiffDownloadUrl("p1", "docs/a.md", true, "pdf"))
      .toBe("/api/projects/p1/file-diff?path=docs%2Fa.md&staged=1&download=pdf");
  });

  it("berkas commit & compare di Git Graph", () => {
    expect(api.ideCommitFileDownloadUrl("p1", "abc1234", "docs/a.md", "md"))
      .toBe("/api/projects/p1/commit/abc1234/file?path=docs%2Fa.md&download=md");
    expect(api.ideCompareFileDownloadUrl("p1", "aaa", "bbb", "docs/a.md", "pdf"))
      .toBe("/api/projects/p1/compare/file?from=aaa&to=bbb&path=docs%2Fa.md&download=pdf");
  });
});
