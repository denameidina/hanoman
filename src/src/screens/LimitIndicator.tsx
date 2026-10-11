import React from "react";
import type { LimitsDTO } from "@hanoman/shared";
// Import langsung dari file komponen, bukan barrel `../ds`: barrel meng-ekspor `Shell`, dan
// shell.tsx meng-import <LimitBadge> dari sini — lewat barrel itu jadi siklus impor.
import { useLimits, worstWindow, severityToken } from "../api/limits";
import { useCodexLimits } from "../api/codex-limits";
import { usePopoverFocus } from "../ds/popover";
import { useCoarsePointer } from "../ds/responsive";

// Tanggal+jam absolut reset (waktu lokal browser, id-ID). Weekly reset berhari-hari ke depan —
// countdown saja tak cukup; tampilkan momen persisnya. SPEC-205.
const resetFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
function resetLabel(iso: string | null, absolute = false): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  const cd = ms <= 0 ? "reset segera" : h >= 1 ? `reset dalam ${h} jam ${m} menit` : `reset dalam ${m} menit`;
  return absolute ? `${cd} · ${resetFmt.format(new Date(iso))}` : cd;
}
function agoLabel(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m <= 0) return "baru saja";
  return m < 60 ? `${m} menit lalu` : `${Math.round(m / 60)} jam lalu`;
}

// Severity selalu ditulis sebagai kata, bukan hanya warna (aturan a11y: warna bukan satu-satunya pembeda).
type Severity = Parameters<typeof severityToken>[0];
const SEVERITY_WORD: Record<string, string> = { normal: "aman", warning: "peringatan", critical: "kritis" };
const severityWord = (s: string) => SEVERITY_WORD[s] ?? "tidak diketahui";

// Meter satu window. Memakai token severity DS; `role="progressbar"` memegang nama dan teks nilainya
// sendiri (DS ProgressBar meneruskan atribut ke pembungkus, bukan ke elemen progressbar-nya).
function WindowMeter({ label, pct, severity }: { label: string; pct: number; severity: Severity }) {
  const tok = severityToken(severity);
  const shown = Math.round(pct);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}
      aria-valuetext={`${shown}% terpakai, ${severityWord(severity)}`}
      style={{ height: 5, background: "var(--bone-300)", borderRadius: "var(--radius-pill)", overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: tok.fg,
        borderRadius: "var(--radius-pill)" }} />
    </div>
  );
}

// Daftar window — dipakai popover badge DAN kartu Overview (satu presentasi).
// SPEC-338 · `dto` sengaja diketik longgar (LimitsDTO) supaya CodexLimitsDTO — yang identik plus
// `plan` — ikut memakainya tanpa cabang render kedua. `emptyHint` memberi teks yang benar per agen.
export function LimitWindows({ dto, emptyHint }: { dto: LimitsDTO; emptyHint?: string }) {
  if (!dto.windows.length)
    return (
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "4px 0" }}>
        {dto.status === "unavailable"
          ? emptyHint ?? "Limit belum terbaca — Claude belum dipakai atau belum login di host ini."
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
              <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: tok.fg }}>{w.usedPct}%</span>
                <span style={{ fontSize: "var(--text-xs)", color: tok.fg }}>{severityWord(w.severity)}</span>
              </span>
            </div>
            <WindowMeter label={w.label} pct={w.usedPct} severity={w.severity} />
            {w.resetsAt && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>{resetLabel(w.resetsAt, w.key.startsWith("weekly"))}</span>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 2 }}>
        {dto.status === "stale"
          ? `Data lama · terakhir diperbarui ${agoLabel(dto.fetchedAt)}`
          : `Diperbarui ${agoLabel(dto.fetchedAt)}`}
      </div>
    </div>
  );
}

// SPEC-338 · Satu pil + popover untuk SEMUA limit (Claude & Codex). Dua agen tetap dua pil terpisah:
// angkanya datang dari sumber yang berbeda (Claude: panggilan live; Codex: snapshot sesi terakhir),
// jadi satu angka "terburuk" lintas keduanya akan mencampur data hidup dengan data historis.
function LimitPill({ title, dto, square = false, emptyHint, eyebrow, footnote }: {
  title: string; dto: LimitsDTO; square?: boolean; emptyHint?: string; eyebrow?: string; footnote?: React.ReactNode;
}) {
  const worst = worstWindow(dto.windows);
  const [open, setOpen] = React.useState(false);
  const popover = usePopoverFocus(open, () => setOpen(false), "dialog");
  // Pil di layar sentuh minimal 44 px tingginya (token --touch-target); inline style tak bisa
  // membaca media query, jadi pointer kasar dideteksi langsung.
  const coarse = useCoarsePointer();
  const known = !!worst && dto.status !== "unavailable";
  const tok = known && worst ? severityToken(worst.severity) : { fg: "var(--text-muted)", bg: "var(--bone-200)" };
  const stale = dto.status === "stale";
  // Nama aksesibel memuat persen + status; teks visibelnya ikut menampilkan keduanya.
  const state = !known || !worst
    ? "belum terbaca"
    : `${worst.usedPct}% terpakai, ${severityWord(worst.severity)}${stale ? ", data lama" : ""}`;
  const visible = !known || !worst
    ? "—"
    : `${worst.usedPct}% · ${severityWord(worst.severity)}${stale ? " · lama" : ""}`;
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={popover.triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popover.panelId}
        aria-label={`${title}, ${state}`}
        title={title}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          minHeight: coarse ? 44 : undefined,
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--border-hair)",
          background: tok.bg, color: tok.fg, cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        }}
      >
        {/* Bentuk membedakan agen sekilas: titik untuk Claude, kotak untuk Codex. */}
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: square ? 2 : 999, background: tok.fg }} />
        {visible}
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label={title} tabIndex={-1}
          onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 280,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
          padding: 14,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>{eyebrow ?? title}</div>
          <LimitWindows dto={dto} emptyHint={emptyHint} />
          {footnote && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 6, lineHeight: 1.45 }}>{footnote}</div>}
        </div>
      )}
    </div>
  );
}

// Pil limit Claude — self-fetch via useLimits(), tanpa props. Shell cukup merender <LimitBadge/>.
export function LimitBadge() {
  const dto = useLimits();
  return <LimitPill title="Limit Claude" dto={dto} />;
}

// SPEC-338 · ADR-0074 · pil limit Codex — TERPISAH dari pil Claude (lihat LimitPill).
// Disembunyikan sepenuhnya saat `unavailable`: operator yang tak pernah memakai Codex tak perlu
// melihat pil "—" permanen. Ia muncul sendiri begitu ada sesi Codex pertama yang melaporkan kuota.
export function CodexLimitBadge() {
  const dto = useCodexLimits();
  if (dto.status === "unavailable" || !worstWindow(dto.windows)) return null;
  return (
    <LimitPill title="Limit Codex" dto={dto} square
      emptyHint="Limit Codex belum terbaca. Jalankan satu sesi Codex dulu."
      eyebrow={`Limit Codex${dto.plan ? ` · paket ${dto.plan}` : ""}`}
      footnote="Dibaca dari sesi Codex terakhir. Nilainya berubah saat sesi Codex berjalan, tidak realtime." />
  );
}
