// ADR-0216 opsi D · Klien · Perangkat: tingkat akses yang DILAPORKAN perangkat remote (baca-saja), dan alasan
// tombol "Lihat (baca saja)" mati memeriksa capability yang dibutuhkan aksi (`sessions:read`), bukan sekadar
// ada-tidaknya `control`. Mock dan stub mengikuti clients-screen.test.tsx.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ClientsScreen, openBlockReason, reportedAccessOf } from "../src/screens/ClientsScreen";
import { TIER_GRANTS } from "../src/screens/remote-access-tier";
import {
  OPEN_BLOCK_NO_GRANT, OPEN_BLOCK_NO_READ, REPORTED_ACCESS_OWNER,
} from "../src/lib/labels";
import type { PresenceControlView, PresenceDeviceView, PresenceView, RemoteCapability } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    presence: vi.fn(),
    issueWsTicket: vi.fn().mockResolvedValue({ ticket: "t" }),
    getRemoteControl: vi.fn().mockResolvedValue({
      control: { enabled: true, capabilities: ["sessions:read"] },
      logs: { event: true, server: false, transcript: false },
      relay: { state: "off", since: null, hubOrigin: null, lastClose: null }, audit: [],
    }),
    listClientAccounts: vi.fn().mockResolvedValue({ items: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [] }),
  },
  logs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  logTranscript: vi.fn().mockResolvedValue(""),
  logRetention: vi.fn().mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 }),
  putLogRetention: vi.fn().mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 }),
  createApi: () => ({
    issueWsTicket: vi.fn().mockResolvedValue({ ticket: "t" }),
    getSpecDocs: vi.fn().mockResolvedValue({ files: [] }),
    ideTree: vi.fn().mockResolvedValue({ files: [], dirs: [] }),
    ideWorkingStatus: vi.fn().mockResolvedValue({ branch: "main", staged: [], unstaged: [] }),
    ideGraph: vi.fn().mockResolvedValue({ commits: [], current: "main", total: 0 }),
  }),
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  public cols = 80; public rows = 24; public options: Record<string, unknown> = {};
  public loadAddon(): void {} public open(): void {} public focus(): void {}
  public write(): void {} public resize(): void {} public scrollLines(): void {}
  public dispose(): void {} public hasSelection(): boolean { return false; }
  public getSelection(): string { return ""; }
  public attachCustomKeyEventHandler(): void {} public attachCustomWheelEventHandler(): void {}
  public onData(): { dispose: () => void } { return { dispose: () => {} }; }
  public get buffer() { return { active: { viewportY: 0, cursorX: 0, cursorY: 0, getLine: () => undefined } }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { public fit(): void {} } }));
vi.stubGlobal("WebSocket", class {
  public static readonly OPEN = 1;
  public readyState = 1;
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: ((ev: { code: number }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public send(): void {} public close(): void {}
});
vi.stubGlobal("ResizeObserver", class { constructor() {} observe(): void {} disconnect(): void {} });

const ctl = (capabilities: RemoteCapability[]): PresenceControlView =>
  ({ state: "available", protocol: 1, version: "0.5.0", capabilities, since: "" });

const remote = (deviceId: string, extra: Partial<PresenceDeviceView> = {}): PresenceDeviceView => ({
  deviceId, name: "laptop", local: false, online: true, lastSeenAt: null, sessions: [], ...extra,
});

const view = (devices: PresenceDeviceView[]): PresenceView => ({ enabled: true, hubVersion: "0.5.0", devices });

describe("openBlockReason: capability yang dibutuhkan aksi (ADR-0216 opsi D)", () => {
  it("enabled dengan capabilities kosong: alasan tanpa-izin, bukan null", () => {
    expect(openBlockReason(remote("d1", { control: ctl([]) }))).toBe(OPEN_BLOCK_NO_GRANT);
  });

  it("tanpa sessions:read tetapi dengan ide:read: alasan belum-Lihat-sesi", () => {
    expect(openBlockReason(remote("d1", { control: ctl(["ide:read"]) }))).toBe(OPEN_BLOCK_NO_READ);
  });

  it("sessions:read saja cukup untuk membuka", () => {
    expect(openBlockReason(remote("d1", { control: ctl(["sessions:read"]) }))).toBeNull();
  });

  it("setiap tingkat (Lihat, Kerja, Tulis) memuat sessions:read, jadi tombolnya aktif", () => {
    for (const caps of Object.values(TIER_GRANTS)) {
      expect(openBlockReason(remote("d1", { control: ctl([...caps]) }))).toBeNull();
    }
  });

  it("alasan yang sudah ada tetap berlaku: offline, protokol tak cocok, tanpa control", () => {
    expect(openBlockReason(remote("d1", { online: false, control: ctl(["sessions:read"]) })))
      .toContain("offline");
    expect(openBlockReason(remote("d1", { control: { ...ctl(["sessions:read"]), state: "protocol-mismatch" } })))
      .toContain("Versi protokol");
    expect(openBlockReason(remote("d1", { control: null }))).toContain("belum diizinkan");
  });
});

describe("reportedAccessOf: keadaan izin yang dilaporkan perangkat", () => {
  it("tiap tingkat dipetakan ke kuncinya sendiri", () => {
    expect(reportedAccessOf(remote("d1", { control: ctl([...TIER_GRANTS.lihat]) }))).toBe("lihat");
    expect(reportedAccessOf(remote("d1", { control: ctl([...TIER_GRANTS.kerja]) }))).toBe("kerja");
    expect(reportedAccessOf(remote("d1", { control: ctl([...TIER_GRANTS.tulis]) }))).toBe("tulis");
  });

  it("grant di luar tiga tingkat menjadi khusus", () => {
    expect(reportedAccessOf(remote("d1", { control: ctl(["sessions:read", "sessions:write"]) }))).toBe("khusus");
  });

  it("enabled tanpa grant: nonaktif", () => {
    expect(reportedAccessOf(remote("d1", { control: ctl([]) }))).toBe("nonaktif");
  });

  it("tanpa laporan (offline, kendali mati, relay belum tersambung): tidak-diketahui", () => {
    expect(reportedAccessOf(remote("d1", { control: null }))).toBe("tidak-diketahui");
    expect(reportedAccessOf(remote("d1", {}))).toBe("tidak-diketahui");
  });

  it("protokol tak cocok dibedakan dari tanpa laporan, meski labelnya sama", () => {
    expect(reportedAccessOf(remote("d1", { control: { ...ctl(["sessions:read"]), state: "protocol-mismatch" } })))
      .toBe("protokol-tidak-cocok");
  });
});

describe("ClientsScreen: baris Tingkat akses perangkat remote (baca-saja)", () => {
  it("menampilkan tingkat yang dilaporkan dan penanda pemilik, tanpa kontrol ubah di baris", () => {
    render(<ClientsScreen view={view([remote("d1", { control: ctl([...TIER_GRANTS.kerja]) })])}
      specTitles={{}} onOpenSpec={() => {}} />);
    const line = screen.getByTestId("device-access-d1");
    expect(line).toHaveTextContent("Tingkat akses: Kerja");
    expect(line).toHaveTextContent(REPORTED_ACCESS_OWNER);
    expect(line).toHaveTextContent("tidak dari sini");
    expect(within(line).queryByRole("radio")).toBeNull();
    expect(within(line).queryByRole("switch")).toBeNull();
    expect(within(line).queryByRole("button")).toBeNull();
  });

  it("perangkat khusus merinci grant-nya", () => {
    render(<ClientsScreen view={view([remote("d1", { control: ctl(["sessions:read", "sessions:write"]) })])}
      specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByTestId("device-access-d1")).toHaveTextContent("Tingkat akses: Khusus");
    expect(screen.getByTestId("device-access-d1")).toHaveTextContent("Rincian: Lihat sesi, Tulis ke terminal.");
  });

  it("perangkat tanpa laporan tampil Tidak diketahui, bukan Nonaktif", () => {
    render(<ClientsScreen view={view([remote("d1", { online: false, control: null })])}
      specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByTestId("device-access-d1")).toHaveTextContent("Tingkat akses: Tidak diketahui");
  });

  it("enabled tanpa grant tampil Nonaktif dan tombol Lihat mati dengan alasannya", () => {
    render(<ClientsScreen view={view([remote("d1", { control: ctl([]) })])} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByTestId("device-access-d1")).toHaveTextContent("Tingkat akses: Nonaktif");
    expect(screen.getByRole("button", { name: /lihat \(baca saja\)/i })).toBeDisabled();
    expect(screen.getByTestId("device-open-reason-d1")).toHaveTextContent(OPEN_BLOCK_NO_GRANT);
  });

  it("perangkat lokal tidak mendapat baris Tingkat akses (izinnya ada di kartu di bawah daftar)", () => {
    render(<ClientsScreen view={view([{ deviceId: "local", name: "mac-dena", local: true, online: true,
      lastSeenAt: null, sessions: [] }])} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.queryByTestId("device-access-local")).toBeNull();
  });

  it("perangkat dengan kerja tetap bisa dibuka", () => {
    render(<ClientsScreen view={view([remote("d1", { control: ctl([...TIER_GRANTS.kerja]) })])}
      specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByRole("button", { name: /lihat \(baca saja\)/i })).toBeEnabled();
    expect(screen.queryByTestId("device-open-reason-d1")).toBeNull();
  });
});
