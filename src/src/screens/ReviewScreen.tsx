/* ReviewScreen (SPEC-171) — review file worktree backlog item ala VSCode:
   daftar berkas (changed + tree) dan viewer Diff|Source. Read-only.

   Audit UI/UX 2026-10 · Fase 3 (3L) · "Tinjau lalu Putuskan": kepala ringkas (jumlah berkas, +/−),
   lalu bar keputusan sticky di bawah. Layar ini tak memutuskan apa pun sendiri: merge dan konflik
   tetap dikerjakan di Backlog (integrate) atau Terminal (sesi konflik). Tiga tombol di bar hanya
   berpindah layar: lewat `onGoto` bila layar induk memberikannya, selain itu tautan biasa. */
import React from "react";
import { Button, Badge, Icon, StateBlock, DocPreviewModal, isMarkdownPath, ResponsivePanels } from "../ds";
import { api, type SpecReview, type ReviewFile } from "../api/client";
import { buildFileTree, TreeRow, TreeRoot, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";
import { routePath, type Route } from "../routes";
import "./styles/review.css";

export type ReviewKind = "spec" | "session";

// SPEC-171/230 · review worktree. kind="spec" (backlog item) atau "session" (sesi project-level
// PRD, tanpa Spec) memilih endpoint yang dipakai — bentuk data & UI identik.
export function ReviewScreen({ specId, title, onBack, kind = "spec", onGoto }:
  { specId: string; title: string; onBack: () => void; kind?: ReviewKind;
    /** Pindah ke layar lain (Backlog, Terminal, IDE). Tanpa ini setiap tombol jadi tautan ke `routePath`. */
    onGoto?: (to: Route) => void }) {
  const fetchReview = kind === "session" ? api.sessionReview : api.specReview;
  const fetchFile = kind === "session" ? api.sessionReviewFile : api.specReviewFile;
  const [review, setReview] = React.useState<SpecReview | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "empty">("loading");
  const [errMsg, setErrMsg] = React.useState("");
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

  React.useEffect(() => {
    let alive = true;
    setState("loading");
    fetchReview(specId).then((r) => {
      if (!alive) return;
      setReview(r); setState("ready");
      setSelected(r.changed[0]?.path ?? r.files[0] ?? "");
    }).catch((e) => {
      if (!alive) return;
      // 409 (worktree/repoDir) → empty jelas, bukan error merah.
      if (e?.status === 409) { setState("empty"); setErrMsg(String(e?.message ?? "")); }
      else setState("error");
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
  const hint = kind === "session"
    ? "Merge dan konflik dikerjakan di Terminal."
    : "Merge dan konflik dikerjakan di Backlog. Buka Terminal untuk melanjutkan sesinya.";

  if (state === "loading") return <StateBlock kind="loading" title="Memuat review…" hint={specId} />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat review" hint={specId} action={() => setTries((n) => n + 1)} />;
  if (state === "empty") return <StateBlock kind="empty" icon="git-branch" title="Belum ada worktree untuk di-review"
    hint={errMsg || "Jalankan atau lanjutkan sesi backlog item ini dulu."} action={onBack} actionLabel="Kembali ke backlog" />;

  // Tiga tujuan keputusan. Di sesi PRD, merge dan konflik hanya ada di Terminal.
  const goTerminal: Route = { section: "terminal" };
  const goIde: Route = { section: "ide" };
  const goBacklog: Route = { section: "backlog", specId };
  const go = (to: Route) => onGoto?.(to);

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
      <p className="hn-review-decide-hint">{hint}</p>
      <div className="hn-review-decide-actions">
        {kind === "spec" && (onGoto
          ? <Button size="sm" variant="primary" leftIcon="list-checks" onClick={() => go(goBacklog)}>Buka di Backlog</Button>
          : <Button size="sm" variant="primary" leftIcon="list-checks" as="a" href={routePath(goBacklog)}>Buka di Backlog</Button>)}
        {onGoto
          ? <Button size="sm" variant={kind === "session" ? "primary" : "secondary"} leftIcon="terminal" onClick={() => go(goTerminal)}>Buka di Terminal</Button>
          : <Button size="sm" variant={kind === "session" ? "primary" : "secondary"} leftIcon="terminal" as="a" href={routePath(goTerminal)}>Buka di Terminal</Button>}
        {onGoto
          ? <Button size="sm" variant="secondary" leftIcon="code" onClick={() => go(goIde)}>Buka di IDE</Button>
          : <Button size="sm" variant="secondary" leftIcon="code" as="a" href={routePath(goIde)}>Buka di IDE</Button>}
      </div>
    </div>
    {preview && canPreview && (
      <DocPreviewModal path={selected} text={file!.content ?? ""} eyebrow={specId}
        download={(f) => downloadUrl(specId, selected, f)} onClose={() => setPreview(false)} />
    )}
  </div>;
}
