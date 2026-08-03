import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { GitGraph } from "../src/screens/GitGraph";
import { api } from "../src/api/client";

const commits = [
  { sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"], tags: [] },
  { sha: "bbbb222", parents: [], author: "t", at: "2026-01-01T00:00:00Z", subject: "pertama", refs: [], tags: [] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main", total: 250 });
  vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "",
    subject: "kedua", body: "", changed: [{ path: "a.ts", add: 1, del: 0, status: "M", binary: false }],
    signed: false, committer: "t", committedAt: "", authorEmail: "t@t" });
});

describe("GitGraph", () => {
  it("menggambar baris commit dari ideGraph", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    expect(await screen.findByText("kedua")).toBeInTheDocument();
    // "main" muncul sbg chip ref DAN opsi filter branch (SPEC-233) → minimal satu.
    expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(1);
  });
  it("klik commit memuat detail file berubah", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    await waitFor(() => expect(api.ideCommit).toHaveBeenCalledWith("p1", "aaaa111"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
  it("context-menu Checkout memanggil onRunGit", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText(/checkout/i));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "checkout", ref: "aaaa111" }));
  });

  // SPEC-206 · hapus branch local dan/atau origin lewat klik-kanan
  it("branch local+origin: tawarkan hapus local+origin, local, dan origin", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["feat", "origin/feat"], tags: [] }],
      current: "main", total: 99,
    });
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));

    fireEvent.click(await screen.findByText("Hapus feat (local + origin)"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "feat", remote: true }));

    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Hapus feat (local)"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "feat" }));

    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Hapus origin/feat"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "feat", local: false, remote: true }));
  });

  it("ref origin saja (tanpa local): hanya tawarkan hapus origin", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["origin/gone"], tags: [] }],
      current: "main", total: 99,
    });
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    expect(screen.queryByText(/Hapus gone \(local/)).toBeNull();
    fireEvent.click(await screen.findByText("Hapus origin/gone"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "gone", local: false, remote: true }));
  });

  // SPEC-229 · aksi merge pindah dari onRunGit ke onMerge (jalur worktree isolasi + sesi claude).
  it("merge commit (termasuk origin) memanggil onMerge dengan sha, bukan onRunGit", async () => {
    const onRunGit = vi.fn().mockResolvedValue({}), onMerge = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["origin/feat"], tags: [] }],
      current: "main", total: 99,
    });
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={onMerge} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Merge (fast-forward bila bisa)"));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("aaaa111", undefined));
    expect(onRunGit).not.toHaveBeenCalled();
  });

  // SPEC-245 · live-refresh: graph mem-poll ideGraph ulang tanpa aksi manual
  // supaya perubahan async (sesi claude commit, konflik diselesaikan di Terminal,
  // commit terminal) tampil tanpa refresh halaman.
  it("mem-poll ideGraph ulang secara live tanpa aksi manual (SPEC-245)", async () => {
    vi.useFakeTimers();
    try {
      const graph = vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main", total: 250 });
      vi.spyOn(api, "ideStatus").mockResolvedValue({ clean: true, branch: "main", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] });
      vi.spyOn(api, "ideStashes").mockResolvedValue([]);
      render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush effect mount + initial load
      const before = graph.mock.calls.length;
      expect(before).toBeGreaterThanOrEqual(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); }); // satu tick poll
      expect(graph.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("merge --no-ff & 'Merge <branch> lalu hapus' meneruskan opsi ke onMerge", async () => {
    const onMerge = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["feat"], tags: [] }],
      current: "main", total: 99,
    });
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={onMerge} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Merge tanpa fast-forward"));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("aaaa111", { ff: "no-ff" }));

    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText(/Merge feat lalu hapus/));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("feat", { deleteBranch: "feat" }));
  });
});

// SPEC-351 · jendela commit berhalaman. `limit` dulu konstanta hardcode 200: daftar berhenti
// diam-diam di commit ke-200 (79% history repo ini tak pernah terlihat) dan tak ada satu pun
// sinyal bahwa masih ada lanjutannya. Kini 200 = HALAMAN PERTAMA.
const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => {
  const idx = from + i;
  const num = (k: number) => `sha${String(k).padStart(4, "0")}`;
  return { sha: num(idx), parents: [num(idx + 1)], author: "t", at: "2026-01-02T00:00:00Z",
    subject: `commit ${idx}`, refs: idx === 0 ? ["main"] : idx === 1 ? ["feat"] : [], tags: [] };
});
const render351 = () => render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()}
  onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);

describe("GitGraph — jendela commit berhalaman (SPEC-351)", () => {
  it("halaman penuh: tampilkan hitungan + tombol muat lebih, bukan berhenti senyap", async () => {
    vi.spyOn(api, "ideGraph").mockResolvedValue({ commits: page(200), current: "main", total: 250 });
    render351();
    expect(await screen.findByText(/200 dari 250 commit/)).toBeInTheDocument();
    expect(screen.getByText("Muat 200 lagi")).toBeInTheDocument();
    expect(screen.queryByText(/seluruh history/)).toBeNull();
  });

  it("history habis (halaman tak penuh): tandai seluruh history, tanpa tombol", async () => {
    render351(); // beforeEach: 2 commit
    expect(await screen.findByText(/2 dari 250 commit/)).toBeInTheDocument();
    expect(screen.getByText(/seluruh history/)).toBeInTheDocument();
    expect(screen.queryByText(/Muat \d+ lagi/)).toBeNull();
  });

  it("muat lebih meminta halaman berikutnya (limit 400) dan merender commit lama", async () => {
    const graph = vi.spyOn(api, "ideGraph").mockImplementation(
      async (_id: string, limit = 200) => ({ commits: page(Math.min(250, limit)), current: "main", total: 250 }));
    render351();
    fireEvent.click(await screen.findByText("Muat 200 lagi"));
    await waitFor(() => expect(graph).toHaveBeenCalledWith("p1", 400, expect.anything()));
    expect(await screen.findByText("commit 249")).toBeInTheDocument();
    expect(await screen.findByText(/250 dari 250 commit/)).toBeInTheDocument();
    expect(screen.queryByText(/Muat \d+ lagi/)).toBeNull(); // 250 < 400 → habis
  });

  it("menggulir sampai penutup memuat halaman berikutnya sendiri (IntersectionObserver)", async () => {
    let fire: (() => void) | null = null;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) { fire = () => cb([{ isIntersecting: true }]); }
      observe() {} unobserve() {} disconnect() {}
    });
    try {
      const graph = vi.spyOn(api, "ideGraph").mockImplementation(
        async (_id: string, limit = 200) => ({ commits: page(Math.min(250, limit)), current: "main", total: 250 }));
      render351();
      await screen.findByText("Muat 200 lagi");
      await act(async () => { fire!(); });
      await waitFor(() => expect(graph).toHaveBeenCalledWith("p1", 400, expect.anything()));
    } finally { vi.unstubAllGlobals(); }
  });

  it("ganti filter branch me-reset jendela ke halaman pertama", async () => {
    const graph = vi.spyOn(api, "ideGraph").mockImplementation(
      async (_id: string, limit = 200) => ({ commits: page(Math.min(250, limit)), current: "main", total: 250 }));
    render351();
    fireEvent.click(await screen.findByText("Muat 200 lagi"));
    await waitFor(() => expect(graph).toHaveBeenCalledWith("p1", 400, expect.anything()));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "feat" } });
    await waitFor(() => expect(graph).toHaveBeenCalledWith("p1", 200, expect.objectContaining({ branches: ["feat"] })));
    expect(graph.mock.calls.at(-1)?.[1]).toBe(200);
  });
});

// SPEC-385 · berkas .md di detail commit dulu hanya bisa dibaca sebagai <pre> mentah.
describe("GitGraph preview .md (SPEC-385)", () => {
  beforeEach(() => {
    vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "",
      subject: "kedua", body: "", changed: [{ path: "docs/a.md", add: 1, del: 0, status: "M", binary: false }],
      signed: false, committer: "t", committedAt: "", authorEmail: "t@t" });
    vi.spyOn(api, "ideCommitFile").mockResolvedValue({ path: "docs/a.md", status: "M", binary: false,
      truncated: false, diff: "@@ -1 +1 @@\n+# Judul", content: "# Judul\n\nisi" });
  });

  const openFile = async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("docs/a.md"));
    await waitFor(() => expect(api.ideCommitFile).toHaveBeenCalledWith("p1", "aaaa111", "docs/a.md"));
  };

  it("tab preview merender markdown, bukan teks mentah", async () => {
    await openFile();
    fireEvent.click(await screen.findByText("preview"));
    expect(await screen.findByRole("heading", { name: "Judul" })).toBeInTheDocument();
  });

  it("modal berkas commit menaut unduh .md/.pdf (ADR-0078)", async () => {
    await openFile();
    expect(await screen.findByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/projects/p1/commit/aaaa111/file?path=docs%2Fa.md&download=md");
  });

  it("berkas non-.md tak punya tab preview", async () => {
    vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: [], author: "t", at: "",
      subject: "kedua", body: "", changed: [{ path: "src/a.ts", add: 1, del: 0, status: "M", binary: false }],
      signed: false, committer: "t", committedAt: "", authorEmail: "t@t" });
    vi.spyOn(api, "ideCommitFile").mockResolvedValue({ path: "src/a.ts", status: "M", binary: false,
      truncated: false, diff: "@@", content: "const x = 1" });
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("src/a.ts"));
    await waitFor(() => expect(api.ideCommitFile).toHaveBeenCalled());
    expect(screen.queryByText("preview")).toBeNull();
  });
});
