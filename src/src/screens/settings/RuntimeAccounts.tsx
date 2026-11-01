import React from "react";
import type { Agent, AccountLimitsDTO, RuntimeAccountDTO } from "@hanoman/shared";
import { Button, Callout, Card, Field, Input, Modal, useConfirm } from "../../ds";
import type { ShowToast } from "../../ds";
import { api } from "../../api/client";
import { useAccountLimits } from "../../api/account-limits";
import { failureMessage } from "../../lib/report-error";
import { Prose } from "./rows";
import "../styles/accounts.css";

// ADR-0234 · akun langganan per runtime. Kredensial tak pernah lewat sini: login berjalan di sesi
// terminal yang dibuka server, dan panel hanya membaca status/identitas yang dilaporkan server.
const RUNTIME_LABEL: Record<Agent, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };
const STATUS_LABEL: Record<RuntimeAccountDTO["status"], string> = {
  "aktif": "aktif", "belum-login": "belum login", "perlu-login-ulang": "perlu login ulang",
};
const RUNTIMES: Agent[] = ["claude", "codex", "antigravity"];

function pctOf(limits: AccountLimitsDTO["limits"] | undefined, match: RegExp): string {
  const w = limits?.windows.filter((x) => match.test(x.label)) ?? [];
  if (!w.length) return "—";
  return `${Math.max(...w.map((x) => x.usedPct))}%`;
}

export function RuntimeAccounts({ onToast }: { onToast?: ShowToast }) {
  const [accounts, setAccounts] = React.useState<RuntimeAccountDTO[] | null>(null);
  const [sandbox, setSandbox] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<Agent | null>(null);
  const [label, setLabel] = React.useState("");
  const limits = useAccountLimits();
  const { confirm, dialog } = useConfirm();

  const reload = React.useCallback(async () => {
    try {
      const r = await api.listRuntimeAccounts();
      setAccounts(r.accounts); setSandbox(r.sandbox); setError(null);
      // Akun yang belum aktif diperiksa ulang tiap panel dibuka / tab kembali fokus — operator baru saja
      // menyelesaikan login di Terminal.
      const pending = r.accounts.filter((a) => !a.builtin && a.status !== "aktif");
      if (pending.length) {
        const fresh = await Promise.all(pending.map((a) => api.checkRuntimeAccount(a.id).catch(() => a)));
        setAccounts((cur) => cur?.map((a) => fresh.find((f) => f.id === a.id) ?? a) ?? cur);
      }
    } catch (e) { setError(failureMessage("memuat akun runtime", e)); }
  }, []);

  React.useEffect(() => {
    void reload();
    const onFocus = () => { void reload(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const act = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) onToast?.(ok, "ok", "check"); await reload(); }
    catch (e) { onToast?.(failureMessage(what, e), "err", "alert-triangle"); }
  };

  const login = (a: RuntimeAccountDTO) => act("membuka login", async () => {
    await api.loginRuntimeAccount(a.id, {});
    onToast?.(`Login ${RUNTIME_LABEL[a.runtime]} · ${a.label} berjalan di Terminal`, "ok", "terminal");
  });

  const remove = async (a: RuntimeAccountDTO) => {
    if (!await confirm({
      title: `Hapus akun "${a.label}"?`,
      message: `Login ${RUNTIME_LABEL[a.runtime]} akun ini dihapus dari mesin ini.`,
      impact: ["Direktori akun & kredensialnya dihapus.", "Skills dan setelan bersama tidak tersentuh."],
      confirmLabel: "Hapus akun", tone: "danger",
    })) return;
    await act("menghapus akun", () => api.deleteRuntimeAccount(a.id), `Akun "${a.label}" dihapus`);
  };

  // Spec §3.4 · email yang sama di runtime yang sama = peringatan, tidak memblokir.
  const dupeOf = (a: RuntimeAccountDTO): RuntimeAccountDTO | undefined => {
    const email = a.identity?.email;
    return email ? accounts?.find((o) => o.runtime === a.runtime && o.id !== a.id && o.identity?.email === email) : undefined;
  };

  const save = async () => {
    if (!adding || !label.trim()) return;
    const name = label.trim();
    await act("menambah akun", () => api.createRuntimeAccount({ runtime: adding, label: name }), `Akun "${name}" ditambahkan`);
    setAdding(null); setLabel("");
  };

  return (
    <Card eyebrow="akun" title="Akun runtime" data-setting-card
      data-search="akun runtime login langganan claude codex antigravity limit">
      <Prose>
        Daftarkan beberapa akun langganan per runtime, lalu pilih akun default di sini atau per sesi saat
        <b> Start</b>. Skills, plugins, dan setelan lain tetap sama untuk semua akun — yang berbeda hanya login.
      </Prose>
      {sandbox && (
        <Callout tone="warn" title="Sandbox sesi aktif">Sesi di mesin ini hanya bisa memakai akun bawaan.</Callout>
      )}
      {error && <Callout tone="err" title="Akun belum terbaca">{error}</Callout>}
      {accounts && RUNTIMES.map((rt) => (
        <section key={rt} className="hn-acct-group" aria-label={RUNTIME_LABEL[rt]}>
          <div className="hn-acct-group-head">
            <span className="hn-eyebrow">{RUNTIME_LABEL[rt]}</span>
            <Button size="sm" variant="ghost" leftIcon="plus" onClick={() => { setAdding(rt); setLabel(""); }}>
              Tambah akun {RUNTIME_LABEL[rt]}
            </Button>
          </div>
          <div role="radiogroup" aria-label={`Akun default ${RUNTIME_LABEL[rt]}`} className="hn-acct-list">
            {accounts.filter((a) => a.runtime === rt).map((a) => {
              const lim = limits.find((l) => l.accountId === a.id)?.limits;
              const dupe = dupeOf(a);
              return (
                <div key={a.id} className="hn-acct-row" data-status={a.status}>
                  <label className="hn-acct-pick">
                    <input type="radio" name={`acct-${rt}`} checked={a.isDefault}
                      disabled={sandbox && !a.builtin}
                      aria-label={`${a.label} sebagai default ${RUNTIME_LABEL[rt]}`}
                      onChange={() => void act("mengubah akun default", () => api.setDefaultRuntimeAccount(rt, a.id))} />
                    <span className="hn-acct-label">{a.label}</span>
                  </label>
                  <span className="hn-acct-identity">{a.identity?.email ?? "—"}{a.identity?.plan ? ` · ${a.identity.plan}` : ""}</span>
                  <span className="hn-acct-status">{STATUS_LABEL[a.status]}</span>
                  <span className="hn-acct-lim" title="Limit 5 jam · mingguan">
                    5j {pctOf(lim, /5 jam/)} · Mgg {pctOf(lim, /Mingguan/)}
                  </span>
                  <span className="hn-acct-actions">
                    {(!a.builtin || a.status !== "aktif") && (
                      <Button size="sm" variant="ghost" aria-label={`Login ${a.label}`} onClick={() => void login(a)}>
                        {a.status === "aktif" ? "Login ulang" : "Login"}
                      </Button>
                    )}
                    {!a.builtin && (
                      <Button size="sm" variant="ghost" aria-label={`Hapus ${a.label}`} onClick={() => void remove(a)}>Hapus</Button>
                    )}
                  </span>
                  {a.drift.length > 0 && (
                    <div className="hn-acct-note" role="note">
                      Konfigurasi menyimpang: {a.drift.join(", ")} bukan lagi tautan ke setelan bersama.
                    </div>
                  )}
                  {dupe && (
                    <div className="hn-acct-note" role="note">
                      Email sama dengan akun "{dupe.label}" — keduanya login ke langganan yang sama.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <Modal open={adding !== null} onClose={() => setAdding(null)} icon="plus"
        eyebrow={adding ? RUNTIME_LABEL[adding] : ""} title="Tambah akun"
        footer={<>
          <Button variant="ghost" onClick={() => setAdding(null)}>Batal</Button>
          <Button disabled={!label.trim()} onClick={() => void save()}>Simpan akun</Button>
        </>}>
        <Field label="Label akun" hint="Nama pendek untuk membedakan akun, mis. Kantor atau Pribadi 2.">
          <Input aria-label="Label akun" value={label} maxLength={40}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)} />
        </Field>
        <div className="hn-acct-hint">Sesudah disimpan, tekan <b>Login</b> untuk masuk ke akun ini di Terminal.</div>
      </Modal>
      {dialog}
    </Card>
  );
}
