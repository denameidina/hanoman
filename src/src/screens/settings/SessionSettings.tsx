import { BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS } from "@hanoman/shared";
import { runtimeFor, runtimeModelOptions, runtimeEfforts, runtimeOptions, runtimeCoerceEffort } from "../session-runtime";
// Audit UI/UX 2026-10 · Fase 3C · niat "Sesi harian": notifikasi, perilaku sesi, default agen & model,
// mode goal, scope verifikasi, dan metode workflow. Ini kebiasaan harian, jadi default-nya ditaruh di
// sini dan BUKAN di "Agen & model" (satu sumber untuk setiap angka; "Agen & model" membaca default ini).
import React from "react";
import { Badge, Button, Card, HnTextarea, Radio, RadioGroup, Select, Switch } from "../../ds";
import type { ShowToast } from "../../ds";
import { usePetEnabled, type PetEnabled } from "../../ui-state/pet-pref";
import { api } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import { useModelCatalog } from "../../api/model-catalog";
import { playNotifySound, type NotifySound } from "../../notifications/sound";
import {
  CODEX_DEFAULTS, CODEX_MODELS, METHODS, METHOD_IDS, codexEfforts, coerceCodexEffort, modelSelectOptions,
  resolveMethod, type MethodSkillStatus, type MethodStatusResponse,
} from "@hanoman/shared";
import type { Setting } from "@hanoman/shared";
import {
  AGENT_LABEL, S_SOUNDS, claudeEffortOptions, claudeEffortPatch, claudeOptions, type CodexVersionState,
} from "./model";
import { AntigravityVersionNote, AgentGroupHeader, CodexVersionNote } from "./fields";
import { Prose, SectionNote, SettingRow } from "./rows";
import type { SettingsStore } from "./useSettingsStore";
import { useSettingField } from "./useSettingField";

type SwitchKey = "notifyDone" | "notifyDecision" | "notifyFail" | "autoDefault" | "autoScaffold";

/** Nilai RadioGroup "Tampilkan Hanoman (pet)" → preferensi per-browser (null = default per tier). */
const PET_PREF_OF: Record<string, PetEnabled> = { default: null, tampil: true, sembunyi: false };

/** Sakelar boolean di root Setting: auto-save diskret (tanpa debounce) dengan toast "· aktif/nonaktif". */
function useSwitchSetting(store: SettingsStore, key: SwitchKey, value: boolean, msg: string) {
  return useSettingField<boolean>({
    value, delayMs: 0,
    save: (v) => store.save({ [key]: v } as Partial<Setting>, msg + (v ? " · aktif" : " · nonaktif")),
  });
}

export function SessionSettings({ s, store, onToast, codexVer }: {
  s: Setting;
  store: SettingsStore;
  onToast?: ShowToast;
  codexVer: CodexVersionState | null;
}) {
  const modelCatalog = useModelCatalog();
  const [methodStatuses, setMethodStatuses] = React.useState<MethodStatusResponse | null>(null);
  // Pemasangan butuh project yang ter-bind ke checkout lokal: sesinya lahir di repoDir project itu.
  const [installProject, setInstallProject] = React.useState("");
  React.useEffect(() => {
    api.getMethodStatus().then(setMethodStatuses).catch(() => setMethodStatuses(null));
    api.listProjects({ limit: 100 })
      .then((r) => setInstallProject((p) => p || (r.items.find((x) => x.binding ?? x.repoDir)?.id ?? "")))
      .catch((e: unknown) => onToast?.(failureMessage("memuat daftar project", e), "err", "alert-triangle"));
  }, []);

  // ── Pet Hanoman (per browser) ────────────────────────────────────────────────
  // Tiga pilihan memetakan ke `PetEnabled`: null = default per tier, true/false = pilihan eksplisit.
  const [petPref, setPetPref] = usePetEnabled();
  const petKey = petPref === null ? "default" : petPref ? "tampil" : "sembunyi";

  // ── Notifikasi ─────────────────────────────────────────────────────────────
  const notifyDone = useSwitchSetting(store, "notifyDone", s.notifyDone, "Notifikasi backlog selesai");
  const notifySound = useSettingField<string>({
    value: s.notifySound, delayMs: 0,
    save: (v) => store.save({ notifySound: v as NotifySound }, "Sound → " + v),
  });
  const notifyDecision = useSwitchSetting(store, "notifyDecision", s.notifyDecision, "Notifikasi keputusan");
  const notifyDecisionSound = useSettingField<string>({
    value: s.notifyDecisionSound, delayMs: 0,
    save: (v) => store.save({ notifyDecisionSound: v as NotifySound }, "Sound keputusan → " + v),
  });
  const notifyFail = useSwitchSetting(store, "notifyFail", s.notifyFail, "Notifikasi gagal");

  // ── Perilaku sesi ─────────────────────────────────────────────────────────
  const autoDefault = useSwitchSetting(store, "autoDefault", s.autoDefault, "Full-auto default");
  const autoScaffold = useSwitchSetting(store, "autoScaffold", s.autoScaffold, "Auto-scaffold");

  // ── Default agen & model (blok milik agen terpilih yang dipakai sesi baru) ──
  const agent = s.agent ?? "claude";
  const codex = s.codex ?? CODEX_DEFAULTS;
  const agentField = useSettingField<Setting["agent"]>({
    value: agent, delayMs: 0, save: (v) => store.save({ agent: v }, "Agen → " + v),
  });
  const claudeModel = useSettingField<string>({
    value: s.model, delayMs: 0,
    save: (v) => store.save({ model: v, ...claudeEffortPatch(v, s.effort) }, "Model claude → " + v),
  });
  const claudeEffort = useSettingField<string>({
    value: s.effort, delayMs: 0, save: (v) => store.save({ effort: v }, "Effort claude → " + v),
  });
  const codexModelField = useSettingField<string>({
    value: codex.model, delayMs: 0,
    // SPEC-339 · effort ikut dikoreksi: memilih model yang tak punya effort `ultra` harus menyimpan
    // pasangan yang sah, bukan pasangan yang nanti ditolak codex saat sesi lahir.
    save: (m) => store.save({ codex: { model: m, effort: coerceCodexEffort(m, codex.effort) } }, "Model codex → " + m),
  });
  const codexEffortField = useSettingField<string>({
    value: codex.effort, delayMs: 0,
    save: (e) => store.save({ codex: { ...codex, effort: e } }, "Effort codex → " + e),
  });

  const antigravity = s.antigravity ?? BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS;
  const agModel = useSettingField<string>({ value: antigravity.model, delayMs: 0,
    save: (model) => store.save({ antigravity: { model, effort: runtimeCoerceEffort("antigravity", model, antigravity.effort) } }, "Model Antigravity → " + model),
  });
  const agEffort = useSettingField<string>({ value: antigravity.effort, delayMs: 0,
    save: (effort) => store.save({ antigravity: { ...antigravity, effort } }, "Effort Antigravity → " + effort),
  });

  // ── Mode goal & scope verifikasi & metode ─────────────────────────────────
  const goalEnabled = useSettingField<boolean>({
    value: s.goal.enabled, delayMs: 0,
    save: (v) => store.save({ goal: { ...s.goal, enabled: v } }, "Mode goal" + (v ? " · aktif" : " · nonaktif")),
  });
  // Kondisi goal = teks: auto-save dengan debounce, dan langsung tersimpan saat kolom ditinggalkan.
  const goalCondition = useSettingField<string>({
    value: s.goal.condition,
    save: (c) => store.save({ goal: { ...s.goal, condition: c } }, "Kondisi mode goal disimpan"),
  });
  const verifyScope = useSettingField<Setting["verifyScope"]>({
    value: s.verifyScope ?? "changed", delayMs: 0,
    save: (v) => store.save({ verifyScope: v }, "Scope verifikasi → " + v),
  });
  const method = useSettingField<string>({
    value: resolveMethod(s.method).id, delayMs: 0,
    save: (v) => store.save({ method: v }, "Metode → " + v),
  });

  // SPEC-739 · ADR-0114 · pemasangan lewat SESI TERMINAL (ADR-0056). Yang dikirim hanya metode + agen;
  // perintahnya diturunkan SERVER dari katalog, jadi UI tak pernah memegang literalnya.
  const installMethod = async (m: MethodSkillStatus) => {
    if (!installProject) return;
    try {
      await api.createShell(installProject, { method: m.method, agent: m.agent });
      onToast?.(`Pemasangan ${m.label} · ${AGENT_LABEL[m.agent]} berjalan di Terminal`, "ok", "terminal");
    } catch {
      onToast?.("Gagal membuka sesi terminal pemasangan", "err", "alert-triangle");
    }
  };

  const inherited = { agent, ...runtimeFor({ claude: { model: s.model, effort: s.effort }, codex, antigravity: s.antigravity ?? BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS }, agent) };

  return (
    <>
      <Card eyebrow="sesi" title="Sesi & notifikasi" data-setting-card data-search="sesi notifikasi suara">
        <SettingRow title="Notifikasi backlog selesai"
          desc="Toast + sound saat sebuah backlog mencapai stage done. Daftar lonceng tetap terisi meski dimatikan."
          save={notifyDone}>
          <Switch aria-label="Notifikasi backlog selesai" checked={notifyDone.value}
            onChange={(v: boolean) => notifyDone.set(v)} />
        </SettingRow>
        <SettingRow title="Sound notifikasi" desc="Durasi nada saat backlog selesai." save={notifySound}>
          <div className="hn-set-inline">
            <Select size="sm" aria-label="Sound notifikasi" value={notifySound.value} options={S_SOUNDS} className="hn-set-w-sm"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => notifySound.set(e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={notifySound.value === "off"}
              onClick={() => playNotifySound(notifySound.value as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi butuh keputusan"
          desc="Toast + sound saat sesi Claude berhenti menunggu keputusanmu. Nada sengaja beda dari selesai."
          save={notifyDecision}>
          <Switch aria-label="Notifikasi keputusan" checked={notifyDecision.value}
            onChange={(v: boolean) => notifyDecision.set(v)} />
        </SettingRow>
        <SettingRow title="Sound keputusan" desc="Nada saat sebuah sesi menunggu keputusan." save={notifyDecisionSound}>
          <div className="hn-set-inline">
            <Select size="sm" aria-label="Sound keputusan" value={notifyDecisionSound.value} options={S_SOUNDS} className="hn-set-w-sm"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => notifyDecisionSound.set(e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={notifyDecisionSound.value === "off"}
              onClick={() => playNotifySound(notifyDecisionSound.value as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi saat sesi gagal" last desc="Kirim notifikasi ketika sesi Claude Code berakhir dengan error."
          save={notifyFail}>
          <Switch aria-label="Notifikasi gagal" checked={notifyFail.value}
            onChange={(v: boolean) => notifyFail.set(v)} />
        </SettingRow>
      </Card>

      <Card eyebrow="umum" title="Perilaku sesi" data-setting-card data-search="perilaku sesi full-auto scaffold doc index">
        <SettingRow title="Full-auto sebagai default"
          desc="Run baru jalan sendiri sampai selesai. Manusia tetap bisa steer / interupsi kapan pun."
          save={autoDefault}>
          <Switch aria-label="Full-auto sebagai default" checked={autoDefault.value}
            onChange={(v: boolean) => autoDefault.set(v)} />
        </SettingRow>
        <SettingRow title="Auto-scaffold doc index"
          desc="Project yang dibuat dari nol otomatis disiapkan indeks dokumennya setelah tujuannya terkunci."
          save={autoScaffold}>
          <Switch aria-label="Auto-scaffold" checked={autoScaffold.value}
            onChange={(v: boolean) => autoScaffold.set(v)} />
        </SettingRow>
        {/* Preferensi per-browser (ui-state/pet-pref.ts), bukan Setting server: tanpa `save`, tak ada PUT. */}
        <SettingRow title="Tampilkan Hanoman (pet)" last search="pet hanoman maskot tampil sembunyi"
          desc="Pendamping kecil di sudut layar. Pilihan ini hanya berlaku di browser ini. Default: aktif di desktop, mati di tablet & ponsel.">
          <RadioGroup aria-label="Tampilkan Hanoman (pet)" direction="row" value={petKey}
            onChange={(v: string) => setPetPref(PET_PREF_OF[v] ?? null)}>
            <Radio value="default" label="Default" />
            <Radio value="tampil" label="Tampilkan" />
            <Radio value="sembunyi" label="Sembunyikan" />
          </RadioGroup>
        </SettingRow>
      </Card>

      {/* SPEC-338 · ADR-0074 · mesin sesi default. Berlaku untuk SEMUA sesi yang men-spawn agen;
          backlog masih bisa di-override saat Start. Katalog model/effort tiap agen tampil di bawahnya. */}
      <Card eyebrow="model" title="Agen & model — default global" data-setting-card
        data-search="agen model default effort claude codex agen sesi baru">
        <Prose>
          Default untuk sesi baru; bisa di-override per sesi saat <b>Start</b>. Di terminal, <code>/model</code>{" "}
          mengubahnya kapan saja. Dengan orkestrasi aktif, model ini menjadi model <b>orchestrator</b>; model
          &amp; effort tiap fase diatur di bagian <b>Orkestrasi</b> pada Agen &amp; model. Yang benar-benar dipakai adalah blok milik
          agen terpilih di bawah — blok runtime lain tersimpan, menunggu giliran.
        </Prose>
        <SettingRow title="Agen default" desc="Sesi backlog masih bisa memilih agen lain saat Start." save={agentField}>
          <Select size="sm" aria-label="Agen default" value={agentField.value} className="hn-set-w-sm"
            options={runtimeOptions}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => agentField.set(e.target.value as Setting["agent"])} />
        </SettingRow>
        <div data-testid="agent-group-antigravity" className="hn-set-group">
          <AgentGroupHeader id="antigravity" label={AGENT_LABEL.antigravity} active={agent === "antigravity"} />
          <AntigravityVersionNote />
          <SettingRow title="Model" desc="Model parent diteruskan ke agy --model." save={agModel}>
            <Select size="sm" aria-label="Model antigravity" value={agModel.value} options={runtimeModelOptions("antigravity", agModel.value)} onChange={(e) => agModel.set(e.target.value)} />
          </SettingRow>
          <SettingRow title="Effort" last desc="Effort mengikuti kemampuan slug model parent." save={agEffort}>
            <Select size="sm" aria-label="Effort antigravity" value={agEffort.value} options={runtimeEfforts("antigravity", agModel.value).map((value) => ({ value, label: value }))} onChange={(e) => agEffort.set(e.target.value)} />
          </SettingRow>
        </div>
        <div data-testid="agent-group-claude" className="hn-set-group">
          <div className="hn-set-catalog">
            Katalog model diperiksa otomatis setiap 5 menit.
            {Object.entries(modelCatalog.providers).map(([name, status]) => (
              <div key={name}>
                {name}: {status.source === "bundled" ? "daftar bawaan" : status.source === "cache" ? "cache terakhir" : "dari CLI"}
                {status.checkedAt ? " · diperiksa " + new Date(status.checkedAt).toLocaleTimeString() : ""}
                {status.error ? " · " + status.error : ""}
              </div>
            ))}
          </div>
          <AgentGroupHeader id="claude" label={AGENT_LABEL.claude} active={agent === "claude"} />
          <SettingRow title="Model" desc="Diteruskan apa adanya ke `claude --model`." save={claudeModel}>
            <Select size="sm" aria-label="Model claude" value={claudeModel.value} options={claudeOptions(claudeModel.value)}
              className="hn-set-w-sm"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => claudeModel.set(e.target.value)} />
          </SettingRow>
          <SettingRow title="Effort" last desc="Anggaran berpikir per giliran (`claude --effort`)." save={claudeEffort}>
            <Select size="sm" aria-label="Effort claude" value={claudeEffort.value} options={claudeEffortOptions(claudeModel.value)}
              className="hn-set-w-xs"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => claudeEffort.set(e.target.value)} />
          </SettingRow>
        </div>
        <div data-testid="agent-group-codex" className="hn-set-group hn-set-group--codex">
          <AgentGroupHeader id="codex" label={AGENT_LABEL.codex} active={agent === "codex"} />
          <CodexVersionNote model={codexModelField.value} codexVer={codexVer} />
          <SettingRow title="Model" desc="Diteruskan apa adanya ke `codex -m`." save={codexModelField}>
            <Select size="sm" aria-label="Model codex" value={codexModelField.value} className="hn-set-w-sm"
              options={modelSelectOptions(CODEX_MODELS, codexModelField.value)}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => codexModelField.set(e.target.value)} />
          </SettingRow>
          <SettingRow title="Effort" last desc="Diteruskan ke `codex -c model_reasoning_effort`." save={codexEffortField}>
            <Select size="sm" aria-label="Effort codex" value={codexEffortField.value} className="hn-set-w-xs"
              options={codexEfforts(codexModelField.value).map((v) => ({ value: v, label: v }))}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => codexEffortField.set(e.target.value)} />
          </SettingRow>
        </div>
        <div className="hn-set-inherited-note" data-testid="session-default-summary">
          Sesi baru memakai <b>{AGENT_LABEL[inherited.agent]}</b> · <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
        </div>
      </Card>

      <Card eyebrow="goal" title="Mode goal — sesi backlog" data-setting-card data-search="mode goal kondisi template gate stop">
        {agent === "antigravity" && <Prose>Mode goal native Antigravity belum didukung. Nilai global tetap disimpan; matikan mode goal secara eksplisit atau pilih runtime lain sebelum memulai sesi.</Prose>}
        <Prose>
          Sesi backlog lahir dengan gate <code>Stop</code>: ia menolak berhenti sampai kondisinya terbukti
          di transkrip. Interupsi manusia (<code>Esc</code>) tetap bekerja; melepas gate sepenuhnya =
          hentikan sesinya. Sesi scheduler mengikuti setelan ini.
        </Prose>
        <SettingRow title="Aktif sebagai default"
          desc="Sesi backlog baru lahir dengan mode goal. Masih bisa dimatikan per sesi saat Start."
          save={goalEnabled}>
          <Switch aria-label="Mode goal default" disabled={agent === "antigravity" && !goalEnabled.value} checked={goalEnabled.value}
            onChange={(v: boolean) => goalEnabled.set(v)} />
        </SettingRow>
        <SettingRow title="Kondisi (template global)" last
          desc="Kosong = kondisi bawaan hanoman: semua fase tercatat di phase file, plan tak menyisakan task, push sukses."
          save={goalCondition}>
          <div className="hn-set-w-field">
            {/* SettingRow bukan <label>, jadi textarea ini diberi aria-label sendiri (SPEC-490). */}
            <GoalConditionField value={goalCondition.value} onSet={goalCondition.set} onFlush={goalCondition.flush} />
          </div>
        </SettingRow>
      </Card>

      {/* SPEC-376 · ADR-0080 · scope verifikasi: default global untuk sesi backlog. Bukan gerbang. */}
      <Card eyebrow="verifikasi" title="Scope verifikasi — sesi backlog" data-setting-card
        data-search="scope verifikasi hanya yang berubah seluruh project uji">
        <Prose>
          Beberapa sesi berjalan bersamaan di perangkat ini. <b>Hanya yang berubah</b> menyuruh sesi menguji
          hanya berkas yang ia ubah — misalnya dengan <code>vitest --changed</code> (uji) dan typecheck per
          paket — alih-alih seluruh project. Dengan begitu RAM dan CPU tetap tersisa untuk sesi lain. Uji
          penuh, lint penuh, dan build penuh tetap dijalankan manusia sebelum merge.
        </Prose>
        <SettingRow title="Scope default" last
          desc="Sesi backlog baru lahir dengan scope ini. Masih bisa diubah per sesi saat Start."
          save={verifyScope}>
          <Select size="sm" aria-label="Scope verifikasi default" value={verifyScope.value} className="hn-set-w-md"
            options={[
              { value: "changed", label: "Hanya yang berubah" },
              { value: "full", label: "Seluruh project" },
            ]}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => verifyScope.set(e.target.value as Setting["verifyScope"])} />
        </SettingRow>
      </Card>

      {/* SPEC-734 · ADR-0113 · metode workflow: default global untuk sesi backlog. */}
      <Card eyebrow="metode" title="Metode workflow — sesi backlog" data-setting-card
        data-search="metode workflow skill direktori plan spec pemasangan">
        <Prose>
          Metode menentukan <b>skill mana yang dimuat di tiap fase</b> dan <b>di direktori mana plan
          &amp; spec ditulis</b>. Fase-fasenya sendiri tak berubah. Gerbang plan memindai direktori
          SEMUA metode, jadi item yang berpindah metode tak pernah lolos lewat direktori kosong.
        </Prose>
        <SettingRow title="Metode default" last
          desc="Sesi backlog baru lahir dengan metode ini. Masih bisa diubah per sesi saat Start."
          save={method}>
          <Select size="sm" aria-label="Metode default" className="hn-set-w-md"
            value={method.value}
            options={METHOD_IDS.map((id) => ({ value: id, label: METHODS[id]!.label }))}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => method.set(e.target.value)} />
        </SettingRow>
        {/* SPEC-739 · ADR-0114 · checklist kesiapan. Metode yang belum siap DITANDAI, tak pernah diblokir. */}
        {methodStatuses && (
          <div data-testid="method-status" className="hn-set-method-status">
            {METHOD_IDS.map((id) => (
              <div key={id} className="hn-set-method">
                <div className="hn-set-method-name">{METHODS[id]!.label}</div>
                {methodStatuses.methods.filter((m) => m.method === id).map((m) => (
                  <div key={m.agent} data-testid={`method-status-${m.method}-${m.agent}`} className="hn-set-method-row">
                    <Badge tone={m.ready ? "ok" : "warn"}>{m.ready ? "siap" : "belum siap"}</Badge>
                    <div className="hn-set-method-text">
                      <b>{AGENT_LABEL[m.agent]}</b>
                      {m.availabilityReason && <div>{m.availabilityReason}</div>}
                      {!m.ready && (
                        <div className="hn-set-method-missing">
                          {m.missingPackages.length > 0 && (
                            <div>paket kurang: <code>{m.missingPackages.join(" · ")}</code></div>)}
                          {m.missingSkills.length > 0 && (
                            <div>skill kurang: <code>{m.missingSkills.join(" · ")}</code></div>)}
                        </div>
                      )}
                    </div>
                    {!m.ready && (
                      <Button size="sm" variant="ghost" leftIcon="download" disabled={!installProject || m.available === false}
                        onClick={() => installMethod(m)}>Pasang</Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <SectionNote>
              {installProject
                ? <>Pemasangan berjalan di <b>sesi terminal</b> project <code>{installProject}</code> — outputnya
                  bisa ditonton di Terminal. hanoman sendiri tak pernah memasang apa pun.</>
                : <>Pemasangan butuh satu project yang sudah di-bind ke checkout lokal: perintahnya
                  dijalankan di sesi terminal project itu.</>}
            </SectionNote>
          </div>
        )}
      </Card>
    </>
  );
}

/**
 * Textarea kondisi goal. Ketikan di-debounce lewat `useSettingField`; blur (dipasang di pembungkus,
 * karena HnTextarea menimpa onBlur-nya sendiri) langsung menyimpan. Bukan per ketikan (audit P0).
 */
function GoalConditionField({ value, onSet, onFlush }: { value: string; onSet: (v: string) => void; onFlush: () => void }) {
  return (
    <div onBlur={() => onFlush()}>
      <HnTextarea value={value} rows={4} mono aria-label="Kondisi mode goal"
        placeholder="mis. semua fase tercatat & plan tanpa - [ ]"
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onSet(e.target.value)} />
    </div>
  );
}
