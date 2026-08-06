import React from "react";
import { Modal, Button, Select, Field, HnTextarea, Badge } from "../ds";
import { convertPayload, flowForSource, payloadShapeFor, shapeOfPayload } from "@hanoman/shared";
import { SOURCE_OPTS, SHAPE_FIELDS, PRIO_OPTS, SEV_OPTS, sourceMeta } from "./source-meta";
import type { Spec } from "./types";

// SPEC-546 · ADR-0109 · dialog "Ubah type". Prefill form-nya memakai `convertPayload` — fungsi
// MURNI yang sama yang dipakai server saat `payload` tak dikirim, jadi apa yang dilihat operator
// di sini persis apa yang akan tersimpan.
export function ChangeSourceDialog({ spec, onClose, onSubmit }: {
  spec: Spec;
  onClose: () => void;
  /** `payload` undefined = item sudah dimulai (server memakai payload lama apa adanya). */
  onSubmit: (source: string, payload?: Record<string, string>) => void;
}) {
  // Cermin gerbang server (`checkSourceChange`): sudah dimulai ⇒ hanya source SE-FLOW, dan
  // isinya tak ikut berpindah. Dicerminkan di sini supaya operator tak menemui 409 di ujung.
  const started = spec.stage !== "brainstorming" || spec.baseSha != null;
  const options = SOURCE_OPTS.filter((o) => o.value !== spec.source
    && (!started || flowForSource(o.value) === flowForSource(spec.source)));
  const [target, setTarget] = React.useState(options[0]?.value ?? "");
  const conv = React.useMemo(() => convertPayload(target, spec.payload), [target, spec.payload]);
  const [form, setForm] = React.useState<Record<string, string>>(
    () => conv.payload as Record<string, string>);
  // Ganti target ⇒ form dirakit ulang dari peta konversi. Ketikan operator untuk target LAMA
  // memang dibuang: field-nya belum tentu ada di bentuk yang baru.
  React.useEffect(() => { setForm(conv.payload as Record<string, string>); }, [target]);
  const setField = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));
  const shape = payloadShapeFor(target);
  const fields = SHAPE_FIELDS[shape] ?? [];
  // Label field yang hilang datang dari bentuk LAMA, bukan bentuk tujuan.
  const labelOf = (key: string) =>
    (SHAPE_FIELDS[shapeOfPayload(spec.payload)] ?? []).find(([k]) => k === key)?.[1] ?? key;

  // Tak ada tujuan yang sah (mis. item `goal` yang sudah dimulai): tak ada yang bisa ditawarkan.
  if (!options.length) return null;
  return (
    <Modal open title="Ubah type backlog item" icon="shuffle"
      eyebrow={`${spec.id} · ${sourceMeta(spec.source).label}`} onClose={onClose}>
      <Field label="Type tujuan">
        <Select aria-label="Type tujuan" value={target} onChange={(e) => setTarget(e.target.value)}
          options={options} style={{ width: "100%" }} />
      </Field>
      {started ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Item ini sudah pernah dikerjakan sesi. Yang berpindah hanya <strong>labelnya</strong> —
          isi, worktree, dan berkas fase tak disentuh, dan hanya type dengan alur kerja yang sama
          yang ditawarkan.
        </div>
      ) : (
        <>
          {conv.dropped.length > 0 && (
            <div data-testid="source-dropped" style={{
              fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12,
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 10,
            }}>
              <Badge tone="warn" size="sm">tak punya padanan</Badge>{" "}
              {conv.dropped.map(labelOf).join(", ")} tidak ada di bentuk{" "}
              {sourceMeta(target).label}. Teks lamanya tetap tersimpan di{" "}
              <strong>jejak konversi</strong> item ini.
            </div>
          )}
          {shape !== "qa" && (
            <Field label="Prioritas">
              <Select aria-label="Prioritas" value={form.priority ?? "sedang"}
                onChange={setField("priority")} options={PRIO_OPTS} style={{ width: "100%" }} />
            </Field>
          )}
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select aria-label={label} value={form[k] ?? "minor"} onChange={setField(k)}
                    options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea aria-label={label} value={form[k] ?? ""} onChange={setField(k)}
                    rows={2} placeholder={ph} />}
            </Field>
          ))}
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={onClose}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="shuffle"
          onClick={() => onSubmit(target, started ? undefined : { ...form })}>Ubah type</Button>
      </div>
    </Modal>
  );
}
