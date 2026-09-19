import type { RemoteCapability } from "@hanoman/shared";
import { render, cleanup, act, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalPane } from "../src/screens/TerminalPane";
import { InstanceProvider } from "../src/api/instance";

const xt = vi.hoisted(() => ({
  written: [] as string[],
  resized: [] as { cols: number; rows: number }[],
  dataHandler: undefined as ((data: string) => void) | undefined,
  resizeCb: undefined as ((entries: ResizeObserverEntry[]) => void) | undefined,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public cols = 80;
    public rows = 24;
    public options: Record<string, unknown> = {};
    constructor(options: Record<string, unknown>) { this.options = options; }
    public loadAddon(): void { }
    public open(): void { }
    public focus(): void { }
    public write(d: string, cb?: () => void): void { xt.written.push(d); cb?.(); }
    public resize(cols: number, rows: number): void {
      this.cols = cols; this.rows = rows; xt.resized.push({ cols, rows });
    }
    public scrollLines(): void { }
    public dispose(): void { }
    public hasSelection(): boolean { return false; }
    public getSelection(): string { return ""; }
    public attachCustomKeyEventHandler(): void { }
    public attachCustomWheelEventHandler(): void { }
    public onData(fn: (data: string) => void): { dispose: () => void } {
      xt.dataHandler = fn;
      return { dispose: () => { xt.dataHandler = undefined; } };
    }
    public get buffer() {
      return { active: { viewportY: 0, cursorX: 0, cursorY: 0, getLine: () => undefined } };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { public fit(): void { } } }));

const sockets: FakeWebSocket[] = [];
class FakeWebSocket {
  public static readonly OPEN = 1;
  public readyState = 1;
  public sent: string[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: ((ev: { code: number }) => void) | null = null;
  public onerror: (() => void) | null = null;
  constructor(public url: string, public protocols?: string[]) { sockets.push(this); }
  public send(m: string): void { this.sent.push(m); }
  public close(): void { this.readyState = 3; }
}

const remoteInstance = {
  kind: "remote" as const, deviceId: "dev1", name: "laptop", version: "0.5.0", protocol: 1,
  capabilities: ["sessions:read"] as RemoteCapability[],
};

const paneHost = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>('[data-testid="terminal-host"]')!;

beforeEach(() => {
  xt.written = []; xt.resized = []; xt.dataHandler = undefined; xt.resizeCb = undefined;
  sockets.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ ticket: "ws-once" }),
  }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: (entries: ResizeObserverEntry[]) => void) { xt.resizeCb = cb; }
    observe(): void { } disconnect(): void { }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const resizeSentOf = (s?: FakeWebSocket) => (s?.sent ?? [])
  .map((m) => JSON.parse(m) as { t: string })
  .filter((f) => f.t === "resize");

describe("TerminalPane mode=remote (SPEC-1218 · AC-C2/AC-C3)", () => {
  it("resize kontainer tak pernah mengirim frame resize", async () => {
    const { container } = render(
      <InstanceProvider value={remoteInstance}>
        <TerminalPane sessionId="s1" onExit={() => {}} mode="remote" />
      </InstanceProvider>,
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    act(() => { sockets[0]?.onopen?.(); });
    xt.resizeCb?.([{ contentRect: { width: 640, height: 360 } } as ResizeObserverEntry]);
    expect(resizeSentOf(sockets[0])).toHaveLength(0);
  });

  it("frame geometry masuk → term.resize(cols, rows), fit dilewati", async () => {
    render(
      <InstanceProvider value={remoteInstance}>
        <TerminalPane sessionId="s1" onExit={() => {}} mode="remote" />
      </InstanceProvider>,
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    act(() => { sockets[0]?.onmessage?.({ data: JSON.stringify({ t: "geometry", cols: 132, rows: 43 }) }); });
    expect(xt.resized).toContainEqual({ cols: 132, rows: 43 });
  });

  it("tanpa sessions:write → tak ada TerminalComposer/TerminalKeys dirender walau showKeys=true", async () => {
    render(
      <InstanceProvider value={remoteInstance}>
        <TerminalPane sessionId="s1" onExit={() => {}} mode="remote" showKeys />
      </InstanceProvider>,
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByTestId("terminal-composer")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /tombol terminal/i })).not.toBeInTheDocument();
  });

  it("ticket admisi memakai relay:deviceId:target, bukan target lokal", async () => {
    render(
      <InstanceProvider value={remoteInstance}>
        <TerminalPane sessionId="s1" onExit={() => {}} mode="remote" />
      </InstanceProvider>,
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(sockets[0]!.url).toContain("/api/devices/dev1/relay/terminal/sessions/s1/ws");
  });
});
