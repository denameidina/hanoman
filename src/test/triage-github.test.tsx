import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    listGithubIssues: vi.fn(),
    pullGithubIssues: vi.fn(),
    acceptGithubIssues: vi.fn(),
    rejectGithubIssue: vi.fn(),
    listTickets: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { GithubIssuesPanel, TriageScreen } from "../src/screens/TriageScreen";
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
  listGithubIssues: Mock; pullGithubIssues: Mock;
  acceptGithubIssues: Mock; rejectGithubIssue: Mock; listTickets: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.listGithubIssues.mockResolvedValue({ items: [issue()], total: 1, page: 1, pageSize: 20 });
  m.pullGithubIssues.mockResolvedValue({
    repo: "o/r", pulled: 1, created: 1, updated: 0, via: "gh", skippedPullRequests: 3 });
  m.acceptGithubIssues.mockResolvedValue({ created: [{ id: "SPEC-472" }], failed: [] });
  m.rejectGithubIssue.mockResolvedValue({ id: "p:o/r#9", status: "rejected" });
  m.listTickets.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 });
});

describe("SPEC-471 · panel issue GitHub", () => {
  it("memuat & menampilkan issue", async () => {
    render(<GithubIssuesPanel projectId="p" />);
    expect(await screen.findByText(/History purge menghapus transkrip/)).toBeTruthy();
    expect(screen.getByText("#9")).toBeTruthy();
  });

  it("tombol Tarik issue memanggil endpoint & melaporkan PR yang dibuang", async () => {
    render(<GithubIssuesPanel projectId="p" />);
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: /tarik issue/i }));
    await waitFor(() => expect(m.pullGithubIssues).toHaveBeenCalledWith("p"));
    expect(await screen.findByText(/3 pull request dilewati/i)).toBeTruthy();
  });

  it("terima terpilih mengirim daftar id", async () => {
    render(<GithubIssuesPanel projectId="p" />);
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
    render(<GithubIssuesPanel projectId="p" />);
    await screen.findByText(/History purge/);
    fireEvent.click(screen.getByRole("button", { name: /tarik issue/i }));
    expect(await screen.findByText(/gitlab\.com/)).toBeTruthy();
  });

  it("issue yang sudah diterima menampilkan tautan Spec-nya, tanpa checkbox pilih", async () => {
    m.listGithubIssues.mockResolvedValue({ items: [issue({ status: "accepted", specId: "SPEC-472" })], total: 1, page: 1, pageSize: 20 });
    render(<GithubIssuesPanel projectId="p" />);
    expect(await screen.findByText("SPEC-472")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /pilih issue 9/i })).toBeNull();
  });
});

// Panel yang hijau tapi tak pernah dirender = fitur yang tak ada bagi operator. Kanal ini
// justru tak terlihat 36 jam karena tak punya permukaan; kontrak "ada tab-nya" ikut diuji.
describe("SPEC-471 · tab Issue GitHub terpasang di layar Triase", () => {
  const projects = [{ id: "p", name: "P" }] as never;

  it("tab issue ada dan menuntut satu project dipilih", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /issue github/i }));
    expect(await screen.findByText(/pilih satu project/i)).toBeTruthy();
    expect(m.listGithubIssues).not.toHaveBeenCalled();
  });

  it("setelah project dipilih, panel issue memuat daftarnya", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /issue github/i }));
    fireEvent.change(screen.getByDisplayValue("Semua project"), { target: { value: "p" } });
    expect(await screen.findByText(/History purge/)).toBeTruthy();
    // SPEC-523 · panggilannya kini membawa halaman (page/limit), bukan projectId telanjang.
    await waitFor(() => expect(m.listGithubIssues).toHaveBeenCalledWith("p", { page: 1, limit: 20 }));
  });
});
