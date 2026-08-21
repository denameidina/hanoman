import React from "react";
import { Icon } from "../ds/icon";
import {
  useUpdate, updateHeadline, updateBadgeLabel, updateBadgeLabelShort, updateVersionLine,
  applyUpdate, applyConfirmMessage, type ApplyOutcome,
  useServerRestartedTo, reloadNoticeLabel, reloadNoticeText, reloadPage,
} from "../api/update";
import { usePopoverFocus } from "../ds/popover";

// Badge topbar — muncul HANYA saat updateAvailable (up-to-date: tanpa noise). Klik → popover berisi
// versi baru + perintah update (Salin).
// SPEC-405 · ADR-0088 · bila proses server ini punya supervisor (`canApply`), popover juga membawa
// tombol "Pasang & mulai ulang": dua langkah, karena klik pertama hanya MEMINTA laporan berapa sesi
// yang sedang berjalan. Perintah salin tetap ada di semua keadaan — ia satu-satunya jalan saat
// `canApply` false (mis. `pnpm dev` atau bundle server telanjang).
type Phase =
  | { t: "idle" }
  | { t: "asking" }
  | { t: "confirming"; message: string }
  | { t: "applying" }
  | { t: "failed"; message: string };

const btn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hair)",
  background: "var(--bone-100)", cursor: "pointer", fontSize: 11,
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--brass-100)", color: "var(--brass-700)",
  border: "1px solid var(--brass-300, var(--border-hair))",
};

export function UpdateBadge() {
  const u = useUpdate();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ t: "idle" });
  const popover = usePopoverFocus(open, () => setOpen(false), "dialog");
  if (!u.updateAvailable) return null;
  const copy = () => {
    try { void navigator.clipboard?.writeText(u.command); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard tak tersedia */ }
  };
  const send = async (confirm: boolean) => {
    setPhase({ t: confirm ? "applying" : "asking" });
    const r: ApplyOutcome = await applyUpdate(confirm);
    if (r.kind === "confirm") setPhase({ t: "confirming", message: applyConfirmMessage(r.liveSessions) });
    else if (r.kind === "accepted") setPhase({ t: "applying" });
    else setPhase({ t: "failed", message: r.message });
  };
  return (
    <div style={{ position: "relative" }}>
      {/* SPEC-763 · label dibungkus span supaya mobile bisa menjatuhkannya (`.hn-topbar-label`):
          pil ini 296px dari ~358px lebar tools, jadi ia sendirian yang memaksa topbar jadi tiga baris
          (terukur 161–211px = 19–25% viewport 844px). Kontrolnya TIDAK hilang — `aria-label` +
          `title` memikul namanya saat teksnya tak dirender, dan versinya tetap ada di popover. */}
      <button ref={popover.triggerRef} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-controls={popover.panelId} aria-expanded={open} title="Update tersedia"
        aria-label={`Update tersedia · ${updateBadgeLabel(u)}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--brass-300, var(--border-hair))",
          background: "var(--brass-100)", color: "var(--brass-700)", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <Icon name="arrow-up-circle" size={13} color="var(--brass-700)" />
        <span className="hn-topbar-label">{updateBadgeLabel(u)}</span>
        <span className="hn-topbar-label-short" aria-hidden="true">{updateBadgeLabelShort(u)}</span>
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label="Update tersedia" tabIndex={-1}
          onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 320,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))", padding: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Update tersedia</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", marginBottom: 10 }}>{updateHeadline(u)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bone-100)",
              padding: "6px 8px", borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "nowrap" }}>{u.command}</code>
            <button onClick={copy} title="Salin perintah" style={btn}>{copied ? "Tersalin" : "Salin"}</button>
          </div>
          {u.canApply && (
            <div style={{ marginBottom: 8 }}>
              {phase.t === "idle" && (
                <button onClick={() => void send(false)} style={btnPrimary}>Pasang &amp; mulai ulang</button>
              )}
              {phase.t === "asking" && (
                <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>Memeriksa sesi yang berjalan…</div>
              )}
              {phase.t === "confirming" && (
                <>
                  <div style={{ fontSize: 11, color: "var(--text-body)", marginBottom: 8 }}>{phase.message}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => void send(true)} style={btnPrimary}>Ya, pasang</button>
                    <button onClick={() => setPhase({ t: "idle" })} style={btn}>Batal</button>
                  </div>
                </>
              )}
              {phase.t === "applying" && (
                <div style={{ fontSize: 11, color: "var(--text-body)" }}>
                  Memasang dari npm lalu menjalankan ulang — dashboard tersambung lagi sendiri.
                </div>
              )}
              {phase.t === "failed" && (
                <>
                  <div style={{ fontSize: 11, color: "var(--status-err-text, var(--text-body))", marginBottom: 8 }}>{phase.message}</div>
                  <button onClick={() => setPhase({ t: "idle" })} style={btn}>Coba lagi</button>
                </>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{updateVersionLine(u)}</div>
        </div>
      )}
    </div>
  );
}

// SPEC-868 · pasangan UpdateBadge untuk arah sebaliknya: bukan "server ketinggalan npm", melainkan
// "tab ini ketinggalan server". Keduanya menghuni slot topbar yang sama dan hampir tak pernah muncul
// bersamaan — begitu update terpasang, UpdateBadge padam dan justru DI SITU tab jadi basi.
export function ReloadBadge() {
  const version = useServerRestartedTo();
  if (!version) return null;
  return (
    <button onClick={reloadPage} title={reloadNoticeText(version)} aria-label={reloadNoticeLabel(version)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
        borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--brass-300, var(--border-hair))",
        background: "var(--brass-100)", color: "var(--brass-700)", cursor: "pointer",
        fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <Icon name="refresh-cw" size={13} color="var(--brass-700)" />
      {/* SPEC-763 · label panjang dijatuhkan di topbar mobile; versinya tetap dirender karena
          ikon telanjang tak mengatakan apa pun. */}
      <span className="hn-topbar-label">{reloadNoticeLabel(version)}</span>
      <span className="hn-topbar-label-short" aria-hidden="true">{version}</span>
    </button>
  );
}
