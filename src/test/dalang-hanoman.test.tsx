import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DalangHanomanScreen } from "../src/screens/DalangHanomanScreen";
import { HN_NAV } from "../src/ds/shell";
// Status koneksi nyata dikendalikan test lewat objek hoisted (baris status harus mencerminkannya).
const { conn } = vi.hoisted(() => ({ conn: { connected: true, since: 0, paused: false } }));
vi.mock("../src/api/live", () => ({ useEventsStatus: () => conn }));
import type { TerminalSession } from "../src/api/client";
import type { ProjectVM, Spec } from "../src/screens/types";

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

describe("Dalang Hanoman — menu & papan status", () => {
  it("terdaftar di HN_NAV sebagai 'Dalang Hanoman' (cabang App dijaga changelog-nav.test)", () => {
    const item = HN_NAV.find((n) => n.key === "dalang");
    expect(item?.label).toBe("Dalang Hanoman");
  });

  it("ringkasan satu baris; yang menunggu di atas; tiap project tampil sekali", () => {
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
    expect(screen.getByText("2 sesi berjalan · 1 menunggu jawabanmu · 3 project")).toBeTruthy();

    const waiting = screen.getByRole("heading", { name: "Menunggu jawabanmu" }).parentElement!;
    const waitRow = within(waiting).getByRole("button", { name: /beta/ });
    expect(waitRow.textContent).toContain("Jawab");
    fireEvent.click(waitRow);
    expect(onOpenSession).toHaveBeenCalledWith("s2");

    const running = screen.getByRole("button", { name: /alpha/ });
    expect(running.textContent).toContain("SPEC-1");
    expect(running.textContent).toContain("Dikerjakan");
    fireEvent.click(running);
    expect(onOpenSession).toHaveBeenLastCalledWith("s1");

    // gamma: sesinya sudah exited → baris redup, klik membuka project
    expect(document.querySelectorAll(".hn-dlg-row--off")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /gamma/ }));
    expect(onOpenProject).toHaveBeenCalled();
    // setiap project tepat satu baris (beta hanya di seksi menunggu)
    expect(screen.getAllByRole("button", { name: /alpha|beta|gamma/ })).toHaveLength(3);
  });

  it("tanpa sesi: semua project redup, tanpa seksi menunggu, keluar via tombol dan Esc", () => {
    const onGoto = vi.fn();
    const onExit = vi.fn();
    render(<DalangHanomanScreen projects={projects} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} onGoto={onGoto} onExit={onExit} />);
    expect(screen.getByText("Tidak ada sesi berjalan · 3 project")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Menunggu jawabanmu" })).toBeNull();
    expect(document.querySelectorAll(".hn-dlg-row--off")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Buka terminal" }));
    expect(onGoto).toHaveBeenCalledWith("terminal");
    fireEvent.click(screen.getByRole("button", { name: /Keluar dari panggung/ }));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("tanpa project: satu kalimat panggung sunyi, tanpa daftar", () => {
    render(<DalangHanomanScreen projects={[]} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    expect(screen.getByText("Panggung sunyi — belum ada project di workspace.")).toBeTruthy();
    expect(document.querySelectorAll(".hn-dlg-row")).toHaveLength(0);
  });

  it("papan senyap: tanpa KPI ganda, donut, grafik, aktivitas, dan jam", () => {
    render(<DalangHanomanScreen projects={projects}
      backlog={[spec({ id: "s1", stage: "done" }), spec({ id: "s3", stage: "executing" })]}
      sessions={[]} onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    expect(document.querySelector(".hn-dlg-kpi")).toBeNull();
    expect(document.querySelector(".hn-dlg-donut")).toBeNull();
    expect(document.querySelector(".hn-dlg-chart")).toBeNull();
    expect(document.querySelector(".hn-dlg-card")).toBeNull();
    expect(document.querySelector(".hn-dlg-hud")).toBeNull();
    expect(document.querySelector(".hn-dlg-rig-body")).toBeNull();
  });

  it("wayang sebagai ikon kecil (SVG, tanpa gambar besar)", () => {
    render(<DalangHanomanScreen projects={[projects[0]!]} backlog={[]}
      sessions={[session({ id: "s1", projectId: "a" })]}
      onOpenSession={noop} onOpenProject={noop} onGoto={noop} onExit={noop} />);
    const glyph = document.querySelector(".hn-dlg-glyph svg");
    expect(glyph).toBeTruthy();
    expect(glyph!.getAttribute("height")).toBe("24");
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("kontrak design system: layar dan CSS-nya tanpa warna literal", () => {
    const src = read("src/screens/DalangHanomanScreen.tsx");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
    const css = read("src/screens/styles/dalang.css");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgba?|hsla?)\(/);
    // sumber hidup wajib sessions WS, bukan ProjectView.session yang basi
    expect(src).not.toMatch(/\.session\.(status|phase|flow)/);
  });

  it("tanpa timer dan animasi: pet tetap satu-satunya elemen yang bergerak", () => {
    const src = read("src/screens/DalangHanomanScreen.tsx");
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|performance\.now|matchMedia/);
    const css = read("src/screens/styles/dalang.css");
    expect(css).not.toMatch(/animation|@keyframes|transition/);
  });
});

describe("Dalang Hanoman — jalan keluar, status koneksi, semantik daftar", () => {
  const base = { projects, backlog: [] as Spec[], sessions: [] as TerminalSession[], onOpenSession: noop, onOpenProject: noop, onGoto: noop };

  beforeEach(() => { conn.connected = true; conn.paused = false; });

  it("tombol keluar ada di header (bukan di wadah yang disembunyikan di ponsel)", () => {
    render(<DalangHanomanScreen {...base} onExit={noop} />);
    expect(document.querySelector(".hn-dlg-top > .hn-dlg-actions > .hn-dlg-exit")).not.toBeNull();
  });

  it("dengan `previous`, tombol keluar kembali ke halaman sebelumnya", () => {
    const onBack = vi.fn(); const onExit = vi.fn();
    render(<DalangHanomanScreen {...base} onExit={onExit} previous={{ label: "Overview", onBack }} />);
    fireEvent.click(screen.getByRole("button", { name: "Kembali ke Overview" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("status koneksi mencerminkan socket nyata: terhubung, jeda, atau terputus", () => {
    conn.connected = false;
    const first = render(<DalangHanomanScreen {...base} onExit={noop} />);
    expect(first.container.querySelector(".hn-dlg-link")!.textContent).toContain("Koneksi terputus · menyambung ulang");
    first.unmount();

    conn.connected = true;
    const second = render(<DalangHanomanScreen {...base} onExit={noop} />);
    expect(second.container.querySelector(".hn-dlg-link")!.textContent).toContain("Terhubung");
    second.unmount();

    conn.connected = false; conn.paused = true;
    const third = render(<DalangHanomanScreen {...base} onExit={noop} />);
    expect(third.container.querySelector(".hn-dlg-link")!.textContent).toContain("Jeda · tab tersembunyi");
    expect(third.container.textContent).not.toContain("SEMUA SISTEM NORMAL");
  });

  it("daftar project memakai listitem di tiap baris", () => {
    render(<DalangHanomanScreen {...base} onExit={noop} />);
    const list = document.querySelector(".hn-dlg-list")!;
    expect(within(list as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
  });
});
