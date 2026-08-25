import { describe, it, expect } from "vitest";
import type { TaskView } from "@hanoman/shared";
import {
  TEAM_COLUMNS, emptyBoard, canDropTask, nextOrder, moveCard, replaceCard,
  dateInputValue, dateInputToIso, taskSpan, taskDates,
  timelineWindow, zoomCell, MAX_TICKS,
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

/* SPEC-948 · rentang task. Akhir INKLUSIF: task yang mulai dan selesai di hari yang sama harus
   selebar satu hari, bukan nol — batang selebar nol tak terlihat sama sekali dan kartunya seolah
   tak bertanggal padahal bertanggal, tanpa satu pun galat. */
describe("taskSpan", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

  it("tanpa tanggal sama sekali = null — satu-satunya arti 'belum dijadwalkan'", () => {
    expect(taskSpan(task())).toBeNull();
  });

  it("mulai dan tenggat di hari yang SAMA selebar satu hari, bukan nol", () => {
    const s = taskSpan(task({ startDate: "2026-09-12T12:00:00.000Z", dueDate: "2026-09-12T12:00:00.000Z" }))!;
    expect(s.start).toBe(at("2026-09-12"));
    expect(s.end - s.start).toBe(DAY);
    expect(s.invalid).toBe(false);
  });

  it("rentang penuh berakhir di AKHIR hari tenggat", () => {
    const s = taskSpan(task({ startDate: "2026-09-01T12:00:00.000Z", dueDate: "2026-09-03T12:00:00.000Z" }))!;
    expect(s.start).toBe(at("2026-09-01"));
    expect(s.end).toBe(at("2026-09-04"));
  });

  // Kartu ber-`dueDate` saja adalah TENGGAT, dan tenggat justru hal yang dicari linimasa.
  it("satu tanggal saja tetap terjadwal — batang satu hari", () => {
    const only = taskSpan(task({ dueDate: "2026-09-12T12:00:00.000Z" }))!;
    expect(only.end - only.start).toBe(DAY);
    expect(only.start).toBe(at("2026-09-12"));
    expect(taskSpan(task({ startDate: "2026-09-12T12:00:00.000Z" }))!.start).toBe(at("2026-09-12"));
  });

  // Ditukar diam-diam = layar menampilkan rencana yang tak pernah diketik siapa pun.
  it("tenggat mendahului mulai digambar apa adanya dan DITANDAI", () => {
    const s = taskSpan(task({ startDate: "2026-09-10T12:00:00.000Z", dueDate: "2026-09-02T12:00:00.000Z" }))!;
    expect(s.invalid).toBe(true);
    expect(s.start).toBe(at("2026-09-02"));
    expect(s.end).toBe(at("2026-09-11"));
  });

  // `NaN` yang lolos meracuni Math.min seluruh papan — jendela jadi NaN dan kanvasnya kosong.
  it("tanggal tak sah jadi null, bukan NaN", () => {
    expect(taskSpan(task({ startDate: "besok", dueDate: null } as never))).toBeNull();
    expect(taskSpan(task({ startDate: "besok", dueDate: "2026-09-02T12:00:00.000Z" } as never))!.start)
      .toBe(at("2026-09-02"));
  });

  // Stempel ditulis TENGAH HARI UTC (`dateInputToIso`), jadi pembulatan harus UTC di kedua sisi.
  it("tengah hari UTC dibulatkan ke awal hari UTC yang sama", () => {
    expect(taskSpan(task({ startDate: "2026-09-12T12:00:00.000Z" }))!.start).toBe(at("2026-09-12"));
  });
});

/* Dipindah dari `team-board.tsx` supaya kanvas linimasa bisa memakainya tanpa mengimpor papan. */
describe("taskDates", () => {
  it("rentang penuh, tenggat saja, mulai saja, dan tanpa tanggal", () => {
    expect(taskDates(task({ startDate: "2026-09-01T12:00:00.000Z", dueDate: "2026-09-03T12:00:00.000Z" })))
      .toBe("1 Sep → 3 Sep");
    expect(taskDates(task({ dueDate: "2026-09-03T12:00:00.000Z" }))).toBe("→ 3 Sep");
    expect(taskDates(task({ startDate: "2026-09-01T12:00:00.000Z" }))).toBe("1 Sep");
    expect(taskDates(task())).toBeNull();
  });
});

describe("timelineWindow", () => {
  const DAY = 86_400_000;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  // 2026-09-12 adalah SABTU — dipilih supaya pembulatan ke Senin benar-benar bergerak.
  const TODAY = at("2026-09-12");
  const span = (a: string, b: string) => ({ start: at(a), end: at(b) + DAY, invalid: false });

  it("papan tanpa tanggal tetap punya sumbu, dan sumbu itu memuat HARI INI", () => {
    const w = timelineWindow([], "day", TODAY);
    expect(w.ticks.length).toBe(14);
    expect(w.from).toBeLessThanOrEqual(TODAY);
    expect(w.to).toBeGreaterThan(TODAY);
  });

  it("zoom hari: tick minimum 14, satu tick = satu hari", () => {
    const w = timelineWindow([span("2026-09-10", "2026-09-11")], "day", TODAY);
    expect(w.ticks.length).toBe(14);
    expect(w.ticks[1]!.start - w.ticks[0]!.start).toBe(DAY);
  });

  it("zoom minggu dibulatkan ke SENIN, bukan ke hari data", () => {
    const w = timelineWindow([span("2026-09-12", "2026-09-12")], "week", TODAY);
    // 2026-09-12 Sabtu → Senin sebelumnya 2026-09-07.
    expect(w.from).toBe(at("2026-09-07"));
    expect(new Date(w.from).getUTCDay()).toBe(1);
    expect(w.ticks[1]!.start - w.ticks[0]!.start).toBe(7 * DAY);
  });

  it("zoom bulan dibulatkan ke tanggal 1 dan ticknya satuan KALENDER", () => {
    const w = timelineWindow([span("2026-09-20", "2026-12-05")], "month", TODAY);
    expect(w.from).toBe(at("2026-09-01"));
    expect(w.ticks[0]!.start).toBe(at("2026-09-01"));
    expect(w.ticks[1]!.start).toBe(at("2026-10-01"));
    // Sep 30 hari, Okt 31 — tick bulan memang TIDAK sama lebar dalam hari.
    expect(w.ticks[1]!.start - w.ticks[0]!.start).toBe(30 * DAY);
    expect(w.ticks[2]!.start - w.ticks[1]!.start).toBe(31 * DAY);
  });

  it("jendela MENUTUPI seluruh data, bukan cuma tick minimum", () => {
    const w = timelineWindow([span("2026-09-01", "2026-11-30")], "day", TODAY);
    expect(w.from).toBeLessThanOrEqual(at("2026-09-01"));
    expect(w.to).toBeGreaterThan(at("2026-11-30"));
  });

  it("hari ini selalu termuat meski seluruh tugas di masa lalu", () => {
    const w = timelineWindow([span("2026-06-01", "2026-06-05")], "week", TODAY);
    expect(w.from).toBeLessThanOrEqual(at("2026-06-01"));
    expect(w.to).toBeGreaterThan(TODAY);
  });

  /* Tanpa plafon, satu task bertanggal 2031 di zoom hari melahirkan ±2 000 sel header dan kanvas
     selebar 70 000 px. Yang jatuh di luar DIDAFTAR oleh `timelineRows`, bukan dihilangkan. */
  it("plafon tick melindungi DOM, jendela tetap berjangkar di mulai paling awal", () => {
    const w = timelineWindow([span("2026-09-01", "2031-01-01")], "day", TODAY);
    expect(w.ticks.length).toBe(MAX_TICKS);
    expect(w.from).toBe(at("2026-09-01"));
    expect(w.to).toBeLessThan(at("2031-01-01"));
  });

  it("`to` adalah akhir tick terakhir — 100% kanvas persis sepanjang tick", () => {
    const w = timelineWindow([], "week", TODAY);
    expect(w.to).toBe(w.ticks[w.ticks.length - 1]!.start + 7 * DAY);
  });

  it("tick major menandai awal bulan di zoom hari dan awal tahun di zoom bulan", () => {
    const d = timelineWindow([span("2026-09-25", "2026-10-05")], "day", at("2026-09-25"));
    expect(d.ticks.find((t) => t.start === at("2026-10-01"))!.major).toBe(true);
    expect(d.ticks.find((t) => t.start === at("2026-09-26"))!.major).toBe(false);
    const m = timelineWindow([span("2026-11-01", "2027-03-01")], "month", at("2026-11-01"));
    expect(m.ticks.find((t) => t.start === at("2027-01-01"))!.major).toBe(true);
    expect(m.ticks.find((t) => t.start === at("2026-12-01"))!.major).toBe(false);
  });

  it("label tick tak bergeser sehari — dibentuk di UTC", () => {
    const w = timelineWindow([span("2026-09-01", "2026-09-02")], "day", at("2026-09-01"));
    expect(w.ticks[0]!.label).toContain("1");
    expect(w.ticks[0]!.label).toContain("Sep");
  });

  it("zoom mengembalikan lebar sel yang berbeda per satuan", () => {
    expect(zoomCell("day")).toBeLessThan(zoomCell("week"));
    expect(zoomCell("week")).toBeLessThan(zoomCell("month"));
  });
});
