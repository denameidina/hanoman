# Voice Input (Speech-to-Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator mengklik mic di pane sesi aktif, berbicara, dan hasilnya masuk ke composer terminal (tanpa Enter otomatis).

**Architecture:** Antarmuka `SpeechEngine` (murni) + implementasi `web-speech-engine` di atas `SpeechRecognition`. Hook `useVoiceInput` memegang engine, mesin-keadaan (`voiceReducer`), dan bahasa. `VoiceControls` menampilkan mic/bahasa/pratinjau/galat. `TerminalPane` merangkai hook ke `TerminalComposer` lewat ref `voiceAppend`; hasil *final* ditambahkan ke composer, hasil *interim* hanya pratinjau.

**Tech Stack:** React + TypeScript strict (Vite), vitest + jsdom + Testing Library, ikon lucide lewat registry statis.

Spec: `docs/superpowers/specs/2026-10-05-voice-input-design.md`

## Global Constraints

- Frontend saja: tidak ada endpoint, skema, atau migration baru.
- Bahasa default `id-ID`; disimpan di `localStorage` kunci `hanoman.voice.lang`, **selalu** dibungkus try/catch.
- Mic toggle (klik mulai, klik lagi berhenti). **Tidak ada** Enter/`\r` otomatis dari jalur suara.
- Hasil interim **tidak boleh** menyentuh state composer atau pty.
- Tombol hanya tampil bila `canWrite` dan `engine.supported`; di browser tanpa dukungan, tak ada DOM suara sama sekali.
- File sumber di `src/src/screens/`, tes di `src/test/` (impor `../src/screens/...`).
- Komentar kode dan docs berbahasa Indonesia, mengikuti file sekitar. Kutip SPEC/ADR bila relevan.
- Setelah tiap task: centang checklist di file plan ini, jalankan **hanya tes yang tersentuh** (path tes disebut per task). Bukan suite penuh.
- Docs yang tersentuh diperbarui di commit yang sama dengan implementasinya (Task 6 memuat ADR + docs; commit docs boleh terpisah dari commit kode asalkan di branch/PR yang sama).
- Jalankan implementasi di worktree terpisah, bukan working tree utama.
- Commit memakai trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Tanggung jawab |
|------|----------------|
| Create `src/src/screens/speech-engine.ts` | Tipe `SpeechEngine`/`SpeechError`, `appendFinal`, `voiceReducer`, konstanta bahasa & pesan galat, `readLang`/`writeLang`. Murni, tanpa DOM/React. |
| Create `src/src/screens/web-speech-engine.ts` | `createWebSpeechEngine()`: adaptor `SpeechRecognition` → `SpeechEngine`. |
| Create `src/src/screens/use-voice-input.ts` | Hook `useVoiceInput`: engine + reducer + bahasa + toggle. |
| Create `src/src/screens/VoiceControls.tsx` | Presentasional: tombol mic, pemilih bahasa, pratinjau interim, pesan galat. |
| Modify `src/src/screens/TerminalComposer.tsx` | Props baru `voiceAppend` & `onDraft`. |
| Modify `src/src/screens/TerminalPane.tsx` | Rangkai hook + controls + visibilitas composer. |
| Modify `src/src/app.css` | Gaya `.hn-terminal-voice*` & indikator rekam. |
| Regenerate `src/src/ds/icon-registry.ts` | Memasukkan ikon `mic`, `info`. |
| Create `src/test/speech-engine.test.ts`, `src/test/web-speech-engine.test.ts`, `src/test/voice-controls.test.tsx`, `src/test/terminal-composer-voice.test.tsx` | Tes unit/komponen. |
| Modify `src/test/terminal-pane.test.tsx` | Describe baru: integrasi voice di pane. |
| Create `internal/docs/adr/0177-dikte-suara-seam-speech-engine.md`; modify `internal/docs/frontend/frontend-implementation.md`, `internal/docs/README.md` | Docs. |

---

### Task 1: Modul murni `speech-engine.ts`

**Files:**
- Create: `src/src/screens/speech-engine.ts`
- Test: `src/test/speech-engine.test.ts`

**Interfaces:**
- Produces (dipakai Task 2–5):
  - `type SpeechError = "not-allowed" | "no-speech" | "network" | "insecure-context" | "unsupported" | "other"`
  - `interface SpeechEngine { readonly supported: boolean; start(lang: string): void; stop(): void; onInterim(cb: (t: string) => void): void; onFinal(cb: (t: string) => void): void; onError(cb: (e: SpeechError) => void): void; onEnd(cb: () => void): void }`
  - `DEFAULT_LANG = "id-ID"`, `LANG_KEY = "hanoman.voice.lang"`, `LANGS: { value: string; label: string }[]`
  - `ERROR_MESSAGES: Record<SpeechError, string>`
  - `appendFinal(draft: string, finalText: string): string`
  - `type VoiceState = { status: "idle" | "listening"; interim: string; error: SpeechError | null }`
  - `type VoiceAction = { type: "start" } | { type: "interim"; text: string } | { type: "final" } | { type: "error"; error: SpeechError } | { type: "end" } | { type: "dismiss" }`
  - `initialVoiceState: VoiceState`, `voiceReducer(s: VoiceState, a: VoiceAction): VoiceState`
  - `readLang(): string`, `writeLang(lang: string): void`

- [x] **Step 1: Write the failing test**

Create `src/test/speech-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendFinal, DEFAULT_LANG, ERROR_MESSAGES, initialVoiceState, LANG_KEY, readLang, voiceReducer,
  writeLang, type SpeechError, type VoiceState,
} from "../src/screens/speech-engine";

describe("appendFinal", () => {
  it("draf kosong → teks final apa adanya (di-trim)", () => {
    expect(appendFinal("", "  halo dunia ")).toBe("halo dunia");
  });
  it("menyisipkan satu spasi pemisah", () => {
    expect(appendFinal("buka file", "server")).toBe("buka file server");
  });
  it("tidak menggandakan spasi bila draf sudah berakhir spasi", () => {
    expect(appendFinal("buka ", "file")).toBe("buka file");
  });
  it("teks final kosong/spasi saja → draf tak berubah", () => {
    expect(appendFinal("abc", "")).toBe("abc");
    expect(appendFinal("abc", "   ")).toBe("abc");
  });
  it("tidak mengubah kapitalisasi", () => {
    expect(appendFinal("jalankan", "PNPM Vitest")).toBe("jalankan PNPM Vitest");
  });
});

describe("voiceReducer", () => {
  const listening: VoiceState = { status: "listening", interim: "", error: null };

  it("start → listening, interim & galat dibersihkan", () => {
    const s = voiceReducer({ status: "idle", interim: "x", error: "network" }, { type: "start" });
    expect(s).toEqual(listening);
  });
  it("interim menyimpan teks sementara", () => {
    expect(voiceReducer(listening, { type: "interim", text: "ha" }).interim).toBe("ha");
  });
  it("final membersihkan interim, tetap listening", () => {
    const s = voiceReducer({ ...listening, interim: "halo" }, { type: "final" });
    expect(s).toEqual(listening);
  });
  it("error → idle dan galat tersimpan", () => {
    const s = voiceReducer({ ...listening, interim: "ha" }, { type: "error", error: "not-allowed" });
    expect(s).toEqual({ status: "idle", interim: "", error: "not-allowed" });
  });
  it("end sesudah error mempertahankan galat (browser memicu error lalu end)", () => {
    const afterError = voiceReducer(listening, { type: "error", error: "no-speech" });
    expect(voiceReducer(afterError, { type: "end" }).error).toBe("no-speech");
  });
  it("end tanpa galat → idle bersih", () => {
    expect(voiceReducer({ ...listening, interim: "ha" }, { type: "end" }))
      .toEqual(initialVoiceState);
  });
  it("dismiss menghapus galat saja", () => {
    const s = voiceReducer({ status: "idle", interim: "", error: "network" }, { type: "dismiss" });
    expect(s).toEqual(initialVoiceState);
  });
});

describe("ERROR_MESSAGES", () => {
  it("punya pesan untuk setiap SpeechError", () => {
    const all: SpeechError[] = ["not-allowed", "no-speech", "network", "insecure-context", "unsupported", "other"];
    for (const e of all) expect(ERROR_MESSAGES[e].length).toBeGreaterThan(0);
  });
});

describe("readLang/writeLang", () => {
  beforeEach(() => { localStorage.clear(); });

  it("default id-ID bila belum tersimpan", () => {
    expect(readLang()).toBe(DEFAULT_LANG);
    expect(DEFAULT_LANG).toBe("id-ID");
  });
  it("menyimpan dan membaca bahasa yang dikenal", () => {
    writeLang("en-US");
    expect(localStorage.getItem(LANG_KEY)).toBe("en-US");
    expect(readLang()).toBe("en-US");
  });
  it("nilai asing di storage → jatuh ke default", () => {
    localStorage.setItem(LANG_KEY, "xx-XX");
    expect(readLang()).toBe(DEFAULT_LANG);
  });
  it("storage melempar → tidak crash, default", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try { expect(readLang()).toBe(DEFAULT_LANG); } finally { Storage.prototype.getItem = orig; }
    expect(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("blocked"); };
      try { writeLang("en-US"); } finally { Storage.prototype.setItem = set; }
    }).not.toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/speech-engine.test.ts`
Expected: FAIL — "Failed to resolve import ../src/screens/speech-engine".

- [x] **Step 3: Write minimal implementation**

Create `src/src/screens/speech-engine.ts`:

```ts
// Dikte suara (spec 2026-10-05-voice-input-design). Modul MURNI: tanpa DOM, tanpa React, supaya
// penggabung transkrip dan mesin-keadaan mic bisa diuji tanpa browser. Engine sungguhan
// (`web-speech-engine.ts`, kelak Whisper) hanya perlu memenuhi `SpeechEngine`.

export type SpeechError =
  "not-allowed" | "no-speech" | "network" | "insecure-context" | "unsupported" | "other";

export interface SpeechEngine {
  readonly supported: boolean;
  start(lang: string): void;
  stop(): void;
  /** Teks sementara (berubah-ubah). Boleh string kosong = "tak ada interim lagi". */
  onInterim(cb: (text: string) => void): void;
  /** Satu potong teks yang sudah final. */
  onFinal(cb: (text: string) => void): void;
  onError(cb: (e: SpeechError) => void): void;
  /** Engine berhenti, entah karena `stop()`, jeda diam, atau galat. */
  onEnd(cb: () => void): void;
}

export const DEFAULT_LANG = "id-ID";
export const LANG_KEY = "hanoman.voice.lang";
export const LANGS: { value: string; label: string }[] = [
  { value: "id-ID", label: "Indonesia" },
  { value: "en-US", label: "English" },
];

export const ERROR_MESSAGES: Record<SpeechError, string> = {
  "not-allowed": "Izin mikrofon ditolak. Aktifkan di pengaturan browser.",
  "no-speech": "Tidak ada suara terdengar.",
  "network": "Layanan suara tak terjangkau.",
  "insecure-context": "Mikrofon butuh HTTPS atau localhost.",
  "unsupported": "Browser ini tak mendukung dikte suara.",
  "other": "Dikte suara gagal.",
};

/** Menambahkan teks final ke draf composer: satu spasi pemisah, tanpa spasi ganda, kapitalisasi
 *  dibiarkan. Teks final kosong tak mengubah apa pun. */
export function appendFinal(draft: string, finalText: string): string {
  const t = finalText.trim();
  if (!t) return draft;
  if (!draft) return t;
  return /\s$/.test(draft) ? draft + t : `${draft} ${t}`;
}

export type VoiceState = { status: "idle" | "listening"; interim: string; error: SpeechError | null };
export type VoiceAction =
  | { type: "start" }
  | { type: "interim"; text: string }
  | { type: "final" }
  | { type: "error"; error: SpeechError }
  | { type: "end" }
  | { type: "dismiss" };

export const initialVoiceState: VoiceState = { status: "idle", interim: "", error: null };

/** Tak ada aksi "stop": `stop()` pada engine tak mengubah status — status baru kembali `idle` saat
 *  engine melapor `end`. Alasannya: Web Speech masih bisa menyerahkan potongan final TERAKHIR
 *  sesudah `stop()`; jika UI sudah idle (dan composer tersembunyi), teks itu hilang. */
export function voiceReducer(s: VoiceState, a: VoiceAction): VoiceState {
  switch (a.type) {
    case "start": return { status: "listening", interim: "", error: null };
    case "interim": return { ...s, interim: a.text };
    case "final": return { ...s, interim: "" };
    case "error": return { status: "idle", interim: "", error: a.error };
    // Browser memicu `error` lalu `end`: galat harus selamat dari `end`.
    case "end": return { ...s, status: "idle", interim: "" };
    case "dismiss": return { ...s, error: null };
  }
}

export function readLang(): string {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.some((l) => l.value === v) ? (v as string) : DEFAULT_LANG;
  } catch { return DEFAULT_LANG; }
}

export function writeLang(lang: string): void {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* mode privat / storage diblokir */ }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/speech-engine.test.ts`
Expected: PASS (semua tes hijau).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/speech-engine.ts src/test/speech-engine.test.ts docs/superpowers/plans/2026-10-05-voice-input.md
git commit -m "feat(voice): modul murni speech-engine (appendFinal, voiceReducer, bahasa)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Adaptor `web-speech-engine.ts`

**Files:**
- Create: `src/src/screens/web-speech-engine.ts`
- Test: `src/test/web-speech-engine.test.ts`

**Interfaces:**
- Consumes: `SpeechEngine`, `SpeechError` dari `./speech-engine` (Task 1).
- Produces: `createWebSpeechEngine(win?: Window): SpeechEngine`, `mapWebSpeechError(code: string): SpeechError | null`.

- [x] **Step 1: Write the failing test**

Create `src/test/web-speech-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebSpeechEngine, mapWebSpeechError } from "../src/screens/web-speech-engine";

class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = ""; continuous = false; interimResults = false;
  started = 0; stopped = 0;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.last = this; }
  start() { this.started += 1; }
  stop() { this.stopped += 1; }
  abort() { this.stopped += 1; }
}

const res = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
const win = (extra: Record<string, unknown> = {}) =>
  ({ SpeechRecognition: FakeRecognition, isSecureContext: true, ...extra }) as unknown as Window;

beforeEach(() => { FakeRecognition.last = undefined; });

describe("mapWebSpeechError", () => {
  it("memetakan kode Web Speech", () => {
    expect(mapWebSpeechError("not-allowed")).toBe("not-allowed");
    expect(mapWebSpeechError("service-not-allowed")).toBe("not-allowed");
    expect(mapWebSpeechError("no-speech")).toBe("no-speech");
    expect(mapWebSpeechError("network")).toBe("network");
    expect(mapWebSpeechError("audio-capture")).toBe("other");
    expect(mapWebSpeechError("language-not-supported")).toBe("other");
  });
  it("aborted (kita sendiri yang berhenti) bukan galat", () => {
    expect(mapWebSpeechError("aborted")).toBeNull();
  });
});

describe("createWebSpeechEngine", () => {
  it("supported=false bila tak ada SpeechRecognition", () => {
    expect(createWebSpeechEngine({} as unknown as Window).supported).toBe(false);
  });
  it("memakai webkitSpeechRecognition bila yang standar tak ada", () => {
    const w = { webkitSpeechRecognition: FakeRecognition, isSecureContext: true } as unknown as Window;
    expect(createWebSpeechEngine(w).supported).toBe(true);
  });
  it("start menyetel bahasa, continuous, interimResults, lalu memulai", () => {
    const e = createWebSpeechEngine(win());
    e.start("id-ID");
    const r = FakeRecognition.last!;
    expect(r.lang).toBe("id-ID");
    expect(r.continuous).toBe(true);
    expect(r.interimResults).toBe(true);
    expect(r.started).toBe(1);
  });
  it("stop memanggil stop() recognition", () => {
    const e = createWebSpeechEngine(win());
    e.start("id-ID");
    e.stop();
    expect(FakeRecognition.last!.stopped).toBe(1);
  });
  it("memisahkan interim dan final dari satu event", () => {
    const e = createWebSpeechEngine(win());
    const onFinal = vi.fn(); const onInterim = vi.fn();
    e.onFinal(onFinal); e.onInterim(onInterim);
    e.start("id-ID");
    FakeRecognition.last!.onresult!({
      resultIndex: 0,
      results: [res("halo dunia", true), res("apa kab", false)],
    });
    expect(onFinal).toHaveBeenCalledWith("halo dunia");
    expect(onInterim).toHaveBeenLastCalledWith("apa kab");
  });
  it("hanya memproses hasil sejak resultIndex (final lama tak diulang)", () => {
    const e = createWebSpeechEngine(win());
    const onFinal = vi.fn();
    e.onFinal(onFinal);
    e.start("id-ID");
    FakeRecognition.last!.onresult!({
      resultIndex: 1,
      results: [res("sudah dikirim", true), res("baru", true)],
    });
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith("baru");
  });
  it("event tanpa interim mengosongkan pratinjau", () => {
    const e = createWebSpeechEngine(win());
    const onInterim = vi.fn();
    e.onInterim(onInterim);
    e.start("id-ID");
    FakeRecognition.last!.onresult!({ resultIndex: 0, results: [res("selesai", true)] });
    expect(onInterim).toHaveBeenLastCalledWith("");
  });
  it("meneruskan galat terpetakan, mengabaikan aborted", () => {
    const e = createWebSpeechEngine(win());
    const onError = vi.fn();
    e.onError(onError);
    e.start("id-ID");
    FakeRecognition.last!.onerror!({ error: "aborted" });
    expect(onError).not.toHaveBeenCalled();
    FakeRecognition.last!.onerror!({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith("not-allowed");
  });
  it("onend diteruskan dan recognition boleh dibuat ulang di start berikutnya", () => {
    const e = createWebSpeechEngine(win());
    const onEnd = vi.fn();
    e.onEnd(onEnd);
    e.start("id-ID");
    const first = FakeRecognition.last!;
    first.onend!();
    expect(onEnd).toHaveBeenCalledTimes(1);
    e.start("en-US");
    expect(FakeRecognition.last).not.toBe(first);
    expect(FakeRecognition.last!.lang).toBe("en-US");
  });
  it("konteks tak aman → insecure-context + end, tanpa memulai recognition", () => {
    const e = createWebSpeechEngine(win({ isSecureContext: false }));
    const onError = vi.fn(); const onEnd = vi.fn();
    e.onError(onError); e.onEnd(onEnd);
    e.start("id-ID");
    expect(onError).toHaveBeenCalledWith("insecure-context");
    expect(onEnd).toHaveBeenCalled();
    expect(FakeRecognition.last).toBeUndefined();
  });
  it("tak didukung → start melapor unsupported + end", () => {
    const e = createWebSpeechEngine({} as unknown as Window);
    const onError = vi.fn(); const onEnd = vi.fn();
    e.onError(onError); e.onEnd(onEnd);
    e.start("id-ID");
    expect(onError).toHaveBeenCalledWith("unsupported");
    expect(onEnd).toHaveBeenCalled();
  });
  it("recognition.start() melempar → other + end", () => {
    class Boom extends FakeRecognition { start() { throw new Error("InvalidStateError"); } }
    const e = createWebSpeechEngine({ SpeechRecognition: Boom, isSecureContext: true } as unknown as Window);
    const onError = vi.fn(); const onEnd = vi.fn();
    e.onError(onError); e.onEnd(onEnd);
    e.start("id-ID");
    expect(onError).toHaveBeenCalledWith("other");
    expect(onEnd).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/web-speech-engine.test.ts`
Expected: FAIL — "Failed to resolve import ../src/screens/web-speech-engine".

- [x] **Step 3: Write minimal implementation**

Create `src/src/screens/web-speech-engine.ts`:

```ts
import type { SpeechEngine, SpeechError } from "./speech-engine";

// Adaptor `SpeechRecognition` (Web Speech API) → `SpeechEngine`. Catatan privasi: di Chrome/Edge
// audio diproses server penyedia browser (ADR-0177).

type Alt = { transcript: string };
type Result = { isFinal: boolean; 0: Alt };
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

/** `null` = bukan galat (mis. `aborted`: kita sendiri yang menghentikan). */
export function mapWebSpeechError(code: string): SpeechError | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return "not-allowed";
    case "no-speech": return "no-speech";
    case "network": return "network";
    case "aborted": return null;
    default: return "other";
  }
}

export function createWebSpeechEngine(win: Window = window): SpeechEngine {
  const w = win as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor; isSecureContext?: boolean };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  let rec: Recognition | null = null;
  let cbInterim: (t: string) => void = () => {};
  let cbFinal: (t: string) => void = () => {};
  let cbError: (e: SpeechError) => void = () => {};
  let cbEnd: () => void = () => {};

  const fail = (e: SpeechError) => { cbError(e); cbEnd(); };

  return {
    supported: Ctor !== undefined,
    start(lang) {
      if (!Ctor) return fail("unsupported");
      // `=== false`, bukan `!`: jsdom/browser lama tak punya properti ini dan tak boleh dianggap tak aman.
      if (w.isSecureContext === false) return fail("insecure-context");
      if (rec) return; // sudah merekam; hook yang menjaga toggle
      const r = new Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const item = e.results[i]!;
          if (item.isFinal) cbFinal(item[0].transcript);
          else interim += item[0].transcript;
        }
        cbInterim(interim);
      };
      r.onerror = (e) => { const m = mapWebSpeechError(e.error); if (m) cbError(m); };
      r.onend = () => { rec = null; cbEnd(); };
      rec = r;
      try { r.start(); } catch { rec = null; fail("other"); }
    },
    stop() { rec?.stop(); },
    onInterim(cb) { cbInterim = cb; },
    onFinal(cb) { cbFinal = cb; },
    onError(cb) { cbError = cb; },
    onEnd(cb) { cbEnd = cb; },
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/web-speech-engine.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/web-speech-engine.ts src/test/web-speech-engine.test.ts docs/superpowers/plans/2026-10-05-voice-input.md
git commit -m "feat(voice): adaptor Web Speech API untuk SpeechEngine

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hook `useVoiceInput` + `VoiceControls`

**Files:**
- Create: `src/src/screens/use-voice-input.ts`, `src/src/screens/VoiceControls.tsx`
- Test: `src/test/voice-controls.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`SpeechEngine`, `voiceReducer`, `initialVoiceState`, `readLang`, `writeLang`, `LANGS`, `ERROR_MESSAGES`), Task 2 (`createWebSpeechEngine`). `IconButton` dari `../ds/components/forms` (props: `icon`, `label`, `variant`, `size`, sisanya diteruskan ke `<button>`), `Icon` dari `../ds/icon`.
- Produces:
  - `useVoiceInput(opts: { onFinalText: (t: string) => void; enabled?: boolean; engine?: SpeechEngine }): VoiceInput` dengan `VoiceInput = { supported: boolean; status: "idle" | "listening"; interim: string; error: SpeechError | null; lang: string; setLang: (l: string) => void; toggle: () => void }`
  - `type VoiceInput = ReturnType<typeof useVoiceInput>`
  - `VoiceControls({ voice }: { voice: VoiceInput }): JSX.Element | null`
  - data-testid: `terminal-voice` (wadah), `voice-toggle`, `voice-lang`, `voice-interim`, `voice-error`.

- [x] **Step 1: Write the failing test**

Create `src/test/voice-controls.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControls } from "../src/screens/VoiceControls";
import { useVoiceInput } from "../src/screens/use-voice-input";
import type { SpeechEngine, SpeechError } from "../src/screens/speech-engine";

function fakeEngine(supported = true) {
  const cb = {
    interim: (_: string) => {}, final: (_: string) => {},
    error: (_: SpeechError) => {}, end: () => {},
  };
  const engine: SpeechEngine & { starts: string[]; stops: number } = {
    supported, starts: [], stops: 0,
    start(lang) { engine.starts.push(lang); },
    stop() { engine.stops += 1; },
    onInterim(f) { cb.interim = f; }, onFinal(f) { cb.final = f; },
    onError(f) { cb.error = f; }, onEnd(f) { cb.end = f; },
  };
  return { engine, cb };
}

function Harness({ engine, onFinalText, enabled = true }: {
  engine: SpeechEngine; onFinalText: (t: string) => void; enabled?: boolean;
}) {
  const voice = useVoiceInput({ engine, onFinalText, enabled });
  return <VoiceControls voice={voice} />;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("VoiceControls", () => {
  it("tak merender apa pun bila engine tak didukung", () => {
    const { engine } = fakeEngine(false);
    render(<Harness engine={engine} onFinalText={() => {}} />);
    expect(screen.queryByTestId("terminal-voice")).toBeNull();
  });

  it("tak merender apa pun bila enabled=false (pane baca-saja)", () => {
    const { engine } = fakeEngine(true);
    render(<Harness engine={engine} onFinalText={() => {}} enabled={false} />);
    expect(screen.queryByTestId("terminal-voice")).toBeNull();
  });

  it("toggle: klik pertama start dengan id-ID, klik kedua stop", () => {
    const { engine } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    const btn = screen.getByTestId("voice-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(engine.starts).toEqual(["id-ID"]);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(engine.stops).toBe(1);
  });

  it("status baru kembali idle saat engine melapor end, bukan saat stop()", () => {
    const { engine, cb } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    const btn = screen.getByTestId("voice-toggle");
    fireEvent.click(btn);
    fireEvent.click(btn); // stop
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    act(() => cb.end());
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("final → onFinalText dipanggil; interim → pratinjau saja, tidak memanggil onFinalText", () => {
    const { engine, cb } = fakeEngine();
    const onFinalText = vi.fn();
    render(<Harness engine={engine} onFinalText={onFinalText} />);
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => cb.interim("halo du"));
    expect(screen.getByTestId("voice-interim").textContent).toBe("halo du");
    expect(onFinalText).not.toHaveBeenCalled();
    act(() => cb.final("halo dunia"));
    expect(onFinalText).toHaveBeenCalledWith("halo dunia");
    expect(screen.queryByTestId("voice-interim")).toBeNull();
  });

  it("galat tampil lalu idle; tampil pesan; hilang otomatis setelah 6 dtk", () => {
    vi.useFakeTimers();
    const { engine, cb } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => { cb.error("not-allowed"); cb.end(); });
    expect(screen.getByTestId("voice-error").textContent).toContain("Izin mikrofon ditolak");
    expect(screen.getByTestId("voice-toggle").getAttribute("aria-pressed")).toBe("false");
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByTestId("voice-error")).toBeNull();
  });

  it("memulai lagi menghapus galat sebelumnya", () => {
    const { engine, cb } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => { cb.error("no-speech"); cb.end(); });
    expect(screen.getByTestId("voice-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-toggle"));
    expect(screen.queryByTestId("voice-error")).toBeNull();
  });

  it("bahasa: default id-ID, ganti ke en-US dipakai start berikutnya dan disimpan", () => {
    const { engine } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    const sel = screen.getByTestId("voice-lang") as HTMLSelectElement;
    expect(sel.value).toBe("id-ID");
    fireEvent.change(sel, { target: { value: "en-US" } });
    expect(localStorage.getItem("hanoman.voice.lang")).toBe("en-US");
    fireEvent.click(screen.getByTestId("voice-toggle"));
    expect(engine.starts).toEqual(["en-US"]);
  });

  it("unmount memanggil stop() pada engine", () => {
    const { engine } = fakeEngine();
    const { unmount } = render(<Harness engine={engine} onFinalText={() => {}} />);
    unmount();
    expect(engine.stops).toBe(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/voice-controls.test.tsx`
Expected: FAIL — "Failed to resolve import ../src/screens/VoiceControls".

- [x] **Step 3: Write minimal implementation**

Create `src/src/screens/use-voice-input.ts`:

```ts
import React from "react";
import {
  initialVoiceState, readLang, voiceReducer, writeLang, type SpeechEngine,
} from "./speech-engine";
import { createWebSpeechEngine } from "./web-speech-engine";

const ERROR_TTL_MS = 6000;

export function useVoiceInput({ onFinalText, enabled = true, engine }: {
  /** Dipanggil untuk tiap potongan teks FINAL. Interim tak pernah lewat sini. */
  onFinalText: (text: string) => void;
  enabled?: boolean;
  /** Hanya untuk tes / engine lain; default Web Speech. */
  engine?: SpeechEngine;
}) {
  // Satu engine per pane. Dibuat sekali: `engine` dari luar dianggap stabil.
  const eng = React.useMemo(() => engine ?? createWebSpeechEngine(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, dispatch] = React.useReducer(voiceReducer, initialVoiceState);
  const [lang, setLangState] = React.useState(readLang);
  const finalRef = React.useRef(onFinalText);
  finalRef.current = onFinalText;

  React.useEffect(() => {
    eng.onInterim((text) => dispatch({ type: "interim", text }));
    eng.onFinal((text) => { finalRef.current(text); dispatch({ type: "final" }); });
    eng.onError((error) => dispatch({ type: "error", error }));
    eng.onEnd(() => dispatch({ type: "end" }));
    // Pane ditutup / sesi berpindah: mic tak boleh tertinggal menyala.
    return () => { eng.stop(); };
  }, [eng]);

  React.useEffect(() => {
    if (!state.error) return;
    const t = setTimeout(() => dispatch({ type: "dismiss" }), ERROR_TTL_MS);
    return () => clearTimeout(t);
  }, [state.error]);

  const toggle = () => {
    if (!enabled) return;
    if (state.status === "listening") { eng.stop(); return; }
    dispatch({ type: "start" });
    eng.start(lang);
  };
  const setLang = (l: string) => { writeLang(l); setLangState(l); };

  return {
    supported: enabled && eng.supported,
    status: state.status, interim: state.interim, error: state.error,
    lang, setLang, toggle,
  };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;
```

Create `src/src/screens/VoiceControls.tsx`:

```tsx
import React from "react";
import { Icon } from "../ds/icon";
import { IconButton } from "../ds/components/forms";
import { ERROR_MESSAGES, LANGS } from "./speech-engine";
import type { VoiceInput } from "./use-voice-input";

// Presentasional: seluruh keadaan ada di `useVoiceInput`. Tak merender apa pun bila engine tak
// didukung / pane baca-saja, supaya browser tanpa Web Speech tak melihat tombol mati.
export function VoiceControls({ voice }: { voice: VoiceInput }) {
  if (!voice.supported) return null;
  const listening = voice.status === "listening";
  return (
    <div className="hn-terminal-voice" data-testid="terminal-voice">
      <IconButton icon="mic" size="sm" variant={listening ? "solid" : "outline"}
        label={listening ? "Hentikan dikte suara" : "Mulai dikte suara"}
        aria-pressed={listening} data-testid="voice-toggle"
        className={listening ? "hn-voice-rec" : ""} onClick={voice.toggle} />
      <select className="hn-terminal-voice-lang" data-testid="voice-lang" aria-label="Bahasa dikte"
        value={voice.lang} onChange={(e) => voice.setLang(e.target.value)}>
        {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      <span className="hn-terminal-voice-hint" role="img" aria-label="Audio diproses oleh layanan browser Anda"
        title="Audio diproses oleh layanan suara browser Anda (di Chrome: Google).">
        <Icon name="info" size={14} />
      </span>
      {listening && voice.interim && (
        <span className="hn-terminal-voice-interim" data-testid="voice-interim">{voice.interim}</span>
      )}
      {voice.error && (
        <span className="hn-terminal-voice-error" role="status" data-testid="voice-error">
          {ERROR_MESSAGES[voice.error]}
        </span>
      )}
    </div>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/voice-controls.test.tsx`
Expected: PASS. (Peringatan dev `Icon: nama "mic"/"info" tak dikenal` dapat muncul sampai Task 5 menjalankan `gen:icons`; itu bukan kegagalan.)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/use-voice-input.ts src/src/screens/VoiceControls.tsx src/test/voice-controls.test.tsx docs/superpowers/plans/2026-10-05-voice-input.md
git commit -m "feat(voice): hook useVoiceInput dan VoiceControls (toggle, bahasa, galat)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `TerminalComposer` menerima teks suara

**Files:**
- Modify: `src/src/screens/TerminalComposer.tsx`
- Test: `src/test/terminal-composer-voice.test.tsx`

**Interfaces:**
- Consumes: `appendFinal` (Task 1); `C.DEBOUNCE_MS` dari `./terminal-composer`.
- Produces: props baru opsional pada `TerminalComposer`:
  - `voiceAppend?: React.MutableRefObject<(text: string) => void>` — diisi komponen; memanggilnya menambahkan teks final ke kolom lewat jalur `change` yang sama dengan ketikan (jadi debounce/delta composer yang ada berlaku).
  - `onDraft?: (nonEmpty: boolean) => void` — dipanggil tiap `text` berubah; `true` bila kolom berisi.

- [x] **Step 1: Write the failing test**

Create `src/test/terminal-composer-voice.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalComposer } from "../src/screens/TerminalComposer";
import { DEBOUNCE_MS } from "../src/screens/terminal-composer";

const Q = { n: 0, held: false };
function setup(extra: { onDraft?: (b: boolean) => void } = {}) {
  const send = vi.fn();
  const external = { current: () => {} };
  const voiceAppend = { current: (_: string) => {} };
  render(<TerminalComposer sessionId="s1" send={send} external={external} linkState="open"
    queue={Q} voiceAppend={voiceAppend} {...extra} />);
  const input = () => screen.getByTestId("terminal-composer") as HTMLInputElement;
  return { send, voiceAppend, input };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TerminalComposer · teks suara", () => {
  it("voiceAppend menambahkan teks final ke kolom", () => {
    const { voiceAppend, input } = setup();
    act(() => voiceAppend.current("halo dunia"));
    expect(input().value).toBe("halo dunia");
    act(() => voiceAppend.current("apa kabar"));
    expect(input().value).toBe("halo dunia apa kabar");
  });

  it("menyambung ke teks yang sudah diketik operator", () => {
    const { voiceAppend, input } = setup();
    fireEvent.change(input(), { target: { value: "jalankan" } });
    act(() => voiceAppend.current("pnpm test"));
    expect(input().value).toBe("jalankan pnpm test");
  });

  it("mengalir ke pty lewat debounce yang ada, sebagai delta, TANPA \\r", () => {
    const { voiceAppend, send } = setup();
    act(() => voiceAppend.current("halo"));
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(send).toHaveBeenCalledWith("halo");
    for (const call of send.mock.calls) expect(call[0]).not.toContain("\r");
  });

  it("teks kosong dari suara tak mengubah kolom", () => {
    const { voiceAppend, input } = setup();
    act(() => voiceAppend.current("  "));
    expect(input().value).toBe("");
  });

  it("onDraft: true saat kolom berisi, false saat Enter mengosongkannya", () => {
    const onDraft = vi.fn();
    const { voiceAppend, input } = setup({ onDraft });
    expect(onDraft).toHaveBeenLastCalledWith(false);
    act(() => voiceAppend.current("halo"));
    expect(onDraft).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onDraft).toHaveBeenLastCalledWith(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-composer-voice.test.tsx`
Expected: FAIL — `voiceAppend.current("halo dunia")` tidak mengubah kolom (nilai tetap `""`).

- [x] **Step 3: Write minimal implementation**

Edit `src/src/screens/TerminalComposer.tsx`.

Tambah import di bawah `import * as C from "./terminal-composer";`:

```tsx
import { appendFinal } from "./speech-engine";
```

Ganti tanda tangan props (tambahkan dua prop opsional):

```tsx
export function TerminalComposer({ sessionId, send, external, linkState, queue, voiceAppend, onDraft }: {
  sessionId: string;
  /** Pintu keluar byte SPEC-878 milik pane (`sendKey.current`). */
  send: (d: string) => void;
  /** Diisi komponen ini; dipanggil pane saat byte lahir DI LUAR kolom. */
  external: React.MutableRefObject<() => void>;
  linkState: string;
  queue: { n: number; held: boolean };
  /** Dikte suara: diisi komponen ini; memanggilnya menambahkan teks FINAL ke kolom lewat jalur
   *  `change` yang sama dengan ketikan (debounce/delta tak berubah, dan tak pernah mengirim `\r`). */
  voiceAppend?: React.MutableRefObject<(text: string) => void>;
  /** Dipanggil tiap isi kolom berubah: `true` bila berisi. Pane memakainya untuk menyembunyikan
   *  kolom (di desktop) begitu mic berhenti dan kolom kosong. */
  onDraft?: (nonEmpty: boolean) => void;
}) {
```

Tepat setelah deklarasi `const submit = () => {...};` tambahkan:

```tsx
  // Sama alasannya dengan `external`: dipasang saat render agar selalu menunjuk teks terbaru.
  if (voiceAppend) voiceAppend.current = (t) => change(appendFinal(state.current.text, t));
  React.useEffect(() => () => { if (voiceAppend) voiceAppend.current = () => {}; }, [voiceAppend]);
  const onDraftRef = React.useRef(onDraft);
  onDraftRef.current = onDraft;
  React.useEffect(() => { onDraftRef.current?.(text !== ""); }, [text]);
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-composer-voice.test.tsx src/test/terminal-composer.test.ts`
Expected: PASS (tes composer lama tetap hijau).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TerminalComposer.tsx src/test/terminal-composer-voice.test.tsx docs/superpowers/plans/2026-10-05-voice-input.md
git commit -m "feat(voice): composer menerima teks suara lewat voiceAppend/onDraft

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rangkai ke `TerminalPane` + CSS + ikon

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx` (impor; ref/hook dekat `sendOuter` ≈ baris 127; effect fit ≈ baris 773–783; render ≈ baris 838)
- Modify: `src/src/app.css` (tambah di dekat `.hn-terminal-composer-status--held`, ≈ baris 636)
- Regenerate: `src/src/ds/icon-registry.ts`
- Test: `src/test/terminal-pane.test.tsx` (describe baru di akhir berkas)

**Interfaces:**
- Consumes: `useVoiceInput`/`VoiceInput` (Task 3), `VoiceControls` (Task 3), `TerminalComposer` props `voiceAppend`/`onDraft` (Task 4).
- Produces: pane merender `terminal-voice` (bila didukung & `canWrite`) di antara host terminal dan composer; composer tampil bila `canWrite && (showKeys || voice.status === "listening" || draft)`.

- [x] **Step 1: Write the failing test**

Di akhir `src/test/terminal-pane.test.tsx` tambahkan describe berikut. Ia memakai mock `xterm`, `sockets`, dan `inputsOf` yang sudah ada di berkas itu (lihat describe "kolom ketik perangkat sentuh (SPEC-882)" untuk pola `openPane`). `cleanup`/`beforeEach` global berkas itu sudah mengurus `sockets`.

```tsx
describe("TerminalPane · dikte suara", () => {
  class FakeRecognition {
    static last: FakeRecognition | undefined;
    lang = ""; continuous = false; interimResults = false; started = 0;
    onresult: ((e: any) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() { FakeRecognition.last = this; }
    start() { this.started += 1; }
    stop() { /* end dipicu manual oleh tes */ }
    abort() { }
  }
  const result = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
  const w = window as unknown as Record<string, unknown>;

  const openPane = async (props: Record<string, unknown> = {}) => {
    const r = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} {...props} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]!.onopen?.(); });
    return r;
  };
  const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

  afterEach(() => { delete w.SpeechRecognition; FakeRecognition.last = undefined; });

  it("tanpa dukungan Web Speech: tak ada DOM suara sama sekali", async () => {
    await openPane();
    expect(screen.queryByTestId("terminal-voice")).toBeNull();
  });

  it("pane remote tanpa sessions:write (baca-saja): tak ada mic", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane({ mode: "remote" });
    expect(screen.queryByTestId("terminal-voice")).toBeNull();
  });

  it("didukung: mic tampil walau showKeys mati, composer belum tampil", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane();
    expect(screen.getByTestId("voice-toggle")).not.toBeNull();
    expect(screen.queryByTestId("terminal-composer")).toBeNull();
  });

  it("klik mic memunculkan composer; teks final masuk composer dan mengalir ke pty TANPA \\r", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane();
    const before = inputsOf(sockets[0]).length;
    fireEvent.click(screen.getByTestId("voice-toggle"));
    expect(FakeRecognition.last!.lang).toBe("id-ID");
    const input = screen.getByTestId("terminal-composer") as HTMLInputElement;
    act(() => { FakeRecognition.last!.onresult!({ resultIndex: 0, results: [result("jalankan tes", true)] }); });
    expect(input.value).toBe("jalankan tes");
    await wait(400);
    expect(inputsOf(sockets[0]).slice(before)).toEqual(["jalankan tes"]);
  });

  it("interim hanya pratinjau: tak mengubah composer dan tak mengirim apa pun ke pty", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane();
    const before = inputsOf(sockets[0]).length;
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => { FakeRecognition.last!.onresult!({ resultIndex: 0, results: [result("jalan", false)] }); });
    expect(screen.getByTestId("voice-interim").textContent).toBe("jalan");
    expect((screen.getByTestId("terminal-composer") as HTMLInputElement).value).toBe("");
    await wait(400);
    expect(inputsOf(sockets[0]).slice(before)).toEqual([]);
  });

  it("desktop: composer kembali tersembunyi saat mic berhenti dan kolom kosong", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane();
    fireEvent.click(screen.getByTestId("voice-toggle"));
    expect(screen.getByTestId("terminal-composer")).not.toBeNull();
    act(() => { FakeRecognition.last!.onend!(); });
    expect(screen.queryByTestId("terminal-composer")).toBeNull();
  });

  it("composer yang berisi tetap tampil sesudah mic berhenti", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane();
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => { FakeRecognition.last!.onresult!({ resultIndex: 0, results: [result("belum dikirim", true)] }); });
    act(() => { FakeRecognition.last!.onend!(); });
    expect((screen.getByTestId("terminal-composer") as HTMLInputElement).value).toBe("belum dikirim");
  });

  it("urutan DOM: host terminal < kontrol suara < composer", async () => {
    w.SpeechRecognition = FakeRecognition;
    await openPane({ showKeys: true });
    const at = (sel: string) => Array.from(document.querySelectorAll("*")).indexOf(document.querySelector(sel)!);
    expect(at('[data-testid="terminal-host"]')).toBeLessThan(at('[data-testid="terminal-voice"]'));
    expect(at('[data-testid="terminal-voice"]')).toBeLessThan(at(".hn-terminal-composer"));
  });

  it("unmount pane menghentikan mic", async () => {
    w.SpeechRecognition = FakeRecognition;
    const stop = vi.spyOn(FakeRecognition.prototype, "stop");
    const r = await openPane();
    fireEvent.click(screen.getByTestId("voice-toggle"));
    r.unmount();
    expect(stop).toHaveBeenCalled();
    stop.mockRestore();
  });
});
```

Catatan untuk implementer: pastikan `afterEach` dan `fireEvent` sudah diimpor di berkas itu (keduanya sudah: lihat baris 1–2). Bila `mode: "remote"` butuh `InstanceContext` khusus di berkas itu, ikuti pola di `terminal-pane-remote.test.tsx` untuk membuat pane baca-saja; tujuan tes: `canWrite=false` ⇒ tak ada `terminal-voice`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run src/test/terminal-pane.test.tsx -t "dikte suara"`
Expected: FAIL — `voice-toggle` tidak ditemukan.

- [x] **Step 3: Write minimal implementation**

3a. `src/src/screens/TerminalPane.tsx` — tambah impor di samping `import { TerminalComposer } from "./TerminalComposer";`:

```tsx
import { VoiceControls } from "./VoiceControls";
import { useVoiceInput } from "./use-voice-input";
```

3b. Tepat setelah deklarasi `const sendOuter = React.useRef<(d: string) => void>(() => {});` tambahkan:

```tsx
  // Dikte suara (spec 2026-10-05): teks FINAL ditambahkan ke composer lewat `voiceAppend`, interim
  // hanya pratinjau di `VoiceControls`. `draft` = composer berisi → tetap tampil di desktop walau mic
  // sudah berhenti, supaya teks yang belum dikirim tak hilang bersama komponennya.
  const voiceAppend = React.useRef<(t: string) => void>(() => {});
  const [draft, setDraft] = React.useState(false);
  const voice = useVoiceInput({ enabled: canWrite, onFinalText: (t) => voiceAppend.current(t) });
  const showComposer = canWrite && (showKeys || voice.status === "listening" || draft);
```

3c. Ganti effect fit (≈ baris 773–783) — hanya array dependensinya, dan komentar:

```tsx
  }, [showKeys, mode, showComposer, voice.supported]);
```
(Baris `}, [showKeys, mode]);` yang ada diganti dengan baris di atas. Baris kontrol suara dan composer memakan tinggi host sama seperti papan tombol, jadi frame `resize` wajib menyusul.)

3d. Ganti dua baris render composer/keys di akhir `return`:

```tsx
      <VoiceControls voice={voice} />
      {showComposer && <TerminalComposer sessionId={sessionId} send={(d) => sendKey.current(d)}
        external={composerDrain} linkState={link.state} queue={queue}
        voiceAppend={voiceAppend} onDraft={setDraft} />}
      {showKeys && canWrite && <TerminalKeys onKey={(seq) => sendOuter.current(seq)} />}
```

3e. `src/src/app.css` — sisipkan setelah baris `.hn-terminal-composer-status--held { ... }`:

```css
/* Dikte suara: satu baris kecil di atas composer. Pratinjau interim sengaja abu-abu & miring —
   ia BELUM masuk composer/pty. */
.hn-terminal-voice {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  border-top: 1px solid var(--border-hair);
}
.hn-terminal-voice-lang {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 6px;
  border: 1px solid var(--border-hair);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-body);
  font: var(--text-xs)/1.2 var(--font-mono);
}
.hn-terminal-voice-hint { display: inline-flex; color: var(--text-subtle); cursor: help; }
.hn-terminal-voice-interim {
  flex: 1 1 120px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: italic var(--text-xs)/1.2 var(--font-mono);
  color: var(--text-subtle);
}
.hn-terminal-voice-error { font: var(--text-xs)/1.2 var(--font-mono); color: var(--status-err); }
.hn-voice-rec { animation: hn-voice-pulse 1.2s ease-in-out infinite; }
@keyframes hn-voice-pulse { 50% { box-shadow: 0 0 0 4px var(--status-err-tint); } }
@media (prefers-reduced-motion: reduce) { .hn-voice-rec { animation: none; } }
```

3f. Daftarkan ikon `mic` dan `info` ke registry (dibangkitkan dari literal di sumber; `VoiceControls.tsx` sudah memuat literal-nya):

Run: `pnpm --filter ./src gen:icons`
Expected: `src/src/ds/icon-registry.ts` berubah, memuat `Mic` dan `Info`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest --run src/test/terminal-pane.test.tsx src/test/terminal-composer-voice.test.tsx src/test/voice-controls.test.tsx src/test/icon-registry.test.ts`
Expected: PASS. Seluruh tes `terminal-pane.test.tsx` lama tetap hijau (jsdom tanpa `SpeechRecognition` ⇒ `VoiceControls` null ⇒ DOM lama tak berubah).

Lalu typecheck sebatas berkas tersentuh: `pnpm --filter ./src exec tsc --noEmit` (bila lambat, cukup pastikan editor/`vitest` tak melaporkan galat tipe).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/src/app.css src/src/ds/icon-registry.ts src/test/terminal-pane.test.tsx docs/superpowers/plans/2026-10-05-voice-input.md
git commit -m "feat(voice): mic dikte di pane terminal, hasil final ke composer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs (ADR-0177, frontend-implementation, README) + verifikasi manual

**Files:**
- Create: `internal/docs/adr/0177-dikte-suara-seam-speech-engine.md`
- Modify: `internal/docs/frontend/frontend-implementation.md` (tambah bullet Terminal di daftar "Bagian", dan satu paragraf di bawah daftar itu)
- Modify: `internal/docs/README.md` (tautan ADR-0177 + spec + plan; ikuti format entri sekitar)

**Interfaces:** tidak ada kode; docs harus konsisten dengan nama di Task 1–5 (`SpeechEngine`, `useVoiceInput`, `VoiceControls`, `voiceAppend`, kunci `hanoman.voice.lang`).

- [ ] **Step 1: Tulis ADR**

Create `internal/docs/adr/0177-dikte-suara-seam-speech-engine.md`:

```markdown
# ADR-0177 — Dikte suara di terminal sesi: seam `SpeechEngine`, Web Speech dulu

- Status: Accepted
- Tanggal: 2026-10-05
- Spec: [2026-10-05-voice-input-design](../../../docs/superpowers/specs/2026-10-05-voice-input-design.md)

## Konteks

Operator mengetik prompt panjang ke `claude` di terminal sesi terus-menerus. Dibutuhkan input suara
(speech-to-text) di pane sesi aktif: klik mic, bicara, teks masuk ke composer.

## Keputusan

- **Seam `SpeechEngine`** (`src/src/screens/speech-engine.ts`): `start/stop` + `onInterim/onFinal/onError/onEnd`.
  UI (`useVoiceInput`, `VoiceControls`) hanya mengenal antarmuka ini.
- **MVP = Web Speech API** (`web-speech-engine.ts`): nol server, nol biaya, nol dependensi paket. Jalur
  **Whisper** (server/lokal) menyusul sebagai implementasi kedua tanpa mengubah UI; pemilihan engine lewat
  `Setting` server akan butuh migration + ADR sendiri dan **tidak** termasuk keputusan ini.
- **Teks masuk composer, tanpa Enter otomatis.** Sesi berjalan `--dangerously-skip-permissions` (ADR-0037):
  salah dengar tak boleh langsung dieksekusi. Composer mengirim delta ke baris prompt pty (tanpa `\r`),
  sehingga teks tampak di prompt `claude`, Enter tetap milik operator.
- **Hanya hasil final yang masuk composer.** Interim berubah-ubah dan composer mengirim delta berbasis
  backspace; mengirim interim akan mengacak baris pty. Interim hanya pratinjau di `VoiceControls`.
- **Toggle**, bahasa default `id-ID`, disimpan per perangkat di `localStorage` (`hanoman.voice.lang`).
- Status mic kembali idle saat engine melapor `end`, bukan saat `stop()`: potongan final terakhir bisa
  tiba sesudah `stop()`.

## Konsekuensi

- **Privasi:** di Chrome/Edge, Web Speech mengirim audio ke server penyedia browser (Google/Microsoft).
  Satu-satunya jalur data keluar baru; dicatat di tooltip tombol. Whisper lokal kelak menjadi opsi tanpa
  data keluar.
- Browser tanpa Web Speech (mis. Firefox): tombol tidak dirender. Konteks bukan HTTPS/localhost: pesan galat.
- Kualitas istilah teknis berbahasa Inggris di tengah kalimat Indonesia terbatas (satu bahasa per rekaman).
- Tanpa perubahan skema/API; tanpa migration.
```

- [ ] **Step 2: Perbarui `frontend-implementation.md`**

Pada bullet "Bagian: …" kalimat **Terminal (sesi Claude Code interaktif di tmux)** biarkan; tambahkan paragraf baru **tepat sebelum** bullet `- **Klien** (SPEC-919 …`:

```markdown
- **Dikte suara** ([ADR-0177](../adr/0177-dikte-suara-seam-speech-engine.md)) — `TerminalPane` menampilkan baris
  `VoiceControls` (tombol mic toggle, pemilih bahasa `id-ID`/`en-US`, pratinjau interim, pesan galat) di antara
  host terminal dan composer, hanya bila `canWrite` dan browser mendukung Web Speech. Teks **final** ditambahkan ke
  `TerminalComposer` lewat `voiceAppend` (alur debounce/delta composer yang ada; tak pernah mengirim `\r`); interim
  hanya pratinjau. Di desktop composer ikut tampil selama mic aktif dan selama berisi. Bahasa tersimpan di
  `localStorage` `hanoman.voice.lang`. Engine ditukar lewat antarmuka `SpeechEngine` (jalur Whisper menyusul).
```

- [ ] **Step 3: Tautkan di `internal/docs/README.md`**

Tambahkan satu entri (di antara entri ADR/rancangan terbaru, format sama seperti entri sekitar) :

```markdown
- [rancangan dikte suara terminal](../../docs/superpowers/specs/2026-10-05-voice-input-design.md) — mic toggle di pane sesi memakai Web Speech API lewat seam `SpeechEngine`; teks final masuk composer tanpa Enter otomatis, interim hanya pratinjau, bahasa default `id-ID`; jalur Whisper menyusul. [ADR-0177](adr/0177-dikte-suara-seam-speech-engine.md) · [plan](../../docs/superpowers/plans/2026-10-05-voice-input.md)
```

- [ ] **Step 4: Verifikasi manual di browser nyata (Chrome)**

Boot: `pnpm dev`, buka dashboard (localhost), buka Terminal, pilih sesi hidup.
Periksa, dan catat hasilnya di PR:
1. Mic tampil di baris di atas composer; klik → indikator berdenyut, composer muncul (desktop), browser meminta izin mikrofon.
2. Ucapkan kalimat `id-ID`: pratinjau abu-abu berubah selagi bicara; saat jeda kalimat final masuk composer dan tampil di prompt `claude`; **tidak** ada Enter otomatis.
3. Klik mic lagi → kembali idle; composer berisi tetap tampil, composer kosong menghilang.
4. Ganti bahasa ke English, ucapkan kalimat Inggris, muat ulang halaman: pilihan bahasa tetap.
5. Tolak izin mikrofon → pesan "Izin mikrofon ditolak…" lalu hilang ±6 dtk.
6. Tablet/ponsel (bila ada): composer sudah tampil, mic bekerja, tak ada layout lompat.
7. Firefox: tak ada tombol mic, terminal normal.

- [ ] **Step 5: Jalankan tes tersentuh & commit**

Run: `pnpm vitest --run src/test/speech-engine.test.ts src/test/web-speech-engine.test.ts src/test/voice-controls.test.tsx src/test/terminal-composer-voice.test.tsx src/test/terminal-composer.test.ts src/test/terminal-pane.test.tsx src/test/icon-registry.test.ts`
Expected: PASS semua. (Tak ada tes server/DB tersentuh, jadi tak perlu `--no-file-parallelism`/`TEST_DATABASE_URL`.)

```bash
git add internal/docs/adr/0177-dikte-suara-seam-speech-engine.md internal/docs/frontend/frontend-implementation.md internal/docs/README.md docs/superpowers/plans/2026-10-05-voice-input.md
git commit -m "docs(voice): ADR-0177 dikte suara + frontend-implementation + index

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
