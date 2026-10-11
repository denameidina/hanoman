import React from "react";
import {
  QA_PRIORITIES, QA_SEVERITIES, type QaFindingView, type QaPriority, type QaSeverity,
} from "@hanoman/shared";
import { Badge, Button, Callout, Card, HnTextarea, Input, Modal, Select, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaField } from "./QaField";
import type { PanelProps } from "./QaReportEditor";
import {
  FINDING_STATUS_LABEL, FINDING_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE, SEVERITY_LABEL, SEVERITY_TONE,
  errText, failText,
} from "./qa-ui";

type Draft = {
  id: string | null; code: string; origCode: string; title: string; severity: QaSeverity; priority: QaPriority; area: string;
  caseId: string; steps: string; expected: string; actual: string; status: "open" | "wontfix";
};
const blank: Draft = { id: null, code: "", origCode: "", title: "", severity: "major", priority: "P2", area: "", caseId: "", steps: "", expected: "", actual: "", status: "open" };
const fromFinding = (f: QaFindingView): Draft => ({
  id: f.id, code: f.code, origCode: f.code, title: f.title, severity: f.severity, priority: f.priority, area: f.area, caseId: f.caseId ?? "",
  steps: f.steps.join("\n"), expected: f.expected, actual: f.actual, status: f.status === "wontfix" ? "wontfix" : "open",
});
// Hasil kirim massal yang tak tuntas. Tetap tampil sampai ditutup, bukan hilang bersama toast.
type Batch = { sent: number; failed: { code: string; title: string; reason: string }[]; error?: string };

export function QaFindingsPanel(p: PanelProps) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [starting, setStarting] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [draftErr, setDraftErr] = React.useState("");
  const [batch, setBatch] = React.useState<Batch | null>(null);

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    const code = draft.code.trim();
    // Kode hanya dikirim bila diubah: menyimpan temuan bernomor otomatis tak boleh membekukan nomornya.
    const body = {
      ...(code !== draft.origCode ? { code: code || null } : {}),
      title: draft.title.trim(), severity: draft.severity, priority: draft.priority, area: draft.area,
      caseId: draft.caseId || null, expected: draft.expected, actual: draft.actual, status: draft.status,
      steps: draft.steps.split("\n").map((l) => l.trim().replace(/^\d+[.)]\s+/, "")).filter(Boolean),
    };
    setDraftErr("");
    try {
      p.onChange(draft.id
        ? await api.patchQaFinding(p.projectId, p.detail.id, draft.id, body)
        : await api.createQaFinding(p.projectId, p.detail.id, body));
      setDraft(null);
    } catch (e) { setDraftErr(failText("menyimpan temuan", e)); }
  };
  // Kirim ke backlog TETAP tersedia di laporan closed (pengecualian read-only: hanya tautan yang berubah).
  const noteRejected = (r: { attachments: { rejected: { filename: string; reason: string }[] } }) =>
    r.attachments.rejected.length ? ` · lampiran ditolak: ${r.attachments.rejected.map((x) => `${x.filename} (${x.reason})`).join(", ")}` : "";
  const send = async (f: QaFindingView) => {
    try {
      const r = await api.sendQaFindingToBacklog(p.projectId, p.detail.id, f.id);
      p.onChange(r.report);
      p.onToast?.(`${f.code} → ${r.spec?.id ?? "backlog"}${r.created ? " dibuat" : " sudah ada"}${noteRejected(r)}`);
    } catch (e) { p.onToast?.(errText(e)); }
  };
  const start = async (f: QaFindingView) => {
    if (starting) return;
    setStarting(f.id);
    try {
      const r = await api.startQaFindingSession(p.projectId, p.detail.id, f.id);
      p.onOpenSession?.(r.id);
      p.onToast?.(`${f.code} · sesi ${r.reused ? "dibuka kembali" : "dimulai"}`);
    } catch (e) { p.onToast?.(errText(e)); }
    finally { setStarting(null); }
  };
  // Kirim semua = membuat item backlog untuk SEMUA temuan terbuka, jadi jumlah dan daftarnya disebut dulu.
  // `run` menahan dialog tetap sibuk selama server bekerja (tak ada klik ganda).
  const sendAll = async () => {
    const targets = p.detail.findings.filter((f) => f.status === "open");
    const n = targets.length;
    try {
      await confirm({
        title: `Kirim ${n} temuan ke backlog?`,
        message: "Setiap temuan terbuka dibuat menjadi satu item backlog baru di project ini.",
        impact: [`Membuat ${n} item backlog.`, ...targets.map((f) => `${f.code} · ${f.title}`)],
        confirmLabel: `Kirim ${n} temuan`,
        run: async () => {
          setBatch(null);
          const r = await api.sendQaReportToBacklog(p.projectId, p.detail.id);
          p.onChange(r.report);
          const failed = r.results.filter((x) => x.error).map((x) => ({
            code: x.code, title: targets.find((f) => f.id === x.findingId)?.title ?? "", reason: x.error ?? "",
          }));
          setBatch({ sent: r.sent, failed });
          p.onToast?.(`${r.sent} temuan dikirim ke backlog${failed.length ? ` · ${failed.length} gagal` : ""}`);
        },
      });
    } catch (e) { setBatch({ sent: 0, failed: [], error: failText("mengirim temuan ke backlog", e) }); }
  };
  const openCount = p.detail.findings.filter((f) => f.status === "open").length;
  const remove = async (f: QaFindingView) => {
    try {
      await confirm({
        title: `Hapus ${f.code}?`,
        message: f.title,
        impact: ["Langkah, hasil, dan lampiran temuan ini ikut terhapus."],
        tone: "danger",
        confirmLabel: "Hapus",
        run: async () => { p.onChange(await api.deleteQaFinding(p.projectId, p.detail.id, f.id)); },
      });
    } catch (e) { p.onToast?.(errText(e)); }
  };
  const set = <K extends keyof Draft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value as Draft[K] } : d));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!p.locked && <Button leftIcon="bug" onClick={() => { setDraftErr(""); setDraft({ ...blank }); }}>Temuan baru</Button>}
        {openCount > 0 && <Button variant="secondary" leftIcon="git-fork" onClick={() => void sendAll()}>{`Kirim semua ke backlog (${openCount})`}</Button>}
      </div>
      {batch && (batch.error || batch.failed.length > 0) && (
        <div role="alert">
          <Callout tone="err"
            title={batch.error ?? `${batch.failed.length} temuan gagal dikirim ke backlog${batch.sent ? ` (${batch.sent} berhasil)` : ""}`}
            action={<Button size="sm" variant="ghost" onClick={() => setBatch(null)}>Tutup</Button>}>
            {batch.failed.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {batch.failed.map((x) => <li key={x.code}>{`${x.code}${x.title ? ` · ${x.title}` : ""}: ${x.reason}`}</li>)}
              </ul>
            )}
          </Callout>
        </div>
      )}
      {p.detail.findings.length === 0 && <StateBlock kind="empty" compact title="Belum ada temuan" hint="Satu temuan = satu masalah, lengkap dengan langkah yang bisa diulang." />}
      {p.detail.findings.map((f) => (
        <Card key={f.id} padding={14}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <Badge tone="neutral" variant="outline" size="sm">{f.code}</Badge>
            <Badge tone={SEVERITY_TONE[f.severity]} size="sm">{SEVERITY_LABEL[f.severity]}</Badge>
            <Badge tone={PRIORITY_TONE[f.priority]} size="sm">{f.priority}</Badge>
            {f.status !== "open" && <Badge tone={FINDING_STATUS_TONE[f.status]} size="sm">{FINDING_STATUS_LABEL[f.status]}</Badge>}
            {f.area && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>{f.area}</span>}
            {f.caseCode && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>· {f.caseCode}</span>}
            {f.spec && <a href={`/backlog/${encodeURIComponent(f.spec.id)}`} style={{ textDecoration: "none" }}><Badge tone="ok" size="sm">{`${f.spec.id} · ${f.spec.stage}`}</Badge></a>}
            {f.backlogId && !f.spec && <Badge tone="warn" size="sm">{`${f.backlogId} · tautan putus`}</Badge>}
            <span style={{ flex: 1 }} />
            {f.status !== "wontfix" && !f.spec && (
              <Button size="sm" disabled={starting !== null} loading={starting === f.id} onClick={() => void start(f)}>Kerjakan langsung</Button>
            )}
            {(f.status === "open" || (f.backlogId && !f.spec)) && (
              <Button size="sm" variant="secondary" leftIcon="git-fork" onClick={() => void send(f)}>Kirim ke backlog</Button>
            )}
            {!p.locked && (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setDraftErr(""); setDraft(fromFinding(f)); }}>Ubah</Button>
                <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${f.code}`} onClick={() => void remove(f)} />
              </>
            )}
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-strong)", overflowWrap: "anywhere" }}>{f.title}</div>
          {f.steps.length > 0 && <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: "var(--text-sm)" }}>{f.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {(f.expected || f.actual) && (
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", marginTop: 8, fontSize: "var(--text-sm)" }}>
              <div><b>Hasil yang diharapkan</b><div style={{ whiteSpace: "pre-wrap" }}>{f.expected || "—"}</div></div>
              <div><b>Hasil yang terjadi</b><div style={{ whiteSpace: "pre-wrap" }}>{f.actual || "—"}</div></div>
            </div>
          )}
          <QaAttachments {...p} ownerType="finding" ownerId={f.id} compact />
        </Card>
      ))}

      <Modal open={!!draft} width={640} title={draft?.id ? "Ubah temuan" : "Temuan baru"} onClose={() => setDraft(null)}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Batal</Button><Button onClick={() => void save()} disabled={!draft?.title.trim()}>Simpan temuan</Button></>}>
        {draft && (
          <>
            <QaField label="Kode (opsional)" hint="Bebas, mis. LOGIN-3. Harus unik di laporan ini; kosongkan untuk nomor otomatis.">
              <Input maxLength={40} placeholder="F-01" value={draft.code} onChange={set("code")} />
            </QaField>
            <QaField label="Judul masalah (wajib)">
              <Input placeholder="Contoh: Tombol Masuk tidak bereaksi di Safari" value={draft.title} onChange={set("title")} autoFocus />
            </QaField>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
              <QaField label="Dampak masalah" hint="Seberapa terganggu pengguna?">
                <Select value={draft.severity} onChange={set("severity")} options={QA_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
              </QaField>
              <QaField label="Prioritas" hint="Urutan perbaikan.">
                <Select value={draft.priority} onChange={set("priority")} options={QA_PRIORITIES.map((s) => ({ value: s, label: PRIORITY_LABEL[s] }))} />
              </QaField>
              <QaField label="Fitur / halaman">
                <Input placeholder="Contoh: Login" value={draft.area} onChange={set("area")} />
              </QaField>
              <QaField label="Pengujian terkait (opsional)">
                <Select value={draft.caseId} onChange={set("caseId")}
                  options={[{ value: "", label: "— tidak terkait —" }, ...p.detail.cases.map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` }))]} />
              </QaField>
            </div>
            <QaField label="Cara memunculkan masalah" hint="Satu langkah per baris; nomor ditambahkan otomatis.">
              <HnTextarea rows={5} placeholder={"Buka halaman login\nIsi akun yang benar\nKlik Masuk"} value={draft.steps} onChange={set("steps")} />
            </QaField>
            <QaField label="Hasil yang diharapkan"><HnTextarea rows={3} placeholder="mis. Halaman beranda terbuka." value={draft.expected} onChange={set("expected")} /></QaField>
            <QaField label="Hasil yang terjadi"><HnTextarea rows={3} placeholder="mis. Tombol diam, tak ada pesan galat." value={draft.actual} onChange={set("actual")} /></QaField>
            {draft.id && (
              <QaField label="Status">
                <Select value={draft.status} onChange={set("status")}
                  options={[{ value: "open", label: FINDING_STATUS_LABEL.open }, { value: "wontfix", label: FINDING_STATUS_LABEL.wontfix }]} />
              </QaField>
            )}
            {draftErr && <p role="alert" style={{ margin: 0, color: "var(--status-err)", fontSize: "var(--text-sm)" }}>{draftErr}</p>}
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}
