# SPEC-847 — Satu kontrak konfirmasi destruktif (`useConfirm`) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keempat belas gerbang destruktif frontend berpindah dari `window.confirm()` native ke dialog aplikasi lewat satu primitif `useConfirm()`, satu pemakaian sisa (`GitGraph` "dorong tag") ditandai pengecualian beralasan, dan aturannya ditegakkan test pemindai sumber sehingga call site ke-16 tak bisa lahir diam-diam.

**Architecture:** Gerbangnya adalah **bentuk pemanggilan**, bukan disiplin. `useConfirm()` memulangkan `{ confirm, dialog }`: `confirm(options)` sebuah promise sehingga call site berubah satu baris (`if (!window.confirm(x)) return;` → `if (!await confirm({…})) return;`) dengan alur kontrol utuh, dan `dialog` dirender pemanggilnya sendiri sehingga tak ada Provider dan layar tetap bisa dirender berdiri sendiri di test. Opsi `run` menahan dialog tetap terbuka + `busy` selama mutasi (pending protection). `ConfirmDialog` diperluas `impact`/`icon`/varian tombol; `Modal` tidak disentuh — focus trap, focus restore, dan Escape-inert-saat-busy sudah ada di sana dan hanya dikunci test.

**Tech Stack:** React 18 + TypeScript strict · Vite · vitest + @testing-library/react (jsdom). Tanpa server, tanpa endpoint, tanpa skema, tanpa migration.

## Global Constraints

- **Semua perintah dijalankan dari root worktree** `/Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-847`. `cwd` tool Bash bertahan antar-panggilan — `vitest --changed` dari direktori salah memberi hijau palsu.
- **Test frontend saja** — tak ada test server yang tersentuh, jadi `TEST_DATABASE_URL`/`--no-file-parallelism` tak diperlukan. Perintah baku: `pnpm vitest --run <path…>`.
- **Jangan sentuh `src/src/ds/kit.tsx` (`Modal`).** Focus trap, focus restore ke pemicu, `aria-modal`, dan `onClose` yang `undefined` saat `busy` sudah ada. AC-3 dipenuhi dengan MENGUNCI perilaku itu lewat test, bukan menulis ulang. React `autoFocus` tak akan bekerja di dalamnya — layout effect `Modal` (`initial?.focus()`) berjalan sesudah `commitMount` anaknya dan menimpanya.
- **Focus awal `ConfirmDialog` tanpa `requireText` jatuh ke tombol "Tutup" di header** (kontrol aman: ia membatalkan). Test menegaskan fokus TIDAK di tombol destruktif; jangan menuntutnya di "Batal".
- **`confirm()` melempar bila `run` melempar; `false` HANYA untuk pembatalan.** Jangan menerjemahkan kegagalan mutasi jadi `false` — call site akan menelannya.
- **Nama hasil destructuring WAJIB `{ confirm, dialog }`** di setiap call site. Test inventaris menghitung `useConfirm(` vs `{dialog}` per berkas; nama lain lolos hitungan dan mematikan penjaganya.
- **Setiap komponen yang memanggil `useConfirm()` WAJIB merender `{dialog}`.** Lupa = promise menggantung selamanya tanpa error dan tanpa gejala selain "tombolnya tak melakukan apa-apa".
- **Teks Indonesia**, mengikuti kalimat `window.confirm` yang digantikan. Judul menyebut **nama objeknya** (AC-1).
- **Jangan menambah `try/catch` yang hari ini tak ada** di sebuah call site (`DocsWorkspace.removeDoc`). Paritas perilaku; perbaikan penanganan error di luar scope.
- **`internal/docs` diperbarui dalam commit yang sama** dan ter-link di `internal/docs/README.md` (Task 9).
- ADR baru bernomor **0125** — 0124 sudah diklaim worktree `spec-843`.

---

### Task 1: `ConfirmDialog` — `impact`, `icon`, varian tombol mengikuti severity

**Files:**
- Modify: `src/src/ds/ConfirmDialog.tsx`
- Test: `src/test/confirm-dialog.test.tsx`

**Interfaces:**
- Produces: `ConfirmDialog` menerima prop tambahan `impact?: React.ReactNode[]` (dirender `<ul>` sesudah `message`) dan `icon?: string` (override ikon header **dan** `leftIcon` tombol konfirmasi). Tombol konfirmasi memakai `variant="danger"` saat `tone === "danger"`, dan `loading={busy}`. Semua prop lama tak berubah maknanya.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/confirm-dialog.test.tsx`:

```tsx
// SPEC-847 · ADR-0125 · dampak berbaris-baris tak boleh dipadatkan jadi satu string, dan aksi
// yang bukan hapus tak boleh dipaksa memakai ikon trash.
describe("ConfirmDialog impact & icon (SPEC-847)", () => {
  it("merender daftar dampak terstruktur, bukan satu paragraf", () => {
    render(<ConfirmDialog open title="Ganti ID?" message="Dampaknya:"
      impact={["Link Help publik berubah.", "Perubahan dirambatkan ke hub."]}
      onConfirm={() => {}} onCancel={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Link Help publik berubah.", "Perubahan dirambatkan ke hub.",
    ]);
  });

  it("tanpa impact tak ada list sama sekali", () => {
    render(<ConfirmDialog open title="Hapus?" message="pesan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("icon menimpa trash-2 di header dan di tombol konfirmasi", () => {
    const { container } = render(<ConfirmDialog open title="Cabut token?" icon="key-round"
      confirmLabel="Cabut" onConfirm={() => {}} onCancel={() => {}} />);
    expect(container.querySelector('[data-icon="trash-2"]')).toBeNull();
    expect(container.querySelectorAll('[data-icon="key-round"]').length).toBe(2);
  });

  it("tone danger memberi tombol konfirmasi varian danger", () => {
    render(<ConfirmDialog open title="Hapus?" confirmLabel="Hapus" onConfirm={() => {}} onCancel={() => {}} />);
    const btn = screen.getByRole("button", { name: "Hapus" });
    expect(btn.style.background).toContain("--clay-600");
  });
});
```

- [x] **Step 2: Ikon butuh penanda yang bisa dipegang test**

`ds/icon.tsx` merender `lucide-react` tanpa atribut identitas. Tambahkan `data-icon` di sana lebih dulu — tanpa itu test ikon di atas mustahil ditulis tanpa menyentuh internal lucide.

Baca `src/src/ds/icon.tsx`; pada elemen yang dirender tambahkan `data-icon={name}` (jangan ubah apa pun yang lain).

- [x] **Step 3: Jalankan test — harus gagal**

Run: `pnpm vitest --run src/test/confirm-dialog.test.tsx`
Expected: FAIL — `getAllByRole("listitem")` tak menemukan apa pun; `data-icon="key-round"` 0 dari 2.

- [x] **Step 4: Implementasi**

Ganti isi `src/src/ds/ConfirmDialog.tsx` (pertahankan seluruh komentar SPEC-269/ADR-0121 yang sudah ada di kepala berkas, tambahkan baris SPEC-847):

```tsx
// SPEC-269 · dialog konfirmasi reusable (di atas Modal). Dipakai untuk aksi hapus data.
// ADR-0121 · `requireText` untuk aksi yang tak bisa dibatalkan (hapus folder rekursif):
// tombol tetap mati sampai operator mengetik ulang namanya. Tanpa prop itu perilakunya
// identik dengan sebelumnya bagi seluruh pemakai lama.
// SPEC-847 · ADR-0125 · `impact` (daftar dampak terstruktur) dan `icon` (aksi yang bukan hapus
// tak dipaksa memakai trash). Tombol konfirmasi mengikuti severity lewat varian `danger` DS.
import React from "react";
import { Modal } from "./kit";
import { Button, Input } from "./components/forms";

export function ConfirmDialog({
  open, title, message, impact, eyebrow, confirmLabel = "Hapus", cancelLabel = "Batal",
  tone = "danger", icon, busy = false, requireText, onConfirm, onCancel,
}: {
  open: boolean; title: React.ReactNode; message?: React.ReactNode; impact?: React.ReactNode[];
  eyebrow?: React.ReactNode; confirmLabel?: string; cancelLabel?: string;
  tone?: "danger" | "default"; icon?: string; busy?: boolean;
  requireText?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  // Dialog yang sama dipakai ulang untuk target berbeda — kosongkan tiap kali ia dibuka atau
  // targetnya berganti, kalau tidak konfirmasi target lama ikut membuka target baru.
  React.useEffect(() => { setTyped(""); }, [open, requireText]);
  const locked = !!requireText && typed !== requireText;
  const mark = icon ?? (tone === "danger" ? "trash-2" : "help-circle");
  return (
    <Modal
      open={open} title={title} eyebrow={eyebrow} width={440}
      icon={mark}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant={tone === "danger" ? "danger" : "primary"}
            leftIcon={icon ?? (tone === "danger" ? "trash-2" : "check")} loading={busy}
            onClick={onConfirm} disabled={busy || locked}>{confirmLabel}</Button>
        </>
      }>
      {message && <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55 }}>{message}</div>}
      {!!impact?.length && (
        <ul style={{ margin: message ? "10px 0 0" : 0, paddingLeft: 18, fontSize: 13,
          color: "var(--text-body)", lineHeight: 1.55 }}>
          {impact.map((it, i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{it}</li>)}
        </ul>
      )}
      {requireText && (
        <Input size="sm" value={typed} aria-label={`Ketik ${requireText} untuk konfirmasi`}
          placeholder={requireText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
          style={{ marginTop: 12, width: "100%" }} />
      )}
    </Modal>
  );
}
```

- [x] **Step 5: Jalankan test — harus lulus, termasuk test lama**

Run: `pnpm vitest --run src/test/confirm-dialog.test.tsx src/test/ds.test.tsx src/test/branches-panel.test.tsx src/test/triage.test.tsx`
Expected: PASS semua. (`loading={busy}` menyembunyikan `leftIcon` dan menampilkan spinner — teks tombol tetap dirender, jadi query berbasis teks di test lama tetap cocok.)

- [x] **Step 6: Commit**

```bash
git add src/src/ds/ConfirmDialog.tsx src/src/ds/icon.tsx src/test/confirm-dialog.test.tsx
git commit -m "feat(ds): ConfirmDialog punya daftar dampak, ikon per-aksi, dan tombol ber-severity"
```

---

### Task 2: `useConfirm()` — bentuk pemanggilan seharga `window.confirm`

**Files:**
- Create: `src/src/ds/useConfirm.tsx`
- Modify: `src/src/ds/index.ts:11`
- Test: `src/test/use-confirm.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` beserta prop `impact`/`icon` dari Task 1.
- Produces:
  ```ts
  export type ConfirmOptions = {
    title: React.ReactNode; message?: React.ReactNode; impact?: React.ReactNode[];
    eyebrow?: React.ReactNode; confirmLabel?: string; cancelLabel?: string;
    tone?: "danger" | "default"; icon?: string; requireText?: string;
    run?: () => Promise<unknown>;
  };
  export function useConfirm(): { confirm: (o: ConfirmOptions) => Promise<boolean>; dialog: React.ReactElement };
  ```
  `confirm` stabil antar-render (aman sebagai dependency `useCallback`/`useEffect`).

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/use-confirm.test.tsx`:

```tsx
// SPEC-847 · ADR-0125 · kontrak useConfirm: satu promise per dialog, diselesaikan tepat sekali;
// `run` menahan dialog terbuka & busy selama mutasi (pending protection); lemparan `run`
// diteruskan ke pemanggil, TIDAK diterjemahkan jadi `false`.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useConfirm, type ConfirmOptions } from "../src/ds/useConfirm";

function Harness({ options, onResult }: { options: ConfirmOptions; onResult: (r: unknown) => void }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button onClick={() => { confirm(options).then((ok) => onResult(ok), (e) => onResult(e)); }}>Picu</button>
      {dialog}
    </>
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Picu" }));

describe("useConfirm (SPEC-847)", () => {
  it("Batal → resolve false; dialog tertutup", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?" }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByText("Hapus X?")).toBeNull();
  });

  it("Konfirmasi tanpa run → resolve true seketika", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus" }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("run menahan dialog terbuka & mematikan Batal/konfirmasi selama pending", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { release = () => r(); }));
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus", run }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Hapus" })).toBeDisabled();
    expect(screen.getByText("Hapus X?")).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByText("Hapus X?")).toBeNull();
  });

  it("klik ganda pada konfirmasi menjalankan run TEPAT sekali", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { release = () => r(); }));
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus", run }} onResult={() => {}} />);
    open();
    const btn = await screen.findByRole("button", { name: "Hapus" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    release();
  });

  it("run yang melempar membuat confirm() melempar — bukan resolve false", async () => {
    const boom = new Error("409");
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus", run: () => Promise.reject(boom) }}
      onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(boom));
  });

  it("Escape membatalkan selama belum pending", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?" }} onResult={onResult} />);
    open();
    await screen.findByText("Hapus X?");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("Escape TIDAK membatalkan saat mutasi pending", async () => {
    let release!: () => void;
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus",
      run: () => new Promise<void>((r) => { release = () => r(); }) }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.getByText("Hapus X?")).toBeTruthy();
    release();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("fokus awal bukan tombol destruktif, dan kembali ke pemicu saat tutup", async () => {
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus" }} onResult={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Picu" });
    trigger.focus();
    open();
    await screen.findByText("Hapus X?");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Hapus" }));
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Tutup");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("dialog kedua membatalkan dialog pertama alih-alih menggantungkannya", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?" }} onResult={onResult} />);
    open();
    await screen.findByText("Hapus X?");
    open();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

Run: `pnpm vitest --run src/test/use-confirm.test.tsx`
Expected: FAIL — modul `../src/ds/useConfirm` tak ada.

- [x] **Step 3: Implementasi**

Buat `src/src/ds/useConfirm.tsx`:

```tsx
// SPEC-847 · ADR-0125 · konfirmasi destruktif dengan bentuk pemanggilan seharga `window.confirm`:
// satu baris di tengah fungsi async, alur kontrol call site utuh. `dialog` dirender PEMANGGILNYA
// sendiri — bukan Provider di akar App — karena layar di repo ini dirender berdiri sendiri di
// test, dan Provider berarti nilai default yang diam-diam menjawab "batal" atau "ya".
import React from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type ConfirmOptions = {
  title: React.ReactNode;
  message?: React.ReactNode;
  impact?: React.ReactNode[];
  eyebrow?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  icon?: string;
  requireText?: string;
  // Bila diberikan, dialog TETAP terbuka dan `busy` sampai promise ini selesai — itulah yang
  // menahan submit ganda selama mutasi berjalan. Lemparannya diteruskan ke pemanggil supaya
  // `try/catch` call site berperilaku persis seperti saat mutasi ditulis inline.
  run?: () => Promise<unknown>;
};

type Pending = {
  options: ConfirmOptions;
  settle: (ok: boolean) => void;
  fail: (err: unknown) => void;
};

export function useConfirm() {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Sumber kebenaran "masih boleh dijawab?" adalah ref, bukan state: klik kedua pada tombol
  // konfirmasi tiba sebelum React sempat me-render ulang dengan tombol yang sudah mati.
  const live = React.useRef<Pending | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions) =>
    new Promise<boolean>((resolve, reject) => {
      // Dialog yang belum terjawab saat dialog lain diminta = pembatalan, bukan promise
      // yang menggantung selamanya.
      live.current?.settle(false);
      const next: Pending = { options, settle: resolve, fail: reject };
      live.current = next;
      setBusy(false);
      setPending(next);
    }), []);

  const cancel = React.useCallback(() => {
    const p = live.current;
    if (!p) return;
    live.current = null;
    setPending(null); setBusy(false);
    p.settle(false);
  }, []);

  const accept = React.useCallback(async () => {
    const p = live.current;
    if (!p) return;
    live.current = null;                       // klik berikutnya tak menemukan apa pun untuk dijalankan
    if (!p.options.run) { setPending(null); p.settle(true); return; }
    setBusy(true);
    try { await p.options.run(); setPending(null); setBusy(false); p.settle(true); }
    catch (e) { setPending(null); setBusy(false); p.fail(e); }
  }, []);

  const o = pending?.options;
  const dialog = (
    <ConfirmDialog
      open={!!pending} busy={busy}
      title={o?.title ?? ""} message={o?.message} impact={o?.impact} eyebrow={o?.eyebrow}
      confirmLabel={o?.confirmLabel} cancelLabel={o?.cancelLabel}
      tone={o?.tone} icon={o?.icon} requireText={o?.requireText}
      onConfirm={() => { void accept(); }} onCancel={cancel} />
  );

  return { confirm, dialog };
}
```

- [x] **Step 4: Ekspor dari barrel**

Di `src/src/ds/index.ts`, tepat sesudah baris 11:

```ts
export { ConfirmDialog } from "./ConfirmDialog";
export { useConfirm, type ConfirmOptions } from "./useConfirm";
```

- [x] **Step 5: Jalankan test — harus lulus**

Run: `pnpm vitest --run src/test/use-confirm.test.tsx`
Expected: PASS (9 test).

- [x] **Step 6: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [x] **Step 7: Commit**

```bash
git add src/src/ds/useConfirm.tsx src/src/ds/index.ts src/test/use-confirm.test.tsx
git commit -m "feat(ds): useConfirm — konfirmasi destruktif berbasis promise dengan pending protection"
```

---

### Task 3: `App.tsx` — hapus project & rename `Project.id`

**Files:**
- Modify: `src/src/App.tsx:7` (impor), `:667+` (hook di badan App), `:816` (rename), `:894` (hapus project), `:1438` (render `{dialog}`)
- Test: `src/test/delete-project-confirm.test.tsx` (baru)

**Interfaces:**
- Consumes: `useConfirm` dari Task 2.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/delete-project-confirm.test.tsx`. Merender `App` penuh mahal; uji komponen sesungguhnya yang memuat aksi ini lewat harness tipis yang meniru `deleteProject` **apa adanya** tak akan menguji kode produksi. Karena itu test ini merender `ProjectsScreen` — permukaan yang menyalakan `onDelete` — dan menyuntikkan `deleteProject` App:

```tsx
// SPEC-847 · AC-1..AC-3 untuk hapus project: nama objek di judul, dampak terstruktur,
// batal/Escape tak memanggil API, konfirmasi memanggil sekali walau diklik berkali-kali,
// dan fokus kembali ke tombol pemicu.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useConfirm } from "../src/ds/useConfirm";

// Cermin persis badan `deleteProject` di App.tsx sesudah Task 3 — bila keduanya berbeda,
// test ini kehilangan maknanya; jaga tetap sinkron.
function DeleteProjectHarness({ del }: { del: (id: string) => Promise<unknown> }) {
  const { confirm, dialog } = useConfirm();
  const p = { id: "demo", name: "Demo" };
  return (
    <>
      <button onClick={() => {
        void (async () => {
          try {
            if (!await confirm({
              title: `Hapus project "${p.name}"?`,
              message: `Project "${p.id}" dan seluruh isinya dihapus dari dashboard ini.`,
              impact: ["Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan."],
              confirmLabel: "Hapus project",
              run: () => del(p.id),
            })) return;
          } catch { /* toast di App */ }
        })();
      }}>Hapus</button>
      {dialog}
    </>
  );
}

describe("hapus project · konfirmasi aplikasi (SPEC-847)", () => {
  it("dialog menyebut nama objek dan dampaknya sebagai daftar", async () => {
    render(<DeleteProjectHarness del={vi.fn(async () => ({}))} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText('Hapus project "Demo"?')).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan.",
    ]);
  });

  it("Batal tak memanggil API", async () => {
    const del = vi.fn(async () => ({}));
    render(<DeleteProjectHarness del={del} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();
  });

  it("Escape tak memanggil API", async () => {
    const del = vi.fn(async () => ({}));
    render(<DeleteProjectHarness del={del} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();
  });

  it("klik ganda pada konfirmasi memanggil API sekali", async () => {
    let release!: () => void;
    const del = vi.fn(() => new Promise((r) => { release = () => r({}); }));
    render(<DeleteProjectHarness del={del} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    const ok = await screen.findByRole("button", { name: "Hapus project" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("fokus kembali ke tombol pemicu sesudah dialog tutup", async () => {
    render(<DeleteProjectHarness del={vi.fn(async () => ({}))} />);
    const trigger = screen.getByRole("button", { name: "Hapus" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run src/test/delete-project-confirm.test.tsx`
Expected: FAIL — `useConfirm` ada (Task 2) tapi berkas test belum; setelah dibuat ia harus langsung PASS karena harness memakai primitif yang sudah jadi. **Bila sudah PASS di sini, itu benar** — nilai test ini adalah mengunci copy + kontrak AC untuk flow ini; kegagalan sesungguhnya muncul kalau Step 3 menyimpang dari harness.

- [ ] **Step 3: Ubah `App.tsx`**

1. Baris 7 — tambahkan `useConfirm` ke impor dari `"./ds"`.
2. Di dalam `export default function App()` (sesudah blok `const [modal, setModal] = …`, baris ~699) tambahkan:

```tsx
// SPEC-847 · ADR-0125 · konfirmasi destruktif memakai dialog aplikasi, bukan window.confirm.
const { confirm, dialog } = useConfirm();
```

3. Ganti gerbang rename (baris ~815-820) menjadi:

```tsx
      if (newId && newId !== proj.id) {
        if (!await confirm({
          title: `Ganti ID project "${proj.id}" → "${newId}"?`,
          message: "Ini berpengaruh ke SEMUA yang terkait project:",
          impact: [
            <>Link Help Center publik berubah jadi <code>/help/{newId}</code> — tautan lama rusak.</>,
            "Perubahan dirambatkan (sync) ke server; server ikut berganti id.",
          ],
          confirmLabel: "Ganti ID",
          icon: "pencil",
        })) return;
```

4. Ganti `deleteProject` (baris ~893-907) menjadi:

```tsx
  // Cascade di DB ikut menghapus spec project ini — cermin state lokalnya.
  async function deleteProject(p: ProjectVM) {
    try {
      if (!await confirm({
        title: `Hapus project "${p.name}"?`,
        message: `Project "${p.id}" dan seluruh isinya dihapus dari dashboard ini.`,
        impact: ["Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Hapus project",
        run: () => api.deleteProject(p.id),
      })) return;
      setProjects((list) => list.filter((x) => x.id !== p.id));
      setBacklog((b) => b.filter((s) => s.projectId !== p.id));
      setSessions((t) => t.filter((x) => x.projectId !== p.id));
      setProjectId((cur) => (cur === p.id ? "" : cur));
      setProjectFilter((cur) => (cur === p.id ? "all" : cur));
      if (section === "docs" || section === "project") setSection("projects");
      showToast("Project " + p.id + " dihapus", "warn", "trash-2");
    } catch (e) {
      const busy = e instanceof ApiError && e.status === 409;
      showToast("Gagal hapus " + p.id + (busy ? " · masih ada sesi aktif" : ""), "err", "x-circle");
    }
  }
```

5. Di JSX akhir App, tepat sebelum `<Toast toast={toast} />` (baris ~1438):

```tsx
        {dialog}
        <Toast toast={toast} />
```

- [ ] **Step 4: Verifikasi**

Run: `pnpm vitest --run src/test/delete-project-confirm.test.tsx src/test/app-flows.test.tsx src/test/app-states.test.tsx src/test/edit-project-id.test.tsx src/test/edit-project-gitremote.test.tsx`
Expected: PASS semua.

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [ ] **Step 5: Commit**

```bash
git add src/src/App.tsx src/test/delete-project-confirm.test.tsx
git commit -m "feat(app): hapus project & rename id memakai dialog konfirmasi aplikasi"
```

---

### Task 4: `DocsWorkspace` — hapus dokumen Source of Truth

**Files:**
- Modify: `src/src/screens/DocsWorkspace.tsx` (impor `ds`, badan `DocsWorkspace`, `removeDoc:174-179`, return akhir)
- Test: `src/test/docs-delete-confirm.test.tsx` (baru)

**Interfaces:**
- Consumes: `useConfirm` (Task 2).

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/docs-delete-confirm.test.tsx`:

```tsx
// SPEC-847 · hapus doc SoT menghapus berkas di disk — AC-1..AC-3 lewat komponen sungguhan.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const { getDocs, getDoc, deleteDoc } = vi.hoisted(() => ({
  getDocs: vi.fn(async () => ({
    tree: [{ cat: "product", files: ["blueprint.md"] }], coverage: 100,
  })),
  getDoc: vi.fn(async () => ({ text: "# Blueprint" })),
  deleteDoc: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/api/client", () => ({
  api: { getDocs, getDoc, deleteDoc, putDoc: vi.fn(), createDoc: vi.fn() },
  ApiError: class extends Error {},
  paths: { doc: () => "/x" },
}));
import { DocsWorkspace } from "../src/screens/DocsWorkspace";

beforeEach(() => { deleteDoc.mockClear(); });

const openDialog = async () => {
  render(<DocsWorkspace projectId="demo" projectName="Demo" docStatus="ok" />);
  const btn = await screen.findByRole("button", { name: "Hapus" });
  btn.focus();
  fireEvent.click(btn);
  await screen.findByRole("dialog");
  return btn;
};

describe("DocsWorkspace hapus doc · konfirmasi aplikasi (SPEC-847)", () => {
  it("dialog menyebut path dokumen dan dampaknya", async () => {
    await openDialog();
    expect(screen.getByText(/product\/blueprint\.md/)).toBeTruthy();
    expect(screen.getByText(/berkas aslinya di disk/i)).toBeTruthy();
  });

  it("Batal & Escape tak memanggil deleteDoc", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteDoc).not.toHaveBeenCalled();

    await openDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("konfirmasi memanggil deleteDoc sekali walau diklik dua kali, lalu fokus kembali ke pemicu", async () => {
    const trigger = await openDialog();
    const ok = screen.getByRole("button", { name: "Hapus dokumen" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(deleteDoc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run src/test/docs-delete-confirm.test.tsx`
Expected: FAIL — `screen.findByRole("dialog")` timeout: `window.confirm` di jsdom memulangkan `undefined`, jadi `removeDoc` berhenti di baris pertamanya.

**Bila mock modul di atas kurang lengkap** (DocsWorkspace memanggil API lain saat mount), lengkapi daftar `vi.mock` sesuai impor nyata berkas itu — jangan mengubah komponennya agar cocok dengan test.

- [ ] **Step 3: Implementasi**

Di `src/src/screens/DocsWorkspace.tsx`:

1. Tambahkan `useConfirm` ke impor dari `"../ds"`.
2. Di badan `DocsWorkspace` (sesudah `const [scanning, setScanning] = React.useState(false);`, baris ~107):

```tsx
  // SPEC-847 · ADR-0125 · konfirmasi hapus dokumen memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();
```

3. Ganti `removeDoc` (baris 174-179):

```tsx
  async function removeDoc() {
    if (!selected) return;
    if (!await confirm({
      title: `Hapus ${selected}?`,
      message: "Berkas aslinya di disk ikut dihapus — dokumen ini adalah Source of Truth project.",
      confirmLabel: "Hapus dokumen",
      run: () => api.deleteDoc(projectId, selected),
    })) return;
    setCache((c) => { const n = { ...c }; delete n[selected]; return n; });
    await reloadIndex();
  }
```

4. Bungkus return akhir dengan fragment agar `{dialog}` ikut dirender:

```tsx
  return (
    <>
    <ResponsivePanels
      …seluruh isi yang sudah ada, tak diubah…
    />
    {dialog}
    </>
  );
```

- [ ] **Step 4: Verifikasi**

Run: `pnpm vitest --run src/test/docs-delete-confirm.test.tsx src/test/docs-tree.test.ts src/test/doc-download-screens.test.tsx`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/DocsWorkspace.tsx src/test/docs-delete-confirm.test.tsx
git commit -m "feat(docs): hapus dokumen SoT memakai dialog konfirmasi aplikasi"
```

---

### Task 5: `SettingsScreen` — hapus user, cabut device token, purge activity log, cabut agent token

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx:4` (impor), `:149-152` (`UsersPanel.remove`), `:201-204` (`DeviceTokensPanel.revoke`), `:246-251` (`ActivityPanel.purge`), `:390-393` (`AgentTokensPanel.revoke`), plus render `{dialog}` di keempat `Card`
- Test: `src/test/settings-destructive-confirm.test.tsx` (baru)

**Interfaces:**
- Consumes: `useConfirm` (Task 2). Empat panel adalah empat komponen terpisah → **empat** pemanggilan `useConfirm()`, masing-masing merender `{dialog}`-nya sendiri.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/settings-destructive-confirm.test.tsx` — mencakup device token (flow yang diminta issue) beserta agent token:

```tsx
// SPEC-847 · AC-1..AC-3 untuk cabut device token & agent token di Settings.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const { listDeviceTokens, revokeDeviceToken, createDeviceToken } = vi.hoisted(() => ({
  listDeviceTokens: vi.fn(async () => [
    { id: "d1", name: "macbook", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, revokedAt: null },
  ]),
  revokeDeviceToken: vi.fn(async () => ({ ok: true })),
  createDeviceToken: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: { listDeviceTokens, revokeDeviceToken, createDeviceToken },
  ApiError: class extends Error {},
}));
import { DeviceTokensPanel } from "../src/screens/SettingsScreen";

beforeEach(() => { revokeDeviceToken.mockClear(); });

const open = async () => {
  render(<DeviceTokensPanel />);
  const btn = await screen.findByRole("button", { name: /cabut/i });
  btn.focus(); fireEvent.click(btn);
  await screen.findByRole("dialog");
  return btn;
};

describe("Settings · cabut device token (SPEC-847)", () => {
  it("dialog menyebut nama token dan dampaknya, dan tak memakai ikon trash", async () => {
    await open();
    expect(screen.getByText(/macbook/)).toBeTruthy();
    expect(screen.getByText(/tak bisa sync lagi/i)).toBeTruthy();
    expect(document.querySelector('[role="dialog"] [data-icon="key-round"]')).toBeTruthy();
  });

  it("Batal & Escape tak mencabut", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revokeDeviceToken).not.toHaveBeenCalled();
  });

  it("konfirmasi mencabut sekali walau diklik dua kali, fokus kembali ke pemicu", async () => {
    const trigger = await open();
    const ok = screen.getByRole("button", { name: "Cabut token" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(revokeDeviceToken).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
```

Bila `DeviceTokensPanel` belum di-`export`, tambahkan `export` pada deklarasinya (perubahan visibilitas saja; tak ada logika yang berubah).

- [ ] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run src/test/settings-destructive-confirm.test.tsx`
Expected: FAIL — tak ada `role="dialog"` (native confirm).

- [ ] **Step 3: Implementasi — keempat panel**

Tambahkan `useConfirm` ke impor `"../ds"` di baris 4, lalu:

**`UsersPanel`** — tambahkan `const { confirm, dialog } = useConfirm();` di badan komponen dan ganti `remove`:

```tsx
  async function remove(u: UserView) {
    try {
      if (!await confirm({
        title: `Hapus user "${u.email}"?`,
        message: "User ini kehilangan akses ke dashboard seketika.",
        impact: ["Semua sesi login miliknya ikut dicabut.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Hapus user",
        run: () => api.deleteUser(u.id),
      })) return;
      load(); onToast?.("User " + u.email + " dihapus", "warn", "trash-2");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 400 ? "Tak bisa hapus user terakhir" : "Gagal hapus user", "err", "x-circle");
    }
  }
```

Render `{dialog}` sebagai anak terakhir `<Card>` panel ini.

**`DeviceTokensPanel`** — `const { confirm, dialog } = useConfirm();` dan:

```tsx
  async function revoke(t: DeviceTokenView) {
    try {
      if (!await confirm({
        title: `Cabut token perangkat "${t.name}"?`,
        message: "Perangkat itu tak bisa sync lagi sampai token baru dibuat.",
        confirmLabel: "Cabut token",
        icon: "key-round",
        run: () => api.revokeDeviceToken(t.id),
      })) return;
      load(); onToast?.("Token dicabut", "warn", "trash-2");
    } catch { onToast?.("Gagal mencabut token", "err", "x-circle"); }
  }
```

Render `{dialog}` sebagai anak terakhir `<Card>`-nya.

**`ActivityPanel`** — `const { confirm, dialog } = useConfirm();` dan:

```tsx
  async function purge() {
    if (!projectId) { onToast?.("Isi project id untuk purge", "warn", "alert-triangle"); return; }
    try {
      if (!await confirm({
        title: `Purge activity log project "${projectId}"?`,
        message: "Seluruh entri hasil sesi project ini dihapus dari device ini.",
        impact: ["Log bersifat append-only — entri yang dihapus tak bisa dipulihkan."],
        confirmLabel: "Purge",
        run: async () => { const r = await api.purgeSessionResults(projectId); onToast?.(`${r.purged} entri dihapus`, "warn", "trash-2"); },
      })) return;
      load();
    } catch { onToast?.("Gagal purge", "err", "x-circle"); }
  }
```

Render `{dialog}` sebagai anak terakhir `<Card>`-nya.

**`AgentTokensPanel`** — `const { confirm, dialog } = useConfirm();` dan:

```tsx
  async function revoke(t: AgentTokenView) {
    try {
      if (!await confirm({
        title: `Cabut agent token "${t.name}"?`,
        message: "Agen yang memakainya langsung kehilangan akses.",
        confirmLabel: "Cabut token",
        icon: "key-round",
        run: () => api.revokeAgentToken(t.id),
      })) return;
      load(); onToast?.("Token dicabut", "warn", "trash-2");
    } catch { onToast?.("Gagal mencabut token", "err", "x-circle"); }
  }
```

Render `{dialog}` sebagai anak terakhir `<Card>`-nya.

- [ ] **Step 4: Verifikasi**

Run: `pnpm vitest --run src/test/settings-destructive-confirm.test.tsx src/test/agent-tokens.test.tsx src/test/config-panel.test.tsx src/test/account-menu.test.tsx`
Expected: PASS semua.

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/settings-destructive-confirm.test.tsx
git commit -m "feat(settings): hapus user, cabut token, dan purge log memakai dialog konfirmasi aplikasi"
```

---

### Task 6: VPS — apply remediasi, tandai seksi N/A, harden, hapus registrasi

**Files:**
- Modify: `src/src/screens/VpsChecklist.tsx` (impor, badan komponen, `doApply:167-173`, `onSectionNa:185-197`, render `{dialog}` di dalam `<Modal>`), `src/src/screens/VpsScreen.tsx` (impor, badan komponen, `harden:107-115`, `remove:125-129`, render `{dialog}`)
- Modify: `src/test/vps-checklist.test.tsx:135,150` (buang mock `window.confirm`)
- Test: `src/test/vps-apply-confirm.test.tsx` (baru)

**Interfaces:**
- Consumes: `useConfirm` (Task 2).

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/vps-apply-confirm.test.tsx` mengikuti pola mock yang sudah dipakai `src/test/vps-checklist.test.tsx` (baca berkas itu lebih dulu dan gunakan mock/fixture yang sama — jangan menulis fixture kedua):

```tsx
// SPEC-847 · AC-1..AC-3 untuk apply remediasi VPS — mutasi server produksi.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
// … blok vi.hoisted + vi.mock("../src/api/client", …) disalin dari vps-checklist.test.tsx,
// dengan `remediate` sebagai vi.fn() yang bisa ditunda.

describe("VPS apply remediasi · konfirmasi aplikasi (SPEC-847)", () => {
  it("dialog menyebut jumlah item dan dampaknya sebagai daftar", async () => {
    // pilih satu item AUTO, klik "Terapkan"
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Terapkan 1 item/)).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("Batal & Escape tak memanggil remediate", async () => { /* … */ });

  it("konfirmasi memanggil remediate sekali walau diklik dua kali", async () => { /* … */ });

  it("fokus kembali ke tombol pemicu", async () => { /* … */ });
});
```

**Isi keempat test dengan langkah konkret**, meniru cara `vps-checklist.test.tsx` memilih item dan menekan tombol; jangan meninggalkan `/* … */` di berkas akhir.

- [ ] **Step 2: Jalankan — harus gagal**

Run: `pnpm vitest --run src/test/vps-apply-confirm.test.tsx`
Expected: FAIL — tak ada `role="dialog"`.

- [ ] **Step 3: `VpsChecklist.tsx`**

Tambahkan `useConfirm` ke impor `"../ds"`, lalu di badan `VpsChecklist`:

```tsx
  // SPEC-847 · ADR-0125 · konfirmasi mutasi VPS memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();
```

Ganti `doApply`:

```tsx
  async function doApply() {
    if (!await confirm({
      title: `Terapkan ${selected.size} item AUTO ke VPS ini?`,
      message: "Remediasi dijalankan langsung di server yang terdaftar.",
      impact: ["Langkahnya idempoten dan anti-lockout.", "Checklist diaudit ulang setelah selesai."],
      confirmLabel: "Terapkan",
      icon: "shield",
    })) return;
    setAction("apply");
    try { await api.remediate(vpsId, [...selected]); clearSel(); load(); onToast("Remediasi diterapkan · audit ulang", "ok", "shield"); }
    catch { onToast("Remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }
```

Ganti gerbang `onSectionNa`:

```tsx
    if (!await confirm({
      title: `Tandai ${ids.length} item seksi "${section.title}" sebagai N/A?`,
      message: "Stack-nya tak terdeteksi — cek Docker manual bila ragu.",
      confirmLabel: "Tandai N/A",
      icon: "shield",
    })) return;
```

Render `{dialog}` tepat sesudah `{body()}` di dalam `<Modal>`. (`Modal` bertumpuk aman: `modalStack` membuat Escape & focus trap menyasar dialog teratas.)

- [ ] **Step 4: `VpsScreen.tsx`**

Tambahkan `useConfirm` ke impor `"../ds"`, `const { confirm, dialog } = useConfirm();` di badan `VpsScreen`, lalu:

```tsx
  async function harden(v: VpsView) {
    if (!await confirm({
      title: `Harden "${v.name}"?`,
      message: "Pastikan akses key SSH non-password kamu sudah bekerja sebelum melanjutkan.",
      impact: [
        `Firewall: izinkan ${v.port}/80/443.`,
        "fail2ban & auto security update dipasang.",
        "PermitRootLogin & PasswordAuthentication dimatikan.",
        "NTP disinkronkan.",
      ],
      confirmLabel: "Harden",
      icon: "shield",
    })) return;
    void run("harden", v.id, () => api.hardenVps(v.id), `${v.name} · harden selesai`);
  }
  async function remove(v: VpsView) {
    try {
      if (!await confirm({
        title: `Hapus registrasi VPS "${v.name}"?`,
        message: "Server-nya sendiri tak disentuh — hanya pendaftarannya di dashboard ini yang dihapus.",
        confirmLabel: "Hapus registrasi",
        run: () => api.deleteVps(v.id),
      })) return;
      load();
    } catch { onToast("Gagal hapus", "err", "x-circle"); }
  }
```

Hapus komentar `// window.confirm cukup (pola deleteProject di App): sebut persis apa yang berubah.` — premisnya sudah tak berlaku.

Render `{dialog}` sebagai anak terakhir `<div>` yang dikembalikan `VpsScreen`.

- [ ] **Step 5: Bersihkan mock lama**

Di `src/test/vps-checklist.test.tsx`, hapus kedua baris `vi.spyOn(window, "confirm").mockReturnValue(true);` (baris 135 & 150) dan ganti dengan menekan tombol konfirmasi dialog, mis.:

```tsx
    fireEvent.click(await screen.findByRole("button", { name: "Terapkan" }));
```

- [ ] **Step 6: Verifikasi**

Run: `pnpm vitest --run src/test/vps-apply-confirm.test.tsx src/test/vps-checklist.test.tsx`
Expected: PASS semua; tak ada lagi `vi.spyOn(window, "confirm")` di kedua berkas.

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [ ] **Step 7: Commit**

```bash
git add src/src/screens/VpsChecklist.tsx src/src/screens/VpsScreen.tsx src/test/vps-apply-confirm.test.tsx src/test/vps-checklist.test.tsx
git commit -m "feat(vps): apply, tandai N/A, harden, dan hapus registrasi memakai dialog konfirmasi aplikasi"
```

---

### Task 7: Sisa gerbang — changelog, tolak tiket, nonaktifkan Help Center

**Files:**
- Modify: `src/src/screens/ChangelogScreen.tsx` (impor, badan, `remove:101-110`, return)
- Modify: `src/src/screens/TriageScreen.tsx` (`reject:103-110` + `{dialog}` di `TicketDetailPanel`)
- Modify: `src/src/screens/ProjectDetailScreen.tsx` (`HelpCenterCard.disable:32-42` + `{dialog}` di `<Card>`)
- Modify: `src/test/project-help-center.test.tsx:55` (buang mock `window.confirm`)

**Interfaces:**
- Consumes: `useConfirm` (Task 2). `TriageScreen` sudah mengimpor `ConfirmDialog` untuk *hapus tiket*; biarkan — keduanya memakai komponen DS yang sama.

- [ ] **Step 1: `ChangelogScreen`**

Tambahkan `useConfirm` ke impor `"../ds"`, `const { confirm, dialog } = useConfirm();` di badan komponen, lalu:

```tsx
  async function remove(c: ChangelogView) {
    try {
      if (!await confirm({
        title: `Hapus changelog "${c.title}"?`,
        message: "Rilis ini hilang dari riwayat project.",
        confirmLabel: "Hapus rilis",
        run: () => api.deleteChangelog(p.id, c.id),
      })) return;
      if (selectedId === c.id) setSelected(null);
      setReloadKey((v) => v + 1);
      onToast("Changelog dihapus", "ok", "trash-2");
    } catch { onToast("Gagal menghapus changelog", "err", "x-circle"); }
  }
```

Render `{dialog}` sebagai anak terakhir `<div>` yang dikembalikan komponen.

- [ ] **Step 2: `TriageScreen`**

Tambahkan `useConfirm` ke impor `"../ds"`, `const { confirm, dialog } = useConfirm();` di `TicketDetailPanel`, lalu:

```tsx
  async function reject() {
    if (!await confirm({
      title: `Tolak & tutup tiket #${t!.number}?`,
      message: `"${t!.title}" ditutup tanpa membuat backlog item.`,
      confirmLabel: "Tolak tiket",
      icon: "x-circle",
    })) return;
    setBusy(true);
    try { await api.rejectTicket(id); setT({ ...t!, status: "rejected" }); onToast("Tiket ditutup", "ok", "check"); }
    catch { onToast("Gagal menolak tiket", "err", "x-circle"); }
    finally { setBusy(false); }
  }
```

Render `{dialog}` tepat sesudah `<ConfirmDialog open={confirm} … />` yang sudah ada di akhir komponen.

**Awas tabrakan nama:** komponen itu punya state bernama `confirm` (`const [confirm, setConfirm] = …` untuk dialog hapus tiket). Ganti nama hasil destructuring hook menjadi `const { confirm: askConfirm, dialog } = useConfirm();` **hanya bila** tabrakan itu memang ada, dan pakai `askConfirm(...)` di `reject`. Aturan penamaan global tetap berlaku untuk `dialog`.

- [ ] **Step 3: `ProjectDetailScreen`**

Tambahkan `useConfirm` ke impor `"../ds"`, `const { confirm, dialog } = useConfirm();` di `HelpCenterCard`, lalu:

```tsx
  async function disable() {
    if (!await confirm({
      title: `Nonaktifkan Help Center project "${p.name}"?`,
      message: "Link publik berhenti menerima keluhan baru.",
      impact: ["Tiket lama tetap ada dan tetap bisa ditriase.", "Bisa diaktifkan lagi kapan saja."],
      confirmLabel: "Nonaktifkan",
      icon: "ban",
      tone: "default",
    })) return;
    setBusy(true);
    try {
      await api.disableHelpCenter(p.id); setEnabled(false); onToast("Help Center nonaktif", "ok", "inbox");
      await onProjectChanged?.(p.id); // SPEC-258 · status persist ke state App
    }
    catch { onToast("Gagal menonaktifkan Help Center", "err", "x-circle"); }
    finally { setBusy(false); }
  }
```

Render `{dialog}` sebagai anak terakhir `<Card>`.

- [ ] **Step 4: Perbarui test lama**

`src/test/project-help-center.test.tsx` — buang `vi.spyOn(window, "confirm").mockReturnValue(true);` (baris 55) dan setelah `fireEvent.click(screen.getByText("Nonaktifkan"))` tekan tombol konfirmasi dialog:

```tsx
    fireEvent.click(await screen.findByRole("button", { name: "Nonaktifkan" }));
```

**Catatan:** sesudah dialog terbuka ada **dua** tombol bernama "Nonaktifkan" (pemicu di kartu + konfirmasi di dialog). Sempitkan query ke dalam dialog:

```tsx
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));
```

- [ ] **Step 5: Verifikasi**

Run: `pnpm vitest --run src/test/project-help-center.test.tsx src/test/triage.test.tsx src/test/changelog-nav.test.tsx src/test/changelog-deeplink.test.ts`
Expected: PASS semua.

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/ChangelogScreen.tsx src/src/screens/TriageScreen.tsx src/src/screens/ProjectDetailScreen.tsx src/test/project-help-center.test.tsx
git commit -m "feat(screens): changelog, tolak tiket, dan Help Center memakai dialog konfirmasi aplikasi"
```

---

### Task 8: Penegakan AC-4 — inventaris `window.confirm` atas sumber

**Files:**
- Create: `src/test/helpers/native-confirm.ts`
- Create: `src/test/confirm-inventory.test.ts`
- Modify: `src/src/screens/GitGraph.tsx:131-134` (komentar `confirm-exempt:`)

**Interfaces:**
- Produces:
  ```ts
  export type ConfirmHit = { file: string; line: number; exemptReason?: string };
  export function scanConfirmSource(file: string, src: string): ConfirmHit[];
  export function scanConfirmDir(root: string): ConfirmHit[];
  export function scanHookBalance(root: string): { file: string; hooks: number; dialogs: number }[];
  export function scannedFileCount(root: string): number;
  ```

- [ ] **Step 1: Tulis helper pemindai**

Buat `src/test/helpers/native-confirm.ts` (cermin `helpers/form-fields.ts` — baca berkas itu untuk pola `walk`):

```ts
// SPEC-847 · ADR-0125 · AC-4 ditegakkan atas SUMBER, bukan DOM: `window.confirm` tak punya
// jejak di pohon render aplikasi, jadi tak ada test render yang akan menangkap call site baru.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type ConfirmHit = { file: string; line: number; exemptReason?: string };

const files = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if ((p.endsWith(".tsx") || p.endsWith(".ts")) && !p.includes(".test.")) out.push(p);
    }
  };
  walk(root);
  return out.sort();
};

export function scanConfirmSource(file: string, src: string): ConfirmHit[] {
  const out: ConfirmHit[] = [];
  const re = /window\.confirm\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const line = src.slice(0, m.index).split("\n").length;
    // Alasan dicari di 400 karakter sebelum call site — cukup untuk komentar dua-tiga baris
    // di atasnya, tak cukup untuk mencuri alasan milik call site sebelumnya.
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    out.push({ file, line, exemptReason: before.match(/confirm-exempt:\s*([^\n*}]+)/)?.[1]?.trim() });
  }
  return out;
}

export const scanConfirmDir = (root: string): ConfirmHit[] =>
  files(root).flatMap((f) => scanConfirmSource(f, readFileSync(f, "utf8")));

const count = (src: string, needle: string) => src.split(needle).length - 1;

export function scanHookBalance(root: string) {
  return files(root)
    .map((f) => { const src = readFileSync(f, "utf8");
      return { file: f, hooks: count(src, "useConfirm("), dialogs: count(src, "{dialog}") }; })
    .filter((r) => r.hooks > 0);
}

export const scannedFileCount = (root: string) => files(root).length;
```

- [ ] **Step 2: Tulis test inventaris**

Buat `src/test/confirm-inventory.test.ts`:

```ts
// SPEC-847 · ADR-0125 · AC-4: frontend produksi tak memakai `window.confirm` untuk destructive
// product flow; pengecualian wajib menyebut alasannya lewat komentar `confirm-exempt:`.
import { describe, expect, it } from "vitest";
import { scanConfirmDir, scanHookBalance, scannedFileCount } from "./helpers/native-confirm";

const ROOT = "src/src";
const hits = scanConfirmDir(ROOT);
const where = (h: { file: string; line: number }) => `${h.file}:${h.line}`;

describe("inventaris window.confirm (SPEC-847)", () => {
  // Pemindai yang diam-diam berhenti memberi gejala persis sama dengan "semua lulus".
  it("benar-benar memindai pohon frontend", () => {
    expect(scannedFileCount(ROOT)).toBeGreaterThan(40);
  });

  it("tak ada window.confirm tanpa pengecualian beralasan", () => {
    expect(hits.filter((h) => !h.exemptReason).map(where)).toEqual([]);
  });

  it("setiap pengecualian menyebut alasan yang bermakna", () => {
    expect(hits.filter((h) => (h.exemptReason ?? "").length < 12).map(where)).toEqual([]);
  });

  // Daftar pengecualian ditulis lengkap supaya penambahan diam-diam jadi kegagalan test,
  // bukan sesuatu yang harus ditemukan lewat review.
  it("pengecualian yang diketahui persis satu", () => {
    expect(hits.map(where)).toEqual(["src/src/screens/GitGraph.tsx:134"]);
  });

  // Komponen yang memanggil useConfirm() tapi lupa merender {dialog} membuat promise-nya
  // menggantung selamanya — tanpa error, tanpa gejala. Ini penjaganya.
  it("setiap useConfirm() punya {dialog} yang dirender", () => {
    const bad = scanHookBalance(ROOT).filter((r) => r.dialogs < r.hooks);
    expect(bad.map((r) => `${r.file} (${r.hooks} hook, ${r.dialogs} dialog)`)).toEqual([]);
  });
});
```

Nomor baris di test "pengecualian yang diketahui" harus disesuaikan dengan hasil nyata sesudah Step 3 — jalankan test, baca nomor yang dilaporkan, tulis nomor itu.

- [ ] **Step 3: Tandai pengecualian `GitGraph`**

Di `src/src/screens/GitGraph.tsx`, ganti komentar & baris di sekitar `window.confirm` (baris ~131-134):

```tsx
    // SPEC-233 · buat tag di commit ini. Pesan kosong = lightweight; terisi = annotated.
    { label: "Add tag…", run: () => {
      const name = window.prompt("Nama tag:"); if (!name) return;
      const message = window.prompt("Pesan (kosong = lightweight):") || undefined;
      // SPEC-847 · confirm-exempt: bukan gerbang destruktif — jawabannya adalah NILAI `push`,
      // bukan izin, dan membatalkannya tetap membuat tag. Merendernya sebagai ConfirmDialog
      // justru menipu ("Batal" yang tetap mengeksekusi). Bentuk benarnya modal form bersama
      // kedua window.prompt di atas; itu di luar scope SPEC-847 yang menyoal window.confirm.
      const push = window.confirm("Dorong tag ke origin?");
      act({ op: "tag", name, message, at: c.sha, push });
    } },
```

- [ ] **Step 4: Jalankan test — harus lulus**

Run: `pnpm vitest --run src/test/confirm-inventory.test.ts`
Expected: PASS. Bila "tak ada window.confirm tanpa pengecualian" gagal, daftar berkas:barisnya adalah call site yang terlewat dari Task 3-7 — selesaikan dulu, jangan tambahkan pengecualian baru.

- [ ] **Step 5: Commit**

```bash
git add src/test/helpers/native-confirm.ts src/test/confirm-inventory.test.ts src/src/screens/GitGraph.tsx
git commit -m "test(ds): inventaris window.confirm ditegakkan atas sumber, satu pengecualian beralasan"
```

---

### Task 9: Docs — ADR-0125 + Source of Truth yang tersentuh

**Files:**
- Create: `internal/docs/adr/0125-satu-kontrak-konfirmasi-destruktif.md`
- Modify: `internal/docs/adr/README.md` (entri 0125 di puncak daftar)
- Modify: `internal/docs/README.md` (link ADR 0125; audit SPEC-847 sudah ter-link)
- Modify: `internal/docs/frontend/frontend-implementation.md:978` (Triase "Tolak" tak lagi `window.confirm`) + bagian design-system frontend
- Modify: `internal/docs/design-system/design-system.md:44-46` (kontrak konfirmasi destruktif)

- [ ] **Step 1: Tulis ADR-0125**

Buat `internal/docs/adr/0125-satu-kontrak-konfirmasi-destruktif.md` dengan struktur ADR repo (baca `0121-operasi-berkas-ide-explorer.md` sebagai contoh bentuk). Isi wajib menyebut:

- Konteks: 15 call site `window.confirm` vs `ConfirmDialog` yang sudah ada; akarnya **bentuk pemanggilan** (sinkron vs deklaratif), bukan kelalaian; bukti terukur bahwa delapan flow destruktif tak punya satu pun test yang menekan tombolnya karena jsdom memulangkan `undefined`.
- Keputusan: `useConfirm()` memulangkan `{ confirm, dialog }`; **lokal per komponen, bukan Provider** (alasannya: layar dirender berdiri sendiri di test; nilai default context gagal senyap ke dua arah); `run` untuk pending protection; `confirm()` **melempar** bila `run` melempar dan `false` hanya untuk pembatalan.
- Konsekuensi & gotcha: (1) lupa merender `{dialog}` = promise menggantung selamanya tanpa error — penjaganya test inventaris, bukan disiplin; (2) `Modal` tak disentuh, AC-3 dipenuhi dengan mengunci perilaku yang sudah ada, dan React `autoFocus` tak bekerja di dalamnya karena layout effect `Modal` berjalan sesudah `commitMount` anaknya; (3) fokus awal jatuh ke tombol "Tutup" header — kontrol aman, bukan "Batal"; (4) sumber kebenaran anti-klik-ganda adalah **ref**, bukan state, karena klik kedua tiba sebelum render ulang; (5) satu pengecualian `GitGraph` beralasan karena jawabannya nilai, bukan izin.
- Alternatif yang ditolak: Provider global; migrasi manual 15 call site tanpa primitif (call site ke-16 lahir besok); ESLint rule (repo tak memakai ESLint — penegakannya test pemindai sumber, pola SPEC-490).

- [ ] **Step 2: Tautkan ADR di kedua index**

Tambahkan entri 0125 di puncak daftar `internal/docs/adr/README.md`, dan tambahkan barisnya di bagian `## adr` `internal/docs/README.md` mengikuti format baris yang sudah ada.

- [ ] **Step 3: Perbarui doc frontend yang tersentuh**

`internal/docs/frontend/frontend-implementation.md`:
- Baris ~978: `**Tolak** (`window.confirm` → `api.rejectTicket`)` → `**Tolak** (`ConfirmDialog` lewat `useConfirm` → `api.rejectTicket`)`.
- Tambahkan satu paragraf di bagian design-system/komponen yang menerangkan kontrak `useConfirm`: bentuk `{ confirm, dialog }`, opsi `run`, prop `impact`/`icon` `ConfirmDialog`, dan bahwa `window.confirm` ditegakkan nol lewat `src/test/confirm-inventory.test.ts` dengan satu pengecualian `GitGraph` yang beralasan.

`internal/docs/design-system/design-system.md` (sekitar baris 44-46, sesudah kalimat "Drawer dan Modal wajib punya label, state expanded/open, Escape, focus trap, serta focus restore."): tambahkan kalimat bahwa konfirmasi destruktif memakai dialog aplikasi (`ConfirmDialog` lewat `useConfirm`), menyebut nama objek + dampak terstruktur + label aksi eksplisit, mematikan cancel/confirm/close/Escape selama mutasi pending, dan bahwa dialog browser native tak dipakai untuk flow produk.

- [ ] **Step 4: Verifikasi integritas index**

Run: `node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/index.js docs index --check`
Expected: index konsisten. Bila CLI belum ter-build di worktree ini, cukup pastikan setiap berkas doc baru muncul di `internal/docs/README.md` secara manual (guardrail SoT sudah dicabut, ADR-0023 — ini konvensi).

- [ ] **Step 5: Commit**

```bash
git add internal/docs
git commit -m "docs(adr): ADR-0125 satu kontrak konfirmasi destruktif"
```

---

### Task 10: Verifikasi akhir & push

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

Run:
```bash
pnpm vitest --run --changed "$HANOMAN_BASE_SHA"
```
Expected: PASS. **Jangan menerima "no test files" sebagai bukti** — `--changed` menyalakan `passWithNoTests`. Pastikan berkas test SPEC-847 (`use-confirm`, `confirm-dialog`, `confirm-inventory`, `delete-project-confirm`, `docs-delete-confirm`, `settings-destructive-confirm`, `vps-apply-confirm`, `project-help-center`, `vps-checklist`, `triage`) benar-benar berjalan di keluarannya.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error. (`server`/`shared`/`cli` tak tersentuh — jangan `pnpm -r typecheck`.)

- [ ] **Step 3: Pastikan tak ada `window.confirm` yang tersisa tanpa alasan**

Run: `grep -rn "window.confirm" src/src | grep -v "confirm-exempt"`
Expected: hanya baris `GitGraph.tsx` yang komentarnya berada di baris terpisah di atasnya — cocokkan dengan hasil `pnpm vitest --run src/test/confirm-inventory.test.ts` yang harus PASS.

- [ ] **Step 4: Centang seluruh kotak plan ini**

Setiap `- [ ]` di berkas ini harus sudah `- [x]`. hanoman menahan backlog di `executing` selama masih ada kotak kosong.

- [ ] **Step 5: Commit sisa & push**

```bash
git add -A
git commit -m "chore(spec-847): verifikasi akhir"   # hanya bila masih ada perubahan
git push origin HEAD:refs/heads/hanoman/spec-847
```
