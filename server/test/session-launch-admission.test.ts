import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "@prisma/client";
import { zSetting, type Setting } from "@hanoman/shared";

const state = vi.hoisted(() => ({
  panes: [] as { id: string; projectId: string; specId?: string; exited: boolean }[],
  setting: undefined as Setting | undefined,
  effects: [] as string[],
}));
vi.mock("../src/db", () => ({ prisma: {
  spec: { update: async () => { state.effects.push("update"); return {}; } },
} }));
vi.mock("../src/services/pty", async () => ({
  ...await import("../src/services/session-id"),
  getSession: (id: string) => state.panes.find((p) => p.id === id),
  getSessionAsync: async (id: string) => state.panes.find((p) => p.id === id),
  listSessionsAsync: async () => state.panes.slice(),
  listPanesAsync: async () => state.panes.slice(),
  killSession: () => { state.effects.push("kill"); },
  createSession: (_project: string, _cwd: string, opts: { specId: string }) => {
    const pane = { id: opts.specId.toLowerCase(), specId: opts.specId, projectId: "p", exited: false };
    state.effects.push("spawn");
    state.panes.push(pane);
    return pane;
  },
}));
vi.mock("@hanoman/runner", async (original) => ({
  ...await original<typeof import("@hanoman/runner")>(),
  realGit: { addWorktree: () => { state.effects.push("worktree"); return "base"; } },
}));
vi.mock("../src/services/settings", () => ({ getSetting: async () => state.setting }));
vi.mock("../src/services/local-binding", () => ({ resolveRepoDir: async () => "/repo" }));
vi.mock("../src/services/spec-deps", () => ({ blockersForSpec: async () => [], blockedNote: () => "blocked" }));
vi.mock("../src/services/spec-attachment-dir", () => ({
  specAttachmentsDir: () => "/repo/.worktrees/.attachments/spec-1108",
  syncSpecAttachmentsDir: async () => [],
}));

import { startSpecSession } from "../src/services/session-launch";

const spec = {
  id: "SPEC-1108", projectId: "p", title: "Gate", source: "qa", stage: "planned",
  priority: "tinggi", objective: "Gate launches", payload: {}, baseSha: null,
  launchApprovedAt: new Date(),
} as Spec;

beforeEach(() => {
  state.panes = [{ id: "spec-other", specId: "SPEC-other", projectId: "p", exited: false }];
  state.setting = zSetting.parse({
    autoDefault: false, autoScaffold: false, notifyFail: true, scheduler: { maxConcurrent: 1 },
  });
  state.effects = [];
});

describe("SPEC-1108 · gerbang bersama peluncuran backlog", () => {
  it("menolak cap penuh walau scheduler mati, sebelum kill/worktree/spawn", async () => {
    await expect(startSpecSession(spec, { flow: "qa" })).rejects.toMatchObject({ kind: "capacity" });
    expect(state.effects).toEqual([]);
  });

  it("re-attach pane hidup tetap boleh saat cap penuh", async () => {
    state.panes.push({ id: "spec-1108", specId: spec.id, projectId: "p", exited: false });
    await expect(startSpecSession(spec, { flow: "qa" })).resolves.toEqual({ id: "spec-1108", reused: true });
    expect(state.effects).toEqual([]);
  });
});
