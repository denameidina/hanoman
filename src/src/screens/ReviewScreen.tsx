/* ReviewScreen (SPEC-171) — review file worktree backlog item ala VSCode:
   sidebar CHANGED (SCM) + FILES (tree), viewer Diff|Source. Read-only. */
import React from "react";
import { Card, Badge, Button, Icon, StateBlock, DocPreviewModal, isMarkdownPath, ResponsivePanels } from "../ds";
import { api, type SpecReview, type ReviewFile } from "../api/client";
import { buildFileTree, TreeRow, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";

// SPEC-171/230 · review worktree. kind="spec" (backlog item) atau "session" (sesi project-level
// PRD, tanpa Spec) memilih endpoint yang dipakai — bentuk data & UI identik.
export function ReviewScreen({ specId, title, onBack, kind = "spec" }:
  { specId: string; title: string; onBack: () => void; kind?: "spec" | "session" }) {
  const fetchReview = kind === "session" ? api.sessionReview : api.specReview;
  const fetchFile = kind === "session" ? api.sessionReviewFile : api.specReviewFile;
  const [review, setReview] = React.useState<SpecReview | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "empty">("loading");
  const [errMsg, setErrMsg] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const [file, setFile] = React.useState<ReviewFile | null>(null);
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
    if (!selected) { setFile(null); return; }
    let alive = true;
    setFile(null); setPreview(false);
    fetchFile(specId, selected)
      .then((f) => { if (alive) setFile(f); })
      .catch(() => { if (alive) setFile(null); });
    return () => { alive = false; };
  }, [specId, selected]);

  const tree = React.useMemo(() => buildFileTree(review?.files ?? []), [review]);
  const changed = review?.changed ?? [];
  // Gerbang seragam SPEC-385: .md + tak biner + punya isi (berkas terhapus tak bisa dibaca).
  const canPreview = !!file && !file.binary && file.content !== null && isMarkdownPath(selected);
  const downloadUrl = kind === "session" ? api.sessionReviewFileDownloadUrl : api.specReviewFileDownloadUrl;
  const selectFile = (path: string) => { setSelected(path); setPanel("viewer"); };

  if (state === "loading") return <StateBlock kind="loading" title="Memuat review…" hint={specId} />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat review" hint={specId} action={() => setTries((n) => n + 1)} />;
  if (state === "empty") return <StateBlock kind="empty" icon="git-branch" title="Belum ada worktree untuk di-review"
    hint={errMsg || "Jalankan atau lanjutkan sesi backlog item ini dulu."} action={onBack} actionLabel="Kembali ke backlog" />;

  return <>
    <ResponsivePanels
      ariaLabel="Panel Review"
      active={panel}
      onActiveChange={(next) => setPanel(next as "files" | "viewer")}
      masterWidth={300}
      panels={[
        { id: "files", label: "Files", content: (
      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">{specId}</span>
          <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={() => setTries((n) => n + 1)}>Muat ulang</Button>
        </div>
        <div style={{ maxHeight: 640, overflow: "auto", padding: "6px 4px" }}>
          <ChangedSection label="Changed" changed={changed} selected={selected} onSelect={selectFile}
            view={chView} onView={setChView} />
          <div className="hn-eyebrow" style={{ padding: "6px 8px", marginTop: 8, borderTop: "1px solid var(--border-hair)" }}>Files</div>
          {tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
        </div>
      </Card>
        ) },

        { id: "viewer", label: "Viewer", content: (
      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{selected || "—"}</span>
          {file?.status && <Badge tone={file.status === "D" ? "err" : file.status === "A" ? "ok" : "brass"} size="sm">{file.status}</Badge>}
          <span style={{ flex: 1 }} />
          {/* SPEC-385 · baca .md sebagai dokumen terender di ruang lebar */}
          {canPreview && (
            <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setPreview(true)}>Preview</Button>
          )}
          <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
            {(["diff", "source"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                fontSize: 12, textTransform: "capitalize",
                background: tab === t ? "var(--surface-card)" : "transparent",
                color: tab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: tab === t ? 600 : 400,
              }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 640, overflow: "auto", background: "var(--surface-card)" }}>
          {!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file" hint="Pilih file dari changed atau tree." />
            : !file ? <StateBlock kind="loading" title="Memuat file…" hint={selected} />
            : file.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint="Tak dapat di-review dari dashboard." />
            : tab === "diff" ? <div style={{ padding: "10px 0" }}><DiffView diff={file.diff ?? ""} emptyHint="File ini bagian dari project tapi tak diubah backlog ini." />
                {file.truncated && <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-subtle)" }}>… dipotong pada 256 KB.</div>}</div>
            : file.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
            : <pre style={{ margin: 0, padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)" }}>{file.content}</pre>}
        </div>
      </Card>
        ) },
      ]}
    />
    {preview && canPreview && (
      <DocPreviewModal path={selected} text={file!.content ?? ""} eyebrow={specId}
        download={(f) => downloadUrl(specId, selected, f)} onClose={() => setPreview(false)} />
    )}
  </>;
}
