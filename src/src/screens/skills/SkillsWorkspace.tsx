// src/src/screens/skills/SkillsWorkspace.tsx
// Skills library (desain 2026-09-26) · satu komponen untuk /skills (semua grup) dan
// /skills/<projectId> (global warisan + skill project itu). Pola CustomAgentsPanel.
import React from "react";
import type { SkillEntry, SkillLibraryView, SkillTreeView } from "@hanoman/shared";
import { Button, Field, Input, Modal, ResponsivePanels, Select, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { SkillsList } from "./SkillsList";
import { SkillFileEditor, SkillStructure, errMessage } from "./SkillEditor";

type NewSkill = { layer: "hanoman" | "user" | "project"; source: string; name: string; description: string };

export function SkillsWorkspace({ projectId, projectName, onToast }:
  { projectId?: string; projectName?: string; onToast?: (m: string) => void }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [library, setLibrary] = React.useState<SkillLibraryView | null>(null);
  const [error, setError] = React.useState(false);
  const [skill, setSkill] = React.useState<SkillEntry | null>(null);
  const [tree, setTree] = React.useState<SkillTreeView | null>(null);
  const [path, setPath] = React.useState("SKILL.md");
  const [panel, setPanel] = React.useState<"list" | "tree" | "editor">("list");
  const [creating, setCreating] = React.useState<NewSkill | null>(null);

  const reload = React.useCallback(async () => {
    setError(false);
    try {
      if (!projectId) { setLibrary(await api.listAllSkills()); return; }
      const rows = await api.listSkills(projectId);
      const project = rows.filter((s) => s.layer === "project");
      setLibrary({ global: rows.filter((s) => s.layer !== "project"), projects: [{ projectId, name: projectName ?? "Project ini", skills: project }] });
    } catch { setError(true); }
  }, [api, projectId, projectName]);
  React.useEffect(() => { void reload(); }, [reload]);

  const loadTree = React.useCallback((s: SkillEntry) => {
    setTree(null);
    api.skillTree(s.key).then(setTree).catch(() => setTree({ files: [], dirs: [] }));
  }, [api]);
  const select = (s: SkillEntry) => { setSkill(s); setPath("SKILL.md"); loadTree(s); setPanel("tree"); };

  const fork = async () => {
    if (!skill) return;
    try {
      const made = await api.forkSkill(skill.key, projectId ? { layer: "project", projectId } : { layer: "hanoman" });
      onToast?.(`Di-fork ke ${made.layer === "project" ? "project" : "global hanoman"}`);
      await reload(); select(made);
    } catch (e) { onToast?.(errMessage(e)); }
  };
  const remove = async () => {
    if (!skill || !(await confirm({ title: `Hapus skill ${skill.name}?`, message: skill.dir, tone: "danger", confirmLabel: "Hapus" }))) return;
    try { await api.deleteSkill(skill.key); setSkill(null); setPanel("list"); await reload(); }
    catch (e) { onToast?.(errMessage(e)); }
  };
  const create = async () => {
    if (!creating) return;
    try {
      const made = await api.createSkill({ ...creating, ...(creating.layer === "project" ? { projectId } : {}), source: creating.layer === "hanoman" ? undefined : creating.source });
      setCreating(null); await reload(); select(made);
    } catch (e) { onToast?.(errMessage(e)); }
  };

  if (error) return <StateBlock kind="error" title="Gagal memuat skill" action={() => void reload()} actionLabel="Coba lagi" />;
  if (!library) return <StateBlock kind="loading" title="Memuat skill…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 0", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {skill?.editable && <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={remove}>Hapus skill</Button>}
        <Button size="sm" leftIcon="plus" onClick={() => setCreating({ layer: projectId ? "project" : "hanoman", source: ".claude", name: "", description: "" })}>Skill baru</Button>
      </div>
      <ResponsivePanels ariaLabel="Skills" active={panel} onActiveChange={(n) => setPanel(n as typeof panel)} masterWidth={300}
        panels={[
          { id: "list", label: "Skill", className: "hn-panel-flex", content: <SkillsList library={library} selected={skill?.key} onSelect={select} /> },
          { id: "tree", label: "Struktur", className: "hn-panel-flex", content: skill
              ? <SkillStructure skill={skill} tree={tree} selected={path} onSelect={(p) => { setPath(p); setPanel("editor"); }} onChanged={() => loadTree(skill)} onToast={onToast} />
              : <StateBlock kind="empty" compact icon="folder-tree" title="Pilih skill" /> },
          { id: "editor", label: "Editor", className: "hn-panel-flex", content: skill
              ? <SkillFileEditor skill={skill} path={path} onFork={fork} onToast={onToast} />
              : <StateBlock kind="empty" compact icon="file-text" title="Pilih skill untuk melihat isinya" /> },
        ]} />
      <Modal open={!!creating} title="Skill baru" onClose={() => setCreating(null)}
        footer={<Button onClick={create} disabled={!creating?.name || !creating?.description}>Buat</Button>}>
        {creating && (
          <>
            <Field label="Lapis">
              <Select aria-label="Lapis" value={creating.layer}
                onChange={(e) => setCreating({ ...creating, layer: e.target.value as NewSkill["layer"] })}
                options={[
                  { value: "hanoman", label: "Global hanoman (disuntik ke semua sesi)" },
                  { value: "user", label: "User (~/.claude, ~/.codex, ~/.agents)" },
                  ...(projectId ? [{ value: "project", label: "Project ini" }] : []),
                ]} />
            </Field>
            {creating.layer !== "hanoman" && (
              <Field label="Sumber">
                <Select aria-label="Sumber" value={creating.source}
                  onChange={(e) => setCreating({ ...creating, source: e.target.value })}
                  options={[
                    { value: ".claude", label: ".claude (claude)" },
                    { value: ".agents", label: ".agents (codex)" },
                    { value: ".codex", label: ".codex (codex)" },
                  ]} />
              </Field>
            )}
            <Field label="Nama" hint="kebab-case, maks 64"><Input value={creating.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreating({ ...creating, name: e.target.value })} mono /></Field>
            <Field label="Deskripsi" hint="diawali kapan skill dipakai, mis. “Use when …”"><Input value={creating.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreating({ ...creating, description: e.target.value })} /></Field>
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}
