// ADR-0217 · opsi C dari ADR-0216, sisi layar. (1) hub: "Minta tingkat…" per perangkat remote; (2) perangkat
// ini: kartu persetujuan permintaan yang masuk lewat relay. Tombol setujui selalu lewat konfirmasi.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { AccessRequestView, PresenceControlView, PresenceDeviceView, PresenceView } from "@hanoman/shared";
import { ClientsScreen } from "../src/screens/ClientsScreen";
import { RemoteAccessCard } from "../src/screens/RemoteControlPanel";
import { requestBlockReason, hostOf, REQUEST_STATUS_LABEL } from "../src/screens/access-request";
import { api, ApiError } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, msg: string, public detail: unknown = null) { super(msg); }
  },
  api: {
    presence: vi.fn(),
    issueWsTicket: vi.fn().mockResolvedValue({ ticket: "t" }),
    getRemoteControl: vi.fn(),
    putRemoteControl: vi.fn(),
    listRemoteAccessRequests: vi.fn(),
    decideRemoteAccessRequest: vi.fn(),
    listDeviceAccessRequests: vi.fn(),
    requestDeviceAccess: vi.fn(),
    listClientAccounts: vi.fn().mockResolvedValue({ items: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [] }),
  },
  logs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  logTranscript: vi.fn().mockResolvedValue(""),
  logRetention: vi.fn().mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 }),
  putLogRetention: vi.fn().mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 }),
  createApi: () => ({ issueWsTicket: vi.fn().mockResolvedValue({ ticket: "t" }) }),
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

const ctl = (capabilities: PresenceControlView["capabilities"] = []): PresenceControlView =>
  ({ state: "available", protocol: 1, version: "0.5.0", capabilities, since: "" });
const remote = (deviceId: string, extra: Partial<PresenceDeviceView> = {}): PresenceDeviceView => ({
  deviceId, name: "laptop", local: false, online: true, lastSeenAt: null, sessions: [], ...extra,
});
const view = (devices: PresenceDeviceView[]): PresenceView => ({ enabled: true, hubVersion: "0.5.0", devices });
const remoteControl = (enabled: boolean, capabilities: string[] = []) => ({
  control: { enabled, capabilities }, logs: { event: true, server: false, transcript: false },
  relay: { state: "off", since: null, hubOrigin: null, lastClose: null }, audit: [],
});
const pendingReq = (over: Partial<AccessRequestView> = {}): AccessRequestView => ({
  id: "ar1", tier: "kerja", status: "pending", requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(), decidedAt: null,
  from: "https://hub.example", requestedBy: "op@hub.example", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getRemoteControl).mockResolvedValue(remoteControl(true) as any);
  vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [] });
  vi.mocked(api.listDeviceAccessRequests).mockResolvedValue({ items: [] });
});

describe("fungsi murni permintaan tingkat (ADR-0217)", () => {
  it("requestBlockReason: offline, protokol tak cocok, dan tanpa kendali menghasilkan alasan; kendali aktif tanpa grant boleh", () => {
    expect(requestBlockReason(remote("d1", { online: false, control: ctl(["sessions:read"]) }))).toMatch(/offline/);
    expect(requestBlockReason(remote("d1", { control: { ...ctl(), state: "protocol-mismatch" } }))).toMatch(/protokol/);
    expect(requestBlockReason(remote("d1", { control: null }))).toMatch(/belum diizinkan/);
    // Meminta Lihat tak butuh grant apa pun di pihak peminta.
    expect(requestBlockReason(remote("d1", { control: ctl([]) }))).toBeNull();
  });

  it("hostOf memangkas origin ke host; status punya label untuk keempat keadaan", () => {
    expect(hostOf("https://hub.example")).toBe("hub.example");
    expect(hostOf("bukan-url")).toBe("bukan-url");
    expect(Object.keys(REQUEST_STATUS_LABEL).sort()).toEqual(["approved", "expired", "pending", "rejected"]);
  });
});

describe("hub · Perangkat: Minta tingkat… per perangkat remote", () => {
  it("perangkat remote online dengan kendali aktif: tombol aktif; kirim memakai tingkat terpilih dan menampilkan status", async () => {
    vi.mocked(api.requestDeviceAccess).mockResolvedValue({ request: pendingReq({ tier: "lihat" }) });
    vi.mocked(api.listDeviceAccessRequests)
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({ items: [pendingReq({ tier: "lihat", id: "ar9" })] });
    render(<ClientsScreen view={view([remote("d1", { control: ctl([]) })])} specTitles={{}} onOpenSpec={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Minta tingkat…" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim permintaan" }));
    await waitFor(() => expect(api.requestDeviceAccess).toHaveBeenCalledWith("d1", "lihat"));
    const status = await screen.findByTestId("device-request-status-ar9");
    expect(status).toHaveTextContent("Lihat · menunggu persetujuan di perangkat itu");
  });

  it("kendali belum diizinkan di perangkat: tombol mati dengan alasan, dan perangkat lokal tak punya tombol ini", () => {
    render(<ClientsScreen view={view([
      remote("d1", { control: null }),
      { deviceId: "me", name: "perangkat ini", local: true, online: true, lastSeenAt: null, sessions: [] } as PresenceDeviceView,
    ])} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByRole("button", { name: "Minta tingkat…" })).toBeDisabled();
    expect(screen.getByText(/tak ada permintaan yang bisa dikirim/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Minta tingkat…" })).toHaveLength(1);
  });

  it("galat dari hub (mis. 409 perangkat belum mendukung) tampil sebagai galat, bukan diam", async () => {
    vi.mocked(api.requestDeviceAccess).mockRejectedValue(Object.assign(new Error("belum mendukung"), { status: 409 }));
    render(<ClientsScreen view={view([remote("d1", { control: ctl([]) })])} specTitles={{}} onOpenSpec={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Minta tingkat…" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim permintaan" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("perangkat ini · kartu persetujuan permintaan dari server pusat", () => {
  it("permintaan tertunda tampil dengan kalimat 'Perangkat <hub> meminta tingkat <Kerja>'", async () => {
    vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [pendingReq()] });
    render(<RemoteAccessCard />);
    const row = await screen.findByTestId("access-request-ar1");
    expect(within(row).getByText("Perangkat hub.example meminta tingkat Kerja")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Setujui" })).toBeEnabled();
  });

  it("Setujui lewat konfirmasi: menyebut dampak dan baru memanggil keputusan setelah dikonfirmasi", async () => {
    vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [pendingReq()] });
    vi.mocked(api.decideRemoteAccessRequest).mockResolvedValue({ request: pendingReq({ status: "approved" }) });
    render(<RemoteAccessCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Setujui" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Menggantikan izin kendali/)).toBeTruthy();
    expect(api.decideRemoteAccessRequest).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Izinkan Kerja" }));
    // persetujuan menyebut tingkat & hub yang dilihat di kartu (ADR-0217 §2)
    await waitFor(() => expect(api.decideRemoteAccessRequest)
      .toHaveBeenCalledWith("ar1", "approve", { tier: "kerja", from: "https://hub.example" }));
  });

  it("Setujui dengan kartu yang sudah basi (409): daftar dimuat ulang dan tampil 'Permintaan berubah, periksa lagi'", async () => {
    vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [pendingReq()] });
    vi.mocked(api.decideRemoteAccessRequest).mockRejectedValue(
      new ApiError(409, "409", { error: "Permintaan berubah, periksa lagi" }),
    );
    const toast = vi.fn();
    render(<RemoteAccessCard onToast={toast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Setujui" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Izinkan Kerja" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Permintaan berubah, periksa lagi", "err", "x-circle"));
    // muat awal + muat ulang setelah galat
    await waitFor(() => expect(api.listRemoteAccessRequests).toHaveBeenCalledTimes(2));
    expect(api.putRemoteControl).not.toHaveBeenCalled();
  });

  it("Tolak langsung memanggil keputusan tolak, tanpa dialog, dan tak mengubah grant", async () => {
    vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [pendingReq()] });
    vi.mocked(api.decideRemoteAccessRequest).mockResolvedValue({ request: pendingReq({ status: "rejected" }) });
    render(<RemoteAccessCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Tolak" }));
    await waitFor(() => expect(api.decideRemoteAccessRequest).toHaveBeenCalledWith("ar1", "reject"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.putRemoteControl).not.toHaveBeenCalled();
  });

  it("kendali mati: setujui dinonaktifkan dengan petunjuk untuk menyalakan dulu", async () => {
    vi.mocked(api.getRemoteControl).mockResolvedValue(remoteControl(false) as any);
    vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [pendingReq()] });
    render(<RemoteAccessCard />);
    const row = await screen.findByTestId("access-request-ar1");
    expect(within(row).getByRole("button", { name: "Setujui" })).toBeDisabled();
    expect(within(row).getByText(/Nyalakan kendali jarak jauh dulu/)).toBeTruthy();
  });

  it("permintaan yang sudah diputuskan atau kedaluwarsa tak lagi tampil sebagai kartu", async () => {
    vi.mocked(api.listRemoteAccessRequests).mockResolvedValue({ items: [pendingReq({ status: "expired" })] });
    render(<RemoteAccessCard />);
    await screen.findByText("Izinkan kendali jarak jauh");
    expect(screen.queryByTestId("access-requests")).toBeNull();
  });
});
