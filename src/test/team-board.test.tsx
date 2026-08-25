import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { TeamBoard } from "../src/screens/team-board";
import { TEAM_COLUMNS, emptyBoard, type Board } from "../src/screens/team-rules";

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

/* Drag HTML5 mati total di keyboard dan di layar sentuh; di sana dua Select ini SATU-SATUNYA jalan. */
describe("TeamBoard · aksi eksplisit kartu", () => {
  it("Pindah kolom mengirim mutasi yang sama dengan drag", () => {
    const { onMove } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.change(screen.getByLabelText("Pindah kolom: Desain"), { target: { value: "done" } });
    expect(onMove.mock.calls[0]![1]).toBe("done");
  });

  it("Tugaskan mengirim id anggota, dan kosong berarti null", () => {
    const { onAssign } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    const sel = screen.getByLabelText("Tugaskan: Desain");
    fireEvent.change(sel, { target: { value: "a@x.id" } });
    expect(onAssign.mock.calls[0]![1]).toBe("a@x.id");
    fireEvent.change(sel, { target: { value: "" } });
    expect(onAssign.mock.calls[1]![1]).toBeNull();
  });

  it("judul membuka detail", () => {
    const { onOpen } = board({ backlog: [task({ id: "a", title: "Desain" })] });
    fireEvent.click(screen.getByRole("button", { name: "Desain" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("TeamBoard · isi kartu", () => {
  it("assignee, tanggal, dan prioritas terbaca", () => {
    board({ backlog: [task({
      id: "a", priority: "tinggi", memberId: "a@x.id",
      startDate: "2026-09-12T12:00:00.000Z", dueDate: "2026-09-20T12:00:00.000Z",
    })] });
    expect(screen.getByText("tinggi")).toBeInTheDocument();
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("Dena");
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("→");
  });

  it("anggota yang tak ada di daftar dibaca 'belum ditugaskan', bukan id mentah", () => {
    board({ backlog: [task({ id: "a", memberId: "hantu@x.id" })] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("belum ditugaskan");
    expect(screen.getByTestId("team-card-a")).not.toHaveTextContent("hantu@x.id");
  });

  it("task tanpa project diberi label, bukan dibiarkan kosong", () => {
    board({ backlog: [task({ id: "a", projectId: null })] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("tanpa project");
  });

  /* `specId` terisi + `spec` null = tautan putus (ADR-0150 keputusan 5). Bedanya dengan "tak
     pernah dieskalasi" harus TERLIHAT. Aksinya item C. */
  it("membedakan tautan hidup dari tautan putus", () => {
    board({ backlog: [
      task({ id: "a", specId: "SPEC-1", spec: { id: "SPEC-1", stage: "executing", priority: "tinggi" } }),
      task({ id: "b", specId: "SPEC-9", spec: null }),
    ] });
    expect(screen.getByTestId("team-card-a")).toHaveTextContent("SPEC-1");
    expect(screen.getByTestId("team-card-b")).toHaveTextContent("tautan putus");
  });
});

/* SPEC-947 · jembatan ke dunia agen. Aksi eksplisit, bukan menu: drag mati di keyboard dan layar
   sentuh, dan alasan itu pula yang sudah melahirkan dua Select di kartu. */
describe("TeamBoard · eskalasi", () => {
  it("kartu belum tertaut membawa aksi Eskalasi", () => {
    const { onEscalate } = board({ backlog: [task({ id: "a" })] });
    fireEvent.click(screen.getByRole("button", { name: /eskalasi.*desain/i }));
    expect(onEscalate).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("kartu tertaut merender lencana SPEC + aksi Lepas tautan, TANPA aksi eskalasi", () => {
    const { onUnlink } = board({ backlog: [task({
      id: "a", specId: "SPEC-9", spec: { id: "SPEC-9", stage: "executing", priority: "tinggi" } })] });
    expect(screen.getByText("SPEC-9 · executing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /eskalasi/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /lepas tautan.*desain/i }));
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  // `specId` terisi + `spec` null = tautan putus. Yang ditawarkan lepas tautan, bukan eskalasi
  // ulang: operator perlu melihat keadaan itu dulu.
  it("tautan putus merender lencananya + aksi Lepas tautan", () => {
    const { onUnlink } = board({ backlog: [task({ id: "a", specId: "SPEC-hantu", spec: null })] });
    expect(screen.getByText(/tautan putus/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /lepas tautan.*desain/i }));
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});
