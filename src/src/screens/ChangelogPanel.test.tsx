import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangelogPanel } from "./ChangelogPanel";

const sources = {
  hasRepo: true, tags: ["v1.1.0", "v1.0.0"], head: "abc1234", reason: null,
  backlog: { doneCount: 3, earliest: null, latest: null },
  defaultRange: { from: "2026-07-05", to: "2026-08-03" },
};

vi.mock("../api/client", () => ({
  api: {
    changelogSources: vi.fn(async () => sources),
    listChangelogs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    generateChangelog: vi.fn(async () => ({
      id: "c1", projectId: "p1", mode: "backlog", title: "Juli", params: {},
      body: "# Changelog — Juli\n\n- **Butir** — manfaatnya.\n",
      generator: "agent", warning: null, itemCount: 1, createdAt: "2026-08-03T00:00:00.000Z",
    })),
    deleteChangelog: vi.fn(async () => undefined),
  },
}));

const props = { p: { id: "p1", name: "p1" } as never, onToast: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("ChangelogPanel", () => {
  it("mode backlog terpilih awal, rentang terisi default dari sources", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Dari tanggal")).toHaveValue("2026-07-05"));
    expect(screen.getByLabelText("Sampai tanggal")).toHaveValue("2026-08-03");
  });

  it("mode SHA menampilkan dua kolom revisi", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Rentang commit" }));
    fireEvent.click(screen.getByRole("button", { name: "Rentang commit" }));
    expect(screen.getByLabelText("Dari revisi")).toBeInTheDocument();
    expect(screen.getByLabelText("Sampai revisi")).toBeInTheDocument();
  });

  it("mode versi menawarkan tag dari sources", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Versi rilis" }));
    fireEvent.click(screen.getByRole("button", { name: "Versi rilis" }));
    await waitFor(() => expect(screen.getByLabelText("Versi")).toBeInTheDocument());
    expect(screen.getAllByRole("option", { name: "v1.1.0" }).length).toBeGreaterThan(0);
  });

  it("Bangkitkan merender hasil beserta tombol salin & unduh", async () => {
    const { api } = await import("../api/client");
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: /Bangkitkan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bangkitkan/ }));
    await waitFor(() => expect(api.generateChangelog).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Butir")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unduh .md" })).toBeInTheDocument();
  });

  it("warning dari server tampil ke operator", async () => {
    const { api } = await import("../api/client");
    (api.generateChangelog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "c2", projectId: "p1", mode: "backlog", title: "Juli", params: {},
      body: "# Changelog — Juli\n", generator: "fallback",
      warning: "Narasi otomatis tak tersedia — agen kehabisan waktu.",
      itemCount: 1, createdAt: "2026-08-03T00:00:00.000Z",
    });
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: /Bangkitkan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bangkitkan/ }));
    await waitFor(() => expect(screen.getByText(/Narasi otomatis tak tersedia/)).toBeInTheDocument());
  });

  it("repo tanpa tag: mode versi menjelaskan alasannya, tanpa tombol mati tanpa sebab", async () => {
    const { api } = await import("../api/client");
    (api.changelogSources as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...sources, tags: [], reason: "repo project ini belum punya tag rilis",
    });
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Versi rilis" }));
    fireEvent.click(screen.getByRole("button", { name: "Versi rilis" }));
    await waitFor(() => expect(screen.getByText(/belum punya tag rilis/)).toBeInTheDocument());
  });
});
