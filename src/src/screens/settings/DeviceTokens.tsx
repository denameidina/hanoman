// SPEC-213 · Token perangkat: token per-perangkat untuk auth sync ke server pusat. Token plaintext hanya
// ditampilkan SEKALI saat dibuat (server simpan hash). Cabut = cabut satu perangkat, yang lain aman.
import React from "react";
import { Button, Card, Field, Input, StateBlock, useConfirm } from "../../ds";
import type { ShowToast } from "../../ds";
import { api } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import type { DeviceTokenView } from "@hanoman/shared";
import { BlockedHint, Prose, SettingRow } from "./rows";

export function DeviceTokensPanel({ onToast }: { onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const [tokens, setTokens] = React.useState<DeviceTokenView[] | null>(null);
  const [name, setName] = React.useState("");
  const [fresh, setFresh] = React.useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const hintId = React.useId();
  const load = React.useCallback(() => { api.listDeviceTokens().then(setTokens).catch(() => setTokens([])); }, []);
  React.useEffect(() => { load(); }, [load]);
  const blocked = name.trim().length < 1 ? "Isi nama perangkat dulu." : null;
  async function create() {
    if (blocked || busy) return;
    setBusy(true);
    try {
      const t = await api.createDeviceToken({ name: name.trim() });
      setFresh({ name: t.name, token: t.token }); setName(""); load();
      onToast?.("Token perangkat dibuat — salin sekarang", "ok", "key-round");
    } catch (e) { onToast?.(failureMessage("membuat token perangkat", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function revoke(t: DeviceTokenView) {
    try {
      if (!await confirm({
        title: `Cabut token perangkat "${t.name}"?`,
        message: "Perangkat itu tak bisa sync lagi sampai token baru dibuat.",
        impact: ["Perangkat berhenti menyinkronkan data ke server pusat.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Cabut token",
        icon: "key-round",
        run: () => api.revokeDeviceToken(t.id),
      })) return;
      load(); onToast?.("Token dicabut", "warn", "trash-2");
    }
    catch (e) { onToast?.(failureMessage("mencabut token", e), "err", "x-circle"); }
  }
  const active = (tokens ?? []).filter((t) => !t.revokedAt);
  return (
    <Card eyebrow="perangkat" title="Token perangkat" data-setting-card data-search="token perangkat sinkron server pusat cabut">
      <Prose>
        Token per perangkat untuk menyinkronkan hanoman di perangkat itu ke server pusat. Tempelkan di kolom
        <code className="hn-set-codeinline">SYNC_DEVICE_TOKEN</code> pada instance perangkat. Teks token hanya tampil sekali.
      </Prose>
      {fresh && (
        <div className="hn-set-token-box">
          <div className="hn-set-token-title">Token untuk “{fresh.name}” — salin sekarang, tak akan ditampilkan lagi:</div>
          <code className="hn-set-token-code">{fresh.token}</code>
          <div className="hn-set-inline">
            <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(fresh.token); onToast?.("Disalin", "ok", "copy"); }}>Salin</Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Tutup</Button>
          </div>
        </div>
      )}
      {tokens === null ? <StateBlock kind="loading" compact title="Memuat token…" />
        : active.length === 0 ? <div className="hn-set-empty">Belum ada token perangkat.</div>
        : active.map((t, i) => (
          <SettingRow key={t.id} title={t.name} last={i === active.length - 1}
            desc={"dibuat " + new Date(t.createdAt).toLocaleDateString("id-ID") + (t.lastSeenAt ? " · terlihat " + new Date(t.lastSeenAt).toLocaleString("id-ID") : " · belum dipakai")}>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => revoke(t)}>Cabut</Button>
          </SettingRow>
        ))}
      <form className="hn-set-form-block" onSubmit={(ev) => { ev.preventDefault(); void create(); }}>
        <div className="hn-grid-mobile hn-set-form2">
          <Field label="Nama perangkat"><Input value={name} placeholder="laptop-dena"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="hn-set-full" /></Field>
          <Button size="sm" type="submit" leftIcon="plus" disabled={!!blocked || busy}
            aria-describedby={blocked ? hintId : undefined} className="hn-set-btn-align">Buat token</Button>
        </div>
        <BlockedHint id={hintId} text={blocked} />
      </form>
      {dialog}
    </Card>
  );
}
