import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangelogScreen } from "./ChangelogScreen";

const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", projectId: "p1", mode: "version", title: "v1.2.0", params: {},
  body: "# v1.2.0\n\n- **Unduh laporan** — sekarang bisa PDF.\n",
  generator: "agent", warning: null, itemCount: 7, createdAt: "2026-08-01T03:00:00.000Z", ...over,
});

vi.mock("../api/client", () => ({
  api: {
    changelogSources: vi.fn(async () => ({
      hasRepo: true, tags: [], head: null, reason: null,
      backlog: { doneCount: 0, earliest: null, latest: null },
      defaultRange: { from: "2026-07-05", to: "2026-08-03" },
    })),
    generateChangelog: vi.fn(),
    listChangelogs: vi.fn(async () => ({
      items: [row(), row({ id: "c2", title: "Juli 2026", mode: "backlog" })],
      total: 2, page: 1, pageSize: 12,
    })),
    getChangelog: vi.fn(async () => row({ id: "c9", title: "v0.9.0" })),
    deleteChangelog: vi.fn(async () => undefined),
  },
}));

const props = { p: { id: "p1", name: "p1" } as never, onToast: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("ChangelogScreen (SPEC-519)", () => {
  it("menampilkan daftar rilis di area yang bisa digulir", async () => {
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(screen.getByText("v1.2.0")).toBeInTheDocument());
    expect(screen.getByText("Juli 2026")).toBeInTheDocument();
    const list = screen.getByTestId("changelog-list");
    expect(list).toHaveStyle({ overflowY: "auto" });
  });

  it("mengetik di kotak cari memanggil daftar dengan q", async () => {
    const { api } = await import("../api/client");
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(api.listChangelogs).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Cari rilis"), { target: { value: "laporan" } });
    await waitFor(() => expect(api.listChangelogs).toHaveBeenLastCalledWith("p1",
      expect.objectContaining({ q: "laporan", page: 1 })));
  });

  it("klik satu rilis merender badan changelog-nya", async () => {
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(screen.getByText("v1.2.0")).toBeInTheDocument());
    fireEvent.click(screen.getByText("v1.2.0"));
    await waitFor(() => expect(screen.getByText("Unduh laporan")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Unduh .md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salin link" })).toBeInTheDocument();
  });

  it("cari tanpa hasil menjelaskan sebabnya, bukan daftar kosong bisu", async () => {
    const { api } = await import("../api/client");
    (api.listChangelogs as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    render(<ChangelogScreen {...props} />);
    fireEvent.change(screen.getByLabelText("Cari rilis"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText(/Tak ada rilis yang cocok/)).toBeInTheDocument());
  });

  it("belum ada rilis sama sekali: mengarahkan ke generator, bukan pesan cari", async () => {
    const { api } = await import("../api/client");
    (api.listChangelogs as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/Belum ada rilis/)).toBeInTheDocument());
  });

  // Deep-link `&cl=` bisa menunjuk rilis yang tak ada di halaman pertama — jadi diambil per-id,
  // bukan dicari di dalam daftar yang kebetulan termuat.
  it("initialChangelogId membuka rilis itu lewat getChangelog", async () => {
    const { api } = await import("../api/client");
    render(<ChangelogScreen {...props} initialChangelogId="c9" />);
    await waitFor(() => expect(api.getChangelog).toHaveBeenCalledWith("p1", "c9"));
    await waitFor(() => expect(screen.getByText("v0.9.0")).toBeInTheDocument());
  });
});
