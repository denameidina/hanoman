/* TriageScreen — antrean triase keluhan Help Center (SPEC-253). Screen mandiri (pola VpsScreen):
   memuat datanya sendiri + silent poll (pola GitGraph). Master (daftar tiket) → detail dengan
   lampiran + aksi Terima (→ Spec, source mengikuti kategori: bug→qa, fitur→brief, pertanyaan→audit,
   lainnya→brief — SPEC-291) / Tolak.
   SPEC-908 · realtime kini lewat langganan berparameter di `/events/ws`; HTTP tinggal muat
   awal + fallback saat server belum punya topiknya.
   SPEC-293 · detail tiket tertaut: badge status penyelesaian turunan dari stage backlog +
   tombol buka/salin link backlog (deep-link #spec=, ADR-0071) + buka/salin link publik status
   tiket (shareToken) untuk dibagikan ke pelapor.
   Audit UI/UX 2026-10 (Fase 1H): tolak lewat konfirmasi, galat tak ditelan, pencarian tak memicu
   "Memuat…" penuh, aksi detail dipangkas ke primer + menu ⋯. */
import React from "react";
import { Button, Badge, Select, StateBlock, Icon, Input, Field, HnTextarea, ConfirmDialog, useConfirm, Pager, ResponsivePanels, serverPage, LiveConnectionBadge, OverflowActions, useResponsiveTier } from "../ds";
import type { OverflowItem } from "../ds";
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
// SPEC-523 · ukuran halaman daftar triase (tiket & issue). Sebelumnya keduanya memuat SELURUH baris.
const TICKET_PAGE = 20;
// SPEC-908 · jeda sebelum ketikan pencarian mengubah HTTP maupun KUNCI langganan (lihat useLiveTopic).
const Q_DEBOUNCE_MS = 400;

/* SPEC-523 · Pager DS untuk daftar triase. `unreviewed` tetap datang dari server yang
   menghitungnya atas SET PENUH, jadi lencana "belum ditinjau" tak ikut mengecil per halaman. */
function TicketPager({ total, page, onPage, unit = "tiket" }:
  { total: number; page: number; onPage: (n: number) => void; unit?: string }) {
  const sp = serverPage(total, page, TICKET_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}

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

// Bentuk relatif lengkap ("5 menit lalu"), supaya pemanggil tak menambah "lalu" sendiri.
function ago(iso: string, now = Date.now()): string {
  const d = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

const STATUS_TONE = { new: "warn", accepted: "ok", rejected: "neutral" } as const;
const STATUS_LABEL = { new: "belum ditinjau", accepted: "diterima", rejected: "ditutup" } as const;
type TStatus = keyof typeof STATUS_TONE;

function TicketRow({ t, selected, onOpen }: { t: TicketView; selected: boolean; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(t.id)}
      aria-current={selected ? "true" : undefined}
      className="hn-dense-row"
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
        padding: "12px 14px", border: `1px solid ${selected ? "var(--accent)" : "var(--border-hair)"}`, borderRadius: "var(--radius-md)",
        background: selected ? "var(--brass-050)" : "var(--surface-card)", cursor: "pointer", marginBottom: 8,
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>#{t.number}</span>
          <Badge tone="neutral" size="sm">{t.category}</Badge>
          <Badge tone={STATUS_TONE[t.status as TStatus] ?? "neutral"} size="sm">{STATUS_LABEL[t.status as TStatus] ?? t.status}</Badge>
        </span>
        <span style={{
          display: "block", color: "var(--text-body)", fontSize: "var(--text-sm)", marginTop: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{t.title}</span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 2, display: "block" }}>
          {t.projectId} · {t.reporterEmail} · {ago(t.createdAt)}{t.attachmentCount > 0 ? ` · ${t.attachmentCount} lampiran` : ""}
        </span>
      </span>
      {t.specId && <Badge tone="ok" icon="link">→ {t.specId}</Badge>}
      <Icon name="chevron-right" size={16} color="var(--text-subtle)" />
    </button>
  );
}

function TicketDetailView({ id, onBack, onAccepted, onDeleted, onToast }:
  { id: string; onBack: () => void; onAccepted: (spec: Spec, already: boolean) => void;
    onDeleted: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const tier = useResponsiveTier();
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

  // Di layar sempit detail menggantikan daftar, jadi Escape harus membawa kembali ke daftar.
  // Bila ada dialog terbuka, Escape milik dialog itu, bukan milik layar.
  React.useEffect(() => {
    if (tier !== "mobile" || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tier, editing, onBack]);

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
  async function reject() {
    try {
      await askConfirm({
        title: `Tolak & tutup tiket #${ticket.number}?`,
        message: `"${ticket.title}"`,
        impact: ["Tiket ditandai ditutup.", "Tidak ada item backlog yang dibuat."],
        confirmLabel: "Tolak tiket",
        tone: "danger",
        icon: "x-circle",
        run: async () => {
          await api.rejectTicket(id);
          setT({ ...ticket, status: "rejected" });
          onToast("Tiket ditutup", "ok", "check");
        },
      });
    } catch (e) { onToast(failed("menolak tiket", e), "err", "x-circle"); }
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
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => void cancelEdit()} disabled={busy}>Batal</Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" leftIcon="check" onClick={save} disabled={busy || titleEmpty}>Simpan</Button>
        </div>
        <Field label="Judul">
          <Input value={form.title} invalid={titleEmpty} placeholder="mis. Tombol Simpan tak berfungsi di HP"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} />
        </Field>
        {titleEmpty && <p role="alert" style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--status-err)" }}>Judul tiket wajib diisi.</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Kategori"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={[{ value: "bug", label: "bug" }, { value: "fitur", label: "fitur" }, { value: "pertanyaan", label: "pertanyaan" }, { value: "lainnya", label: "lainnya" }]} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={[{ value: "new", label: "belum ditinjau" }, { value: "accepted", label: "diterima" }, { value: "rejected", label: "ditutup" }]} /></Field>
        </div>
        <Field label="Detail keluhan"><HnTextarea value={form.detail} rows={6}
          placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan."
          onChange={(e) => setForm({ ...form, detail: e.target.value })} /></Field>
        {dialog}
      </div>
    );
  }

  // Aksi sekunder dan jarang dipakai masuk menu ⋯. Hapus tetap lewat konfirmasi.
  const publicUrl = ticket.publicStatusUrl;
  const items: OverflowItem[] = [
    { key: "edit", label: "Ubah", icon: "pencil", onSelect: startEdit, disabled: busy },
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Satu baris aksi: status, aksi utama (Terima / Buka backlog), Tolak, lalu menu ⋯. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <Badge tone={STATUS_TONE[ticket.status as TStatus] ?? "neutral"}>{STATUS_LABEL[ticket.status as TStatus] ?? ticket.status}</Badge>
        {linked && <>
          <Badge tone="ok" icon="link">→ {ticket.specId}</Badge>
          {/* SPEC-293 · status penyelesaian turunan otomatis dari stage backlog tertaut. */}
          <Badge tone="neutral" size="sm">{publicStatus(ticket.status, ticket.spec?.stage)}</Badge>
        </>}
        <span style={{ flex: 1 }} />
        {linked
          ? <Button size="sm" variant="secondary" leftIcon="external-link" onClick={() => window.open(specDeepLink(ticket.specId!), "_blank", "noreferrer")}>Buka backlog</Button>
          : !done && <>
              <Select size="sm" value={priority} aria-label="Prioritas tiket" onChange={(e) => setPriority(e.target.value)}
                options={[{ value: "tinggi", label: "Prioritas tinggi" }, { value: "sedang", label: "Prioritas sedang" }, { value: "rendah", label: "Prioritas rendah" }]} />
              <Button size="sm" leftIcon="arrow-up-right" onClick={accept} disabled={busy}>Terima → backlog</Button>
              <Button size="sm" variant="secondary" leftIcon="ban" onClick={reject} disabled={busy}>Tolak</Button>
            </>}
        <OverflowActions label="Aksi lainnya" items={items} />
      </div>
      <div>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>#{ticket.number}</span>{" "}
        <Badge tone="neutral" size="sm">{ticket.category}</Badge>
        <h2 style={{ margin: "4px 0 0", fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.3, overflowWrap: "anywhere" }}>{ticket.title}</h2>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 18, flexWrap: "wrap", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        <li>pelapor: <b style={{ color: "var(--text-body)" }}>{ticket.reporterEmail}</b></li>
        <li>project: <b style={{ color: "var(--text-body)" }}>{ticket.projectId}</b></li>
        <li>masuk {ago(ticket.createdAt)}</li>
      </ul>
      <div>
        <h3 className="hn-eyebrow" style={{ margin: "0 0 6px" }}>Detail keluhan</h3>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--text-body)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>{ticket.detail}</div>
      </div>
      {ticket.attachments.length > 0 && (
        <div>
          <h3 className="hn-eyebrow" style={{ margin: "0 0 6px" }}>Lampiran</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {ticket.attachments.map((a) => (
              <li key={a.id}>
                <a href={paths.ticketAttachment(ticket.id, a.id)} target="_blank" rel="noreferrer"
                  style={{ display: "block", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                  <img src={paths.ticketAttachment(ticket.id, a.id)} alt={a.filename}
                    style={{ display: "block", maxWidth: 180, maxHeight: 140, objectFit: "cover" }} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog open={confirm} title="Hapus tiket?" eyebrow={`#${ticket.number}`} confirmLabel="Hapus tiket"
        message={`Tiket "${ticket.title}" dan seluruh lampirannya akan dihapus permanen. Tindakan ini tak bisa dibatalkan.`}
        busy={busy} onCancel={() => setConfirm(false)} onConfirm={remove} />
      {dialog}
    </div>
  );
}

/* SPEC-471 · ADR-0095 · panel issue GitHub. Ditempatkan sebagai TAB di layar Triase, bukan layar
   baru: keduanya permukaan yang sama — laporan dari luar yang menunggu diputuskan. Tarik → daftar
   → terima (satu/massal) / tolak. hanoman TIDAK PERNAH menulis ke GitHub. */
export function GithubIssuesPanel({ projectId, onAccepted }:
  { projectId: string; onAccepted?: (specs: Spec[]) => void }) {
  const { confirm: askConfirm, dialog } = useConfirm();
  const [items, setItems] = React.useState<GithubIssueView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);

  const load = React.useCallback(async () => {
    try {
      const r = await api.listGithubIssues(projectId, { page, limit: TICKET_PAGE });
      setItems(r.items); setTotal(r.total); setState("ready");
    } catch { setState("error"); }
  }, [projectId, page]);
  React.useEffect(() => { void load(); }, [load]);
  // Pilihan hanya berlaku untuk halaman & project yang sedang tampil; pindah keduanya menghapusnya.
  React.useEffect(() => { setPicked([]); }, [projectId, page]);

  // Sebab kegagalan SELALU ditampilkan. Daftar kosong tanpa penjelasan adalah gejala yang
  // membuat kanal ini tak terlihat selama 36 jam (audit SPEC-471 B1).

  async function pull() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await api.pullGithubIssues(projectId);
      setNote(`${r.repo}: ${r.created} baru, ${r.updated} diperbarui`
        + (r.skippedPullRequests ? ` · ${r.skippedPullRequests} pull request dilewati` : ""));
      await load();
    } catch (e) { setErr(`Gagal menarik issue: ${reasonOf(e)}`); }
    finally { setBusy(false); }
  }

  async function acceptPicked() {
    setBusy(true); setErr(null);
    try {
      const r = await api.acceptGithubIssues(picked, undefined);
      setPicked([]);
      onAccepted?.(r.created);
      await load();
    } catch (e) { setErr(`Gagal menerima issue: ${reasonOf(e)}`); }
    finally { setBusy(false); }
  }

  // Tolak lewat dialog seperti tiket: `run` menahan dialog tetap sibuk sampai server menjawab.
  async function reject(i: GithubIssueView) {
    try {
      await askConfirm({
        title: `Tolak issue #${i.number}?`,
        message: i.title,
        impact: ["Issue ditandai ditutup di hanoman.", "Issue di GitHub tidak diubah."],
        confirmLabel: "Tolak issue",
        tone: "danger",
        icon: "x-circle",
        run: async () => { setErr(null); await api.rejectGithubIssue(i.id); await load(); },
      });
    } catch (e) { setErr(`Gagal menolak issue: ${reasonOf(e)}`); }
  }

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="sm" onClick={pull} disabled={busy}>Tarik issue</Button>
        <Button size="sm" variant="primary" onClick={acceptPicked} disabled={busy || picked.length === 0}>
          Terima terpilih{picked.length ? ` (${picked.length})` : ""}
        </Button>
        {note && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{note}</span>}
      </div>
      {err && <div role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--status-err)" }}>{err}</div>}
      {state === "loading" ? <StateBlock kind="loading" />
        : state === "error" ? <StateBlock kind="error" hint="Gagal memuat daftar issue." action={() => void load()} actionLabel="Coba lagi" />
        : items.length === 0 ? <StateBlock kind="empty" icon="inbox" title="Belum ada issue tertarik"
            hint="Tekan “Tarik issue” untuk menariknya dari repo GitHub project ini." />
        : <>
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((i) => (
                  <li key={i.id} className="hn-dense-row" style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "8px 0",
                    borderBottom: "1px solid var(--border-hair)" }}>
                    {i.status === "new" && (
                      <label className="hn-touch-target" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", alignSelf: "center" }}>
                        <input type="checkbox" aria-label={`Pilih issue ${i.number}`}
                          checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                      </label>
                    )}
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>#{i.number}</span>
                    <a href={i.url} target="_blank" rel="noreferrer" className="hn-touch-target" style={{ flex: 1, minWidth: 0 }}>{i.title}</a>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>@{i.authorLogin}</span>
                    {i.labels.map((l) => <Badge key={l}>{l}</Badge>)}
                    {i.status === "rejected" && <Badge tone="neutral">ditutup</Badge>}
                    {i.specId && <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{i.specId}</span>}
                    {i.status === "new" && (
                      <Button size="sm" variant="ghost" onClick={() => void reject(i)} disabled={busy}>Tolak</Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <TicketPager total={total} page={page} onPage={setPage} unit="issue" />
          </>}
      {dialog}
    </div>
  );
}

export function TriageScreen({ projects, onAccepted, onToast }:
  { projects: ProjectVM[]; onAccepted: (spec: Spec, already: boolean) => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [list, setList] = React.useState<TicketView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = usePersistedState("triage", "page", 1, isNum);
  const [unreviewed, setUnreviewed] = React.useState(0);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  // SPEC-740 · ADR-0115 · seluruh state tampilan layar ini persisten berkunci `triage`.
  const [openId, setOpenId] = usePersistedState<string | null>("triage", "openId", null, nullableStr);
  const [project, setProject] = usePersistedState("triage", "project", "", isStr);
  const [status, setStatus] = usePersistedState("triage", "status", "", isStr);
  const [q, setQ] = usePersistedState("triage", "q", "", isStr);
  // SPEC-471 · dua kanal masuk, satu layar. Pemilih tab pakai Button ber-aria-pressed, BUKAN Switch —
  // getByLabelText Switch tak terjangkau di test DS (jebakan SPEC-299).
  const [tab, setTab] = usePersistedState<"tiket" | "issue">("triage", "tab", "tiket", oneOf("tiket", "issue"));
  const activeFilters = [project !== "", status !== "", q.trim() !== ""].filter(Boolean).length;
  // Daftar tiket baru punya tinggi final sesudah potongan pertama mendarat.
  const listRef = useScrollRestore("triage", "scroll", list.length > 0);

  // SPEC-908 · `q` yang menyuapi HTTP dan LANGGANAN ditahan sebentar. Tiap huruf mengubah kunci
  // langganan (tiap kunci baru membangun entri baru di server), dan tiap muat ulang memunculkan
  // "Memuat…" penuh. Yang di-debounce adalah `liveQ`; `q` tetap langsung dipakai untuk penyaring aktif.
  const [liveQ, setLiveQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setLiveQ(q), Q_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Respons usang dibuang: hanya balasan dari permintaan TERBARU yang boleh menulis state, dan
  // muat yang bersifat diam tak mengosongkan daftar yang sudah tampil.
  const reqSeq = React.useRef(0);
  const hasData = React.useRef(false);
  const load = React.useCallback((silent = false) => {
    const seq = ++reqSeq.current;
    if (!silent && !hasData.current) setState("loading");
    api.listTickets({
      project: project || undefined, status: status || undefined, q: liveQ || undefined,
      page: String(page), limit: String(TICKET_PAGE),
    })
      .then((r) => {
        if (seq !== reqSeq.current) return;
        hasData.current = true;
        setList(r.items); setTotal(r.total); setUnreviewed(r.unreviewed); setState("ready");
      })
      .catch(() => {
        if (seq !== reqSeq.current || silent) return;
        hasData.current = false;
        setState("error");
      });
  }, [project, status, liveQ, page]);

  React.useEffect(() => { load(); }, [load]);
  // AC-15 · ganti penyaring = kembali ke halaman 1. Tanpa ini, halaman 5 dari penyaring lama
  // menjawab daftar penyaring baru yang cuma punya 2 halaman → daftar kosong tanpa sebab.
  useResetOnChange(JSON.stringify([project, status, q]), () => setPage(1));
  const resetFilters = () => { setProject(""); setStatus(""); setQ(""); setPage(1); };

  // Pembaruan didorong lewat langganan `/events/ws`, bukan poll 5 dtk. Params = state layar yang
  // SEDANG aktif, jadi halaman & penyaring yang berjalan dihormati secara konstruksi: frame
  // halaman lain punya `key` lain dan tak mungkin mendarat di sini. POLL_MS tinggal kadens
  // fallback saat server belum punya topiknya (ADR-0087) atau WS terhalang.
  useLiveTopic({
    topic: "tickets",
    params: {
      project: project || undefined, status: status || undefined, q: liveQ || undefined,
      page, limit: TICKET_PAGE,
    },
    apply: (m) => {
      reqSeq.current++;   // frame langganan lebih baru dari HTTP yang masih terbang: HTTP-nya dibuang
      hasData.current = true;
      setList(m.data.items); setTotal(m.data.total); setUnreviewed(m.data.unreviewed); setState("ready");
    },
    refetch: () => load(true),
    pollMs: POLL_MS,
  });

  // SPEC-471 · tab issue butuh SATU project (issue milik satu repo). Selama "Semua project"
  // dipilih, jelaskan itu alih-alih menampilkan daftar kosong tanpa sebab.
  const issueTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, flex: 1 }}>
      {project
        ? <GithubIssuesPanel projectId={project} onAccepted={(specs) => specs.forEach((s) => onAccepted(s, false))} />
        : <StateBlock kind="empty" icon="inbox" title="Pilih satu project"
            hint="Issue GitHub milik satu repo, jadi pilih project-nya lebih dulu di penyaring di atas." />}
    </div>
  );

  const ticketList = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {state === "loading" ? <StateBlock kind="loading" />
        : state === "error" ? <StateBlock kind="error" hint="Gagal memuat tiket." action={() => load()} actionLabel="Coba lagi" />
        : list.length === 0 ? (activeFilters > 0
            // Kosong karena penyaring ≠ kosong sungguhan: beri jalan keluar, jangan "Belum ada keluhan".
            ? <StateBlock kind="empty" icon="filter" title="Tak ada tiket yang cocok"
                hint="Tidak ada tiket yang cocok dengan penyaring atau kata kunci saat ini." action={resetFilters} actionLabel="Reset penyaring" />
            : <StateBlock kind="empty" icon="inbox" title="Belum ada keluhan"
                hint="Aktifkan Help Center di detail project, lalu sebar link publiknya agar keluhan mulai masuk." />)
        : <>
            <div ref={listRef} data-testid="triage-scroll" style={{ overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {list.map((t) => <li key={t.id}><TicketRow t={t} selected={t.id === openId} onOpen={setOpenId} /></li>)}
              </ul>
            </div>
            <TicketPager total={total} page={page} onPage={setPage} />
          </>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, flex: 1 }}>
      <div className="hn-wrap-mobile" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button size="sm" aria-pressed={tab === "tiket"} variant={tab === "tiket" ? "primary" : "ghost"} onClick={() => setTab("tiket")}>Tiket Help Center</Button>
        <Button size="sm" aria-pressed={tab === "issue"} variant={tab === "issue" ? "primary" : "ghost"} onClick={() => setTab("issue")}>Issue GitHub</Button>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Select size="sm" value={project} aria-label="Project triase" onChange={(e) => setProject(e.target.value)}
          options={[{ value: "", label: "Semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        {tab === "tiket" && <>
          <Select size="sm" value={status} aria-label="Status tiket" onChange={(e) => setStatus(e.target.value)}
            options={[{ value: "", label: "Semua status" }, { value: "new", label: "belum ditinjau" }, { value: "accepted", label: "diterima" }, { value: "rejected", label: "ditutup" }]} />
          <Input size="sm" value={q} aria-label="Cari tiket" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            placeholder="mis. gagal login atau budi@contoh.id" style={{ flex: 1, minWidth: 160 }} />
          {/* Lencana ini juga penyaring: satu ketukan menampilkan tiket yang belum ditinjau. */}
          {unreviewed > 0 && (
            <button type="button" className="hn-touch-target" title="Saring tiket yang belum ditinjau" onClick={() => setStatus("new")}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              <Badge tone="warn">{unreviewed} belum ditinjau</Badge>
            </button>
          )}
          <SyncButton onDone={() => load(true)} onToast={onToast} />
          <ResetViewButton screen="triage" active={activeFilters} />
          <LiveConnectionBadge />
        </>}
      </div>
      {tab === "issue" ? issueTab : (
        <ResponsivePanels
          ariaLabel="Panel triase"
          active={openId ? "detail" : "list"}
          onActiveChange={(next) => { if (next === "list") setOpenId(null); }}
          splitAt="tablet"
          masterWidth={360}
          panels={[
            { id: "list", label: "Daftar", content: ticketList, className: "hn-panel-flex" },
            ...(openId ? [{ id: "detail", label: "Detail", className: "hn-panel-flex", content: (
              <TicketDetailView id={openId} onBack={() => { setOpenId(null); load(true); }}
                onAccepted={onAccepted} onDeleted={() => { setOpenId(null); load(true); }} onToast={onToast} />
            ) }] : []),
          ]}
        />
      )}
    </div>
  );
}
