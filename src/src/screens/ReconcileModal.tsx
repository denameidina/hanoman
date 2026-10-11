/* ReconcileModal — SPEC-270 · ADR-0067. Daftar konflik sync dua-sisi; tiap kartu menampilkan HANYA
   field yang berbeda antara sisi Lokal dan Server (dua kolom di desktop, bertumpuk di mobile).
   Sisi `updatedAt` terbaru jadi default; user memilih "Pakai Lokal / Pakai Server".
   Audit 2026-10: gagal memuat = galat + Coba lagi (bukan "Semua sinkron"); keputusan lewat
   konfirmasi yang merinci field yang berubah; modal tak bisa ditutup selama keputusan dikirim.
   Fase 3 (3L): istilah "hub" diganti "server pusat" (keputusan istilah di glosarium). */
import React from "react";
import { Modal, Button, StateBlock, useConfirm } from "../ds";
import { api } from "../api/client";
import type { SyncConflictView } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";
import { relativeTime } from "../lib/time-format";
import "./styles/review.css";

function newerSide(c: SyncConflictView): "local" | "server" {
  return new Date(c.localUpdatedAt) >= new Date(c.serverUpdatedAt) ? "local" : "server";
}
function short(v: unknown): string {
  if (v === undefined) return "(kosong)";
  const s = typeof v === "string" ? `"${v}"` : (JSON.stringify(v) ?? String(v));
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}
// Field yang nilainya berbeda antara kedua sisi — inilah yang sebenarnya berubah bila memilih sisi lain.
function differingFields(c: SyncConflictView): string[] {
  const l = (c.localData ?? {}) as Record<string, unknown>;
  const r = (c.serverData ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(l), ...Object.keys(r)])];
  return keys.filter((k) => JSON.stringify(l[k]) !== JSON.stringify(r[k]));
}

// Nama jenis data yang tampil. Kode internal (camelCase) tak pernah dibaca operator; jenis yang
// belum dikenal jatuh ke "Data", bukan ke kode mentahnya.
const ENTITY_LABEL: Record<string, string> = {
  project: "Project", spec: "Item backlog", vps: "VPS", sessionResult: "Hasil sesi",
  ticket: "Tiket", ticketAttachment: "Lampiran tiket", customAgent: "Agen kustom",
  githubIssue: "Issue GitHub", member: "Anggota tim", task: "Tugas", qaReport: "Laporan QA",
  qaCase: "Kasus QA", qaFinding: "Temuan QA", qaAttachment: "Lampiran QA",
};
const entityLabel = (e: string): string => ENTITY_LABEL[e] ?? "Data";

// Kode alasan dari server pusat → kalimat. Kode mentah tak pernah ditampilkan ke operator.
const REASON: Record<string, string> = {
  "still-conflict": "Server pusat bergeser lagi sebelum keputusan ini masuk. Coba lagi — datanya sudah disegarkan.",
  "not-found": "Konflik ini sudah tidak ada di server pusat (mungkin sudah diselesaikan dari perangkat lain).",
};
const REJECTED = "Server pusat menolak keputusan ini. Muat ulang daftar, lalu coba lagi.";

export function ReconcileModal({ open, onClose, onResolved }:
  { open: boolean; onClose: () => void; onResolved: () => void }) {
  const [items, setItems] = React.useState<SyncConflictView[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const now = Date.now();

  // Gagal memuat ≠ tak ada konflik: galatnya ditampilkan dengan Coba lagi, daftar lama dibuang.
  const load = React.useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      setItems((await api.listConflicts()).conflicts);
    } catch (e) {
      setItems([]);
      setLoadError(failureMessage("memuat daftar konflik", e));
    } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { if (open) void load(); }, [open, load]);

  // Route membalas HTTP 200 ber-`{ ok: false, reason }` saat server pusat menolak — jadi "berhasil"
  // di tingkat HTTP tapi keputusannya tidak terjadi. Pesannya wajib tampil, bukan dibuang.
  async function apply(c: SyncConflictView, choice: "local" | "server") {
    const id = `${c.entity}:${c.recordId}`;
    setBusy(id); setError(null);
    try {
      const r = await api.resolveConflict(c.entity, c.recordId, choice);
      if (!r.ok) setError(REASON[r.reason ?? ""] ?? REJECTED);
      await load();
      if (r.ok) onResolved();
    } catch (e) {
      setError(failureMessage("menghubungi server", e));
    } finally { setBusy(null); }
  }

  // Konfirmasi memakai `run`: dialog tetap terbuka & sibuk selama keputusan dikirim. Galat dari
  // `apply` sudah ditampilkan di sana; `catch` ini hanya jaga-jaga bila konfirmasi sendiri gagal.
  function askResolve(c: SyncConflictView, choice: "local" | "server") {
    const label = choice === "local" ? "Lokal" : "Server";
    const otherLabel = choice === "local" ? "Server" : "Lokal";
    const chosen = ((choice === "local" ? c.localData : c.serverData) ?? {}) as Record<string, unknown>;
    const over = ((choice === "local" ? c.serverData : c.localData) ?? {}) as Record<string, unknown>;
    const fields = differingFields(c);
    // Tiap field yang berbeda: nilai yang akan tertimpa → nilai dari sisi yang dipilih.
    const impact = fields.length === 0
      ? ["Tidak ada field yang berbeda antara kedua sisi."]
      : fields.map((k) => `${k}: ${short(over[k])} → ${short(chosen[k])}`);
    confirm({
      title: `Pakai data ${label}?`,
      message: `Sisi ${otherLabel} di server pusat akan diganti dengan data ${label} untuk ${entityLabel(c.entity).toLowerCase()} ${c.recordId}.`,
      impact,
      eyebrow: "konflik sinkron",
      confirmLabel: `Pakai data ${label}`,
      tone: "danger",
      run: () => apply(c, choice),
    }).catch((e) => setError(failureMessage("menyelesaikan konflik", e)));
  }

  const showEmpty = !loading && !loadError && items.length === 0;

  return (
    <>
      <Modal open={open} title="Konflik sinkron" eyebrow="sinkronisasi" icon="git-merge" width={720}
        onClose={() => { if (busy === null) onClose(); }}>
        {error && (
          <div data-testid="resolve-error" role="alert" className="hn-reconcile-error">{error}</div>
        )}
        {loading && items.length === 0 && <StateBlock kind="loading" compact title="Memuat konflik…" />}
        {loadError && (
          <StateBlock kind="error" compact title="Daftar konflik gagal dimuat" hint={loadError}
            action={() => { void load(); }} actionLabel="Coba lagi" />
        )}
        {showEmpty && (
          <StateBlock kind="empty" compact icon="git-merge" title="Tidak ada konflik"
            hint="Data lokal dan server sudah sinkron." />
        )}
        {items.map((c) => {
          const dflt = newerSide(c);
          const id = `${c.entity}:${c.recordId}`;
          const fields = differingFields(c);
          const lokal = (c.localData ?? {}) as Record<string, unknown>;
          const server = (c.serverData ?? {}) as Record<string, unknown>;
          return (
            <section key={id} className="hn-reconcile-card" aria-label={`${entityLabel(c.entity)} ${c.recordId}`}>
              <div className="hn-reconcile-head">
                <strong>{entityLabel(c.entity)}</strong>
                <span className="hn-reconcile-id">{c.recordId}</span>
                <span data-testid="default-side" className="hn-reconcile-hint">
                  disarankan: {dflt === "local" ? "Lokal" : "Server"} (diubah terakhir)
                </span>
              </div>
              <div className="hn-reconcile-meta">
                <span>Lokal v{c.localVersion} · {relativeTime(c.localUpdatedAt, now) || "—"}</span>
                <span>Server v{c.serverVersion} · {relativeTime(c.serverUpdatedAt, now) || "—"}</span>
              </div>
              {fields.length === 0 ? (
                <p className="hn-reconcile-same">Kedua sisi berisi data yang sama.</p>
              ) : (
                <dl className="hn-reconcile-fields" aria-label="Field yang berbeda">
                  <div className="hn-reconcile-field hn-reconcile-field-head" aria-hidden="true">
                    <dt>Field</dt><dd>Lokal</dd><dd>Server</dd>
                  </div>
                  {fields.map((k) => (
                    <div key={k} className="hn-reconcile-field">
                      <dt>{k}</dt>
                      <dd><span className="hn-reconcile-side">Lokal</span><code>{short(lokal[k])}</code></dd>
                      <dd><span className="hn-reconcile-side">Server</span><code>{short(server[k])}</code></dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="hn-reconcile-actions">
                <Button size="sm" variant={dflt === "local" ? "primary" : "secondary"} disabled={busy !== null}
                  loading={busy === id} onClick={() => askResolve(c, "local")}>Pakai Lokal</Button>
                <Button size="sm" variant={dflt === "server" ? "primary" : "secondary"} disabled={busy !== null}
                  onClick={() => askResolve(c, "server")}>Pakai Server</Button>
              </div>
            </section>
          );
        })}
      </Modal>
      {dialog}
    </>
  );
}
