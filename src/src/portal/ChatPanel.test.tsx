import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";

const getChatQuota = vi.fn();
const listChatSessions = vi.fn();
const getChatSession = vi.fn();
const startChatSession = vi.fn();
const sendChatMessage = vi.fn();

vi.mock("../api/portal", () => ({
  portalApi: {
    getChatQuota: (...a: unknown[]) => getChatQuota(...a),
    listChatSessions: (...a: unknown[]) => listChatSessions(...a),
    getChatSession: (...a: unknown[]) => getChatSession(...a),
    startChatSession: (...a: unknown[]) => startChatSession(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
  },
}));

const KOSONG = { items: [], total: 0, page: 1, pageSize: 20 };
const KUOTA = { enabled: true, brainstorm: { terpakai: 0, jatah: 2, sisa: 2 },
  tanya: { terpakai: 0, jatah: 30, sisa: 30 }, resetPada: "2026-09-01T00:00:00.000Z" };
const SESI = {
  id: "s1", type: "tanya" as const, summary: "", prdSiap: false,
  createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getChatQuota.mockResolvedValue(KUOTA);
  listChatSessions.mockResolvedValue(KOSONG);
  getChatSession.mockResolvedValue({ session: SESI, messages: KOSONG });
  startChatSession.mockResolvedValue(SESI);
  sendChatMessage.mockResolvedValue({
    id: "m2", seq: 2, role: "hanoman", text: "Sedang dikerjakan.",
    createdAt: "2026-08-19T00:00:01.000Z" });
});

describe("permukaan chat portal (SPEC-854)", () => {
  it("klien memilih tipe sesi saat memulai", async () => {
    render(<ChatPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Brainstorming")).toBeTruthy());
    expect(screen.getByText("Bertanya")).toBeTruthy();
  });

  // Bedanya dari Help desk harus terbaca klien, bukan disimpulkan sendiri (constraint brief).
  it("menjelaskan bedanya dengan Help desk", async () => {
    render(<ChatPanel projectId="p1" />);
    const b = await screen.findByTestId("chat-beda-help");
    expect(b.textContent).toMatch(/Help desk/i);
  });

  it("mengirim pesan menampilkan giliran klien lalu jawaban hanoman", async () => {
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByText("Bertanya"));
    const box = await screen.findByTestId("chat-input");
    fireEvent.change(box, { target: { value: "kapan selesai?" } });
    fireEvent.click(screen.getByTestId("chat-kirim"));
    await waitFor(() => expect(screen.getByText("Sedang dikerjakan.")).toBeTruthy());
    expect(screen.getByText("kapan selesai?")).toBeTruthy();
    expect(startChatSession).toHaveBeenCalledWith("p1", "tanya");
    expect(sendChatMessage).toHaveBeenCalledWith("p1", "s1", "kapan selesai?");
  });

  it("pesan kosong tak terkirim", async () => {
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByText("Bertanya"));
    await screen.findByTestId("chat-input");
    fireEvent.click(screen.getByTestId("chat-kirim"));
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it("sisa jatah & tanggal reset terbaca dengan bahasa biasa", async () => {
    getChatQuota.mockResolvedValue({ ...KUOTA,
      brainstorm: { terpakai: 1, jatah: 2, sisa: 1 } });
    render(<ChatPanel projectId="p1" />);
    const jatah = await screen.findByTestId("chat-jatah");
    expect(jatah.textContent).toMatch(/1 dari 2/);
    expect(jatah.textContent).toMatch(/1 September 2026/);
    expect(jatah.textContent).not.toMatch(/error|galat|kuota habis/i);
  });

  it("jatah habis: tombol tipe itu tak bisa dipakai, tetangganya tetap bisa", async () => {
    getChatQuota.mockResolvedValue({ ...KUOTA,
      brainstorm: { terpakai: 2, jatah: 2, sisa: 0 } });
    render(<ChatPanel projectId="p1" />);
    const b = await screen.findByText("Brainstorming");
    await waitFor(() =>
      expect((b.closest("button") as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByText("Bertanya").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });

  // Gagal jaringan tak boleh memuntahkan kode status / nama route ke klien (huruf E).
  it("gagal kirim dijawab satu kalimat awam", async () => {
    sendChatMessage.mockRejectedValue(new Error("POST /api/portal/... → 500"));
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByText("Bertanya"));
    fireEvent.change(await screen.findByTestId("chat-input"), { target: { value: "halo" } });
    fireEvent.click(screen.getByTestId("chat-kirim"));
    const galat = await screen.findByTestId("chat-galat");
    expect(galat.textContent).not.toMatch(/500|\/api\/|POST|Error/);
    expect(galat.textContent!.length).toBeGreaterThan(10);
  });
});
