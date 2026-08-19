// SPEC-398 · ADR-0086 · resolusi lokasi data hanoman. Dipakai server (db.ts, vitest.config)
// DAN cli (`hanoman start`, `migrate-from-postgres`) — karena itu ia hidup di runner, satu-satunya
// library node-only yang kedua paket sudah bergantung padanya (`shared` ikut dibundel Vite ke
// browser, jadi ia tak boleh menyentuh `node:os`/`node:path`).
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type EnvLike = Record<string, string | undefined>;

/** Direktori data hanoman: `HANOMAN_HOME` bila diisi, jika tidak `~/.hanoman`. */
export function resolveHome(env: EnvLike = process.env, home: string = homedir()): string {
  const v = env.HANOMAN_HOME?.trim();
  return v ? v : join(home, ".hanoman");
}

/** Direktori data hanoman yang efektif — akar plus setiap turunannya. */
export type DataDirs = { home: string; transcripts: string; uploads: string; sshKeys: string };

/**
 * Seluruh lokasi data dalam SATU resolusi, supaya `$HANOMAN_HOME` benar-benar menjadi batas
 * backup/restore yang dijanjikan runbook (SPEC-846). Setiap pemakai yang menurunkan lokasinya
 * sendiri adalah drift menunggu terjadi: sebelum ini `vps-key.ts` menurunkannya dari `homedir()`,
 * jadi key SSH mendarat di luar `HANOMAN_HOME` dan backup home tak memuat identitas SSH sama sekali.
 *
 * `sshKeys` default ke AKAR home, bukan subdirektori: di situlah key sudah hidup sejak SPEC-165,
 * dan memindahkannya akan membuat instance `~/.hanoman` melahirkan identitas baru diam-diam.
 *
 * Server punya lapis override yang lebih tinggi (`effectiveStr`: DB → env). Nilai di sini sudah
 * memperhitungkan env, jadi ia aman dipakai sebagai fallback dari lapis itu.
 */
export function resolveDataDirs(env: EnvLike = process.env, home: string = homedir()): DataDirs {
  const root = resolveHome(env, home);
  const dir = (key: string, name: string): string => env[key]?.trim() || join(root, name);
  return {
    home: root,
    transcripts: dir("HANOMAN_TRANSCRIPT_DIR", "transcripts"),
    uploads: dir("HANOMAN_UPLOAD_DIR", "uploads"),
    sshKeys: env.HANOMAN_SSH_KEY_DIR?.trim() || root,
  };
}

/** Skema dari URL, tanpa membawa kredensial yang mungkin ada di dalamnya. */
function schemeOf(raw: string): string {
  return raw.split("://")[0] ?? "?";
}

/**
 * URL SQLite absolut untuk Prisma. `schemaDir` = direktori `schema.prisma`, karena Prisma
 * me-resolve path relatif di `file:` URL relatif terhadap situ — BUKAN cwd. Menyamakan aturannya
 * di sini mencegah kelas bug paling mahal di setup ini: CLI dan runtime menunjuk dua berkas beda.
 *
 * Presedensi: `HANOMAN_DATABASE_URL` → `DATABASE_URL` → `<home>/hanoman.db`.
 *
 * `HANOMAN_DATABASE_URL` ada karena `hanoman` dipasang **global** dan mewarisi shell apa pun,
 * sementara `DATABASE_URL` adalah nama env var paling umum yang ada. Nilai non-`file:` di
 * `DATABASE_URL` karena itu hampir selalu milik project LAIN dan **diabaikan** (dengan peringatan
 * dari `dbUrlNotice`, bukan senyap); di knob milik hanoman sendiri niatnya eksplisit, jadi di situ
 * nilai non-`file:` tetap **melempar** — lihat amandemen ADR-0086.
 */
export function resolveDbUrl(env: EnvLike, schemaDir: string): string {
  const own = env.HANOMAN_DATABASE_URL?.trim();
  if (own) {
    if (!own.startsWith("file:")) {
      throw new Error(
        `HANOMAN_DATABASE_URL harus URL SQLite \`file:…\` sejak ADR-0086 (dapat \`${schemeOf(own)}\`). ` +
        `Masih punya data Postgres? Pindahkan sekali: hanoman migrate-from-postgres --from "<url-postgres>"`,
      );
    }
    return absoluteFileUrl(own, schemaDir);
  }
  const raw = env.DATABASE_URL?.trim();
  // Non-`file:` diabaikan, bukan fatal: var itu milik project lain, bukan konfigurasi hanoman.
  if (!raw || !raw.startsWith("file:")) return `file:${join(resolveHome(env), "hanoman.db")}`;
  return absoluteFileUrl(raw, schemaDir);
}

function absoluteFileUrl(raw: string, schemaDir: string): string {
  const p = raw.slice("file:".length);
  if (p.startsWith(":")) return raw;              // file::memory: & kawan-kawan
  return `file:${isAbsolute(p) ? p : resolve(schemaDir, p)}`;
}

/**
 * Peringatan yang HARUS dicetak saat `DATABASE_URL` diabaikan — `null` bila tak ada yang
 * diabaikan. Terpisah dari `resolveDbUrl` supaya fungsi itu tetap murni & bebas I/O.
 *
 * Ini yang menjaga semangat ADR-0086: pengabaian tak boleh senyap, karena instance hanoman lama
 * yang benar-benar memakai Postgres akan tampak "kehilangan data" bila diam-diam boot ke DB kosong.
 * Nilai URL-nya TIDAK dicetak — hanya skemanya — karena ia biasanya memuat kredensial.
 */
export function dbUrlNotice(env: EnvLike): string | null {
  if (env.HANOMAN_DATABASE_URL?.trim()) return null;
  const raw = env.DATABASE_URL?.trim();
  if (!raw || raw.startsWith("file:")) return null;
  return (
    `hanoman: DATABASE_URL bertipe \`${schemeOf(raw)}\` DIABAIKAN — hanoman memakai SQLite ` +
    `(ADR-0086), dan var itu biasanya milik project lain.\n` +
    `  • Punya data Postgres hanoman? Pindahkan sekali: hanoman migrate-from-postgres --from "<url>"\n` +
    `  • Mau menunjuk berkas DB tertentu? Pakai HANOMAN_DATABASE_URL=file:/path/hanoman.db (atau --db)`
  );
}

/** Path berkas dari URL SQLite. Melempar untuk URL non-`file:` — jangan pernah menebak. */
export function dbFilePath(url: string): string {
  if (!url.startsWith("file:")) throw new Error(`bukan URL SQLite: ${url}`);
  return url.slice("file:".length);
}

/**
 * Path entry CLI prisma (`build/index.js`), dipanggil dengan `node <path> migrate deploy`.
 *
 * GOTCHA terukur di prisma 6.19: `require.resolve("prisma")` **tidak** memberi CLI-nya. Peta
 * `exports` paket itu memetakan `"."` ke `./build/types.js` — berkas yang TIDAK ADA di tarball —
 * sehingga resolusi bare-specifier gagal `MODULE_NOT_FOUND` alih-alih memberi `build/index.js`.
 * Yang di-ekspor resmi adalah subpath `./build/index.js` dan `./package.json`; keduanya dicoba di
 * sini supaya perubahan peta exports di versi berikutnya tak langsung mematikan `hanoman start`.
 */
export function prismaCliPath(resolver: (spec: string) => string): string {
  for (const spec of ["prisma/build/index.js", "prisma/package.json"]) {
    try {
      const p = resolver(spec);
      return spec.endsWith("package.json") ? join(dirname(p), "build", "index.js") : p;
    } catch { /* coba kandidat berikutnya */ }
  }
  throw new Error("CLI prisma tak ditemukan — `prisma` wajib terpasang sebagai dependency");
}
