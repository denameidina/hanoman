// src/src/screens/qa/QaWorkspace.tsx
// Workspace QA · satu komponen untuk /qa/<projectId>: daftar laporan ↔ editor satu laporan.
// Pola SkillsWorkspace. Setiap mutasi anak menjawab QaReportDetail terbaru, jadi editor cukup
// menggantikan state-nya — tak ada penghitungan nomor/statistik di klien.
import React from "react";
import type { QaReportDetail, QaReportView } from "@hanoman/shared";
import { Button, Field, Input, Modal, Select, StateBlock } from "../../ds";
import { useApi } from "../../api/instance";
import { QaReportEditor } from "./QaReportEditor";
import { QaReportList } from "./QaReportList";
import { errText } from "./qa-ui";

type Props = {
  projects: { id: string; name: string }[];
  projectId: string | undefined;
  onSelectProject: (id: string) => void;
  onToast?: (m: string) => void;
};

export function QaWorkspace({ projects, projectId, onSelectProject, onToast }: Props) {
  const api = useApi();
  const [reports, setReports] = React.useState<QaReportView[] | null>(null);
  const [error, setError] = React.useState(false);
  const [open, setOpen] = React.useState<QaReportDetail | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File>();
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [importBusy, setImportBusy] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importWarnings, setImportWarnings] = React.useState<string[]>([]);

  const reload = React.useCallback(async () => {
    if (!projectId) return;
    setError(false);
    try { setReports((await api.qaReports(projectId)).items); } catch { setError(true); }
  }, [api, projectId]);
  React.useEffect(() => { setOpen(null); setReports(null); setImportWarnings([]); setImporting(false); setImportFile(undefined); setAttachments([]); void reload(); }, [reload]);

  if (!projectId) {
    return <StateBlock kind="empty" title="Belum ada project" hint="Buat atau muat project di halaman Projects, lalu buka QA lagi." />;
  }

  const openReport = async (id: string) => {
    try { setOpen(await api.qaReport(projectId, id)); } catch (e) { onToast?.(errText(e)); }
  };
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      const d = await api.createQaReport(projectId, { title: t });
      setCreating(false); setTitle(""); setOpen(d); void reload();
    } catch (e) { onToast?.(errText(e)); }
  };
  const doImport = async () => {
    if (!importFile || importBusy) return;
    setImportBusy(true); setImportError(""); setImportWarnings([]);
    try {
      const r = await api.importQaReport(projectId, importFile, attachments);
      const rej = r.attachments.rejected.length ? `, ${r.attachments.rejected.length} lampiran ditolak` : "";
      onToast?.(`${r.created ? "Diimpor" : "Diperbarui"}: ${r.cases} test case, ${r.findings} temuan, ${r.attachments.saved} lampiran${rej}`);
      setImportWarnings(r.attachments.rejected.map((a) => `${a.filename}: ${a.reason === "missing" ? "Berkas belum disertakan. Lampirkan dari laporan yang diimpor." : a.reason === "type" ? "Tipe berkas tidak didukung." : a.reason}`));
      setImporting(false); setImportFile(undefined); setAttachments([]);
      await reload();
      await openReport(r.reportId);
    } catch (e) { setImportError(errText(e)); }
    finally { setImportBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Select aria-label="Project" value={projectId} onChange={(e) => onSelectProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        {!open && (
          <>
            <Button leftIcon="plus" onClick={() => setCreating(true)}>Laporan baru</Button>
            <Button variant="secondary" leftIcon="upload" onClick={() => { setImportError(""); setImporting(true); }}>Impor Excel / ZIP</Button>
            <Button variant="ghost" leftIcon="download" as="a" href={api.qaTemplateUrl()} download="qa-template.xlsx">Unduh template Excel</Button>

          </>
        )}
      </div>

      {!open && <p style={{ margin: 0, color: "var(--text-subtle)", maxWidth: "70ch" }}>Catat hasil pengujian aplikasi dalam satu laporan. Mulai dengan laporan baru, atau unduh template Excel lalu isi dan impor kembali bersama lampirannya.</p>}
      {importWarnings.length > 0 && <div role="status"><p>Laporan berhasil diimpor. Beberapa lampiran perlu ditambahkan:</p><ul>{importWarnings.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
      {open ? (
        <QaReportEditor detail={open} projectId={projectId} onChange={setOpen} onToast={onToast}
          onBack={() => { setOpen(null); void reload(); }}
          onDeleted={() => { setOpen(null); void reload(); }} />
      ) : error ? (
        <StateBlock kind="error" title="Gagal memuat laporan QA" action={() => void reload()} actionLabel="Coba lagi" />
      ) : reports === null ? (
        <StateBlock kind="loading" />
      ) : (
        <QaReportList reports={reports} onOpen={(id) => void openReport(id)} />
      )}

      <Modal open={importing} title="Impor laporan QA" width={620} onClose={() => { if (!importBusy) setImporting(false); }}
        footer={<><Button variant="ghost" disabled={importBusy} onClick={() => setImporting(false)}>Batal</Button><Button disabled={!importFile || importBusy} loading={importBusy} onClick={() => void doImport()}>Impor laporan</Button></>}>
        <p>Isi template Excel, lalu pilih berkasnya di bawah. Laporan hasil ekspor juga dapat diimpor kembali.</p>
        <Field label="Berkas laporan (wajib)" hint="Excel (.xlsx), ZIP dengan Excel dan lampiran, atau Markdown (.md).">
          <input type="file" accept=".xlsx,.zip,.md" aria-label="Berkas impor laporan" disabled={importBusy} onChange={(e) => setImportFile(e.target.files?.[0])} />
        </Field>
        <Field label="Berkas lampiran (opsional)" hint="Pilih semua screenshot atau log yang disebut pada sheet Lampiran. Nama berkas harus sama dengan kolom Berkas; kolom Pemilik diisi Laporan, TC-01, atau F-01.">
          <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.md,.txt,.log,.json,.csv" aria-label="Berkas lampiran impor" disabled={importBusy} onChange={(e) => setAttachments(Array.from(e.target.files ?? []))} />
        </Field>
        <p style={{ color: "var(--text-subtle)", fontSize: 12 }}>Maksimal 10 MB per lampiran, 30 lampiran dan 100 MB per laporan. Untuk ZIP, sertakan report.xlsx dan folder attachments/. Gambar yang ditempel di sel Excel perlu disertakan sebagai berkas terpisah.</p>
        {importError && <p role="alert">{importError}</p>}
      </Modal>

      <Modal open={creating} title="Laporan QA baru" onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Batal</Button><Button onClick={() => void create()} disabled={!title.trim()}>Buat</Button></>}>
        <Field label="Judul" hint="Contoh: Pengujian fitur login versi 1.0">
          <Input value={title} autoFocus onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void create(); }} />
        </Field>
      </Modal>
    </div>
  );
}
