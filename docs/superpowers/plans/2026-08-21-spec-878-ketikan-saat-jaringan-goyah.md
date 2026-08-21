# SPEC-878 — ketikan terminal saat jaringan goyah: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ketikan di sesi terminal selalu tampil dan tetap tampil apa pun keadaan jaringan, sampai
ke pty dalam urutan persis seperti diketik, dan tak pernah men-submit baris ke agen tanpa tindakan
operator.

**Architecture:** Empat perubahan yang saling menopang. (1) Kontrak frame WS bertambah satu pasang
`{t:"in", d, seq}` → `{t:"ack", seq}` (ADR-0134) sehingga jam TTL prediksi punya titik nol yang
benar. (2) Modul murni `terminal-predict.ts` berhenti membaca "tersambung" dan mulai membaca
"terkirimkan" (`View.deliverable`), dan jam TTL-nya hanya berjalan sesudah `onDelivered`.
(3) `TerminalPane` memakai **satu** pintu keluar input (batcher) untuk semua jalur, jadi urutan
byte benar secara konstruksi. (4) Antrean outage jadi berbatas, terlihat, dan tak pernah mengirim
byte yang men-submit tanpa operator menekan `Kirim`.

**Tech Stack:** React 18 + TypeScript (Vite), `@xterm/xterm` 6, Fastify + `@fastify/websocket`,
node-pty + tmux, vitest (jsdom untuk `src`, node untuk `server`/`shared`).

## Global Constraints

- **Docs SoT:** doc yang tersentuh diperbarui **dalam commit yang sama** + ter-link di
  `internal/docs/README.md` (ADR-0023 — konvensi, tanpa gate).
- **Bahasa komentar & UI: Indonesia**, mengikuti berkas di sekitarnya. Komentar hanya untuk yang
  TIDAK terbaca dari kode (alasan, trade-off, invarian, rujukan SPEC/ADR).
- **TypeScript strict.** Tak ada `any`, tak ada `@ts-ignore`.
- **Nol dependensi baru.**
- **Arah keluar SPEC-812 tak disentuh:** `COALESCE_MS = 16`, `COALESCE_MAX_BYTES = 64 * 1024`,
  `perMessageDeflate`, `trimScrollback` — nol perubahan.
- **Konstanta yang TIDAK berubah:** `TTL_MS = 500`, `SUSPEND_MS = 30_000`, `EDGE_MARGIN = 2`,
  `COALESCE_IN_MS = 16`, `RECONNECT_BACKOFF_MS` (plafon 8 dtk, SPEC-761),
  `TERMINAL_WS_MESSAGES_PER_MINUTE = 6_000`.
- **Konstanta baru, tepat dua:** `MAX_PENDING_INPUT = 4_096` (byte) dan `SUBMIT = /[\r\n]/`,
  keduanya di `src/src/screens/TerminalPane.tsx`.
- **Scope verifikasi = yang berubah saja.** Jalankan test berkas yang disebut tiap task; **jangan**
  suite penuh, **jangan** `pnpm -r typecheck`, **jangan** build penuh.
- **Test server wajib DB terisolasi:** setiap perintah vitest untuk paket `server` dijalankan dengan
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (SPEC-479) dan `--no-file-parallelism`.
- **Jangan `pkill -f`/`killall`** (SPEC-402). Bunuh per-PID.

---

## Struktur berkas

| berkas | tanggung jawab sesudah plan ini |
| --- | --- |
| `shared/src/terminal-io.ts` **(baru)** | satu-satunya definisi bentuk *balasan* terminal, dipakai server **dan** klien |
| `shared/src/terminal-io.test.ts` **(baru)** | mengunci sifat yang memotivasi pemindahan: blob campuran bukan balasan |
| `shared/src/index.ts` | menambah satu baris re-export |
| `server/src/services/pty.ts` | berhenti mendefinisikan `TERMINAL_RESPONSE`; mengimpor + mengekspor ulang dari shared |
| `server/src/routes/terminal.ts` | membalas `{t:"ack", seq}` sesudah `writeTo` |
| `server/test/terminal.route.test.ts` | mengunci ack (ada saat `seq` dikirim, tak ada saat tidak) |
| `src/src/screens/terminal-predict.ts` | `View.deliverable`, `since` berhenti saat input, `onDelivered` menyalakannya |
| `src/test/terminal-predict.test.ts` | mengunci semantik jam TTL yang baru |
| `src/src/screens/TerminalPane.tsx` | seq/ack, satu pintu keluar input, antrean berbatas + gerbang submit + strip |
| `src/test/terminal-pane.test.tsx` | mengunci glyph bertahan, urutan, antrean, resize |
| `internal/docs/adr/0134-…md`, `internal/docs/adr/README.md`, `internal/docs/README.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/skills/hanoman/SKILL.md` | doc SoT |

---

### Task 1: `isTerminalResponse` pindah ke `@hanoman/shared`

Klien harus menolak **mengantrekan** balasan handshake terminal (SPEC-878 §7). Predikat yang
menilainya sudah ada di server; menyalin regexnya ke klien adalah cara tercepat gerbang SPEC-860
pecah tanpa satu pun test merah. Jadi ia pindah, bukan diduplikasi.

**Files:**
- Create: `shared/src/terminal-io.ts`
- Create: `shared/src/terminal-io.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `server/src/services/pty.ts:932-945`

**Interfaces:**
- Produces: `isTerminalResponse(d: string): boolean` dari `@hanoman/shared`; `pty.ts` tetap
  mengekspornya dengan nama yang sama (dipakai `server/test/pty-queries.test.ts`).

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/terminal-io.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isTerminalResponse } from "./terminal-io";

describe("isTerminalResponse (SPEC-860, dipakai dua sisi sejak SPEC-878)", () => {
  it("menyebut balasan handshake murni sebagai balasan", () => {
    for (const r of ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[0n", "\x1b]11;rgb:0000/0000/0000\x1b\\"]) {
      expect(isTerminalResponse(r)).toBe(true);
    }
    expect(isTerminalResponse("\x1b[?1;2c\x1b[>0;276;0c")).toBe(true);
  });

  it("menyebut ketikan manusia BUKAN balasan", () => {
    for (const k of ["a", "\r", "\x1b[A", "\x1bOA", "\x1b[3~", ""]) {
      expect(isTerminalResponse(k)).toBe(false);
    }
  });

  // Sifat inilah yang memindahkan predikat ini ke shared: satu blob campuran menembus gerbang
  // `writeTo` (SPEC-860) apa adanya, jadi klien harus menolaknya SEBELUM ia sempat mengantre.
  it("menyebut balasan yang bercampur ketikan BUKAN balasan", () => {
    expect(isTerminalResponse("\x1b[?1;2cya")).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./shared exec vitest run src/terminal-io.test.ts --reporter=basic`
Expected: FAIL — `Failed to resolve import "./terminal-io"`.

- [x] **Step 3: Buat modul shared**

Buat `shared/src/terminal-io.ts`:

```ts
// SPEC-860 · bentuk BALASAN terminal. Ia tinggal di shared karena dua sisi menilai byte yang sama:
// server menolak balasan dari klien non-pertama (`writeTo`), dan sejak SPEC-878 klien menolak
// mengantrekannya saat socket mati — balasan milik sambungan yang sudah lenyap tak berarti apa pun
// bagi sambungan berikutnya, dan satu blob campuran menembus gerbang server apa adanya.
// Tak satu pun bentuk di bawah beririsan dengan sekuens tombol (`\x1b[A`, `\x1bOA`, `\x1b[3~`,
// laporan mouse `…M`), jadi ketikan manusia tak pernah tersentuh gerbangnya.
const TERMINAL_RESPONSE = new RegExp([
  "\\x1b\\[[?>][0-9;]*c",                   // balasan DA
  "\\x1b\\[\\??[0-9]+;[0-9]+R",             // CPR / DECXCPR
  "\\x1b\\[\\??[0-9;]*n",                   // balasan DSR
  "\\x1b\\[\\??[0-9;]*\\$y",                // DECRPM
  "\\x1b\\][0-9][0-9;]*;[^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)",   // balasan warna OSC
  "\\x1bP[0-9]*[$+>][a-z|][^\\x1b]*\\x1b\\\\",                // DECRPSS / XTGETTCAP / XTVERSION
].join("|"), "g");

/** Frame yang isinya SELURUHNYA balasan terminal — tak ada satu pun byte ketikan di dalamnya. */
export const isTerminalResponse = (d: string): boolean =>
  d.length > 0 && d.replace(TERMINAL_RESPONSE, "") === "";
```

Tambahkan di `shared/src/index.ts`, setelah baris `export * from "./terminal-workspace";`:

```ts
export * from "./terminal-io";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./shared exec vitest run src/terminal-io.test.ts --reporter=basic`
Expected: PASS — 3 test.

- [x] **Step 5: Cabut definisi kembar di `pty.ts`**

Di `server/src/services/pty.ts`, **hapus** blok berikut (definisi `TERMINAL_RESPONSE` beserta
komentarnya dan `export const isTerminalResponse`), yaitu dari baris berkomentar
`// Bentuk balasan terminal. Tak satu pun beririsan…` sampai penutup `d.replace(TERMINAL_RESPONSE, "") === "";`:

```ts
// Bentuk balasan terminal. Tak satu pun beririsan dengan sekuens tombol (`\x1b[A`, `\x1bOA`,
// `\x1b[3~`, laporan mouse `…M`), jadi ketikan manusia tak pernah tersentuh gerbangnya.
const TERMINAL_RESPONSE = new RegExp([
  …
].join("|"), "g");

/** Frame yang isinya SELURUHNYA balasan terminal — tak ada satu pun byte ketikan di dalamnya. */
export const isTerminalResponse = (d: string): boolean =>
  d.length > 0 && d.replace(TERMINAL_RESPONSE, "") === "";
```

Gantikan dengan satu baris re-export di tempat yang sama:

```ts
// SPEC-878 · definisinya pindah ke `@hanoman/shared` karena klien memakainya juga; diekspor ulang
// di sini supaya call site server (dan test SPEC-860) tak bergeser.
export { isTerminalResponse };
```

Lalu tambahkan `isTerminalResponse` ke import `@hanoman/shared` yang sudah ada di kepala berkas
(bila belum ada import dari `@hanoman/shared` di `pty.ts`, tambahkan barisnya tepat di bawah import
`@hanoman/runner`):

```ts
import { isTerminalResponse } from "@hanoman/shared";
```

- [x] **Step 6: Jalankan test server yang terdampak**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run \
  test/pty-queries.test.ts --no-file-parallelism --reporter=basic
```
Expected: PASS — semua test SPEC-860 tetap hijau tanpa satu pun perubahan pada test-nya.

- [x] **Step 7: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0, tanpa output error.

- [x] **Step 8: Commit**

```bash
git add shared/src/terminal-io.ts shared/src/terminal-io.test.ts shared/src/index.ts \
        server/src/services/pty.ts
git commit -m "refactor(terminal): isTerminalResponse pindah ke shared, dipakai dua sisi (SPEC-878)"
```

---

### Task 2: `terminal-predict.ts` — `deliverable` + jam TTL yang punya titik nol

Akar masalahnya: `View.connected` (fakta transport) dipakai sebagai fakta pengiriman, dan `since`
dipasang saat karakter **diketik**. Task ini memperbaiki keduanya di modul murni, tanpa menyentuh
komponen.

**Files:**
- Modify: `src/src/screens/terminal-predict.ts:31-33` (`View`), `:73-86` (`canPredict`),
  `:97-105` (`onInput`), `:117-131` (`reapply`)
- Modify: `src/test/terminal-predict.test.ts`

**Interfaces:**
- Consumes: nihil.
- Produces:
  - `type View = { cursorX: number; cols: number; line: string; deliverable: boolean }`
  - `function onDelivered(state: PredictState, now: number): PredictState`
  - `onInput` tetap `(state, d, view, now, enabled) => { state, write }`, tetapi `state.since`
    hasilnya **selalu `null`**.
  - `reapply` tetap `(state, tail, view, now, enabled) => { state, write }`, `state.since` **`null`**.

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/terminal-predict.test.ts`, **ubah** helper `view` (satu-satunya tempat `connected`
disebut) dari:

```ts
const view = (over: Partial<View> = {}): View =>
  ({ cursorX: 4, cols: 100, line: "❯ h", connected: true, ...over });
```

menjadi:

```ts
const view = (over: Partial<View> = {}): View =>
  ({ cursorX: 4, cols: 100, line: "❯ h", deliverable: true, ...over });
```

lalu ganti setiap pemakaian `connected:` di berkas itu menjadi `deliverable:` (cari dengan
`grep -n "connected" src/test/terminal-predict.test.ts`). Tambahkan `onDelivered` ke daftar impor
di kepala berkas, dan **tambahkan** blok test berikut di akhir berkas:

```ts
// SPEC-878 · ADR-0134 · jam TTL hanya boleh berjalan sejak byte diketahui SAMPAI. Selama ia belum
// sampai, diamnya pty bukan bukti tentang apa pun — dan menghukumnya terukur membeli 30,5 detik
// layar bisu untuk satu kedip jaringan 500 ms.
describe("jam TTL berbasis pengiriman (SPEC-878)", () => {
  it("menolak memprediksi saat byte tak akan terkirimkan", () => {
    expect(canPredict(state(), "a", view({ deliverable: false }), 0, true)).toBe(false);
  });

  it("tetap memprediksi meski socket sedang mati, selama antrean akan terkuras", () => {
    const r = onInput(state(), "a", view(), 1_000, true);
    expect(r.write).toBe(applySeq("a"));
    expect(r.state.pending).toBe("a");
  });

  it("onInput menghentikan jam — `since` null, betapa pun lamanya menunggu", () => {
    const r = onInput(state(), "a", view(), 1_000, true);
    expect(r.state.since).toBeNull();
    const t = onTick(r.state, 1_000 + TTL_MS * 100);
    expect(t.write).toBe("");
    expect(t.missed).toBe(false);
    expect(t.state.pending).toBe("a");
    expect(t.state.suspendedUntil).toBe(0);
  });

  it("onDelivered menyalakan jam, dan TTL kembali menggigit sesudahnya", () => {
    const typed = onInput(state(), "a", view(), 1_000, true).state;
    const armed = onDelivered(typed, 5_000);
    expect(armed.since).toBe(5_000);
    expect(onTick(armed, 5_000 + TTL_MS - 1).write).toBe("");
    const fired = onTick(armed, 5_000 + TTL_MS);
    expect(fired.missed).toBe(true);
    expect(fired.write).toBe(rollbackSeq(1));
    expect(fired.state.suspendedUntil).toBe(5_000 + TTL_MS + SUSPEND_MS);
  });

  it("onDelivered tak menyentuh apa pun tanpa prediksi tertunda", () => {
    expect(onDelivered(state(), 9_000).since).toBeNull();
  });

  it("onDelivered tak memundurkan jam yang sudah menyala", () => {
    const armed = onDelivered(onInput(state(), "a", view(), 0, true).state, 100);
    expect(onDelivered(armed, 400).since).toBe(100);
  });

  it("reapply menyerahkan penyalaan jam ke pemanggil, bukan menyetelnya sendiri", () => {
    const r = reapply(state(), "ab", view({ cursorX: 2, line: "❯ " }), 7_000, true);
    expect(r.state.pending).toBe("ab");
    expect(r.state.since).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/terminal-predict.test.ts --reporter=basic`
Expected: FAIL — `onDelivered is not a function` / error tipe `deliverable` tak dikenal.

- [x] **Step 3: Ubah modul murni**

Di `src/src/screens/terminal-predict.ts`:

**3a.** Ganti tipe `View` beserta komentarnya:

```ts
/** Pandangan layar pada saat keputusan diambil. Komponen membacanya dari xterm; modul ini tak
 *  pernah menyentuh xterm supaya seluruh keputusannya bisa diuji sebagai fungsi murni.
 *
 *  SPEC-878 · `deliverable`, bukan `connected`: yang menentukan boleh-tidaknya memprediksi adalah
 *  apakah byte ini akan SAMPAI, bukan apakah socketnya sedang hidup. Byte yang diantre untuk
 *  sambungan yang masih akan pulih pasti terkirim — menolak memprediksinya membuat layar diam
 *  persis saat operator paling butuh umpan balik (terukur: 0 tulis lokal untuk 14 keystroke). */
export type View = { cursorX: number; cols: number; line: string; deliverable: boolean };
```

**3b.** Di `canPredict`, ganti baris gerbang pertama:

```ts
  if (!enabled || !view.deliverable || state.altScreen) return false;
```

**3c.** Ganti `onInput` (bagian `since`) — beserta komentar yang menerangkan kenapa jamnya berhenti:

```ts
// `since` sengaja dikosongkan setiap kali lahir prediksi baru: jam TTL milik `onDelivered`, dan
// ia baru boleh berjalan sesudah byte-nya diketahui sampai di server (ADR-0134). Menyetelnya di
// sini berarti mengukur "sudah berapa lama saya menunggu" — pertanyaan yang jawabannya sama dengan
// "pty sengaja bungkam" hanya selama jaringan sehat.
export function onInput(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string } {
  if (!canPredict(state, d, view, now, enabled)) return { state, write: "" };
  return {
    state: { ...state, pending: state.pending + d, since: null },
    write: applySeq(d),
  };
}
```

**3d.** Tambahkan `onDelivered` tepat sesudah `onServerData`:

```ts
/** SPEC-878 · ADR-0134 · satu-satunya penyala jam TTL: server mengakui sudah menerima frame yang
 *  membawa prediksi ini dan menyerahkannya ke pty. Sesudah titik itu — dan hanya sesudahnya —
 *  diamnya pty benar-benar berarti "pty memilih tak membalas" (`read -s`, tombol yang ditelan
 *  dialog: keduanya terukur nol byte). Idempoten: jam yang sudah menyala tak pernah dimundurkan. */
export function onDelivered(state: PredictState, now: number): PredictState {
  if (!state.pending || state.since !== null) return state;
  return { ...state, since: now };
}
```

**3e.** Di `reapply`, ganti baris `return` terakhir:

```ts
  return { state: { ...state, pending: tail, since: null }, write: applySeq(tail) };
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/terminal-predict.test.ts --reporter=basic`
Expected: PASS — seluruh berkas, termasuk 7 test baru.

- [x] **Step 5: Commit**

Typecheck belum bisa hijau di sini karena `TerminalPane` masih menyuplai `connected` — itu Task 4.
Commit tetap dilakukan supaya perubahan modul murni berdiri sendiri dan bisa ditolak/diterima
terpisah.

```bash
git add src/src/screens/terminal-predict.ts src/test/terminal-predict.test.ts
git commit -m "feat(terminal): jam TTL prediksi berjalan sejak byte diketahui sampai (SPEC-878, ADR-0134)"
```

---

### Task 3: Server membalas `{t:"ack", seq}`

**Files:**
- Modify: `server/src/routes/terminal.ts:453-458`
- Modify: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: nihil.
- Produces: kontrak WS `{t:"in", d: string, seq?: number}` → `{t:"ack", seq: number}`.

- [x] **Step 1: Tulis test yang gagal**

Buka `server/test/terminal.route.test.ts` dan pelajari helper koneksi di sekitar baris 33
(`const ws = new WebSocket(...)`, `frames`, `opened`, `data`). Tambahkan test berikut di dalam
`describe` yang memuat test websocket lain (mis. tepat sesudah test
`"menegosiasikan permessage-deflate pada socket terminal"`), memakai helper yang sama:

```ts
  // SPEC-878 · ADR-0134 · ack adalah satu-satunya titik nol jam TTL prediksi klien. Ia dibalas
  // SESUDAH writeTo, jadi maknanya "server menerima frame ini dan menyerahkannya ke pty".
  it("mengakui frame input yang bernomor, dan hanya yang bernomor", async () => {
    const c = await connect(id);
    await c.opened;
    c.ws.send(JSON.stringify({ t: "in", d: "a", seq: 1 }));
    c.ws.send(JSON.stringify({ t: "in", d: "b", seq: 2 }));
    c.ws.send(JSON.stringify({ t: "in", d: "c" }));
    await vi.waitFor(() => {
      expect(c.frames.filter((f) => f.t === "ack").map((f) => f.seq)).toEqual([1, 2]);
    }, { timeout: 4_000 });
    c.ws.close();
  });
```

Sesuaikan nama helper (`connect`, `c.frames`, `c.opened`) dengan yang benar-benar dipakai berkas
itu — jalankan `sed -n '25,45p' server/test/terminal.route.test.ts` lebih dulu dan pakai bentuk
yang sama persis dengan test tetangganya, termasuk cara `id` sesi disiapkan.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run \
  test/terminal.route.test.ts -t "mengakui frame input" --no-file-parallelism --reporter=basic
```
Expected: FAIL — timeout `vi.waitFor`, daftar ack `[]`.

- [x] **Step 3: Balas ack di route**

Di `server/src/routes/terminal.ts`, ganti blok handler pesan (baris ~453-458):

```ts
      let m: { t?: string; d?: string; cols?: number; rows?: number };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") writeTo(id, m.d, client);
      else if (m.t === "resize" && m.cols && m.rows) resize(id, m.cols, m.rows);
```

menjadi:

```ts
      let m: { t?: string; d?: string; cols?: number; rows?: number; seq?: number };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") {
        writeTo(id, m.d, client);
        // SPEC-878 · ADR-0134 · pengakuan pengiriman, dibalas SESUDAH writeTo. Klien memakainya
        // sebagai satu-satunya titik nol jam TTL echo prediktif: sebelum byte-nya sampai, diamnya
        // pty tak berarti apa pun, dan menghukumnya terukur membeli 30,5 dtk layar bisu.
        // `seq` opsional — klien lama tak mengirimnya dan tak berubah perilakunya.
        if (typeof m.seq === "number") socket.send(JSON.stringify({ t: "ack", seq: m.seq }));
      }
      else if (m.t === "resize" && m.cols && m.rows) resize(id, m.cols, m.rows);
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run \
  test/terminal.route.test.ts --no-file-parallelism --reporter=basic
```
Expected: PASS — seluruh berkas, termasuk test baru dan test kuota burst yang sudah ada.

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: keluar 0.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(terminal): server mengakui frame input bernomor dengan {t:\"ack\"} (SPEC-878, ADR-0134)"
```

---

### Task 4: `TerminalPane` — seq/ack, `deliverable`, dan rollback saat menyambung ulang

Task ini yang membuat glyph **muncul dan bertahan** selama outage.

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Modify: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `P.onDelivered`, `P.View.deliverable` (Task 2); frame `{t:"ack", seq}` (Task 3).
- Produces: variabel closure `seq`, `unacked`, `gone`, helper `clockIfDelivered()` — dipakai
  Task 5 & 6 di berkas yang sama.

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/terminal-pane.test.tsx`, tambahkan blok berikut di akhir berkas. Helper `xt`,
`FakeWebSocket`, `sockets`, dan `paneHost` sudah ada di kepala berkas — pakai apa adanya.

```tsx
// SPEC-878 · brief melaporkan "layar diam meski tombol ditekan". Yang membuatnya diam ada dua:
// gerbang prediksi menolak saat socket mati, dan TTL menghapus + menyuspend 30 dtk saat pty diam
// karena jaringan. Keduanya dikunci di sini.
describe("TerminalPane · umpan balik ketikan saat jaringan goyah (SPEC-878)", () => {
  const glyphs = () => xt.written.filter((w) => w.startsWith("\x1b[4m"));

  it("tetap menggambar satu glyph per keystroke selagi socket putus", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    xt.written = [];
    for (const c of [..."halo"]) act(() => { xt.dataHandler?.(c); });
    expect(glyphs()).toHaveLength(4);
  });

  it("tak menghapus glyph yang belum di-ack, betapa pun lama server diam", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    xt.written = [];
    for (const c of [..."halo"]) act(() => { xt.dataHandler?.(c); });
    await act(() => new Promise<void>((r) => { setTimeout(r, 800); }));
    expect(xt.written.some((w) => w.includes("\x1b[K"))).toBe(false);
    xt.written = [];
    act(() => { xt.dataHandler?.("x"); });
    expect(glyphs()).toHaveLength(1);
  });

  it("TTL tetap menggigit sesudah ack — jaminan SPEC-856 tak dilonggarkan", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    xt.written = [];
    act(() => { xt.dataHandler?.("a"); });
    await act(() => new Promise<void>((r) => { setTimeout(r, 40); }));
    const frames = sockets[0]!.sent.map((m) => JSON.parse(m) as { t: string; seq?: number });
    const seq = frames.find((f) => f.t === "in")?.seq;
    expect(seq).toBe(1);
    act(() => { sockets[0]!.onmessage?.({ data: JSON.stringify({ t: "ack", seq }) }); });
    await act(() => new Promise<void>((r) => { setTimeout(r, 800); }));
    expect(xt.written).toContain("\x1b[1D\x1b[K");
  });

  it("menggulung balik prediksi outage tepat sebelum sambungan baru menggambar", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    for (const c of [..."abc"]) act(() => { xt.dataHandler?.(c); });
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 3_000 });
    xt.written = [];
    act(() => { sockets[1]!.onopen?.(); });
    expect(xt.written[0]).toBe("\x1b[3D\x1b[K");
  });

  it("berhenti memprediksi begitu sesi tmux-nya dinyatakan lenyap", async () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 4004 }); });
    xt.written = [];
    act(() => { xt.dataHandler?.("a"); });
    expect(glyphs()).toHaveLength(0);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/terminal-pane.test.tsx -t "SPEC-878" --reporter=basic`
Expected: FAIL — glyph 0 saat putus, `\x1b[K` muncul sesudah 800 ms tanpa ack, tak ada `seq` di frame.

- [x] **Step 3: Pasang seq/ack + `deliverable` + rollback**

Di `src/src/screens/TerminalPane.tsx`, di dalam `React.useEffect([sessionId])`:

**3a.** Ganti blok `sendInput`/`sendKey` (baris ~92-97) dengan:

```ts
    let pendingInput = "";
    // SPEC-878 · ADR-0134 · penomoran frame masuk. `unacked` adalah satu-satunya hal yang boleh
    // menyalakan jam TTL prediksi; selama ia > 0, diamnya server tak berarti apa pun.
    let seq = 0;
    let unacked = 0;
    // 4004 = sesi tmux-nya memang sudah lenyap. Ini satu-satunya keadaan di mana byte yang
    // diantre TIDAK akan pernah terkirim — jadi satu-satunya yang menutup `deliverable`.
    let gone = false;
    const sendFrame = (d: string) => {
      seq += 1;
      unacked += 1;
      send({ t: "in", d, seq });
    };
    const sendInput = (d: string) => {
      if (ws?.readyState === WebSocket.OPEN) { sendFrame(d); return; }
      // Balasan handshake milik sambungan yang sudah mati tak berarti apa pun bagi sambungan
      // berikutnya, dan blob campuran menembus gerbang `isTerminalResponse` di server (SPEC-860).
      if (gone || isTerminalResponse(d)) return;
      pendingInput += d;
    };
```

Tambahkan importnya di kepala berkas — gabungkan ke import `@hanoman/shared` yang sudah ada:

```ts
import { isTerminalResponse, paths } from "@hanoman/shared";
```

**3b.** Ganti `viewOf` (baris ~104-110):

```ts
    const viewOf = (): P.View => {
      const buf = term.buffer.active;
      return {
        cursorX: buf.cursorX, cols: term.cols, deliverable: !gone,
        line: buf.getLine(buf.viewportY + buf.cursorY)?.translateToString(true) ?? "",
      };
    };
    // Jam TTL baru boleh berjalan sesudah SELURUH frame yang sudah dikirim diakui server: sebelum
    // itu "pty diam" dan "byte belum sampai" tak bisa dibedakan.
    const clockIfDelivered = () => {
      if (unacked === 0 && ws?.readyState === WebSocket.OPEN) pred = P.onDelivered(pred, Date.now());
    };
```

**3c.** Di `socket.onmessage`, tepat sesudah blok `if (r.tail) { … }` di dalam cabang
`f.t === "data"`, tambahkan pemanggilannya, lalu tambahkan cabang `ack`. Bentuk akhir cabang
`data` dan cabang barunya:

```ts
          if (f.t === "data") {
            const r = P.onServerData(pred, f.d ?? "", Date.now());
            pred = r.state;
            // Rollback dan data server WAJIB satu panggilan write: keadaan antara tak boleh pernah
            // dirender, dan itulah yang membuat layar byte-identik dengan tanpa prediksi.
            term.write(r.write);
            if (r.tail) {
              const buf = term.buffer.active;
              const line = buf.getLine(buf.viewportY + buf.cursorY)?.translateToString(true) ?? "";
              const tail = r.tail.slice(P.echoedPrefixLen(line.slice(0, buf.cursorX), r.tail));
              const back = P.reapply(pred, tail, viewOf(), Date.now(), predictRef.current);
              pred = back.state;
              if (back.write) term.write(back.write);
            }
            clockIfDelivered();
          }
          // SPEC-878 · ADR-0134 · pengakuan pengiriman.
          else if (f.t === "ack") { unacked = Math.max(0, unacked - 1); clockIfDelivered(); }
```

Perluas juga tipe frame yang di-parse di baris ~153:

```ts
          const f = JSON.parse(ev.data as string) as {
            t: string; d?: string; code?: number; phases?: Phase[]; complete?: boolean;
            on?: boolean; seq?: number;
          };
```

**3d.** Ganti `socket.onopen` (baris ~134-151) — rollback prediksi outage lebih dulu, penomoran
di-reset per socket, dan `resize` mendahului kuras antrean:

```ts
        socket.onopen = () => {
          attempt = 0;
          seq = 0;
          unacked = 0;
          // Prediksi yang lahir selama outage adalah satu-satunya yang menulis ke terminal selama
          // itu, jadi kursor duduk persis di ujungnya dan rollback CUB+`\x1b[K` masih sah —
          // prasyarat yang sama yang sudah dipegang modul. Ia ditulis SEBELUM apa pun dari server;
          // apa yang benar-benar ada di pty digambar ulang tmux sesudahnya.
          const back = P.rollbackSeq(pred.pending.length);
          if (back) term.write(back);
          // tmux memutar ulang layar penuh saat attach — tak ada prediksi yang boleh diwarisi.
          pred = P.onReattach();
          setLink({ state: "open" });
          if (visibleRect()) {
            const finePointer = typeof window.matchMedia !== "function"
              || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
            if (finePointer) term.focus();
            // Geometri yang berubah selagi putus hilang senyap (`send` no-op saat socket mati), jadi
            // ia wajib mendahului byte antrean — kalau tidak TUI menggambar blob itu untuk geometri
            // lama lalu me-rewrap seluruh layar.
            send({ t: "resize", cols: term.cols, rows: term.rows });
          }
          // Dikuras di SETIAP open, bukan hanya yang pertama: itu yang mengubah buffer SPEC-771
          // dari penyembunyi kegagalan menjadi penyelamat ketikan.
          drainPending();
        };
```

**3e.** Sementara Task 6 belum dikerjakan, definisikan `drainPending` sebagai bentuk hari ini,
tepat di bawah `clockIfDelivered`:

```ts
    const drainPending = () => {
      if (!pendingInput) return;
      const d = pendingInput;
      pendingInput = "";
      sendFrame(d);
    };
```

**3f.** Di `socket.onclose`, tandai `gone` dan gulung balik prediksinya:

```ts
        socket.onclose = (event) => {
          if (disposed || finished) return;
          if (event.code === 4004) {
            gone = true;
            // Byte yang diantre tak akan pernah punya tujuan, jadi layar tak boleh terus
            // menampilkannya seolah ia akan sampai.
            const back = P.rollbackSeq(pred.pending.length);
            if (back) term.write(back);
            pred = P.onReattach();
            pendingInput = "";
            setLink({ state: "gone" });
            return;
          }
          retry();
        };
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/terminal-pane.test.tsx --reporter=basic`
Expected: PASS — seluruh berkas (test SPEC-511/800/856 yang sudah ada ikut hijau).

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(terminal): prediksi hidup & bertahan selama antrean, dihakimi ack (SPEC-878, ADR-0134)"
```

---

### Task 5: `TerminalPane` — satu pintu keluar untuk semua input

Terukur: mengetik `z` lalu menekan satu tombol papan tombol mengirim `["\x1b", "z"]` ke pty — yang
belakangan mendarat lebih dulu, karena hanya `term.onData` yang lewat batcher.

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Modify: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `batcher` (sudah ada), `sendInput` (Task 4).
- Produces: `sendRaw(d: string): void` — dipakai papan tombol, tap dialog, clipboard, lampiran.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/terminal-pane.test.tsx`, di dalam `describe` SPEC-878 yang dibuat Task 4:

```tsx
  // SPEC-878 · transposisi harfiah: jalur mentah menyalip ketikan yang masih ditahan jendela 16 ms.
  it("mengirim tombol papan tombol SESUDAH ketikan yang masih ditahan batcher", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} showKeys />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    const before = sockets[0]!.sent.length;
    act(() => { xt.dataHandler?.("z"); });
    act(() => { fireEvent.click(container.querySelector<HTMLButtonElement>(".hn-terminal-key")!); });
    await act(() => new Promise<void>((r) => { setTimeout(r, 40); }));
    const typed = sockets[0]!.sent.slice(before)
      .map((m) => JSON.parse(m) as { t: string; d?: string })
      .filter((f) => f.t === "in").map((f) => f.d);
    expect(typed).toEqual(["z", "\x1b"]);
  });

  it("mengirim tap dialog SESUDAH ketikan yang masih ditahan batcher", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    const el = paneHost(container);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      width: 640, height: 240, top: 0, right: 640, bottom: 240, left: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    xt.buffer.getLine = (n: number) => ({
      translateToString: () => (n === 0 ? "  1. Opsi A"
        : n === 1 ? "Enter to select · ↑/↓ to navigate" : ""),
    });
    const before = sockets[0]!.sent.length;
    act(() => { xt.dataHandler?.("z"); });
    act(() => {
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [{ clientY: 5 } as Touch] }));
      el.dispatchEvent(new TouchEvent("touchend", { changedTouches: [{ clientY: 5 } as Touch] }));
    });
    await act(() => new Promise<void>((r) => { setTimeout(r, 40); }));
    const typed = sockets[0]!.sent.slice(before)
      .map((m) => JSON.parse(m) as { t: string; d?: string })
      .filter((f) => f.t === "in").map((f) => f.d);
    expect(typed).toEqual(["z", "1"]);
  });
```

Kalau `TouchEvent` tak tersedia di jsdom versi ini, ganti dua `dispatchEvent` di atas dengan
`fireEvent.touchStart(el, { touches: [{ clientY: 5 }] })` dan
`fireEvent.touchEnd(el, { changedTouches: [{ clientY: 5 }] })` — `fireEvent` sudah diimpor di
kepala berkas. Bila tap dialog tetap tak bisa disimulasikan di jsdom, **hapus test kedua** dan
catat alasannya di `## Verifikasi` dokumen audit; test pertama sudah mengunci akar yang sama.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/terminal-pane.test.tsx -t "SESUDAH ketikan" --reporter=basic`
Expected: FAIL — `["\x1b","z"]` (terbalik).

- [x] **Step 3: Alirkan semua jalur mentah lewat batcher**

Di `src/src/screens/TerminalPane.tsx`:

**3a.** Tepat sesudah `const batcher = P.createInputBatcher(sendInput);`, tambahkan:

```ts
    // SPEC-878 · SATU pintu keluar. Jalur yang melewati batcher bisa mendarat di pty SEBELUM
    // ketikan yang masih ditahan jendela 16 ms — terukur `["\x1b","z"]` untuk `z` lalu Escape.
    // `coalesce=false` menguras antrean lebih dulu lalu meneruskan payload UTUH dalam satu frame,
    // jadi "satu tekan = satu keystroke" (SPEC-452) dan "paste utuh" (SPEC-289) tak berubah.
    const sendRaw = (d: string) => batcher.push(d, false);
    sendKey.current = sendRaw;
```

**3b.** Hapus baris `sendKey.current = sendInput;` yang lama (ada di blok `sendInput`, baris ~97).

**3c.** Ganti tiga call site mentah menjadi `sendRaw`:

- clipboard paste (baris ~226):
  ```ts
        void navigator.clipboard?.readText().then((t) => { if (t) sendRaw(t); });
  ```
- tap dialog (baris ~290):
  ```ts
      if (choice) sendRaw(choice);
  ```
- lampiran (baris ~301):
  ```ts
          sendRaw(`${path} `);
  ```

**3d.** Di cleanup effect, `batcher.dispose()` harus mendahului `typed.dispose()` — sudah begitu
hari ini (baris ~354-355); pastikan urutannya tak berubah.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/terminal-pane.test.tsx --reporter=basic`
Expected: PASS — termasuk test SPEC-289/452/800 yang sudah ada.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "fix(terminal): semua jalur input keluar lewat satu batcher, urutan benar (SPEC-878)"
```

---

### Task 6: `TerminalPane` — antrean berbatas, tak pernah men-submit, dan terlihat

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Modify: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `pendingInput`, `sendFrame`, `drainPending`, `gone` (Task 4); `batcher` (Task 5).
- Produces: `data-testid` baru — `terminal-queue`, `terminal-held`, `terminal-queue-full`;
  tombol berlabel `Kirim` dan `Buang`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `describe` SPEC-878 pada `src/test/terminal-pane.test.tsx`:

```tsx
  const reconnect = async () => {
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 3_000 });
    act(() => { sockets[1]!.onopen?.(); });
  };
  const inputs = (s: { sent: string[] }): string[] =>
    s.sent.map((m) => JSON.parse(m) as { t: string; d?: string })
      .filter((f) => f.t === "in").map((f) => f.d ?? "");

  it("menguras antrean tanpa submit apa adanya, dan `resize` mendahuluinya", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    vi.spyOn(paneHost(container), "getBoundingClientRect").mockReturnValue({
      width: 640, height: 360, top: 0, right: 640, bottom: 360, left: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    for (const c of [..."hai"]) act(() => { xt.dataHandler?.(c); });
    await reconnect();
    const kinds = sockets[1]!.sent.map((m) => (JSON.parse(m) as { t: string }).t);
    expect(kinds.indexOf("resize")).toBeLessThan(kinds.indexOf("in"));
    expect(inputs(sockets[1]!)).toEqual(["hai"]);
  });

  it("menahan antrean yang memuat Enter, dan tak mengirim apa pun sampai operator memilih",
    async () => {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(() => { sockets[0]!.onopen?.(); });
      act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
      for (const c of [..."rahasia"]) act(() => { xt.dataHandler?.(c); });
      act(() => { xt.dataHandler?.("\r"); });
      await reconnect();
      expect(inputs(sockets[1]!)).toEqual([]);
      expect(container.querySelector('[data-testid="terminal-held"]')).not.toBeNull();
      const kirim = [...container.querySelectorAll("button")].find((b) => b.textContent === "Kirim")!;
      act(() => { fireEvent.click(kirim); });
      expect(inputs(sockets[1]!)).toEqual(["rahasia\r"]);
      expect(container.querySelector('[data-testid="terminal-held"]')).toBeNull();
    });

  it("membuang antrean tertahan saat operator memilih Buang", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    act(() => { xt.dataHandler?.("\r"); });
    await reconnect();
    const buang = [...container.querySelectorAll("button")].find((b) => b.textContent === "Buang")!;
    act(() => { fireEvent.click(buang); });
    expect(inputs(sockets[1]!)).toEqual([]);
    expect(container.querySelector('[data-testid="terminal-held"]')).toBeNull();
  });

  it("memperlihatkan jumlah ketikan yang sedang diantre", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    for (const c of [..."halo"]) act(() => { xt.dataHandler?.(c); });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="terminal-queue"]')?.textContent)
        .toContain("4");
    });
  });

  it("berhenti menerima ketikan saat antrean penuh, dan berhenti menjanjikannya di layar",
    async () => {
      const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(() => { sockets[0]!.onopen?.(); });
      act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
      // 4096 byte lewat satu jalur mentah: bulk tak pernah diprediksi, jadi ia mengisi antrean
      // tanpa menyentuh gerbang tepi layar.
      act(() => { sendKeyOf(container)("x".repeat(4_096)); });
      xt.written = [];
      act(() => { xt.dataHandler?.("a"); });
      expect(glyphs()).toHaveLength(0);
      expect(container.querySelector('[data-testid="terminal-queue-full"]')).not.toBeNull();
    });
```

Tambahkan helper `sendKeyOf` di dalam `describe` yang sama — ia menekan tombol papan tombol
pertama untuk mendapatkan jalur mentah tanpa mengekspos internal komponen. Karena tombol papan
tombol mengirim sekuens tetap, pakai jalur clipboard sebagai gantinya:

```tsx
  const sendKeyOf = (container: HTMLElement) => (d: string) => {
    // Jalur mentah yang bisa membawa payload sembarang: paste clipboard (SPEC-289).
    const host = paneHost(container);
    const ev = new Event("paste") as ClipboardEvent;
    Object.defineProperty(ev, "clipboardData", { value: { items: [], files: [] } });
    host.dispatchEvent(ev);
    // `onPaste` hanya menangani gambar; teks polos tetap milik jalur `attachCustomKeyEventHandler`.
    xt.keyHandler?.(keydown({ key: "v", metaKey: true }));
    return d;
  };
```

Bila helper di atas ternyata tak bisa menyuntikkan payload (mock clipboard `navigator.clipboard`
tak tersedia), **ganti** test "antrean penuh" dengan bentuk yang memakai `xt.dataHandler` sebanyak
`MAX_PENDING_INPUT + 1` karakter:

```tsx
  it("berhenti menerima ketikan saat antrean penuh", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    act(() => { sockets[0]!.readyState = 3; sockets[0]!.onclose?.({ code: 1006 }); });
    act(() => { for (let i = 0; i < 4_097; i += 1) xt.dataHandler?.("x"); });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="terminal-queue-full"]')).not.toBeNull();
    });
  });
```

Pakai bentuk kedua bila yang pertama menyulitkan; ia menguji invariant yang sama.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/terminal-pane.test.tsx -t "antrean" --reporter=basic`
Expected: FAIL — antrean ber-`\r` terkirim, tak ada `terminal-held`/`terminal-queue`.

- [x] **Step 3: Kebijakan antrean di komponen**

Di `src/src/screens/TerminalPane.tsx`:

**3a.** Tambahkan konstanta di dekat `RECONNECT_BACKOFF_MS` (kepala berkas):

```ts
// SPEC-878 · ADR-0134 · antrean adalah penyelamat ketikan (SPEC-800), bukan tempat penyimpanan.
// 4 KiB memuat satu paragraf yang di-paste dan tetap menghentikan antrean yang lari.
const MAX_PENDING_INPUT = 4_096;
// Layar operator sudah basi berdetik-detik saat antrean mendarat, jadi `\r` di dalamnya adalah
// jawaban atas pertanyaan yang mungkin bukan lagi yang ada di layar — terukur men-submit baris
// yang salah ke agen. Antrean karena itu tak pernah mengirim byte yang men-submit sendiri.
const SUBMIT = /[\r\n]/;
```

**3b.** Tambahkan state komponen di dekat `const [link, setLink] = …`:

```ts
  const [queue, setQueue] = React.useState<{ n: number; held: boolean; full: boolean }>(
    { n: 0, held: false, full: false });
  const sendHeld = React.useRef<() => void>(() => {});
  const dropHeld = React.useRef<() => void>(() => {});
```

**3c.** Di dalam effect, ganti blok `sendInput` (Task 4 §3a) menjadi bentuk final:

```ts
    let pendingInput = "";
    let held = false;
    let full = false;
    let seq = 0;
    let unacked = 0;
    let gone = false;
    const publishQueue = () => setQueue({ n: pendingInput.length, held, full });
    const sendFrame = (d: string) => {
      seq += 1;
      unacked += 1;
      send({ t: "in", d, seq });
    };
    // Byte tak pernah menyalip antrean yang belum terkuras: FIFO secara konstruksi, bukan karena
    // jendela 16 ms kebetulan tak kena.
    const sendInput = (d: string) => {
      if (!held && !pendingInput && ws?.readyState === WebSocket.OPEN) { sendFrame(d); return; }
      if (gone || isTerminalResponse(d)) return;
      if (pendingInput.length + d.length > MAX_PENDING_INPUT) { full = true; publishQueue(); return; }
      pendingInput += d;
      publishQueue();
    };
```

**3d.** Ganti `viewOf`-nya (Task 4 §3b) supaya antrean penuh ikut menutup prediksi:

```ts
        cursorX: buf.cursorX, cols: term.cols, deliverable: !gone && !full,
```

**3e.** Ganti `drainPending` sementara dari Task 4 §3e dengan bentuk final, dan tambahkan
`flushQueue` di atasnya:

```ts
    const flushQueue = () => {
      const d = pendingInput;
      if (!d || ws?.readyState !== WebSocket.OPEN) { publishQueue(); return; }
      pendingInput = "";
      full = false;
      publishQueue();
      sendFrame(d);
    };
    const drainPending = () => {
      // Apa pun yang masih ditahan jendela 16 ms milik antrean ini juga — menguras antrean
      // sebelum batcher akan menukar urutannya.
      batcher.flush();
      if (!pendingInput) { publishQueue(); return; }
      if (SUBMIT.test(pendingInput)) { held = true; publishQueue(); return; }
      flushQueue();
    };
```

`drainPending` memanggil `batcher`, jadi ia harus didefinisikan **sesudah**
`const batcher = P.createInputBatcher(sendInput);`. Pindahkan definisi `flushQueue`/`drainPending`
ke bawah `sendRaw` (Task 5 §3a).

**3f.** Pasang aksi strip, tepat di bawah `drainPending`:

```ts
    sendHeld.current = () => { held = false; flushQueue(); };
    dropHeld.current = () => { pendingInput = ""; held = false; full = false; publishQueue(); };
```

dan kosongkan keduanya di cleanup effect, bersama `retryNow.current`/`sendKey.current`:

```ts
      sendHeld.current = () => {};
      dropHeld.current = () => {};
```

**3g.** Di cabang `4004` pada `socket.onclose` (Task 4 §3f), tambahkan pembersihan antrean:

```ts
            pendingInput = "";
            held = false;
            full = false;
            publishQueue();
```

**3h.** Ganti seluruh blok render strip (baris ~379-397) menjadi:

```tsx
      {/* Diam adalah cacatnya (audit SPEC-800 §3); diam tak boleh jadi bagian perbaikannya.
          SPEC-878 · strip juga bicara saat sambungan sehat: antrean yang ditahan karena memuat
          Enter adalah keputusan yang menunggu operator, bukan keadaan koneksi. */}
      {(link.state !== "open" && link.state !== "connecting" || queue.held || queue.full) && (
        <div data-testid="terminal-link" style={{
          display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto", flexWrap: "wrap",
          padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 11,
          background: link.state === "retrying" || queue.held
            ? "var(--status-warn-tint)" : "var(--status-err-tint)",
          color: "var(--text-body)",
        }}>
          {link.state === "retrying" && <span>menyambung ulang… ({link.attempt}/{RECONNECT_MAX})</span>}
          {link.state === "gone" && <span>sesi tidak ditemukan di tmux</span>}
          {link.state === "lost" && <>
            <span>terputus</span>
            <button type="button" className="hn-terminal-action hn-terminal-action--text"
              onClick={() => retryNow.current()}>Sambungkan lagi</button>
          </>}
          {queue.n > 0 && !queue.held && (
            <span data-testid="terminal-queue">{queue.n} ketikan diantre</span>
          )}
          {queue.held && <>
            <span data-testid="terminal-held">{queue.n} ketikan tertahan — belum dikirim</span>
            <button type="button" className="hn-terminal-action hn-terminal-action--text"
              onClick={() => sendHeld.current()}>Kirim</button>
            <button type="button" className="hn-terminal-action hn-terminal-action--text"
              onClick={() => dropHeld.current()}>Buang</button>
          </>}
          {queue.full && <span data-testid="terminal-queue-full">antrean penuh</span>}
        </div>
      )}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/terminal-pane.test.tsx --reporter=basic`
Expected: PASS — seluruh berkas.

- [x] **Step 5: Jalankan test klien lain yang menyentuh strip**

Run: `pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx test/terminal-chrome.test.ts --reporter=basic`
Expected: PASS.

- [x] **Step 6: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(terminal): antrean outage berbatas, terlihat, dan tak pernah men-submit (SPEC-878)"
```

---

### Task 7: Docs SoT + verifikasi ujung-ke-ujung

**Files:**
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/frontend/frontend-implementation.md:543-570`
- Modify: `internal/skills/hanoman/SKILL.md:122`
- Modify: `internal/docs/research/audit-spec-878-ketikan-hilang-saat-jaringan-goyah.md` (bagian
  `## Verifikasi`, ditambahkan di task ini)
- Delete: `src/test/spec878-probe.test.tsx`

**Interfaces:**
- Consumes: seluruh Task 1-6.
- Produces: nihil (dokumentasi).

- [x] **Step 1: Hapus probe audit**

```bash
rm -f src/test/spec878-probe.test.tsx
```

Probe itu tak punya assertion — ia alat ukur audit, bukan pagar. Yang menjaga perilakunya sekarang
adalah test di Task 2, 4, 5, dan 6.

- [x] **Step 2: Narasi ADR di sub-index**

Tambahkan satu baris di `internal/docs/adr/README.md`, **di atas** baris `0133`, dengan bentuk yang
sama persis dengan tetangganya:

```markdown
- [0134 — Prediksi input dihakimi oleh pengakuan pengiriman, bukan oleh `readyState`](0134-pengakuan-pengiriman-input-terminal.md) — **menegakkan 0014, 0016, 0117, dan 0133**, tanpa mencabut apa pun (SPEC-878). TTL 500 ms + suspend 30 dtk milik SPEC-856 dimulai saat karakter DIKETIK, dan gerbangnya membaca `ws.readyState === OPEN` — dua fakta transport dipakai sebagai fakta pengiriman. Terukur di jalur nyata: socket `OPEN` tanpa byte mengalir (bentuk normal pindah sel) membuat 9 glyph muncul lalu **dihapus** (`\x1b[9D\x1b[K`) dan prediksi mati 30 dtk dengan `link` tetap `"open"` dan **nol banner** — satu kedip 500 ms membeli **30,5 dtk layar bisu**; socket tertutup memberi **0 tulis lokal untuk 14 keystroke** meski bytenya aman diantre. `ws.bufferedAmount` bukan penggantinya (payload satu keystroke lolos ke buffer kernel dan terbaca `0`). Kontrak frame karena itu bertambah satu pasang: `{t:"in", d, seq}` → `{t:"ack", seq}`, dibalas sesudah `writeTo`; `View.connected` jadi `View.deliverable`; `onInput` menghentikan jam (`since = null`) dan `onDelivered` menyalakannya hanya saat semua frame sudah diakui. `TTL_MS`/`SUSPEND_MS` tak berubah — yang diperbaiki kapan hukumannya berhak dijatuhkan. Merosot aman di kedua rilis campuran, dan tanpa denyut periodik apa pun (arah keluar SPEC-812 utuh)
```

- [x] **Step 3: Perbarui doc frontend**

Di `internal/docs/frontend/frontend-implementation.md`, pada paragraf **Echo prediktif lokal**:

- Ganti frasa daftar gerbang `socket belum \`open\`` menjadi:
  `byte tak akan pernah terkirimkan (\`View.deliverable\` — sesi tmux lenyap/4004 atau antrean penuh; SPEC-878 · ADR-0134: byte yang diantre untuk sambungan yang masih akan pulih **tetap** diprediksi)`.
- Ganti frasa `dan begitu satu prediksi mencapai TTL 500 ms tanpa pernah ter-echo` menjadi:
  `dan begitu satu prediksi mencapai TTL 500 ms tanpa pernah ter-echo **sesudah frame yang membawanya diakui server** (\`{t:"ack", seq}\` — SPEC-878 · ADR-0134; sebelum pengakuan itu jam TTL tak berjalan sama sekali, karena diamnya server tak memisahkan "pty bungkam" dari "byte belum sampai")`.
- Ganti kalimat `Di atasnya, **hanya \`term.onData\`** yang melewati batcher input 16 ms` menjadi:
  `Di atasnya, **semua** jalur input keluar lewat batcher yang sama (SPEC-878): \`term.onData\` boleh ditahan 16 ms, sedangkan clipboard (SPEC-289), tap dialog (SPEC-452), lampiran (SPEC-816), dan papan tombol layar (SPEC-800) memakai \`sendRaw\` = \`push(d, false)\` yang **menguras antrean lebih dulu** lalu meneruskan payload utuh dalam satu frame — jaminan "satu tekan = satu keystroke" dan "paste utuh" tak berubah, sementara transposisi yang terukur (\`["\\x1b","z"]\` untuk \`z\` lalu Escape) hilang secara konstruksi`.
- Tambahkan paragraf baru tepat sesudah paragraf itu:

```markdown
**Antrean ketikan saat sambungan putus** (SPEC-878 · ADR-0134). `pendingInput` berbatas
`MAX_PENDING_INPUT = 4 096` byte; penuh berarti byte baru **tidak** diterima, `deliverable` tertutup
(jadi tak ada glyph yang menjanjikan sesuatu yang dibuang), dan strip mengatakannya. Byte tak
pernah menyalip antrean yang belum terkuras — `sendInput` mengirim langsung **hanya** saat antrean
kosong. Saat sambungan pulih, `{t:"resize"}` dikirim lebih dulu (geometri yang berubah selagi putus
hilang senyap karena `send` no-op), lalu antrean dikuras — **kecuali** bila ia memuat `\r`/`\n`:
antrean itu **seluruhnya ditahan** dan strip menawarkan `Kirim` / `Buang`. Alasannya terukur: layar
operator sudah basi berdetik-detik saat blob mendarat, dan `capture-pane` memperlihatkan baris yang
salah benar-benar ter-submit ke agen. Memecah di `\r` pertama ditolak — itu mengirim separuh
kalimat. Balasan handshake terminal (`isTerminalResponse`, kini di `@hanoman/shared`) tak pernah
ikut mengantre: ia milik sambungan yang sudah mati, dan blob campuran menembus gerbang `writeTo`
(SPEC-860) apa adanya. Antrean **tidak** dipersistensi lintas unmount, dan dibuang saat sesi
dinyatakan lenyap (4004) karena tak ada lagi tujuannya.
```

- [x] **Step 4: Perbarui SKILL project**

Di `internal/skills/hanoman/SKILL.md`, pada bullet `- Terminal server: **node-pty + tmux** …`,
ganti anak kalimat `**hanya `term.onData`** yang lewat batcher input 16 ms dan batcher itu hanya
aktif saat prediksi aktif — clipboard/tap dialog/lampiran/papan tombol tetap memakai `sendInput`
mentah, jadi jaminan SPEC-289/452/800/816 tak berubah` menjadi:

```
**semua** jalur input keluar lewat batcher yang sama sejak SPEC-878 (`term.onData` boleh ditahan
16 ms; clipboard/tap dialog/lampiran/papan tombol memakai `sendRaw` = `push(d, false)` yang
menguras antrean lebih dulu lalu lewat utuh dalam satu frame) — jaminan SPEC-289/452/800/816 tak
berubah, dan transposisi terukur `["\x1b","z"]` hilang secara konstruksi
```

Lalu tambahkan kalimat berikut di akhir bullet yang sama:

```
**Arah masuk disempurnakan SPEC-878/ADR-0134:** gerbang prediksi & TTL-nya dulu membaca
`ws.readyState === OPEN` (fakta transport) sebagai fakta pengiriman — terukur, socket `OPEN` tanpa
byte mengalir membuat 9 glyph muncul lalu **dihapus** dan prediksi mati **30,5 dtk tanpa satu pun
banner**, sementara socket tertutup memberi **0 tulis lokal untuk 14 keystroke**. Kontrak frame
bertambah `{t:"in", d, seq}` → `{t:"ack", seq}`; `View.connected` jadi `View.deliverable`; jam TTL
berjalan **hanya** sesudah `onDelivered`. Antrean outage berbatas 4 KiB, terlihat di strip, tak
pernah menyalip byte baru, dan **tak pernah mengirim `\r`/`\n` tanpa operator menekan `Kirim`` —
`capture-pane` membuktikan blob lama benar-benar men-submit baris yang salah ke agen.
```

- [x] **Step 5: Jalankan seluruh test yang tersentuh, sekali**

Run:
```bash
pnpm --filter ./shared exec vitest run src/terminal-io.test.ts --reporter=basic && \
pnpm --filter ./src exec vitest run test/terminal-predict.test.ts test/terminal-pane.test.tsx \
  test/terminal-screen.test.tsx --reporter=basic && \
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run \
  test/terminal.route.test.ts test/pty-queries.test.ts --no-file-parallelism --reporter=basic
```
Expected: PASS di ketiganya, dengan jumlah test **> 0** di setiap berkas (jangan terima
"no test files").

- [x] **Step 6: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./src typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0 di ketiganya.

- [x] **Step 7: Smoke ujung-ke-ujung terhadap server hidup**

Task ini menyentuh endpoint WebSocket, jadi endpoint itu diuji nyata **sekali di akhir**.

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-878
env -u NODE_ENV -u DATABASE_URL HANOMAN_HOME="$(mktemp -d)" \
  node --experimental-strip-types server/src/server.ts &
# tunggu sampai /api/health menjawab, lalu:
curl -s http://127.0.0.1:8787/api/health
```

Buat satu sesi tmux sendiri di socket `hanoman` (JANGAN `POST /terminal/sessions` — ia men-spawn
`claude` sungguhan):

```bash
tmux -L hanoman -f /dev/null new-session -d -s hanoman-s878 -c /tmp 'sh' \
  \; set-option -t hanoman-s878 @hanoman_project hanoman \
  \; set-option -t hanoman-s878 @hanoman_cwd /tmp
```

Lalu buka WS-nya dengan skrip Node sekali pakai di scratchpad yang mengirim
`{"t":"in","d":"echo ok\r","seq":1}` dan mencetak setiap frame yang diterima. Harapan: sebuah frame
`{"t":"ack","seq":1}` muncul, dan `tmux -L hanoman capture-pane -p -t hanoman-s878` memperlihatkan
`ok`. Bersihkan: `tmux -L hanoman kill-session -t hanoman-s878` dan `kill <pid server>` (per-PID,
**jangan** `pkill`).

Catat hasilnya (frame ack yang benar-benar diterima + potongan `capture-pane`) di bagian
`## Verifikasi` dokumen audit.

- [x] **Step 8: Tulis bagian `## Verifikasi` di dokumen audit**

Tambahkan di akhir `internal/docs/research/audit-spec-878-ketikan-hilang-saat-jaringan-goyah.md`
sebuah bagian `## Verifikasi` yang memuat, apa adanya dari run yang benar-benar dijalankan:
angka test yang lulus per berkas, hasil typecheck, hasil smoke WS (frame ack + `capture-pane`), dan
ulangan harness ujung-ke-ujung sesudah perbaikan (glyph bertahan selama `hold`, urutan `["z","\x1b"]`,
antrean ber-`\r` tertahan). Bila ada lengan yang **tidak** dijalankan, katakan itu — jangan menulis
angka yang tak diukur.

- [x] **Step 9: Commit**

```bash
git add internal/docs docs/superpowers src/test
git commit -m "docs(terminal): ADR-0134 + doc SoT ketikan saat jaringan goyah (SPEC-878)"
```

---

## Self-review

**Cakupan spec → task:**

| bagian spec | task |
| --- | --- |
| §1 ack `{t:"in", seq}` / `{t:"ack"}` | Task 3 (server) + Task 4 (klien) |
| §2 `View.connected` → `View.deliverable` | Task 2 + Task 4 §3b/3d, Task 6 §3d |
| §3 jam TTL sejak `onDelivered` | Task 2 + Task 4 §3b/3c |
| §4 antrean berbatas, gerbang submit, strip | Task 6 |
| §5 satu pintu keluar input | Task 5 |
| §6 `resize` mendahului kuras | Task 4 §3d + test Task 6 |
| §7 balasan handshake tak mengantre | Task 1 + Task 4 §3a |
| §8 rollback saat menyambung ulang | Task 4 §3d/3f |
| kriteria terima 1-7 | Task 2, 4, 5, 6 (test), Task 7 (smoke + harness) |

**Konsistensi tipe:** `View.deliverable` dipakai identik di Task 2 (definisi), Task 4 §3b, dan
Task 6 §3d. `onDelivered(state, now)` didefinisikan Task 2 dan dipanggil Task 4 lewat
`clockIfDelivered()`. `sendFrame`/`sendInput`/`sendRaw`/`flushQueue`/`drainPending`/`publishQueue`
semuanya lahir di Task 4-6 dengan nama yang sama di setiap penyebutan. `isTerminalResponse`
diekspor Task 1 dan dikonsumsi Task 4 §3a.

**Catatan urutan:** Task 4 memperkenalkan `drainPending` versi sementara agar `onopen` bisa
di-compile; Task 6 menggantinya dengan versi final dan memindahkannya ke bawah `sendRaw`. Itu
disengaja supaya setiap task berdiri sendiri sebagai deliverable yang bisa ditolak terpisah.
