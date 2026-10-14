// Audit UI/UX 2026-10 · Fase 3C · komponen override satu-bentuk. Konflik, Lead, operator Telegram, dan
// obrolan portal memakai SATU komponen (`FunctionOverride`): sakelar "Pakai setelan sendiri" di atas,
// lalu field-nya bila sakelar hidup, atau teks warisan bila mati. Obrolan portal memberi label sakelarnya
// sendiri ("Aktifkan obrolan") karena ia fitur on/off, bukan override model.
import React from "react";
import { Card, Input, Select, Switch } from "../../ds";
import type { ShowToast } from "../../ds";
import {
  type Agent, type AntigravityVersionInfo, codexClientTooOld, codexModel,
} from "@hanoman/shared";
import { claudeEffortPatch, type CodexVersionState } from "./model";
import { runtimeCoerceEffort, runtimeOptions, runtimeModelOptions, runtimeEfforts, type RuntimeDefs } from "../session-runtime";
import { api } from "../../api/client";
import { Prose, SettingRow } from "./rows";
import { useSettingField } from "./useSettingField";

/** Catatan lunak bila CLI codex terpasang lebih lama dari model yang dipilih. Aturannya di shared. */
export function CodexVersionNote({ model, codexVer }: { model: string; codexVer: CodexVersionState | null }) {
  const have = codexVer?.version ?? null;
  if (!codexClientTooOld(model, have)) return null;
  return (
    <div data-testid="codex-version-note" className="hn-set-codex-note">
      Codex CLI terpasang <b>{have}</b>, sedangkan <b>{model}</b> butuh <b>{codexModel(model)?.minClient}</b>.
      Sesi tetap boleh dijalankan, tapi modelnya belum tentu dikenali CLI ini.
      Perbarui dengan <code>npm i -g @openai/codex@latest</code>.
    </div>
  );
}

/** Judul grup agen di kartu model default. Penanda "dipakai sesi baru" menjawab blok mana yang berlaku. */
export function AgentGroupHeader({ id, label, active }: { id: Agent; label: string; active: boolean }) {
  return (
    <div className="hn-set-agent-head">
      <div className="hn-set-agent-name">{label}</div>
      <span data-testid={`agent-badge-${id}`}
        className={`hn-set-agent-badge${active ? " hn-set-agent-badge--on" : ""}`}>
        {active ? "dipakai sesi baru" : "tidak dipakai sekarang"}
      </span>
    </div>
  );
}

export interface EngineValue {
  enabled: boolean;
  agent: Agent;
  model: string;
  effort: string;
}
export type EnginePatch = Partial<Omit<EngineValue, "enabled">> & { enabled?: boolean };

/** Teks aria dan pesan toast satu fungsi. Beda hanya di kata; kontrolnya sama. */
export interface EngineLabels {
  agentTitle: string;
  agentDesc: string;
  effortDesc: string;
  aria: { agent: string; model: string; effort: string };
  msg: { agent: string; model: string; effort: string };
}

export type EngineDefaults = RuntimeDefs;

/** Runtime + model + effort untuk satu fungsi override. Setiap kontrol auto-save lewat `useSettingField`. */
export function EngineFields({ engine, labels, defaults, codexVer, save }: {
  engine: EngineValue;
  labels: EngineLabels;
  defaults: EngineDefaults;
  codexVer: CodexVersionState | null;
  save: (patch: EnginePatch, msg: string) => Promise<boolean>;
}) {
  const agent = useSettingField<Agent>({
    value: engine.agent, delayMs: 0,
    save: (a) => {
      // Cermin `pickAgent`: menukar runtime HARUS menukar model + effort ke default agen itu,
      // kalau tidak fungsi lahir dengan pasangan yang ditolak CLI (`codex -m claude-…`).
      const d = defaults[a];
      return save({
        agent: a, model: d.model,
        effort: a === "claude" ? d.effort : runtimeCoerceEffort(a, d.model, d.effort),
      }, `${labels.msg.agent} → ${a}`);
    },
  });
  const model = useSettingField<string>({
    value: engine.model, delayMs: 0,
    save: (m) => save({
      model: m,
      ...(engine.agent === "claude" ? claudeEffortPatch(m, engine.effort)
        : { effort: runtimeCoerceEffort(engine.agent, m, engine.effort) }),
    }, `${labels.msg.model} → ${m}`),
  });
  const effort = useSettingField<string>({
    value: engine.effort, delayMs: 0,
    save: (e) => save({ effort: e }, `${labels.msg.effort} → ${e}`),
  });
  const isCodex = agent.value === "codex";
  return (
    <>
      <SettingRow title={labels.agentTitle} desc={labels.agentDesc} save={agent}>
        <Select size="sm" aria-label={labels.aria.agent} value={agent.value} className="hn-set-w-sm"
          options={runtimeOptions}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => agent.set(e.target.value as Agent)} />
      </SettingRow>
      {isCodex && <CodexVersionNote model={model.value} codexVer={codexVer} />}
      {agent.value === "antigravity" && <AntigravityVersionNote />}
      <SettingRow title="Model" save={model}>
        <Select size="sm" aria-label={labels.aria.model} value={model.value} className="hn-set-w-sm"
          options={runtimeModelOptions(agent.value, model.value)}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => model.set(e.target.value)} />
      </SettingRow>
      <SettingRow title="Effort" desc={labels.effortDesc} last save={effort}>
        <Select size="sm" aria-label={labels.aria.effort} value={effort.value} className="hn-set-w-xs"
          options={runtimeEfforts(agent.value, model.value).map((value) => ({ value, label: value === "xhigh" ? "x-high" : value }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => effort.set(e.target.value)} />
      </SettingRow>
    </>
  );
}

/**
 * Satu-satunya komponen override di Pengaturan: kartu, sakelar "Pakai setelan sendiri" (atau labelnya
 * sendiri), dan isi. Saat sakelar mati, `inherited` menjelaskan nilai yang berlaku, supaya operator
 * tahu apa yang diwarisi tanpa membuka field.
 */
export function FunctionOverride({ eyebrow, title, desc, toggleTitle = "Pakai setelan sendiri", toggleDesc, toggleAria,
  enabled, onToggle, inherited, inheritedTestId, children }: {
  eyebrow: string;
  title: string;
  desc: React.ReactNode;
  toggleTitle?: string;
  toggleDesc: string;
  toggleAria: string;
  enabled: boolean;
  onToggle: (next: boolean) => Promise<boolean>;
  inherited?: React.ReactNode;
  inheritedTestId?: string;
  children?: React.ReactNode;
}) {
  const toggle = useSettingField<boolean>({ value: enabled, delayMs: 0, save: (v) => onToggle(v) });
  return (
    <Card eyebrow={eyebrow} title={title} data-setting-card data-search={`${title} ${eyebrow}`}>
      <Prose>{desc}</Prose>
      <SettingRow title={toggleTitle} desc={toggleDesc} save={toggle} last={!toggle.value}>
        <Switch aria-label={toggleAria} checked={toggle.value}
          onChange={(v: boolean) => toggle.set(v)} />
      </SettingRow>
      {toggle.value ? children : (
        inherited ? <div data-testid={inheritedTestId} className="hn-set-inherited">{inherited}</div> : null
      )}
    </Card>
  );
}

/**
 * Field angka yang dinilai saat kolomnya ditinggalkan (blur). Nilai di luar batas ditolak atau dipotong
 * dengan pemberitahuan; nilai lama dipertahankan bila isian kosong. Bukan per ketikan: angka setengah
 * jadi tak boleh tersimpan.
 */
export function NumberSettingField({ label, value, min, max, placeholder, width, onCommit, onToast }: {
  label: string;
  value: number;
  min: number;
  max: number;
  placeholder?: string;
  width?: string;
  onCommit: (n: number) => Promise<boolean>;
  onToast?: ShowToast;
}) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const field = useSettingField<number>({ value, delayMs: 0, save: (n) => onCommit(n) });
  const commit = () => {
    const raw = text.trim();
    const n = raw === "" ? NaN : Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < min) {
      onToast?.(`${label}: isi angka ${min} atau lebih. Nilai sebelumnya dipertahankan.`, "warn", "alert-triangle");
      setText(String(value));
      return;
    }
    const capped = Math.min(n, max);
    if (capped !== n) {
      onToast?.(`${label} dibatasi ke ${max}.`, "warn", "alert-triangle");
      setText(String(capped));
    }
    if (capped !== value) field.set(capped);
  };
  return (
    <Input aria-label={label} type="number" min={min} max={max} placeholder={placeholder}
      className={width ?? "hn-set-w-xs"} value={text}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") commit(); }} />
  );
}

export function AntigravityVersionNote({ info }: { info?: AntigravityVersionInfo | null }) {
  const [detected, setDetected] = React.useState<AntigravityVersionInfo | null>(null);
  React.useEffect(() => {
    if (info !== undefined) return;
    let active = true;
    api.getAntigravityVersion?.().then((value) => { if (active) setDetected(value); })
      .catch(() => { if (active) setDetected({ version: null, error: "Versi Antigravity tidak dapat diperiksa." }); });
    return () => { active = false; };
  }, [info]);
  const value = info === undefined ? detected : info;
  return <div role="status" data-testid="antigravity-version-note" className="hn-set-codex-note">
    Antigravity CLI · versi {value?.version ?? "tak terdeteksi"}. {value?.error}
    <p>Host/lab saja; sandbox belum didukung. Mode goal native belum didukung. Telemetri native tidak diketahui.</p>
    <a href="https://antigravity.google/docs/cli" target="_blank" rel="noreferrer">Panduan pemasangan dan login resmi</a>
  </div>;
}
