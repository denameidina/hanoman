# SPEC-919 — Presence sesi lintas device: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub hanoman menampilkan sesi agen yang sedang berjalan di **semua** instance klien, bukan hanya di mesin hub sendiri.

**Architecture:** Klien menaikkan frame `{t:"presence"}` di atas **socket sync yang sudah ada** (`/api/sync/ws`, Bearer device token). Hub menyimpannya di **registry di memori** — nol tabel, nol kolom, nol `SyncLog`. Sesi mesin hub sendiri masuk registry yang sama lewat pintu yang sama, sehingga hanya ada satu sumber kebenaran. Dashboard menerimanya lewat grup siar ke-9 di `/api/events/ws`.

**Tech Stack:** TypeScript strict · Fastify + `@fastify/websocket` · `ws` (klien) · zod · React 18 · vitest.

## Global Constraints

- Snapshot per sesi **RINGKAS**: tak ada scrollback, tak ada cuplikan pane, tak ada `cwd`, tak ada path berkas apa pun. Skema zod `.strict()` menegakkannya.
- Status hidup **tidak pernah** masuk `SyncLog`/changefeed: ia tak menyentuh Prisma sama sekali.
- Autentikasi memakai **device token** yang sudah ada (`verifyDeviceToken`). Tak ada skema token baru. Token tak pernah masuk log.
- `deviceId` **selalu** dari token terverifikasi (`req.wsPrincipal.id`), **tak pernah** dari payload.
- Kegagalan kanal presence **tak boleh** menjatuhkan sync: frame rusak/kebesaran/terlalu sering **dibuang**, socket tetap terbuka.
- Tak ada message queue, Redis, worker terpisah, atau scheduler cron (ADR-0024/0086).
- Tak ada polling HTTP baru (ADR-0039/0145). `GET /api/presence` hanya muat-awal + fallback.
- Instance tanpa device token terdaftar: **nol perubahan tampilan**.
- Bahasa komentar & copy UI: Indonesia, mengikuti berkas sekitarnya. Design system: `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- Verifikasi per task: `pnpm vitest --run --no-file-parallelism <path test>` dengan
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS`.

---

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/presence.ts` (baru) | tipe wire, zod `.strict()`, konstanta batas, `presenceSignature()` |
| `shared/src/index.ts` (ubah) | re-export |
| `shared/src/dto.ts` (ubah) | varian `EventMsg` `presence` |
| `server/src/services/pty.ts` (ubah) | `#{session_created}` → `Pane.startedAt`; ekspor `Pane`, `listPanesAsync`, `parsePanes`, `FMT` |
| `server/src/services/presence/snapshot.ts` (baru) | `Pane[] → PresenceSession[]` |
| `server/src/services/presence/registry.ts` (baru) | peta memori + stempel transisi + ambang offline |
| `server/src/services/presence/view.ts` (baru) | registry + `DeviceToken` + sesi lokal → `PresenceView` |
| `server/src/services/presence/sender.ts` (baru) | sisi klien: dedup signature + denyut |
| `server/src/services/events.ts` (ubah) | grup siar ke-9 |
| `server/src/routes/sync.ts` (ubah) | `socket.on("message")` |
| `server/src/routes/presence.ts` (baru) | `GET /api/presence` |
| `server/src/app.ts` (ubah) | registrasi route |
| `server/src/services/agent-capabilities.ts` (ubah) | `presence` → `COOKIE_ONLY` eksplisit |
| `server/src/services/sync-client.ts` (ubah) | backoff + start/stop sender |
| `shared/src/api.ts` (ubah) | `paths.presence` |
| `src/src/api/client.ts` (ubah) | `api.presence()` |
| `src/src/screens/presence-map.ts` (baru) | indeks murni `PresenceView → Map` |
| `src/src/screens/PresenceChip.tsx` (baru) | chip "dikerjakan di <device>" |
| `src/src/screens/ClientsScreen.tsx` (baru) | halaman "Klien" |
| `src/src/ds/shell.tsx` (ubah) | `NavItem.gate` + `NavGate` context |
| `src/src/App.tsx` (ubah) | state presence, section `clients`, provider gate |
| `src/src/screens/BacklogScreen.tsx` (ubah) | chip di `SpecRow` + `BoardCard` |
| `src/src/screens/ProjectsScreen.tsx` (ubah) | chip di kolom Status |

---

### Task 1: Kontrak wire presence di `@hanoman/shared`

**Files:**
- Create: `shared/src/presence.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/presence.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `PRESENCE_PROTOCOL`, `MAX_PRESENCE_SESSIONS`, `PRESENCE_HEARTBEAT_MS`, `PRESENCE_OFFLINE_MS`, `PRESENCE_TICK_MS`, `PRESENCE_MAX_FRAMES_PER_MIN`, `LOCAL_DEVICE_ID`, `PresenceStatus`, `PresenceSession`, `zPresenceSession`, `zPresenceFrame`, `PresenceFrame`, `PresenceSessionView`, `PresenceDeviceView`, `PresenceView`, `presenceSignature(sessions: PresenceSession[]): string`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/src/presence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  zPresenceFrame, presenceSignature, MAX_PRESENCE_SESSIONS, PRESENCE_PROTOCOL,
  type PresenceSession,
} from "./presence";

const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T01:00:00.000Z", ...over,
});
const frame = (sessions: PresenceSession[]) => ({ t: "presence", v: PRESENCE_PROTOCOL, sessions });

describe("kontrak wire presence", () => {
  it("menerima frame minimal", () => {
    expect(zPresenceFrame.safeParse(frame([s()])).success).toBe(true);
  });

  // Ini BUKTI "tak ada isi terminal": kunci di luar kontrak ditolak, bukan diabaikan.
  it("menolak field asing di sesi (scrollback tak bisa diselundupkan)", () => {
    const r = zPresenceFrame.safeParse(frame([{ ...s(), scrollback: "rahasia" } as PresenceSession]));
    expect(r.success).toBe(false);
  });

  it("menolak field asing di amplop", () => {
    expect(zPresenceFrame.safeParse({ ...frame([]), cwd: "/home/dena" }).success).toBe(false);
  });

  it("menolak versi protokol lain", () => {
    expect(zPresenceFrame.safeParse({ ...frame([]), v: 2 }).success).toBe(false);
  });

  it("menolak daftar sesi melewati plafon", () => {
    const many = Array.from({ length: MAX_PRESENCE_SESSIONS + 1 }, (_, i) => s({ sessionId: `s${i}` }));
    expect(zPresenceFrame.safeParse(frame(many)).success).toBe(false);
  });

  it("menolak status di luar kosakata", () => {
    expect(zPresenceFrame.safeParse(frame([s({ status: "idle" as never })])).success).toBe(false);
  });

  // Dedup pengirim: urutan pane dari tmux tak stabil, jadi signature harus buta terhadapnya.
  it("signature buta terhadap urutan", () => {
    const a = [s({ sessionId: "a" }), s({ sessionId: "b" })];
    expect(presenceSignature(a)).toBe(presenceSignature([...a].reverse()));
  });

  it("signature berubah saat status berubah", () => {
    expect(presenceSignature([s()])).not.toBe(presenceSignature([s({ status: "waiting" })]));
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
pnpm vitest --run --no-file-parallelism shared/src/presence.test.ts
```
Expected: FAIL — `Failed to resolve import "./presence"`.

- [ ] **Step 3: Implementasi minimal**

Buat `shared/src/presence.ts`:

```ts
import { z } from "zod";

/* SPEC-919 · ADR-0147/0148 · kontrak "sesi apa yang hidup di device mana".
   Muatannya sengaja RINGKAS: hub sudah memegang baris Spec & Project yang menyeberang sync,
   jadi judul/nama/stage di-resolve di sana — beda sadar dari HandledByEntry (ADR-0135) yang
   HARUS membawa `name` karena penerimanya client yang tak punya katalog device. */

export const PRESENCE_PROTOCOL = 1;

/** Plafon jumlah sesi per frame. 100 × ±200 B ≈ 20 KB, jauh di bawah `maxPayload` 64 KiB
    milik plugin WebSocket — frame yang melewatinya akan ditutup 1009 oleh `ws` SEBELUM
    handler kita sempat mengabaikannya, dan socket itu mengangkut changefeed sync. */
export const MAX_PRESENCE_SESSIONS = 100;

/** Kadens pembangunan snapshot di klien (satu `tmux list-panes` asinkron). */
export const PRESENCE_TICK_MS = 3_000;
/** Denyut jaring pengaman: dikirim walau isinya tak berubah. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
/** Tanpa frame selama ini, device dianggap offline — 3× denyut, jadi satu denyut hilang tak menghukum. */
export const PRESENCE_OFFLINE_MS = 90_000;
/** Polisi tidur laju frame per socket. Denyut normal 2/menit; 60 memberi ruang 30×. */
export const PRESENCE_MAX_FRAMES_PER_MIN = 60;

/** deviceId sintetis mesin tempat instance ini berjalan. Bukan `DeviceToken.id` mana pun:
    hub tak menerbitkan token untuk dirinya sendiri, dan penanda di layar tetap harus seragam. */
export const LOCAL_DEVICE_ID = "local";

/* Kosakata status memakai bit yang SUDAH ada, bukan yang ketiga: `waiting` adalah
   `SessionInfo.decision` apa adanya (SPEC-903 · ADR-0143), `exited` adalah `pane_dead`. */
export type PresenceStatus = "working" | "waiting" | "exited";

export const zPresenceSession = z.object({
  sessionId: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  specId: z.string().max(200).optional(),
  flow: z.string().max(40).optional(),
  /** Fase `active` dari `readPhases()`. Absen = sesi tanpa berkas fase (mis. konsol VPS). */
  phase: z.string().max(80).optional(),
  agent: z.enum(["claude", "codex"]),
  status: z.enum(["working", "waiting", "exited"]),
  startedAt: z.string().max(40),
}).strict();
export type PresenceSession = z.infer<typeof zPresenceSession>;

export const zPresenceFrame = z.object({
  t: z.literal("presence"),
  v: z.literal(PRESENCE_PROTOCOL),
  sessions: z.array(zPresenceSession).max(MAX_PRESENCE_SESSIONS),
}).strict();
export type PresenceFrame = z.infer<typeof zPresenceFrame>;

/** `statusAt` dicap HUB, bukan klien: "bekerja" tak punya stempel yang jujur di sisi klien
    (aktivitas pane bergerak tiap detik → signature berubah tiap denyut → banjir frame). */
export type PresenceSessionView = PresenceSession & { statusAt: string };

export type PresenceDeviceView = {
  deviceId: string;
  name: string;
  /** Mesin tempat instance ini sendiri berjalan. */
  local: boolean;
  online: boolean;
  /** `DeviceToken.lastSeenAt` — ditulis jalur sync yang sudah ada, bukan oleh kanal ini. */
  lastSeenAt: string | null;
  sessions: PresenceSessionView[];
};

export type PresenceView = {
  /** Instalasi ini memang punya lebih dari satu mesin. `false` → layar tak berubah sama sekali. */
  enabled: boolean;
  devices: PresenceDeviceView[];
};

/** Dedup pengirim. Urutan pane dari tmux tak dijamin stabil, jadi signature diurutkan dulu —
    tanpa itu satu pergeseran urutan mengirim frame yang isinya identik. */
export function presenceSignature(sessions: PresenceSession[]): string {
  return JSON.stringify(
    [...sessions]
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
      .map((s) => [s.sessionId, s.projectId, s.specId ?? "", s.flow ?? "", s.phase ?? "",
        s.agent, s.status, s.startedAt]),
  );
}
```

Tambahkan ke `shared/src/index.ts`, mengikuti gaya baris ekspor di sekitarnya:

```ts
export * from "./presence";
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
pnpm vitest --run --no-file-parallelism shared/src/presence.test.ts
```
Expected: PASS — 7 test.

- [ ] **Step 5: Typecheck paket shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar 0, tanpa output error.

- [ ] **Step 6: Commit**

```bash
git add shared/src/presence.ts shared/src/presence.test.ts shared/src/index.ts
git commit -m "feat(spec-919): kontrak wire presence sesi lintas device"
```

---

### Task 2: `startedAt` dari tmux + ekspor bahan presence dari `pty.ts`

**Files:**
- Modify: `server/src/services/pty.ts:301-305` (FMT), `:136-146` (`Pane`), `:337-362` (`parsePanes`), `:325` (`listPanesAsync`)
- Test: `server/test/pty-parse.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces: `export type Pane` (kini punya `startedAt: number` = detik epoch), `export const FMT`, `export function parsePanes(out: string): Pane[]`, `export async function listPanesAsync(): Promise<Pane[]>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/pty-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FMT, parsePanes } from "../src/services/pty";

/* SPEC-919 · `parsePanes` men-destructure baris tab per POSISI. Menambah satu field ke FMT
   tanpa menggeser destructuring-nya menghasilkan nilai yang salah di SETIAP kolom sesudahnya —
   tanpa satu pun error. Test ini mengunci jumlah kolom dan pemetaannya. */

const FIELDS = FMT.split("\t");

const line = (over: Partial<Record<string, string>> = {}) => {
  const v: Record<string, string> = {
    "#{session_name}": "hn-spec-919", "#{@hanoman_project}": "hanoman",
    "#{@hanoman_spec}": "SPEC-919", "#{@hanoman_flow}": "feature",
    "#{@hanoman_phase_file}": "/tmp/.phases/spec-919", "#{@hanoman_cwd}": "/tmp/wt",
    "#{pane_dead}": "0", "#{pane_dead_status}": "", "#{@hanoman_decision_file}": "",
    "#{@hanoman_branch}": "", "#{@hanoman_agent}": "codex", "#{alternate_on}": "0",
    "#{window_activity}": "1756000000", "#{@hanoman_event_hook}": "1",
    "#{session_created}": "1755999000",
    ...over,
  };
  return FIELDS.map((f) => v[f] ?? "").join("\t");
};

describe("parsePanes", () => {
  it("FMT dan destructuring sama panjang", () => {
    expect(FIELDS).toHaveLength(15);
    expect(FIELDS[FIELDS.length - 1]).toBe("#{session_created}");
  });

  it("memetakan setiap kolom ke field yang benar", () => {
    const [p] = parsePanes(line());
    expect(p).toMatchObject({
      id: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
      cwd: "/tmp/wt", exited: false, agent: "codex", altScreen: false,
      activityAt: 1756000000, eventHook: true, startedAt: 1755999000,
    });
  });

  it("startedAt 0 saat tmux tak menjawab field itu", () => {
    const [p] = parsePanes(line({ "#{session_created}": "" }));
    expect(p!.startedAt).toBe(0);
  });

  it("baris di luar prefix hanoman dibuang", () => {
    expect(parsePanes(line({ "#{session_name}": "lain" }))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/pty-parse.test.ts
```
Expected: FAIL — `FMT` dan `parsePanes` bukan ekspor `../src/services/pty`.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/pty.ts`, tambahkan field ke tipe `Pane` (tepat sesudah `activityAt`):

```ts
  // SPEC-919 · `#{session_created}` — detik epoch saat sesi tmux dibuat, yaitu awal sesi hanoman
  // ini. Nol bila tmux tak menjawabnya. SENGAJA di luar `SessionInfo`, cermin `activityAt`/
  // `eventHook`: ia bahan presence, bukan bagian DTO yang disiarkan ke dashboard.
  startedAt: number;
```

Ubah `FMT` menjadi ekspor dan tambahkan field di **ujung** (posisi baru tak menggeser yang lama):

```ts
export const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}", "#{@hanoman_agent}", "#{alternate_on}",
  "#{window_activity}", "#{@hanoman_event_hook}", "#{session_created}",
].join("\t");
```

Di `parsePanes`, tambahkan variabel destructuring terakhir dan field hasilnya, lalu jadikan fungsinya ekspor:

```ts
export function parsePanes(out: string): Pane[] {
  return out.split("\n").filter(Boolean).flatMap((line) => {
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, agent,
      alternate, activity, eventHook, created] = line.split("\t");
```

dan di objek yang dikembalikan, tepat sesudah `activityAt,`:

```ts
      startedAt: Number(created) || 0,
```

Jadikan `listPanesAsync` dan tipe `Pane` ekspor:

```ts
export type Pane = SessionInfo & {
```

```ts
export async function listPanesAsync(): Promise<Pane[]> {
```

(hapus `const listPanesAsync = ...`-nya yang lama bila bentuknya berbeda; deklarasi `function` yang sudah ada tinggal diberi `export`.)

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/pty-parse.test.ts
```
Expected: PASS — 4 test.

- [ ] **Step 5: Typecheck server**

```bash
pnpm --filter ./server typecheck
```
Expected: keluar 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/pty.ts server/test/pty-parse.test.ts
git commit -m "feat(spec-919): stempel mulai sesi dari #{session_created}"
```

---

### Task 3: Snapshot presence lokal

**Files:**
- Create: `server/src/services/presence/snapshot.ts`
- Test: `server/test/presence-snapshot.test.ts`

**Interfaces:**
- Consumes: `Pane`, `listPanesAsync` (Task 2); `PresenceSession`, `MAX_PRESENCE_SESSIONS` (Task 1)
- Produces: `paneToPresence(p: Pane, phase?: string): PresenceSession`, `buildLocalPresence(): Promise<PresenceSession[]>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/presence-snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { paneToPresence } from "../src/services/presence/snapshot";
import type { Pane } from "../src/services/pty";

const pane = (over: Partial<Pane> = {}): Pane => ({
  id: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
  cwd: "/tmp/worktrees/spec-919", exited: false, code: 0, decision: false,
  agent: "claude", altScreen: false, activityAt: 1756000000, eventHook: true,
  startedAt: 1755999000, ...over,
});

describe("paneToPresence", () => {
  it("membawa identitas ringkas dan fase", () => {
    expect(paneToPresence(pane(), "Execute")).toEqual({
      sessionId: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
      phase: "Execute", agent: "claude", status: "working",
      startedAt: new Date(1755999000 * 1000).toISOString(),
    });
  });

  // Inilah bagian yang membuat SessionHistory LOCAL-only (schema.prisma:389) tak berlaku di sini.
  it("tidak pernah membawa cwd maupun path berkas", () => {
    const out = JSON.stringify(paneToPresence(pane(), "Execute"));
    expect(out).not.toContain("/tmp/worktrees");
    expect(out).not.toContain("cwd");
  });

  it("exited menang atas menunggu keputusan", () => {
    expect(paneToPresence(pane({ exited: true, decision: true })).status).toBe("exited");
  });

  it("decision → waiting", () => {
    expect(paneToPresence(pane({ decision: true })).status).toBe("waiting");
  });

  it("pane tanpa spec/flow/fase tetap sah", () => {
    const out = paneToPresence(pane({ specId: undefined, flow: undefined }));
    expect(out.specId).toBeUndefined();
    expect(out.flow).toBeUndefined();
    expect(out.phase).toBeUndefined();
  });

  it("startedAt 0 (tmux lama) jatuh ke epoch, bukan Invalid Date", () => {
    expect(paneToPresence(pane({ startedAt: 0 })).startedAt).toBe(new Date(0).toISOString());
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-snapshot.test.ts
```
Expected: FAIL — modul `presence/snapshot` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/presence/snapshot.ts`:

```ts
import { MAX_PRESENCE_SESSIONS, type PresenceSession } from "@hanoman/shared";
import { listPanesAsync, type Pane } from "../pty";
import { readPhases } from "../session-phases";

/* SPEC-919 · ADR-0148 · proyeksi pane tmux → snapshot presence.
   `cwd` SENGAJA dibuang: itulah bagian yang membuat `SessionHistory` local-only
   (schema.prisma:389) — baris yang menunjuk berkas yang tak ada di mesin penerima. */

const isoFromEpochSeconds = (s: number): string => new Date((s || 0) * 1000).toISOString();

export function paneToPresence(p: Pane, phase?: string): PresenceSession {
  return {
    sessionId: p.id,
    projectId: p.projectId,
    ...(p.specId ? { specId: p.specId } : {}),
    ...(p.flow ? { flow: p.flow } : {}),
    ...(phase ? { phase } : {}),
    agent: p.agent,
    // Presedensi: pane mati sudah berakhir apa pun isi markernya.
    status: p.exited ? "exited" : p.decision ? "waiting" : "working",
    startedAt: isoFromEpochSeconds(p.startedAt),
  };
}

/** Fase `active` sesi ini, atau undefined bila ia tak punya berkas fase (mis. konsol VPS). */
function activePhase(p: Pane): string | undefined {
  if (!p.flow || !p.phaseFile) return undefined;
  return readPhases(p.phaseFile, p.flow).find((f) => f.state === "active")?.name;
}

/** Snapshot mesin ini. Dipakai klien (untuk dikirim) DAN hub (untuk dirinya sendiri).
    Dipotong di plafon supaya frame tak pernah menabrak `maxPayload` socket sync. */
export async function buildLocalPresence(): Promise<PresenceSession[]> {
  const panes = await listPanesAsync();
  return panes.slice(0, MAX_PRESENCE_SESSIONS).map((p) => paneToPresence(p, activePhase(p)));
}
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-snapshot.test.ts
```
Expected: PASS — 6 test.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/presence/snapshot.ts server/test/presence-snapshot.test.ts
git commit -m "feat(spec-919): proyeksi pane tmux jadi snapshot presence"
```

---

### Task 4: Registry presence di memori

**Files:**
- Create: `server/src/services/presence/registry.ts`
- Test: `server/test/presence-registry.test.ts`

**Interfaces:**
- Consumes: `PresenceSession`, `PresenceSessionView`, `PRESENCE_OFFLINE_MS` (Task 1)
- Produces: `recordPresence(deviceId: string, sessions: PresenceSession[], now?: number): void`, `dropPresence(deviceId: string): void`, `presenceEntries(now?: number): PresenceEntry[]`, `type PresenceEntry = { deviceId: string; sessions: PresenceSessionView[] }`, `__resetPresence(): void`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/presence-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PRESENCE_OFFLINE_MS, type PresenceSession } from "@hanoman/shared";
import {
  recordPresence, dropPresence, presenceEntries, __resetPresence,
} from "../src/services/presence/registry";

const T0 = Date.parse("2026-08-24T01:00:00.000Z");
const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T00:00:00.000Z", ...over,
});

beforeEach(__resetPresence);

describe("registry presence", () => {
  it("mencatat sesi sebuah device", () => {
    recordPresence("dev1", [s()], T0);
    const [e] = presenceEntries(T0);
    expect(e!.deviceId).toBe("dev1");
    expect(e!.sessions).toHaveLength(1);
  });

  // Ganti-penuh, bukan merge: sesi yang hilang dari frame memang sudah tak ada di mesin itu.
  it("frame berikutnya MENGGANTI seluruh daftar", () => {
    recordPresence("dev1", [s({ sessionId: "a" }), s({ sessionId: "b" })], T0);
    recordPresence("dev1", [s({ sessionId: "b" })], T0 + 1000);
    expect(presenceEntries(T0 + 1000)[0]!.sessions.map((x) => x.sessionId)).toEqual(["b"]);
  });

  it("statusAt dicap saat pertama terlihat", () => {
    recordPresence("dev1", [s()], T0);
    expect(presenceEntries(T0)[0]!.sessions[0]!.statusAt).toBe(new Date(T0).toISOString());
  });

  // Inti keputusan "statusAt dihitung hub": denyut yang isinya sama tak boleh menggeser stempel.
  it("statusAt TIDAK bergerak selama status tetap", () => {
    recordPresence("dev1", [s()], T0);
    recordPresence("dev1", [s()], T0 + 60_000);
    expect(presenceEntries(T0 + 60_000)[0]!.sessions[0]!.statusAt).toBe(new Date(T0).toISOString());
  });

  it("statusAt bergerak saat status berubah", () => {
    recordPresence("dev1", [s()], T0);
    recordPresence("dev1", [s({ status: "waiting" })], T0 + 60_000);
    expect(presenceEntries(T0 + 60_000)[0]!.sessions[0]!.statusAt)
      .toBe(new Date(T0 + 60_000).toISOString());
  });

  it("device yang berhenti berdenyut lewat ambang lenyap", () => {
    recordPresence("dev1", [s()], T0);
    expect(presenceEntries(T0 + PRESENCE_OFFLINE_MS - 1)).toHaveLength(1);
    expect(presenceEntries(T0 + PRESENCE_OFFLINE_MS)).toHaveLength(0);
  });

  it("dropPresence menghapus device seketika", () => {
    recordPresence("dev1", [s()], T0);
    dropPresence("dev1");
    expect(presenceEntries(T0)).toHaveLength(0);
  });

  it("device lain tak terpengaruh", () => {
    recordPresence("dev1", [s()], T0);
    recordPresence("dev2", [s()], T0);
    dropPresence("dev1");
    expect(presenceEntries(T0).map((e) => e.deviceId)).toEqual(["dev2"]);
  });

  it("stempel sesi yang sudah lenyap tak ikut terbawa saat sesi lahir lagi", () => {
    recordPresence("dev1", [s({ sessionId: "a" })], T0);
    recordPresence("dev1", [], T0 + 1_000);
    recordPresence("dev1", [s({ sessionId: "a" })], T0 + 2_000);
    expect(presenceEntries(T0 + 2_000)[0]!.sessions[0]!.statusAt)
      .toBe(new Date(T0 + 2_000).toISOString());
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-registry.test.ts
```
Expected: FAIL — modul `presence/registry` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/presence/registry.ts`:

```ts
import { PRESENCE_OFFLINE_MS, type PresenceSession, type PresenceSessionView } from "@hanoman/shared";

/* SPEC-919 · ADR-0148 · keadaan hidup per-device, DI MEMORI.

   Ia tak menyentuh Prisma sama sekali — bukan "tabel yang kebetulan tak masuk `FIELDS`", tapi
   baris yang tak pernah lahir. Itu yang membuatnya mustahil membanjiri `SyncLog` walau suatu hari
   seseorang menambah entitas ke `SYNCED` tanpa membaca ADR ini. Ukurannya bukan selera: ADR-0131
   mengukur satu tulisan tersync per 5 menit per VPS menjadi 83% isi DB hub; presence berdenyut
   tiap 30 detik per device.

   Restart hub = peta kosong; klien mengisinya lagi dalam satu siklus reconnect. Keadaan basi punah
   dengan sendirinya, dan itu memang yang diminta. */

type Tracked = { session: PresenceSession; statusAt: number };
type Device = { sessions: Map<string, Tracked>; lastFrameAt: number };

export type PresenceEntry = { deviceId: string; sessions: PresenceSessionView[] };

const devices = new Map<string, Device>();

/** Ganti-penuh: frame membawa seluruh daftar sesi mesin itu, jadi yang tak disebut memang hilang.
    `statusAt` dicap di SINI supaya "bekerja" punya stempel yang jujur — klien tak bisa
    memberikannya tanpa mengirim aktivitas pane yang bergerak tiap detik. */
export function recordPresence(deviceId: string, sessions: PresenceSession[], now = Date.now()): void {
  const prev = devices.get(deviceId)?.sessions;
  const next = new Map<string, Tracked>();
  for (const session of sessions) {
    const before = prev?.get(session.sessionId);
    next.set(session.sessionId, {
      session,
      statusAt: before && before.session.status === session.status ? before.statusAt : now,
    });
  }
  devices.set(deviceId, { sessions: next, lastFrameAt: now });
}

/** Socket putus = device offline seketika; tak perlu menunggu ambang denyut. */
export function dropPresence(deviceId: string): void { devices.delete(deviceId); }

/** Device yang denyutnya berhenti melewati ambang disapu di sini — tak ada timer yang perlu hidup. */
export function presenceEntries(now = Date.now()): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [deviceId, d] of devices) {
    if (now - d.lastFrameAt >= PRESENCE_OFFLINE_MS) { devices.delete(deviceId); continue; }
    out.push({
      deviceId,
      sessions: [...d.sessions.values()].map((t) => ({
        ...t.session, statusAt: new Date(t.statusAt).toISOString(),
      })),
    });
  }
  return out;
}

/** Test-only: kosongkan peta. */
export function __resetPresence(): void { devices.clear(); }
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-registry.test.ts
```
Expected: PASS — 9 test.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/presence/registry.ts server/test/presence-registry.test.ts
git commit -m "feat(spec-919): registry presence di memori, nol tabel"
```

---

### Task 5: View presence (registry + DeviceToken + mesin lokal)

**Files:**
- Create: `server/src/services/presence/view.ts`
- Test: `server/test/presence-view.test.ts`

**Interfaces:**
- Consumes: `presenceEntries`, `recordPresence` (Task 4); `buildLocalPresence` (Task 3); `PresenceView`, `LOCAL_DEVICE_ID` (Task 1)
- Produces: `presenceView(o?: { local?: () => Promise<PresenceSession[]>; now?: number }): Promise<PresenceView>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/presence-view.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { hostname } from "node:os";
import { LOCAL_DEVICE_ID, type PresenceSession } from "@hanoman/shared";
import { prisma } from "../src/db";
import { recordPresence, __resetPresence } from "../src/services/presence/registry";
import { presenceView } from "../src/services/presence/view";

const T0 = Date.parse("2026-08-24T01:00:00.000Z");
const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T00:00:00.000Z", ...over,
});
const none = async () => [];

const clean = async () => {
  await prisma.deviceToken.deleteMany();
  await prisma.user.deleteMany();
};
const device = async (name: string, over: { revokedAt?: Date; lastSeenAt?: Date } = {}) => {
  const u = await prisma.user.create({ data: { email: `${name}@d.co`, passwordHash: "x:y" } });
  return prisma.deviceToken.create({
    data: { userId: u.id, name, tokenHash: `h-${name}`, ...over },
  });
};

beforeEach(async () => { __resetPresence(); await clean(); });
afterAll(clean);

describe("presenceView", () => {
  it("enabled false tanpa satu pun device token", async () => {
    expect((await presenceView({ local: none, now: T0 })).enabled).toBe(false);
  });

  it("enabled true begitu ada device token yang belum dicabut", async () => {
    await device("laptop");
    expect((await presenceView({ local: none, now: T0 })).enabled).toBe(true);
  });

  it("device yang dicabut tak dihitung dan tak ditampilkan", async () => {
    await device("lama", { revokedAt: new Date(T0) });
    const v = await presenceView({ local: none, now: T0 });
    expect(v.enabled).toBe(false);
    expect(v.devices.map((d) => d.name)).not.toContain("lama");
  });

  it("device terdaftar tanpa frame tampil offline berikut lastSeenAt", async () => {
    await device("laptop", { lastSeenAt: new Date(T0 - 3_600_000) });
    const [d] = (await presenceView({ local: none, now: T0 })).devices
      .filter((x) => x.deviceId !== LOCAL_DEVICE_ID);
    expect(d!.online).toBe(false);
    expect(d!.lastSeenAt).toBe(new Date(T0 - 3_600_000).toISOString());
    expect(d!.sessions).toEqual([]);
  });

  it("device yang berdenyut tampil online berikut sesinya", async () => {
    const d = await device("laptop");
    recordPresence(d.id, [s()], T0);
    const found = (await presenceView({ local: none, now: T0 })).devices.find((x) => x.deviceId === d.id);
    expect(found!.online).toBe(true);
    expect(found!.sessions[0]!.sessionId).toBe("spec-919");
  });

  // Requirement 5: sesi hub sendiri lewat pintu yang SAMA — tak ada sumber kebenaran kedua.
  it("mesin lokal selalu ada, bernama hostname, dan ditandai local", async () => {
    await device("laptop");
    const v = await presenceView({ local: async () => [s({ sessionId: "lokal" })], now: T0 });
    const me = v.devices.find((d) => d.deviceId === LOCAL_DEVICE_ID);
    expect(me).toMatchObject({ local: true, online: true, name: hostname() });
    expect(me!.sessions[0]!.sessionId).toBe("lokal");
  });

  it("mesin lokal didahulukan di daftar", async () => {
    await device("laptop");
    const v = await presenceView({ local: none, now: T0 });
    expect(v.devices[0]!.deviceId).toBe(LOCAL_DEVICE_ID);
  });

  it("registry tanpa baris DeviceToken padanan diabaikan (token dihapus saat socket masih hidup)", async () => {
    recordPresence("hantu", [s()], T0);
    const v = await presenceView({ local: none, now: T0 });
    expect(v.devices.map((d) => d.deviceId)).not.toContain("hantu");
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-view.test.ts
```
Expected: FAIL — modul `presence/view` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/presence/view.ts`:

```ts
import { hostname } from "node:os";
import {
  LOCAL_DEVICE_ID, type PresenceDeviceView, type PresenceSession, type PresenceView,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { buildLocalPresence } from "./snapshot";
import { presenceEntries, recordPresence } from "./registry";

/* SPEC-919 · ADR-0148 · gabungan katalog device (DB, persisten) + keadaan hidup (memori).

   Nama device TIDAK disimpan di registry: ia sudah hidup di `DeviceToken` dan mengambilnya dari
   satu tempat saja meniadakan pertanyaan "salinan mana yang benar sesudah rename" — kebalikan
   sadar dari `HandledByEntry` (ADR-0135), yang HARUS menyimpan snapshot nama justru karena
   penerimanya client yang tak punya katalog device sama sekali.

   `presenceView` menyegarkan sesi mesin ini sebagai efek samping: satu-satunya pemanggilnya
   adalah build grup siar dan route fallback-nya, dan keduanya memang ingin angka terbaru. */

export async function presenceView(
  o: { local?: () => Promise<PresenceSession[]>; now?: number } = {},
): Promise<PresenceView> {
  const now = o.now ?? Date.now();
  const local = o.local ?? buildLocalPresence;

  // Requirement 5 · sesi mesin ini masuk lewat pintu yang SAMA dengan device remote, supaya
  // `statusAt` dan bentuk barisnya lahir dari satu rumus.
  recordPresence(LOCAL_DEVICE_ID, await local().catch(() => []), now);

  const live = new Map(presenceEntries(now).map((e) => [e.deviceId, e.sessions]));
  const rows = await prisma.deviceToken.findMany({
    where: { revokedAt: null }, orderBy: { createdAt: "asc" },
  });

  const devices: PresenceDeviceView[] = [{
    deviceId: LOCAL_DEVICE_ID, name: hostname(), local: true, online: true,
    lastSeenAt: new Date(now).toISOString(), sessions: live.get(LOCAL_DEVICE_ID) ?? [],
  }];
  for (const r of rows) {
    const sessions = live.get(r.id);
    devices.push({
      deviceId: r.id, name: r.name, local: false, online: !!sessions,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      sessions: sessions ?? [],
    });
  }

  // Gerbang requirement 7: instalasi satu mesin (nol device token) tak berubah tampilannya.
  return { enabled: rows.length > 0, devices };
}
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-view.test.ts
```
Expected: PASS — 8 test.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/presence/view.ts server/test/presence-view.test.ts
git commit -m "feat(spec-919): view presence gabung katalog device dan keadaan hidup"
```

---

### Task 6: Grup siar `presence` + `GET /api/presence`

**Files:**
- Modify: `shared/src/dto.ts` (varian `EventMsg`), `shared/src/api.ts` (`paths.presence`), `server/src/services/events.ts` (GROUPS), `server/src/services/agent-capabilities.ts`, `server/src/app.ts`
- Create: `server/src/routes/presence.ts`
- Test: `server/test/presence.route.test.ts`

**Interfaces:**
- Consumes: `presenceView` (Task 5)
- Produces: `EventMsg` varian `{ t: "presence"; enabled: boolean; devices: PresenceDeviceView[] }`, `paths.presence`, route `GET /api/presence`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/presence.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { __resetPresence, recordPresence } from "../src/services/presence/registry";
import { LOCAL_DEVICE_ID, paths } from "@hanoman/shared";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetPresence(); await clean(); });

describe("GET /api/presence", () => {
  it("menjawab view berisi mesin lokal", async () => {
    const res = await app.inject({ method: "GET", url: paths.presence });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; devices: { deviceId: string }[] };
    expect(body.enabled).toBe(false);
    expect(body.devices[0]!.deviceId).toBe(LOCAL_DEVICE_ID);
  });

  it("memuat device yang sedang berdenyut", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const d = await prisma.deviceToken.create({
      data: { userId: u.id, name: "laptop", tokenHash: "h1" },
    });
    recordPresence(d.id, [{
      sessionId: "spec-919", projectId: "hanoman", agent: "claude",
      status: "working", startedAt: "2026-08-24T00:00:00.000Z",
    }]);
    const body = (await app.inject({ method: "GET", url: paths.presence })).json() as
      { enabled: boolean; devices: { deviceId: string; online: boolean }[] };
    expect(body.enabled).toBe(true);
    expect(body.devices.find((x) => x.deviceId === d.id)!.online).toBe(true);
  });

  // Peta pekerjaan lintas mesin bukan sesuatu yang boleh didelegasikan ke agent token.
  it("tak boleh didelegasikan ke agent token", () => {
    expect(capabilityForRoute("GET", "/api/presence")).toBe("COOKIE_ONLY");
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence.route.test.ts
```
Expected: FAIL — `paths.presence` tak ada.

- [ ] **Step 3: Implementasi minimal**

`shared/src/api.ts` — tambahkan tepat sesudah baris `eventsWs`:

```ts
  // SPEC-919 · ADR-0147 · muat awal + fallback halaman Klien. Selama WS sehat tak ada yang men-poll-nya.
  presence: `${API}/presence`,
```

`shared/src/dto.ts` — tambahkan import tipe di kepala berkas (gabungkan ke baris import `./presence` bila sudah ada) dan varian baru di union `EventMsg`, tepat sesudah varian `leadAsks`:

```ts
  // SPEC-919 · ADR-0147 · grup GLOBAL ke-9: sesi hidup di semua device yang tersambung ke hub ini.
  // Grup, bukan topik berlangganan (ADR-0145): muatannya tak berparameter — satu snapshot yang
  // sama untuk semua penonton.
  | { t: "presence"; enabled: boolean; devices: PresenceDeviceView[] }
```

Pastikan `PresenceDeviceView` ter-import di `shared/src/dto.ts`:

```ts
import type { PresenceDeviceView } from "./presence";
```

`server/src/services/events.ts` — tambahkan import dan grup baru di ujung `GROUPS`:

```ts
import { presenceView } from "./presence/view";
```

```ts
  // SPEC-919 · ADR-0147 · sesi hidup lintas device. 3 dtk: presence berdenyut 30 dtk, jadi kadens
  // lebih rapat hanya menambah build tanpa menambah informasi. `presenceView` menyegarkan sesi
  // mesin ini sendiri di dalamnya — satu `tmux list-panes` asinkron, tak menahan event loop.
  { everyTicks: 3, last: "", build: async () => ({ t: "presence", ...(await presenceView()) }) },
```

`server/src/services/agent-capabilities.ts` — tambahkan `presence` ke daftar tak-boleh-didelegasikan:

```ts
  // SPEC-919 · ADR-0147 · `presence` memaparkan peta pekerjaan yang sedang berjalan di SELURUH
  // mesin operator. Tak ada capability yang berarti apa pun untuk itu (preseden /device-tokens).
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
    || top === "presence"
    || top === "portal" || top === "client-accounts" || top === "session-events") return "COOKIE_ONLY";
```

Buat `server/src/routes/presence.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { presenceView } from "../services/presence/view";

// SPEC-919 · ADR-0147 · muat awal + fallback halaman Klien. Bukan jalur polling: selama
// `/api/events/ws` sehat, grup siar `presence` yang mengantarkan pembaruan (ADR-0039/0145).
export default async function (app: FastifyInstance) {
  app.get("/presence", async () => presenceView());
}
```

`server/src/app.ts` — import dan daftarkan di samping route lain:

```ts
import presence from "./routes/presence";
```

```ts
    await api.register(presence);   // SPEC-919 · ADR-0147 · muat awal halaman Klien
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence.route.test.ts server/test/agent-capabilities.test.ts
```
Expected: PASS — 3 test baru + suite capability yang sudah ada tetap hijau.

- [ ] **Step 5: Typecheck shared + server**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```
Expected: keluar 0.

- [ ] **Step 6: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts server/src/services/events.ts \
  server/src/services/agent-capabilities.ts server/src/routes/presence.ts server/src/app.ts \
  server/test/presence.route.test.ts
git commit -m "feat(spec-919): grup siar presence + GET /api/presence"
```

---

### Task 7: Pintu masuk hub — frame `presence` di `/api/sync/ws`

**Files:**
- Modify: `server/src/routes/sync.ts:150-162`
- Test: `server/test/sync-ws-presence.test.ts` (baru)

**Interfaces:**
- Consumes: `recordPresence`, `dropPresence` (Task 4); `zPresenceFrame`, `PRESENCE_MAX_FRAMES_PER_MIN` (Task 1); `WsMessageGuard` (`server/src/services/ws-admission.ts:227`)
- Produces: — (perilaku route)

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-ws-presence.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { PRESENCE_PROTOCOL, type PresenceSession } from "@hanoman/shared";
import { presenceEntries, __resetPresence } from "../src/services/presence/registry";

const app = buildApp({ requireAuth: false });
let origin = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };

beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetPresence(); await clean(); });

async function token() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}
const open = (tok: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://${origin}/api/sync/ws`, { headers: { authorization: `Bearer ${tok}` } });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

const session: PresenceSession = {
  sessionId: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
  phase: "Execute", agent: "claude", status: "working", startedAt: "2026-08-24T00:00:00.000Z",
};
const frame = (sessions: PresenceSession[]) =>
  JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions });

describe("frame presence di /api/sync/ws", () => {
  it("mencatat sesi ke registry, beratribusi device dari TOKEN", async () => {
    const t = await token();
    const ws = await open(t.token);
    ws.send(frame([session]));
    await waitFor(() => presenceEntries().length > 0);
    const [e] = presenceEntries();
    expect(e!.deviceId).toBe(t.id);
    expect(e!.sessions[0]!.specId).toBe("SPEC-919");
    ws.close();
  });

  it("device lenyap saat socket ditutup", async () => {
    const t = await token();
    const ws = await open(t.token);
    ws.send(frame([session]));
    await waitFor(() => presenceEntries().length > 0);
    ws.close();
    await waitFor(() => presenceEntries().length === 0);
  });

  // Kanal ini mengangkut changefeed sync. Frame presence yang buruk TAK BOLEH menutupnya.
  it("frame rusak dibuang, socket tetap hidup", async () => {
    const t = await token();
    const ws = await open(t.token);
    ws.send("{bukan json");
    ws.send(JSON.stringify({ t: "presence", v: 99, sessions: [] }));
    ws.send(JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions: [{ ...session, cwd: "/rahasia" }] }));
    await new Promise((r) => setTimeout(r, 150));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(presenceEntries()).toHaveLength(0);
    ws.send(frame([session]));
    await waitFor(() => presenceEntries().length > 0);
    ws.close();
  });

  it("frame di atas jatah laju dibuang tanpa menutup socket", async () => {
    const t = await token();
    const ws = await open(t.token);
    for (let i = 0; i < 80; i++) ws.send(frame([{ ...session, sessionId: `s${i}` }]));
    await new Promise((r) => setTimeout(r, 250));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("tanpa device token upgrade ditolak", async () => {
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${origin}/api/sync/ws`);
      ws.on("open", () => resolve("open"));
      ws.on("error", reject);
    })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/sync-ws-presence.test.ts
```
Expected: FAIL — registry tetap kosong (`timeout`), karena route belum membaca frame masuk.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/routes/sync.ts`, tambahkan import:

```ts
import { PRESENCE_MAX_FRAMES_PER_MIN, zPresenceFrame } from "@hanoman/shared";
import { WsMessageGuard } from "../services/ws-admission";
import { recordPresence, dropPresence } from "../services/presence/registry";
```

Lalu di dalam handler `app.get("/sync/ws", …)`, sesudah `attachSync(client);` dan sebelum `const revalidate = …`:

```ts
    /* SPEC-919 · ADR-0147 · arah naik kanal ini. Sebelumnya `/sync/ws` tak pernah memasang
       `socket.on("message")` sama sekali — dan justru itulah yang membuat hub versi LAMA
       mengabaikan frame presence tanpa satu pun error, sehingga klien baru tetap sync normal.

       Semua kegagalan di sini DIBUANG, tak pernah menutup socket: kanal yang sama mengangkut
       changefeed sync, dan kegagalan status tak boleh menjatuhkannya. Itu sebabnya verdict
       `WsMessageGuard` di sini diabaikan alih-alih diterjemahkan jadi close 1008/1009 seperti
       di `/events/ws`, yang socket-nya milik dashboard. */
    const guard = new WsMessageGuard({ perWindow: PRESENCE_MAX_FRAMES_PER_MIN });
    socket.on("message", (raw: Buffer) => {
      try {
        if (!guard.accept(raw).ok) return;
        const parsed = zPresenceFrame.safeParse(JSON.parse(raw.toString("utf8")));
        if (!parsed.success) return;
        // deviceId SELALU dari token terverifikasi — payload tak pernah boleh menamai dirinya.
        recordPresence(principal.id, parsed.data.sessions);
      } catch { /* frame rusak — dibuang */ }
    });
```

dan lengkapi handler `close` yang sudah ada:

```ts
    socket.on("close", () => { clearInterval(revalidate); release(); detachSync(client); dropPresence(principal.id); });
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/sync-ws-presence.test.ts server/test/sync-ws.test.ts
```
Expected: PASS — 5 test baru + suite `sync-ws` yang sudah ada tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/sync.ts server/test/sync-ws-presence.test.ts
git commit -m "feat(spec-919): hub membaca frame presence di kanal sync"
```

---

### Task 8: Pengirim presence di klien + reconnect ber-backoff

**Files:**
- Create: `server/src/services/presence/sender.ts`
- Modify: `server/src/services/sync-client.ts:407-484`
- Test: `server/test/presence-sender.test.ts` (baru), `server/test/sync-backoff.test.ts` (baru)

**Interfaces:**
- Consumes: `buildLocalPresence` (Task 3); `presenceSignature`, `PRESENCE_PROTOCOL`, `PRESENCE_HEARTBEAT_MS`, `PRESENCE_TICK_MS` (Task 1)
- Produces:
  - `createPresenceSender(o: { send: (json: string) => void; build: () => Promise<PresenceSession[]>; heartbeatMs?: number }): { tick(now: number): Promise<void> }`
  - `startPresenceSender(o: { send: (json: string) => void; build?: () => Promise<PresenceSession[]>; tickMs?: number; heartbeatMs?: number }): { stop(): void }`
  - `nextBackoff(prev: number): number`, `withJitter(ms: number, rnd?: () => number): number`, `RECONNECT_MIN_MS`, `RECONNECT_MAX_MS` (dari `sync-client.ts`)

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/presence-sender.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PRESENCE_HEARTBEAT_MS, PRESENCE_PROTOCOL, type PresenceSession } from "@hanoman/shared";
import { createPresenceSender } from "../src/services/presence/sender";

const T0 = 1_000_000;
const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T00:00:00.000Z", ...over,
});

function harness(build: () => Promise<PresenceSession[]>) {
  const sent: string[] = [];
  return { sent, sender: createPresenceSender({ send: (j) => sent.push(j), build }) };
}

describe("pengirim presence", () => {
  it("mengirim pada tick pertama", async () => {
    const h = harness(async () => [s()]);
    await h.sender.tick(T0);
    expect(h.sent).toHaveLength(1);
    expect(JSON.parse(h.sent[0]!)).toMatchObject({ t: "presence", v: PRESENCE_PROTOCOL });
  });

  it("diam saat isinya tak berubah dan denyut belum jatuh tempo", async () => {
    const h = harness(async () => [s()]);
    await h.sender.tick(T0);
    await h.sender.tick(T0 + 3_000);
    await h.sender.tick(T0 + 6_000);
    expect(h.sent).toHaveLength(1);
  });

  it("mengirim saat status berubah", async () => {
    let status: PresenceSession["status"] = "working";
    const h = harness(async () => [s({ status })]);
    await h.sender.tick(T0);
    status = "waiting";
    await h.sender.tick(T0 + 3_000);
    expect(h.sent).toHaveLength(2);
  });

  it("mengirim saat sesi hilang", async () => {
    let list = [s()];
    const h = harness(async () => list);
    await h.sender.tick(T0);
    list = [];
    await h.sender.tick(T0 + 3_000);
    expect(h.sent).toHaveLength(2);
    expect(JSON.parse(h.sent[1]!).sessions).toEqual([]);
  });

  it("denyut mengirim ulang walau isinya sama", async () => {
    const h = harness(async () => [s()]);
    await h.sender.tick(T0);
    await h.sender.tick(T0 + PRESENCE_HEARTBEAT_MS);
    expect(h.sent).toHaveLength(2);
  });

  // Kegagalan snapshot tak boleh merambat ke socket sync.
  it("build yang melempar tidak melempar keluar dan tidak mengirim apa-apa", async () => {
    const h = harness(async () => { throw new Error("tmux mati"); });
    await expect(h.sender.tick(T0)).resolves.toBeUndefined();
    expect(h.sent).toHaveLength(0);
  });

  it("send yang melempar ditelan", async () => {
    const sender = createPresenceSender({
      send: () => { throw new Error("socket tertutup"); },
      build: async () => [s()],
    });
    await expect(sender.tick(T0)).resolves.toBeUndefined();
  });
});
```

Buat `server/test/sync-backoff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextBackoff, withJitter, RECONNECT_MIN_MS, RECONNECT_MAX_MS } from "../src/services/sync-client";

describe("backoff reconnect sync", () => {
  it("mulai dari minimum lalu berlipat", () => {
    expect(nextBackoff(0)).toBe(RECONNECT_MIN_MS);
    expect(nextBackoff(RECONNECT_MIN_MS)).toBe(RECONNECT_MIN_MS * 2);
    expect(nextBackoff(4_000)).toBe(8_000);
  });

  it("dijepit di plafon", () => {
    expect(nextBackoff(RECONNECT_MAX_MS)).toBe(RECONNECT_MAX_MS);
    expect(nextBackoff(RECONNECT_MAX_MS * 4)).toBe(RECONNECT_MAX_MS);
  });

  it("jitter ±20% dan deterministik terhadap sumber acaknya", () => {
    expect(withJitter(10_000, () => 0)).toBe(8_000);
    expect(withJitter(10_000, () => 1)).toBe(12_000);
    expect(withJitter(10_000, () => 0.5)).toBe(10_000);
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-sender.test.ts server/test/sync-backoff.test.ts
```
Expected: FAIL — `createPresenceSender` dan `nextBackoff` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/presence/sender.ts`:

```ts
import {
  PRESENCE_HEARTBEAT_MS, PRESENCE_PROTOCOL, PRESENCE_TICK_MS, presenceSignature,
  type PresenceSession,
} from "@hanoman/shared";
import { buildLocalPresence } from "./snapshot";

/* SPEC-919 · ADR-0147 · sisi KLIEN: menaikkan snapshot sesi mesin ini ke hub.

   `send` disuntik, bukan diimpor. Itu yang membuat modul ini bisa diuji tanpa satu pun WebSocket,
   dan yang membuat "kanal status tak boleh menjatuhkan sync" terbaca dari tipenya: modul ini tak
   memegang socket dan tak bisa menutupnya. */

export type PresenceSender = { tick(now: number): Promise<void> };

export function createPresenceSender(o: {
  send: (json: string) => void;
  build: () => Promise<PresenceSession[]>;
  heartbeatMs?: number;
}): PresenceSender {
  const heartbeatMs = o.heartbeatMs ?? PRESENCE_HEARTBEAT_MS;
  let lastSignature: string | null = null;
  let lastSentAt = 0;

  return {
    async tick(now: number): Promise<void> {
      let sessions: PresenceSession[];
      // tmux mati / belum jalan bukan alasan untuk mengganggu socket sync.
      try { sessions = await o.build(); } catch { return; }

      const signature = presenceSignature(sessions);
      const due = lastSignature === null
        || signature !== lastSignature
        || now - lastSentAt >= heartbeatMs;
      if (!due) return;

      lastSignature = signature;
      lastSentAt = now;
      try { o.send(JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions })); }
      catch { /* socket sudah tertutup — siklus reconnect yang mengurusnya */ }
    },
  };
}

/** Pembungkus `setInterval` untuk pemakaian nyata. Timer di-`unref` supaya tak menahan proses. */
export function startPresenceSender(o: {
  send: (json: string) => void;
  build?: () => Promise<PresenceSession[]>;
  tickMs?: number;
  heartbeatMs?: number;
}): { stop(): void } {
  const sender = createPresenceSender({
    send: o.send, build: o.build ?? buildLocalPresence, heartbeatMs: o.heartbeatMs,
  });
  void sender.tick(Date.now());
  const timer = setInterval(() => { void sender.tick(Date.now()); }, o.tickMs ?? PRESENCE_TICK_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
```

Di `server/src/services/sync-client.ts`, tambahkan import:

```ts
import { startPresenceSender } from "./presence/sender";
```

Tambahkan konstanta + helper murni di dekat deklarasi `let ws` (sebelum `syncStatus`):

```ts
/* SPEC-919 · ADR-0147 · reconnect dulu `setTimeout(…, 3000)` datar: terhadap hub yang mati ia
   mengetuk 20×/menit selamanya, dan timernya TAK PERNAH dibatalkan — `stopSyncClient()` menyetel
   `started=false` tapi ketukan yang tertunda tetap jalan, sehingga `applySyncConfig()` (stop lalu
   start) meninggalkan satu socket yatim yang menyambung memakai token LAMA. */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const nextBackoff = (prev: number): number =>
  prev <= 0 ? RECONNECT_MIN_MS : Math.min(RECONNECT_MAX_MS, prev * 2);
export const withJitter = (ms: number, rnd: () => number = Math.random): number =>
  Math.round(ms * (0.8 + rnd() * 0.4));
```

Tambahkan state modul di samping `let ws`:

```ts
let reconnectTimer: NodeJS.Timeout | undefined;
let reconnectDelay = 0;
let presence: { stop(): void } | undefined;
```

Ganti isi `connectWs` di `startSyncClient` menjadi:

```ts
  const connectWs = async () => {
    const { WebSocket } = await import("ws");
    const wsUrl = base.replace(/^http/, "ws").replace(/\/$/, "") + "/api/sync/ws";
    ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${token}` } });
    ws.on("open", () => {
      reconnectDelay = 0;
      void tick();
      // SPEC-919 · ADR-0147 · arah naik. Hub versi lama tak memasang `socket.on("message")`,
      // jadi frame-frame ini jatuh ke lantai di sana tanpa merusak apa pun.
      presence = startPresenceSender({ send: (json) => ws?.send(json) });
    });
    ws.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.t !== "sync") return;
        // SPEC-382 · frame yang belum bisa diterapkan menahan kursor lalu ditambal lewat pull —
        // dulu kegagalan ditelan diam-diam dan frame berikutnya memajukan kursor melewatinya.
        if (!(await applyFeedFrame(msg))) void tick();
      } catch { /* frame rusak — abaikan */ }
    });
    ws.on("close", () => {
      presence?.stop(); presence = undefined;
      if (!started) return;
      reconnectDelay = nextBackoff(reconnectDelay);
      reconnectTimer = setTimeout(() => { void connectWs(); }, withJitter(reconnectDelay));
      reconnectTimer.unref?.();
    });
    ws.on("error", () => { try { ws?.close(); } catch { /* noop */ } });
  };
```

Lengkapi `stopSyncClient`:

```ts
export function stopSyncClient(): void {
  started = false;
  if (timer) { clearInterval(timer); timer = undefined; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = undefined; }
  reconnectDelay = 0;
  presence?.stop(); presence = undefined;
  try { ws?.close(); } catch { /* noop */ }
  ws = undefined;
}
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/presence-sender.test.ts \
  server/test/sync-backoff.test.ts server/test/sync-client.test.ts
```
Expected: PASS — 10 test baru + suite `sync-client` yang sudah ada tetap hijau.

- [ ] **Step 5: Typecheck server**

```bash
pnpm --filter ./server typecheck
```
Expected: keluar 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/presence/sender.ts server/src/services/sync-client.ts \
  server/test/presence-sender.test.ts server/test/sync-backoff.test.ts
git commit -m "feat(spec-919): klien menyiarkan presence + reconnect ber-backoff"
```

---

### Task 9: Halaman "Klien" + gerbang navigasi

**Files:**
- Create: `src/src/screens/presence-map.ts`, `src/src/screens/ClientsScreen.tsx`
- Modify: `src/src/api/client.ts`, `src/src/ds/shell.tsx:19-42,175`, `src/src/App.tsx`
- Test: `src/test/presence-map.test.ts` (baru), `src/test/clients-screen.test.tsx` (baru)

**Interfaces:**
- Consumes: `PresenceView`, `PresenceDeviceView` (Task 1); `paths.presence` (Task 6)
- Produces: `presenceIndex(view: PresenceView): { bySpec: Map<string, string[]>; byProject: Map<string, string[]> }`, `<ClientsScreen view onOpenSpec />`, `api.presence()`, `NavGate` context, `NavItem.gate`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/presence-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { presenceIndex } from "../src/screens/presence-map";
import type { PresenceView } from "@hanoman/shared";

const view = (over: Partial<PresenceView> = {}): PresenceView => ({
  enabled: true,
  devices: [{
    deviceId: "local", name: "mac-dena", local: true, online: true, lastSeenAt: null,
    sessions: [{
      sessionId: "spec-1", projectId: "hanoman", specId: "SPEC-1", agent: "claude",
      status: "working", startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
    }],
  }, {
    deviceId: "d2", name: "laptop", local: false, online: true, lastSeenAt: null,
    sessions: [{
      sessionId: "spec-2", projectId: "tumbuh", specId: "SPEC-2", agent: "codex",
      status: "waiting", startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
    }, {
      sessionId: "spec-3", projectId: "hanoman", specId: "SPEC-3", agent: "claude",
      status: "exited", startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
    }],
  }],
  ...over,
});

describe("presenceIndex", () => {
  it("memetakan spec ke nama device", () => {
    const { bySpec } = presenceIndex(view());
    expect(bySpec.get("SPEC-1")).toEqual(["mac-dena"]);
    expect(bySpec.get("SPEC-2")).toEqual(["laptop"]);
  });

  it("sesi yang sudah berakhir tak menandai apa pun", () => {
    expect(presenceIndex(view()).bySpec.has("SPEC-3")).toBe(false);
  });

  it("memetakan project, tanpa nama ganda", () => {
    const { byProject } = presenceIndex(view());
    expect(byProject.get("hanoman")).toEqual(["mac-dena"]);
    expect(byProject.get("tumbuh")).toEqual(["laptop"]);
  });

  it("device offline tak menandai apa pun", () => {
    const v = view();
    v.devices[1]!.online = false;
    expect(presenceIndex(v).bySpec.has("SPEC-2")).toBe(false);
  });

  it("view yang dimatikan menghasilkan peta kosong", () => {
    const { bySpec, byProject } = presenceIndex(view({ enabled: false }));
    expect(bySpec.size).toBe(0);
    expect(byProject.size).toBe(0);
  });
});
```

Buat `src/test/clients-screen.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClientsScreen } from "../src/screens/ClientsScreen";
import type { PresenceView } from "@hanoman/shared";

const view: PresenceView = {
  enabled: true,
  devices: [{
    deviceId: "local", name: "mac-dena", local: true, online: true,
    lastSeenAt: "2026-08-24T01:00:00.000Z",
    sessions: [{
      sessionId: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
      phase: "Execute", agent: "claude", status: "working",
      startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:30:00.000Z",
    }],
  }, {
    deviceId: "d2", name: "laptop", local: false, online: false,
    lastSeenAt: "2026-08-23T20:00:00.000Z", sessions: [],
  }],
};

describe("ClientsScreen", () => {
  it("menampilkan device online dan offline", () => {
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByText("mac-dena")).toBeTruthy();
    expect(screen.getByText("laptop")).toBeTruthy();
    expect(screen.getByTestId("device-state-local").textContent).toContain("online");
    expect(screen.getByTestId("device-state-d2").textContent).toContain("offline");
  });

  it("menampilkan sesi berikut fase dan judul spec", () => {
    render(<ClientsScreen view={view} specTitles={{ "SPEC-919": "Hub melihat sesi klien" }}
      onOpenSpec={() => {}} />);
    expect(screen.getByText("SPEC-919")).toBeTruthy();
    expect(screen.getByText("Hub melihat sesi klien")).toBeTruthy();
    expect(screen.getByTestId("presence-session-spec-919").textContent).toContain("Execute");
  });

  it("baris SPEC bisa diklik ke detail backlog", () => {
    const onOpenSpec = vi.fn();
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={onOpenSpec} />);
    fireEvent.click(screen.getByTestId("presence-session-spec-919"));
    expect(onOpenSpec).toHaveBeenCalledWith("SPEC-919");
  });

  it("device tanpa sesi memberi kalimat kosong, bukan daftar kosong", () => {
    render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={() => {}} />);
    expect(screen.getByTestId("device-empty-d2")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
pnpm vitest --run --no-file-parallelism src/test/presence-map.test.ts src/test/clients-screen.test.tsx
```
Expected: FAIL — modul `presence-map` dan `ClientsScreen` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `src/src/screens/presence-map.ts`:

```ts
import type { PresenceView } from "@hanoman/shared";

/* SPEC-919 · ADR-0147 · indeks murni supaya penanda di Backlog/Projects punya SATU rumus.
   `activeSpecs` di App tetap ada dan tetap berarti hal lain: "ada sesi di MESIN INI yang bisa
   dibuka" — ia menggerbangi tombol, bukan penanda. */

const push = (m: Map<string, string[]>, key: string, name: string) => {
  const names = m.get(key);
  if (!names) { m.set(key, [name]); return; }
  if (!names.includes(name)) names.push(name);
};

export function presenceIndex(view: PresenceView): {
  bySpec: Map<string, string[]>; byProject: Map<string, string[]>;
} {
  const bySpec = new Map<string, string[]>();
  const byProject = new Map<string, string[]>();
  if (!view.enabled) return { bySpec, byProject };
  for (const d of view.devices) {
    if (!d.online) continue;
    for (const s of d.sessions) {
      if (s.status === "exited") continue;
      if (s.specId) push(bySpec, s.specId, d.name);
      push(byProject, s.projectId, d.name);
    }
  }
  return { bySpec, byProject };
}
```

Buat `src/src/screens/ClientsScreen.tsx`:

```tsx
import React from "react";
import { Card, Badge, StateBlock } from "../ds";
import { Icon } from "../ds/icon";
import type { PresenceDeviceView, PresenceSessionView, PresenceView } from "@hanoman/shared";

/* SPEC-919 · ADR-0147 · halaman "Klien": device yang sinkron ke hub ini, dan pekerjaan yang
   sedang berjalan di masing-masing. Tak ada isi terminal di sini — menempel ke sesi klien dari
   hub sengaja di luar lingkup (butuh relay WS lintas instance + gerbang auth sendiri). */

const STATUS: Record<PresenceSessionView["status"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  working: { label: "bekerja", tone: "ok" },
  waiting: { label: "menunggu keputusan", tone: "warn" },
  exited: { label: "selesai", tone: "neutral" },
};

function sinceLabel(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} jam ${m % 60} mnt` : `${Math.floor(h / 24)} hari`;
}

function SessionRow({ s, title, onOpenSpec, now }:
  { s: PresenceSessionView; title?: string; onOpenSpec: (specId: string) => void; now: number }) {
  const clickable = !!s.specId;
  const st = STATUS[s.status];
  return (
    <div data-testid={`presence-session-${s.sessionId}`}
      role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onOpenSpec(s.specId!) : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSpec(s.specId!); }
      } : undefined}
      style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, minWidth: 0,
        padding: "9px 10px", borderRadius: "var(--radius-sm)",
        borderBottom: "1px solid var(--border-hair)", cursor: clickable ? "pointer" : "default",
      }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>
        {s.specId ?? s.sessionId}
      </span>
      <span style={{ flex: 1, minWidth: 120, fontSize: 13.5, color: "var(--text-strong)" }}>
        {title ?? s.projectId}
      </span>
      <Badge tone="neutral" size="sm" icon="box">{s.projectId}</Badge>
      {s.phase && <Badge tone="brass" size="sm">{s.phase}</Badge>}
      <Badge tone={st.tone} size="sm">{st.label}</Badge>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
        {sinceLabel(s.startedAt, now)}
      </span>
    </div>
  );
}

function DeviceCard({ d, specTitles, onOpenSpec, now }:
  { d: PresenceDeviceView; specTitles: Record<string, string>;
    onOpenSpec: (specId: string) => void; now: number }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <Icon name="monitor" size={16} color="var(--text-muted)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 500, color: "var(--text-strong)" }}>
          {d.name}
        </span>
        {d.local && <Badge tone="neutral" size="sm">hub ini</Badge>}
        <Badge data-testid={`device-state-${d.deviceId}`} size="sm" tone={d.online ? "ok" : "neutral"}>
          {d.online ? "online" : "offline"}
        </Badge>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
          terakhir terlihat {d.lastSeenAt ? sinceLabel(d.lastSeenAt, now) + " lalu" : "—"}
        </span>
      </div>
      {d.sessions.length === 0
        ? (
          <div data-testid={`device-empty-${d.deviceId}`}
            style={{ fontSize: 12, color: "var(--text-subtle)", padding: "6px 2px" }}>
            Tak ada sesi berjalan.
          </div>
        )
        : d.sessions.map((s) => (
          <SessionRow key={s.sessionId} s={s} title={s.specId ? specTitles[s.specId] : undefined}
            onOpenSpec={onOpenSpec} now={now} />
        ))}
    </Card>
  );
}

export function ClientsScreen({ view, specTitles, onOpenSpec }:
  { view: PresenceView; specTitles: Record<string, string>; onOpenSpec: (specId: string) => void }) {
  // Satu stempel per render: dua baris yang lahir dari render yang sama tak boleh menghitung
  // "sudah berapa lama" dari dua titik waktu berbeda.
  const now = Date.now();
  if (view.devices.length === 0) {
    return (
      <StateBlock kind="empty" icon="monitor" title="Belum ada device"
        hint="Device muncul di sini sesudah sebuah instance hanoman menerbitkan device token dan menyinkron ke hub ini." />
    );
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {view.devices.map((d) => (
        <DeviceCard key={d.deviceId} d={d} specTitles={specTitles} onOpenSpec={onOpenSpec} now={now} />
      ))}
    </div>
  );
}
```

`src/src/api/client.ts` — tambahkan tipe ke daftar import `@hanoman/shared` (`type PresenceView`) dan entri di objek `api`, di dekat `listCleanups`:

```ts
  presence: () => j<PresenceView>(paths.presence),
```

`src/src/ds/shell.tsx` — tambahkan gerbang nav:

```ts
export type NavItem = { key: string; label: string; icon: string; gate?: string };
```

Tambahkan entri baru di `HN_NAV`, tepat sesudah `vps`:

```ts
  // SPEC-919 · ADR-0147 · device yang sinkron ke hub ini + sesi hidupnya. Digerbangi supaya
  // instalasi satu mesin (nol device token) tak berubah tampilannya sama sekali.
  { key: "clients", label: "Klien", icon: "monitor", gate: "clients" },
```

Tambahkan context dan pemakaiannya (letakkan tepat di atas `export function Shell`):

```tsx
/* SPEC-919 · gerbang nav berbasis kemampuan instance. Context, bukan prop: `Shell` dirender di
   belasan cabang `App`, dan menambah prop ke semuanya adalah undangan bagi cabang yang terlewat.
   Default kosong = entri bergerbang TERSEMBUNYI — layar yang tak menyediakan gerbangnya tak
   pernah menampilkan halaman yang tak bisa ia isi. */
export const NavGate = React.createContext<Record<string, boolean>>({});
```

dan di dalam `Shell`, sebelum `return (`:

```tsx
  const gates = React.useContext(NavGate);
```

lalu ganti `{HN_NAV.map((n) => (` menjadi:

```tsx
          {HN_NAV.filter((n) => !n.gate || gates[n.gate]).map((n) => (
```

`src/src/App.tsx` — tambahkan import, state, langganan, dan cabang section:

```tsx
import { ClientsScreen } from "./screens/ClientsScreen";
import { presenceIndex } from "./screens/presence-map";
import { NavGate } from "./ds/shell";
import type { PresenceView } from "@hanoman/shared";
```

```tsx
  // SPEC-919 · ADR-0147 · sesi hidup lintas device. Didorong lewat grup siar `presence`;
  // `api.presence()` hanya muat awal (dan satu-satunya jalur saat WS terhalang proxy).
  const [presence, setPresence] = React.useState<PresenceView>({ enabled: false, devices: [] });
```

Di dalam `React.useEffect(() => subscribe((m) => { … }))`, tambahkan cabang:

```tsx
    else if (m.t === "presence") setPresence({ enabled: m.enabled, devices: m.devices });
```

Di fungsi `load()` yang memuat projects, tambahkan (best-effort, tak boleh menjatuhkan boot):

```tsx
      api.presence().then(setPresence).catch(() => { /* server lama / WS yang mengisi */ });
```

Turunan indeks + judul spec:

```tsx
  const presenceMap = React.useMemo(() => presenceIndex(presence), [presence]);
  const specTitles = React.useMemo(
    () => Object.fromEntries(backlog.map((s) => [s.id, s.title])), [backlog]);
```

Cabang section baru, tepat sesudah cabang `section === "vps"`:

```tsx
  } else if (section === "clients") {
    // SPEC-919 · ADR-0147 · halaman Klien: device + sesi hidupnya. Datanya didorong `presence`.
    screen = (
      <Shell active="clients" title="Klien" breadcrumb="device · sesi yang sedang berjalan"
        onNavigate={setSection}>
        <ClientsScreen view={presence} specTitles={specTitles} onOpenSpec={openReviewSpecId} />
      </Shell>
    );
```

Bungkus `{screen}` dengan providernya:

```tsx
        <NavGate.Provider value={{ clients: presence.enabled }}>{screen}</NavGate.Provider>
```

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
pnpm vitest --run --no-file-parallelism src/test/presence-map.test.ts \
  src/test/clients-screen.test.tsx src/test/changelog-nav.test.tsx
```
Expected: PASS — 9 test baru + kontrak nav (`setiap key HN_NAV punya cabang section di App.tsx`) tetap hijau.

- [ ] **Step 5: Typecheck frontend**

```bash
pnpm --filter ./src typecheck
```
Expected: keluar 0.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/presence-map.ts src/src/screens/ClientsScreen.tsx src/src/api/client.ts \
  src/src/ds/shell.tsx src/src/App.tsx src/test/presence-map.test.ts src/test/clients-screen.test.tsx
git commit -m "feat(spec-919): halaman Klien + gerbang navigasi"
```

---

### Task 10: Penanda device di Backlog & Projects

**Files:**
- Create: `src/src/screens/PresenceChip.tsx`
- Modify: `src/src/screens/BacklogScreen.tsx:649-677` (`SpecRow`), `:715-758` (`BoardCard`), `:761-820` (`Board`), `:833` (props), `:1029-1052` (call site); `src/src/screens/ProjectsScreen.tsx:83`; `src/src/App.tsx` (meneruskan peta)
- Test: `src/test/presence-chip.test.tsx` (baru)

**Interfaces:**
- Consumes: `presenceIndex` (Task 9)
- Produces: `<PresenceChip names={string[] | undefined} />`; prop `presenceBySpec?: Map<string, string[]>` di `BacklogScreen`; field `presenceOn?: string[]` di `ProjectVM`-row

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/presence-chip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceChip } from "../src/screens/PresenceChip";

describe("PresenceChip", () => {
  it("menyebut nama device", () => {
    render(<PresenceChip names={["mac-dena"]} />);
    expect(screen.getByTestId("presence-chip").textContent).toContain("mac-dena");
    expect(screen.getByTestId("presence-chip").textContent).toContain("dikerjakan di");
  });

  it("menggabungkan beberapa device", () => {
    render(<PresenceChip names={["mac-dena", "laptop"]} />);
    expect(screen.getByTestId("presence-chip").textContent).toContain("mac-dena, laptop");
  });

  // Gerbang requirement 7 di ujung terakhirnya: tanpa nama, tak ada apa pun yang dirender.
  it("tak merender apa-apa tanpa nama", () => {
    const { container } = render(<PresenceChip names={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("tak merender apa-apa untuk daftar kosong", () => {
    const { container } = render(<PresenceChip names={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
pnpm vitest --run --no-file-parallelism src/test/presence-chip.test.tsx
```
Expected: FAIL — modul `PresenceChip` belum ada.

- [ ] **Step 3: Implementasi minimal**

Buat `src/src/screens/PresenceChip.tsx`:

```tsx
import React from "react";
import { Badge } from "../ds";

/* SPEC-919 · ADR-0147 · penanda "sedang dikerjakan di <device>". Satu komponen untuk baris
   backlog, kartu board, dan baris project: tiga salinan berarti tiga tempat yang bisa berbeda
   menjawab pertanyaan yang sama.

   Daftar nama kosong/undefined merender NOL elemen — itulah ujung terakhir gerbang requirement 7:
   instance yang `presence.enabled`-nya mati menghasilkan peta kosong, jadi tak ada satu pun chip. */
export function PresenceChip({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <Badge data-testid="presence-chip" size="sm" tone="ok" icon="monitor"
      title="Ada sesi agen yang hidup untuk item ini">
      dikerjakan di {names.join(", ")}
    </Badge>
  );
}
```

`src/src/screens/BacklogScreen.tsx`:

1. Import di kepala berkas:

```ts
import { PresenceChip } from "./PresenceChip";
```

2. `SpecRow` — tambahkan prop dan render chip tepat sebelum `<div style={{ flex: "0 0 auto" }}><StageBar …`:

```tsx
function SpecRow({ spec, onStart, onDelete, onOpenRun, onOpenReview, onOpenDetail, onMarkDone, running, presenceOn }:
  {
    spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void;
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    running?: boolean; presenceOn?: string[]
  }) {
```

```tsx
      <PresenceChip names={presenceOn} />
```

3. `BoardCard` — tambahkan prop `presenceOn?: string[]` ke daftar destructuring dan tipenya, lalu render tepat sesudah blok `BlockedBadge`:

```tsx
      {presenceOn?.length ? (
        <div style={{ marginTop: 6 }}><PresenceChip names={presenceOn} /></div>
      ) : null}
```

4. `Board` — terima dan teruskan:

```tsx
function Board({ specs, activeSpecs, presenceBySpec, onStart, onOpenRun, onOpenReview, onOpenDetail, onMarkDone }:
  {
    specs: Spec[]; activeSpecs?: Set<string>; presenceBySpec?: Map<string, string[]>;
```

```tsx
                  onMarkDone={onMarkDone} running={activeSpecs?.has(s.id)}
                  presenceOn={presenceBySpec?.get(s.id)}
```

5. `BacklogScreen` — tambahkan `presenceBySpec` ke destructuring props dan tipenya:

```tsx
export function BacklogScreen({ backlog, projects, pageSize = 20, onStart, activeSpecs, presenceBySpec, onDelete, /* … sisanya tetap … */ }:
```

```tsx
    onStart?: (s: Spec) => void; activeSpecs?: Set<string>; presenceBySpec?: Map<string, string[]>;
```

lalu teruskan di ketiga call site (`<Board … presenceBySpec={presenceBySpec}`, dan kedua `<SpecRow … presenceOn={presenceBySpec?.get(s.id)}`).

`src/src/screens/ProjectsScreen.tsx` — tambahkan import dan render chip di sel Status:

```ts
import { PresenceChip } from "./PresenceChip";
```

```tsx
      <div data-label="Status" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
        <StatusPill status={p.session.status} size="sm">{running && p.session.phase ? p.session.phase : undefined}</StatusPill>
        {/* SPEC-919 · ADR-0147 · penanda LIVE, beda dari "Ditangani" (ADR-0135) yang penetapan manual. */}
        <PresenceChip names={presenceOn} />
      </div>
```

Tambahkan `presenceOn?: string[]` ke props baris project dan teruskan dari `ProjectsScreen`-nya lewat prop baru `presenceByProject?: Map<string, string[]>` (`presenceOn={presenceByProject?.get(p.id)}`).

`src/src/App.tsx` — teruskan kedua peta:

```tsx
          presenceBySpec={presenceMap.bySpec}
```
pada `<BacklogScreen …>`, dan

```tsx
          presenceByProject={presenceMap.byProject}
```
pada `<ProjectsScreen …>`.

- [ ] **Step 4: Jalankan test untuk memastikan ia lulus**

```bash
pnpm vitest --run --no-file-parallelism src/test/presence-chip.test.tsx \
  src/test/presence-map.test.ts src/test/clients-screen.test.tsx
```
Expected: PASS — 4 test baru + yang sebelumnya tetap hijau.

- [ ] **Step 5: Typecheck frontend**

```bash
pnpm --filter ./src typecheck
```
Expected: keluar 0.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/PresenceChip.tsx src/src/screens/BacklogScreen.tsx \
  src/src/screens/ProjectsScreen.tsx src/src/App.tsx src/test/presence-chip.test.tsx
git commit -m "feat(spec-919): penanda device di baris backlog dan project"
```

---

### Task 11: ADR + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0147-kanal-presence-di-socket-sync.md`, `internal/docs/adr/0148-status-hidup-tidak-disync.md`
- Modify: `internal/docs/README.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/architecture/data-model.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1–10
- Produces: — (dokumentasi)

- [ ] **Step 1: Tulis ADR-0147 (transport)**

Buat `internal/docs/adr/0147-kanal-presence-di-socket-sync.md` dengan struktur yang sama seperti ADR tetangganya (`0145`): judul, Status/Tanggal/SPEC, "Menegakkan"/"Mengamandemen", Konteks, Keputusan, Alternatif yang ditolak, Pagar, Konsekuensi, Plafon yang diketahui.

Isi yang wajib ada, diambil dari rancangan `docs/superpowers/specs/2026-08-24-spec-919-presence-sesi-lintas-device-design.md` §A/§C/§D/§E/§F:

- **Mengamandemen ADR-0046** (kanal `/api/sync/ws` tak lagi satu arah) · **menegakkan** ADR-0043, 0044, 0117 (Bearer, query ditolak), 0024 (nol queue/worker), 0039/0145 (grup global vs topik berparameter).
- Keputusan: frame masuk **tunggal** `{t:"presence",v:1,sessions:[…]}` di socket sync yang sudah ada; `deviceId` selalu dari token terverifikasi.
- Alasan yang menentukan: hub versi lama **tak memasang** `socket.on("message")`, jadi kompatibilitas mundur terpenuhi *by construction*.
- Alternatif ditolak: `POST /api/sync/presence` berkala (polling, dilarang requirement 6); kanal `/api/sync/presence/ws` terpisah (ADR-0046 memisah karena otorisasi BERBEDA; di sini otorisasinya identik).
- Pagar: frame rusak/kebesaran/terlalu sering **dibuang, socket tetap hidup** — berbeda sadar dari `/events/ws` yang menutup 1009/1008; `MAX_PRESENCE_SESSIONS` 100 supaya frame tak pernah menabrak `maxPayload` 64 KiB yang akan ditutup `ws` sebelum handler kita berjalan.
- Backoff 1→30 s + jitter menggantikan `setTimeout(…, 3000)` datar, sekaligus menambal timer reconnect yang tak pernah dibatalkan `stopSyncClient()`.
- Muatan ringkas: `cwd` **dibuang** — itulah bagian yang membuat `SessionHistory` local-only (schema.prisma:389). Judul/nama tak dikirim (kebalikan sadar dari ADR-0135 — di sana penerimanya client tanpa katalog device, di sini hub yang justru pemiliknya).
- Grup siar ke-9 (bukan topik ADR-0145: muatannya tak berparameter). `GET /api/presence` muat-awal + fallback, COOKIE_ONLY.
- Gerbang `enabled` = ada ≥1 `DeviceToken` belum dicabut → instalasi satu mesin nol perubahan tampilan.
- Plafon: arah data **satu arah** klien→hub; client tak bisa menampilkan sesi hub. Menempel terminal klien dari hub di luar lingkup.

- [ ] **Step 2: Tulis ADR-0148 (status hidup tidak disync)**

Buat `internal/docs/adr/0148-status-hidup-tidak-disync.md`. Isi wajib, dari §B rancangan:

- Keputusan: presence **tak menyentuh Prisma sama sekali** — bukan tabel yang kebetulan di luar `FIELDS`, tapi baris yang tak pernah lahir. Karena itu ia tak bisa masuk `SyncLog` walau kelak seseorang menambah entitas ke `SYNCED` tanpa membaca ADR ini.
- Ukuran yang membuatnya bukan selera: ADR-0131 mengukur `pollHealth()` → 121.222 baris / 213,6 MB = **83 % isi DB hub**, hub tercekik `P1008`; presence berdenyut tiap **30 detik per device**, dua orde lebih sering.
- Alternatif ditolak: model `DevicePresence` LOCAL-only (pola `LocalBinding`/`SyncState`) — bertahan restart adalah nilai yang tak ada, karena restart memutus socket sehingga barisnya basi sampai reconnect toh.
- "Terakhir terlihat" **tak butuh kolom baru**: `DeviceToken.lastSeenAt` sudah ditulis jalur sync ter-auth yang ada. Kanal presence sendiri **tidak** menulisnya per denyut.
- Konsekuensi: restart hub = registry kosong, terisi lagi ≤ 30 s. Keadaan basi punah dengan sendirinya.
- Batas: presence **murni informasional** — tak menggerbangi start sesi, worktree, auto-merge, scheduler, atau lead (cermin batas ADR-0135 §6).

- [ ] **Step 3: Tautkan di index**

`internal/docs/README.md` — tambahkan dua baris di daftar ADR, tepat di atas baris `0146`, mengikuti format satu-baris berisi ringkasan yang dipakai tetangganya, lalu tambahkan satu baris rancangan di daftar spec (paling atas) yang menunjuk `../../docs/superpowers/specs/2026-08-24-spec-919-presence-sesi-lintas-device-design.md`.

- [ ] **Step 4: Perbarui doc arsitektur**

`internal/docs/architecture/api-contract.md` — di blok "Sync mesin-ke-mesin", tambahkan paragraf `>` baru: frame masuk `{t:"presence"}` di `GET /api/sync/ws`, semantik ganti-penuh, `deviceId` dari token, kegagalan dibuang tanpa menutup socket, hub lama mengabaikannya. Tambahkan juga `GET /api/presence` (cookie-only, non-delegatable) dan grup siar `presence` di seksi realtime di kepala berkas (yang menyebut delapan grup → sembilan).

`internal/docs/architecture/data-model.md` — di kepala berkas, pada kalimat yang mendaftar model pendukung, tambahkan catatan: presence SPEC-919 **tak punya model** dan alasannya (ADR-0148), sekamar dengan penjelasan `SessionHistory` LOCAL-only. Tambahkan juga catatan `Pane.startedAt` bukan kolom DB.

`internal/docs/frontend/frontend-implementation.md` — daftarkan layar `ClientsScreen` + `PresenceChip` + gerbang `NavItem.gate`/`NavGate`.

`internal/skills/hanoman/SKILL.md` — tambahkan satu butir di daftar "Aturan Arsitektur", setelah butir ADR-0145, meringkas SPEC-919/ADR-0147/0148 dalam bentuk yang sama dengan butir tetangganya (keputusan + gotcha terukur).

- [ ] **Step 5: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/index.js docs index --check
```
Expected: laporan index tanpa entri hilang. Bila CLI belum ter-build di worktree ini, cukup pastikan setiap berkas baru muncul persis sekali di `internal/docs/README.md`:

```bash
grep -c "0147-kanal-presence-di-socket-sync\|0148-status-hidup-tidak-disync" internal/docs/README.md
```
Expected: `2`.

- [ ] **Step 6: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-919): ADR-0147/0148 + api-contract, data-model, frontend, skill"
```

---

### Task 12: Verifikasi menyeluruh & smoke endpoint

**Files:** —

**Interfaces:**
- Consumes: seluruh task sebelumnya
- Produces: bukti hijau

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism \
  shared/src/presence.test.ts \
  server/test/pty-parse.test.ts server/test/presence-snapshot.test.ts \
  server/test/presence-registry.test.ts server/test/presence-view.test.ts \
  server/test/presence.route.test.ts server/test/sync-ws-presence.test.ts \
  server/test/sync-ws.test.ts server/test/sync-client.test.ts server/test/sync-backoff.test.ts \
  server/test/presence-sender.test.ts server/test/agent-capabilities.test.ts \
  server/test/events-ws.test.ts \
  src/test/presence-map.test.ts src/test/clients-screen.test.tsx \
  src/test/presence-chip.test.tsx src/test/changelog-nav.test.tsx
```
Expected: semua PASS. Nol "no test files" — bila ada, path-nya salah dan itu bukan bukti hijau.

- [ ] **Step 2: Typecheck ketiga paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```
Expected: keluar 0.

- [ ] **Step 3: Smoke endpoint nyata**

```bash
export HANOMAN_HOME="$(mktemp -d)"
export DATABASE_URL="file:$HANOMAN_HOME/hanoman.db"
pnpm --filter ./server exec prisma migrate deploy
pnpm dev:api &
sleep 6
curl -s localhost:8787/api/health
curl -s localhost:8787/api/presence
```
Expected: `/api/health` menjawab; `/api/presence` menjawab JSON ber-`{"enabled":false,"devices":[{"deviceId":"local",…}]}` dengan `sessions` berisi sesi tmux mesin ini (boleh kosong). `HANOMAN_HOME` sementara wajib — smoke tanpa itu menulis `setup.token` ke home nyata (pelajaran SPEC-880).

- [ ] **Step 4: Matikan server smoke per-PID**

```bash
lsof -ti:8787 | xargs -r kill
```
Jangan `pkill -f` — pola itu mematikan agen sesi tetangga (SPEC-402).

- [ ] **Step 5: Centang seluruh checkbox plan dan commit**

```bash
git add -A && git commit -m "chore(spec-919): verifikasi hijau"
```

---

## Self-review

**Cakupan requirement backlog → task**

| Requirement | Task |
|---|---|
| 1 · kanal WS persisten klien→hub, device token, snapshot saat konek/berubah/denyut, backoff, offline lewat ambang | 7, 8 (kirim), 4 (ambang), 5 (offline di view) |
| 2 · muatan ringkas, tanpa isi terminal | 1 (`.strict()`), 3 (proyeksi tanpa `cwd`) |
| 3 · keadaan hidup tak masuk changefeed, punah sendiri | 4 (memori), 11 (ADR-0148) |
| 4 · halaman Klien: device, online/offline, terakhir terlihat, sesi, SPEC bisa diklik | 5 (view), 9 (layar) |
| 5 · penanda device di baris backlog & kartu project, termasuk sesi hub sendiri | 5 (`recordPresence` lokal), 9 (`presenceIndex`), 10 (chip) |
| 6 · digerakkan `/api/events/ws`, tanpa polling HTTP baru | 6 (grup ke-9) |
| 7 · instance tanpa sync tak berubah | 5 (`enabled`), 8 (sender hanya hidup di `startSyncClient`), 9 (gerbang nav), 10 (chip nol elemen) |
| ADR transport + ADR tak-disync | 11 |
| Test auth & lifecycle, reconnect/backoff, deteksi offline, pemetaan snapshot → tampilan | 7, 8, 4, 9/10 |

**Konsistensi tipe** — `recordPresence(deviceId, sessions, now?)` dipakai identik di Task 5, 6, 7. `presenceView(o?)` dipakai identik di Task 6 route + grup siar. `PresenceSessionView` (dengan `statusAt`) hanya lahir di registry dan dikonsumsi view + frontend. `PresenceChip` menerima `names?: string[]` di ketiga call site.

**Tanpa placeholder** — setiap step berisi kode atau perintah nyata; tak ada "TBD"/"handle errors".
