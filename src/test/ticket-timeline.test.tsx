/* Audit UI/UX 2026-10 · Fase 3 (3M) · linimasa keluhan klien. Dua lapis: fungsi murni yang
   memetakan status publik ke empat langkah, dan komponen yang menuliskannya ke DOM dengan
   `aria-current` serta teks pembaca layar. Status yang dipakai adalah kosakata `publicStatus()`
   (SPEC-293), jadi test ini ikut berubah bila kosakatanya berubah. */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { publicStatus } from "@hanoman/shared";
import { ticketNote, ticketTimeline, TIMELINE_STEPS, type TimelineStep } from "../src/portal/ticket-timeline";
import { TicketTimeline } from "../src/portal/TicketTimeline";

const states = (steps: TimelineStep[]) => steps.map((s) => s.state);

describe("ticketTimeline (3M)", () => {
  it("empat langkah berurutan Diterima → Ditinjau → Dikerjakan → Selesai", () => {
    expect([...TIMELINE_STEPS]).toEqual(["Diterima", "Ditinjau", "Dikerjakan", "Selesai"]);
  });

  it("Sedang ditinjau: Diterima sudah lewat, Ditinjau sedang berjalan", () => {
    expect(states(ticketTimeline("Sedang ditinjau"))).toEqual(["done", "current", "pending", "pending"]);
  });

  it("Diterima: tinjauan sudah lewat, Dikerjakan menunggu giliran", () => {
    expect(states(ticketTimeline("Diterima"))).toEqual(["done", "done", "current", "pending"]);
  });

  it("Sedang dikerjakan: Dikerjakan yang sedang berjalan", () => {
    expect(states(ticketTimeline("Sedang dikerjakan"))).toEqual(["done", "done", "current", "pending"]);
  });

  it("Selesai: semua langkah sudah lewat", () => {
    expect(states(ticketTimeline("Selesai"))).toEqual(["done", "done", "done", "done"]);
  });

  it("Ditutup: berhenti di Ditinjau, tanpa langkah yang dipalsukan lewat", () => {
    expect(states(ticketTimeline("Ditutup"))).toEqual(["done", "closed", "pending", "pending"]);
  });

  it("status tak dikenal hanya menandai langkah pertama, dan tak pernah melempar", () => {
    expect(states(ticketTimeline("Status baru dari server"))).toEqual(["done", "pending", "pending", "pending"]);
    expect(states(ticketTimeline(""))).toEqual(["done", "pending", "pending", "pending"]);
  });

  // Dikunci ke SUMBER kosakatanya: setiap keluaran publicStatus() punya keadaan yang disengaja
  // dan selalu tepat satu langkah berstatus "current" (kecuali selesai/ditutup).
  it("setiap keluaran publicStatus() terpetakan tanpa jatuh ke keadaan default", () => {
    for (const [ticket, stage] of [["new", null], ["accepted", null], ["accepted", "executing"],
      ["accepted", "done"], ["rejected", null]] as const) {
      const status = publicStatus(ticket, stage);
      const steps = ticketTimeline(status);
      expect(steps[0]!.state, status).toBe("done");
      expect(steps.filter((s) => s.state === "current").length + steps.filter((s) => s.state === "closed").length,
        status).toBeLessThanOrEqual(1);
      expect(ticketNote(status), status).not.toMatch(/^Status laporan:/);
    }
  });
});

describe("ticketNote (3M)", () => {
  it("menjawab 'bagaimana masalah saya' dengan kalimat yang bisa dibaca awam", () => {
    expect(ticketNote("Sedang ditinjau")).toMatch(/Belum ada yang perlu Anda lakukan/);
    expect(ticketNote("Ditutup")).toMatch(/tidak dilanjutkan/);
  });
});

describe("TicketTimeline (3M)", () => {
  it("merender daftar bernama dengan langkah aktif bertanda aria-current", () => {
    render(<TicketTimeline status="Sedang dikerjakan" />);
    const list = screen.getByRole("list", { name: "Perkembangan laporan: Sedang dikerjakan" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(4);
    expect(items[2]!.getAttribute("aria-current")).toBe("step");
    expect(items[0]!.getAttribute("aria-current")).toBeNull();
    expect(items[2]!.textContent).toMatch(/Dikerjakan.*\(sekarang\)/);
  });

  it("langkah yang dihentikan dibacakan sebagai tidak dilanjutkan", () => {
    render(<TicketTimeline status="Ditutup" compact />);
    expect(screen.getByText("(tidak dilanjutkan)", { exact: false })).toBeInTheDocument();
  });
});
