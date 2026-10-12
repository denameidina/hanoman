// Audit UI/UX 2026-10 (3H) · IDE "Perubahan dulu": empat tab, default Perubahan, jalur lama tetap
// membuka tempat yang sama, toolbar ≤6 kontrol, satu aksi primer Commit, dan pemisah panel berkas
// yang bisa diatur keyboard.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";
import { mockViewport, resetViewport } from "./viewport";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;
const KEY_TAB = "hn.ui.v1.ide@p1.tab";
const KEY_TREE_W = "hn.ui.v1.ide@p1.treeW";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files: ["README.md"] });
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] });
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main",
    staged: [{ path: "src/app.ts", add: 1, del: 0, status: "M", binary: false }],
    unstaged: [{ path: "docs/new.md", add: 2, del: 0, status: "A", binary: false }] });
  vi.spyOn(api, "worktrees").mockResolvedValue({ repoDir: "/r", worktrees: [] });
  vi.spyOn(api, "branchesUnused").mockResolvedValue({ base: "main", baseRemote: null, current: "main", branches: [] });
  vi.spyOn(api, "ideGraph").mockResolvedValue({ current: "main", total: 1, commits: [
    { sha: "aaaaaaa", parents: [], author: "t", at: new Date(0).toISOString(), subject: "c1", refs: ["main"], tags: [] },
  ] });
  vi.spyOn(api, "ideStatus").mockResolvedValue({ clean: true, branch: "main", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] } as any);
  vi.spyOn(api, "ideStashes").mockResolvedValue([]);
  vi.spyOn(api, "getConfig").mockResolvedValue({ entries: [] } as any);
});
afterEach(resetViewport);

const tabList = async () => screen.findByRole("tablist", { name: "Bagian IDE" });

describe("IDE · tab", () => {
  it("empat tab; Perubahan terpilih sebagai default", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    const list = await tabList();
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, "").trim())).toEqual(["Perubahan", "Riwayat", "Cabang", "Berkas"]);
    expect(within(list).getByRole("tab", { name: /perubahan/i })).toHaveAttribute("aria-selected", "true");
    // Jumlah perubahan tampil di tab Perubahan, bukan di tiap tab lain.
    expect(within(list).getByRole("tab", { name: /perubahan/i })).toHaveTextContent("2");
  });

  it("jalur lama: tab tersimpan 'explorer' membuka Berkas, 'graph' membuka Riwayat", async () => {
    localStorage.setItem(KEY_TAB, JSON.stringify("explorer"));
    const { unmount } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(within(await tabList()).getByRole("tab", { name: "Berkas" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    unmount();
    localStorage.setItem(KEY_TAB, JSON.stringify("graph"));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(within(await tabList()).getByRole("tab", { name: "Riwayat" })).toHaveAttribute("aria-selected", "true");
  });

  it("nilai tab tak dikenal jatuh ke Perubahan, tak pernah ke objek bawaan", async () => {
    localStorage.setItem(KEY_TAB, JSON.stringify("constructor"));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(within(await tabList()).getByRole("tab", { name: /perubahan/i })).toHaveAttribute("aria-selected", "true");
  });

  it("toolbar atas memuat paling banyak enam kontrol", async () => {
    const { container } = render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await tabList();
    const toolbar = container.querySelector(".hn-ide-toolbar")!;
    const controls = toolbar.querySelectorAll("button, select, input");
    expect(controls.length).toBeLessThanOrEqual(6);
    // ref selector, Fetch, Diabaikan git, Muat ulang, ⋯ — dan proyek.
    expect(screen.getByRole("button", { name: "Aksi lain IDE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /diabaikan git/i })).toBeInTheDocument();
  });
});

describe("IDE · Perubahan", () => {
  it("menampilkan legenda M/A/D dan satu aksi primer Commit yang membawa ke Terminal", async () => {
    const onGoto = vi.fn();
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onGotoTerminal={onGoto} />);
    expect(await screen.findByText(/M diubah · A ditambah · D dihapus/)).toBeInTheDocument();
    const commit = screen.getByRole("button", { name: "Commit dari Terminal" });
    fireEvent.click(commit);
    expect(onGoto).toHaveBeenCalledWith();
  });

  it("Commit dari Terminal nonaktif (dengan penjelasan) tanpa handler terminal", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(await screen.findByRole("button", { name: "Commit dari Terminal" })).toBeDisabled();
    expect(screen.getByText(/dibuat dari sesi Terminal/)).toBeInTheDocument();
  });

  it("daftar Staged/Changed memakai RowList dengan badge status", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    const staged = await screen.findByRole("list", { name: "Berkas Staged" });
    expect(within(staged).getByText("src/app.ts")).toBeInTheDocument();
    expect(within(staged).getByText("M")).toBeInTheDocument();
    const changed = screen.getByRole("list", { name: "Berkas Changed" });
    expect(within(changed).getByText("A")).toBeInTheDocument();
  });
});

describe("IDE · Riwayat", () => {
  it("daftar commit semantik (role list/listitem) dan lane SVG disembunyikan dari pembaca layar", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(within(await tabList()).getByRole("tab", { name: "Riwayat" }));
    const rows = await screen.findByRole("list", { name: "Riwayat commit" });
    expect(within(rows).getAllByRole("listitem").length).toBeGreaterThan(0);
    rows.querySelectorAll("svg").forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
  });
});

describe("IDE · Berkas: pemisah panel", () => {
  it("pemisah lebar bisa diatur keyboard (panah, Home, End) dan menyimpan lebarnya", async () => {
    mockViewport(1100);
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(within(await tabList()).getByRole("tab", { name: "Berkas" }));
    const sep = await screen.findByRole("separator", { name: "Lebar panel berkas" });
    expect(sep).toHaveAttribute("tabindex", "0");
    expect(sep).toHaveAttribute("aria-valuenow", "300");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true });
    expect(sep).toHaveAttribute("aria-valuenow", "268");
    fireEvent.keyDown(sep, { key: "End" });
    expect(sep).toHaveAttribute("aria-valuenow", "560");
    fireEvent.keyDown(sep, { key: "Home" });
    expect(sep).toHaveAttribute("aria-valuenow", "220");
    expect(JSON.parse(localStorage.getItem(KEY_TREE_W) ?? "null")).toBe(220);
  });

  it("di mobile pemisah tak dirender (panel berganti lewat pemilih)", async () => {
    mockViewport(390);
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(within(await tabList()).getByRole("tab", { name: "Berkas" }));
    await screen.findByRole("tablist", { name: "Panel IDE" });
    expect(screen.queryByRole("separator", { name: "Lebar panel berkas" })).toBeNull();
  });
});
