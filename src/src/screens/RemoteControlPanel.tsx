import React from "react";
import type { LogLane, RelayLinkState, RemoteCapability, RemoteControlView } from "@hanoman/shared";
import { Badge, Card, StateBlock, Switch, useConfirm, type ShowToast } from "../ds";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";

// SPEC-1215 · ADR-0165 §4 · K7 transparansi: operator perangkat INI menentukan apa yang boleh dilakukan
// server pusat dan membaca riwayat perintah yang sudah diterima. Berkas sendiri (pola ClientAccessPanel):
// SettingsScreen sudah ~80 KB. Toggle lajur log sengaja BELUM ada — pengirimannya lahir di SPEC-1217
// (keputusan Plan P6).
//
// Audit UI/UX 2026-10: istilah "grant", "socket relay", "POST /sync/logs", dan "lajur" diganti bahasa
// biasa; izin yang bisa mengubah sesi diberi penanda risiko dan konfirmasi saat dinyalakan; mematikan
// "Lihat" memperingatkan bahwa semua izin ikut dicabut.

const VIEW: RemoteCapability[] = ["sessions:read", "backlog:read", "ide:read"];
const VIEW_LABEL = "Lihat";
const EXTRA: { cap: RemoteCapability; label: string; desc: string; risk?: true; impact?: string[] }[] = [
  {
    cap: "sessions:write", label: "Tulis terminal", risk: true,
    desc: "Mengetik ke terminal, mengarahkan, menghentikan, dan menjawab dialog agen.",
    impact: [
      "Server pusat boleh mengetik ke terminal sesi yang berjalan di perangkat ini.",
      "Server pusat boleh menghentikan sesi dan menjawab keputusan yang diminta agen.",
      "Server pusat boleh mengambil alih dialog agen dari Anda.",
    ],
  },
  {
    cap: "sessions:spawn", label: "Mulai sesi", risk: true,
    desc: "Membuka sesi agen baru di perangkat ini atas perintah server pusat. Gerbang beban perangkat tetap berlaku.",
    impact: [
      "Server pusat boleh membuka sesi agen baru di perangkat ini.",
      "Agen akan berjalan di perangkat ini tanpa Anda memulainya dari sini.",
      "Gerbang beban perangkat tetap berlaku: server pusat tak bisa memaksa melewatinya.",
    ],
  },
  { cap: "backlog:write", label: "Tandai selesai", desc: "Hanya menandai item backlog selesai; penyuntingan item lain tetap tertutup untuk server pusat." },
];
// SPEC-1217 · AC-D1 UI · tiga jenis log ke server pusat — terpisah dari izin kendali jarak jauh:
// jenis log hanya MENGIRIM baris, tidak membuka jalur perintah.
const LOG_LANES: { lane: LogLane; label: string; desc: string }[] = [
  { lane: "event", label: "Kejadian", desc: "Sesi dimulai dan selesai, serta perubahan izin. Jejak audit lokal, menyala secara default." },
  { lane: "server", label: "Log server", desc: "Log proses server ini, disaring dari data rahasia sebelum dikirim." },
  { lane: "transcript", label: "Transkrip sesi", desc: "Transkrip sesi terminal yang sudah ditutup." },
];
const RELAY_LABEL: Record<RelayLinkState, string> = {
  off: "tidak aktif", connecting: "menyambung", open: "tersambung", backoff: "mencoba lagi",
  unsupported: "server pusat tak mendukung", rejected: "ditolak server pusat",
};
const RELAY_TONE: Record<RelayLinkState, "ok" | "warn" | "neutral"> = {
  off: "neutral", connecting: "neutral", open: "ok", backoff: "warn", unsupported: "warn", rejected: "warn",
};

function Row({ title, desc, children, last, badge }:
  { title: string; desc: string; children: React.ReactNode; last?: boolean; badge?: React.ReactNode }) {
  return (
    <div className="hn-setting-row" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--border-hair)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
          {title}{badge}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div className="hn-setting-control" style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

const RISK_BADGE = <Badge tone="warn" size="sm">berisiko</Badge>;

export function RemoteControlPanel({ onToast }: { onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const [view, setView] = React.useState<RemoteControlView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => {
    setFailed(false);
    api.getRemoteControl().then(setView).catch(() => setFailed(true));
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

  const { enabled, capabilities } = view.control;
  const has = (c: RemoteCapability) => capabilities.includes(c);
  const union = (...lists: RemoteCapability[][]): RemoteCapability[] => [...new Set(lists.flat())];
  const save = async (nextEnabled: boolean, next: RemoteCapability[]) => {
    setBusy(true);
    try {
      setView(await api.putRemoteControl({ control: { enabled: nextEnabled, capabilities: next } }));
      onToast?.(nextEnabled ? "Izin kendali jarak jauh disimpan" : "Kendali jarak jauh dimatikan", "ok", "check");
    } catch (e) {
      onToast?.(failureMessage("menyimpan izin kendali jarak jauh", e), "err", "x-circle");
    } finally { setBusy(false); }
  };
  // Server menolak grant tulis tanpa `sessions:read` — UI menjaga invarian yang sama, tak mengandalkan 400.
  const toggleMaster = (on: boolean) => save(on, on && capabilities.length === 0 ? VIEW : capabilities);

  // Mematikan "Lihat" membuang SEMUA izin (lihat `save(enabled, [])`), jadi konfirmasinya menyebut
  // izin lain yang ikut hilang, bukan hanya izin lihat itu sendiri.
  const toggleView = async (on: boolean) => {
    if (on) return save(enabled, union(capabilities, VIEW));
    const others = EXTRA.filter((e) => has(e.cap)).map((e) => e.label);
    await confirm({
      title: `Matikan "${VIEW_LABEL}"?`,
      message: "Semua izin kendali jarak jauh ikut dicabut, bukan hanya izin lihat.",
      impact: [
        "Server pusat kehilangan akses lihat ke sesi, backlog, dan IDE perangkat ini.",
        others.length
          ? `Izin lain yang ikut dicabut: ${others.join(", ")}.`
          : "Tak ada izin lain yang sedang aktif.",
      ],
      confirmLabel: "Matikan dan cabut izin",
      tone: "danger",
      icon: "eye",
      run: () => save(enabled, []),
    });
  };

  // Izin berisiko dikonfirmasi SAAT dinyalakan (mematikannya tak perlu konfirmasi). Dialog tetap
  // terbuka dan `busy` selama simpan berjalan, jadi klik ganda tak bisa menyimpan dua kali.
  const toggleExtra = async (cap: RemoteCapability, on: boolean) => {
    const def = EXTRA.find((e) => e.cap === cap)!;
    const next = on ? union(capabilities, VIEW, [cap]) : capabilities.filter((c) => c !== cap);
    if (on && def.risk) {
      await confirm({
        title: `Izinkan "${def.label}"?`,
        message: def.desc,
        impact: def.impact,
        confirmLabel: "Izinkan",
        tone: "danger",
        icon: "shield",
        run: () => save(enabled, next),
      });
      return;
    }
    await save(enabled, next);
  };

  const toggleLog = async (lane: LogLane, on: boolean) => {
    setBusy(true);
    try {
      setView(await api.putRemoteControl({ logs: { ...view.logs, [lane]: on } }));
      onToast?.(on ? `Log ${lane} mulai dikirim ke server pusat` : `Log ${lane} berhenti dikirim`, "ok", "check");
    } catch (e) {
      onToast?.(failureMessage("menyimpan pengaturan log", e), "err", "x-circle");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card eyebrow="kendali" title="Kendali jarak jauh dari server pusat">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Memberi <b>server pusat</b> tempat perangkat ini tersinkron izin untuk bertindak di perangkat ini,
          lewat rute yang sama dengan dashboard lokal. Default mati, dan hanya bisa dinyalakan dari perangkat
          ini — server pusat tak bisa menyalakannya sendiri.
        </div>
        <Row title="Izinkan kendali jarak jauh" desc="Membuka koneksi ke server pusat. Mati = server pusat tidak bisa mengirim perintah ke perangkat ini sama sekali.">
          <Switch checked={enabled} disabled={busy} onChange={(on: boolean) => void toggleMaster(on)} aria-label="Izinkan kendali jarak jauh" />
        </Row>
        <Row title={VIEW_LABEL} desc="Melihat daftar sesi, fase, dialog, dokumen, dan IDE. Hanya baca.">
          <Switch checked={has("sessions:read")} disabled={busy || !enabled} onChange={(on: boolean) => void toggleView(on)} aria-label={VIEW_LABEL} />
        </Row>
        {EXTRA.map((e, i) => (
          <Row key={e.cap} title={e.label} desc={e.desc} last={i === EXTRA.length - 1} badge={e.risk ? RISK_BADGE : undefined}>
            <Switch checked={has(e.cap)} disabled={busy || !enabled} onChange={(on: boolean) => void toggleExtra(e.cap, on)} aria-label={e.label} />
          </Row>
        ))}
      </Card>
      <Card eyebrow="kendali" title="Kirim log ke server pusat">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Mengirim baris log dari perangkat ini ke server pusat. Ini terpisah dari izin kendali di atas.
          Tiap jenis log bisa dinyalakan sendiri-sendiri dan langsung berlaku tanpa restart.
        </div>
        {LOG_LANES.map((l, i) => (
          <Row key={l.lane} title={l.label} desc={l.desc} last={i === LOG_LANES.length - 1}>
            <Switch checked={view.logs[l.lane]} disabled={busy}
              onChange={(on: boolean) => void toggleLog(l.lane, on)} aria-label={l.label} />
          </Row>
        ))}
      </Card>
      <Card eyebrow="kendali" title="Koneksi ke server pusat">
        <div data-testid="relay-status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <Badge tone={RELAY_TONE[view.relay.state]}>{RELAY_LABEL[view.relay.state]}</Badge>
          <span style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{view.relay.hubOrigin ?? "perangkat ini tidak tersambung ke server pusat"}</span>
          {view.relay.lastClose && (
            <span style={{ color: "var(--text-muted)" }}>
              terputus terakhir (kode {view.relay.lastClose.code}){view.relay.lastClose.reason ? ` · ${view.relay.lastClose.reason}` : ""}
            </span>
          )}
        </div>
      </Card>
      <Card eyebrow="kendali" title="Riwayat perintah dari server pusat">
        {view.audit.length === 0
          ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada perintah dari server pusat.</div>
          : view.audit.map((a) => (
            <div key={a.id} data-testid="remote-audit-row" style={{ fontSize: 12.5, padding: "8px 0", borderBottom: "1px solid var(--border-hair)", overflowWrap: "anywhere" }}>
              <b>{a.kind}</b> · {a.msg} · <span style={{ color: "var(--text-muted)" }}>{new Date(a.ts).toLocaleString("id-ID")}</span>
            </div>
          ))}
      </Card>
      {dialog}
    </>
  );
}
