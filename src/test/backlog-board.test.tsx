import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  // listSpecs default vi.fn() → undefined; BacklogScreen optional-call-nya no-op, jadi test
  // di bawah render dari prop `backlog` (seed). Test SPEC-198 mengeset mockResolvedValue sendiri.
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen, specColumn, canDrop } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null, ...over }) as Spec;

describe("specColumn", () => {
  it("spec tanpa sesi duduk di Backlog", () => {
    expect(specColumn(spec())).toBe("backlog");
  });
  it("stage done selalu Success", () => {
    expect(specColumn(spec({ stage: "done" }), true)).toBe("success");
  });
  it("sesi hidup di stage awal memindahkan kartu keluar dari Backlog", () => {
    expect(specColumn(spec({ stage: "brainstorming" }), true)).toBe("brainstorming");
  });
  it("sesi hidup meninggalkan spec di kolom stage-nya", () => {
    expect(specColumn(spec({ stage: "executing" }), true)).toBe("executing");
  });
  it("stage maju tanpa sesi tidak diklaim balik ke Backlog", () => {
    expect(specColumn(spec({ stage: "spec-ready" }))).toBe("spec-ready");
  });
});

describe("canDrop", () => {
  it("Backlog → Brainstorm diterima", () => {
    expect(canDrop("backlog", "brainstorming")).toBe(true);
  });
  /* Kontrak kanban: kartu mendarat di kolom tempat ia dijatuhkan. Run selalu mulai dari
     awal pipeline, jadi drop di Execute dulu menerimanya lalu melempar kartu ke Brainstorm. */
  it("Backlog → kolom kerja selain Brainstorm ditolak", () => {
    expect(canDrop("backlog", "objective")).toBe(false);
    expect(canDrop("backlog", "executing")).toBe(false);
  });
  it("kolom yang mengikuti fase agen tidak menerima apa pun", () => {
    expect(canDrop("spec-ready", "executing")).toBe(false);
    expect(canDrop("executing", "done")).toBe(false);
    expect(canDrop("backlog", "success")).toBe(false);
  });
});

/* Wiring: aturan di atas benar, tapi from/to bisa tertukar saat dipasang. Ini men-drag
   kartu sungguhan di jsdom, bukan memanggil canDrop lagi. */
const DRAGGABLE = "Seret ke Brainstorm untuk memulai sesi";
const AGENT_OWNED = "Stage mengikuti fase yang dilaporkan agen — kartu tak bisa dipindah";
const dt = () => ({ dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } });
// { selector: "span" } — sejak SPEC-178 label stage juga muncul di <option> filter stage;
// header kolom board adalah <span class="hn-eyebrow">, jadi scope ke span agar tak ambigu.
const column = (label: string) => screen.getByText(label, { selector: "span" }).closest("div")!.parentElement!;

function board(specs: Spec[], activeSpecs?: Set<string>) {
  const onStart = vi.fn();
  render(<BacklogScreen backlog={specs} projects={[{ id: "p", name: "p" }] as never}
    activeSpecs={activeSpecs} onStart={onStart}
    projectFilter="all" onProjectFilter={() => {}} />);
  fireEvent.click(screen.getByText("Board"));
  return onStart;
}

describe("tombol Review (SPEC-171)", () => {
  it("klik Review memanggil onOpenReview dengan spec-nya", () => {
    const onOpenReview = vi.fn();
    render(<BacklogScreen backlog={[spec({ title: "x" })]} projects={[{ id: "p", name: "p" }] as never}
      onOpenReview={onOpenReview} projectFilter="all" onProjectFilter={() => {}} />);
    fireEvent.click(screen.getByText("Review"));
    expect(onOpenReview).toHaveBeenCalledOnce();
    expect(onOpenReview.mock.calls[0]![0].id).toBe("SPEC-1");
  });
});

describe("Integrasi rebase/merge (SPEC-175)", () => {
  it("SpecDetail spec done menampilkan aksi Rebase / Merge", async () => {
    render(<BacklogScreen backlog={[spec({ id: "SPEC-9", stage: "done", title: "done spec" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onIntegrate={() => {}} />);
    fireEvent.click(screen.getByText("done spec"));            // buka detail
    fireEvent.click(await screen.findByRole("button", { name: /rebase \/ merge/i }));
    expect(await screen.findByLabelText("Target")).toBeTruthy();
  });
  it("SpecDetail spec belum done tak menampilkan Rebase / Merge", () => {
    render(<BacklogScreen backlog={[spec({ id: "SPEC-8", stage: "planned", title: "wip spec" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onIntegrate={() => {}} />);
    fireEvent.click(screen.getByText("wip spec"));
    expect(screen.queryByRole("button", { name: /rebase \/ merge/i })).toBeNull();
  });
});

describe("Edit backlog (SPEC-186)", () => {
  const editable = spec({ id: "SPEC-5", title: "judul lama", stage: "brainstorming", baseSha: null,
    payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });

  it("item belum dimulai: klik Edit → ubah judul → Simpan memanggil onEditSpec", async () => {
    const onEditSpec = vi.fn();
    render(<BacklogScreen backlog={[editable]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onEditSpec={onEditSpec} />);
    fireEvent.click(screen.getByText("judul lama"));                 // buka detail
    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const judul = screen.getByLabelText("Judul") as HTMLInputElement;
    fireEvent.change(judul, { target: { value: "judul baru" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    expect(onEditSpec).toHaveBeenCalledOnce();
    expect(onEditSpec.mock.calls[0]![0].id).toBe("SPEC-5");
    expect(onEditSpec.mock.calls[0]![1].title).toBe("judul baru");
  });

  it("item sudah dimulai (baseSha) tak menampilkan tombol Edit", () => {
    const started = spec({ id: "SPEC-6", title: "wip", stage: "brainstorming", baseSha: "abc123" });
    render(<BacklogScreen backlog={[started]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onEditSpec={() => {}} />);
    fireEvent.click(screen.getByText("wip"));
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });
});

// SPEC-237 · source audit tampil sebagai "Audit" (bukan "feature brief").
describe("source audit (SPEC-237)", () => {
  it("kartu spec audit berlabel Audit, bukan feature brief", () => {
    render(<BacklogScreen backlog={[spec({ id: "SPEC-237", title: "audit funnel", source: "audit" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
    // "Audit" muncul di tab filter DAN badge kartu → >1; brief hanya di tab (=1).
    expect(screen.getAllByText("Audit").length).toBeGreaterThan(1);
    expect(screen.queryByText("feature brief")).toBeNull();
  });
  it("SpecDetail audit menampilkan 'Jadikan Finding QA' → memanggil onPromoteToQa", async () => {
    const onPromoteToQa = vi.fn();
    render(<BacklogScreen backlog={[spec({ id: "SPEC-237", title: "audit funnel", source: "audit" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onPromoteToQa={onPromoteToQa} />);
    fireEvent.click(screen.getByText("audit funnel"));          // buka detail
    fireEvent.click(await screen.findByRole("button", { name: /jadikan finding qa/i }));
    expect(onPromoteToQa).toHaveBeenCalledOnce();
    expect(onPromoteToQa.mock.calls[0]![0].id).toBe("SPEC-237");
  });
  it("SpecDetail brief tak menampilkan 'Jadikan Finding QA'", () => {
    render(<BacklogScreen backlog={[spec({ id: "SPEC-9", title: "brief x", source: "brief" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onPromoteToQa={() => {}} />);
    fireEvent.click(screen.getByText("brief x"));
    expect(screen.queryByRole("button", { name: /jadikan finding qa/i })).toBeNull();
  });
});

describe("board drag (jsdom)", () => {
  it("Backlog → Brainstorm memanggil onStart dengan spec yang diseret", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Brainstorm"), dt());
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0]![0].id).toBe("SPEC-1");
  });

  it("Backlog → Execute ditolak: kartu akan mendarat di Brainstorm, bukan Execute", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Execute"), dt());
    expect(onStart).not.toHaveBeenCalled();
  });

  it("Backlog → Success ditolak, tak ada sesi yang dimulai", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Success"), dt());
    expect(onStart).not.toHaveBeenCalled();
  });

  /* Drag mati di keyboard dan layar sentuh, jadi tiap kartu board wajib punya tombolnya. */
  it("spec yang stage-nya maju tanpa sesi tak bisa diseret, tapi punya tombol Lanjutkan", () => {
    const onStart = board([spec({ stage: "planned" })]);
    expect(screen.queryByTitle(DRAGGABLE)).toBeNull();
    expect(screen.getByTitle(AGENT_OWNED).getAttribute("draggable")).toBe("false");
    fireEvent.click(screen.getByText("Lanjutkan"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("spec di Backlog punya tombol Mulai, bukan hanya drag", () => {
    const onStart = board([spec()]);
    fireEvent.click(screen.getByText("Mulai"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("kartu spec dengan sesi hidup tak bisa diangkat", () => {
    board([spec({ stage: "planned" })], new Set(["SPEC-1"]));
    expect(screen.getByTitle(AGENT_OWNED).getAttribute("draggable")).toBe("false");
    expect(screen.queryByTitle(DRAGGABLE)).toBeNull();
  });
});

// SPEC-198 · daftar grid/list didorong server: item + total datang dari envelope, bukan slice klien.
describe("server-driven fetch (SPEC-198)", () => {
  it("fetch halaman terfilter via API lalu render item + total dari server", async () => {
    vi.mocked(api.listSpecs).mockResolvedValue({
      items: [spec({ id: "SPEC-77", title: "dari server" })], total: 42, page: 1, pageSize: 20,
    });
    render(<BacklogScreen backlog={[]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
    expect(await screen.findByText("dari server")).toBeTruthy();   // item dari server, bukan prop
    expect(screen.getByText("42 spec")).toBeTruthy();              // total dari envelope
    const params = vi.mocked(api.listSpecs).mock.calls[0]![0];
    expect(params).toMatchObject({ page: 1, limit: 20 });
  });
});

describe("responsive backlog controls (SPEC-763)", () => {
  it("keeps toolbar, filters, view modes, grid, and board overflow reachable", () => {
    render(<BacklogScreen backlog={[spec({ title: "responsive item" })]} projects={[{ id: "p", name: "P" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
    const controls = screen.getByRole("region", { name: "Kontrol backlog" });
    expect(controls).toHaveClass("hn-backlog-controls");
    expect(screen.getByRole("tablist", { name: "Sumber backlog" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Mode tampilan" })).toBeInTheDocument();
    for (const label of ["Cari backlog", "Filter project", "Filter stage", "Filter prioritas", "Filter tanggal berdasarkan", "Tanggal dari", "Tanggal sampai"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByTestId("backlog-scroll")).toHaveClass("hn-backlog-grid");
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByTestId("backlog-board")).toHaveClass("hn-board-local-overflow");
    expect(screen.getByText("Mulai")).toBeInTheDocument();
  });
});
