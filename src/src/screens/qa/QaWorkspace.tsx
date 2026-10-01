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
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    if (!projectId) return;
    setError(false);
    try { setReports((await api.qaReports(projectId)).items); } catch { setError(true); }
  }, [api, projectId]);
  React.useEffect(() => { setOpen(null); setReports(null); void reload(); }, [reload]);

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
  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await api.importQaReport(projectId, file);
      const rej = r.attachments.rejected.length ? `, ${r.attachments.rejected.length} lampiran ditolak` : "";
      onToast?.(`${r.created ? "Diimpor" : "Diperbarui"}: ${r.cases} test case, ${r.findings} temuan, ${r.attachments.saved} lampiran${rej}`);
      await reload();
      await openReport(r.reportId);
    } catch (e) { onToast?.(errText(e)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Select aria-label="Project" value={projectId} onChange={(e) => onSelectProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        {!open && (
          <>
            <Button leftIcon="plus" onClick={() => setCreating(true)}>Laporan baru</Button>
            <Button variant="secondary" leftIcon="upload" onClick={() => fileRef.current?.click()}>Impor</Button>
            <Button variant="ghost" leftIcon="download" as="a" href={api.qaTemplateUrl()} download="qa-template.md">Unduh template</Button>
            <input ref={fileRef} type="file" accept=".zip,.md" hidden aria-label="Berkas impor laporan"
              onChange={(e) => void doImport(e.target.files?.[0])} />
          </>
        )}
      </div>

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

      <Modal open={creating} title="Laporan QA baru" onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Batal</Button><Button onClick={() => void create()} disabled={!title.trim()}>Buat</Button></>}>
        <Field label="Judul" hint="mis. Smoke test rilis 0.9.12">
          <Input value={title} autoFocus onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void create(); }} />
        </Field>
      </Modal>
    </div>
  );
}
