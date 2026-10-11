// src/src/screens/skills/SkillsWorkspace.tsx
// Skills library (desain 2026-09-26) · satu komponen untuk /skills (semua grup) dan
// /skills/<projectId> (global warisan + skill project itu).
// Redesign 3K: dua tab "Skill" dan "Agen". Tab Skill = master-detail: kiri daftar ringkas, kanan
// editor dengan footer Simpan sticky dan konfirmasi saat pindah item. Tab Agen memuat katalog
// custom agent (CustomAgentsPanel). Hapus skill pindah ke ⋯ di kepala detail.
import React from "react";
import type { SkillEntry, SkillLibraryView, SkillTreeView } from "@hanoman/shared";
import { Button, Field, Input, Modal, OverflowActions, ResponsivePanels, Select, StateBlock, Tabs, TabPanel, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { CustomAgentsPanel } from "../CustomAgentsPanel";
import { SkillsList } from "./SkillsList";
import { SkillFileEditor, SkillStructure, skillFailure } from "./SkillEditor";
import "../styles/skills.css";

type NewSkill = { layer: "hanoman" | "user" | "project"; source: string; name: string; description: string };
type Tab = "skill" | "agent";

export function SkillsWorkspace({ projectId, projectName, onToast }:
  { projectId?: string; projectName?: string; onToast?: (m: string) => void }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [tab, setTab] = React.useState<Tab>("skill");
  // Katalog agen dimuat saat tab Agen pertama kali dibuka, bukan saat halaman Skills dibuka.
  const [agentVisited, setAgentVisited] = React.useState(false);
  const [library, setLibrary] = React.useState<SkillLibraryView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [skill, setSkill] = React.useState<SkillEntry | null>(null);
  const [tree, setTree] = React.useState<SkillTreeView | null>(null);
  const [treeError, setTreeError] = React.useState(false);
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
    setTree(null); setTreeError(false);
    api.skillTree(s.key).then(setTree).catch(() => { setTreeError(true); setTree({ files: [], dirs: [] }); });
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

  const skillBody = (() => {
    if (error !== null) return <StateBlock kind="error" title="Gagal memuat skill" hint={error} action={() => void reload()} actionLabel="Coba lagi" />;
    if (!library) return <StateBlock kind="loading" title="Memuat skill…" />;
    return (
      /* Master-detail: ResponsivePanels menampilkan daftar | detail; di layar lebar keduanya berdampingan. */
      <ResponsivePanels ariaLabel="Skills" active={panel} onActiveChange={(n) => setPanel(n as typeof panel)} masterWidth={320}
        panels={[
          { id: "list", label: "Daftar", className: "hn-panel-flex", content: (
            <div className="hn-skill-master">
              <SkillsList library={library} selected={skill?.key} onSelect={(s) => void select(s)} projectFirst={!!projectId} />
              <div className="hn-skill-master-foot">
                <Button size="sm" leftIcon="plus" onClick={() => setCreating({ layer: projectId ? "project" : "hanoman", source: ".claude", name: "", description: "" })}>
                  Skill baru
                </Button>
              </div>
            </div>
          ) },
          { id: "detail", label: skill ? skill.name : "Detail", className: "hn-panel-flex", content: skill ? (
            <div className="hn-skill-detail">
              <div className="hn-skill-detail-head">
                <div className="hn-skill-detail-text">
                  <span className="hn-skill-detail-name">{skill.name}</span>
                  {skill.description && <span className="hn-skill-detail-desc">{skill.description}</span>}
                </div>
                {skill.editable && (
                  <OverflowActions label="Aksi untuk skill" icon="ellipsis" items={[
                    { key: "delete", label: "Hapus skill…", icon: "trash-2", tone: "danger", onSelect: () => void remove() },
                  ]} />
                )}
              </div>
              {treeError && <div role="alert" className="hn-skill-list-error">Struktur berkas gagal dimuat.</div>}
              <div className="hn-skill-detail-body">
                <div className="hn-skill-detail-structure">
                  <SkillStructure skill={skill} tree={tree} selected={path} onSelect={(p) => void selectPath(p)} onChanged={() => loadTree(skill)} />
                </div>
                <div className="hn-skill-detail-editor">
                  <SkillFileEditor skill={skill} path={path} onFork={fork} onToast={onToast} onDirtyChange={onDirtyChange} />
                </div>
              </div>
            </div>
          ) : <StateBlock kind="empty" compact icon="file-text" title="Pilih skill untuk melihat struktur & isinya" /> },
        ]} />
    );
  })();

  return (
    <div className="hn-skills-workspace">
      <Tabs variant="underline" value={tab} onChange={(v) => { setTab(v as Tab); if (v === "agent") setAgentVisited(true); }} tabs={[
        { value: "skill", label: "Skill" },
        { value: "agent", label: "Agen" },
      ]}>
        <TabPanel value="skill">{skillBody}</TabPanel>
        <TabPanel value="agent">
          {agentVisited && <CustomAgentsPanel projectId={projectId ?? null} onToast={onToast} />}
        </TabPanel>
      </Tabs>
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
