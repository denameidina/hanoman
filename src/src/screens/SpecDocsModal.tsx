/* SpecDocsModal (SPEC-170) — dialog preview dokumen sebuah backlog item
   (audit/objective/spec/plan/brainstorm). Data dari GET /specs/:id/docs (+ /docs/*);
   sumber freshest-wins (worktree sesi hidup > repoDir) di-resolve server. */
import React from "react";
import { Modal, StateBlock, Icon, MarkdownView, DocDownload, ResponsivePanels } from "../ds";
import { type SpecDoc } from "../api/client";
import { useApi } from "../api/instance";
import "./styles/dialogs.css";

const KIND_LABEL: Record<string, string> = {
  audit: "Audit", spec: "Spec", plan: "Plan",
  objective: "Tujuan", brainstorm: "Brainstorm", other: "Lainnya",
};

export function SpecDocsModal({ specId, onClose }: { specId: string; onClose: () => void }) {
  const api = useApi();
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
  }, [specId, api]);

  React.useEffect(() => {
    if (!sel || sel in cache) return;
    let alive = true;
    api.getSpecDocFile(specId, sel)
      .then((d) => { if (alive) setCache((c) => ({ ...c, [sel]: d.content })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [sel]: null })); });
    return () => { alive = false; };
  }, [sel, specId, cache, api]);

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
            className="hn-workspace-panels hn-sdm-panels"
            panels={[
              { id: "files", label: "Berkas", className: "hn-panel-flex", content: (
            <div className="hn-sdm-files">
              {groups.map((grp) => (
                <div key={grp.kind} className="hn-sdm-group">
                  <div className="hn-eyebrow hn-sdm-kind">
                    {KIND_LABEL[grp.kind] ?? grp.kind}
                  </div>
                  {grp.items.map((f) => {
                    const on = f.path === sel;
                    return (
                      <button key={f.path} onClick={() => { setSel(f.path); setPanel("preview"); }}
                        className="hn-sdm-doc" data-on={on ? "true" : "false"}>
                        <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                        <span className="hn-sdm-doc-name">{f.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
              ) },
              { id: "preview", label: "Pratinjau", className: "hn-panel-flex", content: (
            <div className="hn-sdm-preview">
              {/* SPEC-361 · unduh dokumen yang sedang dibuka sebagai evidence untuk tim */}
              <div className="hn-sdm-bar">
                <DocDownload href={(f) => api.specDocDownloadUrl(specId, sel, f)}
                  disabled={!sel || docLoading || docFailed} />
              </div>
              <div data-testid="doc-preview-scroll" className="hn-sdm-scroll">
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
