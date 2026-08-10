import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { HanomanPet } from "../src/screens/HanomanPet";
import { PET_HIDDEN_KEY } from "../src/screens/pet-state";

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

function mockMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: reduced, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

const styleOf = (el: HTMLElement): string => el.getAttribute("style") ?? "";
const hit = () => screen.getByRole("button", { name: "Ringkasan status Hanoman" });

function animationEnd(element: HTMLElement, animationName: string): void {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(element, event);
}

beforeEach(() => { localStorage.clear(); mockMatchMedia(false); });

describe("HanomanPet", () => {
  it("merender pose `ready` sebagai status yang terbaca screen reader", () => {
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" })]} onOpen={vi.fn()} />);

    const art = screen.getByTestId("illustration-STK-001");
    expect(art.getAttribute("alt")).toContain("Hanoman");
    expect(art.getAttribute("alt")).toContain("1 backlog siap dikerjakan");
    expect(art).not.toHaveAttribute("aria-hidden");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toContainElement(art);
  });

  it("berpindah pose saat sesi hidup muncul, pose lama tinggal sebagai lapisan bisu", () => {
    const backlog = [spec({ id: "SPEC-1", stage: "executing" })];
    const { rerender } = render(<HanomanPet sessions={[]} backlog={backlog} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "spec-1", specId: "SPEC-1" })]}
      backlog={backlog} onOpen={vi.fn()} />);

    const working = screen.getByTestId("illustration-STK-002");
    expect(working).toHaveStyle({
      opacity: "1",
      animation: "hn-pet-pose-in var(--dur-slow) var(--ease-out) both",
    });
    expect(working.getAttribute("alt")).toContain("sedang berjalan");

    const ready = screen.getByTestId("illustration-STK-001");
    expect(ready).toHaveStyle({
      opacity: "0",
      animation: "hn-pet-pose-out var(--dur-slow) var(--ease-out) both",
    });
    expect(styleOf(working)).not.toContain("transition: opacity");
    expect(ready).toHaveAttribute("aria-hidden", "true");
    expect(ready).toHaveAttribute("alt", "");
  });

  it("memilih idle working yang berbeda dari ready", () => {
    render(<HanomanPet backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
      sessions={[session({ id: "spec-1", specId: "SPEC-1" })]} onOpen={vi.fn()} />);

    expect(screen.getByTestId("pet-idle")).toHaveStyle({
      animation: "hn-pet-idle-working var(--dur-pet-active) var(--ease-inout) infinite",
    });
    expect(styleOf(screen.getByTestId("pet-idle"))).not.toContain("hn-pet-idle-ready");
  });

  it("bereaksi sekali saat diklik dan selesai lewat animationend", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());

    const reactor = screen.getByTestId("pet-reactor");
    expect(reactor).toHaveStyle({
      animation: "hn-pet-click var(--dur-slow) var(--ease-out) both",
    });
    animationEnd(reactor, "hn-pet-click");
    expect(reactor).toHaveStyle({ animation: "none" });
  });

  it("menganimasi panel masuk dan keluar sebelum unmount", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());

    const panel = screen.getByTestId("pet-panel");
    expect(panel).toHaveStyle({
      animation: "hn-pet-panel-in var(--dur-slow) var(--ease-out) both",
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveStyle({
      pointerEvents: "none",
      animation: "hn-pet-panel-out var(--dur-slow) var(--ease-out) both",
    });
    animationEnd(panel, "hn-pet-panel-out");
    expect(screen.queryByTestId("pet-panel")).toBeNull();
  });

  it("mematikan seluruh gerak saat prefers-reduced-motion: reduce", () => {
    mockMatchMedia(true);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);

    expect(screen.getByTestId("pet-stage")).toHaveStyle({ animation: "none" });
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({
      animation: "none", transition: "none",
    });
    expect(screen.getByTestId("pet-idle")).toHaveStyle({ animation: "none" });
    expect(screen.getByTestId("illustration-STK-001")).toHaveStyle({
      animation: "none", transition: "none", opacity: "1",
    });

    fireEvent.click(hit());
    expect(screen.getByTestId("pet-panel")).toHaveStyle({ animation: "none" });
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "none" });
    expect(screen.getByRole("button", { name: "Buka Backlog" })).toHaveStyle({
      transition: "none", transform: "none",
    });
    expect(screen.getByRole("button", { name: "Sembunyikan" })).toHaveStyle({
      transition: "none", transform: "none",
    });
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

    expect(screen.queryByTestId("illustration-STK-001")).toBeNull();
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("1");
    unmount();

    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("illustration-STK-001")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan pet Hanoman" }));
    expect(screen.getByTestId("illustration-STK-001")).toBeInTheDocument();
    expect(screen.getByTestId("pet-stage")).toHaveStyle({
      animation: "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
    });
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("0");
  });

  it("tidak menangkap klik di area kosong sekitarnya", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-root")).toHaveStyle({ pointerEvents: "none" });
    expect(hit()).toHaveStyle({ pointerEvents: "auto" });
  });
});
