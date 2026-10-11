/* FolderPicker — picker folder device nyata: menelusuri filesystem MESIN SERVER lewat
   GET /fs/browse dan memulangkan path absolut. Browser tak bisa memulangkan path absolut dari
   <input type="file" webkitdirectory>, jadi ini satu-satunya cara (SPEC-217/218 · SPEC-858).
   SPEC-867 · pindah dari App.tsx ke modulnya sendiri saat call site keempat lahir di berkas lain.

   Audit 2026-10 (P0): dua keadaan dipisah. `draft` = isi kolom path yang sedang diketik;
   `cur` = path yang BERHASIL dimuat server. "Pilih folder ini" hanya memilih `cur`, jadi path
   yang belum divalidasi (ketikan tanpa Buka/Enter) tak pernah bisa jadi pilihan. Baris folder
   adalah <button> native, sehingga fokus keyboard dan Enter/Space datang gratis. */
import React from "react";
import { Modal, Button, Input, Icon, StateBlock } from "../ds";
import { api } from "../api/client";
import { errorMessage } from "../lib/report-error";

type FsEntry = { name: string; path: string };

function FolderRow({ icon, name, onClick }: { icon: string; name: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box",
        padding: "8px 12px", cursor: "pointer", textAlign: "left",
        border: "none", borderBottom: "1px solid var(--border-hair)",
        background: hover ? "var(--bone-100)" : "transparent",
        fontSize: 13, color: "var(--text-strong)", fontFamily: "inherit" }}>
      <Icon name={icon} size={16} color="var(--brass-700)" />
      <span style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{name}</span>
    </button>
  );
}

export function FolderPicker({ open, onClose, onPick, start }:
  { open: boolean; onClose: () => void; onPick: (path: string) => void; start?: string }) {
  // `draft` = teks di kolom path; `cur` = path tervalidasi yang sedang ditelusuri.
  const [draft, setDraft] = React.useState("");
  const [cur, setCur] = React.useState("");
  const [parent, setParent] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<FsEntry[]>([]);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // Nomor permintaan: klik dua folder berurutan membuat dua respons. Hanya yang terakhir dipakai,
  // supaya respons lama yang datang belakangan tak menimpa folder yang sudah dipilih pengguna.
  const seq = React.useRef(0);
  const load = React.useCallback((path?: string) => {
    const mine = ++seq.current;
    setLoading(true); setErr("");
    api.browseFs(path)
      .then((r) => {
        if (mine !== seq.current) return;
        setCur(r.path); setDraft(r.path); setParent(r.parent); setEntries(r.entries);
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setErr(`Tak bisa membuka folder ini: ${errorMessage(e, "tidak diketahui")}`);
      })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, []);
  React.useEffect(() => { if (open) load(start && start.trim() ? start.trim() : undefined); }, [open, start, load]);

  // Satu-satunya jalan memilih: path yang sudah dimuat tanpa galat, dan belum diedit sejak itu.
  const canPick = !!cur && !loading && !err && draft.trim() === cur;

  return (
    <Modal open={open} onClose={onClose} icon="folder-open" eyebrow="device" title="Pilih folder codebase"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" disabled={!canPick} onClick={() => { onPick(cur); onClose(); }}>Pilih folder ini</Button>
      </>}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Input value={draft} onChange={(e: any) => setDraft(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") load(e.currentTarget.value.trim() || undefined); }}
          aria-label="Path folder"
          leftIcon="folder" mono style={{ flex: 1 }} placeholder="/path/ke/folder" />
        <Button size="sm" variant="secondary" onClick={() => load(draft.trim() || undefined)}>Buka</Button>
      </div>
      <div aria-label="Sub-folder" style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", maxHeight: 320, overflow: "auto" }}>
        {loading ? <StateBlock kind="loading" compact title="Membuka folder…" />
          : err ? <StateBlock kind="error" compact title={err} hint={draft || undefined}
              action={() => load(draft.trim() || undefined)} />
          : <>
              {parent && <FolderRow icon="corner-left-up" name=".." onClick={() => load(parent)} />}
              {entries.map((e) => <FolderRow key={e.path} icon="folder" name={e.name} onClick={() => load(e.path)} />)}
              {entries.length === 0 && <StateBlock kind="empty" compact icon="folder"
                title="Tak ada sub-folder" hint="Folder ini bisa langsung dipilih." />}
            </>}
      </div>
    </Modal>
  );
}
