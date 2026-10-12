import React from "react";
import type { AccessRequestView, LogLane, RelayLinkState, RemoteControl, RemoteControlView } from "@hanoman/shared";
import { Badge, Button, Card, Radio, RadioGroup, StateBlock, Switch, useConfirm, type ShowToast } from "../ds";
import { ApiError, api } from "../api/client";
import { failureMessage } from "../lib/report-error";
import { relativeTime } from "../lib/time-format";
import {
  ACCESS_TIERS, GRANT_IMPACT, GRANT_LABEL, RISKY_GRANTS, TIER_DESC, TIER_GRANTS, TIER_LABEL,
  customGrantLabels, grantDiff, isRiskyTier, needsConfirm, tierOf, type AccessTier,
} from "./remote-access-tier";
import { hostOf } from "./access-request";

// SPEC-1215 · ADR-0165 §4 · K7 transparansi: operator perangkat INI menentukan apa yang boleh dilakukan
// server pusat dan membaca riwayat perintah yang sudah diterima. Berkas sendiri (pola ClientAccessPanel):
// SettingsScreen sudah ~80 KB. Toggle lajur log sengaja BELUM ada — pengirimannya lahir di SPEC-1217
// (keputusan Plan P6).
//
// Audit UI/UX 2026-10 · Fase 3G: lima switch grant diganti SATU selektor tingkat (Lihat · Kerja · Tulis).
// Pemetaan tingkat ↔ grant ada di `remote-access-tier.ts` dan diuji sendiri. Relay dan riwayat
// diringkas; rinciannya dilipat.

const RELAY_LABEL: Record<RelayLinkState, string> = {
  off: "tidak aktif", connecting: "menyambung", open: "tersambung", backoff: "mencoba lagi",
  unsupported: "server pusat tak mendukung", rejected: "ditolak server pusat",
};
const RELAY_TONE: Record<RelayLinkState, "ok" | "warn" | "neutral"> = {
  off: "neutral", connecting: "neutral", open: "ok", backoff: "warn", unsupported: "warn", rejected: "warn",
};
// SPEC-1217 · AC-D1 UI · tiga jenis log ke server pusat — terpisah dari izin kendali jarak jauh:
// jenis log hanya MENGIRIM baris, tidak membuka jalur perintah.
const LOG_LANES: { lane: LogLane; label: string; desc: string }[] = [
  { lane: "event", label: "Kejadian", desc: "Sesi dimulai dan selesai, serta perubahan izin. Jejak audit lokal, menyala secara default." },
  { lane: "server", label: "Log server", desc: "Log proses server ini, disaring dari data rahasia sebelum dikirim." },
  { lane: "transcript", label: "Transkrip sesi", desc: "Transkrip sesi terminal yang sudah ditutup." },
];

/** Memuat izin. `Promise.resolve` membuat api yang tak tersedia (mock parsial) jadi galat yang tertangkap,
    bukan lemparan sinkron yang menjatuhkan render. */
const fetchRemoteControl = (): Promise<RemoteControlView> =>
  Promise.resolve().then(() => api.getRemoteControl());

/** Master + selektor tingkat akses untuk satu perangkat. Dipakai di Klien (Perangkat) dan di panel kendali. */
export function RemoteAccessSection({ view, onView, onToast }:
  { view: RemoteControlView; onView: (next: RemoteControlView) => void; onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const { enabled, capabilities } = view.control;
  const tier = tierOf(capabilities);

  const save = async (nextEnabled: boolean, next: RemoteControlView["control"]["capabilities"], okMsg: string) => {
    setBusy(true);
    try {
      onView(await api.putRemoteControl({ control: { enabled: nextEnabled, capabilities: next } }));
      onToast?.(okMsg, "ok", "check");
    } catch (e) {
      onToast?.(failureMessage("menyimpan izin kendali jarak jauh", e), "err", "x-circle");
    } finally { setBusy(false); }
  };

  // Server menolak grant tulis tanpa `sessions:read` — tingkat mana pun sudah memuatnya, jadi invarian
  // itu terjaga lewat pemetaan, bukan lewat 400 dari server.
  const toggleMaster = (on: boolean) => save(on, on && capabilities.length === 0 ? [...TIER_GRANTS.lihat] : capabilities,
    on ? "Izin kendali jarak jauh disimpan" : "Kendali jarak jauh dimatikan");

  // Pilih tingkat: tak ada perubahan → diam. Naik ke grant berisiko atau turun (ada grant yang dicabut)
  // → dialog yang menyebut dampaknya. Naik ke Lihat saja tak perlu dialog.
  const choose = async (next: AccessTier) => {
    const target = [...TIER_GRANTS[next]];
    const diff = grantDiff(capabilities, target);
    if (diff.added.length === 0 && diff.removed.length === 0) return;
    const okMsg = `Tingkat akses: ${TIER_LABEL[next]}`;
    if (!needsConfirm(diff)) { await save(enabled, target, okMsg); return; }
    const raising = diff.added.some((c) => RISKY_GRANTS.includes(c));
    await confirm({
      title: raising ? `Izinkan tingkat ${TIER_LABEL[next]}?` : `Turunkan ke ${TIER_LABEL[next]}?`,
      message: TIER_DESC[next],
      impact: [
        ...diff.added.map((c) => GRANT_IMPACT[c]),
        ...diff.removed.map((c) => `Dicabut: ${GRANT_LABEL[c]}.`),
      ],
      confirmLabel: raising ? `Izinkan ${TIER_LABEL[next]}` : `Turunkan ke ${TIER_LABEL[next]}`,
      tone: raising ? "danger" : "default",
      icon: raising ? "shield" : "info",
      // Dialog tetap terbuka dan `busy` selama simpan berjalan, jadi klik ganda tak bisa menyimpan dua kali.
      run: () => save(enabled, target, okMsg),
    });
  };

  return (
    <div className="kl-access">
      <div className="kl-row">
        <div className="kl-row-text">
          <div className="kl-row-title">Izinkan kendali jarak jauh</div>
          <div className="kl-row-desc">
            Mati = server pusat tidak bisa mengirim perintah ke perangkat ini sama sekali.
            Hanya bisa dinyalakan dari perangkat ini.
          </div>
        </div>
        <Switch checked={enabled} disabled={busy} onChange={(on: boolean) => void toggleMaster(on)}
          aria-label="Izinkan kendali jarak jauh" />
      </div>

      <div className="kl-tier-head">Tingkat akses</div>
      <RadioGroup aria-label="Tingkat akses" className="kl-tier-group"
        value={tier === "khusus" ? "khusus" : tier === "kosong" ? null : tier}
        disabled={busy || !enabled}
        onChange={(v) => void choose(v as AccessTier)}>
        {ACCESS_TIERS.map((t) => (
          <Radio key={t} value={t} label={TIER_LABEL[t]} description={TIER_DESC[t]} />
        ))}
        {tier === "khusus" && (
          <Radio value="khusus" label="Khusus" disabled
            description="Kombinasi izin yang tak sama dengan tingkat mana pun. Pilih satu tingkat untuk menggantinya." />
        )}
      </RadioGroup>
      {!enabled && (
        <div className="kl-tier-hint">Nyalakan kendali jarak jauh untuk memilih tingkat akses.</div>
      )}
      {tier === "khusus" && (
        <details className="kl-khusus">
          <summary>Rincian izin khusus</summary>
          <div>{customGrantLabels(capabilities).join(", ")}</div>
        </details>
      )}
      {dialog}
    </div>
  );
}

/** Teks 409 saat menyetujui: pesan server bila ada (mis. kendali mati), selain itu "permintaan berubah". */
function conflictText(e: ApiError): string {
  const msg = (e.detail as { error?: unknown } | null)?.error;
  return typeof msg === "string" ? msg : "Permintaan berubah, periksa lagi";
}

/** ADR-0217 · kartu persetujuan: permintaan tingkat yang masuk dari server pusat lewat relay. Hanya operator
    LOKAL yang bisa menyetujui. Menyetujui menerapkan tingkat yang diminta lewat jalur PUT yang sama (dengan
    konfirmasi dan dampaknya); menolak tak mengubah apa pun. Tak ada permintaan yang berlaku sendiri. */
export function AccessRequestsApproval({ control, onApplied, onToast }:
  { control: RemoteControl; onApplied: () => void; onToast?: ShowToast }) {
  const [items, setItems] = React.useState<AccessRequestView[]>([]);
  const [busy, setBusy] = React.useState(false);
  const { confirm, dialog } = useConfirm();
  const load = React.useCallback(() => {
    Promise.resolve().then(() => api.listRemoteAccessRequests())
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);
  // Permintaan bisa datang kapan saja dari hub. Muat ulang saat jendela kembali fokus, bukan polling (ADR-0039).
  React.useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) return null;

  const approve = (r: AccessRequestView) => {
    const target = TIER_GRANTS[r.tier];
    const label = TIER_LABEL[r.tier];
    void confirm({
      title: `Izinkan ${hostOf(r.from)} tingkat ${label}?`,
      message: TIER_DESC[r.tier],
      impact: [
        ...target.map((c) => GRANT_IMPACT[c]),
        "Menggantikan izin kendali jarak jauh yang berlaku sekarang dengan tingkat ini.",
      ],
      confirmLabel: `Izinkan ${label}`,
      tone: isRiskyTier(r.tier) ? "danger" : "default",
      icon: isRiskyTier(r.tier) ? "shield" : "info",
      run: async () => {
        setBusy(true);
        try {
          // Tingkat & hub dari kartu ini yang dikirim: server hanya menerapkan bila masih itu permintaannya.
          await api.decideRemoteAccessRequest(r.id, "approve", { tier: r.tier, from: r.from });
          onToast?.(`Tingkat ${label} diizinkan untuk ${hostOf(r.from)}`, "ok", "check");
          onApplied();
        } catch (e) {
          // 409 = kartu sudah basi (permintaan berganti/diputuskan, atau kendali mati). Daftar dimuat ulang di
          // `finally`; pesan server dipakai bila ada, selain itu pesan baku.
          onToast?.(
            e instanceof ApiError && e.status === 409 ? conflictText(e) : failureMessage("menyetujui permintaan tingkat", e),
            "err", "x-circle",
          );
        } finally {
          setBusy(false);
          load();
        }
      },
    });
  };

  const reject = async (r: AccessRequestView) => {
    setBusy(true);
    try {
      await api.decideRemoteAccessRequest(r.id, "reject");
      onToast?.(`Permintaan tingkat ${TIER_LABEL[r.tier]} ditolak`, "ok", "check");
    } catch (e) {
      onToast?.(failureMessage("menolak permintaan tingkat", e), "err", "x-circle");
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <div className="kl-access-requests" data-testid="access-requests">
      <div className="kl-tier-head">Permintaan dari server pusat</div>
      {pending.map((r) => (
        <div key={r.id} className="kl-row kl-row-last" data-testid={`access-request-${r.id}`}>
          <div className="kl-row-text">
            <div className="kl-row-title">Perangkat {hostOf(r.from)} meminta tingkat {TIER_LABEL[r.tier]}</div>
            <div className="kl-row-desc">
              {TIER_DESC[r.tier]} Diminta oleh {r.requestedBy}{" "}
              {relativeTime(r.requestedAt, Date.now()) || "baru saja"}; berlaku sampai {relativeTime(r.expiresAt, Date.now()) || "—"}.
            </div>
            {!control.enabled && (
              <div className="kl-tier-hint">Nyalakan kendali jarak jauh dulu untuk bisa menyetujui.</div>
            )}
          </div>
          <div className="kl-request-actions">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reject(r)}>Tolak</Button>
            <Button size="sm" variant="primary" disabled={busy || !control.enabled} onClick={() => approve(r)}>Setujui</Button>
          </div>
        </div>
      ))}
      {dialog}
    </div>
  );
}

/** Kartu Perangkat: izin server pusat untuk perangkat yang sedang dibuka ini. Memuat izinnya sendiri. */
export function RemoteAccessCard({ onToast }: { onToast?: ShowToast }) {
  const [view, setView] = React.useState<RemoteControlView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const load = React.useCallback(() => {
    setFailed(false);
    fetchRemoteControl().then(setView).catch(() => setFailed(true));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return (
    <Card eyebrow="akses" title="Izin server pusat untuk perangkat ini">
      {view
        ? (
          <>
            <RemoteAccessSection view={view} onView={setView} onToast={onToast} />
            <AccessRequestsApproval control={view.control} onApplied={load} onToast={onToast} />
          </>
        )
        : failed
          ? <StateBlock kind="error" compact title="Gagal memuat izin perangkat ini"
              hint="Periksa koneksi ke server ini, lalu coba lagi." action={load} />
          : <StateBlock kind="loading" compact title="Memuat izin…" />}
    </Card>
  );
}

export function RemoteControlPanel({ onToast }: { onToast?: ShowToast }) {
  const [view, setView] = React.useState<RemoteControlView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => {
    setFailed(false);
    fetchRemoteControl().then(setView).catch(() => setFailed(true));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  if (!view) {
    return (
      <Card eyebrow="kendali" title="Kendali jarak jauh dari server pusat">
        {failed
          ? <StateBlock kind="error" compact title="Gagal memuat izin kendali jarak jauh"
              hint="Coba muat ulang." action={load} />
          : <StateBlock kind="loading" compact title="Memuat izin…" />}
      </Card>
    );
  }

  const toggleLog = async (lane: LogLane, on: boolean) => {
    setBusy(true);
    try {
      setView(await api.putRemoteControl({ logs: { ...view.logs, [lane]: on } }));
      onToast?.(on ? `Log ${lane} mulai dikirim ke server pusat` : `Log ${lane} berhenti dikirim`, "ok", "check");
    } catch (e) {
      onToast?.(failureMessage("menyimpan pengaturan log", e), "err", "x-circle");
    } finally { setBusy(false); }
  };

  const lastAudit = view.audit[0];
  const relayHint = view.relay.hubOrigin ?? "perangkat ini tidak tersambung ke server pusat";

  return (
    <>
      <Card eyebrow="kendali" title="Kendali jarak jauh dari server pusat">
        <div className="kl-intro">
          Memberi <b>server pusat</b> tempat perangkat ini tersinkron izin untuk bertindak di perangkat ini,
          lewat rute yang sama dengan dashboard lokal.
        </div>
        <RemoteAccessSection view={view} onView={setView} onToast={onToast} />
      </Card>
      <Card eyebrow="kendali" title="Kirim log ke server pusat">
        <div className="kl-intro">
          Mengirim baris log dari perangkat ini ke server pusat. Ini terpisah dari izin kendali di atas.
          Tiap jenis log bisa dinyalakan sendiri-sendiri dan langsung berlaku tanpa restart.
        </div>
        {LOG_LANES.map((l, i) => (
          <div key={l.lane} className={`kl-row${i === LOG_LANES.length - 1 ? " kl-row-last" : ""}`}>
            <div className="kl-row-text">
              <div className="kl-row-title">{l.label}</div>
              <div className="kl-row-desc">{l.desc}</div>
            </div>
            <Switch checked={view.logs[l.lane]} disabled={busy}
              onChange={(on: boolean) => void toggleLog(l.lane, on)} aria-label={l.label} />
          </div>
        ))}
      </Card>
      <Card eyebrow="kendali" title="Koneksi ke server pusat">
        <div data-testid="relay-status" className="kl-status-line">
          <Badge tone={RELAY_TONE[view.relay.state]}>{RELAY_LABEL[view.relay.state]}</Badge>
          <span className="kl-status-origin">{relayHint}</span>
        </div>
        {view.relay.lastClose && (
          <details className="kl-khusus">
            <summary>Rincian koneksi</summary>
            <div>
              Terputus terakhir (kode {view.relay.lastClose.code})
              {view.relay.lastClose.reason ? ` · ${view.relay.lastClose.reason}` : ""}
            </div>
          </details>
        )}
      </Card>
      <Card eyebrow="kendali" title="Riwayat perintah dari server pusat">
        {view.audit.length === 0 ? (
          <div className="kl-muted">Belum ada perintah dari server pusat.</div>
        ) : (
          <>
            <div className="kl-muted">
              {view.audit.length} perintah tercatat
              {lastAudit && <> · terakhir {relativeTime(lastAudit.ts) || "—"}</>}
            </div>
            <details className="kl-khusus">
              <summary>Lihat semua riwayat</summary>
              {view.audit.map((a) => (
                <div key={a.id} data-testid="remote-audit-row" className="kl-audit-row" title={a.kind}>
                  <span>{a.msg}</span>
                  <span className="kl-muted"> · {relativeTime(a.ts) || "—"}</span>
                </div>
              ))}
            </details>
          </>
        )}
      </Card>
    </>
  );
}
