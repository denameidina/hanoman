import { defineConfig, configDefaults } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Import berkasnya LANGSUNG, bukan lewat barrel `@hanoman/runner`: pemuat config Vite
// mem-bundle berkas ini dengan esbuild dan barrel runner me-re-export modul TS tanpa ekstensi,
// yang gagal di-resolve loader ESM node (ERR_MODULE_NOT_FOUND).
import { resolveDbUrl } from "../runner/src/paths";

// PrismaClient reads DATABASE_URL from process.env at runtime (only the CLI
// auto-loads .env). Load the root .env so server tests have one.
try {
  for (const line of readFileSync(resolve(import.meta.dirname, "../.env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* .env optional in CI where env is already set */ }

// SPEC-398 · ADR-0086 · DB test kini BERKAS di sebelah DB nyata (`….test.db`), bukan database
// Postgres bersama. Dua kelas gagal palsu ikut hilang: worktree tetangga tak bisa lagi men-truncate
// DB test sesi lain, dan tak ada lagi DB test yang harus di-`migrate deploy` manual (global-setup
// yang mengerjakannya). Tetap menolak jalan bila berkasnya sama dengan DB nyata.
{
  const schemaDir = resolve(import.meta.dirname, "prisma");
  const real = resolveDbUrl(process.env, schemaDir);
  const test = process.env.TEST_DATABASE_URL
    ?? (real.endsWith(".db") ? `${real.slice(0, -3)}.test.db` : `${real}.test.db`);
  if (test === real) throw new Error("vitest: menolak jalan — DB test sama dengan DATABASE_URL nyata");
  process.env.DATABASE_URL = test;
}

// Sesi terminal hidup di tmux server, dan `killAll()` membunuh server itu seluruhnya.
// Socket terpisah supaya test tidak pernah menyentuh sesi hanoman (atau tmux) yang nyata.
// SPEC-861 · `??=`, bukan `=`: default `hanoman-test` DIPAKAI BERSAMA semua worktree di satu
// mesin, jadi `killAll()` sebuah run membunuh sesi tmux run TETANGGA di tengah kerjanya (dan
// sebaliknya). Terukur pada `terminal.route.test.ts`: **75 gagal → 18 gagal** semata sebagai
// fungsi isolasi socket, tanpa satu baris pun perubahan kode. Beri `HANOMAN_TMUX_SOCKET` sendiri
// per sesi bila ada run lain di mesin ini — cermin `TEST_DATABASE_URL` (SPEC-479).
process.env.HANOMAN_TMUX_SOCKET ??= "hanoman-test";
// SPEC-215 · deteksi update kini dibaca via resolver config (default registry "1"). Test tak boleh
// menyentuh jaringan → paksa OFF di sini (dulu tergantung server.ts yang tak dimuat test).
process.env.HANOMAN_UPDATE_FETCH = "0";

export default defineConfig({
  test: {
    environment: "node",
    // SPEC-398 · terapkan migrasi ke berkas DB test sebelum test pertama menyentuhnya.
    globalSetup: ["./test/global-setup.ts"],
    // Every server test file re-seeds the same SQLite DB file in beforeAll; running
    // files in parallel would race on deleteMany/createMany. Force sequential.
    fileParallelism: false,
    // `.worktrees/**` holds transient/orphaned hanoman checkouts — full repo
    // copies whose test files would collide on the shared DB. Never let the
    // parent suite scan them.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
  },
});
