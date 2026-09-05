import React from "react";
import { zLaunchRejection, type LaunchRejection } from "@hanoman/shared";
import { ApiError } from "../api/client";
import { Button, Modal } from "../ds";

type PendingLaunch = {
  title: string;
  rejection: LaunchRejection;
  retry: (force?: true) => Promise<void>;
};

/** Human launch actions retain their original arguments in retry. Automation never uses this hook. */
export function useLaunchAdmission() {
  const [pending, setPending] = React.useState<PendingLaunch | null>(null);
  const [busy, setBusy] = React.useState(false);

  function offerRetry(error: unknown, title: string, retry: PendingLaunch["retry"]): boolean {
    const parsed = error instanceof ApiError && error.status === 409
      ? zLaunchRejection.safeParse(error.detail) : null;
    if (!parsed?.success) return false;
    setPending({ title, rejection: parsed.data, retry });
    return true;
  }

  async function retry(force?: true) {
    if (!pending || busy) return;
    const request = pending;
    setPending(null);
    setBusy(true);
    try { await request.retry(force); }
    finally { setBusy(false); }
  }

  const status = pending?.rejection.admission;
  const dialog = pending && status && <Modal open onClose={() => setPending(null)} icon="play"
    eyebrow={pending.title} title="Peluncuran ditolak"
    footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>Batal</Button>
      <Button disabled={busy} onClick={() => void retry()}>Coba lagi</Button>
      <Button variant="danger" leftIcon="lock" disabled={busy} onClick={() => void retry(true)}>Mulai tetap</Button>
    </>}>
    <div role="alert" style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-strong)" }}>
      <b>{pending.rejection.error}</b>
      <div>{status.liveCount} sesi hidup · {status.liveAgentCount} agen terstruktur · cap {status.maxConcurrent}</div>
      <div>Load per core: {status.loadStatus === "available" && status.loadPerCore !== null
        ? status.loadPerCore.toFixed(2) : "tidak tersedia"}
        {status.loadStatus === "unsupported" ? " (tidak didukung platform)" : ""} · ambang {status.maxLoadPerCore}</div>
      <p>Mulai tetap melewati cap sesi dan pemeriksaan beban host, serta dependency bila ada.
        Pilihan sesi dan konteks pekerjaan tetap sama.</p>
    </div>
  </Modal>;
  return { offerRetry, dialog };
}
