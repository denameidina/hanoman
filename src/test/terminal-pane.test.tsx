import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../src/api/client";
import { TerminalPane } from "../src/screens/TerminalPane";

// SPEC-511 · xterm butuh canvas + pengukuran font; jsdom tak punya keduanya. Yang diuji di sini
// bukan rendering terminalnya melainkan **kontrak call site**: opsi apa yang benar-benar sampai ke
// konstruktor `Terminal`. Itu tak bisa dijawab helper murni — `clipboardIntent` (SPEC-289) sudah
// benar sejak hari pertama dan salin tetap mati, karena `term.hasSelection()` selamanya `false`
// selagi tmux `mouse on` menyalakan mouse-reporting dan xterm karenanya mematikan SelectionService.
const xt = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  keyHandler: undefined as ((e: KeyboardEvent) => boolean) | undefined,
  selection: "",
  written: [] as string[],
  focused: 0,
  fitCount: 0,
  scrolled: [] as number[],
  dataHandler: undefined as ((data: string) => void) | undefined,
  resize: undefined as ((entries: ResizeObserverEntry[]) => void) | undefined,
  wheelHandler: undefined as ((e: WheelEvent) => boolean) | undefined,
  buffer: {
    viewportY: 0,
    getLine: (_: number) => undefined as undefined | { translateToString: () => string },
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public cols = 80;
    public rows = 24;
    public options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) { xt.options = options; this.options = options; }
    public loadAddon(): void { }
    public open(): void { }
    public focus(): void { xt.focused += 1; }
    public write(d: string): void { xt.written.push(d); }
    public scrollLines(amount: number): void { xt.scrolled.push(amount); }
    public dispose(): void { }
    public hasSelection(): boolean { return xt.selection.length > 0; }
    public getSelection(): string { return xt.selection; }
    public attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean): void { xt.keyHandler = fn; }
    public attachCustomWheelEventHandler(fn: (e: WheelEvent) => boolean): void { xt.wheelHandler = fn; }
    public onData(fn: (data: string) => void): { dispose: () => void } {
      xt.dataHandler = fn;
      return { dispose: () => { xt.dataHandler = undefined; } };
    }
    public get buffer() { return { active: xt.buffer }; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { public fit(): void { xt.fitCount += 1; } } }));

const sockets: FakeWebSocket[] = [];
class FakeWebSocket {
  public static readonly OPEN = 1;
  public readyState = 1;
  public sent: string[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: ((ev: { code: number }) => void) | null = null;
  public onerror: (() => void) | null = null;
  constructor(public url: string) { sockets.push(this); }
  public send(m: string): void { this.sent.push(m); }
  public close(): void { this.readyState = 3; }
}

// SPEC-800 · pane kini membungkus host xterm dengan strip keadaan koneksi + papan tombol,
// jadi host bukan lagi `container.firstElementChild`.
const paneHost = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>('[data-testid="terminal-host"]')!;

const keydown = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ type: "keydown", metaKey: false, ctrlKey: false, shiftKey: false, ...over } as KeyboardEvent);

beforeEach(() => {
  xt.options = undefined; xt.keyHandler = undefined; xt.selection = ""; xt.written = [];
  xt.focused = 0; xt.fitCount = 0; xt.scrolled = []; xt.dataHandler = undefined; xt.resize = undefined;
  xt.wheelHandler = undefined;
  xt.buffer = { viewportY: 0, getLine: () => undefined };
  sockets.length = 0;
  vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "ws-once" });
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: (entries: ResizeObserverEntry[]) => void) { xt.resize = cb; }
    observe(): void { } disconnect(): void { }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("TerminalPane · seleksi & salin (SPEC-511)", () => {
  it("ResizeObserver fits xterm and sends its resized dimensions over the admitted WS", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const initialFits = xt.fitCount;
    xt.resize?.([{ contentRect: { width: 640, height: 360 } } as ResizeObserverEntry]);
    expect(xt.fitCount).toBe(initialFits + 1);
    expect(sockets[0]?.sent).toContain(JSON.stringify({ t: "resize", cols: 80, rows: 24 }));
  });

  it("does not fit or resize the PTY while its mobile panel is hidden", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const initialFits = xt.fitCount;
    act(() => { sockets[0]?.onopen?.(); });
    xt.resize?.([{ contentRect: { width: 0, height: 0 } } as ResizeObserverEntry]);
    expect(xt.fitCount).toBe(initialFits);
    expect(sockets[0]?.sent).not.toContain(JSON.stringify({ t: "resize", cols: 80, rows: 24 }));
  });

  it("does not focus xterm on connect for a coarse pointer", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    act(() => { sockets[0]?.onopen?.(); });
    expect(xt.focused).toBe(0);
  });

  it("retains input typed while the WebSocket is connecting and flushes it in order on open", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    sockets[0]!.readyState = 0;

    xt.dataHandler?.("abc");
    xt.dataHandler?.("123");
    expect(sockets[0]?.sent).not.toContain(JSON.stringify({ t: "in", d: "abc123" }));

    sockets[0]!.readyState = FakeWebSocket.OPEN;
    act(() => { sockets[0]?.onopen?.(); });
    expect(sockets[0]?.sent).toContain(JSON.stringify({ t: "in", d: "abc123" }));
  });

  it("owns a vertical touch gesture and scrolls xterm scrollback instead of the page", () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    const host = paneHost(container);
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      width: 640, height: 320, top: 0, right: 640, bottom: 320, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    const touch = (type: "touchstart" | "touchmove", clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: [{ clientY }] });
      host.dispatchEvent(event);
      return event;
    };

    touch("touchstart", 100);
    const move = touch("touchmove", 180);

    expect(xt.scrolled.at(-1)).toBeLessThan(0);
    expect(move.defaultPrevented).toBe(true);
  });

  it("lahir dengan macOptionClickForcesSelection agar seleksi mungkin di bawah mouse-reporting tmux", () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    // tmux `mouse on` (SPEC-209, terukur memancarkan ?1000h ?1002h ?1006h) membuat xterm memanggil
    // `SelectionService.disable()`. Di macOS satu-satunya jalan keluarnya `altKey &&
    // macOptionClickForcesSelection`, dan opsi itu default `false` — tanpa baris ini, drag polos
    // MAUPUN Option+drag sama-sama menghasilkan nol karakter (terukur di Chrome).
    expect(xt.options?.macOptionClickForcesSelection).toBe(true);
  });

  it("Cmd+C dengan seleksi menyalin isi seleksi dan tak meneruskan tombolnya ke TUI", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    xt.selection = "baris log yang diseleksi";
    const forwarded = xt.keyHandler?.(keydown({ key: "c", metaKey: true }));
    expect(writeText).toHaveBeenCalledWith("baris log yang diseleksi");
    expect(forwarded).toBe(false);
  });

  it("tanpa seleksi, Cmd+C diteruskan apa adanya — clipboard tak disentuh", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    xt.selection = "";
    expect(xt.keyHandler?.(keydown({ key: "c", metaKey: true }))).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("TerminalPane · liveness socket (SPEC-800)", () => {
  it("menyambung ulang sesudah socket tertutup dan menguras ketikan yang mengantre", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
        width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
      });
      act(() => { sockets[0]!.onopen?.(); });

      sockets[0]!.readyState = 3;
      act(() => { sockets[0]!.onclose?.({ code: 1008 }); });
      xt.dataHandler?.("ha");
      xt.dataHandler?.("lo");
      expect(sockets).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(600);
      await vi.waitFor(() => expect(sockets).toHaveLength(2));
      act(() => { sockets[1]!.onopen?.(); });
      expect(sockets[1]?.sent).toContain(JSON.stringify({ t: "in", d: "halo" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("memperlihatkan keadaan sambung ulang, bukan diam", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(() => { sockets[0]!.onopen?.(); });
      sockets[0]!.readyState = 3;
      act(() => { sockets[0]!.onclose?.({ code: 1006 }); });
      expect(container.querySelector('[data-testid="terminal-link"]')?.textContent)
        .toContain("menyambung ulang");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tidak menyambung ulang saat sesi tmux-nya memang sudah lenyap (4004)", async () => {
    vi.useFakeTimers();
    try {
      render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(() => { sockets[0]!.onclose?.({ code: 4004 }); });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("menyerah sesudah enam percobaan dan menawarkan sambung ulang manual", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      for (let i = 0; i < 7; i += 1) {
        sockets.at(-1)!.readyState = 3;
        act(() => { sockets.at(-1)!.onclose?.({ code: 1006 }); });
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(sockets).toHaveLength(7);
      const retry = container.querySelector<HTMLButtonElement>('[data-testid="terminal-link"] button')!;
      expect(retry.textContent).toContain("Sambungkan lagi");
      act(() => { retry.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(sockets).toHaveLength(8));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TerminalPane · ukuran font & gulir lokal (SPEC-800)", () => {
  it("lahir dengan ukuran font yang diminta", () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} fontSize={17} />);
    expect(xt.options?.fontSize).toBe(17);
  });

  it("menerapkan ukuran baru dengan fit + frame resize, tanpa socket baru", async () => {
    const { container, rerender } = render(
      <TerminalPane sessionId="sesi-1" onExit={() => { }} fontSize={13} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    act(() => { sockets[0]?.onopen?.(); });
    const fits = xt.fitCount;
    const resizes = sockets[0]!.sent.filter((m) => m.includes("resize")).length;
    rerender(<TerminalPane sessionId="sesi-1" onExit={() => { }} fontSize={18} />);
    expect(xt.fitCount).toBe(fits + 1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent.filter((m) => m.includes("resize")).length).toBe(resizes + 1);
  });

  it("Shift+wheel menggulir scrollback xterm dan tak diteruskan sebagai laporan mouse", () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    const forwarded = xt.wheelHandler?.({ shiftKey: true, deltaY: 100 } as WheelEvent);
    expect(forwarded).toBe(false);
    expect(xt.scrolled.at(-1)).toBeGreaterThan(0);
  });

  it("wheel polos tetap milik tmux (SPEC-209)", () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    expect(xt.wheelHandler?.({ shiftKey: false, deltaY: 100 } as WheelEvent)).toBe(true);
    expect(xt.scrolled).toHaveLength(0);
  });
});

describe("TerminalPane · papan tombol layar (SPEC-800)", () => {
  it("tak merender papan tombol kecuali diminta", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Kirim Escape ke terminal" })).toBeNull();
  });

  it("mengirim TEPAT SATU keystroke per tekan (SPEC-452)", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    const before = sockets[0]!.sent.length;
    fireEvent.click(screen.getByRole("button", { name: "Kirim panah bawah ke terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim Enter ke terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim Escape ke terminal" }));
    expect(sockets[0]!.sent.slice(before)).toEqual([
      JSON.stringify({ t: "in", d: "\x1b[B" }),
      JSON.stringify({ t: "in", d: "\r" }),
      JSON.stringify({ t: "in", d: "\x1b" }),
    ]);
  });
});

describe("TerminalPane · tap memilih opsi dialog (SPEC-800)", () => {
  const screenLines = (lines: string[]) => {
    xt.buffer.viewportY = 0;
    xt.buffer.getLine = (index: number) => {
      const text = lines[index];
      return text === undefined ? undefined : { translateToString: () => text };
    };
  };
  const tap = (el: HTMLElement, clientY: number) => {
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: [{ clientY }] });
    el.dispatchEvent(start);
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(end, "touches", { value: [] });
    Object.defineProperty(end, "changedTouches", { value: [{ clientY }] });
    el.dispatchEvent(end);
  };

  it("mengirim satu digit saat baris opsi dialog di-tap", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    screenLines([
      "❯ 1. In-memory", "  2. Redis", "  3. Tanpa cache",
      ...Array.from({ length: 20 }, () => ""),
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ]);
    const before = sockets[0]!.sent.length;
    tap(paneHost(container), 15); // baris 1 (tinggi baris 240/24 = 10px)
    expect(sockets[0]!.sent.slice(before)).toEqual([JSON.stringify({ t: "in", d: "2" })]);
  });

  it("tidak mengirim apa pun pada layar tanpa footer dialog", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    screenLines(["  1. langkah pertama", "  2. langkah kedua", "$ "]);
    const before = sockets[0]!.sent.length;
    tap(paneHost(container), 5);
    expect(sockets[0]!.sent.slice(before)).toEqual([]);
  });

  it("swipe yang menggulir tidak dianggap tap", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    const host = paneHost(container);
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    screenLines([
      "❯ 1. In-memory", "  2. Redis",
      ...Array.from({ length: 21 }, () => ""),
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ]);
    const before = sockets[0]!.sent.length;
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: [{ clientY: 100 }] });
    host.dispatchEvent(start);
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(move, "touches", { value: [{ clientY: 15 }] });
    host.dispatchEvent(move);
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(end, "touches", { value: [] });
    Object.defineProperty(end, "changedTouches", { value: [{ clientY: 15 }] });
    host.dispatchEvent(end);
    expect(sockets[0]!.sent.slice(before)).toEqual([]);
  });
});
