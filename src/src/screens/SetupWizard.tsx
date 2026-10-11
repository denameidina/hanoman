/* SetupWizard — SPEC-884 · ADR-0139 · setup awal di browser.

   Audit UI/UX 2026-10 · Fase 3 (3N): SATU layar. Peruntukan (default "Perangkat ini") dan
   pengakuan risiko bila perlu ada di layar utama; hardening dan prasyaratnya tertutup di "Lanjutan".
   Pada setup pertama, langkah berikutnya adalah pembuatan akun di `AuthScreen`; penomoran jujur:
   "setup 1/2" di sini (akun = 2/2 di layar sesudahnya). Dari Pengaturan, tanpa akun, tak ada nomor.
   Akun tetap lahir di `AuthScreen` supaya hanya ada SATU jalur yang membuat akun
   (`POST /api/auth/setup` beserta aturan token, limiter, dan 409-nya). */
import React from "react";
import { Card, Button, Radio, RadioGroup, ProductStateIllustration } from "../ds";
import { Wordmark } from "../ds/marks";
import { api } from "../api/client";
import type { SetupStatus } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";
import "./styles/auth.css";

export function SetupWizard({ status, onDone, onCancel }: {
  status: SetupStatus; onDone: () => void;
  /** Hanya pada mode diulang (dari Pengaturan): tombol Batal menutup wizard tanpa menyimpan. */
  onCancel?: () => void;
}) {
  const firstRun = status.needed;
  // Setup pertama selalu mulai dari "Perangkat ini"; diulang dari Pengaturan, nilai yang berlaku tampil.
  const [deployment, setDeployment] = React.useState<"local" | "public">(firstRun ? "local" : status.deployment);
  const [hardening, setHardening] = React.useState(status.hardening);
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const missing = status.prerequisites.filter((p) => !p.ok);
  // Toggle tak boleh dinyalakan selama ada yang merah: menulis HANOMAN_HARDENING=1 tanpa prasyarat
  // lengkap melahirkan instance yang MENOLAK BOOT pada restart berikutnya — persis kegagalan yang
  // spec ini ada untuk mencabut, cuma dipindah dari instalasi ke tombol.
  const toggleDisabled = status.hardeningLocked || (!hardening && missing.length > 0);
  const needsAck = deployment === "public" && !hardening;
  const canSave = !busy && (!needsAck || ack);
  const saveReason = busy ? null
    : needsAck && !ack ? "Centang pernyataan risiko untuk melanjutkan tanpa hardening."
    : null;

  // Memilih "diakses orang lain" MENYODORKAN hardening — tapi tak memaksanya (keputusan operator).
  function choose(next: "local" | "public") {
    setDeployment(next);
    if (status.hardeningLocked) return;
    if (next === "public" && missing.length === 0) setHardening(true);
    if (next === "local") setHardening(false);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr("");
    try {
      await api.applySetup({ deployment, hardening, ...(needsAck ? { acknowledgedUnhardened: true } : {}) });
      onDone();
    } catch (e) {
      setErr(failureMessage("menyimpan setup", e));
      setBusy(false);
    }
  }

  // Lanjutan: apa yang dilindungi hardening, prasyaratnya, dan kenapa toggle bisa terkunci.
  const hardeningBlock = (
    <>
      <p>
        Hardening memperketat sesi agen: sesi berjalan di dalam kontainer tanpa hak root, lalu lintas
        keluar lewat proxy, dan setiap upload diperiksa pemindai. Tanpa hardening, sesi agen berjalan
        langsung di mesin ini dan satu-satunya penghalangnya adalah password akun.
      </p>
      <label className="hn-choice-target hn-setup-check">
        <input type="checkbox" checked={hardening} disabled={toggleDisabled}
          onChange={(e) => setHardening(e.target.checked)} aria-describedby="hardening-note" />
        Aktifkan hardening
      </label>
      <div id="hardening-note" className="hn-setup-hardening-note">
        {status.hardeningLocked
          ? "Hardening dipasang lewat env di host ini — dashboard tidak bisa mematikannya."
          : missing.length > 0
            ? `Belum bisa dinyalakan: selesaikan prasyarat yang belum lengkap (${missing.map((p) => p.label).join(", ")}).`
            : "Semua prasyarat lengkap."}
      </div>
      <ul className="hn-setup-prereq">
        {status.prerequisites.map((p) => (
          <li key={p.id} data-ok={p.ok ? "true" : "false"}>
            <strong>{p.ok ? "Lengkap" : "Belum"}</strong> · {p.label}{p.detail ? ` — ${p.detail}` : ""}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="hn-dynamic-viewport hn-setup-root">
      <div className="hn-setup-wrap">
        <div className="hn-auth-mark"><Wordmark /></div>
        <Card eyebrow={firstRun ? "hanoman · setup 1/2" : "hanoman · setup"} title="Instance ini untuk apa?">
          <div className="hn-setup-card">
            {firstRun && (
              <ProductStateIllustration id="PST-001" decorative className="hn-setup-illus" />
            )}
            <p className="hn-setup-lead">
              Pilihan ini hanya mengubah default dan peringatan. Tidak ada yang dipaksakan.
            </p>

            <RadioGroup aria-label="Peruntukan" value={deployment} onChange={(v) => choose(v as "local" | "public")}>
              <Radio value="local" label="Perangkat ini" description="Hanya saya yang memakai instance ini. Ini pilihan awal." />
              <Radio value="public" label="Diakses orang lain" description="Instance terbuka untuk orang lain. Hardening disarankan." />
            </RadioGroup>

            {needsAck && (
              <div className="hn-setup-warn" role="note">
                <p>Instance terbuka tanpa hardening: sesi agen berjalan langsung di mesin ini. Nyalakan hardening di Lanjutan, atau akui risikonya di bawah.</p>
                <label className="hn-choice-target hn-setup-check">
                  <input type="checkbox" aria-label="Saya paham risikonya" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  Saya paham instance ini menjalankan perintah penuh di mesin ini, dan tanpa hardening satu-satunya
                  penghalangnya adalah password akun hanoman.
                </label>
              </div>
            )}

            <details className="hn-setup-advanced">
              <summary>Lanjutan · keamanan (hardening)</summary>
              <div className="hn-setup-advanced-body">{hardeningBlock}</div>
            </details>

            {err && <div role="alert" className="hn-auth-error">{err}</div>}
            {saveReason && <p className="hn-auth-reason">{saveReason}</p>}
            <div className="hn-setup-foot">
              {onCancel && <Button variant="ghost" onClick={onCancel}>Batal</Button>}
              <Button onClick={save} disabled={!canSave} loading={busy}>
                {busy ? "Menyimpan…" : firstRun ? "Simpan & lanjut" : "Simpan"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * SPEC-884 · ADR-0139 · kalau perlindungan sebuah instance publik turun jadi satu password, keadaan
 * itu tidak boleh tak terlihat. Tak bisa ditutup permanen — ia padam saat hardening menyala.
 */
export function UnhardenedBanner({ status }: { status: SetupStatus | null }) {
  if (!status || status.deployment !== "public" || status.hardening) return null;
  return (
    <div data-testid="unhardened-banner" className="hn-unhardened">
      Instance ini terbuka tanpa hardening — sesi agen berjalan langsung di mesin ini.
    </div>
  );
}
