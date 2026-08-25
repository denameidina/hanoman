import React from "react";
import type { CreateTaskInput, MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { Button, Field, HnTextarea, Input, Modal, Select, useConfirm } from "../ds";
import { api } from "../api/client";
import { TEAM_COLUMNS, dateInputToIso, dateInputValue } from "./team-rules";
import type { ProjectVM } from "./types";

// SPEC-946 · satu form untuk buat DAN ubah, dibedakan oleh ada/tidaknya kartu yang dipegang.
// Dua modal untuk satu bentuk data adalah cara keduanya mulai menerima field yang berbeda.

// Kosakata prioritas datang dari kontrak (`zPriority` lewat `zCreateTask`), bukan dari daftar
// literal baru — `Record<Priority, …>` membuat nilai yang bertambah jadi galat kompilasi di sini,
// bukan opsi yang diam-diam hilang dari form.
type Priority = NonNullable<CreateTaskInput["priority"]>;
const PRIORITY_LABEL: Record<Priority, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah" };
const PRIORITIES = (Object.keys(PRIORITY_LABEL) as Priority[])
  .map((value) => ({ value, label: PRIORITY_LABEL[value] }));

type Form = {
  title: string; detail: string; projectId: string; status: TaskStatus;
  priority: Priority; memberId: string; startDate: string; dueDate: string;
};

const formOf = (t: TaskView | null, defaultProjectId: string | null): Form => ({
  title: t?.title ?? "",
  detail: t?.detail ?? "",
  projectId: t ? (t.projectId ?? "") : (defaultProjectId ?? ""),
  status: t?.status ?? "backlog",
  // `Task.priority` kolom TEXT yang menyeberang sync dari mesin yang boleh lebih baru (ADR-0087),
  // jadi nilai di luar kosakata jatuh ke "sedang" alih-alih membuat Select tanpa nilai terpilih.
  priority: (t && (t.priority in PRIORITY_LABEL) ? t.priority : "sedang") as Priority,
  memberId: t?.memberId ?? "",
  startDate: dateInputValue(t?.startDate ?? null),
  dueDate: dateInputValue(t?.dueDate ?? null),
});

export function TaskModal({ open, task, projects, members, defaultProjectId, onClose, onSaved, onToast }: {
  open: boolean; task: TaskView | null; projects: ProjectVM[]; members: MemberView[];
  defaultProjectId: string | null;
  onClose: () => void; onSaved: () => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [form, setForm] = React.useState<Form>(() => formOf(task, defaultProjectId));
  const [busy, setBusy] = React.useState(false);
  const { confirm, dialog } = useConfirm();

  // Kartu yang dipegang berganti tanpa modal sempat di-unmount (buka kartu lain, atau `onSaved`
  // → reload mengganti objeknya). Yang menandai "ini kartu lain" adalah id-nya, bukan referensinya
  // — objek `TaskView` baru tiap frame WS, dan menyeed ulang tiap kali itu menghapus ketikan.
  const seedKey = `${open ? "1" : "0"}:${task?.id ?? ""}`;
  const seeded = React.useRef(seedKey);
  if (seeded.current !== seedKey) {
    seeded.current = seedKey;
    if (open) setForm(formOf(task, defaultProjectId));
  }

  if (!open) return null;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.title.trim()) { onToast("Judul tugas wajib diisi", "err", "x-circle"); return; }
    setBusy(true);
    // `null` berarti "kosongkan", `undefined` berarti "jangan sentuh" — route membedakan keduanya,
    // dan form ini SELALU mengirim keadaan penuh, jadi yang kosong memang harus jadi null.
    const payload = {
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      projectId: form.projectId || null,
      status: form.status,
      priority: form.priority,
      memberId: form.memberId || null,
      startDate: dateInputToIso(form.startDate),
      dueDate: dateInputToIso(form.dueDate),
    };
    try {
      if (task) await api.patchTask(task.id, payload);
      else await api.createTask(payload);
      onToast(task ? "Tugas diperbarui" : "Tugas dibuat", "ok", "check");
      onSaved();
      onClose();
    } catch { onToast("Gagal menyimpan tugas", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!task) return;
    if (!await confirm({
      title: `Hapus "${task.title}"?`,
      message: "Kartu ini hilang dari papan di semua device yang tersinkron.",
      confirmLabel: "Hapus tugas", tone: "danger", icon: "trash-2",
      run: () => api.deleteTask(task.id),
    })) return;
    onToast("Tugas dihapus", "ok", "trash-2");
    onSaved();
    onClose();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} icon="clipboard-list"
        eyebrow="Papan tim" title={task ? "Ubah tugas" : "Tugas baru"}
        footer={
          <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
            {task && <Button variant="ghost" leftIcon="trash-2" onClick={remove} disabled={busy}>Hapus</Button>}
            <span style={{ flex: 1 }} />
            <Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={save} loading={busy}>{task ? "Simpan" : "Buat tugas"}</Button>
          </div>
        }>
        <Field label="Judul">
          <Input value={form.title} aria-label="Judul tugas" placeholder="mis. Rapikan halaman harga"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ title: e.target.value })}
            style={{ width: "100%" }} />
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Project">
            {/* `Task.projectId` nullable — tugas internal tim memang tak punya project (ADR-0150). */}
            <Select value={form.projectId} aria-label="Project tugas"
              onChange={(e) => set({ projectId: e.target.value })}
              options={[{ value: "", label: "Tanpa project" },
                ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
          <Field label="Kolom">
            <Select value={form.status} aria-label="Kolom tugas"
              onChange={(e) => set({ status: e.target.value as TaskStatus })}
              options={TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))} />
          </Field>
          <Field label="Prioritas">
            <Select value={form.priority} aria-label="Prioritas tugas"
              onChange={(e) => set({ priority: e.target.value as Priority })} options={PRIORITIES} />
          </Field>
        </div>
        <Field label="Ditugaskan ke">
          <Select value={form.memberId} aria-label="Anggota tugas"
            onChange={(e) => set({ memberId: e.target.value })}
            options={[{ value: "", label: "Belum ditugaskan" },
              ...members.map((m) => ({ value: m.id, label: m.role ? `${m.name} · ${m.role}` : m.name }))]}
            style={{ width: "100%" }} />
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Mulai">
            <Input type="date" value={form.startDate} aria-label="Tanggal mulai"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ startDate: e.target.value })} />
          </Field>
          <Field label="Tenggat">
            <Input type="date" value={form.dueDate} aria-label="Tanggal tenggat"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Detail" hint="Opsional — konteks yang tak muat di judul.">
          <HnTextarea value={form.detail} aria-label="Detail tugas" rows={4}
            onChange={(e) => set({ detail: e.target.value })} />
        </Field>
      </Modal>
      {dialog}
    </>
  );
}
