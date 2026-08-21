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
    cursorX: 0,
    cursorY: 0,
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

// SPEC-878 · ADR-0134 · frame masuk kini bernomor (`seq`), jadi asersi berpegang pada MUATANNYA,
// bukan pada bentuk JSON-nya.
const inputsOf = (s?: FakeWebSocket): string[] => (s?.sent ?? [])
  .map((m) => JSON.parse(m) as { t: string; d?: string })
  .filter((f) => f.t === "in").map((f) => f.d ?? "");

const keydown = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ type: "keydown", metaKey: false, ctrlKey: false, shiftKey: false, ...over } as KeyboardEvent);

beforeEach(() => {
  xt.options = undefined; xt.keyHandler = undefined; xt.selection = ""; xt.written = [];
  xt.focused = 0; xt.fitCount = 0; xt.scrolled = []; xt.dataHandler = undefined; xt.resize = undefined;
  xt.wheelHandler = undefined;
  xt.buffer = { viewportY: 0, cursorX: 0, cursorY: 0, getLine: () => undefined };
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
    expect(inputsOf(sockets[0])).not.toContain("abc123");

    sockets[0]!.readyState = FakeWebSocket.OPEN;
    act(() => { sockets[0]?.onopen?.(); });
    expect(inputsOf(sockets[0])).toContain("abc123");
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
      expect(inputsOf(sockets[1])).toContain("halo");
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

  it("menyerah sesudah anggaran percobaan habis dan menawarkan sambung ulang manual", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      for (let i = 0; i < 13; i += 1) {
        sockets.at(-1)!.readyState = 3;
        act(() => { sockets.at(-1)!.onclose?.({ code: 1006 }); });
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(sockets).toHaveLength(13);
      const retry = container.querySelector<HTMLButtonElement>('[data-testid="terminal-link"] button')!;
      expect(retry.textContent).toContain("Sambungkan lagi");
      act(() => { retry.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(sockets).toHaveLength(14));
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
    const before = inputsOf(sockets[0]).length;
    fireEvent.click(screen.getByRole("button", { name: "Kirim panah bawah ke terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim Enter ke terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim Escape ke terminal" }));
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["\x1b[B", "\r", "\x1b"]);
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
    const before = inputsOf(sockets[0]).length;
    tap(paneHost(container), 15); // baris 1 (tinggi baris 240/24 = 10px)
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["2"]);
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

// SPEC-816 · lampiran gambar: berkas diunggah lebih dulu, PATH-nya yang masuk ke prompt.
const imageFile = (type = "image/png") =>
  ({ type, name: "tangkapan.png", size: 4 }) as unknown as File;

describe("SPEC-816 · lampiran gambar", () => {
  it("mem-paste gambar mengunggahnya dan mengetik path-nya TANPA Enter", async () => {
    const upload = vi.spyOn(api, "uploadTerminalAttachment")
      .mockResolvedValue({ path: "/Users/d/.hanoman/uploads/terminal/sesi-1/abc.png" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [imageFile()] } });
    act(() => { paneHost(container).dispatchEvent(event); });

    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith("sesi-1", expect.anything()));
    await vi.waitFor(() => expect(inputsOf(sockets[0]))
      .toContain("/Users/d/.hanoman/uploads/terminal/sesi-1/abc.png "));
    expect(event.defaultPrevented).toBe(true);
    // Tanpa Enter: operator melanjutkan mengetik kalimatnya di sebelah path.
    expect(sockets[0]?.sent.some((s) => s.includes("\\r"))).toBe(false);
  });

  it("paste teks polos tak memanggil unggahan sama sekali", async () => {
    const upload = vi.spyOn(api, "uploadTerminalAttachment").mockResolvedValue({ path: "/x.png" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [] } });
    act(() => { paneHost(container).dispatchEvent(event); });
    expect(upload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("menyeret berkas ke pane mengunggahnya", async () => {
    const upload = vi.spyOn(api, "uploadTerminalAttachment")
      .mockResolvedValue({ path: "/tmp/seret.webp" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });

    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"], files: [] } });
    act(() => { paneHost(container).dispatchEvent(over); });
    expect(over.defaultPrevented).toBe(true);   // tanpa ini browser menolak drop-nya

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["Files"], files: [imageFile("image/webp")] },
    });
    act(() => { paneHost(container).dispatchEvent(drop); });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(inputsOf(sockets[0])).toContain("/tmp/seret.webp "));
  });

  // Diam adalah cacatnya (audit SPEC-800 §3); diam tak boleh jadi bagian perbaikannya.
  it("menulis baris merah ke pane saat unggahan ditolak", async () => {
    vi.spyOn(api, "uploadTerminalAttachment")
      .mockRejectedValue(new Error("tipe berkas tak didukung"));
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [imageFile()] } });
    act(() => { paneHost(container).dispatchEvent(event); });
    await vi.waitFor(() => expect(xt.written.join("")).toContain("tipe berkas tak didukung"));
    expect(xt.written.join("")).toContain("\x1b[31m");
  });
});

// SPEC-856 · echo prediktif. Yang diuji di sini kontrak call site-nya — keputusan murninya sudah
// dikunci `terminal-predict.test.ts`. Mock xterm tak punya buffer sungguhan, jadi yang diperiksa
// adalah string yang ditulis dan frame yang dikirim, bukan piksel.
describe("TerminalPane · echo prediktif (SPEC-856)", () => {
  const lineIs = (text: string, cursorX = 0) => {
    xt.buffer.cursorX = cursorX;
    xt.buffer.getLine = () => ({ translateToString: () => text });
  };
  const sentInputs = (): string[] => (sockets[0]?.sent ?? [])
    .map((m) => JSON.parse(m) as { t: string; d?: string })
    .filter((f) => f.t === "in").map((f) => f.d!);
  // Timer palsu dipasang SEBELUM render: `setInterval` TTL lahir di dalam effect, jadi
  // memasangnya sesudahnya meninggalkan interval yang berjalan pada jam sungguhan.
  const mount = async (node: React.ReactElement) => {
    vi.useFakeTimers();
    render(node);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    xt.written.length = 0;
  };
  afterEach(() => { vi.useRealTimers(); });

  it("menulis karakter bergaris bawah lokal lalu mengirimnya setelah jendela 16 ms", async () => {
    lineIs("");
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    act(() => { xt.dataHandler?.("a"); });
    expect(xt.written).toEqual(["\x1b[4ma\x1b[24m"]);
    expect(sentInputs()).toEqual([]);
    act(() => { vi.advanceTimersByTime(16); });
    expect(sentInputs()).toEqual(["a"]);
  });

  it("me-rollback SEBELUM data server, dalam satu write", async () => {
    lineIs("");
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    act(() => { xt.dataHandler?.("a"); });
    xt.written.length = 0;
    act(() => { sockets[0]?.onmessage?.({ data: JSON.stringify({ t: "data", d: "❯ a" }) }); });
    expect(xt.written[0]).toBe("\x1b[1D\x1b[K❯ a");
  });

  it("tak memprediksi control dan mengirimnya seketika", async () => {
    lineIs("");
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    act(() => { xt.dataHandler?.("\x1b[A"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["\x1b[A"]);
  });

  it("mengirim paste sebagai SATU frame tanpa memprediksinya", async () => {
    lineIs("");
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    act(() => { xt.dataHandler?.("tempelan panjang"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["tempelan panjang"]);
  });

  it("predict=false: nol tulis lokal dan kirim seketika (sakelar)", async () => {
    lineIs("");
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} predict={false} />);
    act(() => { xt.dataHandler?.("a"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["a"]);
  });

  // Terukur: `read -s` dan dialog trust claude sama-sama membalas NOL byte.
  it("me-rollback dan berhenti memprediksi saat TTL lewat tanpa echo", async () => {
    lineIs("");
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    act(() => { xt.dataHandler?.("a"); });
    // SPEC-878 · ADR-0134 · jam TTL baru berjalan sesudah server mengakui frame yang membawanya.
    act(() => { vi.advanceTimersByTime(20); });
    act(() => { sockets[0]?.onmessage?.({ data: JSON.stringify({ t: "ack", seq: 1 }) }); });
    xt.written.length = 0;
    act(() => { vi.advanceTimersByTime(700); });
    expect(xt.written).toEqual(["\x1b[1D\x1b[K"]);
    xt.written.length = 0;
    act(() => { xt.dataHandler?.("b"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["a", "b"]);
  });

  it("tak memprediksi di baris berpola password", async () => {
    lineIs("[sudo] password for dena:", 25);
    await mount(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    act(() => { xt.dataHandler?.("s"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["s"]);
  });
});

// SPEC-878 · brief melaporkan "layar diam meski tombol ditekan". Yang membuatnya diam ada dua:
// gerbang prediksi menolak saat socket mati, dan TTL menghapus + menyuspend 30 dtk saat pty diam
// karena jaringan — terukur 9 glyph muncul lalu dihapus, lalu 0 tulis lokal, tanpa satu pun banner.
describe("TerminalPane · umpan balik ketikan saat jaringan goyah (SPEC-878)", () => {
  const glyphs = () => xt.written.filter((w) => w.startsWith("\x1b[4m"));
  const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

  it("tetap menggambar satu glyph per keystroke selagi socket putus", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    xt.written = [];
    for (const c of [..."halo"]) act(() => { xt.dataHandler?.(c); });
    expect(glyphs()).toHaveLength(4);
  });

  it("tak menghapus glyph yang belum di-ack, betapa pun lama server diam", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    xt.written = [];
    for (const c of [..."halo"]) act(() => { xt.dataHandler?.(c); });
    await wait(800);
    expect(xt.written.some((w) => w.includes("\x1b[K"))).toBe(false);
    xt.written = [];
    act(() => { xt.dataHandler?.("x"); });
    expect(glyphs()).toHaveLength(1);
  });

  it("TTL tetap menggigit sesudah ack — jaminan SPEC-856 tak dilonggarkan", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    xt.written = [];
    act(() => { xt.dataHandler?.("a"); });
    await wait(40);
    const seq = sockets[0]!.sent.map((m) => JSON.parse(m) as { t: string; seq?: number })
      .find((f) => f.t === "in")?.seq;
    expect(seq).toBe(1);
    act(() => { sockets[0]!.onmessage?.({ data: JSON.stringify({ t: "ack", seq }) }); });
    await wait(800);
    expect(xt.written).toContain("\x1b[1D\x1b[K");
  });

  it("menggulung balik prediksi outage tepat sebelum sambungan baru menggambar", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    for (const c of [..."abc"]) act(() => { xt.dataHandler?.(c); });
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 3_000 });
    xt.written = [];
    act(() => { sockets[1]!.onopen?.(); });
    expect(xt.written[0]).toBe("\x1b[3D\x1b[K");
  });

  // SPEC-878 · transposisi harfiah: jalur mentah menyalip ketikan yang masih ditahan jendela 16 ms.
  // Terukur di jalur nyata — pty menerima `["\x1b","z"]` untuk `z` lalu Escape.
  it("mengirim tombol papan tombol SESUDAH ketikan yang masih ditahan batcher", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    const before = inputsOf(sockets[0]).length;
    act(() => { xt.dataHandler?.("z"); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Kirim Escape ke terminal" })); });
    await wait(40);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["z", "\x1b"]);
  });

  it("mengirim path lampiran SESUDAH ketikan yang masih ditahan batcher", async () => {
    vi.spyOn(api, "uploadTerminalAttachment").mockResolvedValue({ path: "/tmp/a.png" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    const before = inputsOf(sockets[0]).length;
    act(() => { xt.dataHandler?.("z"); });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["Files"], files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    act(() => { paneHost(container).dispatchEvent(drop); });
    await vi.waitFor(() => expect(inputsOf(sockets[0]).slice(before)).toEqual(["z", "/tmp/a.png "]));
  });

  it("berhenti memprediksi begitu sesi tmux-nya dinyatakan lenyap", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 4004 }); });
    xt.written = [];
    act(() => { xt.dataHandler?.("a"); });
    expect(glyphs()).toHaveLength(0);
  });
});
