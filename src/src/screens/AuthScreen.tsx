/* AuthScreen — login + setup akun pertama (SPEC-169). Layar penuh, bone-paper.
   needsSetup=true → buat akun pertama (password min 8); else → masuk.
   Audit UI/UX 2026-10 · Fase 3 (3N): tombol nonaktif selalu menyebut alasannya; ilustrasi kecil
   hanya di setup; penomoran "setup 2/2" hanya bila layar induk memberi `setupStep` (wizard tadi
   tampil). Tampilan dipindah ke `screens/styles/auth.css`. */
import React from "react";
import { Card, Button, Input, Field, ProductStateIllustration } from "../ds";
import { Wordmark } from "../ds/marks";
import { api, ApiError } from "../api/client";
import type { UserView } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";
import "./styles/auth.css";

// Path default setup.token (server menulisnya di `${HANOMAN_HOME}/setup.token`, HANOMAN_HOME
// default ~/.hanoman). Dipakai bila server tak mengirim lokasi konkretnya.
const DEFAULT_SETUP_TOKEN_PATH = "~/.hanoman/setup.token";

// Respons 400 setup membawa `error.fieldErrors` dari zod (`flatten()` di routes/auth.ts). Bidang yang
// salah terbaca dari sana, jadi pesannya menyebut bidang itu, bukan menebak penyebabnya.
function setupFieldProblem(detail: unknown): string | null {
  const fe = (detail as { error?: { fieldErrors?: Record<string, string[] | undefined> } } | null)?.error?.fieldErrors;
  if (!fe) return null;
  const parts: string[] = [];
  if (fe.email?.length) parts.push("Format email belum valid.");
  if (fe.password?.length) parts.push("Password minimal 8 karakter.");
  if (fe.setupToken?.length) parts.push("Setup token belum diisi.");
  return parts.length > 0 ? parts.join(" ") : null;
}

// Galat dipisah per penyebab — "Email atau password salah" untuk semua kegagalan membuat
// operator menebak. Kode status server diterjemahkan di sini; teks mentahnya tak ditampilkan.
export function authErrorMessage(e: unknown, needsSetup: boolean): string {
  if (e instanceof ApiError) {
    if (needsSetup) {
      if (e.status === 409) return "Akun sudah ada. Silakan masuk.";
      if (e.status === 429) return "Terlalu banyak percobaan membuat akun. Tunggu sebentar, lalu coba lagi.";
      if (e.status === 403) return "Setup token salah. Salin ulang isinya dari berkas setup.token di host server.";
      if (e.status === 400) return setupFieldProblem(e.detail) ?? "Data akun belum valid. Periksa email dan password, lalu coba lagi.";
    } else {
      if (e.status === 401) return "Email atau password salah.";
      if (e.status === 429) return "Terlalu banyak percobaan masuk. Tunggu sebentar, lalu coba lagi.";
    }
    return failureMessage(needsSetup ? "membuat akun" : "masuk", e);
  }
  // Bukan respons HTTP sama sekali (fetch gagal): penyebabnya jaringan, bukan kredensial.
  return "Tidak bisa terhubung ke server. Periksa koneksi, lalu coba lagi.";
}

export function AuthScreen({ needsSetup, setupTokenRequired = false, setupTokenPath, setupStep, onDone }: {
  needsSetup: boolean; setupTokenRequired?: boolean; setupTokenPath?: string;
  /** Hanya bila wizard setup tadi tampil di depan layar ini: layar ini adalah langkah ke-2 dari 2. */
  setupStep?: 2;
  onDone: (u: UserView) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [setupToken, setSetupToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  // SPEC-884 · ADR-0139 · sebelum ini form mengunci tombol setiap kali `needsSetup` benar, tanpa
  // pernah membaca `setupTokenRequired` yang sudah dikirim /auth/status — jadi walau server tak
  // meminta token, akun pertama TAK BISA dibuat dari UI. Server tetap otoritasnya; ini cuma cermin.
  const needsToken = needsSetup && setupTokenRequired;
  const emailOk = /\S+@\S+\.\S+/.test(email);
  const minPassword = needsSetup ? 8 : 1;
  const canSubmit = emailOk && password.length >= minPassword && (!needsToken || setupToken.trim().length > 0);
  // Alasan tombol nonaktif ditampilkan — tombol mati tanpa penjelasan dianggap rusak.
  const blockReason = !emailOk ? "Isi email yang valid."
    : password.length < minPassword ? (needsSetup ? "Password minimal 8 karakter." : "Isi password.")
    : needsToken && !setupToken.trim() ? "Isi setup token dari host server."
    : null;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true); setErr("");
    try {
      const { user } = await (needsSetup
        ? api.setup(needsToken ? { email, password, setupToken: setupToken.trim() } : { email, password })
        : api.login({ email, password }));
      onDone(user);
    } catch (e) {
      setErr(authErrorMessage(e, needsSetup));
      setBusy(false);
    }
  }

  const eyebrow = needsSetup ? (setupStep ? `hanoman · setup ${setupStep}/2` : "hanoman · setup") : "hanoman · masuk";

  return (
    <div data-testid="auth-scroll" className="hn-dynamic-viewport" style={{ minHeight: "100dvh", height: "100dvh", display: "flex",
      overflowY: "auto", background: "var(--bone-100)", boxSizing: "border-box",
      padding: "max(24px, var(--safe-top)) max(16px, var(--safe-right)) max(24px, var(--safe-bottom)) max(16px, var(--safe-left))" }}>
      <div className="hn-auth-wrap">
        <div className="hn-auth-mark"><Wordmark /></div>
        <Card eyebrow={eyebrow} title={needsSetup ? "Buat akun pertama" : "Masuk"}>
          {needsSetup && (
            <ProductStateIllustration id="PST-001" priority decorative className="hn-auth-illus" />
          )}
          <p className="hn-auth-lead">
            {needsSetup
              ? "Akun pertama ini yang bisa mengundang orang lain ke hanoman."
              : "Masuk dengan email dan password akun Anda."}
          </p>
          <form className="hn-auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label="Email">
              <Input type="email" size="lg" autoComplete={needsSetup ? "email" : "username"} value={email}
                placeholder="mis. kamu@nafanesia.id" className="hn-auth-input"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" hint={needsSetup ? "Minimal 8 karakter." : undefined}>
              <Input type="password" size="lg" autoComplete={needsSetup ? "new-password" : "current-password"}
                value={password} placeholder="••••••••" className="hn-auth-input"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
            </Field>
            {needsToken && (
              <Field label="Setup token"
                hint={`Ada di berkas ${setupTokenPath ?? DEFAULT_SETUP_TOKEN_PATH} pada komputer tempat hanoman berjalan. Salin isinya ke sini.`}>
                <Input type="password" size="lg" autoComplete="off" value={setupToken} placeholder="••••••••"
                  className="hn-auth-input"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSetupToken(e.target.value)} />
              </Field>
            )}
            {err && <div role="alert" className="hn-auth-error">{err}</div>}
            {!canSubmit && blockReason && (
              <p id="auth-block-reason" className="hn-auth-reason">{blockReason}</p>
            )}
            <Button type="submit" size="lg" leftIcon={needsSetup ? "user-plus" : "log-in"} disabled={!canSubmit || busy}
              loading={busy} fullWidth className="hn-auth-submit">
              {busy ? "Memproses…" : needsSetup ? "Buat akun & masuk" : "Masuk"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
