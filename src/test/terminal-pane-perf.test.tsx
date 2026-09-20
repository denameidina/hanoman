import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../src/api/client";
import { TerminalPane } from "../src/screens/TerminalPane";

// SPEC-1267 · kontrak perf pane: ring pane tersembunyi, WebGL + fallback, timer prediksi, resize.
const xt = vi.hoisted(() => ({
  written: [] as string[], resets: 0, options: {} as Record<string, unknown>,
  resize: undefined as ((e: ResizeObserverEntry[]) => void) | undefined,
  webgl: { throwOnLoad: false, disposed: 0, contextLoss: undefined as (() => void) | undefined },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80; rows = 24; options: Record<string, unknown>;
    constructor(o: Record<string, unknown>) { this.options = { ...o }; xt.options = this.options; }
    loadAddon(a: { activate?: () => void }): void { a.activate?.(); }
    open(): void {} focus(): void {}
    write(d: string, cb?: () => void): void { xt.written.push(d); cb?.(); }
    reset(): void { xt.resets += 1; }
    scrollLines(): void {} dispose(): void {}
    hasSelection(): boolean { return false; } getSelection(): string { return ""; }
    attachCustomKeyEventHandler(): void {} attachCustomWheelEventHandler(): void {}
    onData(): { dispose: () => void } { return { dispose: () => {} }; }
    get buffer() { return { active: { viewportY: 0, cursorX: 0, cursorY: 0, getLine: () => undefined } }; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit(): void {} } }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate(): void { if (xt.webgl.throwOnLoad) throw new Error("no webgl"); }
    onContextLoss(fn: () => void) { xt.webgl.contextLoss = fn; return { dispose: () => {} }; }
    dispose(): void { xt.webgl.disposed += 1; }
  },
}));

const sockets: FakeWebSocket[] = [];
class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = 1; sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = 0;
  constructor(public url: string) { sockets.push(this); }
  send(m: string): void { this.sent.push(m); }
  close(): void { this.closed += 1; this.readyState = 3; }
}
const data = (d: string) => ({ data: JSON.stringify({ t: "data", d }) });

beforeEach(() => {
  xt.written = []; xt.resets = 0; xt.options = {}; xt.resize = undefined;
  xt.webgl = { throwOnLoad: false, disposed: 0, contextLoss: undefined };
  sockets.length = 0;
  vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "t" });
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: (e: ResizeObserverEntry[]) => void) { xt.resize = cb; }
    observe(): void {} disconnect(): void {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const connected = async () => { await vi.waitFor(() => expect(sockets).toHaveLength(1)); act(() => { sockets[0]!.onopen?.(); }); };

describe("pane tersembunyi (SPEC-1267 · AC-S26)", () => {
  it("menahan keluaran saat hidden lalu memutarnya ulang berurutan saat tampil", async () => {
    const { rerender } = render(<TerminalPane sessionId="s" onExit={() => {}} hidden />);
    await connected();
    act(() => { sockets[0]!.onmessage?.(data("satu")); sockets[0]!.onmessage?.(data("dua")); });
    expect(xt.written).toEqual([]);
    rerender(<TerminalPane sessionId="s" onExit={() => {}} hidden={false} />);
    expect(xt.written).toEqual(["satu", "dua"]);
  });

  it("ring meluap: reset layar + sambung ulang (tmux menggambar ulang), bukan replay parsial", async () => {
    const { rerender } = render(<TerminalPane sessionId="s" onExit={() => {}} hidden />);
    await connected();
    act(() => { for (let i = 0; i < 6; i++) sockets[0]!.onmessage?.(data("x".repeat(100 * 1024))); });
    rerender(<TerminalPane sessionId="s" onExit={() => {}} hidden={false} />);
    expect(xt.resets).toBe(1);
    expect(sockets[0]!.closed).toBe(1);
    expect(xt.written).toEqual([]);
  });
});
