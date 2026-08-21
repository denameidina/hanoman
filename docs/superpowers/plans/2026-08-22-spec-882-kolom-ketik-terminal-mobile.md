# SPEC-882 · Kolom ketik terminal untuk tablet & ponsel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan kolom ketik (composer) di bawah setiap pane terminal pada perangkat sentuh — operator mengetik dengan umpan balik lokal nol RTT, dan isinya mengalir ke pty secara debounce 350 ms lewat satu-satunya pintu keluar byte yang sudah ada.

**Architecture:** Pola cermin `terminal-predict.ts` (SPEC-856): mesin keadaan sebagai **fungsi murni** di `src/src/screens/terminal-composer.ts` (nol DOM, nol WebSocket, nol xterm), komponen presentasional tipis `src/src/screens/TerminalComposer.tsx` yang hanya memegang irama debounce dan jalur peristiwa DOM, lalu wiring minimal di `TerminalPane.tsx`. Seluruh byte keluar lewat `sendKey.current` (= `sendRaw` = `batcher.push(d, false)`), satu-satunya pintu keluar sejak SPEC-878, sehingga urutan FIFO, antrean outage, dan penahanan `\r` berlaku tanpa satu baris kode baru.

**Tech Stack:** React 18 + TypeScript strict (Vite), `@xterm/xterm` 6, Vitest + jsdom + `@testing-library/react`, design system hanoman (`src/src/ds`, `src/src/app.css`).

**Rancangan sumber (WAJIB dibaca sebelum mulai):** `docs/superpowers/specs/2026-08-22-spec-882-kolom-ketik-terminal-mobile-design.md` (commit `c9eb5d2f`, status: disetujui operator).

## Global Constraints

Setiap task tunduk pada seluruh butir ini. Nilainya disalin apa adanya dari spec & backlog.

- **Nol perubahan `server/**`, nol skema, nol migration, nol endpoint, nol ADR.** Seluruh perubahan hidup di `src/**` + `internal/docs/**`.
- **Byte WAJIB keluar lewat `sendKey.current`** (satu pintu keluar SPEC-878). Jangan membuat jalur kirim baru: FIFO, antrean outage, dan penahanan `\r` berlaku gratis lewat pintu itu.
- **JANGAN memakai `\x15` (Ctrl-U)** sebagai mekanisme selaraskan-ulang: artinya berbeda di readline vs `vim` mode sisip vs TUI agen, dan pane tak selalu berisi shell. Backspace (`\x7f`) berlaku di mana pun.
- **Perhitungan delta wajib PER CODE POINT**, bukan unit UTF-16. Satu emoji yang dihitung sebagai dua unit menghasilkan jumlah backspace yang salah dan merusak baris pty tanpa jejak di layar operator.
- **`onExternalInput` wajib menguras delta tertunda LEBIH DULU lalu reset**, dan dipanggil **sinkron di awal `onTyped`, SEBELUM `batcher.push`**. Membaliknya menukar urutan byte di pty.
- **Atribut input wajib:** `autoCapitalize="off"`, `autoCorrect="off"`, `spellCheck={false}`, `autoComplete="off"`, `enterKeyHint="send"`. Tanpa ini papan ketik Android mengapitalkan & mengoreksi otomatis perintah shell — fitur ini akan mengirim teks yang bukan diketik operator.
- **Menyalakan/mematikan kolom mengubah tinggi pane** → wajib memicu `fit.fit()` **DAN** frame `resize`. Tanpa itu tmux menggambar untuk geometri lama.
- **JANGAN mengubah `deliverable`, TTL prediksi, maupun ADR-0134.** Ini bukan perbaikan akar; akarnya masih ditunggu dari perekam diagnostik `~/.hanoman/diag/<id>.jsonl`.
- **Urutan tata letak di dalam pane, atas ke bawah:** strip status → terminal (`flex: 1`) → kolom ketik → bar tombol Esc/Tab/panah. Tombol aksi turun ke paling bawah.
- **Ikut sakelar `showKeys` yang sudah ada** — tanpa setelan baru, tampil di **setiap** pane pada grid, bukan hanya pane aktif.
- **Design system** `internal/docs/design-system/design-system.md`: tinggi sasaran sentuh `var(--touch-target)` = 44 px, `font-family: var(--font-mono)`, token warna `--status-warn` / `--status-err` / `--text-subtle`, dan **kontrak placeholder SPEC-490** (placeholder = contoh nilai nyata, diawali `mis. ` bila nilainya bebas — ditegakkan `src/test/placeholder-contract.test.ts`).
- **Irama kirim:** debounce **350 ms** sesudah ketikan terakhir; kuras paksa tiap **1 detik** saat mengetik terus-menerus; kuras langsung saat kolom kehilangan fokus; Enter = submit langsung tanpa menunggu debounce.
- **Bahasa:** komentar & teks UI dalam Bahasa Indonesia, mengikuti berkas di sekitarnya. Komentar hanya untuk hal yang TIDAK terbaca dari kode (alasan, trade-off, invariant, rujukan SPEC/ADR).
- **Verifikasi per task:** jalankan HANYA test yang berkaitan (sebut path-nya), bukan suite penuh, bukan `pnpm -r typecheck`.

---

## File Structure

| Berkas | Tanggung jawab |
| --- | --- |
| `src/src/screens/terminal-composer.ts` | **Baru.** Modul murni: `ComposerState`, aritmetika delta per code point, transisi `onText`/`onFlush`/`onSubmit`/`onExternalInput`, konstanta irama, dan `statusFor` (penanda kejujuran pengiriman). Nol DOM, nol WebSocket, nol xterm. |
| `src/test/terminal-composer.test.ts` | **Baru.** Uji modul murni tanpa DOM (butir uji 1–8 + `statusFor`). |
| `src/src/screens/TerminalComposer.tsx` | **Baru.** Komponen presentasional: satu `<Input>` DS + penanda status. Memegang irama debounce dan jalur peristiwa DOM saja. |
| `src/src/app.css` | Kelas `.hn-terminal-composer` + `.hn-terminal-composer-status*`, bertetangga dengan `.hn-terminal-keys` yang sudah ada. |
| `src/src/screens/TerminalPane.tsx` | Sisip komponen di antara host terminal dan `<TerminalKeys>`; ref `composerDrain` + `sendOuter`; kuras kolom di awal `onTyped` dan pada seluruh jalur byte eksternal; effect `fit`+`resize` saat `showKeys` berubah. |
| `src/test/terminal-pane.test.tsx` | Tambahan uji wiring, urutan tata letak, atribut input, urutan byte, dan penanda status (butir uji 9–13). |
| `internal/docs/architecture/stack.md` | Satu butir baru di daftar invariant "Chrome terminal (SPEC-800)". |
| `internal/docs/README.md` | Tautan rancangan SPEC-882 di kategori `research`. |

---

### Task 1: Modul murni `terminal-composer.ts`

Aritmetika delta dan penanda status, seluruhnya sebagai fungsi murni. Tak ada yang mengimpornya lagi setelah task ini sampai Task 2 — task ini berdiri sendiri dan bisa diuji tanpa DOM.

**Files:**
- Create: `src/src/screens/terminal-composer.ts`
- Test: `src/test/terminal-composer.test.ts`

**Interfaces:**
- Consumes: tidak ada (modul daun).
- Produces:
  - `type ComposerState = { text: string; sentPrefix: string }`
  - `const DEBOUNCE_MS = 350`, `const MAX_HOLD_MS = 1_000`
  - `function initialState(): ComposerState`
  - `function commonPrefixLen(a: string, b: string): number`
  - `function deltaFor(sentPrefix: string, text: string): string`
  - `function onText(state: ComposerState, text: string): ComposerState`
  - `function onFlush(state: ComposerState): { state: ComposerState; send: string }`
  - `function onSubmit(state: ComposerState): { state: ComposerState; send: string }`
  - `function onExternalInput(state: ComposerState): { state: ComposerState; send: string }`
  - `type ComposerStatus = { kind: "sent" | "queued" | "held"; text: string }`
  - `function statusFor(linkState: string, queue: { n: number; held: boolean }): ComposerStatus | null`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/terminal-composer.test.ts` dengan isi persis:

```ts
import { describe, expect, it } from "vitest";
import {
  commonPrefixLen, deltaFor, initialState, onExternalInput, onFlush, onSubmit, onText,
  statusFor, DEBOUNCE_MS, MAX_HOLD_MS, type ComposerState,
} from "../src/screens/terminal-composer";

const at = (text: string, sentPrefix: string): ComposerState => ({ text, sentPrefix });

describe("commonPrefixLen", () => {
  it("menghitung awalan sama per code point, bukan unit UTF-16", () => {
    expect(commonPrefixLen("🙂ab", "🙂ax")).toBe(2);
    expect(commonPrefixLen("", "abc")).toBe(0);
    expect(commonPrefixLen("abc", "abc")).toBe(3);
  });
});

describe("deltaFor", () => {
  // Butir 1
  it("menambah di ujung → hanya karakter baru yang dikirim", () => {
    expect(deltaFor("git st", "git sta")).toBe("a");
    expect(deltaFor("", "halo")).toBe("halo");
  });

  // Butir 2
  it("menghapus di ujung → hanya \\x7f sebanyak selisih", () => {
    expect(deltaFor("halo", "ha")).toBe("\x7f\x7f");
    expect(deltaFor("halo", "")).toBe("\x7f\x7f\x7f\x7f");
  });

  // Butir 3
  it("menyunting di tengah → \\x7f sampai titik pisah lalu sisa teks", () => {
    expect(deltaFor("git commit", "git push")).toBe("\x7f\x7f\x7f\x7f\x7f\x7fpush");
  });

  // Butir 7 — emoji yang dihitung sebagai dua unit UTF-16 merusak baris pty.
  it("menghitung backspace per code point untuk emoji dan huruf beraksen", () => {
    expect(deltaFor("🙂🙂", "")).toBe("\x7f\x7f");
    expect(deltaFor("🙂🙂", "🙂")).toBe("\x7f");
    expect(deltaFor("café", "caf")).toBe("\x7f");
    expect(deltaFor("a🙂", "a🚀")).toBe("\x7f🚀");
  });

  it("tak mengirim apa pun saat tak ada yang berubah", () => {
    expect(deltaFor("halo", "halo")).toBe("");
    expect(deltaFor("", "")).toBe("");
  });
});

describe("onText / onFlush", () => {
  it("onText hanya menggeser teks yang dilihat operator, tanpa menyentuh sentPrefix", () => {
    expect(onText(initialState(), "ha")).toEqual({ text: "ha", sentPrefix: "" });
    expect(onText(at("ha", "h"), "hal")).toEqual({ text: "hal", sentPrefix: "h" });
  });

  it("onFlush mengirim delta lalu memindahkan sentPrefix ke teks saat ini", () => {
    const r = onFlush(at("halo", "ha"));
    expect(r.send).toBe("lo");
    expect(r.state).toEqual({ text: "halo", sentPrefix: "halo" });
  });

  // Butir 4
  it("onFlush tanpa perubahan mengirim string kosong", () => {
    const r = onFlush(at("halo", "halo"));
    expect(r.send).toBe("");
    expect(r.state).toEqual({ text: "halo", sentPrefix: "halo" });
  });
});

describe("onSubmit", () => {
  // Butir 5
  it("menguras delta SEBELUM \\r, lalu mereset", () => {
    const r = onSubmit(at("halo", "ha"));
    expect(r.send).toBe("lo\r");
    expect(r.state).toEqual(initialState());
  });

  // Butir 8 — Enter di baris kosong tetap sah.
  it("tetap mengirim \\r saat teksnya kosong", () => {
    expect(onSubmit(initialState()).send).toBe("\r");
  });

  it("membawa backspace ikut mendahului \\r saat operator memangkas sebelum submit", () => {
    expect(onSubmit(at("ha", "halo")).send).toBe("\x7f\x7f\r");
  });
});

describe("onExternalInput", () => {
  // Butir 6 — delta yang belum melewati debounce tak boleh hilang.
  it("menguras delta yang tertunda LEBIH DULU, baru menihilkan text dan sentPrefix", () => {
    const r = onExternalInput(at("halo", "ha"));
    expect(r.send).toBe("lo");
    expect(r.state).toEqual(initialState());
  });

  it("tak mengirim apa pun saat tak ada delta tertunda", () => {
    const r = onExternalInput(at("halo", "halo"));
    expect(r.send).toBe("");
    expect(r.state).toEqual(initialState());
  });

  it("tak pernah memakai \\x15 sebagai selaraskan-ulang", () => {
    expect(onExternalInput(at("halo", "halo")).send).not.toContain("\x15");
    expect(onSubmit(at("x", "halo")).send).not.toContain("\x15");
  });
});

describe("statusFor", () => {
  it("mengatakan terkirim saat sambungan terbuka dan antrean kosong", () => {
    expect(statusFor("open", { n: 0, held: false })).toEqual({ kind: "sent", text: "terkirim" });
  });

  it("mengatakan berapa yang diantre saat antrean terisi dan tak ditahan", () => {
    expect(statusFor("open", { n: 7, held: false })).toEqual({ kind: "queued", text: "diantre 7" });
    expect(statusFor("retrying", { n: 7, held: false })).toEqual({ kind: "queued", text: "diantre 7" });
  });

  it("mengatakan tertahan dan menunjuk tombol Kirim di strip atas", () => {
    expect(statusFor("open", { n: 3, held: true }))
      .toEqual({ kind: "held", text: "tertahan — Kirim di atas" });
  });

  // Strip status di atas pane sudah bicara sendiri saat menyambung ulang; penanda kedua yang
  // mengatakan hal yang sama hanya menambah derau.
  it("diam saat sambungan belum terbuka dan tak ada apa pun yang menunggu", () => {
    expect(statusFor("retrying", { n: 0, held: false })).toBeNull();
    expect(statusFor("gone", { n: 0, held: false })).toBeNull();
  });
});

describe("irama kirim", () => {
  it("memakai debounce 350 ms dan kuras paksa 1 detik", () => {
    expect(DEBOUNCE_MS).toBe(350);
    expect(MAX_HOLD_MS).toBe(1_000);
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia GAGAL**

Run: `pnpm --filter ./src exec vitest --run test/terminal-composer.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/terminal-composer"`.

- [x] **Step 3: Tulis implementasi minimalnya**

Buat `src/src/screens/terminal-composer.ts` dengan isi persis:

```ts
// SPEC-882 · kolom ketik (composer) untuk perangkat sentuh. Pola cermin `terminal-predict.ts`
// (SPEC-856): seluruh logikanya murni supaya aritmetika delta bisa diuji tanpa DOM, tanpa
// WebSocket, dan tanpa xterm — komponen hanya memegang irama dan jalur peristiwa.
//
// Kolom ini MELENGKAPI, bukan menggantikan, mengetik langsung ke pane: operator melihat hurufnya
// seketika (nol RTT, tak bergantung kesehatan sambungan) dan isinya mengalir ke pty secara debounce.
// Ia sengaja BUKAN perbaikan akar lag tablet — akarnya masih ditunggu dari perekam diagnostik.

/** DEL. Satu-satunya mekanisme selaraskan-ulang yang dipakai modul ini. `\x15` (Ctrl-U) DITOLAK:
 *  artinya berbeda per program — readline memotong sampai awal baris, `vim` mode sisip melakukan
 *  hal lain, dan pane tak selalu berisi shell. Backspace bekerja di mana-mana; ongkos beberapa byte
 *  ekstra pada suntingan tengah tak terasa dibanding satu RTT. */
const BACKSPACE = "\x7f";

/** Debounce sesudah ketikan terakhir. */
export const DEBOUNCE_MS = 350;
/** Kuras paksa saat mengetik terus-menerus: tanpa ini kalimat yang diketik tanpa jeda 350 ms
 *  menahan seluruh isinya sampai jari berhenti, dan terminal di atasnya tertinggal berdetik-detik. */
export const MAX_HOLD_MS = 1_000;

export type ComposerState = {
  /** yang dilihat operator di kolom */
  text: string;
  /** yang diyakini sudah mendarat di baris pty DARI kolom ini */
  sentPrefix: string;
};

export function initialState(): ComposerState {
  return { text: "", sentPrefix: "" };
}

/** Panjang awalan sama antara dua teks, dihitung PER CODE POINT. Menghitungnya dalam unit UTF-16
 *  membuat satu emoji bernilai dua backspace: baris pty rusak sementara layar operator tetap
 *  terlihat benar. */
export function commonPrefixLen(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return n;
}

/** Satu aturan untuk tiga kasus: mundur sampai titik pisah, lalu ketik sisanya. Menambah di ujung
 *  jadi murni append; menghapus di ujung jadi murni backspace; menyunting di tengah jadi keduanya. */
export function deltaFor(sentPrefix: string, text: string): string {
  const k = commonPrefixLen(sentPrefix, text);
  return BACKSPACE.repeat([...sentPrefix].length - k) + [...text].slice(k).join("");
}

export function onText(state: ComposerState, text: string): ComposerState {
  return { ...state, text };
}

export function onFlush(state: ComposerState): { state: ComposerState; send: string } {
  return {
    state: { ...state, sentPrefix: state.text },
    send: deltaFor(state.sentPrefix, state.text),
  };
}

/** `flush` dulu, lalu `\r`, lalu `reset` — urutan ini tak boleh terbalik: `\r` yang mendahului
 *  deltanya men-submit baris yang belum lengkap. Keduanya satu payload supaya tak ada apa pun yang
 *  bisa menyelip di antaranya. */
export function onSubmit(state: ComposerState): { state: ComposerState; send: string } {
  return { state: initialState(), send: deltaFor(state.sentPrefix, state.text) + "\r" };
}

/** Operator mengetik langsung ke pane (papan tombol fisik, tap, tombol Esc/Tab/panah, tempel,
 *  path lampiran). Delta yang belum melewati debounce dikuras LEBIH DULU — tanpa itu huruf yang
 *  sudah diketik operator lenyap tanpa jejak.
 *
 *  Sesudah reset `sentPrefix` NOL, bukan dipertahankan: menebak isi baris pty sesudah byte asing
 *  masuk adalah tebakan, dan tebakan di sini berarti byte yang salah. */
export function onExternalInput(state: ComposerState): { state: ComposerState; send: string } {
  return { state: initialState(), send: deltaFor(state.sentPrefix, state.text) };
}

/** Penanda kejujuran pengiriman. Tanpa ini kolom ketik memperburuk masalah yang sedang diselidiki:
 *  ia terasa mulus persis ketika byte-nya tidak ke mana-mana (terukur: 26 glyph tampil ~21 ms
 *  sementara `tmux capture-pane` menunjukkan prompt kosong). */
export type ComposerStatus = { kind: "sent" | "queued" | "held"; text: string };

export function statusFor(
  linkState: string, queue: { n: number; held: boolean },
): ComposerStatus | null {
  if (queue.held) return { kind: "held", text: "tertahan — Kirim di atas" };
  if (queue.n > 0) return { kind: "queued", text: `diantre ${queue.n}` };
  if (linkState === "open") return { kind: "sent", text: "terkirim" };
  // Strip status di atas pane sudah mengatakan "menyambung ulang…"; penanda kedua yang mengulangnya
  // hanya menambah derau.
  return null;
}
```

- [x] **Step 4: Jalankan test untuk memastikan ia LULUS**

Run: `pnpm --filter ./src exec vitest --run test/terminal-composer.test.ts`
Expected: PASS — 16 test lulus, 0 gagal.

- [x] **Step 5: Typecheck paket `src`**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/terminal-composer.ts src/test/terminal-composer.test.ts
git commit -m "feat(spec-882): modul murni kolom ketik terminal (delta per code point)"
```

---

### Task 2: Komponen `TerminalComposer` + wiring render di pane

Komponen presentasional beserta CSS-nya, sudah dirender lewat `TerminalPane` supaya ia punya siklus uji sendiri: gerbang `showKeys`, urutan DOM, dan atribut papan ketik. Byte belum diuji di sini — itu milik Task 3.

**Files:**
- Create: `src/src/screens/TerminalComposer.tsx`
- Modify: `src/src/app.css` (sisipkan setelah aturan `.hn-terminal-key:hover`, baris 459)
- Modify: `src/src/screens/TerminalPane.tsx` (import baru; ref `composerDrain`; sisipan JSX sebelum `<TerminalKeys>`, baris 554)
- Test: `src/test/terminal-pane.test.tsx` (describe baru di akhir berkas)

**Interfaces:**
- Consumes dari Task 1: `initialState`, `onText`, `onFlush`, `onSubmit`, `onExternalInput`, `statusFor`, `DEBOUNCE_MS`, `MAX_HOLD_MS`, `type ComposerState`.
- Produces:
  - `function TerminalComposer(props: { sessionId: string; send: (d: string) => void; external: React.MutableRefObject<() => void>; linkState: string; queue: { n: number; held: boolean } }): JSX.Element`
  - DOM: `<div class="hn-terminal-composer">` berisi `<input data-testid="terminal-composer">` dan (opsional) `<span data-testid="terminal-composer-status">`.
  - `TerminalPane` mengekspos ref `composerDrain: React.MutableRefObject<() => void>` ke komponen itu lewat prop `external`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di **akhir** `src/test/terminal-pane.test.tsx`:

```ts
describe("TerminalPane · kolom ketik perangkat sentuh (SPEC-882)", () => {
  const composer = () => screen.getByTestId("terminal-composer") as HTMLInputElement;

  // Butir 9
  it("tak merender kolom ketik saat sakelar papan tombol layar mati", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.queryByTestId("terminal-composer")).toBeNull();
  });

  it("merender kolom ketik mengikuti sakelar yang sudah ada", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(screen.getByTestId("terminal-composer")).not.toBeNull();
  });

  // Butir 10 — tombol aksi turun ke paling bawah.
  it("menaruh kolom ketik DI ANTARA host terminal dan bar tombol", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const kids = Array.from(paneHost(container).parentElement!.children);
    const at = (sel: string) => kids.findIndex((k) => k.matches(sel) || k.querySelector(sel) !== null);
    expect(at('[data-testid="terminal-host"]')).toBeGreaterThanOrEqual(0);
    expect(at('[data-testid="terminal-host"]')).toBeLessThan(at(".hn-terminal-composer"));
    expect(at(".hn-terminal-composer")).toBeLessThan(at(".hn-terminal-keys"));
  });

  // Tanpa atribut ini papan ketik Android mengapitalkan & mengoreksi otomatis perintah shell,
  // dan kolom akan mengirim teks yang bukan diketik operator.
  it("mematikan kapitalisasi, koreksi, dan saran papan ketik lunak", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const el = composer();
    expect(el.getAttribute("autocapitalize")).toBe("off");
    expect(el.getAttribute("autocorrect")).toBe("off");
    expect(el.getAttribute("spellcheck")).toBe("false");
    expect(el.getAttribute("autocomplete")).toBe("off");
    expect(el.getAttribute("enterkeyhint")).toBe("send");
    expect(el.getAttribute("aria-label")).toBe("Ketik untuk sesi sesi-1");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia GAGAL**

Run: `pnpm --filter ./src exec vitest --run test/terminal-pane.test.tsx -t "SPEC-882"`
Expected: FAIL — `Unable to find an element by: [data-testid="terminal-composer"]` pada tiga test terakhir.

- [x] **Step 3: Tulis komponennya**

Buat `src/src/screens/TerminalComposer.tsx` dengan isi persis:

```tsx
import React from "react";
import { Input } from "../ds/components/forms";
import * as C from "./terminal-composer";

// SPEC-882 · kolom ketik untuk tablet & ponsel. Presentasional: seluruh aritmetika delta hidup di
// `terminal-composer.ts`; yang di sini hanya irama (debounce) dan jalur peristiwa DOM.
//
// Keadaan otoritatifnya dipegang di REF, bukan di state React: `external` dipanggil pane secara
// sinkron dari dalam `term.onData`, dan closure yang tertinggal satu render akan menguras teks yang
// sudah basi. `text` yang jadi state hanya melayani nilai `<input>` yang terkendali.
export function TerminalComposer({ sessionId, send, external, linkState, queue }: {
  sessionId: string;
  /** Pintu keluar byte SPEC-878 milik pane (`sendKey.current`). */
  send: (d: string) => void;
  /** Diisi komponen ini; dipanggil pane saat byte lahir DI LUAR kolom. */
  external: React.MutableRefObject<() => void>;
  linkState: string;
  queue: { n: number; held: boolean };
}) {
  const [text, setText] = React.useState("");
  const state = React.useRef<C.ComposerState>(C.initialState());
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const debounce = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const forced = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = () => {
    clearTimeout(debounce.current);
    debounce.current = undefined;
    clearTimeout(forced.current);
    forced.current = undefined;
  };
  const emit = (r: { state: C.ComposerState; send: string }) => {
    stop();
    state.current = r.state;
    if (r.send) sendRef.current(r.send);
  };
  const flush = () => emit(C.onFlush(state.current));

  // Dipasang saat render, bukan di dalam effect: pane memanggilnya SINKRON di awal `onTyped`, jadi
  // ia harus sudah menunjuk ke teks paling mutakhir sebelum effect apa pun sempat berjalan.
  external.current = () => { emit(C.onExternalInput(state.current)); setText(""); };
  React.useEffect(() => () => { external.current = () => {}; }, [external]);
  React.useEffect(() => stop, []);

  const change = (next: string) => {
    state.current = C.onText(state.current, next);
    setText(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(flush, C.DEBOUNCE_MS);
    // Kuras paksa TIDAK di-restart tiap ketikan: itulah yang membuat mengetik tanpa jeda tetap
    // menyeberang ke pty tiap detik, bukan tertahan sampai jari berhenti.
    if (!forced.current) forced.current = setTimeout(flush, C.MAX_HOLD_MS);
  };
  const submit = () => { emit(C.onSubmit(state.current)); setText(""); };

  const status = C.statusFor(linkState, queue);
  return (
    <div className="hn-terminal-composer">
      <Input size="lg" mono value={text} data-testid="terminal-composer"
        aria-label={`Ketik untuk sesi ${sessionId}`}
        placeholder="mis. pnpm vitest --run"
        autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
        enterKeyHint="send"
        style={{ flex: "1 1 160px", minWidth: 0 }}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => change(e.target.value)}
        onBlur={() => flush()}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          // `isComposing` menutup papan ketik IME: di sana Enter menutup kandidat, bukan mengirim
          // baris — tanpa gerbang ini kalimat yang belum selesai disusun ikut ter-submit.
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }} />
      {status && (
        <span data-testid="terminal-composer-status"
          className={`hn-terminal-composer-status hn-terminal-composer-status--${status.kind}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}
```

- [x] **Step 4: Tambahkan CSS-nya**

Di `src/src/app.css`, tepat SESUDAH baris `.hn-terminal-key:hover { background: var(--bone-200); color: var(--text-strong); }` dan SEBELUM blok `@media (max-width: 767px)`, sisipkan:

```css
/* SPEC-882 · kolom ketik perangkat sentuh: satu baris, penanda kejujuran pengiriman di kanannya.
   Basis flex dinyatakan (bukan `auto`) karena `flex-wrap` memutus baris SEBELUM menyusut — pelajaran
   SPEC-879: basis `auto` berarti lebar isi, jadi bentuk barisnya ditentukan isinya, bukan layout-nya. */
.hn-terminal-composer {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  border-top: 1px solid var(--border-hair);
}

.hn-terminal-composer-status {
  flex: 0 0 auto;
  font: var(--text-xs)/1.2 var(--font-mono);
  color: var(--text-subtle);
  white-space: nowrap;
}

.hn-terminal-composer-status--queued { color: var(--status-warn); }
.hn-terminal-composer-status--held { color: var(--status-err); }
```

- [x] **Step 5: Sisipkan komponen ke `TerminalPane`**

Di `src/src/screens/TerminalPane.tsx`:

1. Tambahkan import setelah baris `import * as D from "./terminal-diag";`:

```ts
import { TerminalComposer } from "./TerminalComposer";
```

2. Tambahkan ref setelah baris `const dropHeld = React.useRef<() => void>(() => {});`:

```ts
  // SPEC-882 · diisi `TerminalComposer`; dipanggil setiap kali byte lahir DI LUAR kolom ketik.
  const composerDrain = React.useRef<() => void>(() => {});
```

3. Ganti baris JSX `{showKeys && <TerminalKeys onKey={(seq) => sendKey.current(seq)} />}` menjadi:

```tsx
      {showKeys && <TerminalComposer sessionId={sessionId} send={(d) => sendKey.current(d)}
        external={composerDrain} linkState={link.state} queue={queue} />}
      {showKeys && <TerminalKeys onKey={(seq) => sendKey.current(seq)} />}
```

(`TerminalKeys` masih memakai `sendKey.current` di langkah ini; Task 3 yang memindahkannya ke pintu eksternal.)

- [x] **Step 6: Jalankan test untuk memastikan ia LULUS**

Run: `pnpm --filter ./src exec vitest --run test/terminal-pane.test.tsx -t "SPEC-882"`
Expected: PASS — 4 test lulus.

- [x] **Step 7: Jalankan kontrak placeholder dan test pane penuh**

Run: `pnpm --filter ./src exec vitest --run test/placeholder-contract.test.ts test/terminal-pane.test.tsx`
Expected: `terminal-pane.test.tsx` PASS seluruhnya. `placeholder-contract.test.ts` sudah merah di base pada tiga `<Input type="number">` milik `SettingsScreen.tsx` — itu **bukan** regresi task ini. Yang wajib dipastikan: daftar `missing` **tidak** memuat `TerminalComposer.tsx`. Bila ia muncul di sana, placeholder-nya hilang — kembalikan.

- [x] **Step 8: Typecheck paket `src`**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [x] **Step 9: Commit**

```bash
git add src/src/screens/TerminalComposer.tsx src/src/screens/TerminalPane.tsx src/src/app.css src/test/terminal-pane.test.tsx
git commit -m "feat(spec-882): komponen kolom ketik di bawah setiap pane terminal"
```

---

### Task 3: Urutan byte, kuras eksternal, dan geometri pane

Yang membuat kolom ini benar dan bukan sekadar tampil: delta yang tertunda mendahului byte eksternal di pty, Enter mengosongkan kolom, penanda status jujur, dan menyalakan/mematikan kolom memicu `fit.fit()` + frame `resize`.

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane.test.tsx` (tambahan di describe SPEC-882 yang sudah ada)

**Interfaces:**
- Consumes dari Task 2: `composerDrain` ref, `<TerminalComposer>` terpasang, `data-testid="terminal-composer"` / `"terminal-composer-status"`.
- Produces:
  - `sendOuter: React.MutableRefObject<(d: string) => void>` — pintu byte **eksternal** di `TerminalPane`; menguras kolom lalu meneruskan ke `sendRaw`.
  - `sendKey.current` **tetap** `sendRaw` (pintu mentah SPEC-878) dan tetap milik kolom ketik.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di dalam `describe("TerminalPane · kolom ketik perangkat sentuh (SPEC-882)", …)` yang dibuat Task 2, setelah test terakhirnya:

```ts
  const wait882 = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));
  const type882 = (value: string) => act(() => { fireEvent.change(composer(), { target: { value } }); });
  const enter882 = () => act(() => { fireEvent.keyDown(composer(), { key: "Enter" }); });

  const openPane = async (props: Record<string, unknown> = {}) => {
    const r = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys {...props} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    return r;
  };

  it("mengalirkan isi kolom ke pty sesudah debounce, sebagai delta bukan seluruh baris", async () => {
    await openPane();
    const before = inputsOf(sockets[0]).length;
    type882("ls");
    expect(inputsOf(sockets[0]).slice(before)).toEqual([]);
    await wait882(400);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["ls"]);
    type882("ls -l");
    await wait882(400);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["ls", " -l"]);
    type882("ls");
    await wait882(400);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["ls", " -l", "\x7f\x7f\x7f"]);
  });

  // Butir 11
  it("mengosongkan kolom saat Enter, dan \\r menyusul di belakang deltanya", async () => {
    await openPane();
    const before = inputsOf(sockets[0]).length;
    type882("halo");
    enter882();
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["halo\r"]);
    expect(composer().value).toBe("");
    // Debounce yang tertinggal tak boleh mengirim ulang apa pun sesudah submit.
    await wait882(400);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["halo\r"]);
  });

  it("menguras kolom saat ia kehilangan fokus", async () => {
    await openPane();
    const before = inputsOf(sockets[0]).length;
    type882("git");
    act(() => { fireEvent.blur(composer()); });
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["git"]);
  });

  // Butir 12 — membaliknya menukar urutan byte di pty.
  it("mengirim delta kolom MENDAHULUI ketikan langsung ke pane, lalu mengosongkan kolom", async () => {
    await openPane();
    const before = inputsOf(sockets[0]).length;
    type882("ls");
    act(() => { xt.dataHandler?.("x"); });
    await wait882(40);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["ls", "x"]);
    expect(composer().value).toBe("");
  });

  it("mengirim delta kolom MENDAHULUI tombol Esc/Tab/panah", async () => {
    await openPane();
    const before = inputsOf(sockets[0]).length;
    type882("ls");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Kirim Escape ke terminal" })); });
    await wait882(40);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["ls", "\x1b"]);
    expect(composer().value).toBe("");
  });

  // Butir 13
  it("mengikuti keadaan sambungan dan antrean pada penanda status", async () => {
    const { container } = await openPane();
    expect(screen.getByTestId("terminal-composer-status").textContent).toBe("terkirim");
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    for (const c of [..."halo"]) act(() => { xt.dataHandler?.(c); });
    await wait882(40);
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-status").textContent).toBe("diantre 4");
    });
    act(() => { xt.dataHandler?.("\r"); });
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 3_000 });
    act(() => { sockets[1]!.onopen?.(); });
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-status").textContent)
        .toBe("tertahan — Kirim di atas");
    });
    expect(container.querySelector('[data-testid="terminal-held"]')).not.toBeNull();
  });

  it("menyesuaikan geometri pty saat kolom ketik muncul dan hilang", async () => {
    const { container, rerender } = render(
      <TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    act(() => { sockets[0]!.onopen?.(); });
    const fitsBefore = xt.fitCount;
    const resizesBefore = sockets[0]!.sent.filter((m) => m.includes('"resize"')).length;
    rerender(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    expect(xt.fitCount).toBe(fitsBefore + 1);
    expect(sockets[0]!.sent.filter((m) => m.includes('"resize"')).length).toBe(resizesBefore + 1);
    rerender(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    expect(xt.fitCount).toBe(fitsBefore + 2);
    expect(sockets[0]!.sent.filter((m) => m.includes('"resize"')).length).toBe(resizesBefore + 2);
  });
```

- [x] **Step 2: Jalankan test untuk memastikan ia GAGAL**

Run: `pnpm --filter ./src exec vitest --run test/terminal-pane.test.tsx -t "SPEC-882"`
Expected: FAIL. Yang gagal minimal: urutan `["ls", "x"]` (yang muncul justru `["x", "ls"]` atau `["x"]`), urutan `["ls", "\x1b"]`, dan test geometri (`xt.fitCount` tak bertambah).

- [x] **Step 3: Kuras kolom di setiap jalur byte eksternal**

Di `src/src/screens/TerminalPane.tsx`:

1. Tambahkan ref di sebelah `composerDrain` (setelah `const dropHeld = …`):

```ts
  // SPEC-882 · pintu byte yang lahir DI LUAR kolom ketik: ia menguras kolom lebih dulu, lalu lewat
  // pintu mentah yang sama. `sendKey` sengaja TIDAK dibungkus — itu pintu yang dipakai kolom ketik
  // sendiri, dan membungkusnya akan membuatnya menguras dirinya sendiri.
  const sendOuter = React.useRef<(d: string) => void>(() => {});
```

2. Tepat setelah baris `sendKey.current = sendRaw;`, tambahkan:

```ts
    // SPEC-882 · delta kolom yang belum melewati debounce wajib mendarat di pty MENDAHULUI byte
    // ini — membaliknya menghasilkan baris yang salah di pty.
    const sendExternal = (d: string) => { composerDrain.current(); sendRaw(d); };
    sendOuter.current = sendExternal;
```

3. Jadikan `composerDrain.current()` pernyataan **pertama** di `onTyped`:

```ts
    const onTyped = (d: string) => {
      // SPEC-882 · sinkron, sebelum apa pun menyentuh batcher: byte kolom masuk antrean FIFO
      // mendahului byte eksternal ini.
      composerDrain.current();
      const wasPredicting = pred.pending.length > 0;
```

4. Ganti tiga call site `sendRaw` yang membawa byte eksternal menjadi `sendExternal`:
   - tempel clipboard: `void navigator.clipboard?.readText().then((t) => { if (t) sendExternal(t); });`
   - tap opsi dialog: `if (choice) sendExternal(choice);`
   - path lampiran: `sendExternal(`${path} `);`

5. Tambahkan pembersihan ref di dalam fungsi cleanup effect, di sebelah `sendKey.current = () => {};`:

```ts
      sendOuter.current = () => {};
```

6. Ganti prop `TerminalKeys` di JSX supaya memakai pintu eksternal:

```tsx
      {showKeys && <TerminalKeys onKey={(seq) => sendOuter.current(seq)} />}
```

- [x] **Step 4: Picu `fit.fit()` + frame `resize` saat kolom muncul/hilang**

Di `src/src/screens/TerminalPane.tsx`, tepat SESUDAH effect `[fontSize]` yang sudah ada dan SEBELUM `return (`, tambahkan:

```ts
  // SPEC-882 · kolom ketik & bar tombol memakan tinggi host, jadi `cols`/`rows` PTY ikut berubah
  // saat sakelarnya digeser. ResizeObserver menangkapnya di browser, tapi frame `resize` wajib
  // menyusul dari perubahan yang KITA lakukan juga — tanpa itu tmux menggambar untuk geometri lama.
  React.useEffect(() => {
    const current = view.current;
    const el = host.current;
    if (!current || !el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    current.fit.fit();
    current.send({ t: "resize", cols: current.term.cols, rows: current.term.rows });
  }, [showKeys]);
```

- [x] **Step 5: Jalankan test untuk memastikan ia LULUS**

Run: `pnpm --filter ./src exec vitest --run test/terminal-pane.test.tsx`
Expected: PASS — seluruh berkas hijau, termasuk test SPEC-800/816/856/878 yang sudah ada (kontrol negatif: mereka tak boleh berubah perilakunya).

- [x] **Step 6: Typecheck paket `src`**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(spec-882): kuras kolom ketik sebelum byte eksternal + geometri pane"
```

---

### Task 4: Docs Source of Truth + verifikasi scope-berubah

Docs yang tersentuh diperbarui dalam commit yang sama dan ter-link di index (AGENTS.md aturan 2).

**Files:**
- Modify: `internal/docs/architecture/stack.md` (daftar invariant "Chrome terminal (SPEC-800)")
- Modify: `internal/docs/README.md` (kategori `research`)

**Interfaces:**
- Consumes: perilaku final dari Task 1–3.
- Produces: tak ada simbol kode.

- [ ] **Step 1: Tambahkan invariant baru di `stack.md`**

Di `internal/docs/architecture/stack.md`, di dalam daftar berpoin di bawah judul `### Chrome terminal (SPEC-800)`, tepat SESUDAH butir yang diawali `- **Lampiran gambar adalah BERKAS + PATH, bukan gambar inline** (SPEC-816).` (butir terakhir daftar itu), tambahkan:

```markdown
- **Kolom ketik perangkat sentuh adalah jalur ketik kedua, bukan pengganti** (SPEC-882). Di bawah
  setiap pane — mengikuti sakelar `showKeys` yang sudah ada, urutan `strip status → terminal →
  kolom ketik → bar tombol` — ada satu `<input>` yang memberi umpan balik lokal **nol RTT**,
  lepas dari kesehatan sambungan, lalu mengalirkan isinya ke pty secara **debounce 350 ms** (kuras
  paksa tiap 1 dtk saat mengetik terus-menerus, kuras langsung saat kehilangan fokus, Enter =
  submit seketika). Aritmetikanya murni di `screens/terminal-composer.ts`: **satu** aturan delta
  berbasis backspace — `\x7f` sebanyak sisa `sentPrefix` sesudah awalan sama, lalu ekor teks baru,
  dihitung **PER CODE POINT** (unit UTF-16 membuat satu emoji bernilai dua backspace dan merusak
  baris pty). `\x15` (Ctrl-U) **ditolak** sebagai selaraskan-ulang: artinya berbeda di readline vs
  `vim` mode sisip, dan pane tak selalu berisi shell. Byte-nya keluar lewat `sendKey.current` yang
  sama dengan jalur lain, jadi FIFO, antrean outage, dan penahanan `\r` (SPEC-878) berlaku tanpa
  kode baru; sebaliknya **setiap** byte yang lahir di luar kolom (ketikan langsung, tombol
  Esc/Tab/panah, tap dialog, tempel, path lampiran) menguras kolom **lebih dulu** lalu menihilkan
  `sentPrefix` — menebak isi baris pty sesudah byte asing masuk berarti byte yang salah. Penanda
  `terkirim` / `diantre {n}` / `tertahan` menempel di kolom karena tanpa itu ia terasa mulus persis
  ketika byte-nya tidak ke mana-mana (terukur: 26 glyph tampil ~21 ms sementara `capture-pane`
  menunjukkan prompt kosong). Ini **bukan** perbaikan akar lag tablet — `deliverable`, TTL prediksi,
  dan ADR-0134 tak disentuh; akarnya masih ditunggu dari perekam diagnostik.
```

- [ ] **Step 2: Tautkan rancangannya di index Source of Truth**

Di `internal/docs/README.md`, di dalam kategori `## research`, tepat SESUDAH baris yang memuat `audit-spec-879-ide-responsif-layar-sempit.md` (baris pertama daftar `research`), tambahkan satu baris:

```markdown
- [rancangan SPEC-882 — kolom ketik terminal untuk tablet & ponsel](../../docs/superpowers/specs/2026-08-22-spec-882-kolom-ketik-terminal-mobile-design.md) — jalur ketik kedua di bawah setiap pane sentuh: umpan balik lokal **nol RTT** lepas dari kesehatan sambungan, isinya mengalir ke pty **debounce 350 ms** lewat `sendKey.current` yang sama (FIFO, antrean outage, penahanan `\r` SPEC-878 berlaku gratis). **Satu** aturan delta berbasis backspace dihitung **per code point** — `\x15` ditolak karena artinya berbeda per program, dan unit UTF-16 membuat satu emoji bernilai dua backspace. Sengaja **bukan** perbaikan akar: `deliverable`, TTL prediksi, dan ADR-0134 tak disentuh, jadi penanda `terkirim`/`diantre`/`tertahan` di kolom itulah yang menjaga ia tak terasa mulus persis saat byte-nya tak ke mana-mana
```

- [ ] **Step 3: Verifikasi integritas index**

Run: `node cli/dist/index.js docs index --check` (bila `cli/dist` belum ada, jalankan `pnpm --filter ./cli build` lebih dulu)
Expected: index dinyatakan konsisten, atau — bila perintahnya tak tersedia di worktree ini — lewati langkah ini dan catat alasannya.

- [ ] **Step 4: Jalankan seluruh test yang tersentuh perubahan**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: berkas yang berjalan memuat **setidaknya** `src/test/terminal-composer.test.ts` dan `src/test/terminal-pane.test.tsx`, keduanya hijau. Jebakan: `--changed` menyalakan `passWithNoTests`, jadi "no test files" **bukan** bukti — pastikan kedua berkas itu benar-benar muncul di keluaran. Kegagalan yang sudah merah di base (mis. tiga `<Input type="number">` `SettingsScreen` pada `placeholder-contract`, atau `listChatSessions is not a function` di test portal) bukan regresi; buktikan dengan menjalankan berkas itu pada `git stash`-bebas hanya bila ragu, dan catat apa adanya.

- [ ] **Step 5: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error. **Jangan** `pnpm -r typecheck`.

- [ ] **Step 6: Commit**

```bash
git add internal/docs/architecture/stack.md internal/docs/README.md docs/superpowers/plans/2026-08-22-spec-882-kolom-ketik-terminal-mobile.md
git commit -m "docs(spec-882): invariant kolom ketik terminal di stack + tautan index"
```

---

## Yang sengaja TIDAK dikerjakan

Disalin dari spec — jangan menambahkannya diam-diam:

- Tidak memperbaiki akar lag tablet; masih menunggu bukti perekam diagnostik `~/.hanoman/diag/<id>.jsonl`.
- Tidak mengubah `deliverable`, TTL prediksi, maupun ADR-0134.
- Tidak menyentuh `server/**`.
- Tidak menambah riwayat/history untuk kolom ketik (YAGNI).
- Tidak mendukung multi-baris di kolom (Enter = kirim, bukan baris baru).
