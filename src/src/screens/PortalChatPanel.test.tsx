import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PortalChatPanel } from "./PortalChatPanel";

const listSessions = vi.fn();
const getSession = vi.fn();
const materializePrd = vi.fn();

vi.mock("../api/client", () => ({
  portalChatApi: {
    listSessions: (...a: unknown[]) => listSessions(...a),
    getSession: (...a: unknown[]) => getSession(...a),
    materializePrd: (...a: unknown[]) => materializePrd(...a),
  },
}));

const SESI = {
  id: "s1", projectId: "p1", type: "brainstorm", summary: "ide program loyalitas",
  periodKey: "2026-08", prdSiap: true, prdDocPath: null,
  prdReadyAt: "2026-08-19T10:00:00.000Z", clientEmail: "klien@x.co",
  createdAt: "2026-08-19T10:00:00.000Z", updatedAt: "2026-08-19T10:05:00.000Z",
};
const KUOTA = { enabled: true, brainstorm: { terpakai: 1, jatah: 2, sisa: 1 },
  tanya: { terpakai: 3, jatah: 30, sisa: 27 }, resetPada: "2026-09-01T00:00:00.000Z" };

const daftar = (items: unknown[] = [SESI]) =>
  ({ items, total: items.length, page: 1, pageSize: 20, kuota: KUOTA });

beforeEach(() => {
  vi.clearAllMocks();
  listSessions.mockResolvedValue(daftar());
  getSession.mockResolvedValue({
    ...SESI, prdMarkdown: "# Program loyalitas\n\nisi",
    messages: [
      { id: "m1", seq: 1, role: "klien", text: "mau bikin program loyalitas",
        rawText: null, blocked: false, blockReasons: null,
        createdAt: "2026-08-19T10:00:00.000Z" },
      { id: "m2", seq: 2, role: "hanoman", text: "Maaf, tidak bisa ditampilkan.",
        rawText: "Di Klinik Sehat sudah ada.", blocked: true, blockReasons: ["project-lain"],
        createdAt: "2026-08-19T10:01:00.000Z" },
    ],
  });
  materializePrd.mockResolvedValue({ path: "docs/prd/program-loyalitas.md" });
});

describe("panel chat portal di dashboard (SPEC-854 huruf B/C/D)", () => {
  it("asal draft terbaca: sesi mana, kapan, dari siapa", async () => {
    render(<PortalChatPanel projectId="p1" />);
    const row = await screen.findByTestId("portal-chat-row-s1");
    expect(row.textContent).toContain("klien@x.co");
    expect(row.textContent).toContain("19 Agu 2026");
    expect(row.textContent).toContain("ide program loyalitas");
    expect(row.textContent).toContain("PRD draft");
  });

  it("ringkasan bisa dibaca tanpa membuka percakapan", async () => {
    render(<PortalChatPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText("ide program loyalitas")).toBeTruthy());
    expect(screen.queryByTestId("portal-chat-transkrip")).toBeNull();
  });

  it("sisa jatah project terbaca operator", async () => {
    listSessions.mockResolvedValue(daftar([]));
    render(<PortalChatPanel projectId="p1" />);
    const j = await screen.findByTestId("portal-chat-kuota");
    expect(j.textContent).toMatch(/1\s*\/\s*2/);
    expect(j.textContent).toMatch(/3\s*\/\s*30/);
  });

  // Giliran yang diblokir gerbang adalah baris yang paling perlu dilihat operator.
  it("membuka sesi menampilkan transkrip, PRD draft, dan baris yang diblokir", async () => {
    render(<PortalChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByTestId("portal-chat-row-s1"));
    const t = await screen.findByTestId("portal-chat-transkrip");
    expect(t.textContent).toContain("mau bikin program loyalitas");
    expect(t.textContent).toContain("project-lain");
    expect(t.textContent).toContain("Di Klinik Sehat sudah ada.");
    expect(screen.getByTestId("portal-chat-prd").textContent).toContain("Program loyalitas");
  });

  it("materialisasi PRD memakai slug yang diketik operator", async () => {
    render(<PortalChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByTestId("portal-chat-row-s1"));
    const slug = await screen.findByTestId("portal-chat-slug");
    fireEvent.change(slug, { target: { value: "program-loyalitas" } });
    fireEvent.click(screen.getByTestId("portal-chat-jadikan-prd"));
    await waitFor(() => expect(materializePrd).toHaveBeenCalledWith("s1", "program-loyalitas"));
  });
});
