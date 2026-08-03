import { describe, it, expect } from "vitest";
import { scrubSubject, scrubBody, scrubOutput } from "../src/services/changelog/scrub";

describe("scrubSubject", () => {
  it("membuang prefix conventional-commit beserta scope-nya", () => {
    expect(scrubSubject("fix(spec-511): seleksi teks terminal mungkin lagi"))
      .toBe("seleksi teks terminal mungkin lagi");
    expect(scrubSubject("feat!: kirim notifikasi harian")).toBe("kirim notifikasi harian");
  });

  it("membuang path berkas", () => {
    expect(scrubSubject("perbaiki server/src/services/pty.ts agar stabil"))
      .toBe("perbaiki agar stabil");
  });

  it("membuang hash commit", () => {
    expect(scrubSubject("balikkan perubahan b89f8fe yang salah"))
      .toBe("balikkan perubahan yang salah");
  });

  it("membuang rujukan internal SPEC/ADR", () => {
    expect(scrubSubject("tutup SPEC-433 sesuai ADR-0091")).toBe("tutup sesuai");
  });

  it("membuang identifier camelCase & snake_case & pemanggilan fungsi", () => {
    expect(scrubSubject("pasang macOptionClickForcesSelection di terminal")).toBe("pasang di terminal");
    expect(scrubSubject("baca model_reasoning_effort dari setelan")).toBe("baca dari setelan");
    expect(scrubSubject("panggil recordCompletion() sekali")).toBe("panggil sekali");
  });

  it("commit merge jadi kosong (bukan butir changelog)", () => {
    expect(scrubSubject("Merge branch 'main' into feature")).toBe("");
    expect(scrubSubject("Merge pull request #12 from a/b")).toBe("");
  });

  // Kontrol negatif — prosa Indonesia biasa TIDAK boleh dirusak.
  it("prosa biasa lewat utuh", () => {
    const s = "Pengguna kini bisa mengunduh laporan bulanan langsung dari halaman ringkasan.";
    expect(scrubSubject(s)).toBe(s);
  });

  it("nama produk ber-kapital tengah yang sah tetap utuh", () => {
    expect(scrubSubject("dukungan untuk macOS dan iOS")).toBe("dukungan untuk macOS dan iOS");
    expect(scrubSubject("integrasi GitHub kini aktif")).toBe("integrasi GitHub kini aktif");
  });

  it("angka biasa tidak dianggap hash", () => {
    expect(scrubSubject("naikkan batas ke 1000000 baris")).toBe("naikkan batas ke 1000000 baris");
  });
});

describe("scrubBody", () => {
  it("hanya mengambil paragraf pertama dan tetap di-scrub", () => {
    const body = "Menambah tombol unduh di halaman laporan.\n\nDetail teknis: server/src/x.ts diubah.";
    expect(scrubBody(body)).toBe("Menambah tombol unduh di halaman laporan.");
  });

  it("membuang trailer Co-Authored-By dan sejenisnya", () => {
    expect(scrubBody("Perbaiki ejaan.\n\nCo-Authored-By: X <x@y>")).toBe("Perbaiki ejaan.");
  });
});

describe("scrubOutput", () => {
  it("membuang blok kode seluruhnya", () => {
    const md = "## Rilis\n\n- Tombol baru\n\n```ts\nconst x = 1;\n```\n\n- Lebih cepat\n";
    const out = scrubOutput(md);
    expect(out).not.toContain("const x");
    expect(out).toContain("Tombol baru");
    expect(out).toContain("Lebih cepat");
  });

  it("membuang inline code, hash, path, dan rujukan internal", () => {
    const out = scrubOutput("- Perbaikan pada `pty.ts` (b89f8fe) sesuai SPEC-511");
    expect(out).not.toMatch(/pty\.ts|b89f8fe|SPEC-511/);
  });

  it("judul & butir markdown tetap berdiri", () => {
    const out = scrubOutput("## Agustus 2026\n\n- Laporan bisa diunduh\n- Notifikasi lebih tenang\n");
    expect(out).toContain("## Agustus 2026");
    expect(out.match(/^- /gm)?.length).toBe(2);
  });
});
