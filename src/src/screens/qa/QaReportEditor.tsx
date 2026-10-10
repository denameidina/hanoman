import React from "react";
import { QA_VERDICTS, type QaReportDetail, type QaReportStatus } from "@hanoman/shared";
import { Badge, Button, Field, HnTextarea, Input, Select, Tabs, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaCasesPanel } from "./QaCasesPanel";
import { QaFindingsPanel } from "./QaFindingsPanel";
import { QaPreview } from "./QaPreview";
import { REPORT_LABEL, VERDICT_LABEL, REPORT_TONE, envToText, errText, textToEnv } from "./qa-ui";

export type PanelProps = {
  detail: QaReportDetail; projectId: string; locked: boolean;
  onChange: (d: QaReportDetail) => void; onToast?: (m: string) => void; onOpenSession?: (id: string) => void;
};
type Props = {
  detail: QaReportDetail; projectId: string; onChange: (d: QaReportDetail) => void;
  onBack: () => void; onDeleted: () => void; onToast?: (m: string) => void; onOpenSession?: (id: string) => void;
};

const ENV_FIELDS = [{ key: "os", label: "Sistem operasi", example: "Windows 11 atau macOS 15" }, { key: "browser", label: "Browser", example: "Chrome 130" }, { key: "device", label: "Perangkat", example: "Laptop atau iPhone 15" }, { key: "url", label: "Alamat aplikasi", example: "https://staging.example.com" }, { key: "branch", label: "Branch (opsional)", example: "main" }] as const;
const section: React.CSSProperties = { border: "1px solid var(--border-hair)", borderRadius: 12, padding: 20, margin: 0, minWidth: 0 };
const legend: React.CSSProperties = { fontWeight: 600, color: "var(--text-strong)", padding: "0 8px" };
const seed = (d: QaReportDetail) => ({
  title: d.title, buildVersion: d.buildVersion, tester: d.tester, scope: d.scope, summary: d.summary,
  verdict: d.verdict ?? "", env: envToText(Object.fromEntries(Object.entries(d.environment).filter(([k]) => !ENV_FIELDS.some((f) => f.key === k)))),
  os: d.environment.os ?? "", browser: d.environment.browser ?? "", device: d.environment.device ?? "", url: d.environment.url ?? "", branch: d.environment.branch ?? "",
});

export function QaReportEditor({ detail, projectId, onChange, onBack, onDeleted, onToast, onOpenSession }: Props) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const locked = detail.status === "closed";
  const [tab, setTab] = React.useState("cases");
  const [f, setF] = React.useState(() => seed(detail));
  const [busy, setBusy] = React.useState(false);
  // Hanya id: updatedAt berubah di setiap mutasi anak dan akan menimpa ketikan header yang belum disimpan.
  React.useEffect(() => { setF(seed(detail)); }, [detail.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fields = () => ({
    title: f.title, buildVersion: f.buildVersion, tester: f.tester, scope: f.scope, summary: f.summary,
    verdict: (f.verdict || null) as QaReportDetail["verdict"], environment: { ...textToEnv(f.env), ...Object.fromEntries(ENV_FIELDS.filter(({ key }) => f[key].trim()).map(({ key }) => [key, f[key].trim()])) },
  });
  const [error, setError] = React.useState("");
  const patch = async (extra: { status?: QaReportStatus } = {}) => {
    setError("");
    if (!locked && !f.title.trim()) { setError("Isi judul laporan sebelum menyimpan."); return; }
    if (extra.status && extra.status !== "draft" && !f.verdict) { setError("Pilih keputusan hasil pengujian sebelum mengajukan atau menyelesaikan laporan."); return; }
    setBusy(true);
    try { onChange(await api.patchQaReport(projectId, detail.id, { ...(locked ? {} : fields()), ...extra })); }
    catch (e) { setError(errText(e)); onToast?.(errText(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Hapus ${detail.code}?`, message: "Test case, temuan, dan lampirannya ikut terhapus.", tone: "danger", confirmLabel: "Hapus" }))) return;
    try { await api.deleteQaReport(projectId, detail.id); onDeleted(); } catch (e) { onToast?.(errText(e)); }
  };
  const set = (k: keyof ReturnType<typeof seed>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" };
  const panel: PanelProps = { detail, projectId, locked, onChange, onToast, onOpenSession };

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <Badge tone="brass" variant="outline">{detail.code}</Badge>
        <Badge tone={REPORT_TONE[detail.status]}>{REPORT_LABEL[detail.status]}</Badge>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Ekspor ZIP</Button>
        {!locked && <Button variant="ghost" leftIcon="trash-2" onClick={() => void remove()}>Hapus</Button>}
      </div>

      <p style={{ margin: 0, color: "var(--text-subtle)", maxWidth: "70ch" }}>Isi informasi laporan, catat pengujian dan masalah yang ditemukan, lalu tentukan apakah aplikasi siap digunakan.</p>
      <fieldset style={section}>
        <legend style={legend}>Informasi laporan</legend>
        <Field label="Judul laporan (wajib)"><Input aria-label="Judul laporan" placeholder="Contoh: Pengujian fitur login versi 1.0" value={f.title} disabled={locked} onChange={set("title")} /></Field>
        <div style={grid}>
          <Field label="Versi aplikasi"><Input placeholder="Contoh: 1.0.0" value={f.buildVersion} disabled={locked} onChange={set("buildVersion")} /></Field>
          <Field label="Nama penguji"><Input placeholder="Nama orang yang melakukan pengujian" value={f.tester} disabled={locked} onChange={set("tester")} /></Field>
        </div>
        <Field label="Apa yang diuji?" hint="Sebutkan fitur yang diperiksa dan batasan pengujiannya."><HnTextarea rows={3} placeholder="Contoh: Login dengan email dan kata sandi. Login Google belum diuji." value={f.scope} disabled={locked} onChange={set("scope")} /></Field>
      </fieldset>
      <fieldset style={section}>
        <legend style={legend}>Perangkat dan lingkungan pengujian</legend>
        <div style={grid}>
          {ENV_FIELDS.map(({ key, label, example }) => <Field key={key} label={label}><Input value={f[key]} placeholder={example} disabled={locked} onChange={set(key)} /></Field>)}
        </div>
        <details>
          <summary style={{ cursor: "pointer", color: "var(--text-subtle)" }}>Informasi lingkungan tambahan (opsional)</summary>
          <Field label="Lingkungan tambahan" hint="Satu per baris, misalnya jaringan=Wi-Fi"><HnTextarea rows={3} value={f.env} disabled={locked} onChange={set("env")} /></Field>
        </details>
      </fieldset>
      <fieldset style={section}>
        <legend style={legend}>Hasil akhir pengujian</legend>
        <Field label="Ringkasan hasil" hint="Boleh diisi setelah langkah uji dan temuan selesai dicatat."><HnTextarea rows={3} placeholder="Contoh: Login berhasil di Chrome, tetapi tombol Masuk tidak bereaksi di Safari." value={f.summary} disabled={locked} onChange={set("summary")} /></Field>
        <Field label="Keputusan" hint="Wajib saat mengajukan laporan. Pilih berdasarkan hasil pengujian.">
          <Select aria-label="Keputusan" value={f.verdict} disabled={locked} onChange={set("verdict")}
            options={[{ value: "", label: "Pilih setelah pengujian selesai" }, ...QA_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))]} />
        </Field>
        {error && <p role="alert" style={{ color: "var(--text-strong)" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => void patch()} disabled={locked || busy} loading={busy}>Simpan</Button>
          {detail.status === "draft" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "submitted" })}>Ajukan laporan</Button>}
          {detail.status === "submitted" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "closed" })}>Selesaikan dan kunci</Button>}
          {locked && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "draft" })}>Buka kembali</Button>}
        </div>
        <p style={{ marginBottom: 0, fontSize: 12, color: "var(--text-subtle)" }}>{locked ? "Laporan terkunci. Buka kembali untuk mengubah isinya." : "Simpan informasi laporan sebelum berpindah halaman. Langkah uji tersimpan saat Anda keluar dari kolom."}</p>
      </fieldset>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "cases", label: "Langkah uji", count: detail.cases.length },
        { value: "findings", label: "Temuan", count: detail.findings.length },
        { value: "attachments", label: "Lampiran", count: detail.attachments.filter((a) => a.ownerType === "report").length },
        { value: "preview", label: "Pratinjau" },
      ]} />
      {tab === "cases" && <QaCasesPanel {...panel} />}
      {tab === "findings" && <QaFindingsPanel {...panel} />}
      {tab === "attachments" && <QaAttachments {...panel} ownerType="report" ownerId={detail.id} />}
      {tab === "preview" && <QaPreview detail={detail} projectId={projectId} />}
      {dialog}
    </div>
  );
}
