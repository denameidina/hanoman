import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    listGithubIssues: vi.fn(),
    pullGithubIssues: vi.fn(),
    acceptGithubIssues: vi.fn(),
    acceptGithubIssue: vi.fn(),
    rejectGithubIssue: vi.fn(),
    listTickets: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { TriageScreen } from "../src/screens/TriageScreen";
import { api } from "../src/api/client";

const issue = (over: Record<string, unknown> = {}) => ({
  id: "p:o/r#9", projectId: "p", repoSlug: "o/r", number: 9,
  title: "History purge menghapus transkrip", body: "isi", authorLogin: "wulanrlestari",
  labels: [] as string[], url: "https://github.com/o/r/issues/9", issueState: "open",
  status: "new", specId: null, pulledAt: "2026-08-01T00:00:00Z",
  issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z", ...over,
});

type Mock = ReturnType<typeof vi.fn>;
const m = api as unknown as {
  listGithubIssues: Mock; pullGithubIssues: Mock; acceptGithubIssues: Mock; acceptGithubIssue: Mock;
  rejectGithubIssue: Mock; listTickets: Mock;
};

const projects = [{ id: "p", name: "P" }] as never;

// Project dipilih lewat state tersimpan — jalur yang sama dengan pilihan operator sebelumnya.
const renderWithProject = (onAccepted = vi.fn()) => {
  localStorage.setItem("hn.ui.v1.triage.project", JSON.stringify("p"));
  return render(<TriageScreen projects={projects} onAccepted={onAccepted} onToast={() => {}} />);
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  m.listGithubIssues.mockResolvedValue({ items: [issue()], total: 1, page: 1, pageSize: 20 });
  m.pullGithubIssues.mockResolvedValue({
    repo: "o/r", pulled: 1, created: 1, updated: 0, via: "gh", skippedPullRequests: 3 });
  m.acceptGithubIssues.mockResolvedValue({ created: [{ id: "SPEC-472" }], failed: [] });
  m.acceptGithubIssue.mockResolvedValue({ spec: { id: "SPEC-473", projectId: "p" } });
  m.rejectGithubIssue.mockResolvedValue({ id: "p:o/r#9", status: "rejected" });
  m.listTickets.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 });
});

// Audit UI/UX 2026-10 · Fase 3F: issue GitHub masuk SATU daftar bersama tiket (bukan tab terpisah).
describe("SPEC-471 · issue GitHub dalam kotak masuk triase", () => {
  it("tanpa project, issue tak dimuat — daftar hanya tiket", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    await waitFor(() => expect(m.listTickets).toHaveBeenCalled());
    expect(m.listGithubIssues).not.toHaveBeenCalled();
  });

  it("dengan project, issue muncul di daftar gabungan dengan sumber GitHub", async () => {
    renderWithProject();
    expect(await screen.findByText(/History purge menghapus transkrip/)).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText(/#9 ·/)).toBeTruthy();
  });

  it("tombol Tarik issue memanggil endpoint & melaporkan PR yang dibuang", async () => {
    renderWithProject();
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: /tarik issue/i }));
    await waitFor(() => expect(m.pullGithubIssues).toHaveBeenCalledWith("p"));
    expect(await screen.findByText(/3 pull request dilewati/i)).toBeTruthy();
  });

  it("terima terpilih mengirim daftar id issue", async () => {
    renderWithProject();
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("checkbox", { name: /pilih issue 9/i }));
    fireEvent.click(screen.getByRole("button", { name: /terima terpilih/i }));
    await waitFor(() => expect(m.acceptGithubIssues).toHaveBeenCalledWith(["p:o/r#9"], undefined));
  });

  // Sebab kegagalan HARUS terbaca — daftar kosong tanpa penjelasan adalah gejala yang
  // membuat SPEC-471 tak terlihat selama 36 jam.
  it("gagal tarik menampilkan SEBABNYA, bukan daftar kosong senyap", async () => {
    m.pullGithubIssues.mockRejectedValueOnce(Object.assign(new Error("400"),
      { detail: { error: 'remote project ber-host "gitlab.com", bukan GitHub' } }));
    renderWithProject();
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: /tarik issue/i }));
    expect(await screen.findByText(/gitlab\.com/)).toBeTruthy();
  });

  it("issue yang sudah diterima menampilkan tautan Spec-nya, tanpa checkbox pilih", async () => {
    m.listGithubIssues.mockResolvedValue({ items: [issue({ status: "accepted", specId: "SPEC-472" })], total: 1, page: 1, pageSize: 20 });
    renderWithProject();
    expect(await screen.findByText(/SPEC-472/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /pilih issue 9/i })).toBeNull();
  });

  // Tolak issue = keputusan yang menutup issue di hanoman: lewat dialog. Tak ada "Urungkan" — tak ada jalur balik.
  it("tolak issue meminta konfirmasi; Batal tak menolak, konfirmasi memanggil API", async () => {
    renderWithProject();
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: "Tolak issue 9" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Issue di GitHub tidak diubah.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(m.rejectGithubIssue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tolak issue 9" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Tolak issue" }));
    await waitFor(() => expect(m.rejectGithubIssue).toHaveBeenCalledWith("p:o/r#9"));
    expect(screen.queryByRole("button", { name: "Urungkan" })).toBeNull();
  });

  it("setelah project dipilih lewat penyaring, daftar issue memuat halaman pertamanya", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    fireEvent.change(screen.getByLabelText("Project triase"), { target: { value: "p" } });
    expect(await screen.findByText(/History purge/)).toBeTruthy();
    // SPEC-523 · panggilan membawa halaman; status ikut (segmen "Belum ditinjau").
    await waitFor(() => expect(m.listGithubIssues).toHaveBeenCalledWith("p", expect.objectContaining({ page: 1, limit: 20 })));
  });

  it("detail issue: Terima → backlog memanggil acceptGithubIssue lalu onAccepted", async () => {
    const onAccepted = vi.fn();
    renderWithProject(onAccepted);
    fireEvent.click(await screen.findByText(/History purge/));
    fireEvent.click(await screen.findByRole("button", { name: "Terima → backlog" }));
    await waitFor(() => expect(m.acceptGithubIssue).toHaveBeenCalledWith("p:o/r#9"));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ id: "SPEC-473" }), false));
  });
});
