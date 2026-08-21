/* MissingRepoCard — project yang belum punya checkout di MESIN INI (SPEC-867). `Project.repoDir`
   tak pernah disync (services/sync.ts) dan `LocalBinding` LOCAL-only (ADR-0043), jadi project yang
   datang lewat sync — dan project yang clone-nya gagal saat dibuat — mendarat dengan keduanya null.
   Kartunya perlu ada karena layar ini justru makin bisu saat itu terjadi: pintu "Reverse docs" dan
   "Scaffold docs" digerbangi path efektif di App.tsx, jadi keduanya HILANG tanpa satu pun alasan.
   Cloningnya lewat POST /projects/:id/clone yang sudah ada — endpoint itu pula yang menulis
   binding-nya, klien tak menulisnya lagi. */
import React from "react";
import { Callout, Button, Modal, Field, Input, useConfirm } from "../ds";
import { api } from "../api/client";
import { FolderPicker } from "./FolderPicker";
import { cloneErrorText, cloneTargetInto, repoBasename } from "./git-remote";
import type { ProjectVM } from "./types";

type Toast = (msg: string, kind?: string, icon?: string) => void;

function CloneRepoModal({ open, p, onClose, onDone, onToast }:
  { open: boolean; p: ProjectVM; onClose: () => void;
    onDone: () => void | Promise<void>; onToast: Toast }) {
  const remote = p.gitRemote ?? "";
  const [dir, setDir] = React.useState("");
  // Induk disimpan terpisah dari target: `start` picker harus folder yang ADA, sementara target
  // justru folder yang belum ada — memberi picker nilai target berarti GET /fs/browse 400.
  const [parent, setParent] = React.useState("");
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ error: string; stderr: string } | null>(null);
  // SPEC-847 · ADR-0127 · clone menulis ke disk mesin ini, jadi ia dinamai lebih dulu.
  const { confirm, dialog } = useConfirm();
  React.useEffect(() => {
    if (open) { setDir(""); setParent(""); setErr(null); setBusy(false); }
  }, [open]);

  async function run() {
    const target = dir.trim();
    if (!target || busy) return;
    setBusy(true); setErr(null);
    try {
      // `run` menahan dialog tetap terbuka & busy selama git clone berjalan — itu pula yang
      // menutup submit kedua, dan lemparannya diteruskan ke catch di bawah apa adanya.
      if (!await confirm({
        title: "Jalankan git clone di mesin ini?",
        message: <>Folder tujuan <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{target}</code>.</>,
        impact: [
          <>Isi <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{remote}</code> diunduh
            ke disk mesin ini — repo besar berarti unduhan besar.</>,
          // Jawaban atas kekhawatiran "menimpa folder tak kosong": git yang menolaknya, bukan kita.
          <>Folder yang sudah berisi <b>ditolak git</b>, jadi tak ada berkas yang tertimpa.</>,
          "Sesudah berhasil, project ini menunjuk hasil clone (binding lokal, tak disync).",
        ],
        confirmLabel: "Jalankan git clone",
        tone: "default",
        icon: "git-branch",
        run: () => api.cloneProject(p.id, target),
      })) return;
      await onDone();
      onToast(`Repo ${p.id} di-clone ke ${target}`, "ok", "git-branch");
      onClose();
    } catch (e) {
      // Kegagalan tinggal DI DALAM modal: stderr git adalah satu-satunya keterangan yang berguna
      // di sini, dan toast yang lewat tak bisa dibaca ulang saat operator memperbaiki path-nya.
      setErr(cloneErrorText(e));
    } finally { setBusy(false); }
  }

  return (
    <>
    <Modal open={open} onClose={onClose} icon="git-branch" eyebrow={p.id} title="Clone dari git remote"
      footer={<>
        {/* "Tutup", bukan "Batal": yang membatalkan clone adalah dialog konfirmasinya. */}
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Tutup</Button>
        <Button size="sm" leftIcon="git-branch" onClick={() => { void run(); }} disabled={!dir.trim() || busy}>
          {busy ? "Meng-clone…" : err ? "Coba lagi" : "Clone"}
        </Button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
        Menjalankan <code style={{ fontFamily: "var(--font-mono)" }}>git clone</code> dari{" "}
        <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{remote}</code> di
        mesin ini, lalu menunjuk project ke hasilnya. Gagal clone tak menyentuh project.
      </div>
      <Field label="Folder tujuan clone"
        hint="mesin ini · harus belum ada atau kosong — git clone menolak folder berisi">
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={dir} onChange={(e: React.ChangeEvent<any>) => setDir(e.target.value)}
            leftIcon="folder" mono placeholder={`/path/ke/${repoBasename(remote)}`}
            style={{ flex: 1, minWidth: 0 }} />
          <Button size="sm" variant="secondary" leftIcon="folder-open"
            onClick={() => setPicker(true)}>Pilih folder</Button>
        </div>
      </Field>
      <FolderPicker open={picker} onClose={() => setPicker(false)} start={parent}
        onPick={(pick) => { setParent(pick); setDir(cloneTargetInto(pick, remote)); }} />
      {err && (
        <Callout tone="err" title={err.error} style={{ marginTop: 4 }}>
          Project tak tersentuh — perbaiki penyebabnya lalu coba lagi.
          {err.stderr && (
            <pre style={{ marginTop: 8, marginBottom: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
              fontFamily: "var(--font-mono)", fontSize: 12, maxHeight: 160, overflow: "auto" }}>{err.stderr}</pre>
          )}
        </Callout>
      )}
    </Modal>
    {/* Di LUAR <Modal> di atas: dialog konfirmasi punya focus trap & entri modalStack sendiri
        (ds/kit.tsx), dan yang terakhir di DOM-lah yang tampil paling atas. */}
    {dialog}
    </>
  );
}

export function MissingRepoCard({ p, onEdit, onToast, onProjectChanged }:
  { p: ProjectVM; onEdit: () => void; onToast: Toast;
    onProjectChanged?: (id: string) => void | Promise<void> }) {
  const [picker, setPicker] = React.useState(false);
  const [cloning, setCloning] = React.useState(false);
  // Predikat yang SAMA dengan gerbang pintu Reverse/Scaffold di App.tsx — kartu ini muncul tepat
  // saat dua pintu itu menghilang, tak pernah bersamaan dengan keduanya.
  if (p.binding ?? p.repoDir) return null;
  const remote = p.gitRemote ?? "";

  async function bind(repoDir: string) {
    try {
      await api.putBinding(p.id, repoDir);
      await onProjectChanged?.(p.id);
      onToast(`Project ${p.id} menunjuk ${repoDir}`, "ok", "folder");
    } catch { onToast("Gagal menyimpan path project", "err", "x-circle"); }
  }

  return (
    <>
      <Callout tone="warn" icon="folder-git-2" title="Belum ada checkout di mesin ini"
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {remote
              ? <Button size="sm" leftIcon="git-branch" onClick={() => setCloning(true)}>Clone dari git remote</Button>
              : <Button size="sm" leftIcon="pencil" onClick={onEdit}>Isi git remote</Button>}
            <Button size="sm" variant="secondary" leftIcon="folder-open"
              onClick={() => setPicker(true)}>Pilih folder di device</Button>
          </div>
        }>
        {remote
          ? <>Docs, terminal, dan sesi project ini butuh checkout lokal. Clone{" "}
              <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{remote}</code>{" "}
              ke mesin ini, atau tunjuk folder yang sudah kamu clone sendiri.</>
          : <>Project ini juga belum punya git remote, jadi clone tak mungkin dilakukan. Isi git
              remote-nya dulu lewat Edit project, atau tunjuk folder yang sudah ada di device ini.</>}
      </Callout>
      <FolderPicker open={picker} onClose={() => setPicker(false)} onPick={(dir) => { void bind(dir); }} />
      {remote && (
        <CloneRepoModal open={cloning} p={p} onClose={() => setCloning(false)} onToast={onToast}
          onDone={async () => { await onProjectChanged?.(p.id); }} />
      )}
    </>
  );
}
