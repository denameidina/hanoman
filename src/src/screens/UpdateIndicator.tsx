import React from "react";
import { Icon } from "../ds/icon";
import {
  useUpdate, updateHeadline, updateBadgeLabel, updateBadgeLabelShort, updateVersionLine,
  updateRegistryLine, applyUpdate, applyRestart, applyConfirmMessage, type ApplyOutcome,
  useServerRestartedTo, reloadNoticeLabel, reloadNoticeText, reloadPage, waitForServerBack,
  isRealVersion,
} from "../api/update";
import { usePopoverFocus } from "../ds/popover";
import "./styles/panels.css";

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

export function UpdateBadge() {
  const u = useUpdate();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ t: "idle" });
  const [rPhase, setRPhase] = React.useState<Phase>({ t: "idle" });
  const popover = usePopoverFocus(open, () => setOpen(false), "dialog");
  // Versi placeholder (kosong, `0.0.0`, dev, atau bundle yang belum ter-stamp) tak punya apa pun untuk
  // disebut: pil `v0.0.0` telanjang lebih buruk daripada topbar kosong. Hanya keadaan tanpa update yang
  // disaring; pil update tetap tampil apa pun versi jalannya.
  if (!u.updateAvailable && !isRealVersion(u.currentVersion)) return null;
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
  const restart = async (confirm: boolean) => {
    setRPhase({ t: confirm ? "applying" : "asking" });
    const r: ApplyOutcome = await applyRestart(confirm);
    if (r.kind === "confirm") setRPhase({ t: "confirming", message: `Ada ${r.liveSessions} sesi berjalan. Sesi tmux tetap hidup, dashboard terputus sebentar. Mulai ulang?` });
    else if (r.kind === "accepted") {
      setRPhase({ t: "applying" });
      // Versi tak berubah → tak ada drift yang memuat ulang tab; tunggu server lalu muat ulang sendiri.
      void waitForServerBack().then((back) => {
        if (back) reloadPage();
        else setRPhase({ t: "failed", message: "Server belum kembali dalam 90 detik — periksa prosesnya lalu muat ulang halaman ini." });
      });
    } else setRPhase({ t: "failed", message: r.message });
  };
  // Keadaan tanpa update diberi nama yang menjelaskan pil `v…` (tooltip, nama aksesibel, judul popover).
  const name = u.updateAvailable ? "Update tersedia" : "Versi hanoman";
  const label = u.updateAvailable ? updateBadgeLabel(u) : `v${u.currentVersion}`;
  const labelShort = u.updateAvailable ? updateBadgeLabelShort(u) : u.currentVersion;
  return (
    <div className="hn-upd-root">
      {/* SPEC-763 · label dibungkus span supaya mobile bisa menjatuhkannya (`.hn-topbar-label`):
          pil update penuh 296px dari ~358px lebar tools, jadi ia sendirian yang memaksa topbar jadi
          tiga baris (terukur 161–211px = 19–25% viewport 844px). Kontrolnya TIDAK hilang —
          `aria-label` + `title` memikul namanya saat teksnya tak dirender, dan versinya tetap ada di
          popover. Pil versi mengikuti kontrak yang sama: di layar sempit tersisa nomornya saja. */}
      <button ref={popover.triggerRef} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-controls={open ? popover.panelId : undefined} aria-expanded={open} title={name}
        aria-label={`${name} · ${label}`}
        className={`hn-upd-pill ${u.updateAvailable ? "hn-upd-pill--update" : "hn-upd-pill--version"}`}>
        <Icon name={u.updateAvailable ? "arrow-up-circle" : "package"} size={13}
          color={u.updateAvailable ? "var(--brass-700)" : "var(--text-subtle)"} />
        <span className="hn-topbar-label">{label}</span>
        <span className="hn-topbar-label-short" aria-hidden="true">{labelShort}</span>
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label={name} tabIndex={-1}
          onKeyDown={popover.onKeyDown} className="hn-viewport-popover hn-upd-popover">
          <div className="hn-eyebrow hn-upd-eyebrow">{name}</div>
          <div className="hn-upd-headline">{updateHeadline(u)}</div>
          {u.updateAvailable && (
            <>
              <div className="hn-upd-cmd">
                <code className="hn-upd-code">{u.command}</code>
                <button onClick={copy} title="Salin perintah" className="hn-upd-btn">{copied ? "Tersalin" : "Salin"}</button>
              </div>
              {u.canApply && (
                <div className="hn-upd-block">
                  {phase.t === "idle" && (
                    <button onClick={() => void send(false)} className="hn-upd-btn hn-upd-btn--primary">Pasang &amp; mulai ulang</button>
                  )}
                  {phase.t === "asking" && (
                    <div className="hn-upd-note">Memeriksa sesi yang berjalan…</div>
                  )}
                  {phase.t === "confirming" && (
                    <>
                      <div className="hn-upd-text hn-upd-text--gap">{phase.message}</div>
                      <div className="hn-upd-row">
                        <button onClick={() => void send(true)} className="hn-upd-btn hn-upd-btn--primary">Ya, pasang</button>
                        <button onClick={() => setPhase({ t: "idle" })} className="hn-upd-btn">Batal</button>
                      </div>
                    </>
                  )}
                  {phase.t === "applying" && (
                    <div className="hn-upd-text">
                      Memasang dari npm lalu menjalankan ulang — dashboard tersambung lagi sendiri.
                    </div>
                  )}
                  {phase.t === "failed" && (
                    <>
                      <div className="hn-upd-err">{phase.message}</div>
                      <button onClick={() => setPhase({ t: "idle" })} className="hn-upd-btn">Coba lagi</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          <div className="hn-upd-note">{updateVersionLine(u)}</div>
          {u.canApply && (
            <div className="hn-upd-restart">
              {rPhase.t === "idle" && (
                <button onClick={() => void restart(false)} className="hn-upd-btn" title="Untuk server yang macet atau troubleshooting">
                  <Icon name="refresh-cw" size={12} /> Mulai ulang hanoman
                </button>
              )}
              {rPhase.t === "asking" && <div className="hn-upd-note">Memeriksa sesi yang berjalan…</div>}
              {rPhase.t === "confirming" && (
                <>
                  <div className="hn-upd-text hn-upd-text--gap">{rPhase.message}</div>
                  <div className="hn-upd-row">
                    <button onClick={() => void restart(true)} className="hn-upd-btn hn-upd-btn--primary">Ya, mulai ulang</button>
                    <button onClick={() => setRPhase({ t: "idle" })} className="hn-upd-btn">Batal</button>
                  </div>
                </>
              )}
              {rPhase.t === "applying" && (
                <div className="hn-upd-text">Menjalankan ulang — dashboard tersambung lagi sendiri.</div>
              )}
              {rPhase.t === "failed" && (
                <>
                  <div className="hn-upd-err">{rPhase.message}</div>
                  <button onClick={() => setRPhase({ t: "idle" })} className="hn-upd-btn">Coba lagi</button>
                </>
              )}
            </div>
          )}
          {!u.updateAvailable && (
            <div className="hn-upd-note hn-upd-note--gap">{updateRegistryLine(u)}</div>
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
      className="hn-upd-pill hn-upd-pill--update">
      <Icon name="refresh-cw" size={13} color="var(--brass-700)" />
      {/* SPEC-763 · label panjang dijatuhkan di topbar mobile; versinya tetap dirender karena
          ikon telanjang tak mengatakan apa pun. */}
      <span className="hn-topbar-label">{reloadNoticeLabel(version)}</span>
      <span className="hn-topbar-label-short" aria-hidden="true">{version}</span>
    </button>
  );
}
