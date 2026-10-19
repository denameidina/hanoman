// SPEC-884 · ADR-0139 · satu-satunya tempat server meminta dirinya dijalankan ulang.
//
// Dipisah ke modul sendiri BUKAN demi kerapian: `process.exit` yang dipanggil langsung dari handler
// route membuat setiap test yang menyentuh POST /api/setup menjadwalkan exit di dalam worker vitest
// (terukur: "process.exit unexpectedly called with 76", dua kali, pada test yang tetap terlihat
// hijau). Modul kecil ini bisa di-mock; menambahkan cabang `NODE_ENV === "test"` di route tidak
// akan pernah bisa diuji dan menyembunyikan efek nyatanya.
import { CONFIG_RESTART_EXIT, MANUAL_RESTART_EXIT } from "@hanoman/shared";
import { exitGuarded } from "./exit-guard";

/**
 * Ditunda sesaat supaya response sempat mengalir keluar sebelum proses berakhir — pemanggil
 * memasangnya pada `finish`, tapi `finish` menandai socket sudah ditulis, bukan sudah terkirim.
 * Yang menghidupkan server lagi adalah supervisor `hanoman start` (ADR-0088), bukan server ini.
 */
export function requestConfigRestart(delayMs = 50): void {
  setTimeout(() => exitGuarded(CONFIG_RESTART_EXIT), delayMs);
}

/** Bagian `ServerResponse` yang dibutuhkan `afterReplyFlushed` — `reply.raw` memenuhinya. */
export type FlushSignal = {
  once(event: "finish" | "close", cb: () => void): unknown;
  removeListener(event: "finish" | "close", cb: () => void): unknown;
};

/**
 * ADR-0200 · menjalankan `fn` (jadwal exit) HANYA SESUDAH balasan selesai ditulis ke socket
 * (`finish`), atau socket peminta sudah tertutup (`close` — tak ada lagi yang bisa dijawab), atau
 * plafon `maxWaitMs` lewat (klien menggantung; operator sudah memberi `confirm:true`, jadi restart
 * tak boleh tertahan selamanya). Sekali jalan: peristiwa berikutnya diabaikan.
 *
 * Kenapa ada: `POST /update/apply` dan `POST /restart` kini terjangkau agent token. Pemanggil yang
 * menerima koneksi putus tanpa balasan tak bisa membedakan "restart berjalan" dari "server mati" —
 * jadi urutan "jawab dulu, mati kemudian" ditegakkan di kode, bukan diandalkan dari jeda timer
 * yang dimulai SEBELUM balasan mengalir. `finish` hanya menandai byte sudah diserahkan ke kernel,
 * karena itu `requestRestartForUpdate/requestManualRestart` tetap menambah jeda sendiri sesudahnya.
 */
export function afterReplyFlushed(raw: FlushSignal, fn: () => void, maxWaitMs = 5_000): void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    raw.removeListener("finish", run);
    raw.removeListener("close", run);
    fn();
  };
  raw.once("finish", run);
  raw.once("close", run);
  timer = setTimeout(run, maxWaitMs);
}

/** Tombol "Mulai ulang" di dashboard. Sama seperti di atas, tapi tanpa jatah di supervisor. */
export function requestManualRestart(delayMs = 250): void {
  setTimeout(() => exitGuarded(MANUAL_RESTART_EXIT), delayMs);
}
