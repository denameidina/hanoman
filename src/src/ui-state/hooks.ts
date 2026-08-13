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
