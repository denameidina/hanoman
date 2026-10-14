import { BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS } from "@hanoman/shared";
import { runtimeFor } from "../session-runtime";
// Audit UI/UX 2026-10 · Fase 3C · niat "Integrasi & akses". Telegram di sini adalah SATU tempat: kredensial
// (form Simpan eksplisit), gateway, dan agen operator (override). Dua tempat Telegram di Fase 1 kini satu.
import React from "react";
import { Badge, Button, Callout, Card, Icon, Input, StateBlock, Switch, useConfirm } from "../../ds";
import type { ShowToast } from "../../ds";
import { api } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import { configEntry, CODEX_DEFAULTS, TELEGRAM_DEFAULTS } from "@hanoman/shared";
import type {
  Setting, TelegramCredentialsView, TelegramGatewayStatus, TelegramTestResult,
} from "@hanoman/shared";
import { WebhooksPanel } from "../WebhooksPanel";
import { WebhookDocs } from "../WebhookDocs";
import { AGENT_LABEL, type CodexVersionState } from "./model";
import { EngineFields, FunctionOverride, type EnginePatch } from "./fields";
import { Prose, SettingRow } from "./rows";
import { saveTelegramEngine } from "./engines";
import type { SettingsStore } from "./useSettingsStore";
import { useSettingField } from "./useSettingField";

export function TelegramSection({ s, store, onToast, codexVer }: {
  s: Setting;
  store: SettingsStore;
  onToast?: ShowToast;
  codexVer: CodexVersionState | null;
}) {
  const { confirm, dialog } = useConfirm();
  const telegram = s.telegram ?? TELEGRAM_DEFAULTS;
  const [telegramStatus, setTelegramStatus] = React.useState<TelegramGatewayStatus | null>(null);
  const [telegramFailed, setTelegramFailed] = React.useState(false);
  const loadTelegram = React.useCallback(() => {
    setTelegramFailed(false); setTelegramStatus(null);
    api.getTelegramStatus().then(setTelegramStatus).catch(() => setTelegramFailed(true));
  }, []);
  React.useEffect(() => { loadTelegram(); }, [loadTelegram]);

  // SPEC-477 · ADR-0097 · kredensial Telegram hidup di store config, bukan .env.
  const [tgCreds, setTgCreds] = React.useState<TelegramCredentialsView | null>(null);
  const [tgDraft, setTgDraft] = React.useState<Record<string, string>>({});
  const [tgTest, setTgTest] = React.useState<TelegramTestResult | "sending" | null>(null);
  const [tgBusy, setTgBusy] = React.useState(false);
  const loadTgCreds = React.useCallback(() => {
    api.getTelegramCredentials().then((v) => { setTgCreds(v); setTgDraft({}); }).catch(() => setTgCreds(null));
  }, []);
  React.useEffect(() => { loadTgCreds(); }, [loadTgCreds]);

  // Gateway: sakelar diskret, auto-save dengan status per baris.
  const gatewayEnabled = useSettingField<boolean>({
    value: telegram.enabled, delayMs: 0,
    save: (enabled) => store.save({ telegram: { ...telegram, enabled } }, `Gateway Telegram · ${enabled ? "aktif" : "nonaktif"}`),
  });
  const progress = useSettingField<boolean>({
    value: telegram.progress, delayMs: 0,
    save: (on) => store.save({ telegram: { ...telegram, progress: on } }, `Progress Telegram · ${on ? "aktif" : "nonaktif"}`),
  });

  // Agen operator Telegram: override satu-bentuk. Blok ini punya penulis ketiga (command dari chat),
  // jadi tulisnya lewat GET + PUT segar (engines.ts), bukan snapshot mount.
  const tgEngine = telegram.engine ?? TELEGRAM_DEFAULTS.engine;
  const agent = s.agent ?? "claude";
  const codex = s.codex ?? CODEX_DEFAULTS;
  const defaults = {
    claude: { model: s.model, effort: s.effort },
    codex: { model: codex.model, effort: codex.effort },
    antigravity: s.antigravity ?? BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS,
  };
  const inherited = { agent, ...runtimeFor({ claude: { model: s.model, effort: s.effort }, codex, antigravity: s.antigravity ?? BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS }, agent) };

  // `source === "env"` = nilai masih datang dari .env: jalur warisan yang sengaja hidup, tapi ditandai.
  const sourceBadge = (src: "db" | "env" | "default") =>
    src === "db" ? <Badge tone="ok">tersimpan</Badge>
      : src === "env" ? <Badge tone="warn">dari .env · deprecated</Badge>
        : <Badge>belum diisi</Badge>;

  const dirty = Object.values(tgDraft).some((v) => v !== "");
  // Kredensial hanya ditulis saat Simpan ditekan, bukan saat tiap ketikan.
  const saveCreds = () => {
    const patch = Object.fromEntries(Object.entries(tgDraft).filter(([, v]) => v !== ""));
    if (!Object.keys(patch).length) { onToast?.("Tak ada perubahan", "info", "info"); return; }
    setTgBusy(true);
    api.putTelegramCredentials(patch)
      .then((v) => {
        setTgCreds(v); setTgDraft({}); setTgTest(null);
        onToast?.("Kredensial Telegram disimpan", "ok", "check-circle-2");
        loadTelegram();
      })
      .catch((e: unknown) => onToast?.(failureMessage("menyimpan kredensial Telegram", e), "err", "alert-triangle"))
      .finally(() => setTgBusy(false));
  };
  const runTest = () => {
    setTgTest("sending");
    api.testTelegramConnection().then(setTgTest)
      .catch((e: Error) => setTgTest({
        ok: false, error: e.message || "Gagal menghubungi server",
        inbound: { ok: false, reason: "Status jalur masuk tak terbaca — server tak menjawab.", missingCapabilities: [], polling: false },
      }));
  };
  // Hapus lewat dialog aplikasi dengan daftar dampak; pesan sukses menunggu penghapusan benar-benar berhasil.
  const removeCreds = async () => {
    let result = null as null | { envFallback: string[] };
    try {
      const done = await confirm({
        title: "Hapus kredensial Telegram?",
        message: "Gateway berhenti kecuali nilai .env lama masih tersedia.",
        impact: ["Keempat nilai dihapus dari database.", "Gateway berhenti menerima pesan sampai kredensial diisi lagi."],
        confirmLabel: "Hapus kredensial",
        tone: "danger",
        icon: "trash-2",
        run: async () => { result = await api.deleteTelegramCredentials(); },
      });
      if (!done) return;
      const left = result?.envFallback.length ?? 0;
      onToast?.(left
        ? `Kredensial dihapus — ${left} nilai masih datang dari .env`
        : "Kredensial Telegram dihapus", "ok", "check-circle-2");
      setTgTest(null); loadTgCreds(); loadTelegram();
    } catch (e) {
      onToast?.(failureMessage("menghapus kredensial Telegram", e), "err", "alert-triangle");
    }
  };

  return (
    <>
      <Card eyebrow="telegram" title="Kredensial Telegram" data-setting-card data-search="kredensial telegram bot token chat allowlist agenttoken">
        <Prose>
          Disimpan terenkripsi di database dan berlaku langsung — tanpa mengedit <code>.env</code>,
          tanpa restart. Nilai <code>.env</code> lama tetap dipakai selama field-nya masih kosong.
          Perubahan baru tersimpan saat tombol <b>Simpan kredensial</b> ditekan.
        </Prose>
        {!tgCreds ? <StateBlock kind="loading" compact title="Memuat kredensial…" />
          : (
            <form onSubmit={(ev) => { ev.preventDefault(); if (dirty && !tgBusy) saveCreds(); }}>
              {tgCreds.fields.map((f, i) => (
                <SettingRow key={f.key} title={f.label} desc={f.help} last={i === tgCreds.fields.length - 1}>
                  <div className="hn-set-inline">
                    {sourceBadge(f.source)}
                    <Input
                      aria-label={f.label}
                      mono
                      type={f.kind === "secret" ? "password" : "text"}
                      placeholder={f.kind === "secret"
                        ? (f.masked ?? configEntry(f.key)?.example ?? "belum diisi")
                        : (configEntry(f.key)?.example ?? "belum diisi")}
                      value={tgDraft[f.key] ?? (f.kind === "secret" ? "" : (f.value ?? ""))}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setTgDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="hn-set-w-input"
                    />
                  </div>
                </SettingRow>
              ))}
              <div className="hn-set-form-actions">
                <span className="hn-set-dirty" role="status">
                  {dirty ? "Ada perubahan belum disimpan." : "Belum ada perubahan."}
                </span>
                <Button size="sm" type="submit" leftIcon="save" disabled={!dirty || tgBusy}>Simpan kredensial</Button>
              </div>
            </form>
          )}
      </Card>

      <Card eyebrow="uji" title="Uji koneksi & hapus" data-setting-card data-search="uji koneksi test connection hapus kredensial"
        actions={<Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={loadTgCreds}>Refresh</Button>}>
        <SettingRow title="Test Connection"
          desc="Mengirim satu pesan percobaan ke chat tujuan. Batas 10 detik — tak pernah menggantung.">
          <Button size="sm" leftIcon="send" disabled={tgTest === "sending"} onClick={runTest}>Test Connection</Button>
        </SettingRow>
        {tgTest && tgTest !== "sending" && (
          <div className="hn-set-result">
            {/* Hasil uji diumumkan ke pembaca layar: sukses sebagai status, galat sebagai alert. */}
            {tgTest.ok
              ? <Callout tone="ok" role="status">Berhasil — bot @{tgTest.botUsername ?? "?"} mengirim ke chat {tgTest.chatId}.</Callout>
              : <Callout tone="err" role="alert">{tgTest.error}</Callout>}
            {/* SPEC-491 · uji di atas hanya jalur KELUAR. Hijau di sana pernah berdampingan dengan jalur
                masuk yang mati total — itulah keluhan "diam total": pesan tak pernah tertangkap. */}
            {tgTest.inbound?.ok
              ? <Callout tone="ok" role="status">Jalur masuk siap — gateway sedang long polling dan token agen (AgentToken)-nya sah.</Callout>
              : <Callout tone="warn" role="alert">
                  Jalur masuk BELUM siap: {tgTest.inbound?.reason ?? "status tak terbaca."}
                  {!!tgTest.inbound?.missingCapabilities.length && (
                    <> Capability yang kurang: <code>{tgTest.inbound.missingCapabilities.join(", ")}</code>.</>
                  )}
                  {" "}Selama ini merah, pesan Telegram tidak akan pernah tertangkap.
                </Callout>}
          </div>
        )}
        <SettingRow title="Hapus kredensial" last
          desc="Menghapus keempat nilai dari database. Bila .env lama masih terisi, nilainya kembali dipakai.">
          <Button size="sm" variant="danger" leftIcon="trash-2" onClick={() => void removeCreds()}>Hapus kredensial</Button>
        </SettingRow>
      </Card>

      <Card eyebrow="gateway" title="Gateway Telegram" data-setting-card data-search="gateway telegram aktif progress readiness allowlist onboarding"
        actions={<Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={loadTelegram}>Refresh</Button>}>
        <Prose>
          Satu private chat yang diizinkan terikat ke satu session operator Hanoman persisten.
          Bahasa natural tetap antarmuka utama; command hanya shortcut ke session yang sama.
        </Prose>
        <SettingRow title="Gateway aktif" save={gatewayEnabled}
          desc="Menyalakan long polling in-process seketika. Mematikan tidak membunuh session tmux atau memory.">
          <Switch aria-label="Gateway aktif" checked={gatewayEnabled.value} onChange={(v: boolean) => gatewayEnabled.set(v)} />
        </SettingRow>
        <SettingRow title="Kirim progress ringkas" save={progress}
          desc="Hanya progress eksplisit dan fakta status Hanoman; layar PTY/reasoning tidak pernah diteruskan.">
          <Switch aria-label="Kirim progress ringkas" checked={progress.value} onChange={(v: boolean) => progress.set(v)} />
        </SettingRow>
        {telegramFailed ? <StateBlock kind="error" compact title="Gagal membaca status Telegram" action={loadTelegram} />
          : !telegramStatus ? <StateBlock kind="loading" compact title="Memuat status Telegram…" />
          : <>
            <SettingRow title={`Readiness · ${telegramStatus.readiness ?? "memuat"}`}
              desc={telegramStatus.running ? "Long poll aktif." : telegramStatus.lastError ?? "Gateway belum polling."}>
              <span className="hn-set-mono">
                {telegramStatus.botUsername ? `@${telegramStatus.botUsername}` : "bot belum terverifikasi"}
              </span>
            </SettingRow>
            <SettingRow title="Allowlist" last={!telegramStatus.missingCapabilities.length}
              desc={`${telegramStatus.allowlistCount} Telegram numeric user id diizinkan.`}>
              <span>{telegramStatus.configured ? "kredensial lengkap" : "kredensial belum lengkap"}</span>
            </SettingRow>
            {telegramStatus.missingCapabilities.length > 0 && <SettingRow title="Capability kurang" last
              desc={telegramStatus.missingCapabilities.join(", ")} />}
          </>}
        <div className="hn-set-onboarding">
          <b>Onboarding</b>
          <ol>
            <li>Buat satu bot private-chat lewat BotFather, salin token-nya.</li>
            <li>Di Akses AI Agent, aktifkan master switch dan buat <b>token agen (AgentToken)</b> dengan capability yang ditampilkan status.</li>
            <li>Isi keempat field di kartu Kredensial lalu tekan Simpan kredensial.</li>
            <li>Tekan Test Connection sampai hijau.</li>
            <li>Nyalakan gateway di atas dan kirim <code>/status</code> dari Telegram.</li>
          </ol>
        </div>
      </Card>

      <FunctionOverride
        eyebrow="telegram" title="Agen operator Telegram"
        desc={<span data-testid="telegram-engine-desc">
          Mesin yang menjalankan sesi operator Telegram — satu sesi persisten per chat, yang membaca API hanoman
          lalu merangkum. Berlaku untuk sesi operator <b>berikutnya</b> yang dibuat; sesi yang sedang jalan tetap
          memakai setelan lamanya dan tidak di-restart diam-diam — tutup dari chat dengan <code>/engine restart</code>.
          Setelan yang sama juga bisa diubah dari chat: <code>/engine</code>, <code>/runtime</code>,{" "}
          <code>/model</code>, <code>/effort</code>. Berlaku global untuk semua chat.
        </span>}
        toggleDesc="Mati = ikut default global. Hidup = sesi operator Telegram memakai pilihan di bawah."
        toggleAria="Override agen Telegram"
        enabled={tgEngine.enabled}
        onToggle={(v) => saveTelegramEngine(store, onToast, { enabled: v },
          "Setelan operator Telegram" + (v ? " · aktif" : " · ikut default global"))}
        inheritedTestId="telegram-engine-inherited"
        inherited={<>Sesi operator Telegram memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> · <code>{inherited.model}</code> · <code>{inherited.effort}</code>.</>}>
        <EngineFields
          engine={tgEngine}
          labels={{
            agentTitle: "Runtime", agentDesc: "Mesin yang menjalankan sesi operator. Bisa beda dari agen sesi kerja.",
            effortDesc: "Operator Telegram jarang menulis kode — effort rendah memangkas latensi balasan secara langsung.",
            aria: { agent: "Runtime Telegram", model: "Model Telegram", effort: "Effort Telegram" },
            msg: { agent: "Runtime operator Telegram", model: "Model operator Telegram", effort: "Effort operator Telegram" },
          }}
          defaults={defaults} codexVer={codexVer}
          save={(patch: EnginePatch, msg: string) => saveTelegramEngine(store, onToast, patch, msg)} />
      </FunctionOverride>
      {dialog}
    </>
  );
}

/** Webhook keluar: daftar endpoint, dan dokumentasinya dilipat di bawah (bukan halaman terpisah). */
export function WebhookSection({ onToast }: { onToast?: ShowToast }) {
  return (
    <>
      <WebhooksPanel onToast={onToast} />
      <details className="hn-set-fold" data-testid="webhook-docs-fold">
        <summary className="hn-set-fold-summary">
          <Icon name="book-open" size={14} /> Dokumentasi webhook
        </summary>
        <WebhookDocs />
      </details>
    </>
  );
}
