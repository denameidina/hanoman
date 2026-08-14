import { readdirSync, existsSync, statSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * SPEC-403 · Sesi terminal LAHIR tapi layarnya kosong di instalasi `npm i -g hanoman`.
 *
 * Sesi hidup di tmux (ADR-0016); yang menjembatani pane ke WebSocket adalah klien `tmux attach`
 * di atas node-pty. node-pty meng-exec biner pendamping `spawn-helper` yang duduk di sebelah
 * `pty.node`. Di tarball node-pty@1.1.0 biner itu terbit dengan mode **0644** untuk semua
 * platform unix (`tar tvf node-pty-1.1.0.tgz` → `-rw-r--r--`), jadi `posix_spawnp` gagal dengan
 * EACCES. Kegagalannya SENYAP dari sisi pengguna: pane tmux tetap hidup dan terisi, WebSocket
 * tetap tersambung, hanya tak pernah ada satu byte pun yang mengalir → terminal blank.
 *
 * pnpm memulihkan bit exec saat mengait berkas dari store, npm tidak — itulah kenapa bug ini
 * tak pernah terlihat saat `pnpm dev` dan hanya menghantam orang yang install dari npm.
 *
 * Diperbaiki saat start, bukan lewat `postinstall`: postinstall bisa dilewati (`--ignore-scripts`,
 * sebagian setup npm global) — pola yang sama dipakai `ensurePrismaClient`.
 *
 * SPEC-403 (lanjutan, 2026-08-14) · modul ini duduk di `runner` (bukan di `cli`) karena penawarnya HARUS dipasang di
 * jalur yang benar-benar meng-exec node-pty, bukan di satu perintah tertentu. Sebelumnya ia hidup
 * di `cli/src/commands/start.ts` dan hanya jalan lewat `hanoman start`; deployment yang memanggil
 * `node dist/server.js` langsung (launchd/systemd unit yang menunjuk bundle server) melewatinya
 * sepenuhnya, jadi bug 2026-08 di atas kambuh persis pada setiap `npm i -g hanoman` — terukur di
 * mesin nyata: `prebuilds/darwin-arm64/spawn-helper` kembali `-rw-r--r--` sesudah update, pane
 * tmux berisi 13 KB teks, terminal dashboard hitam total.
 */
export function spawnHelperPaths(
  ptyDir: string,
  listDir: (d: string) => string[],
  exists: (p: string) => boolean,
): string[] {
  const dirs = [join(ptyDir, "build", "Release")];
  // Semua prebuild disapu, bukan cuma milik platform ini: menebak nama direktori berarti
  // menduplikasi resolusi node-gyp-build milik node-pty, dan tebakan yang meleset gagal SENYAP —
  // persis mode kegagalan yang sedang diperbaiki. chmod pada biner platform lain tak berbahaya.
  for (const name of listDir(join(ptyDir, "prebuilds"))) dirs.push(join(ptyDir, "prebuilds", name));
  return dirs.map((d) => join(d, "spawn-helper")).filter(exists);
}

export type ModeOps = { mode: (p: string) => number; chmod: (p: string, m: number) => void };

/** Menambahkan bit exec ke helper yang belum punya. Mengembalikan yang benar-benar diperbaiki. */
export function ensureSpawnHelpersExecutable(paths: string[], ops: ModeOps): string[] {
  const fixed: string[] = [];
  for (const p of paths) {
    try {
      const mode = ops.mode(p) & 0o7777;
      if ((mode & 0o111) === 0o111) continue;
      // Bit exec DITAMBAHKAN, bukan mode diganti 0o755: instalasi yang sengaja mempersempit
      // izin baca (mis. 0o640 di home multi-user) tak boleh jadi lebih terbuka gara-gara ini.
      ops.chmod(p, mode | 0o111);
      fixed.push(p);
    } catch { /* EPERM di instalasi milik root: bukan alasan menolak start — lihat pemanggil. */ }
  }
  return fixed;
}

/**
 * Membungkus dua fungsi di atas dengan fs sungguhan. **Tak pernah melempar.**
 *
 * `resolve` datang dari pemanggil (`createRequire(import.meta.url).resolve`) alih-alih dibuat di
 * sini: di bawah pnpm, node-pty hanya terpasang di `node_modules` milik `server`, jadi resolusi
 * dari modul ini sendiri akan meleset di dev sementara pemanggilnya bisa melihatnya.
 */
export function repairSpawnHelper(
  resolve: (id: string) => string,
  notify?: (msg: string) => void,
): string[] {
  let ptyDir: string;
  try {
    ptyDir = dirname(resolve("node-pty/package.json"));
  } catch { return []; }   // node-pty tak terpasang: server yang akan mengeluh, bukan di sini.
  const paths = spawnHelperPaths(ptyDir, (d) => { try { return readdirSync(d); } catch { return []; } }, existsSync);
  const fixed = ensureSpawnHelpersExecutable(paths, {
    mode: (p) => statSync(p).mode,
    chmod: (p, m) => chmodSync(p, m),
  });
  if (fixed.length) notify?.("hanoman · memperbaiki izin `spawn-helper` node-pty (sekali per instalasi)\n");
  return fixed;
}

let repaired = false;

/**
 * Versi sekali-jalan untuk dipasang di jalur panas (`spawnPty`): pemeriksaannya beberapa `stat`,
 * murah, tapi tak ada gunanya diulang tiap sesi lahir. Di-reset hanya oleh test.
 */
export function ensureSpawnHelperOnce(
  resolve: (id: string) => string,
  notify?: (msg: string) => void,
): string[] {
  if (repaired) return [];
  repaired = true;
  return repairSpawnHelper(resolve, notify);
}

/** Hanya untuk test. */
export function resetSpawnHelperMemo(): void { repaired = false; }
