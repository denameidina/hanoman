import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QaReportDetail } from "@hanoman/shared";
import { QaAttachments } from "./QaAttachments";

const at = "2026-10-01T10:00:00.000Z";
const att = (id: string, filename: string, mimeType: string, ownerId = "f1") =>
  ({ id, reportId: "r1", ownerType: "finding", ownerId, filename, mimeType, size: 2048, sha256: "x", syncState: "local-only", createdAt: at });
const base = {
  id: "r1", projectId: "p1", code: "QA-001", title: "T", buildVersion: "", environment: {}, scope: "", tester: "", summary: "",
  status: "draft", verdict: null, createdAt: at, updatedAt: at, cases: [], findings: [],
  stats: { cases: { total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0, todo: 0 }, passRate: null, findings: { total: 0, open: 0, blocker: 0, critical: 0, major: 0, minor: 0, trivial: 0 } },
};
const detail = { ...base, attachments: [att("a1", "layar.png", "image/png"), att("a2", "log.txt", "text/plain"), att("a3", "lain.png", "image/png", "f2")] } as unknown as QaReportDetail;
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);
afterEach(() => vi.restoreAllMocks());

const props = (over = {}) => ({ detail, projectId: "p1", locked: false, onChange: vi.fn(), onToast: vi.fn(), ownerType: "finding" as const, ownerId: "f1", ...over });

describe("QaAttachments", () => {
  it("hanya menampilkan lampiran pemiliknya; gambar bertautan ke URL penyajian, berkas lain bernama + ukuran", () => {
    render(<QaAttachments {...props()} />);
    const img = screen.getByAltText("layar.png") as HTMLImageElement;
    expect(img.src).toContain("/api/projects/p1/qa/reports/r1/attachments/a1");
    expect(screen.getByText("log.txt")).toBeTruthy();
    expect(screen.getAllByText(/2 KB/)).toHaveLength(2);   // gambar (nama · ukuran) + berkas log
    expect(screen.queryByAltText("lain.png")).toBeNull();
  });

  it("menempel screenshot (clipboard) mengunggah ke owner yang benar lalu memuat ulang laporan", async () => {
    const calls: { url: string; method?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      calls.push({ url: String(url), method: init?.method });
      if (init?.method === "POST") return json({ saved: [att("a9", "image.png", "image/png")], rejected: [] }, 201);
      return json({ ...detail, attachments: [...detail.attachments, att("a9", "image.png", "image/png")] });
    });
    const onChange = vi.fn();
    const { container } = render(<QaAttachments {...props({ onChange })} />);
    const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    fireEvent.paste(container.firstElementChild!, { clipboardData: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls[0]!.url).toContain("/qa/reports/r1/attachments?ownerType=finding&ownerId=f1");
    expect(calls[0]!.method).toBe("POST");
  });

  it("berkas > 10 MB ditolak di klien tanpa memanggil API; penolakan server dilaporkan lewat toast", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ saved: [], rejected: [{ filename: "x.sh", reason: "type" }] }, 201));
    const onToast = vi.fn();
    const { container } = render(<QaAttachments {...props({ onToast })} />);
    const big = new File([new Uint8Array(1)], "besar.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.paste(container.firstElementChild!, { clipboardData: { files: [big] } });
    expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/besar\.png.*10 MB/));
    expect(spy).not.toHaveBeenCalled();

    const sh = new File(["rm"], "x.sh", { type: "application/x-sh" });
    fireEvent.paste(container.firstElementChild!, { clipboardData: { files: [sh] } });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/x\.sh/)));
  });

  it("laporan closed: tanpa tombol Lampirkan dan Hapus", () => {
    render(<QaAttachments {...props({ locked: true })} />);
    expect(screen.queryByText("Lampirkan")).toBeNull();
    expect(screen.queryByLabelText(/Hapus lampiran/)).toBeNull();
  });
});
