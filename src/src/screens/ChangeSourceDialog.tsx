import React from "react";
import { Modal, Button, Select, Field, HnTextarea, Badge } from "../ds";
import { convertPayload, flowForSource, payloadShapeFor, shapeOfPayload } from "@hanoman/shared";
import { SOURCE_OPTS, SHAPE_FIELDS, PRIO_OPTS, SEV_OPTS, sourceMeta } from "./source-meta";
import type { SourceResetPending } from "../api/client";
import type { Spec } from "./types";

// SPEC-546 · ADR-0109 · dialog "Ubah type". Prefill form-nya memakai `convertPayload` — fungsi
// MURNI yang sama yang dipakai server saat `payload` tak dikirim, jadi apa yang dilihat operator
// di sini persis apa yang akan tersimpan.
//
// ADR-0149 · daftar tujuan TIDAK lagi disaring flow. Saringan itulah yang membuat item
// qa/audit/goal/no_effort yang sudah dimulai kehabisan opsi — masing-masing sendirian di flow-nya
// — dan dialog menjawab daftar kosong dengan `return null`: tombol terklik, tak ada modal, tak ada
// pesan. Sekarang perpindahan lintas-alur ditawarkan berikut harganya: item kembali ke
// Brainstorming dan jejak sesi lamanya dibuang, di belakang konfirmasi yang menyebut daftarnya.
export function ChangeSourceDialog({ spec, onClose, onSubmit }: {
  spec: Spec;
  onClose: () => void;
  /** `payload` undefined = perpindahan SE-ALUR pada item berjalan (isi tak ikut pindah). */
  onSubmit: (source: string, payload?: Record<string, string>, confirmReset?: boolean)
    => Promise<SourceResetPending | null>;
}) {
  const started = spec.stage !== "brainstorming" || spec.baseSha != null;
  const options = SOURCE_OPTS.filter((o) => o.value !== spec.source);
  const [target, setTarget] = React.useState(options[0]?.value ?? "");
  // Cermin `checkSourceChange` server: hanya perpindahan LINTAS-ALUR pada item berjalan yang
  // mereset. `brief ↔ help` tetap in-place seperti sebelum ADR-0149.
  const resetNeeded = started && flowForSource(target) !== flowForSource(spec.source);
  // Se-alur pada item berjalan: isinya memang tak berpindah — server menolak payload di jalur itu.
  const sameFlowStarted = started && !resetNeeded;
  const conv = React.useMemo(() => convertPayload(target, spec.payload), [target, spec.payload]);
  const [form, setForm] = React.useState<Record<string, string>>(
    () => conv.payload as Record<string, string>);
  const [pending, setPending] = React.useState<SourceResetPending | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Ganti target ⇒ form dirakit ulang dari peta konversi (ketikan untuk target LAMA memang dibuang:
  // field-nya belum tentu ada di bentuk baru), dan rencana reset lama gugur — ia dihitung server
  // untuk target yang sudah tidak dipilih lagi.
  React.useEffect(() => { setForm(conv.payload as Record<string, string>); setPending(null); }, [target]);
  const setField = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));
  const shape = payloadShapeFor(target);
  const fields = SHAPE_FIELDS[shape] ?? [];
  // Label field yang hilang datang dari bentuk LAMA, bukan bentuk tujuan.
  const labelOf = (key: string) =>
    (SHAPE_FIELDS[shapeOfPayload(spec.payload)] ?? []).find(([k]) => k === key)?.[1] ?? key;

  async function submit(confirmReset?: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await onSubmit(target, sameFlowStarted ? undefined : { ...form }, confirmReset);
      // `pending` = server minta konfirmasi; dialog TETAP terbuka dan berganti jadi daftar.
      if (res && res.pending) setPending(res);
      else onClose();
    } finally {
      setBusy(false);
    }
  }

  if (pending) return (
    <Modal open title="Item ini akan dikembalikan ke Brainstorming" icon="rotate-ccw"
      eyebrow={`${spec.id} · ${sourceMeta(spec.source).label} → ${sourceMeta(target).label}`}
      onClose={busy ? undefined : onClose}>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55, marginBottom: 12 }}>
        Alur kerja {sourceMeta(target).label} berbeda dari yang sudah dikerjakan, jadi item ini
        mulai lagi dari awal. Kode yang sudah ter-commit di branch lain tak disentuh.
      </div>
      <ul data-testid="source-reset-impact" style={{
        fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)",
        marginBottom: 16, paddingLeft: 18, lineHeight: 1.6,
      }}>
        {pending.wouldDelete.map((f) => <li key={f}>{f}</li>)}
        {pending.worktree && <li>{pending.worktree}</li>}
        {pending.branch && <li>{pending.branch}</li>}
        {!pending.wouldDelete.length && !pending.worktree && !pending.branch && (
          <li>tak ada berkas yang perlu dibuang — hanya tahapnya yang mundur</li>
        )}
      </ul>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
        <Button size="sm" variant="danger" leftIcon="rotate-ccw" loading={busy}
          onClick={() => submit(true)}>Reset &amp; ubah type</Button>
      </div>
    </Modal>
  );

  return (
    <Modal open title="Ubah type backlog item" icon="shuffle"
      eyebrow={`${spec.id} · ${sourceMeta(spec.source).label}`} onClose={onClose}>
      <Field label="Type tujuan">
        <Select aria-label="Type tujuan" value={target} onChange={(e) => setTarget(e.target.value)}
          options={options} style={{ width: "100%" }} />
      </Field>
      {!options.length && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Tak ada type lain yang bisa dituju. Dialog tetap terbuka dan mengatakannya — menolak
          dengan diam adalah bug yang melahirkan ADR-0149.
        </div>
      )}
      {sameFlowStarted ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Item ini sudah pernah dikerjakan sesi, dan type tujuannya memakai alur kerja yang sama —
          yang berpindah hanya <strong>labelnya</strong>. Isi, worktree, dan berkas fase tak disentuh.
        </div>
      ) : (
        <>
          {resetNeeded && (
            <div data-testid="source-reset-warning" style={{
              fontSize: 12.5, color: "var(--text-strong)", lineHeight: 1.5, marginBottom: 12,
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 10,
            }}>
              <Badge tone="warn" size="sm">alur kerja berbeda</Badge>{" "}
              Item ini akan kembali ke tahap <strong>Brainstorming</strong>; dokumen fase, worktree,
              dan branch sesi lamanya dihapus. Daftar persisnya ditampilkan sebelum kamu menyetujui.
            </div>
          )}
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
        <Button size="sm" variant="primary" leftIcon="shuffle" loading={busy}
          disabled={!options.length} onClick={() => submit()}>Ubah type</Button>
      </div>
    </Modal>
  );
}
