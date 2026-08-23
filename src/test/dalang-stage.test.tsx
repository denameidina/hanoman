import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DalangStage } from "../src/screens/DalangStage";
import type { TerminalSession } from "../src/api/client";
import type { ProjectVM, Spec } from "../src/screens/types";

function project(over: { id: string; name: string }): ProjectVM {
  return { id: over.id, name: over.name,
    session: { status: "idle", phase: null, flow: null } } as unknown as ProjectVM;
}

// Sumber "hidup" adalah daftar sesi WS, cermin pet-state.ts: hidup = !exited,
// menunggu manusia = decision && !deciding.
function session(over: Partial<TerminalSession> & { id: string; projectId: string }): TerminalSession {
  return { cwd: "/tmp", exited: false, ...over } as TerminalSession;
}

// Batas hari LOKAL: fixture memakai jam lokal hari ini, bukan string "YYYY-MM-DD" (yang
// di-parse sebagai UTC dan bisa jatuh ke hari lain di WIB — gotcha ADR-0090).
function spec(over: { id: string; startedAt?: Date | null; stage?: string }): Spec {
  return {
    id: over.id, stage: over.stage ?? "spec",
    startedAt: over.startedAt ? over.startedAt.toISOString() : null,
  } as unknown as Spec;
}

const noop = () => {};
const projects = [project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" }), project({ id: "c", name: "gamma" })];

describe("DalangStage — panggung dalang di Overview", () => {
  it("kelir sunyi: maskot observe, pesan sunyi, semua wayang parkir di debog", () => {
    render(<DalangStage projects={projects.slice(0, 2)} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} />);
    expect(screen.getByText("Anoman siaga di balik kelir")).toBeTruthy();
    expect(screen.getByText(/Panggung sunyi/)).toBeTruthy();
    // Sang dalang (aset Codex) selalu hadir; blencong tak menyala saat kelir sunyi.
    expect(document.querySelector('img[src*="dalang-six-arms"]')).toBeTruthy();
    expect(document.querySelector(".hn-dalang-blencong[data-lit]")).toBeNull();
    expect(document.querySelector(".hn-dalang-stage[data-live]")).toBeNull();
    expect(document.querySelector("svg.hn-dalang-threads")).toBeNull();
    expect(screen.getByRole("button", { name: "Buka project alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buka project beta" })).toBeTruthy();
  });

  it("sesi hidup dari siaran WS: satu wayang per sesi, klik → fokus sesi itu di terminal", () => {
    const onOpenSession = vi.fn();
    render(<DalangStage projects={projects}
      backlog={[spec({ id: "SPEC-1", stage: "execute", startedAt: new Date() })]}
      sessions={[
        session({ id: "s-alpha", projectId: "a", specId: "SPEC-1" }),
        session({ id: "s-beta", projectId: "b", flow: "qa" }),
        session({ id: "s-dead", projectId: "c", exited: true, exitCode: 0 }),
      ]}
      onOpenSession={onOpenSession} onOpenProject={noop} />);
    expect(screen.getByText("Anoman sedang memainkan lakon")).toBeTruthy();
    expect(document.querySelector('img[src*="dalang-six-arms"]')).toBeTruthy();
    expect(document.querySelector(".hn-dalang-blencong[data-lit]")).toBeTruthy();
    // Mode orkestrasi: kelir gelap (data-live) + lapisan benang gapit ada. Path-nya diukur
    // dari rect nyata, jadi di jsdom (rect 0) sengaja kosong — yang dikunci kontraknya.
    expect(document.querySelector(".hn-dalang-stage[data-live]")).toBeTruthy();
    expect(document.querySelector("svg.hn-dalang-threads")).toBeTruthy();
    const liveList = screen.getByRole("list", { name: "Sesi yang sedang berjalan" });
    expect(liveList.querySelectorAll(".hn-dalang-live")).toHaveLength(2);
    expect(liveList.querySelectorAll('img[src*="wayang-project"]')).toHaveLength(2);
    // sub-label memakai Spec.stage yang hidup, bukan ProjectView.session yang basi
    fireEvent.click(screen.getByRole("button", { name: "Buka terminal — alpha, SPEC-1 · execute" }));
    expect(onOpenSession).toHaveBeenCalledWith("s-alpha");
    // gamma: sesinya sudah exited → wayang parkir di debog, bukan di kelir
    expect(screen.getByRole("button", { name: "Buka project gamma" })).toBeTruthy();
  });

  it("sesi decision && !deciding = wayang menunggu jawabanmu (diam, amber)", () => {
    render(<DalangStage projects={projects} backlog={[]}
      sessions={[
        session({ id: "s1", projectId: "a", decision: true }),
        session({ id: "s2", projectId: "b", decision: true, deciding: true }),
      ]}
      onOpenSession={noop} onOpenProject={noop} />);
    const waiting = document.querySelectorAll(".hn-dalang-live[data-waiting]");
    expect(waiting).toHaveLength(1); // s2 sedang dilayani lead — bukan "butuh kamu" (alarm palsu)
    expect(screen.getByText("menunggu jawabanmu")).toBeTruthy();
    expect(document.querySelector(".hn-dalang-puppet--still")).toBeTruthy();
  });

  it("stat 'dikerjakan hari ini' menghitung startedAt hari LOKAL ini saja", () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    render(<DalangStage projects={[]} sessions={[]} backlog={[
      spec({ id: "s1", startedAt: now }),
      spec({ id: "s2", startedAt: yesterday }),
      spec({ id: "s3", startedAt: null }),
      spec({ id: "s4", stage: "done", startedAt: null }),
    ]} onOpenSession={noop} onOpenProject={noop} />);
    const started = screen.getByText("dikerjakan hari ini").parentElement!;
    expect(started.textContent).toContain("1");
    const waiting = screen.getByText("menunggu di backlog").parentElement!;
    expect(waiting.textContent).toContain("1"); // hanya s3 — s1/s2 sudah mulai, s4 sudah done
    const done = screen.getByText("total selesai").parentElement!;
    expect(done.textContent).toContain("1");
  });

  it("klik wayang parkir membuka project-nya", () => {
    const onOpen = vi.fn();
    const p = project({ id: "a", name: "alpha" });
    render(<DalangStage projects={[p]} backlog={[]} sessions={[]} onOpenSession={noop} onOpenProject={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Buka project alpha" }));
    expect(onOpen).toHaveBeenCalledWith(p);
  });

  it("kontrak design system: tanpa warna literal di luar token", () => {
    const found = [resolve(process.cwd(), "src/screens/DalangStage.tsx"),
      resolve(process.cwd(), "src", "src/screens/DalangStage.tsx")].find((c) => existsSync(c));
    const src = readFileSync(found!, "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
  });

  it("sumber hidup adalah sessions WS — komponen tak membaca ProjectView.session", () => {
    const found = [resolve(process.cwd(), "src/screens/DalangStage.tsx"),
      resolve(process.cwd(), "src", "src/screens/DalangStage.tsx")].find((c) => existsSync(c));
    const src = readFileSync(found!, "utf8");
    expect(src).not.toMatch(/\.session\.(status|phase|flow)/);
  });
});
