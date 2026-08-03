import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api, ApiError } from "../src/api/client";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files: ["src/a.ts", "README.md"] });
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "dev"], remotes: ["main"] });
  vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
});

describe("IdeScreen Explorer", () => {
  it("menampilkan pohon file dari ideTree", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });
  it("klik file memuat isinya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "README.md", ""));
  });
  it("mengelompokkan file per folder, folder collapse default", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    // folder src/ tampil sebagai header…
    expect(await screen.findByText("src/")).toBeInTheDocument();
    // …tapi isinya (a.ts) tersembunyi sampai di-expand
    expect(screen.queryByText("a.ts")).toBeNull();
    // buka folder → a.ts muncul
    fireEvent.click(screen.getByText("src/"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
  it("tombol Checkout memanggil ideGit", async () => {
    vi.spyOn(api, "ideGit").mockResolvedValue({ ok: true, stdout: "", stderr: "", current: "dev" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await screen.findByText("README.md");
    // pilih ref "dev" agar Checkout aktif
    fireEvent.change(screen.getByDisplayValue("· working tree ·"), { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(api.ideGit).toHaveBeenCalledWith("p1", { op: "checkout", ref: "dev" }));
  });
  it("checkout 409 memunculkan dialog Paksa", async () => {
    vi.spyOn(api, "ideGit").mockRejectedValueOnce(new ApiError(409, "sesi aktif"));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await screen.findByText("README.md");
    fireEvent.change(screen.getByDisplayValue("· working tree ·"), { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    expect(await screen.findByRole("button", { name: /paksa/i })).toBeInTheDocument();
  });
});

// SPEC-229 · merge via git graph: konflik → pindah Terminal (sesi claude); bersih → toast; error → toast.
describe("IdeScreen merge git graph", () => {
  beforeEach(() => {
    vi.spyOn(api, "ideGraph").mockResolvedValue({ current: "main", total: 1, commits: [
      { sha: "aaaaaaa", parents: [], author: "t", at: new Date(0).toISOString(), subject: "c1", refs: ["origin/feat"], tags: [] },
    ] });
  });
  const openMergeMenu = async () => {
    fireEvent.click(await screen.findByRole("tab", { name: /git graph/i }));
    fireEvent.contextMenu(await screen.findByText("c1"));
    fireEvent.click(await screen.findByText("Merge (fast-forward bila bisa)"));
  };

  it("konflik → onGotoTerminal(sessionId) + toast warn", async () => {
    const onGoto = vi.fn(); const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockResolvedValue({ status: "conflict", sessionId: "merge-main" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={onGoto} />);
    await openMergeMenu();
    await waitFor(() => expect(api.ideGitMerge).toHaveBeenCalledWith("p1", { source: "aaaaaaa" }));
    await waitFor(() => expect(onGoto).toHaveBeenCalledWith("merge-main"));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("konflik"), "warn", "git-merge");
  });

  it("bersih → toast ok, tanpa navigasi", async () => {
    const onGoto = vi.fn(); const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockResolvedValue({ status: "clean", detail: "lokal main (ff) → abcdef0" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={onGoto} />);
    await openMergeMenu();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("merge berhasil"), "ok", "git-merge"));
    expect(onGoto).not.toHaveBeenCalled();
  });

  it("error 409 → toast err, tak melempar ke luar", async () => {
    const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockRejectedValue(new ApiError(409, "tak bisa ff"));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={vi.fn()} />);
    await openMergeMenu();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("gagal merge"), "err", "x-circle"));
  });
});

// SPEC-234 · section Staged & Changed dari status working tree, klik → diff.
describe("IdeScreen Staged & Changed", () => {
  it("merender section Staged & Changed dari ideWorkingStatus", async () => {
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main",
      staged: [{ path: "src/app.ts", add: 12, del: 3, status: "M", binary: false }],
      unstaged: [{ path: "CHANGELOG.md", add: 2, del: 1, status: "M", binary: false }] });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();   // staged (bukan di files tree)
    expect(await screen.findByText("CHANGELOG.md")).toBeInTheDocument(); // changed (bukan di files tree)
  });
  it("klik file staged → panggil ideFileDiff(staged=true) & render diff", async () => {
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main",
      staged: [{ path: "app.ts", add: 1, del: 0, status: "M", binary: false }], unstaged: [] });
    vi.spyOn(api, "ideFileDiff").mockResolvedValue({ path: "app.ts", status: "M", binary: false,
      truncated: false, diff: "@@ -1 +1 @@\n+baris baru", content: "baris baru" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("app.ts"));
    await waitFor(() => expect(api.ideFileDiff).toHaveBeenCalledWith("p1", "app.ts", true));
    expect(await screen.findByText(/baris baru/)).toBeInTheDocument();
  });
  it("toggle Tree pada section Changed memakai folder tree", async () => {
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [],
      unstaged: [{ path: "docs/guide.md", add: 4, del: 0, status: "A", binary: false }] });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Tree Changed/i }));
    expect(await screen.findByText("docs/")).toBeInTheDocument(); // folder node muncul
  });
});

// SPEC-240 · .md default preview + toggle Preview | Source
describe("IdeScreen preview .md (SPEC-240)", () => {
  it("memilih .md → render preview (.hn-md), bukan raw source", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# Judul Preview", binary: false, truncated: false });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    // preview terender: heading <h1> di dalam wrapper .hn-md
    await waitFor(() => {
      const md = container.querySelector(".hn-md");
      expect(md).not.toBeNull();
      expect(md!.querySelector("h1")?.textContent).toBe("Judul Preview");
    });
    // toggle Preview | Source hadir
    expect(screen.getByRole("button", { name: /^Source$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Preview$/i })).toBeInTheDocument();
  });

  it("toggle Source → raw source; balik Preview → terender", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# Judul Preview", binary: false, truncated: false });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    await screen.findByRole("button", { name: /^Source$/i });
    fireEvent.click(screen.getByRole("button", { name: /^Source$/i }));
    // source: <code class="hljs"> muncul, wrapper .hn-md hilang
    await waitFor(() => {
      expect(container.querySelector("code.hljs")).not.toBeNull();
      expect(container.querySelector(".hn-md")).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Preview$/i }));
    await waitFor(() => expect(container.querySelector(".hn-md")).not.toBeNull());
  });

  it("file non-.md → tak ada toggle Preview|Source, source tampil", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "src/a.ts", content: "const x = 1;", binary: false, truncated: false });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("src/")); // buka folder
    fireEvent.click(await screen.findByText("a.ts"));
    await waitFor(() => expect(container.querySelector("code.hljs")).not.toBeNull());
    expect(screen.queryByRole("button", { name: /^Preview$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Source$/i })).toBeNull();
    expect(container.querySelector(".hn-md")).toBeNull();
  });

  it("edit .md → Simpan → kembali ke preview", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# Judul Preview", binary: false, truncated: false });
    vi.spyOn(api, "putIdeFile").mockResolvedValue({ path: "README.md", content: "# Judul Baru" });
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
    const ta = await screen.findByRole("textbox");
    fireEvent.change(ta, { target: { value: "# Judul Baru" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => {
      const md = container.querySelector(".hn-md");
      expect(md).not.toBeNull();
      expect(md!.querySelector("h1")?.textContent).toBe("Judul Baru");
    });
  });
});

describe("IdeScreen tab Branches (SPEC-360)", () => {
  it("tab Branches merender panel branch ter-merge", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue({
      base: "main", baseRemote: "origin/main", current: "main",
      branches: [{ name: "hanoman/spec-9", local: true, remote: true, lastCommit: null, locks: [] }],
    });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    // `Tabs` merender <button role="tab">; role eksplisit menimpa role implisit "button",
    // jadi query WAJIB role "tab" — bukan "button".
    fireEvent.click(await screen.findByRole("tab", { name: /branches/i }));
    expect(await screen.findByText("hanoman/spec-9")).toBeInTheDocument();
  });
});

// SPEC-385 · aksi Preview membuka .md di ruang baca lebar — di mode file (di samping toggle
// SPEC-240 yang tetap ada, karena itu labelnya "Preview lebar") DAN di pane diff, yang dulu
// hanya punya <pre> mentah.
describe("IdeScreen preview .md (SPEC-385)", () => {
  // Mode file SUDAH punya preview inline (SPEC-240) + tombol unduh toolbar (SPEC-361), jadi
  // assertion di-scope ke panel modal — kalau tidak, "found multiple elements" bisa terbaca
  // sebagai lulus/gagal karena alasan yang salah.
  it("mode file: Preview lebar membuka modal berisi markdown terender + unduh berkas itu", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(await screen.findByRole("button", { name: /preview lebar/i }));
    const modal = within(await screen.findByTestId("modal-panel"));
    expect(modal.getByRole("heading", { name: "hi" })).toBeInTheDocument();
    expect(modal.getByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/projects/p1/file?path=README.md&download=md");
  });

  it("toggle inline Preview|Source SPEC-240 tetap ada", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    expect(await screen.findByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("pane diff: Preview lebar merender isi sesudah perubahan + unduh dari endpoint file-diff", async () => {
    vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({
      branch: "main", staged: [],
      unstaged: [{ path: "docs/a.md", add: 2, del: 0, status: "M", binary: false }],
    });
    vi.spyOn(api, "ideFileDiff").mockResolvedValue({
      path: "docs/a.md", status: "M", binary: false, truncated: false,
      diff: "@@ -1 +1 @@\n+# Sesudah", content: "# Sesudah\n\nteks",
    });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("docs/a.md"));
    await waitFor(() => expect(api.ideFileDiff).toHaveBeenCalledWith("p1", "docs/a.md", false));
    fireEvent.click(await screen.findByRole("button", { name: /preview lebar/i }));
    expect(await screen.findByRole("heading", { name: "Sesudah" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unduh \.pdf/i }))
      .toHaveAttribute("href", "/api/projects/p1/file-diff?path=docs%2Fa.md&download=pdf");
  });

  it("berkas non-.md tak menawarkan Preview lebar di mode file", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "src/a.ts", content: "const x = 1", binary: false, truncated: false });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("src/"));
    fireEvent.click(await screen.findByText("a.ts"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "src/a.ts", ""));
    expect(screen.queryByRole("button", { name: /preview lebar/i })).toBeNull();
  });
});
