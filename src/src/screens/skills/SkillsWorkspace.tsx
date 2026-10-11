// src/src/screens/skills/SkillsWorkspace.tsx
// Skills library (desain 2026-09-26) · satu komponen untuk /skills (semua grup) dan
// /skills/<projectId> (global warisan + skill project itu). Pola CustomAgentsPanel.
import React from "react";
import type { SkillEntry, SkillLibraryView, SkillTreeView } from "@hanoman/shared";
import { Button, Card, Field, Input, Modal, ResponsivePanels, Select, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { SkillsList } from "./SkillsList";
import { SkillFileEditor, SkillStructure, skillFailure } from "./SkillEditor";

type NewSkill = { layer: "hanoman" | "user" | "project"; source: string; name: string; description: string };

export function SkillsWorkspace({ projectId, projectName, onToast }:
  { projectId?: string; projectName?: string; onToast?: (m: string) => void }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [library, setLibrary] = React.useState<SkillLibraryView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [skill, setSkill] = React.useState<SkillEntry | null>(null);
  const [tree, setTree] = React.useState<SkillTreeView | null>(null);
  const [path, setPath] = React.useState("SKILL.md");
  const [panel, setPanel] = React.useState<"list" | "detail">("list");
  const [creating, setCreating] = React.useState<NewSkill | null>(null);
  const dirtyRef = React.useRef(false);
  const onDirtyChange = React.useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);

  const reload = React.useCallback(async () => {
    setError(null);
    try {
      if (!projectId) { setLibrary(await api.listAllSkills()); return; }
      const rows = await api.listSkills(projectId);
      const project = rows.filter((s) => s.layer === "project");
      setLibrary({ global: rows.filter((s) => s.layer !== "project"), projects: [{ projectId, name: projectName ?? "Project ini", skills: project }] });
    } catch (e) { setError(skillFailure("memuat skill", e)); }
  }, [api, projectId, projectName]);
  React.useEffect(() => { void reload(); }, [reload]);

  const loadTree = React.useCallback((s: SkillEntry) => {
    setTree(null);
    api.skillTree(s.key).then(setTree).catch(() => setTree({ files: [], dirs: [] }));
  }, [api]);
  // Pindah skill/berkas memuat ulang editor dan membuang draft; draft kotor tak boleh hilang diam-diam.
  const discardOk = async () => !dirtyRef.current || confirm({
    title: "Buang perubahan?", eyebrow: skill?.name, tone: "danger", confirmLabel: "Buang perubahan", cancelLabel: "Tetap mengedit",
    message: "Berkas yang sedang diedit punya perubahan yang belum disimpan.",
    impact: ["Perubahan yang belum disimpan hilang."],
  });
  const select = async (s: SkillEntry) => {
    if (!(await discardOk())) return;
    setSkill(s); setPath("SKILL.md"); loadTree(s); setPanel("detail");
  };
  const selectPath = async (p: string) => { if (p !== path && await discardOk()) setPath(p); };

  const fork = async () => {
    if (!skill) return;
    try {
      const made = await api.forkSkill(skill.key, projectId ? { layer: "project", projectId } : { layer: "hanoman" });
      onToast?.(`Di-fork ke ${made.layer === "project" ? "project" : "global hanoman"}`);
      await reload(); await select(made);
    } catch (e) { onToast?.(skillFailure("mem-fork skill", e)); }
  };
  const remove = async () => {
    if (!skill || !(await confirm({
      title: `Hapus skill ${skill.name}?`, message: skill.dir, tone: "danger", confirmLabel: "Hapus skill",
      impact: ["Seluruh berkas di folder skill ini dihapus.", "Sesi yang memuat skill ini kehilangan akses ke sana."],
    }))) return;
    try { await api.deleteSkill(skill.key); dirtyRef.current = false; setSkill(null); setPanel("list"); await reload(); }
    catch (e) { onToast?.(skillFailure("menghapus skill", e)); }
  };
  const create = async () => {
    if (!creating) return;
    try {
      const made = await api.createSkill({ ...creating, ...(creating.layer === "project" ? { projectId } : {}), source: creating.layer === "hanoman" ? undefined : creating.source });
      setCreating(null); await reload(); await select(made);
    } catch (e) { onToast?.(skillFailure("membuat skill", e)); }
  };

  if (error !== null) return <StateBlock kind="error" title="Gagal memuat skill" hint={error} action={() => void reload()} actionLabel="Coba lagi" />;
  if (!library) return <StateBlock kind="loading" title="Memuat skill…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 0", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {skill?.editable && <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={remove}>Hapus skill</Button>}
        <Button size="sm" leftIcon="plus" onClick={() => setCreating({ layer: projectId ? "project" : "hanoman", source: ".claude", name: "", description: "" })}>Skill baru</Button>
      </div>
      {/* Dua panel (daftar | detail): ResponsivePanels dirancang master-detail. Di dalam detail,
          struktur dan editor berdampingan dan membungkus ke bawah di layar sempit. */}
      <ResponsivePanels ariaLabel="Skills" active={panel} onActiveChange={(n) => setPanel(n as typeof panel)} masterWidth={320}
        panels={[
          { id: "list", label: "Skill", className: "hn-panel-flex", content: (
            <Card padding={0} fill><SkillsList library={library} selected={skill?.key} onSelect={(s) => void select(s)} projectFirst={!!projectId} /></Card>
          ) },
          { id: "detail", label: skill ? skill.name : "Detail", className: "hn-panel-flex", content: skill ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, flex: "1 1 auto", minHeight: 0, alignItems: "stretch" }}>
              <div style={{ flex: "0 1 260px", minWidth: 220, minHeight: 220, display: "flex" }}>
                <SkillStructure skill={skill} tree={tree} selected={path} onSelect={(p) => void selectPath(p)} onChanged={() => loadTree(skill)} />
              </div>
              <div style={{ flex: "1 1 420px", minWidth: 0, minHeight: 320, display: "flex" }}>
                <SkillFileEditor skill={skill} path={path} onFork={fork} onToast={onToast} onDirtyChange={onDirtyChange} />
              </div>
            </div>
          ) : <StateBlock kind="empty" compact icon="file-text" title="Pilih skill untuk melihat struktur & isinya" /> },
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
            <Field label="Nama" hint="kebab-case, maks 64"><Input value={creating.name} placeholder="mis. deploy-staging" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreating({ ...creating, name: e.target.value })} mono /></Field>
            <Field label="Deskripsi" hint="diawali kapan skill dipakai, mis. “Use when …”"><Input value={creating.description} placeholder="mis. Use when deploying to staging" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreating({ ...creating, description: e.target.value })} /></Field>
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}
