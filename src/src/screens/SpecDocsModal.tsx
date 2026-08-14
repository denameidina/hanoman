/* SpecDocsModal (SPEC-170) — dialog preview dokumen sebuah backlog item
   (audit/objective/spec/plan/brainstorm). Data dari GET /specs/:id/docs (+ /docs/*);
   sumber freshest-wins (worktree sesi hidup > repoDir) di-resolve server. */
import React from "react";
import { Modal, StateBlock, Icon, MarkdownView, DocDownload, ResponsivePanels } from "../ds";
import { api, type SpecDoc } from "../api/client";

const KIND_LABEL: Record<string, string> = {
  audit: "Audit", spec: "Spec", plan: "Plan",
  objective: "Objective", brainstorm: "Brainstorm", other: "Lainnya",
};

export function SpecDocsModal({ specId, onClose }: { specId: string; onClose: () => void }) {
  const [files, setFiles] = React.useState<SpecDoc[] | null>(null);
  const [ixError, setIxError] = React.useState(false);
  const [sel, setSel] = React.useState("");
  const [panel, setPanel] = React.useState<"files" | "preview">("files");
  // null = fetch gagal (bukan "kosong"), agar error per-berkas bisa dibedakan.
  const [cache, setCache] = React.useState<Record<string, string | null>>({});

  React.useEffect(() => {
    let alive = true;
    setFiles(null); setIxError(false); setSel(""); setCache({}); setPanel("files");
    api.getSpecDocs(specId).then((r) => {
      if (!alive) return;
      setFiles(r.files);
      if (r.files[0]) setSel(r.files[0].path);
    }).catch(() => { if (alive) setIxError(true); });
    return () => { alive = false; };
  }, [specId]);

  React.useEffect(() => {
    if (!sel || sel in cache) return;
    let alive = true;
    api.getSpecDocFile(specId, sel)
      .then((d) => { if (alive) setCache((c) => ({ ...c, [sel]: d.content })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [sel]: null })); });
    return () => { alive = false; };
  }, [sel, specId, cache]);

  const loading = files === null && !ixError;
  const docLoading = !!sel && !(sel in cache);
  const docFailed = sel ? cache[sel] === null : false;

  // Server sudah mengurutkan per ORDER kind; kelompokkan run yang berurutan.
  const groups: { kind: string; items: SpecDoc[] }[] = [];
  for (const f of files ?? []) {
    const g = groups[groups.length - 1];
    if (g && g.kind === f.kind) g.items.push(f);
    else groups.push({ kind: f.kind, items: [f] });
  }

  return (
    <Modal open title="Dokumen backlog item" eyebrow={specId} icon="file-text" onClose={onClose} width={900} fillHeight>
      {ixError ? <StateBlock kind="error" title="Gagal memuat daftar dokumen" hint={specId} />
        : loading ? <StateBlock kind="loading" title="Memuat dokumen…" hint={specId} />
        : !files!.length ? <StateBlock kind="empty" icon="file-text" title="Belum ada dokumen untuk item ini"
            hint="Jalankan item ini agar agent menulis audit/spec/plan." />
        : (
          // SPEC-363 · tinggi diwarisi dari panel modal (`fillHeight`), bukan `62vh` — angka
          // tetap itu membuang 18–23% ruang baca di setiap tinggi layar (terukur).
          <ResponsivePanels
            ariaLabel="Panel dokumen backlog"
            active={panel}
            onActiveChange={(next) => setPanel(next as "files" | "preview")}
            masterWidth={240}
            className="hn-workspace-panels"
            style={{ height: "100%" }}
            panels={[
              { id: "files", label: "Files", className: "hn-panel-flex", content: (
            <div style={{ overflow: "auto", borderRight: "1px solid var(--border-hair)", paddingRight: 8 }}>
              {groups.map((grp) => (
                <div key={grp.kind} style={{ marginBottom: 10 }}>
                  <div className="hn-eyebrow" style={{ padding: "4px 6px", color: "var(--text-subtle)" }}>
                    {KIND_LABEL[grp.kind] ?? grp.kind}
                  </div>
                  {grp.items.map((f) => {
                    const on = f.path === sel;
                    return (
                      <button key={f.path} onClick={() => { setSel(f.path); setPanel("preview"); }} style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
                        borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
                        background: on ? "var(--brass-100)" : "transparent",
                      }}>
                        <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 11.5,
                          color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{f.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
              ) },
              { id: "preview", label: "Preview", className: "hn-panel-flex", content: (
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* SPEC-361 · unduh dokumen yang sedang dibuka sebagai evidence untuk tim */}
              <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 6,
                borderBottom: "1px solid var(--border-hair)", marginBottom: 8 }}>
                <DocDownload href={(f) => api.specDocDownloadUrl(specId, sel, f)}
                  disabled={!sel || docLoading || docFailed} />
              </div>
              <div data-testid="doc-preview-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "0 8px 16px" }}>
                {docLoading ? <StateBlock kind="loading" title="Memuat…" hint={sel} />
                  : docFailed ? <StateBlock kind="error" title="Gagal memuat berkas" hint={sel} />
                  : <MarkdownView text={cache[sel] ?? ""} name={sel} />}
              </div>
            </div>
              ) },
            ]}
          />
        )}
    </Modal>
  );
}
