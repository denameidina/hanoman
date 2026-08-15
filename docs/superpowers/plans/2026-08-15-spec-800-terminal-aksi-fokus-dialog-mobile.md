# SPEC-800 — Terminal: aksi terjangkau, ketikan tak hilang, dialog claude bisa dijawab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat setiap aksi halaman Terminal terjangkau di lebar berapa pun, menghentikan hilangnya
ketikan saat socket terminal tertutup, dan memberi operator (termasuk di ponsel tanpa keyboard fisik)
jalan untuk menjawab dialog pilihan claude serta membaca output dengan nyaman.

**Architecture:** Empat perbaikan terpisah pada dua berkas terpanas halaman Terminal plus satu
komponen DS baru. Semua aritmetika keputusan (berapa aksi muat inline, apakah sebuah baris layar
adalah opsi dialog, jepitan ukuran font, tabel keystroke) hidup di satu modul murni
`screens/terminal-chrome.ts` supaya teruji tanpa layout engine; komponen hanya mengamati lebar
kontainernya lewat `ResizeObserver` dan memanggil fungsi murni itu.

**Tech Stack:** React 18 + TypeScript (Vite), `@xterm/xterm` 6.0.0 + `@xterm/addon-fit`,
vitest + jsdom + @testing-library/react, design system hanoman (`src/src/ds/**`).

## Global Constraints

- Tidak ada perubahan skema Prisma, migration, endpoint HTTP, atau payload WebSocket. Bila sebuah
  langkah tampak menuntutnya, langkah itu salah — berhenti dan tanya.
- Semua verifikasi ber-scope berkas yang berubah. Perintah test web WAJIB dijalankan dari `src/`
  dengan binary root: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run <path>`.
  `env -u NODE_ENV` wajib (shell mesin ini menunjuk production); `../node_modules/.bin/vitest` wajib
  (vitest ter-hoist ke root, dan cwd Bash bertahan antar-panggilan).
- **Satu keystroke per tekan** (SPEC-452): setiap tombol layar dan setiap tap-pilih mengirim tepat
  satu panggilan input berisi satu keystroke. Jangan pernah menggabungkan dua keystroke dalam satu
  frame `{t:"in"}`.
- Wheel polos tetap diteruskan ke tmux (SPEC-209 / ADR-0016). Hanya `Shift+wheel` yang dibelokkan.
- `Escape` browser tetap TIDAK di-bind untuk menutup overlay Terminal (komentar
  `TerminalScreen.tsx:250-252`). Tombol `Esc` yang dibangun di sini **mengirim** `\x1b` ke pane.
- Ikuti design system: warna lewat token CSS (`var(--…)`), kontrol lewat komponen DS
  (`Button`, `IconButton`, `Modal`, `Select`), target sentuh ≥ `var(--touch-target)`.
- Bahasa UI dan komentar: Indonesia, mengikuti gaya berkas di sekitarnya. Jangan menulis komentar
  yang mengulang apa yang sudah dinyatakan kode.
- Commit per task. Docs yang tersentuh diperbarui dalam commit yang sama.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `src/src/screens/terminal-chrome.ts` (**baru**) | Aritmetika murni: `inlineActionCount`, `dialogChoiceAt`, `clampFontSize`, `TERMINAL_KEYS`, konstanta ambang |
| `src/test/terminal-chrome.test.ts` (**baru**) | Test unit modul murni di atas |
| `src/src/ds/components/ui.tsx` | + `OverflowActions` (trigger `IconButton` + panel `Modal`/sheet) |
| `src/src/ds/index.ts` | Ekspor `OverflowActions` + tipe `OverflowItem` |
| `src/test/overflow-actions.test.tsx` (**baru**) | Test komponen DS baru |
| `src/src/screens/TerminalPane.tsx` | Sambung ulang WS + strip keadaan, ukuran font, `Shift+wheel`, papan tombol layar, tap-pilih dialog |
| `src/test/terminal-pane.test.tsx` | Test semua perilaku pane baru (berkas sudah ada) |
| `src/src/screens/TerminalScreen.tsx` | Header sel sadar-lebar + overflow, toolbar mobile diringkas, state `fontSize`/`keysOpen` |
| `src/test/terminal-screen.test.tsx` | Test overflow header/toolbar (berkas sudah ada) |
| `src/src/app.css` | Aturan responsive papan tombol + strip koneksi |
| `internal/docs/architecture/*.md`, `internal/docs/README.md` | Doc SoT yang tersentuh + index |

---

### Task 1: Modul murni `terminal-chrome.ts`

**Files:**
- Create: `src/src/screens/terminal-chrome.ts`
- Test: `src/test/terminal-chrome.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `HEADER_LABEL_MIN: 96`, `HEADER_MEDIA_PX: 58`, `ACTION_GAP: 8`, `ALWAYS_INLINE: 2`
  - `inlineActionCount(width: number, total: number, actionPx: number): number`
  - `dialogChoiceAt(lines: string[], row: number): string | null`
  - `clampFontSize(value: number): number`, `FONT_MIN: 10`, `FONT_MAX: 24`, `FONT_DEFAULT: 13`, `FONT_DEFAULT_MOBILE: 15`
  - `TERMINAL_KEYS: readonly { id: string; label: string; seq: string; aria: string }[]`

- [x] **Step 1: Write the failing test**

Create `src/test/terminal-chrome.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TERMINAL_KEYS, clampFontSize, dialogChoiceAt, inlineActionCount,
} from "../src/screens/terminal-chrome";

describe("inlineActionCount", () => {
  it("membiarkan semua aksi inline selagi lebarnya belum terukur", () => {
    expect(inlineActionCount(Number.POSITIVE_INFINITY, 4, 28)).toBe(4);
    expect(inlineActionCount(0, 4, 28)).toBe(4);
  });

  it("membiarkan semua aksi inline pada sel lebar", () => {
    expect(inlineActionCount(1000, 4, 28)).toBe(4);
  });

  it("menyisakan satu slot untuk tombol overflow saat tak semuanya muat", () => {
    // slot 36px, tetap 96 + 58 + 2×36 = 226 → sisa 114 → 3 slot; satu dipakai tombol overflow
    expect(inlineActionCount(340, 4, 28)).toBe(2);
  });

  it("meruntuhkan seluruh aksi saat pointer kasar memperbesar tiap kontrol", () => {
    // slot 52px, tetap 96 + 58 + 2×52 = 258 → sisa 42 → 0 slot
    expect(inlineActionCount(300, 4, 44)).toBe(0);
  });

  it("tak pernah mengembalikan angka negatif", () => {
    expect(inlineActionCount(80, 4, 44)).toBe(0);
  });
});

describe("dialogChoiceAt", () => {
  const dialog = [
    "❯ 1. In-memory",
    "  2. Redis",
    "  3. Tanpa cache",
    "  4. Type something.",
    "────────────────────",
    "  5. Chat about this",
    "",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
  ];

  it("mengembalikan digit baris yang di-tap saat footer dialog ada", () => {
    expect(dialogChoiceAt(dialog, 0)).toBe("1");
    expect(dialogChoiceAt(dialog, 2)).toBe("3");
    expect(dialogChoiceAt(dialog, 5)).toBe("5");
  });

  it("mengabaikan baris yang bukan opsi bernomor", () => {
    expect(dialogChoiceAt(dialog, 4)).toBeNull();
    expect(dialogChoiceAt(dialog, 99)).toBeNull();
  });

  it("tak mengirim apa pun pada layar kerja biasa walau ada baris bernomor", () => {
    const work = ["  1. langkah pertama", "  2. langkah kedua", "$ "];
    expect(dialogChoiceAt(work, 0)).toBeNull();
  });
});

describe("clampFontSize", () => {
  it("menjepit ke 10..24 dan membulatkan", () => {
    expect(clampFontSize(2)).toBe(10);
    expect(clampFontSize(99)).toBe(24);
    expect(clampFontSize(13.4)).toBe(13);
  });
});

describe("TERMINAL_KEYS", () => {
  it("memetakan tiap tombol ke SATU keystroke (SPEC-452: burst >1 karakter ditelan Ink)", () => {
    const byId = Object.fromEntries(TERMINAL_KEYS.map((k) => [k.id, k.seq]));
    expect(byId.esc).toBe("\x1b");
    expect(byId.up).toBe("\x1b[A");
    expect(byId.down).toBe("\x1b[B");
    expect(byId.left).toBe("\x1b[D");
    expect(byId.right).toBe("\x1b[C");
    expect(byId.enter).toBe("\r");
    expect(byId.tab).toBe("\t");
  });

  it("memberi tiap tombol nama aksesibel", () => {
    for (const key of TERMINAL_KEYS) expect(key.aria.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-chrome.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/terminal-chrome"`.

- [x] **Step 3: Write minimal implementation**

Create `src/src/screens/terminal-chrome.ts`:

```ts
// SPEC-800 · aritmetika chrome terminal, dipisah dari komponennya supaya teruji tanpa layout
// engine: jsdom tak mengukur apa pun, jadi yang bisa dijaga test adalah keputusannya, bukan
// pikselnya. Komponen hanya menyuplai lebar hasil ResizeObserver.

/** Lebar minimum label sesi di header sel; di bawah ini label tak lagi bisa dibaca. */
export const HEADER_LABEL_MIN = 96;
/** Ilustrasi state (34px) + petunjuk clipboard + gap-nya. */
export const HEADER_MEDIA_PX = 58;
export const ACTION_GAP = 8;
/** `Layar penuh` + `Tutup` tak pernah runtuh: keduanya jalan keluar, bukan aksi tambahan. */
export const ALWAYS_INLINE = 2;

/** Berapa aksi yang boleh tetap inline pada header selebar `width`. Sisanya milik overflow.
 *  `actionPx` mengikuti pointer: 28 (halus) / 44 (kasar), mencermin app.css. */
export function inlineActionCount(width: number, total: number, actionPx: number): number {
  if (!Number.isFinite(width) || width <= 0) return total;
  const slot = actionPx + ACTION_GAP;
  const room = Math.floor((width - HEADER_LABEL_MIN - HEADER_MEDIA_PX - ALWAYS_INLINE * slot) / slot);
  if (room >= total) return total;
  // Satu slot dibayarkan untuk tombol overflow itu sendiri.
  return Math.max(0, room - 1);
}

// SPEC-452 · dialog AskUserQuestion adalah daftar Ink: satu digit sebagai keystroke tersendiri
// LANGSUNG memilih baris bernomor itu, sedangkan burst >1 karakter ditelan bulat-bulat. Footer
// dialognya (`Enter to select · ↑/↓ to navigate · Esc to cancel`) dipakai sebagai gerbang supaya
// daftar bernomor di layar kerja biasa tak pernah ikut terkirim.
const DIALOG_SELECT = /enter to select/i;
const DIALOG_NAVIGATE = /to navigate/i;
const CHOICE_ROW = /^\s*[❯>*]?\s*(\d)\.\s/;

export function dialogChoiceAt(lines: string[], row: number): string | null {
  const screen = lines.join("\n");
  if (!DIALOG_SELECT.test(screen) || !DIALOG_NAVIGATE.test(screen)) return null;
  const line = lines[row];
  return line ? CHOICE_ROW.exec(line)?.[1] ?? null : null;
}

export const FONT_MIN = 10;
export const FONT_MAX = 24;
export const FONT_DEFAULT = 13;
export const FONT_DEFAULT_MOBILE = 15;

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_DEFAULT;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(value)));
}

// Papan tombol layar: keyboard virtual ponsel tak punya panah, Esc, maupun Tab, dan Esc adalah
// satu-satunya jalan keluar dari copy-mode tmux (audit SPEC-800 §4).
export const TERMINAL_KEYS = [
  { id: "esc", label: "Esc", seq: "\x1b", aria: "Kirim Escape ke terminal" },
  { id: "tab", label: "Tab", seq: "\t", aria: "Kirim Tab ke terminal" },
  { id: "up", label: "↑", seq: "\x1b[A", aria: "Kirim panah atas ke terminal" },
  { id: "down", label: "↓", seq: "\x1b[B", aria: "Kirim panah bawah ke terminal" },
  { id: "left", label: "←", seq: "\x1b[D", aria: "Kirim panah kiri ke terminal" },
  { id: "right", label: "→", seq: "\x1b[C", aria: "Kirim panah kanan ke terminal" },
  { id: "enter", label: "Enter", seq: "\r", aria: "Kirim Enter ke terminal" },
] as const;
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-chrome.test.ts`
Expected: PASS — 1 berkas, 11 test lulus.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-chrome.ts src/test/terminal-chrome.test.ts
git commit -m "feat(spec-800): aritmetika chrome terminal sebagai modul murni"
```

---

### Task 2: Komponen DS `OverflowActions`

**Files:**
- Modify: `src/src/ds/components/ui.tsx` (tambah komponen di bawah `Tabs`)
- Modify: `src/src/ds/index.ts:7` (baris ekspor `Tabs`)
- Test: `src/test/overflow-actions.test.tsx`

**Interfaces:**
- Consumes: `Modal` dari `../kit`, `IconButton` dari `./forms`
- Produces:
  ```ts
  export type OverflowItem = {
    key: string; label: string; icon?: string;
    onSelect: () => void; disabled?: boolean; title?: string;
  };
  export function OverflowActions(props: {
    label: string; items: readonly OverflowItem[];
    icon?: string; size?: "sm" | "md" | "lg"; children?: React.ReactNode;
  }): JSX.Element | null;
  ```

- [x] **Step 1: Write the failing test**

Create `src/test/overflow-actions.test.tsx`:

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OverflowActions } from "../src/ds";

afterEach(cleanup);

describe("OverflowActions", () => {
  it("tak merender apa pun tanpa item — trigger kosong hanya menambah kepadatan", () => {
    const { container } = render(<OverflowActions label="Aksi lain" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("menyembunyikan aksinya sampai trigger ditekan, lalu menampilkannya semua", () => {
    const run = vi.fn();
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lihat dokumen", onSelect: run },
        { key: "b", label: "Lepas dari grid", onSelect: () => {} },
      ]} />,
    );
    expect(screen.queryByRole("button", { name: "Lihat dokumen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    expect(screen.getByRole("button", { name: "Lepas dari grid" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lihat dokumen" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("menutup panel sesudah sebuah aksi dipilih", () => {
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lihat dokumen", onSelect: () => {} },
      ]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    fireEvent.click(screen.getByRole("button", { name: "Lihat dokumen" }));
    expect(screen.queryByRole("button", { name: "Lihat dokumen" })).toBeNull();
  });

  it("menghormati item nonaktif", () => {
    const run = vi.fn();
    render(
      <OverflowActions label="Aksi lain" items={[
        { key: "a", label: "Lepas dari grid", onSelect: run, disabled: true },
      ]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    const item = screen.getByRole("button", { name: "Lepas dari grid" });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(run).not.toHaveBeenCalled();
  });

  it("merender children di dalam panel untuk kontrol yang bukan sekadar aksi", () => {
    render(
      <OverflowActions label="Aksi lain" items={[{ key: "a", label: "Lepas", onSelect: () => {} }]}>
        <label htmlFor="ukuran">Ukuran font</label>
      </OverflowActions>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain" }));
    expect(screen.getByText("Ukuran font")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/overflow-actions.test.tsx`
Expected: FAIL — `OverflowActions is not exported by "../src/ds"`.

- [x] **Step 3: Write minimal implementation**

Append to `src/src/ds/components/ui.tsx` (import `React` sudah ada di baris 2; tambah dua import di atas):

```tsx
import { Modal } from "../kit";
import { IconButton } from "./forms";
```

```tsx
export type OverflowItem = {
  key: string; label: string; icon?: string;
  onSelect: () => void; disabled?: boolean; title?: string;
};

// SPEC-800 · ember untuk aksi yang tidak muat. Panelnya `Modal` DS — bukan popover terposisi —
// karena Modal sudah membawa focus trap, Escape, restorasi fokus, dan bentuk bottom-sheet mobile
// (app.css `.hn-modal-overlay { align-items: flex-end }`) tanpa satu pun hitungan tepi viewport.
export function OverflowActions({ label, items, icon = "more-horizontal", size = "sm", children }: {
  label: string; items: readonly OverflowItem[]; icon?: string;
  size?: "sm" | "md" | "lg"; children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  if (!items.length && !children) return null;
  return (
    <>
      <IconButton size={size} icon={icon} label={label} aria-haspopup="dialog"
        aria-expanded={open} onClick={() => setOpen(true)} />
      {open && (
        <Modal open title={label} icon={icon} width={420} onClose={() => setOpen(false)}>
          {children}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((item) => (
              <button key={item.key} type="button" disabled={item.disabled} title={item.title}
                onClick={() => { setOpen(false); item.onSelect(); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%",
                  minHeight: "var(--touch-target)", padding: "8px 10px", textAlign: "left",
                  border: "none", borderRadius: "var(--radius-sm)", background: "transparent",
                  color: item.disabled ? "var(--text-subtle)" : "var(--text-body)",
                  font: "var(--weight-medium) var(--text-md)/1.3 var(--font-ui)",
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  opacity: item.disabled ? 0.5 : 1 }}>
                {item.icon && <Icon name={item.icon} size={15} />}
                {item.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
```

Modify `src/src/ds/index.ts` line 7:

```ts
export { Tabs, OverflowActions } from "./components/ui";
export type { OverflowItem } from "./components/ui";
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/overflow-actions.test.tsx test/ds.test.tsx`
Expected: PASS — kedua berkas hijau (`ds.test.tsx` menjaga tak ada ekspor DS yang rusak).

- [x] **Step 5: Commit**

```bash
git add src/src/ds/components/ui.tsx src/src/ds/index.ts src/test/overflow-actions.test.tsx
git commit -m "feat(spec-800): OverflowActions di design system"
```

---

### Task 3: Sambung ulang WebSocket + strip keadaan koneksi

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `api.issueWsTicket`, `paths.terminalWs` (keduanya sudah dipakai)
- Produces: host pane sekarang punya `data-testid="terminal-host"`; strip keadaan
  `data-testid="terminal-link"`; konstanta `RECONNECT_BACKOFF_MS`, `RECONNECT_MAX`

**Catatan wajib untuk implementer:** JSX pane berubah dari satu `<div>` menjadi pembungkus flex.
Karena itu tiap test lama yang memakai `container.firstElementChild` sebagai host **harus** diubah
menjadi `container.querySelector('[data-testid="terminal-host"]')!`. Ada empat kejadian di
`src/test/terminal-pane.test.tsx` (test "hidden panel", "coarse pointer", "CONNECTING", "swipe").

- [x] **Step 1: Write the failing test**

Di `src/test/terminal-pane.test.tsx`, tambahkan `onclose` pada `FakeWebSocket` dan
`vi.useFakeTimers` pada test baru. Ganti kelas socket palsu menjadi:

```ts
class FakeWebSocket {
  public static readonly OPEN = 1;
  public readyState = 1;
  public sent: string[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: ((ev: { code: number }) => void) | null = null;
  public onerror: (() => void) | null = null;
  constructor(public url: string) { sockets.push(this); }
  public send(m: string): void { this.sent.push(m); }
  public close(): void { this.readyState = 3; }
}
```

lalu tambahkan blok test baru di akhir berkas:

```tsx
describe("TerminalPane · liveness socket (SPEC-800)", () => {
  const host = (container: HTMLElement) =>
    container.querySelector('[data-testid="terminal-host"]')!;

  it("menyambung ulang sesudah socket tertutup dan menguras ketikan yang mengantre", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      vi.spyOn(host(container), "getBoundingClientRect").mockReturnValue({
        width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
      });
      sockets[0]!.onopen?.();

      sockets[0]!.readyState = 3;
      sockets[0]!.onclose?.({ code: 1008 });
      xt.dataHandler?.("ha");
      xt.dataHandler?.("lo");
      expect(sockets).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(600);
      await vi.waitFor(() => expect(sockets).toHaveLength(2));
      sockets[1]!.onopen?.();
      expect(sockets[1]?.sent).toContain(JSON.stringify({ t: "in", d: "halo" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("memperlihatkan keadaan sambung ulang, bukan diam", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      sockets[0]!.onopen?.();
      sockets[0]!.readyState = 3;
      sockets[0]!.onclose?.({ code: 1006 });
      expect(container.querySelector('[data-testid="terminal-link"]')?.textContent)
        .toContain("menyambung ulang");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tidak menyambung ulang saat sesi tmux-nya memang sudah lenyap (4004)", async () => {
    vi.useFakeTimers();
    try {
      render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      sockets[0]!.onclose?.({ code: 4004 });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("menyerah sesudah enam percobaan dan menawarkan sambung ulang manual", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      for (let i = 0; i < 7; i += 1) {
        sockets.at(-1)!.readyState = 3;
        sockets.at(-1)!.onclose?.({ code: 1006 });
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(sockets).toHaveLength(7);
      const retry = container.querySelector('[data-testid="terminal-link"] button')!;
      expect(retry.textContent).toContain("Sambungkan lagi");
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(sockets).toHaveLength(8));
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx`
Expected: FAIL — empat test baru gagal (`sockets` tetap 1 setelah close; `[data-testid="terminal-link"]` null).

- [x] **Step 3: Write minimal implementation**

Ubah `src/src/screens/TerminalPane.tsx`. Tambah konstanta di atas komponen:

```ts
// SPEC-800 · socket terminal bisa tertutup tanpa salah siapa pun (revalidasi principal ADR-0117
// tiap 60 dtk, kuota, restart server saat update, jaringan mobile). Sebelum ini tak ada satu pun
// `onclose`, jadi `pendingInput` menumpuk pada buffer tanpa pembaca dan ketikan hilang senyap.
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000, 8_000];
const RECONNECT_MAX = RECONNECT_BACKOFF_MS.length;

type LinkState =
  | { state: "connecting" | "open" | "gone" }
  | { state: "retrying"; attempt: number }
  | { state: "lost" };
```

Di dalam komponen, tambah state + ref:

```ts
const [link, setLink] = React.useState<LinkState>({ state: "connecting" });
const retryNow = React.useRef<() => void>(() => {});
```

Di dalam effect `[sessionId]`, ganti blok `void api.issueWsTicket(...)` menjadi:

```ts
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const connect = () => {
      void api.issueWsTicket(`terminal:${sessionId}`).then(({ ticket }) => {
        if (disposed) return;
        const scheme = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${scheme}//${location.host}${paths.terminalWs(sessionId)}`, [`hanoman-ticket.${ticket}`]);
        ws = socket;

        socket.onopen = () => {
          attempt = 0;
          setLink({ state: "open" });
          if (pendingInput) {
            const d = pendingInput;
            pendingInput = "";
            send({ t: "in", d });
          }
          if (!visibleRect()) return;
          const finePointer = typeof window.matchMedia !== "function"
            || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
          if (finePointer) term.focus();
          send({ t: "resize", cols: term.cols, rows: term.rows });
        };
        socket.onmessage = (ev) => {
          const f = JSON.parse(ev.data as string) as {
            t: string; d?: string; code?: number; phases?: Phase[]; complete?: boolean;
          };
          if (f.t === "data") term.write(f.d ?? "");
          else if (f.t === "phase") phaseRef.current?.(f.phases ?? [], f.complete === true);
          else if (f.t === "exit") {
            finished = true;
            term.write(`\r\n\x1b[33m— sesi berakhir (exit ${f.code}) —\x1b[0m\r\n`);
            exitRef.current(f.code ?? 0);
          }
        };
        // 4004 = sesi tmux-nya memang sudah lenyap; menyambung ulang hanya menghasilkan badai 404.
        socket.onclose = (event) => {
          if (disposed || finished) return;
          if (event.code === 4004) { setLink({ state: "gone" }); return; }
          retry();
        };
        socket.onerror = () => { /* onclose selalu menyusul; keputusannya cukup di satu tempat */ };
      }).catch(() => {
        if (disposed) return;
        term.write("\r\n\x1b[31mWebSocket admission gagal\x1b[0m\r\n");
        retry();
      });
    };

    const retry = () => {
      if (attempt >= RECONNECT_MAX) { setLink({ state: "lost" }); return; }
      const wait = RECONNECT_BACKOFF_MS[attempt]!;
      attempt += 1;
      setLink({ state: "retrying", attempt });
      timer = setTimeout(connect, wait);
    };

    retryNow.current = () => {
      if (disposed) return;
      clearTimeout(timer);
      attempt = 0;
      setLink({ state: "retrying", attempt: 1 });
      connect();
    };

    connect();
```

Di cleanup, tambah `clearTimeout(timer);` dan `retryNow.current = () => {};` sebelum `ws?.close()`.

Ganti JSX return menjadi:

```tsx
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {link.state !== "open" && link.state !== "connecting" && (
        <div data-testid="terminal-link" style={{
          display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto",
          padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 11,
          background: link.state === "lost" ? "var(--status-err-tint)" : "var(--status-warn-tint)",
          color: "var(--text-body)",
        }}>
          {link.state === "retrying"
            ? `menyambung ulang… (${link.attempt}/${RECONNECT_MAX})`
            : link.state === "gone"
              ? "sesi tidak ditemukan di tmux"
              : <>
                  <span>terputus</span>
                  <button type="button" className="hn-terminal-action hn-terminal-action--text"
                    onClick={() => retryNow.current()}>Sambungkan lagi</button>
                </>}
        </div>
      )}
      <div ref={host} data-testid="terminal-host" style={{ flex: 1, minHeight: 0, width: "100%",
        background: "var(--term-bg)", padding: 8, borderRadius: "var(--radius-sm)",
        touchAction: "pan-x pinch-zoom", overscrollBehavior: "contain" }} />
    </div>
  );
```

Terakhir, ubah empat pemakaian `container.firstElementChild` di
`src/test/terminal-pane.test.tsx` menjadi `container.querySelector('[data-testid="terminal-host"]')!`.

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx`
Expected: PASS — 12 test lulus (8 lama + 4 baru).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "fix(spec-800): pane terminal menyambung ulang dan tak menelan ketikan"
```

---

### Task 4: Ukuran font terminal + `Shift+wheel` menggulir lokal

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `clampFontSize`, `FONT_DEFAULT` dari `./terminal-chrome` (Task 1)
- Produces: prop baru `fontSize?: number` pada `TerminalPane`

- [x] **Step 1: Write the failing test**

Perluas mock xterm di `src/test/terminal-pane.test.tsx` agar menyimpan opsi yang dapat ditulis dan
menerima handler wheel. Ganti kelas `Terminal` palsu menjadi:

```ts
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public cols = 80;
    public rows = 24;
    public options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) { xt.options = options; this.options = options; }
    public loadAddon(): void { }
    public open(): void { }
    public focus(): void { xt.focused += 1; }
    public write(d: string): void { xt.written.push(d); }
    public scrollLines(amount: number): void { xt.scrolled.push(amount); }
    public dispose(): void { }
    public hasSelection(): boolean { return xt.selection.length > 0; }
    public getSelection(): string { return xt.selection; }
    public attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean): void { xt.keyHandler = fn; }
    public attachCustomWheelEventHandler(fn: (e: WheelEvent) => boolean): void { xt.wheelHandler = fn; }
    public onData(fn: (data: string) => void): { dispose: () => void } {
      xt.dataHandler = fn;
      return { dispose: () => { xt.dataHandler = undefined; } };
    }
    public get buffer() { return { active: xt.buffer }; }
  },
}));
```

Tambah dua field pada `vi.hoisted` di atasnya:

```ts
  wheelHandler: undefined as ((e: WheelEvent) => boolean) | undefined,
  buffer: { viewportY: 0, getLine: (_: number) => undefined as undefined | { translateToString: () => string } },
```

dan reset keduanya di `beforeEach` (`xt.wheelHandler = undefined;`).

Test baru:

```tsx
describe("TerminalPane · ukuran font & gulir lokal (SPEC-800)", () => {
  const host = (container: HTMLElement) =>
    container.querySelector('[data-testid="terminal-host"]')!;

  it("lahir dengan ukuran font yang diminta", () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} fontSize={17} />);
    expect(xt.options?.fontSize).toBe(17);
  });

  it("menerapkan ukuran baru dengan fit + frame resize, tanpa socket baru", async () => {
    const { container, rerender } = render(
      <TerminalPane sessionId="sesi-1" onExit={() => { }} fontSize={13} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(host(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    sockets[0]?.onopen?.();
    const fits = xt.fitCount;
    rerender(<TerminalPane sessionId="sesi-1" onExit={() => { }} fontSize={18} />);
    expect(xt.fitCount).toBe(fits + 1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.sent.filter((m) => m.includes("resize")).length).toBeGreaterThan(1);
  });

  it("Shift+wheel menggulir scrollback xterm dan tak diteruskan sebagai laporan mouse", () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    vi.spyOn(host(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    const forwarded = xt.wheelHandler?.({ shiftKey: true, deltaY: 100 } as WheelEvent);
    expect(forwarded).toBe(false);
    expect(xt.scrolled.at(-1)).toBeGreaterThan(0);
  });

  it("wheel polos tetap milik tmux (SPEC-209)", () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    expect(xt.wheelHandler?.({ shiftKey: false, deltaY: 100 } as WheelEvent)).toBe(true);
    expect(xt.scrolled).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx`
Expected: FAIL — `xt.wheelHandler` undefined dan `fontSize` selalu 13.

- [x] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalPane.tsx`:

```ts
import { clampFontSize, FONT_DEFAULT } from "./terminal-chrome";
```

Tanda tangan komponen:

```ts
export function TerminalPane({ sessionId, onExit, onPhases, fontSize = FONT_DEFAULT }: {
  sessionId: string; onExit: (code: number) => void;
  onPhases?: (p: Phase[], complete: boolean) => void;
  fontSize?: number;
}) {
```

Ref baru di samping `host`:

```ts
  const view = React.useRef<{ term: Terminal; fit: FitAddon; send: (m: unknown) => void } | null>(null);
```

Di dalam effect: `fontSize: clampFontSize(fontSizeRef.current)` pada konstruktor (pakai ref supaya
effect tetap hanya bergantung `sessionId`), dan sesudah `term.open(el)` isi `view.current = { term, fit, send }`;
di cleanup `view.current = null`. Tambah ref:

```ts
  const fontSizeRef = React.useRef(fontSize);
  fontSizeRef.current = fontSize;
```

Handler wheel, dipasang tepat di bawah `attachCustomKeyEventHandler`:

```ts
    // SPEC-800 · xterm mematikan wheel-nya sendiri begitu protokol mouse aktif (Viewport.ts) dan
    // tmux `mouse on` (SPEC-209) memang mengambilnya untuk copy-mode. Wheel polos karena itu
    // DIBIARKAN lewat — riwayat 50 000 baris ada di tmux, bukan di buffer xterm. Shift+wheel
    // adalah satu-satunya jalur gulir yang tak pernah melewati mouse-mode, jadi ia tetap hidup
    // saat dialog claude memegang mouse.
    term.attachCustomWheelEventHandler((event) => {
      if (!event.shiftKey) return true;
      const rect = visibleRect();
      if (!rect || term.rows <= 0) return true;
      const lineHeight = rect.height / term.rows;
      const lines = Math.trunc(event.deltaY / lineHeight) || Math.sign(event.deltaY);
      if (lines) term.scrollLines(lines);
      return false;
    });
```

Effect ukuran font, sesudah effect utama:

```ts
  // Ukuran font diterapkan tanpa me-remount: remount berarti socket baru, tiket baru, dan layar
  // kosong sampai tmux menggambar ulang. `cols`/`rows` PTY turunan ukuran font, jadi frame resize
  // wajib menyusul — tanpa itu tmux tetap menggambar untuk geometri lama.
  React.useEffect(() => {
    const current = view.current;
    const el = host.current;
    if (!current || !el) return;
    const size = clampFontSize(fontSize);
    if (current.term.options.fontSize === size) return;
    current.term.options.fontSize = size;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    current.fit.fit();
    current.send({ t: "resize", cols: current.term.cols, rows: current.term.rows });
  }, [fontSize]);
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx`
Expected: PASS — 16 test lulus.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(spec-800): ukuran font terminal & Shift+wheel gulir lokal"
```

---

### Task 5: Papan tombol layar (`Esc`, `Tab`, panah, `Enter`)

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Modify: `src/src/app.css` (aturan `.hn-terminal-keys`)
- Test: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `TERMINAL_KEYS` dari `./terminal-chrome`
- Produces: prop baru `showKeys?: boolean` pada `TerminalPane`

- [x] **Step 1: Write the failing test**

```tsx
describe("TerminalPane · papan tombol layar (SPEC-800)", () => {
  it("tak merender papan tombol kecuali diminta", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Kirim Escape ke terminal" })).toBeNull();
  });

  it("mengirim TEPAT SATU keystroke per tekan (SPEC-452)", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]?.onopen?.();
    const before = sockets[0]!.sent.length;
    fireEvent.click(screen.getByRole("button", { name: "Kirim panah bawah ke terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim Enter ke terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim Escape ke terminal" }));
    expect(sockets[0]!.sent.slice(before)).toEqual([
      JSON.stringify({ t: "in", d: "\x1b[B" }),
      JSON.stringify({ t: "in", d: "\r" }),
      JSON.stringify({ t: "in", d: "\x1b" }),
    ]);
  });
});
```

Tambahkan `screen` dan `fireEvent` ke import `@testing-library/react` di puncak berkas test.

- [x] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx -t "papan tombol"`
Expected: FAIL — tombol dengan nama aksesibel itu tidak ada.

- [x] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalPane.tsx`:

```ts
import { clampFontSize, FONT_DEFAULT, TERMINAL_KEYS } from "./terminal-chrome";
```

Tanda tangan: tambah `showKeys = false`. Ref untuk jalur input:

```ts
  const sendKey = React.useRef<(d: string) => void>(() => {});
```

Di dalam effect, tepat sesudah `const sendInput = …` definisikan `sendKey.current = sendInput;`
dan di cleanup `sendKey.current = () => {};`.

Komponen kecil di bawah `TerminalPane`:

```tsx
// SPEC-800 · keyboard virtual ponsel tak punya panah/Esc/Tab, dan Esc adalah satu-satunya jalan
// keluar dari copy-mode tmux. SPEC-452 · tiap tekan mengirim SATU keystroke: dialog AskUserQuestion
// adalah daftar Ink yang menelan burst >1 karakter bulat-bulat.
function TerminalKeys({ onKey }: { onKey: (seq: string) => void }) {
  return (
    <div className="hn-terminal-keys" role="group" aria-label="Tombol terminal">
      {TERMINAL_KEYS.map((key) => (
        <button key={key.id} type="button" className="hn-terminal-key" aria-label={key.aria}
          title={key.aria} onClick={() => onKey(key.seq)}>{key.label}</button>
      ))}
    </div>
  );
}
```

Render di dalam pembungkus, sesudah host:

```tsx
      {showKeys && <TerminalKeys onKey={(seq) => sendKey.current(seq)} />}
```

Di `src/src/app.css`, tepat di bawah blok `.hn-terminal-action--text`:

```css
/* SPEC-800 · papan tombol layar: menggulir mendatar saat sempit, bukan menyusut sampai
   labelnya tumpah — akar yang sama dengan strip tab SPEC-763. */
.hn-terminal-keys {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  max-width: 100%;
  padding: 4px 2px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border-top: 1px solid var(--border-hair);
}

.hn-terminal-key {
  flex: 0 0 auto;
  min-width: 40px;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border-hair);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-body);
  font: var(--weight-medium) var(--text-sm)/1 var(--font-mono);
  cursor: pointer;
}

.hn-terminal-key:hover { background: var(--bone-200); color: var(--text-strong); }

@media (pointer: coarse), (max-width: 767px) {
  .hn-terminal-key { min-width: var(--touch-target); min-height: var(--touch-target); }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx`
Expected: PASS — 18 test lulus.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/src/app.css src/test/terminal-pane.test.tsx
git commit -m "feat(spec-800): papan tombol layar mengirim satu keystroke per tekan"
```

---

### Task 6: Tap memilih opsi dialog claude

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `dialogChoiceAt` dari `./terminal-chrome`
- Produces: — (perilaku internal pane)

- [ ] **Step 1: Write the failing test**

```tsx
describe("TerminalPane · tap memilih opsi dialog (SPEC-800)", () => {
  const host = (container: HTMLElement) =>
    container.querySelector('[data-testid="terminal-host"]')! as HTMLElement;
  const screenLines = (lines: string[]) => {
    xt.buffer.viewportY = 0;
    xt.buffer.getLine = (index: number) => {
      const text = lines[index];
      return text === undefined ? undefined : { translateToString: () => text };
    };
  };
  const tap = (el: HTMLElement, clientY: number) => {
    for (const type of ["touchstart", "touchend"] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, type === "touchstart" ? "touches" : "changedTouches",
        { value: [{ clientY }] });
      Object.defineProperty(event, type === "touchstart" ? "changedTouches" : "touches",
        { value: [] });
      el.dispatchEvent(event);
    }
  };

  it("mengirim satu digit saat baris opsi dialog di-tap", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]?.onopen?.();
    vi.spyOn(host(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    screenLines([
      "❯ 1. In-memory", "  2. Redis", "  3. Tanpa cache",
      ...Array.from({ length: 20 }, () => ""),
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ]);
    const before = sockets[0]!.sent.length;
    tap(host(container), 15); // baris 1 (tinggi baris 240/24 = 10px)
    expect(sockets[0]!.sent.slice(before)).toEqual([JSON.stringify({ t: "in", d: "2" })]);
  });

  it("tidak mengirim apa pun pada layar tanpa footer dialog", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]?.onopen?.();
    vi.spyOn(host(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    screenLines(["  1. langkah pertama", "  2. langkah kedua", "$ "]);
    const before = sockets[0]!.sent.length;
    tap(host(container), 5);
    expect(sockets[0]!.sent.slice(before)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx -t "tap memilih"`
Expected: FAIL — test pertama menerima array kosong.

- [ ] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalPane.tsx`, tambah `dialogChoiceAt` ke import `./terminal-chrome`, lalu
ganti blok gesture SPEC-771 menjadi (perubahan: jejak `touchScrolled`, `touchendAt` sendiri):

```ts
    let touchY: number | null = null;
    let touchRemainder = 0;
    let touchScrolled = false;
    const resetTouch = () => { touchY = null; touchRemainder = 0; touchScrolled = false; };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { resetTouch(); return; }
      touchY = event.touches[0]!.clientY;
      touchRemainder = 0;
      touchScrolled = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null || event.touches.length !== 1) { resetTouch(); return; }
      const rect = visibleRect();
      if (!rect || term.rows <= 0) return;
      const nextY = event.touches[0]!.clientY;
      touchRemainder += touchY - nextY;
      touchY = nextY;
      const lineHeight = rect.height / term.rows;
      const lines = Math.trunc(touchRemainder / lineHeight);
      if (lines !== 0) {
        term.scrollLines(lines);
        touchRemainder -= lines * lineHeight;
        touchScrolled = true;
      }
      event.preventDefault();
    };
    // SPEC-800 · xterm tak menerjemahkan sentuhan menjadi laporan mouse, jadi tap tak pernah
    // sampai ke dialog claude. SPEC-452 mengukur jalur yang sampai: SATU digit = memilih baris
    // bernomor itu. Gerbangnya footer dialog Ink — di layar kerja biasa tap tak mengirim apa pun.
    const onTouchEnd = (event: TouchEvent) => {
      const tapped = touchY !== null && !touchScrolled;
      const clientY = event.changedTouches?.[0]?.clientY ?? touchY;
      resetTouch();
      if (!tapped || clientY === null || clientY === undefined) return;
      const rect = visibleRect();
      if (!rect || term.rows <= 0) return;
      const row = Math.floor((clientY - rect.top) / (rect.height / term.rows));
      const buffer = term.buffer.active;
      const lines = Array.from({ length: term.rows },
        (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? "");
      const choice = dialogChoiceAt(lines, row);
      if (choice) sendInput(choice);
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", resetTouch, { passive: true });
```

Cleanup: `el.removeEventListener("touchend", onTouchEnd);` menggantikan `resetTouch` untuk touchend.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-pane.test.tsx`
Expected: PASS — 20 test lulus.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(spec-800): tap memilih opsi dialog claude lewat digit hotkey"
```

---

### Task 7: Header sel sadar-lebar + toolbar mobile diringkas

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx`
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `inlineActionCount`, `clampFontSize`, `FONT_DEFAULT`, `FONT_DEFAULT_MOBILE`,
  `FONT_MIN`, `FONT_MAX` dari `./terminal-chrome`; `OverflowActions`, `OverflowItem`,
  `useCoarsePointer` dari `../ds`; `isBool`, `isNum` dari `../ui-state`
- Produces: `TerminalPane` dipanggil dengan `fontSize` dan `showKeys` dari state persisten

- [ ] **Step 1: Write the failing test**

Tambah di `src/test/terminal-screen.test.tsx` (letakkan `stubResizeObserver` di dekat helper lain):

```tsx
function stubResizeObserver(width: number) {
  const observers: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: (entries: ResizeObserverEntry[]) => void) {
      observers.push(() => this.cb([{ contentRect: { width } } as ResizeObserverEntry]));
    }
    observe(): void { observers.at(-1)?.(); }
    disconnect(): void { }
  });
}

describe("TerminalScreen · aksi tetap terjangkau saat sempit (SPEC-800)", () => {
  it("meruntuhkan aksi header sel ke panel overflow pada sel sempit", async () => {
    stubResizeObserver(240);
    localStorage.setItem(WKEY, JSON.stringify({ active: "g1", groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 1, cells: ["aaaa1111"] } },
    ] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", specId: "SPEC-1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} onOpenReview={() => {}} />);
    await screen.findByTestId("pane");

    // jalan keluar tak pernah runtuh
    expect(screen.getByRole("button", { name: "Layar penuh sesi aaaa1111" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tutup sesi aaaa1111" })).toBeInTheDocument();
    // aksi lain pindah ke overflow, dan tetap dapat dipilih
    expect(screen.queryByRole("button", { name: "Lihat dokumen sesi aaaa1111" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi lain sesi aaaa1111" }));
    expect(screen.getByRole("button", { name: "Lihat dokumen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review perubahan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lepas dari grid" })).toBeInTheDocument();
  });

  it("membiarkan aksi inline pada sel lebar", async () => {
    stubResizeObserver(900);
    localStorage.setItem(WKEY, JSON.stringify({ active: "g1", groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 1, cells: ["aaaa1111"] } },
    ] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", specId: "SPEC-1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} onOpenReview={() => {}} />);
    await screen.findByTestId("pane");
    expect(screen.getByRole("button", { name: "Lihat dokumen sesi aaaa1111" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aksi lain sesi aaaa1111" })).toBeNull();
  });

  it("meringkas toolbar mobile: aksi sekunder pindah ke satu panel", async () => {
    mockViewport(390);
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /Sesi baru/ });
    expect(screen.queryByRole("button", { name: "Ambil backlog" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aksi terminal lain" }));
    for (const name of ["Ambil backlog", "Riwayat sesi", "Terminal biasa", "+ Kolom", "+ Baris"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("menyimpan ukuran font terminal lintas render", async () => {
    mockViewport(390);
    listTerminals.mockResolvedValue([]);
    const view = render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /Sesi baru/ });
    fireEvent.click(screen.getByRole("button", { name: "Aksi terminal lain" }));
    fireEvent.click(screen.getByRole("button", { name: "Perbesar teks terminal" }));
    expect(localStorage.getItem("hn.ui.v1.terminal.fontSize")).toBe("16");
    view.unmount();
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /Sesi baru/ });
    fireEvent.click(screen.getByRole("button", { name: "Aksi terminal lain" }));
    expect(screen.getByText("16px")).toBeInTheDocument();
  });
});
```

Perbarui juga test lama pada baris ~202 (`"Hapus kolom aktif"`), karena kontrol itu kini hidup di
panel overflow:

```tsx
    fireEvent.click(screen.getByRole("button", { name: "Aksi terminal lain" }));
    expect(screen.getByRole("button", { name: "Hapus kolom aktif" })).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-screen.test.tsx`
Expected: FAIL — empat test baru + satu test lama gagal (`Aksi lain sesi …` / `Aksi terminal lain` tak ada).

- [ ] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalScreen.tsx`:

Import:

```ts
import { Button, IconButton, Icon, Select, StateBlock, Modal, Input, Badge, StatusPill,
  ProductStateIllustration, Tabs, OverflowActions, useResponsiveTier, useCoarsePointer,
  type OverflowItem } from "../ds";
import { usePersistedState, isStr, isBool, isNum } from "../ui-state";
import { clampFontSize, inlineActionCount, FONT_DEFAULT, FONT_DEFAULT_MOBILE,
  FONT_MIN, FONT_MAX } from "./terminal-chrome";
```

State baru di `TerminalScreen`, di bawah `const [project, setProject] = …`:

```ts
  // SPEC-800 · ukuran font & papan tombol adalah state TAMPILAN (SPEC-740 · ADR-0115): lokal per
  // browser, bukan payload workspace kanonik SPEC-786.
  const coarse = useCoarsePointer();
  const [fontSize, setFontSize] = usePersistedState(
    "terminal", "fontSize", coarse ? FONT_DEFAULT_MOBILE : FONT_DEFAULT, isNum);
  const [keysOpen, setKeysOpen] = usePersistedState("terminal", "keys", coarse, isBool);
  const bumpFont = (delta: number) => setFontSize((n) => clampFontSize(n + delta));
```

Panel overflow toolbar (letakkan sebagai fungsi di dalam komponen, dipakai kedua cabang):

```tsx
  const displayControls = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
      <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-muted)" }}>Ukuran teks terminal</span>
        <IconButton size="sm" icon="minus" label="Perkecil teks terminal"
          disabled={fontSize <= FONT_MIN} onClick={() => bumpFont(-1)} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 44, textAlign: "center" }}>
          {fontSize}px
        </span>
        <IconButton size="sm" icon="plus" label="Perbesar teks terminal"
          disabled={fontSize >= FONT_MAX} onClick={() => bumpFont(1)} />
      </div>
      <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-muted)" }}>
          Papan tombol layar (Esc · panah · Enter)
        </span>
        <Button size="sm" variant="secondary" aria-pressed={keysOpen}
          onClick={() => setKeysOpen((on) => !on)}>{keysOpen ? "Sembunyikan" : "Tampilkan"}</Button>
      </div>
      <Select size="sm" aria-label="Project sesi baru" value={project}
        onChange={(e) => setProject(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
    </div>
  );

  const toolbarItems: OverflowItem[] = [
    { key: "backlog", label: "Ambil backlog", icon: "inbox",
      onSelect: () => { setPickError(null); setPicking(true); } },
    { key: "history", label: "Riwayat sesi", icon: "history", onSelect: () => setHistoryOpen(true) },
    { key: "shell", label: "Terminal biasa", icon: "terminal", onSelect: () => void openShell() },
    { key: "col+", label: "+ Kolom", icon: "columns-2", disabled: !workspaceWritable,
      onSelect: () => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addColumn)) },
    { key: "row+", label: "+ Baris", icon: "rows-2", disabled: !workspaceWritable,
      onSelect: () => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addRow)) },
    { key: "col-", label: "Hapus kolom aktif", icon: "columns-2",
      disabled: !workspaceWritable || layout.cols === 1,
      onSelect: () => void mutateWorkspace((current) =>
        W.mapActiveLayout(current, (l) => L.removeColumn(l, activeCell % l.cols))) },
    { key: "row-", label: "Hapus baris aktif", icon: "rows-2",
      disabled: !workspaceWritable || layout.rows === 1,
      onSelect: () => void mutateWorkspace((current) =>
        W.mapActiveLayout(current, (l) => L.removeRow(l, Math.floor(activeCell / l.cols)))) },
  ];
```

> `layout` dideklarasikan di baris 234, **sesudah** posisi ini. Pindahkan
> `const layout = W.activeGroup(ws).layout;` ke atas — tepat di bawah `const placed = W.placedIds(ws);`
> di baris 231 — sehingga `toolbarItems` dapat memakainya. Tak ada perubahan perilaku: nilainya
> turunan murni dari `ws`.

Ganti isi baris toolbar (`TerminalScreen.tsx:278-321`) menjadi:

```tsx
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          ...(maxed ? { flex: 1, minWidth: 0 } : {}) }}>
          {!mobile && (
            <>
              <Button size="sm" variant="ghost" disabled={!workspaceWritable}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addColumn))}>+ Kolom</Button>
              <Button size="sm" variant="ghost" disabled={!workspaceWritable}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addRow))}>+ Baris</Button>
            </>
          )}
          <div style={{ flex: 1, minWidth: 0 }} />
          {workspaceStatus !== "ready" && (
            /* … blok status workspace apa adanya, tak berubah … */
          )}
          {cleanups.length > 0 && (
            /* … blok cleanups apa adanya, tak berubah … */
          )}
          {!mobile && (
            <>
              <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              <Button size="sm" variant="secondary" leftIcon="inbox"
                onClick={() => { setPickError(null); setPicking(true); }}>Ambil backlog</Button>
              <Button size="sm" variant="secondary" leftIcon="history"
                title="Riwayat sesi yang sudah berlalu — buka kembali atau baca transkripnya"
                onClick={() => setHistoryOpen(true)}>Riwayat</Button>
              <Button size="sm" variant="secondary" leftIcon="terminal"
                title="Buka shell tmux tanpa Claude di project terpilih — jalankan command di project"
                onClick={() => void openShell()}>Terminal biasa</Button>
            </>
          )}
          <Button size="sm" leftIcon="plus" onClick={() => setNewOpen(true)}>Sesi baru</Button>
          {/* SPEC-800 · di mobile aksi sekunder pindah ke satu panel supaya pane mendapat ruang
              layar terbesar; di desktop panel ini hanya memuat kontrol tampilan. */}
          <OverflowActions label={mobile ? "Aksi terminal lain" : "Tampilan terminal"}
            items={mobile ? toolbarItems : []}>{displayControls}</OverflowActions>
          <IconButton size="sm" icon={maxed ? "minimize-2" : "maximize-2"}
            label={maxed ? "Keluar layar penuh" : "Layar penuh"}
            aria-pressed={maxed} onClick={() => setMaxed((m) => !m)} />
        </div>
```

Hapus baris `Hapus kolom`/`Hapus baris` mobile (`TerminalScreen.tsx:351-356`), sisakan strip
`Tabs` panelnya:

```tsx
      {mobile && !showEmpty && (
        <div className="hn-stack-mobile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tabs aria-label="Panel terminal" variant="pill" value={String(activeCell)}
            onChange={(next) => setActiveCell(Number(next))}
            tabs={layout.cells.map((id, idx) => ({ value: String(idx),
              label: `Panel ${idx + 1}${id ? ` · ${id.slice(0, 6)}` : " · kosong"}` }))} />
        </div>
      )}
```

Teruskan prop tampilan ke `Cell` dan `FullscreenTerminal`:

```tsx
                      ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                          canArrange={workspaceWritable} onDetach={() => detach(s.id)} onExit={(code) => markExited(s.id, code)} onReview={onOpenReview}
                          onSessionReview={onOpenSessionReview}
                          titleOf={titleOf} onIntegrate={onIntegrate} onIntegrateSession={onIntegrateSession} specOf={specOf}
                          fontSize={fontSize} showKeys={keysOpen}
                          fullscreen={fullId === s.id} onFullscreen={() => setFullId(s.id)} />
```

```tsx
        <FullscreenTerminal session={byId(fullId)!}
          label={cellLabel(byId(fullId)!, nameOf, titleOf)}
          fontSize={fontSize} showKeys={keysOpen}
          onClose={() => setFullId(null)} />
```

Di `Cell`, tambah props `fontSize: number; showKeys: boolean;` pada tanda tangan, lalu ganti header
menjadi versi sadar-lebar. Tambahkan di awal badan `Cell`:

```ts
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [headerWidth, setHeaderWidth] = React.useState(Number.POSITIVE_INFINITY);
  const coarse = useCoarsePointer();
  React.useEffect(() => {
    const el = headerRef.current;
    // jsdom tak punya ResizeObserver; tanpa penjaga ini seluruh layar Terminal gagal dirender di
    // test yang tak peduli lebar. Lebar tak terukur = semua aksi inline (perilaku lama).
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (width > 0) setHeaderWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
```

Bangun daftar aksi yang boleh runtuh, sesudah `const finished = …`:

```tsx
  const collapsible: (OverflowItem & { render: React.ReactNode })[] = [
    ...(session.specId ? [{
      key: "docs", label: "Lihat dokumen", icon: "file-text",
      title: "Lihat dokumen (audit/spec/plan)", onSelect: () => setDocs(true),
      render: (
        <button type="button" key="docs" className="hn-terminal-action" onClick={() => setDocs(true)}
          aria-label={`Lihat dokumen sesi ${session.id}`} title="Lihat dokumen (audit/spec/plan)">
          <Icon name="file-text" size={12} />
        </button>
      ),
    }] : []),
    ...(session.specId && onReview ? [{
      key: "review", label: "Review perubahan", icon: "git-compare",
      title: "Review perubahan (diff worktree)", onSelect: () => onReview(session.specId!),
      render: (
        <button type="button" key="review" className="hn-terminal-action" onClick={() => onReview(session.specId!)}
          aria-label={`Review sesi ${session.id}`} title="Review perubahan (diff worktree)">
          <Icon name="git-compare" size={12} />
        </button>
      ),
    }] : []),
    ...(branchSession && onSessionReview ? [{
      key: "review-session", label: "Review perubahan", icon: "git-compare",
      title: "Review perubahan (diff worktree sesi)", onSelect: () => onSessionReview(session.id, label),
      render: (
        <button type="button" key="review-session" className="hn-terminal-action"
          onClick={() => onSessionReview(session.id, label)}
          aria-label={`Review sesi ${session.id}`} title="Review perubahan (diff worktree sesi)">
          <Icon name="git-compare" size={12} />
        </button>
      ),
    }] : []),
    ...(spec && onIntegrate ? [{
      key: "integrate", label: "Rebase / Merge branch", icon: "git-merge",
      title: "Rebase / Merge branch spec", onSelect: () => setIntegrate(true),
      render: (
        <button type="button" key="integrate" className="hn-terminal-action" onClick={() => setIntegrate(true)}
          aria-label={`Integrasikan sesi ${session.id}`} title="Rebase / Merge branch spec">
          <Icon name="git-merge" size={12} />
        </button>
      ),
    }] : []),
    ...(branchSession && onIntegrateSession ? [{
      key: "integrate-session", label: "Rebase / Merge branch", icon: "git-merge",
      title: "Rebase / Merge branch sesi", onSelect: () => setSessIntegrate(true),
      render: (
        <button type="button" key="integrate-session" className="hn-terminal-action"
          onClick={() => setSessIntegrate(true)}
          aria-label={`Integrasikan sesi ${session.id}`} title="Rebase / Merge branch sesi">
          <Icon name="git-merge" size={12} />
        </button>
      ),
    }] : []),
    {
      key: "detach", label: "Lepas dari grid", icon: "unlink", disabled: !canArrange,
      title: "Lepas dari grid (sesi tetap hidup)", onSelect: onDetach,
      render: (
        <button type="button" key="detach" className="hn-terminal-action hn-terminal-action--text"
          onClick={onDetach} disabled={!canArrange}
          title="Lepas dari grid (sesi tetap hidup)">lepas</button>
      ),
    },
  ];
  const inline = inlineActionCount(headerWidth, collapsible.length, coarse ? 44 : 28);
  const hidden = collapsible.slice(inline);
```

Di JSX header: pasang `ref={headerRef}` pada `div.hn-terminal-cell-header`, ganti blok tombol
dokumen/review/integrate/lepas menjadi:

```tsx
        {collapsible.slice(0, inline).map((action) => action.render)}
        {hidden.length > 0 && (
          <OverflowActions label={`Aksi lain sesi ${session.id}`}
            items={hidden.map(({ render: _render, ...item }) => item)} />
        )}
```

(`Layar penuh` dan `Tutup` tetap di tempatnya, sesudah blok ini.)

Terakhir, teruskan prop ke pane di dalam `Cell`:

```tsx
            : <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={onPhases}
                fontSize={fontSize} showKeys={showKeys} />}
```

dan pada `FullscreenTerminal` (tambah props `fontSize: number; showKeys: boolean` di tanda tangannya):

```tsx
        <TerminalPane key={session.id} sessionId={session.id} onExit={() => {}}
          fontSize={fontSize} showKeys={showKeys} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run test/terminal-screen.test.tsx`
Expected: PASS — 65 test lulus (61 lama + 4 baru).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(spec-800): header sel sadar-lebar + toolbar mobile diringkas"
```

---

### Task 8: Docs SoT, index, dan verifikasi ber-scope

**Files:**
- Modify: `internal/docs/architecture/stack.md` (bagian Terminal/PTY)
- Modify: `internal/docs/README.md`
- Test: seluruh berkas test yang tersentuh

- [ ] **Step 1: Perbarui doc arsitektur**

Tambahkan sub-bagian pada `internal/docs/architecture/stack.md` di dekat penjelasan PTY/tmux:

```markdown
### Chrome terminal (SPEC-800)

- Aksi header sel runtuh ke `OverflowActions` berdasarkan **lebar kontainernya**, bukan lebar
  viewport: sel grid 4 kolom di desktop lebih sempit daripada satu pane di ponsel. `Layar penuh`
  dan `Tutup` tak pernah runtuh.
- Pane menyambung ulang WebSocket-nya sendiri (backoff 500ms→8s, maksimum 6 percobaan, tiket baru
  tiap percobaan, berhenti pada close 4004) dan menguras input yang mengantre pada setiap `onopen`.
  Sebelum SPEC-800 setiap close membuat ketikan hilang tanpa satu tanda pun.
- Papan tombol layar mengirim **satu keystroke per tekan** (SPEC-452): `Esc` adalah satu-satunya
  jalan keluar dari copy-mode tmux, dan keyboard virtual ponsel tak menyediakannya.
- Tap pada baris opsi dialog claude mengirim satu digit — gerbangnya footer dialog Ink, sehingga
  daftar bernomor di layar kerja biasa tak pernah ikut terkirim.
- Wheel polos tetap milik tmux (SPEC-209); `Shift+wheel` menggulir scrollback xterm secara lokal.
- Ukuran font terminal adalah state tampilan persisten (SPEC-740 · ADR-0115), bukan bagian dari
  workspace kanonik per-user (SPEC-786 · ADR-0118).
```

- [ ] **Step 2: Tautkan di index**

Tambahkan entri audit SPEC-800 pada bagian `## research` di `internal/docs/README.md` bila belum ada
(fase Audit sudah menambahkannya), dan pastikan perubahan `architecture/stack.md` tetap ter-link.

Run: `node cli/dist/index.js docs index --check` atau `pnpm --filter ./cli exec hanoman docs index --check`
Expected: index konsisten (`ok`).

- [ ] **Step 3: Jalankan seluruh test yang tersentuh**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run \
  test/terminal-chrome.test.ts test/overflow-actions.test.tsx test/terminal-pane.test.tsx \
  test/terminal-screen.test.tsx test/terminal-cleanups.test.tsx test/terminal-history-button.test.tsx \
  test/responsive-no-squeeze.test.tsx test/responsive-touch-targets.test.ts test/ds.test.tsx \
  test/app-flows.test.tsx
```

Expected: semua berkas lulus, **nol** "no test files".

- [ ] **Step 4: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: nol error. (Jangan `pnpm -r typecheck` — mesin ini menjalankan beberapa sesi.)

- [ ] **Step 5: Smoke runtime sekali di akhir**

Karena perilaku runtime WS berubah, jalankan satu smoke lokal: boot server pada instance terisolasi,
buat satu sesi tmux di socket `hanoman` (jangan `POST /terminal/sessions` — ia men-spawn `claude`
sungguhan), lalu buka WS terminalnya dan pastikan (a) frame `in` diterima, (b) menutup socket dari
klien tidak meninggalkan proses menggantung.

```bash
tmux -L hanoman -f /dev/null new-session -d -s hanoman-smoke800 -c /tmp 'sh' \
  \; set-option -t hanoman-smoke800 @hanoman_project hanoman \
  \; set-option -t hanoman-smoke800 @hanoman_cwd /tmp
# … boot server dengan HANOMAN_HOME + DATABASE_URL sendiri, cek GET /api/terminal/sessions …
tmux -L hanoman kill-session -t hanoman-smoke800
```

- [ ] **Step 6: Commit**

```bash
git add internal/docs
git commit -m "docs(spec-800): chrome terminal di doc arsitektur + index"
```
