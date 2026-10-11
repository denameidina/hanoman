import React from "react";
import { QA_CASE_STATUSES, type QaCaseStatus, type QaCaseView } from "@hanoman/shared";
import { Button, Card, HnTextarea, Input, Select, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaField } from "./QaField";
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
      {p.detail.cases.map((c) => <CaseCard key={c.id} c={c} p={p} onRemove={() => void removeCase(c)} />)}
      {!p.locked && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <QaField label="Nama pengujian baru">
              <Input placeholder="Contoh: Login dengan akun yang benar" value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void add(); }} />
            </QaField>
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
  const grid: React.CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" };
  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 120px" }}><QaField label="Kode"><Input aria-label={`Kode ${c.code}`} maxLength={40} placeholder="kosong = nomor otomatis" {...bind("code")} /></QaField></div>
        <div style={{ flex: "1 1 200px" }}><QaField label="Nama pengujian"><Input aria-label={`Nama pengujian ${c.code}`} placeholder="mis. Login dengan akun yang benar" {...bind("title")} /></QaField></div>
        {/* Status tampil sekali: select ini sekaligus penanda status (terkunci bila laporan closed). */}
        <div style={{ flex: "0 0 auto" }}>
          <QaField label="Status">
            <Select aria-label={`Status ${c.code}`} value={c.status} disabled={p.locked}
              onChange={(e) => void persist({ status: e.target.value as QaCaseStatus })}
              options={QA_CASE_STATUSES.map((s) => ({ value: s, label: CASE_LABEL[s] }))} />
          </QaField>
        </div>
        {!p.locked && (
          <div style={{ paddingTop: 26 }}>
            <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${c.code}`} onClick={onRemove} />
          </div>
        )}
      </div>
      <div role={save.state === "error" ? "alert" : "status"}
        style={{ fontSize: "var(--text-xs)", color: save.state === "error" ? "var(--status-err)" : "var(--text-subtle)", minHeight: 16, marginBottom: 6 }}>
        {save.state === "saving" ? "Menyimpan…" : save.state === "saved" ? "Tersimpan" : save.state === "error" ? save.message : ""}
      </div>
      <div style={grid}>
        <QaField label="Langkah pengujian" hint="Satu langkah per baris.">
          <HnTextarea rows={4} placeholder={"Buka halaman login\nIsi email dan kata sandi\nKlik Masuk"} aria-label={`Langkah pengujian ${c.code}`} {...bind("steps")} />
        </QaField>
        <QaField label="Hasil yang diharapkan">
          <HnTextarea rows={4} placeholder="Contoh: Halaman beranda terbuka." aria-label={`Hasil yang diharapkan ${c.code}`} {...bind("expected")} />
        </QaField>
        <QaField label="Hasil yang terjadi">
          <HnTextarea rows={4} placeholder="Tulis apa yang terlihat saat dicoba." aria-label={`Hasil yang terjadi ${c.code}`} {...bind("actual")} />
        </QaField>
      </div>
      <QaAttachments {...p} ownerType="case" ownerId={c.id} compact />
    </Card>
  );
}
