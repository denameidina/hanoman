import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listSessionHistory = vi.fn();
const sessionTranscript = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
    sessionTranscript: (...a: unknown[]) => sessionTranscript(...a),
  },
  ApiError: class extends Error {},
}));
import { SessionHistoryModal } from "../src/screens/SessionHistoryModal";

const row = (over: Record<string, unknown> = {}) => ({
  id: "h1", sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", title: "History session terminal",
  kind: "spec", flow: "feature", agent: "claude", model: "claude-opus-5", effort: "xhigh",
  branch: null, cwd: "/r/.worktrees/spec-362", startedAt: "2026-07-28T01:00:00.000Z",
  endedAt: "2026-07-28T02:00:00.000Z", endedReason: "closed", reconciledAt: null,
  exitCode: 0, transcriptBytes: 42, ...over,
});

beforeEach(() => {
  listSessionHistory.mockReset(); sessionTranscript.mockReset();
});

const projects = [{ id: "p1", name: "hanoman" }];

describe("SessionHistoryModal (SPEC-362)", () => {
  it("merender baris riwayat dengan label kind manusia, bukan slug", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("History session terminal")).toBeTruthy();
    // "Backlog" juga muncul sebagai <option> di filter jenis — yang diuji adalah BADGE di barisnya.
    expect(screen.getAllByText("Backlog").some((el) => el.tagName !== "OPTION")).toBe(true);
    expect(screen.queryByText("spec")).toBeNull();        // slug mentah tak pernah dirender
  });

  it("sesi yang belum ditutup terbaca 'berjalan'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: null, exitCode: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("berjalan")).toBeTruthy();
  });

  it("exit bukan nol terbaca sebagai kodenya, bukan 'selesai'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ exitCode: 2 })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("exit 2")).toBeTruthy();
  });

  // SPEC-844 · sebelum ini baris rekonsiliasi tampil hijau "selesai · 0 dtk".
  it("baris hasil rekonsiliasi boot terbaca 'terputus', bukan 'selesai'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: "2026-07-28T01:00:00.000Z", endedReason: "reconciled",
        reconciledAt: "2026-07-29T03:00:00.000Z", exitCode: null, transcriptBytes: null })],
      total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("terputus")).toBeTruthy();
    expect(screen.queryByText("selesai")).toBeNull();
  });

  it("baris terputus tak mengarang durasi", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: "2026-07-28T01:00:00.000Z", endedReason: "reconciled",
        reconciledAt: "2026-07-29T03:00:00.000Z", exitCode: null })],
      total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    await screen.findByText("terputus");
    expect(screen.queryByText("0 dtk")).toBeNull();
  });

  // SPEC-523 · muat-lebih (append) DICABUT: halaman MENGGANTI isi, sama seperti backlog/project/
  // tiket. Test lama mengunci perilaku append sebagai kontrak — pola SPEC-433.
  it("halaman berikutnya MENGGANTI isi, bukan menambahnya", async () => {
    listSessionHistory
      // `total` harus melampaui satu halaman (PAGE = 20) supaya halaman kedua benar-benar ada:
      // pager menurunkan jumlah halaman dari ukuran halaman yang DIMINTA, bukan dari panjang items.
      .mockResolvedValueOnce({ items: [row({ id: "h1", title: "Pertama" })], total: 25, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [row({ id: "h2", title: "Kedua" })], total: 25, page: 2, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("Pertama")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("Kedua")).toBeTruthy());
    expect(screen.queryByText("Pertama")).toBeNull();   // yang lama diganti
  });

  it("kontrol halaman menyatakan rentang & total, tanpa tombol muat lebih", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("1–1 dari 1 sesi")).toBeTruthy();
    expect(screen.queryByText("Muat lebih")).toBeNull();
  });

  it("filter project memanggil ulang API dengan projectId", async () => {
    listSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    await waitFor(() => expect(listSessionHistory).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filter project"), { target: { value: "p1" } });
    await waitFor(() =>
      expect(listSessionHistory.mock.calls.at(-1)?.[0]).toMatchObject({ projectId: "p1", page: 1 }));
  });

  it("riwayat kosong menampilkan StateBlock, bukan daftar kosong tanpa penjelasan", async () => {
    listSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("Belum ada riwayat sesi")).toBeTruthy();
  });
});

describe("SessionHistoryModal — detail (SPEC-362)", () => {
  it("klik baris memuat transkrip dan menampilkannya", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    sessionTranscript.mockResolvedValue({ text: "PENANDA-TRANSKRIP", bytes: 17 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText(/PENANDA-TRANSKRIP/)).toBeTruthy();
  });

  it("baris tanpa transkrip tak memanggil endpoint transkrip", async () => {
    listSessionHistory.mockResolvedValue({ items: [row({ transcriptBytes: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText(/Tanpa transkrip/)).toBeTruthy();
    expect(sessionTranscript).not.toHaveBeenCalled();
  });

  it("'Mulai lagi' memanggil onRestart dengan barisnya (kind restartable)", async () => {
    const onRestart = vi.fn();
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    sessionTranscript.mockResolvedValue({ text: "x", bytes: 1 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={onRestart} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    expect(onRestart).toHaveBeenCalledWith(expect.objectContaining({ id: "h1" }));
  });

  // SPEC-844 · AC "Session detail explains that exit code and final transcript may be incomplete"
  it("detail baris terputus menjelaskan hasil tak diketahui & tetap menawarkan 'Mulai lagi'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: "2026-07-28T01:00:00.000Z", endedReason: "reconciled",
        reconciledAt: "2026-07-29T03:00:00.000Z", exitCode: null, transcriptBytes: null })],
      total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText("Sesi terputus — hasilnya tak diketahui")).toBeTruthy();
    expect(screen.getByText("Terakhir terlihat hidup")).toBeTruthy();
    expect(screen.getByText("Terdeteksi mati")).toBeTruthy();
    expect(screen.getByText("Mulai lagi")).toBeTruthy();
    expect(screen.queryByText(/ditutup sebelum fitur riwayat ada/)).toBeNull();
  });

  it("kind tak restartable tak menawarkan 'Mulai lagi'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "prd", title: "PRD sesuatu", transcriptBytes: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("PRD sesuatu"));
    expect(await screen.findByText(/Tanpa transkrip/)).toBeTruthy();
    expect(screen.queryByText("Mulai lagi")).toBeNull();
  });
});
