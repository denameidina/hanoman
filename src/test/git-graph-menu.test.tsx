// Audit UI/UX 2026-10 (3H) · menu commit Riwayat dikelompokkan (Navigasi / Cabang & tag / Lanjutan)
// dan aksi yang menulis ulang riwayat berada di grup paling bawah. Tautan "Kelola di tab Cabang"
// dari menu cabang adalah satu-satunya jalan ke tempat hapus branch utama.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GitGraph } from "../src/screens/GitGraph";
import { api } from "../src/api/client";

const commits = [
  { sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["feat"], tags: [] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main", total: 1 });
  vi.spyOn(api, "ideStatus").mockResolvedValue({ clean: true, branch: "main", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] } as never);
  vi.spyOn(api, "ideStashes").mockResolvedValue([]);
  vi.spyOn(api, "getConfig").mockResolvedValue({ entries: [] } as never);
});

describe("GitGraph · menu commit dikelompokkan", () => {
  it("tiga grup berjudul; reset & drop berada di Lanjutan", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    const navigasi = screen.getByRole("group", { name: "Navigasi" });
    const cabang = screen.getByRole("group", { name: "Cabang & tag" });
    const lanjutan = screen.getByRole("group", { name: "Lanjutan" });
    expect(within(navigasi).getByRole("menuitem", { name: /Checkout aaaa111/ })).toBeInTheDocument();
    expect(within(cabang).getByRole("menuitem", { name: "Merge (fast-forward bila bisa)" })).toBeInTheDocument();
    expect(within(lanjutan).getByRole("menuitem", { name: "Reset current → sini (hard)" })).toBeInTheDocument();
    expect(within(lanjutan).getByRole("menuitem", { name: "Drop commit…" })).toBeInTheDocument();
    // Lanjutan adalah grup terakhir: aksi yang menulis ulang riwayat paling bawah.
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups.slice(-1)).toEqual(["Lanjutan"]);
  });
});

describe("GitGraph · menu cabang", () => {
  it("'Kelola di tab Cabang' memanggil onOpenCabang", async () => {
    const onOpenCabang = vi.fn();
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()}
      onDrop={vi.fn()} onOpenFile={vi.fn()} onOpenCabang={onOpenCabang} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aksi branch feat" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Kelola di tab Cabang" }));
    expect(onOpenCabang).toHaveBeenCalledTimes(1);
  });

  it("tanpa onOpenCabang, tautan itu tak ditawarkan", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aksi branch feat" }));
    await screen.findByRole("menuitem", { name: /Push ke origin/ });
    expect(screen.queryByRole("menuitem", { name: "Kelola di tab Cabang" })).toBeNull();
  });
});
