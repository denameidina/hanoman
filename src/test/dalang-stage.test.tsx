import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DalangStage } from "../src/screens/DalangStage";
import type { ProjectVM, Spec } from "../src/screens/types";

function project(over: { id: string; name: string; status?: "running" | "idle"; phase?: string | null }): ProjectVM {
  return {
    id: over.id, name: over.name,
    session: { status: over.status ?? "idle", phase: over.phase ?? null, flow: null },
  } as unknown as ProjectVM;
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

describe("DalangStage — panggung dalang di Overview", () => {
  it("kelir sunyi: maskot observe, pesan sunyi, wayang parkir di debog", () => {
    render(<DalangStage projects={[project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" })]}
      backlog={[]} onGoto={noop} onOpenProject={noop} />);
    expect(screen.getByText("Anoman siaga di balik kelir")).toBeTruthy();
    expect(screen.getByText(/Panggung sunyi/)).toBeTruthy();
    expect(document.querySelector('[data-illustration-id="MPS-003"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buka project alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buka project beta" })).toBeTruthy();
  });

  it("sesi running: maskot work + satu wayang hidup per sesi, klik → terminal", () => {
    const onGoto = vi.fn();
    render(<DalangStage
      projects={[
        project({ id: "a", name: "alpha", status: "running", phase: "execute" }),
        project({ id: "b", name: "beta", status: "running" }),
        project({ id: "c", name: "gamma" }),
      ]}
      backlog={[]} onGoto={onGoto} onOpenProject={noop} />);
    expect(screen.getByText("Anoman sedang memainkan lakon")).toBeTruthy();
    expect(document.querySelector('[data-illustration-id="MPS-004"]')).toBeTruthy();
    const liveList = screen.getByRole("list", { name: "Sesi yang sedang berjalan" });
    expect(liveList.querySelectorAll(".hn-dalang-live")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Buka terminal — alpha, fase execute/ }));
    expect(onGoto).toHaveBeenCalledWith("terminal");
    // gamma tak running → parkir di debog, bukan di kelir
    expect(screen.getByRole("button", { name: "Buka project gamma" })).toBeTruthy();
  });

  it("stat 'dikerjakan hari ini' menghitung startedAt hari LOKAL ini saja", () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    render(<DalangStage projects={[]} backlog={[
      spec({ id: "s1", startedAt: now }),
      spec({ id: "s2", startedAt: yesterday }),
      spec({ id: "s3", startedAt: null }),
      spec({ id: "s4", stage: "done", startedAt: null }),
    ]} onGoto={noop} onOpenProject={noop} />);
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
    render(<DalangStage projects={[p]} backlog={[]} onGoto={noop} onOpenProject={onOpen} />);
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
});
