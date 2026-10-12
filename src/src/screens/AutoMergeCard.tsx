import React from "react";
import { Card, Badge, Button, Select, Checkbox } from "../ds";
import { AUTO_MERGE_OFF, autoMergeSummary, type AutoMerge } from "@hanoman/shared";
import { api } from "../api/client";
import type { ProjectVM } from "./types";
import "./styles/auto-merge.css";

// SPEC-486 · ADR-0103 · permukaan kebijakan auto-merge per project. Duduk di Settings project
// (layar yang sama dengan Help Center & Custom agent), bukan di Settings global: kebijakan ini
// milik satu repo, dan branch tujuannya cuma bermakna di sana.
const MODE_OPTS = [
  { value: "off", label: "Tanpa auto-merge (default)" },
  { value: "default-branch", label: "Auto-merge ke default branch repo" },
  { value: "branch", label: "Auto-merge ke branch tujuan…" },
];
const DEST_OPTS = [
  { value: "local", label: "Branch lokal (perbarui ref di checkout ini)" },
  { value: "origin", label: "Origin (push ke remote)" },
];

export function AutoMergeCard({ p, onToast, onProjectChanged }: {
  p: ProjectVM;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onProjectChanged?: (id: string) => void | Promise<void>;
}) {
  const stored = (p as { autoMerge?: AutoMerge | null }).autoMerge ?? null;
  const [form, setForm] = React.useState<AutoMerge>(stored ?? AUTO_MERGE_OFF);
  const [branches, setBranches] = React.useState<{ local: string[]; origin: string[]; def: string | null }>(
    { local: [], origin: [], def: null });
  const [busy, setBusy] = React.useState(false);
  // Path EFEKTIF: binding per-mesin menang atas Project.repoDir (SPEC-217).
  const repoDir = p.binding ?? p.repoDir ?? null;

  React.useEffect(() => { setForm(stored ?? AUTO_MERGE_OFF); }, [stored]);
  React.useEffect(() => {
    let alive = true;
    api.listBranches(p.id)
      .then((r) => { if (alive) setBranches({ local: r.branches, origin: r.remotes, def: r.defaultBranch ?? null }); })
      .catch(() => { if (alive) setBranches({ local: [], origin: [], def: null }); });
    return () => { alive = false; };
  }, [p.id]);

  const pick = branches[form.dest === "origin" ? "origin" : "local"];
  const set = <K extends keyof AutoMerge>(k: K) => (v: AutoMerge[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      // mode "off" dikirim sebagai null: satu bentuk "tak ada kebijakan" di DB, bukan dua.
      await api.updateProject(p.id, { autoMerge: form.mode === "off" ? null : form });
      onToast("Kebijakan auto-merge disimpan", "ok", "git-merge");
      await onProjectChanged?.(p.id);
    } catch (e) {
      onToast(`Gagal menyimpan: ${(e as Error).message}`, "err", "x-circle");
    } finally { setBusy(false); }
  }

  return (
    <Card eyebrow="integrasi" title="Auto-merge saat sesi selesai"
      actions={<Button size="sm" leftIcon="check" disabled={busy || !repoDir} onClick={save}>Simpan</Button>}>
      <div className="hn-am-intro">
        Saat sebuah backlog item mencapai <b>Selesai</b>, hanoman menggabungkan branch kerjanya
        (<code>hanoman/&lt;spec&gt;</code>) ke branch tujuan. Merge saja — tak pernah rebase, tak pernah
        force-push. Konflik tidak menghapus apa pun: branch kerja tetap utuh dan kamu dapat notifikasi
        berisi alasannya. Item bisa menimpa setelan ini satu per satu dari Backlog.
      </div>
      {!repoDir && (
        <div className="hn-am-warn">
          Project ini belum di-bind ke checkout lokal — atur <b>repoDir</b> dulu (Edit project) sebelum
          menyalakan auto-merge.
        </div>
      )}
      <div className="hn-am-row">
        <Badge tone={stored && stored.mode !== "off" ? "ok" : "neutral"} size="sm">
          {autoMergeSummary(stored ?? AUTO_MERGE_OFF)}
        </Badge>
      </div>
      <div className="hn-am-grid">
        <div>
          <div className="hn-eyebrow hn-am-label">Mode</div>
          <Select size="sm" aria-label="Mode auto-merge" value={form.mode} disabled={!repoDir}
            onChange={(e) => set("mode")(e.target.value as AutoMerge["mode"])} options={MODE_OPTS} />
        </div>
        {form.mode !== "off" && (
          <div>
            <div className="hn-eyebrow hn-am-label">Tujuan</div>
            <Select size="sm" aria-label="Tujuan" value={form.dest} disabled={!repoDir}
              onChange={(e) => set("dest")(e.target.value as AutoMerge["dest"])} options={DEST_OPTS} />
          </div>
        )}
        {form.mode === "default-branch" && (
          <div className="hn-am-note">
            Default branch repo saat ini: <b>{branches.def ?? "— tak terbaca"}</b>. Diresolve ulang tiap
            kali auto-merge berjalan, jadi mengganti default branch repo berlaku di run berikutnya.
          </div>
        )}
        {form.mode === "branch" && (
          <div>
            <div className="hn-eyebrow hn-am-label">Branch tujuan</div>
            <Select size="sm" aria-label="Branch tujuan" value={form.branch ?? ""} disabled={!repoDir || !pick.length}
              onChange={(e) => set("branch")(e.target.value || null)}
              options={[{ value: "", label: "Pilih branch…" }, ...pick.map((b) => ({ value: b, label: b }))]} />
          </div>
        )}
        {form.mode !== "off" && (
          <Checkbox aria-label="Hapus branch kerja setelah merge sukses" checked={form.deleteBranch}
            label="Hapus branch kerja setelah merge sukses"
            onChange={() => set("deleteBranch")(!form.deleteBranch)} />
        )}
      </div>
    </Card>
  );
}
