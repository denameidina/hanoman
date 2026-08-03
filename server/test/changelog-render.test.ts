import { describe, it, expect } from "vitest";
import { fallbackMarkdown, changelogPrompt, type ChangelogInput } from "../src/services/changelog/render";

const INPUT: ChangelogInput = {
  mode: "backlog",
  title: "5 Juli – 3 Agustus 2026",
  items: [
    { label: "Laporan bulanan bisa diunduh", detail: "Pemakai mengunduh ringkasan tanpa minta ke admin." },
    { label: "Notifikasi lebih tenang", detail: "" },
  ],
  notes: ["3 item selesai tanpa stempel waktu dan tak ikut dihitung."],
};

describe("fallbackMarkdown", () => {
  it("memuat judul dan satu butir per item", () => {
    const md = fallbackMarkdown(INPUT);
    expect(md).toContain("# Changelog — 5 Juli – 3 Agustus 2026");
    expect(md).toContain("- **Laporan bulanan bisa diunduh** — Pemakai mengunduh");
    expect(md).toContain("- **Notifikasi lebih tenang**");
  });

  it("item tanpa detail tak meninggalkan tanda pisah menggantung", () => {
    expect(fallbackMarkdown(INPUT)).not.toMatch(/Notifikasi lebih tenang\*\* —\s*$/m);
  });

  it("catatan cakupan ikut tercetak", () => {
    expect(fallbackMarkdown(INPUT)).toContain("tanpa stempel waktu");
  });

  it("daftar kosong tetap menghasilkan markdown sah", () => {
    const md = fallbackMarkdown({ ...INPUT, items: [], notes: [] });
    expect(md).toContain("# Changelog —");
    expect(md.trim().length).toBeGreaterThan(0);
  });
});

describe("changelogPrompt", () => {
  const p = changelogPrompt(INPUT, 180_000);

  // Pelajaran SPEC-432, terukur: agen berbatas waktu yang TIDAK diberi tahu batasnya memakai
  // 306 dtk; prompt yang sama + satu paragraf anggaran selesai 101 dtk.
  it("menyebutkan anggaran waktunya sendiri dalam detik", () => {
    expect(p).toContain("180 detik");
  });

  it("melarang jejak teknis secara eksplisit", () => {
    expect(p).toMatch(/nama berkas/i);
    expect(p).toMatch(/nama fungsi/i);
    expect(p).toMatch(/hash commit/i);
  });

  it("meminta bahasa Indonesia dan keluaran markdown saja", () => {
    expect(p).toMatch(/bahasa Indonesia/i);
    expect(p).toMatch(/markdown/i);
  });

  it("membawa setiap item dan judulnya", () => {
    expect(p).toContain("Laporan bulanan bisa diunduh");
    expect(p).toContain("5 Juli – 3 Agustus 2026");
  });

  it("menyebut asal bahannya sesuai mode", () => {
    expect(changelogPrompt(INPUT, 1000)).toMatch(/backlog/i);
    expect(changelogPrompt({ ...INPUT, mode: "version" }, 1000)).toMatch(/versi|rilis/i);
  });
});
