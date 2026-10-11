/* SPEC-883 · ADR-0137 · panel provisioning + lencana komponen. Dipisah dari VpsScreen supaya
   keduanya tetap satu tanggung jawab: VpsScreen mengurus daftar & CRUD, berkas ini mengurus
   "apa yang ada di mesin itu dan apa yang mau dipasang". */
import React from "react";
import { Button, Field, Input, Checkbox, Radio, Icon, useConfirm } from "../ds";
import { api } from "../api/client";
import { usePersistedState, oneOf } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import type {
  ComponentId, ComponentProbe, ProvisionComponent, ProvisionProfile, ProvisionStep,
  VpsComponents, VpsView,
} from "@hanoman/shared";
import { COMPONENT_STATUS_LABEL, labelOf } from "../lib/labels";

const STATUS_LABEL = COMPONENT_STATUS_LABEL;

// `partial not-logged-in` SELALU berbunyi "belum login": itu satu-satunya kalimat yang jujur
// tentang biner yang ada tapi belum siap (SPEC-487, marker ≠ bukti).
export function badgeText(id: string, entry: { status: string; detail: string }): string {
  if (entry.status === "partial" && entry.detail.startsWith("not-logged-in")) return `${id} · belum login`;
  if (entry.status === "partial") return `${id} · ${entry.detail || STATUS_LABEL.partial}`;
  const suffix = entry.status === "ok" && entry.detail ? ` ${entry.detail}` : "";
  return `${id} · ${labelOf(STATUS_LABEL, entry.status)}${suffix}`;
}

// Arti kedua profil bagi operator (sumber: `ProvisionComponent.requires` — lab memasang langsung
// di host, production memasang ke dalam image agen yang terisolasi).
const PROFILE_HINT: Record<ProvisionProfile, string> = {
  lab: "Uji coba: komponen dipasang langsung di host ini.",
  production: "Produksi: agen dipasang ke dalam image terisolasi; sebagian komponen tak tersedia di profil ini.",
};

// Satu kosakata untuk dua tampilan: chip di panel detail, dan ringkasan di baris daftar.
const STATUS_SHORT: Record<string, string> = {
  ok: "terpasang", partial: "belum siap", absent: "belum ada" };

// Warna dot status lahir dari `data-status` di CSS (`.vps-prov-dot`), sama dengan `STATUS_COLOR`.
function Chip({ status, children, title }:
  { status: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="vps-prov-chip">
      <span aria-hidden className="vps-prov-dot" data-status={status} />
      {children}
    </span>
  );
}

// Chip lengkap — dipakai di panel detail, tempat satu-per-satu memang yang dicari.
export function ComponentBadges({ components, checkedAt }:
  { components: VpsComponents | null; checkedAt: string | null }) {
  // Nol data ≠ nol komponen. Deretan strip akan terbaca sebagai "sudah dicek, semuanya kosong".
  if (!components || !checkedAt) {
    return <span className="vps-prov-hint">Komponen belum diperiksa</span>;
  }
  return (
    <div className="vps-prov-badges">
      {Object.entries(components).map(([id, entry]) => (
        <Chip key={id} status={entry.status}>{badgeText(id, entry)}</Chip>
      ))}
      <span className="vps-prov-hint">
        diperiksa {new Date(checkedAt).toLocaleString("id-ID")}
      </span>
    </div>
  );
}

const shortTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Ringkasan satu baris — dipakai di daftar VPS. Deretan penuh lencana di sana memakan sampai
// delapan baris dan membuat tinggi tiap baris berbeda-beda; yang dicari mata di daftar cuma dua
// hal: berapa yang sudah beres, dan APA yang belum. Rinciannya tetap ada di modal detail.
export function ComponentSummary({ components, checkedAt }:
  { components: VpsComponents | null; checkedAt: string | null }) {
  if (!components || !checkedAt) {
    return (
      <span className="vps-prov-hint">
        Komponen belum diperiksa — buka detail untuk memeriksa
      </span>
    );
  }
  const entries = Object.entries(components);
  const problems = entries.filter(([, e]) => e.status !== "ok");
  const okCount = entries.length - problems.length;
  return (
    <div className="vps-prov-summary">
      {/* Meter: satu segmen per komponen, warnanya status. Bentuk keseluruhan terbaca sebelum
          satu kata pun dibaca. */}
      <span aria-hidden className="vps-prov-meter">
        {entries.map(([id, e]) => (
          <span key={id} className="vps-prov-seg" data-status={e.status} />
        ))}
      </span>
      <span className="vps-prov-count">
        <strong className="vps-prov-count-ok">{okCount}/{entries.length}</strong> terpasang
      </span>
      {problems.map(([id, e]) => (
        <Chip key={id} status={e.status} title={badgeText(id, e)}>
          {id} · {e.status === "partial" && e.detail.startsWith("not-logged-in")
            ? "belum login" : STATUS_SHORT[e.status] ?? e.status}
        </Chip>
      ))}
      <span className="vps-prov-count">
        diperiksa {shortTime(checkedAt)}
      </span>
    </div>
  );
}

// Penutupan dependensi di klien HANYA untuk mengunci checkbox & memberi alasan. Server tetap
// menghitung ulang lewat resolveComponents — klien tak pernah jadi otoritas.
export function closure(ids: Set<ComponentId>, catalog: ProvisionComponent[], profile: ProvisionProfile): Set<ComponentId> {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out = new Set<ComponentId>();
  const visit = (id: ComponentId) => {
    if (out.has(id)) return;
    out.add(id);
    for (const dep of byId.get(id)?.requires[profile] ?? []) visit(dep);
  };
  for (const id of ids) visit(id);
  return out;
}

export function VpsProvisionPanel({ vps, onToast, onGotoTerminal }: {
  vps: VpsView;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: (sessionId: string) => void;
}) {
  const [catalog, setCatalog] = React.useState<ProvisionComponent[]>([]);
  const [profile, setProfile] = usePersistedState<ProvisionProfile>(
    "vps", `provisionProfile@${vps.id}`, "lab", oneOf<ProvisionProfile>("lab", "production"));
  const [picked, setPicked] = React.useState<Set<ComponentId>>(new Set());
  const [domain, setDomain] = React.useState("");
  const [steps, setSteps] = React.useState<ProvisionStep[] | null>(null);
  const [probe, setProbe] = React.useState<{ components: ComponentProbe[]; checkedAt: string } | null>(null);
  const [setup, setSetup] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const { confirm, dialog } = useConfirm();

  React.useEffect(() => {
    api.listVpsComponents().then((r) => setCatalog(r.components)).catch(() => setCatalog([]));
  }, []);

  const visible = catalog.filter((c) => c.profiles.includes(profile));
  const required = closure(picked, catalog, profile);
  const items = [...required];
  const needsDomain = items.some((id) => catalog.find((c) => c.id === id)?.needsDomain);
  const canRun = items.length > 0 && (!needsDomain || domain.trim().length > 0);
  // Tombol Pratinjau/Pasang yang mati harus bilang kenapa.
  const blockReason = items.length === 0 ? "Pilih minimal satu komponen."
    : needsDomain && !domain.trim() ? "Isi domain dulu — komponen yang dipilih membutuhkannya."
    : null;

  function toggle(id: ComponentId) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function doProbe() {
    setBusy("probe");
    try { setProbe(await api.probeVps(vps.id)); onToast("Komponen diperiksa", "ok", "server"); }
    catch (e) { onToast(failureMessage("memeriksa komponen", e), "err", "x-circle"); }
    finally { setBusy(null); }
  }

  async function doPreview() {
    setBusy("preview");
    try { setSteps((await api.provisionPreview(vps.id, { items, profile, domain: domain || undefined })).steps); }
    catch (e) { onToast(failureMessage("membuat pratinjau", e), "err", "x-circle"); }
    finally { setBusy(null); }
  }

  async function doApply() {
    if (!await confirm({
      title: `Pasang ${items.length} komponen di "${vps.name}"?`,
      message: `Profil ${profile}. Langkah dijalankan lewat SSH dan bisa memakan beberapa menit.`,
      impact: items.map((id) => catalog.find((c) => c.id === id)?.label ?? id),
      confirmLabel: "Pasang", icon: "server",
    })) return;
    setBusy("apply");
    try {
      const r = await api.provisionVps(vps.id, { items, profile, domain: domain || undefined, confirm: true });
      setSteps(r.steps);
      setProbe({ components: r.components, checkedAt: r.checkedAt });
      setSetup(r.setup);
      onToast("Provisioning selesai", "ok", "server");
    } catch (e) { onToast(failureMessage("memasang komponen", e), "err", "x-circle"); }
    finally { setBusy(null); }
  }

  const openConsole = async () => {
    try { const { id } = await api.vpsConsole(vps.id); onGotoTerminal(id); }
    catch (e) { onToast(failureMessage("membuka console", e), "err", "x-circle"); }
  };

  // Salin dengan umpan balik: tombol berubah jadi "Tersalin" sebentar; tanpa API clipboard, bilang jujur.
  const copyUrl = async (url: string) => {
    if (!navigator.clipboard) {
      onToast("Salin tak tersedia di browser ini. Pilih tautannya lalu salin manual.", "err", "x-circle");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) { onToast(failureMessage("menyalin tautan", e), "err", "x-circle"); }
  };

  const current: VpsComponents | null = probe
    ? Object.fromEntries(probe.components.map((c) => [c.id, { status: c.status, detail: c.detail }]))
    : (vps.components ?? null);
  const checkedAt = probe?.checkedAt ?? vps.componentsCheckedAt ?? null;
  const pending = current
    ? Object.entries(current).filter(([, e]) => e.status === "partial" && e.detail.startsWith("not-logged-in"))
    : [];

  return (
    <div className="vps-prov">
      <div className="vps-prov-row">
        <ComponentBadges components={current} checkedAt={checkedAt} />
        <Button size="sm" variant="ghost" onClick={doProbe} disabled={busy !== null}>Periksa</Button>
      </div>

      <fieldset className="vps-prov-fieldset">
        <legend className="vps-prov-legend">Profil</legend>
        <div className="vps-prov-profiles">
          {(["lab", "production"] as ProvisionProfile[]).map((p) => (
            <div key={p}>
              <Radio aria-label={p} label={p} checked={profile === p} onChange={() => setProfile(p)} />
              <div className="vps-prov-profile-hint">{PROFILE_HINT[p]}</div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="vps-prov-items">
        {visible.map((c) => {
          // Prasyarat yang ikut tercentang dikunci DENGAN alasan terlihat: checkbox yang mati
          // tanpa penjelasan terbaca seperti bug, bukan seperti keputusan.
          const auto = required.has(c.id) && !picked.has(c.id);
          return (
            <div key={c.id} className="vps-prov-item">
              <Checkbox aria-label={c.label} label={c.label} checked={required.has(c.id)}
                disabled={auto} onChange={() => toggle(c.id)} />
              {auto && <span className="vps-prov-tag">prasyarat</span>}
            </div>
          );
        })}
      </div>

      {needsDomain && (
        <Field label="Domain" hint="A record harus sudah menunjuk ke IP VPS ini">
          <Input aria-label="Domain" value={domain} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomain(e.currentTarget.value)}
            placeholder="hanoman.contoh.id" />
        </Field>
      )}

      <div className="vps-prov-row">
        <Button variant="ghost" onClick={doPreview} disabled={!canRun || busy !== null}>Pratinjau</Button>
        <Button onClick={doApply} disabled={!canRun || busy !== null}>Pasang</Button>
        {!canRun && blockReason && <span className="vps-prov-reason">{blockReason}</span>}
      </div>

      {/* Hasil langkah diumumkan ke pembaca layar dan bisa difokus untuk digulir lewat keyboard. */}
      <div aria-live="polite">
        {steps && (
          <pre tabIndex={0} aria-label="Hasil langkah provisioning" className="vps-prov-steps">
            {steps.map((s) => `${s.item.padEnd(14)} ${s.status.padEnd(6)} ${s.detail}`).join("\n")}
          </pre>
        )}
      </div>

      {setup && (
        <div className="vps-prov-setup">
          <strong className="vps-prov-setup-title">Buat admin pertama</strong>
          <a href={setup.url} target="_blank" rel="noreferrer" className="vps-prov-setup-link">{setup.url}</a>
          <span className="vps-prov-hint">
            berlaku sampai {new Date(setup.expiresAt).toLocaleTimeString("id-ID")}
          </span>
          <div>
            <Button size="sm" variant="ghost" onClick={() => void copyUrl(setup.url)}>{copied ? "Tersalin" : "Salin"}</Button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="vps-prov-pending">
          <Icon name="alert-triangle" />
          <span>{pending.map(([id]) => id).join(", ")} terpasang tapi belum login.</span>
          <Button size="sm" variant="ghost" onClick={openConsole}>Login lewat Console</Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
