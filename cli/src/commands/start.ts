// SPEC-398 · ADR-0087 · `hanoman` (tanpa argumen) = perintah tunggal yang menjalankan hanoman:
// resolve home → terapkan migrasi → spawn bundle server dengan NODE_ENV=production supaya ia
// menyajikan dashboard dari dalam paket. Server hidup sebagai proses ANAK (bukan import) supaya
// sinyal, exit code, dan flag node-nya bersih; sesi tmux tetap selamat dari restart (ADR-0016).
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveHome, resolveDbUrl, dbFilePath, prismaCliPath, dbUrlNotice, repairSpawnHelper,
} from "@hanoman/runner";
import { UPDATE_RESTART_EXIT } from "@hanoman/shared";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { INSTALL_ARGS } from "./update";

export type StartOpts = { port: number | null; host: string | null; db: string | null; migrate: boolean };

export function parseStartArgs(argv: string[]): StartOpts {
  const out: StartOpts = { port: null, host: null, db: null, migrate: true };
  const value = (i: number, flag: string, inline: string | undefined): string => {
    const v = inline ?? argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} butuh nilai`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    if (flag === "--no-migrate") { out.migrate = false; continue; }
    if (flag === "--port") {
      const v = value(i, "--port", inline);
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--port harus angka, dapat "${v}"`);
      out.port = n; if (inline === undefined) i++; continue;
    }
    if (flag === "--host") { out.host = value(i, "--host", inline); if (inline === undefined) i++; continue; }
    if (flag === "--db") { out.db = value(i, "--db", inline); if (inline === undefined) i++; continue; }
    throw new Error(`argumen tak dikenal untuk start: ${raw}`);
  }
  return out;
}

export function distDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Menjalankan CLI prisma. Keluarannya di-BUFFER lalu diteruskan, bukan `stdio: "inherit"`, supaya
 * pemanggil bisa mengenali kode error Prisma dan menggantinya dengan pesan yang bisa
 * ditindaklanjuti (lihat `migrateFailureHint`). Error yang dilempar membawa `output`.
 */
function runPrisma(args: string[], dbUrl: string): string {
  const prismaCli = prismaCliPath(createRequire(import.meta.url).resolve);
  try {
    const out = execFileSync(process.execPath, [prismaCli, ...args], {
      env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(out);
    return out;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    process.stderr.write(output);
    throw Object.assign(new Error("prisma gagal"), { output });
  }
}

/**
 * Menerjemahkan kegagalan `migrate deploy` yang PUNYA sebab spesifik menjadi petunjuk yang bisa
 * dikerjakan; `null` untuk kegagalan lain — jangan mengarang penjelasan.
 *
 * P3005 = berkas DB sudah punya tabel tapi tak punya tabel riwayat `_prisma_migrations`. Ini
 * TERJADI di pemakaian nyata: `~/.hanoman/hanoman.db` milik prototipe hanoman lama (tabel
 * `runs`/`meta`, nol baris) menyerobot nama berkas yang dipakai versi Prisma. Pesan asli Prisma
 * menyuruh operator "baseline an existing production database" — jargon yang tak berarti apa pun
 * bagi orang yang baru `npm i -g hanoman`, dan menyesatkan karena DB-nya bukan miliknya.
 */
export function migrateFailureHint(output: string, dbFile: string): string | null {
  if (!output.includes("P3005")) return null;
  return (
    `hanoman: berkas DB ${dbFile} sudah berisi tabel, tapi tak punya riwayat migrasi hanoman.\n` +
    `Biasanya ia bukan DB hanoman versi ini — mis. sisa prototipe lama atau berkas tool lain.\n` +
    `Pilih salah satu:\n` +
    `  • Pindahkan berkas itu, lalu jalankan ulang:  mv "${dbFile}" "${dbFile}.lama"\n` +
    `  • Pakai berkas lain:  hanoman --db /path/baru.db  (atau HANOMAN_DATABASE_URL=file:/path/baru.db)\n` +
    `Isi berkas lama tidak diubah oleh hanoman — periksa dulu sebelum menghapusnya.`
  );
}

/** `prisma migrate deploy` lewat CLI prisma yang ikut terpasang sebagai dependency paket. */
export function applyMigrations(schema: string, dbUrl: string): void {
  runPrisma(["migrate", "deploy", "--schema", schema], dbUrl);
}

/**
 * `@prisma/client` yang datang dari npm adalah STUB: kodenya baru ada setelah `prisma generate`.
 *
 * GOTCHA terukur di instalasi `npm i -g` nyata: migrasi berhasil, server lalu mati seketika dengan
 * "@prisma/client did not initialize yet". `npm install` sendiri tidak pernah menghasilkan client —
 * paket terbit karena itu punya `postinstall`, TAPI postinstall bisa dilewati (`--ignore-scripts`,
 * beberapa CI, sebagian setup npm global), jadi pemeriksaannya diulang di sini saat start.
 *
 * Pemeriksaannya LANGSUNG — mencoba mengonstruksi client dan menangkap kegagalannya — bukan menebak
 * dari keberadaan berkas: berkas stub `default.js` memang ADA justru saat client belum di-generate,
 * jadi `existsSync` akan selalu berkata "sudah siap".
 */
export async function prismaClientUsable(): Promise<boolean> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    new PrismaClient();     // konstruksi saja; Prisma menyambung DB secara lazy
    return true;
  } catch { return false; }
}

export async function ensurePrismaClient(schema: string, dbUrl: string, ctx: Ctx): Promise<boolean> {
  if (await prismaClientUsable()) return true;
  ctx.stdout("hanoman · menyiapkan Prisma client (sekali per instalasi)\n");
  try { runPrisma(["generate", "--schema", schema], dbUrl); return true; }
  catch {
    ctx.stderr("hanoman: `prisma generate` gagal — jalankan manual di direktori paket, " +
      "atau pasang ulang tanpa --ignore-scripts\n");
    return false;
  }
}

/**
 * SPEC-403 · terminal blank di instalasi npm karena `spawn-helper` node-pty kehilangan bit exec.
 * Implementasinya pindah ke `@hanoman/runner` (`runner/src/spawn-helper.ts`) dan dipasang di
 * `spawnPty` — lihat catatan panjang di sana. Yang di sini tinggal pemanggilan lebih awal supaya
 * `hanoman start` sempat MELAPORKAN perbaikannya ke operator sebelum server lahir.
 */
function repairSpawnHelperEarly(ctx: Ctx): void {
  repairSpawnHelper(createRequire(import.meta.url).resolve, ctx.stdout);
}

/**
 * SPEC-405 · ADR-0088 · `hanoman start` adalah SUPERVISOR-nya, bukan sekadar peluncur.
 *
 * Server tak pernah memanggil `npm`; ia hanya keluar dengan kode sentinel saat operator menekan
 * "Pasang & mulai ulang" di dashboard. Yang memasang lalu menjalankan ulang adalah proses ini —
 * itulah kenapa ADR-0048 tetap benar di intinya: server tak memasang perangkat lunak apa pun.
 */
export const MAX_UPDATE_RESTARTS = 5;

export type SupervisorStep = { action: "exit"; code: number } | { action: "update" };

/**
 * Murni. HANYA kode sentinel yang berarti "pasang lalu jalankan lagi" — kode lain diteruskan apa
 * adanya, jadi `hanoman start` yang tak pernah diminta update berperilaku byte-identik dengan
 * sebelum SPEC-405.
 *
 * Jatah `MAX_UPDATE_RESTARTS` adalah pagar terhadap rilis yang meminta restart berulang: aksinya
 * dipicu manusia, jadi loop tak berujung bukan mode kegagalan otomatis — tapi batasnya murah dan
 * pemanggil WAJIB mencetak alasannya saat jatah habis (jangan pernah membatasi diam-diam).
 */
export function planSupervisorStep(code: number, restartsUsed: number): SupervisorStep {
  if (code !== UPDATE_RESTART_EXIT) return { action: "exit", code };
  if (restartsUsed >= MAX_UPDATE_RESTARTS) return { action: "exit", code };
  return { action: "update" };
}

export type ServerEnvInput = {
  dbUrl: string; port: number; host: string; home: string; web: string | null;
};

/**
 * Env proses anak. `HANOMAN_SUPERVISOR=1` disuntik DI SINI dan hanya di sini — ia satu-satunya
 * bukti bahwa ada yang akan menghidupkan server lagi, dan server memakainya untuk memutuskan
 * apakah tombol update boleh ada.
 */
export function serverEnv(o: ServerEnvInput): Record<string, string> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: o.dbUrl,
    PORT: String(o.port),
    HOST: o.host,
    HANOMAN_HOME: o.home,
    HANOMAN_SUPERVISOR: "1",
    ...(o.web ? { HANOMAN_WEB_DIR: o.web } : {}),
  };
}

export type InstallOutcome = { ok: true } | { ok: false; reason: string };

/** `npm i -g hanoman@latest`. Tak pernah melempar — kegagalannya data, bukan crash. */
export function installLatest(): InstallOutcome {
  try { execFileSync("npm", [...INSTALL_ARGS], { stdio: "inherit" }); return { ok: true }; }
  catch (e) { return { ok: false, reason: (e as Error).message || "npm i -g gagal" }; }
}

/**
 * Satu putaran hidup server anak. Listener sinyal DIPASANG DAN DILEPAS per putaran: di dalam loop
 * supervisor, memasangnya tanpa melepas akan menumpuk listener tiap restart sampai node
 * memperingatkan kebocoran.
 */
function runServer(serverJs: string, env: Record<string, string>): Promise<number> {
  const child = spawn(process.execPath, [serverJs], { stdio: "inherit", env: { ...process.env, ...env } });
  const handlers = (["SIGINT", "SIGTERM"] as const).map((sig) => [sig, () => child.kill(sig)] as const);
  for (const [sig, h] of handlers) process.on(sig, h);
  return new Promise<number>((res) => child.on("exit", (code) => {
    for (const [sig, h] of handlers) process.off(sig, h);
    res(code ?? 0);
  }));
}

export default async function start(argv: string[], ctx: Ctx): Promise<number> {
  process.umask(0o077);
  let opts: StartOpts;
  try { opts = parseStartArgs(argv); } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 2; }

  let layout: ReturnType<typeof resolveLayout>;
  let dbUrl: string;
  try {
    layout = resolveLayout(distDir(), existsSync);
    dbUrl = opts.db ? `file:${resolvePath(opts.db)}` : resolveDbUrl(ctx.env, dirname(layout.schema));
  } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }

  // `DATABASE_URL` asing diabaikan, tapi TIDAK diam-diam — lihat amandemen ADR-0086.
  const notice = dbUrlNotice(ctx.env);
  if (notice) ctx.stderr(`${notice}\n`);

  const home = resolveHome(ctx.env);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  mkdirSync(dirname(dbFilePath(dbUrl)), { recursive: true, mode: 0o700 });

  if (!existsSync(layout.server)) {
    ctx.stderr(`hanoman: bundle server tak ada di ${layout.server} — jalankan \`pnpm build\` dulu\n`);
    return 1;
  }
  if (!await ensurePrismaClient(layout.schema, dbUrl, ctx)) return 1;
  repairSpawnHelperEarly(ctx);
  if (opts.migrate) {
    ctx.stdout(`hanoman · menerapkan migrasi ke ${dbFilePath(dbUrl)}\n`);
    try { applyMigrations(layout.schema, dbUrl); }
    catch (e) {
      const hint = migrateFailureHint(String((e as { output?: string }).output ?? ""), dbFilePath(dbUrl));
      ctx.stderr(hint ? `\n${hint}\n` : "hanoman: `prisma migrate deploy` gagal — lihat keluaran di atas\n");
      return 1;
    }
  }
  if (existsSync(dbFilePath(dbUrl))) chmodSync(dbFilePath(dbUrl), 0o600);

  const port = opts.port ?? Number(ctx.env.PORT ?? 8787);
  const host = opts.host ?? ctx.env.HOST ?? "127.0.0.1";
  ctx.stdout(`hanoman · http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}\n`);

  const env = serverEnv({ dbUrl, port, host, home, web: layout.web ?? null });

  // SPEC-405 · ADR-0088 · loop supervisor. Tanpa permintaan update dari dashboard, ia berputar
  // tepat sekali dan berperilaku identik dengan sebelum SPEC-405.
  let restartsUsed = 0;
  for (;;) {
    const code = await runServer(layout.server, env);
    const step = planSupervisorStep(code, restartsUsed);
    if (step.action === "exit") {
      if (code === UPDATE_RESTART_EXIT) {
        ctx.stderr(`hanoman: jatah update-restart (${MAX_UPDATE_RESTARTS}) habis — keluar tanpa memasang\n`);
      }
      return step.code;
    }

    restartsUsed++;
    ctx.stdout(`hanoman · memasang versi terbaru dari npm (${restartsUsed}/${MAX_UPDATE_RESTARTS})\n`);
    const res = installLatest();
    if (!res.ok) {
      // Instance tak boleh mati permanen gara-gara registry down atau izin `sudo`: kembalikan
      // versi yang sudah ada dan katakan kenapa.
      ctx.stderr(`hanoman: update gagal — ${res.reason}\n`);
      ctx.stdout("hanoman · menjalankan ulang versi yang ada\n");
      continue;
    }

    // `prisma generate` TANPA cek dulu. `ensurePrismaClient` memeriksa dengan
    // `await import("@prisma/client")`, dan modul itu sudah ter-cache di proses ini sejak boot —
    // pemeriksaan kedua akan menjawab "siap" memakai modul LAMA sekalipun paketnya baru saja
    // diganti di disk. Kelas jebakan yang sama dengan `existsSync` di ADR-0087.
    try { runPrisma(["generate", "--schema", layout.schema], dbUrl); }
    catch { ctx.stderr("hanoman: `prisma generate` sesudah update gagal — lanjut; server anak yang akan mengeluh\n"); }

    if (opts.migrate) {
      // Migrasi gagal DITANGGAPI KERAS (beda dari install gagal): menjalankan bundle baru di atas
      // skema lama menukar downtime dengan kesalahan data, dan itu pertukaran yang buruk.
      try { applyMigrations(layout.schema, dbUrl); }
      catch (e) {
        const hint = migrateFailureHint(String((e as { output?: string }).output ?? ""), dbFilePath(dbUrl));
        ctx.stderr(hint ? `\n${hint}\n` : "hanoman: migrasi sesudah update gagal — lihat keluaran di atas\n");
        return 1;
      }
    }
    ctx.stdout("hanoman · terpasang; menjalankan ulang\n");
  }
}
