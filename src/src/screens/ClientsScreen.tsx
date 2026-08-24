import React from "react";
import { Card, Badge, StateBlock } from "../ds";
import { api } from "../api/client";
import { Icon } from "../ds/icon";
import type { PresenceDeviceView, PresenceSessionView, PresenceView } from "@hanoman/shared";

/* SPEC-919 · ADR-0147 · halaman "Klien": device yang sinkron ke hub ini, dan pekerjaan yang
   sedang berjalan di masing-masing. Tak ada isi terminal di sini — menempel ke sesi klien dari
   hub sengaja di luar lingkup (butuh relay WS lintas instance + gerbang auth sendiri). */

const STATUS: Record<PresenceSessionView["status"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  working: { label: "bekerja", tone: "ok" },
  waiting: { label: "menunggu keputusan", tone: "warn" },
  exited: { label: "selesai", tone: "neutral" },
};

function sinceLabel(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} jam ${m % 60} mnt` : `${Math.floor(h / 24)} hari`;
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
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--text-strong)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title ?? s.projectId}
      </span>
      <Badge tone="neutral" size="sm" icon="box">{s.projectId}</Badge>
      {s.phase && <Badge tone="brass" size="sm">{s.phase}</Badge>}
      <Badge tone={st.tone} size="sm">{st.label}</Badge>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
        {sinceLabel(s.startedAt, now)}
      </span>
    </div>
  );
}

function DeviceCard({ d, specTitles, onOpenSpec, now }:
  { d: PresenceDeviceView; specTitles: Record<string, string>;
    onOpenSpec: (specId: string) => void; now: number }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <Icon name="monitor" size={16} color="var(--text-muted)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 500, color: "var(--text-strong)" }}>
          {d.name}
        </span>
        {d.local && <Badge tone="neutral" size="sm">hub ini</Badge>}
        <Badge data-testid={`device-state-${d.deviceId}`} size="sm" tone={d.online ? "ok" : "neutral"}>
          {d.online ? "online" : "offline"}
        </Badge>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
          terakhir terlihat {d.lastSeenAt ? sinceLabel(d.lastSeenAt, now) + " lalu" : "—"}
        </span>
      </div>
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
     tiba; tak ada polling. */
  const [fallback, setFallback] = React.useState<PresenceView | null>(null);
  const empty = view.devices.length === 0;
  React.useEffect(() => {
    if (!empty) return;
    let alive = true;
    api.presence().then((v) => { if (alive) setFallback(v); })
      .catch(() => { /* server lama: layar tetap pada keadaan kosongnya */ });
    return () => { alive = false; };
  }, [empty]);

  const shown = empty && fallback ? fallback : view;
  // Satu stempel per render: dua baris yang lahir dari render yang sama tak boleh menghitung
  // "sudah berapa lama" dari dua titik waktu berbeda.
  const now = Date.now();
  if (shown.devices.length === 0) {
    return (
      <StateBlock kind="empty" icon="monitor" title="Belum ada device"
        hint="Device muncul di sini sesudah sebuah instance hanoman menerbitkan device token dan menyinkron ke hub ini." />
    );
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {shown.devices.map((d) => (
        <DeviceCard key={d.deviceId} d={d} specTitles={specTitles} onOpenSpec={onOpenSpec} now={now} />
      ))}
    </div>
  );
}
