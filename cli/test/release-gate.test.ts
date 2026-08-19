// SPEC-852 · ADR-0128 · Gerbang rilis hidup di berkas konfigurasi, dan berkas konfigurasi rusak
// tanpa suara: sebuah langkah yang terhapus tak menggagalkan apa pun, ia hanya membuat publish
// lewat begitu saja. Persis itu yang terjadi sampai issue #1 — `release.yml` tak pernah memanggil
// vitest maupun tsc, dan tak ada yang merah karenanya. Pagar ini menahannya secara mekanis.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const validate = read(".github/workflows/validate.yml");
const release = read(".github/workflows/release.yml");
const ciSetup = read(".github/actions/ci-setup/action.yml");
const rootPkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const serverPkg = JSON.parse(read("server/package.json")) as { scripts: Record<string, string> };

describe("bootstrap Prisma Client", () => {
  // Akar issue #1: `pnpm install` sendiri TIDAK menghasilkan client — postinstall @prisma/client
  // hanya mencari skema di lokasi default, sementara skema hanoman ada di server/prisma/. Tanpa
  // baris ini checkout bersih punya test & typecheck merah yang terbaca seperti regresi kode.
  it("postinstall server men-generate client dari skema yang eksplisit", () => {
    expect(serverPkg.scripts.postinstall).toContain("prisma generate");
    expect(serverPkg.scripts.postinstall).toContain("--schema prisma/schema.prisma");
  });

  it("ada jalan keluar eksplisit `pnpm db:generate` saat postinstall dilewati", () => {
    expect(rootPkg.scripts["db:generate"]).toContain("prisma generate");
  });
});

describe("script validate", () => {
  it("memanggil typecheck DAN test — bukan salah satu", () => {
    const v = rootPkg.scripts.validate ?? "";
    expect(v).toContain("typecheck");
    expect(v).toContain("test");
  });

  // ADR-0080/SPEC-397: test server berbagi satu berkas DB, run paralel memberi 181 gagal palsu
  // vs 736 lulus serial. Melepas flag ini membuat CI merah karena alasan yang salah, lalu
  // membuat orang mematikan gerbangnya.
  it("suite root serial — `--no-file-parallelism` tak boleh lepas", () => {
    expect(rootPkg.scripts.test).toContain("--no-file-parallelism");
  });
});

describe("workflow validate", () => {
  it("berjalan pada pull request dan push ke main", () => {
    expect(validate).toMatch(/^\s*pull_request:/m);
    expect(validate).toMatch(/branches:\s*\[\s*main\s*\]/);
  });

  it("bisa dipanggil workflow lain (workflow_call)", () => {
    expect(validate).toMatch(/^\s*workflow_call:/m);
  });

  // SPEC-853 · Dulu satu job menjalankan `pnpm validate` (db:generate → typecheck → test) secara
  // berurutan; wall-clock-nya = jumlah keduanya, dan test serial (SPEC-397) mendominasi. Dipisah
  // jadi dua job yang berjalan BERSAMAAN. Yang dijaga bukan bentuk perintahnya melainkan
  // CAKUPANNYA: kedua lapisan harus tetap ada, karena job yang hilang tak menggagalkan apa pun —
  // ia hanya membuat publish lewat begitu saja (kelas kegagalan yang sama dengan issue #1).
  it("menjalankan typecheck DAN test — keduanya, sebagai job terpisah", () => {
    expect(validate).toMatch(/^\s{2}typecheck:/m);
    expect(validate).toMatch(/^\s{2}test:/m);
    expect(validate).toContain("pnpm typecheck");
    expect(validate).toContain("pnpm test");
  });

  // Paralel hanya menghemat waktu bila tak ada `needs` di antara keduanya.
  it("kedua job tak saling menunggu", () => {
    expect(validate).not.toMatch(/needs:\s*typecheck/);
    expect(validate).not.toMatch(/needs:\s*test/);
  });

  // Prisma Client tak ada di checkout bersih (ADR-0128): typecheck DAN test sama-sama mati
  // tanpanya, dan job terpisah tak mewarisi apa pun dari job tetangga. Setup-nya hidup di composite
  // action supaya tak jadi dua salinan yang menyimpang — yang dijaga: kedua job memakainya, dan
  // action itu benar-benar men-generate client.
  it("kedua job memakai setup bersama yang menyiapkan Prisma Client", () => {
    expect(validate.match(/uses:\s*\.\/\.github\/actions\/ci-setup/g) ?? []).toHaveLength(2);
    expect(ciSetup).toContain("pnpm db:generate");
    expect(ciSetup).toContain("pnpm install --frozen-lockfile");
  });

  // BYPASS SEMENTARA (2026-08-19). Yang dijaga di sini bukan "test wajib jalan" — untuk sementara
  // memang tidak — melainkan bahwa melewatinya tetap TINDAKAN YANG DISEBUT: defaultnya `false`,
  // dan jalur sehari-hari (pull_request / push main) tak punya input sama sekali sehingga tak ikut
  // terlonggarkan. Bypass yang defaultnya longgar akan jadi permanen tanpa ada yang merah.
  it("melewati test hanya lewat input eksplisit, defaultnya tidak", () => {
    expect(validate).toMatch(/skip_test:/);
    expect(validate).toMatch(/default:\s*false/);
    expect(validate).toMatch(/if:\s*\$\{\{\s*!inputs\.skip_test\s*\}\}/);
  });

  // Hang 6 jam (tiga run terukur) menyamar sebagai "CI lambat". Pagar waktu membuatnya lapor merah.
  it("kedua job punya batas waktu", () => {
    expect(validate.match(/timeout-minutes:/g) ?? []).toHaveLength(2);
  });

  // tmux hanya dibutuhkan job test (sesi terminal ADR-0016) — memasangnya di job typecheck
  // menambah waktu tanpa alasan. Yang dijaga: job test TIDAK boleh kehilangan tmux.
  it("job test tetap memasang tmux", () => {
    expect(validate.split(/^\s{2}test:/m)[1] ?? "").toContain("tmux");
  });
});

describe("workflow release", () => {
  it("memanggil validate.yml, bukan menyalin langkahnya", () => {
    expect(release).toContain("uses: ./.github/workflows/validate.yml");
  });

  // Inti issue #1: tanpa `needs`, job publish jalan berdampingan dengan validasi dan menerbitkan
  // paket sebelum hasilnya diketahui.
  it("job publish menunggu validate", () => {
    const publish = release.slice(release.indexOf("\n  publish:"));
    expect(publish).toMatch(/^\s{4}needs:\s*validate\s*$/m);
  });

  it("publish tetap satu-satunya langkah yang menyentuh registry", () => {
    expect(release.match(/npm publish/g)).toHaveLength(1);
  });
});
