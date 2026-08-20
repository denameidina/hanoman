import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BranchesPanel } from "../src/screens/BranchesPanel";
import { api, type UnusedReport } from "../src/api/client";

const report = (over: Partial<UnusedReport> = {}): UnusedReport => ({
  base: "main", baseRemote: "origin/main", current: "main",
  branches: [
    { name: "main", local: true, remote: true, lastCommit: { sha: "aaa1111", at: "2026-07-20T10:00:00Z", subject: "init" }, locks: ["current", "base"] },
    { name: "hanoman/spec-1", local: true, remote: true, lastCommit: { sha: "bbb2222", at: "2026-07-21T10:00:00Z", subject: "feat: satu" }, locks: [] },
    { name: "hanoman/spec-2", local: true, remote: false, lastCommit: { sha: "ccc3333", at: "2026-07-22T10:00:00Z", subject: "feat: dua" }, locks: [] },
    { name: "hanoman/spec-3", local: true, remote: true, lastCommit: null, locks: ["session"] },
  ],
  ...over,
});
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: /ya, hapus/i }));
// `Checkbox` design system BUKAN <input type=checkbox>: ia <label> (pembawa data-testid) yang
// membungkus <span> kotak — dan onClick hidup di span itu, bukan di label. Mengklik label = no-op,
// jadi test yang mengklik label bisa "lulus" karena tak terjadi apa-apa (pelajaran SPEC-299).
const pick = (id: string) => fireEvent.click(screen.getByTestId(id).firstElementChild!);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "branchesUnused").mockResolvedValue(report());
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "dev"], remotes: ["main"] });
});

describe("BranchesPanel", () => {
  it("menampilkan tiap branch ter-merge", async () => {
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText("hanoman/spec-1")).toBeInTheDocument();
    expect(screen.getByText("hanoman/spec-2")).toBeInTheDocument();
  });

  it("baris terkunci menampilkan alasannya & tak bisa dipilih", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-3");
    expect(screen.getByText(/sesi aktif/i)).toBeInTheDocument();
    pick("pick-hanoman/spec-3");
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
  });

  it("pilih semua hanya mencentang yang boleh dihapus", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    pick("pick-all");
    // spec-1 & spec-2 saja — bukan main (base+current) maupun spec-3 (session)
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("2");
  });

  // SPEC-861 · kebuntuan 'branch tak bisa dihapus karena worktree, worktree tak terlihat di mana
  // pun' — badge kuncinya harus jadi jalan keluar, bukan sekadar label.
  it("badge kunci worktree menautkan ke barisnya di tab Worktrees", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({
      branches: [{ name: "hanoman/spec-4", local: true, remote: false, lastCommit: null,
        locks: ["worktree"], worktree: "/repo/.worktrees/wt-b" }],
    }));
    const onOpenWorktree = vi.fn();
    render(<BranchesPanel projectId="p1" onOpenWorktree={onOpenWorktree} />);
    fireEvent.click(await screen.findByTestId("goto-worktree-hanoman/spec-4"));
    expect(onOpenWorktree).toHaveBeenCalledWith("/repo/.worktrees/wt-b");
  });

  it("tombol hapus per baris memanggil api dengan satu nama", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main", results: [{ name: "hanoman/spec-1", ok: true, scope: "both" }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("row-delete-hanoman/spec-1"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["hanoman/spec-1"], scope: "both" }));
  });

  it("bulk mengirim semua nama terpilih dalam SATU panggilan", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main",
      results: [{ name: "hanoman/spec-1", ok: true, scope: "both" }, { name: "hanoman/spec-2", ok: true, scope: "local" }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    pick("pick-all");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0]![1]).toEqual({ names: ["hanoman/spec-1", "hanoman/spec-2"], scope: "both" });
  });

  it("scope diteruskan ke api", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.change(screen.getByTestId("scope"), { target: { value: "local" } });
    pick("pick-hanoman/spec-1");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del.mock.calls[0]![1]).toMatchObject({ scope: "local" }));
  });

  it("ganti base memuat ulang laporan", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.change(screen.getByTestId("base"), { target: { value: "dev" } });
    await waitFor(() => expect(api.branchesUnused).toHaveBeenCalledWith("p1", "dev"));
  });

  it("hasil gagal ditampilkan apa adanya", async () => {
    vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main",
      results: [{ name: "hanoman/spec-1", ok: false, scope: "none", error: "terkunci: sesi aktif memakainya" }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("row-delete-hanoman/spec-1"));
    await confirm();
    expect(await screen.findByText(/terkunci: sesi aktif memakainya/)).toBeInTheDocument();
  });

  it("tanpa branch ter-merge → state kosong", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({ branches: [] }));
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText(/tak ada branch ter-merge/i)).toBeInTheDocument();
  });
});
