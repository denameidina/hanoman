/* ReviewScreen (SPEC-171) — review file worktree backlog item ala VSCode:
   daftar berkas (changed + tree) dan viewer Diff|Source. Viewer itu read-only.

   Audit UI/UX 2026-10 · Fase 3 (3L′) · "Tinjau lalu Putuskan": kepala ringkas (jumlah berkas, +/−),
   lalu bar keputusan sticky di bawah. Tanpa prop keputusan, bar hanya berisi tiga tujuan navigasi
   (Backlog, Terminal, IDE). Dengan prop keputusan (`onIntegrate`, `onRevert`, `onDiscard`), bar memuat
   aksi nyata: satu primer, satu sekunder, dan ⋯ untuk aksi destruktif serta navigasi. Setiap mutasi
   lewat konfirmasi `useConfirm`; layar ini tak memanggil API mutasi sendiri — layar induk yang
   menjalankannya dan melempar galat agar ditampilkan di sini. */
import React from "react";
import { Button, Badge, Callout, Icon, Inline, OverflowActions, StateBlock, DocPreviewModal, isMarkdownPath,
  ResponsivePanels, useConfirm, type OverflowItem } from "../ds";
import { api, type SpecReview, type ReviewFile, type RevertPending } from "../api/client";
import { buildFileTree, TreeRow, TreeRoot, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";
import { routePath, type Route } from "../routes";
import { failureMessage } from "../lib/report-error";
import "./styles/review.css";

export type ReviewKind = "spec" | "session";

// SPEC-171/230 · review worktree. kind="spec" (backlog item) atau "session" (sesi project-level
// PRD, tanpa Spec) memilih endpoint yang dipakai — bentuk data & UI identik.
export function ReviewScreen({ specId, title, onBack, kind = "spec", onGoto, onIntegrate, integrateTarget, onRevert, onDiscard }:
  { specId: string; title: string; onBack: () => void; kind?: ReviewKind;
    /** Pindah ke layar lain (Backlog, Terminal, IDE). Tanpa ini setiap tombol jadi tautan ke `routePath`. */
    onGoto?: (to: Route) => void;
    /** Integrasikan: merge branch item ke cabang tujuannya. Layar induk memilih tujuan dan menjalankan
     *  mutasi; galat dilempar agar ditampilkan di bar. Hanya bermakna untuk item `done` (server 409 selain itu). */
    onIntegrate?: (specId: string) => Promise<void>;
    /** Cabang tujuan integrasi, hanya untuk teks dialog konfirmasi (mis. "main (lokal)"). */
    integrateTarget?: string;
    /** Kembalikan status ke Dikerjakan. Panggilan tanpa `confirmDelete` adalah dry-run: balasan `pending`
     *  memuat daftar dokumen yang akan dihapus; layar meminta konfirmasi lalu memanggil lagi dengan `true`. */
    onRevert?: (specId: string, confirmDelete?: boolean) => Promise<RevertPending | void>;
    /** Hapus worktree item: direktorinya dipindah ke tempat sampah repo, branch dan commit tetap. Galat dilempar. */
    onDiscard?: (specId: string) => Promise<void>; }) {
  const fetchReview = kind === "session" ? api.sessionReview : api.specReview;
  const fetchFile = kind === "session" ? api.sessionReviewFile : api.specReviewFile;
  const [review, setReview] = React.useState<SpecReview | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "empty">("loading");
  const [errMsg, setErrMsg] = React.useState("");
  // ADR-0213 · alasan keadaan kosong dari server (`no-worktree` | `no-commit`). Undefined = jalur 409 lama (sesi).
  const [emptyReason, setEmptyReason] = React.useState<SpecReview["reason"]>();
  const [selected, setSelected] = React.useState("");
  const [file, setFile] = React.useState<ReviewFile | null>(null);
  // Gagal memuat berkas ≠ "Memuat file…" selamanya: keadaannya dipisah dan bisa dicoba ulang.
  const [fileState, setFileState] = React.useState<"loading" | "ready" | "error">("loading");
  const [fileTries, setFileTries] = React.useState(0);
  const [tab, setTab] = React.useState<"diff" | "source">("diff");
  const [tries, setTries] = React.useState(0);
  const [chView, setChView] = React.useState<"list" | "tree">("list");
  // SPEC-385 · pratinjau .md sebagai dokumen terbaca; pane ini berorientasi diff, jadi
  // preview-nya sebuah AKSI, bukan tab ketiga (Diff|Source tetap apa adanya).
  const [preview, setPreview] = React.useState(false);
  const [panel, setPanel] = React.useState<"files" | "viewer">("files");
  const { confirm, dialog } = useConfirm();
  const [actionErr, setActionErr] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    setState("loading");
    fetchReview(specId).then((r) => {
      if (!alive) return;
      // ADR-0213 · `empty` = belum ada worktree maupun commit. Itu keadaan, bukan galat: 200, bukan 409.
      if (r.empty) { setReview(null); setEmptyReason(r.reason); setState("empty"); return; }
      setReview(r); setEmptyReason(undefined); setState("ready");
      setSelected(r.changed[0]?.path ?? r.files[0] ?? "");
    }).catch((e) => {
      if (!alive) return;
      // 409 (sesi project yang worktree-nya lenyap, dan galat repoDir) → empty jelas, bukan error merah.
      // Pesan teknisnya tak ditampilkan: ia hanya di atribut data-detail dan di console untuk penelusuran.
      if (e?.status === 409) {
        setEmptyReason(undefined); setState("empty"); setErrMsg(String(e?.message ?? ""));
        console.debug("review: belum ada worktree", e?.message);
      } else setState("error");
    });
    return () => { alive = false; };
  }, [specId, tries]);

  React.useEffect(() => {
    if (!selected) { setFile(null); setFileState("ready"); return; }
    let alive = true;
    setFile(null); setPreview(false); setFileState("loading");
    fetchFile(specId, selected)
      .then((f) => { if (alive) { setFile(f); setFileState("ready"); } })
      .catch(() => { if (alive) setFileState("error"); });
    return () => { alive = false; };
  }, [specId, selected, fileTries]);

  const tree = React.useMemo(() => buildFileTree(review?.files ?? []), [review]);
  const changed = review?.changed ?? [];
  const totalAdd = changed.reduce((n, c) => n + c.add, 0);
  const totalDel = changed.reduce((n, c) => n + c.del, 0);
  const selStat = changed.find((c) => c.path === selected);
  // Gerbang seragam SPEC-385: .md + tak biner + punya isi (berkas terhapus tak bisa dibaca).
  const canPreview = !!file && !file.binary && file.content !== null && isMarkdownPath(selected);
  const downloadUrl = kind === "session" ? api.sessionReviewFileDownloadUrl : api.specReviewFileDownloadUrl;
  const selectFile = (path: string) => { setSelected(path); setPanel("viewer"); };

  const backLabel = kind === "session" ? "Kembali ke terminal" : "Kembali ke backlog";
  const hasDecision = !!(onIntegrate || onRevert || onDiscard);
  const branch = `hanoman/${specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  const hint = hasDecision
    ? onIntegrate
      ? "Integrasi menggabungkan branch item ke cabang tujuan. Konflik dibereskan sesi agen di Terminal."
      : "Tinjau perubahan, lalu putuskan."
    : kind === "session"
      ? "Merge dan konflik dikerjakan di Terminal."
      : "Merge dan konflik dikerjakan di Backlog. Buka Terminal untuk melanjutkan sesinya.";

  // Tiga tujuan navigasi. Di sesi PRD, merge dan konflik hanya ada di Terminal.
  const goTerminal: Route = { section: "terminal" };
  const goIde: Route = { section: "ide" };
  const goBacklog: Route = { section: "backlog", specId };
  const go = (to: Route) => onGoto?.(to);
  // Tujuan sebagai tombol bila layar induk memberi `onGoto`; selain itu tautan biasa ke rute hanoman.
  const goButton = (to: Route, label: string, icon: string, variant: "primary" | "secondary") => onGoto
    ? <Button size="sm" variant={variant} leftIcon={icon} onClick={() => go(to)}>{label}</Button>
    : <Button size="sm" variant={variant} leftIcon={icon} as="a" href={routePath(to)}>{label}</Button>;

  // Aksi keputusan. Galat mutasi tampil di bar (`actionErr`), bukan ditelan. Dialog konfirmasi menahan
  // batal/konfirmasi selama `run` berjalan, sehingga submit ganda tak mungkin.
  async function askIntegrate() {
    const integrate = onIntegrate;
    if (!integrate) return;
    setActionErr("");
    try {
      await confirm({
        title: `Integrasikan ${specId}?`, eyebrow: specId, icon: "git-merge", confirmLabel: "Integrasikan",
        message: "Branch item di-merge ke cabang tujuan. Bila ada konflik, sesi agen membereskannya di Terminal. Rebase tetap di Backlog.",
        impact: [
          `Branch: ${branch}`,
          `${changed.length} berkas berubah, +${totalAdd} −${totalDel} baris`,
          `Cabang tujuan: ${integrateTarget ?? "cabang asal item (default project)"}`,
        ],
        run: () => integrate(specId),
      });
    } catch (e) { setActionErr(failureMessage("mengintegrasikan item", e)); }
  }
  async function askRevert() {
    const revert = onRevert;
    if (!revert) return;
    setActionErr("");
    try {
      const preview = await revert(specId);
      // Tanpa `pending` server sudah mengubah status langsung; tak ada yang perlu dikonfirmasi lagi.
      if (!preview || !("pending" in preview)) return;
      const files = preview.wouldDelete;
      await confirm({
        title: `Kembalikan ${specId} ke Dikerjakan?`, eyebrow: `${specId} → Dikerjakan`, icon: "rotate-ccw",
        tone: files.length ? "danger" : "default",
        confirmLabel: files.length ? "Hapus dokumen & kembalikan" : "Kembalikan",
        message: files.length
          ? `${files.length} berkas dokumen fase akan dihapus dari disk. Kode dan commit tidak disentuh.`
          : "Tak ada dokumen fase yang dihapus. Kode dan commit tidak disentuh.",
        impact: files,
        run: () => revert(specId, true),
      });
    } catch (e) { setActionErr(failureMessage("mengembalikan status", e)); }
  }
  async function askDiscard() {
    const discard = onDiscard;
    if (!discard) return;
    setActionErr("");
    try {
      await confirm({
        title: `Hapus worktree ${specId}?`, eyebrow: specId, icon: "trash-2", tone: "danger", confirmLabel: "Hapus worktree",
        message: "Direktori worktree dipindah ke tempat sampah repo, lalu dibersihkan. Branch dan commit item tetap ada.",
        impact: ["Sesi yang masih berjalan di worktree ini ditutup.", "Perubahan yang belum di-commit di worktree ini ikut dibersihkan."],
        run: async () => { await discard(specId); setTries((n) => n + 1); },
      });
    } catch (e) { setActionErr(failureMessage("menghapus worktree", e)); }
  }
  // Menu ⋯: aksi destruktif plus navigasi. Navigasi hanya ada bila layar induk memberi `onGoto`,
  // karena item menu tak bisa menjadi tautan.
  const moreItems: OverflowItem[] = [
    ...(onDiscard ? [{ key: "discard", label: "Hapus worktree", icon: "trash-2", tone: "danger" as const,
      onSelect: () => void askDiscard() }] : []),
    ...(onGoto && kind === "spec" ? [{ key: "backlog", label: "Buka di Backlog", icon: "list-checks",
      onSelect: () => go(goBacklog) }] : []),
    ...(onGoto ? [
      { key: "terminal", label: "Buka di Terminal", icon: "terminal", onSelect: () => go(goTerminal) },
      { key: "ide", label: "Buka di IDE", icon: "code", onSelect: () => go(goIde) },
    ] : []),
  ];

  if (state === "loading") return <StateBlock kind="loading" title="Memuat review…" hint={specId} />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat review" hint={specId} action={() => setTries((n) => n + 1)} />;
  if (state === "empty") return <div className="hn-review-empty" data-review-state="empty" data-reason={emptyReason ?? "409"} data-status={emptyReason ? "200" : "409"}
    data-detail={errMsg || undefined}>
    <StateBlock kind="empty" icon="git-branch" title="Belum ada perubahan untuk ditinjau"
      hint={emptyReason === "no-commit"
        ? "Worktree sudah dilepas dan belum ada commit untuk ditinjau. Jalankan sesinya lagi bila perlu."
        : "Sesi belum membuat worktree. Jalankan atau lanjutkan sesinya dulu, lalu muat ulang."} />
    <Inline gap={2} justify="center">
      {kind === "spec" && goButton(goBacklog, "Buka di Backlog", "list-checks", "primary")}
      {goButton(goTerminal, "Buka di Terminal", "terminal", kind === "session" ? "primary" : "secondary")}
      <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={onBack}>{backLabel}</Button>
    </Inline>
  </div>;

  return <div className="hn-review">
    <header className="hn-review-topbar">
      <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={onBack}>{backLabel}</Button>
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={() => setTries((n) => n + 1)}>Muat ulang</Button>
    </header>

    <div className="hn-review-head">
      <span className="hn-eyebrow">{specId}</span>
      <h2 className="hn-review-title">{title || specId}</h2>
      <p className="hn-review-stat">
        {changed.length} berkas berubah · <span className="hn-review-delta">{`+${totalAdd} −${totalDel}`}</span> baris
      </p>
    </div>

    <ResponsivePanels
      ariaLabel="Panel Review"
      active={panel}
      onActiveChange={(next) => setPanel(next as "files" | "viewer")}
      masterWidth={300}
      panels={[
        { id: "files", label: "Files", content: (
      <section className="hn-review-pane" aria-label="Daftar berkas">
        <div className="hn-review-list">
          <ChangedSection label="Changed" changed={changed} selected={selected} onSelect={selectFile}
            view={chView} onView={setChView} />
          <div className="hn-eyebrow hn-review-sep">Semua berkas</div>
          <TreeRoot label="Pohon berkas" nodes={tree}>
            {tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
          </TreeRoot>
        </div>
        {/* Legenda status git — huruf di kanan tiap baris changed/Badge file. */}
        <p className="hn-review-legend">A = baru · M = diubah · D = dihapus</p>
      </section>
        ) },

        { id: "viewer", label: "Viewer", content: (
      <section className="hn-review-viewer" aria-label="Isi berkas">
        <div className="hn-review-viewbar">
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span className="hn-review-path">{selected || "—"}</span>
          {file?.status && <Badge tone={file.status === "D" ? "err" : file.status === "A" ? "ok" : "brass"} size="sm">{file.status}</Badge>}
          {selStat && <span className="hn-review-filestat">+{selStat.add} −{selStat.del}</span>}
          {/* SPEC-385 · baca .md sebagai dokumen terender di ruang lebar */}
          {canPreview && (
            <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setPreview(true)}>Preview</Button>
          )}
          <div className="hn-review-seg">
            {(["diff", "source"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === "diff" ? "Diff" : "Sumber"}
              </button>
            ))}
          </div>
        </div>
        <div className="hn-review-body">
          {!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file" hint="Pilih file dari changed atau tree." />
            : fileState === "error" ? <StateBlock kind="error" title="Gagal memuat berkas" hint={selected} action={() => setFileTries((n) => n + 1)} />
            : !file ? <StateBlock kind="loading" title="Memuat file…" hint={selected} />
            : file.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint="Tak dapat di-review dari dashboard." />
            : tab === "diff" ? <div className="hn-review-diff"><DiffView diff={file.diff ?? ""} emptyHint="File ini bagian dari project, tetapi tidak diubah oleh item ini." />
                {file.truncated && (
                  <div className="hn-review-truncated">
                    <span>… dipotong pada 256 KB.</span>
                    <a href={downloadUrl(specId, selected, "md")} download>Unduh berkas utuh</a>
                  </div>
                )}</div>
            : file.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
            : <pre className="hn-review-pre">{file.content}</pre>}
        </div>
      </section>
        ) },
      ]}
    />

    <div className="hn-review-decide" role="region" aria-label="Keputusan">
      {actionErr && <Callout tone="err" className="hn-review-decide-err">{actionErr}</Callout>}
      <p className="hn-review-decide-hint">{hint}</p>
      {hasDecision ? (
        <div className="hn-review-decide-actions">
          {onRevert && <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={() => void askRevert()}>Kembalikan ke Dikerjakan</Button>}
          {onIntegrate && <Button size="sm" variant="primary" leftIcon="git-merge" onClick={() => void askIntegrate()}>Integrasikan</Button>}
          {moreItems.length > 0 && <div className="hn-review-more">
            <OverflowActions label="Aksi lain untuk item ini" items={moreItems} />
          </div>}
        </div>
      ) : (
        <div className="hn-review-decide-actions">
          {kind === "spec" && goButton(goBacklog, "Buka di Backlog", "list-checks", "primary")}
          {goButton(goTerminal, "Buka di Terminal", "terminal", kind === "session" ? "primary" : "secondary")}
          {goButton(goIde, "Buka di IDE", "code", "secondary")}
        </div>
      )}
    </div>
    {dialog}
    {preview && canPreview && (
      <DocPreviewModal path={selected} text={file!.content ?? ""} eyebrow={specId}
        download={(f) => downloadUrl(specId, selected, f)} onClose={() => setPreview(false)} />
    )}
  </div>;
}
