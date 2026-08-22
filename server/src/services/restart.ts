// SPEC-884 · ADR-0138 · satu-satunya tempat server meminta dirinya dijalankan ulang.
//
// Dipisah ke modul sendiri BUKAN demi kerapian: `process.exit` yang dipanggil langsung dari handler
// route membuat setiap test yang menyentuh POST /api/setup menjadwalkan exit di dalam worker vitest
// (terukur: "process.exit unexpectedly called with 76", dua kali, pada test yang tetap terlihat
// hijau). Modul kecil ini bisa di-mock; menambahkan cabang `NODE_ENV === "test"` di route tidak
// akan pernah bisa diuji dan menyembunyikan efek nyatanya.
import { CONFIG_RESTART_EXIT } from "@hanoman/shared";

/**
 * Ditunda sesaat supaya response sempat mengalir keluar sebelum proses berakhir — pemanggil
 * memasangnya pada `finish`, tapi `finish` menandai socket sudah ditulis, bukan sudah terkirim.
 * Yang menghidupkan server lagi adalah supervisor `hanoman start` (ADR-0088), bukan server ini.
 */
export function requestConfigRestart(delayMs = 50): void {
  setTimeout(() => process.exit(CONFIG_RESTART_EXIT), delayMs);
}
