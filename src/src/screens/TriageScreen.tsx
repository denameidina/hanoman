/* TriageScreen — kotak masuk keputusan triase (SPEC-253, SPEC-471, SPEC-908; Audit UI/UX 2026-10 · Fase 3F).
   Satu daftar gabungan tiket Help Center + issue GitHub (bukan dua tab). Status dipilih lewat segmented
   "Belum ditinjau (N) · Diterima · Ditutup". Baris = titik status + judul + meta satu baris (+ checkbox
   saat belum ditinjau) dan aksi Terima/Tolak inline. Detail: decision bar menempel di bawah; aksi lain di ⋯.
   - Tolak tiket: langsung, dengan toast "Urungkan" 6 dtk yang mengembalikan status lewat PATCH tiket.
   - Tolak issue GitHub: tetap lewat konfirmasi; tak ada jalur balik status untuk issue (unlink melepas
     tautan, bukan membuka kembali), jadi tak ada "Urungkan".
   - Aksi massal selalu lewat konfirmasi yang memuat daftar nama item.
   - Keyboard (fokus di daftar/detail, bukan input): J/K pindah, A terima, R tolak, Esc tutup detail.
   SPEC-908 · realtime tiket lewat langganan berparameter `tickets` di `/events/ws`; HTTP tinggal muat awal
   dan fallback. Issue GitHub tak punya topik realtime: dimuat ulang lewat HTTP. */
import React from "react";
import "./styles/triage.css";
import { relativeTime } from "../lib/time-format";
import { TICKET_STATUS_LABEL } from "../lib/labels";
import {
  Button, Badge, Select, StateBlock, Input, Field, HnTextarea, ConfirmDialog, useConfirm, Pager, ResponsivePanels,
  serverPage, LiveConnectionBadge, OverflowActions, useResponsiveTier, FilterBar, Callout, SkeletonList, StatusPill,
  useToast, ToastHost, Stack, RowList, DenseRow,
} from "../ds";
import type { OverflowItem, FilterChip } from "../ds";
import { paths, publicStatus, type TicketView, type TicketDetail, type Spec, type GithubIssueView } from "@hanoman/shared";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import { failureMessage } from "../lib/report-error";
import { specDeepLink } from "./deeplink";
import { SyncButton } from "./SyncButton";
import {
  usePersistedState, useScrollRestore, useResetOnChange, ResetViewButton, oneOf, isStr, isNum, nullableStr,
} from "../ui-state";
import type { ProjectVM } from "./types";

const POLL_MS = 5000;
// SPEC-523 · ukuran halaman daftar triase (tiket & issue).
const TICKET_PAGE = 20;
// SPEC-908 · jeda sebelum ketikan pencarian mengubah HTTP maupun KUNCI langganan (lihat useLiveTopic).
const Q_DEBOUNCE_MS = 400;
// Toast "Urungkan" bertahan selama ini (Audit 3F: 6 dtk).
const UNDO_MS = 6000;

type TStatus = "new" | "accepted" | "rejected";
type Source = "semua" | "tiket" | "issue";
const SEGMENTS: { key: TStatus; label: string }[] = [
  { key: "new", label: "Belum ditinjau" },
  { key: "accepted", label: "Diterima" },
  { key: "rejected", label: "Ditutup" },
];
// Titik status memakai tone DS yang sudah ada; teksnya selalu ikut (titik tak pernah membawa makna sendiri).
const STATUS_DOT: Record<TStatus, string> = { new: "drift", accepted: "ok", rejected: "idle" };
const STATUS_LABEL = TICKET_STATUS_LABEL;
const SOURCE_LABEL: Record<Source, string> = { semua: "Semua sumber", tiket: "Help Center", issue: "GitHub" };

// Alasan galat yang layak dibaca: pesan server (`detail.error`), selain itu status HTTP. Pesan bawaan
// klien memuat URL mentah ("POST /api/… → 400") dan tak boleh sampai ke layar.
const reasonOf = (e: unknown): string => {
  const d = (e as { detail?: { error?: unknown } } | null)?.detail?.error;
  if (typeof d === "string" && d.trim()) return d;
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `server menolak permintaan (HTTP ${status})`;
  return e instanceof Error ? e.message : "";
};
const failed = (action: string, e: unknown): string => failureMessage(action, new Error(reasonOf(e)));

// Waktu relatif satu bentuk untuk seluruh dashboard (lib/time-format.ts).
const ago = (iso: string, now = Date.now()): string => relativeTime(iso, now) || "—";

/* ---------------------------------------------------------------- baris gabungan */

// Satu bentuk untuk tiket dan issue: daftar, pilihan, dan keyboard bekerja tanpa cabang per sumber.
type Row = {
  key: string; kind: "tiket" | "issue"; id: string; number: number; title: string;
  status: TStatus; specId: string | null; at: string; meta: string[];
};
const rowKey = (kind: "tiket" | "issue", id: string) => `${kind === "tiket" ? "t" : "i"}:${id}`;

function ticketRow(t: TicketView, projectName: (id: string) => string): Row {
  return {
    key: rowKey("tiket", t.id), kind: "tiket", id: t.id, number: t.number, title: t.title,
    status: t.status as TStatus, specId: t.specId, at: t.createdAt,
    meta: [`#${t.number}`, t.category, projectName(t.projectId), t.reporterEmail, ago(t.createdAt),
      ...(t.attachmentCount > 0 ? [`${t.attachmentCount} lampiran`] : []), ...(t.specId ? [`→ ${t.specId}`] : [])],
  };
}

function issueRow(i: GithubIssueView, projectName: (id: string) => string): Row {
  return {
    key: rowKey("issue", i.id), kind: "issue", id: i.id, number: i.number, title: i.title,
    status: i.status as TStatus, specId: i.specId, at: i.issueCreatedAt,
    meta: [`#${i.number}`, `@${i.authorLogin}`, ...i.labels, projectName(i.projectId), ago(i.issueCreatedAt),
      ...(i.specId ? [`→ ${i.specId}`] : [])],
  };
}

/* Pager gabungan: tiket dan issue dipaginasi per sumber pada nomor halaman yang sama. Footer hanya
   bisa menyebut halaman, bukan rentang, karena totalnya dua sumber yang berbeda. */
function CombinedPager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (n: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="hn-triage-footer">
      <span>Halaman {page} dari {pageCount} · tiket dan issue</span>
      <span className="hn-triage-acts">
        <Button size="sm" variant="ghost" aria-label="Sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</Button>
        <Button size="sm" variant="ghost" aria-label="Berikutnya" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Berikutnya</Button>
      </span>
    </div>
  );
}

function TicketPager({ total, page, onPage, unit = "tiket" }:
  { total: number; page: number; onPage: (n: number) => void; unit?: string }) {
  const sp = serverPage(total, page, TICKET_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}

// Baris satu daftar (DenseRow DS): klik = buka detail; checkbox dan Terima/Tolak di luar elemen klik.
// Checkbox hanya untuk yang belum ditinjau (satu-satunya yang bisa diputuskan massal).
function InboxRow({ row, selected, picked, busy, onOpen, onPick, onAccept, onReject }: {
  row: Row; selected: boolean; picked: boolean; busy: boolean;
  onOpen: () => void; onPick: () => void; onAccept: () => void; onReject: () => void;
}) {
  const isNew = row.status === "new";
  const noun = row.kind === "tiket" ? "tiket" : "issue";
  return (
    <DenseRow selected={selected} onClick={onOpen} actions={<>
      {isNew && (
        <span className="hn-triage-check hn-touch-target">
          <input type="checkbox" aria-label={`Pilih ${noun} ${row.number}`} checked={picked} onChange={onPick} />
        </span>
      )}
      <Badge tone="neutral" size="sm">{row.kind === "tiket" ? "Help Center" : "GitHub"}</Badge>
      {isNew && <>
        <Button size="sm" aria-label={`Terima ${noun} ${row.number}`} disabled={busy} onClick={onAccept}>Terima</Button>
        <Button size="sm" variant="ghost" aria-label={`Tolak ${noun} ${row.number}`} disabled={busy} onClick={onReject}>Tolak</Button>
      </>}
    </>}>
      <span className="hn-triage-title-line">
        <StatusPill variant="dot" status={STATUS_DOT[row.status]}>{STATUS_LABEL[row.status]}</StatusPill>
        <span className="hn-triage-title">{row.title}</span>
      </span>
      <span className="hn-triage-meta">{row.meta.join(" · ")}</span>
    </DenseRow>
  );
}

// Galat `Esc` di layar sempit: detail menggantikan daftar, jadi Esc membawa kembali ke daftar.
// Bila ada dialog terbuka, Esc milik dialog itu.
function useMobileEscape(enabled: boolean, onBack: () => void) {
  const tier = useResponsiveTier();
  React.useEffect(() => {
    if (tier !== "mobile" || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tier, enabled, onBack]);
}

/* ---------------------------------------------------------------- detail tiket */

function TicketDetailView({ id, projectName, onBack, onAccepted, onDeleted, onReject, onToast }:
  { id: string; projectName: (id: string) => string; onBack: () => void;
    onAccepted: (spec: Spec, already: boolean) => void; onDeleted: () => void;
    onReject: (id: string) => Promise<void>;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [t, setT] = React.useState<(TicketDetail & { spec: Spec | null }) | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [priority, setPriority] = React.useState("sedang");
  const [editing, setEditing] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  // SPEC-847 · ADR-0127 · `confirm` sudah dipakai state dialog hapus tiket, jadi hook-nya
  // dinamai `askConfirm`; `dialog` tetap dinamai baku agar penjaga inventaris menghitungnya.
  const { confirm: askConfirm, dialog } = useConfirm();
  const [form, setForm] = React.useState({ title: "", detail: "", category: "bug", status: "new" });

  const load = React.useCallback(() => {
    api.getTicket(id).then((d) => { setT(d); setState("ready"); }).catch(() => setState("error"));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  useMobileEscape(!editing, onBack);

  if (state === "loading") return <StateBlock kind="loading" />;
  if (state === "error" || !t) return <StateBlock kind="error" hint="Gagal memuat tiket." action={load} actionLabel="Coba lagi" />;
  const ticket = t;
  const linked = !!ticket.specId;
  const done = ticket.status !== "new";
  const dirty = form.title !== ticket.title || form.detail !== ticket.detail || form.category !== ticket.category || form.status !== ticket.status;

  async function accept() {
    setBusy(true);
    try {
      const r = await api.acceptTicket(id, priority);
      onAccepted(r.spec, !!r.alreadyPromoted);
    } catch (e) { onToast(failed("menerima tiket", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }
  // Tolak langsung (tanpa konfirmasi): toast "Urungkan" di layar induk yang memegang undo-nya.
  async function reject() {
    setBusy(true);
    try { await onReject(id); load(); }
    finally { setBusy(false); }
  }
  // Galat clipboard ditangkap: toast "disalin" hanya muncul bila benar-benar berhasil.
  async function copy(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(okMsg, "ok", "copy");
    } catch (e) { onToast(failed("menyalin link", e), "err", "x-circle"); }
  }
  async function unlink() {
    setBusy(true);
    try {
      const r = await api.unlinkTicket(id);
      setT({ ...ticket, specId: r.specId, spec: null, status: r.status as TicketDetail["status"] });
      onToast("Tautan backlog dilepas", "ok", "unlink");
    } catch (e) { onToast(failed("melepas tautan", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }
  function startEdit() {
    setForm({ title: ticket.title, detail: ticket.detail, category: ticket.category, status: ticket.status });
    setEditing(true);
  }
  // Batal dengan isian yang belum tersimpan harus bertanya dulu.
  async function cancelEdit() {
    if (dirty && !(await askConfirm({
      title: "Buang perubahan?",
      message: "Perubahan pada tiket ini belum disimpan.",
      impact: ["Judul, detail, kategori, dan status kembali ke nilai tersimpan."],
      confirmLabel: "Buang perubahan",
      tone: "danger",
    }))) return;
    setEditing(false);
  }
  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const d = await api.editTicket(id, { title: form.title, detail: form.detail, category: form.category as never, status: form.status as never });
      setT(d); setEditing(false); onToast("Tiket diperbarui", "ok");
    } catch (e) { onToast(failed("menyimpan tiket", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteTicket(id); onToast("Tiket dihapus", "ok", "trash-2"); onDeleted(); }
    catch (e) { onToast(failed("menghapus tiket", e), "err", "x-circle"); setBusy(false); }
  }

  if (editing) {
    const titleEmpty = !form.title.trim();
    return (
      <div className="hn-triage-detail">
        <div className="hn-triage-detail-scroll">
          <Stack gap={4}>
            <div className="hn-triage-status-row">
              <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => void cancelEdit()} disabled={busy}>Batal</Button>
              <Button size="sm" variant="primary" leftIcon="check" onClick={save} disabled={busy || titleEmpty}>Simpan</Button>
            </div>
            <Field label="Judul" error={titleEmpty ? "Judul tiket wajib diisi." : undefined}>
              <Input value={form.title} invalid={titleEmpty} placeholder="mis. Tombol Simpan tak berfungsi di HP"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <div className="hn-triage-status-row">
              <Field label="Kategori"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                options={[{ value: "bug", label: "bug" }, { value: "fitur", label: "fitur" }, { value: "pertanyaan", label: "pertanyaan" }, { value: "lainnya", label: "lainnya" }]} /></Field>
              <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={[{ value: "new", label: STATUS_LABEL.new }, { value: "accepted", label: STATUS_LABEL.accepted }, { value: "rejected", label: STATUS_LABEL.rejected }]} /></Field>
            </div>
            <Field label="Detail keluhan"><HnTextarea value={form.detail} rows={6}
              placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan."
              onChange={(e) => setForm({ ...form, detail: e.target.value })} /></Field>
          </Stack>
        </div>
        {dialog}
      </div>
    );
  }

  // Aksi sekunder dan jarang dipakai masuk menu ⋯. Hapus tetap lewat konfirmasi.
  const publicUrl = ticket.publicStatusUrl;
  const items: OverflowItem[] = [
    { key: "edit", label: "Edit", icon: "pencil", onSelect: startEdit, disabled: busy },
    ...(publicUrl ? [
      { key: "public-open", label: "Buka status publik", icon: "share-2", onSelect: () => window.open(publicUrl, "_blank", "noreferrer") },
      { key: "public-copy", label: "Salin link publik", icon: "link-2", onSelect: () => void copy(publicUrl, "Link publik disalin") },
    ] : []),
    ...(linked ? [
      { key: "spec-copy", label: "Salin link backlog", icon: "copy", onSelect: () => void copy(specDeepLink(ticket.specId!), "Link backlog disalin") },
      { key: "unlink", label: "Lepas tautan", icon: "unlink", onSelect: () => void unlink(), disabled: busy },
    ] : []),
    { key: "delete", label: "Hapus", icon: "trash-2", onSelect: () => setConfirm(true), disabled: busy },
  ];

  return (
    <div className="hn-triage-detail">
      <div className="hn-triage-detail-scroll">
        <div className="hn-triage-detail-body">
          <div>
            <span className="hn-triage-meta">#{ticket.number} · {ticket.category}</span>
            <h2 className="hn-triage-detail-title">{ticket.title}</h2>
          </div>
          <ul className="hn-triage-facts">
            <li>pelapor: <b>{ticket.reporterEmail}</b></li>
            <li>project: <b>{projectName(ticket.projectId)}</b></li>
            <li>masuk {ago(ticket.createdAt)}</li>
            {linked && <li>backlog: <b>{ticket.specId}</b> · <span>{publicStatus(ticket.status, ticket.spec?.stage)}</span></li>}
          </ul>
          <div>
            <h3 className="hn-eyebrow hn-triage-section-title">Detail keluhan</h3>
            <div className="hn-triage-body-text">{ticket.detail}</div>
          </div>
          {ticket.attachments.length > 0 && (
            <details className="hn-triage-disclosure" open>
              <summary>Lampiran ({ticket.attachments.length})</summary>
              <ul className="hn-triage-attachments">
                {ticket.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={paths.ticketAttachment(ticket.id, a.id)} target="_blank" rel="noreferrer" className="hn-triage-attachment-link">
                      <img src={paths.ticketAttachment(ticket.id, a.id)} alt={a.filename} />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      {/* Decision bar: satu aksi primer; sisanya di ⋯. Terima dari detail membawa ke backlog. */}
      <div className="hn-triage-decision" role="group" aria-label="Keputusan">
        {linked
          ? <Button size="sm" leftIcon="external-link" onClick={() => window.open(specDeepLink(ticket.specId!), "_blank", "noreferrer")}>Buka backlog</Button>
          : !done && <>
              <Button size="sm" leftIcon="arrow-up-right" onClick={accept} disabled={busy}>Terima → backlog</Button>
              <Button size="sm" variant="secondary" leftIcon="ban" onClick={reject} disabled={busy}>Tolak</Button>
              <Select size="sm" value={priority} aria-label="Prioritas tiket" onChange={(e) => setPriority(e.target.value)}
                options={[{ value: "tinggi", label: "Prioritas tinggi" }, { value: "sedang", label: "Prioritas sedang" }, { value: "rendah", label: "Prioritas rendah" }]} />
            </>}
        <span className="hn-triage-decision-spacer" />
        <OverflowActions label="Aksi lainnya" items={items} />
      </div>
      <ConfirmDialog open={confirm} title="Hapus tiket?" eyebrow={`#${ticket.number}`} confirmLabel="Hapus tiket"
        message={`Tiket "${ticket.title}" dan seluruh lampirannya akan dihapus permanen. Tindakan ini tak bisa dibatalkan.`}
        busy={busy} onCancel={() => setConfirm(false)} onConfirm={remove} />
      {dialog}
    </div>
  );
}

/* ---------------------------------------------------------------- detail issue GitHub */

// hanoman TIDAK PERNAH menulis ke GitHub; keputusan di sini hanya mengubah status di hanoman.
function IssueDetailView({ issue, projectName, onBack, onAccepted, onReject, onToast }:
  { issue: GithubIssueView; projectName: (id: string) => string; onBack: () => void;
    onAccepted: (spec: Spec, already: boolean) => void; onReject: (issue: GithubIssueView) => Promise<void>;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  useMobileEscape(true, onBack);
  const isNew = issue.status === "new";
  const linked = !!issue.specId;

  async function accept() {
    setBusy(true);
    try {
      const r = await api.acceptGithubIssue(issue.id);
      onAccepted(r.spec, !!r.alreadyPromoted);
    } catch (e) { onToast(failed("menerima issue", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await onReject(issue); } finally { setBusy(false); }
  }
  const items: OverflowItem[] = [
    { key: "gh", label: "Buka di GitHub", icon: "external-link", onSelect: () => window.open(issue.url, "_blank", "noreferrer") },
    ...(linked ? [{ key: "spec-copy", label: "Salin link backlog", icon: "copy",
      onSelect: () => { void navigator.clipboard.writeText(specDeepLink(issue.specId!)).then(
        () => onToast("Link backlog disalin", "ok", "copy"),
        (e: unknown) => onToast(failed("menyalin link", e), "err", "x-circle")); } }] : []),
  ];

  return (
    <div className="hn-triage-detail">
      <div className="hn-triage-detail-scroll">
        <div className="hn-triage-detail-body">
          <div>
            <span className="hn-triage-meta">#{issue.number} · @{issue.authorLogin}</span>
            <h2 className="hn-triage-detail-title">{issue.title}</h2>
          </div>
          <ul className="hn-triage-facts">
            <li>project: <b>{projectName(issue.projectId)}</b></li>
            <li>repo: <b>{issue.repoSlug}</b></li>
            <li>dibuat {ago(issue.issueCreatedAt)}</li>
            {issue.labels.length > 0 && <li>label: <b>{issue.labels.join(", ")}</b></li>}
            {linked && <li>backlog: <b>{issue.specId}</b></li>}
          </ul>
          <div>
            <h3 className="hn-eyebrow hn-triage-section-title">Isi issue</h3>
            <div className="hn-triage-body-text">{issue.body || "Tanpa isi."}</div>
          </div>
        </div>
      </div>
      <div className="hn-triage-decision" role="group" aria-label="Keputusan">
        {isNew && <>
          <Button size="sm" leftIcon="arrow-up-right" onClick={accept} disabled={busy}>Terima → backlog</Button>
          <Button size="sm" variant="secondary" leftIcon="ban" onClick={reject} disabled={busy}>Tolak</Button>
        </>}
        {linked && <Button size="sm" leftIcon="external-link" onClick={() => window.open(specDeepLink(issue.specId!), "_blank", "noreferrer")}>Buka backlog</Button>}
        <span className="hn-triage-decision-spacer" />
        <OverflowActions label="Aksi lainnya" items={items} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- layar */

export function TriageScreen({ projects, onAccepted, onToast }:
  { projects: ProjectVM[]; onAccepted: (spec: Spec, already: boolean) => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const projectName = React.useCallback((id: string) => projects.find((p) => p.id === id)?.name ?? id, [projects]);

  // Data: tiket (server-paged) dan issue (server-paged, hanya bila satu project dipilih).
  const [tickets, setTickets] = React.useState<TicketView[]>([]);
  const [ticketTotal, setTicketTotal] = React.useState(0);
  const [unreviewed, setUnreviewed] = React.useState(0);
  const [issues, setIssues] = React.useState<GithubIssueView[]>([]);
  const [issueTotal, setIssueTotal] = React.useState(0);
  const [issueNew, setIssueNew] = React.useState<number | null>(0);
  const [loaded, setLoaded] = React.useState(false);
  const [ticketErr, setTicketErr] = React.useState<string | null>(null);
  const [issueErr, setIssueErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pullNote, setPullNote] = React.useState<string | null>(null);
  const [pullErr, setPullErr] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  // Kenaikan ini memaksa detail tiket memuat ulang setelah "Urungkan" (remount, bukan state tersebar).
  const [detailVersion, setDetailVersion] = React.useState(0);

  // State tampilan layar ini persisten berkunci `triage` (SPEC-740 · ADR-0115).
  const [status, setStatus] = usePersistedState<TStatus>("triage", "status", "new", oneOf("new", "accepted", "rejected"));
  const [source, setSource] = usePersistedState<Source>("triage", "source", "semua", oneOf("semua", "tiket", "issue"));
  const [project, setProject] = usePersistedState("triage", "project", "", isStr);
  const [q, setQ] = usePersistedState("triage", "q", "", isStr);
  const [page, setPage] = usePersistedState("triage", "page", 1, isNum);
  const [openKey, setOpenKey] = usePersistedState<string | null>("triage", "openId", null, nullableStr);
  const activeFilters = [project !== "", source !== "semua", q.trim() !== ""].filter(Boolean).length;
  const includeTickets = source !== "issue";
  const includeIssues = source !== "tiket" && project !== "";
  // Daftar tiket baru punya tinggi final sesudah potongan pertama mendarat.
  const scrollRef = useScrollRestore("triage", "scroll", loaded);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const setListNode = React.useCallback((n: HTMLDivElement | null) => { listRef.current = n; scrollRef(n); }, [scrollRef]);
  // `dialog` tetap dinamai baku (penjaga inventaris menghitung `{dialog}` yang dirender).
  const { confirm: askConfirm, dialog } = useConfirm();
  const [toast, showToast] = useToast();

  // SPEC-908 · `q` yang menyuapi HTTP dan LANGGANAN ditahan sebentar: tiap huruf mengubah kunci langganan.
  const [liveQ, setLiveQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setLiveQ(q), Q_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Respons usang dibuang per sumber. Muat yang bersifat diam tak mengosongkan daftar yang tampil.
  const ticketSeq = React.useRef(0);
  const issueSeq = React.useRef(0);
  const load = React.useCallback((silent = false) => {
    const tSeq = ++ticketSeq.current;
    const iSeq = ++issueSeq.current;
    api.listTickets({
      project: project || undefined, status, q: liveQ || undefined,
      page: String(page), limit: String(includeTickets ? TICKET_PAGE : 1),
    }).then((r) => {
      if (tSeq !== ticketSeq.current) return;
      setTickets(includeTickets ? r.items : []);
      setTicketTotal(includeTickets ? r.total : 0);
      setUnreviewed(r.unreviewed);
      setTicketErr(null);
      setLoaded(true);
    }, (e: unknown) => {
      if (tSeq !== ticketSeq.current) return;
      // Muat diam: galat tak menggantikan daftar yang sudah tampil.
      if (!silent) setTicketErr(failed("memuat tiket", e));
      setLoaded(true);
    });

    if (!project) {
      setIssues([]); setIssueTotal(0); setIssueNew(0); setIssueErr(null);
      return;
    }
    if (includeIssues) {
      api.listGithubIssues(project, { status, page, limit: TICKET_PAGE }).then((r) => {
        if (iSeq !== issueSeq.current) return;
        setIssues(r.items); setIssueTotal(r.total); setIssueErr(null);
        setLoaded(true);
      }, (e: unknown) => {
        if (iSeq !== issueSeq.current) return;
        if (!silent) setIssueErr(failed("memuat issue", e));
        setLoaded(true);
      });
    } else {
      setIssues([]); setIssueTotal(0); setIssueErr(null);
    }
    // Hitungan "belum ditinjau" untuk issue selalu dari satu project, apa pun sumber yang tampil.
    api.listGithubIssues(project, { status: "new", limit: 1 }).then(
      (r) => { if (iSeq === issueSeq.current) setIssueNew(r.total); },
      () => { if (iSeq === issueSeq.current) setIssueNew(null); });
  }, [project, status, liveQ, page, includeTickets, includeIssues]);

  React.useEffect(() => { load(); }, [load]);
  // AC-15 · ganti penyaring atau status = kembali ke halaman 1 dan lepas pilihan massal.
  useResetOnChange(JSON.stringify([project, source, status, q]), () => { setPage(1); setPicked([]); });
  const resetFilters = () => { setProject(""); setSource("semua"); setQ(""); setPage(1); };

  // Pembaruan tiket didorong lewat langganan `/events/ws`. Params = state layar yang SEDANG aktif.
  // Issue tak punya topik realtime; POLL_MS tinggal kadens fallback (ADR-0087).
  useLiveTopic({
    topic: "tickets",
    params: {
      project: project || undefined, status, q: liveQ || undefined,
      page, limit: TICKET_PAGE,
    },
    apply: (m) => {
      ticketSeq.current++;   // frame langganan lebih baru dari HTTP tiket yang masih terbang: HTTP-nya dibuang
      setTickets(m.data.items); setTicketTotal(m.data.total); setUnreviewed(m.data.unreviewed);
      setTicketErr(null); setLoaded(true);
    },
    refetch: () => load(true),
    pollMs: POLL_MS,
  });

  // Gabungan, diurutkan dari yang terbaru. Pencarian tiket dikerjakan server; issue disaring di sini.
  const rows = React.useMemo<Row[]>(() => {
    const ql = q.trim().toLowerCase();
    const ts = includeTickets ? tickets.map((t) => ticketRow(t, projectName)) : [];
    const is = includeIssues
      ? issues
        .filter((i) => !ql || `${i.number} ${i.title} ${i.authorLogin} ${i.labels.join(" ")}`.toLowerCase().includes(ql))
        .map((i) => issueRow(i, projectName))
      : [];
    return [...ts, ...is].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [tickets, issues, includeTickets, includeIssues, q, projectName]);

  const rowByKey = React.useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const openRow = openKey ? rowByKey.get(openKey) : undefined;
  const pickedSet = new Set(picked);
  const newCount = unreviewed + (issueNew ?? 0);

  /* ------------------------------------------------------------ keputusan */

  // Tolak tiket: langsung, lalu toast "Urungkan" yang mengembalikan status ke "new" selama UNDO_MS.
  async function rejectTicketsWithUndo(ids: string[]) {
    const res = await Promise.allSettled(ids.map((id) => api.rejectTicket(id)));
    const okIds = ids.filter((_, i) => res[i]!.status === "fulfilled");
    const bad = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (okIds.length > 0) {
      showToast(okIds.length === 1 ? "Tiket ditolak" : `${okIds.length} tiket ditolak`, "ok", "ban", {
        action: { label: "Urungkan", onAction: () => void undoTickets(okIds) }, duration: UNDO_MS,
      });
    }
    if (bad) showToast(failed("menolak tiket", bad.reason), "err", "x-circle");
    load(true);
  }

  async function undoTickets(ids: string[]) {
    const res = await Promise.allSettled(ids.map((id) => api.editTicket(id, { status: "new" })));
    const okN = res.filter((r) => r.status === "fulfilled").length;
    setDetailVersion((v) => v + 1);
    load(true);
    if (okN === ids.length) showToast("Penolakan dibatalkan", "ok", "check");
    else showToast(`${okN} dari ${ids.length} penolakan dibatalkan`, "err", "x-circle");
  }

  // Terima baris (tiket: prioritas sedang; issue: default). Tetap di kotak masuk; detail yang membawa ke backlog.
  async function acceptRow(r: Row) {
    setBusy(true);
    try {
      const res = r.kind === "tiket" ? await api.acceptTicket(r.id, "sedang") : await api.acceptGithubIssue(r.id);
      const label = res.spec.id;
      showToast(res.alreadyPromoted ? `Sudah jadi ${label}` : `Diterima → ${label}`, "ok", "arrow-up-right");
      load(true);
    } catch (e) { showToast(failed("menerima " + (r.kind === "tiket" ? "tiket" : "issue"), e), "err", "x-circle"); }
    finally { setBusy(false); }
  }

  // Tolak issue: lewat konfirmasi. Tak ada jalur balik status untuk issue, jadi tak ada "Urungkan".
  async function rejectIssueConfirmed(i: GithubIssueView) {
    await askConfirm({
      title: `Tolak issue #${i.number}?`,
      message: i.title,
      impact: ["Issue ditandai ditutup di hanoman.", "Issue di GitHub tidak diubah."],
      confirmLabel: "Tolak issue",
      tone: "danger",
      icon: "x-circle",
      run: async () => { await api.rejectGithubIssue(i.id); load(true); },
    }).catch((e: unknown) => showToast(failed("menolak issue", e), "err", "x-circle"));
  }

  async function rejectRow(r: Row) {
    if (r.kind === "tiket") { setBusy(true); try { await rejectTicketsWithUndo([r.id]); } finally { setBusy(false); } return; }
    const issue = issues.find((i) => i.id === r.id);
    if (issue) await rejectIssueConfirmed(issue);
  }

  async function acceptPicked() {
    const sel = rows.filter((r) => pickedSet.has(r.key) && r.status === "new");
    const tix = sel.filter((r) => r.kind === "tiket");
    const iss = sel.filter((r) => r.kind === "issue");
    setBusy(true);
    try {
      const outcomes = await Promise.allSettled(tix.map((r) => api.acceptTicket(r.id, "sedang")));
      const issueRes = iss.length ? await api.acceptGithubIssues(iss.map((r) => r.id), undefined) : null;
      const okTickets = outcomes.filter((r) => r.status === "fulfilled").length;
      const okIssues = issueRes?.created.length ?? 0;
      const failedN = outcomes.length - okTickets + (issueRes?.failed.length ?? 0);
      showToast(`${okTickets + okIssues} diterima${failedN ? ` · ${failedN} gagal` : ""}`, failedN ? "err" : "ok", "arrow-up-right");
      setPicked([]);
      load(true);
    } catch (e) { showToast(failed("menerima yang dipilih", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function rejectPicked() {
    const sel = rows.filter((r) => pickedSet.has(r.key) && r.status === "new");
    if (sel.length === 0) return;
    await askConfirm({
      title: `Tolak ${sel.length} item?`,
      message: "Item berikut ditandai ditutup di hanoman. Issue di GitHub tidak diubah.",
      impact: sel.map((r) => `${r.kind === "tiket" ? "Tiket" : "Issue"} #${r.number}: ${r.title}`),
      confirmLabel: `Tolak ${sel.length} item`,
      tone: "danger",
      icon: "x-circle",
      run: async () => {
        const tix = sel.filter((r) => r.kind === "tiket").map((r) => r.id);
        const iss = sel.filter((r) => r.kind === "issue").map((r) => r.id);
        if (tix.length) await rejectTicketsWithUndo(tix);
        if (iss.length) {
          const res = await Promise.allSettled(iss.map((id) => api.rejectGithubIssue(id)));
          const n = res.filter((r) => r.status === "fulfilled").length;
          showToast(`${n} issue ditolak`, "ok", "ban");
        }
        setPicked([]);
        load(true);
      },
    }).catch((e: unknown) => showToast(failed("menolak yang dipilih", e), "err", "x-circle"));
  }

  async function pullIssues() {
    if (!project) return;
    setBusy(true); setPullErr(null); setPullNote(null);
    try {
      const r = await api.pullGithubIssues(project);
      setPullNote(`${r.repo}: ${r.created} baru, ${r.updated} diperbarui`
        + (r.skippedPullRequests ? ` · ${r.skippedPullRequests} pull request dilewati` : ""));
      load(true);
    } catch (e) { setPullErr(`Gagal menarik issue: ${reasonOf(e)}`); }
    finally { setBusy(false); }
  }

  const togglePick = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));

  /* ------------------------------------------------------------ keyboard */

  // Urutan tombol baris di DOM = urutan `rows` (satu daftar, tanpa cabang lain).
  const focusRow = (key: string) => {
    const idx = rows.findIndex((r) => r.key === key);
    listRef.current?.querySelectorAll<HTMLElement>("button.hn-row-main")[idx]?.focus();
  };
  const moveTo = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r.key === openKey);
    const next = rows[idx < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, idx + delta))];
    if (!next) return;
    setOpenKey(next.key);
    focusRow(next.key);
  };
  // Pintasan hanya saat fokus ada di layar ini dan bukan di kolom isian atau dialog.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable='true']")) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.key === "Escape") { if (openKey) { e.preventDefault(); setOpenKey(null); } return; }
    const key = e.key.toLowerCase();
    if (key === "j" || key === "k") { e.preventDefault(); moveTo(key === "j" ? 1 : -1); return; }
    if (!openRow || openRow.status !== "new" || busy) return;
    if (key === "a") { e.preventDefault(); void acceptRow(openRow); }
    else if (key === "r") { e.preventDefault(); void rejectRow(openRow); }
  };

  /* ------------------------------------------------------------ render */

  const chips: FilterChip[] = [
    ...(project ? [{ key: "project", label: `Project: ${projectName(project)}`, onRemove: () => setProject("") }] : []),
    ...(source !== "semua" ? [{ key: "source", label: `Sumber: ${SOURCE_LABEL[source]}`, onRemove: () => setSource("semua") }] : []),
  ];

  const filtersBody = (
    <Stack gap={3}>
      <Field label="Project">
        <Select size="sm" value={project} aria-label="Project triase" onChange={(e) => setProject(e.target.value)}
          options={[{ value: "", label: "Semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      </Field>
      <Field label="Sumber">
        <Select size="sm" value={source} aria-label="Sumber triase" onChange={(e) => setSource(e.target.value as Source)}
          options={[{ value: "semua", label: SOURCE_LABEL.semua }, { value: "tiket", label: SOURCE_LABEL.tiket }, { value: "issue", label: SOURCE_LABEL.issue }]} />
      </Field>
    </Stack>
  );

  // Pager: satu sumber = pager eksak; dua sumber (issue + tiket) = footer gabungan berbasis halaman.
  const merged = includeTickets && includeIssues;
  const footer = merged
    ? <CombinedPager page={page}
        pageCount={Math.max(serverPage(ticketTotal, page, TICKET_PAGE).pageCount, serverPage(issueTotal, page, TICKET_PAGE).pageCount)}
        onPage={setPage} />
    : includeTickets
      ? <TicketPager total={ticketTotal} page={page} onPage={setPage} />
      : includeIssues
        ? <TicketPager total={issueTotal} page={page} onPage={setPage} unit="issue" />
        : null;

  const listBody = !loaded
    ? <SkeletonList rows={4} label="Memuat keluhan dan issue…" />
    : rows.length === 0 && (ticketErr || issueErr)
      ? <StateBlock kind="error" hint={ticketErr ?? issueErr ?? "Gagal memuat."} action={() => load()} actionLabel="Coba lagi" />
      : rows.length === 0
        ? (source === "issue" && !project
          ? <StateBlock kind="empty" icon="inbox" title="Pilih satu project"
              hint="Issue GitHub milik satu repo, jadi pilih project-nya lebih dulu di penyaring." />
          : activeFilters > 0
            // Kosong karena penyaring ≠ kosong sungguhan: beri jalan keluar, jangan "Belum ada keluhan".
            ? <StateBlock kind="empty" icon="filter" title="Tak ada yang cocok"
                hint="Tidak ada tiket atau issue yang cocok dengan penyaring atau kata kunci saat ini." action={resetFilters} actionLabel="Reset penyaring" />
            : status === "new"
              ? <StateBlock kind="empty" icon="inbox" title="Belum ada keluhan"
                  hint="Aktifkan Help Center di detail project, lalu sebar link publiknya agar keluhan mulai masuk." />
              : <StateBlock kind="empty" icon="inbox" title={`Belum ada yang ${STATUS_LABEL[status].toLowerCase()}`} />)
        : (
          <RowList label="Keluhan dan issue">
            {rows.map((r) => (
              <InboxRow key={r.key} row={r} selected={r.key === openKey} picked={pickedSet.has(r.key)} busy={busy}
                onOpen={() => setOpenKey(r.key)} onPick={() => togglePick(r.key)}
                onAccept={() => void acceptRow(r)} onReject={() => void rejectRow(r)} />
            ))}
          </RowList>
        );

  const listPanel = (
    <div className="hn-triage-list-panel">
      {(ticketErr || issueErr) && rows.length > 0 && (
        <Callout tone="err" title="Sebagian data gagal dimuat">{ticketErr ?? issueErr}</Callout>
      )}
      {picked.length > 0 && (
        <div className="hn-triage-bulk" role="region" aria-label="Aksi massal">
          <span className="hn-triage-bulk-count">{picked.length} dipilih</span>
          <Button size="sm" leftIcon="arrow-up-right" onClick={() => void acceptPicked()} disabled={busy}>Terima terpilih</Button>
          <Button size="sm" variant="secondary" leftIcon="ban" onClick={() => void rejectPicked()} disabled={busy}>Tolak terpilih</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])} disabled={busy}>Batal pilih</Button>
        </div>
      )}
      <div ref={setListNode} data-testid="triage-scroll" className="hn-triage-scroll">
        {listBody}
      </div>
      {footer}
    </div>
  );

  const detailPanel = openKey && (openKey.startsWith("i:")
    ? (openRow
      ? <IssueDetailView issue={issues.find((i) => rowKey("issue", i.id) === openKey)!} projectName={projectName}
          onBack={() => setOpenKey(null)} onAccepted={onAccepted} onReject={rejectIssueConfirmed} onToast={onToast} />
      : <StateBlock kind="empty" icon="inbox" title="Issue ini tak ada di daftar" hint="Pilih ulang dari daftar di sebelahnya."
          action={() => setOpenKey(null)} actionLabel="Kembali ke daftar" />)
    : <TicketDetailView key={`${openKey}-${detailVersion}`} id={openKey.slice(2)} projectName={projectName}
        onBack={() => setOpenKey(null)}
        onAccepted={onAccepted}
        onDeleted={() => { setOpenKey(null); load(true); }}
        onReject={(id) => rejectTicketsWithUndo([id])}
        onToast={onToast} />);

  return (
    <div className="hn-triage" onKeyDown={onKeyDown}>
      <div className="hn-triage-status-row">
        <div className="hn-triage-segment" role="group" aria-label="Status keluhan dan issue">
          {SEGMENTS.map((s) => (
            <button key={s.key} type="button" className="hn-triage-segment-btn" aria-pressed={status === s.key}
              onClick={() => setStatus(s.key)}>
              {s.label}
              {s.key === "new" && newCount > 0 && <Badge tone="warn" size="sm">{newCount}</Badge>}
            </button>
          ))}
        </div>
        {project && source !== "tiket" && (
          <Button size="sm" variant="secondary" onClick={() => void pullIssues()} disabled={busy}>Tarik issue</Button>
        )}
      </div>
      {(pullNote || pullErr) && (pullErr
        ? <Callout tone="err" role="alert">{pullErr}</Callout>
        : <span className="hn-triage-meta">{pullNote}</span>)}

      <FilterBar label="Filter keluhan dan issue"
        search={{ value: q, onChange: setQ, label: "Cari tiket", placeholder: "mis. gagal login atau budi@contoh.id" }}
        chips={chips}
        filters={filtersBody}
        filtersLabel="Filter"
        onReset={resetFilters}
        resetLabel="Hapus semua filter"
        actions={<>
          <SyncButton onDone={() => load(true)} onToast={onToast} />
          <ResetViewButton screen="triage" active={activeFilters} />
          <LiveConnectionBadge />
        </>} />

      <ResponsivePanels
        ariaLabel="Panel triase"
        active={openKey ? "detail" : "list"}
        onActiveChange={(next) => { if (next === "list") setOpenKey(null); }}
        splitAt="tablet"
        masterWidth={360}
        panels={[
          { id: "list", label: "Daftar", content: listPanel, className: "hn-panel-flex" },
          ...(openKey && detailPanel ? [{ id: "detail", label: "Detail", className: "hn-panel-flex", content: detailPanel }] : []),
        ]}
      />
      <ToastHost toast={toast} />
      {dialog}
    </div>
  );
}
