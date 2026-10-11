// Skills library · struktur (pohon berkas) + editor berkas skill. Plugin baca-saja → tombol Fork.
import React from "react";
import { parseSkillFrontmatter, type SkillEntry, type SkillFileView, type SkillTreeView } from "@hanoman/shared";
import { Badge, Button, Card, Field, Input, Modal, StateBlock, isMarkdownPath, useConfirm } from "../../ds";
import { MarkdownView } from "../../ds/markdown";
import { useApi } from "../../api/instance";
import { ApiError } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import { buildFileTree, TreeRow } from "../file-tree";

/** Frontmatter sudah punya kartunya sendiri — jangan dirender ulang sebagai prosa di pratinjau. */
const stripFrontmatter = (t: string): string => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

/** Pesan galat untuk operator: `error` dari body server bila ada, bukan "PUT … → 409". */
export const errMessage = (e: unknown): string => {
  const d = e instanceof ApiError ? (e.detail as { error?: unknown } | null) : null;
  return typeof d?.error === "string" ? d.error : (e as Error).message;
};

/** `failureMessage` yang alasannya diambil dari body server (`errMessage`). */
export const skillFailure = (action: string, e: unknown): string => failureMessage(action, new Error(errMessage(e)));

/** Path berkas/folder baru relatif ke root skill; `null` = sah. */
export function validateEntryPath(path: string, kind: "file" | "dir", existing: string[]): string | null {
  if (!path.trim()) return "Nama wajib diisi.";
  if (path !== path.trim()) return "Nama tak boleh diawali atau diakhiri spasi.";
  if (path.includes("\\")) return "Pakai / sebagai pemisah folder, bukan \\.";
  if (path.startsWith("/")) return "Path relatif terhadap folder skill, tanpa / di depan.";
  if (path.endsWith("/")) return "Tulis nama tanpa / di belakang.";
  if (/[\u0000-\u001f]/.test(path)) return "Nama mengandung karakter kontrol.";
  const segments = path.split("/");
  if (segments.some((seg) => seg === "")) return "Path tak boleh punya segmen kosong (//).";
  if (segments.some((seg) => seg === "." || seg === "..")) return "Segmen . dan .. tidak diizinkan.";
  if (existing.includes(path)) return `${kind === "file" ? "Berkas" : "Folder"} ${path} sudah ada.`;
  return null;
}

export function SkillStructure({ skill, tree, selected, onSelect, onChanged }:
  { skill: SkillEntry; tree: SkillTreeView | null; selected: string; onSelect: (p: string) => void; onChanged: () => void }) {
  const api = useApi();
  const [adding, setAdding] = React.useState<"file" | "dir" | null>(null);
  const [path, setPath] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const errorId = React.useId();

  const existing = tree ? [...tree.files.map((f) => f.path), ...tree.dirs] : [];
  const problem = adding ? validateEntryPath(path, adding, existing) : null;
  const shownProblem = path === "" ? null : problem ?? (submitError || null);
  const label = adding === "dir" ? "Path folder" : "Path berkas";
  const close = () => { setAdding(null); setPath(""); setSubmitError(""); };
  const open = (kind: "file" | "dir") => { setPath(""); setSubmitError(""); setAdding(kind); };

  const submit = async () => {
    if (!adding || problem || busy) return;
    setBusy(true); setSubmitError("");
    try { await api.createSkillEntry(skill.key, path, adding); close(); onChanged(); }
    catch (e) { setSubmitError(skillFailure(adding === "file" ? "membuat berkas" : "membuat folder", e)); }
    finally { setBusy(false); }
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
          <Button size="sm" variant="ghost" leftIcon="file-plus" onClick={() => open("file")}>Berkas</Button>
          <Button size="sm" variant="ghost" leftIcon="folder-plus" onClick={() => open("dir")}>Folder</Button>
        </div>
      )}
      <Modal open={adding !== null} title={adding === "dir" ? "Folder baru" : "Berkas baru"} eyebrow={`${skill.name}/`} onClose={close}
        footer={<>
          <Button variant="ghost" onClick={close}>Batal</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={Boolean(problem)}>Buat</Button>
        </>}>
        <Field label={label} hint={shownProblem
          ? <span id={errorId} role="alert" style={{ color: "var(--clay-600)" }}>{shownProblem}</span>
          : "Relatif ke folder skill; pakai / untuk subfolder."}>
          <Input aria-label={label} value={path} mono invalid={Boolean(shownProblem)}
            aria-invalid={shownProblem ? true : undefined} aria-describedby={shownProblem ? errorId : undefined}
            placeholder={adding === "dir" ? "mis. references" : "mis. references/api.md"}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPath(e.target.value); setSubmitError(""); }}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} />
        </Field>
      </Modal>
    </Card>
  );
}

export function SkillFileEditor({ skill, path, onFork, onToast, onDirtyChange }:
  { skill: SkillEntry; path: string; onFork: () => void; onToast?: (m: string) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [file, setFile] = React.useState<SkillFileView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState("");
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const loadSeq = React.useRef(0);

  const load = React.useCallback(() => {
    const seq = ++loadSeq.current;
    setFile(null); setConflict(null); setLoadError(null);
    api.skillFile(skill.key, path)
      .then((f) => { if (seq === loadSeq.current) { setFile(f); setDraft(f.content ?? ""); } })
      .catch((e) => { if (seq === loadSeq.current) setLoadError(errMessage(e)); });
  }, [api, skill.key, path]);
  React.useEffect(() => { setMode("preview"); load(); return () => { loadSeq.current++; }; }, [load]);

  const dirty = file?.content != null && draft !== file.content;
  React.useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      const r = await api.writeSkillFile(skill.key, path, draft, file.hash);
      setFile({ ...file, content: draft, hash: r.hash }); setConflict(null); onToast?.("Tersimpan");
    } catch (e) {
      setConflict(e instanceof ApiError && e.status === 409 ? "Berkas berubah di tempat lain — muat ulang atau timpa." : skillFailure("menyimpan berkas", e));
    } finally { setSaving(false); }
  };
  const reload = async () => {
    if (dirty && !(await confirm({
      title: "Buang perubahan?", eyebrow: path, tone: "danger", confirmLabel: "Buang perubahan", cancelLabel: "Tetap mengedit",
      message: "Memuat ulang mengganti isi editor dengan versi yang tersimpan.",
      impact: ["Perubahan di editor yang belum disimpan hilang."],
    }))) return;
    load();
  };
  const overwrite = async () => {
    if (!file || saving) return;
    try {
      await confirm({
        title: `Timpa ${path}?`, eyebrow: skill.name, tone: "danger", confirmLabel: "Timpa berkas", cancelLabel: "Batal",
        message: "Isi editor akan ditulis di atas versi terbaru yang ada di disk.",
        impact: ["Perubahan yang dibuat orang atau proses lain pada berkas ini hilang.", "Draf di editor tetap utuh bila penimpaan gagal."],
        run: async () => {
          setSaving(true);
          try {
            const fresh = await api.skillFile(skill.key, path);
            const r = await api.writeSkillFile(skill.key, path, draft, fresh.hash);
            setFile({ ...fresh, content: draft, hash: r.hash }); setConflict(null); onToast?.("Tersimpan (menimpa)");
          } finally { setSaving(false); }
        },
      });
    } catch (e) { setConflict(skillFailure("menimpa berkas", e)); }
  };

  const fm = path === "SKILL.md" && file?.content != null ? parseSkillFrontmatter(draft) : null;

  return (
    <Card padding={0} fill>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, flex: "1 1 auto" }}>{path}</span>
        {skill.editable ? (
          <>
            <Button size="sm" variant={mode === "preview" ? "secondary" : "ghost"} aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Pratinjau</Button>
            <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Edit</Button>
          </>
        ) : <Button size="sm" leftIcon="git-fork" onClick={onFork}>Fork ke global hanoman / project</Button>}
      </div>
      {fm && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-200)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>name: {fm.name ?? "—"}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{fm.description ?? "—"}</div>
          {fm.error && <Badge tone="err" size="sm">{fm.error}</Badge>}
        </div>
      )}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: mode === "edit" ? 0 : 16 }}>
        {loadError !== null ? <StateBlock kind="error" compact title="Gagal memuat berkas" hint={loadError} action={load} actionLabel="Coba lagi" />
          : !file ? <StateBlock kind="loading" compact title="Memuat berkas…" />
          : file.binary || file.tooLarge ? <StateBlock kind="empty" compact icon="file" title={file.binary ? "Berkas biner" : "Berkas terlalu besar"} hint={`${file.size} B`} />
          : mode === "edit" ? (
            <textarea aria-label="Isi berkas" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} placeholder="mis. # Langkah deploy"
              style={{ width: "100%", height: "100%", minHeight: 320, border: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: 13, background: "transparent", resize: "none" }} />
          ) : isMarkdownPath(path) ? <MarkdownView text={path === "SKILL.md" ? stripFrontmatter(draft) : draft} name={path} />
          : <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre-wrap" }}>{draft}</pre>}
      </div>
      {skill.editable && (mode === "edit" || dirty || conflict) && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: 8, borderTop: "1px solid var(--border-hair)" }}>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty || saving}>Simpan</Button>
          {dirty && <span style={{ fontSize: 12, color: "var(--brass-700)" }}>belum disimpan</span>}
          {conflict && (
            <span role="alert" style={{ fontSize: 12, color: "var(--clay-600)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {conflict}
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void reload()}>Muat ulang</Button>
              <Button size="sm" variant="ghost" disabled={saving || !dirty} onClick={() => void overwrite()}>Timpa</Button>
            </span>
          )}
        </div>
      )}
      {dialog}
    </Card>
  );
}
