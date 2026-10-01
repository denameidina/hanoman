import React from "react";
import { QA_CASE_STATUSES, type QaCaseStatus, type QaCaseView } from "@hanoman/shared";
import { Badge, Button, Card, Field, HnTextarea, Input, Select, StateBlock } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import type { PanelProps } from "./QaReportEditor";
import { CASE_LABEL, CASE_TONE, errText } from "./qa-ui";

export function QaCasesPanel(p: PanelProps) {
  const api = useApi();
  const [title, setTitle] = React.useState("");
  const run = async (fn: () => Promise<PanelProps["detail"]>) => {
    try { p.onChange(await fn()); return true; } catch (e) { p.onToast?.(errText(e)); return false; }
  };
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    if (await run(() => api.createQaCase(p.projectId, p.detail.id, { title: t }))) setTitle("");
  };
  const fileRef = React.useRef<HTMLInputElement>(null);
  // Matriks test case = sheet "Test case" XLSX / CSV: diunduh, diisi di spreadsheet, diimpor kembali (upsert lewat Ref).
  const importMatrix = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await api.importQaCases(p.projectId, p.detail.id, file);
      p.onChange(await api.qaReport(p.projectId, p.detail.id));
      p.onToast?.(`Matriks diimpor: ${r.updated} diperbarui, ${r.created} dibuat, ${r.unchanged} tak berubah`);
    } catch (e) { p.onToast?.(errText(e)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, color: "var(--text-subtle)" }}>Satu langkah uji (test case) = satu aktivitas yang diperiksa. Kolom tersimpan saat Anda keluar dari kolom.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" leftIcon="download" as="a" href={api.qaExportUrl(p.projectId, p.detail.id, "xlsx")}>Unduh matriks (XLSX)</Button>
        {!p.locked && (
          <>
            <Button size="sm" variant="secondary" leftIcon="upload" onClick={() => fileRef.current?.click()}>Impor matriks</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden aria-label="Berkas matriks test case"
              onChange={(e) => void importMatrix(e.target.files?.[0])} />
          </>
        )}
      </div>
      {p.detail.cases.length === 0 && <StateBlock kind="empty" compact title="Belum ada test case" hint="Mulai dari satu aktivitas, misalnya login. Isi langkahnya, hasil yang diharapkan, lalu catat hasil saat dicoba." />}
      {p.detail.cases.map((c) => <CaseCard key={c.id} c={c} p={p} run={run} />)}
      {!p.locked && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <Field label="Nama pengujian baru"><Input aria-label="Judul test case baru" placeholder="Contoh: Login dengan akun yang benar" value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void add(); }} /></Field>
          </div>
          <Button leftIcon="plus" onClick={() => void add()} disabled={!title.trim()}>Tambah</Button>
        </div>
      )}
    </div>
  );
}

function CaseCard({ c, p, run }: { c: QaCaseView; p: PanelProps; run: (fn: () => Promise<PanelProps["detail"]>) => Promise<boolean> }) {
  const api = useApi();
  const [d, setD] = React.useState({ title: c.title, steps: c.steps, expected: c.expected, actual: c.actual });
  React.useEffect(() => { setD({ title: c.title, steps: c.steps, expected: c.expected, actual: c.actual }); }, [c.id, c.title, c.steps, c.expected, c.actual]);
  // Simpan saat blur, hanya bila berubah — ketikan tak membanjiri server.
  const commit = (k: "title" | "steps" | "expected" | "actual") => {
    if (d[k] === c[k] || (k === "title" && !d.title.trim())) return;
    void run(() => api.patchQaCase(p.projectId, p.detail.id, c.id, { [k]: d[k] }));
  };
  const bind = (k: keyof typeof d) => ({
    value: d[k], disabled: p.locked, onBlurCapture: () => commit(k),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((s) => ({ ...s, [k]: e.target.value })),
  });
  const grid: React.CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" };
  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <Badge tone="neutral" variant="outline" size="sm">{c.code}</Badge>
        <div style={{ flex: "1 1 200px" }}><Field label="Nama pengujian"><Input aria-label={`Judul ${c.code}`} {...bind("title")} /></Field></div>
        <Select aria-label={`Status ${c.code}`} value={c.status} disabled={p.locked}
          onChange={(e) => void run(() => api.patchQaCase(p.projectId, p.detail.id, c.id, { status: e.target.value as QaCaseStatus }))}
          options={QA_CASE_STATUSES.map((s) => ({ value: s, label: CASE_LABEL[s] }))} />
        <Badge tone={CASE_TONE[c.status]} size="sm">{CASE_LABEL[c.status]}</Badge>
        {!p.locked && (
          <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${c.code}`}
            onClick={() => void run(() => api.deleteQaCase(p.projectId, p.detail.id, c.id))} />
        )}
      </div>
      <div style={grid}>
        <Field label="Langkah pengujian" hint="Satu langkah per baris."><HnTextarea rows={4} placeholder={"Buka halaman login\nIsi email dan kata sandi\nKlik Masuk"} aria-label={`Langkah ${c.code}`} {...bind("steps")} /></Field>
        <Field label="Hasil yang diharapkan"><HnTextarea rows={4} placeholder="Contoh: Halaman beranda terbuka." aria-label={`Diharapkan ${c.code}`} {...bind("expected")} /></Field>
        <Field label="Hasil yang terjadi"><HnTextarea rows={4} placeholder="Tulis apa yang terlihat saat dicoba." aria-label={`Aktual ${c.code}`} {...bind("actual")} /></Field>
      </div>
      <QaAttachments {...p} ownerType="case" ownerId={c.id} compact />
    </Card>
  );
}
