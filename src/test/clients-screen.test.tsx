import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientsScreen, sinceLabel } from "../src/screens/ClientsScreen";
import { api } from "../src/api/client";
import type { PresenceView } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({ api: { presence: vi.fn() } }));

const view: PresenceView = {
  enabled: true,
  devices: [{
    deviceId: "local", name: "mac-dena", local: true, online: true,
    lastSeenAt: "2026-08-24T01:00:00.000Z",
    sessions: [{
      sessionId: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
      phase: "Execute", agent: "claude", status: "working",
      startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:30:00.000Z",
    }],
  }, {
    deviceId: "d2", name: "laptop", local: false, online: false,
    lastSeenAt: "2026-08-23T20:00:00.000Z", sessions: [],
  }],
};

describe("ClientsScreen", () => {
  it("menampilkan device online dan offline", () => {
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByText("mac-dena")).toBeTruthy();
    expect(screen.getByText("laptop")).toBeTruthy();
    expect(screen.getByTestId("device-state-local").textContent).toContain("online");
    expect(screen.getByTestId("device-state-d2").textContent).toContain("offline");
  });

  it("menampilkan sesi berikut fase dan judul spec", () => {
    render(<ClientsScreen view={view} specTitles={{ "SPEC-919": "Hub melihat sesi klien" }}
      onOpenSpec={() => {}} />);
    expect(screen.getByText("SPEC-919")).toBeTruthy();
    expect(screen.getByText("Hub melihat sesi klien")).toBeTruthy();
    expect(screen.getByTestId("presence-session-spec-919").textContent).toContain("Execute");
  });

  it("baris SPEC bisa diklik ke detail backlog", () => {
    const onOpenSpec = vi.fn();
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={onOpenSpec} />);
    fireEvent.click(screen.getByTestId("presence-session-spec-919"));
    expect(onOpenSpec).toHaveBeenCalledWith("SPEC-919");
  });

  it("device tanpa sesi memberi kalimat kosong, bukan daftar kosong", () => {
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByTestId("device-empty-d2")).toBeTruthy();
  });

  it("sesi tanpa specId tak bisa diklik", () => {
    const onOpenSpec = vi.fn();
    const v: PresenceView = {
      enabled: true,
      devices: [{
        deviceId: "local", name: "mac-dena", local: true, online: true, lastSeenAt: null,
        sessions: [{
          sessionId: "prd-abc", projectId: "hanoman", agent: "codex", status: "working",
          startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
        }],
      }],
    };
    render(<ClientsScreen view={v} specTitles={{}} onOpenSpec={onOpenSpec} />);
    fireEvent.click(screen.getByTestId("presence-session-prd-abc"));
    expect(onOpenSpec).not.toHaveBeenCalled();
  });
});

describe("ClientsScreen muat awal HTTP", () => {
  beforeEach(() => { vi.mocked(api.presence).mockReset(); });

  it("menarik /api/presence hanya saat frame siar belum membawa apa pun", async () => {
    vi.mocked(api.presence).mockResolvedValue({
      enabled: true,
      devices: [{
        deviceId: "d9", name: "dari-http", local: false, online: true,
        lastSeenAt: null, sessions: [],
      }],
    });
    render(<ClientsScreen view={{ enabled: false, devices: [] }} specTitles={{}} onOpenSpec={() => {}} />);
    await waitFor(() => expect(screen.getByText("dari-http")).toBeTruthy());
  });

  it("tidak menarik apa pun saat frame siar sudah membawa device", () => {
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={() => {}} />);
    expect(api.presence).not.toHaveBeenCalled();
  });

  it("server lama (fetch gagal) tetap merender keadaan kosong, bukan melempar", async () => {
    vi.mocked(api.presence).mockRejectedValue(new Error("404"));
    render(<ClientsScreen view={{ enabled: false, devices: [] }} specTitles={{}} onOpenSpec={() => {}} />);
    await waitFor(() => expect(screen.getByText("Belum ada device")).toBeTruthy());
  });
});

describe("sinceLabel", () => {
  const T = Date.parse("2026-08-24T12:00:00.000Z");
  const lalu = (ms: number) => new Date(T - ms).toISOString();

  it("di bawah satu menit", () => expect(sinceLabel(lalu(30_000), T)).toBe("baru saja"));
  it("menit", () => expect(sinceLabel(lalu(42 * 60_000), T)).toBe("42 mnt"));
  it("jam + sisa menit", () => expect(sinceLabel(lalu(3 * 3_600_000 + 7 * 60_000), T)).toBe("3 jam 7 mnt"));
  it("hari", () => expect(sinceLabel(lalu(50 * 3_600_000), T)).toBe("2 hari"));
  it("batas 60 menit naik ke jam", () => expect(sinceLabel(lalu(60 * 60_000), T)).toBe("1 jam 0 mnt"));

  /* Dua guard yang tak akan pernah tersentuh render normal — dan keduanya menutupi keadaan yang
     BISA terjadi: jam device klien berbeda dari jam hub (stempel di masa depan), dan stempel
     rusak yang lolos dari instance versi lain. */
  it("stempel di masa depan tak menghasilkan angka negatif", () =>
    expect(sinceLabel(new Date(T + 60_000).toISOString(), T)).toBe("—"));
  it("stempel tak terbaca tak menghasilkan NaN", () =>
    expect(sinceLabel("bukan-tanggal", T)).toBe("—"));
});
