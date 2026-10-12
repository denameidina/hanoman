import React from "react";
import { Badge, Button, Callout, Card, Checkbox, Field, Icon, Input, StateBlock, Switch, useConfirm } from "../ds";
import type { ShowToast } from "../ds";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";
import { WEBHOOK_ENTITIES, WEBHOOK_EVENTS, WEBHOOK_PING_TYPE } from "@hanoman/shared";
import type { WebhookDeliveryView, WebhookEndpointView, WebhookTestResult } from "@hanoman/shared";
import "./styles/integrations.css";

// SPEC-481 · ADR-0100 · pengelolaan endpoint webhook. Daftar jenis peristiwa dibaca dari KATALOG
// (@hanoman/shared) — sumber yang sama dengan pengirimnya, jadi pilihan di sini tak bisa basi.

type Draft = {
  id?: string; name: string; url: string; events: string[];
  enabled: boolean; allowPrivate: boolean;
};
const EMPTY: Draft = { name: "", url: "", events: ["*"], enabled: true, allowPrivate: false };

/** Keluarga peristiwa + jenisnya, diturunkan dari katalog. `webhook.ping` selalu terkirim. */
const FAMILIES = WEBHOOK_ENTITIES.map((d) => ({
  entity: d.entity,
  label: d.label,
  types: WEBHOOK_EVENTS.filter((e) => e.entity === d.entity).map((e) => e.type),
}));

const fmtTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" }) : "—";

function StatusPillFor({ e }: { e: WebhookEndpointView }) {
  if (e.enabled) return <Badge tone="ok">aktif</Badge>;
  if (e.disabledAt) return <Badge tone="err">dinonaktifkan otomatis</Badge>;
  return <Badge>nonaktif</Badge>;
}

export function WebhooksPanel({ onToast, onOpenDocs }:
  { onToast?: ShowToast; onOpenDocs?: () => void } = {}) {
  const [rows, setRows] = React.useState<WebhookEndpointView[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [secretOnce, setSecretOnce] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Record<string, WebhookTestResult>>({});
  const [historyFor, setHistoryFor] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<WebhookDeliveryView[]>([]);
  // Konfirmasi hapus lewat dialog aplikasi dengan daftar dampak (audit UI/UX 2026-10).
  const { confirm, dialog } = useConfirm();

  const load = React.useCallback(async () => {
    try { setRows((await api.listWebhooks()).endpoints); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const openHistory = async (id: string) => {
    setHistoryFor(id);
    try { setHistory((await api.listWebhookDeliveries(id)).items); }
    catch { setHistory([]); }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.id) {
        await api.updateWebhook(draft.id, {
          name: draft.name, url: draft.url, events: draft.events,
          enabled: draft.enabled, allowPrivate: draft.allowPrivate,
        });
        onToast?.("Endpoint webhook diperbarui");
      } else {
        const created = await api.createWebhook({
          name: draft.name, url: draft.url, events: draft.events,
          enabled: draft.enabled, allowPrivate: draft.allowPrivate,
        });
        setSecretOnce(created.secret ?? null);
        onToast?.("Endpoint webhook dibuat");
      }
      setDraft(null);
      await load();
    } catch (e) {
      onToast?.(failureMessage("menyimpan endpoint", e), "err");
    } finally { setBusy(false); }
  };

  const rotate = async (id: string) => {
    setBusy(true);
    try {
      const next = await api.updateWebhook(id, { rotateSecret: true });
      setSecretOnce(next.secret ?? null);
      await load();
    } catch (e) { onToast?.(`Gagal merotasi secret: ${(e as Error).message}`, "err"); }
    finally { setBusy(false); }
  };

  const toggle = async (e: WebhookEndpointView, on: boolean) => {
    try { await api.updateWebhook(e.id, { enabled: on }); await load(); }
    catch (err) { onToast?.(failureMessage("mengubah status endpoint", err), "err"); }
  };

  const test = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.testWebhook(id);
      setResult((m) => ({ ...m, [id]: r }));
      await load();
    } catch (e) {
      setResult((m) => ({ ...m, [id]: { ok: false, httpStatus: null, durationMs: 0, error: (e as Error).message } }));
    } finally { setBusy(false); }
  };

  const remove = async (target: WebhookEndpointView) => {
    try {
      const done = await confirm({
        title: `Hapus endpoint "${target.name}"?`,
        message: "Endpoint ini tak lagi menerima peristiwa dari hanoman.",
        impact: ["Riwayat pengiriman endpoint ini ikut dihapus.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Hapus endpoint",
        tone: "danger",
        icon: "trash-2",
        run: () => api.deleteWebhook(target.id),
      });
      if (done) { onToast?.("Endpoint webhook dihapus"); await load(); }
    } catch (err) { onToast?.(failureMessage("menghapus endpoint", err), "err"); }
  };

  const retry = async (deliveryId: string) => {
    try {
      await api.retryWebhookDelivery(deliveryId);
      if (historyFor) await openHistory(historyFor);
      await load();
    } catch (e) { onToast?.(`Gagal antre ulang: ${(e as Error).message}`, "err"); }
  };

  const toggleFamily = (types: string[], on: boolean) => setDraft((d) => d && ({
    ...d,
    events: on
      ? [...new Set([...d.events.filter((x) => x !== "*"), ...types])]
      : d.events.filter((x) => x !== "*" && !types.includes(x)),
  }));

  const all = draft?.events.includes("*") ?? false;

  return (
    <>
      <Card eyebrow="integrasi" title="Webhook keluar">
        <div className="hn-wh-muted hn-wh-mb12">
          hanoman mengirim <b>HTTP POST</b> bertanda tangan ke endpoint yang Anda daftarkan setiap
          kali sesuatu berubah — backlog dibuat atau berpindah stage, sesi mulai dan selesai,
          putusan lead terbit, tiket masuk, notifikasi. Pengiriman berjalan di antrean: penerima
          yang lambat atau mati <b>tidak</b> memperlambat hanoman.
        </div>
        <div className="hn-wh-actions">
          <Button size="sm" onClick={() => { setDraft({ ...EMPTY }); setSecretOnce(null); }}>
            <Icon name="plus" size={14} /> Tambah endpoint
          </Button>
          {onOpenDocs && (
            <Button size="sm" variant="ghost" onClick={onOpenDocs}>
              <Icon name="book-open" size={14} /> Dokumentasi webhook
            </Button>
          )}
        </div>

        {failed ? <StateBlock kind="error" compact title="Gagal memuat endpoint webhook"
          hint="Coba muat ulang." action={() => void load()} actionLabel="Coba lagi" />
          : rows === null ? <div className="hn-wh-muted">Memuat…</div>
            : rows.length === 0 ? (
              <StateBlock kind="empty" compact title="Belum ada endpoint webhook"
                hint="Daftarkan URL penerima pertama untuk mulai berlangganan peristiwa hanoman." />
            ) : (
              <div className="hn-wh-col-10">
                {rows.map((e) => (
                  <div key={e.id} data-testid={`webhook-${e.id}`} className="hn-wh-endpoint">
                    <div className="hn-wh-endpoint-head">
                      <div className="hn-wh-name">{e.name}</div>
                      <StatusPillFor e={e} />
                      {e.pending > 0 ? <Badge>{e.pending} mengantre</Badge> : null}
                      <div className="hn-wh-endpoint-actions">
                        <Switch checked={e.enabled} aria-label={`Aktifkan ${e.name}`}
                          onChange={(on: boolean) => void toggle(e, on)} />
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void test(e.id)}>Test</Button>
                        <Button size="sm" variant="ghost" onClick={() => void openHistory(e.id)}>Riwayat</Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          setSecretOnce(null);
                          setDraft({
                            id: e.id, name: e.name, url: e.url, events: e.events,
                            enabled: e.enabled, allowPrivate: e.allowPrivate,
                          });
                        }}>Ubah</Button>
                        <Button size="sm" variant="ghost" onClick={() => void remove(e)}>Hapus</Button>
                      </div>
                    </div>
                    <div className="hn-wh-url">{e.url}</div>
                    <div className="hn-wh-muted hn-wh-mt6">
                      Peristiwa: <code>{e.events.join(", ")}</code> · secret …{e.secretHint} ·
                      {" "}sukses terakhir {fmtTime(e.lastSuccessAt)}
                      {e.failureStreak > 0 ? ` · ${e.failureStreak} gagal beruntun` : ""}
                    </div>
                    {e.disabledReason ? (
                      <div className="hn-wh-muted hn-wh-mt6 hn-wh-err">
                        {e.disabledReason}
                      </div>
                    ) : null}
                    {result[e.id] ? (
                      <div className="hn-wh-muted hn-wh-mt6">
                        {result[e.id]!.ok
                          ? `Test berhasil — HTTP ${result[e.id]!.httpStatus} · ${result[e.id]!.durationMs} ms`
                          : `Test gagal — ${result[e.id]!.error}`}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
      </Card>

      {secretOnce ? (
        <Card eyebrow="secret" title="Salin sekarang — secret tak ditampilkan lagi">
          <Callout tone="brass">
            <div className="hn-wh-secret">{secretOnce}</div>
          </Callout>
          <div className="hn-wh-row hn-wh-mt10">
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(secretOnce)}>Salin secret</Button>
            <Button size="sm" variant="ghost" onClick={() => setSecretOnce(null)}>Tutup</Button>
          </div>
        </Card>
      ) : null}

      {draft ? (
        <Card eyebrow={draft.id ? "ubah" : "tambah"} title={draft.id ? "Ubah endpoint" : "Endpoint baru"}>
          <div className="hn-wh-col-12">
            <Field label="Nama">
              <Input value={draft.name} placeholder="mis. Dashboard internal"
                onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, name: ev.target.value })} />
            </Field>
            <Field label="URL tujuan">
              <Input value={draft.url} placeholder="https://contoh.id/hanoman-webhook"
                onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, url: ev.target.value })} />
            </Field>

            <div>
              <div className="hn-wh-label">Peristiwa yang dikirim</div>
              <Checkbox checked={all} label="Semua peristiwa"
                onChange={(on: boolean) => setDraft({ ...draft, events: on ? ["*"] : [] })} />
              {!all ? (
                <div className="hn-wh-tree">
                  {FAMILIES.map((f) => (
                    <div key={f.entity}>
                      <Checkbox
                        checked={f.types.every((t) => draft.events.includes(t))}
                        label={f.label}
                        onChange={(on: boolean) => toggleFamily(f.types, on)} />
                      <div className="hn-wh-family-types">
                        {f.types.map((t) => (
                          <Checkbox key={t} checked={draft.events.includes(t)} label={t}
                            onChange={(on: boolean) => setDraft({
                              ...draft,
                              events: on
                                ? [...new Set([...draft.events.filter((x) => x !== "*"), t])]
                                : draft.events.filter((x) => x !== t && x !== "*"),
                            })} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="hn-wh-muted">
                    <code>{WEBHOOK_PING_TYPE}</code> selalu terkirim saat tombol Test ditekan,
                    apa pun langganannya.
                  </div>
                </div>
              ) : null}
            </div>

            <Checkbox checked={draft.allowPrivate}
              label="Izinkan alamat internal / loopback"
              onChange={(on: boolean) => setDraft({ ...draft, allowPrivate: on })} />
            <div className="hn-wh-muted">
              Biarkan mati kecuali penerima memang berjalan di mesin/jaringan yang sama. Menyalakannya
              membuka jalan ke layanan internal yang tak pernah dimaksudkan terekspos.
            </div>

            <Checkbox checked={draft.enabled} label="Aktif"
              onChange={(on: boolean) => setDraft({ ...draft, enabled: on })} />

            <div className="hn-wh-row">
              <Button size="sm" disabled={busy || !draft.name || !draft.url || draft.events.length === 0}
                onClick={() => void save()}>Simpan</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Batal</Button>
              {draft.id ? (
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => void rotate(draft.id!)}>Rotasi secret</Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {historyFor ? (
        <Card eyebrow="riwayat" title="Riwayat pengiriman">
          <div className="hn-wh-history-head">
            <Button size="sm" variant="ghost" onClick={() => setHistoryFor(null)}>Tutup riwayat</Button>
          </div>
          {history.length === 0 ? <div className="hn-wh-muted">Belum ada pengiriman.</div> : (
            <div className="hn-local-overflow">
              <table className="hn-wh-table hn-wh-table--full">
                <thead>
                  <tr className="hn-wh-thead">
                    <th className="hn-wh-cell">Waktu</th>
                    <th className="hn-wh-cell">Jenis</th>
                    <th className="hn-wh-cell">Status</th>
                    <th className="hn-wh-cell">HTTP</th>
                    <th className="hn-wh-cell">Percobaan</th>
                    <th className="hn-wh-cell">Galat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((d) => (
                    <tr key={d.id} className="hn-wh-tr">
                      <td className="hn-wh-cell hn-wh-cell--nowrap">{fmtTime(d.createdAt)}</td>
                      <td className="hn-wh-cell hn-wh-cell--mono12">{d.eventType}</td>
                      <td className="hn-wh-cell">{d.status}</td>
                      <td className="hn-wh-cell">{d.httpStatus ?? "—"}</td>
                      <td className="hn-wh-cell">{`${d.attempt} / ${d.maxAttempts}`}</td>
                      <td className="hn-wh-cell hn-wh-cell--muted">{d.error ?? "—"}</td>
                      <td className="hn-wh-cell">
                        {d.status === "failed" || d.status === "dropped" ? (
                          <Button size="sm" variant="ghost" onClick={() => void retry(d.id)}>Antre ulang</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {dialog}
    </>
  );
}
