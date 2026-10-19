// ADR-0227 · `process.exit()` yang macet DI DALAM dirinya sendiri.
//
// Insiden 2026-10-19: server yang hidup 8 jam menerima SIGTERM, menutup semuanya dengan rapi
// (`SIGTERM — menutup`), memanggil `process.exit(0)` — lalu diam selamanya. Node menjalankan
// `uv_library_shutdown` → `uv__threadpool_cleanup`, yang wajib `pthread_join` setiap worker
// threadpool libuv; satu worker sudah lenyap sebelumnya dan tiga sisanya tak pernah menerima pesan
// keluar, jadi join itu tak pernah kembali. Batas waktu di graceful-shutdown.ts tak menolong: ia
// timer JS, dan kemacetannya terjadi SESUDAH JS selesai. Jalur restart dashboard (75/76/77) keluar
// lewat `process.exit` yang sama — supervisor lalu menunggu anak yang tak pernah mati, dan instance
// tak pernah hidup lagi.
//
// Yang bisa menghentikan proses yang macet di exit hanya SIGKILL dari LUAR. Karena itu, tepat
// sebelum keluar, server menitipkan pembunuhnya sendiri: `sh` terlepas yang menunggu sebentar lalu
// `kill -9` bila proses yang SAMA masih hidup. SIGKILL menghapus kode exit, jadi maksudnya ditulis
// dulu ke `$HANOMAN_HOME/exit-intent` untuk supervisor (`resolveChildExit` di cli `hanoman start`).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_INTENT_FILE, formatExitIntent } from "@hanoman/shared";
import { resolveHome } from "@hanoman/runner";

/** Proses yang sehat keluar dalam milidetik; lima detik hanya terlewati bila exit-nya macet. */
export const EXIT_WATCHDOG_MS = 5_000;

/**
 * Skrip watchdog. Waktu mulai proses dicatat saat watchdog lahir (server pasti masih hidup) dan
 * dibandingkan lagi sebelum `kill -9`, supaya PID yang sempat dipakai ulang tak ikut terbunuh.
 */
export function watchdogScript(pid: number, graceMs: number): string {
  const secs = Math.max(1, Math.ceil(graceMs / 1000));
  return `s=$(ps -o lstart= -p ${pid}); sleep ${secs}; `
    + `[ -n "$s" ] && [ "$(ps -o lstart= -p ${pid})" = "$s" ] && kill -9 ${pid}`;
}

/**
 * Meluncurkan watchdog terlepas (sesi proses sendiri, tanpa stdio) supaya ia tetap hidup sesudah
 * server mati dan tak menahan event loop. Di bawah vitest `process.exit` dicegat dan tak pernah
 * mengakhiri worker, jadi watchdog sungguhan akan meng-SIGKILL worker test — ditolak di sini.
 */
export function launchWatchdog(script: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST) return false;
  const child = spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return true;
}

export type ExitGuardDeps = {
  pid?: number;
  home?: string;
  graceMs?: number;
  writeIntent?: (path: string, text: string) => void;
  launch?: (script: string) => void;
  exit?: (code: number) => void;
};

/** `process.exit(code)` dengan watchdog terpasang. Kegagalan menyiapkannya tak pernah menahan exit. */
export function exitGuarded(code: number, d: ExitGuardDeps = {}): void {
  const pid = d.pid ?? process.pid;
  try {
    const write = d.writeIntent ?? ((p: string, t: string) => writeFileSync(p, t, { mode: 0o600 }));
    write(join(d.home ?? resolveHome(), EXIT_INTENT_FILE), formatExitIntent(pid, code));
  } catch { /* tanpa berkas maksud, supervisor tetap melihat SIGKILL — lebih baik daripada macet */ }
  try { (d.launch ?? launchWatchdog)(watchdogScript(pid, d.graceMs ?? EXIT_WATCHDOG_MS)); }
  catch { /* spawn gagal bukan alasan untuk tidak keluar */ }
  (d.exit ?? ((c: number) => process.exit(c)))(code);
}
