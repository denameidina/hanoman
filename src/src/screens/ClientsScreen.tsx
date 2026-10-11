import React from "react";
import { Card, Badge, Button, StateBlock } from "../ds";
import { Tabs } from "../ds/components/ui";
import { api } from "../api/client";
import { Icon } from "../ds/icon";
import { LogsPanel } from "./LogsPanel";
import { RemoteInstanceView } from "./RemoteInstanceView";
import type { PresenceDeviceView, PresenceSessionView, PresenceView } from "@hanoman/shared";
import { relativeTime } from "../lib/time-format";

/* SPEC-919 · ADR-0147 · halaman "Klien": perangkat yang sinkron ke server ini, dan pekerjaan yang
   sedang berjalan di masing-masing.
   SPEC-1218 · ADR-0165 §11 · mirror terminal/dokumen/IDE perangkat kini ADA lewat tombol "Buka" →
   `RemoteInstanceView`, baca-saja; menempel untuk MENGETIK di sesi perangkat tetap di luar lingkup.

   Audit UI/UX 2026-10: daftar kosong tak boleh menyamar sebagai kegagalan muat, dan tombol yang
   mati harus menyebut alasannya sebagai teks, bukan hanya lewat `title`. */

const STATUS: Record<PresenceSessionView["status"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  working: { label: "bekerja", tone: "ok" },
  waiting: { label: "menunggu keputusan", tone: "warn" },
  exited: { label: "selesai", tone: "neutral" },
};

/** Alasan tombol "Buka" mati, dalam bahasa biasa. `null` = tombol boleh dipakai. Murni, supaya
    tiap cabangnya bisa diuji tanpa merender kartu. */
export function openBlockReason(d: PresenceDeviceView): string | null {
  if (!d.online) return "Perangkat sedang offline — kendali jarak jauh tak bisa dibuka.";
  if (d.control?.state === "protocol-mismatch") return "Versi protokol perangkat tak cocok dengan server ini.";
  if (!d.control) return "Kendali jarak jauh belum diizinkan di perangkat ini.";
  return null;
}

function SessionRow({ s, title, onOpenSpec, now }:
  { s: PresenceSessionView; title?: string; onOpenSpec: (specId: string) => void; now: number }) {
  const clickable = !!s.specId;
  const st = STATUS[s.status];
  return (
    /* SPEC-763 · `hn-dense-row`: bentuk baris ini persis yang class itu layani —
       [id mono][judul flex:1][badge…]. Tanpanya, di ≤767px badge menahan lebarnya dan judul
       tersisa beberapa karakter per baris. */
    <div data-testid={`presence-session-${s.sessionId}`} className="hn-dense-row"
      role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onOpenSpec(s.specId!) : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSpec(s.specId!); }
      } : undefined}
      style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, minWidth: 0,
        padding: "9px 10px", borderRadius: "var(--radius-sm)",
        borderBottom: "1px solid var(--border-hair)", cursor: clickable ? "pointer" : "default",
      }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>
        {s.specId ?? s.sessionId}
      </span>
      <span className="hn-grow" style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--text-strong)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title ?? s.projectId}
      </span>
      <Badge tone="neutral" size="sm" icon="box">{s.projectId}</Badge>
      {s.phase && <Badge tone="brass" size="sm">{s.phase}</Badge>}
      <Badge tone={st.tone} size="sm">{st.label}</Badge>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
        {relativeTime(s.startedAt, now) || "—"}
      </span>
    </div>
  );
}

function DeviceCard({ d, specTitles, onOpenSpec, now, onOpenRemote }:
  { d: PresenceDeviceView; specTitles: Record<string, string>;
    onOpenSpec: (specId: string) => void; now: number; onOpenRemote: (d: PresenceDeviceView) => void }) {
  const reasonId = React.useId();
  const reason = openBlockReason(d);
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <Icon name="monitor" size={16} color="var(--text-muted)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 500, color: "var(--text-strong)" }}>
          {d.name}
        </span>
        {d.local && <Badge tone="neutral" size="sm">perangkat ini</Badge>}
        <Badge data-testid={`device-state-${d.deviceId}`} size="sm" tone={d.online ? "ok" : "neutral"}>
          {d.online ? "online" : "offline"}
        </Badge>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
          terakhir terlihat {relativeTime(d.lastSeenAt, now) || "—"}
        </span>
        {!d.local && (
          <Button size="sm" disabled={!!reason} onClick={() => onOpenRemote(d)}
            aria-describedby={reason ? reasonId : undefined}>
            Buka
          </Button>
        )}
      </div>
      {!d.local && reason && (
        <div id={reasonId} data-testid={`device-open-reason-${d.deviceId}`}
          style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          {reason}
        </div>
      )}
      {d.sessions.length === 0
        ? (
          <div data-testid={`device-empty-${d.deviceId}`}
            style={{ fontSize: 12, color: "var(--text-subtle)", padding: "6px 2px" }}>
            Tak ada sesi berjalan.
          </div>
        )
        : d.sessions.map((s) => (
          <SessionRow key={s.sessionId} s={s} title={s.specId ? specTitles[s.specId] : undefined}
            onOpenSpec={onOpenSpec} now={now} />
        ))}
    </Card>
  );
}

export function ClientsScreen({ view, specTitles, onOpenSpec }:
  { view: PresenceView; specTitles: Record<string, string>; onOpenSpec: (specId: string) => void }) {
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
  // SPEC-1217 · D6/AC-S8 · tab "Perangkat"|"Log", default "Perangkat" — log terpusat (LogsPanel)
  // hidup di tab kedua.
  const [tab, setTab] = React.useState<"device" | "log">("device");
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
        <div style={{ display: "grid", gap: 12 }}>
          {shown.devices.map((d) => (
            <DeviceCard key={d.deviceId} d={d} specTitles={specTitles} onOpenSpec={onOpenSpec}
              now={now} onOpenRemote={(dev) => { setOpenId(dev.deviceId); setPickedSession(null); }} />
          ))}
        </div>
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
    <div style={{ display: "grid", gap: 12 }}>
      {openDevice ? (
        <RemoteInstanceView device={openDevice} hubVersion={shown.hubVersion}
          sessionId={session?.sessionId} projectId={session?.projectId}
          onPickSession={(id) => setPickedSession(id)} onClose={() => setOpenId(null)} />
      ) : (
        <>
          <Tabs variant="pill"
            tabs={[{ value: "device", label: "Perangkat" }, { value: "log", label: "Log" }]}
            value={tab} onChange={(v) => setTab(v as "device" | "log")} />
          {tab === "device" ? deviceList() : <LogsPanel />}
        </>
      )}
    </div>
  );
}
