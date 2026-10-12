import React from "react";
import { Modal, Select, Button } from "../ds";
import { api } from "../api/client";

// SPEC-175/230 · dialog target rebase/merge. Dipakai backlog (branch spec `hanoman/<id>`) &
// terminal (branch sesi, mis. PRD `prd/<slug>`). Target = branch lokal ("local:<b>") atau origin
// ("origin:<b>"); branch sendiri (ownBranch) dikecualikan.
export function IntegrateDialog({ projectId, ownBranch, eyebrow, onClose, onIntegrate }: {
  projectId: string; ownBranch: string; eyebrow: string;
  onClose: () => void;
  onIntegrate: (op: "merge" | "rebase", target: string) => void | Promise<void>;
}) {
  const [targets, setTargets] = React.useState<{ local: string[]; origin: string[] }>({ local: [], origin: [] });
  const [target, setTarget] = React.useState("");
  const own = ownBranch;
  React.useEffect(() => {
    let alive = true;
    api.listBranches(projectId)
      .then((r) => { if (alive) setTargets({ local: r.branches.filter((b) => b !== own), origin: r.remotes.filter((b) => b !== own) }); })
      .catch(() => { if (alive) setTargets({ local: [], origin: [] }); });
    return () => { alive = false; };
  }, [projectId, own]);

  const options = [
    { value: "", label: "Pilih target…" },
    ...targets.local.map((b) => ({ value: `local:${b}`, label: `${b} (lokal)` })),
    ...targets.origin.map((b) => ({ value: `origin:${b}`, label: `origin/${b}` })),
  ];
  const go = (op: "merge" | "rebase") => { if (target) void onIntegrate(op, target); };

  return (
    <Modal open title="Rebase / Merge" eyebrow={`${eyebrow} · ${own}`} icon="git-merge" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Rebase menata ulang branch di atas target (force-push balik ke branch itu). Merge
        menggabungkan branch ke target. Bila ada konflik, sesi agen membereskannya di Terminal —
        agen, model & effort-nya diatur di <b>Settings → Model sesi → Konflik rebase &amp; merge</b>
        {" "}— selama kartu itu dinonaktifkan, ia mengikuti default global.
      </div>
      <div style={{ marginBottom: 16 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Target</div>
        <Select size="sm" aria-label="Target" value={target} disabled={options.length === 1}
          onChange={(e) => setTarget(e.target.value)} options={options} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" leftIcon="git-branch" disabled={!target} onClick={() => go("rebase")}>Rebase</Button>
        <Button size="sm" variant="primary" leftIcon="git-merge" disabled={!target} onClick={() => go("merge")}>Merge</Button>
      </div>
    </Modal>
  );
}
