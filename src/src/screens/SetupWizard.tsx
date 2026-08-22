/* SetupWizard — SPEC-884 · ADR-0138 · setup awal di browser.

   DUA langkah, bukan tiga: akun pertama tetap lahir di `AuthScreen`, supaya hanya ada SATU jalur
   yang membuat akun (`POST /api/auth/setup` beserta aturan token, limiter, dan 409-nya). Urutan
   yang dilihat operator tetap peruntukan → keamanan → buat akun. */
import React from "react";
import { Card, Button, Field } from "../ds";
import { Wordmark } from "../ds/marks";
import { api } from "../api/client";
import type { SetupStatus } from "@hanoman/shared";

type Step = "purpose" | "security";

export function SetupWizard({ status, onDone }: { status: SetupStatus; onDone: () => void }) {
  const [step, setStep] = React.useState<Step>("purpose");
  const [deployment, setDeployment] = React.useState<"local" | "public">(status.deployment);
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
    } catch { setErr("Gagal menyimpan setup. Coba lagi."); setBusy(false); }
  }

  return (
    <div className="hn-dynamic-viewport" style={{ minHeight: "100dvh", display: "flex", overflowY: "auto",
      background: "var(--bone-100)", boxSizing: "border-box",
      padding: "max(24px, var(--safe-top)) max(16px, var(--safe-right)) max(24px, var(--safe-bottom)) max(16px, var(--safe-left))" }}>
      <div style={{ width: "100%", maxWidth: 460, margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Wordmark /></div>
        {step === "purpose" ? (
          <Card eyebrow="hanoman · setup 1/2" title="Instance ini untuk apa?">
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
              Pilihan ini hanya mengubah default dan peringatan. Ia tak memaksa apa pun.
            </div>
            <Field label="Peruntukan">
              <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                <input type="radio" name="deployment" aria-label="Device saya sendiri"
                  checked={deployment === "local"} onChange={() => choose("local")} />
                {" "}Device saya sendiri
              </label>
              <label style={{ display: "block", fontSize: 13 }}>
                <input type="radio" name="deployment" aria-label="Diakses orang lain"
                  checked={deployment === "public"} onChange={() => choose("public")} />
                {" "}Diakses orang lain
              </label>
            </Field>
            <Button onClick={() => setStep("security")} fullWidth>Lanjut</Button>
          </Card>
        ) : (
          <Card eyebrow="hanoman · setup 2/2" title="Keamanan">
            <Field label="Hardening">
              <label style={{ display: "block", fontSize: 13 }}>
                <input type="checkbox" aria-label="Aktifkan hardening" checked={hardening}
                  disabled={toggleDisabled} onChange={(e) => setHardening(e.target.checked)} />
                {" "}Aktifkan hardening
              </label>
            </Field>
            {status.hardeningLocked && (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
                Hardening dipasang lewat env di host ini — dashboard tak bisa mematikannya.
              </div>
            )}
            <ul style={{ fontSize: 12.5, listStyle: "none", padding: 0, margin: "0 0 14px" }}>
              {status.prerequisites.map((p) => (
                <li key={p.id} style={{ color: p.ok ? "var(--text-muted)" : "var(--status-err)", marginBottom: 4 }}>
                  {p.ok ? "✓" : "✗"} {p.label}{p.detail ? ` — ${p.detail}` : ""}
                </li>
              ))}
            </ul>
            {needsAck && (
              <label style={{ display: "block", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
                <input type="checkbox" aria-label="Saya paham risikonya" checked={ack}
                  onChange={(e) => setAck(e.target.checked)} />
                {" "}Saya paham instance ini menjalankan perintah penuh di mesin ini, dan tanpa
                hardening satu-satunya penghalangnya adalah password akun hanoman.
              </label>
            )}
            {err && <div style={{ fontSize: 12.5, color: "var(--status-err)", marginBottom: 12 }}>{err}</div>}
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
 * SPEC-884 · ADR-0138 · kalau perlindungan sebuah instance publik turun jadi satu password, keadaan
 * itu tidak boleh tak terlihat. Tak bisa ditutup permanen — ia padam saat hardening menyala.
 */
export function UnhardenedBanner({ status }: { status: SetupStatus | null }) {
  if (!status || status.deployment !== "public" || status.hardening) return null;
  return (
    <div data-testid="unhardened-banner" style={{
      background: "var(--status-warn-bg, #fff4e0)", color: "var(--text-strong, #3a2c12)",
      fontSize: 12.5, padding: "6px 14px", borderBottom: "1px solid var(--rule)",
    }}>
      Instance ini terbuka tanpa hardening — sesi agen berjalan langsung di mesin ini.
    </div>
  );
}
