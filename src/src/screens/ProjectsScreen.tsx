/* ProjectsScreen — daftar project sebagai RowList yang diurut berdasar perhatian.

   Audit 2026-10 (Fase 1): galat memuat tampil sebagai blok error + "Coba lagi" (bukan empty state);
   empty state dibedakan per sebab (pencarian, halaman habis, filter perangkat, belum ada project).
   Redesign 3P (Projects · daftar): StatStrip dibuang. Hitungannya pindah ke chip filter
   (Semua · Perlu perhatian · Sesi berjalan). Kolom ringkas: Project · Status · Dokumen ·
   Backlog terbuka. "Perlu perhatian" (dokumen drift/rusak) diurut paling atas.

   Sumber data: daftar penuh `projects` (App memuat seluruh project) dipakai untuk tampilan default
   dan untuk hitungan chip, sehingga urutan dan chip konsisten. Pencarian dan filter perangkat tetap
   lewat API (SPEC-198/SPEC-880); di mode itu urutan berlaku per halaman yang dimuat. */
import React from "react";
import { StatusPill, ProgressBar, OverflowActions, Select, StateBlock, Button, serverPage, Pager,
  RowList, DenseRow, LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE } from "../ds";
import { api } from "../api/client";
import { usePersistedState, useScrollRestore, useResetOnChange, isNum, isStr, oneOf } from "../ui-state";
import { PresenceChip } from "./PresenceChip";
import type { DeviceTokenView } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { errorMessage } from "../lib/report-error";
import { PROJECT_KIND_LABEL, labelOf } from "../lib/labels";
import "./styles/projects.css";

/** Enum `ProjectKind` → label Indonesia (lib/labels.ts). Nilai yang tak dikenal dirapikan, bukan mentah. */
export const KIND_LABEL = PROJECT_KIND_LABEL;
export const kindLabel = (kind: string): string => labelOf(PROJECT_KIND_LABEL, kind);

type Chip = "all" | "attention" | "running";
const CHIP_LABEL: Record<Chip, string> = { all: "Semua", attention: "Perlu perhatian", running: "Sesi berjalan" };
const CHIP_ORDER: Chip[] = ["all", "attention", "running"];

/** Dokumen yang drift atau rusak butuh perhatian operator. */
export const needsAttention = (p: ProjectVM): boolean => p.docStatus !== "ok";
export const isRunning = (p: ProjectVM): boolean => p.session.status === "running";
const CHIP_MATCH: Record<Chip, (p: ProjectVM) => boolean> = {
  all: () => true, attention: needsAttention, running: isRunning,
};

/** Rank perhatian: rusak (0) → drift (1) → sisanya (2). Sort JS stabil: urutan asal dijaga dalam rank. */
export function attentionRank(p: ProjectVM): number {
  if (p.docStatus === "broken") return 0;
  if (p.docStatus === "drift") return 1;
  return 2;
}
export const sortByAttention = (list: ProjectVM[]): ProjectVM[] =>
  [...list].sort((a, b) => attentionRank(a) - attentionRank(b));

function hnCovTone(s: string) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }

function ProjectRow({ p, onOpen, onDelete, presenceOn }:
  { p: ProjectVM; onOpen?: (p: ProjectVM) => void; onDelete?: (p: ProjectVM) => void;
    presenceOn?: string[] }) {
  const running = isRunning(p);
  // Hapus bukan aksi baris utama: ia ada di menu ⋯ (dan di zona bahaya layar detail).
  const actions = onDelete ? (
    <OverflowActions label={`Aksi untuk project ${p.name}`} icon="ellipsis" items={[
      { key: "delete", label: "Hapus project…", icon: "trash-2", tone: "danger", onSelect: () => onDelete(p) },
    ]} />
  ) : undefined;
  return (
    <DenseRow onClick={onOpen ? () => onOpen(p) : undefined} actions={actions}>
      <span className="hn-prj-main">
        <span className="hn-prj-name">{p.name}</span>
        {/* Jenis project sebagai teks, bukan lencana: lencana per baris dibatasi dua (status + LIVE). */}
        <span className="hn-prj-desc">{kindLabel(p.kind)}{p.desc ? ` · ${p.desc}` : ""}</span>
      </span>
      {/* Status + penanda LIVE lintas device (SPEC-919 · ADR-0147). Dua penanda per baris, tak lebih. */}
      <span className="hn-prj-status">
        <StatusPill status={p.session.status} size="sm">{running && p.session.phase ? p.session.phase : undefined}</StatusPill>
        <PresenceChip names={presenceOn} />
      </span>
      <span className="hn-prj-docs">
        <ProgressBar value={p.coverage} showLabel tone={hnCovTone(p.docStatus)} size="sm" />
      </span>
      <span className="hn-prj-backlog">
        <span className="hn-prj-num">{p.backlog}</span> terbuka
      </span>
    </DenseRow>
  );
}

export function ProjectsScreen({ projects, onOpen, onDelete, pageSize, search = "", dataVersion, onClearSearch, presenceByProject }:
  { projects: ProjectVM[]; variant?: string; onOpen?: (p: ProjectVM) => void;
    onDelete?: (p: ProjectVM) => void; pageSize?: number;
    search?: string; dataVersion?: number; onClearSearch?: () => void;
    presenceByProject?: Map<string, string[]> }) {
  // SPEC-740 · ADR-0115 · nomor halaman, chip, dan posisi scroll bertahan.
  const [page, setPage] = usePersistedState("projects", "page", 1, isNum);
  const [chip, setChip] = usePersistedState<Chip>("projects", "chip", "all", oneOf<Chip>(...CHIP_ORDER));
  // SPEC-880 · ADR-0135 · katalog device instance ini. `[]` = instance ini bukan pemegang katalog.
  const [devices, setDevices] = React.useState<DeviceTokenView[]>([]);
  const [handledBy, setHandledBy] = usePersistedState("projects", "handledBy", "", isStr);
  React.useEffect(() => {
    let alive = true;
    // Katalog perangkat hanya memandu filter opsional: gagal memuatnya = filter tak ditawarkan.
    api.listDeviceTokens?.()
      .then((list) => { if (alive) setDevices(list); })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, []);

  // Dua sumber data. Tampilan "Semua" tanpa filter perangkat memakai API (SPEC-198: galat, muat
  // ulang, dan paginasi Fase 1). Chip aktif memakai daftar penuh dari App, supaya hitungan chip
  // dan hasilnya selalu sama. Tanpa `pageSize` (pemakaian non-paginasi) daftar penuh dipakai apa adanya.
  const clientMode = !pageSize || (chip !== "all" && !handledBy);
  const serverMode = !clientMode;

  // Seed dari prop penuh supaya baris tampil seketika; muatan server menggantinya begitu tiba (Fase 1).
  const [serverRows, setServerRows] = React.useState<ProjectVM[]>(projects);
  const [serverTotal, setServerTotal] = React.useState(projects.length);
  // Audit 2026-10 · galat & muat ulang. Baris lama TETAP ada saat muat ulang gagal.
  const [listError, setListError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  // AC-15 · ganti pencarian/penyaring/chip = kembali ke halaman 1, TAPI tidak saat mount.
  useResetOnChange(JSON.stringify([search, handledBy, chip]), () => setPage(1));
  React.useEffect(() => {
    if (!serverMode) { setListError(null); setLoading(false); return; }
    let alive = true;
    const p = api.listProjects?.({ q: search || undefined, handledBy: handledBy || undefined, page, limit: pageSize });
    if (!p) return;
    setLoading(true);
    p.then((r) => {
        if (!alive) return;
        setServerRows(r.items as ProjectVM[]); setServerTotal(r.total); setListError(null);
      })
      .catch((e: unknown) => { if (alive) setListError(errorMessage(e, "tidak diketahui")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [serverMode, search, handledBy, page, pageSize, dataVersion, projects, reloadKey]);

  const counts: Record<Chip, number> = {
    all: projects.length,
    attention: projects.filter(needsAttention).length,
    running: projects.filter(isRunning).length,
  };
  const chipFilter = CHIP_MATCH[chip];

  // Mode klien: seluruh daftar, dipangkas chip (dan pencarian nama bila ada), diurut perhatian,
  // lalu dipaginasi di sini. Mode server: urutan perhatian berlaku pada halaman yang dimuat.
  const needle = search.trim().toLowerCase();
  const clientFiltered = sortByAttention(projects.filter((p) => chipFilter(p)
    && (!pageSize || !needle || `${p.name} ${p.desc ?? ""}`.toLowerCase().includes(needle))));
  const clientTotal = clientFiltered.length;
  const clientPage = pageSize ? clientFiltered.slice((page - 1) * pageSize, page * pageSize) : clientFiltered;
  const rows = serverMode ? sortByAttention(serverRows.filter(chipFilter)) : clientPage;
  const total = serverMode ? serverTotal : clientTotal;
  const sp = serverPage(total, page, pageSize || total || 1);
  // Pemulihan scroll hanya setelah baris ada (SPEC-740): kalau tidak, posisi lama hilang saat kosong.
  const listRef = useScrollRestore("projects", "scroll", rows.length > 0);

  // Daftar perangkat untuk filter: hanya bila instance ini memegang katalog (lihat komentar di atas).
  const deviceOptions = devices.filter((d) => !d.revokedAt);

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
    if (chip !== "all" && projects.length > 0) return (
      <StateBlock kind="empty" icon="filter" compact title={`Tak ada project “${CHIP_LABEL[chip].toLowerCase()}”`}
        hint="Semua project sudah dalam keadaan sesuai untuk filter ini."
        action={() => setChip("all")} actionLabel="Tampilkan semua" actionIcon="x" />
    );
    // Halaman habis: total masih ada, tetapi halaman yang diminta kosong.
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
      <div style={FIXED_ROW_STYLE} className="hn-prj-toolbar">
        <div role="group" aria-label="Saring project" className="hn-prj-chips">
          {CHIP_ORDER.map((c) => (
            <button key={c} type="button" className="hn-prj-chip hn-touch-target" aria-pressed={chip === c}
              onClick={() => setChip(c)}>
              {CHIP_LABEL[c]}
              <span className="hn-prj-chip-count">{counts[c]}</span>
            </button>
          ))}
        </div>
        {/* SPEC-880 · disembunyikan di instance tanpa katalog device. Nilai tersimpan tetap tampil. */}
        {deviceOptions.length > 0 && (
          <div className="hn-prj-device">
            <Select aria-label="Saring per perangkat" value={handledBy} size="sm"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setHandledBy(e.target.value)}
              options={[{ value: "", label: "Semua perangkat" },
                ...deviceOptions.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        )}
      </div>
      {emptyBlock ?? (
        <div className="hn-prj-list">
          {listError && (
            <div role="alert" className="hn-prj-stale">
              <span className="hn-prj-stale-text">Gagal memuat ulang — yang tampil adalah data terakhir yang berhasil dimuat.</span>
              <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={() => setReloadKey((k) => k + 1)}>Coba lagi</Button>
            </div>
          )}
          <div ref={listRef} data-testid="projects-scroll" style={LIST_SCROLL_STYLE}>
            <RowList label="Daftar project">
              {rows.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpen} onDelete={onDelete}
                presenceOn={presenceByProject?.get(p.id)} />)}
            </RowList>
          </div>
          {pageSize && <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="project" />}
        </div>
      )}
    </div>
  );
}
