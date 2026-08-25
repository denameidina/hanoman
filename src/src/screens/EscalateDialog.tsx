import React from "react";
import { ESCALATE_SOURCES, type EscalateSource, type EscalateTaskInput, type TaskView } from "@hanoman/shared";
import { Button, Field, Modal, Select } from "../ds";
import { api } from "../api/client";
import { PRIO_OPTS, sourceMeta } from "./source-meta";
import type { ProjectVM } from "./types";

/* SPEC-947 · satu-satunya jembatan papan tim ke dunia agen. Kartu TETAP di papan sesudahnya —
   yang lahir adalah backlog item, bukan pemindahan.

   Label source datang dari `sourceMeta()` (SPEC-546 · source-meta.ts), bukan literal baru:
   katalog yang disalin pasti berselisih dengan lencananya di layar Backlog. */

const SOURCE_OPTS = ESCALATE_SOURCES.map((value) => ({ value, label: sourceMeta(value).label }));

type Priority = NonNullable<EscalateTaskInput["priority"]>;

export function EscalateDialog({ task, projects, onClose, onDone, onToast }: {
  task: TaskView; projects: ProjectVM[];
  onClose: () => void;
  /** Kartu terbaru dari server — papan memperbaruinya seketika, tak menunggu frame WS. */
  onDone: (task: TaskView) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [source, setSource] = React.useState<EscalateSource>("brief");
  // Kartu sudah membawa prioritas; memaksa operator memilih ulang dari nol adalah pertanyaan yang
  // jawabannya sudah ada di layar. `Task.priority` kolom TEXT yang menyeberang sync dari mesin
  // yang boleh lebih baru (ADR-0087), jadi nilai di luar kosakata jatuh ke "sedang".
  const [priority, setPriority] = React.useState<string>(
    () => (PRIO_OPTS.some((o) => o.value === task.priority) ? task.priority : "sedang"));
  const [projectId, setProjectId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // `nextSpecId` mengambil lantai nomornya dari repo project, dan `Task.projectId` boleh null
  // (ADR-0150 keputusan 3). Gerbangnya di SINI supaya operator tak menabrak 400 server — tapi
  // sebabnya tetap TERTULIS, bukan tombol mati tanpa penjelasan (kelas bug SPEC-546).
  const needsProject = task.projectId === null;
  const target = task.projectId ?? projectId;

  async function submit() {
    if (!target || busy) return;
    setBusy(true);
    try {
      const r = await api.escalateTask(task.id, {
        source, priority: priority as Priority,
        ...(task.projectId ? {} : { projectId }),
      });
      onToast(r.created ? `Dieskalasi jadi ${r.spec.id}` : `Sudah tertaut ke ${r.spec.id}`, "ok", "link");
      onDone(r.task);
      onClose();
    } catch {
      // Dialog TETAP terbuka: isian operator tak boleh hilang gara-gara jaringan.
      onToast("Gagal mengeskalasi kartu", "err", "x-circle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} icon="git-branch"
      eyebrow="Papan tim" title="Eskalasi ke backlog"
      footer={
        <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={submit} loading={busy} disabled={!target} leftIcon="git-branch">
            Eskalasi
          </Button>
        </div>}>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55, marginBottom: 14 }}>
        Kartu <strong>{task.title}</strong> tetap di papan. Yang lahir adalah backlog item baru
        yang bisa dikerjakan sesi agen, dan kartu ini menampilkan stage-nya.
      </div>

      {needsProject && (
        <Field label="Project">
          <Select aria-label="Project" value={projectId} style={{ width: "100%" }}
            onChange={(e) => setProjectId(e.target.value)}
            options={[{ value: "", label: "Pilih project…" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
            Nomor SPEC diambil dari repo project, jadi kartu tanpa project belum bisa dieskalasi.
          </div>
        </Field>
      )}

      <Field label="Source">
        <Select aria-label="Source" value={source} style={{ width: "100%" }}
          onChange={(e) => setSource(e.target.value as EscalateSource)} options={SOURCE_OPTS} />
      </Field>

      <Field label="Prioritas">
        <Select aria-label="Prioritas" value={priority} style={{ width: "100%" }}
          onChange={(e) => setPriority(e.target.value)} options={PRIO_OPTS} />
      </Field>
    </Modal>
  );
}
