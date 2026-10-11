import React from "react";
import type { ClientAccountView } from "@hanoman/shared";
import { Button, Callout, Card, Checkbox, Field, Input, StateBlock, StatusPill, useConfirm, type ShowToast } from "../ds";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";

// SPEC-617 · ADR-0110 · layar admin "Akses klien". Berkasnya sendiri: SettingsScreen.tsx sudah
// ~80 KB, dan panel ini punya state serta siklus datanya sendiri.
//
// Audit UI/UX 2026-10: gagal memuat akun atau project tampil sebagai galat dengan "Coba lagi" (bukan
// daftar kosong yang berbohong), perubahan akses punya feedback dan tak pernah diam saat gagal, dan
// "Hapus akun" lewat `useConfirm` dengan daftar dampaknya.

const EMAIL_OK = /\S+@\S+\.\S+/;

export function ClientAccessPanel({ onToast }: { onToast?: ShowToast } = {}) {
  const { confirm, dialog } = useConfirm();
  const [accounts, setAccounts] = React.useState<ClientAccountView[] | null>(null);
  const [accountsErr, setAccountsErr] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[] | null>(null);
  const [projectsErr, setProjectsErr] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [createErr, setCreateErr] = React.useState<string | null>(null);
  const [actionErr, setActionErr] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const emailHintId = React.useId();
  const passwordHintId = React.useId();
  const createHintId = React.useId();

  const loadAccounts = React.useCallback(() => {
    setAccountsErr(null);
    return api.listClientAccounts().then((r) => setAccounts(r.items))
      .catch((e: unknown) => setAccountsErr(failureMessage("memuat akun klien", e)));
  }, []);
  const loadProjects = React.useCallback(() => {
    setProjectsErr(null);
    return api.listProjects().then((r) => setProjects(r.items.map((p) => ({ id: p.id, name: p.name }))))
      .catch((e: unknown) => setProjectsErr(failureMessage("memuat daftar project", e)));
  }, []);
  const reloadAll = React.useCallback(() => { void loadAccounts(); void loadProjects(); }, [loadAccounts, loadProjects]);

  React.useEffect(() => { reloadAll(); }, [reloadAll]);

  const emailBad = email.length > 0 && !EMAIL_OK.test(email);
  const passwordBad = password.length > 0 && password.length < 8;
  // Alasan tombol mati ditulis sebagai teks: tombol yang diredupkan tanpa penjelasan membuat orang
  // menebak-nebak apa yang kurang.
  const createBlock = !email.trim() ? "Isi email klien dulu."
    : !EMAIL_OK.test(email) ? "Format email belum benar."
    : password.length < 8 ? "Password awal minimal 8 karakter."
    : null;

  const create = async () => {
    setCreateErr(null);
    setCreating(true);
    try {
      await api.createClientAccount({ email, password, projects: picked });
      setEmail(""); setPassword(""); setPicked([]);
      onToast?.("Akun klien dibuat", "ok", "user-plus");
      await loadAccounts();
    } catch { setCreateErr("Gagal membuat akun — periksa email (mungkin sudah dipakai) dan panjang password."); }
    finally { setCreating(false); }
  };

  // Satu jalur untuk setiap perubahan akun: busy per baris (kontrol baris itu mati selama
  // menunggu), galat ditampilkan, dan keberhasilan diberi tahu. Tak ada lagi `await` yang bisa
  // melempar ke luar tanpa tangkapan.
  const patch = async (a: ClientAccountView, input: Parameters<typeof api.updateClientAccount>[1], okMsg: string) => {
    setActionErr(null);
    setBusyId(a.id);
    try {
      await api.updateClientAccount(a.id, input);
      onToast?.(okMsg, "ok", "check");
      await loadAccounts();
    } catch (e) {
      setActionErr(failureMessage(`memperbarui akun ${a.email}`, e));
    } finally { setBusyId(null); }
  };

  const remove = async (a: ClientAccountView) => {
    setActionErr(null);
    const impact: React.ReactNode[] = ["Akun dan password-nya dihapus permanen."];
    if (a.projects.length) impact.push(`Akses ke ${a.projects.length} project yang diberikan ke akun ini ikut dicabut.`);
    impact.push("Tindakan ini tak bisa dibatalkan.");
    try {
      const done = await confirm({
        title: `Hapus akun "${a.email}"?`,
        message: "Klien ini langsung kehilangan akses ke portal.",
        impact,
        confirmLabel: "Hapus akun",
        tone: "danger",
        icon: "trash-2",
        run: () => api.deleteClientAccount(a.id),
      });
      if (done) {
        onToast?.("Akun klien dihapus", "warn", "trash-2");
        await loadAccounts();
      }
    } catch (e) {
      setActionErr(failureMessage(`menghapus akun ${a.email}`, e));
    }
  };

  const withProject = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((v) => v !== id);

  const projectsReady = !!projects && !projectsErr;

  return (
    <>
      <Card eyebrow="akses" title="Buat akun klien">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Akun klien melihat <b>daftar backlog</b> dan <b>tiket help desk</b> project yang dipilih —
          hanya baca, tanpa terminal, dokumen internal, maupun setelan. Ia tak pernah melihat dashboard
          operator.
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (!createBlock) void create(); }}>
          <Field label="Email klien">
            <Input aria-label="Email klien" type="email" placeholder="mis. budi@tokomekar.co.id"
              aria-invalid={emailBad || undefined} aria-describedby={emailBad ? emailHintId : undefined}
              invalid={emailBad} value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
            {emailBad && <span id={emailHintId} style={{ display: "block", fontSize: 11.5, color: "var(--status-err)", marginTop: 5 }}>
              Format email belum benar, mis. nama@domain.id.</span>}
          </Field>
          <Field label="Password awal"
            hint={<span id={passwordHintId}>Minimal 8 karakter. Sampaikan lewat kanal yang aman — klien bisa menggantinya sendiri.</span>}>
            <Input aria-label="Password awal" type="password" placeholder="mis. kunci-tokomekar-2026"
              aria-invalid={passwordBad || undefined} aria-describedby={passwordHintId}
              invalid={passwordBad} value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
          </Field>
          <Field label="Project yang boleh dilihat">
            {projectsErr ? (
              <StateBlock kind="error" compact title="Daftar project gagal dimuat" hint={projectsErr}
                action={() => void loadProjects()} />
            ) : !projects ? (
              <StateBlock kind="loading" compact title="Memuat project…" />
            ) : projects.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>Belum ada project untuk dibagikan.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {projects.map((p) => (
                  <Checkbox key={p.id} aria-label={`Beri akses ${p.name}`} label={p.name}
                    checked={picked.includes(p.id)}
                    onChange={(on) => setPicked((cur) => withProject(cur, p.id, on))} />
                ))}
              </div>
            )}
          </Field>
          {createErr && <Callout tone="err" role="alert" style={{ marginBottom: 10 }}>{createErr}</Callout>}
          <Button size="sm" type="submit" leftIcon="user-plus" disabled={!!createBlock || creating} loading={creating}
            aria-describedby={createBlock ? createHintId : undefined}>Buat akun</Button>
          {createBlock && (
            <div id={createHintId} style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{createBlock}</div>
          )}
        </form>
      </Card>

      <Card eyebrow="akses" title="Akun klien">
        {accountsErr ? (
          <StateBlock kind="error" title="Akun klien gagal dimuat" hint={accountsErr}
            action={reloadAll} />
        ) : accounts === null ? <StateBlock kind="loading" title="Memuat…" />
          : accounts.length === 0
            ? <StateBlock kind="empty" icon="users" title="Belum ada akun klien"
                hint="Buat akun di atas, lalu pilih project yang boleh ia lihat." />
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {!projectsReady && (
                  <div role="status" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 0" }}>
                    Akses project belum bisa diubah sebelum daftar project termuat.
                  </div>
                )}
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
                      {(projects ?? []).map((p) => (
                        <Checkbox key={p.id} aria-label={`${a.email} · ${p.name}`} label={p.name}
                          checked={a.projects.includes(p.id)} disabled={busyId === a.id || !projectsReady}
                          onChange={(on) => void patch(a, { projects: withProject(a.projects, p.id, on) },
                            on ? `Akses ${p.name} diberikan` : `Akses ${p.name} dicabut`)} />
                      ))}
                    </div>
                    <Button size="sm" variant="secondary" disabled={busyId === a.id}
                      onClick={() => void patch(a, { disabled: !a.disabled },
                        a.disabled ? "Akun diaktifkan" : "Akun dinonaktifkan")}>
                      {a.disabled ? "Aktifkan" : "Nonaktifkan"}
                    </Button>
                    <Button size="sm" variant="secondary" leftIcon="trash-2" disabled={busyId === a.id}
                      style={{ color: "var(--clay-600)" }} onClick={() => void remove(a)}>Hapus</Button>
                  </div>
                ))}
              </div>
            )}
        {/* Galat perubahan akses ditampilkan di sini (bukan toast saja) supaya tak hilang sebelum dibaca. */}
        {actionErr && <Callout tone="err" role="alert" style={{ marginTop: 10 }}>{actionErr}</Callout>}
      </Card>
      {dialog}
    </>
  );
}
