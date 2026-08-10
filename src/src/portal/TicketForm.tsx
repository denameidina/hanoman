import React from "react";
import { zTicketCategory } from "@hanoman/shared";
import type { PortalProject } from "@hanoman/shared";
import { Button, Field, HnTextarea, Modal, Select } from "../ds";
import { portalApi } from "../api/portal";

// SPEC-626 · ADR-0111 · jalur kedua pembuatan tiket, setara halaman Help Center publik tapi untuk
// klien yang SUDAH login: emailnya datang dari akun (tak diketik ulang), tak ada honeypot, dan
// tujuannya dibatasi project yang memang boleh ia akses.
const CAT_LABEL: Record<string, string> = {
  bug: "Bug", fitur: "Permintaan fitur", pertanyaan: "Pertanyaan", lainnya: "Lainnya",
};
const MAX_FILES = 3;

export function TicketForm({ projects, activeId, onCancel, onSent }: {
  projects: PortalProject[];
  activeId: string;
  onCancel: () => void;
  onSent: (projectId: string) => void;
}) {
  const [projectId, setProjectId] = React.useState(activeId);
  const [category, setCategory] = React.useState<string>(zTicketCategory.options[0]);
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const form = new FormData();
      form.set("category", category); form.set("title", title); form.set("detail", detail);
      for (const f of files.slice(0, MAX_FILES)) form.append("files", f, f.name);
      await portalApi.createTicket(projectId, form);
      onSent(projectId);
    } catch {
      setErr("Gagal mengirim keluhan. Coba lagi sebentar.");
    } finally { setBusy(false); }
  };

  return (
    <Modal open title="Kirim keluhan" icon="send" eyebrow="help desk" onClose={onCancel}>
      <Field label="Project">
        <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} style={{ width: "100%" }} />
      </Field>
      <Field label="Kategori">
        <Select aria-label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)}
          options={zTicketCategory.options.map((c) => ({ value: c, label: CAT_LABEL[c] ?? c }))}
          style={{ width: "100%" }} />
      </Field>
      <Field label="Judul">
        <input aria-label="Judul" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
          placeholder="mis. Tombol Simpan tak berfungsi di HP" style={INPUT} />
      </Field>
      <Field label="Detail">
        <HnTextarea aria-label="Detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={5}
          placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan." />
      </Field>
      <Field label="Lampiran gambar" hint={`Opsional, maksimal ${MAX_FILES} berkas PNG/JPEG/WebP.`}>
        {/* placeholder-exempt: input berkas tak punya teks yang bisa diketik */}
        <input aria-label="Lampiran gambar" type="file" accept="image/png,image/jpeg,image/webp" multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))} />
      </Field>
      {err && <div style={{ color: "var(--clay-600)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={onCancel}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="send" disabled={busy || !title.trim() || !detail.trim()}
          onClick={submit}>Kirim</Button>
      </div>
    </Modal>
  );
}

const INPUT: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box", padding: "9px 11px",
  border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
  background: "var(--surface-card)", color: "var(--text-strong)", fontSize: 13,
  fontFamily: "var(--font-ui)",
};
