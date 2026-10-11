import React from "react";
import type { MemberView } from "@hanoman/shared";
import { Badge, Button, Callout, IconButton, Input, Modal, StateBlock, useConfirm } from "../ds";
import { api } from "../api/client";
import "./styles/panels.css";

/* SPEC-946 · direktori orang, dikelola DI DALAM layar Tim — bukan `SettingsScreen.tsx`, yang
   sudah 93 KB. Anggota GLOBAL, bukan per project: task boleh tanpa project, jadi direktorinya
   tak bisa digantung pada project (ADR-0150 keputusan 3). */

function MemberRow({ m, busy, onSave, onToggle, onDelete }: {
  m: MemberView; busy: boolean;
  onSave: (id: string, patch: { name: string; role: string | null }) => void;
  onToggle: (m: MemberView) => void;
  onDelete: (m: MemberView) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(m.name);
  const [role, setRole] = React.useState(m.role ?? "");

  if (editing) {
    return (
      <div className="hn-mem-edit">
        <Input size="sm" value={name} aria-label={`Nama ${m.name}`} placeholder="mis. Dena Meidina"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
        <Input size="sm" value={role} aria-label={`Peran ${m.name}`} placeholder="mis. desainer"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRole(e.target.value)} />
        {/* ADR-0094/ADR-0150 · id diturunkan dari email dan changefeed sync tak punya operasi
            rename — id yang berubah meninggalkan baris yatim di setiap mesin lain. Emailnya
            ditampilkan sebagai TEKS, tak pernah sebagai field yang bisa diketik: form yang
            menawarkannya lalu membuangnya persis kelas bug yang membuat route menolaknya lagi. */}
        <div className="hn-mem-note">
          {m.email} — ganti email berarti hapus lalu buat baru.
        </div>
        <div className="hn-mem-actions">
          <Button size="sm" disabled={busy}
            onClick={() => { onSave(m.id, { name: name.trim(), role: role.trim() || null }); setEditing(false); }}>
            Simpan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Batal</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`hn-dense-row hn-mem-row${m.active ? "" : " hn-mem-row--off"}`}>
      <span className="hn-mem-main">
        <span className="hn-mem-name-row">
          <span className="hn-mem-name">{m.name}</span>
          {m.role && <Badge tone="neutral" size="sm">{m.role}</Badge>}
          {!m.active && <Badge tone="warn" size="sm">nonaktif</Badge>}
        </span>
        <span className="hn-mem-email">{m.email}</span>
      </span>
      <IconButton icon="pencil" label={`Ubah ${m.name}`} size="sm" onClick={() => setEditing(true)} />
      <IconButton icon={m.active ? "user-minus" : "user-check"} size="sm"
        label={`${m.active ? "Nonaktifkan" : "Aktifkan"} ${m.name}`} onClick={() => onToggle(m)} />
      <IconButton icon="trash-2" label={`Hapus ${m.name}`} size="sm" onClick={() => onDelete(m)} />
    </div>
  );
}

export function MembersPanel({ open, onClose, onChanged, onToast }: {
  open: boolean; onClose: () => void;
  onChanged: (members: MemberView[]) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [list, setList] = React.useState<MemberView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  // Galat muat ulang saat daftar sudah pernah tampil: daftar lama tetap di layar, galatnya di atasnya.
  const [reloadFailed, setReloadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("");
  const { confirm, dialog } = useConfirm();

  // `onChanged` hampir selalu arrow inline di call site; memasukkannya ke deps `load` membuat
  // effect di bawah memuat ulang tiap render pemanggilnya.
  const changed = React.useRef(onChanged);
  changed.current = onChanged;
  // Sudah pernah ada daftar yang berhasil dimuat? Menentukan apakah muat ulang boleh senyap.
  const hasData = React.useRef(false);

  const load = React.useCallback(() => {
    // Muat ulang senyap: bila daftar sudah pernah tampil, keadaan "loading" tak dipakai dan daftar
    // tak dikosongkan. Galat muat ulang hanya muncul sebagai alert di atas data lama. "loading"
    // dipakai hanya saat belum ada apa pun untuk ditampilkan (muat pertama, atau coba lagi dari galat).
    if (!hasData.current) setState("loading");
    api.listMembers()
      .then((r) => {
        hasData.current = true;
        setList(r.items); setState("ready"); setReloadFailed(false);
        changed.current(r.items);
      })
      .catch(() => {
        if (hasData.current) setReloadFailed(true);
        else setState("error");
      });
  }, []);
  React.useEffect(() => { if (open) load(); }, [open, load]);

  if (!open) return null;

  async function add() {
    if (!name.trim() || !email.trim()) { onToast("Nama & email wajib diisi", "err", "x-circle"); return; }
    setBusy(true);
    try {
      await api.createMember({ name: name.trim(), email: email.trim(), role: role.trim() || null });
      setName(""); setEmail(""); setRole("");
      onToast("Anggota ditambahkan", "ok", "user-plus");
      load();
    } catch { onToast("Gagal menambah anggota — email mungkin sudah terdaftar", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function save(id: string, patch: { name: string; role: string | null }) {
    setBusy(true);
    try { await api.patchMember(id, patch); load(); }
    catch { onToast("Gagal menyimpan anggota", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function toggle(m: MemberView) {
    setBusy(true);
    try { await api.patchMember(m.id, { active: !m.active }); load(); }
    catch { onToast("Gagal mengubah status anggota", "err", "x-circle"); }
    finally { setBusy(false); }
  }

  async function remove(m: MemberView) {
    // `onDelete: SetNull` — tugasnya jadi "belum ditugaskan", tidak ikut terhapus. Operator harus
    // tahu itu SEBELUM menekan, bukan menemukannya di papan sesudahnya.
    if (!await confirm({
      title: `Hapus ${m.name} dari direktori?`,
      message: "Tugasnya tidak ikut terhapus — kartu yang ditugaskan padanya jadi 'belum ditugaskan'.",
      confirmLabel: "Hapus anggota", tone: "danger", icon: "trash-2",
      run: () => api.deleteMember(m.id),
    })) return;
    onToast("Anggota dihapus", "ok", "trash-2");
    load();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} icon="users" eyebrow="Papan tim" title="Anggota" width={620}>
        <div className="hn-mem-add">
          <Input size="sm" value={name} aria-label="Nama anggota baru" placeholder="Nama"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            className="hn-mem-in-name" />
          <Input size="sm" value={email} aria-label="Email anggota baru" placeholder="email@nafanesia.id"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            className="hn-mem-in-email" />
          <Input size="sm" value={role} aria-label="Peran anggota baru" placeholder="Peran (opsional)"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRole(e.target.value)}
            className="hn-mem-in-role" />
          <Button size="sm" leftIcon="user-plus" onClick={add} loading={busy}>Tambah anggota</Button>
        </div>
        {reloadFailed && (
          <Callout tone="err" title="Gagal memuat ulang anggota" className="hn-mem-alert"
            action={<Button size="sm" variant="ghost" onClick={load}>Coba lagi</Button>}>
            Yang tampil di bawah adalah data lama. Coba lagi untuk memuat yang terbaru.
          </Callout>
        )}
        {state === "loading" ? <StateBlock kind="loading" compact />
          : state === "error" ? <StateBlock kind="error" compact hint="Gagal memuat anggota."
              action={load} actionLabel="Coba lagi" />
          : list.length === 0 ? <StateBlock kind="empty" compact icon="users" title="Belum ada anggota"
              hint="Tambahkan orang di atas agar kartu papan bisa ditugaskan." />
          : list.map((m) => (
              <MemberRow key={m.id} m={m} busy={busy} onSave={save} onToggle={toggle} onDelete={remove} />
            ))}
      </Modal>
      {dialog}
    </>
  );
}
