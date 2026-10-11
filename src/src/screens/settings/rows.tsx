// Audit UI/UX 2026-10 · Fase 3C · primitif baris Pengaturan. Satu baris = judul, penjelasan, kontrol,
// dan (untuk field auto-save) status simpannya sendiri. Atribut `data-setting-row` dan `data-search`
// dibaca oleh filter "Cari pengaturan" (`applySettingsFilter`), jadi judul dan penjelasan harus tetap
// berupa teks yang dibaca pencarian.
import React from "react";
import { Button } from "../../ds";
import type { SaveStatus } from "./useSettingField";

/** Status simpan satu field, diteruskan ke baris agar status itu tampil di sebelah kontrolnya. */
export interface RowSave {
  status: SaveStatus;
  retry: () => void;
}

export function SaveStatusLine({ save }: { save: RowSave }) {
  if (save.status === "idle") return null;
  if (save.status === "error") {
    return (
      <span className="hn-set-save hn-set-save--err" role="status" data-testid="save-status">
        Gagal — coba lagi
        <Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={save.retry}>Coba lagi</Button>
      </span>
    );
  }
  const label = save.status === "saved" ? "Tersimpan" : "Menyimpan…";
  const tone = save.status === "saved" ? "hn-set-save--ok" : "hn-set-save--pending";
  return <span className={`hn-set-save ${tone}`} role="status" data-testid="save-status">{label}</span>;
}

export function SettingRow({ title, desc, children, last, save, search }: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
  last?: boolean;
  save?: RowSave;
  /** Teks tambahan yang ikut dicari selain judul dan penjelasan (mis. nama opsi yang tak tampil). */
  search?: string;
}) {
  return (
    <div className={`hn-setting-row hn-set-row${last ? " hn-set-row--last" : ""}`}
      data-setting-row data-search={`${title} ${desc ?? ""} ${search ?? ""}`}>
      <div className="hn-set-row-text">
        <div className="hn-set-row-title">{title}</div>
        {desc && <div className="hn-set-row-desc">{desc}</div>}
        {save && <SaveStatusLine save={save} />}
      </div>
      <div className="hn-setting-control hn-set-row-control">{children}</div>
    </div>
  );
}

/** Alasan tombol tak bisa dipakai, ditulis sebagai teks. Tak merender apa pun bila `text` kosong. */
export function BlockedHint({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return <div id={id} className="hn-set-hint">{text}</div>;
}

/** Catatan pendek di atas sebuah bagian (perilaku simpan, konteks). */
export function SectionNote({ children }: { children: React.ReactNode }) {
  return <div className="hn-set-note">{children}</div>;
}

/** Paragraf penjelas di dalam kartu. */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="hn-set-prose">{children}</div>;
}
