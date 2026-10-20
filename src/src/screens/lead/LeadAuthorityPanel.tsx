/* ADR-0228 · Wewenang & jatah per project. Mode tiap tindakan: jalan sendiri (auto), minta izin
   (ask), atau tidak boleh (off). Branch target & perintah verifikasi menentukan cara lead
   mengintegrasikan; jatah membatasi berapa backlog yang boleh ia luncurkan. Draft lokal, Simpan
   eksplisit — pola panel pengaturan lead yang sudah ada. */
import React from "react";
import {
  LEAD_AUTHORITY_DEFAULTS, zLeadProject,
  type Lead, type LeadAction, type LeadAuthorityMode, type LeadProjectInput,
} from "@hanoman/shared";
import { Button, Field, Input, Select } from "../../ds";
import { clampNumber } from "../sched-lead-shared";
import { LEAD_ACTION_LABEL as ACTION_LABEL } from "../../lib/labels";

const ACTIONS: LeadAction[] = ["answer-session", "start-session", "integrate-main", "stop-session", "resume-session"];
const MODE_OPTIONS = [
  { value: "auto", label: "jalan sendiri" },
  { value: "ask", label: "minta izin" },
  { value: "off", label: "tidak boleh" },
];
type Num = "quotaStopPct" | "rampStep" | "rampProbeMin" | "failStreak" | "answerSlaSec";
const NUMS: { key: Num; label: string; hint: string; min: number; max: number }[] = [
  { key: "quotaStopPct", label: "Berhenti meluncurkan saat kuota (%)", hint: "1–100. Data kuota tak terbaca = berhenti.", min: 1, max: 100 },
  { key: "rampStep", label: "Sesi baru sekaligus (maks)", hint: "1–16. Sesi berikutnya menunggu yang sebelumnya lolos probe.", min: 1, max: 16 },
  { key: "rampProbeMin", label: "Probe sesi baru (menit)", hint: "1–240. Lama sesi baru harus bertahan tanpa gagal.", min: 1, max: 240 },
  { key: "failStreak", label: "Jeda project setelah gagal beruntun", hint: "1–20 sesi lead yang gagal berturut-turut.", min: 1, max: 20 },
  { key: "answerSlaSec", label: "Tenggat jawaban pertanyaan (detik)", hint: "30–3600. Lewat dari ini, pertanyaan jatuh ke kamu.", min: 30, max: 3600 },
];

type Draft = { authority: Record<string, LeadAuthorityMode>; targetBranch: string; verifyCommand: string } & Record<Num, string>;
const toDraft = (p: LeadProjectInput | undefined): Draft => {
  const v = zLeadProject.parse(p ?? {});
  return {
    authority: Object.fromEntries(ACTIONS.map((a) => [a, v.authority[a] ?? LEAD_AUTHORITY_DEFAULTS[a]])),
    targetBranch: v.targetBranch, verifyCommand: v.verifyCommand,
    quotaStopPct: String(v.quotaStopPct), rampStep: String(v.rampStep), rampProbeMin: String(v.rampProbeMin),
    failStreak: String(v.failStreak), answerSlaSec: String(v.answerSlaSec),
  };
};

export type LeadAuthorityPanelProps = {
  config: Lead;
  projects: { id: string; name: string }[];
  busy: boolean;
  onSave: (next: Lead) => Promise<boolean>;
};

export function LeadAuthorityPanel({ config, projects, busy, onSave }: LeadAuthorityPanelProps) {
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const saved = config.projects?.[projectId];
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(saved));
  React.useEffect(() => { setDraft(toDraft(config.projects?.[projectId])); }, [projectId, config]);
  if (!projects.length) return <p className="hn-lead-note">Serahkan project ke lead dulu untuk mengatur wewenangnya.</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const save = async () => {
    const base = zLeadProject.parse(saved ?? {});
    const next: LeadProjectInput = {
      authority: draft.authority as LeadProjectInput["authority"],
      targetBranch: draft.targetBranch.trim() || "main",
      verifyCommand: draft.verifyCommand.trim(),
      ...Object.fromEntries(NUMS.map((n) => [n.key, clampNumber(draft[n.key], n.min, n.max, base[n.key])])),
    };
    await onSave({ ...config, projects: { ...(config.projects ?? {}), [projectId]: next } });
  };

  return (
    <div className="hn-lead-settings">
      <Field label="Project">
        <Select size="sm" aria-label="project untuk wewenang lead" value={projectId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProjectId(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <div className="hn-lead-settings-grid">
        {ACTIONS.map((a) => (
          <Field key={a} label={`Wewenang: ${ACTION_LABEL[a as keyof typeof ACTION_LABEL]}`}>
            <Select size="sm" aria-label={`wewenang ${a}`} value={draft.authority[a]}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setDraft({ ...draft, authority: { ...draft.authority, [a]: e.target.value as LeadAuthorityMode } })}
              options={MODE_OPTIONS} />
          </Field>
        ))}
        <Field label="Branch target integrasi" hint="Lead merge ke branch ini, bukan main terpatok.">
          <Input aria-label="branch target integrasi" value={draft.targetBranch} placeholder="main"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, targetBranch: e.target.value })} />
        </Field>
        <Field label="Perintah verifikasi sebelum merge" hint="Dijalankan server di worktree sesi dan harus hijau. Kosong = merge selalu minta izin.">
          <Input aria-label="perintah verifikasi" value={draft.verifyCommand} placeholder="mis. pnpm test"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, verifyCommand: e.target.value })} />
        </Field>
        {NUMS.map((n) => (
          <Field key={n.key} label={n.label} hint={n.hint}>
            <Input type="number" min={n.min} max={n.max} aria-label={n.label} value={draft[n.key]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [n.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="hn-lead-footer">
        <span role="status" aria-live="polite">{dirty ? "Ada perubahan yang belum disimpan." : ""}</span>
        <span className="hn-lead-chips">
          <Button size="sm" variant="ghost" disabled={!dirty || busy} onClick={() => setDraft(toDraft(saved))}>Urungkan</Button>
          <Button size="sm" leftIcon="check" disabled={!dirty || busy} onClick={() => void save()}>Simpan wewenang</Button>
        </span>
      </div>
    </div>
  );
}
