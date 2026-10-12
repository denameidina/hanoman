import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { reviewSpecIdsOf } from "../src/screens/backlog-worktree";
import type { TerminalSession } from "../src/api/client";
import type { Spec } from "../src/screens/types";

// ADR-0218 · "Perlu ditinjau" = sesi menunggu jawaban ATAU item selesai yang pernah dikerjakan dan belum
// ditandai "sudah ditinjau". Tes ini mengunci predikat klausa (b) dan aksi menu "Tandai ditinjau".

const done = (over: Partial<Spec> = {}) => ({
  id: "SPEC-D", projectId: "p1", title: "Selesai", source: "brief", stage: "done", priority: "sedang",
  author: "dena", objective: "obj", payload: {}, branchFrom: null, baseSha: "a1b2c3d", headSha: "e4f5a6b",
  createdAt: "2026-08-15T00:00:00.000Z", startedAt: "2026-08-15T01:00:00.000Z", reviewedAt: null,
  dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], manualDone: null, ...over,
}) as unknown as Spec;

const sesi = (over: Partial<TerminalSession>): TerminalSession =>
  ({ id: "s", projectId: "p1", cwd: "/repo", exited: false, ...over }) as TerminalSession;

describe("ADR-0218 · predikat Perlu ditinjau (klausa item selesai)", () => {
  it("item selesai, pernah dikerjakan, belum ditandai: masuk", () => {
    expect([...reviewSpecIdsOf([], [done()])]).toEqual(["SPEC-D"]);
  });

  it("sudah ditandai ditinjau: keluar", () => {
    expect([...reviewSpecIdsOf([], [done({ reviewedAt: "2026-10-01T00:00:00.000Z" })])]).toEqual([]);
  });

  it("selesai tanpa baseSha (ditandai manual, tanpa diff): keluar", () => {
    expect([...reviewSpecIdsOf([], [done({ baseSha: null })])]).toEqual([]);
  });

  it("belum selesai walau pernah dikerjakan: keluar", () => {
    expect([...reviewSpecIdsOf([], [done({ stage: "executing" })])]).toEqual([]);
  });

  it("union dengan klausa sesi: kedua sumber masuk, tanpa duplikat", () => {
    const sessions = [sesi({ id: "menunggu", specId: "SPEC-W", decision: true, deciding: false })];
    const ids = [...reviewSpecIdsOf(sessions, [done({ id: "SPEC-W" }), done({ id: "SPEC-D" })])].sort();
    expect(ids).toEqual(["SPEC-D", "SPEC-W"]);
  });

  it("tanpa daftar item, hanya klausa sesi (perilaku lama tetap)", () => {
    const sessions = [sesi({ id: "menunggu", specId: "SPEC-W", decision: true, deciding: false })];
    expect([...reviewSpecIdsOf(sessions)]).toEqual(["SPEC-W"]);
  });
});

describe("ADR-0218 · aksi menu 'Tandai ditinjau' di Backlog", () => {
  const screenWith = (backlog: Spec[], onMarkReviewed?: any) =>
    render(<BacklogScreen backlog={backlog} projects={[{ id: "p1", name: "p1" } as never]}
      projectFilter="all" onProjectFilter={() => {}} onMarkReviewed={onMarkReviewed} />);
  const openMenu = (id: string) =>
    fireEvent.click(screen.getAllByRole("button", { name: `Aksi lain ${id}` })[0]!);

  it("item selesai menawarkan 'Tandai ditinjau' dan memanggil dengan reviewed=true", () => {
    const onMarkReviewed = vi.fn(async () => {});
    screenWith([done()], onMarkReviewed);
    openMenu("SPEC-D");
    fireEvent.click(screen.getByRole("menuitem", { name: "Tandai ditinjau" }));
    expect(onMarkReviewed).toHaveBeenCalledWith(expect.objectContaining({ id: "SPEC-D" }), true);
  });

  it("item yang sudah ditinjau menawarkan 'Batalkan tanda ditinjau' dan memanggil dengan reviewed=false", () => {
    const onMarkReviewed = vi.fn(async () => {});
    screenWith([done({ reviewedAt: "2026-10-01T00:00:00.000Z" })], onMarkReviewed);
    openMenu("SPEC-D");
    fireEvent.click(screen.getByRole("menuitem", { name: "Batalkan tanda ditinjau" }));
    expect(onMarkReviewed).toHaveBeenCalledWith(expect.objectContaining({ id: "SPEC-D" }), false);
  });

  it("item yang belum selesai tidak menawarkan aksi ini", () => {
    screenWith([done({ stage: "executing" })], vi.fn(async () => {}));
    openMenu("SPEC-D");
    expect(screen.queryByRole("menuitem", { name: "Tandai ditinjau" })).toBeNull();
  });

  it("tanpa handler (layar tanpa App) aksi ini tak tampil", () => {
    screenWith([done()]);
    openMenu("SPEC-D");
    expect(screen.queryByRole("menuitem", { name: "Tandai ditinjau" })).toBeNull();
  });
});
