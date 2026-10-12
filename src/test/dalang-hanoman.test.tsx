import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { DalangHanomanScreen, isToday } from "../src/screens/DalangHanomanScreen";
import { HN_NAV } from "../src/ds/shell";
import type { TerminalSession } from "../src/api/client";
import type { ProjectVM, Spec } from "../src/screens/types";

// Status koneksi nyata dikendalikan test lewat objek hoisted (baris status & ticker harus mencerminkannya).
const { conn } = vi.hoisted(() => ({ conn: { connected: true, since: 0, paused: false, idle: false } }));
vi.mock("../src/api/live", () => ({ useEventsStatus: () => conn }));

// Penghitung render layar INDUK: tombol keluar (ikon ✕ / panah) hidup di induk, jadi setiap render induk
// menaikkan hitungannya. Ticker dan jam tak boleh menaikkannya.
const { renders } = vi.hoisted(() => ({ renders: { exitIcon: 0 } }));
vi.mock("../src/ds", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/ds")>();
  const React = await import("react");
  const Counted = (props: Parameters<typeof mod.Icon>[0]) => {
    if (props.name === "x" || props.name === "arrow-left") renders.exitIcon++;
    return React.createElement(mod.Icon, props);
  };
  return { ...mod, Icon: Counted };
});

// Preferensi gerak sistem dikendalikan per test (jsdom tak punya matchMedia).
const { motion } = vi.hoisted(() => ({ motion: { reduce: false } }));
function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") && motion.reduce,
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((c) => existsSync(c));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

function project(over: { id: string; name: string; activity?: string }): ProjectVM {
  return { id: over.id, name: over.name, activity: over.activity ?? "aktivitas", commit: "abc123",
    session: { status: "idle", phase: null, flow: null } } as unknown as ProjectVM;
}
function session(over: Partial<TerminalSession> & { id: string; projectId: string }): TerminalSession {
  return { cwd: "/tmp", exited: false, ...over } as TerminalSession;
}
function spec(over: { id: string; startedAt?: Date | null; stage?: string }): Spec {
  return { id: over.id, stage: over.stage ?? "spec",
    startedAt: over.startedAt ? over.startedAt.toISOString() : null } as unknown as Spec;
}

const noop = () => {};
const projects = [project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" }), project({ id: "c", name: "gamma" })];

beforeEach(() => {
  conn.connected = true; conn.paused = false;
  motion.reduce = false;
  installMatchMedia();
});
afterEach(() => {
  // @ts-expect-error — dikembalikan ke keadaan jsdom (tanpa matchMedia)
  delete window.matchMedia;
});

describe("Dalang Hanoman — menu & panggung sinematik", () => {
  it("terdaftar di HN_NAV sebagai 'Dalang Hanoman' (cabang App dijaga changelog-nav.test)", () => {
    const item = HN_NAV.find((n) => n.key === "dalang");
    expect(item?.label).toBe("Dalang Hanoman");
  });

  it("SEMUA project tampil: sesi hidup menyala (klik → fokus sesi), tanpa sesi = wayang redup", () => {
    const onOpenSession = vi.fn();
    const onOpenProject = vi.fn();
    render(<DalangHanomanScreen projects={projects}
      backlog={[spec({ id: "SPEC-1", stage: "executing", startedAt: new Date() })]}
      sessions={[
        session({ id: "s1", projectId: "a", specId: "SPEC-1" }),
        session({ id: "s2", projectId: "b", decision: true }),
        session({ id: "s3", projectId: "c", exited: true, exitCode: 0 }),
      ]}
      onOpenSession={onOpenSession} onOpenProject={onOpenProject} onGoto={noop} onExit={noop} />);
    // Hero rig ber-sendi: badan + 4 lengan terpisah + 4 jangkar tangan untuk benang.
    expect(document.querySelector('img[src*="hero-rig-body"]')).toBeTruthy();
    expect(document.querySelectorAll(".hn-dlg-rig-arm")).toHaveLength(4);
    expect(document.querySelectorAll("[data-hand]")).toHaveLength(4);
    const cards = screen.getByRole("list", { name: "Wayang project" });
    expect(cards.querySelectorAll(".hn-dlg-prj")).toHaveLength(3);         // semua tampil: 2 hidup + 1 redup
    expect(cards.querySelectorAll("[data-puppet]")).toHaveLength(2);       // benang emas ke yang hidup
    expect(cards.querySelectorAll(".hn-dlg-prj[data-waiting]")).toHaveLength(1);
    expect(cards.querySelectorAll(".hn-dlg-prj--off")).toHaveLength(1);    // gamma redup, tetap wayang
    fireEvent.click(screen.getByRole("button", { name: /Buka terminal — alpha, SPEC-1 · Dikerjakan/ }));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByRole("button", { name: "Buka project gamma" }));
    expect(onOpenProject).toHaveBeenCalled();
  });

  it("'Menunggu jawabanmu' di atas: satu baris dan tombol Jawab per sesi yang menunggu", () => {
    const onOpenSession = vi.fn();
    render(<DalangHanomanScreen projects={projects} backlog={[]}
      sessions={[session({ id: "s2", projectId: "b", decision: true })]}
      onOpenSession={onOpenSession} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    const section = screen.getByRole("heading", { name: "Menunggu jawabanmu" }).parentElement!;
    const row = within(section).getByRole("button", { name: /beta/ });
    expect(row.textContent).toContain("Jawab");
    fireEvent.click(row);
    expect(onOpenSession).toHaveBeenCalledWith("s2");
  });

  it("tanpa yang menunggu, seksi 'Menunggu jawabanmu' tak dirender", () => {
    render(<DalangHanomanScreen projects={projects} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    expect(screen.queryByRole("heading", { name: "Menunggu jawabanmu" })).toBeNull();
    expect(document.querySelectorAll(".hn-dlg-prj--off")).toHaveLength(3);
  });

  it("kelir sunyi: semua wayang redup, perintah dalang membuka terminal", () => {
    const onGoto = vi.fn();
    render(<DalangHanomanScreen projects={projects} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} onGoto={onGoto} onExit={noop} />);
    expect(screen.getByText("Tidak ada sesi berjalan · 3 project")).toBeTruthy();
    expect(document.querySelector(".hn-dlg-blencong[data-lit]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /pusat kendali sesi/ }));
    expect(onGoto).toHaveBeenCalledWith("terminal");
  });

  it("tanpa project: satu kalimat panggung sunyi, tanpa kartu wayang", () => {
    render(<DalangHanomanScreen projects={[]} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    expect(screen.getByText("Panggung sunyi — belum ada project di workspace.")).toBeTruthy();
    expect(document.querySelectorAll(".hn-dlg-prj")).toHaveLength(0);
  });

  it("donut distribusi backlog dihitung dari stage nyata", () => {
    render(<DalangHanomanScreen projects={[]} sessions={[]}
      backlog={[
        spec({ id: "s1", stage: "done" }), spec({ id: "s2", stage: "done" }),
        spec({ id: "s3", stage: "executing" }), spec({ id: "s4", stage: "planned" }), spec({ id: "s5" }),
      ]}
      onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    const leg = document.querySelector(".hn-dlg-leg")!;
    expect(leg.textContent).toContain("Done 2");
    expect(leg.textContent).toContain("Execute 1");
    expect(document.querySelector(".hn-dlg-donut-c b")!.textContent).toBe("5");
  });

  it("grafik 7 hari dan panel aktivitas dirender dari data nyata", () => {
    render(<DalangHanomanScreen projects={[projects[0]!]} backlog={[spec({ id: "s1", startedAt: new Date() })]}
      sessions={[]} onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    expect(document.querySelectorAll(".hn-dlg-act")).toHaveLength(1);
    // Data grafik terbaca lewat teks tersembunyi visual; SVG-nya dekoratif (aria-hidden).
    expect(screen.getByText(/Item mulai dikerjakan, 7 hari terakhir/)).toBeTruthy();
    expect(document.querySelector(".hn-dlg-chart")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll(".hn-dlg-chart circle")).toHaveLength(7);
  });

  it("isToday memakai hari LOKAL: jam 00:30 hari ini tetap hari ini, kemarin tidak", () => {
    const today = new Date(); today.setHours(0, 30, 0, 0);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(today.toISOString())).toBe(true);
    expect(isToday(yesterday.toISOString())).toBe(false);
    expect(isToday(null)).toBe(false);
    expect(isToday("bukan tanggal")).toBe(false);
  });

  it("kontrak design system: layar dan CSS-nya tanpa warna literal; sumber hidup = sessions WS", () => {
    const src = read("src/screens/DalangHanomanScreen.tsx");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
    const css = read("src/screens/styles/dalang.css");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(src).not.toMatch(/\.session\.(status|phase|flow)/);
  });

  it("tanpa inline style statis: setiap style={{…}} hanya membawa variabel CSS (--d) yang dinamis", () => {
    const src = read("src/screens/DalangHanomanScreen.tsx");
    expect(src).not.toMatch(/style=\{\{(?!\s*"--)/);
  });
});

describe("Dalang Hanoman — jalan keluar (44×44, Esc, kembali ke previous)", () => {
  const base = { projects, backlog: [] as Spec[], sessions: [] as TerminalSession[], onOpenSession: noop, onOpenProject: noop, onGoto: noop };

  it("tombol keluar ada di header, tak berada di wadah yang disembunyikan di ponsel", () => {
    render(<DalangHanomanScreen {...base} onExit={noop} />);
    expect(document.querySelector(".hn-dlg-top > .hn-dlg-bar > .hn-dlg-exit")).not.toBeNull();
    const css = read("src/screens/styles/dalang.css");
    expect(css).toMatch(/\.hn-dlg-exit\s*\{[^}]*width:\s*var\(--touch-target\)/);
    expect(css).toMatch(/\.hn-dlg-exit\s*\{[^}]*height:\s*var\(--touch-target\)/);
    expect(css).not.toMatch(/\.hn-dlg-(bar|exit|clock|chip)[^{]*\{[^}]*display:\s*none/);
  });

  it("tanpa `previous`, tombol keluar dan Esc memanggil onExit", () => {
    const onExit = vi.fn();
    render(<DalangHanomanScreen {...base} onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: /Keluar dari panggung/ }));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("dengan `previous`, tombol keluar dan Esc kembali ke halaman sebelumnya, bukan onExit", () => {
    const onBack = vi.fn(); const onExit = vi.fn();
    render(<DalangHanomanScreen {...base} onExit={onExit} previous={{ label: "Overview", onBack }} />);
    fireEvent.click(screen.getByRole("button", { name: "Kembali ke Overview" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe("Dalang Hanoman — status jujur (bukan teks tetap)", () => {
  const base = { projects, backlog: [] as Spec[], sessions: [] as TerminalSession[], onOpenSession: noop, onOpenProject: noop, onGoto: noop, onExit: noop };

  it("status koneksi mencerminkan socket nyata: terhubung, jeda, atau terputus", () => {
    conn.connected = false;
    const first = render(<DalangHanomanScreen {...base} />);
    expect(first.container.querySelector(".hn-dlg-link")!.textContent).toContain("Koneksi terputus · menyambung ulang");
    first.unmount();

    conn.connected = true;
    const second = render(<DalangHanomanScreen {...base} />);
    expect(second.container.querySelector(".hn-dlg-link")!.textContent).toContain("Terhubung");
    second.unmount();

    conn.connected = false; conn.paused = true;
    const third = render(<DalangHanomanScreen {...base} />);
    expect(third.container.querySelector(".hn-dlg-link")!.textContent).toContain("Jeda · tab tersembunyi");
    expect(third.container.textContent).not.toContain("SEMUA SISTEM NORMAL");
  });

  it("ticker jujur: 'ONLINE' hanya saat terhubung; terputus tak pernah ditulis online", () => {
    motion.reduce = true;
    conn.connected = false;
    const off = render(<DalangHanomanScreen {...base} />);
    expect(off.container.querySelector(".hn-dlg-boot")!.textContent).toBe("KONEKSI TERPUTUS · MENYAMBUNG ULANG");
    expect(off.container.textContent).not.toContain("ONLINE");
    off.unmount();

    conn.connected = true;
    const on = render(<DalangHanomanScreen {...base} />);
    expect(on.container.querySelector(".hn-dlg-boot")!.textContent).toBe("HANOMAN ONLINE · KELIR SUNYI");
    expect(on.container.textContent).not.toContain("SEMUA SISTEM NORMAL");
  });

  it("tanpa yang menunggu, ticker berkata begitu, bukan 'semua sistem normal'", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    try {
      const { container } = render(<DalangHanomanScreen {...base} />);
      const boot = container.querySelector(".hn-dlg-boot")!;
      // Baris ketiga ticker baru tampil setelah dua baris pertama selesai diketik (ketukan 26 ms).
      const line = "TIDAK ADA YANG MENUNGGU JAWABANMU";
      for (let i = 0; i < 4000 && boot.textContent !== line; i++) act(() => { vi.advanceTimersByTime(26); });
      expect(boot.textContent).toBe(line);
      expect(container.textContent).not.toContain("SEMUA SISTEM NORMAL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("daftar project memakai listitem di tiap baris", () => {
    render(<DalangHanomanScreen {...base} />);
    const list = document.querySelector(".hn-dlg-cards")!;
    expect(within(list as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("Dalang Hanoman — reduced-motion dan isolasi ticker/jam", () => {
  const base = { projects, backlog: [] as Spec[], sessions: [] as TerminalSession[], onOpenSession: noop, onOpenProject: noop, onGoto: noop, onExit: noop };
  const FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
    "cancelAnimationFrame", "performance", "Date"] as const;

  afterEach(() => { vi.useRealTimers(); });

  it("reduced-motion: ticker statis di baris pertama, hitungan KPI langsung ke nilai akhir", () => {
    motion.reduce = true;
    const { container } = render(<DalangHanomanScreen {...base} />);
    expect(container.querySelector(".hn-dlg-boot")!.textContent).toBe("HANOMAN ONLINE · KELIR SUNYI");
    const kpi = container.querySelector(".hn-dlg-kpi-v")!;
    expect(kpi.textContent).toBe("3");
  });

  it("gerak normal: ticker mengetik (teks tumbuh) dan hitungan KPI naik ke nilai akhir", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { container } = render(<DalangHanomanScreen {...base} />);
    const boot = container.querySelector(".hn-dlg-boot")!;
    expect(boot.textContent ?? "").toBe("");
    act(() => { vi.advanceTimersByTime(26 * 10); });
    const typed = boot.textContent ?? "";
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.length).toBeLessThan("HANOMAN ONLINE · KELIR SUNYI".length);
    act(() => { vi.advanceTimersByTime(1200); });
    expect(container.querySelector(".hn-dlg-kpi-v")!.textContent).toBe("3");
  });

  it("ticker dan jam tak me-render ulang layar induk (penghitung render tombol keluar tetap)", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { container } = render(<DalangHanomanScreen {...base} />);
    const boot = container.querySelector(".hn-dlg-boot")!;
    const clock = container.querySelector(".hn-dlg-clock")!;
    const exitBefore = renders.exitIcon;
    const clockBefore = clock.textContent;
    act(() => { vi.advanceTimersByTime(26 * 200); });       // ~5 detik ketikan ticker
    act(() => { vi.advanceTimersByTime(4000); });            // empat detik jam
    expect(boot.textContent!.length).toBeGreaterThan(0);     // ticker benar-benar berjalan
    expect(clock.textContent).not.toBe(clockBefore);         // jam benar-benar berjalan
    expect(renders.exitIcon).toBe(exitBefore);               // induk tak ikut render
  });

  it("kontrak CSS: animasi dimatikan di reduced-motion, dan ticker/jam punya komponen sendiri", () => {
    const css = read("src/screens/styles/dalang.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const src = read("src/screens/DalangHanomanScreen.tsx");
    expect(src).toMatch(/const BootTicker = React\.memo\(/);
    expect(src).toMatch(/const DalangClock = React\.memo\(/);
    expect(src).toMatch(/const Kpi = React\.memo\(/);
  });
});
