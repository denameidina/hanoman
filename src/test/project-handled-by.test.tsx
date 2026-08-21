import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// `ProjectDetailScreen` merender AutoMergeCard & CustomAgentsPanel, jadi mock-nya harus memuat
// jalur yang mereka panggil saat mount — kalau tidak, komponennya melempar sebelum sempat dirender.
vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(), listDeviceTokens: vi.fn(),
    listBranches: vi.fn().mockResolvedValue({ branches: [], remotes: [], defaultBranch: null }),
    listCustomAgents: vi.fn().mockResolvedValue([]),
    getCustomAgentCatalog: vi.fn().mockResolvedValue({ tools: [], models: [], runtimes: [] }),
  },
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

import { EditProjectModal } from "../src/App";
import { ProjectDetailScreen } from "../src/screens/ProjectDetailScreen";

const DETAIL_PROPS = {
  onEdit: () => {}, onGotoDocs: () => {}, onGotoTerminal: () => {}, onGotoBacklog: () => {},
  onGotoChangelog: () => {}, onDelete: () => {}, onToast: () => {},
};

describe("SPEC-880 · detail project", () => {
  it("penanda tampil di panel info dan dinyatakan DISYNC", () => {
    render(<ProjectDetailScreen p={P({
      handledBy: [{ deviceId: "d1", name: "hm-dena", revoked: false }],
    }) as never} {...DETAIL_PROPS} />);
    expect(screen.getByText("Ditangani oleh · disync")).toBeInTheDocument();
    expect(screen.getByText("hm-dena")).toBeInTheDocument();
  });

  it("repo tetap dinyatakan fakta mesin ini saja", () => {
    render(<ProjectDetailScreen p={P({ binding: "/tmp/arta" }) as never} {...DETAIL_PROPS} />);
    expect(screen.getByText("Repo · mesin ini")).toBeInTheDocument();
  });
});

describe("SPEC-880 · editor penanda di EditProjectModal", () => {
  it("dengan katalog device: multi-select dirender dan nilai tersimpan terpilih", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([
      { id: "d1", name: "hm-dena", createdAt: "", lastSeenAt: null, revokedAt: null },
    ] as never);
    render(<EditProjectModal open project={P({
      handledBy: [{ deviceId: "d1", name: "hm-dena", revoked: false }],
    }) as never} onClose={() => {}} onSave={() => {}} />);
    expect(await screen.findByLabelText("Pilih hanoman client")).toBeInTheDocument();
    expect(screen.getByTestId("chip-d1")).toBeInTheDocument();
  });

  it("tanpa katalog device: baca-saja, nama tersimpan tetap terlihat, tak ada kontrol", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([] as never);
    render(<EditProjectModal open project={P({
      handledBy: [{ deviceId: "dev-hub", name: "hub-vps", revoked: false }],
    }) as never} onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => expect(api.listDeviceTokens).toHaveBeenCalled());
    expect(screen.getByText("hub-vps")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pilih hanoman client")).toBeNull();
    expect(screen.getByText(/hanya bisa diubah dari instance yang memegang katalog device/)).toBeInTheDocument();
  });

  // Inti K4: mengirim [] dari instance read-only akan MENGHAPUS nilai yang di-set di hub, dan
  // penghapusannya menyeberang. `undefined` = jangan sentuh.
  it("mode baca-saja menyimpan TANPA field handledBy", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([] as never);
    const onSave = vi.fn();
    render(<EditProjectModal open project={P({
      handledBy: [{ deviceId: "dev-hub", name: "hub-vps", revoked: false }],
    }) as never} onClose={() => {}} onSave={onSave} />);
    await waitFor(() => expect(api.listDeviceTokens).toHaveBeenCalled());
    screen.getByRole("button", { name: "Simpan" }).click();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toHaveProperty("handledBy", undefined);
  });
});
