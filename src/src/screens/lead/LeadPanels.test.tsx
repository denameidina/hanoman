import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LEAD_DEFAULTS, type LeadApprovalView, type LeadEventView, type LeadSessionView } from "@hanoman/shared";
import { LeadApprovalsPanel } from "./LeadApprovalsPanel";
import { LeadInboxPanel } from "./LeadInboxPanel";
import { LeadSessionsPanel } from "./LeadSessionsPanel";
import { LeadAuthorityPanel } from "./LeadAuthorityPanel";

// ADR-0228 · panel sesi lead di layar Lead.

const name = (id: string) => `Proyek ${id}`;
const approval: LeadApprovalView = {
  id: "ap1", eventId: "e1", projectId: "erp", action: "integrate-main", target: "SPEC-1",
  reason: "Plan tuntas, 228 uji API hijau.", evidence: ["SPEC-1", "server/src/x.ts"],
  gateReport: ["wewenang \"integrate-main\" = minta izin"], status: "pending",
  decidedBy: null, decidedAt: null, note: null, createdAt: new Date().toISOString(),
};

describe("LeadApprovalsPanel", () => {
  it("memperlihatkan tindakan, alasan, bukti, dan laporan gerbang", () => {
    render(<LeadApprovalsPanel approvals={[approval]} projectName={name} busyId={null} onDecide={() => {}} />);
    expect(screen.getByText(/integrasi ke main · SPEC-1/)).toBeTruthy();
    expect(screen.getByText("Plan tuntas, 228 uji API hijau.")).toBeTruthy();
    expect(screen.getByText("server/src/x.ts")).toBeTruthy();
    expect(screen.getByText(/Gerbang server/)).toBeTruthy();
  });
  it("Setujui memanggil onDecide(id, true)", () => {
    const onDecide = vi.fn();
    render(<LeadApprovalsPanel approvals={[approval]} projectName={name} busyId={null} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /Setujui/ }));
    expect(onDecide).toHaveBeenCalledWith("ap1", true);
  });
  it("Tolak meminta catatan lalu mengirimnya", () => {
    const onDecide = vi.fn();
    render(<LeadApprovalsPanel approvals={[approval]} projectName={name} busyId={null} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /Tolak/ }));
    fireEvent.change(screen.getByLabelText("Catatan untuk lead"), { target: { value: "tunggu review" } });
    fireEvent.click(screen.getByRole("button", { name: /Kirim penolakan/ }));
    expect(onDecide).toHaveBeenCalledWith("ap1", false, "tunggu review");
  });
  it("kosong → kalimat penjelas", () => {
    render(<LeadApprovalsPanel approvals={[]} projectName={name} busyId={null} onDecide={() => {}} />);
    expect(screen.getByText(/Tidak ada tindakan lead/)).toBeTruthy();
  });
});

const ev = (over: Partial<LeadEventView> = {}): LeadEventView => ({
  id: "e1", projectId: "erp", kind: "ask", status: "delivered", priority: 0, question: "Pakai kolom baru?",
  specId: "SPEC-2", sessionId: "spec-2", deadlineAt: new Date(Date.now() + 120_000).toISOString(),
  deliveredAt: null, createdAt: new Date().toISOString(), decisionId: null, ...over,
});

describe("LeadInboxPanel", () => {
  it("event terbuka bisa diambil alih dan sesinya dibuka", () => {
    const onTake = vi.fn(); const onGoto = vi.fn();
    render(<LeadInboxPanel events={[ev()]} projectName={name} busyId={null} onTake={onTake} onGoto={onGoto} />);
    expect(screen.getByText("di pane lead")).toBeTruthy();
    expect(screen.getByText(/tenggat/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ambil alih/ }));
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
    fireEvent.click(screen.getByRole("button", { name: /Buka sesi/ }));
    expect(onGoto).toHaveBeenCalledWith("spec-2");
  });
  it("event yang lewat tenggat ditandai menunggu kamu, tanpa tombol ambil alih", () => {
    render(<LeadInboxPanel events={[ev({ status: "late" })]} projectName={name} busyId={null} onTake={() => {}} onGoto={() => {}} />);
    expect(screen.getByText(/lewat tenggat/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ambil alih/ })).toBeNull();
  });
});

const sess = (over: Partial<LeadSessionView> = {}): LeadSessionView =>
  ({ projectId: "erp", sessionId: "lead-erp", alive: true, idle: true, humanActive: false, delivered: 3, restarts: 1, ...over });

describe("LeadSessionsPanel", () => {
  it("pane hidup: buka terminal, rotasi, hentikan", () => {
    const onOp = vi.fn(); const onGoto = vi.fn();
    render(<LeadSessionsPanel sessions={[sess()]} projectName={name} busyId={null} onGoto={onGoto} onOp={onOp} />);
    expect(screen.getByText("diam · siap")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Buka terminal/ }));
    expect(onGoto).toHaveBeenCalledWith("lead-erp");
    fireEvent.click(screen.getByRole("button", { name: /Rotasi/ }));
    expect(onOp).toHaveBeenCalledWith("erp", "rotate");
  });
  it("pane mati: hanya Mulai", () => {
    const onOp = vi.fn();
    render(<LeadSessionsPanel sessions={[sess({ alive: false })]} projectName={name} busyId={null} onGoto={() => {}} onOp={onOp} />);
    fireEvent.click(screen.getByRole("button", { name: /Mulai/ }));
    expect(onOp).toHaveBeenCalledWith("erp", "start");
    expect(screen.queryByRole("button", { name: /Hentikan/ })).toBeNull();
  });
  it("manusia mengetik terlihat di status", () => {
    render(<LeadSessionsPanel sessions={[sess({ humanActive: true })]} projectName={name} busyId={null} onGoto={() => {}} onOp={() => {}} />);
    expect(screen.getByText("kamu sedang mengetik")).toBeTruthy();
  });
});

describe("LeadAuthorityPanel", () => {
  it("menyimpan wewenang & perintah verifikasi untuk project terpilih, tanpa menyentuh project lain", async () => {
    const onSave = vi.fn(async () => true);
    const config = { ...LEAD_DEFAULTS, projects: { lain: { targetBranch: "develop" } } };
    render(<LeadAuthorityPanel config={config} busy={false} onSave={onSave}
      projects={[{ id: "erp", name: "ERP" }, { id: "lain", name: "Lain" }]} />);
    fireEvent.change(screen.getByLabelText("wewenang integrate-main"), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText("perintah verifikasi"), { target: { value: "pnpm test" } });
    fireEvent.click(screen.getByRole("button", { name: /Simpan wewenang/ }));
    await Promise.resolve();
    const next = onSave.mock.calls[0]![0] as typeof config & { projects: Record<string, { authority: Record<string, string>; verifyCommand: string }> };
    expect(next.projects.erp!.authority["integrate-main"]).toBe("auto");
    expect(next.projects.erp!.verifyCommand).toBe("pnpm test");
    expect(next.projects.lain).toEqual({ targetBranch: "develop" });
  });
  it("tanpa project yang diurus lead → kalimat penjelas", () => {
    render(<LeadAuthorityPanel config={LEAD_DEFAULTS} busy={false} onSave={async () => true} projects={[]} />);
    expect(screen.getByText(/Serahkan project ke lead dulu/)).toBeTruthy();
  });
});
