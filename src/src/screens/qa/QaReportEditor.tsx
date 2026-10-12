// Editor satu laporan QA sebagai lembar kerja: header sticky (judul, status, satu aksi utama yang
// mengikuti keadaan laporan, dan menu ⋯ untuk ekspor/pratinjau/hapus), kartu "Info laporan" yang ringkas
// dan membuka drawer untuk mengubah isinya, lalu tab kerja (Langkah uji, Temuan, Lampiran) yang selalu
// terlihat tanpa menggulir melewati form. Mengajukan/menyelesaikan lewat dialog "Tinjau dan ajukan".
import React from "react";
import { QA_VERDICTS, type QaReportDetail, type QaReportStatus, type QaVerdict } from "@hanoman/shared";
import {
  Badge, Button, Field, HnTextarea, Icon, Input, Modal, OverflowActions, Radio, RadioGroup, Select, Tabs, useConfirm,
} from "../../ds";
import type { OverflowItem } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaCasesPanel } from "./QaCasesPanel";
import { QaFindingsPanel } from "./QaFindingsPanel";
import { QaPreview } from "./QaPreview";
import {
  QA_EXPORTS, REPORT_LABEL, REPORT_TONE, VERDICT_LABEL, envToText, errText, failText, textToEnv,
} from "./qa-ui";

export type PanelProps = {
  detail: QaReportDetail; projectId: string; locked: boolean;
  onChange: (d: QaReportDetail) => void; onToast?: (m: string) => void; onOpenSession?: (id: string) => void;
};
type Props = {
  detail: QaReportDetail; projectId: string; onChange: (d: QaReportDetail) => void;
  onBack: () => void; onDeleted: () => void; onToast?: (m: string) => void; onOpenSession?: (id: string) => void;
  /** Laporan yang baru dibuat membuka drawer "Info laporan" otomatis; laporan yang sudah ada mulai dengan kartu ringkas. */
  startOpen?: boolean;
};

const ENV_FIELDS = [{ key: "os", label: "Sistem operasi", example: "Windows 11 atau macOS 15" }, { key: "browser", label: "Browser", example: "Chrome 130" }, { key: "device", label: "Perangkat", example: "Laptop atau iPhone 15" }, { key: "url", label: "Alamat aplikasi", example: "https://staging.example.com" }, { key: "branch", label: "Branch (opsional)", example: "main" }] as const;
const seed = (d: QaReportDetail) => ({
  title: d.title, buildVersion: d.buildVersion, tester: d.tester, scope: d.scope, summary: d.summary,
  verdict: d.verdict ?? "", env: envToText(Object.fromEntries(Object.entries(d.environment).filter(([k]) => !ENV_FIELDS.some((f) => f.key === k)))),
  os: d.environment.os ?? "", browser: d.environment.browser ?? "", device: d.environment.device ?? "", url: d.environment.url ?? "", branch: d.environment.branch ?? "",
});
type Form = ReturnType<typeof seed>;

export function QaReportEditor({ detail, projectId, onChange, onBack, onDeleted, onToast, onOpenSession, startOpen = false }: Props) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const locked = detail.status === "closed";
  const statusKnown = Object.prototype.hasOwnProperty.call(REPORT_LABEL, detail.status);
  const [tab, setTab] = React.useState("cases");
  const [f, setF] = React.useState<Form>(() => seed(detail));
  // Snapshot yang terakhir diterima server. Dipakai sebagai pembanding "belum disimpan" dan untuk Kembali.
  const [saved, setSaved] = React.useState<Form>(() => seed(detail));
  const [infoOpen, setInfoOpen] = React.useState(startOpen);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [titleErr, setTitleErr] = React.useState("");
  const [saveErr, setSaveErr] = React.useState("");
  const [reviewErr, setReviewErr] = React.useState("");
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  // Transisi yang ditawarkan header: draf → diajukan, diajukan → selesai dan kunci.
  const nextStatus: QaReportStatus = detail.status === "submitted" ? "closed" : "submitted";
  const titleOk = f.title.trim().length > 0;
  const openFindings = detail.findings.filter((x) => x.status === "open").length;
  const attachmentCount = detail.attachments.filter((a) => a.ownerType === "report").length;

  const fields = () => ({
    title: f.title, buildVersion: f.buildVersion, tester: f.tester, scope: f.scope, summary: f.summary,
    verdict: (f.verdict || null) as QaVerdict | null, environment: { ...textToEnv(f.env), ...Object.fromEntries(ENV_FIELDS.filter(({ key }) => f[key].trim()).map(({ key }) => [key, f[key].trim()])) },
  });
  // Satu PATCH: isian (bila belum terkunci) plus transisi status bila ada. Mengembalikan null bila berhasil,
  // atau pesan galat yang ditampilkan di tempatnya (header, atau dialog tinjau untuk transisi status).
  const write = async (status: QaReportStatus | undefined, action: string): Promise<string | null> => {
    const snapshot = f;
    setBusy(true);
    try {
      const next = await api.patchQaReport(projectId, detail.id, { ...(locked ? {} : fields()), ...(status ? { status } : {}) });
      setSaved(snapshot);
      setTitleErr("");
      setSaveErr("");
      onChange(next);
      return null;
    } catch (e) { return failText(action, e); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!titleOk) { setTitleErr("Isi judul laporan sebelum menyimpan."); setInfoOpen(true); return; }
    const err = await write(undefined, "menyimpan laporan");
    if (err) setSaveErr(err);
  };
  const reopen = async () => {
    const err = await write("draft", "membuka kembali laporan");
    if (err) setSaveErr(err);
  };
  const openReview = () => { setReviewErr(""); setReviewOpen(true); };
  const submit = async () => {
    setReviewErr("");
    const err = await write(nextStatus, nextStatus === "closed" ? "menyelesaikan laporan" : "mengajukan laporan");
    if (err) setReviewErr(err); else setReviewOpen(false);
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

  const verdictText = f.verdict && f.verdict in VERDICT_LABEL ? VERDICT_LABEL[f.verdict as QaVerdict] : "Belum dipilih";
  const envParts = [f.os, f.browser, f.device].map((s) => s.trim()).filter(Boolean);
  const saveText = saveErr || (locked ? "Laporan terkunci. Buka kembali untuk mengubah isinya." : dirty ? "Ada perubahan belum disimpan." : "Semua perubahan tersimpan.");
  const reviewLabel = nextStatus === "closed" ? "Selesaikan dan kunci" : "Ajukan";
  const reviewConfirm = nextStatus === "closed" ? "Selesaikan dan kunci" : "Ajukan laporan";

  // Aksi utama mengikuti keadaan: terkunci → buka kembali; ada perubahan → simpan (ajukan jadi sekunder);
  // bersih → transisi status. Hanya satu aksi primer.
  const primaryActions = locked ? (
    <Button disabled={busy} loading={busy} onClick={() => void reopen()}>Buka kembali</Button>
  ) : dirty ? (
    <>
      <Button disabled={busy} loading={busy} onClick={() => void save()}>Simpan</Button>
      <Button variant="secondary" disabled={busy} onClick={openReview}>{reviewLabel}</Button>
    </>
  ) : (
    <Button disabled={busy} onClick={openReview}>{reviewLabel}</Button>
  );
  const menuItems: OverflowItem[] = [
    { key: "preview", label: "Pratinjau laporan", icon: "eye", onSelect: () => setPreviewOpen(true) },
    ...(locked ? [] : [{ key: "delete", label: "Hapus laporan", icon: "trash-2", tone: "danger" as const, onSelect: () => void remove() }]),
  ];
  const canSubmit = titleOk && f.verdict !== "";

  const panel: PanelProps = { detail, projectId, locked, onChange, onToast, onOpenSession };

  return (
    <div className="hn-qa-editor">
      <div className="hn-qa-bar">
        <div className="hn-qa-bar-title">
          <Button variant="ghost" size="sm" leftIcon="arrow-left" onClick={() => void back()}>Kembali</Button>
          <Badge tone="brass" variant="outline" size="sm">{detail.code}</Badge>
          {/* Pill hanya bila statusnya dikenal peta label (lib/labels.ts): status kosong atau tak dikenal
              tak boleh tampil sebagai "—" atau nilai mentah. */}
          {statusKnown && <Badge tone={REPORT_TONE[detail.status]} size="sm">{REPORT_LABEL[detail.status]}</Badge>}
          <h3 className="hn-qa-bar-name">{f.title.trim() || "Tanpa judul"}</h3>
        </div>
        <div className="hn-qa-bar-actions">
          <span role={saveErr ? "alert" : "status"} className={`hn-qa-bar-save${saveErr ? " is-error" : ""}`}>{saveText}</span>
          {primaryActions}
          <OverflowActions label="Menu laporan" title="Ekspor dan tindakan lain" items={menuItems}>
            <div className="hn-qa-export">
              {QA_EXPORTS.map((x) => (
                <Button key={x.format} size="sm" variant={x.format === "zip" ? "secondary" : "ghost"} leftIcon="download" as="a"
                  href={api.qaExportUrl(projectId, detail.id, x.format)}>{x.label}</Button>
              ))}
            </div>
          </OverflowActions>
        </div>
      </div>

      <section className="hn-qa-info" aria-labelledby={`${detail.id}-info`}>
        <div className="hn-qa-info-head">
          <h3 id={`${detail.id}-info`} className="hn-qa-info-title">Info laporan</h3>
          {dirty && <Badge tone="warn" size="sm">Belum disimpan</Badge>}
          <Button variant="secondary" size="sm" leftIcon="pencil" onClick={() => setInfoOpen(true)}>{locked ? "Lihat info" : "Ubah info"}</Button>
        </div>
        <dl className="hn-qa-facts">
          <div><dt>Versi aplikasi</dt><dd>{f.buildVersion.trim() || "Belum diisi"}</dd></div>
          <div><dt>Penguji</dt><dd>{f.tester.trim() || "Belum diisi"}</dd></div>
          <div><dt>Keputusan</dt><dd>{verdictText}</dd></div>
          <div><dt>Perangkat dan lingkungan</dt><dd>{envParts.length ? envParts.join(" · ") : "Belum diisi"}</dd></div>
        </dl>
      </section>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "cases", label: "Langkah uji", count: detail.cases.length },
        { value: "findings", label: "Temuan", count: detail.findings.length },
        { value: "attachments", label: "Lampiran", count: attachmentCount },
      ]} />
      {tab === "cases" && <QaCasesPanel {...panel} />}
      {tab === "findings" && <QaFindingsPanel {...panel} />}
      {tab === "attachments" && <QaAttachments {...panel} ownerType="report" ownerId={detail.id} />}

      {/* Drawer "Info laporan": isian lengkap. Perubahan tetap draf sampai disimpan dari header. */}
      <Modal open={infoOpen} title="Info laporan" eyebrow={detail.code} width={640} onClose={() => setInfoOpen(false)}
        footer={<Button onClick={() => setInfoOpen(false)}>Selesai</Button>}>
        <div className="hn-qa-form">
          <Field label="Judul laporan (wajib)" error={titleErr || undefined}>
            <Input placeholder="Contoh: Pengujian fitur login versi 1.0" value={f.title} disabled={locked} onChange={set("title")} />
          </Field>
          <div className="hn-qa-grid">
            <Field label="Versi aplikasi"><Input placeholder="Contoh: 1.0.0" value={f.buildVersion} disabled={locked} onChange={set("buildVersion")} /></Field>
            <Field label="Nama penguji"><Input placeholder="Contoh: Rina Pratama" value={f.tester} disabled={locked} onChange={set("tester")} /></Field>
          </div>
          <Field label="Apa yang diuji?" hint="Sebutkan fitur yang diperiksa dan batasan pengujiannya.">
            <HnTextarea rows={3} placeholder="Contoh: Login dengan email dan kata sandi. Login Google belum diuji." value={f.scope} disabled={locked} onChange={set("scope")} />
          </Field>
          <fieldset className="hn-qa-fieldset">
            <legend className="hn-qa-legend">Perangkat dan lingkungan pengujian</legend>
            <div className="hn-qa-grid">
              {ENV_FIELDS.map(({ key, label, example }) => (
                <Field key={key} label={label}><Input value={f[key]} placeholder={example} disabled={locked} onChange={set(key)} /></Field>
              ))}
            </div>
            <details className="hn-qa-more">
              <summary>Informasi lingkungan tambahan (opsional)</summary>
              <Field label="Lingkungan tambahan" hint="Satu per baris, misalnya jaringan=Wi-Fi">
                <HnTextarea rows={3} placeholder="mis. jaringan=Wi-Fi" value={f.env} disabled={locked} onChange={set("env")} />
              </Field>
            </details>
          </fieldset>
          <Field label="Ringkasan hasil" hint="Boleh diisi setelah langkah uji dan temuan selesai dicatat.">
            <HnTextarea rows={3} placeholder="Contoh: Login berhasil di Chrome, tetapi tombol Masuk tidak bereaksi di Safari." value={f.summary} disabled={locked} onChange={set("summary")} />
          </Field>
          <Field label="Keputusan" hint="Wajib saat mengajukan laporan. Pilih berdasarkan hasil pengujian.">
            <Select value={f.verdict} disabled={locked} onChange={set("verdict")}
              options={[{ value: "", label: "Pilih setelah pengujian selesai" }, ...QA_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))]} />
          </Field>
        </div>
      </Modal>

      {/* Tinjau dan ajukan: syarat sebagai checklist. Keputusan dipilih di sini; temuan terbuka hanya informasi. */}
      <Modal open={reviewOpen} title={nextStatus === "closed" ? "Tinjau dan selesaikan" : "Tinjau dan ajukan"} eyebrow={detail.code}
        width={560} dismissible={!busy} onClose={() => setReviewOpen(false)}
        footer={<>
          <Button variant="ghost" disabled={busy} onClick={() => setReviewOpen(false)}>Batal</Button>
          <Button disabled={!canSubmit || busy} loading={busy} onClick={() => void submit()}>{reviewConfirm}</Button>
        </>}>
        <ul className="hn-qa-check" aria-label="Syarat pengajuan">
          <li>
            <CheckIcon ok={titleOk} />
            <div className="hn-qa-check-body">
              <div className="hn-qa-check-name">Judul laporan</div>
              <div className="hn-qa-check-note">{titleOk ? "Sudah diisi." : "Belum diisi. Isi judul di Info laporan, lalu tinjau lagi."}</div>
            </div>
          </li>
          <li>
            <CheckIcon ok={f.verdict !== ""} />
            <div className="hn-qa-check-body">
              <div className="hn-qa-check-name">Keputusan hasil pengujian</div>
              <div className="hn-qa-check-note">{f.verdict !== "" ? `Dipilih: ${verdictText}.` : "Pilih satu keputusan. Wajib sebelum laporan diajukan."}</div>
              <RadioGroup aria-label="Keputusan hasil pengujian" value={f.verdict} onChange={(v) => setF((p) => ({ ...p, verdict: v }))}>
                {QA_VERDICTS.map((v) => <Radio key={v} value={v} label={VERDICT_LABEL[v]} />)}
              </RadioGroup>
            </div>
          </li>
          <li>
            <CheckIcon ok={openFindings === 0} warn />
            <div className="hn-qa-check-body">
              <div className="hn-qa-check-name">Temuan belum ditangani</div>
              <div className="hn-qa-check-note">{openFindings === 0 ? "Tidak ada temuan terbuka." : `${openFindings} temuan belum ditangani. Ini tidak menghalangi pengajuan.`}</div>
            </div>
          </li>
        </ul>
        {reviewErr && <p role="alert" className="hn-qa-error">{reviewErr}</p>}
      </Modal>

      {/* Pratinjau: renderer Markdown yang sama dengan ekspor. Format unduhan ada di menu ⋯. */}
      <Modal open={previewOpen} title={`Pratinjau ${detail.code}`} width={880} onClose={() => setPreviewOpen(false)}
        footer={<Button variant="ghost" onClick={() => setPreviewOpen(false)}>Tutup</Button>}>
        <QaPreview detail={detail} projectId={projectId} />
      </Modal>
      {dialog}
    </div>
  );
}

// Penanda syarat: ✓ terpenuhi, ⚠ perlu diperhatikan (tak menghalangi), ✕ belum terpenuhi. Maknanya ikut di teks.
function CheckIcon({ ok, warn = false }: { ok: boolean; warn?: boolean }) {
  const tone = ok ? "is-ok" : warn ? "is-warn" : "is-miss";
  return (
    <span className={`hn-qa-check-icon ${tone}`}>
      <Icon name={ok ? "circle-check" : warn ? "triangle-alert" : "circle-x"} size={16} />
    </span>
  );
}
