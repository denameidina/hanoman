// Stub `../src/api/events` diimpor PALING DULU: factory `vi.mock` di bawah membacanya saat
// modul yang di-mock pertama kali dievaluasi — itu terjadi sebelum import di bawahnya selesai.
import { eventsStub } from "./helpers/events-stub";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification, SessionAsk, SessionDialog, SessionDialogPayload, Spec } from "@hanoman/shared";
import { api, ApiError, type TerminalSession } from "../src/api/client";
import { HanomanPet } from "../src/screens/HanomanPet";
import { NotificationsContext } from "../src/notifications/NotificationsContext";
import { PET_HIDDEN_KEY, PET_ROAM_KEY } from "../src/screens/pet-state";
import { PET_MANIFEST, durationMs, rowIndex } from "../src/screens/pet-sprite";
import { LANE_MARGIN, homeX } from "../src/screens/pet-walk";
import { PET_SPEECH_MS } from "../src/screens/pet-speech";
import { MOBILE_QUERY } from "../src/ds/responsive";

// Status koneksi datang dari socket `events` yang sudah ada; test mendorongnya lewat `h.status`.
const h = vi.hoisted(() => ({ status: { connected: true, since: 0, paused: false } }));

vi.mock("../src/api/events", () => ({
  // SPEC-908 · stub terpusat, bukan tiga ekspor tangan: modul ini kini juga punya
  // `subscribeTopic`/`eventsTopics`/`eventsHelloSeen`, dan ekspor yang hilang baru
  // meledak saat sebuah layar realtime kebetulan ikut ter-render.
  ...eventsStub,
  eventsStatus: () => h.status,
  subscribeStatus: () => () => { },
}));

function spec(over: Partial<Spec> & { id: string }): Spec {
  return {
    projectId: "hanoman", title: `judul ${over.id}`, source: "brief", stage: "spec-ready",
    priority: "sedang", author: "op", objective: "", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], ...over,
  } as Spec;
}

function session(over: Partial<TerminalSession> & { id: string }): TerminalSession {
  return { projectId: "hanoman", cwd: "/tmp", exited: false, ...over };
}

// `matches` per query: reduced-motion dan tier dibaca dari matchMedia yang sama.
function mockMatchMedia(matching: (query: string) => boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: matching(query), media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}
const REDUCED = "(prefers-reduced-motion: reduce)";

const styleOf = (el: HTMLElement): string => el.getAttribute("style") ?? "";
const hit = () => screen.getByRole("button", { name: "Ringkasan status Hanoman" });
const atlas = () => screen.getByTestId("pet-atlas");
const rowshift = () => screen.getByTestId("pet-rowshift");

function animationEnd(element: HTMLElement, animationName: string): void {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(element, event);
}

// jsdom 24 tak punya `PointerEvent`, jadi `fireEvent.pointerDown(el, { clientX })` jatuh ke `Event`
// polos dan handler menerima `clientX === null` — test seret yang memakainya HIJAU PALSU. `MouseEvent`
// membawa koordinatnya, dan React memetakan tipe `pointer*` apa adanya.
function pointer(el: HTMLElement, type: string, clientX: number, clientY: number, pointerId = 1): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(el, event);
}
const actor = () => screen.getByTestId("pet-actor");
const laneOf = () => screen.getByTestId("pet-root");

// Skala desktop: karakter 112 px dari character.h manifest.
const SCALE = 112 / PET_MANIFEST.character.h;
const CELL_W = Math.round(PET_MANIFEST.cell.w * SCALE);
const CELL_H = Math.round(PET_MANIFEST.cell.h * SCALE);
const HOME = homeX(window.innerWidth, CELL_W);

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  mockMatchMedia(() => false);
  h.status = { connected: true, since: 0, paused: false };
  // SPEC-899 · kotak jawaban memanggil endpoint dialog begitu panel terbuka. Test yang tak
  // membahasnya tak boleh menembak `fetch` sungguhan — dan promise yang RESOLVE akan menyelesaikan
  // dirinya sesudah badan test berakhir, yaitu di luar act(). Default-nya karena itu menggantung:
  // kotaknya berhenti di "Membaca layar sesi…" dan tak ada satu pun setState yang bocor.
  vi.spyOn(api, "sessionDialog").mockReturnValue(new Promise(() => { }));
});
const conditions = () => screen.getAllByTestId("pet-condition");

describe("HanomanPet (sprite)", () => {
  it("merender satu img atlas di viewport sel, baris dipilih --row, frame oleh steps(8)", () => {
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" })]} onOpen={vi.fn()} />);

    expect(screen.getByTestId("pet-viewport")).toHaveStyle({ overflow: "hidden", width: `${CELL_W}px`, height: `${CELL_H}px` });
    expect(rowshift()).toHaveClass("hn-pet-rowshift");
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    expect(styleOf(rowshift())).toContain(`--row: ${rowIndex("idle")}`);
    const img = atlas();
    expect(img.getAttribute("src")).toMatch(/\.webp$/);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
    expect(img).toHaveStyle({
      width: `${CELL_W * PET_MANIFEST.columns}px`,
      height: `${CELL_H * PET_MANIFEST.rows.length}px`,
      animation: `hn-pet-frames ${durationMs("idle")}ms steps(8, end) infinite`,
    });
  });

  it("kalimat status hidup di span visually-hidden di dalam region status, bukan di alt", () => {
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" })]} onOpen={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    const text = screen.getByTestId("pet-status");
    expect(status).toContainElement(text);
    expect(text).toHaveClass("hn-sr-only");
    expect(text.textContent).toBe("Hanoman siap · 1 backlog siap dikerjakan");
  });

  it("berpindah baris saat sesi hidup muncul dan memperbarui kalimat status", () => {
    const backlog = [spec({ id: "SPEC-1", stage: "executing" })];
    const { rerender } = render(<HanomanPet sessions={[]} backlog={backlog} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "spec-1", specId: "SPEC-1" })]}
      backlog={backlog} onOpen={vi.fn()} />);

    expect(rowshift()).toHaveAttribute("data-row", "working");
    expect(styleOf(rowshift())).toContain(`--row: ${rowIndex("working")}`);
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("working")}ms steps(8, end) infinite` });
    expect(screen.getByTestId("pet-status").textContent).toContain("sedang berjalan");
  });

  it("klik memutar wave sekali lalu kembali ke baris pose lewat animationend", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());

    expect(rowshift()).toHaveAttribute("data-row", "wave");
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("wave")}ms steps(8, end) 1 forwards` });
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "hn-pet-click var(--dur-slow) var(--ease-out) both" });

    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    animationEnd(screen.getByTestId("pet-reactor"), "hn-pet-click");
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "none" });
  });

  it("shipped main sekali (1 forwards) lalu idle sampai pose berganti", () => {
    const backlog = [spec({ id: "SPEC-9", stage: "done" })];
    const fresh: Notification = {
      id: "n1", type: "done", specId: "SPEC-9", sessionId: null, title: "judul SPEC-9",
      projectId: "hanoman", createdAt: new Date().toISOString(), readAt: null,
    };
    render(
      <NotificationsContext.Provider value={{ items: [fresh], unread: 1, total: 1, markAllRead: () => {}, clear: () => {} }}>
        <HanomanPet sessions={[]} backlog={backlog} onOpen={vi.fn()} />
      </NotificationsContext.Provider>,
    );
    expect(rowshift()).toHaveAttribute("data-row", "shipped");
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("shipped")}ms steps(8, end) 1 forwards` });
    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    expect(screen.getByTestId("pet-status").textContent).toContain("baru saja selesai");   // pose tetap shipped
  });

  it("menganimasi panel masuk dan keluar, dijangkar & di-clamp di atas pet", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());

    const panel = screen.getByTestId("pet-panel");
    expect(panel).toHaveStyle({
      animation: "hn-pet-panel-in var(--dur-slow) var(--ease-out) both",
      bottom: `${CELL_H + 10}px`, width: "268px",
      maxWidth: "calc(100vw - var(--safe-left) - var(--safe-right) - 24px)",
      maxHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 120px)",
    });
    // jsdom: rect nol → pusat dari posisi keadaan (rumah) → di-clamp ke tepi kanan viewport
    const center = HOME + PET_MANIFEST.anchor.x * CELL_W;
    const expected = Math.round(Math.min(Math.max(center - 134, 12), window.innerWidth - 268 - 12));
    expect(panel).toHaveStyle({ left: `${expected}px` });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveStyle({ pointerEvents: "none", animation: "hn-pet-panel-out var(--dur-slow) var(--ease-out) both" });
    animationEnd(panel, "hn-pet-panel-out");
    expect(screen.queryByTestId("pet-panel")).toBeNull();
  });

  it("mematikan seluruh gerak saat prefers-reduced-motion: reduce dan diam di rumah", () => {
    mockMatchMedia((q) => q === REDUCED);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);

    expect(screen.getByTestId("pet-stage")).toHaveStyle({ animation: "none" });
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "none", transition: "none" });
    expect(atlas()).toHaveStyle({ animation: "none" });
    const actor = screen.getByTestId("pet-actor");
    expect(actor).toHaveStyle({ transition: "none", transform: `translate(${HOME}px, 0px)` });
    expect(actor).toHaveAttribute("data-mode", "stand");

    fireEvent.click(hit());
    expect(rowshift()).toHaveAttribute("data-row", "idle");          // tanpa wave
    expect(screen.getByTestId("pet-panel")).toHaveStyle({ animation: "none" });
    expect(screen.getByRole("button", { name: "Buka Backlog" })).toHaveStyle({ transition: "none", transform: "none" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("pet-panel")).toBeNull();
  });

  it("membuka ringkasan berisi headline, detail, dan tautan ke tempat kejadian", () => {
    const onOpen = vi.fn();
    render(<HanomanPet backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
      sessions={[session({ id: "spec-1", specId: "SPEC-1" })]} onOpen={onOpen} />);

    expect(hit().getAttribute("title")).toContain("SPEC-1 · sedang berjalan");
    fireEvent.click(hit());
    expect(screen.getByText("SPEC-1 · sedang berjalan")).toBeInTheDocument();
    expect(screen.getByText("judul SPEC-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buka Terminal" }));
    expect(onOpen).toHaveBeenCalledWith({ section: "terminal", sessionId: "spec-1" });
  });

  it("menyembunyikan pet, menyimpan pilihannya, dan tetap bisa dipanggil kembali", () => {
    const { unmount } = render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan" }));

    expect(screen.queryByTestId("pet-atlas")).toBeNull();
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("1");
    expect(screen.getByRole("button", { name: "Tampilkan pet Hanoman" })).toHaveStyle({ width: "44px", height: "44px" });
    unmount();

    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("pet-atlas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan pet Hanoman" }));
    expect(atlas()).toBeInTheDocument();
    expect(screen.getByTestId("pet-stage")).toHaveStyle({ animation: "hn-pet-reveal var(--dur-slow) var(--ease-out) both" });
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("0");
  });

  it("toggle berkeliaran bertahan lintas remount dan menjangkarkan pet ke rumah", () => {
    const { unmount } = render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(screen.getByRole("button", { name: "Diam di pojok" }));
    expect(localStorage.getItem(PET_ROAM_KEY)).toBe("0");
    expect(screen.getByTestId("pet-actor")).toHaveStyle({ transform: `translate(${HOME}px, 0px)` });
    unmount();

    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    expect(screen.getByRole("button", { name: "Berkeliaran" })).toBeInTheDocument();
  });

  it("di tier mobile pet 96 px, selalu diam di pojok, dan toggle berkeliaran disembunyikan", () => {
    mockMatchMedia((q) => q === MOBILE_QUERY);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    const scale = 96 / PET_MANIFEST.character.h;
    const cellW = Math.round(PET_MANIFEST.cell.w * scale);
    expect(screen.getByTestId("pet-viewport")).toHaveStyle({ width: `${cellW}px` });
    expect(screen.getByTestId("pet-actor")).toHaveStyle({ transform: `translate(${homeX(window.innerWidth, cellW)}px, 0px)` });
    fireEvent.click(hit());
    expect(screen.queryByRole("button", { name: "Diam di pojok" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Berkeliaran" })).toBeNull();
  });

  it("berjalan di jalur saat jadwal berdiri habis: transisi transform linear ke target", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(0.5);   // jalan 9,5 dtk = 380 px; arah kanan → balik kiri dari rumah
      render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
      expect(actor()).toHaveAttribute("data-mode", "stand");
      act(() => { vi.advanceTimersByTime(1_300); });     // STAND_MS[0] = 1,2 dtk
      expect(actor()).toHaveAttribute("data-mode", "walk");
      expect(actor()).toHaveAttribute("data-facing", "left");
      expect(actor()).toHaveStyle({ transform: `translate(${HOME - 380}px, 0px)`, transition: "transform 9500ms linear" });
      expect(rowshift()).toHaveAttribute("data-row", "walk-left");
      // tiba (transitionend) → berdiri di target, baris pose
      const end = new Event("transitionend", { bubbles: true });
      Object.defineProperty(end, "propertyName", { value: "transform" });
      act(() => { vi.advanceTimersByTime(9_500); fireEvent(actor(), end); });
      expect(actor()).toHaveAttribute("data-mode", "stand");
      expect(rowshift()).toHaveAttribute("data-row", "idle");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("tidak menangkap klik di area kosong jalur; hanya tombol 44 px di kaki", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-root")).toHaveStyle({ pointerEvents: "none", left: "0px", right: "0px", bottom: "max(0px, var(--safe-bottom))" });
    expect(hit()).toHaveStyle({
      pointerEvents: "auto", width: "44px", height: "44px", bottom: "0px",
      left: `${Math.round(PET_MANIFEST.anchor.x * CELL_W - 22)}px`,
    });
    expect(LANE_MARGIN).toBe(16);
  });
});

describe("HanomanPet — pet jujur & lengkap (SPEC-897)", () => {
  const twoWaiting = {
    sessions: [
      session({ id: "a", specId: "SPEC-1", decision: true }),
      session({ id: "b", specId: "SPEC-2", decision: true }),
    ],
    backlog: [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })],
  };

  it("lencana hitungan muncul saat ada ≥2 kondisi sejenis, dan tak menerima pointer", () => {
    render(<HanomanPet {...twoWaiting} onOpen={vi.fn()} />);
    const badge = screen.getByTestId("pet-badge");
    expect(badge.textContent).toBe("2");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge).toHaveStyle({ pointerEvents: "none" });
    // Angkanya punya satuan di kalimat status — satu sumber, lencananya sendiri aria-hidden.
    expect(screen.getByTestId("pet-status").textContent).toContain("2 sesi menunggu jawabanmu");
    // Warna lencana hanya token DS.
    expect(styleOf(badge)).toContain("var(--accent)");
    expect(styleOf(badge)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("tak ada lencana saat hanya satu kondisi sejenis, maupun saat istirahat", () => {
    const { unmount } = render(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]}
      backlog={[spec({ id: "SPEC-1", stage: "executing" })]} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("pet-badge")).toBeNull();
    unmount();
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" }), spec({ id: "SPEC-2" })]} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("pet-badge")).toBeNull();
  });

  it("panel mendaftar SEMUA kondisi aktif dengan aksi ke targetnya masing-masing", () => {
    const onOpen = vi.fn();
    render(<HanomanPet sessions={[
      session({ id: "a", specId: "SPEC-1", decision: true }),
      session({ id: "c", specId: "SPEC-3" }),
    ]} backlog={[spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-3", stage: "done" })]}
      onOpen={onOpen} />);
    fireEvent.click(hit());
    const rows = conditions();
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["waiting", "review"]);
    // aksi baris KEDUA membuka sesi kedua, bukan puncak prioritas — inilah inti SPEC-897.
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Buka Terminal" }));
    expect(onOpen).toHaveBeenCalledWith({ section: "terminal", sessionId: "c" });
  });

  it("hitungan per baris muncul di baris yang punya lebih dari satu", () => {
    render(<HanomanPet {...twoWaiting} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    expect(within(conditions()[0]!).getByTestId("pet-condition-count").textContent).toBe("2");
  });

  it("pudar dan mengaku saat terputus; baris offline tanpa tombol", () => {
    h.status = { connected: false, since: Date.now() - 60_000, paused: false };
    render(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1" })]}
      backlog={[spec({ id: "SPEC-1", stage: "executing" })]} onOpen={vi.fn()} />);
    const viewport = screen.getByTestId("pet-viewport");
    expect(viewport.getAttribute("data-offline")).toBe("true");
    expect(viewport).toHaveStyle({ opacity: "0.45" });
    expect(screen.getByTestId("pet-status").textContent).toContain("Tak terhubung sejak");
    // Baris pose tetap `idle`: pudar + kalimat sudah mengatakan "aku tak tahu".
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    fireEvent.click(hit());
    const rows = conditions();
    expect(rows[0]!.getAttribute("data-kind")).toBe("offline");
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    // kondisi lama tetap terdaftar sebagai data terakhir
    expect(rows[1]!.getAttribute("data-kind")).toBe("working");
  });

  it("tak pudar saat tab hidden (paused): socket ditutup atas permintaan kita", () => {
    h.status = { connected: false, since: Date.now() - 60_000, paused: true };
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-viewport").getAttribute("data-offline")).toBeNull();
    expect(screen.getByTestId("pet-viewport")).toHaveStyle({ opacity: "1" });
  });

  it("tak melambai saat terputus — melambai atas data basi adalah berbohong", () => {
    h.status = { connected: false, since: Date.now() - 60_000, paused: false };
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "idle");   // bukan "wave"
  });

  it("reduced-motion mematikan transisi pudar dengan nilai persis `none`", () => {
    mockMatchMedia((q) => q === REDUCED);
    h.status = { connected: false, since: Date.now() - 60_000, paused: false };
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-viewport")).toHaveStyle({ transition: "none" });
    // lencana adalah informasi, bukan gerak: ia tetap tampil saat reduced-motion.
    expect(screen.queryByTestId("pet-badge")).toBeNull();   // di sini count = 1
  });
});

describe("HanomanPet — pet bicara (SPEC-898)", () => {
  const bl = [spec({ id: "SPEC-1", stage: "executing" })];
  const bubble = () => screen.queryByTestId("pet-bubble");

  it("gelembung lahir saat pose berganti ke kabar yang tak lewat Toast", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toBeNull();                                   // mount tak berteriak
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    // SPEC-899 · teksnya kini hidup di span-nya sendiri: gelembung `waiting` menumbuhkan CTA
    // "Jawab di sini", jadi textContent gelembung memuat label tombol itu juga.
    expect(within(bubble()!).getByTestId("pet-bubble-text").textContent).toBe("SPEC-1 butuh jawabanmu");
  });

  it("keadaan mapan tak bergelembung", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1" })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toBeNull();
  });

  it("gelembung pose tak menerima pointer dan tak diumumkan dua kali", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    const el = bubble()!;
    expect(el).toHaveStyle({ pointerEvents: "none" });
    // SPEC-899 · bungkusnya berhenti `aria-hidden` begitu ia punya tombol — elemen di dalam
    // `aria-hidden` tak bisa difokuskan sama sekali. Yang disembunyikan kini TEKS-nya, dan
    // janji "tak diumumkan dua kali" tetap dipegang region status di bawah.
    expect(within(el).getByTestId("pet-bubble-text").getAttribute("aria-hidden")).toBe("true");
    // Kalimat status tetap SATU sumber untuk pembaca layar.
    expect(screen.getByTestId("pet-status").textContent).toContain("menunggu jawabanmu");
    expect(styleOf(el)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("gelembung hilang sendiri lewat satu timeout", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
      expect(bubble()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(PET_SPEECH_MS + 50); });
      expect(bubble()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("gelembung di-clamp ke viewport walau pet di tepi kanan", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    const left = Number(/left:\s*(-?\d+)px/.exec(styleOf(bubble()!))![1]);
    // Pet berdiri di rumah (tepi kanan): tepi kanan gelembung harus tetap di dalam viewport.
    expect(HOME + left).toBeGreaterThanOrEqual(0);
    expect(HOME + left + 200).toBeLessThanOrEqual(window.innerWidth);
  });

  it("reduced-motion: gelembung tetap tampil, tanpa animasi", () => {
    mockMatchMedia((q) => q === REDUCED);
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toHaveStyle({ animation: "none" });
  });

  // `document.hidden` adalah getter; test menukarnya lalu menembakkan visibilitychange, persis
  // seperti browser.
  function setHidden(value: boolean): void {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  }

  it("rekap muncul sesudah tab tersembunyi ≥ 5 menit, dengan tombol yang membuka panel", () => {
    const now = vi.spyOn(Date, "now");
    const T0 = Date.parse("2026-08-22T10:00:00.000Z");
    now.mockReturnValue(T0);
    try {
      const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(true);
      now.mockReturnValue(T0 + 6 * 60_000);
      rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(false);
      const el = screen.getByTestId("pet-bubble");
      expect(el.getAttribute("data-kind")).toBe("recap");
      expect(el.textContent).toContain("1 menunggu");
      fireEvent.click(within(el).getByRole("button"));
      expect(screen.getByTestId("pet-panel")).toBeTruthy();
      expect(screen.queryByTestId("pet-bubble")).toBeNull();
    } finally { now.mockRestore(); setHidden(false); }
  });

  it("absen singkat tak melahirkan rekap", () => {
    const now = vi.spyOn(Date, "now");
    const T0 = Date.parse("2026-08-22T10:00:00.000Z");
    now.mockReturnValue(T0);
    try {
      const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(true);
      now.mockReturnValue(T0 + 60_000);                    // 1 menit < PET_AWAY_MS
      rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(false);
      // Boleh ada gelembung POSE (kondisi memang berubah), tapi tak boleh ada rekap.
      expect(screen.queryByTestId("pet-bubble")?.getAttribute("data-kind")).not.toBe("recap");
    } finally { now.mockRestore(); setHidden(false); }
  });

  it("baris waiting berdenyut lebih cepat saat pertanyaannya menua", () => {
    const young = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: new Date(Date.now() - 60_000).toISOString() })];
    const { rerender } = render(<HanomanPet sessions={young} backlog={bl} onOpen={vi.fn()} />);
    expect(styleOf(atlas())).toContain(`${durationMs("waiting")}ms`);

    const old = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: new Date(Date.now() - 20 * 60_000).toISOString() })];
    rerender(<HanomanPet sessions={old} backlog={bl} onOpen={vi.fn()} />);
    expect(styleOf(atlas())).toContain(`${Math.round(durationMs("waiting") / 1.5)}ms`);
  });

  it("tiga klik dalam 2 dtk memutar baris thanks + hati, tanpa mengubah panel", () => {
    render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    fireEvent.click(hit());                                   // buka
    expect(screen.getByTestId("pet-panel")).toBeTruthy();
    fireEvent.click(hit());                                   // tutup
    fireEvent.click(hit());                                   // elus — panel TIDAK dibuka lagi
    expect(rowshift()).toHaveAttribute("data-row", "thanks");
    expect(screen.getByTestId("pet-hearts").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("pet-hearts")).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("pet-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("klik yang berjauhan tetap membuka/menutup panel seperti biasa", () => {
    vi.useFakeTimers();
    try {
      render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      fireEvent.click(hit());
      act(() => { vi.advanceTimersByTime(2_500); });
      fireEvent.click(hit());
      act(() => { vi.advanceTimersByTime(2_500); });
      fireEvent.click(hit());
      expect(rowshift()).not.toHaveAttribute("data-row", "thanks");
    } finally { vi.useRealTimers(); }
  });

  it("reduced-motion: elus tak memutar apa pun dan tak memunculkan hati", () => {
    mockMatchMedia((q) => q === REDUCED);
    render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(hit());
    fireEvent.click(hit());
    expect(rowshift()).not.toHaveAttribute("data-row", "thanks");
    expect(screen.queryByTestId("pet-hearts")).toBeNull();
  });

  it("panel terbuka menelan gelembung — daftarnya sudah di layar", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toBeNull();
  });
});

// SPEC-899 · ADR-0142 · inbox keputusan: pertanyaan agen dijawab dari panel, bukan dari pane.
describe("Pet · inbox keputusan", () => {
  const payload = (over: Partial<SessionDialog> = {}): SessionDialogPayload => ({
    screenHash: "deadbeef",
    dialog: {
      title: "Warna apa yang dipakai?", multi: false, freeIndex: 3, notes: false,
      options: [{ n: 1, label: "merah", checked: null }, { n: 2, label: "biru", checked: null }],
      tabs: [], ...over,
    },
  });

  const waitingProps = () => ({
    sessions: [session({ id: "s1", specId: "SPEC-1", decision: true })],
    backlog: [spec({ id: "SPEC-1", stage: "executing" })],
    onOpen: vi.fn(),
  });

  // SPEC-909 · ADR-0146 · AC-6 · jendela "ambil alih SEBELUM lead mengetik ke pane" ada saat sesi
  // ber-`deciding`, bukan `waiting`: sejak pertanyaan tiba sebagai EVENT, `deciding` menyala ±50 ms
  // sesudah agen bertanya sementara marker (`decision`) baru terisi ±6 detik kemudian. `sessionKind`
  // memberi tiap sesi tepat SATU kondisi dan `deciding` menang, jadi kotak yang hanya digantung di
  // `waiting` tak pernah muncul justru di jendela yang dituju AC-6.
  //
  // Test ini sengaja lewat `HanomanPet`, bukan me-render `PetAnswer` langsung: yang rusak dulu
  // adalah GERBANG mount-nya, dan test yang melewati gerbang itu tak bisa melihatnya.
  const ask = (over: Partial<SessionAsk> = {}): SessionAsk => ({
    sessionId: "s1", agent: "claude", source: "ask-tool", askId: "t1",
    askedAt: "2026-08-23T00:00:00.000Z",
    questions: [{ header: "Warna", question: "Warna apa yang dipakai?", multiSelect: false,
      options: [{ label: "merah" }, { label: "biru" }] }],
    message: "", at: 0, total: 1, state: "deciding", flowId: null, step: null, ...over,
  });

  it("sesi yang SEDANG diputuskan lead tetap menumbuhkan kotak + tombol Ambil alih (SPEC-909)", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(null);   // scrape 409/204 — payload harus menang
    render(<HanomanPet
      sessions={[session({ id: "s1", specId: "SPEC-1", decision: false, deciding: true })]}
      backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
      asks={[ask()]} onOpen={vi.fn()} />);
    await act(async () => { fireEvent.click(hit()); });
    expect(await screen.findByText("Warna apa yang dipakai?")).toBeTruthy();
    expect(screen.getByTestId("pet-answer-takeover")).toBeInTheDocument();
  });

  it("tanpa payload event, sesi deciding TIDAK menumbuhkan kotak (tak ada yang bisa direbut)", async () => {
    const get = vi.spyOn(api, "sessionDialog").mockResolvedValue(null);
    render(<HanomanPet
      sessions={[session({ id: "s1", specId: "SPEC-1", decision: false, deciding: true })]}
      backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
      onOpen={vi.fn()} />);
    await act(async () => { fireEvent.click(hit()); });
    expect(screen.queryByTestId("pet-answer-takeover")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("merender pertanyaan + opsi untuk sesi waiting, lalu mengirim nomor barisnya", async () => {
    const get = vi.spyOn(api, "sessionDialog").mockResolvedValue(payload());
    const post = vi.spyOn(api, "answerSessionDialog").mockResolvedValue({ accepted: true });
    render(<HanomanPet {...waitingProps()} />);
    await act(async () => { fireEvent.click(hit()); });
    expect(await screen.findByText("Warna apa yang dipakai?")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("s1");
    expect(screen.getAllByTestId("pet-answer-option")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "merah" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "biru" })); });
    expect(post).toHaveBeenCalledWith("s1", { screenHash: "deadbeef", choice: 2 });
    expect(screen.getByTestId("pet-answer-sent").textContent).toContain("Terkirim");
  });

  it("multiSelect mengirim centang lewat choices dan satu tombol Submit", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(payload({
      multi: true, freeIndex: null,
      options: [{ n: 1, label: "alpha", checked: false }, { n: 2, label: "beta", checked: true }],
    }));
    const post = vi.spyOn(api, "answerSessionDialog").mockResolvedValue({ accepted: true });
    render(<HanomanPet {...waitingProps()} />);
    await act(async () => { fireEvent.click(hit()); });
    await screen.findByTestId("pet-answer");
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);   // centang alpha; beta sudah tercentang
    await act(async () => { fireEvent.click(screen.getByTestId("pet-answer-submit")); });
    expect(post).toHaveBeenCalledWith("s1", { screenHash: "deadbeef", choices: [1, 2] });
  });

  it("409 stale memuat ulang pertanyaannya alih-alih mengaku terkirim", async () => {
    const get = vi.spyOn(api, "sessionDialog").mockResolvedValue(payload());
    vi.spyOn(api, "answerSessionDialog").mockRejectedValue(new ApiError(409, "409", { reason: "stale" }));
    render(<HanomanPet {...waitingProps()} />);
    await act(async () => { fireEvent.click(hit()); });
    await screen.findByTestId("pet-answer");
    await act(async () => { fireEvent.click(screen.getAllByTestId("pet-answer-option")[0]!); });
    expect(screen.queryByTestId("pet-answer-sent")).toBeNull();
    expect(screen.getByTestId("pet-answer-note").textContent).toContain("berubah");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("gelembung waiting menawarkan 'Jawab di sini' dan membuka panel", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(payload());
    const props = waitingProps();
    // Gelembung lahir saat kabarnya BERGANTI (SPEC-898), bukan saat mount.
    const { rerender } = render(<HanomanPet {...props} sessions={[]} />);
    rerender(<HanomanPet {...props} />);
    const cta = await screen.findByRole("button", { name: /jawab di sini/i });
    expect(screen.getByTestId("pet-bubble").getAttribute("aria-hidden")).toBeNull();
    await act(async () => { fireEvent.click(cta); });
    expect(await screen.findByTestId("pet-answer")).toBeTruthy();
  });

  it("teks gelembung tetap aria-hidden — region status pet-stage yang membacakannya", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(payload());
    const props = waitingProps();
    const { rerender } = render(<HanomanPet {...props} sessions={[]} />);
    rerender(<HanomanPet {...props} />);
    const bubble = await screen.findByTestId("pet-bubble");
    expect(within(bubble).getByTestId("pet-bubble-text").getAttribute("aria-hidden")).toBe("true");
  });

  it("tak ada dialog di layar → panel mengatakannya, tak ada tombol jawaban", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(null);
    render(<HanomanPet {...waitingProps()} />);
    await act(async () => { fireEvent.click(hit()); });
    expect(await screen.findByTestId("pet-answer-note")).toBeTruthy();
    expect(screen.queryAllByTestId("pet-answer-option")).toHaveLength(0);
  });
});

describe("HanomanPet — pet diseret (SPEC-905)", () => {
  const CEILING = window.innerHeight - CELL_H;

  it("seret mengangkat pet di dua sumbu, memutar baris held, tanpa transisi menyusul", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(laneOf()).toHaveStyle({ height: `${CELL_H}px` });

    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 500);

    expect(rowshift()).toHaveAttribute("data-row", "held");
    expect(actor()).toHaveAttribute("data-mode", "held");
    // selisih: x −40, y +200 dari HOME/0
    expect(actor()).toHaveStyle({ transform: `translate(${HOME - 40}px, -200px)`, transition: "none" });
    // jalur melebar HANYA sekarang, dan tetap tak menangkap pointer
    expect(laneOf()).toHaveStyle({ top: "max(0px, var(--safe-top))", pointerEvents: "none" });
    expect(laneOf().style.height).toBe("");
  });

  it("plafon angkat jatuh ke viewport selama jalur belum melebar; jalur tak dilewati ke bawah", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 500, -9_000);
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, -${CEILING}px)` });
    pointer(hit(), "pointermove", 500, 9_000);
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, 0px)` });
  });

  it("plafon angkat MENGIKUTI tinggi jalur yang sudah melebar, bukan viewport", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    // jsdom memberi rect nol untuk semua elemen, jadi cabang "baca jalur yang sudah melebar" hanya
    // bisa dijalankan dengan memalsukan rect-nya — tanpa ini yang teruji cuma fallback viewport.
    vi.spyOn(laneOf(), "getBoundingClientRect")
      .mockReturnValue({ height: 500, width: 1024, top: 268, bottom: 768, left: 0, right: 1024, x: 0, y: 268, toJSON: () => ({}) } as DOMRect);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 500, -9_000);
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, -${500 - CELL_H}px)` });
  });

  it("dilepas: jatuh dengan easing percepatan, lalu pusing, lalu baris pose — jalur menyusut lagi", () => {
    vi.useFakeTimers();
    try {
      render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
      pointer(hit(), "pointerdown", 500, 700);
      pointer(hit(), "pointermove", 460, 460);          // terangkat 240 px
      pointer(hit(), "pointerup", 460, 460);

      expect(rowshift()).toHaveAttribute("data-row", "falling");
      expect(actor()).toHaveStyle({
        transform: `translate(${HOME - 40}px, 0px)`,
        transition: "transform 1000ms var(--ease-fall)",
      });
      expect(laneOf()).toHaveStyle({ top: "max(0px, var(--safe-top))" });   // masih melebar selagi jatuh

      // Mendarat. Waktu dimajukan LEBIH DULU: `transitionend` di browser tiba tepat saat durasinya
      // habis, dan mesin menilai pendaratan dari jam, bukan dari peristiwanya (pola test jalan kaki).
      const end = new Event("transitionend", { bubbles: true });
      Object.defineProperty(end, "propertyName", { value: "transform" });
      act(() => { vi.advanceTimersByTime(1_000); fireEvent(actor(), end); });

      expect(rowshift()).toHaveAttribute("data-row", "dizzy");
      expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("dizzy")}ms steps(8, end) 1 forwards` });
      expect(laneOf()).toHaveStyle({ height: `${CELL_H}px` });   // menyusut kembali begitu mendarat

      act(() => { vi.advanceTimersByTime(durationMs("dizzy") + 50); });
      expect(rowshift()).toHaveAttribute("data-row", "idle");
      expect(actor()).toHaveStyle({ transform: `translate(${HOME - 40}px, 0px)` });
    } finally {
      vi.useRealTimers();
    }
  });

  it("mesin berkeliaran melanjutkan dari x tempat pet dilepas, tidak melompat ke pojok", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
      pointer(hit(), "pointerdown", 500, 700);
      pointer(hit(), "pointermove", 300, 700);        // geser 200 px ke kiri, tetap di lantai
      pointer(hit(), "pointerup", 300, 700);
      act(() => { vi.advanceTimersByTime(durationMs("dizzy") + 50); });   // pusing selesai
      expect(actor()).toHaveStyle({ transform: `translate(${HOME - 200}px, 0px)` });
      expect(actor()).toHaveAttribute("data-mode", "stand");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("ambang 6 px memisahkan klik dari seret: di bawahnya panel terbuka, di atasnya tidak", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 504, 700);          // 4 px → masih klik
    pointer(hit(), "pointerup", 504, 700);
    fireEvent.click(hit());
    expect(screen.getByTestId("pet-panel")).toBeInTheDocument();
    expect(rowshift()).toHaveAttribute("data-row", "wave");
  });

  it("seret tidak membuka panel dan tidak memicu thanks walau tiga kali berturut-turut", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    for (let i = 0; i < 3; i++) {
      pointer(hit(), "pointerdown", 500, 700);
      pointer(hit(), "pointermove", 460, 660);
      pointer(hit(), "pointerup", 460, 660);
      fireEvent.click(hit());                        // `click` menyusul `pointerup` di elemen yang sama
    }
    expect(screen.queryByTestId("pet-panel")).toBeNull();
    expect(screen.queryByTestId("pet-hearts")).toBeNull();
  });

  it("seret yang dimulai SESUDAH hover memutar wave tetap memperlihatkan held, bukan wave", () => {
    // Urutan nyata di desktop: pointer masuk (wave mulai) → tekan → seret. `oneShot` menumpuk DI ATAS
    // baris mesin, jadi tanpa membersihkannya pet akan terlihat melambai selagi diangkat.
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "wave");
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 500);
    expect(rowshift()).toHaveAttribute("data-row", "held");
  });

  it("seret menutup panel yang terbuka — jangkarnya dibaca saat panel dibuka, pet sedang pergi", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    expect(screen.getByTestId("pet-panel")).not.toHaveAttribute("aria-hidden");
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 500);
    expect(screen.getByTestId("pet-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("jari kedua mengambil alih seret tanpa menjatuhkan pet", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700, 1);
    pointer(hit(), "pointermove", 500, 500, 1);          // terangkat 200 px
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, -200px)` });
    // Jari kedua mencengkeram di titik lain lalu naik 50 px. X tak boleh bergerak (ia hanya naik),
    // dan Y harus MENAMBAH dari 200 ke 250 — tanpa suku `+ walkRef.current.y` di titik pegang, pet
    // akan terjun ke 50 px karena ketinggian yang sedang berjalan hilang dari perhitungan.
    pointer(hit(), "pointerdown", 300, 400, 2);
    pointer(hit(), "pointermove", 300, 350, 2);
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, -250px)` });
  });

  it("pointercancel dilayani seperti pointerup: pet tidak tertinggal di udara", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);
    pointer(hit(), "pointercancel", 460, 460);
    expect(rowshift()).toHaveAttribute("data-row", "falling");
  });

  it("tombol pet menolak gulir & seleksi selama gestur seret", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    // `touch-action`/`user-select` hidup di `.hn-pet-hit` (app.css): jsdom menjatuhkan keduanya dari
    // inline style secara senyap, jadi kelasnya adalah satu-satunya yang bisa dibuktikan di sini.
    expect(hit()).toHaveClass("hn-pet-hit");
    expect(hit()).toHaveStyle({ cursor: "grab" });
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 500);
    expect(hit()).toHaveStyle({ cursor: "grabbing" });
  });

  it("hover memutar wave BERULANG; lepas hover menyelesaikan putaran lalu berhenti", () => {
    // Waktu DIBEKUKAN dengan sengaja: `oneShot.id` yang diturunkan dari `Date.now()` akan memberi
    // `key` React yang identik di sini, sehingga `not.toBe(first)` di bawah menangkapnya SETIAP run
    // alih-alih hanya saat dua putaran kebetulan jatuh di milidetik yang sama.
    vi.useFakeTimers();
    try {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "wave");
    const first = atlas();

    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "wave");   // putaran ke-2
    expect(atlas()).not.toBe(first);                          // `key` baru → animasi restart
    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "wave");   // putaran ke-3

    fireEvent.pointerLeave(hit());
    expect(rowshift()).toHaveAttribute("data-row", "wave");   // TIDAK dipotong di tengah
    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "idle");   // baru berhenti di batas putaran
    } finally {
      vi.useRealTimers();
    }
  });

  it("tidak melambai selagi diangkat, jatuh, atau pusing", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "held");
    pointer(hit(), "pointerup", 460, 460);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "falling");
  });

  it("reduced-motion: seret tetap boleh, jatuh seketika, pusing dilewati", () => {
    mockMatchMedia((q) => q === REDUCED);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);
    expect(rowshift()).toHaveAttribute("data-row", "held");
    pointer(hit(), "pointerup", 460, 460);
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    expect(actor()).toHaveStyle({ transform: `translate(${HOME - 40}px, 0px)`, transition: "none" });
  });
});
