import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacklogScreen } from "../src/screens/BacklogScreen";

const item = {
  id: "SPEC-1", projectId: "hanoman", title: "Fitur", source: "brief", stage: "planned",
  priority: "sedang", author: "a", objective: "obj", branchFrom: null, baseSha: null,
  createdAt: "2026-08-01T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [], autoMerge: null,
};
const full = { ...item, payload: { context: "konteks-penuh", outcome: "o", constraints: "", priority: "sedang" }, sourceHistory: [] };

afterEach(() => vi.restoreAllMocks());

const mockFetch = (detail: () => Response) => vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
  const url = String(input);
  if (/\/specs\/SPEC-1$/.test(url)) return Promise.resolve(detail());
  const value = url.includes("/branches")
    ? { branches: ["main"], remotes: ["main"], defaultBranch: "main" }
    : { items: [item], total: 1, page: 1, pageSize: 20 };
  return Promise.resolve({ ok: true, status: 200, json: async () => value } as Response);
});

const renderScreen = (onToast = vi.fn()) => render(
  <BacklogScreen backlog={[item] as never} projects={[]} projectFilter="all" onProjectFilter={() => { }} onToast={onToast} />);

describe("detail backlog via GET /specs/:id (SPEC-1267)", () => {
  it("membuka detail memuat item penuh lewat getSpec", async () => {
    const spy = mockFetch(() => ({ ok: true, status: 200, json: async () => full } as Response));
    renderScreen();
    fireEvent.click(screen.getByText("Fitur"));
    await waitFor(() => expect(spy.mock.calls.some(([u]) => /\/specs\/SPEC-1$/.test(String(u)))).toBe(true));
  });

  it("404 menutup dialog dan memberi toast", async () => {
    mockFetch(() => ({ ok: false, status: 404, json: async () => ({ error: "spec tak ditemukan" }), text: async () => "spec tak ditemukan" } as Response));
    const onToast = vi.fn();
    renderScreen(onToast);
    fireEvent.click(screen.getByText("Fitur"));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("SPEC-1"), "warn"));
  });
});
