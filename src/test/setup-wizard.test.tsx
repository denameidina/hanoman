import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SetupWizard } from "../src/screens/SetupWizard";
import { api } from "../src/api/client";
import type { SetupStatus } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: { applySetup: vi.fn(async () => ({ restart: "self" })) },
  ApiError: class extends Error { status = 0 },
}));

const status = (o: Partial<SetupStatus> = {}): SetupStatus => ({
  needed: true, deployment: "local", hardening: false, hardeningLocked: false,
  supervised: true, setupTokenRequired: false,
  prerequisites: [
    { id: "podman", label: "Podman rootless", ok: false, detail: "podman tak ada" },
    { id: "network", label: "Network", ok: false, detail: null },
    { id: "egress-proxy", label: "Egress proxy", ok: false, detail: null },
    { id: "credential-dir", label: "Dir credential agen", ok: false, detail: null },
    { id: "control-origin", label: "Control origin", ok: false, detail: null },
    { id: "trust-proxy", label: "Trusted proxy", ok: false, detail: null },
    { id: "upload-scanner", label: "Scanner upload", ok: false, detail: null },
  ],
  ...o,
});

const green = (s: SetupStatus): SetupStatus =>
  ({ ...s, prerequisites: s.prerequisites.map((p) => ({ ...p, ok: true })) });

beforeEach(() => vi.clearAllMocks());

describe("SetupWizard (SPEC-884 · Fase 3N: satu layar)", () => {
  it("satu layar: peruntukan default Perangkat ini, tanpa langkah kedua", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    expect(screen.getByRole("radio", { name: /Perangkat ini/ })).toBeChecked();
    expect(screen.queryByRole("button", { name: /Lanjut/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Simpan & lanjut/ })).toBeTruthy();
  });

  it("hardening ada di Lanjutan yang tertutup, bukan di layar utama", () => {
    const { container } = render(<SetupWizard status={status()} onDone={() => {}} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toMatch(/Lanjutan/);
    expect(details!.contains(screen.getByLabelText("Aktifkan hardening"))).toBe(true);
  });

  it("toggle hardening TERKUNCI selama ada prasyarat merah", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    expect(screen.getByLabelText("Aktifkan hardening")).toBeDisabled();
    expect(screen.getByText(/podman tak ada/)).toBeTruthy();
  });

  it("prasyarat hijau → toggle bisa dinyalakan dan tersimpan", async () => {
    render(<SetupWizard status={green(status())} onDone={() => {}} />);
    const toggle = screen.getByLabelText("Aktifkan hardening");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /Simpan & lanjut/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith(
      expect.objectContaining({ hardening: true })));
  });

  it("publik + hardening ditolak → wajib mencentang pengakuan", async () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Diakses orang lain/ }));
    expect(screen.getByRole("button", { name: /Simpan/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Saya paham risikonya"));
    fireEvent.click(screen.getByRole("button", { name: /Simpan/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith(
      expect.objectContaining({ deployment: "public", acknowledgedUnhardened: true })));
  });

  it("hardening terkunci env: tak ada tombol mematikannya", () => {
    render(<SetupWizard status={status({ hardeningLocked: true, hardening: true })} onDone={() => {}} />);
    expect(screen.getByLabelText("Aktifkan hardening")).toBeDisabled();
    expect(screen.getByText(/dipasang lewat env/)).toBeTruthy();
  });

  it("setup pertama menomori 1/2; diulang dari Pengaturan tanpa nomor, dengan Batal", () => {
    const { unmount } = render(<SetupWizard status={status()} onDone={() => {}} />);
    expect(screen.getByText("hanoman · setup 1/2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Batal" })).toBeNull();
    unmount();
    render(<SetupWizard status={status({ needed: false })} onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("hanoman · setup")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Batal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Simpan$/ })).toBeTruthy();
  });

  it("diulang dari Pengaturan menampilkan peruntukan yang sudah tersimpan", () => {
    render(<SetupWizard status={status({ needed: false, deployment: "public" })} onDone={() => {}} />);
    expect(screen.getByRole("radio", { name: /Diakses orang lain/ })).toBeChecked();
  });

  it("galat simpan membawa alasan server, tak diganti kalimat generik", async () => {
    vi.mocked(api.applySetup).mockRejectedValueOnce(new Error("disk penuh"));
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Simpan & lanjut/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gagal menyimpan setup: disk penuh");
  });

  it("tombol Simpan yang nonaktif menjelaskan alasannya (pengakuan risiko)", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Diakses orang lain/ }));
    expect(screen.getByText("Centang pernyataan risiko untuk melanjutkan tanpa hardening.")).toBeTruthy();
  });
});
