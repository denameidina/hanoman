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

describe("SetupWizard (SPEC-884)", () => {
  it("langkah 1 default device pribadi, dan lanjut ke langkah keamanan", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    expect(screen.getByLabelText("Device saya sendiri")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByLabelText("Aktifkan hardening")).not.toBeChecked();
  });

  it("toggle hardening TERKUNCI selama ada prasyarat merah", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByLabelText("Aktifkan hardening")).toBeDisabled();
    expect(screen.getByText(/podman tak ada/)).toBeTruthy();
  });

  it("prasyarat hijau → toggle bisa dinyalakan dan tersimpan", async () => {
    render(<SetupWizard status={green(status())} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    const toggle = screen.getByLabelText("Aktifkan hardening");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /Simpan/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith(
      expect.objectContaining({ hardening: true })));
  });

  it("publik + hardening ditolak → wajib mencentang pengakuan", async () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByLabelText("Diakses orang lain"));
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByRole("button", { name: /Simpan/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Saya paham risikonya"));
    fireEvent.click(screen.getByRole("button", { name: /Simpan/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith(
      expect.objectContaining({ deployment: "public", hardening: false, acknowledgedUnhardened: true })));
  });

  it("hardening terkunci env: tak ada tombol mematikannya", () => {
    render(<SetupWizard status={{ ...green(status()), hardening: true, hardeningLocked: true }} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByLabelText("Aktifkan hardening")).toBeDisabled();
    expect(screen.getByText(/dipasang lewat env/)).toBeTruthy();
  });
});
