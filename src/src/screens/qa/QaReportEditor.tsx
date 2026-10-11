import React from "react";
import { QA_VERDICTS, type QaReportDetail, type QaReportStatus, type QaVerdict } from "@hanoman/shared";
import { Badge, Button, HnTextarea, Input, Select, Tabs, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaCasesPanel } from "./QaCasesPanel";
import { QaField } from "./QaField";
import { QaFindingsPanel } from "./QaFindingsPanel";
import { QaPreview } from "./QaPreview";
import { REPORT_LABEL, REPORT_TONE, VERDICT_LABEL, envToText, errText, textToEnv, failText } from "./qa-ui";

export type PanelProps = {
  detail: QaReportDetail; projectId: string; locked: boolean;
  onChange: (d: QaReportDetail) => void; onToast?: (m: string) => void; onOpenSession?: (id: string) => void;
};
type Props = {
  detail: QaReportDetail; projectId: string; onChange: (d: QaReportDetail) => void;
  onBack: () => void; onDeleted: () => void; onToast?: (m: string) => void; onOpenSession?: (id: string) => void;
  /** Laporan yang baru dibuat mulai dengan "Info laporan" terbuka; laporan yang sudah ada mulai terlipat. */
  startOpen?: boolean;
};

const ENV_FIELDS = [{ key: "os", label: "Sistem operasi", example: "Windows 11 atau macOS 15" }, { key: "browser", label: "Browser", example: "Chrome 130" }, { key: "device", label: "Perangkat", example: "Laptop atau iPhone 15" }, { key: "url", label: "Alamat aplikasi", example: "https://staging.example.com" }, { key: "branch", label: "Branch (opsional)", example: "main" }] as const;
const seed = (d: QaReportDetail) => ({
  title: d.title, buildVersion: d.buildVersion, tester: d.tester, scope: d.scope, summary: d.summary,
  verdict: d.verdict ?? "", env: envToText(Object.fromEntries(Object.entries(d.environment).filter(([k]) => !ENV_FIELDS.some((f) => f.key === k)))),
  os: d.environment.os ?? "", browser: d.environment.browser ?? "", device: d.environment.device ?? "", url: d.environment.url ?? "", branch: d.environment.branch ?? "",
});
type Form = ReturnType<typeof seed>;
const legend: React.CSSProperties = { fontWeight: 600, color: "var(--text-strong)", padding: 0, marginBottom: 8, fontSize: "var(--text-sm)" };
const errStyle: React.CSSProperties = { margin: "0 0 12px", color: "var(--status-err)", fontSize: "var(--text-sm)" };

export function QaReportEditor({ detail, projectId, onChange, onBack, onDeleted, onToast, onOpenSession, startOpen = false }: Props) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const locked = detail.status === "closed";
  const [tab, setTab] = React.useState("cases");
  const [f, setF] = React.useState<Form>(() => seed(detail));
  // Snapshot yang terakhir diterima server. Dipakai sebagai pembanding "belum disimpan" dan untuk Kembali.
  const [saved, setSaved] = React.useState<Form>(() => seed(detail));
  const [infoOpen, setInfoOpen] = React.useState(startOpen);
  const [busy, setBusy] = React.useState(false);
  const [titleErr, setTitleErr] = React.useState("");
  const [verdictErr, setVerdictErr] = React.useState("");
  const [saveErr, setSaveErr] = React.useState("");
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);

  const fields = () => ({
    title: f.title, buildVersion: f.buildVersion, tester: f.tester, scope: f.scope, summary: f.summary,
    verdict: (f.verdict || null) as QaVerdict | null, environment: { ...textToEnv(f.env), ...Object.fromEntries(ENV_FIELDS.filter(({ key }) => f[key].trim()).map(({ key }) => [key, f[key].trim()])) },
  });
  const patch = async (extra: { status?: QaReportStatus } = {}) => {
    setTitleErr(""); setVerdictErr(""); setSaveErr("");
    if (!locked && !f.title.trim()) { setTitleErr("Isi judul laporan sebelum menyimpan."); setInfoOpen(true); return; }
    if (extra.status && extra.status !== "draft" && !f.verdict) {
      setVerdictErr("Pilih keputusan hasil pengujian sebelum mengajukan atau menyelesaikan laporan.");
      setInfoOpen(true);
      return;
    }
    const snapshot = f;
    setBusy(true);
    try {
      const next = await api.patchQaReport(projectId, detail.id, { ...(locked ? {} : fields()), ...extra });
      setSaved(snapshot);
      onChange(next);
    } catch (e) { setSaveErr(failText("menyimpan laporan", e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({
      title: `Hapus ${detail.code}?`,
      message: `"${detail.title}"`,
      impact: ["Test case, temuan, dan lampirannya ikut terhapus."],
      tone: "danger",
      confirmLabel: "Hapus",
    }))) return;
    try { await api.deleteQaReport(projectId, detail.id); onDeleted(); } catch (e) { onToast?.(errText(e)); }
  };
  // Kembali dengan isian yang belum disimpan harus bertanya dulu — isian itu tak ada di server.
  const back = async () => {
    if (dirty && !(await confirm({
      title: "Buang perubahan yang belum disimpan?",
      message: "Perubahan pada informasi laporan belum disimpan dan akan hilang.",
      impact: ["Judul, versi, penguji, lingkungan, ringkasan, dan keputusan kembali ke nilai yang tersimpan."],
      tone: "danger",
      confirmLabel: "Buang perubahan",
    }))) return;
    onBack();
  };
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const infoSummary = [f.title.trim(), f.buildVersion.trim() && `Versi ${f.buildVersion.trim()}`, f.tester.trim()]
    .filter(Boolean).join(" · ") || "Belum diisi";
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" };
  const panel: PanelProps = { detail, projectId, locked, onChange, onToast, onOpenSession };

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="ghost" leftIcon="arrow-left" onClick={() => void back()}>Kembali</Button>
        <Badge tone="brass" variant="outline">{detail.code}</Badge>
        <Badge tone={REPORT_TONE[detail.status]}>{REPORT_LABEL[detail.status]}</Badge>
        <span style={{ flex: 1 }} />
        {/* Pintu ekspor utama. Pratinjau memuat pilihan format lain dengan gaya ghost. */}
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Ekspor ZIP</Button>
        {!locked && <Button variant="ghost" leftIcon="trash-2" onClick={() => void remove()}>Hapus</Button>}
      </div>

      <details open={infoOpen} onToggle={(e) => setInfoOpen(e.currentTarget.open)}
        style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", background: "var(--surface-card)" }}>
        <summary style={{ cursor: "pointer", padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: "var(--text-strong)" }}>Info laporan</span>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)", minWidth: 0, overflowWrap: "anywhere" }}>{infoSummary}</span>
          {dirty && <Badge tone="warn" size="sm">Belum disimpan</Badge>}
        </summary>
        <div style={{ padding: "4px 16px 16px", display: "grid", gap: 0 }}>
          <QaField label="Judul laporan (wajib)" invalid={!!titleErr}>
            <Input placeholder="Contoh: Pengujian fitur login versi 1.0" value={f.title} disabled={locked} invalid={!!titleErr} onChange={set("title")} />
          </QaField>
          {titleErr && <p role="alert" style={errStyle}>{titleErr}</p>}
          <div style={grid}>
            <QaField label="Versi aplikasi"><Input placeholder="Contoh: 1.0.0" value={f.buildVersion} disabled={locked} onChange={set("buildVersion")} /></QaField>
            <QaField label="Nama penguji"><Input placeholder="Nama orang yang melakukan pengujian" value={f.tester} disabled={locked} onChange={set("tester")} /></QaField>
          </div>
          <QaField label="Apa yang diuji?" hint="Sebutkan fitur yang diperiksa dan batasan pengujiannya.">
            <HnTextarea rows={3} placeholder="Contoh: Login dengan email dan kata sandi. Login Google belum diuji." value={f.scope} disabled={locked} onChange={set("scope")} />
          </QaField>
          <fieldset style={{ border: 0, margin: "0 0 12px", padding: 0, minWidth: 0 }}>
            <legend style={legend}>Perangkat dan lingkungan pengujian</legend>
            <div style={grid}>
              {ENV_FIELDS.map(({ key, label, example }) => (
                <QaField key={key} label={label}><Input value={f[key]} placeholder={example} disabled={locked} onChange={set(key)} /></QaField>
              ))}
            </div>
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", color: "var(--text-subtle)", fontSize: "var(--text-sm)", marginBottom: 10 }}>Informasi lingkungan tambahan (opsional)</summary>
              <QaField label="Lingkungan tambahan" hint="Satu per baris, misalnya jaringan=Wi-Fi"><HnTextarea rows={3} placeholder="mis. jaringan=Wi-Fi" value={f.env} disabled={locked} onChange={set("env")} /></QaField>
            </details>
          </fieldset>
          <QaField label="Ringkasan hasil" hint="Boleh diisi setelah langkah uji dan temuan selesai dicatat.">
            <HnTextarea rows={3} placeholder="Contoh: Login berhasil di Chrome, tetapi tombol Masuk tidak bereaksi di Safari." value={f.summary} disabled={locked} onChange={set("summary")} />
          </QaField>
          <QaField label="Keputusan" hint="Wajib saat mengajukan laporan. Pilih berdasarkan hasil pengujian." invalid={!!verdictErr}>
            <Select value={f.verdict} disabled={locked} invalid={!!verdictErr} onChange={set("verdict")}
              options={[{ value: "", label: "Pilih setelah pengujian selesai" }, ...QA_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))]} />
          </QaField>
          {verdictErr && <p role="alert" style={errStyle}>{verdictErr}</p>}
        </div>
      </details>

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

      {/* Aksi laporan menempel di bawah layar: Simpan dan transisi status tetap terjangkau saat menggulir. */}
      <div role="region" aria-label="Aksi laporan" style={{ position: "sticky", bottom: 0, zIndex: 2, display: "flex", gap: 8, flexWrap: "wrap",
        alignItems: "center", padding: "12px 0", background: "var(--surface-card)", borderTop: "1px solid var(--border-hair)" }}>
        <Button onClick={() => void patch()} disabled={locked || busy} loading={busy}>Simpan</Button>
        {detail.status === "draft" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "submitted" })}>Ajukan laporan</Button>}
        {detail.status === "submitted" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "closed" })}>Selesaikan dan kunci</Button>}
        {locked && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "draft" })}>Buka kembali</Button>}
        <span role={saveErr ? "alert" : "status"} style={{ fontSize: "var(--text-xs)", color: saveErr ? "var(--status-err)" : "var(--text-subtle)", minWidth: 0 }}>
          {saveErr || (locked ? "Laporan terkunci. Buka kembali untuk mengubah isinya." : dirty ? "Ada perubahan belum disimpan." : "Informasi laporan tersimpan.")}
        </span>
      </div>
      {dialog}
    </div>
  );
}
