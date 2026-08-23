import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DalangHanomanScreen } from "../src/screens/DalangHanomanScreen";
import { HN_NAV } from "../src/ds/shell";
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

describe("Dalang Hanoman — menu & layar panggung orkestrasi", () => {
  it("terdaftar di HN_NAV sebagai 'Dalang Hanoman' (cabang App dijaga changelog-nav.test)", () => {
    const item = HN_NAV.find((n) => n.key === "dalang");
    expect(item?.label).toBe("Dalang Hanoman");
  });

  it("sesi hidup → hero sinematik, kartu per sesi (klik → fokus sesi), yang decision amber", () => {
    const onOpenSession = vi.fn();
    render(<DalangHanomanScreen projects={projects}
      backlog={[spec({ id: "SPEC-1", stage: "execute", startedAt: new Date() })]}
      sessions={[
        session({ id: "s1", projectId: "a", specId: "SPEC-1" }),
        session({ id: "s2", projectId: "b", decision: true }),
        session({ id: "s3", projectId: "c", exited: true, exitCode: 0 }),
      ]}
      onOpenSession={onOpenSession} onOpenProject={noop} onGoto={noop} />);
    expect(document.querySelector('img[src*="hero-cinematic"]')).toBeTruthy();
    const list = screen.getByRole("list", { name: "Sesi yang sedang berjalan" });
    expect(list.querySelectorAll(".hn-dlg-prj")).toHaveLength(2);
    expect(list.querySelectorAll('.hn-dlg-prj[data-waiting]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Buka terminal — alpha, SPEC-1 · execute/ }));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
    // gamma exited → parkir di debog
    expect(screen.getByRole("button", { name: "Buka project gamma" })).toBeTruthy();
  });

  it("kelir sunyi → pesan sunyi, blencong tak menyala, tombol perintah → terminal", () => {
    const onGoto = vi.fn();
    render(<DalangHanomanScreen projects={projects} backlog={[]} sessions={[]}
      onOpenSession={noop} onOpenProject={noop} onGoto={onGoto} />);
    expect(screen.getByText(/Panggung sunyi/)).toBeTruthy();
    expect(document.querySelector(".hn-dlg-blencong[data-lit]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /pusat kendali sesi/ }));
    expect(onGoto).toHaveBeenCalledWith("terminal");
  });

  it("donut distribusi backlog dihitung dari stage nyata", () => {
    render(<DalangHanomanScreen projects={[]} sessions={[]}
      backlog={[
        spec({ id: "s1", stage: "done" }), spec({ id: "s2", stage: "done" }),
        spec({ id: "s3", stage: "executing" }), spec({ id: "s4", stage: "planned" }), spec({ id: "s5" }),
      ]}
      onOpenSession={noop} onOpenProject={noop} onGoto={noop} />);
    const leg = document.querySelector(".hn-dlg-leg")!;
    expect(leg.textContent).toContain("Done 2");
    expect(leg.textContent).toContain("Execute 1");
    expect(document.querySelector(".hn-dlg-donut-c b")!.textContent).toBe("5");
  });

  it("kontrak design system: layar tanpa warna literal (semua lewat kelas/token)", () => {
    const src = read("src/screens/DalangHanomanScreen.tsx");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
    // sumber hidup wajib sessions WS, bukan ProjectView.session yang basi
    expect(src).not.toMatch(/\.session\.(status|phase|flow)/);
  });
});
