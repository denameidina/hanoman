// Audit UI/UX 2026-10 · Fase 3C · satu aturan simpan untuk setelan auto-save.
//
// Tiap field punya nilai tampil (draft lokal bila sedang menunggu/menyimpan, atau nilai tersimpan),
// jadwal simpan (debounce untuk input yang diketik, langsung untuk kontrol diskret), dan status
// sendiri. Simpan yang gagal membuat nilai tampil kembali ke nilai tersimpan (rollback) dan status
// menjadi `error`, sehingga operator bisa mencoba lagi tanpa kehilangan jejak apa yang gagal.
import React from "react";

/** `pending` = menunggu jeda mengetik; `saving` = simpan berjalan; `saved` = tersimpan (memudar). */
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/** Jeda diam sebelum menyimpan input yang diketik. Kontrol diskret (sakelar, pilihan) memakai 0. */
export const SAVE_DEBOUNCE_MS = 400;
/** Berapa lama "Tersimpan" tampil sebelum kembali kosong. */
const SAVED_VISIBLE_MS = 1800;

export interface UseSettingFieldOptions<T> {
  /** Nilai tersimpan (dari snapshot settings). Draft lokal menimpanya selama menunggu/menyimpan. */
  value: T;
  /** Simpan nilai. Resolve `true` = tersimpan; `false` = gagal (rollback, status `error`). */
  save: (next: T) => boolean | Promise<boolean>;
  /** Jeda sebelum menyimpan. Default `SAVE_DEBOUNCE_MS`; `0` = langsung. */
  delayMs?: number;
}

export interface SettingField<T> {
  /** Nilai yang ditampilkan. */
  value: T;
  /** Ubah nilai; simpan dijadwalkan (atau langsung bila `delayMs` 0). Nilai sama dengan tersimpan dilewati. */
  set: (next: T) => void;
  /** Simpan sekarang bila ada perubahan yang masih menunggu jeda (dipanggil saat blur). */
  flush: () => void;
  status: SaveStatus;
  /** Ulangi simpan nilai yang terakhir gagal. */
  retry: () => void;
}

export function useSettingField<T>(opts: UseSettingFieldOptions<T>): SettingField<T> {
  const optsRef = React.useRef(opts);
  optsRef.current = opts;
  // `settled`: sudah tersimpan, tetapi nilai tampilnya tetap dipegang sampai `value` dari luar berubah.
  // Dengan begitu tampilan tak berkedip walau parent belum memperbarui snapshotnya.
  const [draft, setDraft] = React.useState<{ v: T; settled: boolean } | null>(null);
  const lastValue = React.useRef(opts.value);
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  // `seq` menomori setiap ubahan: simpan yang selesai setelah ada ubahan baru tak boleh menimpa keadaannya.
  const seq = React.useRef(0);
  const latest = React.useRef<{ v: T; id: number } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = React.useRef<{ v: T } | null>(null);
  const alive = React.useRef(false);
  // Jumlah simpan yang masih berjalan. Nilai yang "sama dengan tersimpan" hanya dilewati bila tak ada
  // simpan berjalan: simpan yang belum selesai bisa saja membawa nilai lain ke server.
  const inFlight = React.useRef(0);

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  const clearFade = () => {
    if (fade.current) { clearTimeout(fade.current); fade.current = null; }
  };

  const run = (v: T, id: number) => {
    clearTimer();
    // Nilai yang sama dengan yang tersimpan tak perlu PUT; cukup membuang draft-nya.
    if (inFlight.current === 0 && Object.is(v, optsRef.current.value)) {
      if (id === seq.current) { latest.current = null; setDraft(null); setStatus("idle"); }
      return;
    }
    inFlight.current++;
    setStatus("saving");
    Promise.resolve(optsRef.current.save(v)).then((ok) => {
      inFlight.current--;
      if (!alive.current || id !== seq.current) return;
      latest.current = null;
      if (ok) {
        failed.current = null;
        setDraft({ v, settled: true });
        setStatus("saved");
        clearFade();
        fade.current = setTimeout(() => {
          fade.current = null;
          if (alive.current) setStatus((cur) => (cur === "saved" ? "idle" : cur));
        }, SAVED_VISIBLE_MS);
      } else {
        // Gagal: draft dibuang dan nilai tampil kembali ke nilai tersimpan (rollback).
        failed.current = { v };
        setDraft(null);
        setStatus("error");
      }
    });
  };

  const set = (next: T) => {
    const id = ++seq.current;
    latest.current = { v: next, id };
    failed.current = null;
    clearFade();
    setDraft({ v: next, settled: false });
    clearTimer();
    const delay = optsRef.current.delayMs ?? SAVE_DEBOUNCE_MS;
    if (delay <= 0) { run(next, id); return; }
    setStatus("pending");
    timer.current = setTimeout(() => {
      timer.current = null;
      const l = latest.current;
      if (l) run(l.v, l.id);
    }, delay);
  };

  // Nilai dari luar berubah (mis. parent memperbarui snapshot): draft yang sudah tersimpan tak lagi perlu.
  React.useEffect(() => {
    if (Object.is(lastValue.current, opts.value)) return;
    lastValue.current = opts.value;
    setDraft((d) => (d && d.settled ? null : d));
  }, [opts.value]);

  const flush = () => {
    const l = latest.current;
    if (!timer.current || !l) return;
    run(l.v, l.id);
  };

  const retry = () => {
    const f = failed.current;
    if (f) set(f.v);
  };

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Ubahan yang masih menunggu jeda tak boleh hilang hanya karena tab ditutup: simpan sekarang.
      const l = latest.current;
      if (timer.current && l) {
        clearTimer();
        void Promise.resolve(optsRef.current.save(l.v));
      }
      clearFade();
    };
  }, []);

  return { value: draft ? draft.v : opts.value, set, flush, status, retry };
}
