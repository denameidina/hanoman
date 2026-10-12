// Preferensi "Hanoman pet" yang dipakai banyak pemakai sekaligus: App (memutuskan apakah pet dirender),
// palet perintah ("Tampilkan Hanoman" / "Sembunyikan Hanoman"), dan pet sendiri (tombol Sembunyikan di
// panelnya). Disimpan di ui-state sebagai `hn.ui.v1.pet.enabled`.
//
// Mengapa modul ini, bukan `usePersistedState` saja: hook itu menyimpan nilainya di state tiap instans
// dan tak menyinkronkan dua instans. Palet yang menulis `false` tak akan dilihat pet yang masih
// memegang `true`. Karena itu nilainya dibagi lewat satu langganan kecil di sini.
//
// `null` = belum pernah dipilih: tier yang menentukan (desktop tampil, tablet dan ponsel mati).
// Akses storage selalu lewat `readUiState`/`writeUiState` yang sudah dibungkus try/catch; nilai di
// memori menutup kasus mode privat, tempat penulisan tak pernah bertahan.
import React from "react";
import { readUiState, uiKey, writeUiState } from "./store";

export type PetEnabled = boolean | null;
export type PetTier = "mobile" | "tablet" | "desktop";

const KEY = uiKey("pet", "enabled");
const isPetEnabled = (v: unknown): v is PetEnabled => v === null || typeof v === "boolean";

// `undefined` = belum dibaca dari storage. Setelah penulisan, memori menang atas storage.
let memory: PetEnabled | undefined;
const listeners = new Set<() => void>();

export function readPetEnabled(): PetEnabled {
  if (memory !== undefined) return memory;
  return readUiState<PetEnabled>(KEY, null, isPetEnabled);
}

export function writePetEnabled(next: PetEnabled): void {
  memory = next;
  writeUiState(KEY, next);
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Nilai efektif pada tier tertentu: preferensi eksplisit menang, tanpa itu desktop tampil saja. */
export function petVisibleOn(enabled: PetEnabled, tier: PetTier): boolean {
  return enabled ?? tier === "desktop";
}

/** Pembaca dan penulis preferensi yang sinkron di semua pemakainya. */
export function usePetEnabled(): [PetEnabled, (next: PetEnabled) => void] {
  const value = React.useSyncExternalStore(subscribe, readPetEnabled, () => null);
  return [value, writePetEnabled];
}
