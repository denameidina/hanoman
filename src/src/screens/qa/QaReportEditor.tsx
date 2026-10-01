import React from "react";
import { QA_VERDICTS, type QaReportDetail, type QaReportStatus } from "@hanoman/shared";
import { Badge, Button, Field, HnTextarea, Input, Select, Tabs, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaCasesPanel } from "./QaCasesPanel";
import { QaFindingsPanel } from "./QaFindingsPanel";
import { QaPreview } from "./QaPreview";
import { REPORT_TONE, envToText, errText, textToEnv } from "./qa-ui";

export type PanelProps = {
  detail: QaReportDetail; projectId: string; locked: boolean;
  onChange: (d: QaReportDetail) => void; onToast?: (m: string) => void;
};
type Props = {
  detail: QaReportDetail; projectId: string; onChange: (d: QaReportDetail) => void;
  onBack: () => void; onDeleted: () => void; onToast?: (m: string) => void;
};

const seed = (d: QaReportDetail) => ({
  title: d.title, buildVersion: d.buildVersion, tester: d.tester, scope: d.scope, summary: d.summary,
  verdict: d.verdict ?? "", env: envToText(d.environment),
});

export function QaReportEditor({ detail, projectId, onChange, onBack, onDeleted, onToast }: Props) {
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
    verdict: (f.verdict || null) as QaReportDetail["verdict"], environment: textToEnv(f.env),
  });
  const patch = async (extra: { status?: QaReportStatus } = {}) => {
    setBusy(true);
    try { onChange(await api.patchQaReport(projectId, detail.id, { ...(locked ? {} : fields()), ...extra })); }
    catch (e) { onToast?.(errText(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Hapus ${detail.code}?`, message: "Test case, temuan, dan lampirannya ikut terhapus.", tone: "danger", confirmLabel: "Hapus" }))) return;
    try { await api.deleteQaReport(projectId, detail.id); onDeleted(); } catch (e) { onToast?.(errText(e)); }
  };
  const set = (k: keyof ReturnType<typeof seed>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" };
  const panel: PanelProps = { detail, projectId, locked, onChange, onToast };

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <Badge tone="brass" variant="outline">{detail.code}</Badge>
        <Badge tone={REPORT_TONE[detail.status]}>{detail.status}</Badge>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Ekspor ZIP</Button>
        {!locked && <Button variant="ghost" leftIcon="trash-2" onClick={() => void remove()}>Hapus</Button>}
      </div>

      <div style={grid}>
        <Field label="Judul"><Input value={f.title} disabled={locked} onChange={set("title")} /></Field>
        <Field label="Build / versi"><Input value={f.buildVersion} disabled={locked} onChange={set("buildVersion")} /></Field>
        <Field label="Penguji"><Input value={f.tester} disabled={locked} onChange={set("tester")} /></Field>
        <Field label="Keputusan" hint="Wajib sebelum Submit/Close">
          <Select aria-label="Keputusan" value={f.verdict} disabled={locked} onChange={set("verdict")}
            options={[{ value: "", label: "— belum diputuskan —" }, ...QA_VERDICTS.map((v) => ({ value: v, label: v }))]} />
        </Field>
      </div>
      <div style={grid}>
        <Field label="Lingkungan" hint="satu per baris: kunci=nilai (os, browser, device, url, branch)">
          <HnTextarea rows={4} mono value={f.env} disabled={locked} onChange={set("env")} />
        </Field>
        <Field label="Cakupan"><HnTextarea rows={4} value={f.scope} disabled={locked} onChange={set("scope")} /></Field>
        <Field label="Ringkasan hasil"><HnTextarea rows={4} value={f.summary} disabled={locked} onChange={set("summary")} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => void patch()} disabled={locked || busy} loading={busy}>Simpan</Button>
        {detail.status === "draft" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "submitted" })}>Submit</Button>}
        {detail.status === "submitted" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "closed" })}>Close</Button>}
        {locked && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "draft" })}>Buka kembali</Button>}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "cases", label: "Test case", count: detail.cases.length },
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
