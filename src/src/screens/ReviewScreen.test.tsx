import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./ReviewScreen";

// ADR-0213/0215 · belum ada worktree maupun commit = keadaan kosong (200 `empty`), bukan galat 409.
// 409 hanya galat konfigurasi (repoDir belum diatur): pada jalur spec masih tampil sebagai keadaan kosong,
// pada jalur sesi tampil sebagai galat.
const json = (v: unknown, statusCode = 200) =>
  Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => v } as Response);

const file = { path: "a.txt", status: "A", binary: false, truncated: false, diff: "+x", content: "x" };

function mockReview(review: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (/\/review$/.test(url)) return json(review, status);
    if (url.includes("/review/")) return json(file);
    return json({});
  });
}
afterEach(() => vi.restoreAllMocks());

const screenFor = () => render(<ReviewScreen specId="SPEC-7" title="Judul" onBack={() => {}} />);
const EMPTY_TITLE = "Belum ada perubahan untuk ditinjau";

describe("ReviewScreen · keadaan kosong (ADR-0213)", () => {
  it("200 empty reason no-commit: teks tanpa-commit dan data-reason", async () => {
    mockReview({ base: "", files: [], changed: [], empty: true, reason: "no-commit" });
    const { container } = screenFor();
    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText(/belum ada commit untuk ditinjau/i)).toBeTruthy();
    expect(container.querySelector('[data-review-state="empty"]')?.getAttribute("data-reason")).toBe("no-commit");
  });

  it("200 empty reason no-worktree: teks belum membuat worktree", async () => {
    mockReview({ base: "", files: [], changed: [], empty: true, reason: "no-worktree" });
    const { container } = screenFor();
    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText(/belum membuat worktree/i)).toBeTruthy();
    expect(container.querySelector('[data-review-state="empty"]')?.getAttribute("data-reason")).toBe("no-worktree");
  });

  it("409 pada jalur spec (repoDir belum diatur) tetap keadaan kosong, tanpa galat merah", async () => {
    mockReview({ error: "project belum punya repoDir" }, 409);
    const { container } = screenFor();
    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(container.querySelector('[data-review-state="empty"]')?.getAttribute("data-reason")).toBe("409");
    expect(screen.queryByText("Gagal memuat review")).toBeNull();
  });

  it("200 empty pada jalur sesi (no-worktree): keadaan kosong, bukan galat", async () => {
    mockReview({ base: "", files: [], changed: [], empty: true, reason: "no-worktree" });
    const { container } = render(<ReviewScreen specId="sess1" title="PRD" onBack={() => {}} kind="session" />);
    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(container.querySelector('[data-review-state="empty"]')?.getAttribute("data-reason")).toBe("no-worktree");
    expect(screen.queryByText("Gagal memuat review")).toBeNull();
  });

  it("409 pada jalur sesi adalah galat (ADR-0215), bukan keadaan kosong", async () => {
    mockReview({ error: "project belum punya repoDir" }, 409);
    render(<ReviewScreen specId="sess1" title="PRD" onBack={() => {}} kind="session" />);
    expect(await screen.findByText("Gagal memuat review")).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it("isi biasa (tanpa `empty`) tidak memunculkan keadaan kosong", async () => {
    mockReview({
      base: "main", files: ["a.txt"],
      changed: [{ path: "a.txt", add: 1, del: 0, status: "A", binary: false }],
    });
    screenFor();
    expect((await screen.findAllByText("a.txt")).length).toBeGreaterThan(0);
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });
});
