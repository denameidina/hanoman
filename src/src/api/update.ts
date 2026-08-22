import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

// SPEC-214 · status auto-update didorong lewat WS siar (grup "update"), pola api/limits.ts.
// SPEC-398 · ADR-0087 · isinya kini semver paket npm, bukan SHA git.
// Store singleton ref-count: badge topbar berlangganan satu feed. Default = up-to-date sampai
// frame pertama tiba (server kirim snapshot penuh saat connect).
const UP_TO_DATE: UpdateStatus = {
  currentVersion: "", latestVersion: null,
  registry: { status: "unavailable", checkedAt: null },
  updateAvailable: false, command: "", canApply: false,
};
// SPEC-868 · versi server saat tab ini memuat vs versi server sekarang. Lihat `trackServerVersion`.
export type VersionDrift = { boot: string | null; restartedTo: string | null };
export const NO_DRIFT: VersionDrift = { boot: null, restartedTo: null };

let state: UpdateStatus = UP_TO_DATE;
let drift: VersionDrift = NO_DRIFT;
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t !== "update") return;
      state = m.update;
      drift = trackServerVersion(drift, m.update.currentVersion);
      for (const s of subs) s();
    });
  }
  return () => { subs.delete(cb); if (subs.size === 0 && unsub) { unsub(); unsub = undefined; } };
}

export function useUpdate(): UpdateStatus { return useSyncExternalStore(subscribe, () => state, () => state); }

// Helper murni (di-uji unit): heading popover + label pill.
export function updateHeadline(u: UpdateStatus): string {
  if (!u.updateAvailable) return "Versi terpasang sudah terbaru";
  return `hanoman ${u.latestVersion} tersedia — pasang lalu restart instance ini`;
}
export function updateBadgeLabel(u: UpdateStatus): string {
  return u.latestVersion ? `Update · ${u.latestVersion}` : "Update";
}
// SPEC-763 · bentuk ringkas untuk topbar mobile: pil penuh 296px sendirian memaksa topbar jadi tiga
// baris. Yang dijatuhkan hanya kata "Update" — versinya tetap dirender, karena ikon telanjang tak
// mengatakan apa pun (lingkaran kosong), sementara "0.1.34" langsung terbaca sebagai versi baru.
export function updateBadgeLabelShort(u: UpdateStatus): string {
  return u.latestVersion ?? "Update";
}
// Baris kaki popover: versi jalan → versi terbaru. Versi kosong (dev/belum ter-stamp) → "?".
export function updateVersionLine(u: UpdateStatus): string {
  return `terpasang ${u.currentVersion || "?"} · tersedia ${u.latestVersion ?? "?"}`;
}
// SPEC-906 · kaki popover keadaan up-to-date. Ia menjawab pertanyaan yang muncul justru saat tak ada
// update: "sudah terbaru menurut siapa, dan sejak kapan?". `unavailable` BUKAN error — offline,
// opt-out, dan paket yang belum terbit semuanya mendarat di sana, jadi "tersedia ?" pada baris versi
// tak boleh dibaca sebagai "tak ada versi baru".
export function updateRegistryLine(u: UpdateStatus): string {
  if (u.registry.status !== "ok") return "Registry npm belum terbaca — versi tersedia tak bisa dipastikan.";
  if (!u.registry.checkedAt) return "Registry npm terbaca.";
  return `Registry npm diperiksa ${new Date(u.registry.checkedAt).toLocaleString("id-ID")}.`;
}

// ── SPEC-405 · ADR-0088 · memasang lalu menjalankan ulang dari dashboard ────────────────────────
export type ApplyOutcome =
  | { kind: "confirm"; liveSessions: number; from: string; to: string | null }
  | { kind: "accepted"; liveSessions: number; from: string; to: string | null }
  | { kind: "error"; message: string };

/**
 * Sengaja TIDAK lewat `api` client: helper `j<T>` di sana melempar untuk setiap non-2xx, sedangkan
 * `409 confirm-required` di sini BUKAN kegagalan — ia langkah pertama alur konfirmasi, dan isinya
 * (jumlah sesi hidup) justru yang dibutuhkan untuk memutuskan.
 */
export async function applyUpdate(confirm: boolean): Promise<ApplyOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/update/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
  } catch { return { kind: "error", message: "Server tak terjangkau." }; }

  let b: Record<string, unknown> = {};
  try { b = (await res.json()) as Record<string, unknown>; } catch { /* body kosong: pakai status */ }

  const from = String(b.from ?? "");
  const to = (b.to as string | null | undefined) ?? null;
  const live = Number(b.liveSessions ?? 0);

  if (res.status === 202) return { kind: "accepted", liveSessions: live, from, to };
  if (res.status === 409 && b.error === "confirm-required")
    return { kind: "confirm", liveSessions: live, from, to };
  return { kind: "error", message: applyErrorMessage(String(b.error ?? res.status)) };
}

/** Kode error server → kalimat yang bisa ditindaklanjuti. Kode tak dikenal tetap ditampilkan. */
export function applyErrorMessage(code: string): string {
  if (code === "unsupervised")
    return "Instance ini tidak dijalankan lewat `hanoman start`, jadi tak ada yang akan menghidupkannya lagi — pasang manual dengan perintah di atas.";
  if (code === "up-to-date") return "Versi terpasang ternyata sudah terkini.";
  return `Gagal memulai update (${code}).`;
}

/**
 * Kalimat konfirmasi. Ia menyebut fakta yang menenangkan sekaligus benar: pane tmux beserta agen di
 * dalamnya SELAMAT dari restart (ADR-0016) — yang terputus hanya jembatan terminalnya, beberapa
 * detik, dan dashboard menyambung ulang sendiri.
 */
export function applyConfirmMessage(liveSessions: number): string {
  if (liveSessions <= 0) return "Pasang versi baru lalu jalankan ulang hanoman? Tak ada sesi yang sedang berjalan.";
  return `${liveSessions} sesi sedang berjalan. Sesi itu tetap hidup di tmux dan terminalnya tersambung lagi sendiri. Lanjutkan?`;
}

// ── SPEC-868 · tab yang bundle-nya sudah ketinggalan servernya ─────────────────────────────────
// Diaudit dari laporan "tombol Pilih folder (SPEC-858) tak ada": kodenya utuh, dua instance
// menyajikannya, tapi restart update terjadi 10–59 menit sebelum laporan — tab yang sudah terbuka
// tetap menjalankan JS lama selamanya, karena tak ada yang memuat ulang halaman. Yang membuatnya
// tak terdeteksi: badge update justru MENGHILANG saat itu (`updateAvailable` kembali false), jadi
// tab paling basi terlihat paling terkini. `currentVersion` milik proses server sudah tiba tiap
// frame WS; yang kurang cuma membandingkannya dengan versi saat tab ini memuat.
/**
 * `prev` dipulangkan apa adanya saat tak ada perubahan — `getSnapshot` useSyncExternalStore wajib
 * referensial stabil, dan frame `update` datang tiap kali status registry di-recompute.
 */
export function trackServerVersion(prev: VersionDrift, currentVersion: string): VersionDrift {
  if (!currentVersion) return prev;
  if (prev.boot === null) return { boot: currentVersion, restartedTo: null };
  if (currentVersion === prev.boot)
    return prev.restartedTo === null ? prev : { boot: prev.boot, restartedTo: null };
  if (currentVersion === prev.restartedTo) return prev;
  return { boot: prev.boot, restartedTo: currentVersion };
}

/** Versi server saat ini bila ia sudah berbeda dari versi tab ini; null = bundle masih sejalan. */
export function useServerRestartedTo(): string | null {
  return useSyncExternalStore(subscribe, () => drift.restartedTo, () => drift.restartedTo);
}

export function reloadNoticeLabel(version: string): string { return `Muat ulang · ${version}`; }

export function reloadNoticeText(version: string): string {
  return `hanoman di server sudah diperbarui ke ${version}. Halaman ini masih menjalankan versi lama — muat ulang untuk memakainya.`;
}

/** Ekspor tersendiri karena `location` milik jsdom tak bisa diganti dengan bersih dari test. */
export function reloadPage(): void { location.reload(); }
