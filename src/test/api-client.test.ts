import { describe, it, expect, vi } from "vitest";
import { paths } from "@hanoman/shared";
import { api } from "../src/api/client";

// SPEC-162 · SSE run dan control run sudah tak ada; yang tersisa satu POST yang membuka sesi.
describe("api client · sesi backlog", () => {
  it.each(["reverse", "scaffold", "prd", "breakdown", "history"])("forwards explicit human force for %s", async (flow) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "session-1108" }), { status: 201 }));
    if (flow === "reverse") await api.reverseDocs("p1", { force: true });
    else if (flow === "scaffold") await api.scaffoldDocs("p1", { force: true });
    else if (flow === "prd") await api.startPrd("p1", { title: "T", context: "c", outcome: "o" }, { force: true });
    else if (flow === "breakdown") await api.startBreakdown("p1", "docs/prd/a.md", { force: true });
    else await api.createTerminalFlow("p1", "reverse", { force: true });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ project: "p1", force: true });
  });

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

// ADR-0121 · operasi berkas IDE Explorer.
describe("api client · operasi berkas IDE", () => {
  it("path entry & upload", () => {
    expect(paths.ideEntry("p1")).toBe("/api/projects/p1/entry");
    expect(paths.ideEntry("p1", "src/a b.ts")).toBe("/api/projects/p1/entry?path=src%2Fa%20b.ts");
    expect(paths.ideUpload("p1")).toBe("/api/projects/p1/upload");
  });

  it("ideUpload menyusun FormData: dir → overwrite → manifest → berkas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ written: [], skipped: [] }), { status: 200 }));
    await api.ideUpload("p1", "src/ds", [
      { path: "sub/a.ts", file: new File(["A"], "a.ts") },
      { path: "b.ts", file: new File(["B"], "b.ts") },
    ], true);
    const form = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect([...form.keys()]).toEqual(["dir", "overwrite", "manifest", "file", "file"]);
    expect(form.get("dir")).toBe("src/ds");
    expect(form.get("overwrite")).toBe("1");
    expect(form.get("manifest")).toBe(JSON.stringify(["sub/a.ts", "b.ts"]));
  });

  it("ideUpload tanpa overwrite tak mengirim field-nya", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ written: [], skipped: [] }), { status: 200 }));
    await api.ideUpload("p1", "", [{ path: "a.ts", file: new File(["A"], "a.ts") }]);
    const form = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect([...form.keys()]).toEqual(["dir", "manifest", "file"]);
  });
});

// SPEC-899 · ADR-0142 · inbox keputusan pet.
describe("api client · dialog sesi", () => {
  it("sessionDialog memetakan 204 jadi null, bukan undefined", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.sessionDialog("s1")).resolves.toBeNull();
  });

  it("sessionDialog mengembalikan payload pada 200", async () => {
    const payload = {
      screenHash: "deadbeef",
      dialog: { title: "Warna?", multi: false, freeIndex: 3, notes: false, options: [], tabs: [] },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.sessionDialog("s1")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalDialog("s1"), expect.anything());
  });

  it("answerSessionDialog mem-POST screenHash + pilihan ke path jawaban", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } }));
    await api.answerSessionDialog("s1", { screenHash: "deadbeef", choice: 2 });
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalDialogAnswer("s1"), expect.objectContaining({
      method: "POST", body: JSON.stringify({ screenHash: "deadbeef", choice: 2 }),
    }));
  });
});

// SPEC-946 · papan tim. Path-nya sudah ada sejak SPEC-945 (`shared/src/api.ts`); yang belum ada
// fungsi klien yang memakainya.
describe("api client · papan tim", () => {
  const stub = (payload: unknown) => vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));

  it("listTasks membuang penyaring kosong dari query", async () => {
    const f = stub({ items: [], total: 0, page: 1, pageSize: 0 });
    await api.listTasks({ projectId: "p1", status: "doing", q: "", page: 1, limit: 200 });
    expect(f.mock.calls[0]![0]).toBe(`${paths.tasks}?projectId=p1&status=doing&page=1&limit=200`);
  });

  it("createTask mem-POST body apa adanya", async () => {
    const f = stub({ id: "t1" });
    await api.createTask({ title: "Desain", projectId: "p1" });
    expect(f.mock.calls[0]![0]).toBe(paths.tasks);
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ title: "Desain", projectId: "p1" });
  });

  it("patchTask memakai id ter-encode", async () => {
    const f = stub({ id: "t 1" });
    await api.patchTask("t 1", { status: "done" });
    expect(f.mock.calls[0]![0]).toBe("/api/tasks/t%201");
    expect(f.mock.calls[0]![1]!.method).toBe("PATCH");
  });

  // `Member.id` adalah email ternormalisasi, jadi ia SELALU memuat "@" — path yang tak di-encode
  // adalah cara id anggota mulai hilang di tengah URL.
  it("patchMember meng-encode id yang berupa email", async () => {
    const f = stub({ id: "a@x.id" });
    await api.patchMember("a@x.id", { name: "A" });
    expect(f.mock.calls[0]![0]).toBe("/api/members/a%40x.id");
  });
});
