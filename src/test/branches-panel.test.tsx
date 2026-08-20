import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BranchesPanel } from "../src/screens/BranchesPanel";
import { api, type UnusedBranch, type UnusedReport } from "../src/api/client";

const br = (over: Partial<UnusedBranch> & { name: string }): UnusedBranch => ({
  local: true, remote: true, merged: true, mergedLocal: true, mergedRemote: true,
  lastCommit: { sha: "aaa1111", at: "2026-07-20T10:00:00Z", subject: "kerja" }, locks: [], ...over,
});
const report = (over: Partial<UnusedReport> = {}): UnusedReport => ({
  base: "main", baseRemote: "origin/main", current: "main",
  branches: [
    br({ name: "main", locks: ["current", "base"] }),
    br({ name: "hanoman/spec-1" }),
    br({ name: "hanoman/spec-2", remote: false, mergedRemote: false }),
    br({ name: "hanoman/spec-3", lastCommit: null, locks: ["session"] }),
    // SPEC-859 · branch aktif yang belum ter-merge — dulu tak pernah sampai ke panel.
    br({ name: "fitur/aktif", merged: false, mergedLocal: false, mergedRemote: false }),
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
    // spec-1, spec-2 & fitur/aktif — bukan main (base+current) maupun spec-3 (session)
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("3");
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
    // Saring ke ter-merge dulu: batch campuran memakai dialog risiko (SPEC-859), bukan dialog ini.
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
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
    await waitFor(() => expect(api.branchesUnused).toHaveBeenCalledWith("p1", "dev", "all"));
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

  it("project tanpa branch → state kosong", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({ branches: [] }));
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText(/tak ada branch/i)).toBeInTheDocument();
  });

  // SPEC-859 · panel melebar ke SELURUH branch; filter & pilihan hidup di klien.
  it("meminta include=all dan menampilkan branch belum ter-merge", async () => {
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText("fitur/aktif")).toBeInTheDocument();
    expect(api.branchesUnused).toHaveBeenCalledWith("p1", undefined, "all");
  });

  it("filter status ter-merge menyembunyikan yang belum", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
    expect(screen.queryByText("fitur/aktif")).toBeNull();
    expect(screen.getByText("hanoman/spec-1")).toBeInTheDocument();
  });

  it("filter status belum ter-merge menyisakan yang belum saja", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "unmerged" } });
    expect(screen.getByText("fitur/aktif")).toBeInTheDocument();
    expect(screen.queryByText("hanoman/spec-1")).toBeNull();
  });

  it("cari menyaring berdasarkan nama", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("cari"), { target: { value: "spec-2" } });
    expect(screen.getByText("hanoman/spec-2")).toBeInTheDocument();
    expect(screen.queryByText("hanoman/spec-1")).toBeNull();
  });

  it("pilih semua hanya mencakup yang tampak setelah filter", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "unmerged" } });
    pick("pick-all");
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("1");
  });

  it("hapus branch belum ter-merge menuntut konfirmasi risiko lalu mengirim allowUnmerged", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main", results: [{ name: "fitur/aktif", ok: true, scope: "both", forced: true }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.click(screen.getByTestId("row-delete-fitur/aktif"));
    expect(await screen.findByText(/commit yang hanya ada di branch itu akan hilang/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ya, hapus/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/ketik fitur\/aktif untuk konfirmasi/i),
      { target: { value: "fitur/aktif" } });
    fireEvent.click(screen.getByRole("button", { name: /ya, hapus/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1",
      { names: ["fitur/aktif"], scope: "both", allowUnmerged: true }));
  });

  it("batch semua-ter-merge TIDAK mengirim allowUnmerged", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
    pick("pick-all");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del.mock.calls[0]![1]).toEqual(
      { names: ["hanoman/spec-1", "hanoman/spec-2"], scope: "both" }));
  });

  it("batch campuran menuntut ketikan `hapus paksa`", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    pick("pick-all");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    expect(await screen.findByText(/1 branch belum ter-merge/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/ketik hapus paksa untuk konfirmasi/i),
      { target: { value: "hapus paksa" } });
    fireEvent.click(screen.getByRole("button", { name: /ya, hapus/i }));
    await waitFor(() => expect(del.mock.calls[0]![1]).toMatchObject({ allowUnmerged: true }));
  });

  it("daftar tersaring kosong dibedakan dari project tanpa branch", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("cari"), { target: { value: "zzz" } });
    expect(screen.getByText(/tak ada branch cocok filter/i)).toBeInTheDocument();
  });
});
