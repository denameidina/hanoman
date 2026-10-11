/* ProjectsScreen — multi-project monitor. Kolom "trigger" hilang bersama subsistem
   trigger; yang berjalan adalah sesi claude di tmux (SPEC-162).

   Audit 2026-10: (1) galat memuat daftar tampil sebagai blok error + "Coba lagi", tak lagi
   menyamar sebagai daftar kosong, dan data lama tak ditimpa diam-diam; (2) empty state dibedakan
   per sebab — pencarian, filter, halaman habis, belum ada project; (3) enum `kind` dan istilah
   jargon dipetakan ke bahasa Indonesia biasa; (4) hapus dipindah dari baris ke menu ⋯ dan ke
   layar detail; (5) tabel memakai semantik role=table/row/columnheader/cell. */
import React from "react";
import { Card, StatusPill, Badge, ProgressBar, Icon, OverflowActions, Select, StateBlock, Button, serverPage, Pager,
  LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE } from "../ds";
import { api } from "../api/client";
import { usePersistedState, useScrollRestore, useResetOnChange, isNum, isStr } from "../ui-state";
import { HandledByChips } from "./HandledByChips";
import { PresenceChip } from "./PresenceChip";
import type { DeviceTokenView } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { errorMessage } from "../lib/report-error";
import { PROJECT_KIND_LABEL, labelOf } from "../lib/labels";

/** Enum `ProjectKind` → label Indonesia (lib/labels.ts). Nilai yang tak dikenal dirapikan, bukan mentah. */
export const KIND_LABEL = PROJECT_KIND_LABEL;
export const kindLabel = (kind: string): string => labelOf(PROJECT_KIND_LABEL, kind);

function hnCovTone(s: string) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }
function hnAttention(p: ProjectVM): "high" | "low" | "none" {
  if (p.docStatus === "broken") return "high";
  if (p.docStatus === "drift") return "low";
  return "none";
}
const HN_ATT: Record<string, { bar: string; tint: string; text: string }> = {
  high: { bar: "var(--clay-500)", tint: "var(--clay-100)", text: "var(--clay-600)" },
  low: { bar: "var(--amber-500)", tint: "var(--amber-100)", text: "var(--status-warn)" },
};

function StatStrip({ projects }: { projects: ProjectVM[] }) {
  const activeRuns = projects.filter((p) => p.session.status === "running").length;
  const backlog = projects.reduce((n, p) => n + p.backlog, 0);
  const onConv = projects.filter((p) => p.docStatus === "ok").length;
  const attention = projects.filter((p) => hnAttention(p) === "high").length;
  const stats = [
    { label: "Sesi berjalan", value: activeRuns, dot: "var(--brass-500)" },
    { label: "Total item di backlog", value: backlog, dot: "var(--wind-600)" },
    { label: "Dokumen sesuai", value: onConv + "/" + projects.length, dot: "var(--leaf-600)" },
    { label: "Perlu perhatian", value: attention, dot: "var(--clay-600)" },
  ];
  return (
    <div className="hn-stat-grid" style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1,
      background: "var(--border-hair)", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20,
    }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: "var(--surface-card)", padding: "15px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 27, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{s.value}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProjectRow({ p, onOpen, onDelete, presenceOn }:
  { p: ProjectVM; onOpen?: (p: ProjectVM) => void; onDelete?: (p: ProjectVM) => void;
    presenceOn?: string[] }) {
  const att = hnAttention(p);
  const running = p.session.status === "running";
  const [hover, setHover] = React.useState(false);
  return (
    <div
      role="row"
      className="hn-project-row"
      onClick={onOpen ? () => onOpen(p) : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "1.6fr 1fr 1.2fr 0.9fr 1.3fr 1.2fr",
        alignItems: "center", gap: 12, padding: "11px 14px 11px 12px",
        borderBottom: "1px solid var(--border-hair)",
        borderLeft: `3px solid ${att === "none" ? "transparent" : HN_ATT[att]!.bar}`,
        cursor: onOpen ? "pointer" : "default",
        background: hover && onOpen ? "var(--bone-100)" : "transparent",
        transition: "background 120ms ease",
      }}>
      <div role="cell" data-label="Project" style={{ minWidth: 0 }}>
        <button type="button" className="hn-project-open" aria-label={`Buka project ${p.name}`} disabled={!onOpen}
          onClick={(event) => { event.stopPropagation(); onOpen?.(p); }}
          style={{ all: "unset", display: "block", width: "100%", cursor: onOpen ? "pointer" : "default" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Icon name="box" size={13} color="var(--text-muted)" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{p.name}</span>
            <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{kindLabel(p.kind)}</Badge>
          </span>
          <span style={{ display: "block", fontSize: 12, color: "var(--text-subtle)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</span>
        </button>
      </div>
      <div role="cell" data-label="Status" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
        <StatusPill status={p.session.status} size="sm">{running && p.session.phase ? p.session.phase : undefined}</StatusPill>
        {/* SPEC-919 · ADR-0147 · penanda LIVE lintas device — beda dari "Ditangani oleh" (ADR-0135)
            yang penetapan MANUAL dan menyeberang sync. */}
        <PresenceChip names={presenceOn} />
      </div>
      <div role="cell" data-label="Dokumen" style={{ paddingRight: 8 }}><ProgressBar value={p.coverage} showLabel tone={hnCovTone(p.docStatus)} size="sm" /></div>
      <div role="cell" data-label="Backlog" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{p.backlog} · {p.topStage}</div>
      {/* SPEC-880 · ADR-0135 · penanda "ditangani oleh" — DISYNC, beda dari repoDir/binding. */}
      <div role="cell" data-label="Ditangani oleh" style={{ minWidth: 0 }}><HandledByChips list={p.handledBy} /></div>
      <div role="cell" data-label="Aktivitas" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.activity}</span>
        {/* Hapus bukan aksi baris: ia ada di menu ⋯ dan di layar detail. Wrapper stopPropagation
            menutup klik di dalam menu (Modal ikut merambat lewat pohon React ke baris). */}
        {onDelete && (
          <span onClick={(e) => e.stopPropagation()}>
            <OverflowActions label={`Aksi untuk project ${p.name}`} icon="ellipsis" items={[
              { key: "delete", label: "Hapus project…", icon: "trash-2", onSelect: () => onDelete(p) },
            ]} />
          </span>
        )}
        {onOpen && <Icon name="chevron-right" size={14} color="var(--text-subtle)" />}
      </div>
    </div>
  );
}

export function ProjectsScreen({ projects, onOpen, onDelete, pageSize, search = "", dataVersion, onClearSearch, presenceByProject }:
  { projects: ProjectVM[]; variant?: string; onOpen?: (p: ProjectVM) => void;
    onDelete?: (p: ProjectVM) => void; pageSize?: number;
    search?: string; dataVersion?: number; onClearSearch?: () => void;
    presenceByProject?: Map<string, string[]> }) {
  const cols = ["Project", "Status", "Dokumen", "Backlog", "Ditangani oleh", "Aktivitas"];
  const tmpl = "1.6fr 1fr 1.2fr 0.9fr 1.3fr 1.2fr";
  // SPEC-198 · search + paginasi via API. StatStrip tetap dari `projects` PENUH (statistik global).
  // Baris = potongan server; seed dari prop utk render instan + tahan mock parsial di test.
  const [rows, setRows] = React.useState<ProjectVM[]>(projects);
  const [total, setTotal] = React.useState(projects.length);
  // Audit 2026-10 · galat & muat ulang. `listError` = muat terakhir gagal; baris lama TETAP ada
  // di `rows` (tak ditimpa kosong), dan `reloadKey` memicu muat ulang lewat "Coba lagi".
  const [listError, setListError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  // SPEC-740 · ADR-0115 · nomor halaman & posisi scroll bertahan; `pageSize` tetap prop.
  const [page, setPage] = usePersistedState("projects", "page", 1, isNum);
  const listRef = useScrollRestore("projects", "scroll", rows.length > 0);
  // SPEC-880 · ADR-0135 · katalog device instance ini. `[]` = instance ini bukan pemegang katalog
  // (client) → filter tak punya arti di sini dan tak dirender. Panggilan opsional (`?.`) supaya
  // test/mock lama yang cuma menyediakan `listProjects` tak jatuh.
  const [devices, setDevices] = React.useState<DeviceTokenView[]>([]);
  const [handledBy, setHandledBy] = usePersistedState("projects", "handledBy", "", isStr);
  React.useEffect(() => {
    let alive = true;
    // Katalog perangkat hanya memandu filter opsional: gagal memuatnya = filter tak ditawarkan,
    // persis seperti instance tanpa katalog. Tak ada daftar project yang bergantung padanya.
    api.listDeviceTokens?.()
      .then((list) => { if (alive) setDevices(list); })
      .catch(() => { /* filter opsional — lihat komentar di atas */ });
    return () => { alive = false; };
  }, []);
  // AC-15 · ganti pencarian/penyaring = kembali ke halaman 1, TAPI tidak saat mount: `page`
  // ikut dipersistensi (SPEC-740 · ADR-0115).
  useResetOnChange(JSON.stringify([search, handledBy]), () => setPage(1));
  React.useEffect(() => {
    if (!pageSize) { setRows(projects); setTotal(projects.length); setListError(null); return; }
    let alive = true;
    const p = api.listProjects?.({ q: search || undefined, handledBy: handledBy || undefined, page, limit: pageSize });
    if (!p) return;
    setLoading(true);
    p.then((r) => {
        if (!alive) return;
        setRows(r.items as ProjectVM[]); setTotal(r.total); setListError(null);
      })
      .catch((e: unknown) => { if (alive) setListError(errorMessage(e, "tidak diketahui")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [search, handledBy, page, pageSize, dataVersion, projects, reloadKey]);
  const sp = serverPage(total, page, pageSize || total || 1);

  const emptyBlock = (() => {
    if (loading && rows.length === 0) return <StateBlock kind="loading" title="Memuat daftar project…" />;
    if (listError && rows.length === 0) {
      return <StateBlock kind="error" title="Gagal memuat daftar project" hint={listError}
        action={() => setReloadKey((k) => k + 1)} actionLabel="Coba lagi" />;
    }
    if (rows.length > 0) return null;
    if (search) return (
      <StateBlock kind="empty" icon="search" title={`Tidak ada project cocok dengan “${search}”`}
        hint="Coba kata kunci lain, atau kosongkan pencarian."
        action={onClearSearch} actionLabel="Hapus pencarian" actionIcon="x" />
    );
    // Halaman habis: total masih ada, tetapi halaman yang diminta kosong (mis. item terakhir
    // di halaman ini sudah dihapus dari tempat lain). Jalan keluarnya kembali ke halaman 1.
    if (page > 1 && total > 0) return (
      <StateBlock kind="empty" icon="filter" compact title="Halaman ini sudah kosong"
        hint="Daftar berubah sejak halaman ini dibuka."
        action={() => setPage(1)} actionLabel="Kembali ke halaman 1" actionIcon="chevron-left" />
    );
    if (handledBy) return (
      <StateBlock kind="empty" icon="filter" compact title="Tak ada project yang ditangani perangkat ini"
        hint="Perangkat yang dipilih di filter belum menangani project mana pun."
        action={() => { setHandledBy(""); setPage(1); }} actionLabel="Reset filter" actionIcon="x" />
    );
    return <StateBlock kind="empty" icon="box" title="Belum ada project"
      hint="Tambah project untuk mulai bekerja." />;
  })();

  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={FIXED_ROW_STYLE}>
        <StatStrip projects={projects} />
        {/* SPEC-880 · disembunyikan di instance tanpa katalog device: pilihan yang tak bisa diisi
            lebih buruk daripada tak ada pilihan. Device dicabut tak ditawarkan sebagai pilihan
            BARU, tapi nilai tersimpan tetap tampil sebagai chip di barisnya. */}
        {devices.some((d) => !d.revokedAt) && (
          <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span className="hn-eyebrow">Ditangani oleh</span>
            <Select aria-label="Saring per perangkat" value={handledBy} style={{ minWidth: 180 }}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setHandledBy(e.target.value)}
              options={[{ value: "", label: "Semua perangkat" },
                ...devices.filter((d) => !d.revokedAt).map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        )}
      </div>
      {emptyBlock ?? (
        <Card padding={0} fill>
          {listError && (
            <div role="alert" style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "10px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--status-err-tint)",
              fontSize: 12.5, color: "var(--text-body)" }}>
              <span style={{ flex: 1, minWidth: 0 }}>Gagal memuat ulang — yang tampil adalah data terakhir yang berhasil dimuat.</span>
              <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={() => setReloadKey((k) => k + 1)}>Coba lagi</Button>
            </div>
          )}
          {/* Semantik tabel: header & baris membawa role sendiri, sehingga pembaca layar
              mengumumkan kolom untuk tiap sel. Pemisah grup (rowgroup) membungkus baris saja. */}
          <div role="table" aria-label="Daftar project" style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
            <div role="row" className="hn-project-header" style={{ ...FIXED_ROW_STYLE, display: "grid", gridTemplateColumns: tmpl, gap: 12, padding: "10px 14px 10px 15px", borderBottom: "1px solid var(--border-hair)" }}>
              {cols.map((c) => <span role="columnheader" key={c} className="hn-eyebrow">{c}</span>)}
            </div>
            <div role="rowgroup" ref={listRef} data-testid="projects-scroll" style={LIST_SCROLL_STYLE}>
              {rows.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpen} onDelete={onDelete}
                presenceOn={presenceByProject?.get(p.id)} />)}
            </div>
          </div>
          {pageSize && <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="project" />}
        </Card>
      )}
    </div>
  );
}
