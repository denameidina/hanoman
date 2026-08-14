/* AuthScreen — login + setup akun pertama (SPEC-169). Layar penuh, bone-paper.
   needsSetup=true → buat akun pertama (password min 8); else → masuk. */
import React from "react";
import { Card, Button, Input, Field, ProductStateIllustration } from "../ds";
import { Wordmark } from "../ds/marks";
import { api, ApiError } from "../api/client";
import type { UserView } from "@hanoman/shared";

export function AuthScreen({ needsSetup, onDone }: { needsSetup: boolean; onDone: (u: UserView) => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const canSubmit = /\S+@\S+\.\S+/.test(email) && password.length >= (needsSetup ? 8 : 1);

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true); setErr("");
    try {
      const { user } = await (needsSetup ? api.setup({ email, password }) : api.login({ email, password }));
      onDone(user);
    } catch (e) {
      setErr(needsSetup
        ? (e instanceof ApiError && e.status === 409 ? "Sudah ada akun — silakan masuk." : "Gagal membuat akun. Password minimal 8 karakter.")
        : "Email atau password salah.");
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
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="Email">
              <Input type="email" autoComplete="username" value={email} placeholder="kamu@nafanesia.id"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} style={{ width: "100%" }} />
            </Field>
            <Field label="Password" hint={needsSetup ? "minimal 8 karakter" : undefined}>
              <Input type="password" autoComplete={needsSetup ? "new-password" : "current-password"}
                value={password} placeholder="••••••••"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} style={{ width: "100%" }} />
            </Field>
            {err && <div style={{ fontSize: 12.5, color: "var(--status-err)", marginBottom: 12 }}>{err}</div>}
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
