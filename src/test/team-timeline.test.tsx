import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { MemberView, TaskView } from "@hanoman/shared";
import { TeamTimeline } from "../src/screens/team-timeline";
import { barGeometry, taskSpan, timelineWindow, todayOffset, zoomCell } from "../src/screens/team-rules";

// Cermin `LABEL_W` di `team-timeline.tsx` — lebar kolom label tak diekspor karena ia keputusan
// tata letak, bukan kontrak; yang diuji di sini adalah OFFSET-nya, bukan angkanya.
const LABEL_W = 232;

const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (d: string) => `${d}T12:00:00.000Z`;
const TODAY = at("2026-09-12");

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Desain", detail: null, status: "doing",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: iso("2026-08-25"), updatedAt: iso("2026-08-25"),
  ...over,
});
const members: MemberView[] = [{
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: null, active: true,
  createdAt: iso("2026-08-25"), updatedAt: iso("2026-08-25"),
}];

const view = (tasks: TaskView[], over: Partial<Parameters<typeof TeamTimeline>[0]> = {}) => {
  const onOpen = vi.fn();
  render(<TeamTimeline tasks={tasks} members={members} zoom="day" today={TODAY}
    hidden={0} onOpen={onOpen} {...over} />);
  return { onOpen };
};

describe("TeamTimeline · kanvas", () => {
  it("batang memakai persen yang SAMA dengan barGeometry untuk masukan yang sama", () => {
    const t = task({ startDate: iso("2026-09-10"), dueDate: iso("2026-09-14") });
    view([t]);
    const win = timelineWindow([taskSpan(t)!], "day", TODAY);
    const g = barGeometry(t, win)!;
    const bar = screen.getByTestId("timeline-bar-t1");
    expect(bar.style.left).toBe(`${g.left}%`);
    expect(bar.style.width).toBe(`${g.width}%`);
  });

  it("jumlah sel header sama dengan jumlah tick jendela, dan berubah saat zoom berubah", () => {
    const t = task({ startDate: iso("2026-09-01"), dueDate: iso("2026-11-30") });
    const { unmount } = render(<TeamTimeline tasks={[t]} members={members} zoom="day"
      today={TODAY} hidden={0} onOpen={vi.fn()} />);
    const hari = screen.getAllByTestId("timeline-tick").length;
    expect(hari).toBe(timelineWindow([taskSpan(t)!], "day", TODAY).ticks.length);
    unmount();
    render(<TeamTimeline tasks={[t]} members={members} zoom="month" today={TODAY}
      hidden={0} onOpen={vi.fn()} />);
    expect(screen.getAllByTestId("timeline-tick").length).toBeLessThan(hari);
  });

  it("klik batang membuka task yang benar", () => {
    const { onOpen } = view([task({ id: "t9", startDate: iso("2026-09-12") })]);
    fireEvent.click(screen.getByTestId("timeline-bar-t9"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].id).toBe("t9");
  });

  /* Keberadaan node saja tak cukup: garis yang dipaku ke `left: 0` lolos dari assertion "ada",
     dan ia lalu menandai hari yang salah tanpa satu pun galat. Yang diuji posisinya. */
  it("garis hari ini berdiri di posisi yang dihitung todayOffset", () => {
    const t = task({ startDate: iso("2026-09-01"), dueDate: iso("2026-09-20") });
    view([t]);
    const win = timelineWindow([taskSpan(t)!], "day", TODAY);
    const expected = LABEL_W + (todayOffset(win, TODAY)! / 100) * win.ticks.length * zoomCell("day");
    expect(screen.getByTestId("timeline-today").style.left).toBe(`${expected}px`);
  });

  it("garis hari ini tak dirender saat hari ini di luar jendela", () => {
    // Jendela berplafon yang berjangkar jauh di masa lalu meninggalkan hari ini di luar.
    view([task({ startDate: iso("2020-01-01"), dueDate: iso("2020-03-01") })]);
    expect(screen.queryByTestId("timeline-today")).toBeNull();
  });

  it("kanvas tak bisa melar mengikuti isinya — minWidth 0 hidup di gaya inline, bukan cuma CSS", () => {
    view([task({ startDate: iso("2026-09-12") })]);
    // jsdom tak memuat stylesheet: properti yang hanya hidup di `.hn-timeline-scroll` dijaga nol
    // test, dan justru `min-width: 0` inilah kelas bug SPEC-879.
    const scroller = screen.getByTestId("team-timeline");
    // React menulis `0` tanpa satuan untuk nilai numerik nol.
    expect(scroller.style.minWidth).toBe("0");
    expect(scroller.style.maxWidth).toBe("100%");
  });

  /* SPEC-879 · gulir mendatar hidup DI DALAM kanvas; badan halaman tak boleh ikut. Dan anak blok
     yang menyusut mengikuti containernya membuat scroller-nya tak punya apa pun untuk digulir —
     lebar pembungkus dalam karena itu EKSPLISIT. */
  it("gulir mendatar milik kanvas, dengan pembungkus dalam berlebar eksplisit", () => {
    view([task({ startDate: iso("2026-09-12") })]);
    const scroller = screen.getByTestId("team-timeline");
    expect(scroller.className).toContain("hn-timeline-scroll");
    expect(scroller.style.overflowX).toBe("auto");
    const inner = screen.getByTestId("timeline-canvas");
    expect(parseInt(inner.style.minWidth, 10)).toBeGreaterThan(0);
  });
});

describe("TeamTimeline · yang tidak digambar", () => {
  it("task tanpa tanggal masuk daftar 'belum dijadwalkan', bukan disembunyikan", () => {
    view([task({ id: "kosong", title: "Tanpa tanggal" }), task({ id: "ada", startDate: iso("2026-09-12") })]);
    const list = screen.getByTestId("timeline-unscheduled");
    expect(list).toHaveTextContent("Tanpa tanggal");
    expect(screen.queryByTestId("timeline-bar-kosong")).toBeNull();
    expect(screen.getByTestId("timeline-bar-ada")).toBeInTheDocument();
  });

  it("daftar 'belum dijadwalkan' tak dirender saat semua tugas bertanggal", () => {
    view([task({ startDate: iso("2026-09-12") })]);
    expect(screen.queryByTestId("timeline-unscheduled")).toBeNull();
  });

  it("task di luar jendela berplafon didaftar dengan saran zoom, bukan dihilangkan", () => {
    view([task({ id: "jauh", title: "Jauh sekali", dueDate: iso("2031-01-01") }),
      task({ id: "dekat", startDate: iso("2026-09-12") })]);
    const list = screen.getByTestId("timeline-outside");
    expect(list).toHaveTextContent("Jauh sekali");
    expect(list.textContent).toMatch(/zoom/i);
  });

  it("plafon 200/kolom tetap diakui di linimasa", () => {
    view([task({ startDate: iso("2026-09-12") })], { hidden: 7 });
    expect(screen.getByTestId("timeline-truncated")).toHaveTextContent("7");
  });

  it("seluruh tugas tanpa tanggal: kanvas mengaku kosong, daftarnya tetap berisi", () => {
    view([task({ id: "a", title: "Satu" }), task({ id: "b", title: "Dua" })]);
    expect(screen.getByTestId("timeline-empty")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-unscheduled")).toHaveTextContent("Satu");
  });
});

describe("TeamTimeline · kejujuran batang", () => {
  it("tenggat mendahului mulai dirender dengan nada galat dan judul yang menyebut sebabnya", () => {
    view([task({ id: "kacau", startDate: iso("2026-09-14"), dueDate: iso("2026-09-10") })]);
    const bar = screen.getByTestId("timeline-bar-kacau");
    expect(bar.getAttribute("data-invalid")).toBe("true");
    expect(bar.getAttribute("title")).toMatch(/tenggat mendahului mulai/i);
  });

  it("batang terpotong mengaku terpotong", () => {
    view([task({ id: "panjang", startDate: iso("2026-09-01"), dueDate: iso("2027-06-01") })]);
    const bar = screen.getByTestId("timeline-bar-panjang");
    expect(bar.getAttribute("data-clipped-end")).toBe("true");
    expect(bar.getAttribute("title")).toMatch(/melewati tepi/i);
  });

  /* Tiga nada, tiga arti. Tanpa uji ini cabang `done` bisa dihapus dan tak ada yang protes —
     seluruh papan lalu tampak sama sibuknya, termasuk yang sudah selesai. */
  it("nada batang membedakan selesai, salah, dan sedang berjalan", () => {
    view([
      task({ id: "beres", status: "done", startDate: iso("2026-09-12") }),
      task({ id: "jalan", status: "doing", startDate: iso("2026-09-12") }),
      task({ id: "salah", startDate: iso("2026-09-14"), dueDate: iso("2026-09-10") }),
    ]);
    const bg = (id: string) => screen.getByTestId(`timeline-bar-${id}`).style.background;
    expect(bg("beres")).toBe("var(--bone-300)");
    expect(bg("jalan")).toBe("var(--brass-300)");
    expect(bg("salah")).toBe("var(--status-err-tint)");
  });

  it("nama pemilik baris ikut dirender, kartu tanpa assignee tetap punya kalimat", () => {
    view([task({ id: "x", startDate: iso("2026-09-12"), memberId: "dena@x.id" }),
      task({ id: "y", title: "Yatim", startDate: iso("2026-09-12") })]);
    expect(screen.getByTestId("timeline-row-x")).toHaveTextContent("Dena");
    expect(screen.getByTestId("timeline-row-y")).toHaveTextContent("belum ditugaskan");
  });
});
