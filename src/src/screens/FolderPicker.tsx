/* FolderPicker — picker folder device nyata: menelusuri filesystem MESIN SERVER lewat
   GET /fs/browse dan memulangkan path absolut. Browser tak bisa memulangkan path absolut dari
   <input type="file" webkitdirectory>, jadi ini satu-satunya cara (SPEC-217/218 · SPEC-858).
   SPEC-867 · pindah dari App.tsx ke modulnya sendiri saat call site keempat lahir di berkas lain. */
import React from "react";
import { Modal, Button, Input, Icon, StateBlock } from "../ds";
import { api } from "../api/client";

type FsEntry = { name: string; path: string };

function FolderRow({ icon, name, onClick }: { icon: string; name: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
        borderBottom: "1px solid var(--border-hair)", background: hover ? "var(--bone-100)" : "transparent",
        fontSize: 13, color: "var(--text-strong)" }}>
      <Icon name={icon} size={16} color="var(--brass-700)" />
      <span style={{ fontFamily: "var(--font-mono)" }}>{name}</span>
    </div>
  );
}

export function FolderPicker({ open, onClose, onPick, start }:
  { open: boolean; onClose: () => void; onPick: (path: string) => void; start?: string }) {
  const [cur, setCur] = React.useState("");
  const [parent, setParent] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<FsEntry[]>([]);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const load = React.useCallback((path?: string) => {
    setLoading(true); setErr("");
    api.browseFs(path)
      .then((r) => { setCur(r.path); setParent(r.parent); setEntries(r.entries); })
      .catch(() => setErr("Tak bisa membuka folder ini"))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { if (open) load(start && start.trim() ? start.trim() : undefined); }, [open, start, load]);
  return (
    <Modal open={open} onClose={onClose} icon="folder-open" eyebrow="device" title="Pilih folder codebase"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" disabled={!cur} onClick={() => { onPick(cur); onClose(); }}>Pilih folder ini</Button>
      </>}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Input value={cur} onChange={(e: any) => setCur(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") load(e.currentTarget.value); }}
          leftIcon="folder" mono style={{ flex: 1 }} placeholder="/path/ke/folder" />
        <Button size="sm" variant="secondary" onClick={() => load(cur)}>Buka</Button>
      </div>
      <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", maxHeight: 320, overflow: "auto" }}>
        {loading ? <StateBlock kind="loading" compact title="Membuka folder…" />
          : err ? <StateBlock kind="error" compact title={err} hint={cur} action={() => load(cur)} />
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
