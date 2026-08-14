/* ProjectDetailScreen — satu project: identitas, edit, dan tiga pintu ke docs/runs/backlog.
   Tak ada fetch sendiri: ProjectVM dari daftar sudah memuat setiap field yang dirender
   (SPEC-146). GET /projects/:id ada, tapi memanggilnya hanya menambah state loading. */
import React from "react";
import { Card, Badge, StatusPill, ProgressBar, Button, Icon } from "../ds";
import { api } from "../api/client";
import type { ProjectVM } from "./types";
import { CustomAgentsPanel } from "./CustomAgentsPanel";
import { AutoMergeCard } from "./AutoMergeCard";

const COV_TONE = (s: string) => (s === "broken" ? "err" : s === "drift" ? "warn" : "ok");

// SPEC-253 · kartu Help Center: toggle aktif + link publik yang bisa disalin & disebar. Link terikat
// Project.id (slug), stabil. Init dari VM, update lokal saat aksi.
function HelpCenterCard({ p, onToast, onProjectChanged }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  const [enabled, setEnabled] = React.useState(p.helpEnabled);
  const [busy, setBusy] = React.useState(false);
  // Link publik same-origin — dibangun di klien (setara publicUrl server), tanpa fetch saat mount.
  const publicUrl = `${window.location.origin}/help/${encodeURIComponent(p.id)}`;

  async function enable() {
    setBusy(true);
    try {
      await api.enableHelpCenter(p.id); setEnabled(true); onToast("Help Center aktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · status persist ke state App
    }
    catch { onToast("Gagal mengaktifkan Help Center", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (!window.confirm(`Nonaktifkan Help Center project "${p.name}"? Link publik berhenti menerima keluhan baru (tiket lama tetap ada).`)) return;
    setBusy(true);
    try {
      await api.disableHelpCenter(p.id); setEnabled(false); onToast("Help Center nonaktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · status persist ke state App
    }
    catch { onToast("Gagal menonaktifkan Help Center", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  return (
    <Card eyebrow="help center" title="Link publik keluhan"
      actions={enabled
        ? <Button size="sm" variant="ghost" leftIcon="ban" onClick={disable} disabled={busy}>Nonaktifkan</Button>
        : <Button size="sm" leftIcon="inbox" onClick={enable} disabled={busy}>Aktifkan</Button>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Saat aktif, sebar link ini agar pengguna project melapor keluhan tanpa login. Keluhan masuk ke antrean Triase.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge tone={enabled ? "ok" : "neutral"} size="sm">{enabled ? "aktif" : "nonaktif"}</Badge>
        {enabled && publicUrl && (
          <>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-body)", wordBreak: "break-all" }}>{publicUrl}</code>
            <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(publicUrl); onToast("Link disalin", "ok", "copy"); }}>Salin</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="hn-eyebrow">{label}</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-body)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Door({ icon, title, hint, onClick }:
  { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <Card padding={0}>
      <button type="button" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "14px 16px", cursor: "pointer", textAlign: "left",
        border: "none", background: "transparent", color: "inherit" }}>
        <Icon name={icon} size={16} color="var(--text-muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{hint}</div>
        </div>
        <Icon name="chevron-right" size={14} color="var(--text-subtle)" />
      </button>
    </Card>
  );
}

export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onGotoChangelog, onDelete, onReverse, onScaffold, onToast, onProjectChanged }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void;
    // SPEC-519 · changelog punya halamannya sendiri (entri sidebar + deep-link); di sini ia pintu,
    // bukan panel — dua salinan generator berarti dua tempat yang bisa berbeda perilaku.
    onGotoChangelog: () => void;
    onDelete: () => void; onReverse?: () => void; onScaffold?: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void;
    // SPEC-258 · dipanggil sesudah mutasi in-card (Help Center) agar App refetch VM & status persist.
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div className="hn-stack-mobile" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="hn-wrap-mobile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="box" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600,
                color: "var(--text-strong)" }}>{p.name}</span>
              <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</Badge>
              <StatusPill status={p.session.status} size="sm">{p.session.phase ?? undefined}</StatusPill>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginTop: 6 }}>{p.desc}</div>
          </div>
          <div className="hn-row-actions" style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <Button size="sm" variant="secondary" leftIcon="pencil" onClick={onEdit}>Edit project</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onDelete}>Hapus project</Button>
          </div>
        </div>

        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 20 }}>
          <Meta label="ID" value={p.id} mono />
          {/* SPEC-217 · path EFEKTIF (binding per-mesin ?? default project). Label menandai override. */}
          <Meta label={p.binding ? "Repo · mesin ini" : "Repo"} value={(p.binding ?? p.repoDir) || "—"} mono />
          {/* SPEC-218 · remote resmi untuk clone di device lain (— bila belum diset). */}
          <Meta label="Git remote" value={p.gitRemote || "—"} mono />
          <Meta label="Stack" value={p.stack || "—"} />
          <Meta label="Backlog terbuka" value={`${p.backlog} · ${p.topStage}`} />
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Docs · SoT</div>
          <ProgressBar value={p.coverage} showLabel tone={COV_TONE(p.docStatus)} size="sm" />
        </div>
      </Card>

      <HelpCenterCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />

      {/* SPEC-486 · ADR-0103 · kebijakan auto-merge per project (override per item di Backlog). */}
      <AutoMergeCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />

      {/* SPEC-450 · ADR-0094 · permukaan PER-PROJECT katalog custom agent. Komponen yang sama
          dipakai Settings dengan projectId=null; di sini agen global tampil read-only bertanda
          "warisan global" supaya tak ada pertanyaan "lalu yang global mana". */}
      <Card eyebrow="agen" title="Custom agent — project ini">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Persona khusus project ini, ditambah agen global yang berlaku di sini. Agen project
          <b> menimpa</b> agen global bernama sama — termasuk untuk mematikannya di project ini saja.
        </div>
        <CustomAgentsPanel projectId={p.id} onToast={onToast} />
      </Card>

      {/* SPEC-519 · jumlah pintu tak lagi dihitung tangan (`repeat(4|3, 1fr)`): auto-fit menampung
          pintu baru tanpa ada yang perlu ingat memperbarui angkanya. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Door icon="book-open" title="Source of Truth" hint="baca & sunting docs" onClick={onGotoDocs} />
        <Door icon="terminal" title="Buka terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="list-checks" title="Lihat backlog" hint={`${p.backlog} spec terbuka`} onClick={onGotoBacklog} />
        <Door icon="megaphone" title="Changelog" hint="ringkasan rilis untuk pemakai" onClick={onGotoChangelog} />
        {onReverse && <Door icon="radar" title="Reverse docs" hint="susun Source of Truth dari kode" onClick={onReverse} />}
        {onScaffold && <Door icon="sparkles" title="Scaffold docs" hint="susun Source of Truth dari ide" onClick={onScaffold} />}
      </div>
    </div>
  );
}
