import React from "react";
import {
  QA_PRIORITIES, QA_SEVERITIES, type QaFindingView, type QaPriority, type QaSeverity,
} from "@hanoman/shared";
import {
  Badge, Button, Callout, DenseRow, Field, HnTextarea, Icon, Input, Modal, OverflowActions, RowList, Select, StateBlock, useConfirm,
} from "../../ds";
import type { OverflowItem } from "../../ds";
import { useApi } from "../../api/instance";
import { labelOf, STAGE_LABEL } from "../../lib/labels";
import { QaAttachments } from "./QaAttachments";
import type { PanelProps } from "./QaReportEditor";
import {
  FINDING_STATUS_LABEL, FINDING_STATUS_TONE, PRIORITY_LABEL, SEVERITY_LABEL, SEVERITY_TONE, errText, failText,
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
// Satu baris hasil "Kirim semua": sukses (item backlog + baru/sudah ada) atau gagal dengan alasannya.
type BatchRow = { key: string; code: string; title: string; ok: boolean; text: string };
type Batch = { rows: BatchRow[]; error?: string };

export function QaFindingsPanel(p: PanelProps) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [starting, setStarting] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [draftErr, setDraftErr] = React.useState("");
  const [viewId, setViewId] = React.useState<string | null>(null);
  const [batch, setBatch] = React.useState<Batch | null>(null);
  const viewed = p.detail.findings.find((x) => x.id === viewId) ?? null;
  const openCount = p.detail.findings.filter((f) => f.status === "open").length;

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
  const edit = (f: QaFindingView) => { setDraftErr(""); setDraft(fromFinding(f)); };
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
  // Hasilnya dibuka di dialog setelah konfirmasi selesai (satu per temuan), tidak hanya sebagai toast.
  const sendAll = async () => {
    const targets = p.detail.findings.filter((f) => f.status === "open");
    const n = targets.length;
    const box = { value: null as { rows: BatchRow[]; sent: number } | null };
    try {
      await confirm({
        title: `Kirim ${n} temuan ke backlog?`,
        message: "Setiap temuan terbuka dibuat menjadi satu item backlog baru di project ini.",
        impact: [`Membuat ${n} item backlog.`, ...targets.map((f) => `${f.code} · ${f.title}`)],
        confirmLabel: `Kirim ${n} temuan`,
        // `run` menahan dialog konfirmasi tetap sibuk selama server bekerja (tak ada klik ganda).
        run: async () => {
          const r = await api.sendQaReportToBacklog(p.projectId, p.detail.id);
          p.onChange(r.report);
          const rows: BatchRow[] = targets.map((f) => {
            const hit = r.results.find((x) => x.findingId === f.id);
            const base = { key: f.id, code: f.code, title: f.title };
            if (!hit) return { ...base, ok: false, text: "Server tidak mengembalikan hasil untuk temuan ini." };
            if (hit.error) return { ...base, ok: false, text: hit.error };
            return { ...base, ok: true, text: `${hit.spec?.id ?? "backlog"} · ${hit.created ? "item baru dibuat" : "sudah ada di backlog"}` };
          });
          box.value = { rows, sent: r.sent };
        },
      });
    } catch (e) { setBatch({ rows: [], error: failText("mengirim temuan ke backlog", e) }); return; }
    const done = box.value;
    if (!done) return;
    const failed = done.rows.filter((x) => !x.ok).length;
    setBatch({ rows: done.rows });
    p.onToast?.(`${done.sent} temuan dikirim ke backlog${failed ? ` · ${failed} gagal` : ""}`);
  };
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

  // Satu aksi utama per baris di luar baris; sisanya di menu ⋯.
  const primary = (f: QaFindingView) => {
    if (f.spec) return <Button size="sm" variant="secondary" as="a" href={`/backlog/${encodeURIComponent(f.spec.id)}`}>Buka backlog</Button>;
    if (f.status === "open" || (f.backlogId && !f.spec))
      return <Button size="sm" variant="secondary" leftIcon="git-fork" onClick={() => void send(f)}>Kirim ke backlog</Button>;
    return null;
  };
  const rowItems = (f: QaFindingView): OverflowItem[] => {
    const items: OverflowItem[] = [];
    if (f.status !== "wontfix" && !f.spec)
      items.push({ key: "start", label: "Kerjakan langsung", icon: "play", disabled: starting !== null, onSelect: () => void start(f) });
    if (!p.locked) {
      items.push({ key: "edit", label: "Ubah temuan", icon: "pencil", onSelect: () => edit(f) });
      items.push({ key: "remove", label: "Hapus temuan", icon: "trash-2", tone: "danger", onSelect: () => void remove(f) });
    }
    return items;
  };

  const batchFailed = batch ? batch.rows.filter((r) => !r.ok).length : 0;
  const batchTitle = !batch ? ""
    : batch.error ? "Gagal mengirim ke backlog"
    : batchFailed === 0 ? `${batch.rows.length} temuan terkirim ke backlog`
    : batchFailed === batch.rows.length ? "Tidak ada temuan yang terkirim"
    : `${batch.rows.length - batchFailed} terkirim, ${batchFailed} gagal`;

  return (
    <div className="hn-qa-stack">
      <div className="hn-qa-toolbar">
        {!p.locked && <Button leftIcon="bug" onClick={() => { setDraftErr(""); setDraft({ ...blank }); }}>Temuan baru</Button>}
        {openCount > 0 && <Button variant="secondary" leftIcon="git-fork" onClick={() => void sendAll()}>{`Kirim semua ke backlog (${openCount})`}</Button>}
      </div>
      {p.detail.findings.length === 0 && <StateBlock kind="empty" compact title="Belum ada temuan" hint="Satu temuan = satu masalah, lengkap dengan langkah yang bisa diulang." />}
      {p.detail.findings.length > 0 && (
        <RowList label="Daftar temuan">
          {p.detail.findings.map((f) => {
            const attached = p.detail.attachments.filter((a) => a.ownerType === "finding" && a.ownerId === f.id).length;
            return (
              <DenseRow key={f.id} onClick={() => setViewId(f.id)}
                actions={<>{primary(f)}<OverflowActions label={`Menu ${f.code}`} title={`Temuan ${f.code}`} items={rowItems(f)} /></>}>
                <span className="hn-qa-row-body">
                  <span className="hn-qa-row-head">
                    <span className="hn-qa-code">{f.code}</span>
                    <Badge tone={SEVERITY_TONE[f.severity]} size="sm">{SEVERITY_LABEL[f.severity]}</Badge>
                    <Badge tone={FINDING_STATUS_TONE[f.status]} variant="dot" size="sm">{FINDING_STATUS_LABEL[f.status]}</Badge>
                  </span>
                  <span className="hn-qa-row-title">{f.title}</span>
                  <span className="hn-qa-row-line">
                    <span>{f.priority}</span>
                    {f.area && <span>{f.area}</span>}
                    {f.caseCode && <span>{f.caseCode}</span>}
                    {f.spec && <span>{`${f.spec.id} · ${labelOf(STAGE_LABEL, f.spec.stage)}`}</span>}
                    {f.backlogId && !f.spec && <span>{`${f.backlogId} · tautan putus`}</span>}
                    {attached > 0 && <span>{`${attached} lampiran`}</span>}
                  </span>
                </span>
              </DenseRow>
            );
          })}
        </RowList>
      )}

      {/* Detail temuan: langkah, hasil, dan lampiran. Dibuka dengan mengetuk baris. */}
      <Modal open={!!viewed} title={viewed?.title ?? ""} eyebrow={viewed?.code} width={680} onClose={() => setViewId(null)}
        footer={viewed && (
          <>
            <Button variant="ghost" onClick={() => setViewId(null)}>Tutup</Button>
            {!p.locked && <Button variant="secondary" leftIcon="pencil" onClick={() => { setViewId(null); edit(viewed); }}>Ubah temuan</Button>}
          </>
        )}>
        {viewed && <FindingDetail f={viewed} p={p} />}
      </Modal>

      {/* Hasil "Kirim semua": sukses dan gagal per temuan, tetap terbaca sampai ditutup. */}
      <Modal open={!!batch} title={batchTitle} width={560} onClose={() => setBatch(null)}
        footer={<Button onClick={() => setBatch(null)}>Tutup</Button>}>
        <div className="hn-qa-detail-stack">
          {batch?.error && <Callout tone="err">{batch.error}</Callout>}
          {batch && batch.rows.length > 0 && (
            <RowList label="Hasil per temuan">
              {batch.rows.map((r) => (
                <DenseRow key={r.key}>
                  <span className="hn-qa-row-body">
                    <span className="hn-qa-row-title">{`${r.code} · ${r.title}`}</span>
                    <span className={`hn-qa-result-line${r.ok ? "" : " is-err"}`}>
                      <Icon name={r.ok ? "circle-check" : "circle-x"} size={13} /> {r.text}
                    </span>
                  </span>
                </DenseRow>
              ))}
            </RowList>
          )}
        </div>
      </Modal>

      <Modal open={!!draft} width={640} title={draft?.id ? "Ubah temuan" : "Temuan baru"} onClose={() => setDraft(null)}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Batal</Button><Button onClick={() => void save()} disabled={!draft?.title.trim()}>Simpan temuan</Button></>}>
        {draft && (
          <>
            <Field label="Kode (opsional)" hint="Bebas, mis. LOGIN-3. Harus unik di laporan ini; kosongkan untuk nomor otomatis.">
              <Input maxLength={40} placeholder="F-01" value={draft.code} onChange={set("code")} />
            </Field>
            <Field label="Judul masalah (wajib)">
              <Input placeholder="Contoh: Tombol Masuk tidak bereaksi di Safari" value={draft.title} onChange={set("title")} autoFocus />
            </Field>
            <div className="hn-qa-grid">
              <Field label="Dampak masalah" hint="Seberapa terganggu pengguna?">
                <Select value={draft.severity} onChange={set("severity")} options={QA_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
              </Field>
              <Field label="Prioritas" hint="Urutan perbaikan.">
                <Select value={draft.priority} onChange={set("priority")} options={QA_PRIORITIES.map((s) => ({ value: s, label: PRIORITY_LABEL[s] }))} />
              </Field>
              <Field label="Fitur / halaman">
                <Input placeholder="Contoh: Login" value={draft.area} onChange={set("area")} />
              </Field>
              <Field label="Pengujian terkait (opsional)">
                <Select value={draft.caseId} onChange={set("caseId")}
                  options={[{ value: "", label: "— tidak terkait —" }, ...p.detail.cases.map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` }))]} />
              </Field>
            </div>
            <Field label="Cara memunculkan masalah" hint="Satu langkah per baris; nomor ditambahkan otomatis.">
              <HnTextarea rows={5} placeholder={"Buka halaman login\nIsi akun yang benar\nKlik Masuk"} value={draft.steps} onChange={set("steps")} />
            </Field>
            <Field label="Hasil yang diharapkan"><HnTextarea rows={3} placeholder="mis. Halaman beranda terbuka." value={draft.expected} onChange={set("expected")} /></Field>
            <Field label="Hasil yang terjadi"><HnTextarea rows={3} placeholder="mis. Tombol diam, tak ada pesan galat." value={draft.actual} onChange={set("actual")} /></Field>
            {draft.id && (
              <Field label="Status">
                <Select value={draft.status} onChange={set("status")}
                  options={[{ value: "open", label: FINDING_STATUS_LABEL.open }, { value: "wontfix", label: FINDING_STATUS_LABEL.wontfix }]} />
              </Field>
            )}
            {draftErr && <p role="alert" className="hn-qa-error">{draftErr}</p>}
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}

// Isi dialog detail temuan. Lampiran ikut di sini (milik temuan ini), bisa ditambah bila laporan terbuka.
function FindingDetail({ f, p }: { f: QaFindingView; p: PanelProps }) {
  return (
    <div className="hn-qa-detail-stack">
      <span className="hn-qa-row-line">
        <Badge tone={SEVERITY_TONE[f.severity]} size="sm">{SEVERITY_LABEL[f.severity]}</Badge>
        <Badge tone={FINDING_STATUS_TONE[f.status]} variant="dot" size="sm">{FINDING_STATUS_LABEL[f.status]}</Badge>
        <span>Prioritas {f.priority}</span>
        {f.area && <span>{f.area}</span>}
        {f.caseCode && <span>{f.caseCode}</span>}
      </span>
      {f.steps.length > 0 && (
        <div>
          <div className="hn-qa-label">Cara memunculkan masalah</div>
          <ol className="hn-qa-steps">{f.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      )}
      <div className="hn-qa-detail-grid">
        <div>
          <div className="hn-qa-label">Hasil yang diharapkan</div>
          <div className="hn-qa-pre">{f.expected || "—"}</div>
        </div>
        <div>
          <div className="hn-qa-label">Hasil yang terjadi</div>
          <div className="hn-qa-pre">{f.actual || "—"}</div>
        </div>
      </div>
      <div>
        <div className="hn-qa-label">Lampiran temuan</div>
        <QaAttachments {...p} ownerType="finding" ownerId={f.id} compact />
      </div>
    </div>
  );
}
