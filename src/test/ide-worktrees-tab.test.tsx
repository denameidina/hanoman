import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";

// SPEC-861 · ADR-0132 · tab keempat di IDE + jalan keluar dua arah untuk kebuntuan
// 'branch terkunci worktree' ↔ 'worktree tak terlihat di mana pun'.
const projects = [{ id: "p1", name: "P1", repoDir: "/repo" } as any];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] });
  vi.spyOn(api, "ideTree").mockResolvedValue({ files: [] } as any);
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] } as any);
  vi.spyOn(api, "branchesUnused").mockResolvedValue({
    base: "main", baseRemote: null, current: "main",
    branches: [{ name: "hanoman/spec-1", local: true, remote: false,
      merged: true, mergedLocal: true, mergedRemote: false, lastCommit: null,
      locks: ["worktree"], worktree: "/repo/.worktrees/spec-1" }],
  });
  vi.spyOn(api, "worktrees").mockResolvedValue({
    repoDir: "/repo",
    worktrees: [{ path: "/repo/.worktrees/spec-1", name: "spec-1", head: "bbb2222", branch: null,
      prunable: false, locked: false, deletable: true, blocked: null,
      spec: null, session: null, createdAt: "2026-08-01T10:00:00Z" }],
  });
  vi.spyOn(api, "worktreeStats").mockResolvedValue(
    { name: "spec-1", sizeBytes: 1024, dirtyFiles: 0, orphanCommits: 0 });
});

describe("IdeScreen · tab Worktrees", () => {
  it("tab Worktrees ada dan merender panelnya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: /worktrees/i }));
    expect(await screen.findByTestId("row-spec-1")).toBeInTheDocument();
  });

  it("dari tab Branches, badge worktree memindahkan ke baris Worktrees-nya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: /branches/i }));
    fireEvent.click(await screen.findByTestId("goto-worktree-hanoman/spec-1"));
    await waitFor(() => expect(screen.getByTestId("row-spec-1")).toBeInTheDocument());
  });

  it("dari tab Worktrees, nama branch memindahkan ke tab Branches", async () => {
    vi.spyOn(api, "worktrees").mockResolvedValue({
      repoDir: "/repo",
      worktrees: [{ path: "/repo/.worktrees/wt-b", name: "wt-b", head: "ccc3333", branch: "topik",
        prunable: false, locked: false, deletable: true, blocked: null,
        spec: null, session: null, createdAt: "2026-08-01T10:00:00Z" }],
    });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: /worktrees/i }));
    fireEvent.click(await screen.findByTestId("goto-branch-wt-b"));
    await waitFor(() => expect(screen.getByText("hanoman/spec-1")).toBeInTheDocument());
  });
});
