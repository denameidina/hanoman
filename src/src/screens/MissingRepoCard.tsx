/* MissingRepoCard — project yang belum punya checkout di MESIN INI (SPEC-867). `Project.repoDir`
   tak pernah disync (services/sync.ts) dan `LocalBinding` LOCAL-only (ADR-0043), jadi project yang
   datang lewat sync — dan project yang clone-nya gagal saat dibuat — mendarat dengan keduanya null.
   Kartunya perlu ada karena layar ini justru makin bisu saat itu terjadi: pintu "Reverse docs" dan
   "Scaffold docs" digerbangi path efektif di App.tsx, jadi keduanya HILANG tanpa satu pun alasan.
   Cloningnya lewat POST /projects/:id/clone yang sudah ada — endpoint itu pula yang menulis
   binding-nya, klien tak menulisnya lagi.

   Audit 2026-10: clone hanya dikonfirmasi SATU kali — tombol "Clone" di modal, dengan dampaknya
   ditulis di badan modal. Dialog konfirmasi kedua dihapus: clone tak menimpa apa pun (git menolak
   folder yang sudah berisi), jadi tak ada alasan destruktif untuk dialog tambahan.
   Redesign 3P: banner memakai kelas (tanpa inline style); modal clone terkunci lewat `dismissible`. */
import React from "react";
import { Callout, Button, Modal, Input } from "../ds";
import { api } from "../api/client";
import { FolderPicker } from "./FolderPicker";
import { cloneErrorText, cloneTargetInto, repoBasename } from "./git-remote";
import type { ProjectVM } from "./types";
import { failureMessage } from "../lib/report-error";
import "./styles/projects.css";

type Toast = (msg: string, kind?: string, icon?: string) => void;

function CloneRepoModal({ open, p, onClose, onDone, onToast }:
  { open: boolean; p: ProjectVM; onClose: () => void;
    onDone: () => void | Promise<void>; onToast: Toast }) {
  const remote = p.gitRemote ?? "";
  const dirId = React.useId();
  const [dir, setDir] = React.useState("");
  // Induk disimpan terpisah dari target: `start` picker harus folder yang ADA, sementara target
  // justru folder yang belum ada — memberi picker nilai target berarti GET /fs/browse 400.
  const [parent, setParent] = React.useState("");
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<{ error: string; stderr: string } | null>(null);
  React.useEffect(() => {
    if (open) { setDir(""); setParent(""); setErr(null); setBusy(false); }
  }, [open]);

  // Satu-satunya konfirmasi: tombol "Clone". `busy` mengunci submit kedua, tutup, dan Escape
  // selama git clone berjalan.
  async function run() {
    const target = dir.trim();
    if (!target || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.cloneProject(p.id, target);
      await onDone();
      onToast(`Repo ${p.id} di-clone ke ${target}`, "ok", "git-branch");
      setBusy(false);
      onClose();
    } catch (e) {
      // Kegagalan tinggal DI DALAM modal: stderr git adalah satu-satunya keterangan yang berguna.
      setErr(cloneErrorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} dismissible={!busy} icon="git-branch" eyebrow={p.id} title="Clone dari git remote"
      footer={<>
        {/* "Tutup", bukan "Batal": clone sudah dimulai begitu tombol Clone ditekan. */}
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Tutup</Button>
        <Button size="sm" leftIcon="git-branch" onClick={() => { void run(); }} disabled={!dir.trim() || busy}>
          {busy ? "Meng-clone…" : err ? "Coba lagi" : "Clone"}
        </Button>
      </>}>
      <p className="hn-prj-note">
        Menjalankan <code className="hn-prj-mono">git clone</code> dari{" "}
        <code className="hn-prj-mono hn-prj-wrap">{remote}</code> di mesin ini, lalu menunjuk project ke hasilnya.
        Gagal clone tak menyentuh project.
      </p>
      <div className="hn-prj-field">
        <label htmlFor={dirId} className="hn-prj-field-label">Folder tujuan clone</label>
        <div className="hn-prj-inline">
          <Input id={dirId} value={dir} onChange={(e: React.ChangeEvent<any>) => setDir(e.target.value)}
            leftIcon="folder" mono placeholder={`/path/ke/${repoBasename(remote)}`} className="hn-prj-grow" />
          <Button size="md" variant="secondary" leftIcon="folder-open"
            onClick={() => setPicker(true)}>Pilih folder</Button>
        </div>
        <div className="hn-prj-hint">
          Harus belum ada atau kosong — git menolak folder yang sudah berisi.
        </div>
      </div>
      <ul className="hn-prj-list-plain">
        <li>Isi remote diunduh ke disk mesin ini — repo besar berarti unduhan besar.</li>
        <li>Sesudah berhasil, project menunjuk hasil clone (binding lokal, tak disync).</li>
      </ul>
      <FolderPicker open={picker} onClose={() => setPicker(false)} start={parent}
        onPick={(pick) => { setParent(pick); setDir(cloneTargetInto(pick, remote)); }} />
      {err && (
        <Callout tone="err" title={err.error}>
          Project tak tersentuh — perbaiki penyebabnya lalu coba lagi.
          {err.stderr && <pre className="hn-prj-stderr">{err.stderr}</pre>}
        </Callout>
      )}
    </Modal>
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
    } catch (e) { onToast(failureMessage("menyimpan path project", e), "err", "x-circle"); }
  }

  return (
    <>
      <Callout tone="warn" icon="folder-git-2" title="Belum ada checkout di mesin ini"
        action={
          <div className="hn-prj-inline">
            {remote
              ? <Button size="sm" leftIcon="git-branch" onClick={() => setCloning(true)}>Clone dari git remote</Button>
              : <Button size="sm" leftIcon="pencil" onClick={onEdit}>Isi git remote</Button>}
            <Button size="sm" variant="secondary" leftIcon="folder-open"
              onClick={() => setPicker(true)}>Pilih folder di device</Button>
          </div>
        }>
        {remote
          ? <>Docs, terminal, dan sesi project ini butuh checkout lokal. Clone{" "}
              <code className="hn-prj-mono hn-prj-wrap">{remote}</code>{" "}
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
