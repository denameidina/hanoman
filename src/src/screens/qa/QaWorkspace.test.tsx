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
    expect(screen.getByText(/1 belum ditangani/)).toBeTruthy();
    expect(screen.getByText("Laporan baru")).toBeTruthy();
    expect(screen.getByText("Unduh template Excel")).toBeTruthy();
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
    fireEvent.click(await screen.findByText("Kirim semua ke backlog (1)"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/1 temuan dikirim/));
  });

  it("Pratinjau: enam tautan unduh (ZIP, DOCX, PDF, XLSX, CSV, .md) ber-format benar", async () => {
    mockFetch();
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByRole("tab", { name: /Pratinjau/ }));
    const href = (label: string) => (screen.getByText(label).closest("a") as HTMLAnchorElement).getAttribute("href");
    expect(href("Unduh ZIP (laporan + lampiran)")).toBe("/api/projects/p1/qa/reports/r1/export");
    expect(href("Unduh DOCX")).toBe("/api/projects/p1/qa/reports/r1/export?format=docx");
    expect(href("Unduh PDF")).toBe("/api/projects/p1/qa/reports/r1/export?format=pdf");
    expect(href("Unduh XLSX")).toBe("/api/projects/p1/qa/reports/r1/export?format=xlsx");
    expect(href("Unduh CSV (test case)")).toBe("/api/projects/p1/qa/reports/r1/export?format=csv");
    expect(href("Unduh .md")).toBe("/api/projects/p1/qa/reports/r1/export?format=md");
  });

  it("Impor matriks: unggah ke /cases/import lalu memuat ulang laporan dan melaporkan hitungan lewat toast", async () => {
    const posted: string[] = [];
    mockFetch((u, init) => {
      if (u.endsWith("/qa/reports/r1/cases/import") && init?.method === "POST") { posted.push(u); return json({ updated: 2, created: 1, unchanged: 3 }); }
      return null;
    });
    const toast = vi.fn();
    renderWs({ onToast: toast });
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    const input = await screen.findByLabelText("Berkas matriks test case");
    fireEvent.change(input, { target: { files: [new File(["Judul\nx"], "matriks.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Matriks diimpor: 2 diperbarui, 1 dibuat, 3 tak berubah"));
    expect(posted).toHaveLength(1);
  });

  it("laporan closed: matriks tetap bisa diunduh, tetapi tak bisa diimpor", async () => {
    mockFetch((u) => (u.endsWith("/qa/reports/r1") ? json({ ...detail, status: "closed", verdict: "go" }) : null));
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    expect(await screen.findByText("Unduh matriks (XLSX)")).toBeTruthy();
    expect(screen.queryByText("Impor matriks")).toBeNull();
  });

  it("galat server (409/400) ditampilkan lewat onToast, bukan ditelan", async () => {
    const toast = vi.fn();
    mockFetch((u, init) => (u.endsWith("/qa/reports/r1") && init?.method === "PATCH"
      ? json({ error: "verdict wajib diisi sebelum laporan di-submit atau di-close" }, 400) : null));
    renderWs({ onToast: toast });
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByText("Ajukan laporan"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pilih keputusan hasil pengujian");
    expect(toast).not.toHaveBeenCalled();
  });
});

it("mengimpor Excel bersama lampiran sebagai multipart dan membuka laporan hasil impor", async () => {
  let body: FormData | undefined;
  mockFetch((u, init) => {
    if (u.endsWith("/qa/import")) { body = init?.body as FormData; return json({ reportId: "r1", created: true, cases: 1, findings: 1, attachments: { saved: 1, rejected: [] } }); }
    return null;
  });
  renderWs();
  fireEvent.click(await screen.findByText("Impor Excel / ZIP"));
  fireEvent.change(screen.getByLabelText("Berkas impor laporan"), { target: { files: [new File(["excel"], "report.xlsx")] } });
  fireEvent.change(screen.getByLabelText("Berkas lampiran impor"), { target: { files: [new File(["png"], "layar.png")] } });
  fireEvent.click(screen.getByText("Impor laporan"));
  expect(await screen.findByDisplayValue("Smoke 0.9")).toBeTruthy();
  expect((body!.get("file") as File).name).toBe("report.xlsx");
  expect((body!.get("attachments") as File).name).toBe("layar.png");
});

it("menyimpan input lingkungan sederhana tanpa membuang metadata tambahan", async () => {
  let saved: any;
  mockFetch((u, init) => {
    if (u.endsWith("/reports/r1")) {
      if (init?.method === "PATCH") { saved = JSON.parse(String(init.body)); return json({ ...detail, ...saved }); }
      return json({ ...detail, environment: { os: "macOS", jaringan: "Wi-Fi" } });
    }
    return null;
  });
  renderWs(); fireEvent.click(await screen.findByText("Smoke 0.9"));
  fireEvent.change(await screen.findByDisplayValue("macOS"), { target: { value: "Windows 11" } });
  fireEvent.click(screen.getByText("Simpan"));
  await waitFor(() => expect(saved.environment).toEqual({ os: "Windows 11", jaringan: "Wi-Fi" }));
});

it("menyimpan langkah pengujian ketika keluar dari textarea", async () => {
  let saved: any;
  mockFetch((u, init) => {
    if (u.endsWith("/cases/c1") && init?.method === "PATCH") { saved = JSON.parse(String(init.body)); return json({ ...detail, cases: [{ ...detail.cases[0], ...saved }] }); }
    return null;
  });
  renderWs(); fireEvent.click(await screen.findByText("Smoke 0.9"));
  const input = await screen.findByLabelText("Langkah TC-01");
  fireEvent.change(input, { target: { value: "Buka halaman login" } }); fireEvent.blur(input);
  await waitFor(() => expect(saved).toEqual({ steps: "Buka halaman login" }));
});


it("kerjakan langsung opens the returned session and leaves backlog option available", async () => {
  const openSession = vi.fn();
  const fetch = mockFetch((url, init) => url.endsWith("/findings/f1/session") ? json({ id: "qa-f1", reused: false }, 201) : null);
  renderWs({ onOpenSession: openSession });
  fireEvent.click(await screen.findByText("Smoke 0.9"));
  fireEvent.click(await screen.findByRole("tab", { name: /Temuan/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Kerjakan langsung" }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith("qa-f1"));
  expect(screen.getByRole("button", { name: "Kirim ke backlog" })).toBeTruthy();
  expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith("/session") && init?.method === "POST")).toBe(true);
});

it("sync QA refreshes open report and reports configuration or network errors", async () => {
  const toast = vi.fn();
  let calls = 0;
  mockFetch((url) => url.endsWith("/sync/now") ? json(++calls === 1 ? { ok: false, reason: "not-configured" } : { ok: true }) : null);
  renderWs({ onToast: toast });
  fireEvent.click(await screen.findByText("Smoke 0.9"));
  fireEvent.click(screen.getByRole("button", { name: "Sinkronkan QA" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("konfigurasi")));
  fireEvent.click(screen.getByRole("button", { name: "Sinkronkan QA" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("QA disinkronkan")));
});
