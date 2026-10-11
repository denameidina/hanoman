import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { TeamBoard } from "../src/screens/team-board";
import { TEAM_COLUMNS, emptyBoard, type Board } from "../src/screens/team-rules";
import { mockViewport, resetViewport } from "./viewport";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p", title: "Desain", detail: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});
const member = (id: string, name: string): MemberView => ({
  id, name, email: id, role: null, active: true,
  createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
});

// jsdom tak punya `DataTransfer`; event drag dioper objek palsu, pola backlog-board.test.tsx:57.
const dt = () => ({ dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } });
const zeros = { backlog: 0, doing: 0, review: 0, done: 0 } as Record<TaskStatus, number>;

function board(over: Partial<Board>, totals: Partial<Record<TaskStatus, number>> = {}) {
  const b = { ...emptyBoard(), ...over };
  const onMove = vi.fn(), onAssign = vi.fn(), onOpen = vi.fn(), onEscalate = vi.fn(), onUnlink = vi.fn();
  render(<TeamBoard board={b} totals={{ ...zeros, ...totals }} columns={TEAM_COLUMNS}
    members={[member("a@x.id", "Dena")]} onMove={onMove} onAssign={onAssign} onOpen={onOpen}
    onEscalate={onEscalate} onUnlink={onUnlink} />);
  return { onMove, onAssign, onOpen, onEscalate, onUnlink };
}
const column = (key: TaskStatus) => screen.getByTestId(`team-col-${key}`);

describe("TeamBoard · kolom", () => {
  it("merender empat kolom milik manusia", () => {
    board({});
    for (const c of TEAM_COLUMNS) expect(column(c.key)).toBeInTheDocument();
  });

  /* Plafon langganan 200/kolom. Board yang diam-diam memotong terbaca sebagai board yang
     lengkap — dan itu kebohongan yang paling mahal di layar ini. */
  it("menyebut jumlah yang tak tertampil saat kolom melewati plafon", () => {
    board({ done: [task({ id: "d1", status: "done" })] }, { done: 340 });
    expect(screen.getByText(/menampilkan 1 dari 340/i)).toBeInTheDocument();
  });

  it("tak menyebut apa pun saat kolom utuh", () => {
    board({ done: [task({ id: "d1", status: "done" })] }, { done: 1 });
    expect(screen.queryByText(/menampilkan/i)).toBeNull();
  });
});

/* Wiring: aturan `canDropTask` sudah benar di unit test-nya, tapi `from`/`to` bisa tertukar saat
   dipasang. Ini men-drag kartu SUNGGUHAN di jsdom, bukan memanggil aturannya lagi. */
describe("TeamBoard · drag sungguhan", () => {
  it("drop lintas kolom memanggil onMove dengan kolom TUJUAN", () => {
    const { onMove } = board({ backlog: [task({ id: "a" })] });
    fireEvent.dragStart(screen.getByTestId("team-card-a"), dt());
    fireEvent.drop(column("review"), dt());
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0]![0].id).toBe("a");
    expect(onMove.mock.calls[0]![1]).toBe("review");
  });

  it("keempat kolom menerima drop — kebalikan board Backlog", () => {
    const { onMove } = board({ done: [task({ id: "z", status: "done" })] });
    fireEvent.dragStart(screen.getByTestId("team-card-z"), dt());
    fireEvent.drop(column("backlog"), dt());
    expect(onMove.mock.calls[0]![1]).toBe("backlog");
  });

  it("drop ke kolom asal tak memanggil apa pun", () => {
    const { onMove } = board({ doing: [task({ id: "a", status: "doing" })] });
    fireEvent.dragStart(screen.getByTestId("team-card-a"), dt());
    fireEvent.drop(column("doing"), dt());
    expect(onMove).not.toHaveBeenCalled();
  });
});

/* Drag HTML5 mati total di keyboard dan di layar sentuh; jalur itu sekarang satu menu "Ubah…" per
   kartu (Modal DS: fokus terkurung, Escape, fokus kembali). Audit 2026-10 menggantikan dua Select. */
describe("TeamBoard · aksi eksplisit kartu", () => {
  it("Pindah kolom lewat menu mengirim mutasi yang sama dengan drag", () => {
    const { onMove } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    fireEvent.click(screen.getByRole("button", { name: "Pindah ke Selesai" }));
    expect(onMove.mock.calls[0]![1]).toBe("done");
  });

  it("kolom sendiri tak ditawarkan sebagai tujuan pindah", () => {
    board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    expect(screen.queryByRole("button", { name: "Pindah ke Menunggu" })).toBeNull();
  });

  it("Tugaskan lewat menu mengirim id anggota; Kosongkan penugasan mengirim null", () => {
    const { onAssign } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    fireEvent.click(screen.getByRole("button", { name: "Tugaskan ke Dena" }));
    expect(onAssign.mock.calls[0]![1]).toBe("a@x.id");
  });

  it("Kosongkan penugasan mengirim null untuk kartu yang sudah ditugaskan", () => {
    const { onAssign } = board({ backlog: [task({ id: "a", title: "Desain", memberId: "a@x.id" })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    fireEvent.click(screen.getByRole("button", { name: "Kosongkan penugasan" }));
    expect(onAssign.mock.calls[0]![1]).toBeNull();
  });

  it("judul membuka detail", () => {
    const { onOpen } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.click(screen.getByRole("button", { name: "Desain" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("TeamBoard · isi kartu", () => {
  // Kartu hanya judul, prioritas (titik), dan penanggung jawab. Tanggal pindah ke detail tugas.
  it("penanggung jawab dan prioritas terbaca; tanggal tak lagi di kartu", () => {
    board({ backlog: [task({
      id: "a", priority: "tinggi", memberId: "a@x.id",
      startDate: "2026-09-12T12:00:00.000Z", dueDate: "2026-09-20T12:00:00.000Z",
    })] });
    expect(screen.getByTitle("Prioritas Tinggi")).toBeInTheDocument();
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("Dena");
    expect(screen.getByTestId("team-card-a")).not.toHaveTextContent("→");
  });

  it("anggota yang tak ada di daftar dibaca 'belum ditugaskan', bukan id mentah", () => {
    board({ backlog: [task({ id: "a", memberId: "hantu@x.id" })] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("belum ditugaskan");
    expect(screen.getByTestId("team-card-a")).not.toHaveTextContent("hantu@x.id");
  });

  it("task tanpa project diberi label, bukan dibiarkan kosong (di tooltip kartu)", () => {
    board({ backlog: [task({ id: "a", projectId: null })] });
    expect(screen.getByTestId("team-card-a")).toHaveAttribute("title", "Project: tanpa project");
  });

  /* `specId` terisi + `spec` null = tautan putus (ADR-0150 keputusan 5). Keadaannya tetap terbaca,
     di label item menu "Ubah tugas", karena kartu hanya memuat judul, prioritas, dan penanggung jawab. */
  it("membedakan tautan hidup dari tautan putus di menu Ubah tugas", () => {
    const { unmount } = render(<TeamBoard board={{ ...emptyBoard(), backlog: [
      task({ id: "a", title: "A", specId: "SPEC-1", spec: { id: "SPEC-1", stage: "executing", priority: "tinggi" } }) ] }}
      totals={zeros} columns={TEAM_COLUMNS} members={[]} onMove={() => {}} onAssign={() => {}}
      onOpen={() => {}} onEscalate={() => {}} onUnlink={() => {}} onOpenSpec={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: A" }));
    expect(screen.getByRole("button", { name: "Buka SPEC-1 di Backlog" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lepas tautan (spec tak ditemukan)" })).toBeNull();
    unmount();
    board({ backlog: [task({ id: "b", title: "B", specId: "SPEC-9", spec: null })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: B" }));
    expect(screen.getByRole("button", { name: "Lepas tautan (spec tak ditemukan)" })).toBeInTheDocument();
  });
});

/* SPEC-947 · jembatan ke dunia agen. Aksi eksplisit, bukan menu: drag mati di keyboard dan layar
   sentuh, dan alasan itu pula yang sudah melahirkan dua Select di kartu. */
describe("TeamBoard · eskalasi", () => {
  it("kartu belum tertaut membawa aksi Kirim ke Backlog di menu Ubah tugas", () => {
    const { onEscalate } = board({ backlog: [task({ id: "a" })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim ke Backlog" }));
    expect(onEscalate).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("kartu tertaut menawarkan Lepas tautan di menu, TANPA Kirim ke Backlog", () => {
    const { onUnlink } = board({ backlog: [task({
      id: "a", specId: "SPEC-9", spec: { id: "SPEC-9", stage: "executing", priority: "tinggi" } })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    expect(screen.queryByRole("button", { name: "Kirim ke Backlog" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lepas tautan" }));
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  // `specId` terisi + `spec` null = tautan putus. Yang ditawarkan lepas tautan, bukan eskalasi
  // ulang: operator perlu melihat keadaan itu dulu.
  it("tautan putus ditawarkan Lepas tautan (dengan keterangannya), bukan eskalasi ulang", () => {
    const { onUnlink } = board({ backlog: [task({ id: "a", specId: "SPEC-hantu", spec: null })] });
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    fireEvent.click(screen.getByRole("button", { name: "Lepas tautan (spec tak ditemukan)" }));
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});

// Audit UI/UX 2026-10 · kartu Tim: nama project (bukan id), lencana spec bisa diklik ke Backlog,
// dan di mobile satu kolom per layar lewat pemilih kolom.
describe("TeamBoard · audit 2026-10", () => {
  afterEach(() => resetViewport());

  it("project kartu ada di tooltip (bukan id mentah); id yang tak dikenal jatuh ke label netral", () => {
    render(<TeamBoard board={{ ...emptyBoard(), backlog: [
        task({ id: "a", projectId: "p" }), task({ id: "b", projectId: "hilang" }) ] }}
      totals={zeros} columns={TEAM_COLUMNS} members={[]} projects={[{ id: "p", name: "Erp Toko" }]}
      onMove={() => {}} onAssign={() => {}} onOpen={() => {}} onEscalate={() => {}} onUnlink={() => {}} />);
    expect(screen.getByTestId("team-card-a")).toHaveAttribute("title", "Project: Erp Toko");
    expect(screen.getByTestId("team-card-b")).toHaveAttribute("title", "Project: project tak dikenal");
    expect(screen.getByTestId("team-card-b")).not.toHaveTextContent("hilang");
  });

  it("tautan spec yang hidup membuka spec-nya di Backlog dari menu Ubah tugas", () => {
    const onOpenSpec = vi.fn();
    render(<TeamBoard board={{ ...emptyBoard(), backlog: [
        task({ id: "a", specId: "SPEC-9", spec: { id: "SPEC-9", stage: "executing", priority: "tinggi" } }) ] }}
      totals={zeros} columns={TEAM_COLUMNS} members={[]} onMove={() => {}} onAssign={() => {}}
      onOpen={() => {}} onEscalate={() => {}} onUnlink={() => {}} onOpenSpec={onOpenSpec} />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah tugas: Desain" }));
    fireEvent.click(screen.getByRole("button", { name: "Buka SPEC-9 di Backlog" }));
    expect(onOpenSpec).toHaveBeenCalledWith("SPEC-9");
  });

  it("mobile: satu kolom per layar lewat pemilih kolom, bukan papan yang digeser", () => {
    mockViewport(390);
    render(<TeamBoard board={{ ...emptyBoard(), backlog: [task({ id: "a", title: "Desain" })] }}
      totals={zeros} columns={TEAM_COLUMNS} members={[]} onMove={() => {}} onAssign={() => {}}
      onOpen={() => {}} onEscalate={() => {}} onUnlink={() => {}} />);
    expect(screen.getByTestId("team-board")).toHaveAttribute("data-layout", "mobile");
    expect(screen.getByTestId("team-col-backlog")).toHaveTextContent("Desain");
    expect(screen.queryByTestId("team-col-done")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Selesai/ }));
    expect(screen.getByTestId("team-col-done")).toHaveTextContent("Tak ada tugas di Selesai.");
  });
});
