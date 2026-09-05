import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { WorktreesPanel } from "../src/screens/WorktreesPanel";
import { api, type WorktreeReport } from "../src/api/client";

const report = (): WorktreeReport => ({
  repoDir: "/repo",
  worktrees: [
    { path: "/repo", name: "repo", head: "aaa1111", branch: "main", prunable: false, locked: false,
      deletable: false, blocked: "checkout project", spec: null, session: null, createdAt: "2026-07-01T10:00:00Z" },
    { path: "/repo/.worktrees/spec-1", name: "spec-1", head: "bbb2222", branch: null, prunable: false,
      locked: false, deletable: true, blocked: null, spec: { id: "SPEC-1", stage: "executing" },
      session: { id: "spec-1", specId: "SPEC-1" }, createdAt: "2026-08-01T10:00:00Z" },
    { path: "/repo/.worktrees/wt-b", name: "wt-b", head: "ccc3333", branch: "topik", prunable: false,
      locked: false, deletable: true, blocked: null, spec: null, session: null, createdAt: "2026-08-02T10:00:00Z" },
  ],
});
// `Checkbox` design system BUKAN <input type=checkbox>: ia <label> (pembawa data-testid) yang
// membungkus <span> kotak — dan onClick hidup di span itu, bukan di label. Mengklik label = no-op,
// jadi test yang mengklik label bisa "lulus" karena tak terjadi apa-apa (pelajaran SPEC-299).
const pick = (id: string) => fireEvent.click(screen.getByTestId(id).firstElementChild!);
const confirm = async () => {
  const button = await screen.findByRole("button", { name: /ya, hapus/i });
  await act(async () => { fireEvent.click(button); });
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "worktrees").mockResolvedValue(report());
  vi.spyOn(api, "worktreeStats").mockImplementation(async (_id, name) =>
    ({ name, sizeBytes: 4 * 1024 * 1024, dirtyFiles: 2, orphanCommits: 3 }));
});

describe("WorktreesPanel", () => {
  it("pemungutan yatim meminta konfirmasi dan tidak menghapus branch", async () => {
    const r = report();
    r.worktrees[2]!.orphan = { historyId: "h1", sessionId: "old" };
    vi.mocked(api.worktrees).mockResolvedValue(r);
    const del = vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc" }],
    });
    render(<WorktreesPanel projectId="p1" />);
    expect(await screen.findByText("sesi yatim")).toBeInTheDocument();
    pick("with-branch");
    fireEvent.click(screen.getByRole("button", { name: /Pungut yatim/ }));
    expect(await screen.findByText(/termasuk berkas ignored/)).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /batal/i }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Pungut yatim/ }));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["wt-b"], orphanOnly: true }));
  });

  it.each(["request", "git"])("stats gagal %s tidak diklaim aman dalam dialog", async (failure) => {
    if (failure === "request") vi.mocked(api.worktreeStats).mockRejectedValue(new Error("offline"));
    else vi.mocked(api.worktreeStats).mockResolvedValue({ name: "wt-b", sizeBytes: null, dirtyFiles: null, orphanCommits: null });
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("wt-b");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    expect(await screen.findByText(/dampak.*belum diketahui/i)).toBeInTheDocument();
    expect(screen.queryByText(/tak ada kerja yang belum tersimpan/)).not.toBeInTheDocument();
  });

  it("menampilkan tiap worktree hidup + backlog & stage-nya", async () => {
    render(<WorktreesPanel projectId="p1" />);
    expect(await screen.findByText("spec-1")).toBeInTheDocument();
    expect(screen.getByText(/SPEC-1/)).toBeInTheDocument();
    expect(screen.getByText(/executing/)).toBeInTheDocument();
  });

  // ADR-0002 · sesi hanoman selalu detached: kolomnya harus sanggup menampilkan SHA.
  it("HEAD detached tampil sebagai SHA, bukan nama branch", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("spec-1");
    expect(screen.getByText(/bbb2222/)).toBeInTheDocument();
    expect(screen.getByText("topik")).toBeInTheDocument();
  });

  it("checkout project tampil tapi tak bisa dipilih", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("repo");
    expect(screen.getByText(/checkout project/i)).toBeInTheDocument();
    pick("pick-repo");
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
  });

  it("ukuran & isi kotor dimuat menyusul per baris", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("spec-1");
    await waitFor(() => expect(api.worktreeStats).toHaveBeenCalledWith("p1", "spec-1"));
    await waitFor(() => expect(screen.getAllByText(/4\.0 MB/)).toHaveLength(3));
  });

  it("dialog konfirmasi menyebut apa yang akan hilang", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("spec-1");
    fireEvent.click(screen.getByTestId("row-delete-spec-1"));
    expect(await screen.findByText(/1 sesi aktif akan ditutup/i)).toBeInTheDocument();
    expect(screen.getByText(/3 commit/i)).toBeInTheDocument();
    expect(screen.getByText(/2 berkas belum tersimpan/i)).toBeInTheDocument();
  });

  it("hapus memanggil api dengan nama baris dan flag branch", async () => {
    const del = vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc" }] });
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("wt-b");
    pick("with-branch");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["wt-b"], deleteBranch: true }));
  });

  // Pagar ADR-0077 tetap berdiri untuk branch; worktree-nya tetap terhapus. Keduanya harus terbaca.
  it("kegagalan hapus branch dilaporkan tanpa menyembunyikan keberhasilan worktree", async () => {
    vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc",
        branch: { name: "topik", ok: false, error: "terkunci: backlog-nya belum selesai" } }] });
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("wt-b");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    await confirm();
    expect(await screen.findByText(/backlog-nya belum selesai/)).toBeInTheDocument();
  });

  it("nama branch membawa ke tab Branches", async () => {
    const onOpenBranch = vi.fn();
    render(<WorktreesPanel projectId="p1" onOpenBranch={onOpenBranch} />);
    fireEvent.click(await screen.findByTestId("goto-branch-wt-b"));
    expect(onOpenBranch).toHaveBeenCalledWith("topik");
  });
});
