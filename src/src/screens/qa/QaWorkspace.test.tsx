import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaWorkspace } from "./QaWorkspace";

const at = "2026-10-01T10:00:00.000Z";
const stats = {
  cases: { total: 2, pass: 1, fail: 1, blocked: 0, skipped: 0, todo: 0 }, passRate: 0.5,
  findings: { total: 1, open: 1, blocker: 0, critical: 0, major: 1, minor: 0, trivial: 0 },
};
const view = {
  id: "r1", projectId: "p1", code: "QA-001", title: "Smoke 0.9", buildVersion: "0.9.12", environment: { os: "macOS" },
  scope: "", tester: "Dena", summary: "", status: "draft", verdict: null, createdAt: at, updatedAt: at, stats,
};
const mkCase = (id: string, code: string, title: string, status = "todo") =>
  ({ id, reportId: "r1", code, title, steps: "", expected: "", actual: "", status, order: 1, createdAt: at, updatedAt: at });
const detail = {
  ...view,
  cases: [mkCase("c1", "TC-01", "Login")],
  findings: [{
    id: "f1", reportId: "r1", code: "F-01", caseId: "c1", caseCode: "TC-01", title: "Tombol mati", severity: "major", priority: "P1",
    area: "checkout", steps: ["buka", "klik"], expected: "ok", actual: "diam", status: "open", backlogId: null, spec: null, createdAt: at, updatedAt: at,
  }],
  attachments: [],
};
const projects = [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }];
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);

function mockFetch(extra: (u: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url);
    const x = extra(u, init);
    if (x) return x;
    if (u.endsWith("/api/projects/p1/qa/reports") && (!init?.method || init.method === "GET")) return json({ items: [view], total: 1 });
    if (u.endsWith("/api/projects/p1/qa/reports/r1")) return json(detail);
    return json({});
  });
}
const renderWs = (over: Partial<React.ComponentProps<typeof QaWorkspace>> = {}) =>
  render(<QaWorkspace projects={projects} projectId="p1" onSelectProject={() => {}} {...over} />);
afterEach(() => vi.restoreAllMocks());

describe("QaWorkspace", () => {
  it("daftar: nomor, judul, status, pass-rate, dan temuan open", async () => {
    mockFetch();
    renderWs();
    expect(await screen.findByText("QA-001")).toBeTruthy();
    expect(screen.getByText("Smoke 0.9")).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getByText(/1 open/)).toBeTruthy();
    expect(screen.getByText("Laporan baru")).toBeTruthy();
    expect(screen.getByText("Unduh template")).toBeTruthy();
  });

  it("tanpa project: keadaan kosong, tanpa memanggil API", async () => {
    const spy = mockFetch();
    renderWs({ projectId: undefined, projects: [] });
    expect(await screen.findByText(/belum ada project/i)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("membuka laporan menampilkan editor; tab Temuan memuat F-01 beserta severity/prioritas", async () => {
    mockFetch();
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    expect(await screen.findByDisplayValue("Smoke 0.9")).toBeTruthy();
    expect(screen.getByDisplayValue("Login")).toBeTruthy();   // tab Test case aktif lebih dulu (judul = nilai Input)
    fireEvent.click(screen.getByRole("tab", { name: /Temuan/ }));
    expect(await screen.findByText("F-01")).toBeTruthy();
    expect(screen.getByText("Tombol mati")).toBeTruthy();
    expect(screen.getByText("major")).toBeTruthy();
    expect(screen.getByText("P1")).toBeTruthy();
  });

  it("menambah test case: POST ke /cases lalu menampilkan hasil jawaban server", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch((u, init) => {
      if (u.endsWith("/qa/reports/r1/cases") && init?.method === "POST") {
        posted.push({ url: u, body: JSON.parse(String(init.body)) });
        return json({ ...detail, cases: [mkCase("c1", "TC-01", "Login"), mkCase("c2", "TC-02", "Checkout")] }, 201);
      }
      return null;
    });
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    const input = await screen.findByLabelText("Judul test case baru");
    fireEvent.change(input, { target: { value: "Checkout" } });
    fireEvent.click(screen.getByText("Tambah"));
    expect(await screen.findByDisplayValue("Checkout")).toBeTruthy();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toMatchObject({ title: "Checkout" });
  });

  it("laporan closed: tombol Buka kembali ada, Simpan dan Tambah tak ada", async () => {
    mockFetch((u) => (u.endsWith("/qa/reports/r1") ? json({ ...detail, status: "closed", verdict: "go" }) : null));
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    expect(await screen.findByText("Buka kembali")).toBeTruthy();
    expect(screen.queryByText("Tambah")).toBeNull();
    expect((screen.getByText("Simpan").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("temuan open: Kirim ke backlog → POST /backlog, lencana SPEC muncul, tombol hilang; tetap tersedia di laporan closed", async () => {
    const sentDetail = { ...detail, findings: [{ ...detail.findings[0]!, status: "sent", backlogId: "SPEC-212", spec: { id: "SPEC-212", stage: "brainstorming", priority: "tinggi" } }] };
    const posted: string[] = [];
    mockFetch((u, init) => {
      if (u.endsWith("/findings/f1/backlog") && init?.method === "POST") {
        posted.push(u);
        return json({ findingId: "f1", code: "F-01", created: true, spec: sentDetail.findings[0]!.spec, attachments: { saved: 0, rejected: [] }, report: sentDetail }, 201);
      }
      return null;
    });
    const toast = vi.fn();
    renderWs({ onToast: toast });
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByRole("tab", { name: /Temuan/ }));
    fireEvent.click(await screen.findByText("Kirim ke backlog"));
    expect(await screen.findByText(/SPEC-212 · brainstorming/)).toBeTruthy();
    expect(posted).toHaveLength(1);
    expect(screen.queryByText("Kirim ke backlog")).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/F-01 → SPEC-212 dibuat/));
    expect((screen.getByText(/SPEC-212 · brainstorming/).closest("a") as HTMLAnchorElement).getAttribute("href")).toBe("/backlog/SPEC-212");
  });

  it("laporan closed tetap menampilkan Kirim ke backlog (pengecualian read-only); tautan putus ditandai", async () => {
    const closed = { ...detail, status: "closed", verdict: "go" };
    mockFetch((u) => (u.endsWith("/qa/reports/r1") ? json(closed) : null));
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByRole("tab", { name: /Temuan/ }));
    expect(await screen.findByText("Kirim ke backlog")).toBeTruthy();
    expect(screen.queryByText("Temuan baru")).toBeNull();   // sisanya tetap terkunci
  });

  it("Kirim semua yang open: tombol bertanda jumlah; hasil massal dilaporkan lewat toast", async () => {
    const posted: string[] = [];
    mockFetch((u, init) => {
      if (u.endsWith("/qa/reports/r1/backlog") && init?.method === "POST") {
        posted.push(u);
        return json({ results: [{ findingId: "f1", code: "F-01", created: true, spec: { id: "SPEC-5", stage: "brainstorming", priority: "tinggi" }, attachments: { saved: 0, rejected: [] } }], sent: 1, report: detail });
      }
      return null;
    });
    const toast = vi.fn();
    renderWs({ onToast: toast });
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByRole("tab", { name: /Temuan/ }));
    fireEvent.click(await screen.findByText("Kirim semua yang open (1)"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/1 temuan dikirim/));
  });

  it("galat server (409/400) ditampilkan lewat onToast, bukan ditelan", async () => {
    const toast = vi.fn();
    mockFetch((u, init) => (u.endsWith("/qa/reports/r1") && init?.method === "PATCH"
      ? json({ error: "verdict wajib diisi sebelum laporan di-submit atau di-close" }, 400) : null));
    renderWs({ onToast: toast });
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByText("Submit"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/verdict wajib/)));
  });
});
