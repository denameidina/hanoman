import React from "react";
import type { ClientAccountView } from "@hanoman/shared";
import { Button, Card, Checkbox, Field, Input, StateBlock, StatusPill } from "../ds";
import { api } from "../api/client";

// SPEC-617 · ADR-0110 · layar admin "Akses klien". Berkasnya sendiri: SettingsScreen.tsx sudah
// ~80 KB, dan panel ini punya state serta siklus datanya sendiri.

export function ClientAccessPanel() {
  const [accounts, setAccounts] = React.useState<ClientAccountView[] | null>(null);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const reload = React.useCallback(() =>
    api.listClientAccounts().then((r) => setAccounts(r.items)).catch(() => setAccounts([])), []);

  React.useEffect(() => {
    void reload();
    void api.listProjects().then((r) => setProjects(r.items.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, [reload]);

  const create = async () => {
    setErr(null);
    try {
      await api.createClientAccount({ email, password, projects: picked });
      setEmail(""); setPassword(""); setPicked([]);
      await reload();
    } catch { setErr("Gagal membuat akun — periksa email (mungkin sudah dipakai) dan panjang password."); }
  };

  const patch = async (id: string, input: Parameters<typeof api.updateClientAccount>[1]) => {
    await api.updateClientAccount(id, input);
    await reload();
  };
  const remove = async (id: string) => { await api.deleteClientAccount(id); await reload(); };

  const withProject = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((v) => v !== id);

  return (
    <>
      <Card eyebrow="akses" title="Buat akun klien">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Akun klien melihat <b>daftar backlog</b> dan <b>tiket help desk</b> project yang dipilih —
          baca-saja, tanpa terminal, dokumen internal, maupun setelan. Ia tak pernah melihat dashboard
          operator.
        </div>
        <Field label="Email klien">
          <Input aria-label="Email klien" placeholder="mis. budi@tokomekar.co.id"
            value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password awal"
          hint="Minimal 8 karakter. Sampaikan lewat kanal yang aman — klien bisa menggantinya sendiri.">
          <Input aria-label="Password awal" type="password" placeholder="mis. kunci-tokomekar-2026"
            value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
        </Field>
        <Field label="Project yang boleh dilihat">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {projects.map((p) => (
              <Checkbox key={p.id} aria-label={`Beri akses ${p.name}`} label={p.name}
                checked={picked.includes(p.id)}
                onChange={(on) => setPicked((cur) => withProject(cur, p.id, on))} />
            ))}
          </div>
        </Field>
        {err && <div style={{ color: "var(--status-err)", fontSize: "var(--text-sm)", marginBottom: 10 }}>{err}</div>}
        <Button size="sm" leftIcon="user-plus" onClick={create}
          disabled={!email || password.length < 8}>Buat akun</Button>
      </Card>

      <Card eyebrow="akses" title="Akun klien">
        {accounts === null ? <StateBlock kind="loading" title="Memuat…" />
          : accounts.length === 0
            ? <StateBlock kind="empty" icon="users" title="Belum ada akun klien"
                hint="Buat akun di atas, lalu pilih project yang boleh ia lihat." />
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {accounts.map((a) => (
                  <div key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                    padding: "12px 0", borderBottom: "1px solid var(--border-hair)",
                  }}>
                    <span style={{ fontWeight: 500, color: "var(--text-strong)" }}>{a.email}</span>
                    <StatusPill status={a.disabled ? "stopped" : "done"} size="sm">
                      {a.disabled ? "nonaktif" : "aktif"}
                    </StatusPill>
                    <div style={{ flex: 1, minWidth: 240, display: "flex", flexWrap: "wrap", gap: 14 }}>
                      {projects.map((p) => (
                        <Checkbox key={p.id} aria-label={`${a.email} · ${p.name}`} label={p.name}
                          checked={a.projects.includes(p.id)}
                          onChange={(on) => void patch(a.id, { projects: withProject(a.projects, p.id, on) })} />
                      ))}
                    </div>
                    <Button size="sm" variant="ghost"
                      onClick={() => void patch(a.id, { disabled: !a.disabled })}>
                      {a.disabled ? "Aktifkan" : "Nonaktifkan"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(a.id)}>Hapus</Button>
                  </div>
                ))}
              </div>
            )}
      </Card>
    </>
  );
}
