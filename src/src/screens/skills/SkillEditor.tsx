// Skills library · struktur (pohon berkas) + editor berkas skill. Plugin baca-saja → tombol Fork.
import React from "react";
import { parseSkillFrontmatter, type SkillEntry, type SkillFileView, type SkillTreeView } from "@hanoman/shared";
import { Badge, Button, Card, StateBlock, isMarkdownPath } from "../../ds";
import { MarkdownView } from "../../ds/markdown";
import { useApi } from "../../api/instance";
import { ApiError } from "../../api/client";
import { buildFileTree, TreeRow } from "../file-tree";

/** Frontmatter sudah punya kartunya sendiri — jangan dirender ulang sebagai prosa di pratinjau. */
const stripFrontmatter = (t: string): string => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

/** Pesan galat untuk operator: `error` dari body server bila ada, bukan "PUT … → 409". */
export const errMessage = (e: unknown): string => {
  const d = e instanceof ApiError ? (e.detail as { error?: unknown } | null) : null;
  return typeof d?.error === "string" ? d.error : (e as Error).message;
};

export function SkillStructure({ skill, tree, selected, onSelect, onChanged, onToast }:
  { skill: SkillEntry; tree: SkillTreeView | null; selected: string; onSelect: (p: string) => void; onChanged: () => void; onToast?: (m: string) => void }) {
  const api = useApi();
  const add = async (kind: "file" | "dir") => {
    const path = window.prompt(kind === "file" ? "Path berkas baru (mis. references/api.md)" : "Path folder baru");
    if (!path) return;
    try { await api.createSkillEntry(skill.key, path, kind); onChanged(); }
    catch (e) { onToast?.(errMessage(e)); }
  };
  return (
    <Card padding={0} fill>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">{skill.name}/</span>
      </div>
      <div style={{ padding: 8, flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        {!tree ? <StateBlock kind="loading" compact title="Memuat struktur…" />
          : buildFileTree(tree.files.map((f) => f.path), tree.dirs).map((n) => (
              <TreeRow key={n.path} node={n} selected={selected} onSelect={onSelect} defaultOpen />
            ))}
      </div>
      {skill.editable && (
        <div style={{ display: "flex", gap: 8, padding: 8, borderTop: "1px solid var(--border-hair)" }}>
          <Button size="sm" variant="ghost" leftIcon="file-plus" onClick={() => add("file")}>Berkas</Button>
          <Button size="sm" variant="ghost" leftIcon="folder-plus" onClick={() => add("dir")}>Folder</Button>
        </div>
      )}
    </Card>
  );
}

export function SkillFileEditor({ skill, path, onFork, onToast }:
  { skill: SkillEntry; path: string; onFork: () => void; onToast?: (m: string) => void }) {
  const api = useApi();
  const [file, setFile] = React.useState<SkillFileView | null>(null);
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState("");
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    setFile(null); setConflict(null);
    api.skillFile(skill.key, path).then((f) => { setFile(f); setDraft(f.content ?? ""); }).catch(() => setFile(null));
  }, [api, skill.key, path]);
  React.useEffect(() => { setMode("preview"); load(); }, [load]);

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const r = await api.writeSkillFile(skill.key, path, draft, file.hash);
      setFile({ ...file, content: draft, hash: r.hash }); setConflict(null); onToast?.("Tersimpan");
    } catch (e) {
      setConflict(e instanceof ApiError && e.status === 409 ? "Berkas berubah di tempat lain — muat ulang atau timpa." : errMessage(e));
    } finally { setSaving(false); }
  };
  const overwrite = async () => {
    const fresh = await api.skillFile(skill.key, path);
    setFile({ ...fresh }); await api.writeSkillFile(skill.key, path, draft, fresh.hash);
    setConflict(null); onToast?.("Tersimpan (menimpa)");
  };

  const fm = path === "SKILL.md" && file?.content != null ? parseSkillFrontmatter(mode === "edit" ? draft : file.content) : null;
  const dirty = file?.content != null && draft !== file.content;

  return (
    <Card padding={0} fill>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, flex: "1 1 auto" }}>{path}</span>
        {skill.editable ? (
          <>
            <Button size="sm" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => setMode("preview")}>Pratinjau</Button>
            <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}>Edit</Button>
          </>
        ) : <Button size="sm" leftIcon="git-fork" onClick={onFork}>Fork ke global hanoman / project</Button>}
      </div>
      {fm && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", background: "var(--paper-100)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>name: {fm.name ?? "—"}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{fm.description ?? "—"}</div>
          {fm.error && <Badge tone="err" size="sm">{fm.error}</Badge>}
        </div>
      )}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: mode === "edit" ? 0 : 16 }}>
        {!file ? <StateBlock kind="loading" compact title="Memuat berkas…" />
          : file.binary || file.tooLarge ? <StateBlock kind="empty" compact icon="file" title={file.binary ? "Berkas biner" : "Berkas terlalu besar"} hint={`${file.size} B`} />
          : mode === "edit" ? (
            <textarea aria-label="Isi berkas" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
              style={{ width: "100%", height: "100%", minHeight: 320, border: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: 13, background: "transparent", resize: "none" }} />
          ) : isMarkdownPath(path) ? <MarkdownView text={path === "SKILL.md" ? stripFrontmatter(file.content ?? "") : file.content ?? ""} name={path} />
          : <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre-wrap" }}>{file.content}</pre>}
      </div>
      {skill.editable && mode === "edit" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderTop: "1px solid var(--border-hair)" }}>
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>Simpan</Button>
          {dirty && <span style={{ fontSize: 12, color: "var(--brass-700)" }}>belum disimpan</span>}
          {conflict && (
            <span style={{ fontSize: 12, color: "var(--clay-600)", display: "flex", gap: 8, alignItems: "center" }}>
              {conflict}
              <Button size="sm" variant="ghost" onClick={load}>Muat ulang</Button>
              <Button size="sm" variant="ghost" onClick={overwrite}>Timpa</Button>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
