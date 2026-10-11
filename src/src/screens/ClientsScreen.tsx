import React from "react";
import { Badge, Button, DenseRow, RowList, StateBlock, StatusPill, type ShowToast } from "../ds";
import { Tabs } from "../ds/components/ui";
import { api } from "../api/client";
import { LogsPanel } from "./LogsPanel";
import { RemoteInstanceView } from "./RemoteInstanceView";
import { ClientAccessPanel } from "./ClientAccessPanel";
import { RemoteAccessCard } from "./RemoteControlPanel";
import type { PresenceDeviceView, PresenceSessionView, PresenceView } from "@hanoman/shared";
import { relativeTime } from "../lib/time-format";
import "./styles/clients.css";

/* SPEC-919 · ADR-0147 · halaman "Klien": perangkat yang sinkron ke server ini, dan pekerjaan yang
   sedang berjalan di masing-masing.
   SPEC-1218 · ADR-0165 §11 · mirror terminal/dokumen/IDE perangkat ada lewat "Lihat (baca saja)" →
   `RemoteInstanceView`; menempel untuk MENGETIK di sesi perangkat tetap di luar lingkup.

   Audit UI/UX 2026-10 · Fase 3G: daftar Perangkat berbentuk baris (nama, status online/offline, sesi
   berjalan dalam bahasa biasa, terakhir terlihat); satu aksi utama per baris. Tab "Akun" memuat
   akun klien. Izin server pusat per perangkat dipilih lewat satu selektor tingkat (Lihat/Kerja/Tulis).
   Daftar kosong tak boleh menyamar sebagai kegagalan muat. */

// Label bahasa biasa + warna pill untuk status sesi. `pill` memakai kunci StatusPill yang sudah ada.
const STATUS: Record<PresenceSessionView["status"], { label: string; pill: string }> = {
  working: { label: "bekerja", pill: "running" },
  waiting: { label: "menunggu keputusan", pill: "awaiting" },
  exited: { label: "selesai", pill: "stopped" },
};

/** Alasan tombol "Lihat (baca saja)" mati, dalam bahasa biasa. `null` = tombol boleh dipakai. Murni, supaya
    tiap cabangnya bisa diuji tanpa merender baris. */
export function openBlockReason(d: PresenceDeviceView): string | null {
  if (!d.online) return "Perangkat sedang offline — kendali jarak jauh tak bisa dibuka.";
  if (d.control?.state === "protocol-mismatch") return "Versi protokol perangkat tak cocok dengan server ini.";
  if (!d.control) return "Kendali jarak jauh belum diizinkan di perangkat ini.";
  return null;
}

/** Ringkasan sesi berjalan dalam bahasa biasa: "1 sesi berjalan" atau "Tidak ada sesi berjalan". */
export function sessionSummary(count: number): string {
  return count === 0 ? "Tidak ada sesi berjalan" : `${count} sesi berjalan`;
}

function SessionLine({ s, title, onOpenSpec, now }:
  { s: PresenceSessionView; title?: string; onOpenSpec: (specId: string) => void; now: number }) {
  const st = STATUS[s.status];
  const body = (
    <>
      <span className="kl-session-id">{s.specId ?? s.sessionId}</span>
      <span className="kl-session-title">{title ?? s.projectId}</span>
      {s.phase && <span className="kl-session-phase">{s.phase}</span>}
      <StatusPill variant="dot" size="sm" status={st.pill}>{st.label}</StatusPill>
      <span className="kl-muted">{relativeTime(s.startedAt, now) || "—"}</span>
    </>
  );
  // Baris sesi yang punya SPEC bisa diklik ke detail backlog; yang tak punya SPEC hanya teks.
  return s.specId
    ? <button type="button" data-testid={`presence-session-${s.sessionId}`} className="kl-session kl-session-link"
        onClick={() => onOpenSpec(s.specId!)}>{body}</button>
    : <div data-testid={`presence-session-${s.sessionId}`} className="kl-session">{body}</div>;
}

function DeviceRow({ d, specTitles, onOpenSpec, now, onOpenRemote }:
  { d: PresenceDeviceView; specTitles: Record<string, string>;
    onOpenSpec: (specId: string) => void; now: number; onOpenRemote: (d: PresenceDeviceView) => void }) {
  const reasonId = React.useId();
  const reason = d.local ? null : openBlockReason(d);
  return (
    <DenseRow actions={d.local ? undefined : (
      <Button size="sm" variant="secondary" disabled={!!reason} onClick={() => onOpenRemote(d)}
        aria-describedby={reason ? reasonId : undefined}>
        Lihat (baca saja)
      </Button>
    )}>
      <div className="kl-device">
        <div className="kl-device-head">
          <span className="kl-device-name">{d.name}</span>
          {d.local && <Badge tone="neutral" size="sm">perangkat ini</Badge>}
          <StatusPill variant="dot" size="sm" status={d.online ? "ok" : "idle"}
            data-testid={`device-state-${d.deviceId}`}>
            {d.online ? "online" : "offline"}
          </StatusPill>
        </div>
        <div className="kl-device-meta">
          {d.sessions.length === 0
            ? <span data-testid={`device-empty-${d.deviceId}`}>{sessionSummary(0)}</span>
            : <span>{sessionSummary(d.sessions.length)}</span>}
          <span> · terakhir terlihat {relativeTime(d.lastSeenAt, now) || "—"}</span>
        </div>
        {reason && (
          <div id={reasonId} data-testid={`device-open-reason-${d.deviceId}`} className="kl-device-reason">{reason}</div>
        )}
        {d.sessions.map((s) => (
          <SessionLine key={s.sessionId} s={s} title={s.specId ? specTitles[s.specId] : undefined}
            onOpenSpec={onOpenSpec} now={now} />
        ))}
      </div>
    </DenseRow>
  );
}

export function ClientsScreen({ view, specTitles, onOpenSpec, onToast }:
  { view: PresenceView; specTitles: Record<string, string>; onOpenSpec: (specId: string) => void;
    onToast?: ShowToast }) {
  /* ADR-0145 · muat awal. Yang benar-benar memicunya bukan proxy yang menolak upgrade melainkan
     kasus sehari-hari: `section` dipulihkan dari storage (ADR-0115, `clients` ada di `NAV_KEYS`),
     jadi refresh saat sedang membuka layar ini mendaratkan kita di sini SEBELUM socket sempat
     mengantar frame pertamanya — dan `App` sengaja tak menariknya di `load()` (satu panggilan `api`
     di sana mematahkan 20 test ber-mock parsial, kelas jebakan SPEC-884). Ia berhenti begitu frame
     tiba; tak ada polling.
     Audit UI/UX 2026-10: selama menunggu muatan awal tampil "Memuat…", dan kalau gagal tampil
     galat dengan "Coba lagi" — bukan "Belum ada perangkat" yang seolah-olah jawaban yang sah. */
  const [fallback, setFallback] = React.useState<PresenceView | null>(null);
  const [fetchState, setFetchState] = React.useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = React.useState(0);
  const empty = view.devices.length === 0;
  React.useEffect(() => {
    if (!empty) return;
    let alive = true;
    setFetchState("loading");
    api.presence()
      .then((v) => { if (alive) { setFallback(v); setFetchState("ready"); } })
      .catch(() => { if (alive) setFetchState("error"); });
    return () => { alive = false; };
  }, [empty, attempt]);

  const shown = empty && fallback ? fallback : view;
  // Satu stempel per render: dua baris yang lahir dari render yang sama tak boleh menghitung
  // "sudah berapa lama" dari dua titik waktu berbeda.
  const now = Date.now();
  // Tab: Perangkat (default) · Akun (akun klien) · Log (LogsPanel terpusat).
  const [tab, setTab] = React.useState<"device" | "akun" | "log">("device");
  // Perangkat yang dibuka dicari ulang dari `shown` setiap render, jadi status online/kendalinya
  // selalu segar. Sesi dipilih lewat id; sesi yang sudah lenyap jatuh ke sesi pertama.
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [pickedSession, setPickedSession] = React.useState<string | null>(null);
  const openDevice = openId ? shown.devices.find((d) => d.deviceId === openId) ?? null : null;
  const session = openDevice
    ? openDevice.sessions.find((s) => s.sessionId === pickedSession) ?? openDevice.sessions[0]
    : undefined;

  const deviceList = () => {
    if (shown.devices.length > 0) {
      return (
        <RowList label="Perangkat">
          {shown.devices.map((d) => (
            <DeviceRow key={d.deviceId} d={d} specTitles={specTitles} onOpenSpec={onOpenSpec}
              now={now} onOpenRemote={(dev) => { setOpenId(dev.deviceId); setPickedSession(null); }} />
          ))}
        </RowList>
      );
    }
    if (fetchState === "error") {
      return <StateBlock kind="error" title="Gagal memuat daftar perangkat"
        hint="Periksa koneksi ke server ini, lalu coba lagi." action={() => setAttempt((n) => n + 1)} />;
    }
    if (fetchState === "loading") return <StateBlock kind="loading" compact title="Memuat perangkat…" />;
    return <StateBlock kind="empty" icon="monitor" title="Belum ada perangkat"
      hint="Perangkat muncul di sini setelah hanoman di perangkat itu terhubung ke server ini dengan token perangkat." />;
  };

  return (
    <div className="kl-screen">
      {openDevice ? (
        <RemoteInstanceView device={openDevice} hubVersion={shown.hubVersion}
          sessionId={session?.sessionId} projectId={session?.projectId}
          onPickSession={(id) => setPickedSession(id)} onClose={() => setOpenId(null)} />
      ) : (
        <>
          <Tabs variant="pill"
            tabs={[{ value: "device", label: "Perangkat" }, { value: "akun", label: "Akun" }, { value: "log", label: "Log" }]}
            value={tab} onChange={(v) => setTab(v as "device" | "akun" | "log")} />
          {tab === "device" && (
            <>
              {deviceList()}
              <RemoteAccessCard onToast={onToast} />
            </>
          )}
          {tab === "akun" && <ClientAccessPanel onToast={onToast} />}
          {tab === "log" && <LogsPanel />}
        </>
      )}
    </div>
  );
}
