// src/src/screens/qa/QaWorkspace.tsx
// Workspace QA · satu komponen untuk /qa/<projectId>: daftar laporan ↔ editor satu laporan.
// Pola SkillsWorkspace. Setiap mutasi anak menjawab QaReportDetail terbaru, jadi editor cukup
// menggantikan state-nya — tak ada penghitungan nomor/statistik di klien.
import React from "react";
import type { QaReportDetail, QaReportView } from "@hanoman/shared";
import { Button, Callout, Field, Input, Modal, Pager, Select, SkeletonList, StateBlock, serverPage } from "../../ds";
import { useApi } from "../../api/instance";
import "../styles/qa.css";
import { QaReportEditor } from "./QaReportEditor";
import { QaReportList } from "./QaReportList";
import { errText } from "./qa-ui";

const PAGE = 10;

type Props = {
  projects: { id: string; name: string }[];
  /** `undefined` dengan project yang ada = "Semua project" (default). */
  projectId: string | undefined;
  onSelectProject: (id: string) => void;
  onToast?: (m: string) => void;
  onOpenSession?: (id: string) => void;
};

export function QaWorkspace({ projects, projectId, onSelectProject, onToast, onOpenSession }: Props) {
  const api = useApi();
  const all = !projectId && projects.length > 0;
  // Project tujuan laporan BARU / impor saat daftar menampilkan semua project.
  const [target, setTarget] = React.useState(projects[0]?.id ?? "");
  const pid = projectId ?? target;
  const [page, setPage] = React.useState(1);
  const [syncBusy, setSyncBusy] = React.useState(false);
  const [reports, setReports] = React.useState<QaReportView[] | null>(null);
  const [error, setError] = React.useState(false);
  const [open, setOpen] = React.useState<QaReportDetail | null>(null);
  // Id laporan yang baru dibuat di sesi ini: hanya laporan itu yang membuka "Info laporan" otomatis.
  const [freshId, setFreshId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File>();
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [importBusy, setImportBusy] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const [importWarnings, setImportWarnings] = React.useState<string[]>([]);

  const reload = React.useCallback(async () => {
    if (!projectId && !all) return;
    setError(false);
    try {
      if (projectId) setReports((await api.qaReports(projectId)).items);
      // Semua project: API laporan per project, jadi dikumpulkan paralel; urutan mengikuti urutan project.
      else setReports((await Promise.all(projects.map((p) => api.qaReports(p.id)))).flatMap((r) => r.items));
    } catch { setError(true); }
  }, [api, projectId, all, projects]);
  React.useEffect(() => { setOpen(null); setFreshId(null); setReports(null); setImportWarnings([]); setImporting(false); setImportFile(undefined); setAttachments([]); setPage(1); void reload(); }, [reload]);

  if (!projectId && !all) {
    return <StateBlock kind="empty" title="Belum ada project" hint="Buat atau muat project di halaman Projects, lalu buka QA lagi." />;
  }

  const openReport = async (r: Pick<QaReportView, "projectId" | "id">) => {
    try { setOpen(await api.qaReport(r.projectId, r.id)); } catch (e) { onToast?.(errText(e)); }
  };
  const synchronize = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      const result = await api.syncNow();
      if (!result.ok) { onToast?.(result.reason === "not-configured" ? "Sinkronisasi belum dikonfigurasi. Hubungkan server dan device token di Settings." : result.reason ?? "Sinkronisasi gagal"); return; }
      await reload();
      if (open) setOpen(await api.qaReport(open.projectId, open.id));
      onToast?.("QA disinkronkan. Lampiran dipindahkan bertahap pada siklus sinkronisasi.");
    } catch (e) { onToast?.(errText(e)); }
    finally { setSyncBusy(false); }
  };
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      const d = await api.createQaReport(pid, { title: t });
      setCreating(false); setTitle(""); setFreshId(d.id); setOpen(d); void reload();
    } catch (e) { onToast?.(errText(e)); }
  };
  const doImport = async () => {
    if (!importFile || importBusy) return;
    setImportBusy(true); setImportError(""); setImportWarnings([]);
    try {
      const r = await api.importQaReport(pid, importFile, attachments);
      const rej = r.attachments.rejected.length ? `, ${r.attachments.rejected.length} lampiran ditolak` : "";
      onToast?.(`${r.created ? "Diimpor" : "Diperbarui"}: ${r.cases} test case, ${r.findings} temuan, ${r.attachments.saved} lampiran${rej}`);
      setImportWarnings(r.attachments.rejected.map((a) => `${a.filename}: ${a.reason === "missing" ? "Berkas belum disertakan. Lampirkan dari laporan yang diimpor." : a.reason === "type" ? "Tipe berkas tidak didukung." : a.reason}`));
      setImporting(false); setImportFile(undefined); setAttachments([]);
      await reload();
      await openReport({ projectId: pid, id: r.reportId });
    } catch (e) { setImportError(errText(e)); }
    finally { setImportBusy(false); }
  };

  const paged = serverPage(reports?.length ?? 0, page, PAGE);
  const targetField = all && (
    <Field label="Project">
      <Select aria-label="Project tujuan" value={target} onChange={(e) => setTarget(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
    </Field>
  );

  return (
    <div className="hn-qa-stack">
      <div className="hn-qa-toolbar">
        <Select aria-label="Project" className="hn-qa-toolbar-project" value={projectId ?? ""} onChange={(e) => onSelectProject(e.target.value)}
          options={[{ value: "", label: "Semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        <Button variant="secondary" disabled={syncBusy} loading={syncBusy} onClick={() => void synchronize()}>Sinkronkan QA</Button>
        {!open && (
          <>
            <Button leftIcon="plus" onClick={() => setCreating(true)}>Laporan baru</Button>
            <Button variant="secondary" leftIcon="upload" onClick={() => { setImportError(""); setImporting(true); }}>Impor Excel, ZIP, atau .md</Button>
            <Button variant="ghost" leftIcon="download" as="a" href={api.qaTemplateUrl()} download="qa-template.xlsx">Unduh template Excel</Button>
          </>
        )}
      </div>

      {!open && <p className="hn-qa-intro">Catat hasil pengujian aplikasi dalam satu laporan. Mulai dengan laporan baru, atau unduh template Excel lalu isi dan impor kembali bersama lampirannya.</p>}
      {importWarnings.length > 0 && (
        <div role="status">
          <Callout tone="warn" title="Laporan berhasil diimpor. Beberapa lampiran perlu ditambahkan."
            action={<Button size="sm" variant="ghost" onClick={() => setImportWarnings([])}>Tutup</Button>}>
            <ul className="hn-qa-note-list">{importWarnings.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </Callout>
        </div>
      )}
      {open ? (
        <QaReportEditor key={open.id} detail={open} projectId={open.projectId} onChange={setOpen} onToast={onToast} onOpenSession={onOpenSession}
          startOpen={open.id === freshId}
          onBack={() => { setOpen(null); setFreshId(null); void reload(); }}
          onDeleted={() => { setOpen(null); void reload(); }} />
      ) : error ? (
        <StateBlock kind="error" title="Gagal memuat laporan QA" action={() => void reload()} actionLabel="Coba lagi" />
      ) : reports === null ? (
        <SkeletonList rows={3} label="Memuat laporan QA…" rowHeight={64} />
      ) : (
        <>
          <QaReportList projects={all ? projects : undefined} reports={reports.slice((paged.page - 1) * PAGE, paged.page * PAGE)}
            onOpen={(r) => void openReport(r)} />
          {reports.length > PAGE && (
            <Pager page={paged.page} pageCount={paged.pageCount} total={reports.length} from={paged.from} to={paged.to} onPage={setPage} unit="laporan" />
          )}
        </>
      )}

      <Modal open={importing} title="Impor laporan QA" width={620} onClose={() => { if (!importBusy) setImporting(false); }}
        footer={<><Button variant="ghost" disabled={importBusy} onClick={() => setImporting(false)}>Batal</Button><Button disabled={!importFile || importBusy} loading={importBusy} onClick={() => void doImport()}>Impor laporan</Button></>}>
        <div className="hn-qa-modal-stack">
          {targetField}
          <p className="hn-qa-note">Isi template Excel, lalu pilih berkasnya di bawah. Laporan hasil ekspor juga dapat diimpor kembali.</p>
          <Field label="Berkas laporan (wajib)" hint="Excel (.xlsx), ZIP dengan Excel dan lampiran, atau Markdown (.md).">
            <input type="file" className="hn-qa-file" aria-label="Berkas laporan (wajib)" accept=".xlsx,.zip,.md" disabled={importBusy}
              onChange={(e) => setImportFile(e.target.files?.[0])} />
          </Field>
          <Field label="Berkas lampiran (opsional)" hint="Pilih semua screenshot atau log yang disebut pada sheet Lampiran. Nama berkas harus sama dengan kolom Berkas; kolom Pemilik diisi Laporan, TC-01, atau F-01.">
            <input type="file" multiple className="hn-qa-file" aria-label="Berkas lampiran (opsional)" accept=".png,.jpg,.jpeg,.webp,.pdf,.md,.txt,.log,.json,.csv" disabled={importBusy}
              onChange={(e) => setAttachments(Array.from(e.target.files ?? []))} />
          </Field>
          <p className="hn-qa-note">Maksimal 10 MB per lampiran, 30 lampiran dan 100 MB per laporan. Untuk ZIP, sertakan report.xlsx dan folder attachments/. Gambar yang ditempel di sel Excel perlu disertakan sebagai berkas terpisah.</p>
          {importError && <p role="alert" className="hn-qa-error">{importError}</p>}
        </div>
      </Modal>

      <Modal open={creating} title="Laporan QA baru" onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Batal</Button><Button onClick={() => void create()} disabled={!title.trim()}>Buat</Button></>}>
        {targetField}
        <Field label="Judul" hint="Contoh: Pengujian fitur login versi 1.0">
          <Input value={title} autoFocus placeholder="mis. Regresi rilis 1.1" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void create(); }} />
        </Field>
      </Modal>
    </div>
  );
}
