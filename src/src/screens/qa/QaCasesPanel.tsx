import React from "react";
import { QA_CASE_STATUSES, type QaCaseStatus, type QaCaseView } from "@hanoman/shared";
import { Button, Card, Field, HnTextarea, Icon, Input, OverflowActions, Radio, RadioGroup, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import type { PanelProps } from "./QaReportEditor";
import { CASE_LABEL, errText, failText } from "./qa-ui";

type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };
type CaseBody = Parameters<ReturnType<typeof useApi>["patchQaCase"]>[3];

export function QaCasesPanel(p: PanelProps) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [title, setTitle] = React.useState("");
  const run = async (fn: () => Promise<PanelProps["detail"]>) => {
    try { p.onChange(await fn()); return true; } catch (e) { p.onToast?.(errText(e)); return false; }
  };
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    if (await run(() => api.createQaCase(p.projectId, p.detail.id, { title: t }))) setTitle("");
  };
  // Hapus menunggu konfirmasi; `run` menahan dialog tetap sibuk sampai server menjawab (tak ada klik ganda).
  const removeCase = async (c: QaCaseView) => {
    try {
      await confirm({
        title: `Hapus ${c.code}?`,
        message: c.title,
        impact: ["Langkah dan hasil pengujian ikut terhapus.", "Lampiran milik test case ini ikut terhapus."],
        tone: "danger",
        confirmLabel: "Hapus",
        run: async () => { p.onChange(await api.deleteQaCase(p.projectId, p.detail.id, c.id)); },
      });
    } catch (e) { p.onToast?.(errText(e)); }
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
    <div className="hn-qa-stack">
      <p className="hn-qa-intro">Satu langkah uji (test case) = satu aktivitas yang diperiksa. Kolom tersimpan saat Anda keluar dari kolom.</p>
      <div className="hn-qa-toolbar">
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
      {p.detail.cases.map((c) => <CaseCard key={c.id} c={c} p={p} onRemove={() => void removeCase(c)} />)}
      {!p.locked && (
        <div className="hn-qa-add">
          <div className="hn-qa-add-field">
            <Field label="Nama pengujian baru">
              <Input placeholder="Contoh: Login dengan akun yang benar" value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void add(); }} />
            </Field>
          </div>
          <Button leftIcon="plus" onClick={() => void add()} disabled={!title.trim()}>Tambah</Button>
        </div>
      )}
      {dialog}
    </div>
  );
}

function CaseCard({ c, p, onRemove }: { c: QaCaseView; p: PanelProps; onRemove: () => void }) {
  const api = useApi();
  const [d, setD] = React.useState({ code: c.code, title: c.title, steps: c.steps, expected: c.expected, actual: c.actual });
  const [save, setSave] = React.useState<SaveState>({ state: "idle" });
  React.useEffect(() => { setD({ code: c.code, title: c.title, steps: c.steps, expected: c.expected, actual: c.actual }); }, [c.id, c.code, c.title, c.steps, c.expected, c.actual]);
  // Satu PATCH per simpanan. Hasilnya tampil di kartu ini (Menyimpan / Tersimpan / gagal + alasan),
  // bukan hanya toast yang hilang dalam 2,6 detik.
  const persist = async (body: CaseBody, onFail?: () => void) => {
    setSave({ state: "saving" });
    try {
      p.onChange(await api.patchQaCase(p.projectId, p.detail.id, c.id, body));
      setSave({ state: "saved" });
    } catch (e) {
      setSave({ state: "error", message: failText("menyimpan test case", e) });
      onFail?.();
    }
  };
  // Simpan saat blur, hanya bila berubah — ketikan tak membanjiri server.
  const commit = (k: "code" | "title" | "steps" | "expected" | "actual") => {
    if (d[k] === c[k] || (k === "title" && !d.title.trim())) return;
    // Kode kosong = kembali ke nomor otomatis; galat (mis. kode bentrok) mengembalikan isian ke kode tersimpan.
    void persist({ [k]: k === "code" ? d.code.trim() || null : d[k] }, () => { if (k === "code") setD((s) => ({ ...s, code: c.code })); });
  };
  const bind = (k: keyof typeof d) => ({
    value: d[k], disabled: p.locked, onBlurCapture: () => commit(k),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((s) => ({ ...s, [k]: e.target.value })),
  });
  const saveText = save.state === "saving" ? "Menyimpan…" : save.state === "saved" ? "Tersimpan" : save.state === "error" ? save.message : "";
  return (
    <Card padding={14}>
      <div className="hn-qa-case-head">
        <div className="hn-qa-case-code"><Field label="Kode"><Input aria-label={`Kode ${c.code}`} maxLength={40} placeholder="kosong = nomor otomatis" {...bind("code")} /></Field></div>
        <div className="hn-qa-case-name"><Field label="Nama pengujian"><Input aria-label={`Nama pengujian ${c.code}`} placeholder="mis. Login dengan akun yang benar" {...bind("title")} /></Field></div>
        {!p.locked && (
          <OverflowActions label={`Menu ${c.code}`} title={`Test case ${c.code}`}
            items={[{ key: "remove", label: "Hapus test case", icon: "trash-2", tone: "danger", onSelect: onRemove }]} />
        )}
      </div>
      <div className="hn-qa-case-status">
        {/* Satu ketukan per status. Status tampil sekali di sini; tak ada select atau badge kedua. */}
        <RadioGroup aria-label={`Status ${c.code}`} value={c.status} direction="row" disabled={p.locked} className="hn-qa-seg"
          onChange={(v) => void persist({ status: v as QaCaseStatus })}>
          {QA_CASE_STATUSES.map((s) => (
            <Radio key={s} value={s} label={CASE_LABEL[s]} className={c.status === s ? "is-on" : undefined} />
          ))}
        </RadioGroup>
        <span role={save.state === "error" ? "alert" : "status"}
          className={`hn-qa-save is-${save.state === "error" ? "error" : save.state}`}>
          {save.state === "saving" && <Icon name="loader-circle" size={13} />}
          {save.state === "saved" && <Icon name="circle-check" size={13} />}
          {save.state === "error" && <Icon name="circle-x" size={13} />}
          {saveText}
        </span>
      </div>
      <div className="hn-qa-case-grid">
        <Field label="Langkah pengujian" hint="Satu langkah per baris.">
          <HnTextarea rows={4} placeholder={"Buka halaman login\nIsi email dan kata sandi\nKlik Masuk"} aria-label={`Langkah pengujian ${c.code}`} {...bind("steps")} />
        </Field>
        <Field label="Hasil yang diharapkan">
          <HnTextarea rows={4} placeholder="Contoh: Halaman beranda terbuka." aria-label={`Hasil yang diharapkan ${c.code}`} {...bind("expected")} />
        </Field>
        <Field label="Hasil yang terjadi">
          <HnTextarea rows={4} placeholder="Contoh: Tombol Masuk tidak bereaksi." aria-label={`Hasil yang terjadi ${c.code}`} {...bind("actual")} />
        </Field>
      </div>
      <QaAttachments {...p} ownerType="case" ownerId={c.id} compact />
    </Card>
  );
}
