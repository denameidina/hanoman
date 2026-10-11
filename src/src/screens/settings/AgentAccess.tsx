// SPEC-257 · ADR-0065 · Akses AI Agent: master switch + agent token + capability per domain. Dipindah
// dari SettingsScreen (Fase 3C) dengan perilaku sama; sakelar master kini lewat `useSettingField`.
import React from "react";
import { Button, Card, Field, Input, StateBlock, Switch, useConfirm, useResponsiveTier } from "../../ds";
import type { ShowToast } from "../../ds";
import { api } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import { CAPABILITY_DOMAINS } from "@hanoman/shared";
import type { Setting, AgentTokenView, CapabilityInfo } from "@hanoman/shared";
import { rebaseEdits } from "../settings-rebase";
import { AgentDocCard } from "../AgentDocCard";
import { McpPanel } from "../McpPanel";
import { BlockedHint, Prose, SettingRow } from "./rows";
import { useSettingField } from "./useSettingField";

// ADR-0155 · token yang HAKNYA MENYEMPIT saat empat capability berbahaya dipecah dari `:write`.
// Data murni: menambah pecahan berikutnya = menambah satu baris di sini. Kalimatnya menyebut HAK YANG
// HILANG, supaya integrasi yang patah tak diam saja (kelas kegagalan SPEC-491).
const LOST_RIGHTS: { had: string; needs: string; sentence: string }[] = [
  { had: "sessions:write", needs: "sessions:spawn", sentence: "dulu bisa membuka sesi baru" },
  { had: "ide:write", needs: "ide:git", sentence: "dulu bisa merge/rebase & menghapus branch" },
  { had: "backlog:write", needs: "backlog:lifecycle", sentence: "dulu bisa integrate & menghapus backlog" },
  { had: "vps:write", needs: "vps:exec", sentence: "dulu bisa menjalankan perintah di VPS" },
  { had: "qa:write", needs: "qa:delete", sentence: "dulu bisa menghapus laporan, test case, temuan & lampiran QA" },
];

export function lostRights(caps: string[]): string[] {
  return LOST_RIGHTS.filter((l) => caps.includes(l.had) && !caps.includes(l.needs)).map((l) => l.sentence);
}

/**
 * Checkbox "pilih semua" untuk satu kolom capability. Tri-state: tercentang bila SELURUH id-nya
 * terpilih, indeterminate bila sebagian. `indeterminate` hanya ada sebagai properti DOM, jadi lewat ref.
 */
function CheckAll({ ids, picked, onToggle, ariaLabel, label }: {
  ids: string[]; picked: string[]; onToggle: (ids: string[], next: boolean) => void; ariaLabel: string; label?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const chosen = ids.filter((id) => picked.includes(id)).length;
  const all = ids.length > 0 && chosen === ids.length;
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = chosen > 0 && !all; }, [chosen, all]);
  if (ids.length === 0) return null;
  return (
    <label className="hn-set-checkall">
      {label && <span>{label}</span>}
      <input ref={ref} type="checkbox" aria-label={ariaLabel} checked={all} onChange={() => onToggle(ids, !all)} />
    </label>
  );
}

export function AgentAccessPanel({ onToast }: { onToast?: ShowToast } = {}) {
  const { confirm, dialog } = useConfirm();
  const mobile = useResponsiveTier() === "mobile";
  const [caps, setCaps] = React.useState<CapabilityInfo[]>([]);
  const [items, setItems] = React.useState<AgentTokenView[] | null>(null);
  const [setting, setSetting] = React.useState<Setting | null>(null);
  const [name, setName] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [fresh, setFresh] = React.useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const hintId = React.useId();
  const nameBlock = name.trim().length < 1 ? "Isi nama token dulu." : null;
  const load = React.useCallback(() => { api.listAgentTokens().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  React.useEffect(() => {
    api.getSettings().then(setSetting)
      .catch((e: unknown) => onToast?.(failureMessage("memuat pengaturan akses agen", e), "err", "alert-triangle"));
    api.getAgentCapabilities().then((r) => setCaps(r.capabilities))
      .catch((e: unknown) => onToast?.(failureMessage("memuat daftar capability agen", e), "err", "alert-triangle"));
    load();
  }, [load]);

  // Sakelar master: auto-save diskret. S5 · rebase ke DB terbaru supaya snapshot mount tak membalik
  // runtime seed atau setelan lain.
  async function saveMaster(next: boolean): Promise<boolean> {
    if (!setting) return false;
    const updated = { ...setting, agentAccessEnabled: next };
    setSetting(updated);
    try {
      const latest = await api.getSettings().catch(() => undefined);
      await api.putSettings(rebaseEdits(setting, updated, latest));
      onToast?.("Akses AI agent " + (next ? "aktif" : "nonaktif"), next ? "ok" : "warn", "bot");
      return true;
    } catch {
      onToast?.("Gagal menyimpan", "err", "x-circle");
      setSetting(setting);
      return false;
    }
  }
  const master = useSettingField<boolean>({ value: !!setting?.agentAccessEnabled, delayMs: 0, save: saveMaster });

  const toggleCap = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  // ADR-0155 · "pilih semua" bekerja atas himpunan id yang BENAR-BENAR ada di katalog. Kolom
  // `berbahaya` hanya terisi untuk sebagian domain, jadi memilih semua kolom itu = empat capability.
  const toggleAll = (ids: string[], next: boolean) => setPicked((p) => next
    ? Array.from(new Set([...p, ...ids]))
    : p.filter((x) => !ids.includes(x)));
  async function create() {
    if (nameBlock || busy) return;
    setBusy(true);
    try {
      const t = await api.createAgentToken({ name: name.trim(), capabilities: picked });
      setFresh({ name: t.name, token: t.token }); setName(""); setPicked([]); load();
      onToast?.("Agent token dibuat — salin sekarang", "ok", "key-round");
    } catch { onToast?.("Gagal membuat token", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function revoke(t: AgentTokenView) {
    try {
      if (!await confirm({
        title: `Cabut agent token "${t.name}"?`,
        message: "Agen yang memakainya langsung kehilangan akses.",
        impact: [`Token "${t.name}" tak bisa dipakai lagi untuk masuk lewat API.`, "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Cabut token",
        icon: "key-round",
        run: () => api.revokeAgentToken(t.id),
      })) return;
      load(); onToast?.("Token dicabut", "warn", "trash-2");
    }
    catch { onToast?.("Gagal mencabut token", "err", "x-circle"); }
  }
  async function setEnabled(t: AgentTokenView, enabled: boolean) {
    try { await api.patchAgentToken(t.id, { enabled }); load(); }
    catch { onToast?.("Gagal mengubah token", "err", "x-circle"); }
  }

  // Kelompokkan capability per domain → baris {domain, read?, write?, danger?} untuk grid checkbox.
  const domains = Array.from(new Set(caps.map((c) => c.domain)));
  const idsOf = (access: string) => caps.filter((c) => c.access === access).map((c) => c.id);
  const allIds = caps.map((c) => c.id);
  const active = (items ?? []).filter((t) => !t.revokedAt);
  // Sel capability: pembaca layar mendengar labelnya ("Sesi — tulis"), bukan id mentah ("sessions:write").
  const capCell = (c: CapabilityInfo | undefined, word: string) => (
    <div className="hn-set-capcell">
      {c && mobile && <span className="hn-set-capword">{word}</span>}
      {c && <input type="checkbox" aria-label={c.label} checked={picked.includes(c.id)} onChange={() => toggleCap(c.id)} />}
    </div>
  );

  return (
    <>
      {/* SPEC-489 · panduannya mendahului tokennya: baca dulu, baru buat kredensial. */}
      <AgentDocCard onToast={onToast} />

      <Card eyebrow="ai agent" title="Akses AI Agent" data-setting-card data-search="akses ai agent master switch capability">
        <Prose>
          Beri AI agent eksternal kendali hanoman lewat token (header <code>Authorization: Bearer</code>).
          Tiap fitur dibuka per <b>capability</b>. Selagi master switch mati, semua token ditolak.
        </Prose>
        <SettingRow title="Aktifkan akses AI agent" last save={master}
          desc="Master switch. Nonaktif → semua agent token 401, apa pun capability-nya.">
          <Switch checked={master.value} onChange={(v: boolean) => master.set(v)} aria-label="Aktifkan akses AI agent" />
        </SettingRow>
      </Card>

      <Card eyebrow="token" title="Agent tokens" data-setting-card data-search="agent token capability buat cabut">
        {fresh && (
          <div className="hn-set-token-box">
            <div className="hn-set-token-title">Token “{fresh.name}” — salin sekarang, tak akan ditampilkan lagi:</div>
            <code className="hn-set-token-code">{fresh.token}</code>
            <div className="hn-set-inline">
              <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(fresh.token); onToast?.("Disalin", "ok", "copy"); }}>Salin</Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Tutup</Button>
            </div>
          </div>
        )}
        {items === null ? <StateBlock kind="loading" compact title="Memuat token…" />
          : active.length === 0 ? <div className="hn-set-empty">Belum ada agent token.</div>
          : active.map((t, i) => (
            <SettingRow key={t.id} title={t.name} last={i === active.length - 1}
              desc={`${t.tokenPrefix}… · ${t.capabilities.length} capability · `
                + (t.lastUsedAt ? "terpakai " + new Date(t.lastUsedAt).toLocaleString("id-ID") : "belum dipakai")
                // ADR-0155 · peringatan hak yang menyempit ikut di `desc` supaya terbaca di baris yang sama.
                + (lostRights(t.capabilities).length
                  ? ` — token ini ${lostRights(t.capabilities).join(", ")}; sekarang tidak, sampai capability berbahayanya dicentang. Cabut lalu buat ulang bila memang perlu.`
                  : "")}>
              <div className="hn-set-inline">
                <Switch size="sm" checked={t.enabled} onChange={(v: boolean) => void setEnabled(t, v)} aria-label={`Aktif: ${t.name}`} />
                <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => revoke(t)}>Cabut</Button>
              </div>
            </SettingRow>
          ))}

        <form className="hn-set-form-block" onSubmit={(ev) => { ev.preventDefault(); void create(); }}>
          <Field label="Nama token"><Input value={name} placeholder="mis. agent-ci"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="hn-set-full" /></Field>
          <div className="hn-set-subhead">Capability</div>
          {/* ADR-0155 · TIGA tingkat akses, bukan dua. Kolom `berbahaya` hanya terisi untuk empat domain. */}
          <div className="hn-grid-mobile hn-set-capgrid">
            <div className="hn-set-capcol-right">
              <CheckAll label="Pilih semua capability" ariaLabel="pilih semua capability" ids={allIds} picked={picked} onToggle={toggleAll} />
            </div>
            <div className="hn-set-capcol">
              baca<CheckAll ariaLabel="pilih semua baca" ids={idsOf("read")} picked={picked} onToggle={toggleAll} />
            </div>
            <div className="hn-set-capcol">
              tulis<CheckAll ariaLabel="pilih semua tulis" ids={idsOf("write")} picked={picked} onToggle={toggleAll} />
            </div>
            <div className="hn-set-capcol hn-set-capcol--danger">
              berbahaya<CheckAll ariaLabel="pilih semua berbahaya" ids={idsOf("danger")} picked={picked} onToggle={toggleAll} />
            </div>
            {domains.map((d) => {
              const r = caps.find((c) => c.domain === d && c.access === "read");
              const w = caps.find((c) => c.domain === d && c.access === "write");
              const x = caps.find((c) => c.domain === d && c.access === "danger");
              const meta = CAPABILITY_DOMAINS.find((m) => m.domain === d);
              return (
                <React.Fragment key={d}>
                  <div className="hn-set-capdomain">
                    <div className="hn-set-capdomain-name">{meta?.label ?? d}{w?.risk || x?.risk ? " ⚠" : ""}</div>
                    {meta?.desc && <div className="hn-set-capdomain-desc">{meta.desc}</div>}
                    {x && <div className="hn-set-capdomain-danger">{x.label.replace(/^[^—]+—\s*/, "berbahaya: ")} — {x.desc}</div>}
                  </div>
                  {capCell(r, "baca")}
                  {capCell(w, "tulis")}
                  {capCell(x, "berbahaya")}
                </React.Fragment>
              );
            })}
          </div>
          <div className="hn-set-form-actions">
            <Button size="sm" type="submit" leftIcon="plus" disabled={!!nameBlock || busy}
              aria-describedby={nameBlock ? hintId : undefined}>Buat token</Button>
          </div>
          <BlockedHint id={hintId} text={nameBlock} />
        </form>
        {dialog}
      </Card>

      {/* SPEC-482 · ADR-0099 · memasang MCP server dan memberi capability adalah satu pekerjaan manusia;
          panelnya duduk di bagian yang sama dengan master switch & daftar token. */}
      <McpPanel />
    </>
  );
}

