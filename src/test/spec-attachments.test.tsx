import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AttachmentPicker, SpecAttachmentsPanel } from "../src/screens/SpecAttachments";

const attachments = [
  { id: "a1", filename: "layar.png", mimeType: "image/png", size: 2048, createdAt: "2026-08-19T00:00:00.000Z" },
  { id: "a2", filename: "error.log", mimeType: "text/plain", size: 4096, createdAt: "2026-08-19T00:01:00.000Z" },
];
const listSpecAttachments = vi.fn(async () => ({ attachments }));
const deleteSpecAttachment = vi.fn(async () => ({ ok: true as const }));
const uploadSpecAttachments = vi.fn(async () => ({ saved: [], rejected: [{ filename: "x.exe", reason: "type" }] }));

vi.mock("../src/api/client", () => ({
  api: {
    listSpecAttachments: (...a: unknown[]) => listSpecAttachments(...(a as [])),
    deleteSpecAttachment: (...a: unknown[]) => deleteSpecAttachment(...(a as [])),
    uploadSpecAttachments: (...a: unknown[]) => uploadSpecAttachments(...(a as [])),
  },
}));

beforeEach(() => {
  listSpecAttachments.mockClear(); deleteSpecAttachment.mockClear(); uploadSpecAttachments.mockClear();
});

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("SPEC-843 · UI lampiran backlog", () => {
  it("panel menampilkan thumbnail gambar dan ikon+nama dokumen", async () => {
    render(<SpecAttachmentsPanel specId="SPEC-1" onToast={vi.fn()} />);
    expect(await screen.findByAltText("layar.png")).toBeTruthy();
    expect(screen.getByText("error.log")).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
    expect(screen.getByLabelText("Unduh error.log")).toBeTruthy();
  });

  it("tombol hapus memanggil API lalu memuat ulang daftar", async () => {
    render(<SpecAttachmentsPanel specId="SPEC-1" onToast={vi.fn()} />);
    await screen.findByAltText("layar.png");
    fireEvent.click(screen.getByLabelText("Hapus lampiran layar.png"));
    await waitFor(() => expect(deleteSpecAttachment).toHaveBeenCalledWith("SPEC-1", "a1"));
    await waitFor(() => expect(listSpecAttachments).toHaveBeenCalledTimes(2));
  });

  it("penolakan per-berkas dilaporkan ke operator, tak senyap", async () => {
    const onToast = vi.fn();
    const { container } = render(<SpecAttachmentsPanel specId="SPEC-1" onToast={onToast} />);
    await screen.findByAltText("layar.png");
    const zone = container.querySelector("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [file("x.exe", "application/x-msdownload")], types: ["Files"] } });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("x.exe"), "warn"));
  });

  it("picker menerima drop berkas dan menampilkannya sebelum item dibuat", async () => {
    const onChange = vi.fn();
    const { container } = render(<AttachmentPicker files={[]} onChange={onChange} />);
    const zone = container.querySelector("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [file("catatan.md", "text/markdown")], types: ["Files"] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![0]![0].name).toBe("catatan.md");
  });

  it("picker menampilkan berkas yang sudah dipilih beserta tombol buang", () => {
    const onChange = vi.fn();
    render(<AttachmentPicker files={[file("a.pdf", "application/pdf")]} onChange={onChange} />);
    expect(screen.getByText("a.pdf")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Buang a.pdf"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
