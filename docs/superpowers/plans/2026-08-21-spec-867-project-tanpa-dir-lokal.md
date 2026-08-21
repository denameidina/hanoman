# SPEC-867 — Project tanpa dir lokal: CTA clone / pilih folder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project yang belum punya checkout di mesin ini menawarkan dua jalan langsung dari detail
project — clone dari `gitRemote`, atau tunjuk folder yang sudah ada — memakai endpoint
`POST /projects/:id/clone` yang sudah ada.

**Architecture:** Murni frontend. Nol endpoint baru, nol kolom baru, nol field sync baru. Tiga
modul baru di `src/src/screens/` (satu pemindahan, satu modul murni, satu komponen), satu baris
sisipan di `ProjectDetailScreen`, dan pembetulan janji "clone ulang dari Edit" di `App.tsx`.

**Tech Stack:** React 18 + TypeScript (strict, `noUncheckedIndexedAccess`), Vite, Vitest + jsdom +
@testing-library/react, design system `src/src/ds`.

## Global Constraints

- Satu-satunya jalur clone adalah `api.cloneProject` → `POST /projects/:id/clone`. Jangan bikin
  jalur kedua, dan jangan menulis binding dari klien sesudah clone — endpoint sudah melakukannya.
- `FolderPicker` (SPEC-858) di-REUSE, tak pernah disalin.
- Binding LOCAL-only per-device (SPEC-213/217/218, ADR-0043): binding tak disync, `gitRemote` disync.
- Bahasa UI: Bahasa Indonesia, mengikuti gaya berkas sekitarnya.
- **Kontrak placeholder (SPEC-490):** setiap `<Input>`/`<textarea>` teks WAJIB punya `placeholder`
  yang berupa contoh nilai, bukan pengulangan label — ditegakkan `src/test/placeholder-contract.test.ts`.
- Test dijalankan dari root: `pnpm vitest --run <path>` (project `src` sudah di `vitest.workspace.ts`).
- Docs `internal/docs/**` yang tersentuh diperbarui **dalam commit yang sama** (Task 4).

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `src/src/screens/git-remote.ts` (baru) | tiga fungsi murni: `repoBasename`, `cloneTargetInto`, `cloneErrorText` |
| `src/src/screens/FolderPicker.tsx` (baru, dipindah) | `FolderPicker` + `FolderRow` + `FsEntry`, apa adanya dari `App.tsx:479-538` |
| `src/src/screens/MissingRepoCard.tsx` (baru) | Callout dua-cabang + `CloneRepoModal` private |
| `src/src/screens/ProjectDetailScreen.tsx` | satu import + satu baris render |
| `src/src/App.tsx` | buang definisi FolderPicker, impor; pakai `repoBasename`/`cloneErrorText`; betulkan janji toast |
| `src/test/git-remote.test.ts` (baru) | unit murni |
| `src/test/project-missing-repo.test.tsx` (baru) | integrasi lewat `App` |

---

### Task 1: Modul murni `git-remote.ts`

**Files:**
- Create: `src/src/screens/git-remote.ts`
- Create: `src/test/git-remote.test.ts`
- Modify: `src/src/App.tsx` (baris `const fromUrl = …` di `createProject`, ±872)

**Interfaces:**
- Consumes: tak ada.
- Produces:
  - `repoBasename(remote: string): string`
  - `cloneTargetInto(parent: string, remote: string): string`
  - `cloneErrorText(e: unknown): { error: string; stderr: string }`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/git-remote.test.ts`:

```ts
// SPEC-867 · turunan murni dari URL remote & bentuk galat endpoint clone. Diuji langsung
// (tanpa render) karena tiga call site-nya — modal Project baru, kartu tanpa-dir, dan toast
// kegagalan — harus sepakat soal nilai yang sama.
import { describe, it, expect } from "vitest";
import { repoBasename, cloneTargetInto, cloneErrorText } from "../src/screens/git-remote";

describe("git-remote (SPEC-867)", () => {
  it("repoBasename menurunkan nama repo dari https maupun ssh", () => {
    expect(repoBasename("https://github.com/org/repo.git")).toBe("repo");
    expect(repoBasename("git@github.com:org/repo.git")).toBe("repo");
    expect(repoBasename("https://gitlab.com/grup/sub/proyek")).toBe("proyek");
    expect(repoBasename("  ")).toBe("repo");
  });

  it("cloneTargetInto memperlakukan folder pilihan sebagai INDUK", () => {
    expect(cloneTargetInto("/home/dena/code", "https://github.com/org/repo.git"))
      .toBe("/home/dena/code/repo");
    expect(cloneTargetInto("/home/dena/code/", "git@github.com:org/arta.git"))
      .toBe("/home/dena/code/arta");
  });

  it("cloneErrorText mengangkat stderr endpoint, bukan 'POST … → 409'", () => {
    const e = Object.assign(new Error("POST /api/projects/x/clone → 409"),
      { detail: { error: "git clone gagal", detail: "fatal: repository not found\n" } });
    expect(cloneErrorText(e)).toEqual({ error: "git clone gagal", stderr: "fatal: repository not found" });
  });

  it("cloneErrorText tetap memberi kalimat saat galat bukan dari endpoint", () => {
    expect(cloneErrorText(new Error("boom"))).toEqual({ error: "boom", stderr: "" });
    expect(cloneErrorText(null)).toEqual({ error: "clone gagal", stderr: "" });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/git-remote.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/git-remote"`.

- [ ] **Step 3: Tulis implementasi minimal**

Buat `src/src/screens/git-remote.ts`:

```ts
// SPEC-867 · turunan murni dari URL git remote. Tanpa dependensi (termasuk ke api/client) supaya
// bisa diuji langsung — bentuk galatnya dibaca secara struktural, cermin cabang reverse-docs di App.tsx.

/** `https://github.com/org/repo.git` / `git@github.com:org/repo.git` → `repo`. */
export function repoBasename(remote: string): string {
  return remote.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "repo";
}

// FolderPicker memulangkan folder yang SUDAH ada, sementara `git clone` menolak folder tak kosong —
// folder pilihan karena itu diperlakukan sebagai INDUK dan targetnya sub-folder bernama repo.
// Tanpa komposisi ini setiap percobaan pertama gagal dengan "destination path already exists".
export function cloneTargetInto(parent: string, remote: string): string {
  return `${parent.trim().replace(/\/+$/, "")}/${repoBasename(remote)}`;
}

// POST /projects/:id/clone membalas `{ error, detail }` dengan `detail` = stderr git. `ApiError.message`
// sendiri hanya "POST /api/… → 409" — tak bisa ditindaklanjuti operator.
export function cloneErrorText(e: unknown): { error: string; stderr: string } {
  const d = (e as { detail?: { error?: string; detail?: string } | null } | null)?.detail ?? null;
  return {
    error: d?.error?.trim() || (e as { message?: string } | null)?.message || "clone gagal",
    stderr: d?.detail?.trim() || "",
  };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/git-remote.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 5: Pakai helper di `App.tsx` (buang duplikat inline)**

Tambahkan ke blok impor `screens/*` di `src/src/App.tsx` (dekat `import { branchOptions } from "./screens/branch";`):

```ts
import { repoBasename, cloneErrorText } from "./screens/git-remote";
```

Lalu di `createProject`, ganti baris:

```ts
    // SPEC-218 · mode clone: turunkan nama dari basename URL bila user tak isi (buang .git & host).
    const fromUrl = f.gitRemote.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "repo";
```

menjadi:

```ts
    // SPEC-218 · mode clone: turunkan nama dari basename URL bila user tak isi (buang .git & host).
    // SPEC-867 · perhitungan yang sama dipakai kartu tanpa-dir untuk menyusun folder tujuan clone.
    const fromUrl = repoBasename(f.gitRemote);
```

- [ ] **Step 6: Jalankan test yang menyentuh jalur itu**

Run: `pnpm vitest --run src/test/git-remote.test.ts src/test/new-project-clone.test.tsx src/test/new-project-reverse.test.tsx`
Expected: PASS semua (3 berkas).

- [ ] **Step 7: Typecheck paket frontend**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0, tanpa error.

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/git-remote.ts src/test/git-remote.test.ts src/src/App.tsx
git commit -m "feat(spec-867): helper murni repoBasename/cloneTargetInto/cloneErrorText"
```

---

### Task 2: `FolderPicker` pindah ke modulnya sendiri

Pemindahan murni — tak ada perubahan perilaku. Diperlukan karena `MissingRepoCard` (Task 3) hidup
di berkas lain dan constraint melarang menyalin komponen ini.

**Files:**
- Create: `src/src/screens/FolderPicker.tsx`
- Modify: `src/src/App.tsx` (hapus `type FsEntry`, `function FolderRow`, `function FolderPicker` —
  blok yang hari ini ada di ±479-538; tambah impor)
- Test (yang sudah ada, jadi jaring pengaman): `src/test/edit-project-folder-picker.test.tsx`,
  `src/test/new-project-clone.test.tsx`, `src/test/new-project-reverse.test.tsx`

**Interfaces:**
- Consumes: `api.browseFs` (sudah ada), komponen `ds`.
- Produces: `export function FolderPicker({ open, onClose, onPick, start }: { open: boolean; onClose: () => void; onPick: (path: string) => void; start?: string }): JSX.Element`

- [ ] **Step 1: Jalankan tiga test itu SEBELUM pindah (baseline hijau)**

Run: `pnpm vitest --run src/test/edit-project-folder-picker.test.tsx src/test/new-project-clone.test.tsx src/test/new-project-reverse.test.tsx`
Expected: PASS semua. Kalau ada yang merah di sini, itu bukan akibat spec ini — catat dulu.

- [ ] **Step 2: Buat `src/src/screens/FolderPicker.tsx`**

Isinya persis blok yang sekarang ada di `App.tsx` (`type FsEntry`, `FolderRow`, `FolderPicker`),
plus impor yang dibutuhkan dan `export` pada `FolderPicker`:

```tsx
/* FolderPicker — picker folder device nyata: menelusuri filesystem MESIN SERVER lewat
   GET /fs/browse dan memulangkan path absolut. Browser tak bisa memulangkan path absolut dari
   <input type="file" webkitdirectory>, jadi ini satu-satunya cara (SPEC-217/218 · SPEC-858).
   SPEC-867 · pindah dari App.tsx ke modulnya sendiri saat call site keempat lahir di berkas lain. */
import React from "react";
import { Modal, Button, Input, Icon, StateBlock } from "../ds";
import { api } from "../api/client";

type FsEntry = { name: string; path: string };

function FolderRow({ icon, name, onClick }: { icon: string; name: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
        borderBottom: "1px solid var(--border-hair)", background: hover ? "var(--bone-100)" : "transparent",
        fontSize: 13, color: "var(--text-strong)" }}>
      <Icon name={icon} size={16} color="var(--brass-700)" />
      <span style={{ fontFamily: "var(--font-mono)" }}>{name}</span>
    </div>
  );
}

export function FolderPicker({ open, onClose, onPick, start }:
  { open: boolean; onClose: () => void; onPick: (path: string) => void; start?: string }) {
  const [cur, setCur] = React.useState("");
  const [parent, setParent] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<FsEntry[]>([]);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const load = React.useCallback((path?: string) => {
    setLoading(true); setErr("");
    api.browseFs(path)
      .then((r) => { setCur(r.path); setParent(r.parent); setEntries(r.entries); })
      .catch(() => setErr("Tak bisa membuka folder ini"))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { if (open) load(start && start.trim() ? start.trim() : undefined); }, [open, start, load]);
  return (
    <Modal open={open} onClose={onClose} icon="folder-open" eyebrow="device" title="Pilih folder codebase"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" disabled={!cur} onClick={() => { onPick(cur); onClose(); }}>Pilih folder ini</Button>
      </>}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Input value={cur} onChange={(e: any) => setCur(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") load(e.currentTarget.value); }}
          leftIcon="folder" mono style={{ flex: 1 }} placeholder="/path/ke/folder" />
        <Button size="sm" variant="secondary" onClick={() => load(cur)}>Buka</Button>
      </div>
      <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", maxHeight: 320, overflow: "auto" }}>
        {loading ? <StateBlock kind="loading" compact title="Membuka folder…" />
          : err ? <StateBlock kind="error" compact title={err} hint={cur} action={() => load(cur)} />
          : <>
              {parent && <FolderRow icon="corner-left-up" name=".." onClick={() => load(parent)} />}
              {entries.map((e) => <FolderRow key={e.path} icon="folder" name={e.name} onClick={() => load(e.path)} />)}
              {entries.length === 0 && <StateBlock kind="empty" compact icon="folder"
                title="Tak ada sub-folder" hint="Folder ini bisa langsung dipilih." />}
            </>}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Hapus blok itu dari `App.tsx` dan impor gantinya**

Hapus dari `src/src/App.tsx` seluruh `type FsEntry = …`, `function FolderRow(…) { … }`, dan
`function FolderPicker(…) { … }` (termasuk komentar di atas `FolderPicker`, yang ikut pindah).
Tambahkan di blok impor `screens/*`:

```ts
import { FolderPicker } from "./screens/FolderPicker";
```

Tiga call site `<FolderPicker … />` di `App.tsx` tak berubah sedikit pun.

- [ ] **Step 4: Rapikan impor yang mungkin jadi yatim**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0. Bila muncul error "declared but never read" untuk `Icon` atau `StateBlock` di
`App.tsx`, hapus nama itu dari baris `import { … } from "./ds";` — **hanya** yang benar-benar
dilaporkan. (Cek dulu dengan `grep -c "<Icon\|StateBlock" src/src/App.tsx`; keduanya kemungkinan
besar masih dipakai di tempat lain, jadi biasanya tak ada yang perlu dihapus.)

- [ ] **Step 5: Jalankan jaring pengamannya**

Run: `pnpm vitest --run src/test/edit-project-folder-picker.test.tsx src/test/new-project-clone.test.tsx src/test/new-project-reverse.test.tsx`
Expected: PASS semua — sama persis dengan baseline Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/FolderPicker.tsx src/src/App.tsx
git commit -m "refactor(spec-867): FolderPicker pindah dari App.tsx ke modulnya sendiri"
```

---

### Task 3: `MissingRepoCard` + dua CTA di detail project

**Files:**
- Create: `src/src/screens/MissingRepoCard.tsx`
- Create: `src/test/project-missing-repo.test.tsx`
- Modify: `src/src/screens/ProjectDetailScreen.tsx` (impor + satu baris render sebelum `<HelpCenterCard …/>`)

**Interfaces:**
- Consumes: `FolderPicker` (Task 2), `repoBasename`/`cloneTargetInto`/`cloneErrorText` (Task 1),
  `api.cloneProject(id, dir)`, `api.putBinding(id, repoDir)`, `ProjectVM`.
- Produces: `export function MissingRepoCard({ p, onEdit, onToast, onProjectChanged }: { p: ProjectVM; onEdit: () => void; onToast: (msg: string, kind?: string, icon?: string) => void; onProjectChanged?: (id: string) => void | Promise<void> }): JSX.Element | null`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/project-missing-repo.test.tsx`:

```tsx
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Project dari sync hub: repoDir TAK PERNAH menyeberang (services/sync.ts), jadi keduanya null.
const NO_DIR = {
  id: "arta", name: "arta", desc: "marketplace", kind: "existing", repoDir: null,
  binding: null, gitRemote: "https://github.com/org/arta.git", stack: "", docStatus: "broken",
  coverage: 0, createdAt: "2026-08-01T00:00:00.000Z", backlog: 0, topStage: "spec",
  activity: "idle", commit: "belum ada commit", session: { status: "idle", phase: null, flow: null },
};
const CLONED = { ...NO_DIR, binding: "/home/dena/code/arta" };

vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));
const { state } = vi.hoisted(() => ({ state: { project: null as any } }));
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => ({ items: [state.project], total: 1, page: 1, pageSize: 20 })),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
    getProject: vi.fn(async () => CLONED),
    cloneProject: vi.fn(async () => ({ repoDir: "/home/dena/code/arta" })),
    putBinding: vi.fn(async () => ({ repoDir: "/home/dena/code/arta" })),
    browseFs: vi.fn(async (path?: string) => ({
      path: path ?? "/home/dena", parent: "/home",
      entries: [{ name: "code", path: `${path ?? "/home/dena"}/code` }],
    })),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";

async function openDetail(project: any) {
  state.project = project;
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByText("Projects")[0]!);
  fireEvent.click((await screen.findAllByText(project.name))[0]!);
}

describe("project tanpa dir lokal (SPEC-867)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("menampilkan keadaan tanpa-dir beserta dua jalan keluarnya", async () => {
    await openDetail(NO_DIR);
    expect(await screen.findByText("Belum ada checkout di mesin ini")).toBeInTheDocument();
    expect(screen.getByText("Clone dari git remote")).toBeInTheDocument();
    expect(screen.getByText("Pilih folder di device")).toBeInTheDocument();
  });

  it("tak muncul saat project sudah punya checkout", async () => {
    await openDetail(CLONED);
    expect(await screen.findByText("Edit project")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada checkout di mesin ini")).toBeNull();
  });

  it("clone memakai folder pilihan sebagai INDUK lalu menyegarkan project", async () => {
    const { api } = await import("../src/api/client");
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Clone dari git remote"));
    fireEvent.click(await screen.findByText("Pilih folder"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("code"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalledWith("/home/dena/code"));
    fireEvent.click(screen.getByText("Pilih folder ini"));
    expect((await screen.findByPlaceholderText("/path/ke/arta") as HTMLInputElement).value)
      .toBe("/home/dena/code/arta");
    fireEvent.click(screen.getByText("Clone"));
    await waitFor(() => expect((api.cloneProject as any))
      .toHaveBeenCalledWith("arta", "/home/dena/code/arta"));
    await waitFor(() => expect((api.getProject as any)).toHaveBeenCalledWith("arta"));
  });

  it("clone gagal menampilkan stderr endpoint, project tetap ada, dan bisa dicoba ulang", async () => {
    const { api } = await import("../src/api/client");
    (api.cloneProject as any).mockRejectedValueOnce(Object.assign(
      new Error("POST /api/projects/arta/clone → 409"),
      { detail: { error: "git clone gagal", detail: "fatal: repository 'x' not found" } }));
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Clone dari git remote"));
    fireEvent.change(await screen.findByPlaceholderText("/path/ke/arta"),
      { target: { value: "/home/dena/code/arta" } });
    fireEvent.click(screen.getByText("Clone"));
    expect(await screen.findByText("git clone gagal")).toBeInTheDocument();
    expect(screen.getByText(/repository 'x' not found/)).toBeInTheDocument();
    expect(screen.getAllByText("arta").length).toBeGreaterThan(0);   // project tak terhapus
    fireEvent.click(screen.getByText("Coba lagi"));
    await waitFor(() => expect((api.cloneProject as any)).toHaveBeenCalledTimes(2));
  });

  it("tanpa gitRemote: tak menawarkan clone, mengantar mengisi remote", async () => {
    await openDetail({ ...NO_DIR, gitRemote: null });
    expect(await screen.findByText("Belum ada checkout di mesin ini")).toBeInTheDocument();
    expect(screen.queryByText("Clone dari git remote")).toBeNull();
    fireEvent.click(screen.getByText("Isi git remote"));
    expect(await screen.findByPlaceholderText("https://github.com/org/repo.git")).toBeInTheDocument();
  });

  it("pilih folder di device menyimpan binding lalu menyegarkan project", async () => {
    const { api } = await import("../src/api/client");
    await openDetail(NO_DIR);
    fireEvent.click(await screen.findByText("Pilih folder di device"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("code"));
    await waitFor(() => expect((api.browseFs as any)).toHaveBeenCalledWith("/home/dena/code"));
    fireEvent.click(screen.getByText("Pilih folder ini"));
    await waitFor(() => expect((api.putBinding as any)).toHaveBeenCalledWith("arta", "/home/dena/code"));
    await waitFor(() => expect((api.getProject as any)).toHaveBeenCalledWith("arta"));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/project-missing-repo.test.tsx`
Expected: FAIL — teks "Belum ada checkout di mesin ini" tak ditemukan.

- [ ] **Step 3: Tulis `src/src/screens/MissingRepoCard.tsx`**

```tsx
/* MissingRepoCard — project yang belum punya checkout di MESIN INI (SPEC-867). `Project.repoDir`
   tak pernah disync (services/sync.ts) dan `LocalBinding` LOCAL-only (ADR-0043), jadi project yang
   datang lewat sync — dan project yang clone-nya gagal saat dibuat — mendarat dengan keduanya null.
   Kartunya perlu ada karena layar ini justru makin bisu saat itu terjadi: pintu "Reverse docs" dan
   "Scaffold docs" digerbangi path efektif di App.tsx, jadi keduanya HILANG tanpa satu pun alasan.
   Cloningnya lewat POST /projects/:id/clone yang sudah ada — endpoint itu pula yang menulis
   binding-nya, klien tak menulisnya lagi. */
import React from "react";
import { Callout, Button, Modal, Field, Input } from "../ds";
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
  React.useEffect(() => {
    if (open) { setDir(""); setParent(""); setErr(null); setBusy(false); }
  }, [open]);

  async function run() {
    const target = dir.trim();
    if (!target || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.cloneProject(p.id, target);
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
    <Modal open={open} onClose={onClose} icon="git-branch" eyebrow={p.id} title="Clone dari git remote"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
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
```

- [ ] **Step 4: Sisipkan di `ProjectDetailScreen`**

Di `src/src/screens/ProjectDetailScreen.tsx`, tambahkan impor di bawah `import { AutoMergeCard } …`:

```ts
import { MissingRepoCard } from "./MissingRepoCard";
```

lalu sisipkan tepat sebelum `<HelpCenterCard p={p} … />`:

```tsx
      {/* SPEC-867 · project tanpa checkout di mesin ini: keadaan + dua jalan keluarnya. Merender
          null saat repo-nya ada, jadi urutan kartu di bawah tak berubah. */}
      <MissingRepoCard p={p} onEdit={onEdit} onToast={onToast} onProjectChanged={onProjectChanged} />
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/project-missing-repo.test.tsx`
Expected: PASS — 6 test.

- [ ] **Step 6: Kontrak placeholder + typecheck**

Run: `pnpm vitest --run src/test/placeholder-contract.test.ts`
Expected: PASS. Test ini bisa sudah merah di base karena sebab lain (`<Input type="number">` di
`SettingsScreen`) — yang wajib dipastikan: **tak satu pun** baris pelanggarnya menyebut
`MissingRepoCard.tsx`. Jangan `git stash` untuk membandingkan (tumpukan stash milik REPO, dibagi
dengan sesi lain); baca saja daftar pelanggarnya.

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [ ] **Step 7: Commit**

```bash
git add src/src/screens/MissingRepoCard.tsx src/src/screens/ProjectDetailScreen.tsx src/test/project-missing-repo.test.tsx
git commit -m "feat(spec-867): kartu tanpa-checkout di detail project — clone atau pilih folder"
```

---

### Task 4: Janji "clone ulang dari Edit" jadi benar + docs

**Files:**
- Modify: `src/src/App.tsx` (komentar ±879 dan cabang `catch` toast ±886-889 di `createProject`)
- Modify: `src/test/new-project-clone.test.tsx` (tambah satu test untuk teks toast)
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: `cloneErrorText` (Task 1), kartu dari Task 3.
- Produces: tak ada API baru.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/new-project-clone.test.tsx`, di dalam `describe` yang sudah ada, sesudah
test yang ada:

```tsx
  it("clone gagal: project bertahan, toast memakai pesan endpoint & menunjuk detail project (SPEC-867)", async () => {
    const { api } = await import("../src/api/client");
    (api.cloneProject as any).mockRejectedValueOnce(Object.assign(
      new Error("POST /api/projects/repo/clone → 409"),
      { detail: { error: "git clone gagal", detail: "fatal: repository not found" } }));
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByText("Projects")[0]!);
    fireEvent.click((await screen.findAllByText("Project baru"))[0]!);
    fireEvent.click(await screen.findByText("Existing codebase"));
    fireEvent.click(await screen.findByText("Clone dari URL git"));
    fireEvent.change(await screen.findByPlaceholderText("https://github.com/org/repo.git"),
      { target: { value: "https://github.com/org/repo.git" } });
    fireEvent.change(screen.getByPlaceholderText("/path/ke/repo"), { target: { value: "/tmp/clone" } });
    fireEvent.click(screen.getByText("Clone → reverse-engineer docs"));
    const toast = await screen.findByText(/clone gagal/);
    expect(toast.textContent).toContain("git clone gagal");
    expect(toast.textContent).toContain("detail project");
    expect(toast.textContent).not.toContain("dari Edit");
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/new-project-clone.test.tsx`
Expected: FAIL — toast masih berbunyi "clone ulang dari Edit" dan memuat `POST /api/… → 409`.

- [ ] **Step 3: Betulkan komentar & toast di `App.tsx`**

Ganti komentar di atas `if (clone) {`:

```ts
    // SPEC-218 · project sudah ada; clone di jalur terpisah agar gagal-clone tak menghapus project
    // (remote tersimpan → bisa clone ulang dari Edit). AC-8.
```

menjadi:

```ts
    // SPEC-218 · project sudah ada; clone di jalur terpisah agar gagal-clone tak menghapus project.
    // SPEC-867 · remote tersimpan, jadi clone bisa diulang dari kartu "Belum ada checkout di mesin
    // ini" di detail project — cabang catch di bawah mendaratkan operator tepat di kartu itu. AC-8.
```

lalu ganti isi `catch (e)`-nya:

```ts
      } catch (e) {
        const detail = e instanceof ApiError ? ` · ${e.message}` : "";
        setProjects((list) => [created!, ...list]);
        setProjectId(created.id); setModal(null); setSection("project");
        showToast(`Project ${created.id} dibuat, tapi clone gagal${detail} · clone ulang dari Edit`, "warn", "git-branch");
        return;
      }
```

menjadi:

```ts
      } catch (e) {
        // SPEC-867 · `ApiError.message` hanya "POST /api/… → 409"; yang bisa ditindaklanjuti adalah
        // pesan endpoint-nya.
        const { error } = cloneErrorText(e);
        setProjects((list) => [created!, ...list]);
        setProjectId(created.id); setModal(null); setSection("project");
        showToast(`Project ${created.id} dibuat, tapi clone gagal · ${error} · clone ulang dari detail project`,
          "warn", "git-branch");
        return;
      }
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/new-project-clone.test.tsx`
Expected: PASS — 2 test.

Bila `ApiError` jadi impor yatim di `App.tsx`, `pnpm --filter ./src typecheck` akan mengatakannya —
cek dulu `grep -c "ApiError" src/src/App.tsx` (ia masih dipakai `load()` untuk 401, jadi tetap ada).

- [ ] **Step 5: Perbarui `internal/docs/frontend/frontend-implementation.md`**

Di seksi "## Path project dipilih, bukan diketik (SPEC-217/218 · SPEC-858)", ubah kalimat
`memakai FolderPicker (App.tsx)` menjadi `memakai FolderPicker
(src/src/screens/FolderPicker.tsx — pindah dari App.tsx di SPEC-867 saat call site keempat lahir
di berkas lain)`, ubah "tiga call site" jadi "empat call site", dan tambahkan butir keempat:

```markdown
- **Detail project → "Belum ada checkout di mesin ini"** (SPEC-867): folder tujuan clone (picker
  memilih **induk**), dan folder repo yang sudah ter-clone manual.
```

Lalu tambahkan seksi baru tepat sesudah paragraf "Jalur simpannya tak berubah …":

```markdown
## Project tanpa checkout di mesin ini (SPEC-867)

`Project.repoDir` **tak pernah menyeberang sync** (`server/src/services/sync.ts`) dan `LocalBinding`
LOCAL-only per-device (ADR-0043), jadi project yang datang dari hub — dan project yang clone-nya
gagal saat dibuat — mendarat dengan `binding` **dan** `repoDir` null. Justru di keadaan itu detail
project paling bisu: pintu "Reverse docs"/"Scaffold docs" digerbangi path efektif
(`App.tsx`), sehingga keduanya **hilang tanpa alasan**. `MissingRepoCard`
(`src/src/screens/MissingRepoCard.tsx`) mengisi lubang itu dengan predikat yang **sama persis**
(`p.binding ?? p.repoDir`) — ia muncul tepat saat dua pintu itu menghilang, dan merender `null`
selebihnya.

Dua cabang. **Ada `gitRemote`**: "Clone dari git remote" (membuka modal) + "Pilih folder di device".
**Tanpa `gitRemote`**: clone dinyatakan mustahil apa adanya, tombolnya "Isi git remote" (mengantar
ke modal Edit yang memang punya field itu) + "Pilih folder di device".

Tiga hal yang membuatnya bekerja:

- **Folder pilihan adalah INDUK, bukan target.** `FolderPicker` memulangkan folder yang **sudah
  ada**; `git clone` menolak folder tak kosong. `cloneTargetInto` (`screens/git-remote.ts`)
  menyusun `<induk>/<repoBasename(remote)>` — tanpa itu percobaan pertama selalu gagal dengan
  "destination path already exists". `start` picker memegang **induk** terakhir, bukan target,
  karena target belum ada dan `GET /fs/browse` akan membalas 400 untuknya.
- **Kegagalan tinggal di dalam modal.** `POST /projects/:id/clone` membalas `{ error, detail }`
  dengan `detail` = **stderr git**, sementara `ApiError.message` cuma `POST /api/… → 409`.
  `cloneErrorText` mengangkat keduanya; modal tetap terbuka dengan tombol "Coba lagi", dan project
  tak tersentuh sama sekali.
- **Tanpa `useConfirm`.** Syarat ADR-0127 di sini ("menimpa/menulis ke folder tak kosong") tak bisa
  terpenuhi: `git clone` menolak folder tak kosong, jadi ia tak pernah menimpa apa pun; dan klien
  memang tak bisa menjawab "kosong?" — `GET /fs/browse` hanya melist **direktori**. "Pilih folder di
  device" tak menyentuh disk sama sekali (hanya baris `LocalBinding`).

Binding hasil clone ditulis **oleh endpoint**; klien hanya memanggil `onProjectChanged` (jalur
refetch VM SPEC-258). Toast kegagalan clone di modal Project baru karena itu berhenti menyebut
"Edit" dan menunjuk kartu ini — cabang `catch`-nya sudah `setSection("project")`, jadi operator
mendarat persis di sana.
```

- [ ] **Step 6: Perbarui `internal/docs/architecture/api-contract.md`**

Ganti baris `POST   /projects/:id/clone …` menjadi:

```
POST   /projects/:id/clone    { dir }   # 201 { repoDir } · git clone gitRemote→dir lalu set binding; 409 tanpa gitRemote / clone gagal.
#   409 clone gagal membawa `detail` = stderr git — satu-satunya keterangan yang bisa ditindaklanjuti.
#   SPEC-867 · bukan hanya jalur pembuatan project: kartu "Belum ada checkout di mesin ini" di detail
#   project memanggil endpoint yang SAMA untuk project yang sudah ada (dari sync hub, atau yang
#   clone-nya gagal saat dibuat). Binding ditulis endpoint ini, bukan oleh klien sesudahnya.
```

Dan ganti dua baris `GET /fs/browse` menjadi:

```
GET      /fs/browse?path=               # directory picker sisi server; menopang `FolderPicker` di modal
#   Project baru (repoDir/folder clone), modal Edit project (path per-mesin, SPEC-858), DAN kartu
#   "Belum ada checkout di mesin ini" di detail project (SPEC-867 — folder yang dipilih di sana
#   adalah INDUK folder clone). Hanya melist DIREKTORI, jadi ia tak bisa menjawab "folder ini kosong?".
```

- [ ] **Step 7: Cek index docs masih utuh**

Run: `node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check`
Expected: index OK — tak ada doc baru, jadi tak ada yang perlu di-link. Bila CLI belum ter-build,
verifikasi manual: kedua berkas sudah ter-link di `internal/docs/README.md` (kategori `frontend`
dan `architecture`) dan tak ada berkas doc baru yang ditambahkan spec ini.

- [ ] **Step 8: Commit**

```bash
git add src/src/App.tsx src/test/new-project-clone.test.tsx internal/docs/frontend/frontend-implementation.md internal/docs/architecture/api-contract.md
git commit -m "fix(spec-867): janji 'clone ulang' menunjuk detail project + pesan endpoint; docs"
```

---

### Task 5: Verifikasi akhir

**Files:** tak ada perubahan; hanya menjalankan bukti.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"`
Expected: PASS. **Pastikan test-nya benar-benar berjalan** — `--changed` menyalakan
`passWithNoTests`, jadi "no test files" TERLIHAT hijau. Hitung jumlah berkas test yang dijalankan;
minimal harus memuat `git-remote.test.ts`, `project-missing-repo.test.tsx`,
`new-project-clone.test.tsx`, `new-project-reverse.test.tsx`, `edit-project-folder-picker.test.tsx`,
`placeholder-contract.test.ts`.

Bila set-nya menyentuh test **server**, tambahkan `--no-file-parallelism` dan
`TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"`. Spec ini murni frontend, jadi normalnya tidak.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0. Jangan `pnpm -r typecheck`.

- [ ] **Step 3: Smoke endpoint clone di server hidup**

Spec ini tak mengubah server, tapi ia memindahkan pemakaian sebuah endpoint ke permukaan baru —
sekali di akhir, buktikan endpoint-nya masih berperilaku seperti yang diandalkan UI:

```bash
# server dev di port lain agar tak bentrok dengan instance yang sedang jalan
curl -s -X POST localhost:8787/api/projects/<id-tanpa-gitRemote>/clone \
  -H 'content-type: application/json' -d '{"dir":"/tmp/spec867"}' | head -c 400
```

Expected: `409` dengan `{"error":"project tidak punya gitRemote untuk clone"}` — cabang yang
dipetakan kartu ke pesan "clone tak mungkin". Bila tak ada server hidup yang aman dipakai, catat
itu apa adanya alih-alih mengklaim sudah diuji.

- [ ] **Step 4: Centang seluruh checklist plan ini & commit**

```bash
git add docs/superpowers/plans/2026-08-21-spec-867-project-tanpa-dir-lokal.md
git commit -m "chore(spec-867): centang checklist plan"
```
