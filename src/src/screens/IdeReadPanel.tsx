/* IdeReadPanel (SPEC-1218 · ADR-0165 §11) — subset BACA dari IdeScreen.tsx, dipakai lewat
   RemoteInstanceView untuk mirroring IDE klien lain: tree, isi file, status working tree, diff
   staged/unstaged, dan riwayat commit + compare. Tanpa satu pun tombol tulis (commit/rename/
   delete/upload/remote add) — sengaja tak mengimpor `RemoteManager` atau `runGit`. */
import React from "react";
import { Card, Icon, StateBlock, Tabs, Badge, isMarkdownPath, ResponsivePanels } from "../ds";
import { MarkdownView } from "../ds/markdown";
import { useApi } from "../api/instance";
import type { RepoFile, ReviewFile, WorkingStatus } from "../api/client";
import type { GraphCommit } from "@hanoman/shared";
import { buildFileTree, TreeRow, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";

export function IdeReadPanel({ projectId }: { projectId: string }) {
  const api = useApi();
  const [tab, setTab] = React.useState<"explorer" | "graph">("explorer");
  const [files, setFiles] = React.useState<string[]>([]);
  const [dirs, setDirs] = React.useState<string[]>([]);
  const [treeState, setTreeState] = React.useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = React.useState<WorkingStatus | null>(null);
  const [selected, setSelected] = React.useState("");
  const [selKind, setSelKind] = React.useState<"file" | "staged" | "unstaged">("file");
  const [file, setFile] = React.useState<RepoFile | null>(null);
  const [diff, setDiff] = React.useState<ReviewFile | null>(null);
  const [panel, setPanel] = React.useState<"files" | "viewer">("files");

  React.useEffect(() => {
    setTreeState("loading");
    api.ideTree(projectId, "").then((t) => {
      setFiles(t.files); setDirs(t.dirs ?? []); setTreeState("ready");
    }).catch(() => setTreeState("error"));
    api.ideWorkingStatus(projectId).then(setStatus).catch(() => setStatus(null));
  }, [projectId, api]);

  React.useEffect(() => {
    if (!selected) { setFile(null); setDiff(null); return; }
    let alive = true;
    if (selKind === "file") {
      setDiff(null);
      api.ideFile(projectId, selected).then((f) => { if (alive) setFile(f); }).catch(() => { if (alive) setFile(null); });
    } else {
      setFile(null);
      api.ideFileDiff(projectId, selected, selKind === "staged")
        .then((d) => { if (alive) setDiff(d); }).catch(() => { if (alive) setDiff(null); });
    }
    return () => { alive = false; };
  }, [selected, selKind, projectId, api]);

  const selectFile = (p: string) => { setSelKind("file"); setSelected(p); setPanel("viewer"); };
  const selectStaged = (p: string) => { setSelKind("staged"); setSelected(p); setPanel("viewer"); };
  const selectChanged = (p: string) => { setSelKind("unstaged"); setSelected(p); setPanel("viewer"); };
  const inDiff = selKind !== "file";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: "1 1 0", minHeight: 0 }}>
      <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Riwayat" }]}
        value={tab} onChange={(v) => setTab(v as "explorer" | "graph")} />
      {tab === "explorer" ? (
        <ResponsivePanels
          ariaLabel="Panel IDE baca-saja"
          active={panel}
          onActiveChange={(next) => setPanel(next as "files" | "viewer")}
          masterWidth={300}
          panels={[
            { id: "files", label: "Files", className: "hn-panel-flex", content: (
              <Card padding={0} fill>
                <div style={{ flex: "0 0 auto", padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
                  <span className="hn-eyebrow">changes{status?.branch ? ` · ${status.branch}` : ""}</span>
                </div>
                <div data-testid="ide-tree-scroll" style={{ padding: 8, flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
                  <ChangedSection label="Staged" changed={status?.staged ?? []}
                    selected={selKind === "staged" ? selected : ""} onSelect={selectStaged}
                    view="list" onView={() => {}} emptyText="Tak ada file staged." />
                  <div style={{ borderTop: "1px solid var(--border-hair)", margin: "6px 0" }} />
                  <ChangedSection label="Changed" changed={status?.unstaged ?? []}
                    selected={selKind === "unstaged" ? selected : ""} onSelect={selectChanged}
                    view="list" onView={() => {}} emptyText="Tak ada file berubah." />
                  <div className="hn-eyebrow" style={{ padding: "6px 8px", marginTop: 8, borderTop: "1px solid var(--border-hair)" }}>
                    Files
                  </div>
                  {treeState === "loading" ? <StateBlock kind="loading" compact title="Memuat file…" />
                    : treeState === "error" ? <StateBlock kind="error" compact title="Gagal memuat file" />
                    : files.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Tak ada file" />
                    : buildFileTree(files, dirs).map((n) => (
                        <TreeRow key={n.path} node={n} selected={selKind === "file" ? selected : ""} onSelect={selectFile} />
                      ))}
                </div>
              </Card>
            ) },
            { id: "viewer", label: "Viewer", className: "hn-panel-flex", content: (
              <Card padding={0} fill>
                <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
                  <Icon name="file-text" size={15} color="var(--text-muted)" />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)" }}>{selected || "—"}</span>
                  {inDiff && diff?.status && <Badge tone={diff.status === "D" ? "err" : diff.status === "A" ? "ok" : "brass"} size="sm">{diff.status}</Badge>}
                </div>
                <div data-testid="doc-preview-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
                  {inDiff
                    ? (!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari Staged/Changed" />
                        : diff === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                        : diff.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint={selected} />
                        : <div style={{ padding: "10px 0" }}><DiffView diff={diff.diff ?? ""} /></div>)
                    : (!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari pohon di kiri" />
                        : file === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                        : file.binary ? <StateBlock kind="empty" icon="file" title="File biner" hint={selected} />
                        : isMarkdownPath(selected)
                          ? <div style={{ padding: "16px 20px" }}><MarkdownView text={file.content ?? ""} name={selected} /></div>
                          : <pre style={{ margin: 0, padding: "16px 18px", overflow: "auto", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}>{file.content}</pre>)}
                </div>
              </Card>
            ) },
          ]}
        />
      ) : (
        <GraphRead projectId={projectId} />
      )}
    </div>
  );
}

// SPEC-1218 · riwayat commit + compare BACA — koreksi atas plan §T13 ("ideGit(op:'graph'|'compare')"):
// endpoint nyata `api.ideGraph`/`api.ideCompare`, bukan `ideGit`. Klik dua commit membandingkan,
// meniru pola `compareFrom` GitGraph.tsx tapi tanpa aksi mutasi (merge/rebase/pull/drop).
function GraphRead({ projectId }: { projectId: string }) {
  const api = useApi();
  const [commits, setCommits] = React.useState<GraphCommit[] | null>(null);
  const [compareFrom, setCompareFrom] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState<{ from: string; to: string; changed: { path: string }[] } | null>(null);

  React.useEffect(() => {
    api.ideGraph(projectId, 100).then((g) => setCommits(g.commits)).catch(() => setCommits([]));
  }, [projectId, api]);

  const onClickCommit = (sha: string) => {
    if (!compareFrom) { setCompareFrom(sha); return; }
    if (compareFrom !== sha) api.ideCompare(projectId, compareFrom, sha).then(setCompare).catch(() => {});
    setCompareFrom(null);
  };

  return (
    <Card padding={0} fill>
      {compareFrom && (
        <div style={{ padding: "6px 14px", fontSize: 11.5, color: "var(--text-subtle)" }}>
          Compare dari {compareFrom.slice(0, 7)} — klik commit kedua
        </div>
      )}
      {compare && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)" }}>
          <div className="hn-eyebrow">compare {compare.from.slice(0, 7)} … {compare.to.slice(0, 7)}</div>
          {compare.changed.length === 0
            ? <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>Tak ada perbedaan.</div>
            : compare.changed.map((f) => (
                <div key={f.path} style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, padding: "2px 0" }}>{f.path}</div>
              ))}
        </div>
      )}
      <div style={{ padding: 8, overflow: "auto" }}>
        {commits === null ? <StateBlock kind="loading" compact title="Memuat riwayat…" />
          : commits.length === 0 ? <StateBlock kind="empty" compact icon="git-commit" title="Tak ada commit" />
          : commits.map((c) => (
              <button key={c.sha} onClick={() => onClickCommit(c.sha)} style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%",
                padding: "6px 10px", border: "none", cursor: "pointer", textAlign: "left",
                background: compareFrom === c.sha ? "var(--brass-100)" : "transparent",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{c.subject}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>
                  {c.sha.slice(0, 7)} · {c.author}
                </span>
              </button>
            ))}
      </div>
    </Card>
  );
}
