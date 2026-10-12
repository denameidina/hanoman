// Audit UI/UX 2026-10 · Fase 3C · store snapshot Settings, satu sumber untuk seluruh bagian.
//
// Perilaku yang dipertahankan dari Fase 1 (persist jujur): toast sukses hanya SETELAH PUT berhasil;
// kegagalan membalik kunci yang diubah simpan ini saja (simpan lain yang sudah berhasil tak ikut
// terbalik); PUT berurutan lewat antrean dan selalu di-rebase ke DB terbaru (S5, settings-rebase).
import React from "react";
import type { Setting } from "@hanoman/shared";
import { api } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import type { ShowToast } from "../../ds";
import { rebaseEdits } from "../settings-rebase";

export interface SettingsStore {
  /** Snapshot yang ditampilkan; `null` selama memuat atau bila GET gagal. */
  s: Setting | null;
  failed: boolean;
  load: () => void;
  /** Tulis snapshot baru. Resolve `true` bila tersimpan, `false` bila gagal (sudah di-rollback dan di-toast). */
  persist: (next: Setting, msg?: string, tone?: string, icon?: string) => Promise<boolean>;
  /** Tulis satu patch di atas snapshot terbaru. */
  save: (patch: Partial<Setting>, msg?: string) => Promise<boolean>;
  /** Ubah snapshot lokal saja, untuk blok yang punya penulis lain (lead, operator Telegram). */
  update: (fn: (prev: Setting) => Setting) => void;
  /** Snapshot terbaru secara sinkron (bukan hasil render), untuk penulis yang membaca lalu menulis. */
  current: () => Setting | null;
}

const noop = () => undefined;

export function useSettingsStore(onToast?: ShowToast): SettingsStore {
  const [s, setS] = React.useState<Setting | null>(null);
  const [failed, setFailed] = React.useState(false);
  // Cermin sinkron `s`: dua ubahan dalam satu tik harus membaca snapshot yang sudah optimistis.
  const sRef = React.useRef<Setting | null>(null);
  const toastRef = React.useRef(onToast);
  toastRef.current = onToast;
  const saveQueue = React.useRef<Promise<unknown>>(Promise.resolve());

  const commit = React.useCallback((next: Setting | null) => {
    sRef.current = next;
    setS(next);
  }, []);

  // Jangan fallback ke S_DEFAULTS saat GET gagal: toggle berikutnya akan mem-PUT default itu
  // dan menimpa pengaturan asli di server.
  const load = React.useCallback(() => {
    setFailed(false);
    commit(null);
    api.getSettings().then((v) => commit(v), () => setFailed(true));
  }, [commit]);
  React.useEffect(() => { load(); }, [load]);

  const persist = React.useCallback((next: Setting, msg?: string, tone?: string, icon?: string): Promise<boolean> => {
    const base = sRef.current;
    if (!base) return Promise.resolve(false);
    const changed = (Object.keys(next) as (keyof Setting)[])
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(base[k]));
    commit(next);
    const write = saveQueue.current.then(async () => {
      const fresh = await api.getSettings().catch(() => undefined);
      await api.putSettings(rebaseEdits(base, next, fresh));
    });
    // Rantai antrean hanya perlu tetap hidup; galat ditangani cabang kedua `write.then` di bawah.
    saveQueue.current = write.then(noop, noop);
    return write.then(
      () => {
        if (msg) toastRef.current?.(msg, tone || "ok", icon || "check-circle-2");
        return true;
      },
      (e: unknown) => {
        const revert = Object.fromEntries(changed.map((k) => [k, base[k]])) as Partial<Setting>;
        commit({ ...(sRef.current ?? base), ...revert } as Setting);
        toastRef.current?.(failureMessage("menyimpan pengaturan", e), "err", "alert-triangle");
        return false;
      },
    );
  }, [commit]);

  const save = React.useCallback((patch: Partial<Setting>, msg?: string): Promise<boolean> => {
    const base = sRef.current;
    if (!base) return Promise.resolve(false);
    return persist({ ...base, ...patch }, msg);
  }, [persist]);

  const update = React.useCallback((fn: (prev: Setting) => Setting) => {
    const cur = sRef.current;
    if (cur) commit(fn(cur));
  }, [commit]);

  const current = React.useCallback(() => sRef.current, []);

  return { s, failed, load, persist, save, update, current };
}
