// Audit UI/UX 2026-10 (1F) · GitGraph: reset hard & clean lewat dialog DS dengan dampak,
// galat memuat tak menyembunyikan filter bar, dan "Coba lagi" tak meneruskan MouseEvent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { GitGraph } from "../src/screens/GitGraph";
import { api } from "../src/api/client";

const commits = [
  { sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"], tags: [] },
  { sha: "bbbb222", parents: [], author: "t", at: "2026-01-01T00:00:00Z", subject: "pertama", refs: [], tags: [] },
];
const STATUS = { branch: "main", ahead: 0, behind: 0, staged: [], unstaged: ["a.ts"], untracked: ["scratch.log"], clean: false };

function view(onRunGit = vi.fn().mockResolvedValue({})) {
  return render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()}
    onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main", total: 2 });
  vi.spyOn(api, "ideStatus").mockResolvedValue(STATUS as never);
  vi.spyOn(api, "ideStashes").mockResolvedValue([]);
  vi.spyOn(api, "getConfig").mockResolvedValue({ entries: [] } as never);
});

describe("GitGraph · aksi destruktif", () => {
  it("reset hard dari menu commit menunggu konfirmasi dan menyebut berkas yang dibuang", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    view(onRunGit);
    fireEvent.click(await screen.findByRole("button", { name: "Aksi commit aaaa111" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reset current → sini (hard)" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/Reset main ke aaaa111 secara hard/)).toBeInTheDocument();
    expect(dialog.getByText(/a\.ts/)).toBeInTheDocument();
    expect(onRunGit).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Reset hard" }));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "reset", sha: "aaaa111", mode: "hard" }));
  });

  it("hapus berkas untracked dari baris uncommitted meminta dialog yang menyebut namanya", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    view(onRunGit);
    fireEvent.click(await screen.findByRole("button", { name: "Aksi working tree" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hapus berkas untracked…" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/scratch\.log/)).toBeInTheDocument();
    expect(onRunGit).not.toHaveBeenCalled();
  });
});

describe("GitGraph · galat memuat", () => {
  it("filter bar tetap terlihat saat galat, dan Coba lagi memuat ulang", async () => {
    const graph = vi.spyOn(api, "ideGraph").mockRejectedValue(new Error("git gagal"));
    view();
    expect(await screen.findByText("Gagal memuat git graph")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter branch" })).toBeInTheDocument();
    graph.mockResolvedValue({ commits, current: "main", total: 2 });
    fireEvent.click(screen.getByRole("button", { name: /coba lagi/i }));
    expect(await screen.findByText("kedua")).toBeInTheDocument();
  });
});
