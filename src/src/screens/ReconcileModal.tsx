/* ReconcileModal — SPEC-270 · ADR-0067. Daftar konflik sync dua-sisi; tiap kartu side-by-side
   (Lokal | Server), sisi updatedAt terbaru jadi default; user pilih "Pakai Lokal / Pakai Server".
   Audit 2026-10: gagal memuat = galat + Coba lagi (bukan "Semua sinkron"); keputusan lewat
   konfirmasi yang merinci field yang berubah; modal tak bisa ditutup selama keputusan dikirim. */
import React from "react";
import { Modal, Button, StateBlock, useConfirm } from "../ds";
import { api } from "../api/client";
import type { SyncConflictView } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";

function newerSide(c: SyncConflictView): "local" | "server" {
  return new Date(c.localUpdatedAt) >= new Date(c.serverUpdatedAt) ? "local" : "server";
}
function fmt(v: unknown): string { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
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

// Kode alasan dari hub → kalimat. Kode mentah tak pernah ditampilkan ke operator.
const REASON: Record<string, string> = {
  "still-conflict": "Hub bergeser lagi sebelum keputusan ini masuk. Coba lagi — datanya sudah disegarkan.",
  "not-found": "Konflik ini sudah tak ada di hub (mungkin sudah diselesaikan dari mesin lain).",
};
const REJECTED = "Hub menolak keputusan ini. Muat ulang daftar lalu coba lagi.";

export function ReconcileModal({ open, onClose, onResolved }:
  { open: boolean; onClose: () => void; onResolved: () => void }) {
  const [items, setItems] = React.useState<SyncConflictView[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

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

  // Route membalas HTTP 200 ber-`{ ok: false, reason }` saat hub menolak — jadi "berhasil" di
  // tingkat HTTP tapi keputusannya tidak terjadi. Pesannya wajib tampil, bukan dibuang.
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

  // Konfirmasi memakai `run`: dialog tetap terbuka & sibuk selama keputusan dikirim, lalu
  // galatnya sudah ditangani di `apply` — jadi `run` tak pernah melempar.
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
    void confirm({
      title: `Pakai data ${label}?`,
      message: `Sisi ${otherLabel} di hub akan diganti dengan data ${label} untuk ${c.entity} ${c.recordId}.`,
      impact,
      eyebrow: "rekonsil konflik",
      confirmLabel: `Pakai data ${label}`,
      tone: "danger",
      run: () => apply(c, choice),
    }).catch(() => { /* galat sudah ditampilkan di `apply` */ });
  }

  const showEmpty = !loading && !loadError && items.length === 0;

  return (
    <>
      <Modal open={open} title="Rekonsil konflik sync" eyebrow="SPEC-270" icon="git-merge" width={720}
        onClose={() => { if (busy === null) onClose(); }}>
        {error && (
          <div data-testid="resolve-error" role="alert" style={{
            fontSize: 12.5, color: "var(--clay-600)", background: "var(--status-err-tint)",
            border: "1px solid var(--clay-500)", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 12,
          }}>{error}</div>
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
          return (
            <div key={id} style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)", padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                {c.entity} · {c.recordId} · <span data-testid="default-side">disarankan: {dflt === "local" ? "Lokal" : "Server"} (diubah terakhir)</span>
              </div>
              <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <SideView label="Lokal" data={c.localData} at={c.localUpdatedAt} ver={c.localVersion} active={dflt === "local"} />
                <SideView label="Server" data={c.serverData} at={c.serverUpdatedAt} ver={c.serverVersion} active={dflt === "server"} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <Button size="sm" variant={dflt === "local" ? "primary" : "secondary"} disabled={busy !== null}
                  loading={busy === id} onClick={() => askResolve(c, "local")}>Pakai Lokal</Button>
                <Button size="sm" variant={dflt === "server" ? "primary" : "secondary"} disabled={busy !== null}
                  onClick={() => askResolve(c, "server")}>Pakai Server</Button>
              </div>
            </div>
          );
        })}
      </Modal>
      {dialog}
    </>
  );
}

function SideView({ label, data, at, ver, active }:
  { label: string; data: unknown; at: string; ver: number; active: boolean }) {
  return (
    <div style={{ border: active ? "1px solid var(--brass-500)" : "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 8, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label} · v{ver}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{new Date(at).toLocaleString()}</div>
      <pre tabIndex={0} aria-label={`Isi sisi ${label}`}
        style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: 0, maxHeight: 200, overflow: "auto" }}>{fmt(data)}</pre>
    </div>
  );
}
