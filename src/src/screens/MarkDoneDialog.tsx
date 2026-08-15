import React from "react";
import { Button, Field, HnTextarea, Modal } from "../ds";
import type { Spec } from "./types";

export type MarkDoneResult = { needConfirm: true; sessionId?: string } | Spec | undefined;

const REASON_MAX = 280;

// SPEC-804 · ADR-0120 · satu dialog untuk kedua permukaan (baris daftar & detail item). Dua
// langkahnya hidup DI DALAM komponen ini: menyalinnya ke tiap call site berarti dua kalimat
// konfirmasi yang bisa berselisih. Peringatan sesi hidup datang dari respons server
// (`needConfirm`), bukan dari daftar sesi klien yang bisa basi.
export function MarkDoneDialog({ spec, onClose, onSubmit }: {
  spec: Spec;
  onClose: () => void;
  onSubmit: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
}) {
  const [reason, setReason] = React.useState("");
  const [live, setLive] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await onSubmit(spec, reason.trim(), live !== null);
      if (res && "needConfirm" in res) { setLive(res.sessionId ?? ""); return; }
      if (res) onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open title="Tandai selesai" icon="circle-check" eyebrow={spec.id + " · " + spec.projectId}
      onClose={busy ? undefined : onClose}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 14 }}>
        Item keluar dari daftar siap-kerja dan berstatus selesai — sama seperti item yang selesai
        lewat sesi. Kode, commit, dan dokumen tidak disentuh, dan status ini masih bisa dikembalikan
        lewat “Ubah status”.
      </div>
      {live !== null && (
        <div data-testid="mark-done-live" style={{
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
          background: "var(--bone-100)", padding: 10, marginBottom: 14,
          fontSize: 12.5, color: "var(--text-strong)", lineHeight: 1.5,
        }}>
          Masih ada sesi yang berjalan untuk item ini{live ? ` (${live})` : ""}. Menandainya selesai
          tidak menghentikan sesi itu — tutup sesinya dari Terminal bila memang sudah tak dibutuhkan.
        </div>
      )}
      <Field label="Alasan singkat (opsional)"
        hint={`${reason.trim().length}/${REASON_MAX} — mis. “sudah ter-merge lewat PR #12”`}>
        <HnTextarea aria-label="Alasan singkat (opsional)" rows={2} value={reason}
          maxLength={REASON_MAX} disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="sudah dikerjakan langsung di checkout" />
      </Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="circle-check" loading={busy} onClick={submit}>
          {live !== null ? "Tandai selesai — sesi tetap berjalan" : "Tandai selesai"}
        </Button>
      </div>
    </Modal>
  );
}
