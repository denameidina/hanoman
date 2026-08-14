import React from "react";
import type { LimitsDTO, CodexLimitsDTO } from "@hanoman/shared";
// Import langsung dari file komponen, bukan barrel `../ds`: barrel meng-ekspor `Shell`, dan
// shell.tsx meng-import <LimitBadge> dari sini — lewat barrel itu jadi siklus impor.
import { ProgressBar } from "../ds/components/feedback";
import { useLimits, worstWindow, severityToken, severityTone } from "../api/limits";
import { useCodexLimits } from "../api/codex-limits";
import { usePopoverFocus } from "../ds/popover";

// Tanggal+jam absolut reset (waktu lokal browser, id-ID). Weekly reset berhari-hari ke depan —
// countdown saja tak cukup; tampilkan momen persisnya. SPEC-205.
const resetFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
function resetLabel(iso: string | null, absolute = false): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  const cd = ms <= 0 ? "reset segera" : h >= 1 ? `reset ${h}j ${m}m` : `reset ${m}m`;
  return absolute ? `${cd} · ${resetFmt.format(new Date(iso))}` : cd;
}
function agoLabel(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m <= 0 ? "baru saja" : `${m}m lalu`;
}

// Daftar window — dipakai popover badge DAN kartu Overview (satu presentasi).
// SPEC-338 · `dto` sengaja diketik longgar (LimitsDTO) supaya CodexLimitsDTO — yang identik plus
// `plan` — ikut memakainya tanpa cabang render kedua. `emptyHint` memberi teks yang benar per agen.
export function LimitWindows({ dto, emptyHint }: { dto: LimitsDTO; emptyHint?: string }) {
  if (!dto.windows.length)
    return (
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "4px 0" }}>
        {dto.status === "unavailable"
          ? emptyHint ?? "Limit tidak tersedia — Claude idle / belum login di host ini."
          : "Belum ada data limit."}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {dto.windows.map((w) => {
        const tok = severityToken(w.severity);
        return (
          <div key={w.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
                {w.label}{w.isActive ? " · aktif" : ""}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: tok.fg }}>{w.usedPct}%</span>
            </div>
            <ProgressBar value={w.usedPct} max={100} tone={severityTone(w.severity)} size="sm" />
            {w.resetsAt && (
              <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{resetLabel(w.resetsAt, w.key.startsWith("weekly"))}</span>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 2 }}>
        {dto.status === "stale" ? `stale · diperbarui ${agoLabel(dto.fetchedAt)}` : `diperbarui ${agoLabel(dto.fetchedAt)}`}
      </div>
    </div>
  );
}

// Badge top bar — self-fetch via useLimits(), tanpa props. Shell cukup merender <LimitBadge/>.
export function LimitBadge() {
  const dto = useLimits();
  const worst = worstWindow(dto.windows);
  const [open, setOpen] = React.useState(false);
  const popover = usePopoverFocus(open, () => setOpen(false), "dialog");
  const label = dto.status === "unavailable" || !worst ? "—" : `${worst.usedPct}%`;
  const tok = worst ? severityToken(worst.severity) : { fg: "var(--text-muted)", bg: "var(--bone-200)" };
  const dim = dto.status === "stale" ? 0.6 : 1;
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={popover.triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popover.panelId}
        aria-label="Limit Claude"
        title="Limit Claude"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--border-hair)",
          background: tok.bg, color: tok.fg, opacity: dim, cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tok.fg }} />
        {label}
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label="Limit Claude" tabIndex={-1}
          onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 280,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))",
          padding: 14,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Limit Claude</div>
          <LimitWindows dto={dto} />
        </div>
      )}
    </div>
  );
}

// SPEC-338 · ADR-0074 · badge limit codex — TERPISAH dari badge claude, bukan digabung. Alasannya
// bukan kosmetik: angka claude berasal dari panggilan API live tiap 30 dtk, angka codex dari
// SNAPSHOT terakhir yang codex tulis saat sesi berjalan. Satu angka "terburuk" lintas keduanya akan
// mencampur data hidup dengan data historis dan menyesatkan operator.
//
// Disembunyikan sepenuhnya saat `unavailable`: operator yang tak pernah memakai codex tak perlu
// melihat badge "—" permanen. Ia muncul sendiri begitu ada sesi codex pertama yang melaporkan kuota.
export function CodexLimitBadge() {
  const dto = useCodexLimits();
  const worst = worstWindow(dto.windows);
  const [open, setOpen] = React.useState(false);
  const popover = usePopoverFocus(open, () => setOpen(false), "dialog");
  if (dto.status === "unavailable" || !worst) return null;
  const tok = severityToken(worst.severity);
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={popover.triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popover.panelId}
        aria-label="Limit Codex"
        title="Limit Codex"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--border-hair)",
          background: tok.bg, color: tok.fg, opacity: dto.status === "stale" ? 0.6 : 1,
          cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12,
        }}
      >
        {/* Kotak (bukan titik) membedakannya sekilas dari badge claude di sebelahnya. */}
        <span style={{ width: 7, height: 7, borderRadius: 2, background: tok.fg }} />
        {worst.usedPct}%
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label="Limit Codex" tabIndex={-1}
          onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 280,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))",
          padding: 14,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>
            Limit Codex{dto.plan ? ` · plan ${dto.plan}` : ""}
          </div>
          <LimitWindows dto={dto} emptyHint="Limit codex belum terbaca — jalankan satu sesi codex dulu." />
          <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 6, lineHeight: 1.45 }}>
            Snapshot dari sesi codex terakhir — bergerak saat ada sesi codex berjalan, bukan realtime.
          </div>
        </div>
      )}
    </div>
  );
}
