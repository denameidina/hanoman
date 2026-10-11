import React from "react";
import { zTicketCategory } from "@hanoman/shared";
import type { PortalProject } from "@hanoman/shared";
import { Button, Field, Input, Modal, Select } from "../ds";
import { portalApi } from "../api/portal";
import { kategoriLabel } from "./labels";
import "./portal.css";

// SPEC-626 · ADR-0111 · jalur kedua pembuatan tiket, setara halaman Help Center publik tapi untuk
// klien yang SUDAH login: emailnya datang dari akun (tak diketik ulang), tak ada honeypot, dan
// tujuannya dibatasi project yang memang boleh ia akses.
//
// Audit UI/UX 2026-10 · Fase 3 (3M): dua langkah. Langkah 1 menanyakan apa yang terjadi; langkah 2
// lampiran gambar yang sengaja opsional dan ringkasan sebelum kirim. Tak ada field baru: payload
// tetap project, kategori, judul, detail, dan berkas.
const MAX_FILES = 3;

export function TicketForm({ projects, activeId, email, onCancel, onSent }: {
  projects: PortalProject[];
  activeId: string;
  /** Email akun yang sedang masuk. Hanya untuk ringkasan — tiket tercatat atas nama akun ini. */
  email?: string;
  onCancel: () => void;
  onSent: (projectId: string) => void;
}) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [projectId, setProjectId] = React.useState(activeId);
  const [category, setCategory] = React.useState<string>(zTicketCategory.options[0]);
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const adaIsi = title.trim() !== "" && detail.trim() !== "";
  const namaProject = projects.find((p) => p.id === projectId)?.name ?? "";

  const submit = async () => {
    if (busy || !adaIsi) return;
    setErr(null); setBusy(true);
    try {
      const form = new FormData();
      form.set("category", category); form.set("title", title); form.set("detail", detail);
      for (const f of files.slice(0, MAX_FILES)) form.append("files", f, f.name);
      await portalApi.createTicket(projectId, form);
      onSent(projectId);
    } catch {
      setErr("Gagal mengirim keluhan. Periksa koneksi, lalu coba lagi.");
    } finally { setBusy(false); }
  };

  const footer = step === 1 ? (
    <div className="hn-portal-foot">
      <Button size="sm" variant="secondary" onClick={onCancel}>Batal</Button>
      <Button size="sm" variant="primary" rightIcon="arrow-right" disabled={!adaIsi}
        onClick={() => setStep(2)}>Lanjut</Button>
    </div>
  ) : (
    <div className="hn-portal-foot">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStep(1)}>Kembali</Button>
      <Button size="sm" variant="primary" leftIcon="send" disabled={busy || !adaIsi} loading={busy}
        onClick={() => { void submit(); }}>Kirim</Button>
    </div>
  );

  return (
    <Modal open title="Lapor masalah" icon="send" eyebrow={`langkah ${step} dari 2`}
      dismissible={!busy} onClose={onCancel} footer={footer}>
      {step === 1 ? (
        <div className="hn-portal-form">
          <p className="hn-portal-field-note"><strong>Apa yang terjadi?</strong> Cukup judul singkat dan ceritanya.</p>
          {projects.length > 1 && (
            <Field label="Project">
              <Select aria-label="Project" size="lg" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))} className="hn-portal-wide" />
            </Field>
          )}
          <Field label="Kategori">
            <Select aria-label="Kategori" size="lg" value={category} onChange={(e) => setCategory(e.target.value)}
              options={zTicketCategory.options.map((c) => ({ value: c, label: kategoriLabel(c) }))}
              className="hn-portal-wide" />
          </Field>
          <Field label="Judul" hint="Satu kalimat tentang masalahnya.">
            <Input aria-label="Judul" size="lg" value={title} maxLength={200} className="hn-portal-wide"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              placeholder="mis. Tombol Simpan tidak berfungsi di HP" />
          </Field>
          <Field label="Detail" hint="Langkah yang Anda lakukan, dan apa yang terjadi setelahnya.">
            <textarea aria-label="Detail" className="hn-portal-textarea" value={detail} rows={5}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tidak tersimpan." />
          </Field>
          {!adaIsi && <p className="hn-portal-field-note">Isi judul dan detail untuk melanjutkan.</p>}
        </div>
      ) : (
        <div className="hn-portal-form">
          <p className="hn-portal-field-note"><strong>Lampiran (opsional).</strong> Tangkapan layar membantu tim melihat masalahnya lebih cepat.</p>
          <Field label="Lampiran gambar" hint={`Maksimal ${MAX_FILES} berkas PNG, JPEG, atau WebP.`}>
            {/* placeholder-exempt: input berkas tak punya teks yang bisa diketik */}
            <input aria-label="Lampiran gambar" className="hn-portal-file" type="file"
              accept="image/png,image/jpeg,image/webp" multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))} />
          </Field>
          {files.length > 0 && (
            <ul className="hn-portal-files" aria-label="Lampiran terpilih">
              {files.map((f) => <li key={f.name}>{f.name}</li>)}
            </ul>
          )}
          <div className="hn-portal-summary">
            <span>Judul: <strong>{title}</strong></span>
            <span>Kategori: <strong>{kategoriLabel(category)}</strong></span>
            {projects.length > 1 && <span>Project: <strong>{namaProject}</strong></span>}
            {email && <span>Tercatat atas nama <strong>{email}</strong>.</span>}
          </div>
          {err && <p role="alert" className="hn-portal-error">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
