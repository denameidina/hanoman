import { describe, it, expect } from "vitest";
import { guardReply } from "../src/services/portal-chat/guard-output";
import { TEKS_TETAP } from "@hanoman/shared";

const O = { projectName: "Toko Mekar", otherNames: ["Klinik Sehat", "p2"] };
const lolos = (t: string) => guardReply(t, O);

describe("gerbang keluaran chat portal (SPEC-854 huruf E)", () => {
  it("jawaban awam lolos apa adanya", () => {
    const r = lolos("Fitur keranjang belanja sedang dikerjakan dan ditargetkan selesai bulan ini.");
    expect(r.blocked).toBe(false);
    expect(r.text).toContain("keranjang belanja");
  });

  it("jawaban awam panjang lolos apa adanya", () => {
    const r = lolos(
      "Sampai sekarang ada tiga pekerjaan yang sedang berjalan untuk Toko Mekar. "
      + "Yang paling dekat selesai adalah keranjang belanja, lalu pengingat pesanan, "
      + "dan terakhir laporan penjualan bulanan. Kalau Anda mau, kita bisa bahas urutannya.");
    expect(r.blocked, r.reasons.join(",")).toBe(false);
  });

  // Ketiganya BENAR-BENAR diproduksi agen saat pengukuran SPEC-854 — bukan kasus karangan.
  it("tolak: blok kode berpagar", () => {
    const r = lolos("Coba jalankan ini:\n```bash\ncat /etc/hosts\n```");
    expect(r.blocked).toBe(true);
    expect(r.text).toBe(TEKS_TETAP.diblokir);
    expect(r.reasons).toContain("blok-kode");
  });

  it("tolak: path absolut yang bocor dari prosa agen", () => {
    const r = lolos("Berkas /private/var/folders/5r/T/tmp.eLlA/rahasia.txt tak bisa dibaca.");
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain("path");
  });

  it("tolak: alamat email", () => {
    const r = lolos("Silakan hubungi nafanesia@gmail.com untuk itu.");
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain("email");
  });

  it("tolak: nama berkas, tabel, perintah, konfigurasi, jejak galat", () => {
    const kasus: [string, string][] = [
      ["Lihat di pekerjaan.md ya.", "nama-berkas"],
      ["Datanya ada di tabel PortalChatSession.", "istilah-teknis"],
      ["SELECT * FROM Spec WHERE id = 1", "istilah-teknis"],
      ["Jalankan npm install dulu.", "perintah"],
      ["Setel HANOMAN_HOME=/data lebih dulu.", "konfigurasi"],
      ["Error: gagal\n    at Object.<anonymous> (x)", "jejak-galat"],
    ];
    for (const [t, sebab] of kasus) {
      const r = lolos(t);
      expect(r.blocked, t).toBe(true);
      expect(r.reasons, t).toContain(sebab);
    }
  });

  // Inti huruf E: memancing isi project lain.
  it("tolak: menyebut project lain", () => {
    for (const t of ["Di Klinik Sehat hal itu sudah selesai.", "Project p2 juga punya fitur ini."]) {
      const r = lolos(t);
      expect(r.blocked, t).toBe(true);
      expect(r.reasons, t).toContain("project-lain");
    }
  });

  it("nama project sendiri jelas boleh disebut", () => {
    expect(lolos("Di Toko Mekar fitur itu sedang dikerjakan.").blocked).toBe(false);
  });

  // Nama project klien yang MEMUAT nama project lain tak boleh memblokir dirinya sendiri.
  it("nama project yang tumpang tindih tak saling memblokir", () => {
    const r = guardReply("Toko Mekar Jaya sedang jalan.",
      { projectName: "Toko Mekar Jaya", otherNames: ["Toko Mekar"] });
    expect(r.blocked).toBe(false);
  });

  it("redaksi: span kode inline jadi teks biasa, bukan penolakan", () => {
    const r = lolos("Fitur `keranjang` sudah siap.");
    expect(r.blocked).toBe(false);
    expect(r.text).toBe("Fitur keranjang sudah siap.");
  });

  it("balasan kosong dianggap gagal, bukan jawaban kosong", () => {
    const r = lolos("   ");
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain("kosong");
  });
});
