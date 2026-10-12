import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OverviewScreen } from "../src/screens/OverviewScreen";
import type { ProjectVM, SpecSlim } from "../src/screens/types";
import type { TerminalSession } from "../src/api/client";

// Dua sumber limit dimock lewat objek hoisted supaya tiap test bisa mengubah statusnya.
const { claude, codex } = vi.hoisted(() => ({
  claude: { label: "limit-claude", status: "ok" },
  codex: { label: "limit-codex", status: "unavailable", plan: null as string | null },
}));
vi.mock("../src/api/limits", () => ({ useLimits: () => claude }));
vi.mock("../src/api/codex-limits", () => ({ useCodexLimits: () => codex }));
vi.mock("../src/screens/LimitIndicator", async () => {
  const React = await import("react");
  return { LimitWindows: ({ dto }: { dto: { label: string } }) => React.createElement("div", { "data-testid": "limit-body" }, dto.label) };
});

const noop = () => {};
const project = (over: Partial<ProjectVM> & { id: string; name: string }) =>
  ({ docStatus: "ok", coverage: 90, backlog: 0, activity: "commit terakhir", commit: "abc123",
    session: { status: "idle", phase: null, flow: null }, ...over }) as unknown as ProjectVM;
const session = (over: Partial<TerminalSession> & { id: string; projectId: string }) =>
  ({ cwd: "/tmp", exited: false, ...over }) as TerminalSession;
const spec = (over: { id: string; startedAt?: string | null; stage?: string; source?: string; priority?: string }) =>
  ({ id: over.id, stage: over.stage ?? "executing", startedAt: over.startedAt ?? null,
    source: over.source ?? "brief", priority: over.priority ?? "sedang" }) as unknown as SpecSlim;

beforeEach(() => { codex.status = "unavailable"; codex.plan = null; });

const overviewSrc = () => readFileSync(resolve(import.meta.dirname, "../src/screens/OverviewScreen.tsx"), "utf8");

describe("Overview · tanpa project", () => {
  it("satu jalan masuk ke 'Buat project pertama', tanpa KPI '0/0' atau jargon", () => {
    const onGoto = vi.fn();
    render(<OverviewScreen projects={[]} backlog={[]} sessions={[]} onOpenProject={noop} onGoto={onGoto} onOpenSession={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Buat project pertama" }));
    expect(onGoto).toHaveBeenCalledWith("projects");
    expect(screen.getByText("Selamat datang di hanoman")).toBeTruthy();
    expect(screen.queryByText(/0\/0/)).toBeNull();
    expect(screen.queryByText(/on-convention/i)).toBeNull();
  });

  it("memakai onCreateProject bila diberikan (modal langsung, bukan halaman Projects)", () => {
    const onCreate = vi.fn(); const onGoto = vi.fn();
    render(<OverviewScreen projects={[]} backlog={[]} sessions={[]} onOpenProject={noop} onGoto={onGoto}
      onOpenSession={noop} onCreateProject={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Buat project pertama" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onGoto).not.toHaveBeenCalled();
  });
});

describe("Overview · kalimat status dan CTA kontekstual", () => {
  const projects = [
    project({ id: "a", name: "alpha", docStatus: "broken", coverage: 30 }),
    project({ id: "b", name: "beta", docStatus: "drift", coverage: 70 }),
    project({ id: "c", name: "gamma" }),
  ];

  it("satu kalimat status: sesi berjalan, menunggu jawabanmu, perlu perhatian", () => {
    render(<OverviewScreen projects={projects} backlog={[]} onOpenProject={noop} onGoto={noop} onOpenSession={noop}
      sessions={[
        session({ id: "s1", projectId: "a" }),
        session({ id: "s2", projectId: "b", decision: true }),
        session({ id: "s3", projectId: "c" }),
      ]} />);
    expect(screen.getByText("3 sesi berjalan · 1 menunggu jawabanmu · 2 perlu perhatian")).toBeTruthy();
  });

  it("CTA primer 'Jawab sesi yang menunggu' membuka sesi yang menunggu", () => {
    const onOpenSession = vi.fn();
    render(<OverviewScreen projects={projects} backlog={[]} onOpenProject={noop} onGoto={noop} onOpenSession={onOpenSession}
      sessions={[session({ id: "s2", projectId: "b", decision: true })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Jawab sesi yang menunggu" }));
    expect(onOpenSession).toHaveBeenCalledWith("s2");
  });

  it("tanpa yang menunggu, CTA primer 'Buka backlog'; 'Buka panggung' menuju Dalang", () => {
    const onGoto = vi.fn();
    render(<OverviewScreen projects={[project({ id: "c", name: "gamma" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={onGoto} onOpenSession={noop} />);
    expect(screen.getByText("Tidak ada sesi berjalan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Buka backlog" }));
    expect(onGoto).toHaveBeenCalledWith("backlog");
    fireEvent.click(screen.getByRole("button", { name: "Buka panggung" }));
    expect(onGoto).toHaveBeenCalledWith("dalang");
    expect(screen.queryByRole("button", { name: "Jawab sesi yang menunggu" })).toBeNull();
  });
});

describe("Overview · sesi berjalan", () => {
  it("yang menunggu di atas, dengan aksi 'Jawab'; sesi lain diurut dari yang paling lama mulai", () => {
    const onOpenSession = vi.fn();
    render(<OverviewScreen
      projects={[project({ id: "a", name: "alpha" }), project({ id: "b", name: "beta" }), project({ id: "c", name: "gamma" })]}
      backlog={[spec({ id: "SPEC-NEW", startedAt: "2026-10-10T08:00:00.000Z" }), spec({ id: "SPEC-OLD", startedAt: "2026-10-01T08:00:00.000Z" })]}
      sessions={[
        session({ id: "s-new", projectId: "a", specId: "SPEC-NEW" }),
        session({ id: "s-old", projectId: "b", specId: "SPEC-OLD" }),
        session({ id: "s-wait", projectId: "c", decision: true }),
      ]}
      onOpenProject={noop} onGoto={noop} onOpenSession={onOpenSession} />);
    const items = within(screen.getByRole("list", { name: "Sesi berjalan" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("gamma");
    expect(items[0]!.textContent).toContain("Menunggu jawabanmu");
    expect(items[1]!.textContent).toContain("beta");
    expect(items[2]!.textContent).toContain("alpha");
    fireEvent.click(within(items[0]!).getByRole("button", { name: "Jawab" }));
    expect(onOpenSession).toHaveBeenLastCalledWith("s-wait");
    fireEvent.click(within(items[1]!).getByRole("button", { name: /beta/ }));
    expect(onOpenSession).toHaveBeenLastCalledWith("s-old");
  });

  it("'dimulai' memakai waktu relatif dari fungsi bersama, dan spec-nya tampil", () => {
    const started = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]}
      backlog={[spec({ id: "SPEC-7", startedAt: started })]}
      sessions={[session({ id: "s1", projectId: "a", specId: "SPEC-7" })]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    const row = within(screen.getByRole("list", { name: "Sesi berjalan" })).getByRole("button", { name: /alpha/ });
    expect(row.textContent).toContain("SPEC-7");
    expect(row.textContent).toContain("dimulai 5 menit lalu");
  });

  it("tanpa sesi, tampil keadaan kosong (bukan daftar)", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getByText("Tidak ada sesi aktif")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Sesi berjalan" })).toBeNull();
  });
});

describe("Overview · perlu perhatian dan project", () => {
  it("dokumen rusak/drift tampil dengan label glosarium; klik membuka project", () => {
    const onOpenProject = vi.fn();
    const alpha = project({ id: "a", name: "alpha", docStatus: "broken", coverage: 20 });
    render(<OverviewScreen projects={[alpha, project({ id: "b", name: "beta", docStatus: "drift", coverage: 60 })]}
      backlog={[]} sessions={[]} onOpenProject={onOpenProject} onGoto={noop} onOpenSession={noop} />);
    const attn = within(screen.getByRole("list", { name: "Perlu perhatian" })).getAllByRole("listitem");
    expect(attn).toHaveLength(2);
    expect(attn[0]!.textContent).toContain("Belum sesuai");
    expect(attn[1]!.textContent).toContain("Tidak sinkron");
    fireEvent.click(within(attn[0]!).getByRole("button", { name: /alpha/ }));
    expect(onOpenProject).toHaveBeenCalledWith(alpha);
  });

  it("tanpa masalah dokumen, tampil 'Dokumen sudah sesuai standar'", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getByText("Dokumen sudah sesuai standar")).toBeTruthy();
  });

  it("project: nama, cakupan, status, dan backlog terbuka; urut cakupan terendah", () => {
    const onOpenProject = vi.fn();
    const onGoto = vi.fn();
    const low = project({ id: "a", name: "alpha", coverage: 40, backlog: 3 });
    render(<OverviewScreen projects={[project({ id: "b", name: "beta", coverage: 95, backlog: 0 }), low]}
      backlog={[spec({ id: "S1", source: "qa", priority: "tinggi" }), spec({ id: "S2", source: "brief" })]}
      sessions={[]} onOpenProject={onOpenProject} onGoto={onGoto} onOpenSession={noop} />);
    const rows = within(screen.getByRole("list", { name: "Project" })).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("alpha");
    expect(rows[0]!.textContent).toContain("40%");
    expect(rows[0]!.textContent).toContain("3 item terbuka");
    expect(rows[1]!.textContent).toContain("95%");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /alpha/ }));
    expect(onOpenProject).toHaveBeenCalledWith(low);
    fireEvent.click(screen.getByRole("button", { name: "Backlog: 1 dari brief · 1 dari QA · 1 prioritas tinggi" }));
    expect(onGoto).toHaveBeenCalledWith("backlog");
  });

  it("aktivitas terbaru: maksimal lima baris, dan klik membuka project", () => {
    const onOpenProject = vi.fn();
    const many = Array.from({ length: 7 }, (_, i) => project({ id: `p${i}`, name: `proj${i}` }));
    render(<OverviewScreen projects={many} backlog={[]} sessions={[session({ id: "s1", projectId: "p6" })]}
      onOpenProject={onOpenProject} onGoto={noop} onOpenSession={noop} />);
    const rows = within(screen.getByRole("list", { name: "Aktivitas terbaru" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toContain("Berjalan");
    expect(rows[0]!.textContent).toContain("proj6");   // yang hidup naik ke atas
    fireEvent.click(within(rows[0]!).getByRole("button"));
    expect(onOpenProject).toHaveBeenCalledWith(many[6]);
  });
});

describe("Overview · limit langganan", () => {
  it("satu seksi 'Limit langganan' saat codex belum pernah melapor", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getAllByText("Limit langganan")).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Codex" })).toBeNull();
    expect(screen.getByTestId("limit-body").textContent).toBe("limit-claude");
  });

  it("bila codex melapor, satu seksi bertab Claude/Codex", () => {
    codex.status = "ok"; codex.plan = "plus";
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]} sessions={[]}
      onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(screen.getAllByText("Limit langganan")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByTestId("limit-body").textContent).toBe("limit-codex");
    expect(screen.getByText(/tercatat · Codex · plus/)).toBeTruthy();
  });
});

describe("Overview · kontrak layout", () => {
  it("tanpa hero Dalang: panggung dan aset dalang tidak dirender", () => {
    render(<OverviewScreen projects={[project({ id: "a", name: "alpha" })]} backlog={[]}
      sessions={[session({ id: "s1", projectId: "a" })]} onOpenProject={noop} onGoto={noop} onOpenSession={noop} />);
    expect(document.querySelector(".hn-dalang")).toBeNull();
    expect(document.querySelector('img[src*="dalang-six-arms"]')).toBeNull();
    expect(screen.queryByText("Panggung sunyi")).toBeNull();
  });

  it("satu kolom tanpa inline grid atau layout inline: layout lewat kelas hn-ov-*", () => {
    const src = overviewSrc();
    expect(src).not.toMatch(/gridTemplateColumns/);
    expect(src).not.toMatch(/style=\{\{/);
    expect(src).not.toMatch(/SpotIllustration|DalangStage/);
  });
});
