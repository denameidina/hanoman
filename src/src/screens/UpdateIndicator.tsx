import React from "react";
import { Icon } from "../ds/icon";
import {
  useUpdate, updateHeadline, updateBadgeLabel, updateBadgeLabelShort, updateVersionLine,
  updateRegistryLine, applyUpdate, applyConfirmMessage, type ApplyOutcome,
  useServerRestartedTo, reloadNoticeLabel, reloadNoticeText, reloadPage,
} from "../api/update";
import { usePopoverFocus } from "../ds/popover";

// Badge topbar dengan dua wajah dalam satu pil (SPEC-906): saat versi sudah terkini ia pil netral
// `v<versi>` yang membuka popover ringkas, saat ada versi baru ia pil brass + popover lengkap.
// Sebelumnya ia padam total saat up-to-date — dan versi yang sedang dipakai instance ini tak tersebut
// di satu tempat pun di UI, termasuk saat operator butuh tahu update tadi benar-benar terpasang.
// SPEC-405 · ADR-0088 · bila proses server ini punya supervisor (`canApply`), popover keadaan update
// juga membawa tombol "Pasang & mulai ulang": dua langkah, karena klik pertama hanya MEMINTA laporan
// berapa sesi yang sedang berjalan. Perintah salin tetap ada di semua keadaan — ia satu-satunya jalan
// saat `canApply` false (mis. `pnpm dev` atau bundle server telanjang).
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
const pill: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
  borderRadius: "var(--radius-pill, 999px)", cursor: "pointer",
  fontFamily: "var(--font-mono)", fontSize: 12,
};
// Brass = "ada yang harus kaulakukan". Keadaan up-to-date tak meminta apa pun, jadi ia bone/hair —
// terbaca, tapi tak pernah bersaing dengan pil update yang menggantikannya di slot yang sama.
const pillUpdate: React.CSSProperties = {
  ...pill, border: "1px solid var(--brass-300, var(--border-hair))",
  background: "var(--brass-100)", color: "var(--brass-700)",
};
const pillVersion: React.CSSProperties = {
  ...pill, border: "1px solid var(--border-hair)",
  background: "var(--bone-100)", color: "var(--text-subtle)",
};

export function UpdateBadge() {
  const u = useUpdate();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ t: "idle" });
  const popover = usePopoverFocus(open, () => setOpen(false), "dialog");
  // Versi kosong (dev, atau bundle yang belum ter-stamp) tak punya apa pun untuk disebut: pil `v`
  // telanjang lebih buruk daripada topbar kosong.
  if (!u.updateAvailable && !u.currentVersion) return null;
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
  const name = u.updateAvailable ? "Update tersedia" : "Versi terpasang";
  const label = u.updateAvailable ? updateBadgeLabel(u) : `v${u.currentVersion}`;
  const labelShort = u.updateAvailable ? updateBadgeLabelShort(u) : u.currentVersion;
  return (
    <div style={{ position: "relative" }}>
      {/* SPEC-763 · label dibungkus span supaya mobile bisa menjatuhkannya (`.hn-topbar-label`):
          pil update penuh 296px dari ~358px lebar tools, jadi ia sendirian yang memaksa topbar jadi
          tiga baris (terukur 161–211px = 19–25% viewport 844px). Kontrolnya TIDAK hilang —
          `aria-label` + `title` memikul namanya saat teksnya tak dirender, dan versinya tetap ada di
          popover. Pil versi mengikuti kontrak yang sama: di layar sempit tersisa nomornya saja. */}
      <button ref={popover.triggerRef} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-controls={popover.panelId} aria-expanded={open} title={name}
        aria-label={`${name} · ${label}`}
        style={u.updateAvailable ? pillUpdate : pillVersion}>
        <Icon name={u.updateAvailable ? "arrow-up-circle" : "package"} size={13}
          color={u.updateAvailable ? "var(--brass-700)" : "var(--text-subtle)"} />
        <span className="hn-topbar-label">{label}</span>
        <span className="hn-topbar-label-short" aria-hidden="true">{labelShort}</span>
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label={name} tabIndex={-1}
          onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 320,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))", padding: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>{name}</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", marginBottom: 10 }}>{updateHeadline(u)}</div>
          {u.updateAvailable && (
            <>
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
            </>
          )}
          <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{updateVersionLine(u)}</div>
          {!u.updateAvailable && (
            <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 4 }}>{updateRegistryLine(u)}</div>
          )}
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
