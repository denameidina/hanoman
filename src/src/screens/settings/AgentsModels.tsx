// Audit UI/UX 2026-10 · Fase 3C · niat "Agen & model": daftar override per fungsi (Konflik, Lead, obrolan
// portal) dan orkestrasi per fase. Default global TIDAK diedit di sini (ia di "Sesi harian"); setiap
// override membaca default itu dan menjelaskan nilai yang diwarisinya saat sakelarnya mati.
import React from "react";
import { Button, Card, Select } from "../../ds";
import type { ShowToast } from "../../ds";
import { OrchestrationPanel } from "../OrchestrationPanel";
import { CODEX_DEFAULTS, CONFLICT_DEFAULTS, LEAD_DEFAULTS, PORTAL_CHAT_DEFAULTS } from "@hanoman/shared";
import type { Setting } from "@hanoman/shared";
import {
  AGENT_LABEL, claudeEffortOptions, claudeEffortPatch, claudeOptions, type CodexVersionState, type SectionKey,
} from "./model";
import { EngineFields, FunctionOverride, NumberSettingField, type EnginePatch } from "./fields";
import { Prose, SettingRow } from "./rows";
import { saveLeadEngine } from "./engines";
import type { SettingsStore } from "./useSettingsStore";
import { useSettingField } from "./useSettingField";

export function AgentsModels({ s, store, onToast, codexVer, onNavigate }: {
  s: Setting;
  store: SettingsStore;
  onToast?: ShowToast;
  codexVer: CodexVersionState | null;
  onNavigate: (key: SectionKey) => void;
}) {
  const codex = s.codex ?? CODEX_DEFAULTS;
  const agent = s.agent ?? "claude";
  // Default global, dibaca sebagai basis warisan setiap override.
  const defaults = {
    claude: { model: s.model, effort: s.effort },
    codex: { model: codex.model, effort: codex.effort },
  };
  const inherited = agent === "codex"
    ? { agent: "codex" as const, model: codex.model, effort: codex.effort }
    : { agent: "claude" as const, model: s.model, effort: s.effort };
  const inheritedText = (prefix: string) => (
    <>{prefix} <b>{AGENT_LABEL[inherited.agent]}</b> · <code>{inherited.model}</code> · <code>{inherited.effort}</code>.</>
  );

  // SPEC-383 · ADR-0081 · sesi penyelesai konflik rebase/merge boleh punya default sendiri (opt-in).
  const conflict = s.conflict ?? CONFLICT_DEFAULTS;
  const saveConflict = (patch: Partial<Setting["conflict"]>, msg: string) =>
    store.save({ conflict: { ...conflict, ...patch } }, msg);

  // SPEC-488 · agen yang MENJALANKAN hanoman-lead. Tulisnya lewat PUT /lead/config (lihat engines.ts).
  const lead = s.lead ?? LEAD_DEFAULTS;
  const engine = lead.engine ?? LEAD_DEFAULTS.engine;

  return (
    <>
      <Card eyebrow="override" title="Override per fungsi" data-setting-card data-search="override per fungsi">
        <Prose>
          Default global diatur di <b>Sesi harian</b>. Tiap fungsi di bawah bisa memakai setelan sendiri; bila
          sakelarnya mati, ia ikut default global. Agen operator Telegram juga override, tetapi diatur di
          satu tempat bersama kredensial Telegram.
        </Prose>
        <div className="hn-set-inline">
          <Button size="sm" variant="ghost" leftIcon="send" onClick={() => onNavigate("telegram")}>
            Buka Telegram
          </Button>
        </div>
      </Card>

      <FunctionOverride
        eyebrow="konflik" title="Konflik rebase & merge"
        desc="Saat rebase/merge berkonflik, hanoman menyerahkan worktree-nya ke satu sesi agen untuk dibereskan. Pekerjaannya sempit dan tak berfase, jadi ia boleh memakai model & effort yang berbeda dari sesi kerja. Berlaku untuk ketiga pintu integrasi: backlog, git graph, dan PRD."
        toggleDesc="Mati = ikut default global. Hidup = sesi konflik memakai pilihan di bawah."
        toggleAria="Override agen konflik"
        enabled={conflict.enabled}
        onToggle={(v) => saveConflict({ enabled: v },
          "Setelan konflik" + (v ? " · aktif" : " · ikut default global"))}
        inheritedTestId="conflict-inherited"
        inherited={inheritedText("Sesi konflik memakai default global:")}>
        <EngineFields
          engine={{ enabled: conflict.enabled, agent: conflict.agent, model: conflict.model, effort: conflict.effort }}
          labels={{
            agentTitle: "Agen", agentDesc: "Mesin yang membereskan konflik. Bisa beda dari agen sesi kerja.",
            effortDesc: "Konflik biasanya mekanis — effort rendah sering cukup.",
            aria: { agent: "Agen konflik", model: "Model konflik", effort: "Effort konflik" },
            msg: { agent: "Agen konflik", model: "Model konflik", effort: "Effort konflik" },
          }}
          defaults={defaults} codexVer={codexVer}
          save={(patch: EnginePatch, msg: string) => saveConflict(patch, msg)} />
      </FunctionOverride>

      <FunctionOverride
        eyebrow="lead" title="Agen hanoman-lead"
        desc={<>Mesin yang menjalankan agen pemimpin — panggilan sekali-jalan non-interaktif yang membaca docs, plan, kode, dan riwayat git sebelum memutuskan. Berlaku untuk ketiga pintu lead (kontrak, deteksi otomatis, denyut) dan dipakai putusan berikutnya, tanpa restart. Rem darurat, denyut, dan opt-in per project tetap diurus di layar <b>Lead</b>.</>}
        toggleDesc="Mati = ikut default global. Hidup = lead memakai pilihan di bawah."
        toggleAria="Override agen lead"
        enabled={engine.enabled}
        onToggle={(v) => saveLeadEngine(store, onToast, { enabled: v },
          "Setelan lead" + (v ? " · aktif" : " · ikut default global"))}
        inheritedTestId="lead-engine-inherited"
        inherited={inheritedText("hanoman-lead memakai default global:")}>
        <EngineFields
          engine={engine}
          labels={{
            agentTitle: "Runtime", agentDesc: "Mesin yang menjalankan lead. Bisa beda dari agen sesi kerja.",
            effortDesc: "Putusan lead menuntut membaca bukti — dokumen proyek, ADR, plan, kode, riwayat git. Effort rendah memangkas kedalamannya.",
            aria: { agent: "Runtime lead", model: "Model lead", effort: "Effort lead" },
            msg: { agent: "Runtime lead", model: "Model lead", effort: "Effort lead" },
          }}
          defaults={defaults} codexVer={codexVer}
          save={(patch, msg) => saveLeadEngine(store, onToast, patch, msg)} />
      </FunctionOverride>

      {/* SPEC-854 · ADR-0130 · obrolan portal klien. TANPA pemilih runtime: gerbang tool (`--tools`)
          yang menjaga fitur ini adalah flag claude (ADR-0129 gotcha 5). Ia fitur on/off, bukan override
          model, jadi sakelarnya berlabel "Aktifkan obrolan" — kontrol dan bentuknya tetap sama. */}
      <FunctionOverride
        eyebrow="portal" title="Obrolan portal klien"
        desc="Permukaan obrolan di portal klien: klien memilih Brainstorming (digali sampai jelas, keluarannya PRD draft untuk Anda review) atau Bertanya (dijawab langsung dari dokumen project). Jatah berlaku per project dan dihitung bulanan; brainstorming dan pertanyaan punya jatah masing-masing."
        toggleTitle="Aktifkan obrolan"
        toggleDesc="Mati = klien hanya punya Pekerjaan & Help desk, persis seperti sebelumnya."
        toggleAria="Aktifkan obrolan portal"
        enabled={(s.portalChat ?? PORTAL_CHAT_DEFAULTS).enabled}
        onToggle={(v) => store.save({ portalChat: { ...(s.portalChat ?? PORTAL_CHAT_DEFAULTS), enabled: v } },
          "Obrolan portal" + (v ? " · aktif" : " · mati"))}>
        <PortalChatFields s={s} store={store} onToast={onToast} />
      </FunctionOverride>

      {/* ADR-0164 · orkestrasi subagent per fase. Kartunya sendiri dari OrchestrationPanel. */}
      <OrchestrationPanel orchestration={s.orchestration}
        onChange={(orchestration, msg) => { void store.save({ orchestration }, msg); }} />
    </>
  );
}

/** Isi obrolan portal ketika sakelarnya hidup. Jatah diperiksa saat kolomnya ditinggalkan. */
function PortalChatFields({ s, store, onToast }: { s: Setting; store: SettingsStore; onToast?: ShowToast }) {
  const portalChat = s.portalChat ?? PORTAL_CHAT_DEFAULTS;
  const savePortalChat = (patch: Partial<Setting["portalChat"]>, msg: string) =>
    store.save({ portalChat: { ...portalChat, ...patch } }, msg);
  const model = useSettingField<string>({
    value: portalChat.model, delayMs: 0,
    save: (m) => savePortalChat({ model: m, ...claudeEffortPatch(m, portalChat.effort) }, "Model obrolan portal → " + m),
  });
  const effort = useSettingField<string>({
    value: portalChat.effort, delayMs: 0,
    save: (e) => savePortalChat({ effort: e }, "Effort obrolan portal → " + e),
  });
  return (
    <>
      <SettingRow title="Jatah brainstorming" desc="Berapa sesi brainstorming per project tiap bulan. 0 = tertutup.">
        <NumberSettingField label="Jatah brainstorming" value={portalChat.brainstormPerMonth} min={0} max={1000}
          placeholder="mis. 3" onToast={onToast}
          onCommit={(n) => savePortalChat({ brainstormPerMonth: n }, "Jatah brainstorming → " + n)} />
      </SettingRow>
      <SettingRow title="Jatah pertanyaan" desc="Berapa sesi tanya-jawab per project tiap bulan. 0 = tertutup.">
        <NumberSettingField label="Jatah pertanyaan" value={portalChat.askPerMonth} min={0} max={10000}
          placeholder="mis. 30" onToast={onToast}
          onCommit={(n) => savePortalChat({ askPerMonth: n }, "Jatah pertanyaan → " + n)} />
      </SettingRow>
      <SettingRow title="Model" desc="Mesin obrolan selalu Claude — gerbang tool yang menjaganya tak ada di runtime lain.">
        <Select size="sm" aria-label="Model obrolan portal" value={model.value} className="hn-set-w-sm"
          options={claudeOptions(model.value)}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => model.set(e.target.value)} />
      </SettingRow>
      <SettingRow title="Effort">
        <Select size="sm" aria-label="Effort obrolan portal" value={effort.value} className="hn-set-w-xs"
          options={claudeEffortOptions(model.value)}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => effort.set(e.target.value)} />
      </SettingRow>
      <SettingRow title="Batas waktu satu jawaban" last
        desc="Detik. Lewat dari ini klien menerima kalimat 'coba lagi sebentar', bukan layar menggantung.">
        <NumberSettingField label="Batas waktu obrolan portal" value={portalChat.timeoutSec} min={10} max={900}
          placeholder="mis. 120" onToast={onToast}
          onCommit={(n) => savePortalChat({ timeoutSec: n }, "Batas waktu obrolan → " + n)} />
      </SettingRow>
    </>
  );
}

