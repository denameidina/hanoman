// Hook state tampilan persisten (SPEC-740 · ADR-0115). Pengganti langsung `React.useState`
// untuk field tampilan: tanda tangannya sama, hanya kuncinya yang ditambahkan di depan.
import React from "react";
import { onUiReset, readUiState, uiKey, writeUiState, type Accept } from "./store";

export function usePersistedState<T>(
  screen: string, field: string, initial: T, accept?: Accept<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const key = uiKey(screen, field);
  // `initial`/`accept` hampir selalu literal atau arrow inline di call site — memasukkannya
  // ke deps effect akan menulis ulang storage tiap render.
  const seed = React.useRef({ initial, accept });
  seed.current = { initial, accept };

  // Nilai DAN kunci pemiliknya disimpan bersama: tanpa itu, saat scope project berganti,
  // effect penulis sempat menyimpan nilai project LAMA di bawah kunci project BARU
  // sebelum effect pembaca menggantinya.
  const [snap, setSnap] = React.useState(() => ({ key, value: readUiState(key, initial, accept) }));
  if (snap.key !== key) setSnap({ key, value: readUiState(key, seed.current.initial, seed.current.accept) });

  React.useEffect(() => { writeUiState(snap.key, snap.value); }, [snap]);
  React.useEffect(() => onUiReset((prefix) => {
    if (key.startsWith(prefix)) setSnap({ key, value: seed.current.initial });
  }), [key]);

  const set = React.useCallback<React.Dispatch<React.SetStateAction<T>>>((next) => {
    setSnap((s) => ({
      key: s.key,
      value: typeof next === "function" ? (next as (prev: T) => T)(s.value) : next,
    }));
  }, []);

  return [snap.value, set];
}

// Berapa frame pemulihan boleh menunggu tinggi konten jadi final. Daftar yang datanya
// baru tiba tumbuh beberapa frame; daftar yang memang lebih pendek tak boleh membuat
// loop abadi.
const RESTORE_FRAMES = 20;

/** Ref callback untuk elemen bergulir: menyimpan `scrollTop` dan memulihkannya SETELAH
    `ready` (mis. data selesai dimuat). Ref callback, bukan RefObject — container daftar
    sering baru muncul sesudah state `loading` selesai. */
export function useScrollRestore<E extends HTMLElement = HTMLDivElement>(
  screen: string, field: string, ready = true,
): (node: E | null) => void {
  const key = uiKey(screen, field);
  const [el, setEl] = React.useState<E | null>(null);
  const ref = React.useCallback((node: E | null) => setEl(node), []);
  // Pemulihan menyetel scrollTop, yang memancarkan event scroll. Tanpa penanda ini,
  // percobaan pertama (saat konten masih pendek) menulis balik nilai TERPOTONG dan
  // posisi aslinya hilang sebelum konten sempat tumbuh.
  const restoring = React.useRef(false);

  React.useEffect(() => {
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (restoring.current || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; writeUiState(key, el.scrollTop); });
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [el, key]);

  React.useEffect(() => {
    if (!el || !ready) return;
    const saved = readUiState(key, 0);
    if (saved <= 0) return;
    let frames = 0;
    let raf = 0;
    restoring.current = true;
    const tick = () => {
      el.scrollTop = saved;
      const enough = el.scrollHeight - el.clientHeight >= saved;
      if (enough || ++frames >= RESTORE_FRAMES) { restoring.current = false; return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); restoring.current = false; };
  }, [el, key, ready]);

  return ref;
}
