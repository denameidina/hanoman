/* AuthScreen — login + setup akun pertama (SPEC-169). Layar penuh, bone-paper.
   needsSetup=true → buat akun pertama (password min 8); else → masuk. */
import React from "react";
import { Card, Button, Input, Field, ProductStateIllustration } from "../ds";
import { Wordmark } from "../ds/marks";
import { api, ApiError } from "../api/client";
import type { UserView } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";

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

export function AuthScreen({ needsSetup, setupTokenRequired = false, setupTokenPath, onDone }: {
  needsSetup: boolean; setupTokenRequired?: boolean; setupTokenPath?: string; onDone: (u: UserView) => void;
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

  return (
    <div data-testid="auth-scroll" className="hn-dynamic-viewport" style={{ minHeight: "100dvh", height: "100dvh", display: "flex",
      overflowY: "auto", background: "var(--bone-100)", boxSizing: "border-box",
      padding: "max(24px, var(--safe-top)) max(16px, var(--safe-right)) max(24px, var(--safe-bottom)) max(16px, var(--safe-left))" }}>
      <div style={{ width: "100%", maxWidth: 380, margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Wordmark /></div>
        <Card eyebrow={needsSetup ? "hanoman · setup" : "hanoman · masuk"}
          title={needsSetup ? "Buat akun pertama" : "Masuk"}>
          <ProductStateIllustration id="PST-001" priority
            style={{ width: "100%", maxHeight: 184, marginBottom: 14, borderRadius: "var(--radius-md)" }} />
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
            {needsSetup
              ? "Belum ada akun. Akun pertama ini yang bisa mengundang user lain."
              : "Masuk dengan email dan password."}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label="Email">
              <Input type="email" autoComplete={needsSetup ? "email" : "username"} value={email} placeholder="mis. kamu@nafanesia.id"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} style={{ width: "100%" }} />
            </Field>
            <Field label="Password" hint={needsSetup ? "minimal 8 karakter" : undefined}>
              <Input type="password" autoComplete={needsSetup ? "new-password" : "current-password"}
                value={password} placeholder="••••••••"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} style={{ width: "100%" }} />
            </Field>
            {needsToken && (
              <Field label="Setup token"
                hint={`Ada di ${setupTokenPath ?? DEFAULT_SETUP_TOKEN_PATH} pada host server (berkas setup.token di folder HANOMAN_HOME).`}>
                <Input type="password" autoComplete="off" value={setupToken} placeholder="••••••••"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSetupToken(e.target.value)} style={{ width: "100%" }} />
              </Field>
            )}
            {err && (
              <div role="alert" style={{ fontSize: 12.5, color: "var(--clay-600)", background: "var(--status-err-tint)",
                border: "1px solid var(--clay-500)", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 12 }}>
                {err}
              </div>
            )}
            {!canSubmit && blockReason && (
              <div id="auth-block-reason" style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{blockReason}</div>
            )}
            <Button type="submit" leftIcon={needsSetup ? "user-plus" : "log-in"} disabled={!canSubmit || busy}
              style={{ width: "100%", justifyContent: "center" }}>
              {busy ? "Memproses…" : needsSetup ? "Buat akun & masuk" : "Masuk"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
