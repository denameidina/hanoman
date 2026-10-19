import { describe, it, expect } from "vitest";
import { verifyScopeClause } from "../src/verify-scope";

describe("verifyScopeClause", () => {
  it("full tak menghasilkan klausa apa pun (perilaku lama utuh)", () => {
    expect(verifyScopeClause("full")).toBe("");
  });

  it("changed memberi perintah yang bisa langsung dijalankan, berbasis baseSha", () => {
    const c = verifyScopeClause("changed");
    expect(c).toContain("$HANOMAN_BASE_SHA");
    expect(c).toContain("git diff --name-only");
    expect(c).toContain("--changed");
    expect(c).toContain("vitest related");
  });

  it("changed melarang perintah suite penuh secara eksplisit", () => {
    const c = verifyScopeClause("changed");
    expect(c).toContain("pnpm test");        // disebut sebagai yang DILARANG
    expect(c).toContain("pnpm -r typecheck");
    expect(c.toUpperCase()).toContain("JANGAN");
  });

  // Keempat sumbu yang diminta operator (SPEC-376): test, typecheck, lint, build, smoke API.
  it("changed menutup typecheck, lint, build, dan smoke server", () => {
    const c = verifyScopeClause("changed").toLowerCase();
    for (const kata of ["typecheck", "lint", "build", "curl"]) expect(c).toContain(kata);
  });

  // `--changed` menyalakan passWithNoTests di vitest → "0 test" terlihat hijau. Klausa harus
  // menyebutnya, kalau tidak scope sempit justru memproduksi kepercayaan palsu.
  it("changed memperingatkan jebakan passWithNoTests", () => {
    expect(verifyScopeClause("changed")).toContain("passWithNoTests");
  });

  // Scope sempit tak boleh jadi alasan melewatkan verifikasi perubahan berdampak luas.
  it("changed memberi jalan keluar eksplisit untuk perubahan berdampak luas", () => {
    expect(verifyScopeClause("changed").toLowerCase()).toContain("perluas scope");
  });

  // SPEC-402 · klausa ini sendiri adalah muatan yang kena `pkill -f`: ia memuat `vitest` & `tsc`,
  // dan prompt sesi hidup di argv agen, jadi `pkill -f vitest` milik satu sesi meng-SIGTERM agen
  // sesi lain (BSD pkill mengecualikan leluhurnya sendiri → korbannya selalu sesi tetangga).
  it("changed melarang pembunuhan proses lewat pola", () => {
    const c = verifyScopeClause("changed");
    expect(c).toContain("pkill -f");
    expect(c).toContain("killall");
    expect(c.toUpperCase()).toContain("JANGAN");
  });

  // ADR-0225 · 92 Execute terukur: median 26 perintah test, berkas test yang sama dijalankan 6,5×
  // (p90 15×), 730 typecheck — ~21 menit per Execute hanya untuk verifikasi berulang.
  it("changed mengatur ritme: per task hanya test task itu, yang hijau tak diulang, set penuh sekali di akhir", () => {
    const c = verifyScopeClause("changed");
    expect(c).toContain("Ritme");
    expect(c).toContain("JANGAN menjalankan ulang berkas test yang sudah hijau");
    expect(c).toContain("SEKALI di akhir");
    expect(c).toMatch(/Typecheck paket tersentuh[\s\S]*bukan tiap task/);
  });

  it("changed menyebutkan alasannya (prompt sesi lain ada di argv) dan gantinya (PID/port)", () => {
    const c = verifyScopeClause("changed").toLowerCase();
    expect(c).toContain("argv");
    expect(c).toContain("pid");
  });
});
