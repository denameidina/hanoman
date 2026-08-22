/* SPEC-883 · ADR-0137 · panel provisioning + lencana komponen. Dipisah dari VpsScreen supaya
   keduanya tetap satu tanggung jawab: VpsScreen mengurus daftar & CRUD, berkas ini mengurus
   "apa yang ada di mesin itu dan apa yang mau dipasang". */
import React from "react";
import { Button, Field, Input, Checkbox, Radio, Icon, useConfirm } from "../ds";
import { api } from "../api/client";
import { usePersistedState, oneOf } from "../ui-state";
import type {
  ComponentId, ComponentProbe, ProvisionComponent, ProvisionProfile, ProvisionStep,
  VpsComponents, VpsView,
} from "@hanoman/shared";

const STATUS_LABEL: Record<string, string> = {
  ok: "terpasang", partial: "belum siap", absent: "belum ada" };
const STATUS_COLOR: Record<string, string> = {
  ok: "var(--leaf-600)", partial: "var(--amber-600)", absent: "var(--text-subtle)" };

// `partial not-logged-in` SELALU berbunyi "belum login": itu satu-satunya kalimat yang jujur
// tentang biner yang ada tapi belum siap (SPEC-487, marker ≠ bukti).
export function badgeText(id: string, entry: { status: string; detail: string }): string {
  if (entry.status === "partial" && entry.detail.startsWith("not-logged-in")) return `${id} · belum login`;
  if (entry.status === "partial") return `${id} · ${entry.detail || STATUS_LABEL.partial}`;
  const suffix = entry.status === "ok" && entry.detail ? ` ${entry.detail}` : "";
  return `${id} · ${STATUS_LABEL[entry.status] ?? entry.status}${suffix}`;
}

export function ComponentBadges({ components, checkedAt }:
  { components: VpsComponents | null; checkedAt: string | null }) {
  // Nol data ≠ nol komponen. Deretan strip akan terbaca sebagai "sudah dicek, semuanya kosong".
  if (!components || !checkedAt) {
    return <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Komponen belum diperiksa</span>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {Object.entries(components).map(([id, entry]) => (
        <span key={id} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
          color: STATUS_COLOR[entry.status], border: `1px solid ${STATUS_COLOR[entry.status]}`,
          borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}>{badgeText(id, entry)}</span>
      ))}
      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
        diperiksa {new Date(checkedAt).toLocaleString("id-ID")}
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
  const { confirm, dialog } = useConfirm();

  React.useEffect(() => {
    api.listVpsComponents().then((r) => setCatalog(r.components)).catch(() => setCatalog([]));
  }, []);

  const visible = catalog.filter((c) => c.profiles.includes(profile));
  const required = closure(picked, catalog, profile);
  const items = [...required];
  const needsDomain = items.some((id) => catalog.find((c) => c.id === id)?.needsDomain);
  const canRun = items.length > 0 && (!needsDomain || domain.trim().length > 0);

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
    catch { onToast("Probe gagal", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  async function doPreview() {
    setBusy("preview");
    try { setSteps((await api.provisionPreview(vps.id, { items, profile, domain: domain || undefined })).steps); }
    catch { onToast("Pratinjau gagal", "err", "x-circle"); }
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
    } catch { onToast("Provisioning gagal", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  const openConsole = async () => {
    try { const { id } = await api.vpsConsole(vps.id); onGotoTerminal(id); }
    catch { onToast("Gagal membuka console", "err", "x-circle"); }
  };

  const current: VpsComponents | null = probe
    ? Object.fromEntries(probe.components.map((c) => [c.id, { status: c.status, detail: c.detail }]))
    : (vps.components ?? null);
  const checkedAt = probe?.checkedAt ?? vps.componentsCheckedAt ?? null;
  const pending = current
    ? Object.entries(current).filter(([, e]) => e.status === "partial" && e.detail.startsWith("not-logged-in"))
    : [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <ComponentBadges components={current} checkedAt={checkedAt} />
        <Button size="sm" variant="ghost" onClick={doProbe} disabled={busy !== null}>Periksa</Button>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        {(["lab", "production"] as ProvisionProfile[]).map((p) => (
          <Radio key={p} aria-label={p} label={p} checked={profile === p} onChange={() => setProfile(p)} />
        ))}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {visible.map((c) => {
          // Prasyarat yang ikut tercentang dikunci DENGAN alasan terlihat: checkbox yang mati
          // tanpa penjelasan terbaca seperti bug, bukan seperti keputusan.
          const auto = required.has(c.id) && !picked.has(c.id);
          return (
            <div key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Checkbox aria-label={c.label} label={c.label} checked={required.has(c.id)}
                disabled={auto} onChange={() => toggle(c.id)} />
              {auto && <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>prasyarat</span>}
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

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="ghost" onClick={doPreview} disabled={!canRun || busy !== null}>Pratinjau</Button>
        <Button onClick={doApply} disabled={!canRun || busy !== null}>Pasang</Button>
      </div>

      {steps && (
        <pre style={{ fontSize: 11, fontFamily: "var(--font-mono)", maxHeight: 220, overflow: "auto",
          background: "var(--surface-sunken)", padding: 8, borderRadius: 4 }}>
          {steps.map((s) => `${s.item.padEnd(14)} ${s.status.padEnd(6)} ${s.detail}`).join("\n")}
        </pre>
      )}

      {setup && (
        <div style={{ display: "grid", gap: 4, border: "1px solid var(--border-strong)", borderRadius: 4, padding: 8 }}>
          <strong style={{ fontSize: 12 }}>Buat admin pertama</strong>
          <a href={setup.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: "break-all" }}>{setup.url}</a>
          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
            berlaku sampai {new Date(setup.expiresAt).toLocaleTimeString("id-ID")}
          </span>
          <div>
            <Button size="sm" variant="ghost"
              onClick={() => void navigator.clipboard?.writeText(setup.url)}>Salin</Button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <Icon name="alert-triangle" />
          <span>{pending.map(([id]) => id).join(", ")} terpasang tapi belum login.</span>
          <Button size="sm" variant="ghost" onClick={openConsole}>Login lewat Console</Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
