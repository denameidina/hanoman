/* ProjectDetailScreen — satu project: identitas, tiga pintu kerja, pengaturan (lipat), dan zona bahaya.
   Tak ada fetch sendiri: ProjectVM dari daftar sudah memuat setiap field yang dirender (SPEC-146).

   Redesign 3P (Projects · detail): header memuat tiga pintu kerja besar — Backlog (dengan jumlah
   item terbuka), Terminal, dan Dokumen. Banner "belum ada checkout" (MissingRepoCard) tetap di atas
   pintu-pintu itu. Konfigurasi (Help Center, auto-merge, custom agent, tautan Skills) dilipat di
   "Pengaturan project". "Zona bahaya" paling bawah. Angka backlog hanya ditampilkan sekali (di pintu). */
import React from "react";
import { Card, Badge, StatusPill, ProgressBar, Button, Icon, useConfirm } from "../ds";
import { api } from "../api/client";
import type { ProjectVM } from "./types";
import { CustomAgentsPanel } from "./CustomAgentsPanel";
import { AutoMergeCard } from "./AutoMergeCard";
import { MissingRepoCard } from "./MissingRepoCard";
import { HandledByChips } from "./HandledByChips";
import { kindLabel } from "./ProjectsScreen";
import { failureMessage } from "../lib/report-error";
import "./styles/projects.css";

const COV_TONE = (s: string) => (s === "broken" ? "err" : s === "drift" ? "warn" : "ok");

type Toast = (msg: string, kind?: string, icon?: string) => void;

// SPEC-253 · kartu Help Center: toggle aktif + link publik yang bisa disalin & disebar. Link terikat
// Project.id (slug), stabil. Init dari VM, update lokal saat aksi.
function HelpCenterCard({ p, onToast, onProjectChanged }:
  { p: ProjectVM; onToast: Toast; onProjectChanged?: (id: string) => void | Promise<void> }) {
  const [enabled, setEnabled] = React.useState(p.helpEnabled);
  const [busy, setBusy] = React.useState(false);
  // Link publik same-origin — dibangun di klien (setara publicUrl server), tanpa fetch saat mount.
  const publicUrl = `${window.location.origin}/help/${encodeURIComponent(p.id)}`;
  // SPEC-847 · ADR-0127 · konfirmasi nonaktifkan Help Center memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();

  async function enable() {
    setBusy(true);
    try {
      await api.enableHelpCenter(p.id); setEnabled(true); onToast("Help Center aktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · status persist ke state App
    }
    catch (e) { onToast(failureMessage("mengaktifkan Help Center", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (!await confirm({
      title: `Nonaktifkan Help Center project "${p.name}"?`,
      message: "Link publik berhenti menerima keluhan baru.",
      impact: ["Tiket lama tetap ada dan tetap bisa ditriase.", "Bisa diaktifkan lagi kapan saja."],
      confirmLabel: "Nonaktifkan",
      icon: "ban",
      tone: "default",
    })) return;
    setBusy(true);
    try {
      await api.disableHelpCenter(p.id); setEnabled(false); onToast("Help Center nonaktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · status persist ke state App
    }
    catch (e) { onToast(failureMessage("menonaktifkan Help Center", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }

  return (
    <Card eyebrow="help center" title="Link publik keluhan"
      actions={enabled
        ? <Button size="sm" variant="ghost" leftIcon="ban" onClick={disable} disabled={busy}>Nonaktifkan</Button>
        : <Button size="sm" leftIcon="inbox" onClick={enable} disabled={busy}>Aktifkan</Button>}>
      <p className="hn-prj-note">
        Saat aktif, sebar link ini agar pengguna project melapor keluhan tanpa login. Keluhan masuk ke antrean Triase.
      </p>
      <div className="hn-prj-inline">
        <Badge tone={enabled ? "ok" : "neutral"} size="sm">{enabled ? "aktif" : "nonaktif"}</Badge>
        {enabled && publicUrl && (
          <>
            <code className="hn-prj-code">{publicUrl}</code>
            <Button size="sm" leftIcon="copy" onClick={() => {
              const copy = navigator.clipboard?.writeText(publicUrl) ?? Promise.reject(new Error("clipboard tidak tersedia"));
              copy.then(() => onToast("Link disalin", "ok", "copy"),
                (e: unknown) => onToast(failureMessage("menyalin link", e), "err", "x-circle"));
            }}>Salin</Button>
          </>
        )}
      </div>
      {dialog}
    </Card>
  );
}

/* Nilai repo/remote bisa sangat panjang: dibungkus (bukan dipotong ellipsis), diberi `title`
   supaya versi utuhnya tetap terbaca, dan punya tombol salin sendiri. */
function CopyableMeta({ label, value, onToast }: { label: string; value: string; onToast: Toast }) {
  const empty = !value || value === "—";
  return (
    <div className="hn-prj-meta-item">
      <dt className="hn-eyebrow">{label}</dt>
      <dd className="hn-prj-meta-value">
        <span title={empty ? undefined : value} className="hn-prj-meta-wrap">{value}</span>
        {!empty && (
          <button type="button" aria-label={`Salin ${label}`} className="hn-prj-copy"
            onClick={() => {
              const copy = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error("clipboard tidak tersedia"));
              copy.then(() => onToast(`${label} disalin`, "ok", "copy"),
                (e: unknown) => onToast(failureMessage(`menyalin ${label.toLowerCase()}`, e), "err", "x-circle"));
            }}>
            <Icon name="copy" size={13} />
          </button>
        )}
      </dd>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="hn-prj-meta-item">
      <dt className="hn-eyebrow">{label}</dt>
      <dd className="hn-prj-meta-value hn-prj-meta-clip">{value}</dd>
    </div>
  );
}

/** Pintu kerja besar: satu aksi per pintu, dengan angka (bila ada) di judulnya. */
function Door({ icon, title, count, hint, onClick }:
  { icon: string; title: string; count?: number; hint: string; onClick: () => void }) {
  return (
    <button type="button" className="hn-prj-door" onClick={onClick}>
      <span className="hn-prj-door-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="hn-prj-door-text">
        <span className="hn-prj-door-title">
          {title}
          {count !== undefined && <span className="hn-prj-door-count">{count}</span>}
        </span>
        <span className="hn-prj-door-hint">{hint}</span>
      </span>
      <Icon name="chevron-right" size={16} color="var(--text-subtle)" />
    </button>
  );
}

export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onGotoSkills, onDelete, onReverse, onScaffold, onToast, onProjectChanged }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void;
    onGotoSkills?: () => void;
    onDelete: () => void; onReverse?: () => void; onScaffold?: () => void;
    onToast: Toast;
    // SPEC-258 · dipanggil sesudah mutasi in-card (Help Center) agar App refetch VM & status persist.
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  return (
    <div className="hn-prj-detail">
      <Card>
        <div className="hn-prj-head">
          <div className="hn-prj-head-text">
            <div className="hn-prj-head-title">
              <Icon name="box" size={15} color="var(--text-muted)" />
              {/* h2, bukan h1: shell (ds/shell.tsx) sudah memakai h1 untuk judul layar. */}
              <h2 className="hn-prj-title">{p.name}</h2>
              <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{kindLabel(p.kind)}</Badge>
              <StatusPill status={p.session.status} size="sm">{p.session.phase ?? undefined}</StatusPill>
            </div>
            {p.desc && <p className="hn-prj-subtitle">{p.desc}</p>}
          </div>
          <Button size="sm" variant="secondary" leftIcon="pencil" onClick={onEdit}>Edit project</Button>
        </div>

        <dl className="hn-prj-meta">
          <Meta label="ID" value={p.id} />
          {/* SPEC-217 · path EFEKTIF (binding per-mesin ?? default project). Label menandai override. */}
          <CopyableMeta label={p.binding ? "Repo · mesin ini" : "Repo"} value={(p.binding ?? p.repoDir) || "—"} onToast={onToast} />
          {/* SPEC-218 · remote resmi untuk clone di device lain (— bila belum diset). */}
          <CopyableMeta label="Git remote" value={p.gitRemote || "—"} onToast={onToast} />
          {/* SPEC-880 · ADR-0135 · "ditangani oleh" = pernyataan yang DISYNC ke setiap mesin. */}
          <div className="hn-prj-meta-item">
            <dt className="hn-eyebrow">Ditangani oleh · disync</dt>
            <dd className="hn-prj-meta-value"><HandledByChips list={p.handledBy} /></dd>
          </div>
          <Meta label="Stack" value={p.stack || "—"} />
          <Meta label="Aktivitas" value={p.activity || "—"} />
        </dl>

        <div className="hn-prj-coverage">
          <span className="hn-eyebrow">Dokumen</span>
          <ProgressBar value={p.coverage} showLabel tone={COV_TONE(p.docStatus)} size="sm"
            aria-label={`Cakupan dokumen ${p.name}`} />
        </div>
      </Card>

      {/* SPEC-867 · project tanpa checkout di mesin ini: keadaan + dua jalan keluarnya. Merender
          null saat repo-nya ada, jadi tata letak di bawah tak berubah. */}
      <MissingRepoCard p={p} onEdit={onEdit} onToast={onToast} onProjectChanged={onProjectChanged} />

      {/* Tiga pintu kerja: Backlog (dengan jumlah terbuka), Terminal, dan Dokumen. */}
      <section aria-label="Pintu kerja" className="hn-prj-doors">
        <Door icon="list-checks" title="Backlog" count={p.backlog} hint="item terbuka" onClick={onGotoBacklog} />
        <Door icon="terminal" title="Terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="book-open" title="Dokumen" hint="baca & sunting dokumen project" onClick={onGotoDocs} />
      </section>
      {(onReverse || onScaffold) && (
        <div className="hn-prj-doc-actions" role="group" aria-label="Susun dokumen">
          {onReverse && <Button size="sm" variant="secondary" leftIcon="radar" onClick={onReverse}>Reverse docs</Button>}
          {onScaffold && <Button size="sm" variant="secondary" leftIcon="sparkles" onClick={onScaffold}>Scaffold docs</Button>}
          <span className="hn-prj-note">Susun Dokumen dari kode (reverse) atau dari ide (scaffold).</span>
        </div>
      )}

      {/* Konfigurasi project: lipat. Tiap kartu di dalamnya tetap mandiri (punya aksi dan galatnya). */}
      <details className="hn-prj-disclosure" aria-label="Pengaturan project">
        <summary className="hn-prj-disclosure-summary">Pengaturan project</summary>
        <div className="hn-prj-disclosure-body">
          <HelpCenterCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />

          {/* SPEC-486 · ADR-0103 · kebijakan auto-merge per project (override per item di Backlog). */}
          <AutoMergeCard p={p} onToast={onToast} onProjectChanged={onProjectChanged} />

          {/* SPEC-450 · ADR-0094 · katalog custom agent per project. Agen global tampil read-only
              bertanda "warisan global" supaya tak ada pertanyaan "lalu yang global mana". */}
          <Card eyebrow="agen" title="Custom agent — project ini">
            <p className="hn-prj-note">
              Persona khusus project ini, ditambah agen global yang berlaku di sini. Agen project
              <b> menimpa</b> agen global bernama sama — termasuk untuk mematikannya di project ini saja.
            </p>
            <CustomAgentsPanel projectId={p.id} onToast={onToast} />
          </Card>

          {onGotoSkills && (
            <div className="hn-prj-inline">
              <span className="hn-prj-note">Skill project ini dan skill global yang diwarisinya.</span>
              <Button size="sm" variant="ghost" leftIcon="sparkles" onClick={onGotoSkills}>Buka Skills</Button>
            </div>
          )}
        </div>
      </details>

      {/* Zona bahaya: paling bawah. Konfirmasinya dimiliki App (deleteProject), yang menyebut dampaknya. */}
      <section aria-labelledby="zona-bahaya" className="hn-prj-danger">
        <div className="hn-prj-danger-text">
          <h2 id="zona-bahaya" className="hn-eyebrow hn-prj-danger-title">Zona bahaya</h2>
          <p className="hn-prj-note">
            Menghapus project berarti menghapus seluruh backlog-nya dari dashboard ini. Tak bisa dibatalkan.
          </p>
        </div>
        <Button variant="danger" size="sm" leftIcon="trash-2" onClick={onDelete}>Hapus project</Button>
      </section>
    </div>
  );
}
