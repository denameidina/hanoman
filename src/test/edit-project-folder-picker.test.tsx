import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const PROJECT = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: "/repo/arta",
  binding: "/repo/arta", gitRemote: null, stack: "ts", docStatus: "ok", coverage: 100,
  createdAt: "2026-07-10T00:00:00.000Z", backlog: 1, topStage: "planned", activity: "idle",
  commit: "belum ada commit", session: { status: "idle", phase: null, flow: null },
};

// AutoMergeCard (SPEC-486) self-fetch `listBranches` saat detail project di-mount — bukan subjek di sini.
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    // SPEC-884 · App memuat status setup begitu auth diketahui; mock `api` parsial tanpa ini
    // melempar di efek dan terbaca seperti App-nya yang rusak (jebakan yang sama SPEC-739/786).
    setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
    listProjects: vi.fn(async () => ({ items: [PROJECT], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    updateProject: vi.fn(async (_id: string, b: any) => ({ ...PROJECT, ...b })),
    getProject: vi.fn(async () => PROJECT),
    putBinding: vi.fn(async () => ({ repoDir: "/tmp/x" })),
    deleteBinding: vi.fn(async () => {}),
    browseFs: vi.fn(async (path?: string) => ({
      path: path ?? "/home/dena",
      parent: "/home",
      entries: [{ name: "kirana", path: `${path ?? "/home/dena"}/kirana` }],
    })),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

async function openEdit() {
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByText("Projects")[0]!);
  fireEvent.click(screen.getAllByText("arta")[0]!);
  fireEvent.click(await screen.findByText("Edit project"));
}

describe("edit project folder picker (SPEC-858)", () => {
  it("field path berdampingan dengan tombol Pilih folder", async () => {
    await openEdit();
    expect(await screen.findByPlaceholderText("/path/ke/repo (mesin ini)")).toBeInTheDocument();
    expect(screen.getByText("Pilih folder")).toBeInTheDocument();
  });

  it("picker mulai dari f.dir dan hasil pilihnya mengisi field path lalu tersimpan", async () => {
    const { api } = await import("../src/api/client");
    await openEdit();
    fireEvent.click(await screen.findByText("Pilih folder"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalledWith("/repo/arta"));
    fireEvent.click(await screen.findByText("kirana"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalledWith("/repo/arta/kirana"));
    fireEvent.click(screen.getByText("Pilih folder ini"));

    const path = await screen.findByPlaceholderText("/path/ke/repo (mesin ini)");
    expect((path as HTMLInputElement).value).toBe("/repo/arta/kirana");
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect((api.putBinding as any)).toHaveBeenCalledWith("arta", "/repo/arta/kirana"));
  });

  it("path tetap bisa diketik manual sebagai fallback", async () => {
    const { api } = await import("../src/api/client");
    await openEdit();
    fireEvent.change(await screen.findByPlaceholderText("/path/ke/repo (mesin ini)"),
      { target: { value: "/repo/manual" } });
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect((api.putBinding as any)).toHaveBeenCalledWith("arta", "/repo/manual"));
  });
});
