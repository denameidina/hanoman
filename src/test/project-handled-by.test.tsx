import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listProjects: vi.fn(), listDeviceTokens: vi.fn() },
  ApiError: class extends Error {},
}));
import { ProjectsScreen } from "../src/screens/ProjectsScreen";
import { api } from "../src/api/client";

const P = (over: Record<string, unknown> = {}) => ({
  id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
  docStatus: "ok", coverage: 90, createdAt: "", backlog: 3, topStage: "execute",
  session: { status: "idle", phase: "", flow: "feature" }, activity: "", commit: "",
  handledBy: [], ...over,
});
const envelope = (items: unknown[]): any => ({ items, total: items.length, page: 1, pageSize: 20 });

beforeEach(() => {
  vi.mocked(api.listProjects).mockReset();
  vi.mocked(api.listDeviceTokens).mockReset();
  vi.mocked(api.listDeviceTokens).mockResolvedValue([]);
});

describe("SPEC-880 · daftar project: kolom 'Ditangani'", () => {
  it("baris punya sel Ditangani dan merender nama client", () => {
    render(<ProjectsScreen projects={[P({
      handledBy: [{ deviceId: "d1", name: "hm-dena", revoked: false }],
    })] as never} onOpen={() => {}} />);
    const row = screen.getByRole("button", { name: "Buka project arta" }).closest(".hn-project-row")!;
    expect(row.querySelector('[data-label="Ditangani"]')).toBeInTheDocument();
    expect(screen.getByText("hm-dena")).toBeInTheDocument();
  });

  it("tanpa penanda → 'belum ditetapkan', bukan sel kosong", () => {
    render(<ProjectsScreen projects={[P()] as never} onOpen={() => {}} />);
    expect(screen.getByText("belum ditetapkan")).toBeInTheDocument();
  });

  it("device dicabut ditandai, bukan disembunyikan", () => {
    render(<ProjectsScreen projects={[P({
      handledBy: [{ deviceId: "d1", name: "laptop-lama", revoked: true }],
    })] as never} onOpen={() => {}} />);
    expect(screen.getByText(/laptop-lama · dicabut/)).toBeInTheDocument();
  });

  it("view lama tanpa field handledBy tak meruntuhkan baris", () => {
    const legacy = P();
    delete (legacy as Record<string, unknown>).handledBy;
    render(<ProjectsScreen projects={[legacy] as never} onOpen={() => {}} />);
    expect(screen.getByText("belum ditetapkan")).toBeInTheDocument();
  });

  it("instance tanpa katalog device: filter tak dirender", async () => {
    render(<ProjectsScreen projects={[P()] as never} pageSize={20} dataVersion={0} />);
    await waitFor(() => expect(api.listDeviceTokens).toHaveBeenCalled());
    expect(screen.queryByLabelText("Saring per client")).toBeNull();
  });

  it("dengan katalog device: filter dirender dan meneruskan handledBy ke API", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([
      { id: "d1", name: "hm-dena", createdAt: "", lastSeenAt: null, revokedAt: null },
      { id: "d2", name: "sudah-dicabut", createdAt: "", lastSeenAt: null, revokedAt: "2026-08-01T00:00:00.000Z" },
    ] as never);
    vi.mocked(api.listProjects).mockResolvedValue(envelope([P()]));
    render(<ProjectsScreen projects={[P()] as never} pageSize={20} dataVersion={0} />);
    const select = await screen.findByLabelText("Saring per client");
    // device yang sudah dicabut tak ditawarkan sebagai pilihan baru
    expect(screen.queryByRole("option", { name: /sudah-dicabut/ })).toBeNull();
    (select as HTMLSelectElement).value = "d1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() =>
      expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).toMatchObject({ handledBy: "d1" }));
  });
});
