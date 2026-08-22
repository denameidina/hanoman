import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { SessionAsk } from "@hanoman/shared";
import { PetAnswer } from "../src/screens/PetAnswer";
import { api, ApiError } from "../src/api/client";

// SPEC-909 · ADR-0146 · pet menampilkan pertanyaan ASLI dari payload hook, tanpa bergantung scrape.
// `sessionDialog` sengaja dibuat MENYERAH di seluruh berkas ini: itu justru kasus yang dulu
// melahirkan "Pertanyaannya tak terbaca dari sini", dan payload event harus menang di sana.

const ASK: SessionAsk = {
  sessionId: "s1", agent: "claude", source: "ask-tool", askId: "t1",
  askedAt: "2026-08-23T00:00:00.000Z",
  questions: [
    { header: "Basis", question: "Basis data mana yang dipakai?", multiSelect: false,
      options: [{ label: "SQLite", description: "ringan" }, { label: "Postgres" }] },
    { header: "Auth", question: "Auth mana?", multiSelect: true, options: [{ label: "Cookie" }] },
  ],
  message: "", at: 0, total: 2, state: "deciding", flowId: "f1", step: 1,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "sessionDialog").mockResolvedValue(null);
});

describe("PetAnswer dengan payload event", () => {
  it("menampilkan pertanyaan ASLI tanpa bergantung scrape", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    expect(await screen.findByText("Basis data mana yang dipakai?")).toBeTruthy();
    expect(screen.queryByText(/tak terbaca dari sini/)).toBeNull();
  });

  it("menampilkan rantai sebagai langkah berurutan", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    expect(await screen.findByText(/Pertanyaan 1 dari 2/)).toBeTruthy();
  });

  it("menyebut status lead: sedang menyusun", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    expect((await screen.findByTestId("pet-answer-lead-state")).textContent).toMatch(/menyusun/i);
  });

  it("menyebut status lead: mengantre", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={{ ...ASK, state: "queued" }} />);
    expect((await screen.findByTestId("pet-answer-lead-state")).textContent).toMatch(/antre/i);
  });

  it("menyebut status lead: sudah menjawab", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={{ ...ASK, state: "answered" }} />);
    expect((await screen.findByTestId("pet-answer-lead-state")).textContent).toMatch(/sudah menjawab/i);
  });

  it("sesi codex: pesan giliran dengan label jujur, bukan pertanyaan berpilihan", async () => {
    const codex: SessionAsk = {
      ...ASK, agent: "codex", source: "turn-end", questions: [],
      message: "Mau SQLite atau Postgres?", total: 1,
    };
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={codex} />);
    expect(await screen.findByText("Mau SQLite atau Postgres?")).toBeTruthy();
    expect((await screen.findByTestId("pet-answer-source")).textContent).toMatch(/giliran terakhir/i);
  });

  it("tanpa payload, jatuh ke perilaku hari ini (server lebih tua, ADR-0087)", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced />);
    expect(await screen.findByText(/tak terbaca dari sini/)).toBeTruthy();
  });

  it("Ambil alih memanggil endpoint dan mengaku sudah merebutnya", async () => {
    const spy = vi.spyOn(api, "takeoverSessionDialog").mockResolvedValue({ accepted: true });
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    fireEvent.click(await screen.findByTestId("pet-answer-takeover"));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("s1"));
    expect((await screen.findByTestId("pet-answer-note")).textContent).toMatch(/mengambil alih/i);
  });

  it("Ambil alih yang KALAH memberi penolakan yang jelas, bukan diam", async () => {
    vi.spyOn(api, "takeoverSessionDialog")
      .mockRejectedValue(new ApiError(409, "konflik", { reason: "answering" }));
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    fireEvent.click(await screen.findByTestId("pet-answer-takeover"));
    expect((await screen.findByTestId("pet-answer-note")).textContent)
      .toMatch(/sudah mengirim jawabannya/i);
  });

  it("sesudah diambil alih, tombolnya hilang — tak ada yang tersisa untuk direbut", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={{ ...ASK, state: "taken-over" }} />);
    await screen.findByTestId("pet-answer-lead-state");
    expect(screen.queryByTestId("pet-answer-takeover")).toBeNull();
  });
});
