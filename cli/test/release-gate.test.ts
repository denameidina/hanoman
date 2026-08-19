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

  it("menjalankan `pnpm validate`", () => {
    expect(validate).toContain("pnpm validate");
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
