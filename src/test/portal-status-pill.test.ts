/* SPEC-626 · warna badge portal. Badge tiket dulu `status="idle"` HARDCODE di dua tempat
   sementara teksnya ikut berubah — jadi `new`/`accepted`/`rejected` semuanya abu-abu yang sama:
   warnanya berbohong, cuma hurufnya yang jujur. Nol test render bisa menangkap itu selama
   labelnya benar, jadi yang dipagari di sini adalah FUNGSI pemetaannya. */
import { describe, it, expect } from "vitest";
import { publicStatus, zStage } from "@hanoman/shared";
import { stagePill, ticketPill } from "../src/portal/status-pill";

describe("ticketPill (SPEC-626)", () => {
  it("tiap kosakata klien punya warnanya sendiri", () => {
    expect(ticketPill("Sedang ditinjau")).toBe("queued");
    expect(ticketPill("Diterima")).toBe("awaiting");
    expect(ticketPill("Sedang dikerjakan")).toBe("running");
    expect(ticketPill("Selesai")).toBe("done");
    expect(ticketPill("Ditutup")).toBe("failed");
  });

  // Inti bug yang diperbaiki: tiga status DB harus berujung di warna yang berbeda.
  it("new / accepted / rejected mendarat di warna yang berbeda", () => {
    const pills = ["new", "accepted", "rejected"].map((s) => ticketPill(publicStatus(s, null)));
    expect(new Set(pills).size).toBe(3);
  });

  // Diikat ke SUMBER kosakatanya (publicStatus, SPEC-293), bukan ke daftar hafalan: kosakata
  // yang berubah/bertambah di sana membuat test ini merah, bukan diam-diam jadi abu-abu.
  it("seluruh keluaran publicStatus punya pemetaan — tak ada yang jatuh ke idle", () => {
    const stages: (string | null)[] = [null, ...zStage.options];
    for (const s of ["new", "accepted", "rejected", "triaged"])
      for (const st of stages)
        expect(ticketPill(publicStatus(s, st)), `${s}/${st}`).not.toBe("idle");
  });

  it("status tak dikenal jatuh ke idle yang netral, bukan warna yang menyesatkan", () => {
    expect(ticketPill("Entah apa")).toBe("idle");
    expect(ticketPill("")).toBe("idle");
  });
});

describe("stagePill (SPEC-626)", () => {
  it("stage kerja dipetakan sesuai keadaannya", () => {
    expect(stagePill("brainstorming")).toBe("queued");
    expect(stagePill("objective")).toBe("queued");
    expect(stagePill("spec-ready")).toBe("queued");
    expect(stagePill("planned")).toBe("queued");
    expect(stagePill("executing")).toBe("running");
    expect(stagePill("done")).toBe("done");
  });

  it("seluruh zStage punya pemetaan eksplisit", () => {
    for (const s of zStage.options) expect(stagePill(s), s).not.toBe("idle");
  });

  // Versi lama memakai `else → queued`: stage asing diwarnai "antre" — percaya diri tentang
  // keadaan yang tak diketahui. Arah kegagalannya dibalik.
  it("stage tak dikenal jatuh ke idle", () => {
    expect(stagePill("blocked")).toBe("idle");
    expect(stagePill("")).toBe("idle");
  });
});
