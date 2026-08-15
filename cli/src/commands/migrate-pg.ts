// SPEC-398 · ADR-0086 · pindah sekali-jalan Postgres → SQLite. Dibutuhkan karena instance hanoman
// yang sudah hidup (termasuk hub produksi) menyimpan akun & tiket nyata di Postgres, dan cutover
// provider tanpa jalan pindah berarti membuang data orang.
//
// Skema hanoman tak memakai `@map` sama sekali, jadi nama kolom Postgres = nama field Prisma dan
// baris hasil `SELECT *` bisa langsung dipakai sebagai data `createMany`. Yang TIDAK boleh
// diserahkan pada nasib adalah URUTAN tabel: FK menolak anak yang datang sebelum induk. Karena itu
// PG_ORDER ditulis eksplisit dan diverifikasi test terhadap DMMF.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { resolveDbUrl, dbFilePath } from "@hanoman/runner";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir, applyMigrations, ensurePrismaClient } from "./start";

export const PG_ORDER = [
  // SPEC-450 · ADR-0094 · CustomAgent sesudah Project (FK projectId nullable → cascade).
  "Project", "Spec", "CustomAgent", "Setting", "Notification",
  // SPEC-516 · ADR-0105 · Changelog sesudah Project (FK projectId). Tabel ini LOCAL-only dan
  // lazimnya TIDAK ada di sumber Postgres lama — jalur 42P01 memperlakukannya sebagai nol baris.
  "Changelog",
  // SPEC-617 · ADR-0110 · ClientProjectAccess sesudah User DAN Project (FK ke keduanya).
  "User", "ClientProjectAccess", "Session", "DeviceToken", "AgentToken",
  "Vps", "VpsAuditSnapshot", "VpsItemState",
  "SessionResult", "SessionHistory",
  // SPEC-799 · ADR-0119 · SyncTombstone LOCAL-only, tanpa FK; letaknya bersama tabel sync lain.
  "SyncLog", "LocalBinding", "SyncOutbox", "SyncState", "SyncConflict", "SyncTombstone",
  // SPEC-485 · ADR-0102 · LeadFlow SEBELUM LeadDecision: `flowId` menunjuk ke sana. Tanpa FK, tapi
  // urutan tabel harus tetap mencerminkan arah tautannya bagi pembaca berikutnya.
  // SPEC-646 · ADR-0112 · SchedulerCron SEBELUM SchedulerCronRun: `cronId` menunjuk ke sana. Tanpa
  // FK (cermin SchedulerQueueItem/LeadDecision), tapi urutan tabel harus tetap mencerminkan arah
  // tautannya bagi pembaca berikutnya.
  "SchedulerQueueItem", "SchedulerCron", "SchedulerCronRun",
  "RuntimeConfig", "LeadFlow", "LeadDecision",
  // SPEC-476 · ADR-0096 · tabel gateway LOCAL-only; sumber Postgres lama lazimnya tidak punya
  // tabel ini dan jalur 42P01 di bawah memperlakukannya sebagai nol baris.
  "TelegramGatewayState", "TelegramChat", "TelegramUpdate", "TelegramMemory",
  "TelegramOutbox", "TelegramConfirmation", "TelegramAudit",
  "Ticket", "TicketAttachment",
  // SPEC-471 · ADR-0095 · GithubIssue sesudah Project (FK projectId) DAN sesudah Spec: `specId`
  // memang tanpa FK, tapi memindahkannya lebih awal membuat urutan tabel tak lagi mencerminkan
  // arah tautannya bagi pembaca berikutnya.
  "GithubIssue",
  // SPEC-481 · ADR-0100 · WebhookDelivery WAJIB sesudah WebhookEndpoint (FK endpointId).
  "WebhookEndpoint", "WebhookDelivery",
] as const;

const CHUNK = 200;

/** OID tipe `bigint` Postgres. `pg` mengembalikannya sebagai string demi presisi 64-bit. */
export const INT8_OID = 20;

type PgField = { name: string; dataTypeID: number };

/**
 * Postgres `bigint` → `Int` Prisma/SQLite. Driver `pg` menyerahkan int8 sebagai STRING (agar
 * presisi 64-bit tak hilang lewat `number`), dan Prisma menolak string untuk field `Int` — jadi
 * `SyncLog.seq` menggagalkan migrasi di tengah jalan. Koersi disandarkan pada `dataTypeID` hasil
 * query, bukan tebakan nama kolom, supaya tak ada kolom teks yang ikut jadi angka.
 *
 * Melempar bila nilainya di luar jangkauan integer aman JS: membulatkan diam-diam akan merusak
 * kursor sync tanpa jejak.
 */
export function coerceInt8<T extends Record<string, unknown>>(rows: T[], fields: PgField[], model: string): T[] {
  const cols = fields.filter((f) => f.dataTypeID === INT8_OID).map((f) => f.name);
  if (!cols.length) return rows;
  return rows.map((row) => {
    const out = { ...row } as Record<string, unknown>;
    for (const c of cols) {
      const v = out[c];
      if (v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isSafeInteger(n)) {
        throw new Error(`${model}.${c} = ${String(v)} di luar jangkauan integer aman — migrasi dihentikan`);
      }
      out[c] = n;
    }
    return out as T;
  });
}

/**
 * `42P01 undefined_table`. Model yang LOCAL-only (mis. `SessionHistory`, SPEC-362) atau ditambahkan
 * sesudah instance sumber lahir tak punya tabel di Postgres. Itu berarti nol baris, bukan alasan
 * membatalkan seluruh migrasi.
 */
export function isUndefinedTable(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "42P01";
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type MigrateOpts = { from: string; to: string | null; dryRun: boolean; force: boolean };

export function parseMigrateArgs(argv: string[]): MigrateOpts {
  const out: MigrateOpts = { from: "", to: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a === "--force") { out.force = true; continue; }
    if (a === "--from" || a === "--to") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new Error(`${a} butuh nilai`);
      if (a === "--from") out.from = v; else out.to = v;
      i++; continue;
    }
    throw new Error(`argumen tak dikenal: ${a}`);
  }
  if (!out.from) throw new Error("--from <postgresql://…> wajib");
  if (!/^postgres(ql)?:\/\//.test(out.from)) throw new Error("--from harus URL postgres://…");
  return out;
}

/**
 * Langkah mana yang benar-benar jalan. Dry-run **tidak boleh menyentuh target sama sekali** —
 * bukan cuma "tidak menulis": tanpa aturan ini ia sempat memanggil `count()` pada berkas SQLite
 * yang belum dimigrasi dan gagal "The table `main.Project` does not exist" (terukur saat dry-run
 * nyata terhadap Postgres dev). Dry-run adalah pertanyaan tentang SUMBER, bukan tujuan.
 */
export function migrationSteps(opts: MigrateOpts): { prepareTarget: boolean; checkTarget: boolean; write: boolean } {
  return { prepareTarget: !opts.dryRun, checkTarget: !opts.dryRun, write: !opts.dryRun };
}

type Delegate = {
  createMany(a: { data: unknown[] }): Promise<unknown>;
  count(): Promise<number>;
  deleteMany(): Promise<unknown>;
};

const delegateKey = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

export default async function migratePg(argv: string[], ctx: Ctx): Promise<number> {
  let opts: MigrateOpts;
  try { opts = parseMigrateArgs(argv); } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 2; }

  let layout: ReturnType<typeof resolveLayout>;
  let dbUrl: string;
  try {
    layout = resolveLayout(distDir(), existsSync);
    // Sejak amandemen ADR-0086, `DATABASE_URL` non-`file:` DIABAIKAN (bukan melempar), jadi
    // tanpa `--to` target jatuh ke `<home>/hanoman.db` — itu tujuan yang benar untuk perintah ini.
    // Yang masih melempar: `HANOMAN_DATABASE_URL` non-`file:`, karena di situ niatnya eksplisit.
    dbUrl = opts.to ? `file:${resolvePath(opts.to)}` : resolveDbUrl(ctx.env, dirname(layout.schema));
  } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }

  const steps = migrationSteps(opts);
  if (steps.prepareTarget) {
    if (!await ensurePrismaClient(layout.schema, dbUrl, ctx)) return 1;
    try { applyMigrations(layout.schema, dbUrl); }
    catch { ctx.stderr("`prisma migrate deploy` ke target gagal — lihat keluaran di atas\n"); return 1; }
  }
  process.env.DATABASE_URL = dbUrl;   // PrismaClient membacanya saat konstruksi

  const { Client } = await import("pg");
  const pg = new Client({ connectionString: opts.from });
  const db = steps.write || steps.checkTarget ? new (await import("@prisma/client")).PrismaClient() : null;
  const at = (model: string): Delegate => (db as unknown as Record<string, Delegate>)[delegateKey(model)]!;

  try {
    await pg.connect();

    if (steps.checkTarget) {
      const nonEmpty: string[] = [];
      for (const m of PG_ORDER) if (await at(m).count() > 0) nonEmpty.push(m);
      if (nonEmpty.length) {
        if (!opts.force) {
          ctx.stderr(`target sudah berisi data (${nonEmpty.join(", ")}) — pakai --force untuk menimpa\n`);
          return 1;
        }
        for (const m of [...PG_ORDER].reverse()) await at(m).deleteMany();   // urutan terbalik = FK aman
        ctx.stdout("target dikosongkan (--force)\n");
      }
    }

    let total = 0;
    for (const model of PG_ORDER) {
      let rows: Record<string, unknown>[];
      try {
        const res = await pg.query(`SELECT * FROM "${model}"`);
        rows = coerceInt8(res.rows as Record<string, unknown>[], res.fields as PgField[], model);
      } catch (e) {
        if (!isUndefinedTable(e)) throw e;
        ctx.stdout(`  ${"—".padStart(6)} · ${model} (tak ada di sumber — dilewati)\n`);
        continue;
      }
      total += rows.length;
      if (rows.length && steps.write) {
        for (const part of chunk(rows, CHUNK)) await at(model).createMany({ data: part });
      }
      ctx.stdout(`  ${opts.dryRun ? "akan pindah" : "pindah"} ${String(rows.length).padStart(6)} · ${model}\n`);
    }
    ctx.stdout(`${opts.dryRun ? "DRY RUN — tak ada yang ditulis. " : ""}${total} baris · ${dbFilePath(dbUrl)}\n`);
    return 0;
  } catch (e) {
    ctx.stderr(`migrasi gagal: ${(e as Error).message}\n`);
    return 1;
  } finally {
    await pg.end().catch(() => { /* sudah tertutup */ });
    await db?.$disconnect();
  }
}
