import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-384 · berkas ini dulu menguji kartu DSN (project-dsn.test.tsx). Kartu itu dicabut bersama
// error monitoring (ADR-0092), tapi regresi yang dijaganya — SPEC-258, status hasil mutasi in-card
// yang hilang saat layar re-mount — TIDAK ikut tercabut: kartu Help Center memakai pola
// `onProjectChanged` yang persis sama dan tak punya test lain. Test itu dipindahkan ke sini.
const { enableHelpCenter, disableHelpCenter } = vi.hoisted(() => ({
  enableHelpCenter: vi.fn(async () => ({ enabled: true, publicUrl: "http://h/help/a" })),
  disableHelpCenter: vi.fn(async () => undefined),
}));
vi.mock("../src/api/client", () => ({
  api: { enableHelpCenter, disableHelpCenter },
  ApiError: class extends Error {},
}));
// Kartu tetangga di layar yang sama self-fetch (AutoMergeCard → `listBranches`, CustomAgentsPanel
// → katalog agen) dan bukan subjek berkas ini; tanpa di-noop, keempat test mati di render pertama
// dengan "api.listBranches is not a function" — merah yang tak ada hubungannya dengan Help Center.
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
vi.mock("../src/screens/CustomAgentsPanel", () => ({ CustomAgentsPanel: () => null }));

import { ProjectDetailScreen } from "../src/screens/ProjectDetailScreen";

const base = {
  id: "a", name: "Alpha", desc: "d", kind: "existing", repoDir: "/r", binding: null, gitRemote: null,
  stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 0, topStage: "spec", activity: "idle", commit: "—",
  session: { status: "idle", phase: null, flow: null },
} as const;
const vm = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as Parameters<typeof ProjectDetailScreen>[0]["p"];

const noop = vi.fn();
const props = { onEdit: noop, onGotoDocs: noop, onGotoTerminal: noop, onGotoBacklog: noop,
  onGotoChangelog: noop, onDelete: noop, onToast: noop };   // SPEC-519 · pintu Changelog

beforeEach(() => { enableHelpCenter.mockClear(); disableHelpCenter.mockClear(); });

describe("Help Center management (SPEC-253)", () => {
  it("project tanpa Help Center menampilkan Aktifkan; klik memanggil API", async () => {
    render(<ProjectDetailScreen p={vm({ helpEnabled: false })} {...props} />);
    fireEvent.click(screen.getByText("Aktifkan"));
    await waitFor(() => expect(enableHelpCenter).toHaveBeenCalledWith("a"));
    expect(await screen.findByText(/\/help\/a$/)).toBeInTheDocument();
  });

  it("project ber-Help Center menampilkan link publik + Nonaktifkan", () => {
    render(<ProjectDetailScreen p={vm({ helpEnabled: true })} {...props} />);
    expect(screen.getByText(/\/help\/a$/)).toBeInTheDocument();
    expect(screen.getByText("Nonaktifkan")).toBeInTheDocument();
    expect(screen.getByText("Salin")).toBeInTheDocument();
  });

  // SPEC-847 · konfirmasinya kini dialog aplikasi, jadi test ini menekan tombol sungguhan
  // alih-alih mem-mock window.confirm. Ada DUA tombol "Nonaktifkan" saat dialog terbuka
  // (pemicu di kartu + konfirmasi di dialog) — query disempitkan ke dalam dialognya.
  it("Nonaktifkan memanggil API sesudah konfirmasi", async () => {
    render(<ProjectDetailScreen p={vm({ helpEnabled: true })} {...props} />);
    fireEvent.click(screen.getByText("Nonaktifkan"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/tetap bisa ditriase/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));
    await waitFor(() => expect(disableHelpCenter).toHaveBeenCalledWith("a"));
  });

  it("membatalkan konfirmasi TIDAK menonaktifkan Help Center", async () => {
    render(<ProjectDetailScreen p={vm({ helpEnabled: true })} {...props} />);
    fireEvent.click(screen.getByText("Nonaktifkan"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(disableHelpCenter).not.toHaveBeenCalled();
  });

  // SPEC-258 · Regresi: status yang baru diubah tak boleh "hilang" saat layar di-refresh
  // (re-mount). Akar: mutasi lokal kartu tak dirambatkan ke state project App, jadi re-mount
  // membaca prop basi (helpEnabled=false). Fix: onProjectChanged → App refetch VM.
  it("status Help Center bertahan sesudah re-mount begitu induknya menyegarkan VM (SPEC-258)", async () => {
    function Harness() {
      // Meniru state `projects` App: awalnya Help Center belum aktif.
      const [proj, setProj] = React.useState(vm({ helpEnabled: false }));
      const [nav, setNav] = React.useState(0); // pindah section lalu balik = re-mount
      // Meniru App.refreshProject: fetch VM segar dari server (server sudah persist enabled=true).
      const onProjectChanged = async () => setProj(vm({ helpEnabled: true }));
      return (
        <>
          <button onClick={() => setNav((n) => n + 1)}>renav</button>
          <ProjectDetailScreen key={nav} p={proj} {...props} onProjectChanged={onProjectChanged} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("Aktifkan"));
    await waitFor(() => expect(enableHelpCenter).toHaveBeenCalledWith("a"));
    // Re-mount layar (refresh). Tanpa perbaikan, prop tetap basi → balik ke "Aktifkan".
    fireEvent.click(screen.getByText("renav"));
    expect(await screen.findByText("Nonaktifkan")).toBeInTheDocument();
    expect(screen.getByText(/\/help\/a$/)).toBeInTheDocument();
    expect(screen.queryByText("Aktifkan")).not.toBeInTheDocument();
  });
});
