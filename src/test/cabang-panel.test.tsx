// Audit UI/UX 2026-10 (3H) · tab Cabang: branch dan worktree dalam SATU daftar (menggantikan
// BranchesPanel + WorktreesPanel). Asersi di sini mewarisi kedua suite lama; yang berubah: navigasi
// lintas-panel ("badge → baris Worktrees") kini jadi fokus di daftar yang sama, dan base/cakupan/
// "branch ikut" pindah ke disclosure "Opsi".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CabangPanel } from "../src/screens/CabangPanel";
import { api, type UnusedBranch, type UnusedReport, type WorktreeReport } from "../src/api/client";

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
const emptyWorktrees = (): WorktreeReport => ({ repoDir: "/repo", worktrees: [] });
const worktreeReport = (): WorktreeReport => ({
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
// membungkus <span> kotak — dan onClick hidup di span itu, bukan di label (pelajaran SPEC-299).
const pick = (id: string) => fireEvent.click(screen.getByTestId(id).firstElementChild!);
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: /ya, hapus/i }));
const openOpsi = () => fireEvent.click(screen.getByRole("button", { name: "Opsi" }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "branchesUnused").mockResolvedValue(report());
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "dev"], remotes: ["main"] });
  vi.spyOn(api, "worktrees").mockResolvedValue(emptyWorktrees());
  vi.spyOn(api, "worktreeStats").mockResolvedValue({ name: "x", sizeBytes: 0, dirtyFiles: 0, orphanCommits: 0 });
});

describe("CabangPanel · branch", () => {
  it("menampilkan tiap branch ter-merge", async () => {
    render(<CabangPanel projectId="p1" />);
    expect(await screen.findByText("hanoman/spec-1")).toBeInTheDocument();
    expect(screen.getByText("hanoman/spec-2")).toBeInTheDocument();
  });

  it("baris terkunci menampilkan alasannya & tak bisa dipilih", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-3");
    expect(screen.getByText(/sesi aktif/i)).toBeInTheDocument();
    pick("pick-hanoman/spec-3");
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
  });

  it("pilih semua hanya mencentang yang boleh dihapus", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    pick("pick-all");
    // spec-1, spec-2 & fitur/aktif — bukan main (base+current) maupun spec-3 (session)
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("3");
  });

  // SPEC-861 · kebuntuan 'branch tak bisa dihapus karena worktree' — badge kuncinya harus jadi jalan
  // keluar: kini ke baris worktree yang menahannya, yang ada di daftar yang sama.
  it("kunci worktree pada branch menyorot baris worktree-nya", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({
      branches: [br({ name: "hanoman/spec-4", remote: false, mergedRemote: false, lastCommit: null,
        locks: ["worktree"], worktree: "/repo/.worktrees/wt-b" })],
    }));
    vi.spyOn(api, "worktrees").mockResolvedValue(worktreeReport());
    render(<CabangPanel projectId="p1" />);
    fireEvent.click(await screen.findByTestId("goto-worktree-hanoman/spec-4"));
    expect(screen.getByTestId("row-wt-b")).toHaveStyle({ background: "var(--surface-sunken)" });
  });

  it("tombol hapus per baris memanggil api dengan satu nama", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main", results: [{ name: "hanoman/spec-1", ok: true, scope: "both" }] });
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("row-delete-hanoman/spec-1"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["hanoman/spec-1"], scope: "both" }));
  });

  it("bulk mengirim semua nama terpilih dalam SATU panggilan", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main",
      results: [{ name: "hanoman/spec-1", ok: true, scope: "both" }, { name: "hanoman/spec-2", ok: true, scope: "local" }] });
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    // Saring ke ter-merge dulu: batch campuran memakai dialog risiko (SPEC-859), bukan dialog ini.
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
    pick("pick-all");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0]![1]).toEqual({ names: ["hanoman/spec-1", "hanoman/spec-2"], scope: "both" });
  });

  it("scope (di Opsi) diteruskan ke api", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    openOpsi();
    fireEvent.change(screen.getByTestId("scope"), { target: { value: "local" } });
    pick("pick-hanoman/spec-1");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del.mock.calls[0]![1]).toMatchObject({ scope: "local" }));
  });

  it("ganti base (di Opsi) memuat ulang laporan", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    openOpsi();
    fireEvent.change(screen.getByTestId("base"), { target: { value: "dev" } });
    await waitFor(() => expect(api.branchesUnused).toHaveBeenCalledWith("p1", "dev", "all"));
  });

  it("hasil gagal ditampilkan apa adanya", async () => {
    vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main",
      results: [{ name: "hanoman/spec-1", ok: false, scope: "none", error: "terkunci: sesi aktif memakainya" }] });
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.click(screen.getByTestId("row-delete-hanoman/spec-1"));
    await confirm();
    expect(await screen.findByText(/terkunci: sesi aktif memakainya/)).toBeInTheDocument();
  });

  it("project tanpa branch maupun worktree → state kosong", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({ branches: [] }));
    render(<CabangPanel projectId="p1" />);
    expect(await screen.findByText(/tak ada branch/i)).toBeInTheDocument();
  });

  // SPEC-859 · panel melebar ke SELURUH branch; filter & pilihan hidup di klien.
  it("meminta include=all dan menampilkan branch belum ter-merge", async () => {
    render(<CabangPanel projectId="p1" />);
    expect(await screen.findByText("fitur/aktif")).toBeInTheDocument();
    expect(api.branchesUnused).toHaveBeenCalledWith("p1", undefined, "all");
  });

  it("filter status ter-merge menyembunyikan yang belum", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
    expect(screen.queryByText("fitur/aktif")).toBeNull();
    expect(screen.getByText("hanoman/spec-1")).toBeInTheDocument();
  });

  it("filter status belum ter-merge menyisakan yang belum saja", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "unmerged" } });
    expect(screen.getByText("fitur/aktif")).toBeInTheDocument();
    expect(screen.queryByText("hanoman/spec-1")).toBeNull();
  });

  it("cari menyaring berdasarkan nama", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("cari"), { target: { value: "spec-2" } });
    expect(screen.getByText("hanoman/spec-2")).toBeInTheDocument();
    expect(screen.queryByText("hanoman/spec-1")).toBeNull();
  });

  it("pilih semua hanya mencakup yang tampak setelah filter", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "unmerged" } });
    pick("pick-all");
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("1");
  });

  it("hapus branch belum ter-merge menuntut konfirmasi risiko lalu mengirim allowUnmerged", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main", results: [{ name: "fitur/aktif", ok: true, scope: "both", forced: true }] });
    render(<CabangPanel projectId="p1" />);
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
    render(<CabangPanel projectId="p1" />);
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
    render(<CabangPanel projectId="p1" />);
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
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("cari"), { target: { value: "zzz" } });
    expect(screen.getByText(/tak ada branch cocok filter/i)).toBeInTheDocument();
  });
});

describe("CabangPanel · worktree", () => {
  beforeEach(() => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({ branches: [] }));
    vi.spyOn(api, "worktrees").mockResolvedValue(worktreeReport());
    vi.spyOn(api, "worktreeStats").mockImplementation(async (_id, name) =>
      ({ name, sizeBytes: 4 * 1024 * 1024, dirtyFiles: 2, orphanCommits: 3 }));
  });

  it("pembersihan sesi terputus meminta konfirmasi dan tidak menghapus branch", async () => {
    const r = worktreeReport();
    r.worktrees[2]!.orphan = { historyId: "h1", sessionId: "old" };
    vi.mocked(api.worktrees).mockResolvedValue(r);
    const del = vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc" }],
    });
    render(<CabangPanel projectId="p1" />);
    expect(await screen.findByText("sesi terputus")).toBeInTheDocument();
    openOpsi();
    pick("with-branch");
    fireEvent.click(screen.getByRole("button", { name: /Bersihkan sesi terputus/ }));
    expect(await screen.findByText(/termasuk berkas ignored/)).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /batal/i }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Bersihkan sesi terputus/ }));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["wt-b"], orphanOnly: true }));
  });

  it.each(["request", "git"])("stats gagal %s tidak diklaim aman dalam dialog", async (failure) => {
    if (failure === "request") vi.mocked(api.worktreeStats).mockRejectedValue(new Error("offline"));
    else vi.mocked(api.worktreeStats).mockResolvedValue({ name: "wt-b", sizeBytes: null, dirtyFiles: null, orphanCommits: null });
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("wt-b");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    expect(await screen.findByText(/dampak.*belum diketahui/i)).toBeInTheDocument();
    expect(screen.queryByText(/tak ada kerja yang belum tersimpan/)).not.toBeInTheDocument();
  });

  it("menampilkan tiap worktree hidup + backlog & stage-nya", async () => {
    render(<CabangPanel projectId="p1" />);
    expect(await screen.findByText("spec-1")).toBeInTheDocument();
    expect(screen.getByText(/SPEC-1/)).toBeInTheDocument();
    expect(screen.getByText(/executing/)).toBeInTheDocument();
  });

  // ADR-0002 · sesi hanoman selalu detached: kolomnya harus sanggup menampilkan SHA.
  it("HEAD detached tampil sebagai SHA, bukan nama branch", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("spec-1");
    expect(screen.getByText(/bbb2222/)).toBeInTheDocument();
    expect(screen.getByText("topik")).toBeInTheDocument();
  });

  it("checkout project tampil tapi tak bisa dipilih", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("repo");
    expect(screen.getByText(/checkout project/i)).toBeInTheDocument();
    pick("pick-repo");
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
  });

  it("ukuran & isi kotor dimuat menyusul per baris", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("spec-1");
    await waitFor(() => expect(api.worktreeStats).toHaveBeenCalledWith("p1", "spec-1"));
    await waitFor(() => expect(screen.getAllByText(/4\.0 MB/)).toHaveLength(3));
  });

  it("dialog konfirmasi menyebut apa yang akan hilang", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("spec-1");
    fireEvent.click(screen.getByTestId("row-delete-spec-1"));
    expect(await screen.findByText(/1 sesi aktif akan ditutup/i)).toBeInTheDocument();
    expect(screen.getByText(/3 commit/i)).toBeInTheDocument();
    expect(screen.getByText(/2 berkas belum tersimpan/i)).toBeInTheDocument();
  });

  it("hapus memanggil api dengan nama baris dan flag branch (di Opsi)", async () => {
    const del = vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc" }] });
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("wt-b");
    openOpsi();
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
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("wt-b");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    await confirm();
    expect(await screen.findByText(/backlog-nya belum selesai/)).toBeInTheDocument();
  });

  // Branch yang sudah dipakai worktree tampil SEBAGAI baris worktree-nya, bukan sebagai baris kedua.
  it("branch worktree tak tampil dua kali", async () => {
    render(<CabangPanel projectId="p1" />);
    await screen.findByText("wt-b");
    expect(screen.getByText("topik")).toBeInTheDocument();
    expect(screen.queryByTestId("branch-row-topik")).toBeNull();
  });
});
