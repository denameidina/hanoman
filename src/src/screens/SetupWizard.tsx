/* SetupWizard — SPEC-884 · ADR-0139 · setup awal di browser.

   Dua langkah di wizard ini; pada setup pertama ada langkah ketiga — pembuatan akun di
   `AuthScreen`. Akun pertama tetap lahir di sana supaya hanya ada SATU jalur yang membuat akun
   (`POST /api/auth/setup` beserta aturan token, limiter, dan 409-nya). Penomoran jujur:
   "1/3, 2/3" pada setup pertama; "1/2, 2/2" saat diulang dari Pengaturan (tanpa akun). */
import React from "react";
import { Card, Button, Field } from "../ds";
import { Wordmark } from "../ds/marks";
import { api } from "../api/client";
import type { SetupStatus } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";

type Step = "purpose" | "security";

export function SetupWizard({ status, onDone, onCancel }: {
  status: SetupStatus; onDone: () => void;
  /** Hanya pada mode diulang (dari Pengaturan): tombol Batal menutup wizard tanpa menyimpan. */
  onCancel?: () => void;
}) {
  const [step, setStep] = React.useState<Step>("purpose");
  const [deployment, setDeployment] = React.useState<"local" | "public">(status.deployment);
  const [hardening, setHardening] = React.useState(status.hardening);
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const firstRun = status.needed;
  const total = firstRun ? 3 : 2;
  const stepNo = step === "purpose" ? 1 : 2;

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

  // Blok hardening: apa yang dilindungi, prasyaratnya, dan kenapa toggle bisa terkunci.
  const hardeningBlock = (
    <>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Hardening mengharuskan prasyarat di bawah terpenuhi: sesi agen berjalan di dalam kontainer rootless,
        lalu lintas keluar lewat proxy, dan upload diperiksa pemindai. Tanpa hardening, sesi agen berjalan
        langsung di mesin ini dan satu-satunya penghalang adalah password akun.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
        <input type="checkbox" checked={hardening} disabled={toggleDisabled}
          onChange={(e) => setHardening(e.target.checked)} aria-describedby="hardening-note" />
        Aktifkan hardening
      </label>
      <div id="hardening-note" style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        {status.hardeningLocked
          ? "Hardening dipasang lewat env di host ini — dashboard tak bisa mematikannya."
          : missing.length > 0
            ? `Belum bisa dinyalakan: selesaikan prasyarat yang belum lengkap (${missing.map((p) => p.label).join(", ")}).`
            : "Semua prasyarat lengkap."}
      </div>
      <ul style={{ fontSize: 12.5, listStyle: "none", padding: 0, margin: "0 0 4px" }}>
        {status.prerequisites.map((p) => (
          <li key={p.id} style={{ color: p.ok ? "var(--text-muted)" : "var(--clay-600)", marginBottom: 4 }}>
            <strong style={{ fontWeight: 600 }}>{p.ok ? "Lengkap" : "Belum"}</strong> · {p.label}{p.detail ? ` — ${p.detail}` : ""}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="hn-dynamic-viewport" style={{ minHeight: "100dvh", display: "flex", overflowY: "auto",
      background: "var(--bone-100)", boxSizing: "border-box",
      padding: "max(24px, var(--safe-top)) max(16px, var(--safe-right)) max(24px, var(--safe-bottom)) max(16px, var(--safe-left))" }}>
      <div style={{ width: "100%", maxWidth: 460, margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Wordmark /></div>
        {step === "purpose" ? (
          <Card eyebrow={`hanoman · setup ${stepNo}/${total}`} title="Instance ini untuk apa?">
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
              Pilihan ini hanya mengubah default dan peringatan. Ia tak memaksa apa pun.
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px", minWidth: 0 }}>
              <legend style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)", marginBottom: 8, padding: 0 }}>Peruntukan</legend>
              <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                <input type="radio" name="deployment" aria-label="Perangkat ini" aria-describedby="dep-local"
                  checked={deployment === "local"} onChange={() => choose("local")} />
                {" "}Perangkat ini
                <span id="dep-local" style={{ display: "block", marginLeft: 22, fontSize: 12, color: "var(--text-muted)" }}>Hanya saya yang memakai instance ini.</span>
              </label>
              <label style={{ display: "block", fontSize: 13 }}>
                <input type="radio" name="deployment" aria-label="Diakses orang lain" aria-describedby="dep-public"
                  checked={deployment === "public"} onChange={() => choose("public")} />
                {" "}Diakses orang lain
                <span id="dep-public" style={{ display: "block", marginLeft: 22, fontSize: 12, color: "var(--text-muted)" }}>Instance terbuka untuk orang lain; hardening disarankan.</span>
              </label>
            </fieldset>
            <div style={{ display: "flex", gap: 8 }}>
              {onCancel && <Button variant="ghost" onClick={onCancel}>Batal</Button>}
              <Button onClick={() => setStep("security")} style={{ flex: 1, justifyContent: "center" }}>Lanjut</Button>
            </div>
          </Card>
        ) : (
          <Card eyebrow={`hanoman · setup ${stepNo}/${total}`} title="Keamanan">
            {deployment === "public" ? (
              <div style={{ marginBottom: 14 }}>{hardeningBlock}</div>
            ) : (
              <details style={{ marginBottom: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--text-muted)" }}>Lanjutan · hardening</summary>
                <div style={{ paddingTop: 10 }}>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                    Instance untuk device sendiri tidak memerlukan hardening. Buka bagian ini hanya bila instance akan diakses orang lain.
                  </div>
                  {hardeningBlock}
                </div>
              </details>
            )}
            {needsAck && (
              <label style={{ display: "block", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
                <input type="checkbox" aria-label="Saya paham risikonya" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                {" "}Saya paham instance ini menjalankan perintah penuh di mesin ini, dan tanpa
                hardening satu-satunya penghalangnya adalah password akun hanoman.
              </label>
            )}
            {err && <div role="alert" style={{ fontSize: 12.5, color: "var(--clay-600)", background: "var(--status-err-tint)",
              border: "1px solid var(--clay-500)", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 12 }}>{err}</div>}
            {saveReason && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{saveReason}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={() => setStep("purpose")}>Kembali</Button>
              <Button onClick={save} disabled={!canSave}
                style={{ flex: 1, justifyContent: "center" }}>
                {busy ? "Menyimpan…" : "Simpan & lanjut"}
              </Button>
            </div>
          </Card>
        )}
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
    <div data-testid="unhardened-banner" style={{
      background: "var(--status-warn-tint)", color: "var(--text-strong)",
      fontSize: 12.5, padding: "6px 14px", borderBottom: "1px solid var(--border-hair)",
    }}>
      Instance ini terbuka tanpa hardening — sesi agen berjalan langsung di mesin ini.
    </div>
  );
}
