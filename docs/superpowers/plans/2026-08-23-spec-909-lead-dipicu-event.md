# hanoman-lead dipicu event `AskUserQuestion` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah pintu deteksi hanoman-lead dari pemindai `setInterval` 5 detik menjadi penerima event: hook agen menembak tepat pada `AskUserQuestion` (claude) / akhir-turn (codex) dan mengirim pertanyaan terstruktur ke server, yang langsung menyusun keputusan — sementara pet menampilkan pertanyaan aslinya dan operator bisa mengambil alih.

**Architecture:** Hook `type: "command"` di settings sesi meng-`curl` payload hook **verbatim** ke `POST /api/session-events` di loopback, berotorisasi token turunan HMAC per sesi. Route menaruh event di registry in-memory (`lead/ask.ts`) yang memegang idempotensi, batas laju, dan antrean berpekerja `cfg.maxConcurrent`; pekerja memanggil pagar lama (`admitAsk`) lalu `runChain` yang kini disuapi payload, bukan layar. Registry itu juga sumber frame siar `leadAsks` di `/api/events/ws` yang sudah ada. Nol tabel baru, nol migration, nol kanal WS baru, nol timer baru (satu timer lead tersisa, iramanya melambat 5 dtk → 60 dtk).

**Tech Stack:** TypeScript strict · Fastify 5 · Prisma 6 (SQLite) · zod · vitest · React 18 (Vite) · tmux · `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-08-23-spec-909-lead-dipicu-event-askuserquestion-design.md` — baca §3 (keputusan yang mengikat) dan §6 (bukti terukur) sebelum task 1.

## Global Constraints

- **ADR baru = ADR-0146.** 0144 dipegang SPEC-905 (repo utama), 0145 dipegang SPEC-908. Jangan memakai nomor lain.
- **Nol migration, nol model Prisma baru, nol kolom baru.** Seluruh keadaan baru in-memory (cermin `lead/deciding.ts`).
- **Nol kanal WebSocket baru** (ADR-0039). Frame pet lewat grup baru di `services/events.ts` `GROUPS`.
- **Nol message queue / worker / cron** (ADR-0024). Jumlah `setInterval` di lead **berkurang**, tak bertambah.
- **Marker keputusan tak berubah:** arti, isi, penulis, dan ketiga pengosongnya (`UserPromptSubmit`, `lead/detect.ts`, route jawab dialog) tetap persis seperti sekarang (ADR-0141/0143).
- **Jangan memblokir event loop dari jalur event.** `getSession()` sinkron (`execFileSync`); jalur route WAJIB memakai `getSessionAsync()`.
- **Hook WAJIB `exit 0` tanpa syarat** — `PreToolUse` yang keluar kode 2 memblokir tool-nya.
- **Test:** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` + `--no-file-parallelism` untuk set yang menyentuh test server, dan bersihkan env: `env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u NODE_ENV -u DATABASE_URL -u HANOMAN_SUPERVISOR`.
- **Gaya kode:** ikuti berkas sekitarnya. Komentar hanya untuk WHY / trade-off / rujukan SPEC-ADR / invariant tak kelihatan. Bahasa komentar: Indonesia, seperti sekitarnya.

---

## File Structure

**Baru**

| berkas | tanggung jawab |
|---|---|
| `shared/src/session-ask.ts` | Tipe `SessionAsk`/`SessionAskQuestion` + parser zod payload hook (`parseHookEvent`). Murni, tanpa I/O — dipakai server & frontend. |
| `server/src/services/session-event-token.ts` | Token turunan HMAC per sesi: `sessionEventToken(id)` + `verifySessionEventToken(id, given)`. |
| `server/src/services/lead/ask.ts` | Registry tanya hidup + idempotensi + batas laju + antrean berpekerja + bendera takeover. Satu-satunya pemilik keadaan event. |
| `server/src/routes/session-events.ts` | `POST /api/session-events` — auth token sesi, parse payload, serahkan ke `ask.ts`. |
| `internal/docs/adr/0146-lead-dipicu-event-hook.md` | ADR-0146. |

**Diubah**

| berkas | perubahan |
|---|---|
| `shared/src/index.ts` | re-export `session-ask`. |
| `shared/src/dto.ts` | `EventMsg` + varian `leadAsks`. |
| `shared/src/api.ts` | `paths.terminalDialogTakeover`. |
| `runner/src/settings.ts` | hook `PreToolUse` matcher `AskUserQuestion`. |
| `runner/src/codex-settings.ts` | perintah `Stop` kedua (kirim event) berdampingan dengan penulis marker. |
| `runner/src/agent-cli.ts` | `AgentFlagsOpts` + `eventHook`; diteruskan ke `guardSettings`/`codexHookArgs`. |
| `server/src/services/pty.ts` | `getSessionAsync()`, env event sesi, opsi window `@hanoman_event_hook`, `paneIO` sudah diekspor. |
| `server/src/services/lead/detect.ts` | `admitAsk()` (pagar tahap 1 per sesi) + `answerAsk()` (rantai disuapi payload); `scanAndAnswer`, `settledPane`, `CHAIN_END_TRIES` dicabut. |
| `server/src/services/lead/engine.ts` | `TICK_MS` → `HOUSEKEEPING_MS` 60 dtk; `scanAndAnswer` & `busyDetect` dicabut; notifikasi sesi pra-pembaruan. |
| `server/src/services/lead/pane.ts` | `readCodexTurn(message)` — gerbang `ASK_SIGNALS`/`CODEX_FINISHED` atas `last_assistant_message`. |
| `server/src/services/agent-capabilities.ts` | `session-events` → `COOKIE_ONLY`. |
| `server/src/app.ts` | bypass gate cookie untuk `/api/session-events`; daftar route. |
| `server/src/routes/terminal.ts` | `POST /terminal/sessions/:id/dialog/takeover`. |
| `server/src/services/events.ts` | grup siar `leadAsks`. |
| `src/src/api/client.ts` | `takeoverSessionDialog`. |
| `src/src/screens/PetAnswer.tsx` | pertanyaan dari `leadAsks`, langkah _n_ dari _N_, status lead, tombol Ambil alih. |
| `src/src/screens/HanomanPet.tsx` | teruskan `ask` dari state siar ke `PetAnswer`. |
| `src/src/state/*` (tempat frame WS dijahit) | simpan `leadAsks`. |
| `runner/src/doctor.ts` | prasyarat `curl`. |
| `internal/docs/adr/README.md`, `internal/docs/README.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/frontend/frontend-implementation.md` | docs tersentuh + index. |

**Test baru**

`shared/src/session-ask.test.ts` · `server/test/session-event-token.test.ts` · `server/test/lead-ask.test.ts` · `server/test/session-events.route.test.ts` · `server/test/lead-detect-event.test.ts` · `server/test/terminal-takeover.route.test.ts` · `src/test/pet-answer.test.tsx`

---

### Task 1: Tipe & parser payload hook (shared)

**Files:**
- Create: `shared/src/session-ask.ts`
- Create: `shared/src/session-ask.test.ts`
- Modify: `shared/src/index.ts` (tambah satu baris re-export, ikuti urutan abjad yang ada)
- Modify: `shared/src/dto.ts:713-724` (union `EventMsg`)

**Interfaces:**
- Consumes: `Agent` dari `./entities` (sudah ada).
- Produces: `SessionAskQuestion`, `SessionAskOption`, `SessionAsk`, `HookEvent`, `parseHookEvent(body: unknown): HookEvent | null`, `ASK_QUESTION_MAX = 2000`, `ASK_MESSAGE_MAX = 4000`.

- [x] **Step 1: Tulis test yang gagal**

`shared/src/session-ask.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseHookEvent, ASK_MESSAGE_MAX } from "./session-ask";

// Payload di bawah adalah TANGKAPAN NYATA (spec §6.1/§6.4), bukan karangan: claude 2.1.240 &
// codex-cli 0.147.0. Kalau bentuknya berubah, test ini yang harus jadi tempat pertama tahu.
const CLAUDE = {
  session_id: "6b3cc73f-9494-4dd9-ac6e-8545f8bc2f2b",
  cwd: "/tmp/hooktest", hook_event_name: "PreToolUse", tool_name: "AskUserQuestion",
  tool_use_id: "toolu_01Ev4E6Yw74X3uEWxLbKMsSv",
  tool_input: { questions: [{
    question: "Warna mana yang kamu pilih?", header: "Warna", multiSelect: false,
    options: [{ label: "Merah", description: "hangat" }, { label: "Biru", description: "sejuk" }],
  }] },
};
const CODEX = {
  session_id: "01a02bad-554c-7fe0-b7ad-92e070301f77", turn_id: "01a02bad-5737-72e0-933b-fcc99b4b993b",
  cwd: "/tmp/hooktest", hook_event_name: "Stop", stop_hook_active: false,
  last_assistant_message: "Mau pakai SQLite atau Postgres?",
};

describe("parseHookEvent", () => {
  it("membaca AskUserQuestion claude jadi daftar pertanyaan terstruktur", () => {
    const e = parseHookEvent(CLAUDE);
    expect(e).toMatchObject({ source: "ask-tool", askId: "toolu_01Ev4E6Yw74X3uEWxLbKMsSv", message: "" });
    expect(e!.questions).toHaveLength(1);
    expect(e!.questions[0]).toEqual({
      header: "Warna", question: "Warna mana yang kamu pilih?", multiSelect: false,
      options: [{ label: "Merah", description: "hangat" }, { label: "Biru", description: "sejuk" }],
    });
  });

  it("membaca Stop codex jadi pesan giliran, tanpa pertanyaan terstruktur", () => {
    const e = parseHookEvent(CODEX);
    expect(e).toMatchObject({
      source: "turn-end", askId: "01a02bad-5737-72e0-933b-fcc99b4b993b",
      message: "Mau pakai SQLite atau Postgres?",
    });
    expect(e!.questions).toEqual([]);
  });

  it("memotong pesan yang kelewat panjang, bukan menolaknya", () => {
    const e = parseHookEvent({ ...CODEX, last_assistant_message: "x".repeat(ASK_MESSAGE_MAX + 500) });
    expect(e!.message).toHaveLength(ASK_MESSAGE_MAX);
  });

  it("mengabaikan event yang bukan pertanyaan", () => {
    expect(parseHookEvent({ ...CLAUDE, tool_name: "Bash" })).toBeNull();
    expect(parseHookEvent({ hook_event_name: "PostToolUse" })).toBeNull();
    expect(parseHookEvent({ ...CODEX, stop_hook_active: true })).toBeNull();
    expect(parseHookEvent(null)).toBeNull();
    expect(parseHookEvent("bukan objek")).toBeNull();
  });

  it("menolak AskUserQuestion tanpa satu pun pertanyaan", () => {
    expect(parseHookEvent({ ...CLAUDE, tool_input: { questions: [] } })).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm vitest --run shared/src/session-ask.test.ts`
Expected: FAIL — `Failed to resolve import "./session-ask"`.

- [x] **Step 3: Tulis `shared/src/session-ask.ts`**

```ts
import { z } from "zod";
import type { Agent } from "./entities";

// SPEC-909 · ADR-0146 · bentuk PERTANYAAN sebuah sesi sebagaimana dikirim hook agennya sendiri.
//
// Ini bukan cermin layar (bandingkan `session-dialog.ts`, yang memang membaca pane): ia payload
// tool `AskUserQuestion` apa adanya. Pembacanya dua — pintu deteksi lead dan panel pet — dan
// keduanya membaca bentuk YANG SAMA, supaya "apa yang ditanyakan" tak pernah punya dua definisi.

export const ASK_QUESTION_MAX = 2_000;
export const ASK_MESSAGE_MAX = 4_000;

export type SessionAskOption = { label: string; description?: string };
export type SessionAskQuestion = {
  header: string;
  question: string;
  multiSelect: boolean;
  options: SessionAskOption[];
};

/** Peristiwa hook yang sudah dinormalkan; `null` dari `parseHookEvent` = bukan pertanyaan. */
export type HookEvent = {
  source: "ask-tool" | "turn-end";
  /** Kunci idempotensi milik AGEN: `tool_use_id` (claude) / `turn_id` (codex). */
  askId: string;
  questions: SessionAskQuestion[];
  /** Teks giliran terakhir codex; "" untuk claude, yang pertanyaannya terstruktur. */
  message: string;
};

/** Keadaan satu tanya hidup — dipakai pintu deteksi DAN frame siar `leadAsks`. */
export type SessionAsk = {
  sessionId: string;
  agent: Agent;
  source: HookEvent["source"];
  askId: string;
  askedAt: string;
  questions: SessionAskQuestion[];
  message: string;
  /** Langkah yang sedang dikerjakan (0-based) dari `total`. */
  at: number;
  total: number;
  state: "queued" | "deciding" | "answered" | "taken-over" | "failed";
  flowId: string | null;
  step: number | null;
};

const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/\s+$/g, "").slice(0, max) : "";

const zOption = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

const zQuestion = z.object({
  question: z.string().min(1),
  header: z.string().default(""),
  multiSelect: z.boolean().default(false),
  options: z.array(zOption).default([]),
});

// Payload hook adalah kontrak AGEN, bukan kontrak kita: skema di bawah sengaja `passthrough`-ish
// (hanya field yang dipakai yang divalidasi). Field baru dari rilis agen berikutnya tak boleh
// menjatuhkan jalur ini — yang menjatuhkannya hanya field yang HILANG.
const zAskTool = z.object({
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.literal("AskUserQuestion"),
  tool_use_id: z.string().min(1),
  tool_input: z.object({ questions: z.array(zQuestion).min(1) }),
});

const zTurnEnd = z.object({
  hook_event_name: z.literal("Stop"),
  turn_id: z.string().min(1),
  last_assistant_message: z.string().optional(),
  // Codex menyalakan bendera ini saat Stop dipicu oleh hook Stop lain. Melayani giliran yang
  // dibangkitkan gate mode goal (ADR-0074) berarti lead menjawab dirinya sendiri.
  stop_hook_active: z.boolean().optional(),
});

export function parseHookEvent(body: unknown): HookEvent | null {
  const ask = zAskTool.safeParse(body);
  if (ask.success) {
    return {
      source: "ask-tool",
      askId: ask.data.tool_use_id,
      questions: ask.data.tool_input.questions.map((q) => ({
        header: clip(q.header, 200),
        question: clip(q.question, ASK_QUESTION_MAX),
        multiSelect: q.multiSelect,
        options: q.options.map((o) => ({
          label: clip(o.label, 200),
          ...(o.description ? { description: clip(o.description, 400) } : {}),
        })),
      })),
      message: "",
    };
  }
  const turn = zTurnEnd.safeParse(body);
  if (turn.success && !turn.data.stop_hook_active) {
    return {
      source: "turn-end",
      askId: turn.data.turn_id,
      questions: [],
      message: clip(turn.data.last_assistant_message, ASK_MESSAGE_MAX),
    };
  }
  return null;
}
```

- [x] **Step 4: Sambungkan ke barrel & DTO**

`shared/src/index.ts` — tambahkan di antara re-export lain:

```ts
export * from "./session-ask";
```

`shared/src/dto.ts` — impor tipe dan tambahkan varian di union `EventMsg` (setelah baris `cleanups`):

```ts
import type { SessionAsk } from "./session-ask";
```

```ts
  // SPEC-909 · ADR-0146 · pertanyaan sesi yang HIDUP, langsung dari payload hook agennya. Grup
  // sendiri, bukan hiasan di `sessions`: `sessions` di-recompute tiap detik untuk SETIAP pane, dan
  // menempelkan teks pertanyaan di sana membuat frame terbesar dashboard tumbuh untuk pembaca yang
  // hanya butuh daftar pendek ini.
  | { t: "leadAsks"; asks: SessionAsk[] }
```

- [x] **Step 5: Jalankan test — pastikan LULUS**

Run: `pnpm vitest --run shared/src/session-ask.test.ts`
Expected: PASS, 5 test.

- [x] **Step 6: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck`
Expected: keluar 0, tanpa error.

- [x] **Step 7: Commit**

```bash
git add shared/src/session-ask.ts shared/src/session-ask.test.ts shared/src/index.ts shared/src/dto.ts
git commit -m "feat(lead): tipe & parser payload hook AskUserQuestion/Stop (SPEC-909)"
```

---

### Task 2: Token sesi turunan HMAC

**Files:**
- Create: `server/src/services/session-event-token.ts`
- Create: `server/test/session-event-token.test.ts`

**Interfaces:**
- Consumes: `secretKey()` dari `./secret-box` (sudah ada — 32 byte di `$HANOMAN_HOME/secret.key`).
- Produces: `sessionEventToken(sessionId: string): string`, `verifySessionEventToken(sessionId: string, given: string): boolean`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/session-event-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sessionEventToken, verifySessionEventToken } from "../src/services/session-event-token";

describe("token event sesi", () => {
  it("deterministik untuk id yang sama", () => {
    expect(sessionEventToken("spec-909")).toBe(sessionEventToken("spec-909"));
  });

  it("berbeda antar sesi — id sesi TIDAK cukup sebagai kredensial", () => {
    expect(sessionEventToken("spec-909")).not.toBe(sessionEventToken("spec-910"));
  });

  it("menerima token miliknya sendiri", () => {
    expect(verifySessionEventToken("spec-909", sessionEventToken("spec-909"))).toBe(true);
  });

  it("menolak token milik sesi tetangga", () => {
    expect(verifySessionEventToken("spec-909", sessionEventToken("spec-910"))).toBe(false);
  });

  it("menolak token kosong / bentuk salah tanpa melempar", () => {
    for (const bad of ["", "x", "!".repeat(43), sessionEventToken("spec-909") + "a"])
      expect(verifySessionEventToken("spec-909", bad)).toBe(false);
  });

  it("tak bocor lewat panjang: semua token sama panjang", () => {
    const a = sessionEventToken("a"), b = sessionEventToken("sesi-yang-namanya-jauh-lebih-panjang");
    expect(a).toHaveLength(b.length);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-event-token.test.ts`
Expected: FAIL — modul tak ditemukan.

- [x] **Step 3: Tulis implementasinya**

`server/src/services/session-event-token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { secretKey } from "./secret-box";

// SPEC-909 · ADR-0146 · kredensial hook sesi.
//
// TURUNAN, bukan acak-lalu-disimpan, dan itu keputusan yang membeli tiga hal sekaligus: tak ada
// registry yang harus dihidrasi ulang sesudah restart server, tak ada round-trip tmux di jalur
// panas (`execFileSync` tmux memblokir event loop — SPEC-856/860/878), dan sesi yang lahir sebelum
// restart tetap bisa mengirim event.
//
// Sub-kunci, bukan `secretKey()` langsung: kunci itu juga dipakai enkripsi at-rest RuntimeConfig
// (ADR-0097), dan satu kunci untuk dua kegunaan adalah cara termurah membuat kebocoran di satu
// sisi jadi kebocoran di sisi lain.
const SUBKEY_LABEL = "hanoman:session-event:v1";

const subkey = (): Buffer => createHmac("sha256", secretKey()).update(SUBKEY_LABEL).digest();

export function sessionEventToken(sessionId: string): string {
  return createHmac("sha256", subkey()).update(sessionId).digest("base64url");
}

/**
 * Batas yang dinyatakan apa adanya: token ini membuktikan "pengirim tahu rahasia milik sesi ini",
 * bukan "pengirim ADALAH sesi ini". Semua sesi di mesin ini berjalan sebagai uid yang sama, jadi
 * tetangga yang memang berniat bisa membacanya dari env prosesnya — batas yang sama yang sudah
 * diterima ADR-0037. Yang ditutup di sini: pemanggil tanpa kredensial apa pun, dan pemalsuan yang
 * cuma bermodal tahu id sesi.
 */
export function verifySessionEventToken(sessionId: string, given: string): boolean {
  const want = Buffer.from(sessionEventToken(sessionId));
  let got: Buffer;
  try { got = Buffer.from(given); } catch { return false; }
  // Panjang dibandingkan lebih dulu: `timingSafeEqual` MELEMPAR untuk panjang berbeda, dan token
  // kita selalu sama panjang — jadi selisih panjang bukan informasi rahasia.
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}
```

- [x] **Step 4: Jalankan test — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-event-token.test.ts`
Expected: PASS, 6 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-event-token.ts server/test/session-event-token.test.ts
git commit -m "feat(lead): token event sesi turunan HMAC, stateless lintas restart (SPEC-909)"
```

---

### Task 3: Env event sesi, penanda hook, dan `getSessionAsync`

**Files:**
- Modify: `server/src/services/pty.ts` — tambah `getSessionAsync`, `sessionEventEnv()`, opsi window `@hanoman_event_hook`
- Modify: `server/src/services/ingress-policy.ts` — tambah `controlHost(policy)`
- Test: `server/test/session-event-env.test.ts` (baru)

**Interfaces:**
- Consumes: `sessionEventToken` (Task 2).
- Produces:
  - `getSessionAsync(id: string): Promise<Pane | undefined>` di `pty.ts`
  - `sessionEventEnv(sessionId: string, env?: NodeJS.ProcessEnv): Record<string, string>` di `pty.ts` — `{HANOMAN_SESSION_ID, HANOMAN_EVENT_URL, HANOMAN_EVENT_TOKEN, HANOMAN_EVENT_HOST?}`
  - `controlHost(policy: IngressPolicy): string | null` di `ingress-policy.ts`

- [x] **Step 1: Tulis test yang gagal**

`server/test/session-event-env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sessionEventEnv } from "../src/services/pty";
import { sessionEventToken } from "../src/services/session-event-token";
import { loadIngressPolicy, controlHost } from "../src/services/ingress-policy";

describe("env event sesi", () => {
  it("selalu loopback dan http — tanpa DNS, tanpa TLS", () => {
    const e = sessionEventEnv("spec-909", { PORT: "9911" });
    expect(e.HANOMAN_EVENT_URL).toBe("http://127.0.0.1:9911/api/session-events");
    expect(e.HANOMAN_SESSION_ID).toBe("spec-909");
    expect(e.HANOMAN_EVENT_TOKEN).toBe(sessionEventToken("spec-909"));
  });

  it("tanpa PORT jatuh ke 8787, cermin server.ts", () => {
    expect(sessionEventEnv("spec-909", {}).HANOMAN_EVENT_URL)
      .toBe("http://127.0.0.1:8787/api/session-events");
  });

  it("tanpa split origin, header Host tak dikirim", () => {
    expect(sessionEventEnv("spec-909", {}).HANOMAN_EVENT_HOST).toBeUndefined();
  });

  it("dengan split origin, membawa host control — gerbang ingress menolak Host loopback", () => {
    const e = sessionEventEnv("spec-909", {
      HANOMAN_CONTROL_ORIGINS: "https://hm.example.com",
      HANOMAN_PUBLIC_ORIGINS: "https://pub.example.com",
    });
    expect(e.HANOMAN_EVENT_HOST).toBe("hm.example.com");
  });

  it("controlHost mengembalikan null saat gerbang ingress mati", () => {
    expect(controlHost(loadIngressPolicy({}))).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-event-env.test.ts`
Expected: FAIL — `sessionEventEnv is not a function`.

- [x] **Step 3: Tambahkan `controlHost` di `ingress-policy.ts`**

Sesudah `loadIngressPolicy`:

```ts
/**
 * Host control pertama, atau `null` bila deployment ini tak memisahkan origin.
 *
 * SPEC-909 · dipakai hook sesi sebagai header `Host` di atas koneksi loopback. `classifyIngress`
 * SENGAJA tak diberi pengecualian loopback: ia menilai `Host`, dan `Host` dikendalikan pemanggil —
 * mengistimewakan `127.0.0.1` di sana akan membuka seluruh permukaan control lewat reverse proxy
 * publik, yaitu persis pemisahan yang gerbang itu ada untuk menegakkan.
 */
export function controlHost(policy: IngressPolicy): string | null {
  for (const h of policy.controlHosts) return h;
  return null;
}
```

- [x] **Step 4: Tambahkan `sessionEventEnv` + `getSessionAsync` di `pty.ts`**

Impor di kepala berkas, di kelompok impor service lokal (sejajar `import { effectiveStr } from "../config";`):

```ts
import { controlHost, loadIngressPolicy } from "./ingress-policy";
import { sessionEventToken } from "./session-event-token";
```

Sesudah `export const getSession = …` (sekitar `pty.ts:387`):

```ts
// SPEC-909 · ADR-0146 · kembaran asinkron `getSession`. Jalur event hook WAJIB memakai ini:
// `listPanes()` memakai `execFileSync` dan memblokir event loop sampai 916 ms saat mesin sibuk
// (terukur SPEC-878), dan constraint SPEC-909 melarang jalur ini menahan loop.
export const getSessionAsync = async (id: string): Promise<Pane | undefined> =>
  (await listPanesAsync()).find((p) => p.id === id);
```

Sesudah `noTtyPromptEnv()` (dekat helper env lain di berkas ini) — atau tepat sebelum `CreateOpts`:

```ts
/**
 * SPEC-909 · ADR-0146 · env yang membuat hook sesi bisa mengirim event ke server.
 *
 * Lewat env, bukan lewat argv `--settings`: settings claude adalah JSON inline di argv, dan token
 * di sana ikut ke `ps` milik proses agennya sendiri. Env tetap terbaca uid yang sama lewat `sh -c`
 * yang melahirkan pane — batas ADR-0037, dinyatakan di ADR-0146, tidak dilebarkan di sini.
 *
 * Preseden bentuknya `HANOMAN_API_BASE` gateway Telegram (services/telegram/session.ts).
 */
export function sessionEventEnv(
  sessionId: string, env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const port = Number(env.PORT ?? 8787);
  const host = controlHost(loadIngressPolicy(env));
  return {
    HANOMAN_SESSION_ID: sessionId,
    HANOMAN_EVENT_URL: `http://127.0.0.1:${port}/api/session-events`,
    HANOMAN_EVENT_TOKEN: sessionEventToken(sessionId),
    ...(host ? { HANOMAN_EVENT_HOST: host } : {}),
  };
}
```

- [x] **Step 5: Pasang env & penanda hook di `createSession`**

Di `createSession`, tepat SESUDAH blok `noTtyPromptEnv()` dan SEBELUM `if (opts.phaseFile)`:

```ts
  // SPEC-909 · ADR-0146 · hanya sesi AGEN. Console VPS & terminal biasa (`opts.command`) adalah
  // shell mentah: tak ada hook di sana, jadi tak ada gunanya membawa kredensialnya.
  if (!opts.command) {
    for (const [k, v] of Object.entries(sessionEventEnv(id))) envPairs.push(`${k}=${sq(v)}`);
  }
```

Di blok `set-option` per-sesi, sesudah `@hanoman_decision_file`:

```ts
  // SPEC-909 · ADR-0146 · penanda "sesi ini lahir dengan hook event". Sesi hidup TANPA penanda ini
  // lahir sebelum pembaruan dan tak akan dijawab lead — engine menotifikasinya sekali (§3.10).
  // Opsi window, bukan berkas: sumber kebenaran sesi tetap tmux (pola @hanoman_agent, SPEC-338).
  if (!opts.command) tmux("set-option", "-t", name(id), "@hanoman_event_hook", "1");
```

Tambahkan `#{@hanoman_event_hook}` ke `FMT` (setelah `#{window_activity}`) dan ke destrukturisasi
`parsePanes`, dengan field baru di `Pane`:

```ts
const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}", "#{@hanoman_agent}", "#{alternate_on}",
  "#{window_activity}", "#{@hanoman_event_hook}",
].join("\t");
```

```ts
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, agent,
      alternate, activity, eventHook] = line.split("\t");
```

```ts
      // SPEC-909 · ADR-0146 · sesi yang lahir sebelum pembaruan tak punya opsi ini → false.
      eventHook: eventHook === "1",
```

dan di `type Pane` tambahkan `eventHook: boolean;`. **Jangan** masukkan ke `SessionInfo`
(`toSessionInfo`): ia detail internal, bukan bagian DTO yang disync/disiarkan.

- [x] **Step 6: Jalankan test — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-event-env.test.ts server/test/pty.test.ts`
Expected: PASS. `pty.test.ts` ikut karena `FMT`/`parsePanes` berubah — bila ia merah dengan `SSH_ASKPASS`, bersihkan env dulu (Global Constraints), itu gagal palsu SPEC-881.

- [x] **Step 7: Commit**

```bash
git add server/src/services/pty.ts server/src/services/ingress-policy.ts server/test/session-event-env.test.ts
git commit -m "feat(lead): env event sesi + penanda @hanoman_event_hook + getSessionAsync (SPEC-909)"
```

---

### Task 4: Hook pengirim event di kedua mesin sesi

**Files:**
- Modify: `runner/src/settings.ts:4-30` (claude — `PreToolUse` matcher `AskUserQuestion`)
- Modify: `runner/src/codex-settings.ts:34-50` (codex — perintah `Stop` kedua)
- Modify: `runner/src/agent-cli.ts:11-43` (`AgentFlagsOpts.eventHook` diteruskan)
- Modify: `server/src/services/pty.ts` (satu baris: `eventHook: !opts.command` ke `agentFlags`)
- Test: `runner/test/settings.test.ts` (tambah), `runner/test/codex-settings.test.ts` (tambah)

**Interfaces:**
- Consumes: env `HANOMAN_EVENT_URL` / `HANOMAN_EVENT_TOKEN` / `HANOMAN_SESSION_ID` / `HANOMAN_EVENT_HOST` (Task 3).
- Produces: `EVENT_HOOK_COMMAND` (konstanta string, diekspor dari `runner/src/settings.ts` supaya kedua mesin memakai satu definisi), `guardSettings(decisionFile?, goal?, eventHook?)`, `codexHookArgs({decisionFile?, goalGate?, eventHook?})`, `agentFlags({..., eventHook?})`.

- [x] **Step 1: Tulis test yang gagal (claude)**

Tambahkan di `runner/test/settings.test.ts`:

```ts
import { guardSettings, EVENT_HOOK_COMMAND } from "../src/settings";

describe("SPEC-909 · hook pengirim event", () => {
  it("memasang PreToolUse ber-matcher AskUserQuestion", () => {
    const h = guardSettings("/w/.decisions/s1", undefined, true).hooks as Record<string, any[]>;
    expect(h.PreToolUse).toHaveLength(1);
    expect(h.PreToolUse[0].matcher).toBe("AskUserQuestion");
    expect(h.PreToolUse[0].hooks[0]).toEqual({ type: "command", command: EVENT_HOOK_COMMAND });
  });

  it("SELALU exit 0 — PreToolUse berkode 2 memblokir tool-nya", () => {
    expect(EVENT_HOOK_COMMAND.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("membuang stdout — keluaran hook command dibaca claude sebagai kendali izin", () => {
    expect(EVENT_HOOK_COMMAND).toContain(">/dev/null 2>&1");
  });

  it("membatasi tunggu supaya server mati tak menggantungkan agen", () => {
    expect(EVENT_HOOK_COMMAND).toContain("-m 2");
  });

  it("tanpa eventHook, settings byte-identik seperti sebelum SPEC-909", () => {
    expect(guardSettings("/w/.decisions/s1")).toEqual(guardSettings("/w/.decisions/s1", undefined, false));
    expect((guardSettings("/w/.decisions/s1").hooks as Record<string, unknown>).PreToolUse).toBeUndefined();
  });

  it("penulis & pengosong marker TIDAK berubah (ADR-0141/0143)", () => {
    const h = guardSettings("/w/.decisions/s1", undefined, true).hooks as Record<string, any[]>;
    expect(h.Notification[0].hooks[0].command).toContain("date +%s >");
    expect(h.UserPromptSubmit[0].hooks[0].command).toContain(": >");
  });
});
```

- [x] **Step 2: Tulis test yang gagal (codex)**

Tambahkan di `runner/test/codex-settings.test.ts`:

```ts
import { codexHookArgs } from "../src/codex-settings";
import { EVENT_HOOK_COMMAND } from "../src/settings";

describe("SPEC-909 · hook pengirim event codex", () => {
  it("menambahkan perintah kedua di Stop, berdampingan dengan penulis marker", () => {
    const args = codexHookArgs({ decisionFile: "/w/.decisions/s1", eventHook: true });
    const stop = args[args.indexOf("-c") + 1];
    expect(stop.startsWith("hooks.Stop=")).toBe(true);
    expect(stop).toContain("date +%s >");        // penulis marker tetap ada …
    expect(stop).toContain("curl");              // … dan pengirim event menyusul
  });

  it("tanpa eventHook, argv byte-identik seperti sebelum SPEC-909", () => {
    expect(codexHookArgs({ decisionFile: "/w/.decisions/s1" }))
      .toEqual(codexHookArgs({ decisionFile: "/w/.decisions/s1", eventHook: false }));
  });

  it("memakai definisi perintah yang SAMA dengan claude — bukan salinan", () => {
    const stop = codexHookArgs({ eventHook: true })[1];
    // Perintahnya di-escape TOML, jadi cocokkan potongan yang tak mengandung kutip.
    expect(stop).toContain("$HANOMAN_EVENT_URL");
    expect(EVENT_HOOK_COMMAND).toContain("$HANOMAN_EVENT_URL");
  });
});
```

- [x] **Step 3: Jalankan kedua test — pastikan GAGAL**

Run: `pnpm vitest --run runner/test/settings.test.ts runner/test/codex-settings.test.ts`
Expected: FAIL — `EVENT_HOOK_COMMAND` tak diekspor.

- [x] **Step 4: Implementasi claude (`runner/src/settings.ts`)**

Tambahkan sebelum `guardSettings`:

```ts
/**
 * SPEC-909 · ADR-0146 · pengirim event pertanyaan sesi ke server.
 *
 * Satu definisi dipakai KEDUA mesin (codex mengutipnya lagi untuk TOML): dua penulis perintah yang
 * tak sepakat adalah kelas kegagalan SPEC-431/448, dan di sini perbedaan satu header berarti separuh
 * sesi diam tanpa satu pun error.
 *
 * Empat hal yang mengikat di baris ini:
 * - `exit 0` tanpa syarat — `PreToolUse` yang keluar dengan kode 2 MEMBLOKIR tool-nya; server mati
 *   tak boleh berarti agen tak bisa bertanya.
 * - `-m 2` — batas atas stall yang dibayar agen saat server tak menjawab. Ia menunggu manusia
 *   sesudah ini, jadi dua detik adalah harga yang benar untuk kepastian.
 * - stdout dibuang — keluaran hook `type: "command"` dibaca claude sebagai kendali izin.
 * - payload diteruskan APA ADANYA (`--data-binary @-`): bentuknya kontrak agen dan bisa bertambah
 *   field tiap rilis; server yang memarsenya. Tak ada `jq` di jalur ini — hook tak boleh menuntut
 *   biner yang belum tentu terpasang.
 *
 * Env-nya dipasang saat sesi lahir (`sessionEventEnv`, services/pty.ts). Tanpa env itu `curl`
 * memanggil URL kosong, gagal, dan `exit 0` — sesi kembali ke perilaku menunggu manusia.
 */
export const EVENT_HOOK_COMMAND = [
  'curl -sS -m 2 -X POST "$HANOMAN_EVENT_URL"',
  "-H 'content-type: application/json'",
  '-H "authorization: Bearer $HANOMAN_EVENT_TOKEN"',
  '-H "x-hanoman-session: $HANOMAN_SESSION_ID"',
  '${HANOMAN_EVENT_HOST:+-H "host: $HANOMAN_EVENT_HOST"}',
  '--data-binary @- >/dev/null 2>&1; exit 0',
].join(" ");
```

Ubah tanda tangan & tambahkan hook:

```ts
export const guardSettings = (decisionFile?: string, goal?: string, eventHook?: boolean) => {
```

Sesudah blok `if (decisionFile) { … }`, sebelum blok `goal`:

```ts
  // SPEC-909 · ADR-0146 · pintu deteksi lead tak lagi memindai; ia menunggu event ini. Matcher
  // `AskUserQuestion` menembak TEPAT saat agen bertanya — terukur 6 023–6 071 ms lebih awal dari
  // hook `Notification` di atas, yang lahir dari pengait idle 6 detik dan hanya mengisi marker.
  // Keduanya hidup berdampingan: marker tetap milik pil/notifikasi/pet (ADR-0141/0143).
  if (eventHook) {
    hooks.PreToolUse = [{ matcher: "AskUserQuestion",
      hooks: [{ type: "command", command: EVENT_HOOK_COMMAND }] }];
  }
```

- [x] **Step 5: Implementasi codex (`runner/src/codex-settings.ts`)**

Impor konstanta:

```ts
import { EVENT_HOOK_COMMAND } from "./settings";
```

Ubah tanda tangan dan tambahkan perintah:

```ts
export function codexHookArgs(o: { decisionFile?: string; goalGate?: string; eventHook?: boolean }): string[] {
```

Sesudah blok `if (o.decisionFile) { … }`, sebelum `if (o.goalGate)`:

```ts
  // SPEC-909 · ADR-0146 · padanan hook `AskUserQuestion` untuk codex. Codex tak punya tool itu;
  // yang tersedia adalah akhir-turn, dan payload `Stop`-nya membawa `last_assistant_message` —
  // teks penuh giliran terakhir, TANPA dipotong lebar pane. Bukti yang lebih kuat daripada
  // `capture-pane` yang dipakai jalur lama, dengan nol invokasi tmux.
  if (o.eventHook) stop.push(EVENT_HOOK_COMMAND);
```

- [x] **Step 6: Teruskan bendera lewat `agentFlags` (`runner/src/agent-cli.ts`)**

Tambahkan `eventHook?: boolean;` ke `AgentFlagsOpts`, lalu:

```ts
      ...codexHookArgs({ decisionFile: o.decisionFile, goalGate: o.goalGate, eventHook: o.eventHook }),
```

```ts
    "--settings", JSON.stringify(guardSettings(o.decisionFile, o.goal, o.eventHook)),
```

- [x] **Step 7: Nyalakan dari `pty.ts`**

Di `createSession`, pada pemanggilan `agentFlags({ … })`:

```ts
    const flags = agentFlags({
      agent, model: opts.model, effort,
      decisionFile: opts.decisionFile, goal: opts.goal, goalGate,
      // SPEC-909 · sesi ber-`opts.command` tak pernah sampai ke sini (cabang shell mentah di atas).
      eventHook: true,
    }).map(sq).join(" ");
```

- [x] **Step 8: Jalankan test — pastikan LULUS**

Run: `pnpm vitest --run runner/test/settings.test.ts runner/test/codex-settings.test.ts`
Expected: PASS — seluruh test lama plus 9 test baru.

- [x] **Step 9: Typecheck runner**

Run: `pnpm --filter ./runner typecheck`
Expected: keluar 0.

- [x] **Step 10: Commit**

```bash
git add runner/src/settings.ts runner/src/codex-settings.ts runner/src/agent-cli.ts \
        runner/test/settings.test.ts runner/test/codex-settings.test.ts server/src/services/pty.ts
git commit -m "feat(lead): hook AskUserQuestion (claude) & Stop (codex) mengirim event ke server (SPEC-909)"
```

---

### Task 5: Pintu deteksi disuapi payload — `admitAsk` + `answerAsk`

**Files:**
- Modify: `server/src/services/lead/detect.ts` (cabut `scanAndAnswer`, `settledPane`, `CHAIN_END_TRIES`, `sweep`; tambah `admitAsk`, `answerAsk`, `waitDialog`; `runChain` disuapi `SessionAsk`)
- Modify: `server/src/services/lead/pane.ts` (tambah `readCodexTurn`)
- Test: `server/test/lead-detect-event.test.ts` (baru)
- Test: `server/test/lead-detect.test.ts` (sesuaikan: `scanAndAnswer` tak ada lagi)
- Test: `server/test/lead-pane.test.ts` (tambah untuk `readCodexTurn`)

**Interfaces:**
- Consumes: `SessionAsk`, `SessionAskQuestion` (Task 1); `DetectDeps` yang sudah ada minus `live`/`filled`/`agentOf`.
- Produces:
  - `admitAsk(s: { id: string; specId?: string; projectId: string }, deps: DetectDeps): Promise<{ ok: true } | { ok: false; reason: string }>`
  - `answerAsk(ask: SessionAsk, s: AskCtx, deps?: DetectDeps): Promise<AnswerAskResult>` dengan
    `type AskCtx = { projectId: string; specId?: string; decisionFile?: string }` dan
    `type AnswerAskResult = { answered: boolean; reason: string; at: number; flowId: string | null; step: number | null }`
  - `readCodexTurn(message: string): { asking: boolean; reason: string }` di `pane.ts`
  - `resetSession`, `answerCount`, `failureCount`, `MAX_CHAIN_STEPS`, `FAIL_COOLDOWN_MS` tetap diekspor apa adanya.

**Catatan desain yang mengikat (baca sebelum menulis kode):**

1. **`PreToolUse` menembak SEBELUM tool-nya jalan** — jadi saat event tiba, dialognya BELUM tergambar
   di pane. Urutannya karena itu: `decide()` dulu (yang memakan detik sampai menit), BARU
   `waitDialog()`. Menunggunya gratis karena tumpang tindih dengan pikiran lead.
2. **`waitDialog` gagal = JANGAN mengetik apa pun.** `sendToPane` jatuh ke "prosa + Enter" bila
   layarnya bukan dialog, dan itu persis pesan liar SPEC-487 yang membakar jatah `maxAutoAnswers`.
   Untuk `source: "ask-tool"`, tak ada dialog berarti batal — bukan jatuh ke jalur prosa.
3. **Satu panggilan `AskUserQuestion` = satu `LeadFlow`**, ditutup di ujungnya. Ini SETARA dengan
   yang diperbaiki SPEC-487 (yang rusak di sana adalah `chainSteps` kosong untuk 3 pertanyaan DALAM
   SATU dialog), dan kini unitnya bisa dilihat langsung dari payload alih-alih ditebak dari layar.
4. **`waitScreenChange` DIPERTAHANKAN**, hanya untuk berpindah antar-tab di dalam satu dialog: tak
   ada event di antara tab (terukur, spec §6.2 — 3 pertanyaan menerbitkan 1 event). Ini satu-satunya
   sisa interaksi layar di jalur keputusan.
5. **`CHAIN_END_TRIES` & `settledPane` dicabut**: keduanya ada semata untuk menebak berapa langkah
   rantai itu, dan payload sekarang menyebutnya (`questions.length`).

- [x] **Step 1: Tulis test yang gagal**

`server/test/lead-detect-event.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionAsk } from "@hanoman/shared";
import { admitAsk, answerAsk, __resetDetect, answerCount, failureCount, type DetectDeps }
  from "../src/services/lead/detect";
import { __resetLeadGate } from "../src/services/lead/gate";
import { __resetDeciding } from "../src/services/lead/deciding";

const LEAD = {
  enabled: true, paused: false, pausedProjects: [] as string[], everyMin: 5, timeoutSec: 600,
  maxAutoAnswers: 3, maxConcurrent: 2, queueWaitSec: 120, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true, engine: { enabled: false, agent: "claude", model: "m", effort: "high" },
} as any;

const DIALOG = [
  "☐ Basis",
  "Basis data mana?",
  "❯ 1. SQLite",
  "  2. Postgres",
  "  3. Type something.",
  "  4. Chat about this",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

const ask = (over: Partial<SessionAsk> = {}): SessionAsk => ({
  sessionId: "s1", agent: "claude", source: "ask-tool", askId: "toolu_1",
  askedAt: new Date().toISOString(),
  questions: [{ header: "Basis", question: "Basis data mana?", multiSelect: false,
    options: [{ label: "SQLite" }, { label: "Postgres" }] }],
  message: "", at: 0, total: 1, state: "queued", flowId: null, step: null, ...over,
});

function deps(over: Partial<DetectDeps> = {}): DetectDeps {
  return {
    pane: () => DIALOG,
    exited: () => false,
    send: vi.fn(async () => true),
    clearMarker: vi.fn(),
    submit: vi.fn(async () => true),
    sleep: async () => {},
    closeChain: vi.fn(async () => {}),
    now: () => 1_000_000,
    decide: vi.fn(async () => ({ id: "d1", status: "berlaku", answer: "SQLite", flowId: "f1", step: 1 })) as any,
    decideDeps: {} as any,
    delivery: () => ({ decision: "Pakai SQLite", choices: [{ index: 1, option: "SQLite" }], refs: [], missing: [] }) as any,
    optIn: async () => ["p1"],
    notify: vi.fn(async () => {}),
    cfg: async () => LEAD,
    ...over,
  } as DetectDeps;
}

const S = { id: "s1", specId: "SPEC-1", projectId: "p1" };

beforeEach(() => { __resetDetect(); __resetLeadGate(); __resetDeciding(); });

describe("admitAsk — pagar lama, satu sesi per panggilan", () => {
  it("meloloskan sesi yang opt-in & lead aktif", async () => {
    expect(await admitAsk(S, deps())).toEqual({ ok: true });
  });

  it("menolak project yang tak opt-in", async () => {
    const r = await admitAsk(S, deps({ optIn: async () => [] }));
    expect(r).toEqual({ ok: false, reason: "project tak opt-in lead" });
  });

  it("menolak saat lead dijeda untuk project ini (AC-15/27)", async () => {
    const cfg = async () => ({ ...LEAD, pausedProjects: ["p1"] });
    expect(await admitAsk(S, deps({ cfg: cfg as any }))).toEqual({ ok: false, reason: "lead dijeda untuk project ini" });
  });

  it("menolak saat master switch mati (AC-30)", async () => {
    const cfg = async () => ({ ...LEAD, enabled: false });
    expect((await admitAsk(S, deps({ cfg: cfg as any }))).ok).toBe(false);
  });

  it("menolak pane mati (AC-10)", async () => {
    expect(await admitAsk(S, deps({ exited: () => true }))).toEqual({ ok: false, reason: "pane mati" });
  });

  it("menolak + menotifikasi SEKALI saat maxAutoAnswers tercapai (AC-11)", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) await answerAsk(ask({ askId: `t${i}` }), { decisionFile: "/m" }, d);
    expect(answerCount("s1")).toBe(3);
    const first = await admitAsk(S, d);
    const second = await admitAsk(S, d);
    expect(first).toEqual({ ok: false, reason: "batas jawaban otomatis tercapai" });
    expect(second.ok).toBe(false);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("melepas failCapped sesudah FAIL_COOLDOWN_MS (SPEC-487)", async () => {
    const d = deps({ decide: (async () => ({ id: "d", status: "gagal", answer: "", flowId: null, step: null })) as any });
    for (let i = 0; i < 3; i++) await answerAsk(ask({ askId: `t${i}` }), { decisionFile: "/m" }, d);
    expect(failureCount("s1")).toBe(3);
    expect((await admitAsk(S, d)).ok).toBe(false);
    const later = deps({ now: () => 1_000_000 + 16 * 60_000 });
    expect(await admitAsk(S, later)).toEqual({ ok: true });
  });
});

describe("answerAsk — rantai disuapi payload", () => {
  it("memakai pertanyaan & opsi DARI PAYLOAD, bukan dari layar", async () => {
    const d = deps();
    await answerAsk(ask(), { decisionFile: "/m" }, d);
    const req = (d.decide as any).mock.calls[0][0];
    expect(req.question).toBe("Basis data mana?");
    expect(req.options).toEqual(["SQLite", "Postgres"]);
    expect(req.chain).toBe(true);
  });

  it("satu panggilan 3 pertanyaan = 3 decide dalam SATU alur, lalu Submit & marker dikosongkan", async () => {
    const d = deps();
    // layar berganti tiap kali dibaca supaya waitScreenChange maju
    let n = 0;
    (d as any).pane = () => (n++ < 20 ? DIALOG : DIALOG) + `\n#${n}`;
    const three = ask({
      total: 3,
      questions: [
        { header: "Basis", question: "Basis?", multiSelect: false, options: [{ label: "SQLite" }] },
        { header: "Auth", question: "Auth?", multiSelect: true, options: [{ label: "Cookie" }] },
        { header: "Deploy", question: "Deploy?", multiSelect: false, options: [{ label: "VPS" }] },
      ],
    });
    const r = await answerAsk(three, { decisionFile: "/m" }, d);
    expect((d.decide as any).mock.calls).toHaveLength(3);
    const flowIds = (d.decide as any).mock.calls.map((c: any[]) => c[0].flowId);
    expect(flowIds).toEqual([null, "f1", "f1"]);
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.clearMarker).toHaveBeenCalledWith("/m");
    expect(d.closeChain).toHaveBeenCalledWith("f1");
    expect(r.answered).toBe(true);
    expect(answerCount("s1")).toBe(1);       // satu PANGGILAN = satu jawaban otomatis
  });

  it("dialog tak pernah muncul → TIDAK mengetik apa pun (anti pesan liar SPEC-487)", async () => {
    const d = deps({ pane: () => "✻ Cooked for 40m 4s\n> " });
    const r = await answerAsk(ask(), { decisionFile: "/m" }, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.clearMarker).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
    expect(failureCount("s1")).toBe(1);
  });

  it("codex turn-end tanpa sinyal pertanyaan → diam (AC-9)", async () => {
    const d = deps({ pane: () => "> " });
    const r = await answerAsk(ask({ agent: "codex", source: "turn-end", questions: [], message: "Selesai. tokens used 8.180" }), { decisionFile: "/m" }, d);
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
  });

  it("codex turn-end DENGAN pertanyaan → prosa diketik ke kolom chat", async () => {
    const d = deps({ pane: () => "> " });
    const r = await answerAsk(ask({ agent: "codex", source: "turn-end", questions: [], message: "Pakai SQLite atau Postgres?" }), { decisionFile: "/m" }, d);
    expect((d.decide as any).mock.calls[0][0].question).toBe("Pakai SQLite atau Postgres?");
    expect(d.send).toHaveBeenCalled();
    expect(r.answered).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-detect-event.test.ts`
Expected: FAIL — `admitAsk`/`answerAsk` belum diekspor.

- [x] **Step 3: Tambahkan `readCodexTurn` di `pane.ts`**

Sesudah `readPaneQuestion`:

```ts
/**
 * SPEC-909 · ADR-0146 · gerbang "codex benar-benar bertanya", dinilai atas `last_assistant_message`
 * dari payload hook `Stop` — bukan atas `capture-pane`.
 *
 * Sumber yang lebih baik untuk pertanyaan yang sama: pesan giliran tak dipotong lebar pane (pane
 * sesi di mesin dev 52 kolom) dan tak tercampur sisa scrollback. Nol invokasi tmux. Ambangnya
 * TIDAK berubah — `CODEX_FINISHED` dan `ASK_SIGNALS` yang sama, supaya cakupan codex sesudah SPEC
 * ini setara dengan sebelumnya, bukan lebih longgar.
 */
export function readCodexTurn(message: string): { asking: boolean; reason: string } {
  const body = message.trim();
  if (!body) return { asking: false, reason: "giliran codex berakhir tanpa pesan" };
  if (CODEX_FINISHED.some((re) => re.test(body)))
    return { asking: false, reason: "sesi codex selesai wajar (ADR-0074)" };
  if (!ASK_SIGNALS.some((re) => re.test(body)))
    return { asking: false, reason: "tak ada sinyal pertanyaan di pesan giliran codex" };
  return { asking: true, reason: "" };
}
```

- [x] **Step 4: Rombak `detect.ts`**

**4a. Impor & pemangkasan.** Hapus `liveDecisions`, `markerFilled`, `getSession` dari impor `../pty`
(yang tersisa: `capturePane`, `clearMarker`, `sendToPane`, `submitPaneDialog`). Hapus `readPaneQuestion`
dari impor, ganti dengan `readCodexTurn`. Tambah `import type { SessionAsk } from "@hanoman/shared";`.

**4b. Konstanta.** Hapus `CHAIN_END_TRIES` dan seluruh blok komentarnya; hapus fungsi `settledPane`.
Tambahkan:

```ts
/**
 * SPEC-909 · ADR-0146 · berapa lama menunggu dialognya TERGAMBAR sesudah lead selesai memutuskan.
 *
 * `PreToolUse` menembak SEBELUM tool-nya jalan, jadi pada saat event tiba dialognya belum ada di
 * layar. Menunggunya praktis gratis: `decide()` sudah memakan detik sampai menit lebih dulu.
 * Habis tanpa dialog = BATAL, bukan jatuh ke jalur prosa — `sendToPane` akan mengetik prosa +
 * `Enter` ke kolom chat yang sudah normal, dan itu persis pesan liar SPEC-487.
 */
const DIALOG_WAIT_TRIES = 20;   // × CHAIN_POLL_MS = ±6 dtk
```

**4c. `DetectDeps` menyempit.** Hapus field `live`, `filled`, `agentOf` (tak ada lagi pemindaian;
agen datang dari `SessionAsk.agent`). Sisanya tetap. `prodDetectDeps` menyusut mengikuti.

**4d. Hapus `scanAndAnswer` dan `sweep`.** Ganti dengan:

```ts
export type AdmitResult = { ok: true } | { ok: false; reason: string };

/**
 * SPEC-909 · ADR-0146 · seluruh pagar tahap 1 `scanAndAnswer` yang lama, dinilai untuk SATU sesi.
 *
 * Kalimat, `kind`, dan `weighty` baris jejaknya sengaja tak berubah sehuruf pun: pagar yang "masih
 * menggigit" harus menggigit dengan bunyi yang sama, dan operator membaca jejak itu sebagai bukti.
 */
export async function admitAsk(
  s: { id: string; specId?: string; projectId: string },
  deps: DetectDeps = prodDetectDeps,
): Promise<AdmitResult> {
  const cfg = await deps.cfg();
  const no = (reason: string): AdmitResult => ({ ok: false, reason });
  if (!cfg.enabled || cfg.paused) return no("lead tidak aktif");
  if (!(await deps.optIn()).includes(s.projectId)) return no("project tak opt-in lead");
  if (!leadActive(cfg, s.projectId)) return no("lead dijeda untuk project ini");
  if (deps.exited(s.id)) return no("pane mati");                       // AC-10

  if ((answers.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {                // AC-11
    if (!capped.has(s.id)) {
      capped.add(s.id);
      const row = await recordDecision({
        projectId: s.projectId, specId: s.specId, sessionId: s.id,
        gate: "detected", kind: "quality",
        question: `Sesi ${s.id} sudah dijawab otomatis ${cfg.maxAutoAnswers}× berturut-turut.`,
        answer: "Berhenti menjawab sesi ini; serahkan ke operator.",
        reason: "Batas jawaban otomatis per sesi tercapai — pengulangan menandakan lead tak benar-benar membuka jalan buntunya (AC-11).",
        refs: [], confidence: "tinggi", action: "none", weighty: true,
      });
      await deps.notify(row.id, `Lead berhenti menjawab sesi ${s.id} (batas ${cfg.maxAutoAnswers}× tercapai)`,
        s.projectId, s.specId ?? null, s.id);
    }
    return no("batas jawaban otomatis tercapai");
  }

  // SPEC-487 · deret kegagalan PUTUS sesudah FAIL_COOLDOWN_MS tanpa kegagalan baru; tanpa ini
  // `failCapped` adalah keadaan MENYERAP dan tiga lonjakan beban menutup lead selamanya.
  const lastFail = failedAt.get(s.id);
  if (lastFail !== undefined && deps.now() - lastFail > FAIL_COOLDOWN_MS) {
    failures.delete(s.id); failCapped.delete(s.id); failedAt.delete(s.id);
  }

  if ((failures.get(s.id) ?? 0) >= cfg.maxAutoAnswers) {               // SPEC-472
    if (!failCapped.has(s.id)) {
      failCapped.add(s.id);
      const row = await recordDecision({
        projectId: s.projectId, specId: s.specId, sessionId: s.id,
        gate: "detected", kind: "quality",
        question: `Keputusan untuk sesi ${s.id} gagal disusun ${cfg.maxAutoAnswers}× berturut-turut.`,
        answer: "Berhenti mencoba; serahkan ke operator.",
        reason: "Kegagalan beruntun menandakan sebab yang tak hilang dengan mengulang (kunci/kuota agen, biner tak terpasang) — mencoba lagi tiap denyut hanya membakar kuota. Alasan percobaan terakhir ada di baris jejak `gagal` tepat di atas ini.",
        refs: [], confidence: "tinggi", action: "none", weighty: true,
      });
      await deps.notify(row.id, `Lead berhenti mencoba sesi ${s.id} (${cfg.maxAutoAnswers}× gagal berturut-turut)`,
        s.projectId, s.specId ?? null, s.id);
    }
    return no("batas kegagalan beruntun tercapai");
  }
  return { ok: true };
}
```

**4e. `answerAsk`** — pembungkus yang memegang penghitung, menggantikan blok `runPool` lama:

```ts
export type AskCtx = { projectId: string; specId?: string; decisionFile?: string };
export type AnswerAskResult = {
  answered: boolean; reason: string; at: number; flowId: string | null; step: number | null;
};

/**
 * Layani SATU event. Dipanggil pekerja `lead/ask.ts`, tak pernah melempar ke pemanggil.
 *
 * Penghitungnya persis seperti jalur lama: satu PANGGILAN `AskUserQuestion` = satu jawaban
 * otomatis (AC-11), keberhasilan memutus deret `failures` (SPEC-472), dan marker dikosongkan HANYA
 * saat seluruh rantainya tuntas (SPEC-452/474 — marker sebuah dialog hanya terisi sekali).
 */
export async function answerAsk(
  ask: SessionAsk, s: AskCtx, deps: DetectDeps = prodDetectDeps,
): Promise<AnswerAskResult> {
  const chain = await runChain(ask, s, deps);
  if (chain.acted && chain.done) {
    if (s.decisionFile) deps.clearMarker(s.decisionFile);
    answers.set(ask.sessionId, (answers.get(ask.sessionId) ?? 0) + 1);
    failures.delete(ask.sessionId);
    return { answered: true, reason: "", at: chain.at, flowId: chain.flowId, step: chain.step };
  }
  if (chain.failed) {
    failures.set(ask.sessionId, (failures.get(ask.sessionId) ?? 0) + 1);
    failedAt.set(ask.sessionId, deps.now());
  }
  return { answered: false, reason: chain.reason, at: chain.at, flowId: chain.flowId, step: chain.step };
}
```

**4f. `runChain` disuapi payload.** Ganti seluruh fungsi lama:

```ts
type ChainResult = {
  acted: boolean; done: boolean; failed: boolean; reason: string;
  at: number; flowId: string | null; step: number | null;
};

/**
 * SPEC-909 · ADR-0146 · satu panggilan `AskUserQuestion` = satu rantai = satu `LeadFlow`.
 *
 * Berapa langkahnya DIKETAHUI dari payload (`questions.length`, ≤ 4 per kontrak tool), bukan
 * ditebak dari layar — itulah yang mencabut `CHAIN_END_TRIES`. Yang tersisa dari layar hanya dua,
 * keduanya di dalam satu rantai yang sudah dipicu event: menunggu dialognya TERGAMBAR (§4b) dan
 * berpindah antar-tab (`waitScreenChange`) — terukur tak ada event di antara tab.
 */
async function runChain(ask: SessionAsk, s: AskCtx, deps: DetectDeps): Promise<ChainResult> {
  const sid = ask.sessionId;
  let flowId: string | null = chainFlows.get(sid) ?? null;
  let step: number | null = null;
  let acted = false;
  let at = 0;

  const close = async (r: ChainResult): Promise<ChainResult> => {
    const f = chainFlows.get(sid);
    if (f) { chainFlows.delete(sid); await deps.closeChain(f).catch(() => {}); }
    return { ...r, flowId, step };
  };
  const stop = (reason: string, o: Partial<ChainResult> = {}): ChainResult =>
    ({ acted, done: false, failed: false, reason, at, flowId, step, ...o });

  // codex: satu langkah prosa ke kolom chat. Gerbangnya pesan giliran, bukan layar (AC-9 utuh).
  if (ask.source === "turn-end") {
    const read = readCodexTurn(ask.message);
    if (!read.asking) return stop(read.reason);
  }

  const steps = ask.source === "ask-tool" ? ask.questions : [null];
  if (steps.length > MAX_CHAIN_STEPS) return stop("payload melebihi batas langkah rantai dialog");

  for (let i = 0; i < steps.length; i++) {
    at = i;
    const q = steps[i];
    const notes = [`Sesi ini menunggu di terminal. Jawablah sebagai masukan yang bisa langsung diketik ke terminal itu (isi \`reply\`).`];
    if (q?.options.length) {
      notes.push("Layarnya adalah dialog pilihan. Isi `choice` dengan nomor atau label opsi yang kamu pilih — server yang merangkai kalimat jawabannya dari label itu, jadi `reply` tak perlu mengulanginya.");
    }
    if (steps.length > 1) {
      notes.push(
        `Dialog ini BERANTAI: ${steps.length} pertanyaan dalam satu tanya `
        + `(${ask.questions.map((x) => x.header).join(", ")}). `
        + `Yang sedang tampil pertanyaan ke-${i + 1}; jawab HANYA pertanyaan itu — sisanya akan `
        + `ditanyakan sesudah ini.`,
      );
    }

    const req = {
      projectId: s.projectId, specId: s.specId, sessionId: sid,
      gate: "detected" as const, kind: "answer" as const,
      question: q ? q.question : ask.message,
      options: q?.options.length ? q.options.map((o) => o.label) : undefined,
      // SPEC-485 · ADR-0102 · `multiSelect` datang dari payload, jadi bentuk pilihannya tak perlu
      // disimpulkan dari kotak centang di layar lagi.
      select: q?.multiSelect ? { mode: "multi" as const, min: 1, max: null } : undefined,
      notes, chain: true,
    };

    let row: LeadDecision | null;
    try {
      row = await deps.decide({ ...req, flowId }, deps.decideDeps);
    } catch (e) {
      if (e instanceof LeadBusyError) return stop(`lead penuh — ${e.message}`);
      if (!(e instanceof LeadFlowClosedError)) throw e;
      chainFlows.delete(sid); flowId = null;
      try { row = await deps.decide({ ...req, flowId: null }, deps.decideDeps); }
      catch (e2) {
        if (e2 instanceof LeadBusyError) return stop(`lead penuh — ${e2.message}`);
        throw e2;
      }
    }
    if (row?.flowId) { flowId = row.flowId; chainFlows.set(sid, row.flowId); }
    if (row) step = row.step ?? step;
    if (!row) return stop("lead tak menghasilkan keputusan yang berlaku");
    if (row.status !== "berlaku")
      return stop("lead tak menghasilkan keputusan yang berlaku", { failed: true });

    // Dialog baru tergambar SESUDAH tool-nya jalan (§4b). Untuk codex tak ada dialog sama sekali.
    let before = "";
    if (ask.source === "ask-tool") {
      const text = await waitDialog(sid, deps);
      if (text === null)
        return stop("dialog tak muncul di pane — tak ada yang diketik", { failed: true });
      before = dialogKey(text);
    }

    const sent = deps.delivery(row.id);
    const reply = (sent ? leadReplyText(sent) : "") || row.answer;
    const picked = sent?.choices.map((c) => c.option) ?? [];
    if (!(await deps.send(sid, reply, picked)))
      return stop("gagal mengetik ke pane", { failed: true });
    acted = true;

    if (ask.source === "turn-end") return close({ acted, done: true, failed: false, reason: "", at, flowId, step });
    if (i < steps.length - 1 && !(await waitScreenChange(sid, before, deps)))
      return stop("layar dialog tak berubah sesudah dijawab", { failed: true });
  }

  // Layar rekap: langkah MEKANIS, tanpa agen — seluruh jawabannya sudah masuk.
  if (!(await deps.submit(sid)))
    return stop("gagal menekan Submit answers", { failed: true });
  return close({ acted: true, done: true, failed: false, reason: "", at, flowId, step });
}

/** Tangkapan pertama yang berupa dialog, atau `null` bila tak pernah muncul. */
async function waitDialog(id: string, deps: DetectDeps): Promise<string | null> {
  for (let i = 0; i < DIALOG_WAIT_TRIES; i++) {
    const text = deps.pane(id);
    if (readDialogScreen(text)) return text;
    await deps.sleep(CHAIN_POLL_MS);
  }
  return null;
}
```

**4g. `resetSession`/`__resetDetect`** tetap apa adanya (mereka juga mengosongkan `chainFlows`).
Karena `sweep()` hilang, pemangkasan sesi mati dilakukan `lead/ask.ts` (Task 6) lewat `resetSession`.

- [x] **Step 5: Jalankan test baru — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-detect-event.test.ts server/test/lead-pane.test.ts`
Expected: PASS.

- [x] **Step 6: Perbaiki `server/test/lead-detect.test.ts`**

Test lama menguji `scanAndAnswer`. Pindahkan tiap kasusnya ke `admitAsk`/`answerAsk` — jangan
dihapus: kasusnya (rantai dialog, `maxAutoAnswers`, kegagalan beruntun, gerbang penuh) adalah pagar
yang AC-7 tuntut tetap teruji. Kasus yang MEMANG kehilangan artinya (menyapu daftar sesi hidup,
gerbang marker/`readDialogScreen`, `sweep`) dihapus dengan satu baris komentar yang menyebut
SPEC-909 di kepala berkas.

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-detect.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/lead/detect.ts server/src/services/lead/pane.ts \
        server/test/lead-detect-event.test.ts server/test/lead-detect.test.ts server/test/lead-pane.test.ts
git commit -m "feat(lead): pintu deteksi disuapi payload — admitAsk/answerAsk, CHAIN_END_TRIES dicabut (SPEC-909)"
```

---

### Task 6: Registry tanya — idempotensi, batas laju, antrean berpekerja, takeover

**Files:**
- Create: `server/src/services/lead/ask.ts`
- Create: `server/test/lead-ask.test.ts`
- Modify: `server/src/services/lead/deciding.ts` (keadaan `takenOver`)

**Catatan siklus impor (mengikat):** `ask.ts` mengimpor `detect.ts`, dan `detect.ts` perlu membaca
bendera takeover di tengah rantai. Karena itu bendera itu hidup di **`deciding.ts`** — modul yang
sudah jadi rumah keadaan in-memory lead dan tak mengimpor apa pun dari `detect.ts`. `ask.ts` dan
`detect.ts` sama-sama mengimpor dari sana; tak ada satu pun siklus.

**Interfaces:**
- Consumes: `HookEvent`, `SessionAsk` (Task 1); `admitAsk`, `answerAsk`, `resetSession` (Task 5); `markQueued`/`clearQueued`/`markDeciding`/`clearDeciding` (sudah ada); `beginAnswer`/`endAnswer` dari `../session-dialog` (Task 9 memakai yang sama).
- Produces:
  - `intakeAsk(input: { sessionId; agent; projectId; specId?; decisionFile?; event: HookEvent }, deps?): Promise<IntakeResult>`
  - `type IntakeResult = { status: "accepted" } | { status: "duplicate" } | { status: "rate-limited" } | { status: "rejected"; reason: string }`
  - `liveAsks(): SessionAsk[]`
  - `takeOverAsk(sessionId: string): "taken" | "answering" | "none"` (di `ask.ts` — ia perlu tahu
    apakah ada tanya hidup)
  - `markTakenOver(sessionId)`, `isTakenOver(sessionId)`, `clearTakeover(sessionId)` (di
    `deciding.ts` — keadaannya, bukan aksinya)
  - `__resetAsks(): void`, `ASK_BUCKET`, `GLOBAL_BUCKET` (konstanta diekspor untuk test)

- [x] **Step 1: Tulis test yang gagal**

`server/test/lead-ask.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HookEvent } from "@hanoman/shared";
import {
  intakeAsk, liveAsks, takeOverAsk, isTakenOver, __resetAsks, type AskDeps,
} from "../src/services/lead/ask";

const EV: HookEvent = {
  source: "ask-tool", askId: "toolu_1", message: "",
  questions: [{ header: "Basis", question: "Basis?", multiSelect: false, options: [{ label: "SQLite" }] }],
};
const IN = (over: Partial<Parameters<typeof intakeAsk>[0]> = {}) => ({
  sessionId: "s1", agent: "claude" as const, projectId: "p1", specId: "SPEC-1",
  decisionFile: "/m", event: EV, ...over,
});

function deps(over: Partial<AskDeps> = {}): AskDeps {
  return {
    admit: vi.fn(async () => ({ ok: true as const })),
    answer: vi.fn(async () => ({ answered: true, reason: "", at: 0, flowId: "f1", step: 1 })),
    reset: vi.fn(),
    live: () => ["s1", "s2"],
    maxConcurrent: async () => 2,
    now: () => 1_000_000,
    ...over,
  };
}

beforeEach(() => { __resetAsks(); });

describe("intakeAsk", () => {
  it("menerima event sah dan menjalankan pekerjaannya sekali", async () => {
    const d = deps();
    expect(await intakeAsk(IN(), d)).toEqual({ status: "accepted" });
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
  });

  it("askId yang sama tak melahirkan keputusan kedua", async () => {
    const d = deps();
    await intakeAsk(IN(), d);
    expect(await intakeAsk(IN(), d)).toEqual({ status: "duplicate" });
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
  });

  it("dua event BERBEDA yang tiba bertumpuk = satu pekerjaan berjalan, yang kedua menyusul", async () => {
    let running = 0, maxRunning = 0;
    const d = deps({
      answer: vi.fn(async () => {
        running++; maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return { answered: true, reason: "", at: 0, flowId: null, step: null };
      }),
    });
    await intakeAsk(IN({ event: { ...EV, askId: "a" } }), d);
    await intakeAsk(IN({ event: { ...EV, askId: "b" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(maxRunning).toBe(1);          // satu sesi = satu pekerjaan, tak pernah dua paralel
  });

  it("membatasi laju per sesi — badai tak bisa jadi SPEC-472 versi baru", async () => {
    const d = deps();
    const out: string[] = [];
    for (let i = 0; i < 8; i++) out.push((await intakeAsk(IN({ event: { ...EV, askId: `x${i}` } }), d)).status);
    expect(out.filter((s) => s === "rate-limited").length).toBeGreaterThanOrEqual(3);
  });

  it("rantai LINTAS-PANGGILAN: event kedua jadi pekerjaan berikutnya, bukan tunggu layar", async () => {
    const d = deps();
    await intakeAsk(IN({ event: { ...EV, askId: "a" } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(1));
    await intakeAsk(IN({ event: { ...EV, askId: "b", questions: [
      { header: "Auth", question: "Auth?", multiSelect: false, options: [{ label: "Cookie" }] }] } }), d);
    await vi.waitFor(() => expect(d.answer).toHaveBeenCalledTimes(2));
    expect((d.answer as any).mock.calls[1][0].questions[0].question).toBe("Auth?");
  });

  it("429 TIDAK dihitung sebagai kegagalan lead — ia hilang dengan menunggu (SPEC-479)", async () => {
    const d = deps();
    for (let i = 0; i < 8; i++) await intakeAsk(IN({ event: { ...EV, askId: `y${i}` } }), d);
    // Ditolak batas laju tak boleh menyentuh pagar apa pun: nol baris jejak, nol notifikasi.
    expect(d.admit).toHaveBeenCalledTimes(5);      // hanya yang lolos ember yang menilai pagar
  });

  it("event yang ditolak pagar tak pernah memanggil answer", async () => {
    const d = deps({ admit: vi.fn(async () => ({ ok: false as const, reason: "project tak opt-in lead" })) });
    expect(await intakeAsk(IN(), d)).toEqual({ status: "rejected", reason: "project tak opt-in lead" });
    expect(d.answer).not.toHaveBeenCalled();
  });

  it("memangkas penghitung sesi yang sudah tak hidup", async () => {
    const d = deps({ live: () => ["s1"] });
    await intakeAsk(IN(), d);
    await vi.waitFor(() => expect(d.reset).toHaveBeenCalledWith("s2"));
  });
});

describe("liveAsks — sumber frame siar leadAsks", () => {
  it("memancarkan tanya yang sedang dikerjakan dengan langkah & total", async () => {
    const d = deps();
    await intakeAsk(IN(), d);
    const a = liveAsks().find((x) => x.sessionId === "s1")!;
    expect(a).toMatchObject({ sessionId: "s1", agent: "claude", source: "ask-tool", total: 1, askId: "toolu_1" });
    expect(a.questions[0].question).toBe("Basis?");
    expect(["queued", "deciding", "answered"]).toContain(a.state);
  });

  it("codex memancarkan pesan giliran, bukan pertanyaan palsu", async () => {
    const d = deps();
    await intakeAsk(IN({
      sessionId: "s2", agent: "codex",
      event: { source: "turn-end", askId: "t1", questions: [], message: "Pakai SQLite atau Postgres?" },
    }), d);
    const a = liveAsks().find((x) => x.sessionId === "s2")!;
    expect(a.questions).toEqual([]);
    expect(a.message).toBe("Pakai SQLite atau Postgres?");
    expect(a.total).toBe(1);
  });
});

describe("takeOverAsk", () => {
  it("mengambil alih sebelum lead memegang pane", async () => {
    const d = deps({ answer: vi.fn(async () => new Promise(() => {})) as any });
    await intakeAsk(IN(), d);
    expect(takeOverAsk("s1")).toBe("taken");
    expect(isTakenOver("s1")).toBe(true);
    expect(liveAsks().find((x) => x.sessionId === "s1")!.state).toBe("taken-over");
  });

  it("kalah saat lead sudah mengetik — penolakan yang jelas, bukan dua jawaban", async () => {
    const { beginAnswer, endAnswer } = await import("../src/services/session-dialog");
    const d = deps();
    await intakeAsk(IN(), d);
    expect(beginAnswer("s1")).toBe(true);      // seolah lead sedang mengetik
    expect(takeOverAsk("s1")).toBe("answering");
    endAnswer("s1");
  });

  it("sesi tanpa tanya hidup → none", () => {
    expect(takeOverAsk("entah")).toBe("none");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-ask.test.ts`
Expected: FAIL — modul `lead/ask` tak ada.

- [x] **Step 3: Tambahkan keadaan takeover di `deciding.ts`**

Sesudah blok `queued`:

```ts
/**
 * SPEC-909 · ADR-0146 · AC-6 · sesi yang DIREBUT operator dari lead.
 *
 * Keadaan KEEMPAT di modul ini, dan rumahnya di sini bukan di `lead/ask.ts` karena `detect.ts`
 * harus membacanya di tengah rantai — sementara `ask.ts` sudah mengimpor `detect.ts`. Menaruhnya
 * di sana melahirkan siklus impor; menaruhnya di sini tidak.
 *
 * In-memory dengan alasan yang sama seperti `deciding`/`queued`: ia berumur satu episode dan mati
 * bersama proses lead. Single-process (ADR-0024).
 */
const takenOver = new Set<string>();

export function markTakenOver(sessionId: string): void { takenOver.add(sessionId); }
export function isTakenOver(sessionId: string): boolean { return takenOver.has(sessionId); }
export function clearTakeover(sessionId: string): void { takenOver.delete(sessionId); }
```

dan tambahkan `takenOver.clear();` ke `__resetDeciding()`.

- [x] **Step 4: Tulis `server/src/services/lead/ask.ts`**

```ts
import type { Agent, HookEvent, SessionAsk } from "@hanoman/shared";
import { getLead } from "./config";
import { admitAsk, answerAsk, resetSession, type AdmitResult } from "./detect";
import {
  markDeciding, clearDeciding, markQueued, clearQueued,
  markTakenOver, isTakenOver, clearTakeover,
} from "./deciding";
import { beginAnswer, endAnswer } from "../session-dialog";
import { listSessions } from "../pty";

// SPEC-909 · ADR-0146 · SATU-SATUNYA pemilik keadaan event pintu deteksi.
//
// In-memory dan sengaja begitu, dengan alasan yang sama seperti `lead/deciding.ts`: keadaan ini
// berumur satu episode dan tak boleh selamat dari restart server — pertanyaan yang tercatat di sini
// sesudah proses lead mati akan berbohong selamanya. Single-process (ADR-0024), jadi Map/Set biasa
// sudah cukup dan tak ada queue/worker/cron baru.

/** Ember token per sesi: 5 sekaligus, isi ulang 1 per 10 dtk (≤ 6/menit langgeng). */
export const ASK_BUCKET = { capacity: 5, refillMs: 10_000 };
/** Ember global: pagar terakhir bila banyak sesi meledak bersamaan. */
export const GLOBAL_BUCKET = { capacity: 20, refillMs: 500 };
/** Berapa `askId` terakhir diingat untuk idempotensi. */
const SEEN_MAX = 512;

type Entry = {
  ask: SessionAsk;
  ctx: { projectId: string; specId?: string; decisionFile?: string };
  /** Event yang tiba selagi sesi ini dikerjakan — yang TERBARU menang. */
  pending: { ask: SessionAsk; ctx: Entry["ctx"] } | null;
  running: boolean;
};

const entries = new Map<string, Entry>();
const seen: string[] = [];
const seenSet = new Set<string>();

type Bucket = { tokens: number; at: number };
const perSession = new Map<string, Bucket>();
let global: Bucket = { tokens: GLOBAL_BUCKET.capacity, at: 0 };

function take(b: Bucket, spec: { capacity: number; refillMs: number }, now: number): boolean {
  if (b.at === 0) b.at = now;
  const gained = Math.floor((now - b.at) / spec.refillMs);
  if (gained > 0) { b.tokens = Math.min(spec.capacity, b.tokens + gained); b.at += gained * spec.refillMs; }
  if (b.tokens <= 0) return false;
  b.tokens--;
  return true;
}

export type IntakeResult =
  | { status: "accepted" } | { status: "duplicate" }
  | { status: "rate-limited" } | { status: "rejected"; reason: string };

export type AskDeps = {
  admit: (s: { id: string; specId?: string; projectId: string }) => Promise<AdmitResult>;
  answer: (ask: SessionAsk, ctx: { projectId: string; specId?: string; decisionFile?: string })
    => Promise<{ answered: boolean; reason: string; at: number; flowId: string | null; step: number | null }>;
  reset: (sessionId: string) => void;
  live: () => string[];
  maxConcurrent: () => Promise<number>;
  now: () => number;
};

export const prodAskDeps: AskDeps = {
  admit: (s) => admitAsk(s),
  answer: (ask, ctx) => answerAsk(ask, ctx),
  reset: resetSession,
  // SPEC-402 · bacaan tmux yang gagal tak boleh berarti "semua sesi berakhir": daftar kosong akan
  // memangkas penghitung sesi yang sebenarnya hidup, dan pagar AC-11 lahir kembali dari nol.
  live: () => { try { return listSessions().filter((s) => !s.exited).map((s) => s.id); } catch { return [...entries.keys()]; } },
  maxConcurrent: async () => (await getLead()).maxConcurrent,
  now: Date.now,
};

export function __resetAsks(): void {
  entries.clear(); seen.length = 0; seenSet.clear();
  perSession.clear(); global = { tokens: GLOBAL_BUCKET.capacity, at: 0 };
  inFlight = 0; waiting.length = 0;
}

/** Daftar tanya hidup — sumber frame siar `leadAsks` (ADR-0039, tanpa kanal baru). */
export function liveAsks(): SessionAsk[] {
  return [...entries.values()].map((e) => ({
    ...e.ask,
    // Status lead dibaca dari sumber yang SUDAH ada; menyalinnya ke sini akan melahirkan definisi
    // kedua yang bisa berselisih dengan panel lead & pil terminal.
    state: isTakenOver(e.ask.sessionId) ? "taken-over" : e.ask.state,
  }));
}

/**
 * AC-6 · operator merebut sesi dari lead.
 *
 * Pemenangnya ditentukan `beginAnswer()` — `Set` sinkron yang SAMA yang sudah mencegah dua POST
 * manusia menyilangkan keystroke (ADR-0142 §5). Begitu lead memegangnya, takeover kalah dengan
 * penolakan yang jelas; sebelum itu, lead yang kalah dan batal sebelum satu byte pun keluar.
 */
export function takeOverAsk(sessionId: string): "taken" | "answering" | "none" {
  const e = entries.get(sessionId);
  if (!e) return "none";
  if (!beginAnswer(sessionId)) return "answering";
  endAnswer(sessionId);
  markTakenOver(sessionId);
  e.ask = { ...e.ask, state: "taken-over" };
  return "taken";
}

const toAsk = (o: { sessionId: string; agent: Agent; event: HookEvent; now: number }): SessionAsk => ({
  sessionId: o.sessionId, agent: o.agent, source: o.event.source, askId: o.event.askId,
  askedAt: new Date(o.now).toISOString(),
  questions: o.event.questions, message: o.event.message,
  at: 0, total: Math.max(1, o.event.questions.length),
  state: "queued", flowId: null, step: null,
});

export async function intakeAsk(
  input: {
    sessionId: string; agent: Agent; projectId: string; specId?: string; decisionFile?: string;
    event: HookEvent;
  },
  deps: AskDeps = prodAskDeps,
): Promise<IntakeResult> {
  const now = deps.now();
  const key = `${input.sessionId}:${input.event.askId}`;
  if (seenSet.has(key)) return { status: "duplicate" };

  const bucket = perSession.get(input.sessionId) ?? { tokens: ASK_BUCKET.capacity, at: now };
  perSession.set(input.sessionId, bucket);
  // Batas laju SEBELUM pagar: menolak karena ramai tak boleh menulis baris jejak maupun
  // menotifikasi — ia hilang dengan menunggu, persis seperti `LeadBusyError` (SPEC-479).
  if (!take(bucket, ASK_BUCKET, now) || !take(global, GLOBAL_BUCKET, now))
    return { status: "rate-limited" };

  const verdict = await deps.admit({
    id: input.sessionId, specId: input.specId, projectId: input.projectId,
  });
  if (!verdict.ok) return { status: "rejected", reason: verdict.reason };

  seenSet.add(key); seen.push(key);
  while (seen.length > SEEN_MAX) { const old = seen.shift()!; seenSet.delete(old); }
  clearTakeover(input.sessionId);

  const ctx = { projectId: input.projectId, specId: input.specId, decisionFile: input.decisionFile };
  const ask = toAsk({ sessionId: input.sessionId, agent: input.agent, event: input.event, now });
  const cur = entries.get(input.sessionId);
  if (cur?.running) { cur.pending = { ask, ctx }; return { status: "accepted" }; }
  entries.set(input.sessionId, { ask, ctx, pending: null, running: false });

  prune(deps);
  void run(input.sessionId, deps);
  return { status: "accepted" };
}

/** Buang penghitung sesi yang sudah tak hidup — pengganti `sweep()` yang dulu ikut pemindaian. */
function prune(deps: AskDeps): void {
  const live = new Set(deps.live());
  for (const id of [...entries.keys()]) {
    if (live.has(id)) continue;
    entries.delete(id); perSession.delete(id); clearTakeover(id);
    deps.reset(id);
  }
}

// Kolam pekerja: batas yang SAMA dengan `runPool(ready, cfg.maxConcurrent)` yang digantikannya —
// yang berubah cuma umur antreannya, bukan angkanya. Satu rantai dialog mem-poll pane sampai 20×
// per langkah dan `tmux()` memblokir event loop 6,28 ms per panggilan; fan-out tanpa batas menukar
// kelaparan dengan server yang tersendat.
let inFlight = 0;
const waiting: string[] = [];

async function run(sessionId: string, deps: AskDeps): Promise<void> {
  const cap = Math.max(1, await deps.maxConcurrent().catch(() => 1));
  if (inFlight >= cap) { if (!waiting.includes(sessionId)) waiting.push(sessionId); return; }
  const e = entries.get(sessionId);
  if (!e || e.running) return;
  e.running = true;
  inFlight++;
  markQueued(sessionId);
  try {
    while (true) {
      if (isTakenOver(sessionId)) { e.ask = { ...e.ask, state: "taken-over" }; break; }
      clearQueued(sessionId); markDeciding(sessionId);
      e.ask = { ...e.ask, state: "deciding" };
      const r = await deps.answer(e.ask, e.ctx).catch((err) => {
        console.error("lead ask:", err);
        return { answered: false, reason: "kesalahan tak terduga", at: 0, flowId: null, step: null };
      });
      clearDeciding(sessionId);
      e.ask = { ...e.ask, at: r.at, flowId: r.flowId, step: r.step, state: r.answered ? "answered" : "failed" };
      if (!e.pending) break;
      const next = e.pending; e.pending = null;
      e.ask = next.ask; e.ctx = next.ctx;
    }
  } finally {
    clearQueued(sessionId); clearDeciding(sessionId);
    e.running = false;
    inFlight--;
    const nextId = waiting.shift();
    if (nextId) void run(nextId, deps);
  }
}
```

- [x] **Step 5: Jalankan test — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-ask.test.ts server/test/lead-deciding.test.ts`
Expected: PASS, 13 test baru + test `lead-deciding` yang lama tetap hijau.

- [x] **Step 6: Commit**

```bash
git add server/src/services/lead/ask.ts server/src/services/lead/deciding.ts server/test/lead-ask.test.ts
git commit -m "feat(lead): registry tanya — idempotensi, batas laju, antrean berpekerja, takeover (SPEC-909)"
```

---

### Task 7: Route `POST /api/session-events` + jalur auth-nya

**Files:**
- Create: `server/src/routes/session-events.ts`
- Create: `server/test/session-events.route.test.ts`
- Modify: `server/src/app.ts` (bypass gate cookie + daftar route)
- Modify: `server/src/services/agent-capabilities.ts:29-30` (`session-events` → `COOKIE_ONLY`)
- Modify: `server/test/agent-capabilities.test.ts`, `server/test/parity-endpoints.test.ts`, `server/test/client-route-allowed.test.ts`

**Interfaces:**
- Consumes: `parseHookEvent` (Task 1), `verifySessionEventToken` (Task 2), `getSessionAsync` (Task 3), `intakeAsk` (Task 6).
- Produces: `POST /api/session-events` → `202 {accepted:true}` · `202 {ignored:true}` · `202 {duplicate:true}` · `202 {rejected:true, reason}` · `400` · `401` · `404` · `429`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/session-events.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { sessionEventToken } from "../src/services/session-event-token";
import { __resetAsks } from "../src/services/lead/ask";

vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSessionAsync: vi.fn(async (id: string) =>
    id === "s1" ? { id: "s1", projectId: "p1", specId: "SPEC-1", exited: false, agent: "claude",
                    decisionFile: "/m", cwd: "/w" } as any
    : id === "dead" ? { id: "dead", projectId: "p1", exited: true, agent: "claude" } as any
    : undefined),
}));

const CLAUDE = {
  hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_1",
  tool_input: { questions: [{ question: "Basis?", header: "Basis", multiSelect: false,
    options: [{ label: "SQLite" }] }] },
};

const post = (app: any, body: unknown, headers: Record<string, string>) =>
  app.inject({ method: "POST", url: "/api/session-events", payload: body, headers });

const auth = (id: string) => ({
  authorization: `Bearer ${sessionEventToken(id)}`, "x-hanoman-session": id,
});

beforeEach(() => { __resetAsks(); });

describe("POST /api/session-events", () => {
  it("menerima event bertoken sah", async () => {
    const app = buildApp();
    const r = await post(app, CLAUDE, auth("s1"));
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("401 tanpa Authorization — id sesi saja tak pernah cukup", async () => {
    const app = buildApp();
    const r = await post(app, CLAUDE, { "x-hanoman-session": "s1" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("401 dengan token milik sesi LAIN", async () => {
    const app = buildApp();
    const r = await post(app, CLAUDE, {
      authorization: `Bearer ${sessionEventToken("s2")}`, "x-hanoman-session": "s1",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("404 untuk sesi yang tak hidup", async () => {
    const app = buildApp();
    expect((await post(app, CLAUDE, auth("dead"))).statusCode).toBe(404);
    expect((await post(app, CLAUDE, auth("entah"))).statusCode).toBe(404);
    await app.close();
  });

  it("202 ignored untuk event yang bukan pertanyaan", async () => {
    const app = buildApp();
    const r = await post(app, { ...CLAUDE, tool_name: "Bash" }, auth("s1"));
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ ignored: true });
    await app.close();
  });

  it("202 duplicate untuk tool_use_id yang sama", async () => {
    const app = buildApp();
    await post(app, CLAUDE, auth("s1"));
    expect((await post(app, CLAUDE, auth("s1"))).json()).toEqual({ duplicate: true });
    await app.close();
  });

  it("429 saat ember token per sesi habis", async () => {
    const app = buildApp();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++)
      codes.push((await post(app, { ...CLAUDE, tool_use_id: `t${i}` }, auth("s1"))).statusCode);
    expect(codes).toContain(429);
    await app.close();
  });

  it("403 untuk agent token — memalsukan pertanyaan bukan capability apa pun", async () => {
    const { checkAgentCapability } = await import("../src/services/agent-capabilities");
    expect(checkAgentCapability(["lead:write", "sessions:write"], "POST", "/api/session-events"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-events.route.test.ts`
Expected: FAIL — 404 untuk semuanya (route belum ada).

- [x] **Step 3: Tulis route**

`server/src/routes/session-events.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { parseHookEvent } from "@hanoman/shared";
import { verifySessionEventToken } from "../services/session-event-token";
import { getSessionAsync } from "../services/pty";
import { intakeAsk } from "../services/lead/ask";

// SPEC-909 · ADR-0146 · pintu masuk event pertanyaan sesi.
//
// Prefix SENDIRI, bukan sub-path `/api/lead`, dan itu keputusan keamanan: `capabilityForRoute`
// memetakan seluruh prefix `lead` ke `rw("lead")`, jadi di sana setiap agent token pemegang
// `lead:write` bisa MEMALSUKAN pertanyaan atas nama sesi mana pun dan menggerakkan lead. Prefix ini
// dipetakan eksplisit ke `COOKIE_ONLY`; kredensialnya bukan cookie dan bukan agent token melainkan
// token turunan per sesi, jadi gate cookie di app.ts mem-bypass-nya — pola yang sama dengan
// `/api/sync` (device token) dan `/api/help` (kunci tiket).

export default async function (app: FastifyInstance) {
  app.post("/session-events", async (req, reply) => {
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    const sessionId = String(req.headers["x-hanoman-session"] ?? "");
    // Identitas datang dari HEADER, bukan dari body: body adalah kontrak agen yang bentuknya bisa
    // berubah tiap rilis, sementara header ini kontrak kita sendiri. `session_id` di dalam payload
    // adalah id internal agen dan tak pernah berarti sesi hanoman.
    if (!sessionId || !given || !verifySessionEventToken(sessionId, given))
      return reply.code(401).send({ error: "unauthorized" });

    const s = await getSessionAsync(sessionId);
    if (!s || s.exited) return reply.code(404).send({ error: "live session not found" });

    const event = parseHookEvent(req.body);
    // Bukan 400: hook mengirim SETIAP tembakan `Stop`/`PreToolUse` yang cocok, dan sebagian besar
    // memang bukan pertanyaan. Menjawabnya error akan membuat log sesi penuh kegagalan palsu.
    if (!event) return reply.code(202).send({ ignored: true });

    const r = await intakeAsk({
      sessionId, agent: s.agent, projectId: s.projectId, specId: s.specId,
      decisionFile: s.decisionFile, event,
    });
    if (r.status === "duplicate") return reply.code(202).send({ duplicate: true });
    if (r.status === "rate-limited") return reply.code(429).send({ error: "terlalu banyak event" });
    if (r.status === "rejected") return reply.code(202).send({ rejected: true, reason: r.reason });
    return reply.code(202).send({ accepted: true });
  });
}
```

- [x] **Step 4: Daftarkan route & bypass gate**

`server/src/app.ts` — impor + registrasi bersama route lain di scope `/api`:

```ts
import sessionEvents from "./routes/session-events";
```

```ts
    await api.register(sessionEvents);
```

Di hook `onRequest` gate, tepat SESUDAH baris bypass `/api/sync` dan SEBELUM `/api/help`:

```ts
        // SPEC-909 · ADR-0146 · event hook sesi: kredensialnya token turunan per sesi, di-enforce
        // route-nya sendiri (pola /api/sync device token). `capabilityForRoute` memetakannya ke
        // COOKIE_ONLY, jadi agent token tetap 403 — memalsukan pertanyaan bukan capability apa pun.
        if (path === "/api/session-events") return;
```

`server/src/services/agent-capabilities.ts` — tambahkan `session-events` ke daftar COOKIE_ONLY:

```ts
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
    || top === "portal" || top === "client-accounts" || top === "session-events") return "COOKIE_ONLY";
```

- [x] **Step 5: Perbarui tiga allowlist yang harus tetap sepakat**

Route baru gagal senyap kalau salah satu ketinggalan:

- `server/test/agent-capabilities.test.ts` — tambah kasus `POST /api/session-events` → `COOKIE_ONLY`.
- `server/test/parity-endpoints.test.ts` — daftarkan route baru sesuai bentuk berkas itu.
- `server/test/client-route-allowed.test.ts` — pastikan akun `client` **tidak** boleh (deny-by-default sudah berlaku; test menegaskannya).

- [x] **Step 6: Jalankan test — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-events.route.test.ts server/test/agent-capabilities.test.ts server/test/parity-endpoints.test.ts server/test/client-route-allowed.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/routes/session-events.ts server/src/app.ts server/src/services/agent-capabilities.ts \
        server/test/session-events.route.test.ts server/test/agent-capabilities.test.ts \
        server/test/parity-endpoints.test.ts server/test/client-route-allowed.test.ts
git commit -m "feat(lead): POST /api/session-events bertoken sesi, di luar jangkauan agent token (SPEC-909)"
```

---

### Task 8: Engine berhenti memindai; sesi pra-pembaruan dinyatakan

**Files:**
- Modify: `server/src/services/lead/engine.ts`
- Modify: `server/src/services/notifications.ts` (tambah `recordLegacySession`)
- Modify: `server/test/lead-engine.test.ts`

**Interfaces:**
- Consumes: `expireFlows`, `pulse` (sudah ada); `liveDecisions` dari `../pty`.
- Produces: `HOUSEKEEPING_MS` (menggantikan `TICK_MS`), `LeadTickDeps.legacy?`, `recordLegacySession(sessionId, projectId, specId)`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/lead-engine.test.ts`:

```ts
import { tick, __resetEngine, HOUSEKEEPING_MS } from "../src/services/lead/engine";
// `LEAD` = objek setelan lead yang sudah dipakai berkas test ini; kalau belum ada, salin bentuk
// `LEAD` dari server/test/lead-detect-event.test.ts.

describe("SPEC-909 · tick tak lagi memindai sesi", () => {
  it("iramanya rumah tangga, bukan 5 detik", () => {
    expect(HOUSEKEEPING_MS).toBe(60_000);
  });

  it("expireFlows tetap jalan, tanpa gerbang paused", async () => {
    __resetEngine();
    const expire = vi.fn(async () => []);
    await tick(0, { expire, cfg: async () => ({ ...LEAD, paused: true }) } as any);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("menotifikasi SEKALI sesi hidup yang lahir tanpa hook event", async () => {
    __resetEngine();
    const legacy = vi.fn(async () => {});
    const live = () => [
      { id: "lama", projectId: "p1", specId: "SPEC-1", decisionFile: "/m", waiting: true, eventHook: false },
      { id: "baru", projectId: "p1", specId: "SPEC-2", decisionFile: "/m", waiting: true, eventHook: true },
    ];
    await tick(0, { legacy, live } as any);
    await tick(HOUSEKEEPING_MS, { legacy, live } as any);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledWith("lama", "p1", "SPEC-1");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-engine.test.ts`
Expected: FAIL — `HOUSEKEEPING_MS` tak diekspor.

- [x] **Step 3: `liveDecisions` ikut membawa `eventHook`**

`server/src/services/pty.ts` — tambahkan `eventHook: p.eventHook` ke objek yang dipancarkan
`liveDecisions()`, dan ke tipe kembaliannya. `notifications.ts` `DecisionSession` boleh tetap
tak mengenalnya (field ekstra tak mengganggu structural typing).

- [x] **Step 4: Tulis `recordLegacySession` di `notifications.ts`**

Sesudah `recordLeadDecision`:

```ts
// SPEC-909 · ADR-0146 · sesi yang lahir SEBELUM pembaruan tak punya hook event, dan pemindainya
// sudah dicabut — jadi hanoman-lead tak akan menjawabnya. Menyisakan pemindai "hanya untuk sesi
// lama" berarti mempertahankan persis biaya yang dicabut SPEC ini, untuk populasi yang menyusut
// sendiri. Yang tak boleh terjadi adalah sesi menggantung tanpa siapa pun tahu.
//
// `key` unik → P2002 mendedup SEKALI SEUMUR SESI, termasuk lintas restart server. Itu sebabnya
// dedupnya di DB, bukan `Set` di memori (pelajaran ADR-0091 gotcha 2).
export async function recordLegacySession(
  sessionId: string, projectId: string | null, specId: string | null,
): Promise<void> {
  await prisma.notification.create({
    data: {
      type: "lead", key: `lead-legacy:${sessionId}`, sessionId, specId, projectId,
      title: `Sesi ${sessionId} lahir sebelum pembaruan dan tak memasang hook event — hanoman-lead tak akan menjawabnya. Jawab dari panel pet atau terminal, atau mulai ulang sesinya.`,
    },
  }).catch(() => { /* P2002: sudah pernah diberitahukan untuk sesi ini */ });
}
```

- [x] **Step 5: Rombak `engine.ts`**

Ganti kepala berkas & tick:

```ts
import { getLead } from "./config";
import { pulse, prodPulseDeps, type PulseDeps } from "./pulse";
import { expireFlows } from "./flow";
import { recordLeadDecision, recordLegacySession } from "../notifications";
import { liveDecisions } from "../pty";

// SPEC-409 · ADR-0091 · SPEC-909 · ADR-0146 · irama hanoman-lead.
//
// ADR-0091 §5 memberi dua irama: pintu deteksi tiap 5 detik dan denyut proaktif tiap `everyMin`.
// Irama pertama DICABUT — pertanyaan sesi kini tiba sebagai event hook (`routes/session-events.ts`)
// dan tak pernah menunggu giliran timer mana pun. Yang tersisa satu irama RUMAH TANGGA: menyapu
// rantai kedaluwarsa, menagih denyut yang jatuh tempo, dan memberi tahu sesi pra-pembaruan.
//
// Jumlah timer BERKURANG, bukan bertambah — ADR-0024 utuh, dan tak ada kanal WS baru (ADR-0039).
export const HOUSEKEEPING_MS = 60_000;
```

Buang `busyDetect` dan seluruh blok `scanAndAnswer` dari `tick`. Tambahkan blok sesi pra-pembaruan
dan sesuaikan `LeadTickDeps`:

```ts
export type LeadTickDeps = {
  pulse?: PulseDeps;
  now?: () => number;
  expire?: (now: Date) => Promise<{ id: string; projectId: string; specId: string | null; sessionId: string | null; title: string }[]>;
  notify?: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  /** SPEC-909 · sesi hidup + apakah ia lahir dengan hook event. */
  live?: () => { id: string; projectId: string; specId?: string; waiting: boolean; eventHook: boolean }[];
  legacy?: (sessionId: string, projectId: string | null, specId: string | null) => Promise<void>;
  cfg?: () => Promise<Lead>;
};
```

```ts
  // SPEC-909 · ADR-0146 · sesi pra-pembaruan. Nol `capture-pane`, nol panggilan agen: satu
  // `tmux list-panes -a` yang sudah dilakukan `liveDecisions()`, sekali per menit. Digantung di
  // tick LEAD, bukan pada `scanDecisions()` milik scheduler: jalur itu memulangkan tick lebih dulu
  // saat master switch scheduler mati, dan sesi yang menggantung tak boleh bergantung pada setelan
  // subsistem lain.
  jobs.push((async () => {
    const live = deps.live ?? (() => liveDecisions());
    const legacy = deps.legacy ?? recordLegacySession;
    for (const s of live()) {
      if (s.eventHook || !s.waiting) continue;
      await legacy(s.id, s.projectId || null, s.specId ?? null);
    }
  })().catch((e) => { console.error("lead legacy:", e); }));
```

`startLead` memakai `HOUSEKEEPING_MS`; `stopLead` tak berubah.

- [x] **Step 6: Jalankan test — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-engine.test.ts server/test/lead-engine-argv.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/lead/engine.ts server/src/services/notifications.ts \
        server/src/services/pty.ts server/test/lead-engine.test.ts
git commit -m "feat(lead): tick berhenti memindai sesi; sesi pra-pembaruan dinyatakan sekali (SPEC-909)"
```

---

### Task 9: Ambil alih — route + jalur lead ikut `beginAnswer`

**Files:**
- Modify: `server/src/routes/terminal.ts` (route takeover; gerbang `taken-over` di jalur jawab)
- Modify: `server/src/services/lead/detect.ts` (`deps.send` dibungkus `beginAnswer`/`endAnswer`)
- Modify: `shared/src/api.ts` (`paths.terminalDialogTakeover`)
- Modify: `src/src/api/client.ts` (`takeoverSessionDialog`)
- Create: `server/test/terminal-takeover.route.test.ts`

**Interfaces:**
- Consumes: `takeOverAsk`, `isTakenOver` (Task 6); `beginAnswer`/`endAnswer` (sudah ada).
- Produces:
  - `POST /api/terminal/sessions/:id/dialog/takeover` → `202 {accepted:true}` · `409 {reason:"answering"}` · `404`
  - `paths.terminalDialogTakeover(id)`, `api.takeoverSessionDialog(id)`

- [x] **Step 1: Tulis test yang gagal**

`server/test/terminal-takeover.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { __resetAsks, intakeAsk, isTakenOver } from "../src/services/lead/ask";
import { beginAnswer, endAnswer } from "../src/services/session-dialog";

vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSession: vi.fn((id: string) =>
    id === "s1" ? { id: "s1", projectId: "p1", exited: false, agent: "claude", decisionFile: "/m" } as any : undefined),
}));

const EV = { source: "ask-tool" as const, askId: "t1", message: "",
  questions: [{ header: "H", question: "Q?", multiSelect: false, options: [{ label: "A" }] }] };

const url = "/api/terminal/sessions/s1/dialog/takeover";
beforeEach(() => { __resetAsks(); });

describe("POST /terminal/sessions/:id/dialog/takeover", () => {
  it("202 dan lead berhenti sebelum mengetik", async () => {
    const app = buildApp({ requireAuth: false });
    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV },
      { admit: async () => ({ ok: true }), answer: () => new Promise(() => {}),
        reset: () => {}, live: () => ["s1"], maxConcurrent: async () => 1, now: () => 1 } as any);
    const r = await app.inject({ method: "POST", url });
    expect(r.statusCode).toBe(202);
    expect(isTakenOver("s1")).toBe(true);
    await app.close();
  });

  it("409 answering saat lead sudah memegang pane — bukan dua jawaban ke pane yang sama", async () => {
    const app = buildApp({ requireAuth: false });
    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV },
      { admit: async () => ({ ok: true }), answer: () => new Promise(() => {}),
        reset: () => {}, live: () => ["s1"], maxConcurrent: async () => 1, now: () => 1 } as any);
    expect(beginAnswer("s1")).toBe(true);
    const r = await app.inject({ method: "POST", url });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("answering");
    endAnswer("s1");
    await app.close();
  });

  it("404 saat tak ada tanya hidup untuk sesi itu", async () => {
    const app = buildApp({ requireAuth: false });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(404);
    await app.close();
  });

  it("sesudah diambil alih, jawaban operator TIDAK lagi ditolak 409 deciding", async () => {
    // Gerbang `isDeciding` (ADR-0142 §5) tetap berlaku untuk sesi yang BELUM diambil alih.
    const { isDeciding } = await import("../src/services/lead/deciding");
    expect(typeof isDeciding).toBe("function");
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal-takeover.route.test.ts`
Expected: FAIL — 404 pada semua kasus (route belum ada).

- [x] **Step 3: Tulis route**

`server/src/routes/terminal.ts`, tepat sesudah `POST …/dialog/answer`:

```ts
  // SPEC-909 · ADR-0146 · AC-6 · operator merebut sesi dari hanoman-lead SEBELUM lead mengetik ke
  // pane. Di bawah prefix `terminal` supaya capability-nya turun dari peta yang sudah ada
  // (`rw("sessions")` → sessions:write, sama dengan menjawab dialog): siapa yang boleh menjawab,
  // boleh mengambil alih. Pemenang perebutannya ditentukan `beginAnswer()` — Set sinkron yang sama
  // yang mencegah dua POST manusia menyilangkan keystroke (ADR-0142 §5).
  app.post("/terminal/sessions/:id/dialog/takeover", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = takeOverAsk(id);
    if (r === "none") return reply.code(404).send({ error: "tak ada pertanyaan hidup untuk sesi ini" });
    if (r === "answering")
      return reply.code(409)
        .send({ error: "hanoman-lead sudah mengirim jawabannya ke pane", reason: "answering" });
    return reply.code(202).send({ accepted: true });
  });
```

Impor `takeOverAsk` dari `../services/lead/ask`.

Impor `isTakenOver` dari `../services/lead/deciding`. Di `POST …/dialog/answer`, longgarkan
gerbang `deciding` untuk sesi yang sudah diambil alih:

```ts
    // ADR-0091 ditegakkan apa adanya: selama lead memegang sesi ini, dialah yang berhak menjawab.
    // SPEC-909 · KECUALI sesudah operator mengambil alih — di situ lead sudah dibatalkan dan
    // menolak operator berarti tak ada yang bisa menjawab sama sekali.
    if (isDeciding(id) && !isTakenOver(id))
      return reply.code(409)
        .send({ error: "hanoman-lead sedang menyusun keputusan untuk sesi ini", reason: "deciding" });
```

- [x] **Step 4: Bungkus jalur lead dengan `beginAnswer`**

`server/src/services/lead/detect.ts` — `prodDetectDeps.send` menjadi:

```ts
  // SPEC-909 · ADR-0146 · jalur lead ikut masuk ke penjaga yang SAMA dengan jalur manusia
  // (`beginAnswer`, ADR-0142 §5). Dua penulis pane yang tak sepakat menyilangkan keystroke jadi
  // sampah yang tak bisa ditarik kembali — dan sejak AC-6 kedua penulis itu bisa aktif bersamaan.
  send: async (id, text, choices) => {
    if (!beginAnswer(id)) return false;
    try { return await sendToPane(id, text, 50, choices); }
    finally { endAnswer(id); }
  },
```

dan `submit` dibungkus sama persis. Impor `beginAnswer`/`endAnswer` dari `../session-dialog`.

Di `runChain`, sebelum setiap `deps.send`, hormati bendera takeover:

```ts
    if (isTakenOver(sid)) return stop("diambil alih operator");
```

Impor `isTakenOver` dari `./deciding` (Task 6 sudah menaruhnya di sana justru supaya baris ini
tak melahirkan siklus impor — `ask.ts` mengimpor `detect.ts`, jadi arah sebaliknya tertutup).

- [x] **Step 5: Path & klien**

`shared/src/api.ts`, sesudah `terminalDialogAnswer`:

```ts
  terminalDialogTakeover: (id: string) => `${API}/terminal/sessions/${id}/dialog/takeover`,
```

`src/src/api/client.ts`, sesudah `answerSessionDialog`:

```ts
  // SPEC-909 · ADR-0146 · hentikan hanoman-lead untuk sesi ini sebelum ia mengetik ke pane.
  takeoverSessionDialog: (id: string) =>
    j<{ accepted: true }>(paths.terminalDialogTakeover(id), { method: "POST" }),
```

- [x] **Step 6: Jalankan test — pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal-takeover.route.test.ts server/test/terminal-dialog.route.test.ts server/test/lead-ask.test.ts server/test/lead-detect-event.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/routes/terminal.ts server/src/services/lead/detect.ts \
        server/src/services/lead/deciding.ts server/src/services/lead/ask.ts \
        shared/src/api.ts src/src/api/client.ts server/test/terminal-takeover.route.test.ts
git commit -m "feat(lead): operator bisa mengambil alih sesi dari lead, pemenang deterministik (SPEC-909)"
```

---

### Task 10: Siaran `leadAsks` & pet yang menampilkan pertanyaan asli

**Files:**
- Modify: `server/src/services/events.ts:32-59` (grup `leadAsks`)
- Modify: `src/src/screens/PetAnswer.tsx`
- Modify: `src/src/screens/HanomanPet.tsx` (teruskan `ask`)
- Modify: `src/src/App.tsx:798-801` (frame WS → state) dan `src/src/App.tsx:1484` (prop ke `HanomanPet`)
- Create: `src/test/pet-answer.test.tsx`
- Modify: `server/test/events-ws.test.ts` (kasus grup baru — kode di Step 3)

**Interfaces:**
- Consumes: `liveAsks()` (Task 6), `SessionAsk` (Task 1), `api.takeoverSessionDialog` (Task 9).
- Produces: frame `{ t: "leadAsks", asks: SessionAsk[] }`; prop `ask?: SessionAsk` pada `PetAnswer`.

- [x] **Step 1: Tulis test yang gagal**

`src/test/pet-answer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionAsk } from "@hanoman/shared";
import { PetAnswer } from "../src/screens/PetAnswer";
import { api } from "../src/api/client";

const ASK: SessionAsk = {
  sessionId: "s1", agent: "claude", source: "ask-tool", askId: "t1",
  askedAt: new Date().toISOString(),
  questions: [
    { header: "Basis", question: "Basis data mana yang dipakai?", multiSelect: false,
      options: [{ label: "SQLite", description: "ringan" }, { label: "Postgres" }] },
    { header: "Auth", question: "Auth mana?", multiSelect: true, options: [{ label: "Cookie" }] },
  ],
  message: "", at: 0, total: 2, state: "deciding", flowId: "f1", step: 1,
};

beforeEach(() => {
  vi.spyOn(api, "sessionDialog").mockResolvedValue(null);   // scrape GAGAL — payload harus menang
});

describe("PetAnswer dengan payload event", () => {
  it("menampilkan pertanyaan ASLI tanpa bergantung scrape", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    expect(await screen.findByText("Basis data mana yang dipakai?")).toBeTruthy();
    expect(screen.queryByText(/tak terbaca dari sini/)).toBeNull();
  });

  it("menampilkan rantai sebagai langkah berurutan", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    expect(await screen.findByText(/Pertanyaan 1 dari 2/)).toBeTruthy();
  });

  it("menyebut status lead: sedang menyusun", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    expect(await screen.findByTestId("pet-answer-lead-state")).toHaveTextContent(/menyusun/i);
  });

  it("menyebut status lead: mengantre", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={{ ...ASK, state: "queued" }} />);
    expect(await screen.findByTestId("pet-answer-lead-state")).toHaveTextContent(/antre/i);
  });

  it("menyebut status lead: sudah menjawab", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={{ ...ASK, state: "answered" }} />);
    expect(await screen.findByTestId("pet-answer-lead-state")).toHaveTextContent(/sudah menjawab/i);
  });

  it("sesi codex: menampilkan pesan giliran dengan label jujur, bukan pertanyaan berpilihan", async () => {
    const codex: SessionAsk = { ...ASK, agent: "codex", source: "turn-end", questions: [],
      message: "Mau SQLite atau Postgres?", total: 1 };
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={codex} />);
    expect(await screen.findByText("Mau SQLite atau Postgres?")).toBeTruthy();
    expect(screen.getByTestId("pet-answer-source")).toHaveTextContent(/giliran terakhir/i);
  });

  it("tanpa payload, jatuh ke perilaku hari ini (server lebih tua, ADR-0087)", async () => {
    render(<PetAnswer sessionId="s1" label="sesi" reduced />);
    expect(await screen.findByText(/tak terbaca dari sini/)).toBeTruthy();
  });

  it("Ambil alih memanggil endpoint dan membuka kotak jawab", async () => {
    const spy = vi.spyOn(api, "takeoverSessionDialog").mockResolvedValue({ accepted: true } as any);
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    await userEvent.click(await screen.findByTestId("pet-answer-takeover"));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("s1"));
  });

  it("Ambil alih yang kalah memberi penolakan yang jelas", async () => {
    const { ApiError } = await import("../src/api/client");
    vi.spyOn(api, "takeoverSessionDialog")
      .mockRejectedValue(new ApiError("x", 409, { reason: "answering" } as any));
    render(<PetAnswer sessionId="s1" label="sesi" reduced ask={ASK} />);
    await userEvent.click(await screen.findByTestId("pet-answer-takeover"));
    expect(await screen.findByTestId("pet-answer-note")).toHaveTextContent(/sudah mengirim jawabannya/i);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm vitest --run src/test/pet-answer.test.tsx`
Expected: FAIL — `PetAnswer` belum menerima prop `ask`.

- [x] **Step 3: Grup siar `leadAsks` + testnya**

Tambahkan di `server/test/events-ws.test.ts`:

```ts
import { __tick, __reset } from "../src/services/events";
import { __resetAsks, intakeAsk } from "../src/services/lead/ask";

describe("SPEC-909 · grup siar leadAsks", () => {
  it("melahirkan frame saat daftarnya berubah, dan diam saat tidak", async () => {
    __reset(); __resetAsks();
    const sent: string[] = [];
    await attach({ send: (m: string) => sent.push(m), close: () => {} });
    const before = sent.filter((m) => m.includes('"leadAsks"')).length;
    await intakeAsk(
      { sessionId: "s1", agent: "claude", projectId: "p1",
        event: { source: "ask-tool", askId: "t1", message: "",
          questions: [{ header: "H", question: "Q?", multiSelect: false, options: [] }] } },
      { admit: async () => ({ ok: true }), answer: () => new Promise(() => {}),
        reset: () => {}, live: () => ["s1"], maxConcurrent: async () => 1, now: () => 1 } as any);
    await __tick();
    const mid = sent.filter((m) => m.includes('"leadAsks"')).length;
    expect(mid).toBeGreaterThan(before);
    await __tick();
    expect(sent.filter((m) => m.includes('"leadAsks"')).length).toBe(mid);   // dedup signature
    __reset(); __resetAsks();
  });
});
```

(`attach` diimpor dari `../src/services/events` — berkas test itu sudah memakainya.)

Lalu implementasinya:

`server/src/services/events.ts` — impor `liveAsks` dari `./lead/ask`, lalu tambahkan grup sesudah
`cleanups`:

```ts
  // SPEC-909 · ADR-0146 · pertanyaan sesi yang hidup, langsung dari payload hook agennya. Membaca
  // peta di memori (`lead/ask.ts`) — nol I/O, nol tmux, nol DB per tick — dan dedup signature
  // membuat frame lahir hanya saat daftarnya berubah. Grup SENDIRI, bukan hiasan di `sessions`:
  // frame itu sudah yang terbesar di dashboard dan pembacanya jauh lebih banyak daripada pembaca
  // daftar pendek ini.
  { everyTicks: 1, last: "", build: async () => ({ t: "leadAsks", asks: liveAsks() }) },
```

- [x] **Step 4: Jahit frame ke state frontend**

`src/src/App.tsx` — state baru di sebelah `sessions`:

```tsx
const [leadAsks, setLeadAsks] = React.useState<SessionAsk[]>([]);
```

Di `React.useEffect(() => subscribe((m) => { … }), [])` (App.tsx:798):

```tsx
    else if (m.t === "sessions") setSessions(m.sessions as TerminalSession[]);
    // SPEC-909 · ADR-0146 · pertanyaan sesi datang dari payload hook agennya, bukan dari scrape
    // layar saat panel pet dibuka. Menumpang kanal siar yang sudah ada (ADR-0039).
    else if (m.t === "leadAsks") setLeadAsks(m.asks);
```

Di App.tsx:1484:

```tsx
        <HanomanPet sessions={sessions} backlog={backlog} asks={leadAsks}
```

`src/src/screens/HanomanPet.tsx` — tambahkan prop dan teruskan:

```tsx
export function HanomanPet({ sessions, backlog, asks = [], onOpen }:
  { sessions: TerminalSession[]; backlog: Spec[]; asks?: SessionAsk[]; onOpen: (target: PetTarget) => void }) {
```

```tsx
                {c.kind === "waiting" && open && waiting.map((s) => (
                  <PetAnswer key={s.id} sessionId={s.id} label={s.specId ?? s.id} reduced={reduced}
                    ask={asks.find((a) => a.sessionId === s.id)} />
                ))}
```

`asks` diberi default `[]` dengan sengaja: ADR-0087 mengizinkan dashboard lebih baru daripada
server yang dilayaninya, dan server yang belum punya grup `leadAsks` cuma tak pernah mengirim
frame itu — pet harus tetap masuk akal, bukan kosong.

- [x] **Step 5: Ubah `PetAnswer.tsx`**

Tanda tangan & konstanta:

```tsx
import type { SessionAsk, SessionDialogAnswer, SessionDialogPayload } from "@hanoman/shared";

const NOTE = {
  loading: "Membaca layar sesi…",
  none: "Pertanyaannya tak terbaca dari sini — buka Terminal untuk menjawabnya.",
  stale: "Layarnya sudah berubah — pertanyaannya dimuat ulang.",
  deciding: "hanoman-lead sedang menyusun keputusan untuk sesi ini.",
  failed: "Jawaban tak terkirim. Buka Terminal untuk menjawabnya.",
  // SPEC-909 · ADR-0146
  answering: "hanoman-lead sudah mengirim jawabannya ke pane — terlambat mengambil alih.",
  taken: "Kamu mengambil alih sesi ini. hanoman-lead berhenti menjawabnya.",
  preparing: "Kotak jawabnya sedang disiapkan — dialognya belum tergambar di pane.",
};

// SPEC-909 · AC-5 · status lead terlihat. Kalimatnya di SATU tempat: tiga permukaan yang
// menamainya sendiri-sendiri adalah tiga kalimat yang akan hanyut terpisah.
const LEAD_STATE: Record<SessionAsk["state"], string> = {
  queued: "hanoman-lead mengantre untuk sesi ini",
  deciding: "hanoman-lead sedang menyusun keputusan",
  answered: "hanoman-lead sudah menjawab",
  "taken-over": "Kamu yang menjawab sesi ini",
  failed: "hanoman-lead tak sanggup menjawab sesi ini",
};

export function PetAnswer({ sessionId, label, reduced, ask }:
  { sessionId: string; label: string; reduced: boolean; ask?: SessionAsk }) {
```

Aksi ambil alih, di sebelah `send()`:

```tsx
  async function takeover() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.takeoverSessionDialog(sessionId);
      setNote(NOTE.taken);
      setReload((n) => n + 1);          // dialognya dimuat ulang; gerbang `deciding` sudah lepas
    } catch (e) {
      setNote(reasonOf(e) === "answering" ? NOTE.answering : NOTE.failed);
    } finally {
      setBusy(false);
    }
  }
```

Blok kepala yang dirender SEBELUM cabang `payload === null` — inilah yang membuat pertanyaan tampil
seketika tanpa menunggu scrape:

```tsx
  // SPEC-909 · ADR-0146 · payload event MENANG atas scrape. Ia bukti dari agennya sendiri
  // (`tool_input` tool `AskUserQuestion`), sementara `GET …/dialog` cuma tangkapan layar 52 kolom
  // yang bisa memotong pertanyaannya — dan yang selama ini menyerah dengan `NOTE.none`.
  const asked = ask?.questions[Math.min(ask.at, ask.questions.length - 1)];
  const head = ask && (
    <div style={{ marginBottom: 6 }}>
      <div data-testid="pet-answer-lead-state" className="hn-eyebrow">{LEAD_STATE[ask.state]}</div>
      {ask.total > 1 && (
        <div className="hn-eyebrow" style={{ marginTop: 2 }}>
          Pertanyaan {Math.min(ask.at + 1, ask.total)} dari {ask.total}
        </div>
      )}
      {ask.source === "turn-end" && (
        <div data-testid="pet-answer-source" className="hn-eyebrow" style={{ marginTop: 2 }}>
          Giliran terakhir sesi
        </div>
      )}
      {(asked?.question || ask.message) && (
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
          color: "var(--text-strong)", lineHeight: 1.4, marginTop: 4 }}>
          {asked?.question || ask.message}
        </div>
      )}
      {ask.state !== "taken-over" && (
        <div style={{ marginTop: 6 }}>
          <Button data-testid="pet-answer-takeover" size="sm" variant="ghost" disabled={busy}
            style={flat} onClick={() => { void takeover(); }}>Ambil alih</Button>
        </div>
      )}
    </div>
  );
```

Tiga cabang keluar yang berubah — masing-masing kini menampilkan `head` lebih dulu:

```tsx
  if (sent) { /* tak berubah */ }
  if (payload === undefined) return <div style={box}>{head}{noteLine(NOTE.loading)}</div>;
  // Payload event ada tapi dialognya belum tergambar (`PreToolUse` menembak SEBELUM tool jalan):
  // pertanyaannya sudah bisa dibaca, kotak jawabnya belum bisa dipasang — katakan itu apa adanya.
  if (payload === null)
    return <div style={box}>{head}{noteLine(ask ? NOTE.preparing : NOTE.none)}{note && noteLine(note)}</div>;
```

Di blok utama, sisipkan `{head}` tepat sesudah `<div data-testid="pet-answer" …>` dan **ganti** baris
langkah lama supaya tak dobel:

```tsx
      {!ask && dialog.tabs.length > 1 && (
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>
          Pertanyaan {Math.min(answered + 1, dialog.tabs.length)} dari {dialog.tabs.length}
        </div>
      )}
      {!ask && dialog.title && ( /* judul dari scrape hanya dipakai saat payload tak ada */ )}
```

Yang **tidak** berubah, dan tak boleh berubah: tombol opsi, checkbox, kotak teks, dan `send()`
tetap memakai `payload` — `screenHash` dan nomor baris opsi adalah yang dibutuhkan untuk MENJAWAB,
dan pagar SPEC-899/ADR-0142 berdiri di atasnya. Payload event menjawab "apa pertanyaannya", bukan
"baris mana yang ditekan".

Design system: `hn-eyebrow`, `var(--bone-100)`, `var(--border-hair)`, `var(--text-muted)`,
`var(--text-strong)` — semuanya sudah dipakai berkas ini. Setiap `Button` baru memakai
`style={flat}` yang sudah ada supaya `prefers-reduced-motion` tetap dihormati.

- [x] **Step 6: Jalankan test — pastikan LULUS**

Run: `pnpm vitest --run src/test/pet-answer.test.tsx src/test/hanoman-pet.test.tsx`
Expected: PASS.
Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/events-ws.test.ts server/test/events.route.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/events.ts src/src/screens/PetAnswer.tsx src/src/screens/HanomanPet.tsx \
        src/src/state src/test/pet-answer.test.tsx server/test/events-ws.test.ts
git commit -m "feat(pet): pertanyaan asli dari payload event, langkah rantai, status lead, ambil alih (SPEC-909)"
```

---

### Task 11: `curl` jadi prasyarat, dan latensi diukur SESUDAH

**Files:**
- Modify: `runner/src/doctor.ts` (prasyarat `curl`)
- Modify: `runner/test/doctor.test.ts` (atau berkas test doctor yang ada)
- Create: `docs/superpowers/audits/2026-08-23-spec-909-latensi-event-vs-denyut.md`

**Interfaces:**
- Consumes: seluruh jalur Task 3–8, berjalan sungguhan.
- Produces: satu dokumen berisi ANGKA sebelum/sesudah, dirujuk ADR-0146 dan spec §6.6.

- [x] **Step 1: Tambahkan `curl` ke doctor**

Ikuti bentuk pemeriksaan yang sudah ada di `runner/src/doctor.ts` (node/git/tmux/CLI agen). Baris
yang ditambahkan menjelaskan AKIBATNYA, bukan cuma "tak ada":

```ts
// SPEC-909 · ADR-0146 · hook sesi mengirim pertanyaan ke server lewat `curl`. Tanpa biner ini hook
// diam dan `exit 0` (ia tak pernah memblokir agen), tetapi hanoman-lead tak akan pernah menjawab
// satu sesi pun — dan tak ada error di mana pun yang akan mengatakannya.
```

Pesan gagal: `"curl tak ditemukan — hanoman-lead tak akan menerima pertanyaan sesi (SPEC-909)"`.

- [x] **Step 2: Test doctor**

Tambahkan satu kasus di test doctor yang ada: `curl` hilang → laporan memuat baris itu, dan
`doctor` tidak melempar.

Run: `pnpm vitest --run runner/test/doctor.test.ts`
Expected: PASS.

- [x] **Step 3: Siapkan harness pengukuran**

Boot server dari terminal MANUSIA (bukan dari sesi agen — server yang di-boot dari sesi Claude Code
tak bisa membaca kredensial claude dan setiap spawn agen 401; itu bukan bug produk):

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u NODE_ENV -u DATABASE_URL -u HANOMAN_SUPERVISOR \
  HANOMAN_HOME="$(mktemp -d)" PORT=8799 pnpm dev
```

Nyalakan lead: `Setting.lead.enabled = true`, project `leadOptIn = true`, `maxAutoAnswers` ≥ 1.

- [x] **Step 4: Ukur SESUDAH**

Stempel di tiga titik, satu sesi diam, tanpa beban lain:

1. `t_ask` — di dalam hook, tepat sebelum `curl` (sisipkan sementara
   `perl -MTime::HiRes=time -e 'printf "%.0f\n", time*1000' > /tmp/909-ask.ms;` di depan perintah hook).
2. `t_recv` — `console.time`-style di `routes/session-events.ts` awal handler.
3. `t_decide` — di `lead/ask.ts` tepat sebelum `deps.answer(...)` dipanggil (= lead MULAI menyusun).

Ulangi **5 kali** dengan `AskUserQuestion` 1 pertanyaan pada sesi yang diam. Catat median dan
maksimum `t_decide − t_ask`.

- [x] **Step 5: Ukur `capture-pane` sebelum vs sesudah**

Dengan N sesi hidup yang sama (N ≥ 3) dan **tak ada** yang bertanya, hitung invokasi
`tmux capture-pane` selama 60 detik:

- **Sebelum** (`git stash`-kan? JANGAN — tumpukan stash milik repo. Pakai `git worktree` terpisah
  di `HEAD~` atau checkout tag base ke direktori sementara).
- **Sesudah** (worktree ini).

Hitung dengan membungkus biner tmux sementara:
`printf '#!/bin/sh\n[ "$3" = capture-pane ] && echo 1 >> /tmp/909-cap.log\nexec /opt/homebrew/bin/tmux "$@"\n'`
lalu `HANOMAN_TMUX_SOCKET` tetap, dan arahkan PATH ke shim itu. Angka yang dilaporkan: jumlah
`capture-pane` / 60 dtk / N sesi.

- [x] **Step 6: Ukur stall hook**

`t_hookdone − t_ask` di dalam hook saat server sehat (5 sampel), dan sekali lagi dengan server
dimatikan (harus ≈ 2 000 ms, batas `-m 2`).

- [x] **Step 7: Tulis audit**

`docs/superpowers/audits/2026-08-23-spec-909-latensi-event-vs-denyut.md` — tabel tiga baris:

| | sebelum | sesudah |
|---|---|---|
| `AskUserQuestion` → lead mulai menyusun (median / maks, sesi diam) | 6 071 ms + U(0,5 s) → ukur | ukur |
| `capture-pane` per 60 dtk per sesi, tak ada yang bertanya | ukur | ukur (harus 0) |
| stall agen oleh hook (median / server mati) | 0 | ukur / ≈2 000 |

Baris "sebelum" untuk kolom pertama **wajib diukur ulang di harness yang sama**, bukan disalin dari
spec §6.5: §6.5 mengukur jarak hook→hook, sedangkan yang ini jarak hook→lead. Kalau salah satu tak
bisa diukur, tulis alasannya apa adanya — jangan mengarang angka.

- [x] **Step 8: Cabut instrumentasi sementara**

Hapus ketiga stempel dari Step 4 dan shim tmux dari Step 5. Yang tinggal di kode hanya satu baris
log permanen di `lead/ask.ts` yang menyebut selisih `askedAt → decide`:

```ts
// SPEC-909 · AC-3 · latensi jalur event, satu baris per keputusan. Ini satu-satunya angka yang
// membedakan "event sudah jalan" dari "event terpasang tapi diam", dan ia gratis.
console.log(`lead ask ${sessionId}: ${deps.now() - Date.parse(e.ask.askedAt)} ms sampai mulai menyusun`);
```

- [x] **Step 9: Commit**

```bash
git add runner/src/doctor.ts runner/test/doctor.test.ts \
        docs/superpowers/audits/2026-08-23-spec-909-latensi-event-vs-denyut.md \
        server/src/services/lead/ask.ts
git commit -m "measure(lead): latensi event vs denyut, capture-pane idle, stall hook (SPEC-909)"
```

---

### Task 12: ADR-0146 + docs tersentuh + index

**Files:**
- Create: `internal/docs/adr/0146-lead-dipicu-event-hook.md`
- Modify: `internal/docs/adr/README.md` (baris ADR-0146; amandemen di baris 0091)
- Modify: `internal/docs/README.md` (link ADR-0146 di seksi adr; perbarui deskripsi `api-contract` & `frontend-implementation`)
- Modify: `internal/docs/architecture/api-contract.md` (`POST /api/session-events`, `POST /terminal/sessions/:id/dialog/takeover`, frame `leadAsks`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (§Pet: pertanyaan dari payload, langkah rantai, status lead, ambil alih)
- Modify: `internal/docs/architecture/stack.md` (irama lead: satu tick rumah tangga, jalur event)

- [x] **Step 1: Tulis ADR-0146**

Judul: `# ADR-0146 — Pintu deteksi hanoman-lead dipicu event hook, bukan denyut`

Isi wajib (ikuti bentuk ADR-0143 yang paling dekat): **Status/Tanggal/Sumber** menyebut spec &
audit Task 11 · **Konteks** dengan angka §1 spec (6 071 / 6 023 ms, ½ tick, `capture-pane` 6,28 ms)
· **Keputusan** 1–11 mencerminkan §3 spec · **Bukti** menyalin §6 spec + angka audit Task 11 ·
**Alternatif yang ditolak** minimal empat: (a) menyisakan pemindai untuk sesi lama, (b) menaruh
event di `/api/lead`, (c) memberi `classifyIngress` pengecualian loopback, (d) menutup rantai
antar-panggilan dengan menunggu layar · **Konsekuensi** memuat lima butir "diterima sadar" dari
spec §9 · **Gotcha** minimal:

1. `PreToolUse` menembak **sebelum** tool-nya jalan — dialognya belum ada di layar saat event tiba.
2. Hook `PreToolUse` berkode keluar 2 **memblokir** tool-nya; `exit 0` bukan kerapian, ia syarat.
3. `Host` loopback ditolak `classifyIngress` saat origin dipisah — header `Host` eksplisit adalah
   satu-satunya jalan yang tak melebarkan permukaan control.
4. Token turunan HMAC bukan pembuktian identitas proses: uid yang sama tetap bisa membacanya
   (ADR-0037), dan ADR ini menyatakannya alih-alih berpura-pura menutupnya.
5. `beginAnswer()` kini dipakai lead **dan** manusia; melewatkan salah satunya mengembalikan dua
   penulis pane yang bisa menyilangkan keystroke.
6. Sesi yang lahir sebelum pembaruan **tidak** dilayani — dan penandanya opsi window tmux, bukan
   berkas, supaya restart server tak menghapusnya.

- [x] **Step 2: Tautkan di `internal/docs/adr/README.md`**

Tambahkan baris ADR-0146 di puncak daftar (urutan menurun), dan **sunting baris ADR-0091** supaya
menyebut amandemennya — pola yang sama dengan ADR-0140 yang menyebut amandemen SPEC-904/ADR-0144.

- [x] **Step 3: Tautkan di `internal/docs/README.md`**

Tambahkan ADR-0146 di seksi `adr`. Perbarui kalimat deskripsi `api-contract` dan
`frontend-implementation` supaya menyebut permukaan baru.

- [x] **Step 4: Perbarui `api-contract.md`**

Dua endpoint + satu frame siar, dengan kode status lengkap dari §5 spec dan catatan bahwa
`session-events` **di luar** jangkauan agent token.

- [x] **Step 5: Perbarui `frontend-implementation.md`**

Di §Pet Hanoman, tambahkan "Pet hidup G — SPEC-909 ADR-0146": pertanyaan dari payload event
(bukan scrape), "Pertanyaan _n_ dari _N_", tiga status lead, tombol Ambil alih dan dua hasilnya.

- [x] **Step 6: Perbarui `stack.md`**

Satu paragraf: irama lead sekarang satu tick rumah tangga 60 detik + jalur event hook; sebut bahwa
jumlah timer berkurang (ADR-0024 utuh) dan tak ada kanal WS baru (ADR-0039 utuh).

- [x] **Step 7: Verifikasi integritas index**

Run: `node runner/dist/cli.js docs index --check` (atau `pnpm hanoman docs index --check` sesuai
skrip yang ada di repo).
Expected: keluar 0, "index utuh".

- [x] **Step 8: Commit**

```bash
git add internal/docs
git commit -m "docs(lead): ADR-0146 mengamandemen ADR-0091 §5 — pintu deteksi dipicu event (SPEC-909)"
```

---

## Verifikasi akhir (sesudah task 12)

- [x] **Test yang tersentuh, sekali jalan:**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u NODE_ENV -u DATABASE_URL -u HANOMAN_SUPERVISOR \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Pastikan test-nya BENAR-BENAR berjalan — `--changed` menyalakan `passWithNoTests`, jadi nol test
terlihat hijau.

- [x] **Typecheck paket yang tersentuh (bukan `-r`):**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck \
  && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

- [x] **Smoke endpoint nyata, sekali di akhir** — dilakukan LIVE saat pengukuran (audit
  `docs/superpowers/audits/2026-08-23-spec-909-latensi-event-vs-denyut.md`): server sungguhan di
  `:8799` + sesi `claude` sungguhan di pane tmux. Terbukti `Bearer` salah → **401**, `Bearer` benar
  + sesi tak hidup → **404**, event `AskUserQuestion` sungguhan → **202** lalu satu `LeadFlow`
  ber-`steps = 3` dengan tiga `LeadDecision` ber-`flowId` sama. (task ini menyentuh route): boot server dari
  terminal manusia (Task 11 Step 3), lalu:

```bash
S=spec-smoke
TOK=$(node -e 'import("./server/dist/services/session-event-token.js").then(m=>console.log(m.sessionEventToken(process.argv[1])))' "$S")
curl -sS -i -X POST http://127.0.0.1:8799/api/session-events \
  -H 'content-type: application/json' -H "authorization: Bearer $TOK" -H "x-hanoman-session: $S" \
  --data '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_use_id":"t1","tool_input":{"questions":[{"question":"Q?","header":"H","multiSelect":false,"options":[{"label":"A"}]}]}}'
# tanpa sesi hidup → 404; dengan sesi `spec-smoke` hidup → 202
curl -sS -i -X POST http://127.0.0.1:8799/api/session-events -H 'content-type: application/json' --data '{}'
# → 401
```

- [x] **Sapuan blast-radius:** jalankan subagent `blast-radius` atas diff penuh untuk mencari cermin
  yang ketinggalan (daftar route, enum kembar, DTO, tabel konstanta, dokumen kontrak).

- [x] **Tinjauan keamanan:** jalankan subagent `security-reviewer` atas `routes/session-events.ts`,
  `services/session-event-token.ts`, `services/lead/ask.ts`, dan perubahan `app.ts`.

- [x] **Push:**

```bash
git push origin HEAD:refs/heads/hanoman/spec-909
```
