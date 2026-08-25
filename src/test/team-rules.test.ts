import { describe, it, expect } from "vitest";
import type { TaskView } from "@hanoman/shared";
import {
  TEAM_COLUMNS, emptyBoard, canDropTask, nextOrder, moveCard, replaceCard,
  dateInputValue, dateInputToIso,
} from "../src/screens/team-rules";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p", title: "Desain", detail: null, status: "backlog",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});

describe("TEAM_COLUMNS", () => {
  it("empat kolom, urutannya TASK_STATUSES", () => {
    expect(TEAM_COLUMNS.map((c) => c.key)).toEqual(["backlog", "doing", "review", "done"]);
    expect(TEAM_COLUMNS.map((c) => c.label)).toEqual(["Backlog", "Dikerjakan", "Review", "Selesai"]);
  });
});

/* Di board Backlog `canDrop` MENYEMPIT — `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024).
   Di sini aturannya berbalik: `Task.status` milik manusia. */
describe("canDropTask", () => {
  it("semua kolom saling menerima", () => {
    expect(canDropTask("backlog", "done")).toBe(true);
    expect(canDropTask("done", "backlog")).toBe(true);
    expect(canDropTask("review", "doing")).toBe(true);
  });
  it("kolom asal ditolak — itu bukan perpindahan", () => {
    expect(canDropTask("doing", "doing")).toBe(false);
  });
});

describe("nextOrder", () => {
  it("kolom kosong mulai dari 0", () => {
    expect(nextOrder([])).toBe(0);
  });
  it("max + 1, tak peduli urutan masukan", () => {
    expect(nextOrder([{ order: 3 }, { order: 1 }, { order: 7 }])).toBe(8);
  });
  it("nilai negatif tetap menghasilkan urutan yang naik", () => {
    expect(nextOrder([{ order: -4 }])).toBe(-3);
  });
});

describe("moveCard", () => {
  it("memindahkan kartu antar-larik dan menghitung order tujuan", () => {
    const board = emptyBoard();
    board.backlog = [task({ id: "a" })];
    board.doing = [task({ id: "b", status: "doing", order: 5 })];
    const r = moveCard(board, "a", "backlog", "doing")!;
    expect(r.patch).toEqual({ status: "doing", order: 6 });
    expect(r.board.backlog).toEqual([]);
    expect(r.board.doing.map((t) => t.id)).toEqual(["b", "a"]);
    // Kartu yang berpindah membawa nilai BARU-nya, bukan nilai lama: papan optimistis dan
    // muatan PATCH lahir dari satu fungsi supaya keduanya tak bisa berselisih.
    expect(r.board.doing[1]!.status).toBe("doing");
    expect(r.board.doing[1]!.order).toBe(6);
  });
  it("papan asal tak dimutasi", () => {
    const board = emptyBoard();
    board.backlog = [task({ id: "a" })];
    moveCard(board, "a", "backlog", "review");
    expect(board.backlog.map((t) => t.id)).toEqual(["a"]);
  });
  it("null untuk kolom yang sama, dan untuk id yang tak ada", () => {
    const board = emptyBoard();
    board.backlog = [task({ id: "a" })];
    expect(moveCard(board, "a", "backlog", "backlog")).toBeNull();
    expect(moveCard(board, "hantu", "backlog", "doing")).toBeNull();
  });
});

describe("replaceCard", () => {
  it("mengganti kartu di kolomnya sendiri tanpa memindahkannya", () => {
    const board = emptyBoard();
    board.doing = [task({ id: "a", status: "doing" }), task({ id: "b", status: "doing" })];
    const next = replaceCard(board, task({ id: "a", status: "doing", memberId: "x@y.id" }));
    expect(next.doing.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.doing[0]!.memberId).toBe("x@y.id");
  });
});

/* `<input type="date">` memancarkan YYYY-MM-DD; `zCreateTask` menuntut ISO 8601 BER-OFFSET.
   Mengirim nilai input apa adanya dijawab 400 oleh route — tanpa satu pun petunjuk di layar. */
describe("konversi tanggal", () => {
  it("iso → nilai input", () => {
    expect(dateInputValue("2026-09-12T12:00:00.000Z")).toBe("2026-09-12");
    expect(dateInputValue(null)).toBe("");
  });
  it("nilai input → iso ber-offset", () => {
    expect(dateInputToIso("2026-09-12")).toBe("2026-09-12T12:00:00.000Z");
  });
  it("bolak-balik tak menggeser tanggal", () => {
    expect(dateInputValue(dateInputToIso("2026-09-12"))).toBe("2026-09-12");
  });
  it("kosong & bentuk asing jadi null, bukan Invalid Date", () => {
    expect(dateInputToIso("")).toBeNull();
    expect(dateInputToIso("besok")).toBeNull();
  });
});
