/* ReconcileModal — SPEC-270 · ADR-0067. Daftar konflik sync dua-sisi; tiap kartu side-by-side
   (Lokal | Server), sisi updatedAt terbaru jadi default; user pilih "Pakai Lokal / Pakai Server". */
import React from "react";
import { Modal, Button } from "../ds";
import { api } from "../api/client";
import type { SyncConflictView } from "@hanoman/shared";

function newerSide(c: SyncConflictView): "local" | "server" {
  return new Date(c.localUpdatedAt) >= new Date(c.serverUpdatedAt) ? "local" : "server";
}
function fmt(v: unknown): string { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }

export function ReconcileModal({ open, onClose, onResolved }:
  { open: boolean; onClose: () => void; onResolved: () => void }) {
  const [items, setItems] = React.useState<SyncConflictView[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try { setItems((await api.listConflicts()).conflicts); } catch { setItems([]); }
  }, []);
  React.useEffect(() => { if (open) void load(); }, [open, load]);

  // Route membalas HTTP 200 ber-`{ ok: false, reason }` saat hub menolak — jadi "berhasil" di
  // tingkat HTTP tapi keputusannya tidak terjadi. Membuang hasil itu (perilaku lama) membuat
  // tombolnya tampak mati: operator mengklik, tak ada yang berubah, tak ada pesan apa pun.
  const REASON: Record<string, string> = {
    "still-conflict": "Hub bergeser lagi sebelum keputusan ini masuk. Coba lagi — datanya sudah disegarkan.",
    "not-found": "Konflik ini sudah tak ada di hub (mungkin sudah diselesaikan dari mesin lain).",
  };

  async function resolve(c: SyncConflictView, choice: "local" | "server") {
    const id = `${c.entity}:${c.recordId}`;
    setBusy(id); setError(null);
    try {
      const r = await api.resolveConflict(c.entity, c.recordId, choice);
      if (!r.ok) { setError(REASON[r.reason ?? ""] ?? `Gagal menyimpan keputusan (${r.reason ?? "tak diketahui"}).`); }
      await load();
      if (r.ok) onResolved();
    } catch (e) {
      setError(`Gagal menghubungi server: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  return (
    <Modal open={open} title="Rekonsil konflik sync" eyebrow="SPEC-270" icon="git-merge" width={720} onClose={onClose}>
      {error && (
        <div data-testid="resolve-error" role="alert" style={{
          fontSize: 12.5, color: "var(--danger, #b23b3b)", border: "1px solid var(--danger, #b23b3b)",
          borderRadius: 6, padding: "8px 10px", marginBottom: 12,
        }}>{error}</div>
      )}
      {items.length === 0 && <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>Tak ada konflik. Semua sinkron.</div>}
      {items.map((c) => {
        const dflt = newerSide(c);
        const id = `${c.entity}:${c.recordId}`;
        return (
          <div key={id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              {c.entity} · {c.recordId} · <span data-testid="default-side">default: {dflt === "local" ? "Lokal" : "Server"} (updatedAt terbaru)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <SideView label="Lokal" data={c.localData} at={c.localUpdatedAt} ver={c.localVersion} active={dflt === "local"} />
              <SideView label="Server" data={c.serverData} at={c.serverUpdatedAt} ver={c.serverVersion} active={dflt === "server"} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <Button size="sm" variant={dflt === "local" ? "primary" : "secondary"} disabled={busy === id}
                onClick={() => resolve(c, "local")}>Pakai Lokal</Button>
              <Button size="sm" variant={dflt === "server" ? "primary" : "secondary"} disabled={busy === id}
                onClick={() => resolve(c, "server")}>Pakai Server</Button>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function SideView({ label, data, at, ver, active }:
  { label: string; data: unknown; at: string; ver: number; active: boolean }) {
  return (
    <div style={{ border: active ? "1px solid var(--brass)" : "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label} · v{ver}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{new Date(at).toLocaleString()}</div>
      <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: 0, maxHeight: 200, overflow: "auto" }}>{fmt(data)}</pre>
    </div>
  );
}
