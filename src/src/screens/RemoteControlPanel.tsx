import React from "react";
import type { RelayLinkState, RemoteCapability, RemoteControlView } from "@hanoman/shared";
import { Badge, Card, StateBlock, Switch, type ShowToast } from "../ds";
import { api } from "../api/client";

// SPEC-1215 · ADR-0165 §4 · K7 transparansi: operator mesin INI menentukan apa yang boleh dilakukan hub
// dan membaca audit apa yang sudah dilakukannya. Berkas sendiri (pola ClientAccessPanel): SettingsScreen
// sudah ~80 KB. Toggle lajur log sengaja BELUM ada — pengirimannya lahir di SPEC-1217 (keputusan Plan P6).

const VIEW: RemoteCapability[] = ["sessions:read", "backlog:read", "ide:read"];
const EXTRA: { cap: RemoteCapability; label: string; desc: string }[] = [
  { cap: "sessions:write", label: "Tulis terminal", desc: "Ketik ke terminal, steer, interrupt, jawab & ambil alih dialog." },
  { cap: "sessions:spawn", label: "Mulai sesi", desc: "Membuka sesi agen BARU di mesin ini atas perintah hub — eksekusi agen di mesin ini. Hub tak bisa memaksa melewati gerbang beban." },
  { cap: "backlog:write", label: "Tandai selesai", desc: "Hanya menandai backlog selesai; suntingan backlog lain tetap tertutup untuk hub." },
];
const RELAY_LABEL: Record<RelayLinkState, string> = {
  off: "mati", connecting: "menyambung", open: "tersambung", backoff: "mencoba lagi",
  unsupported: "hub tak mendukung", rejected: "ditolak hub",
};
const RELAY_TONE: Record<RelayLinkState, "ok" | "warn" | "neutral"> = {
  off: "neutral", connecting: "neutral", open: "ok", backoff: "warn", unsupported: "warn", rejected: "warn",
};

function Row({ title, desc, children, last }: { title: string; desc: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="hn-setting-row" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--border-hair)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div className="hn-setting-control" style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

export function RemoteControlPanel({ onToast }: { onToast?: ShowToast }) {
  const [view, setView] = React.useState<RemoteControlView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { api.getRemoteControl().then(setView).catch(() => setFailed(true)); }, []);

  if (!view) {
    return (
      <Card eyebrow="kendali" title="Kendali jarak jauh dari hub">
        {failed
          ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Gagal memuat grant kendali jarak jauh.</div>
          : <StateBlock kind="loading" compact title="Memuat grant…" />}
      </Card>
    );
  }

  const { enabled, capabilities } = view.control;
  const has = (c: RemoteCapability) => capabilities.includes(c);
  const union = (...lists: RemoteCapability[][]): RemoteCapability[] => [...new Set(lists.flat())];
  const save = async (nextEnabled: boolean, next: RemoteCapability[]) => {
    setBusy(true);
    try {
      setView(await api.putRemoteControl({ control: { enabled: nextEnabled, capabilities: next } }));
      onToast?.(nextEnabled ? "Grant kendali jarak jauh disimpan" : "Kendali jarak jauh dimatikan", "ok", "check");
    } catch {
      onToast?.("Gagal menyimpan grant kendali jarak jauh", "err", "x-circle");
    } finally { setBusy(false); }
  };
  // Server menolak grant tulis tanpa `sessions:read` — UI menjaga invarian yang sama, tak mengandalkan 400.
  const toggleMaster = (on: boolean) => save(on, on && capabilities.length === 0 ? VIEW : capabilities);
  const toggleView = (on: boolean) => save(enabled, on ? union(capabilities, VIEW) : []);
  const toggleExtra = (cap: RemoteCapability, on: boolean) =>
    save(enabled, on ? union(capabilities, VIEW, [cap]) : capabilities.filter((c) => c !== cap));

  return (
    <>
      <Card eyebrow="kendali" title="Kendali jarak jauh dari hub">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Mengizinkan operator <b>hub</b> tempat mesin ini tersinkron bertindak di mesin ini lewat route yang
          sama dengan dashboard lokal. Default mati dan hanya bisa dinyalakan dari mesin ini — hub tak bisa
          menyalakannya sendiri.
        </div>
        <Row title="Izinkan kendali jarak jauh" desc="Membuka socket relay ke hub. Mati = tak ada jalur perintah dari hub sama sekali.">
          <Switch checked={enabled} disabled={busy} onChange={(on: boolean) => void toggleMaster(on)} aria-label="Izinkan kendali jarak jauh" />
        </Row>
        <Row title="Lihat" desc="Daftar sesi, fase, dialog, dokumen & review sesi, IDE baca-saja.">
          <Switch checked={has("sessions:read")} disabled={busy || !enabled} onChange={(on: boolean) => void toggleView(on)} aria-label="Lihat" />
        </Row>
        {EXTRA.map((e, i) => (
          <Row key={e.cap} title={e.label} desc={e.desc} last={i === EXTRA.length - 1}>
            <Switch checked={has(e.cap)} disabled={busy || !enabled} onChange={(on: boolean) => void toggleExtra(e.cap, on)} aria-label={e.label} />
          </Row>
        ))}
      </Card>
      <Card eyebrow="kendali" title="Status relay">
        <div data-testid="relay-status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <Badge tone={RELAY_TONE[view.relay.state]}>{RELAY_LABEL[view.relay.state]}</Badge>
          <span style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{view.relay.hubOrigin ?? "mesin ini tak tersambung ke hub"}</span>
          {view.relay.lastClose && (
            <span style={{ color: "var(--text-muted)" }}>
              tutup terakhir {view.relay.lastClose.code}{view.relay.lastClose.reason ? ` · ${view.relay.lastClose.reason}` : ""}
            </span>
          )}
        </div>
      </Card>
      <Card eyebrow="kendali" title="Audit aksi hub di mesin ini">
        {view.audit.length === 0
          ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada aksi dari hub.</div>
          : view.audit.map((a) => (
            <div key={a.id} data-testid="remote-audit-row" style={{ fontSize: 12.5, padding: "8px 0", borderBottom: "1px solid var(--border-hair)", overflowWrap: "anywhere" }}>
              <b>{a.kind}</b> · {a.msg} · <span style={{ color: "var(--text-muted)" }}>{new Date(a.ts).toLocaleString("id-ID")}</span>
            </div>
          ))}
      </Card>
    </>
  );
}
