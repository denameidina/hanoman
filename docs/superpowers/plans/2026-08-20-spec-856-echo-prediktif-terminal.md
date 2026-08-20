# SPEC-856 — echo prediktif lokal + coalescing input terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengetik di sesi terminal hanoman lewat domain publik terasa seketika — karakter tampil lokal lebih dulu lalu direkonsiliasi dengan echo asli dari pty, tanpa pernah meninggalkan sisa atau merusak layar TUI agen.

**Architecture:** Seluruh logika hidup di **klien**. Modul murni `terminal-predict.ts` (tanpa React, tanpa xterm) memegang state machine prediksi + rekonsiliasi + batching input; `TerminalPane` hanya menyuplai pandangan layar (kursor, lebar, isi baris) dan mengeksekusi keputusannya. Invarian keselamatannya satu kalimat: **begitu satu byte pun datang dari pty, prediksi di-rollback sebelum byte itu ditulis, dalam satu panggilan `term.write`** — sehingga layar sesudah setiap frame server byte-identik dengan layar tanpa prediksi. Tak ada perubahan server, tak ada tipe frame WS baru, tak ada skema, tak ada ADR.

**Tech Stack:** React 18 + TypeScript strict, `@xterm/xterm` 6, Vitest + Testing Library (jsdom), `usePersistedState` (`src/src/ui-state`).

## Global Constraints

- **Prediksi tak boleh mengubah satu byte pun yang dikirim ke pty.** Ia murni tampilan lokal; tak satu karakter boleh ganda atau hilang di sisi kirim.
- **Kontrak frame WS SPEC-812 tak disentuh:** `t:"in"` / `t:"data"`, coalesce keluar 16 ms / 64 KiB, `perMessageDeflate` level 6 `memLevel` 7. Tidak ada perubahan di `server/**`.
- **Jalur mahal terminal wajib utuh:** clipboard Cmd/Ctrl+C-V (SPEC-289/511), tap memilih baris dialog claude (SPEC-452/800), Shift+wheel & swipe scroll (SPEC-771/800/209), lampiran gambar (SPEC-816), reconnect + `pendingInput` saat socket belum OPEN. Hanya `term.onData` yang boleh lewat jalur baru; `sendInput` mentah tetap dipakai apa adanya oleh keempat jalur itu.
- **Gerbang alt-screen hanya membaca `?1049h/l` dan `?1047h/l`.** `?47h` dan `?2004h` **terukur** ikut lahir dari handshake attach tmux pada `bash` polos — mempercayainya mematikan prediksi selamanya di setiap attach.
- Jendela coalescing input: **16 ms**, dan **hanya aktif saat prediksi aktif**.
- TTL prediksi: **500 ms**. Cooldown suspend sesudah satu kali meleset: **30 000 ms**.
- Penanda prediksi: underline saja (`\x1b[4m` … `\x1b[24m`) — netral SGR, tak menyentuh warna/latar.
- TypeScript strict. Test untuk logika rekonsiliasi ditulis sebagai **fungsi murni**, bukan lewat tmux.
- Doc yang tersentuh diperbarui **dalam commit yang sama** + ter-link di `internal/docs/README.md`.

---

## File Structure

| berkas | tanggung jawab |
| --- | --- |
| `src/src/screens/terminal-predict.ts` (baru) | seluruh state machine: klasifikasi input, gerbang, sekuens apply/rollback, rekonsiliasi, TTL/suspend, batcher input. Bebas React & xterm. |
| `src/test/terminal-predict.test.ts` (baru) | unit murni untuk modul di atas |
| `src/src/screens/TerminalPane.tsx` (ubah) | wiring: prop `predict`, pandangan layar dari xterm, `term.onData` → predictor, `t:"data"` → predictor |
| `src/src/screens/TerminalScreen.tsx` (ubah) | sakelar `predict` di `displayControls` + diturunkan lewat `Cell`/`FullscreenTerminal` |
| `src/test/terminal-pane.test.tsx` (ubah) | kontrak call site di atas mock xterm yang sudah ada |
| `src/test/terminal-screen.test.tsx` (ubah) | sakelar terlihat & tersimpan |
| `internal/docs/research/audit-spec-856-echo-prediktif-terminal.md` (baru) | doc-of-record berikut angka sebelum/sesudah |
| `internal/docs/README.md` (ubah) | link doc-of-record |
| `internal/docs/frontend/frontend-implementation.md` (ubah) | bagian Terminal |
| `internal/skills/hanoman/SKILL.md` (ubah) | butir arsitektur terminal |

---

### Task 1: Modul murni — klasifikasi input & sekuens tampilan

**Files:**
- Create: `src/src/screens/terminal-predict.ts`
- Test: `src/test/terminal-predict.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `type InputKind = "text" | "control" | "bulk"`; `classifyInput(d: string): InputKind`; `applySeq(chars: string): string`; `rollbackSeq(n: number): string`

- [x] **Step 1: Write the failing test**

`src/test/terminal-predict.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyInput, applySeq, rollbackSeq } from "../src/screens/terminal-predict";

describe("classifyInput", () => {
  it("menyebut satu grafem cetak sebagai teks", () => {
    expect(classifyInput("a")).toBe("text");
    expect(classifyInput(" ")).toBe("text");
    expect(classifyInput("é")).toBe("text");
  });
  it("menyebut escape, panah, Enter, Tab, dan ctrl sebagai control", () => {
    for (const d of ["\x1b", "\x1b[A", "\r", "\n", "\t", "\x03", "\x7f", "\b"]) {
      expect(classifyInput(d)).toBe("control");
    }
  });
  it("menyebut input >1 karakter cetak sebagai bulk", () => {
    expect(classifyInput("halo")).toBe("bulk");
  });
  // Pembungkus bracketed paste memuat ESC, jadi ia jatuh ke "control" — bukan "bulk". Bedanya
  // tak berperilaku: batcher memperlakukan setiap yang bukan "text" sama persis (kuras lalu
  // loloskan seketika), dan gerbang prediksi menolak keduanya.
  it("menyebut bungkus bracketed paste sebagai control", () => {
    expect(classifyInput("\x1b[200~x\x1b[201~")).toBe("control");
  });
  it("menyebut string kosong sebagai control (tak pernah diprediksi)", () => {
    expect(classifyInput("")).toBe("control");
  });
});

describe("applySeq / rollbackSeq", () => {
  it("hanya men-toggle underline — netral terhadap warna dan latar", () => {
    expect(applySeq("ab")).toBe("\x1b[4mab\x1b[24m");
  });
  it("mundur n kolom lalu menghapus ke akhir baris", () => {
    expect(rollbackSeq(3)).toBe("\x1b[3D\x1b[K");
  });
  it("tak menghasilkan apa pun untuk n <= 0", () => {
    expect(rollbackSeq(0)).toBe("");
    expect(rollbackSeq(-1)).toBe("");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/terminal-predict"`

- [x] **Step 3: Write minimal implementation**

`src/src/screens/terminal-predict.ts`:

```ts
// SPEC-856 · echo prediktif lokal. Seluruh logikanya murni supaya rekonsiliasi bisa diuji tanpa
// tmux dan tanpa layout engine: komponen menyuplai pandangan layar sebagai data (lihat `View`).
//
// Invarian keselamatan yang menopang seluruh modul ini: begitu satu byte pun datang dari pty,
// prediksi di-rollback SEBELUM byte itu ditulis, dalam SATU panggilan `term.write`. Layar sesudah
// setiap frame server karena itu byte-identik dengan layar tanpa prediksi — prediksi paling buruk
// hanya salah selama < 1 RTT lalu hilang tanpa sisa.

export type InputKind = "text" | "control" | "bulk";

/** Kontrol C0/C1 dan DEL: apa pun di sini tak pernah diprediksi dan tak pernah di-batch. */
const CONTROL = /[\x00-\x1f\x7f]/;

export function classifyInput(d: string): InputKind {
  if (!d || CONTROL.test(d)) return "control";
  return [...d].length > 1 ? "bulk" : "text";
}

/** Underline saja: `\x1b[24m` mematikan underline TANPA menyentuh warna/latar, jadi SGR yang
 *  berlaku sesudah prediksi identik dengan sebelumnya — itu yang membuat `rollbackSeq` setia. */
export function applySeq(chars: string): string {
  return chars ? `\x1b[4m${chars}\x1b[24m` : "";
}

/** Mundur n kolom lalu hapus ke akhir baris. Setia hanya karena gerbang menjamin ekor baris di
 *  kanan kursor kosong — yang justru dipastikan `\x1b[K` milik TUI agen sendiri. */
export function rollbackSeq(n: number): string {
  return n > 0 ? `\x1b[${n}D\x1b[K` : "";
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: PASS (4 + 3 test)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-predict.ts src/test/terminal-predict.test.ts
git commit -m "feat(terminal): klasifikasi input & sekuens apply/rollback prediksi (SPEC-856)"
```

---

### Task 2: Gerbang — kapan prediksi TIDAK jalan

**Files:**
- Modify: `src/src/screens/terminal-predict.ts`
- Test: `src/test/terminal-predict.test.ts`

**Interfaces:**
- Consumes: `classifyInput` (Task 1)
- Produces:
  - `type View = { cursorX: number; cols: number; line: string; connected: boolean }`
  - `type PredictState = { pending: string; since: number | null; altScreen: boolean; suspendedUntil: number }`
  - `initialState(): PredictState`
  - `scanAltScreen(data: string, alt: boolean): boolean`
  - `looksLikePasswordPrompt(line: string): boolean`
  - `canPredict(state: PredictState, d: string, view: View, now: number, enabled: boolean): boolean`

- [x] **Step 1: Write the failing test**

Tambahkan ke `src/test/terminal-predict.test.ts`:

```ts
import { canPredict, initialState, looksLikePasswordPrompt, scanAltScreen,
  type PredictState, type View } from "../src/screens/terminal-predict";

const view = (over: Partial<View> = {}): View =>
  ({ cursorX: 4, cols: 100, line: "❯ h", connected: true, ...over });
const state = (over: Partial<PredictState> = {}): PredictState => ({ ...initialState(), ...over });

describe("scanAltScreen", () => {
  it("menyala pada ?1049h dan padam pada ?1049l", () => {
    expect(scanAltScreen("\x1b[?1049h", false)).toBe(true);
    expect(scanAltScreen("\x1b[?1049l", true)).toBe(false);
  });
  it("menghormati ?1047h/l juga", () => {
    expect(scanAltScreen("\x1b[?1047h", false)).toBe(true);
    expect(scanAltScreen("\x1b[?1047l", true)).toBe(false);
  });
  // Terukur di probe SPEC-856: `?47h` DAN `?2004h` sama-sama lahir dari handshake attach tmux —
  // muncul 1x pada `bash --noprofile --norc` polos, bukan hanya pada TUI agen. Mempercayainya
  // berarti prediksi mati selamanya di setiap attach.
  it("MENGABAIKAN ?47h dan ?2004h — keduanya milik handshake attach tmux", () => {
    expect(scanAltScreen("\x1b[?47h", false)).toBe(false);
    expect(scanAltScreen("\x1b[?2004h", false)).toBe(false);
  });
  it("memakai kejadian terakhir dalam satu frame", () => {
    expect(scanAltScreen("\x1b[?1049h isi \x1b[?1049l", false)).toBe(false);
  });
});

describe("looksLikePasswordPrompt", () => {
  it("mengenali prompt password yang lazim", () => {
    for (const l of ["Password:", "password for dena:", "Enter passphrase for key:",
      "PASS:", "Masukkan PIN:", "[sudo] password for dena:"]) {
      expect(looksLikePasswordPrompt(l)).toBe(true);
    }
  });
  it("tak menuduh baris kerja biasa", () => {
    for (const l of ["❯ h", "$ git push", "// password rotation adalah ADR-0117"]) {
      expect(looksLikePasswordPrompt(l)).toBe(false);
    }
  });
});

describe("canPredict", () => {
  it("mengizinkan satu karakter teks di ujung baris yang bersih", () => {
    expect(canPredict(state(), "a", view(), 0, true)).toBe(true);
  });
  it("menolak saat sakelar operator mati", () => {
    expect(canPredict(state(), "a", view(), 0, false)).toBe(false);
  });
  it("menolak saat socket belum open", () => {
    expect(canPredict(state(), "a", view({ connected: false }), 0, true)).toBe(false);
  });
  it("menolak di alternate screen", () => {
    expect(canPredict(state({ altScreen: true }), "a", view(), 0, true)).toBe(false);
  });
  it("menolak input control dan bulk", () => {
    expect(canPredict(state(), "\x1b[A", view(), 0, true)).toBe(false);
    expect(canPredict(state(), "\r", view(), 0, true)).toBe(false);
    expect(canPredict(state(), "tempelan", view(), 0, true)).toBe(false);
  });
  it("menolak saat kursor dekat tepi kanan — wrap tak bisa di-rollback dengan CUB", () => {
    expect(canPredict(state(), "a", view({ cursorX: 98, cols: 100 }), 0, true)).toBe(false);
    expect(canPredict(state({ pending: "xy" }), "a", view({ cursorX: 95, cols: 100 }), 0, true)).toBe(false);
  });
  it("menolak saat ekor baris di kanan kursor tak kosong", () => {
    expect(canPredict(state(), "a", view({ cursorX: 2, line: "❯ halo" }), 0, true)).toBe(false);
  });
  it("menolak pada baris berpola password", () => {
    expect(canPredict(state(), "a", view({ line: "Password:", cursorX: 10 }), 0, true)).toBe(false);
  });
  it("menolak selama cooldown suspend, lalu mengizinkan lagi sesudahnya", () => {
    const s = state({ suspendedUntil: 30_000 });
    expect(canPredict(s, "a", view(), 29_999, true)).toBe(false);
    expect(canPredict(s, "a", view(), 30_000, true)).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: FAIL — `canPredict is not a function` / import error

- [x] **Step 3: Write minimal implementation**

Tambahkan ke `src/src/screens/terminal-predict.ts`:

```ts
/** Pandangan layar pada saat keputusan diambil. Komponen membacanya dari xterm; modul ini tak
 *  pernah menyentuh xterm supaya seluruh keputusannya bisa diuji sebagai fungsi murni. */
export type View = { cursorX: number; cols: number; line: string; connected: boolean };

export type PredictState = {
  /** karakter yang sudah di-echo lokal dan belum terkonfirmasi, berurutan */
  pending: string;
  /** stempel prediksi terlama yang masih menunggu, untuk TTL */
  since: number | null;
  altScreen: boolean;
  /** prediksi mati sampai stempel ini (0 = tidak disuspend) */
  suspendedUntil: number;
};

export const TTL_MS = 500;
export const SUSPEND_MS = 30_000;
/** Kolom cadangan di tepi kanan: prediksi yang membungkus baris tak bisa di-rollback dengan CUB. */
const EDGE_MARGIN = 2;

export function initialState(): PredictState {
  return { pending: "", since: null, altScreen: false, suspendedUntil: 0 };
}

// SPEC-856 · HANYA ?1049 dan ?1047. `?47h`/`?2004h` terukur ikut lahir dari handshake attach tmux
// pada `bash` polos — bukan penanda TUI apa pun.
const ALT_ON = /\x1b\[\?(1049|1047)h/g;
const ALT_OFF = /\x1b\[\?(1049|1047)l/g;

export function scanAltScreen(data: string, alt: boolean): boolean {
  const last = (re: RegExp): number => {
    let at = -1;
    for (const m of data.matchAll(re)) at = m.index ?? at;
    return at;
  };
  const on = last(ALT_ON);
  const off = last(ALT_OFF);
  if (on < 0 && off < 0) return alt;
  return on > off;
}

const PASSWORD = /(password|passphrase|pass|pin)\s*(for\s+\S+\s*)?:\s*$/i;

export function looksLikePasswordPrompt(line: string): boolean {
  return PASSWORD.test(line);
}

export function canPredict(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): boolean {
  if (!enabled || !view.connected || state.altScreen) return false;
  if (now < state.suspendedUntil) return false;
  if (classifyInput(d) !== "text") return false;
  if (view.cursorX + state.pending.length + 1 > view.cols - EDGE_MARGIN) return false;
  // Ekor baris di kanan kursor wajib kosong: itu prasyarat `rollbackSeq` yang memakai `\x1b[K`.
  if (view.line.slice(view.cursorX).trim().length > 0) return false;
  return !looksLikePasswordPrompt(view.line.trimEnd());
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: PASS (semua, termasuk 9 test `canPredict`)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-predict.ts src/test/terminal-predict.test.ts
git commit -m "feat(terminal): gerbang prediksi (alt-screen, tepi, password, suspend) (SPEC-856)"
```

---

### Task 3: Rekonsiliasi — transisi state penuh

**Files:**
- Modify: `src/src/screens/terminal-predict.ts`
- Test: `src/test/terminal-predict.test.ts`

**Interfaces:**
- Consumes: seluruh Task 1 & 2
- Produces:
  - `echoedPrefixLen(before: string, pending: string): number`
  - `onInput(state, d, view, now, enabled): { state: PredictState; write: string }`
  - `onServerData(state, data, now): { state: PredictState; write: string; tail: string }`
  - `reapply(state, tail, view, now, enabled): { state: PredictState; write: string }`
  - `onTick(state, now): { state: PredictState; write: string; missed: boolean }`
  - `onReattach(): PredictState`

- [x] **Step 1: Write the failing test**

Tambahkan ke `src/test/terminal-predict.test.ts`:

```ts
import { echoedPrefixLen, onInput, onServerData, onTick, onReattach, reapply,
  SUSPEND_MS, TTL_MS } from "../src/screens/terminal-predict";

describe("echoedPrefixLen", () => {
  it("menghitung berapa karakter pending yang sudah digambar server", () => {
    expect(echoedPrefixLen("❯ he", "el")).toBe(1);
    expect(echoedPrefixLen("❯ hel", "el")).toBe(2);
    expect(echoedPrefixLen("❯ h", "el")).toBe(0);
  });
  it("mengambil prefiks TERPANJANG, bukan yang pertama cocok", () => {
    expect(echoedPrefixLen("aaa", "aa")).toBe(2);
  });
  it("nol untuk pending kosong", () => {
    expect(echoedPrefixLen("apa pun", "")).toBe(0);
  });
});

describe("onInput", () => {
  it("menulis karakter bergaris bawah dan menyimpannya sebagai pending", () => {
    const r = onInput(initialState(), "a", view(), 1_000, true);
    expect(r.write).toBe("\x1b[4ma\x1b[24m");
    expect(r.state.pending).toBe("a");
    expect(r.state.since).toBe(1_000);
  });
  it("menumpuk karakter kedua tanpa memindahkan stempel TTL", () => {
    const first = onInput(initialState(), "a", view(), 1_000, true);
    const second = onInput(first.state, "b", view({ cursorX: 5 }), 1_100, true);
    expect(second.state.pending).toBe("ab");
    expect(second.state.since).toBe(1_000);
  });
  it("tak menulis apa pun saat gerbang menolak", () => {
    const r = onInput(initialState(), "\r", view(), 1_000, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
  });
});

describe("onServerData", () => {
  it("mendahulukan rollback lalu data — satu string, satu write", () => {
    const s = { ...initialState(), pending: "ab", since: 1_000 };
    const r = onServerData(s, "DATA", 1_050);
    expect(r.write).toBe("\x1b[2D\x1b[KDATA");
    expect(r.state.pending).toBe("");
    expect(r.state.since).toBeNull();
    expect(r.tail).toBe("ab");
  });
  it("melewatkan data apa adanya saat tak ada pending", () => {
    const r = onServerData(initialState(), "DATA", 0);
    expect(r.write).toBe("DATA");
    expect(r.tail).toBe("");
  });
  it("memperbarui alt-screen dari aliran yang sama", () => {
    expect(onServerData(initialState(), "\x1b[?1049h", 0).state.altScreen).toBe(true);
  });
});

describe("reapply", () => {
  it("menghidupkan ulang hanya sisa yang belum ter-echo", () => {
    const r = reapply(initialState(), "b", view({ cursorX: 5, line: "❯ ha" }), 1_050, true);
    expect(r.write).toBe("\x1b[4mb\x1b[24m");
    expect(r.state.pending).toBe("b");
  });
  it("membuang sisa tanpa menulis apa pun bila gerbang tak lagi lolos", () => {
    const r = reapply(initialState(), "b", view({ connected: false }), 1_050, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
  });
});

describe("onTick", () => {
  it("diam selama TTL belum lewat", () => {
    const s = { ...initialState(), pending: "a", since: 1_000 };
    const r = onTick(s, 1_000 + TTL_MS - 1);
    expect(r.write).toBe("");
    expect(r.missed).toBe(false);
    expect(r.state.pending).toBe("a");
  });
  // Kasus terukur: `read -s` dan dialog trust claude sama-sama membalas NOL byte. TTL adalah
  // satu-satunya sinyal yang membedakannya dari jaringan lambat.
  it("me-rollback dan menyuspend begitu TTL lewat tanpa echo", () => {
    const s = { ...initialState(), pending: "ab", since: 1_000 };
    const r = onTick(s, 1_000 + TTL_MS);
    expect(r.write).toBe("\x1b[2D\x1b[K");
    expect(r.missed).toBe(true);
    expect(r.state.pending).toBe("");
    expect(r.state.suspendedUntil).toBe(1_000 + TTL_MS + SUSPEND_MS);
  });
  it("diam saat tak ada pending", () => {
    expect(onTick(initialState(), 9_999).write).toBe("");
  });
});

describe("onReattach", () => {
  it("melupakan segalanya — tmux memutar ulang layar penuh saat attach", () => {
    expect(onReattach()).toEqual(initialState());
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: FAIL — `onInput is not a function`

- [x] **Step 3: Write minimal implementation**

Tambahkan ke `src/src/screens/terminal-predict.ts`:

```ts
/** Berapa karakter awal `pending` yang sudah digambar server, dilihat dari teks di kiri kursor
 *  SESUDAH frame server ditulis (saat itu xterm sudah otoritatif). */
export function echoedPrefixLen(before: string, pending: string): number {
  for (let n = pending.length; n > 0; n -= 1) {
    if (before.endsWith(pending.slice(0, n))) return n;
  }
  return 0;
}

export function onInput(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string } {
  if (!canPredict(state, d, view, now, enabled)) return { state, write: "" };
  return {
    state: { ...state, pending: state.pending + d, since: state.since ?? now },
    write: applySeq(d),
  };
}

export function onServerData(
  state: PredictState, data: string, _now: number,
): { state: PredictState; write: string; tail: string } {
  const altScreen = scanAltScreen(data, state.altScreen);
  return {
    state: { ...state, pending: "", since: null, altScreen },
    write: rollbackSeq(state.pending.length) + data,
    tail: state.pending,
  };
}

export function reapply(
  state: PredictState, tail: string, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string } {
  if (!tail) return { state, write: "" };
  // Gerbang diuji terhadap SELURUH sisa sekaligus: memasang sebagian lalu kehabisan kolom akan
  // meninggalkan pending yang tak bisa di-rollback.
  const probe: PredictState = { ...state, pending: "" };
  for (let i = 0; i < tail.length; i += 1) {
    if (!canPredict({ ...probe, pending: tail.slice(0, i) }, tail[i]!, view, now, enabled)) {
      return { state, write: "" };
    }
  }
  return { state: { ...state, pending: tail, since: now }, write: applySeq(tail) };
}

export function onTick(
  state: PredictState, now: number,
): { state: PredictState; write: string; missed: boolean } {
  if (!state.pending || state.since === null || now < state.since + TTL_MS) {
    return { state, write: "", missed: false };
  }
  return {
    state: { ...state, pending: "", since: null, suspendedUntil: now + SUSPEND_MS },
    write: rollbackSeq(state.pending.length),
    missed: true,
  };
}

/** tmux memutar ulang layar penuh saat attach — tak ada yang boleh diwarisi lintas sambungan. */
export function onReattach(): PredictState {
  return initialState();
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: PASS (seluruh berkas)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-predict.ts src/test/terminal-predict.test.ts
git commit -m "feat(terminal): rekonsiliasi prediksi + TTL/suspend sebagai fungsi murni (SPEC-856)"
```

---

### Task 4: Batcher input 16 ms

**Files:**
- Modify: `src/src/screens/terminal-predict.ts`
- Test: `src/test/terminal-predict.test.ts`

**Interfaces:**
- Consumes: `classifyInput` (Task 1)
- Produces: `COALESCE_IN_MS: number`; `createInputBatcher(send: (d: string) => void): { push(d: string, coalesce: boolean): void; flush(): void; dispose(): void }`

- [x] **Step 1: Write the failing test**

Tambahkan ke `src/test/terminal-predict.test.ts`:

```ts
import { beforeEach, afterEach, vi } from "vitest";
import { createInputBatcher, COALESCE_IN_MS } from "../src/screens/terminal-predict";

describe("createInputBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("menggabungkan teks yang tiba dalam satu jendela menjadi SATU frame", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", true); b.push("b", true); b.push("c", true);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(COALESCE_IN_MS);
    expect(sent).toEqual(["abc"]);
  });
  it("mengirim seketika saat coalesce dimatikan — sakelar prediksi mati tak boleh menambah latensi", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", false);
    expect(sent).toEqual(["a"]);
  });
  // SPEC-452/800/816: Enter, panah, Esc, path lampiran, dan digit dialog wajib tetap satu
  // keystroke = satu frame, dan wajib tak pernah menyalip teks yang sudah mengantre.
  it("meloloskan control seketika, sesudah menguras buffer lebih dulu", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("h", true); b.push("i", true);
    b.push("\r", true);
    expect(sent).toEqual(["hi", "\r"]);
  });
  it("meloloskan bulk (paste) seketika sebagai satu frame", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("tempelan panjang", true);
    expect(sent).toEqual(["tempelan panjang"]);
  });
  it("flush() mengosongkan buffer tanpa menunggu timer", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", true);
    b.flush();
    expect(sent).toEqual(["a"]);
  });
  it("dispose() menguras buffer — ketikan tak boleh mati bersama pane", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", true);
    b.dispose();
    expect(sent).toEqual(["a"]);
    vi.advanceTimersByTime(COALESCE_IN_MS * 4);
    expect(sent).toEqual(["a"]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: FAIL — `createInputBatcher is not a function`

- [x] **Step 3: Write minimal implementation**

Tambahkan ke `src/src/screens/terminal-predict.ts`:

```ts
/** Satu frame animasi, cermin `COALESCE_MS` arah keluar (SPEC-812). Terukur: TUI agen menggambar
 *  ulang sekali per EVENT input, bukan per karakter — `hello world` sebagai 11 keystroke terpisah
 *  membalas 22 frame / 16 999 byte, sebagai satu frame 2 frame / 1 551 byte. */
export const COALESCE_IN_MS = 16;

export function createInputBatcher(send: (d: string) => void): {
  push(d: string, coalesce: boolean): void; flush(): void; dispose(): void;
} {
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!buf) return;
    const d = buf;
    buf = "";
    send(d);
  };
  return {
    push(d, coalesce) {
      // Control & bulk tak pernah ditahan: mereka menguras antrean lebih dulu supaya urutan byte
      // ke pty tak pernah berubah, lalu lewat sendiri.
      if (!coalesce || classifyInput(d) !== "text") { flush(); if (d) send(d); return; }
      buf += d;
      if (!timer) timer = setTimeout(flush, COALESCE_IN_MS);
    },
    flush,
    dispose() { flush(); },
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-predict.test.ts`
Expected: PASS (6 test batcher + seluruh berkas)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-predict.ts src/test/terminal-predict.test.ts
git commit -m "feat(terminal): batcher input 16 ms yang meloloskan control & paste (SPEC-856)"
```

---

### Task 5: Wiring `TerminalPane`

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: seluruh API `terminal-predict.ts`
- Produces: prop baru `predict?: boolean` (default `true`) pada `TerminalPane`

- [x] **Step 1: Write the failing test**

Mock xterm di `src/test/terminal-pane.test.tsx` belum punya kursor maupun isi baris. Perluas objek `xt` dan kelas `Terminal`-nya:

```ts
// di dalam vi.hoisted({...}) — tambahkan ke `buffer`:
  buffer: {
    viewportY: 0,
    cursorX: 2,
    cursorY: 0,
    getLine: (_: number) => undefined as undefined | { translateToString: () => string },
  },
```

Lalu tambahkan blok test baru di akhir berkas:

```ts
describe("SPEC-856 · echo prediktif", () => {
  const lineIs = (text: string) => {
    xt.buffer.getLine = () => ({ translateToString: () => text });
  };

  it("menulis karakter bergaris bawah lokal lalu mengirimnya setelah jendela 16 ms", async () => {
    vi.useFakeTimers();
    lineIs("❯ ");
    render(<TerminalPane sessionId="s1" onExit={() => {}} />);
    await openSocket();
    xt.written.length = 0;
    act(() => { xt.dataHandler!("a"); });
    expect(xt.written).toEqual(["\x1b[4ma\x1b[24m"]);
    expect(sentInputs()).toEqual([]);
    act(() => { vi.advanceTimersByTime(16); });
    expect(sentInputs()).toEqual(["a"]);
    vi.useRealTimers();
  });

  it("me-rollback SEBELUM data server, dalam satu write", async () => {
    vi.useFakeTimers();
    lineIs("❯ ");
    render(<TerminalPane sessionId="s1" onExit={() => {}} />);
    await openSocket();
    act(() => { xt.dataHandler!("a"); });
    xt.written.length = 0;
    act(() => { sockets[0]!.onmessage!({ data: JSON.stringify({ t: "data", d: "❯ a" }) }); });
    expect(xt.written[0]).toBe("\x1b[1D\x1b[K❯ a");
    vi.useRealTimers();
  });

  it("tak memprediksi control dan mengirimnya seketika", async () => {
    vi.useFakeTimers();
    lineIs("❯ ");
    render(<TerminalPane sessionId="s1" onExit={() => {}} />);
    await openSocket();
    xt.written.length = 0;
    act(() => { xt.dataHandler!("\x1b[A"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["\x1b[A"]);
    vi.useRealTimers();
  });

  it("mengirim paste sebagai SATU frame tanpa memprediksinya", async () => {
    vi.useFakeTimers();
    lineIs("❯ ");
    render(<TerminalPane sessionId="s1" onExit={() => {}} />);
    await openSocket();
    xt.written.length = 0;
    act(() => { xt.dataHandler!("tempelan panjang"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["tempelan panjang"]);
    vi.useRealTimers();
  });

  it("predict=false: nol tulis lokal dan kirim seketika (sakelar)", async () => {
    vi.useFakeTimers();
    lineIs("❯ ");
    render(<TerminalPane sessionId="s1" onExit={() => {}} predict={false} />);
    await openSocket();
    xt.written.length = 0;
    act(() => { xt.dataHandler!("a"); });
    expect(xt.written).toEqual([]);
    expect(sentInputs()).toEqual(["a"]);
    vi.useRealTimers();
  });

  it("me-rollback dan berhenti memprediksi saat TTL lewat tanpa echo (password/prompt bisu)", async () => {
    vi.useFakeTimers();
    lineIs("❯ ");
    render(<TerminalPane sessionId="s1" onExit={() => {}} />);
    await openSocket();
    act(() => { xt.dataHandler!("a"); });
    xt.written.length = 0;
    act(() => { vi.advanceTimersByTime(600); });
    expect(xt.written).toEqual(["\x1b[1D\x1b[K"]);
    xt.written.length = 0;
    act(() => { xt.dataHandler!("b"); });
    expect(xt.written).toEqual([]);
    vi.useRealTimers();
  });
});
```

Tambahkan dua helper di dekat `paneHost` bila belum ada:

```ts
const sentInputs = (): string[] => (sockets[0]?.sent ?? [])
  .map((m) => JSON.parse(m) as { t: string; d?: string })
  .filter((f) => f.t === "in").map((f) => f.d!);
```

`openSocket()` mengikuti pola yang sudah dipakai berkas ini untuk menyelesaikan `issueWsTicket` lalu memanggil `sockets[0].onopen()`; pakai helper yang sudah ada di berkas kalau namanya berbeda.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-pane.test.tsx`
Expected: FAIL — prediksi belum ada; `xt.written` kosong pada test pertama

- [x] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalPane.tsx`:

1. Tambahkan impor:

```ts
import * as P from "./terminal-predict";
```

2. Tambahkan prop `predict` pada signature komponen (default `true`) dan ref-nya, sejajar `fontSizeRef`:

```ts
export function TerminalPane({ sessionId, onExit, onPhases, fontSize = FONT_DEFAULT,
  showKeys = false, predict = true }: {
  …
  showKeys?: boolean;
  /** SPEC-856 · sakelar echo prediktif. Ref, bukan dependency effect: mematikannya tak boleh
   *  melahirkan socket baru. */
  predict?: boolean;
}) {
  …
  const predictRef = React.useRef(predict);
  predictRef.current = predict;
```

3. Di dalam `React.useEffect`, tepat sesudah `let pendingInput = "";`, ganti blok `sendInput`/`sendKey` menjadi:

```ts
    let pendingInput = "";
    const sendInput = (d: string) => {
      if (ws?.readyState === WebSocket.OPEN) send({ t: "in", d });
      else pendingInput += d;
    };
    sendKey.current = sendInput;

    // SPEC-856 · echo prediktif. Hanya `term.onData` yang lewat sini; clipboard (SPEC-289),
    // tap dialog (SPEC-452), lampiran (SPEC-816), dan papan tombol (SPEC-800) tetap memakai
    // `sendInput` mentah, jadi jaminan "satu keystroke = satu frame" milik mereka tak berubah.
    let pred = P.initialState();
    const batcher = P.createInputBatcher(sendInput);
    const viewOf = (): P.View => {
      const buf = term.buffer.active;
      return {
        cursorX: buf.cursorX, cols: term.cols, connected: ws?.readyState === WebSocket.OPEN,
        line: buf.getLine(buf.viewportY + buf.cursorY)?.translateToString(true) ?? "",
      };
    };
    const onTyped = (d: string) => {
      const before = pred;
      const r = P.onInput(pred, d, viewOf(), Date.now(), predictRef.current);
      pred = r.state;
      if (r.write) term.write(r.write);
      batcher.push(d, before.pending.length > 0 || r.write.length > 0);
    };
    // TTL adalah satu-satunya sinyal yang memisahkan "pty diam" (password, tombol yang ditelan
    // dialog — keduanya terukur membalas NOL byte) dari "jaringan lambat".
    const ttl = setInterval(() => {
      const r = P.onTick(pred, Date.now());
      pred = r.state;
      if (r.write) term.write(r.write);
    }, 100);
```

4. Ganti cabang `f.t === "data"` di `socket.onmessage`:

```ts
          if (f.t === "data") {
            const r = P.onServerData(pred, f.d ?? "", Date.now());
            pred = r.state;
            // Rollback dan data server WAJIB satu panggilan write: keadaan antara tak boleh
            // pernah dirender, dan itulah yang membuat layar byte-identik dengan tanpa prediksi.
            term.write(r.write);
            if (r.tail) {
              const buf = term.buffer.active;
              const line = buf.getLine(buf.viewportY + buf.cursorY)?.translateToString(true) ?? "";
              const tail = r.tail.slice(P.echoedPrefixLen(line.slice(0, buf.cursorX), r.tail));
              const back = P.reapply(pred, tail, viewOf(), Date.now(), predictRef.current);
              pred = back.state;
              if (back.write) term.write(back.write);
            }
          }
```

5. Reset di `socket.onopen`, tepat sesudah `attempt = 0;`:

```ts
          attempt = 0;
          pred = P.onReattach();
```

6. Di cleanup effect, sebelum `typed.dispose();`:

```ts
      clearInterval(ttl);
      batcher.dispose();
```

7. Ganti `const typed = term.onData(sendInput);` menjadi:

```ts
    const typed = term.onData(onTyped);
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-pane.test.tsx`
Expected: PASS — 6 test baru **dan** seluruh test lama (clipboard, wheel, touch, lampiran, reconnect) tetap hijau

- [x] **Step 5: Typecheck & commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(terminal): wiring echo prediktif + batcher di TerminalPane (SPEC-856)"
```

---

### Task 6: Sakelar operator di `TerminalScreen`

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx`
- Test: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: prop `predict` (Task 5)
- Produces: kunci UI-state `hn.ui.v1.terminal.predict`

- [x] **Step 1: Write the failing test**

Tambahkan ke `src/test/terminal-screen.test.tsx`:

```ts
it("SPEC-856 · sakelar echo prediktif hidup secara default dan tersimpan", async () => {
  renderScreen();                               // helper yang sudah ada di berkas ini
  await openDisplayPanel();                     // helper yang sudah ada; buka panel tampilan
  const toggle = screen.getByRole("button", { name: /ketik responsif/i });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(localStorage.getItem("hn.ui.v1.terminal.predict")).toBe("false");
});
```

Bila `renderScreen`/`openDisplayPanel` bernama lain di berkas itu, pakai nama yang ada — pola
pembukaan panel `displayControls` sudah dipakai test ukuran font & papan tombol.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-screen.test.tsx -t "echo prediktif"`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /ketik responsif/i`

- [x] **Step 3: Write minimal implementation**

Di `src/src/screens/TerminalScreen.tsx`:

1. Di sebelah `const [keysOpen, setKeysOpen] = usePersistedState(...)`:

```ts
  // SPEC-856 · sakelar echo prediktif. State TAMPILAN lokal per browser seperti fontSize &
  // papan tombol (SPEC-740 · ADR-0115) — bukan payload workspace kanonik per-user (ADR-0118).
  const [predict, setPredict] = usePersistedState("terminal", "predict", true, isBool);
```

2. Di dalam `displayControls`, sesudah baris papan tombol:

```tsx
      <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-muted)" }}>
          Ketik responsif (huruf tampil sebelum echo server)
        </span>
        <Button size="sm" variant="secondary" aria-pressed={predict}
          onClick={() => setPredict((on) => !on)}>{predict ? "Matikan" : "Nyalakan"}</Button>
      </div>
```

3. Turunkan ke kedua call site `TerminalPane` (baris ±467 dan ±496) dengan menambahkan
   `predict={predict}` di samping `showKeys={keysOpen}`, dan tambahkan `predict` ke props
   `Cell` (deklarasi tipe di ±737 dan pemakaian di ±921) dan `FullscreenTerminal` (±945/±952)
   persis mengikuti bentuk `showKeys`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-screen.test.tsx`
Expected: PASS — test baru dan seluruh test lama layar Terminal

- [x] **Step 5: Typecheck & commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(terminal): sakelar ketik responsif di panel tampilan (SPEC-856)"
```

---

### Task 7: Ukur sebelum/sesudah di jalur nyata

**Files:**
- Create: (scratchpad, tidak di-commit) probe CDP
- Modify: `internal/docs/research/audit-spec-856-echo-prediktif-terminal.md` (§hasil)

**Interfaces:**
- Consumes: sakelar `predict` (Task 6) sebagai **satu-satunya variabel** — satu build, dua kondisi.

- [x] **Step 1: Boot server hidup dari worktree ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm dev
```

Tunggu sampai dashboard dan `GET /api/health` menjawab. Buat satu sesi shell biasa
(`Terminal biasa`) supaya ada pane yang bisa diketik tanpa membangunkan agen.

- [x] **Step 2: Jalankan probe CDP dengan RTT disuntik**

Chrome headless via CDP (pola yang sudah dipakai SPEC-812 & SPEC-800). Untuk tiap kondisi
(`predict` on/off) dan tiap RTT (0 ms dan 200 ms lewat `Network.emulateNetworkConditions`):

- ketik 20 karakter berjeda 120 ms ke dalam pane;
- catat **keydown → glyph** (waktu dari `Input.dispatchKeyEvent` sampai sel yang bersangkutan
  memuat karakter itu, dibaca lewat `Runtime.evaluate` atas `term.buffer.active`);
- catat **frame masuk/detik** (hitung `WebSocket.send` lewat `Network.webSocketFrameSent`);
- catat **byte** dua arah lewat `Network.webSocketFrameSent`/`Received`.

- [x] **Step 3: Isi tabel hasil di doc-of-record**

Isi §"Hasil terukur" dengan matriks 2×2 (predict on/off × RTT 0/200 ms) berisi ketiga metrik.
Bila jendela 16 ms terukur tak menggabungkan apa pun pada kecepatan ketik manusia, **katakan
begitu** — itu kontrol negatif, bukan kegagalan.

- [x] **Step 4: Commit**

```bash
git add internal/docs/research/audit-spec-856-echo-prediktif-terminal.md
git commit -m "docs(spec-856): hasil ukur sebelum/sesudah echo prediktif"
```

---

### Task 8: Doc-of-record & docs yang tersentuh

**Files:**
- Create: `internal/docs/research/audit-spec-856-echo-prediktif-terminal.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/skills/hanoman/SKILL.md`

- [x] **Step 1: Tulis doc-of-record**

Ikuti bentuk `internal/docs/research/audit-spec-812-latensi-ketik-terminal-mobile.md`:
ringkasan · feedback loop merah · temuan bernomor berikut tabel angka · kontrol negatif ·
yang sengaja tidak dikerjakan · perbaikan · hasil terukur · test yang mengunci.
Angka probe wajib masuk apa adanya: 1 byte (bash) vs 1 540 byte (claude) per keystroke,
0 byte (`read -s` & dialog trust), 22 frame/16 999 B vs 2 frame/1 551 B untuk `hello world`,
dan kontrol negatif `?47h`/`?2004h` yang juga muncul pada `bash` polos.

- [x] **Step 2: Tautkan di index**

Tambahkan satu baris di bagian `## research` `internal/docs/README.md`, **di atas** baris
SPEC-851, mengikuti format `- [judul](research/berkas.md) — ringkasan padat`.

- [x] **Step 3: Perbarui bagian Terminal frontend**

Di `internal/docs/frontend/frontend-implementation.md`, sesudah paragraf "Input xterm yang lahir
saat tiket/upgrade WebSocket masih `CONNECTING`…", tambahkan paragraf SPEC-856: invarian
rollback-sebelum-data, daftar gerbang, TTL 500 ms + cooldown 30 dtk, batcher 16 ms yang
meloloskan control/bulk, dan sakelar `hn.ui.v1.terminal.predict`.

- [x] **Step 4: Perbarui butir arsitektur terminal di skill**

Di `internal/skills/hanoman/SKILL.md`, pada butir "Terminal server: **node-pty + tmux**…",
sambung sesudah kalimat SPEC-812: arah MASUK diselesaikan SPEC-856 di klien, berikut invarian,
gerbang, dan gotcha `?47h`/`?2004h`.

- [x] **Step 5: Verifikasi integritas index & commit**

```bash
node cli/dist/index.js docs index --check || pnpm --filter ./cli build && node cli/dist/index.js docs index --check
git add internal/docs internal/skills
git commit -m "docs(spec-856): doc-of-record echo prediktif + index, frontend, skill"
```

---

### Task 9: Verifikasi akhir

- [x] **Step 1: Test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: hijau, **dan** jumlah berkas test yang berjalan > 0 (`--changed` menyalakan
`passWithNoTests`, jadi "no test files" bukan bukti).

- [x] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./src typecheck
```

Expected: nol error. (`server/**` tak disentuh sama sekali — jangan jalankan `pnpm -r typecheck`.)

- [x] **Step 3: Smoke browser nyata**

Buka dashboard dari server Task 7, ketik di pane sesi shell dan di pane sesi agen: karakter
tampil seketika bergaris bawah lalu menyatu tanpa sisa; Enter/panah/Esc tetap responsif; paste
mendarat utuh sekali; Cmd/Ctrl+C-V masih menyalin & menempel; Shift+wheel masih menggulir.

- [x] **Step 4: Commit sisa & push**

```bash
git add -A && git commit -m "feat(terminal): echo prediktif lokal + coalescing input (SPEC-856)"
git push origin HEAD:refs/heads/hanoman/spec-856
```

- [x] **Step 5: Verifikasi manusia di perangkat nyata**

Laporkan ke operator bahwa langkah terakhir — mengetik dari ponsel/tablet lewat domain publik
(Cloudflare Tunnel), bukan localhost — adalah miliknya, berikut apa yang harus dilihat.
