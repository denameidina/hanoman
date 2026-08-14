import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const VPS = {
  id: "v1", name: "web-1", host: "203.0.113.10", port: 22, user: "deploy", keyPath: null,
  createdAt: "2026-07-10T00:00:00Z", lastSeenAt: null, health: null,
  lastAuditAt: null, audit: null, hardened: false,
};
// vi.mock di-hoist ke atas berkas — factory-nya TIDAK boleh merujuk `const` biasa.
// vi.hoisted menaikkan mock fn-nya bersama vi.mock, jadi test bisa memeriksanya.
const { updateVps, testVps, vpsSession, vpsConsole, vpsChecklist } = vi.hoisted(() => ({
  updateVps: vi.fn(),
  testVps: vi.fn(async () => ({ ok: true, out: "" })),
  vpsSession: vi.fn(async () => ({ id: "vps-v1" })),
  vpsConsole: vi.fn(async () => ({ id: "vpsc-v1" })),
  vpsChecklist: vi.fn(async () => ({
    vpsId: "v1", scoreTotal: 77, lastAuditAt: null, scoreBySection: { ssh: 77 },
    sections: [{ id: "ssh", title: "SSH", icon: "🔑", score: 77, items: [
      { id: "ssh-b2", section: "ssh", sectionTitle: "SSH", level: "Basic", title: "Nonaktifkan login root",
        mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
        status: "fail", na: false, attested: false, drifted: false, actorEmail: null, naReason: null, attestNote: null }] }],
  })),
}));
vi.mock("../src/api/client", () => ({
  api: { listVps: vi.fn(async () => [VPS]), updateVps, testVps, vpsSession, vpsConsole, vpsChecklist },
  ApiError: class extends Error {},
}));
import { VpsScreen, isReachable, hardenedLabel, vpsFormToBody } from "../src/screens/VpsScreen";

describe("VpsScreen (SPEC-164)", () => {
  it("badge: belum diaudit → unknown; audit ada → hardened/belum", () => {
    expect(hardenedLabel(VPS as never)).toBe("unknown");
    expect(hardenedLabel({ ...VPS, lastAuditAt: "2026-07-10T01:00:00Z", hardened: true } as never)).toBe("hardened");
    expect(hardenedLabel({ ...VPS, lastAuditAt: "2026-07-10T01:00:00Z", hardened: false } as never)).toBe("belum");
  });
  it("reachable = lastSeenAt < 10 menit (2× interval healthcheck)", () => {
    const now = Date.parse("2026-07-10T10:00:00Z");
    expect(isReachable({ ...VPS, lastSeenAt: "2026-07-10T09:55:00Z" } as never, now)).toBe(true);
    expect(isReachable({ ...VPS, lastSeenAt: "2026-07-10T09:45:00Z" } as never, now)).toBe(false);
    expect(isReachable(VPS as never, now)).toBe(false);
  });
  it("render daftar dari api", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    expect(await screen.findByText("web-1")).toBeTruthy();
    expect(screen.getByText("deploy@203.0.113.10")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buka detail web-1" })).toBeInTheDocument();
  });
  it("tombol Console memanggil api.vpsConsole lalu pindah ke terminal (SPEC-211)", async () => {
    const onGotoTerminal = vi.fn();
    render(<VpsScreen onToast={() => {}} onGotoTerminal={onGotoTerminal} />);
    await screen.findByText("web-1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /console/i })); });
    await vi.waitFor(() => expect(vpsConsole).toHaveBeenCalledWith("v1"));
    await vi.waitFor(() => expect(onGotoTerminal).toHaveBeenCalledWith("vpsc-v1"));
  });
  it("tombol Sesi Claude membuka ID sesi yang dikembalikan API", async () => {
    const onGotoTerminal = vi.fn();
    render(<VpsScreen onToast={() => {}} onGotoTerminal={onGotoTerminal} />);
    await screen.findByText("web-1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sesi Claude" })); });
    expect(vpsSession).toHaveBeenCalledWith("v1");
    expect(onGotoTerminal).toHaveBeenCalledWith("vps-v1");
  });
  it("tombol Test memanggil api.testVps (SPEC-211)", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    await screen.findByText("web-1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^test$/i })); });
    await vi.waitFor(() => expect(testVps).toHaveBeenCalledWith("v1"));
  });
  it("klik baris VPS membuka modal detail+checklist langsung (UI 2026-07-18)", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    fireEvent.click(await screen.findByText("web-1")); // klik baris → modal langsung terbuka
    expect(await screen.findByTestId("score-total")).toBeTruthy(); // modal termuat
    expect(screen.getByTestId("vps-detail")).toBeTruthy();         // detail (bekas side panel) ikut di modal
    await vi.waitFor(() => expect(vpsChecklist).toHaveBeenCalledWith("v1"));
  });
});

describe("form → body (SPEC-165)", () => {
  const base = { name: "w", host: "h", user: "root", port: "22", keyPath: "", password: "" };
  it("password kosong tak dikirim; keyPath kosong tak dikirim", () => {
    expect(vpsFormToBody(base)).toEqual({ name: "w", host: "h", user: "root", port: 22 });
  });
  it("password diisi ikut terkirim", () => {
    expect(vpsFormToBody({ ...base, password: "s3cret" }).password).toBe("s3cret");
  });
  it("port bukan angka jatuh ke 22", () => {
    expect(vpsFormToBody({ ...base, port: "abc" }).port).toBe(22);
  });
});

describe("modal edit (SPEC-165)", () => {
  it("tombol Edit membuka modal berisi nilai VPS, submit memanggil updateVps", async () => {
    updateVps.mockResolvedValue({ ...VPS, name: "web-1b" });
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    fireEvent.click(await screen.findByTitle("Edit web-1"));
    expect(await screen.findByDisplayValue("web-1")).toBeTruthy();
    expect(screen.getByDisplayValue("203.0.113.10")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Simpan")); });
    expect(updateVps).toHaveBeenCalled();
    expect(updateVps.mock.calls[0]![0]).toBe("v1");
  });
});
