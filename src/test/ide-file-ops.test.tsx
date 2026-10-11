import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { buildFileTree, TreeRow } from "../src/screens/file-tree";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// jsdom tak memuat CSS: latar terpilih dibaca dari berkas stylesheet-nya.
const ideCss = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/ide.css"), "utf8");

// ADR-0121 · folder sebagai TUJUAN operasi berkas.
describe("TreeRow · folder sebagai target", () => {
  it("klik folder memanggil onSelectDir dan menandainya", () => {
    const onSelectDir = vi.fn();
    const nodes = buildFileTree(["src/ds/a.ts"]);
    const { rerender } = render(
      <TreeRow node={nodes[0]!} selected="" onSelect={() => {}} dirSelected="" onSelectDir={onSelectDir} />);
    fireEvent.click(screen.getByText("src/"));
    expect(onSelectDir).toHaveBeenCalledWith("src");
    rerender(<TreeRow node={nodes[0]!} selected="" onSelect={() => {}} dirSelected="src" onSelectDir={onSelectDir} />);
    expect(screen.getByText("src/").closest("button")).toHaveClass("hn-ide-sel");
    expect(ideCss).toMatch(/\.hn-ide-sel\s*\{\s*background:\s*var\(--brass-100\)/);
  });

  it("tanpa onSelectDir perilaku lama utuh: klik hanya buka-tutup", () => {
    const nodes = buildFileTree(["src/ds/a.ts"]);
    render(<TreeRow node={nodes[0]!} selected="" onSelect={() => {}} />);
    expect(screen.queryByText("ds/")).toBeNull();
    fireEvent.click(screen.getByText("src/"));
    expect(screen.getByText("ds/")).toBeInTheDocument();
  });
});

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;
function mountIde() {
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files: ["src/ds/a.ts", "README.md"] });
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] });
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
  vi.spyOn(api, "worktrees").mockResolvedValue({ repoDir: "/r", worktrees: [] });
  return render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
}
/** Buka tab Berkas (default-nya Perubahan) dan tunggu pohonnya. */
async function openBerkas() {
  const list = await screen.findByRole("tablist", { name: "Bagian IDE" });
  fireEvent.click(within(list).getByRole("tab", { name: "Berkas" }));
  return screen.findByText("README.md");
}
/** Menu konteks baris pohon (klik-kanan pada treeitem). */
function contextMenuOn(name: string) {
  fireEvent.contextMenu(screen.getByRole("treeitem", { name }));
  return within(screen.getByRole("menu"));
}

describe("Berkas · buat & unggah", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("tujuan default root, berubah mengikuti folder terpilih", async () => {
    mountIde();
    expect(await openBerkas()).toBeInTheDocument();
    expect(screen.getByTestId("ide-entry-dest")).toHaveTextContent("→ root");
    fireEvent.click(screen.getByText("src/"));
    expect(await screen.findByText("→ src")).toBeInTheDocument();
  });

  it("Berkas baru membuat berkas di folder terpilih lalu memuat ulang pohon", async () => {
    const create = vi.spyOn(api, "ideCreateEntry").mockResolvedValue({ path: "src/Baru.tsx" });
    mountIde();
    await openBerkas();
    fireEvent.click(screen.getByText("src/"));
    fireEvent.click(screen.getByRole("button", { name: /berkas baru/i }));
    fireEvent.change(screen.getByLabelText("Nama berkas"), { target: { value: "Baru.tsx" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("p1", "src/Baru.tsx", "file"));
    await waitFor(() => expect(api.ideTree).toHaveBeenCalledTimes(2));
  });

  it("Folder baru di menu ⋯ mengirim kind dir", async () => {
    const create = vi.spyOn(api, "ideCreateEntry").mockResolvedValue({ path: "kosong" });
    mountIde();
    await openBerkas();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain berkas" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /folder baru/i }));
    fireEvent.change(screen.getByLabelText("Nama folder"), { target: { value: "kosong" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("p1", "kosong", "dir"));
  });

  it("menu konteks folder menawarkan Berkas baru di folder itu", async () => {
    const create = vi.spyOn(api, "ideCreateEntry").mockResolvedValue({ path: "src/ds/Baru.ts" });
    mountIde();
    await openBerkas();
    fireEvent.click(screen.getByText("src/"));
    fireEvent.click(contextMenuOn("src/").getByRole("menuitem", { name: "Berkas baru di src/" }));
    fireEvent.change(screen.getByLabelText("Nama berkas"), { target: { value: "Baru.ts" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("p1", "src/Baru.ts", "file"));
  });

  it("unggah berkas memakai webkitRelativePath bila ada", async () => {
    const up = vi.spyOn(api, "ideUpload").mockResolvedValue({ written: ["a.txt"], skipped: [] });
    mountIde();
    await openBerkas();
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    const f = new File(["A"], "a.txt");
    Object.defineProperty(f, "webkitRelativePath", { value: "" });
    Object.defineProperty(input, "files", { value: [f] });
    fireEvent.change(input);
    await waitFor(() => expect(up).toHaveBeenCalledWith("p1", "", [{ path: "a.txt", file: f }], false));
  });

  it("berkas bentrok memunculkan modal & Timpa semua mengirim ulang hanya yang bentrok", async () => {
    const up = vi.spyOn(api, "ideUpload")
      .mockResolvedValueOnce({ written: ["b.txt"], skipped: [{ path: "a.txt", reason: "exists" }] })
      .mockResolvedValueOnce({ written: ["a.txt"], skipped: [] });
    mountIde();
    await openBerkas();
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    const fa = new File(["A"], "a.txt"), fb = new File(["B"], "b.txt");
    Object.defineProperty(input, "files", { value: [fa, fb] });
    fireEvent.change(input);
    fireEvent.click(await screen.findByRole("button", { name: /timpa semua/i }));
    await waitFor(() => expect(up).toHaveBeenLastCalledWith("p1", "", [{ path: "a.txt", file: fa }], true));
  });
});

describe("Berkas · drop", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("drop berkas mengunggahnya ke tujuan yang aktif", async () => {
    const up = vi.spyOn(api, "ideUpload").mockResolvedValue({ written: ["src/a.txt"], skipped: [] });
    mountIde();
    await openBerkas();
    fireEvent.click(screen.getByText("src/"));
    const f = new File(["A"], "a.txt");
    fireEvent.drop(screen.getByTestId("ide-tree-scroll"), { dataTransfer: { items: [], files: [f] } });
    await waitFor(() => expect(up).toHaveBeenCalledWith("p1", "src", [{ path: "a.txt", file: f }], false));
  });
});

describe("Berkas · ganti nama & hapus lewat menu konteks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("ganti nama berkas memindahkan seleksi viewer", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
    const ren = vi.spyOn(api, "ideRenameEntry").mockResolvedValue({ from: "README.md", to: "BACA.md" });
    mountIde();
    await openBerkas();
    fireEvent.click(screen.getByText("README.md"));
    fireEvent.click(contextMenuOn("README.md").getByRole("menuitem", { name: "Ganti nama…" }));
    fireEvent.change(screen.getByLabelText("Path baru"), { target: { value: "BACA.md" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(ren).toHaveBeenCalledWith("p1", "README.md", "BACA.md"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "BACA.md", ""));
  });

  it("hapus berkas cukup satu konfirmasi", async () => {
    const del = vi.spyOn(api, "ideDeleteEntry").mockResolvedValue({ path: "README.md", kind: "file" });
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
    mountIde();
    await openBerkas();
    fireEvent.click(contextMenuOn("README.md").getByRole("menuitem", { name: "Hapus berkas…" }));
    // Tombol "Hapus" di dialog konfirmasi — ruang lingkupnya wajib dialog.
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", "README.md"));
  });

  it("hapus folder menuntut nama diketik ulang", async () => {
    const del = vi.spyOn(api, "ideDeleteEntry").mockResolvedValue({ path: "src", kind: "dir" });
    mountIde();
    await openBerkas();
    fireEvent.click(contextMenuOn("src/").getByRole("menuitem", { name: "Hapus folder…" }));
    const dialog = within(await screen.findByRole("dialog"));
    const konfirm = dialog.getByRole("button", { name: "Hapus" });
    expect(konfirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ketik src untuk konfirmasi"), { target: { value: "src" } });
    fireEvent.click(konfirm);
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", "src"));
  });

  it("menghapus berkas yang sedang dibuka mengosongkan viewer", async () => {
    vi.spyOn(api, "ideDeleteEntry").mockResolvedValue({ path: "README.md", kind: "file" });
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
    mountIde();
    await openBerkas();
    fireEvent.click(screen.getByText("README.md"));
    fireEvent.click(contextMenuOn("README.md").getByRole("menuitem", { name: "Hapus berkas…" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText(/pilih file dari pohon/i)).toBeInTheDocument();
  });
});
