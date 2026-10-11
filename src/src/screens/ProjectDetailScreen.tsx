/* ProjectDetailScreen — satu project: identitas, pintu kerja, pengaturan, dan zona bahaya.
   Tak ada fetch sendiri: ProjectVM dari daftar sudah memuat setiap field yang dirender
   (SPEC-146). GET /projects/:id ada, tapi memanggilnya hanya menambah state loading.

   Susunan (audit 2026-10): pintu kerja (Dokumen, Terminal, Backlog) di atas; konfigurasi
   (Help Center, auto-merge, agen) dikelompokkan di "Pengaturan project"; hapus project di zona
   bahaya paling bawah. */
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
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Saat aktif, sebar link ini agar pengguna project melapor keluhan tanpa login. Keluhan masuk ke antrean Triase.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge tone={enabled ? "ok" : "neutral"} size="sm">{enabled ? "aktif" : "nonaktif"}</Badge>
        {enabled && publicUrl && (
          <>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-body)", wordBreak: "break-all" }}>{publicUrl}</code>
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
function CopyableMeta({ label, value, onToast }:
  { label: string; value: string; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const empty = !value || value === "—";
  return (
    <div style={{ minWidth: 0 }}>
      <div className="hn-eyebrow">{label}</div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "flex-start", gap: 6 }}>
        <span title={empty ? undefined : value} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text-body)",
          fontFamily: "var(--font-mono)", overflowWrap: "anywhere", wordBreak: "break-all" }}>{value}</span>
        {!empty && (
          <button type="button" aria-label={`Salin ${label}`}
            onClick={() => {
              const copy = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error("clipboard tidak tersedia"));
              copy.then(() => onToast(`${label} disalin`, "ok", "copy"),
                (e: unknown) => onToast(failureMessage(`menyalin ${label.toLowerCase()}`, e), "err", "x-circle"));
            }}
            style={{ flex: "0 0 auto", border: "none", background: "transparent", cursor: "pointer",
              padding: 2, color: "var(--text-muted)", lineHeight: 0 }}>
            <Icon name="copy" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="hn-eyebrow">{label}</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-body)",
        fontFamily: "var(--font-ui)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
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
          <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 2 }}>{hint}</div>
        </div>
        <Icon name="chevron-right" size={14} color="var(--text-subtle)" />
      </button>
    </Card>
  );
}

export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onGotoSkills, onDelete, onReverse, onScaffold, onToast, onProjectChanged }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void;
    onGotoSkills?: () => void;
    onDelete: () => void; onReverse?: () => void; onScaffold?: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void;
    // SPEC-258 · dipanggil sesudah mutasi in-card (Help Center) agar App refetch VM & status persist.
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div className="hn-stack-mobile" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="hn-wrap-mobile" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Icon name="box" size={15} color="var(--text-muted)" />
              {/* h2, bukan h1: shell (ds/shell.tsx) sudah memakai h1 untuk judul layar. */}
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600,
                lineHeight: 1.25, color: "var(--text-strong)", overflowWrap: "anywhere" }}>{p.name}</h2>
              <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{kindLabel(p.kind)}</Badge>
              <StatusPill status={p.session.status} size="sm">{p.session.phase ?? undefined}</StatusPill>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginTop: 6 }}>{p.desc}</div>
          </div>
          <div className="hn-row-actions" style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <Button size="sm" variant="secondary" leftIcon="pencil" onClick={onEdit}>Edit project</Button>
          </div>
        </div>

        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 20 }}>
          <Meta label="ID" value={p.id} />
          {/* SPEC-217 · path EFEKTIF (binding per-mesin ?? default project). Label menandai override. */}
          <CopyableMeta label={p.binding ? "Repo · mesin ini" : "Repo"} value={(p.binding ?? p.repoDir) || "—"} onToast={onToast} />
          {/* SPEC-218 · remote resmi untuk clone di device lain (— bila belum diset). */}
          <CopyableMeta label="Git remote" value={p.gitRemote || "—"} onToast={onToast} />
          {/* SPEC-880 · ADR-0135 · penanda "ditangani oleh" = pernyataan yang DISYNC ke setiap
              mesin; `Repo · mesin ini` di sebelahnya adalah fakta mesin ini saja. Pembedaan itu
              dinyatakan di labelnya, bukan disiratkan. */}
          <div>
            <div className="hn-eyebrow">Ditangani oleh · disync</div>
            <div style={{ marginTop: 4 }}><HandledByChips list={p.handledBy} /></div>
          </div>
          <Meta label="Stack" value={p.stack || "—"} />
          <Meta label="Backlog terbuka" value={`${p.backlog} · ${p.topStage}`} />
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Dokumen</div>
          <ProgressBar value={p.coverage} showLabel tone={COV_TONE(p.docStatus)} size="sm" />
        </div>
      </Card>

      {/* SPEC-867 · project tanpa checkout di mesin ini: keadaan + dua jalan keluarnya. Merender
          null saat repo-nya ada, jadi urutan kartu di bawah tak berubah. */}
      <MissingRepoCard p={p} onEdit={onEdit} onToast={onToast} onProjectChanged={onProjectChanged} />

      {/* Pintu kerja — di atas, karena inilah yang paling sering dituju dari halaman project. */}
      <section aria-label="Pintu kerja" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Door icon="book-open" title="Dokumen" hint="baca & sunting dokumen project" onClick={onGotoDocs} />
        <Door icon="terminal" title="Buka terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="list-checks" title="Backlog" hint={`${p.backlog} item terbuka`} onClick={onGotoBacklog} />
        {onGotoSkills && <Door icon="sparkles" title="Skills" hint="skill project & global warisan" onClick={onGotoSkills} />}
        {onReverse && <Door icon="radar" title="Reverse docs" hint="susun Dokumen dari kode" onClick={onReverse} />}
        {onScaffold && <Door icon="sparkles" title="Scaffold docs" hint="susun Dokumen dari ide" onClick={onScaffold} />}
      </section>

      {/* Konfigurasi project, dikelompokkan. Setiap kartu tetap mandiri (punya aksi dan galatnya). */}
      <section aria-labelledby="pengaturan-project" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h2 id="pengaturan-project" className="hn-eyebrow" style={{ margin: 0 }}>Pengaturan project</h2>

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
      </section>

      {/* Zona bahaya: paling bawah, dengan batas merah sendiri. Konfirmasinya dimiliki App
          (deleteProject), yang menyebut dampak lengkapnya sebelum menghapus. */}
      <section aria-labelledby="zona-bahaya" style={{ border: "1px solid var(--status-err)", borderRadius: "var(--radius-lg)",
        padding: 16, background: "var(--status-err-tint)", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <h2 id="zona-bahaya" className="hn-eyebrow" style={{ margin: 0, color: "var(--clay-600)" }}>Zona bahaya</h2>
          <div style={{ fontSize: 12.5, color: "var(--text-body)", marginTop: 4, lineHeight: 1.5 }}>
            Menghapus project berarti menghapus seluruh backlog-nya dari dashboard ini. Tak bisa dibatalkan.
          </div>
        </div>
        <Button variant="danger" size="sm" leftIcon="trash-2" onClick={onDelete}>Hapus project</Button>
      </section>
    </div>
  );
}
