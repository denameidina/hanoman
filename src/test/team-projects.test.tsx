import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { MemberView, TaskView } from "@hanoman/shared";
import { TeamProjectTimeline } from "../src/screens/team-timeline";
import { projectSpan, spanGeometry, taskSpan, timelineWindow } from "../src/screens/team-rules";

// Unit test aturan tidak cukup — pelajaran yang sama yang melahirkan `team-board.test.tsx` dan
// `team-timeline.test.tsx`: amplop dan segmen yang TERTUKAR urutan lukisnya lolos sempurna dari
// uji aritmetikanya sendiri.

const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (d: string) => `${d}T12:00:00.000Z`;
const TODAY = at("2026-09-10");

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
const projects = [{ id: "p1", name: "Project Satu" }, { id: "p2", name: "Project Dua" }];

const view = (tasks: TaskView[], over: Partial<Parameters<typeof TeamProjectTimeline>[0]> = {}) => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  const r = render(<TeamProjectTimeline tasks={tasks} projects={projects} members={members}
    zoom="day" today={TODAY} hidden={0} expanded={[]} onToggle={onToggle} onOpen={onOpen} {...over} />);
  return { onOpen, onToggle, unmount: r.unmount };
};
const win = (tasks: TaskView[]) =>
  timelineWindow(tasks.map(taskSpan).filter((s): s is NonNullable<typeof s> => s !== null),
    "day", TODAY);
const barsOf = (rowKey: string) =>
  [...screen.getByTestId(`timeline-row-${rowKey}`).querySelectorAll("[data-testid^='timeline-bar-']")]
    .map((el) => el.getAttribute("data-testid"));

describe("TeamProjectTimeline · baris per project", () => {
  it("kanvasnya punya testid SENDIRI — mode lain tak boleh berbagi permukaan", () => {
    view([task({ startDate: iso("2026-09-11") })]);
    expect(screen.getByTestId("team-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("team-timeline")).toBeNull();
  });

  it("satu baris per project, plus baris Tanpa project", () => {
    view([
      task({ id: "a", projectId: "p1", startDate: iso("2026-09-11") }),
      task({ id: "b", projectId: "p2", startDate: iso("2026-09-12") }),
      task({ id: "c", projectId: null, startDate: iso("2026-09-13") }),
    ]);
    expect(screen.getByTestId("timeline-row-p:p1")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-row-p:p2")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-row-p:__none__")).toBeInTheDocument();
    expect(screen.getByText("Tanpa project")).toBeInTheDocument();
    expect(screen.getByText("Project Satu")).toBeInTheDocument();
  });

  it("amplop memakai persen yang SAMA dengan spanGeometry(projectSpan(...))", () => {
    const tasks = [
      task({ id: "a", startDate: iso("2026-09-11"), dueDate: iso("2026-09-12") }),
      task({ id: "b", startDate: iso("2026-09-14"), dueDate: iso("2026-09-15") }),
    ];
    view(tasks);
    const g = spanGeometry(projectSpan(tasks)!, win(tasks))!;
    const env = screen.getByTestId("timeline-bar-span:p1");
    expect(env.style.left).toBe(`${g.left}%`);
    expect(env.style.width).toBe(`${g.width}%`);
  });

  it("amplop dilukis SEBELUM segmen, dan ada satu segmen per task bertanggal", () => {
    view([
      task({ id: "a", startDate: iso("2026-09-11") }),
      task({ id: "b", startDate: iso("2026-09-14") }),
      task({ id: "kosong" }),
    ]);
    // Urutan DOM = urutan lukis: amplop harus di indeks 0, kalau tidak ia menutupi segmennya.
    expect(barsOf("p:p1"))
      .toEqual(["timeline-bar-span:p1", "timeline-bar-seg:a", "timeline-bar-seg:b"]);
  });

  it("project tanpa satu pun task bertanggal: baris ada, NOL batang, nol NaN", () => {
    view([task({ id: "a", projectId: "p1" }), task({ id: "b", projectId: "p1" })]);
    expect(barsOf("p:p1")).toHaveLength(0);
    expect(screen.getByTestId("timeline-row-p:p1").innerHTML).not.toMatch(/NaN/);
    expect(screen.getByText(/belum dijadwalkan/i)).toBeInTheDocument();
  });

  it("project bertanggal di luar jendela berplafon: nol batang, meta menyebut sebabnya", () => {
    view([
      task({ id: "dekat", projectId: "p1", startDate: iso("2026-09-11") }),
      task({ id: "jauh", projectId: "p2", startDate: iso("2031-01-01") }),
    ]);
    expect(barsOf("p:p2")).toHaveLength(0);
    expect(screen.getByText(/di luar jendela/i)).toBeInTheDocument();
  });
});

describe("TeamProjectTimeline · buka baris", () => {
  // Tanggal SEBELUM `today` disengaja: jendela lahir dari data ∪ hari ini, jadi task yang seluruhnya
  // sesudah hari ini membuat kedua rumus (seluruh task vs baris terlihat) menjawab jangkar yang SAMA
  // — dan test "jendela tidak bergeser" yang memakainya tak bisa gagal. Terukur.
  const tasks = () => [
    task({ id: "a", projectId: "p1", title: "Awal", startDate: iso("2026-06-01") }),
    task({ id: "kosong", projectId: "p1", title: "Kosong" }),
  ];

  it("tertutup: tak ada baris anak", () => {
    view(tasks());
    expect(screen.queryByTestId("timeline-row-t:a")).toBeNull();
  });

  it("klik tombol buka memanggil onToggle dengan project yang benar", () => {
    const { onToggle } = view(tasks());
    fireEvent.click(screen.getByTestId("expand-p1"));
    expect(onToggle).toHaveBeenCalledWith("p1");
  });

  it("baris Tanpa project memakai kunci sentinel yang sama dengan state terbuka", () => {
    const { onToggle } = view([task({ id: "c", projectId: null, startDate: iso("2026-09-11") })]);
    fireEvent.click(screen.getByTestId("expand-__none__"));
    expect(onToggle).toHaveBeenCalledWith("__none__");
  });

  it("dibuka: baris anak muncul, dan JENDELA tidak bergeser", () => {
    const t = tasks();
    const ticks = () => screen.getAllByTestId("timeline-tick");
    const { unmount } = view(t);
    const tutup = ticks().length;
    // Label tick PERTAMA ikut dibandingkan, bukan cuma jumlahnya: jendela yang jangkarnya bergeser
    // sambil panjangnya kebetulan sama lolos dari perbandingan jumlah.
    const jangkar = ticks()[0]!.textContent;
    unmount();
    view(t, { expanded: ["p1"] });
    expect(screen.getByTestId("timeline-row-t:a")).toBeInTheDocument();
    // Task tanpa tanggal tetap punya BARIS — di situlah operator melihatnya — tanpa batang.
    expect(barsOf("t:kosong")).toHaveLength(0);
    expect(ticks().length).toBe(tutup);
    expect(ticks()[0]!.textContent).toBe(jangkar);
  });

  it("klik segmen membuka task yang benar", () => {
    const { onOpen } = view(tasks());
    fireEvent.click(screen.getByTestId("timeline-bar-seg:a"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].id).toBe("a");
  });

  it("tanggal terbalik: amplop project ikut bernada GALAT, bukan sekadar ditandai", () => {
    view([task({ id: "x", projectId: "p1", startDate: iso("2026-09-20"), dueDate: iso("2026-09-15") })]);
    const env = screen.getByTestId("timeline-bar-span:p1");
    expect(env.dataset.invalid).toBe("true");
    expect(env.dataset.tone).toBe("err");
  });

  it("projectId yang tak ada di daftar tetap punya baris, label jatuh ke id mentah", () => {
    view([task({ id: "a", projectId: "phantom", startDate: iso("2026-09-11") })]);
    expect(screen.getByTestId("timeline-row-p:phantom")).toBeInTheDocument();
    expect(screen.getByText("phantom")).toBeInTheDocument();
  });
});

/* Tiga hal yang dinyatakan sebagai invarian di komentar sumber tapi sebelumnya tak punya penjaga
   satu pun — ditemukan dengan memutasi sumbernya dan mendapati suite tetap hijau. */
describe("TeamProjectTimeline · kontrak yang gagal senyap", () => {
  it("amplop memakai nada RESESIF sendiri, bukan nada task selesai", () => {
    view([
      task({ id: "a", projectId: "p1", startDate: iso("2026-09-11") }),
      task({ id: "b", projectId: "p1", status: "done", startDate: iso("2026-09-12") }),
    ]);
    const tone = (k: string) => screen.getByTestId(`timeline-bar-${k}`).dataset.tone;
    // `muted` sudah dipakai task selesai; amplop yang sewarna dengannya membuat dua hal berbeda
    // tampak sama.
    expect(tone("span:p1")).toBe("envelope");
    expect(tone("seg:b")).toBe("muted");
    expect(tone("seg:a")).toBe("brass");
  });

  it("rentang yang DITAMPILKAN berakhir di hari task terakhir, bukan sehari sesudahnya", () => {
    view([
      task({ id: "a", projectId: "p1", startDate: iso("2026-09-11") }),
      task({ id: "b", projectId: "p1", startDate: iso("2026-09-14") }),
    ]);
    // `span.end` EKSKLUSIF — merendernya apa adanya membuat SETIAP project berakhir sehari lebih
    // lambat dari task terakhirnya, dan tak ada satu pun galat yang muncul.
    expect(screen.getByText("11 Sep → 14 Sep")).toBeInTheDocument();
  });

  it("kepala kolom label berbunyi Project, bukan Tugas", () => {
    view([task({ startDate: iso("2026-09-11") })]);
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.queryByText("Tugas")).toBeNull();
  });

  it("plafon 200/kolom tetap DIRENDER di mode ini juga (ADR-0151)", () => {
    view([task({ startDate: iso("2026-09-11") })], { hidden: 3 });
    expect(screen.getByTestId("projects-truncated")).toHaveTextContent("3 tugas tak termuat");
  });
});
