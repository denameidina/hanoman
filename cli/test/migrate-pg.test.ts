import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  PG_ORDER, chunk, parseMigrateArgs, migrationSteps, coerceInt8, isUndefinedTable, INT8_OID,
} from "../src/commands/migrate-pg";

// SPEC-852 · issue #1 · `Prisma.dmmf` baru ada SESUDAH `prisma generate`, dan tanpanya berkas ini
// dulu meledak saat collect: vitest melaporkan `0 test` / `no tests` dengan pesan
// `Cannot read properties of undefined (reading 'datamodel')` yang tak menyebut Prisma sama
// sekali. Dibaca lewat optional chaining, prasyarat itu jadi satu test bernama yang menyebut
// perbaikannya — dan `--changed` (yang menyalakan `passWithNoTests`) tak bisa lagi membuat
// berkas yang gagal-collect terlihat hijau.
const models = Prisma.dmmf?.datamodel?.models ?? [];

describe("prasyarat Prisma Client", () => {
  it("DMMF ter-generate — jalankan `pnpm db:generate` bila kosong", () => {
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("PG_ORDER", () => {
  it("memuat setiap model Prisma tepat sekali", () => {
    expect([...PG_ORDER].sort()).toEqual(models.map((m) => m.name).sort());
    expect(new Set(PG_ORDER).size).toBe(PG_ORDER.length);
  });

  // Invarian yang benar-benar rapuh: FK menolak anak yang datang sebelum induk. Dijaga terhadap
  // DMMF, bukan komentar — model baru tanpa memperbarui urutan = test merah, bukan kegagalan
  // runtime di mesin orang lain.
  it("setiap model muncul SESUDAH induk relasinya (urutan FK sah)", () => {
    const at = new Map<string, number>(PG_ORDER.map((n, i) => [n, i]));
    const problems: string[] = [];
    for (const m of models) {
      for (const f of m.fields) {
        // sisi yang memegang FK adalah yang punya relationFromFields terisi
        if (f.kind !== "object" || !f.relationFromFields?.length) continue;
        if (f.type === m.name) continue;                       // self-relation: urutan baris yang menjamin
        if (at.get(m.name)! < at.get(f.type)!) problems.push(`${m.name}.${f.name} → ${f.type}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("chunk", () => {
  it("memotong sesuai ukuran, sisa ikut", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("kosong → kosong", () => {
    expect(chunk([], 3)).toEqual([]);
  });
  it("lebih kecil dari ukuran potong → satu potong", () => {
    expect(chunk([1], 200)).toEqual([[1]]);
  });
});

describe("parseMigrateArgs", () => {
  it("--from wajib", () => {
    expect(() => parseMigrateArgs([])).toThrow(/--from/);
  });
  it("bentuk lengkap", () => {
    expect(parseMigrateArgs(["--from", "postgresql://x/db", "--to", "/t/a.db", "--dry-run", "--force"]))
      .toEqual({ from: "postgresql://x/db", to: "/t/a.db", dryRun: true, force: true });
  });
  it("default: bukan dry-run, bukan force, target default", () => {
    expect(parseMigrateArgs(["--from", "postgres://x/db"]))
      .toEqual({ from: "postgres://x/db", to: null, dryRun: false, force: false });
  });
  it("--from harus URL postgres (bukan file: — itu targetnya, bukan sumbernya)", () => {
    expect(() => parseMigrateArgs(["--from", "file:/x.db"])).toThrow(/postgres/);
  });
  it("--to tanpa nilai → melempar, tak menelan flag berikutnya", () => {
    expect(() => parseMigrateArgs(["--from", "postgres://x/db", "--to", "--force"])).toThrow(/--to/);
  });
  it("argumen tak dikenal → melempar", () => {
    expect(() => parseMigrateArgs(["--from", "postgres://x/db", "--wat"])).toThrow(/--wat/);
  });
});

describe("migrationSteps", () => {
  const base = { from: "postgres://x/db", to: null, force: false };
  // Regresi: dry-run sempat memanggil count() pada target yang belum dimigrasi dan gagal
  // "The table `main.Project` does not exist". Dry-run adalah pertanyaan tentang SUMBER.
  it("dry-run tak menyentuh target sama sekali", () => {
    expect(migrationSteps({ ...base, dryRun: true }))
      .toEqual({ prepareTarget: false, checkTarget: false, write: false });
  });
  it("run sungguhan menyiapkan, memeriksa, lalu menulis target", () => {
    expect(migrationSteps({ ...base, dryRun: false }))
      .toEqual({ prepareTarget: true, checkTarget: true, write: true });
  });
  it("--force tak mengubah langkah — ia hanya mengubah reaksi saat target berisi", () => {
    expect(migrationSteps({ ...base, dryRun: false, force: true }))
      .toEqual(migrationSteps({ ...base, dryRun: false }));
  });
});

// Regresi terukur saat cutover hub produksi (2026-07-31): `SyncLog.seq` adalah `bigint` di Postgres
// lama (sisa `@default(autoincrement())` yang dipetakan int8) sedangkan schema SQLite memakai `Int`.
// Driver `pg` mengembalikan int8 sebagai STRING supaya presisi 64-bit tak hilang → Prisma menolak
// `Argument seq: Expected Int, provided String` di tengah jalan, sesudah 13 tabel terlanjur tertulis.
// Yang bikin mahal: `--dry-run` LULUS, karena ia tak pernah menulis.
describe("coerceInt8", () => {
  const fields = [{ name: "seq", dataTypeID: INT8_OID }, { name: "entity", dataTypeID: 25 }];

  it("kolom int8 string → number; kolom lain tak disentuh", () => {
    expect(coerceInt8([{ seq: "44770", entity: "Spec" }], fields, "SyncLog"))
      .toEqual([{ seq: 44770, entity: "Spec" }]);
  });
  it("null tetap null — bukan 0", () => {
    expect(coerceInt8([{ seq: null, entity: "x" }], fields, "SyncLog")).toEqual([{ seq: null, entity: "x" }]);
  });
  it("bigint asli (driver versi lain) ikut dikoersi", () => {
    expect(coerceInt8([{ seq: 7n, entity: "x" }], fields, "SyncLog")).toEqual([{ seq: 7, entity: "x" }]);
  });
  it("tanpa kolom int8 → baris dikembalikan apa adanya", () => {
    const rows = [{ entity: "x" }];
    expect(coerceInt8(rows, [{ name: "entity", dataTypeID: 25 }], "SyncLog")).toEqual(rows);
  });
  // Diam-diam membulatkan ke float lebih buruk daripada berhenti: kursor sync yang salah satu digit
  // membuat perangkat melompati baris SELAMANYA (SPEC-382).
  it("di luar jangkauan aman → melempar dan menyebut tabel + kolom", () => {
    expect(() => coerceInt8([{ seq: "9007199254740993" }], fields, "SyncLog"))
      .toThrow(/SyncLog\.seq/);
  });
});

// Regresi kedua dari cutover yang sama: `SessionHistory` LOCAL-only (SPEC-362) tak pernah ada di
// Postgres, jadi `SELECT *` melempar 42P01 dan MEMATIKAN seluruh migrasi. Tabel yang tak ada di
// sumber berarti nol baris — bukan alasan membuang 45 ribu baris lainnya.
describe("isUndefinedTable", () => {
  it("42P01 → true", () => {
    expect(isUndefinedTable(Object.assign(new Error('relation "SessionHistory" does not exist'), { code: "42P01" })))
      .toBe(true);
  });
  it("galat lain (mis. koneksi putus) → false, harus tetap menggagalkan migrasi", () => {
    expect(isUndefinedTable(Object.assign(new Error("connection terminated"), { code: "57P01" }))).toBe(false);
    expect(isUndefinedTable(new Error("boom"))).toBe(false);
    expect(isUndefinedTable(null)).toBe(false);
  });
});
