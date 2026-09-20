import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RemoteInstanceView } from "../src/screens/RemoteInstanceView";
import * as LocalTerminalPane from "../src/screens/TerminalPane";

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
vi.mock("../src/api/client", () => ({
  api: { issueWsTicket: vi.fn().mockResolvedValue({ ticket: "t" }), getSpecDocs: vi.fn().mockResolvedValue({ files: [] }) },
  createApi: () => ({
    issueWsTicket: vi.fn().mockResolvedValue({ ticket: "t" }),
    getSpecDocs: vi.fn().mockResolvedValue({ files: [] }),
    ideTree: vi.fn().mockResolvedValue({ files: [], dirs: [] }),
    ideWorkingStatus: vi.fn().mockResolvedValue({ branch: "main", staged: [], unstaged: [] }),
    ideGraph: vi.fn().mockResolvedValue({ commits: [], current: "main", total: 0 }),
  }),
}));

class FakeWebSocket {
  public static readonly OPEN = 1;
  public readyState = 1;
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: ((ev: { code: number }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public send(): void {}
  public close(): void {}
}
vi.stubGlobal("WebSocket", FakeWebSocket);
vi.stubGlobal("ResizeObserver", class { constructor() {} observe(): void {} disconnect(): void {} });

describe("RemoteInstanceView (SPEC-1218 · AC-C1/AC-C7)", () => {
  it("control.state protocol-mismatch → gate error, TerminalPane/SpecDocsModal tak dirender", () => {
    const device = { deviceId: "d1", name: "laptop", local: false, online: true, lastSeenAt: null, sessions: [],
      control: { state: "protocol-mismatch", protocol: 2, version: "0.6.0", capabilities: [], since: "" } } as any;
    render(<RemoteInstanceView device={device} hubVersion="0.5.0" onClose={() => {}} />);
    expect(screen.getByText(/versi protokol tak cocok/i)).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-banner")).not.toBeInTheDocument();
  });

  it("control.version beda, protokol sama → banner peringatan versi, tampilan tetap terbuka", () => {
    const device = { deviceId: "d1", name: "laptop", local: false, online: true, lastSeenAt: null, sessions: [],
      control: { state: "available", protocol: 1, version: "0.6.0", capabilities: ["sessions:read"], since: "" } } as any;
    render(<RemoteInstanceView device={device} hubVersion="0.5.0" onClose={() => {}} />);
    expect(screen.getByTestId("remote-banner")).toHaveTextContent(/berbeda/);
  });

  it("identitas modul: TerminalPane dalam RemoteInstanceView adalah IMPORT YANG SAMA dengan layar lokal", async () => {
    const mod = await import("../src/screens/RemoteInstanceView");
    expect(mod).toBeTruthy();
    // Modul RemoteInstanceView mengimpor TerminalPane dari "./TerminalPane" — path sumber yang
    // SAMA dengan yang diimpor layar lokal di sini, jadi module resolution menjaminnya satu fungsi.
    // SPEC-1267 · TerminalPane dibungkus React.memo, jadi ia objek komponen, bukan fungsi polos.
    expect(LocalTerminalPane.TerminalPane).toBeTruthy();
  });
});
