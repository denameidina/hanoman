# SPEC-1215 · Turunan A — Fondasi kanal relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pakai superpowers:test-driven-development per task dan superpowers:verification-before-completion di akhir.

**Goal:** Klien hanoman yang grant lokalnya dinyalakan cookie manusia membuka socket relay kedua ke hub, hub bisa mengirim request ke route klien yang sudah ada dan menerima jawabannya lewat principal `remote` yang tak bisa dipalsukan dari jaringan, setiap aksi jarak jauh tercatat di `LogEntry` lokal, kapasitas klien terlihat di presence hub, dan pencabutan device token memutus kedua socket seketika.

**Architecture:** Turunan A dari [spec SPEC-1215](../specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md) (§S2–S4, §S8–S10) dan [ADR-0165](../../../internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md)/[ADR-0166](../../../internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md). Kontrak murni hidup di `@hanoman/shared` (`relay.ts`, `logs.ts`, tambahan `presence.ts`). Di server: gate `/api` mendapat cabang `remote` (rahasia proses ∧ bukan `net.Socket` ∧ grant ∧ allowlist ∧ capability), dispatcher klien menjalankan frame `req` lewat `app.inject`, hub memegang registry socket relay per device + `requestRelay()`, dan registry socket per device dipakai `DELETE /device-tokens/:id`. Tidak ada route HTTP relay di hub (itu SPEC-1216) dan tidak ada stream WS (itu SPEC-1218).

**Tech Stack:** TypeScript strict, Fastify 5 + `@fastify/websocket` 11, `ws` 8, zod 3, Prisma 6 (SQLite), Vitest 2, React 18 + Testing Library.

---

## Skop eksekusi — DIPUTUSKAN

**Dieksekusi sekarang, di sesi SPEC-1215 ini:** turunan **A · Fondasi kanal** penuh = Task 1–16 di bawah, mencakup AC-A1…AC-A12 dan AC-M1…AC-M2 (spec §S9). Setiap task meninggalkan pohon hijau, jadi berhenti di tengah aman, tapi target sesi ini adalah seluruh A.

**Ditunda sebagai backlog turunan — sudah difilekan di DB oleh fase Plan (2026-09-15):**

| Backlog | Turunan | AC yang dicakup | `dependsOn` | Isi ringkas |
|---|---|---|---|---|
| **SPEC-1216** | B · Orkestrasi | AC-B1…AC-B11 | SPEC-1215 | route COOKIE_ONLY `/api/devices/:deviceId/relay/*` di atas `requestRelay()`; gerbang `remote-session`/`confirm-required` (start & done); `launchPrincipal` remote + `force` 403; spec-404 → `syncOnce`; audit `relay.request` di hub; `createApi` + `InstanceContext`; target Start + aksi sesi remote |
| **SPEC-1218** | C · Tampilan identik | AC-C1…AC-C10 | SPEC-1215, SPEC-1216 | stream `open/data/credit/close` lewat `injectWS({onOpen})`; tiket `relay:*`; `WsPrincipal` `remote`; kredit/resync 4009/plafon; grup events terbatas; `TerminalPane`/`SpecDocsModal`/IDE di `InstanceContext`; pengukuran Mac mini 8 GB |
| **SPEC-1217** | D · Log terpusat | AC-D1…AC-D10 | SPEC-1215 | shipper + `POST /api/sync/logs` + ingest high-water mark; redaksi dua lapis; spool console; lajur transcript; tap `session.phase`/`session.result`/`launch.rejected`/`log.gap`; `GET /api/logs` + retensi + `LogsPanel`; ukur p95 `GET /specs` |

Alasan memfilekan sekarang, bukan menunggu: bila SPEC-1215 ditandai selesai sesudah A, B–D tak boleh hanya hidup di dokumen. Risiko "dua sesi mengerjakan kontrak yang sama" ditutup gerbang dependency ADR-0093 — terverifikasi `hanoman_backlog_get SPEC-1216` → `blockedBy: [{ id: "SPEC-1215", reason: "unfinished" }]`, dan gerbang itu juga dibaca governor scheduler dan denyut lead (`server/src/services/spec-deps.ts:6-9`). Payload tiap backlog menunjuk spec ini sebagai design-of-record dan melarang membuka ulang keputusan tanpa amandemen ADR.

## Keputusan & koreksi fase Plan atas Spec (dicatat juga di spec §S13)

- **P1 · `PG_ORDER` MEMUAT `LogEntry`/`LogCursor`.** Spec §S4.10 menyebut "dikecualikan". Salah terhadap kode: `cli/test/migrate-pg.test.ts:23` menuntut `PG_ORDER` = seluruh model DMMF. Tabel LOCAL-only yang absen di Postgres lama sudah punya jalurnya (42P01 = nol baris, preseden `AgentInvocation`/`Changelog`, `cli/src/commands/migrate-pg.ts:19-24`). Tetap dikecualikan dari `SYNCED`/`FIELDS`/`WEBHOOK_ENTITIES`.
- **P2 · Tap event A = `session.start`, `session.end`, `remote.request`, `remote.link`, `grant.changed`.** `session.phase`, `session.result`, `launch.rejected`, `log.gap` pindah ke SPEC-1217: pembacanya (pengiriman & pencarian) baru lahir di D, dan tap fase butuh berbagi snapshot sesi yang juga disentuh D.
- **P3 · Pemeriksaan body `POST /terminal/sessions` (hanya varian `spec`) tak bisa di `onRequest`** — body belum di-parse di hook itu. Allowlist path di `onRequest`, `relayBodyAllowed` di `preHandler`, dan dispatcher memeriksa keduanya **sebelum** `inject` (AC-A7: handler tak pernah jalan).
- **P4 · Hook gate `remote` dipasang terlepas dari `requireAuth`.** Jadi header relay dari jaringan tetap 401 bahkan di app test ber-`requireAuth:false`; gate cookie melewati request yang `req.remote`-nya sudah terisi.
- **P5 · `PresenceDeviceView.control`/`capacity` opsional di tipe** (additive; literal lama tetap valid). `presenceView()` selalu mengisinya (`null` bila tak ada).
- **P6 · `GET /api/remote-control` di A tanpa `shipping`, dan `RemoteControlPanel` di A tanpa toggle lajur log.** A tak punya shipper; menampilkan angka/saklar pengiriman yang belum bekerja melanggar kejujuran tampilan (K7). API `PUT` tetap menerima `logs` supaya D tak mengubah kontrak.
- **P7 · Retensi baris `LogEntry` lokal belum ada di A.** Volume A = lahir/tutup sesi + aksi manusia dari hub; sapuan `pruneLogs` milik SPEC-1217.
- **P8 · `requestRelay()` hub diekspor untuk SPEC-1216 tanpa route HTTP.** A membuktikannya lewat test ujung-ke-ujung in-process dan tidak mencatat `relay.request` (itu B).
- **P9 · Helper backoff pindah ke `server/src/services/backoff.ts`** (di-re-export `sync-client.ts`) agar `relay/client.ts` tak membentuk impor siklik dengan `sync-client.ts`.
- **P10 · Klien A menjawab frame `open` dengan `close 4502`** alih-alih diam, supaya hub versi C tak menunggu 10 dtk pada klien versi A.
- **P11 · `registerSessionHooks` kini mengembalikan fungsi pencabut.** `server/test/pty.test.ts:904` yang "mereset" dengan `registerSessionHooks({})` wajib diganti, kalau tidak hook test bocor antar-test.

## Global Constraints

- TypeScript strict; ikuti idiom sekitar; komentar hanya untuk WHY (alasan, invarian, jebakan), bahasa Indonesia seperti kode sekitarnya.
- Tanpa Redis/queue/worker/Docker (ADR-0024/0086). Keadaan hidup di memori; data tahan-lama di SQLite per instance.
- Skema berubah = migration `20260915120000_log_terpusat` + ADR-0166 (sudah ada). Grant di `Setting.data` = **tanpa migration**.
- `REMOTE_CAPABILITIES = ["sessions:read","sessions:write","sessions:spawn","backlog:read","backlog:write","ide:read"]`.
- Konstanta S4.1 persis: `RELAY_PROTOCOL = 1`, `RELAY_PART_MAX_BYTES = 32 KiB`, `RELAY_MAX_STREAMS = 6`, `RELAY_MAX_INFLIGHT = 4`, `RELAY_RESPONSE_MAX_BYTES = RELAY_REASSEMBLY_MAX_BYTES = 1 MiB`, `RELAY_REQUEST_BODY_MAX_BYTES = 32 KiB`, `RELAY_CREDIT_INITIAL = 256 KiB`, `RELAY_CREDIT_REFILL_BELOW = 64 KiB`, `RELAY_SOCKET_MAX_BUFFERED = 1 MiB`, `RELAY_RESYNC_MIN_MS = 5000`, `RELAY_REQ_TIMEOUT_MS = 30000`, `RELAY_SPAWN_TIMEOUT_MS = 120000`, `RELAY_OPEN_TIMEOUT_MS = 10000`, `RELAY_MAX_FRAMES_PER_MIN = 12000`, `RELAY_IDLE_STREAM_CLOSE_MS = 2000`, `RELAY_UNSUPPORTED_RETRY_MS = 30 × 60000`, `LOG_MSG_MAX_BYTES = 4 KiB`, `LOG_DATA_MAX_BYTES = 8 KiB`, `LOG_RETENTION_DEFAULTS = {eventDays:90, serverDays:7, transcriptDays:30, maxBytes:268435456}`.
- Kode tutup socket relay: `1008` token dicabut/laju · `1009` frame > 64 KiB · `4000` digantikan · `4001` protokol tak cocok · `4003` grant berubah (klien) · `1001` shutdown.
- Kegagalan relay **tak pernah** menutup `/api/sync/ws`. Klien tanpa `SYNC_SERVER_URL` atau tanpa grant = nol upgrade relay, nol perubahan perilaku.
- Route `GET|PUT /api/remote-control` COOKIE_ONLY. `PUT /api/settings` **mempertahankan** `remoteControl`, `logShipping`, `logRetention` tersimpan.
- Principal `remote` hanya sah bila header `x-hanoman-relay` = rahasia proses (timing-safe) **dan** `req.raw.socket` bukan `net.Socket`.
- JANGAN `git stash` (stack stash dipakai bersama worktree lain) dan JANGAN `pkill -f` (SPEC-402). JANGAN `git push`.
- Resep test di mesin bersesi banyak (wajib, CLAUDE.md/AGENTS.md):
  `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path…>`
  Bila gagal ramai dengan 404/P2022 → hampir pasti isolasi DB/env, bukan regresi.
- Docs SoT yang tersentuh diperbarui di branch yang sama (Task 15) dan ter-link di `internal/docs/README.md`.
- Setiap task selesai: centang step-nya di berkas plan ini (`- [ ]` → `- [x]`) dan jalankan HANYA test yang tersentuh task itu (CLAUDE.md, SPEC-376/ADR-0080) — bukan suite penuh, bukan `pnpm -r typecheck`.
- Setiap perintah Bash berjalan di shell baru: tulis `HANOMAN_BASE_SHA` inline (`${HANOMAN_BASE_SHA:-67478d09c611ed926620eaa8c69c4213d5486ef0}`), jangan mengandalkan `export` dari step sebelumnya.

## Peta berkas

| Berkas | Tanggung jawab | Task |
|---|---|---|
| `shared/src/relay.ts` (baru) | konstanta relay, frame zod `.strict()`, `RelayActor`, `REMOTE_CAPABILITIES`, `zRemoteControl`, `validateRemoteGrant`, `relayRouteAllowed`, `relayBodyAllowed`, `remoteCapabilityFor`, `utf8Bytes`, `splitUtf8`, tipe `RelayLinkStatus`/`RemoteControlView` | 1 |
| `shared/src/logs.ts` (baru) | `LOG_LANES`, `LOG_LEVELS`, `nextSeq`, `LogEntryView`, `zLogShipping`, `zLogRetention` | 2 |
| `shared/src/presence.ts` | `zCapacityFrame`, `capacityFrameJson`, `capacitySignature`, `PresenceControlView`, field opsional `control`/`capacity` | 2 |
| `shared/src/entities.ts` · `server/src/services/settings.ts` · `server/src/routes/settings.ts` · `src/src/screens/SettingsScreen.tsx` | kunci `Setting` baru + `PUT /settings` mempertahankan | 3 |
| `server/prisma/schema.prisma` · `server/prisma/migrations/20260915120000_log_terpusat/migration.sql` · `cli/src/commands/migrate-pg.ts` | `LogEntry`, `LogCursor` | 4 |
| `server/src/services/pty.ts` · `server/test/pty.test.ts` | hook sesi aditif | 5 |
| `server/src/services/logs/event-log.ts` (baru) · `server/src/server.ts` | `appendEvent` (seq HLC, serial), `recentAudit`, `installEventTap` | 6 |
| `server/src/services/device-sockets.ts` (baru) · `server/src/routes/device-tokens.ts` · `server/src/routes/sync.ts` | registry socket per device, pencabutan seketika | 7 |
| `server/src/services/relay/secret.ts` · `server/src/services/relay/gate.ts` (baru) · `server/src/app.ts` | principal `remote` | 8 |
| `server/src/services/relay/dispatcher.ts` (baru) | frame `req` → `app.inject` → `res` terpotong + audit | 9 |
| `server/src/services/relay/hub.ts` (baru) · `server/src/routes/sync.ts` | `/api/sync/relay/ws`, `hello`/`welcome`, `requestRelay`, `relayControlFor` | 10 |
| `server/src/services/backoff.ts` · `server/src/services/relay/client.ts` (baru) · `server/src/services/sync-client.ts` · `server/src/server.ts` | tautan relay klien: grant → connect → hello → backoff/unsupported | 11 |
| `server/src/services/remote-control.ts` · `server/src/routes/remote-control.ts` (baru) · `server/src/app.ts` · `server/src/services/agent-capabilities.ts` · `docs/agent-integration.md` | `GET|PUT /api/remote-control` | 12 |
| `server/src/services/presence/{snapshot,sender,registry,view}.ts` · `server/src/routes/sync.ts` | frame `capacity` + `control`/`capacity` di presence | 13 |
| `shared/src/api.ts` · `src/src/api/client.ts` · `src/src/screens/RemoteControlPanel.tsx` (baru) · `src/src/screens/SettingsScreen.tsx` | panel Settings "Kendali jarak jauh" | 14 |
| `internal/docs/**`, `internal/skills/hanoman/SKILL.md`, spec | cabut penanda DIRANCANG bagian A | 15 |
| — | verifikasi + smoke API nyata dua instance | 16 |

---

### Task 0: Siapkan worktree (tanpa commit)

- [x] **Step 1: Install & generate**

Run: `cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-1215 && pnpm install`
Expected: selesai tanpa error; `postinstall` server men-generate Prisma Client. Bila kelak muncul `Property 'dmmf' does not exist`, jalankan `pnpm db:generate`.

- [x] **Step 2: Kunci base SHA untuk `--changed`**

Run: `export HANOMAN_BASE_SHA=${HANOMAN_BASE_SHA:-67478d09c611ed926620eaa8c69c4213d5486ef0} && git log --oneline -1`
Expected: HEAD memuat commit docs SPEC-1215 fase Plan.

- [x] **Step 3: Baseline suite yang akan disentuh**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-ws-presence.test.ts server/test/sync-client-presence-wiring.test.ts server/test/device-tokens.route.test.ts server/test/agent-gate.test.ts server/test/settings.test.ts server/test/presence-view.test.ts server/test/presence-sender.test.ts cli/test/migrate-pg.test.ts`
Expected: PASS. Catat test yang sudah merah di base (jangan diperbaiki diam-diam; sebut di laporan).

### Task 1: Kontrak relay murni di `@hanoman/shared`

**Files:**
- Create: `shared/src/relay.ts`
- Create: `shared/src/relay.test.ts`
- Modify: `shared/src/index.ts` (tambah export)

**Interfaces:**
- Consumes: `type Capability` dari `shared/src/agent.ts:39`.
- Produces (dipakai Task 3, 8–14 dan SPEC-1216/1218):
  - konstanta S4.1 (`RELAY_*`), `RELAY_HEADER = "x-hanoman-relay"`, `RELAY_ACTOR_HEADER = "x-hanoman-relay-actor"`, `RELAY_MODE_HEADER = "x-hanoman-relay-mode"`
  - `REMOTE_CAPABILITIES`, `zRemoteCapability`, `type RemoteCapability`, `zRemoteControl`, `type RemoteControl`, `REMOTE_CONTROL_DEFAULTS`
  - `validateRemoteGrant(caps: readonly string[]): string | null`
  - `utf8Bytes(s: string): number`, `splitUtf8(text: string, maxBytes?: number): string[]`
  - `zRelayActor`, `type RelayActor = { hubOrigin: string; userId: string; email: string }`
  - `zHubToClientFrame`, `type HubToClientFrame`, `type RelayReqFrame`, `zClientToHubFrame`, `type ClientToHubFrame`, `type RelayMethod`
  - `relayRouteAllowed(method: string, url: string): boolean` (url = path `/api/...` + query opsional)
  - `relayBodyAllowed(method: string, path: string, body: unknown): boolean`
  - `remoteCapabilityFor(method: string, path: string, mode: "read" | "write"): Capability | null`
  - `zRemoteControlPut`, `type RemoteControlPut`, `type RelayLinkState`, `type RelayLinkStatus`, `type RemoteControlView` (butuh `LogEntryView` dari Task 2 — tipe ini ditambahkan di Task 2 Step 5)

- [x] **Step 1: Tulis test yang gagal**

Create `shared/src/relay.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  RELAY_PART_MAX_BYTES, REMOTE_CAPABILITIES, relayBodyAllowed, relayRouteAllowed, remoteCapabilityFor,
  splitUtf8, utf8Bytes, validateRemoteGrant, zClientToHubFrame, zHubToClientFrame,
} from "./relay";

const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };

describe("relayRouteAllowed (SPEC-1215 · ADR-0165 §5)", () => {
  const allowed: [string, string][] = [
    ["GET", "/api/terminal/sessions"],
    ["POST", "/api/terminal/sessions"],
    ["GET", "/api/terminal/sessions/spec-1/phases"],
    ["GET", "/api/terminal/sessions/spec-1/dialog"],
    ["POST", "/api/terminal/sessions/spec-1/steer"],
    ["POST", "/api/terminal/sessions/spec-1/interrupt"],
    ["POST", "/api/terminal/sessions/spec-1/dialog/answer"],
    ["POST", "/api/terminal/sessions/spec-1/dialog/takeover"],
    ["GET", "/api/terminal/sessions/spec-1/ws"],
    ["GET", "/api/terminal/sessions/spec-1/review"],
    ["GET", "/api/terminal/sessions/spec-1/review/docs/plan.md"],
    ["GET", "/api/specs/SPEC-1/docs"],
    ["GET", "/api/specs/SPEC-1/docs/docs/superpowers/plans/x.md"],
    ["GET", "/api/specs/SPEC-1/review"],
    ["GET", "/api/specs/SPEC-1/review/file.md?x=1"],
    ["GET", "/api/projects/hanoman/tree"],
    ["GET", "/api/projects/hanoman/file?path=README.md"],
    ["GET", "/api/projects/hanoman/working-status"],
    ["GET", "/api/projects/hanoman/file-diff?path=a.ts"],
    ["GET", "/api/projects/hanoman/status"],
    ["GET", "/api/projects/hanoman/graph"],
    ["GET", "/api/projects/hanoman/graph/search?q=x"],
    ["GET", "/api/projects/hanoman/compare"],
    ["GET", "/api/projects/hanoman/compare/file"],
    ["GET", "/api/projects/hanoman/commit/abc123"],
    ["GET", "/api/projects/hanoman/commit/abc123/file"],
    ["POST", "/api/specs/SPEC-1/done"],
    ["GET", "/api/events/ws"],
  ];
  for (const [m, p] of allowed) it(`boleh: ${m} ${p}`, () => expect(relayRouteAllowed(m, p)).toBe(true));

  const denied: [string, string][] = [
    ["PATCH", "/api/specs/SPEC-1"],
    ["DELETE", "/api/specs/SPEC-1"],
    ["POST", "/api/specs/SPEC-1/attachments"],
    ["POST", "/api/specs/SPEC-1/integrate"],
    ["DELETE", "/api/terminal/sessions/spec-1"],
    ["PUT", "/api/projects/hanoman/file"],
    ["POST", "/api/projects/hanoman/git"],
    ["POST", "/api/projects/hanoman/entry"],
    ["POST", "/api/projects/hanoman/upload"],
    ["GET", "/api/projects/hanoman/archive"],
    ["GET", "/api/settings"],
    ["PUT", "/api/settings"],
    ["GET", "/api/remote-control"],
    ["GET", "/api/device-tokens"],
    ["GET", "/api/sync/pull"],
    ["GET", "/api/presence"],
    ["GET", "/api/terminal/workspace"],
    ["GET", "/api/specs/SPEC-1/review/x.md?download=1"],
    ["GET", "/api/terminal/sessions/spec-1/review?download"],
    ["GET", "/api/specs/SPEC-1/docs/../../../etc/passwd"],
    ["GET", "/api/specs/SPEC-1/docs/%2e%2e/secret"],
    ["GET", "/api/terminal/sessions/"],
    ["GET", "/terminal/sessions"],
  ];
  for (const [m, p] of denied) it(`tolak: ${m} ${p}`, () => expect(relayRouteAllowed(m, p)).toBe(false));
});

describe("relayBodyAllowed", () => {
  it("POST /terminal/sessions hanya varian spec", () => {
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { spec: "SPEC-1", flow: "feature" })).toBe(true);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { project: "p1", shell: true })).toBe(false);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { project: "p1", flow: "reverse" })).toBe(false);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { spec: "" })).toBe(false);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", undefined)).toBe(false);
  });
  it("route lain tak dinilai body-nya", () => {
    expect(relayBodyAllowed("POST", "/api/terminal/sessions/spec-1/steer", { text: "x" })).toBe(true);
  });
});

describe("remoteCapabilityFor", () => {
  it("WS terminal mode read menuntut sessions:read", () => {
    expect(remoteCapabilityFor("GET", "/api/terminal/sessions/spec-1/ws", "read")).toBe("sessions:read");
    expect(remoteCapabilityFor("GET", "/api/terminal/sessions/spec-1/ws", "write")).toBeNull();
    expect(remoteCapabilityFor("GET", "/api/terminal/sessions", "read")).toBeNull();
  });
});

describe("validateRemoteGrant", () => {
  it("menerima kosong, Lihat, dan kombinasi ber-sessions:read", () => {
    expect(validateRemoteGrant([])).toBeNull();
    expect(validateRemoteGrant(["sessions:read", "backlog:read", "ide:read"])).toBeNull();
    expect(validateRemoteGrant([...REMOTE_CAPABILITIES])).toBeNull();
  });
  it("menolak capability di luar kosakata dan tulis tanpa sessions:read", () => {
    expect(validateRemoteGrant(["vps:exec"])).toMatch(/REMOTE_CAPABILITIES/);
    expect(validateRemoteGrant(["sessions:write"])).toMatch(/sessions:read/);
  });
});

describe("utf8Bytes & splitUtf8", () => {
  it("menghitung byte UTF-8 termasuk pasangan surrogate", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
    expect(utf8Bytes("😀")).toBe(4);
    expect(utf8Bytes("😀é")).toBe(new TextEncoder().encode("😀é").byteLength);
  });
  it("memotong ≤ maxBytes tanpa membelah karakter, dan menyambung kembali utuh", () => {
    const text = "a😀€é".repeat(20_000);
    const parts = splitUtf8(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(utf8Bytes(p)).toBeLessThanOrEqual(RELAY_PART_MAX_BYTES);
    expect(parts.join("")).toBe(text);
    expect(splitUtf8("")).toEqual([""]);
    expect(splitUtf8("😀😀", 4)).toEqual(["😀", "😀"]);
  });
});

describe("frame relay .strict()", () => {
  it("req sah lolos; field asing, path non-/api, dan method asing dibuang", () => {
    const req = { t: "req", id: "r1", method: "GET", path: "/api/terminal/sessions", actor };
    expect(zHubToClientFrame.safeParse(req).success).toBe(true);
    expect(zHubToClientFrame.safeParse({ ...req, extra: 1 }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, path: "/etc/passwd" }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, path: "/api/a/../b" }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, method: "TRACE" }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, actor: { ...actor, role: "x" } }).success).toBe(false);
  });
  it("hello membawa protocol numerik apa pun (hub yang memutuskan cocok/tidak)", () => {
    const hello = { t: "hello", v: 1, protocol: 2, version: "0.5.0", capabilities: ["sessions:read"] };
    expect(zClientToHubFrame.safeParse(hello).success).toBe(true);
    expect(zClientToHubFrame.safeParse({ ...hello, capabilities: ["vps:exec"] }).success).toBe(false);
  });
  it("res dengan part > 32 KiB ditolak", () => {
    const big = "x".repeat(RELAY_PART_MAX_BYTES + 1);
    expect(zClientToHubFrame.safeParse({ t: "res", id: "r1", status: 200, part: "ok", end: true }).success).toBe(true);
    expect(zClientToHubFrame.safeParse({ t: "res", id: "r1", part: big, end: true }).success).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/relay.test.ts`
Expected: FAIL — `Failed to resolve import "./relay"`.

- [x] **Step 3: Implementasi**

Create `shared/src/relay.ts`:

```ts
import { z } from "zod";
import type { Capability } from "./agent";
import type { LogEntryView } from "./logs";

/* SPEC-1215 · ADR-0165 · kontrak kanal relay hub → klien.

   Relay TIDAK punya katalog operasi: hub menunnel request ke route REST/WS yang SUDAH ada, dan
   klien menjalankannya ulang in-process. Karena itu yang dikunci di sini hanya amplop frame,
   anggaran byte, dan dua pagar murni — allowlist route dan kosakata grant. Semua fungsi di sini
   murni supaya bisa diuji tabel positif DAN negatif tanpa server. */

export const RELAY_PROTOCOL = 1;
/** ½ `maxPayload` 64 KiB (pola `PRESENCE_MAX_FRAME_BYTES`): frame di atasnya ditutup `ws` dengan 1009. */
export const RELAY_PART_MAX_BYTES = 32 * 1024;
export const RELAY_MAX_STREAMS = 6;
/** Cermin `MAX_INFLIGHT` ADR-0145. */
export const RELAY_MAX_INFLIGHT = 4;
/** Cermin `PULL_MAX_BYTES` ADR-0138. */
export const RELAY_RESPONSE_MAX_BYTES = 1024 * 1024;
export const RELAY_REASSEMBLY_MAX_BYTES = 1024 * 1024;
export const RELAY_REQUEST_BODY_MAX_BYTES = 32 * 1024;
export const RELAY_CREDIT_INITIAL = 256 * 1024;
export const RELAY_CREDIT_REFILL_BELOW = 64 * 1024;
export const RELAY_SOCKET_MAX_BUFFERED = 1024 * 1024;
export const RELAY_RESYNC_MIN_MS = 5_000;
export const RELAY_REQ_TIMEOUT_MS = 30_000;
/** Pembuatan worktree bisa melewati 30 dtk. */
export const RELAY_SPAWN_TIMEOUT_MS = 120_000;
export const RELAY_OPEN_TIMEOUT_MS = 10_000;
export const RELAY_MAX_FRAMES_PER_MIN = 12_000;
export const RELAY_IDLE_STREAM_CLOSE_MS = 2_000;
/** Hub lama (upgrade relay 404) diketuk lagi paling cepat 30 menit kemudian. */
export const RELAY_UNSUPPORTED_RETRY_MS = 30 * 60_000;

export const RELAY_HEADER = "x-hanoman-relay";
export const RELAY_ACTOR_HEADER = "x-hanoman-relay-actor";
export const RELAY_MODE_HEADER = "x-hanoman-relay-mode";

/** Subset katalog capability yang BOLEH diberikan ke hub. `danger` selain `sessions:spawn` tak pernah masuk. */
export const REMOTE_CAPABILITIES = [
  "sessions:read", "sessions:write", "sessions:spawn", "backlog:read", "backlog:write", "ide:read",
] as const satisfies readonly Capability[];
export const zRemoteCapability = z.enum(REMOTE_CAPABILITIES);
export type RemoteCapability = z.infer<typeof zRemoteCapability>;

/** Grant LOCAL-only di `Setting.data.remoteControl`. `setting` tak ada di `SYNCED`, jadi hub tak bisa menyalakannya. */
export const zRemoteControl = z.object({
  enabled: z.boolean().default(false),
  capabilities: z.array(zRemoteCapability).default([]),
});
export type RemoteControl = z.infer<typeof zRemoteControl>;
export const REMOTE_CONTROL_DEFAULTS: RemoteControl = { enabled: false, capabilities: [] };

/** `null` = sah. Setiap grant yang tak kosong wajib memuat `sessions:read`: tulis/mulai/selesai tanpa
    bisa melihat sesinya membuat operator hub bertindak buta di mesin orang lain. */
export function validateRemoteGrant(caps: readonly string[]): string | null {
  const known = new Set<string>(REMOTE_CAPABILITIES);
  const unknown = caps.filter((c) => !known.has(c));
  if (unknown.length) return `capability di luar REMOTE_CAPABILITIES: ${unknown.join(", ")}`;
  if (caps.length > 0 && !caps.includes("sessions:read"))
    return "grant tanpa sessions:read ditolak — Tulis/Mulai/Selesai butuh Lihat";
  return null;
}

const cpBytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Panjang UTF-8 tanpa `Buffer`: modul ini juga diimpor dashboard (browser). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    n += cpBytes(cp);
    if (cp > 0xffff) i++;
  }
  return n;
}

/** Potong teks jadi bagian ≤ `maxBytes` byte UTF-8 tanpa pernah membelah satu code point. */
export function splitUtf8(text: string, maxBytes = RELAY_PART_MAX_BYTES): string[] {
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    const b = cpBytes(cp);
    if (bytes + b > maxBytes && i > start) { parts.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += b;
    i += width;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Aktor adalah KLAIM hub: klien mencatatnya apa adanya, ia tak bisa memverifikasi manusia di hub. */
export const zRelayActor = z.object({
  hubOrigin: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  email: z.string().min(1).max(320),
}).strict();
export type RelayActor = z.infer<typeof zRelayActor>;

const zId = z.string().min(1).max(64);
const UNSAFE_PATH = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\|[?#]/i;
const zRelayPath = z.string().max(2048).regex(/^\/api\//).refine((p) => !UNSAFE_PATH.test(p), "path relay tak sah");
const zPart = z.string().refine((s) => utf8Bytes(s) <= RELAY_PART_MAX_BYTES, "part relay > 32 KiB");
export const RELAY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RelayMethod = (typeof RELAY_METHODS)[number];

// ── hub → klien ────────────────────────────────────────────────────────────────────────────
const zWelcome = z.object({ t: z.literal("welcome"), v: z.literal(1), protocol: z.number().int(), version: z.string().max(40) }).strict();
const zReq = z.object({
  t: z.literal("req"), id: zId, method: z.enum(RELAY_METHODS), path: zRelayPath,
  query: z.string().max(2048).optional(), body: z.unknown().optional(), actor: zRelayActor,
}).strict();
const zCancel = z.object({ t: z.literal("cancel"), id: zId }).strict();
const zOpen = z.object({ t: z.literal("open"), sid: zId, path: zRelayPath, mode: z.enum(["read", "write"]), actor: zRelayActor }).strict();
const zHubData = z.object({ t: z.literal("data"), sid: zId, d: zPart }).strict();
const zCredit = z.object({ t: z.literal("credit"), sid: zId, n: z.number().int().min(1).max(4 * 1024 * 1024) }).strict();
const zClose = z.object({ t: z.literal("close"), sid: zId, code: z.number().int().min(1000).max(4999), reason: z.string().max(120).optional() }).strict();
export const zHubToClientFrame = z.discriminatedUnion("t", [zWelcome, zReq, zCancel, zOpen, zHubData, zCredit, zClose]);
export type HubToClientFrame = z.infer<typeof zHubToClientFrame>;
export type RelayReqFrame = z.infer<typeof zReq>;

// ── klien → hub ────────────────────────────────────────────────────────────────────────────
const zHello = z.object({
  t: z.literal("hello"), v: z.literal(1),
  // Sengaja number, bukan literal: hub harus bisa MELIHAT protokol yang beda untuk menutup 4001
  // dan menampilkan "protocol-mismatch", bukan membuang frame-nya senyap.
  protocol: z.number().int(), version: z.string().max(40),
  capabilities: z.array(zRemoteCapability).max(REMOTE_CAPABILITIES.length),
}).strict();
const zRes = z.object({
  t: z.literal("res"), id: zId, status: z.number().int().min(100).max(599).optional(),
  contentType: z.string().max(200).optional(), part: zPart, end: z.boolean(),
}).strict();
const zGeometryFields = { cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) };
const zOpened = z.object({ t: z.literal("opened"), sid: zId, geometry: z.object(zGeometryFields).strict().optional() }).strict();
const zGeometry = z.object({ t: z.literal("geometry"), sid: zId, ...zGeometryFields }).strict();
const zClientData = z.object({ t: z.literal("data"), sid: zId, d: zPart, more: z.literal(true).optional() }).strict();
export const zClientToHubFrame = z.discriminatedUnion("t", [zHello, zRes, zOpened, zGeometry, zClientData, zClose]);
export type ClientToHubFrame = z.infer<typeof zClientToHubFrame>;

// ── allowlist route (lapis kedua di atas capability) ──────────────────────────────────────
// `backlog:write` juga membuka `PATCH /specs`, lampiran, dll. Capability sendirian terlalu lebar
// untuk mesin orang lain, jadi permukaan relay dibatasi DI SINI, deny-by-default.
const RELAY_ROUTES: readonly (readonly [string, RegExp])[] = [
  ["GET", /^\/terminal\/sessions$/],
  ["POST", /^\/terminal\/sessions$/],
  ["GET", /^\/terminal\/sessions\/[^/]+\/(?:phases|dialog|ws)$/],
  ["POST", /^\/terminal\/sessions\/[^/]+\/(?:steer|interrupt|dialog\/answer|dialog\/takeover)$/],
  ["GET", /^\/terminal\/sessions\/[^/]+\/review(?:\/.+)?$/],
  ["GET", /^\/specs\/[^/]+\/(?:docs|review)(?:\/.+)?$/],
  ["GET", /^\/projects\/[^/]+\/(?:tree|file|working-status|file-diff|status|graph|graph\/search|compare|compare\/file)$/],
  ["GET", /^\/projects\/[^/]+\/commit\/[^/]+(?:\/file)?$/],
  ["POST", /^\/specs\/[^/]+\/done$/],
  ["GET", /^\/events\/ws$/],
];
const REVIEW_SEGMENT = /\/review(?:\/|$)/;
const UNSAFE_SEGMENT = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i;

export function relayRouteAllowed(method: string, url: string): boolean {
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? "" : url.slice(q + 1);
  if (!path.startsWith("/api/") || UNSAFE_SEGMENT.test(path)) return false;
  const rel = path.slice("/api".length);
  const m = method.toUpperCase();
  if (!RELAY_ROUTES.some(([rm, re]) => rm === m && re.test(rel))) return false;
  // Unduhan review = byte mentah ber-content-disposition; di luar permukaan relay (ADR-0165 §5).
  if (REVIEW_SEGMENT.test(rel) && new URLSearchParams(query).has("download")) return false;
  return true;
}

/** Hanya `POST /terminal/sessions` yang dinilai body-nya: varian shell/project/reverse/prd = sesi
    tanpa backlog, di luar grant "Mulai sesi". Dipanggil di `preHandler` (body sudah di-parse). */
export function relayBodyAllowed(method: string, path: string, body: unknown): boolean {
  const p = path.split("?")[0];
  if (method.toUpperCase() !== "POST" || p !== "/api/terminal/sessions") return true;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const spec = (body as { spec?: unknown }).spec;
  return typeof spec === "string" && spec.length > 0;
}

/** Satu pengecualian atas `capabilityForRoute`: WS terminal baca-saja menuntut `sessions:read`,
    bukan `sessions:write` — dispatcher (SPEC-1218) membuang `in`/`diag` sebelum route. */
export function remoteCapabilityFor(method: string, path: string, mode: "read" | "write"): Capability | null {
  const p = path.split("?")[0] ?? "";
  return method.toUpperCase() === "GET" && mode === "read" && /^\/api\/terminal\/sessions\/[^/]+\/ws$/.test(p)
    ? "sessions:read" : null;
}

// ── /api/remote-control ───────────────────────────────────────────────────────────────────
export const zRemoteControlPut = z.object({
  control: z.object({ enabled: z.boolean(), capabilities: z.array(z.string().max(40)).max(20) }).strict().optional(),
  logs: z.object({ event: z.boolean(), server: z.boolean(), transcript: z.boolean() }).strict().optional(),
}).strict();
export type RemoteControlPut = z.infer<typeof zRemoteControlPut>;

export type RelayLinkState = "off" | "connecting" | "open" | "backoff" | "unsupported" | "rejected";
export type RelayLinkStatus = {
  state: RelayLinkState; since: string | null; hubOrigin: string | null;
  lastClose: { code: number; reason: string } | null;
};
/** `shipping` ditambahkan SPEC-1217 bersama shipper-nya (keputusan Plan P6). */
export type RemoteControlView = {
  control: RemoteControl;
  logs: { event: boolean; server: boolean; transcript: boolean };
  relay: RelayLinkStatus;
  audit: LogEntryView[];
};
```

Modify `shared/src/index.ts` — tambahkan sesudah `export * from "./presence";`:

```ts
export * from "./relay";
```

(Impor tipe `./logs` di atas baru terpenuhi di Task 2. Karena itu jalankan Step 4 **sesudah** Task 2 Step 3 bila typecheck mengeluh, atau buat `shared/src/logs.ts` Task 2 lebih dulu — vitest sendiri tak menegakkan impor tipe.)

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm vitest --run shared/src/relay.test.ts`
Expected: PASS (seluruh tabel).

- [x] **Step 5: Commit**

```bash
git add shared/src/relay.ts shared/src/relay.test.ts shared/src/index.ts
git commit -m "feat(shared): kontrak relay SPEC-1215 — frame, allowlist, grant"
```

### Task 2: Kontrak log + frame `capacity` di `@hanoman/shared`

**Files:**
- Create: `shared/src/logs.ts`
- Create: `shared/src/logs.test.ts`
- Create: `shared/src/presence-capacity.test.ts`
- Modify: `shared/src/presence.ts` (tambah di akhir berkas + tipe `PresenceDeviceView` baris 62-71)
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `zLaunchStatus`, `type LaunchStatus` (`shared/src/session-admission.ts:4-13`); `type RemoteCapability` (Task 1).
- Produces:
  - `LOG_LANES`, `zLogLane`, `type LogLane`, `LOG_LEVELS`, `zLogLevel`, `type LogLevel`, `LOG_MSG_MAX_BYTES`, `LOG_DATA_MAX_BYTES`
  - `nextSeq(last: number, now: number): number`
  - `type LogEntryView = { id: number; deviceId: string; deviceName: string; lane: LogLane; seq: string; ts: string; receivedAt: string; level: LogLevel; kind: string; projectId: string | null; specId: string | null; sessionId: string | null; msg: string; data: Record<string, unknown> | null; hasTranscript: boolean }`
  - `zLogShipping`, `LOG_SHIPPING_DEFAULTS`, `zLogRetention`, `LOG_RETENTION_DEFAULTS`
  - `zCapacityFrame`, `type CapacityFrame`, `capacityFrameJson(admission: LaunchStatus): string`, `capacitySignature(a: LaunchStatus): string`
  - `type PresenceControlView = { state: "available" | "protocol-mismatch"; protocol: number; version: string; capabilities: RemoteCapability[]; since: string }`
  - `PresenceDeviceView.control?: PresenceControlView | null`, `PresenceDeviceView.capacity?: LaunchStatus | null`

- [x] **Step 1: Tulis test yang gagal**

Create `shared/src/logs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LOG_RETENTION_DEFAULTS, nextSeq, zLogRetention, zLogShipping } from "./logs";

describe("nextSeq — jam logis hibrida (ADR-0166 §3)", () => {
  const T = 1_757_000_000_000;
  it("mengikuti jam dinding ×1000 saat jam maju", () => {
    expect(nextSeq(0, T)).toBe(T * 1000);
    expect(nextSeq(T * 1000, T + 1)).toBe((T + 1) * 1000);
  });
  it("tetap naik ketat pada milidetik yang sama", () => {
    const a = nextSeq(0, T);
    const b = nextSeq(a, T);
    const c = nextSeq(b, T);
    expect([b - a, c - b]).toEqual([1, 1]);
  });
  it("tak pernah mundur saat jam mundur (restart dengan last dari DB)", () => {
    const last = nextSeq(0, T + 60_000);
    expect(nextSeq(last, T)).toBe(last + 1);
  });
  it("tetap integer aman JS", () => {
    expect(Number.isSafeInteger(nextSeq(0, Date.now()))).toBe(true);
  });
});

describe("kunci Setting log", () => {
  it("default dan batas retensi", () => {
    expect(zLogRetention.parse({})).toEqual(LOG_RETENTION_DEFAULTS);
    expect(LOG_RETENTION_DEFAULTS).toEqual({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 268435456 });
    expect(zLogRetention.safeParse({ eventDays: 0 }).success).toBe(false);
    expect(zLogRetention.safeParse({ maxBytes: 1024 }).success).toBe(false);
    expect(zLogShipping.parse({})).toEqual({ event: true, server: false, transcript: false });
  });
});
```

Create `shared/src/presence-capacity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { capacityFrameJson, capacitySignature, zCapacityFrame, zPresenceFrame } from "./presence";
import type { LaunchStatus } from "./session-admission";

const admission: LaunchStatus = {
  enabled: true, liveCount: 2, liveAgentCount: 1, maxConcurrent: 4,
  loadPerCore: 0.42, maxLoadPerCore: 1.5, loadStatus: "available",
};

describe("frame capacity (SPEC-1215 · ADR-0165 §9)", () => {
  it("frame yang dirakit lolos zCapacityFrame dan .strict()", () => {
    const parsed = JSON.parse(capacityFrameJson(admission));
    expect(zCapacityFrame.safeParse(parsed).success).toBe(true);
    expect(zCapacityFrame.safeParse({ ...parsed, extra: 1 }).success).toBe(false);
  });
  it("hub versi lama (zPresenceFrame) membuangnya senyap — gagal parse, bukan melempar", () => {
    expect(zPresenceFrame.safeParse(JSON.parse(capacityFrameJson(admission))).success).toBe(false);
  });
  it("signature membulatkan loadPerCore ke 1 desimal supaya denyut beban tak membanjiri frame", () => {
    expect(capacitySignature({ ...admission, loadPerCore: 0.41 })).toBe(capacitySignature({ ...admission, loadPerCore: 0.44 }));
    expect(capacitySignature({ ...admission, loadPerCore: 0.41 })).not.toBe(capacitySignature({ ...admission, loadPerCore: 0.49 }));
    expect(capacitySignature({ ...admission, liveCount: 3 })).not.toBe(capacitySignature(admission));
    expect(capacitySignature({ ...admission, loadPerCore: null })).toContain("null");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/logs.test.ts shared/src/presence-capacity.test.ts`
Expected: FAIL — `./logs` tak ditemukan; `capacityFrameJson` bukan export.

- [x] **Step 3: Implementasi `logs.ts`**

Create `shared/src/logs.ts`:

```ts
import { z } from "zod";

/* SPEC-1215 · ADR-0166 · kontrak log terpusat. Turunan A memakai lajur `event` untuk audit lokal;
   ingest, pengiriman, dan pencarian (beserta konstanta batch/spool/kuota) ditambahkan SPEC-1217. */

export const LOG_LANES = ["event", "server", "transcript"] as const;
export const zLogLane = z.enum(LOG_LANES);
export type LogLane = z.infer<typeof zLogLane>;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const zLogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof zLogLevel>;

export const LOG_MSG_MAX_BYTES = 4 * 1024;
export const LOG_DATA_MAX_BYTES = 8 * 1024;

/** `max(seqTerakhir + 1, now × 1000)`: monoton lintas restart DAN instal ulang ber-token sama tanpa
    menulis penghitung per baris; ≈ 1,8 × 10¹⁵ masih integer aman JS. Autoincrement lokal ditolak
    karena reset saat instal ulang, dan hub akan menolak semua entrinya sebagai duplikat senyap. */
export function nextSeq(last: number, now: number): number {
  return Math.max(last + 1, Math.floor(now) * 1000);
}

export type LogEntryView = {
  id: number; deviceId: string; deviceName: string; lane: LogLane;
  /** BigInt di DB → string di kawat: JSON tak punya bigint. */
  seq: string; ts: string; receivedAt: string; level: LogLevel; kind: string;
  projectId: string | null; specId: string | null; sessionId: string | null;
  msg: string; data: Record<string, unknown> | null; hasTranscript: boolean;
};

export const LOG_SHIPPING_DEFAULTS = { event: true, server: false, transcript: false };
export const zLogShipping = z.object({
  event: z.boolean().default(true),
  server: z.boolean().default(false),
  transcript: z.boolean().default(false),
});
export type LogShipping = z.infer<typeof zLogShipping>;

export const LOG_RETENTION_DEFAULTS = { eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 256 * 1024 ** 2 };
const days = (d: number) => z.number().int().min(1).max(365).default(d);
export const zLogRetention = z.object({
  eventDays: days(90), serverDays: days(7), transcriptDays: days(30),
  maxBytes: z.number().int().min(16 * 1024 ** 2).max(4 * 1024 ** 3).default(256 * 1024 ** 2),
});
export type LogRetention = z.infer<typeof zLogRetention>;
```

- [x] **Step 4: Implementasi tambahan `presence.ts`**

Di `shared/src/presence.ts`, tambahkan impor di bawah `import { z } from "zod";`:

```ts
import { zLaunchStatus, type LaunchStatus } from "./session-admission";
import type { RemoteCapability } from "./relay";
```

Ganti tipe `PresenceDeviceView` (baris 62-71) menjadi:

```ts
export type PresenceDeviceView = {
  deviceId: string;
  name: string;
  /** Mesin tempat instance ini sendiri berjalan. */
  local: boolean;
  online: boolean;
  /** `DeviceToken.lastSeenAt` — ditulis jalur sync yang sudah ada, bukan oleh kanal ini. */
  lastSeenAt: string | null;
  sessions: PresenceSessionView[];
  /** SPEC-1215 · ADR-0165 · ketersediaan kendali dari `hello` socket relay; `null` = tak ada socket
      relay (grant mati, klien lama, offline). Opsional di tipe supaya literal lama tetap sah;
      `presenceView()` selalu mengisinya. */
  control?: PresenceControlView | null;
  /** SPEC-1215 · angka `launchStatus()` dari frame naik `capacity`; `null` = belum ada frame. */
  capacity?: LaunchStatus | null;
};

export type PresenceControlView = {
  state: "available" | "protocol-mismatch";
  protocol: number; version: string; capabilities: RemoteCapability[]; since: string;
};
```

Tambahkan di akhir `shared/src/presence.ts`:

```ts
/* SPEC-1215 · ADR-0165 §9 · arah naik KEDUA di socket sync: kapasitas klien. Di socket sync, bukan
   relay, karena angka ini berguna untuk SEMUA klien terpasang, termasuk yang tak opt-in. Hub lama
   membuangnya senyap: `zPresenceFrame` gagal parse karena `t` bukan "presence". */
export const zCapacityFrame = z.object({
  t: z.literal("capacity"),
  v: z.literal(PRESENCE_PROTOCOL),
  admission: zLaunchStatus,
}).strict();
export type CapacityFrame = z.infer<typeof zCapacityFrame>;

export const capacityFrameJson = (admission: LaunchStatus): string =>
  JSON.stringify({ t: "capacity", v: PRESENCE_PROTOCOL, admission });

/** Dedup pengirim. `loadPerCore` dibulatkan 1 desimal: load average bergerak tiap tick, dan
    signature presisi penuh berarti satu frame per 3 dtk walau tak ada yang berubah berarti. */
export function capacitySignature(a: LaunchStatus): string {
  return JSON.stringify([a.enabled, a.liveCount, a.liveAgentCount, a.maxConcurrent,
    a.loadPerCore === null ? null : Math.round(a.loadPerCore * 10) / 10, a.maxLoadPerCore, a.loadStatus]);
}
```

- [x] **Step 5: Export**

Di `shared/src/index.ts`, tambahkan sesudah `export * from "./relay";`:

```ts
export * from "./logs";
```

- [x] **Step 6: Jalankan test + typecheck shared**

Run: `pnpm vitest --run shared/src/logs.test.ts shared/src/presence-capacity.test.ts shared/src/relay.test.ts && pnpm --filter ./shared typecheck`
Expected: PASS; typecheck tanpa error.

- [x] **Step 7: Commit**

```bash
git add shared/src/logs.ts shared/src/logs.test.ts shared/src/presence.ts shared/src/presence-capacity.test.ts shared/src/index.ts
git commit -m "feat(shared): kontrak log & frame capacity SPEC-1215"
```

### Task 3: Kunci `Setting` LOCAL-only + `PUT /settings` mempertahankannya (AC-A3 bagian 1)

**Files:**
- Modify: `shared/src/entities.ts:1-6` (impor) dan `:393-431` (`zSetting`)
- Modify: `server/src/services/settings.ts:2-6` (impor) dan `:12-35` (`DEFAULT_SETTING`)
- Modify: `server/src/routes/settings.ts:9-24`
- Modify: `src/src/screens/SettingsScreen.tsx:6` (impor) dan `:43-67` (`S_DEFAULTS`)
- Test: `server/test/settings-remote-keys.test.ts` (baru)

**Interfaces:**
- Consumes: `zRemoteControl`, `REMOTE_CONTROL_DEFAULTS` (Task 1); `zLogShipping`, `LOG_SHIPPING_DEFAULTS`, `zLogRetention`, `LOG_RETENTION_DEFAULTS` (Task 2).
- Produces: `Setting.remoteControl: RemoteControl`, `Setting.logShipping: LogShipping`, `Setting.logRetention: LogRetention` — dibaca `getSetting()` di Task 8, 11, 12.

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/settings-remote-keys.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { DEFAULT_SETTING, getSetting } from "../src/services/settings";
import { makeSetting, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
beforeEach(resetDb);
afterAll(async () => { await resetDb(); await app.close(); });

// SPEC-1215 · ADR-0165 §4 / ADR-0166 §7–8 · agent token ber-`settings:write` tak boleh menyalakan
// kendali jarak jauh ke mesinnya sendiri, menyalakan ekspor transkrip, atau memendekkan retensi audit.
describe("PUT /settings tak menulis kunci LOCAL-only SPEC-1215 (AC-A3)", () => {
  it("default kunci baru: grant mati, hanya lajur event, retensi 90/7/30", () => {
    expect(DEFAULT_SETTING.remoteControl).toEqual({ enabled: false, capabilities: [] });
    expect(DEFAULT_SETTING.logShipping).toEqual({ event: true, server: false, transcript: false });
    expect(DEFAULT_SETTING.logRetention).toEqual({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 268435456 });
  });

  it("body yang MENYALAKAN grant/lajur/retensi diabaikan — nilai tersimpan bertahan", async () => {
    const body = {
      ...DEFAULT_SETTING,
      remoteControl: { enabled: true, capabilities: ["sessions:read", "sessions:spawn"] },
      logShipping: { event: true, server: true, transcript: true },
      logRetention: { eventDays: 1, serverDays: 1, transcriptDays: 1, maxBytes: 16 * 1024 ** 2 },
    };
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: body });
    expect(put.statusCode).toBe(200);
    const s = await getSetting();
    expect(s.remoteControl).toEqual({ enabled: false, capabilities: [] });
    expect(s.logShipping).toEqual({ event: true, server: false, transcript: false });
    expect(s.logRetention.eventDays).toBe(90);
  });

  it("body yang MEMATIKAN grant juga diabaikan, sementara kunci lain tetap tertulis", async () => {
    await makeSetting({ remoteControl: { enabled: true, capabilities: ["sessions:read"] } });
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...DEFAULT_SETTING, notifyDone: false } });
    expect(put.statusCode).toBe(200);
    const s = await getSetting();
    expect(s.notifyDone).toBe(false);
    expect(s.remoteControl).toEqual({ enabled: true, capabilities: ["sessions:read"] });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/settings-remote-keys.test.ts`
Expected: FAIL — `DEFAULT_SETTING.remoteControl` undefined.

- [x] **Step 3: Tambah kunci ke `zSetting`**

Di `shared/src/entities.ts`, tambahkan impor sesudah baris 6:

```ts
import { REMOTE_CONTROL_DEFAULTS, zRemoteControl } from "./relay";
import { LOG_RETENTION_DEFAULTS, LOG_SHIPPING_DEFAULTS, zLogRetention, zLogShipping } from "./logs";
```

Di `zSetting`, sisipkan tepat sebelum baris komentar `// SPEC-881 · ADR-0136 · sidik jari isi bawaan…`:

```ts
  // SPEC-1215 · ADR-0165/0166 · LOCAL-only (setting tak ada di SYNCED) dan TAK ditulis `PUT /settings`
  // (routes/settings.ts mempertahankan nilai tersimpan). Pengelolanya `PUT /api/remote-control` dan,
  // kelak, `PUT /api/logs/retention` — keduanya COOKIE_ONLY.
  remoteControl: zRemoteControl.default(REMOTE_CONTROL_DEFAULTS),      // grant kendali jarak jauh (default mati)
  logShipping: zLogShipping.default(LOG_SHIPPING_DEFAULTS),            // lajur log ke hub (SPEC-1217)
  logRetention: zLogRetention.default(LOG_RETENTION_DEFAULTS),         // retensi log di hub (SPEC-1217)
```

- [x] **Step 4: Default server & frontend**

Di `server/src/services/settings.ts`, tambahkan `REMOTE_CONTROL_DEFAULTS, LOG_SHIPPING_DEFAULTS, LOG_RETENTION_DEFAULTS,` ke impor `@hanoman/shared` (baris 2-6), lalu di `DEFAULT_SETTING` sesudah `orchestration: ORCHESTRATION_DEFAULTS,`:

```ts
  remoteControl: REMOTE_CONTROL_DEFAULTS, // SPEC-1215 · ADR-0165 · grant LOCAL-only, default mati
  logShipping: LOG_SHIPPING_DEFAULTS,     // SPEC-1215 · ADR-0166
  logRetention: LOG_RETENTION_DEFAULTS,   // SPEC-1215 · ADR-0166
```

Di `src/src/screens/SettingsScreen.tsx`, tambahkan `REMOTE_CONTROL_DEFAULTS, LOG_SHIPPING_DEFAULTS, LOG_RETENTION_DEFAULTS` ke impor nilai `@hanoman/shared` di baris 6, lalu di `S_DEFAULTS` sesudah `orchestration: ORCHESTRATION_DEFAULTS, …`:

```ts
  remoteControl: REMOTE_CONTROL_DEFAULTS, // SPEC-1215 · wajib di tipe Setting; dikelola RemoteControlPanel
  logShipping: LOG_SHIPPING_DEFAULTS,
  logRetention: LOG_RETENTION_DEFAULTS,
```

- [x] **Step 5: `PUT /settings` mempertahankan**

Ganti isi handler `app.put("/settings", …)` di `server/src/routes/settings.ts` menjadi:

```ts
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    // SPEC-1215 · ADR-0165 §4 / ADR-0166 §7–8 · tiga kunci ini dibaca dari baris TERSIMPAN, bukan body:
    // `settings:write` agent token tak boleh menyalakan RCE ke mesinnya sendiri, mengekspor transkrip,
    // atau memendekkan retensi (= menghapus bukti audit). Pengelolanya route COOKIE_ONLY sendiri.
    const data = {
      ...parsed.data,
      remoteControl: before.remoteControl, logShipping: before.logShipping, logRetention: before.logRetention,
    };
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data }, create: { id: 1, data } });
    // SPEC-477 · ADR-0097 · toggle gateway berlaku LANGSUNG, tanpa restart. Dibandingkan dulu
    // supaya PUT settings yang tak menyentuh Telegram tak memutus long-poll yang sedang jalan.
    // SPEC-492 · `telegram.engine` sengaja DIKECUALIKAN dari perbandingan: ia dibaca lazy tiap
    // sesi operator lahir, jadi menggeser satu dropdown tak boleh memutus long-poll dan
    // mempertaruhkan `readiness` pada satu panggilan `getMe()`.
    if (telegramReloadNeeded(before.telegram, parsed.data.telegram)) {
      await reloadTelegramGateway();
    }
    return row.data;
  });
```

- [x] **Step 6: Jalankan test tersentuh + typecheck**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/settings-remote-keys.test.ts server/test/settings.test.ts server/test/sync-exclusions.test.ts && pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: PASS; tiga typecheck bersih. Bila `src` typecheck merah pada literal `Setting` lain, tambahkan tiga kunci yang sama di literal itu (bukan `as Setting`).

- [x] **Step 7: Commit**

```bash
git add shared/src/entities.ts server/src/services/settings.ts server/src/routes/settings.ts src/src/screens/SettingsScreen.tsx server/test/settings-remote-keys.test.ts
git commit -m "feat(settings): kunci remoteControl/logShipping/logRetention LOCAL-only, PUT /settings mempertahankan"
```

### Task 4: Model `LogEntry`/`LogCursor` + migration

**Files:**
- Modify: `server/prisma/schema.prisma` (tambah di akhir berkas)
- Create: `server/prisma/migrations/20260915120000_log_terpusat/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts:34` (`PG_ORDER`)
- Test: `server/test/log-schema.test.ts` (baru)

**Interfaces:**
- Produces: delegate `prisma.logEntry` (kolom `id Int`, `deviceId`, `lane`, `seq BigInt`, `ts`, `receivedAt`, `level`, `kind`, `projectId?`, `specId?`, `sessionId?`, `msg`, `data Json?`, `transcriptKey?`, `bytes Int`) dan `prisma.logCursor` (`deviceId`, `lane`, `seq BigInt`, `updatedAt`; PK `[deviceId, lane]`).

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/log-schema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { SYNCED, isEntity } from "../src/services/sync";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const clean = async () => { await prisma.logEntry.deleteMany(); await prisma.logCursor.deleteMany(); };
beforeEach(clean);
afterAll(clean);

describe("skema log terpusat (SPEC-1215 · ADR-0166)", () => {
  it("LogEntry & LogCursor ada, seq BigInt, tanpa kolom version (LOCAL-only)", () => {
    for (const name of ["LogEntry", "LogCursor"]) {
      const m = models.get(name);
      expect(m, name).toBeDefined();
      const fields = new Map(m!.fields.map((f) => [f.name, f]));
      expect(fields.get("seq")!.type, `${name}.seq`).toBe("BigInt");
      expect(fields.has("version"), `${name}.version`).toBe(false);
    }
  });

  it("bukan entitas sync, tapi terdaftar di PG_ORDER (jalur 42P01, keputusan Plan P1)", () => {
    for (const e of ["logEntry", "logCursor"]) {
      expect(SYNCED as readonly string[]).not.toContain(e);
      expect(isEntity(e)).toBe(false);
    }
    expect(PG_ORDER).toContain("LogEntry");
    expect(PG_ORDER).toContain("LogCursor");
  });

  it("unique (deviceId, lane, seq) menolak baris kembar — jaring pengaman dedup", async () => {
    const row = {
      deviceId: "local", lane: "event", seq: BigInt("1757000000000000"), ts: new Date(),
      level: "info", kind: "session.start", msg: "x", bytes: 1,
    };
    await prisma.logEntry.create({ data: row });
    await expect(prisma.logEntry.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.logEntry.create({ data: { ...row, lane: "server" } })).resolves.toBeTruthy();
  });

  it("LogCursor ber-PK (deviceId, lane)", async () => {
    await prisma.logCursor.create({ data: { deviceId: "local", lane: "event", seq: BigInt(5) } });
    const up = await prisma.logCursor.upsert({
      where: { deviceId_lane: { deviceId: "local", lane: "event" } },
      create: { deviceId: "local", lane: "event", seq: BigInt(9) }, update: { seq: BigInt(9) },
    });
    expect(up.seq).toBe(BigInt(9));
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-schema.test.ts`
Expected: FAIL — `prisma.logEntry` undefined / model tak ada di DMMF.

- [x] **Step 3: Tambah model di akhir `server/prisma/schema.prisma`**

```prisma
/// SPEC-1215 · ADR-0166 · log terpusat + audit kendali jarak jauh. LOCAL-only per instance: BUKAN
/// entitas sync (tak masuk SYNCED/FIELDS/WEBHOOK_ENTITIES). Di klien `deviceId` = "local"; di hub
/// = DeviceToken.id pengirim (SPEC-1217). Tanpa kolom `version`.
model LogEntry {
  id            Int      @id @default(autoincrement())
  deviceId      String
  lane          String   // event | server | transcript (zod shared/src/logs.ts)
  seq           BigInt   // jam logis hibrida per (deviceId, lane); Int Prisma 32 bit tak cukup
  ts            DateTime
  receivedAt    DateTime @default(now())
  level         String
  kind          String
  projectId     String?  // tanpa FK (konvensi SessionResult)
  specId        String?
  sessionId     String?
  msg           String
  data          Json?
  transcriptKey String?
  bytes         Int      // msg + data + transkrip, untuk plafon maxBytes retensi

  @@unique([deviceId, lane, seq])
  @@index([ts])
  @@index([deviceId, ts])
  @@index([projectId, ts])
  @@index([specId, ts])
  @@index([lane, ts])
}

/// SPEC-1215 · ADR-0166 §3 · high-water mark. Hub: seq terakhir yang diterima dari device itu.
/// Klien (`deviceId` "local"): seq terakhir yang sudah di-ack hub.
model LogCursor {
  deviceId  String
  lane      String
  seq       BigInt
  updatedAt DateTime @updatedAt

  @@id([deviceId, lane])
}
```

- [x] **Step 4: Tulis migration**

Create `server/prisma/migrations/20260915120000_log_terpusat/migration.sql`:

```sql
-- SPEC-1215 · ADR-0166 · LOCAL-only per instance; bukan entitas sync. Nol backfill, tabel lain tak disentuh.
CREATE TABLE "LogEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "ts" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" TEXT,
    "specId" TEXT,
    "sessionId" TEXT,
    "msg" TEXT NOT NULL,
    "data" JSONB,
    "transcriptKey" TEXT,
    "bytes" INTEGER NOT NULL
);

CREATE TABLE "LogCursor" (
    "deviceId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("deviceId", "lane")
);

CREATE UNIQUE INDEX "LogEntry_deviceId_lane_seq_key" ON "LogEntry"("deviceId", "lane", "seq");
CREATE INDEX "LogEntry_ts_idx" ON "LogEntry"("ts");
CREATE INDEX "LogEntry_deviceId_ts_idx" ON "LogEntry"("deviceId", "ts");
CREATE INDEX "LogEntry_projectId_ts_idx" ON "LogEntry"("projectId", "ts");
CREATE INDEX "LogEntry_specId_ts_idx" ON "LogEntry"("specId", "ts");
CREATE INDEX "LogEntry_lane_ts_idx" ON "LogEntry"("lane", "ts");
```

- [x] **Step 5: Buktikan skema ≡ migration (tanpa drift)**

Run: `pnpm db:generate && pnpm --filter ./server exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "file:$(mktemp -d)/shadow.db" --exit-code`
Expected: `No difference detected.` dan exit 0. Bila ada selisih, jangan ubah skema: ganti isi `migration.sql` dengan keluaran `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "file:$(mktemp -d)/shadow.db" --script` (dengan migration baru dipindah sementara ke luar direktori), pertahankan baris komentar pertama, lalu ulangi step ini sampai exit 0.

- [x] **Step 6: Daftarkan di `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts`, sesudah baris `"SyncLog", "LocalBinding", "SyncOutbox", "SyncState", "SyncConflict", "SyncTombstone",` sisipkan:

```ts
  // SPEC-1215 · ADR-0166 · LOCAL-only, tanpa FK. Tabel ini tak ada di sumber Postgres lama — jalur
  // 42P01 memperlakukannya sebagai nol baris (cermin AgentInvocation/Changelog). Tetap WAJIB
  // terdaftar: test migrate-pg menuntut PG_ORDER = seluruh model DMMF.
  "LogEntry", "LogCursor",
```

- [x] **Step 7: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-schema.test.ts cli/test/migrate-pg.test.ts server/test/sync-exclusions.test.ts server/test/webhook-catalog-dmmf.test.ts`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260915120000_log_terpusat cli/src/commands/migrate-pg.ts server/test/log-schema.test.ts
git commit -m "feat(db): LogEntry & LogCursor LOCAL-only (SPEC-1215 · ADR-0166)"
```

### Task 5: Hook sesi aditif

**Files:**
- Modify: `server/src/services/pty.ts:530-535`
- Modify: `server/test/pty.test.ts:904,919,932`
- Test: `server/test/session-hooks-additive.test.ts` (baru)

**Interfaces:**
- Produces: `registerSessionHooks(h: { onBirth?: (b: SessionBirth) => void; onDeath?: (d: SessionDeath) => void }): () => void` (mengembalikan pencabut); `__emitSessionHooks: { birth(b: SessionBirth): void; death(d: SessionDeath): void }` (test-only). Dipakai Task 6.

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/session-hooks-additive.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { __emitSessionHooks, registerSessionHooks, type SessionBirth, type SessionDeath } from "../src/services/pty";

const birth: SessionBirth = {
  sessionId: "spec-1", projectId: "p1", specId: "SPEC-1", flow: "feature", kind: "spec", agent: "claude", cwd: "/tmp/x",
};
const death: SessionDeath = { sessionId: "spec-1", exitCode: 0, transcript: null };
const offs: (() => void)[] = [];
afterEach(() => { while (offs.length) offs.pop()!(); });

// SPEC-1215 · ADR-0166 · dulu satu slot: pendaftar kedua (tap log) mematikan riwayat sesi tanpa error.
describe("registerSessionHooks aditif", () => {
  it("dua pendaftar sama-sama menerima lahir dan tutup", () => {
    const a: string[] = []; const b: string[] = [];
    offs.push(registerSessionHooks({ onBirth: (x) => a.push(`lahir:${x.sessionId}`), onDeath: (x) => a.push(`tutup:${x.sessionId}`) }));
    offs.push(registerSessionHooks({ onBirth: (x) => b.push(`lahir:${x.sessionId}`), onDeath: (x) => b.push(`tutup:${x.sessionId}`) }));
    __emitSessionHooks.birth(birth);
    __emitSessionHooks.death(death);
    expect(a).toEqual(["lahir:spec-1", "tutup:spec-1"]);
    expect(b).toEqual(["lahir:spec-1", "tutup:spec-1"]);
  });

  it("pendaftar yang melempar tak membungkam pendaftar sesudahnya", () => {
    const seen: string[] = [];
    offs.push(registerSessionHooks({ onBirth: () => { throw new Error("boom"); } }));
    offs.push(registerSessionHooks({ onBirth: (x) => seen.push(x.sessionId) }));
    expect(() => __emitSessionHooks.birth(birth)).not.toThrow();
    expect(seen).toEqual(["spec-1"]);
  });

  it("fungsi yang dikembalikan mencabut pendaftar", () => {
    const seen: string[] = [];
    const off = registerSessionHooks({ onBirth: (x) => seen.push(x.sessionId) });
    off();
    __emitSessionHooks.birth(birth);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run server/test/session-hooks-additive.test.ts`
Expected: FAIL — `__emitSessionHooks` bukan export.

- [ ] **Step 3: Implementasi**

Ganti `server/src/services/pty.ts:530-535` (dari `type SessionHooks = …` sampai `const emitDeath = …`) dengan:

```ts
type SessionHooks = { onBirth?: (b: SessionBirth) => void; onDeath?: (d: SessionDeath) => void };
// SPEC-1215 · ADR-0166 · dulu SATU slot (`hooks = h`): pendaftar kedua — tap log event — MENGGANTI
// riwayat sesi tanpa satu pun error. Kini himpunan; pendaftar mencabut dirinya lewat fungsi yang
// dikembalikan, bukan dengan mendaftarkan `{}` (yang kini hanya menambah pendaftar kosong).
const hooks = new Set<SessionHooks>();
export function registerSessionHooks(h: SessionHooks): () => void {
  hooks.add(h);
  return () => { hooks.delete(h); };
}
// Fire-and-forget: riwayat/log tak boleh memblokir atau menggagalkan kelahiran/penutupan sesi, dan
// pendaftar yang melempar tak boleh membungkam pendaftar sesudahnya.
const emitBirth = (b: SessionBirth): void => {
  for (const h of hooks) { try { h.onBirth?.(b); } catch { /* opsional */ } }
};
const emitDeath = (d: SessionDeath): void => {
  for (const h of hooks) { try { h.onDeath?.(d); } catch { /* opsional */ } }
};
/** Test-only: tembakkan hook tanpa tmux. */
export const __emitSessionHooks = { birth: emitBirth, death: emitDeath };
```

- [ ] **Step 4: Perbaiki `pty.test.ts` yang bergantung pada semantik ganti-slot**

Di `server/test/pty.test.ts`, ganti baris 904:

```ts
  afterEach(() => { registerSessionHooks({}); });  // singleton modul — jangan bocor ke test lain
```

menjadi:

```ts
  // SPEC-1215 · hook kini aditif: `registerSessionHooks({})` hanya MENAMBAH pendaftar kosong dan
  // membiarkan hook test sebelumnya hidup. Cabut lewat fungsi yang dikembalikan.
  let unhook: (() => void) | undefined;
  afterEach(() => { unhook?.(); unhook = undefined; });
```

Lalu baris 919 `registerSessionHooks({ onBirth: (b) => { births.push(b); } });` → `unhook = registerSessionHooks({ onBirth: (b) => { births.push(b); } });`, dan baris 932 `registerSessionHooks({ onDeath: (d) => { deaths.push(d); } });` → `unhook = registerSessionHooks({ onDeath: (d) => { deaths.push(d); } });`.

- [ ] **Step 5: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-hooks-additive.test.ts server/test/pty.test.ts -t "hook"`
Expected: PASS. (`pty.test.ts` memakai tmux socket test; bila merah karena tmux sisa/tetangga, lihat memori "pty.test.ts gagal palsu karena tmux sisa" — bukan regresi.)

- [ ] **Step 6: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts server/test/session-hooks-additive.test.ts
git commit -m "refactor(pty): hook sesi aditif agar tap log tak mematikan riwayat (SPEC-1215)"
```

### Task 6: Log event lokal — `appendEvent`, `recentAudit`, tap lahir/tutup sesi

**Files:**
- Create: `server/src/services/logs/event-log.ts`
- Modify: `server/src/server.ts:9` (impor) dan `:106` (sesudah `installSessionHistory();`)
- Test: `server/test/log-event.test.ts` (baru)

**Interfaces:**
- Consumes: `prisma.logEntry` (Task 4); `registerSessionHooks`, `__emitSessionHooks` (Task 5); `nextSeq`, `LOG_MSG_MAX_BYTES`, `LOG_DATA_MAX_BYTES`, `splitUtf8`, `utf8Bytes`, `LOCAL_DEVICE_ID`, `type LogEntryView` (shared).
- Produces (dipakai Task 9, 11, 12 dan SPEC-1217):
  - `type EventInput = { kind: string; msg: string; level?: LogLevel; projectId?: string | null; specId?: string | null; sessionId?: string | null; data?: Record<string, unknown> | null; at?: Date }`
  - `appendEvent(e: EventInput): Promise<void>` — tak pernah reject
  - `recentAudit(limit?: number): Promise<LogEntryView[]>` — kind `remote.*` atau `grant.changed`, `ts desc, id desc`
  - `toLogEntryView(row): LogEntryView`, `installEventTap(): () => void`, `__resetEventLog(): void`

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/log-event.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { __emitSessionHooks } from "../src/services/pty";
import { __resetEventLog, appendEvent, installEventTap, recentAudit } from "../src/services/logs/event-log";

const clean = async () => { await prisma.logEntry.deleteMany(); __resetEventLog(); };
beforeEach(clean);
afterAll(clean);
const T = new Date("2026-09-15T01:00:00.000Z");
const waitFor = async (ok: () => Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("appendEvent (SPEC-1215 · ADR-0166 §2–3)", () => {
  it("seq naik ketat walau stempel sama dan dipanggil serentak", async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => appendEvent({ kind: "t", msg: `m${n}`, at: T })));
    const rows = await prisma.logEntry.findMany({ orderBy: { seq: "asc" } });
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.seq > rows[i - 1]!.seq).toBe(true);
    expect(rows[0]!.seq).toBe(BigInt(T.getTime()) * BigInt(1000));
    expect(rows.every((r) => r.deviceId === "local" && r.lane === "event")).toBe(true);
  });

  it("sesudah restart dengan jam mundur, seq tetap di atas baris terakhir", async () => {
    await appendEvent({ kind: "a", msg: "a", at: new Date(T.getTime() + 60_000) });
    __resetEventLog();
    await appendEvent({ kind: "b", msg: "b", at: T });
    const [a, b] = await prisma.logEntry.findMany({ orderBy: { id: "asc" } });
    expect(b!.seq > a!.seq).toBe(true);
  });

  it("msg dipotong 4 KiB, data > 8 KiB diganti penanda, bytes terisi", async () => {
    await appendEvent({ kind: "big", msg: "x".repeat(10_000), data: { blob: "y".repeat(20_000) } });
    const r = await prisma.logEntry.findFirstOrThrow({ where: { kind: "big" } });
    expect(r.msg).toHaveLength(4096);
    expect(r.data).toMatchObject({ truncated: true });
    expect(r.bytes).toBeGreaterThan(4096);
  });

  it("recentAudit hanya remote.* dan grant.changed, terbaru dulu", async () => {
    await appendEvent({ kind: "session.start", msg: "s", at: T });
    await appendEvent({ kind: "remote.request", msg: "r", at: new Date(T.getTime() + 1) });
    await appendEvent({ kind: "grant.changed", msg: "g", at: new Date(T.getTime() + 2) });
    const audit = await recentAudit();
    expect(audit.map((a) => a.kind)).toEqual(["grant.changed", "remote.request"]);
    expect(audit[0]).toMatchObject({ deviceId: "local", lane: "event", hasTranscript: false });
    expect(typeof audit[0]!.seq).toBe("string");
  });
});

describe("installEventTap", () => {
  let off: (() => void) | undefined;
  afterEach(() => { off?.(); off = undefined; });

  it("mencatat session.start & session.end tanpa cwd maupun transkrip", async () => {
    off = installEventTap();
    __emitSessionHooks.birth({
      sessionId: "spec-9", projectId: "p1", specId: "SPEC-9", flow: "feature", kind: "spec",
      agent: "claude", cwd: "/rahasia/path", model: "claude-opus-5",
    });
    __emitSessionHooks.death({ sessionId: "spec-9", exitCode: 1, transcript: "ISI-TRANSKRIP" });
    await waitFor(async () => (await prisma.logEntry.count()) === 2);
    const rows = await prisma.logEntry.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.kind)).toEqual(["session.start", "session.end"]);
    expect(rows[0]).toMatchObject({ projectId: "p1", specId: "SPEC-9", sessionId: "spec-9", level: "info" });
    expect(JSON.stringify(rows)).not.toContain("/rahasia/path");
    expect(JSON.stringify(rows)).not.toContain("ISI-TRANSKRIP");
    expect(rows[1]!.level).toBe("warn");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-event.test.ts`
Expected: FAIL — modul `event-log` tak ada.

- [ ] **Step 3: Implementasi**

Create `server/src/services/logs/event-log.ts`:

```ts
import { hostname } from "node:os";
import { Prisma } from "@prisma/client";
import {
  LOCAL_DEVICE_ID, LOG_DATA_MAX_BYTES, LOG_MSG_MAX_BYTES, nextSeq, splitUtf8, utf8Bytes,
  type LogEntryView, type LogLane, type LogLevel,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { registerSessionHooks } from "../pty";

/* SPEC-1215 · ADR-0166 · lajur `event` instance ini (`deviceId` "local"). Semua event — lahir/tutup
   sesi, audit aksi jarak jauh, perubahan grant — masuk lewat SATU pintu ini, supaya seq HLC hanya
   punya satu penulis. Pengiriman ke hub milik SPEC-1217; di A baris ini sudah menjadi audit lokal
   yang bisa dibaca operator klien di panel Kendali jarak jauh. */

export type EventInput = {
  kind: string; msg: string; level?: LogLevel;
  projectId?: string | null; specId?: string | null; sessionId?: string | null;
  data?: Record<string, unknown> | null; at?: Date;
};

let lastSeq: number | null = null;
// Serial: dua `appendEvent` serentak yang sama-sama membaca `lastSeq` akan menghasilkan seq kembar
// dan P2002 pada unique (deviceId, lane, seq).
let tail: Promise<void> = Promise.resolve();

async function loadLastSeq(): Promise<number> {
  const row = await prisma.logEntry.findFirst({
    where: { deviceId: LOCAL_DEVICE_ID, lane: "event" }, orderBy: { seq: "desc" }, select: { seq: true },
  });
  return row ? Number(row.seq) : 0;
}

function boundedData(data: Record<string, unknown> | null | undefined): { json: Record<string, unknown> | null; bytes: number } {
  if (!data) return { json: null, bytes: 0 };
  const bytes = utf8Bytes(JSON.stringify(data));
  if (bytes <= LOG_DATA_MAX_BYTES) return { json: data, bytes };
  const marker = { truncated: true, bytes };
  return { json: marker, bytes: utf8Bytes(JSON.stringify(marker)) };
}

/** Fire-and-forget yang aman: TAK PERNAH reject. Audit yang gagal ditulis tak boleh menggagalkan
    aksi yang diauditnya, dan kegagalannya tetap terlihat di log server. */
export function appendEvent(e: EventInput): Promise<void> {
  const run = tail.then(async () => {
    lastSeq ??= await loadLastSeq();
    const at = e.at ?? new Date();
    const seq = nextSeq(lastSeq, at.getTime());
    const msg = splitUtf8(e.msg, LOG_MSG_MAX_BYTES)[0] ?? "";
    const data = boundedData(e.data);
    await prisma.logEntry.create({
      data: {
        deviceId: LOCAL_DEVICE_ID, lane: "event", seq: BigInt(seq), ts: at, level: e.level ?? "info",
        kind: e.kind, projectId: e.projectId ?? null, specId: e.specId ?? null, sessionId: e.sessionId ?? null,
        msg, ...(data.json ? { data: data.json as Prisma.InputJsonValue } : {}), bytes: utf8Bytes(msg) + data.bytes,
      },
    });
    lastSeq = seq;
  });
  const settled = run.catch((err: unknown) => {
    lastSeq = null; // muat ulang dari DB: kegagalan bisa berarti seq di memori sudah basi
    console.error(`log event ${e.kind} gagal dicatat:`, err);
  });
  tail = settled;
  return settled;
}

type LogRow = Awaited<ReturnType<typeof prisma.logEntry.findMany>>[number];

export function toLogEntryView(r: LogRow): LogEntryView {
  return {
    id: r.id, deviceId: r.deviceId, deviceName: r.deviceId === LOCAL_DEVICE_ID ? hostname() : r.deviceId,
    lane: r.lane as LogLane, seq: r.seq.toString(), ts: r.ts.toISOString(), receivedAt: r.receivedAt.toISOString(),
    level: r.level as LogLevel, kind: r.kind, projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    msg: r.msg, data: (r.data as Record<string, unknown> | null) ?? null, hasTranscript: !!r.transcriptKey,
  };
}

/** Audit yang ditampilkan ke operator KLIEN: apa yang dilakukan hub di mesinnya (K7 transparansi). */
export async function recentAudit(limit = 50): Promise<LogEntryView[]> {
  const rows = await prisma.logEntry.findMany({
    where: {
      deviceId: LOCAL_DEVICE_ID, lane: "event",
      OR: [{ kind: { startsWith: "remote." } }, { kind: "grant.changed" }],
    },
    orderBy: [{ ts: "desc" }, { id: "desc" }], take: limit,
  });
  return rows.map(toLogEntryView);
}

/** `cwd` dan transkrip SENGAJA tak dicatat: keduanya milik mesin ini (alasan yang sama dengan
    presence, ADR-0148). Transkrip menyeberang hanya lewat lajur `transcript` opt-in (SPEC-1217). */
export function installEventTap(): () => void {
  return registerSessionHooks({
    onBirth: (b) => {
      void appendEvent({
        kind: "session.start", msg: `sesi ${b.sessionId} lahir`,
        projectId: b.projectId, specId: b.specId ?? null, sessionId: b.sessionId,
        data: { kind: b.kind, flow: b.flow ?? null, agent: b.agent, model: b.model ?? null, effort: b.effort ?? null, branch: b.branch ?? null },
      });
    },
    onDeath: (d) => {
      void appendEvent({
        kind: "session.end", level: d.exitCode !== null && d.exitCode !== 0 ? "warn" : "info",
        msg: `sesi ${d.sessionId} ditutup (exit ${d.exitCode ?? "?"})`, sessionId: d.sessionId,
        data: { exitCode: d.exitCode },
      });
    },
  });
}

/** Test-only: lupakan seq di memori (mensimulasikan restart). */
export function __resetEventLog(): void { lastSeq = null; }
```

- [ ] **Step 4: Pasang di boot**

Di `server/src/server.ts`, tambahkan impor sesudah baris 9:

```ts
import { installEventTap } from "./services/logs/event-log";
```

dan tepat sesudah `installSessionHistory();` (baris 106):

```ts
  // SPEC-1215 · ADR-0166 · tap event lokal (lahir/tutup sesi). Hook sesi kini aditif, jadi ia berdiri
  // di samping riwayat sesi, bukan menggantikannya.
  installEventTap();
```

- [ ] **Step 5: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-event.test.ts server/test/session-hooks-additive.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/logs/event-log.ts server/src/server.ts server/test/log-event.test.ts
git commit -m "feat(logs): appendEvent seq HLC + tap lahir/tutup sesi (SPEC-1215)"
```

### Task 7: Registry socket per device + pencabutan seketika (AC-A4, bagian sync)

**Files:**
- Create: `server/src/services/device-sockets.ts`
- Modify: `server/src/routes/device-tokens.ts:25-28`
- Modify: `server/src/routes/sync.ts:143-184` (`/sync/ws`)
- Test: `server/test/device-token-revoke.test.ts` (baru)

**Interfaces:**
- Produces (dipakai Task 10):
  - `type DeviceSocketKind = "sync" | "relay"`
  - `registerDeviceSocket(deviceId: string, kind: DeviceSocketKind, socket: { close(code?: number, reason?: string): void }): () => void`
  - `closeDeviceSockets(deviceId: string, code?: number, reason?: string): number`
  - `deviceSocketCount(deviceId: string, kind?: DeviceSocketKind): number`, `__resetDeviceSockets(): void`

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/device-token-revoke.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { deviceSocketCount } from "../src/services/device-sockets";

const app = buildApp();
let host = "";
const clean = async () => {
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(clean);

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0]!;
async function loginAndDevice() {
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  const user = await prisma.user.findFirstOrThrow();
  return { cookie: cookieOf(setup), device: await issueDeviceToken(user.id, "laptop") };
}
const open = (path: string, token: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(`ws://${host}${path}`, { headers: { authorization: `Bearer ${token}` } });
  ws.once("open", () => resolve(ws));
  ws.once("error", reject);
});
const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
const upgradeStatus = (path: string, token: string) => new Promise<number>((resolve) => {
  const ws = new WebSocket(`ws://${host}${path}`, { headers: { authorization: `Bearer ${token}` } });
  ws.once("unexpected-response", (_req, res) => { resolve(res.statusCode ?? 0); ws.terminate(); });
  ws.once("open", () => { resolve(101); ws.close(); });
  ws.once("error", () => {});
});

describe("pencabutan device token seketika (SPEC-1215 · ADR-0165 §7 · AC-A4)", () => {
  it("socket sync ditutup 1008 sebelum DELETE membalas 204, bukan menunggu revalidasi 60 dtk", async () => {
    const { cookie, device } = await loginAndDevice();
    const sync = await open("/api/sync/ws", device.token);
    await waitFor(() => deviceSocketCount(device.id, "sync") === 1);
    const code = closeCode(sync);
    const started = Date.now();
    const del = await app.inject({ method: "DELETE", url: `/api/device-tokens/${device.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(deviceSocketCount(device.id)).toBe(0);
    expect(await code).toBe(1008);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reconnect memakai token yang sudah dicabut ditolak 401", async () => {
    const { cookie, device } = await loginAndDevice();
    await app.inject({ method: "DELETE", url: `/api/device-tokens/${device.id}`, headers: { cookie } });
    expect(await upgradeStatus("/api/sync/ws", device.token)).toBe(401);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/device-token-revoke.test.ts`
Expected: FAIL — modul `device-sockets` tak ada.

- [ ] **Step 3: Implementasi registry**

Create `server/src/services/device-sockets.ts`:

```ts
/* SPEC-1215 · ADR-0165 §7 · registry MEMORI deviceId → socket sync & relay yang sedang terbuka.
   Tanpanya pencabutan device token hanya menyetel `revokedAt`, dan socket yang sudah terbuka baru mati
   lewat revalidasi 60 dtk (routes/sync.ts) — padahal socket relay adalah jalur RCE ke mesin klien. */

export type DeviceSocketKind = "sync" | "relay";
type Closable = { close(code?: number, reason?: string): void };
type Entry = { kind: DeviceSocketKind; socket: Closable };

const byDevice = new Map<string, Set<Entry>>();

export function registerDeviceSocket(deviceId: string, kind: DeviceSocketKind, socket: Closable): () => void {
  const entry: Entry = { kind, socket };
  let set = byDevice.get(deviceId);
  if (!set) { set = new Set(); byDevice.set(deviceId, set); }
  set.add(entry);
  return () => {
    const current = byDevice.get(deviceId);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) byDevice.delete(deviceId);
  };
}

export function closeDeviceSockets(deviceId: string, code = 1008, reason = "token revoked"): number {
  const set = byDevice.get(deviceId);
  if (!set) return 0;
  byDevice.delete(deviceId);
  for (const { socket } of set) {
    try { socket.close(code, reason); } catch { /* sudah tertutup */ }
  }
  return set.size;
}

export function deviceSocketCount(deviceId: string, kind?: DeviceSocketKind): number {
  let n = 0;
  for (const e of byDevice.get(deviceId) ?? []) if (!kind || e.kind === kind) n++;
  return n;
}

/** Test-only. */
export function __resetDeviceSockets(): void { byDevice.clear(); }
```

- [ ] **Step 4: Pakai di route**

Ganti handler `app.delete("/device-tokens/:id", …)` di `server/src/routes/device-tokens.ts` menjadi (dan tambahkan `import { closeDeviceSockets } from "../services/device-sockets";`):

```ts
  app.delete("/device-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await revokeDeviceToken(id))) return reply.code(404).send({ error: "not found" });
    // SPEC-1215 · ADR-0165 §7 · SESUDAH revokedAt tertulis (reconnect langsung 401) dan SEBELUM 204:
    // socket sync + relay device ini ditutup sekarang, tak menunggu revalidasi 60 dtk.
    closeDeviceSockets(id, 1008, "token revoked");
    return reply.code(204).send();
  });
```

Di `server/src/routes/sync.ts`: tambahkan `import { registerDeviceSocket } from "../services/device-sockets";`. Di handler `/sync/ws`, sesudah `attachSync(client);` tambahkan:

```ts
    // SPEC-1215 · ADR-0165 §7 · supaya DELETE /device-tokens/:id bisa menutupnya seketika.
    const unregisterSocket = registerDeviceSocket(principal.id, "sync", socket);
```

dan ubah baris `socket.on("close", …)` menjadi:

```ts
    socket.on("close", () => {
      clearInterval(revalidate); release(); detachSync(client); dropPresence(principal.id); unregisterSocket();
    });
```

- [ ] **Step 5: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/device-token-revoke.test.ts server/test/device-tokens.route.test.ts server/test/sync-ws-presence.test.ts server/test/sync-ws.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/device-sockets.ts server/src/routes/device-tokens.ts server/src/routes/sync.ts server/test/device-token-revoke.test.ts
git commit -m "feat(sync): cabut device token menutup socket seketika (SPEC-1215 AC-A4)"
```

### Task 8: Gate principal `remote` (AC-A6, AC-A7 lapis gate)

**Files:**
- Create: `server/src/services/relay/secret.ts`
- Create: `server/src/services/relay/gate.ts`
- Modify: `server/src/app.ts` (impor; hook baru sebelum `if (requireAuth) {` baris 156; baris pertama hook gate cookie; `preHandler` sebelum baris 219)
- Test: `server/test/relay-gate.test.ts` (baru)

**Interfaces:**
- Consumes: `getSetting()` (`Setting.remoteControl`, Task 3); `checkAgentCapability` (`server/src/services/agent-capabilities.ts:143`); `relayRouteAllowed`, `relayBodyAllowed`, `remoteCapabilityFor`, `zRelayActor`, `RELAY_*_HEADER`, `grantsCapability` (shared).
- Produces (dipakai Task 9, 10 dan SPEC-1216/1218):
  - `relaySecret(): string`, `isRelaySecret(value: unknown): boolean`, `isInProcessRequest(raw: { socket?: unknown }): boolean`
  - `type RemoteContext = { actor: RelayActor; capabilities: RemoteCapability[]; mode: "read" | "write" }`; `FastifyRequest.remote?: RemoteContext`
  - `encodeRelayActor(a: RelayActor): string`, `decodeRelayActor(v: unknown): RelayActor | null`
  - `admitRemoteRequest(req, readGrant?): Promise<{ ok: true; remote: RemoteContext } | { ok: false; status: 401 | 403; body: { error: string; need?: string } }>`

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/relay-gate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import { Socket, type AddressInfo } from "node:net";
import { RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MODE_HEADER, type RemoteCapability } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { admitRemoteRequest, encodeRelayActor } from "../src/services/relay/gate";
import { relaySecret } from "../src/services/relay/secret";
import { makeProject, makeSetting, makeSpec, resetDb } from "./factory";

const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
const relayHeaders = (over: Record<string, string> = {}) => ({
  [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(actor), ...over,
});
type GateReq = Parameters<typeof admitRemoteRequest>[0];
const fakeReq = (o: { method?: string; url?: string; headers?: Record<string, string>; network?: boolean } = {}) => ({
  method: o.method ?? "GET", url: o.url ?? "/api/terminal/sessions",
  headers: { ...relayHeaders(), ...o.headers },
  raw: { socket: o.network ? new Socket() : undefined },
}) as unknown as GateReq;
const grant = (capabilities: RemoteCapability[], enabled = true) => async () => ({ enabled, capabilities });

describe("admitRemoteRequest — unit (SPEC-1215 · ADR-0165 §3–5)", () => {
  it("socket jaringan dengan rahasia BENAR tetap 401", async () => {
    expect(await admitRemoteRequest(fakeReq({ network: true }), grant(["sessions:read"]))).toMatchObject({ ok: false, status: 401 });
  });
  it("rahasia salah, aktor rusak, atau grant mati → 401", async () => {
    expect(await admitRemoteRequest(fakeReq({ headers: { [RELAY_HEADER]: "salah" } }), grant(["sessions:read"]))).toMatchObject({ status: 401 });
    expect(await admitRemoteRequest(fakeReq({ headers: { [RELAY_ACTOR_HEADER]: "bukan-base64-json" } }), grant(["sessions:read"]))).toMatchObject({ status: 401 });
    expect(await admitRemoteRequest(fakeReq(), grant(["sessions:read"], false))).toMatchObject({ status: 401 });
  });
  it("route di luar allowlist → 403 walau capability-nya ada", async () => {
    const v = await admitRemoteRequest(fakeReq({ method: "PATCH", url: "/api/specs/SPEC-1" }), grant(["sessions:read", "backlog:write"]));
    expect(v).toMatchObject({ ok: false, status: 403, body: { error: "relay route not allowed" } });
  });
  it("capability kurang → 403 need", async () => {
    const v = await admitRemoteRequest(fakeReq({ method: "POST", url: "/api/terminal/sessions/spec-1/steer" }), grant(["sessions:read"]));
    expect(v).toMatchObject({ ok: false, status: 403, body: { need: "sessions:write" } });
  });
  it("WS terminal mode read cukup sessions:read; mode write butuh sessions:write", async () => {
    const url = "/api/terminal/sessions/spec-1/ws";
    expect(await admitRemoteRequest(fakeReq({ url, headers: { [RELAY_MODE_HEADER]: "read" } }), grant(["sessions:read"]))).toMatchObject({ ok: true });
    expect(await admitRemoteRequest(fakeReq({ url }), grant(["sessions:read"]))).toMatchObject({ ok: false, status: 403, body: { need: "sessions:write" } });
  });
  it("lolos: aktor klaim hub + capability grant", async () => {
    const v = await admitRemoteRequest(fakeReq(), grant(["sessions:read", "ide:read"]));
    expect(v).toEqual({ ok: true, remote: { actor, capabilities: ["sessions:read", "ide:read"], mode: "write" } });
  });
});

describe("gate remote di app — jaringan nyata vs in-process", () => {
  const app = buildApp();
  let host = "";
  beforeAll(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await app.close(); await resetDb(); });
  beforeEach(async () => {
    await resetDb();
    await makeSetting({ remoteControl: { enabled: true, capabilities: ["sessions:read", "sessions:spawn", "backlog:write"] } });
  });

  it("HTTP jaringan berheader relay + rahasia benar → 401 (AC-A6)", async () => {
    const res = await fetch(`http://${host}/api/terminal/sessions`, { headers: relayHeaders() });
    expect(res.status).toBe(401);
  });

  it("upgrade WS jaringan berheader relay + rahasia benar → 401 (AC-A6)", async () => {
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${host}/api/events/ws`, { headers: relayHeaders() });
      ws.once("unexpected-response", (_req, res) => { resolve(res.statusCode ?? 0); ws.terminate(); });
      ws.once("open", () => { resolve(101); ws.close(); });
      ws.once("error", () => {});
    });
    expect(status).toBe(401);
  });

  it("in-process + grant + allowlist + capability → handler route berjalan", async () => {
    const res = await app.inject({ method: "GET", url: "/api/terminal/sessions", headers: { host: "127.0.0.1", ...relayHeaders() } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("route di luar allowlist → 403 dan handler TIDAK berjalan (AC-A7)", async () => {
    await makeProject();
    await makeSpec({ title: "asli" });
    const res = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1", payload: { title: "diubah hub" },
      headers: { host: "127.0.0.1", ...relayHeaders() },
    });
    expect(res.statusCode).toBe(403);
    expect((await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } })).title).toBe("asli");
  });

  it("POST /terminal/sessions varian non-spec → 403 di preHandler (keputusan Plan P3)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/terminal/sessions", payload: { project: "p1", shell: true },
      headers: { host: "127.0.0.1", ...relayHeaders() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "relay route not allowed" });
  });

  it("app ber-requireAuth:false tetap menegakkan gate remote (keputusan Plan P4)", async () => {
    const open = buildApp({ requireAuth: false });
    const res = await open.inject({ method: "GET", url: "/api/terminal/sessions", headers: { host: "127.0.0.1", ...relayHeaders({ [RELAY_HEADER]: "salah" }) } });
    expect(res.statusCode).toBe(401);
    await open.close();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-gate.test.ts`
Expected: FAIL — modul `relay/gate` tak ada.

- [ ] **Step 3: Implementasi rahasia & gate**

Create `server/src/services/relay/secret.ts`:

```ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Socket } from "node:net";

/* SPEC-1215 · ADR-0165 §3 · rahasia per PROSES yang menandai request dispatcher relay. Hanya hidup di
   memori: tak pernah ke disk, log, maupun env proses anak — itulah yang membedakannya dari token
   turunan sesi (session-event-token) yang sengaja diwariskan ke pane. */
const SECRET = randomBytes(32).toString("base64url");

export const relaySecret = (): string => SECRET;

export function isRelaySecret(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Terukur di spike S0a: `inject` → `MockSocket`, `injectWS` → `undefined`, jaringan → `net.Socket`
    (TLS turunan `net.Socket`). Rahasia yang bocor tetap tak berguna dari jaringan. */
export function isInProcessRequest(raw: { socket?: unknown }): boolean {
  return !(raw.socket instanceof Socket);
}
```

Create `server/src/services/relay/gate.ts`:

```ts
import type { FastifyRequest } from "fastify";
import {
  RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MODE_HEADER, grantsCapability, relayRouteAllowed, remoteCapabilityFor,
  zRelayActor, type RelayActor, type RemoteCapability, type RemoteControl,
} from "@hanoman/shared";
import { getSetting } from "../settings";
import { checkAgentCapability } from "../agent-capabilities";
import { isInProcessRequest, isRelaySecret } from "./secret";

export type RemoteContext = { actor: RelayActor; capabilities: RemoteCapability[]; mode: "read" | "write" };
declare module "fastify" { interface FastifyRequest { remote?: RemoteContext } }

type Verdict =
  | { ok: true; remote: RemoteContext }
  | { ok: false; status: 401 | 403; body: { error: string; need?: string } };

export const encodeRelayActor = (a: RelayActor): string => Buffer.from(JSON.stringify(a)).toString("base64url");

export function decodeRelayActor(value: unknown): RelayActor | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = zRelayActor.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const UNAUTHORIZED = { ok: false, status: 401, body: { error: "unauthorized" } } as const;

/** Urutan disengaja: bukti in-process dan rahasia DULU (murah, tanpa DB), baru grant (DB), lalu
    allowlist SEBELUM capability — `backlog:write` sah tak boleh membuka `PATCH /specs`. */
export async function admitRemoteRequest(
  req: Pick<FastifyRequest, "headers" | "method" | "url" | "raw">,
  readGrant: () => Promise<RemoteControl> = async () => (await getSetting()).remoteControl,
): Promise<Verdict> {
  if (!isInProcessRequest(req.raw) || !isRelaySecret(req.headers[RELAY_HEADER])) return UNAUTHORIZED;
  const actor = decodeRelayActor(req.headers[RELAY_ACTOR_HEADER]);
  if (!actor) return UNAUTHORIZED;
  const grant = await readGrant();
  if (!grant.enabled) return UNAUTHORIZED;
  if (!relayRouteAllowed(req.method, req.url)) return { ok: false, status: 403, body: { error: "relay route not allowed" } };
  const path = req.url.split("?")[0] ?? req.url;
  const mode = req.headers[RELAY_MODE_HEADER] === "read" ? "read" : "write";
  const override = remoteCapabilityFor(req.method, path, mode);
  if (override) {
    if (!grantsCapability(grant.capabilities, override))
      return { ok: false, status: 403, body: { error: "capability required", need: override } };
  } else {
    const verdict = checkAgentCapability(grant.capabilities, req.method, path);
    if (!verdict.ok) {
      return {
        ok: false, status: 403,
        body: verdict.reason === "cookie-only" ? { error: "cookie session required" } : { error: "capability required", need: verdict.need },
      };
    }
  }
  return { ok: true, remote: { actor, capabilities: grant.capabilities, mode } };
}
```

- [ ] **Step 4: Pasang di `app.ts`**

Tambahkan impor:

```ts
import { RELAY_HEADER, relayBodyAllowed } from "@hanoman/shared";
import { admitRemoteRequest } from "./services/relay/gate";
```

Sisipkan tepat sebelum `if (requireAuth) {` (baris 156):

```ts
    // SPEC-1215 · ADR-0165 §3 · principal `remote`: request yang dijalankan ulang dispatcher relay
    // in-process. Dipasang TANPA syarat requireAuth (keputusan Plan P4) supaya header relay dari
    // jaringan selalu 401 — juga di app test. Gate cookie di bawah melewati `req.remote`.
    api.addHook("onRequest", async (req, reply) => {
      if (req.headers[RELAY_HEADER] === undefined) return;
      const verdict = await admitRemoteRequest(req);
      if (!verdict.ok) return reply.code(verdict.status).send(verdict.body);
      req.remote = verdict.remote;
    });
```

Di awal badan hook gate cookie (baris pertama sesudah `api.addHook("onRequest", async (req, reply) => {` di dalam `if (requireAuth)`), tambahkan:

```ts
        if (req.remote) return; // SPEC-1215 · sudah dinilai gate remote di atas
```

Sisipkan tepat sebelum `api.addHook("preHandler", guardTelegramGatewayRequest);`:

```ts
    // SPEC-1215 · keputusan Plan P3 · body baru ter-parse di sini: `POST /terminal/sessions` lewat relay
    // hanya varian `spec`. Dispatcher sudah memeriksanya sebelum inject; ini lapis kedua.
    api.addHook("preHandler", async (req, reply) => {
      if (req.remote && !relayBodyAllowed(req.method, req.url, req.body))
        return reply.code(403).send({ error: "relay route not allowed" });
    });
```

- [ ] **Step 5: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-gate.test.ts server/test/agent-gate.test.ts server/test/client-gate.test.ts server/test/app.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/relay/secret.ts server/src/services/relay/gate.ts server/src/app.ts server/test/relay-gate.test.ts
git commit -m "feat(relay): gate principal remote — rahasia proses, grant, allowlist (SPEC-1215 AC-A6/A7)"
```

### Task 9: Dispatcher klien — frame `req` → `app.inject` → `res` terpotong + audit (AC-A7 lapis dispatcher, AC-A8)

**Files:**
- Create: `server/src/services/relay/dispatcher.ts`
- Test: `server/test/relay-dispatcher.test.ts` (baru)

**Interfaces:**
- Consumes: `relaySecret` (Task 8), `encodeRelayActor` (Task 8), `appendEvent` (Task 6), `controlHost`/`loadIngressPolicy` (`server/src/services/ingress-policy.ts:20,43`), shared: `zHubToClientFrame`, `relayRouteAllowed`, `relayBodyAllowed`, `splitUtf8`, `utf8Bytes`, `RELAY_*`.
- Produces (dipakai Task 11 dan SPEC-1218):
  - `type InjectResponse = { statusCode: number; headers: Record<string, unknown>; body: string }`
  - `type InjectableApp = { inject(o: { method: string; url: string; headers: Record<string, string>; payload?: string }): Promise<InjectResponse> }`
  - `injectableFrom(app: FastifyInstance): InjectableApp`
  - `type RemoteRequestAudit = { kind: "remote.request"; level: "info" | "warn" | "error"; msg: string; data: Record<string, unknown> }`
  - `createRelayDispatcher(o: { app: InjectableApp; send: (json: string) => void; host?: () => string; audit?: (e: RemoteRequestAudit) => void; now?: () => number }): { onMessage(raw: string): void; cancelAll(): void; inflight(): number }`
  - `type RelayDispatcher = ReturnType<typeof createRelayDispatcher>`

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/relay-dispatcher.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_PART_MAX_BYTES, utf8Bytes } from "@hanoman/shared";
import { buildApp } from "../src/app";
import {
  createRelayDispatcher, injectableFrom, type InjectResponse, type InjectableApp, type RemoteRequestAudit,
} from "../src/services/relay/dispatcher";
import { decodeRelayActor } from "../src/services/relay/gate";
import { isRelaySecret } from "../src/services/relay/secret";
import { makeSetting, resetDb } from "./factory";

type Frame = Record<string, any>;
const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
const req = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "req", id: "r1", method: "GET", path: "/api/terminal/sessions", actor, ...over });
const ok = (body: string, contentType = "application/json; charset=utf-8"): InjectResponse =>
  ({ statusCode: 200, headers: { "content-type": contentType }, body });

function harness(respond: (o: Parameters<InjectableApp["inject"]>[0]) => Promise<InjectResponse>) {
  const calls: Parameters<InjectableApp["inject"]>[0][] = [];
  const sent: Frame[] = [];
  const audits: RemoteRequestAudit[] = [];
  const d = createRelayDispatcher({
    app: { inject: async (o) => { calls.push(o); return respond(o); } },
    send: (json) => sent.push(JSON.parse(json)), host: () => "127.0.0.1", audit: (e) => audits.push(e),
  });
  return { d, calls, sent, audits };
}
const waitFor = async (ok: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 5)); }
};
const assemble = (sent: Frame[], id: string) => {
  const frames = sent.filter((f) => f.t === "res" && f.id === id);
  return { frames, status: frames[0]?.status, contentType: frames[0]?.contentType, body: frames.map((f) => f.part).join(""), ended: frames.at(-1)?.end === true };
};

describe("dispatcher relay — unit (SPEC-1215 · ADR-0165 §2, spec §S4.5)", () => {
  it("req sah → inject route yang sama dengan rahasia + aktor + host; res utuh; audit beraktor", async () => {
    const h = harness(async () => ok("[]"));
    h.d.onMessage(req());
    await waitFor(() => assemble(h.sent, "r1").ended);
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call).toMatchObject({ method: "GET", url: "/api/terminal/sessions" });
    expect(call.headers.host).toBe("127.0.0.1");
    expect(isRelaySecret(call.headers[RELAY_HEADER])).toBe(true);
    expect(decodeRelayActor(call.headers[RELAY_ACTOR_HEADER])).toEqual(actor);
    expect(assemble(h.sent, "r1")).toMatchObject({ status: 200, contentType: "application/json; charset=utf-8", body: "[]" });
    expect(h.audits).toEqual([expect.objectContaining({
      kind: "remote.request", level: "info",
      data: expect.objectContaining({ actor, method: "GET", path: "/api/terminal/sessions", status: 200, ms: expect.any(Number) }),
    })]);
  });

  it("query digabung ke url; body JSON dikirim sebagai payload", async () => {
    const h = harness(async () => ok("{}"));
    h.d.onMessage(req({ id: "q", path: "/api/projects/p1/file", query: "path=README.md" }));
    h.d.onMessage(req({ id: "b", method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "lanjut" } }));
    await waitFor(() => assemble(h.sent, "q").ended && assemble(h.sent, "b").ended);
    expect(h.calls.find((c) => c.url.includes("file"))!.url).toBe("/api/projects/p1/file?path=README.md");
    const post = h.calls.find((c) => c.method === "POST")!;
    expect(post.payload).toBe(JSON.stringify({ text: "lanjut" }));
    expect(post.headers["content-type"]).toBe("application/json");
  });

  it("respons besar dipotong ≤ 32 KiB per part; status hanya di part pertama; tersambung utuh", async () => {
    const big = "é".repeat(60_000);
    const h = harness(async () => ok(big, "text/plain"));
    h.d.onMessage(req());
    await waitFor(() => assemble(h.sent, "r1").ended);
    const a = assemble(h.sent, "r1");
    expect(a.frames.length).toBeGreaterThan(3);
    for (const f of a.frames) expect(utf8Bytes(f.part)).toBeLessThanOrEqual(RELAY_PART_MAX_BYTES);
    expect(a.frames.slice(1).every((f) => f.status === undefined && f.contentType === undefined)).toBe(true);
    expect(a.body).toBe(big);
  });

  it("respons > 1 MiB → 502 relay-response-too-large", async () => {
    const h = harness(async () => ok("x".repeat(1024 * 1024 + 1)));
    h.d.onMessage(req());
    await waitFor(() => assemble(h.sent, "r1").ended);
    expect(assemble(h.sent, "r1")).toMatchObject({ status: 502, body: JSON.stringify({ error: "relay-response-too-large" }) });
  });

  it("di luar allowlist, body non-spec, atau body > 32 KiB → ditolak TANPA inject (AC-A7)", async () => {
    const h = harness(async () => ok("{}"));
    h.d.onMessage(req({ id: "patch", method: "PATCH", path: "/api/specs/SPEC-1", body: { title: "x" } }));
    h.d.onMessage(req({ id: "shell", method: "POST", path: "/api/terminal/sessions", body: { project: "p1", shell: true } }));
    h.d.onMessage(req({ id: "big", method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x".repeat(40_000) } }));
    await waitFor(() => ["patch", "shell", "big"].every((id) => assemble(h.sent, id).ended));
    expect(h.calls).toHaveLength(0);
    expect(assemble(h.sent, "patch").status).toBe(403);
    expect(assemble(h.sent, "shell").status).toBe(403);
    expect(assemble(h.sent, "big").status).toBe(413);
    expect(h.audits.map((a) => a.level)).toEqual(["warn", "warn", "warn"]);
  });

  it("inflight > 4 → 429; sisanya selesai sesudah dilepas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness(async () => { await gate; return ok("[]"); });
    for (const id of ["a", "b", "c", "d", "e"]) h.d.onMessage(req({ id }));
    await waitFor(() => assemble(h.sent, "e").ended);
    expect(assemble(h.sent, "e").status).toBe(429);
    expect(h.d.inflight()).toBe(4);
    release();
    await waitFor(() => ["a", "b", "c", "d"].every((id) => assemble(h.sent, id).ended));
    expect(h.d.inflight()).toBe(0);
  });

  it("cancel → tak ada res untuk id itu, audit tetap tercatat", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness(async () => { await gate; return ok("[]"); });
    h.d.onMessage(req({ id: "c1" }));
    await waitFor(() => h.calls.length === 1);
    h.d.onMessage(JSON.stringify({ t: "cancel", id: "c1" }));
    release();
    await waitFor(() => h.audits.length === 1);
    expect(assemble(h.sent, "c1").frames).toHaveLength(0);
  });

  it("frame rusak dibuang; inject melempar → 502; open (stream, SPEC-1218) → close 4502", async () => {
    const h = harness(async () => { throw new Error("boom"); });
    h.d.onMessage("{bukan json");
    h.d.onMessage(JSON.stringify({ t: "req" }));
    h.d.onMessage(JSON.stringify({ t: "open", sid: "s1", path: "/api/events/ws", mode: "read", actor }));
    h.d.onMessage(req({ id: "x" }));
    await waitFor(() => assemble(h.sent, "x").ended);
    expect(assemble(h.sent, "x").status).toBe(502);
    expect(h.sent.filter((f) => f.t === "close")).toEqual([{ t: "close", sid: "s1", code: 4502, reason: expect.any(String) }]);
  });
});

describe("dispatcher relay + gate app nyata", () => {
  const app = buildApp();
  afterAll(async () => { await app.close(); await resetDb(); });

  it("grant menyala → 200 dari route yang sama; grant mati → 401 dari gate", async () => {
    const run = async (id: string) => {
      const sent: Frame[] = [];
      const d = createRelayDispatcher({ app: injectableFrom(app), send: (j) => sent.push(JSON.parse(j)), host: () => "127.0.0.1", audit: () => {} });
      d.onMessage(req({ id }));
      await waitFor(() => assemble(sent, id).ended);
      return assemble(sent, id);
    };
    await resetDb();
    await makeSetting({ remoteControl: { enabled: true, capabilities: ["sessions:read"] } });
    const on = await run("on");
    expect(on.status).toBe(200);
    expect(Array.isArray(JSON.parse(on.body))).toBe(true);
    await makeSetting({ remoteControl: { enabled: false, capabilities: ["sessions:read"] } });
    expect((await run("off")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.test.ts`
Expected: FAIL — modul `relay/dispatcher` tak ada.

- [ ] **Step 3: Implementasi**

Create `server/src/services/relay/dispatcher.ts`:

```ts
import type { FastifyInstance, InjectOptions } from "fastify";
import {
  RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MAX_INFLIGHT, RELAY_REQUEST_BODY_MAX_BYTES, RELAY_RESPONSE_MAX_BYTES,
  relayBodyAllowed, relayRouteAllowed, splitUtf8, utf8Bytes, zHubToClientFrame, type RelayReqFrame,
} from "@hanoman/shared";
import { controlHost, loadIngressPolicy } from "../ingress-policy";
import { appendEvent } from "../logs/event-log";
import { encodeRelayActor } from "./gate";
import { relaySecret } from "./secret";

/* SPEC-1215 · ADR-0165 §2 · sisi KLIEN: menjalankan ulang request hub lewat route yang SAMA.
   Tak ada handler bisnis di sini — hanya amplop, anggaran, dan audit. "Hasil identik dengan aksi
   lokal" terpenuhi by construction karena `app.inject` melewati gate, preValidation, dan handler
   yang persis sama dengan request dari dashboard lokal. */

export type InjectResponse = { statusCode: number; headers: Record<string, unknown>; body: string };
export type InjectableApp = {
  inject(o: { method: string; url: string; headers: Record<string, string>; payload?: string }): Promise<InjectResponse>;
};
export type RemoteRequestAudit = { kind: "remote.request"; level: "info" | "warn" | "error"; msg: string; data: Record<string, unknown> };

export function injectableFrom(app: FastifyInstance): InjectableApp {
  return {
    async inject(o) {
      const r = await app.inject({
        method: o.method as InjectOptions["method"], url: o.url, headers: o.headers,
        ...(o.payload !== undefined ? { payload: o.payload } : {}),
      });
      return { statusCode: r.statusCode, headers: r.headers as Record<string, unknown>, body: r.body };
    },
  };
}

// `classifyIngress` menjawab 404 untuk host asing (spike S0a), dan `inject` tanpa host = `localhost:80`.
const defaultHost = (): string => controlHost(loadIngressPolicy(process.env)) ?? "127.0.0.1";
const JSON_TYPE = "application/json; charset=utf-8";

export function createRelayDispatcher(o: {
  app: InjectableApp;
  send: (json: string) => void;
  host?: () => string;
  audit?: (e: RemoteRequestAudit) => void;
  now?: () => number;
}) {
  const host = o.host ?? defaultHost;
  const audit = o.audit ?? ((e: RemoteRequestAudit) => { void appendEvent(e); });
  const now = o.now ?? Date.now;
  const inflight = new Map<string, { cancelled: boolean }>();

  const send = (frame: Record<string, unknown>): void => {
    try { o.send(JSON.stringify(frame)); } catch { /* socket tertutup — hub menganggap offline */ }
  };
  const reply = (id: string, status: number, contentType: string, body: string): void => {
    const parts = splitUtf8(body);
    parts.forEach((part, i) => {
      const end = i === parts.length - 1;
      send(i === 0 ? { t: "res", id, status, contentType, part, end } : { t: "res", id, part, end });
    });
  };
  const fail = (id: string, status: number, error: string): void => reply(id, status, JSON_TYPE, JSON.stringify({ error }));

  async function handleReq(f: RelayReqFrame): Promise<void> {
    const started = now();
    const record = (status: number): void => audit({
      kind: "remote.request", level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: `${f.method} ${f.path} → ${status}`,
      data: { actor: f.actor, method: f.method, path: f.path, status, ms: now() - started },
    });
    if (inflight.has(f.id)) return; // id kembar dari hub — frame pertama yang menang
    if (inflight.size >= RELAY_MAX_INFLIGHT) { fail(f.id, 429, "relay-busy"); record(429); return; }
    const payload = f.body === undefined ? undefined : JSON.stringify(f.body);
    if (payload !== undefined && utf8Bytes(payload) > RELAY_REQUEST_BODY_MAX_BYTES) {
      fail(f.id, 413, "relay-body-too-large"); record(413); return;
    }
    const url = f.query ? `${f.path}?${f.query.replace(/^\?/, "")}` : f.path;
    // AC-A7 · diperiksa SEBELUM inject: handler route yang tak diizinkan tak pernah jalan sama sekali.
    // Gate `remote` di app.ts menilai ulang (lapis kedua), jadi dispatcher yang salah tetap tertahan.
    if (!relayRouteAllowed(f.method, url) || !relayBodyAllowed(f.method, f.path, f.body)) {
      fail(f.id, 403, "relay route not allowed"); record(403); return;
    }
    const entry = { cancelled: false };
    inflight.set(f.id, entry);
    try {
      const res = await o.app.inject({
        method: f.method, url,
        headers: {
          host: host(), [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(f.actor),
          ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(payload !== undefined ? { payload } : {}),
      });
      record(res.statusCode);
      if (entry.cancelled) return;
      if (utf8Bytes(res.body) > RELAY_RESPONSE_MAX_BYTES) { fail(f.id, 502, "relay-response-too-large"); return; }
      reply(f.id, res.statusCode, String(res.headers["content-type"] ?? "application/octet-stream"), res.body);
    } catch {
      record(502);
      if (!entry.cancelled) fail(f.id, 502, "relay-dispatch-failed");
    } finally {
      inflight.delete(f.id);
    }
  }

  return {
    onMessage(raw: string): void {
      let parsed: ReturnType<typeof zHubToClientFrame.safeParse>;
      try { parsed = zHubToClientFrame.safeParse(JSON.parse(raw)); } catch { return; }
      if (!parsed.success) return;
      const f = parsed.data;
      if (f.t === "req") { void handleReq(f); return; }
      if (f.t === "cancel") { const e = inflight.get(f.id); if (e) e.cancelled = true; return; }
      // Keputusan Plan P10 · stream milik SPEC-1218. Jawab tutup, jangan diam: hub versi C yang
      // bicara ke klien versi A tak perlu menunggu RELAY_OPEN_TIMEOUT_MS.
      if (f.t === "open") send({ t: "close", sid: f.sid, code: 4502, reason: "stream relay belum didukung klien ini" });
    },
    cancelAll(): void { for (const e of inflight.values()) e.cancelled = true; },
    inflight: (): number => inflight.size,
  };
}
export type RelayDispatcher = ReturnType<typeof createRelayDispatcher>;
```

- [ ] **Step 4: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/relay/dispatcher.ts server/test/relay-dispatcher.test.ts
git commit -m "feat(relay): dispatcher klien req→inject→res terpotong + audit remote.request (SPEC-1215)"
```

### Task 10: Hub — socket `/api/sync/relay/ws`, `hello`, `requestRelay` (AC-A4 relay, AC-A9, AC-A11)

**Files:**
- Create: `server/src/services/relay/hub.ts`
- Modify: `server/src/routes/sync.ts` (ekstrak `requireDeviceWs`; route baru sesudah `/sync/ws`)
- Modify: `server/test/device-token-revoke.test.ts` (tambah kasus relay)
- Test: `server/test/relay-hub.test.ts` (baru, unit), `server/test/relay-hub.route.test.ts` (baru, jaringan)

**Interfaces:**
- Consumes: `registerDeviceSocket` (Task 7), `runningVersion()` (`server/src/services/update.ts:53`), shared: `zClientToHubFrame`, `RELAY_*`, `utf8Bytes`, `type PresenceControlView`, `type RelayActor`, `type RelayMethod`.
- Produces (dipakai Task 13 dan SPEC-1216/1218):
  - `type RelaySocket = { send(data: string): void; close(code?: number, reason?: string): void; readyState: number }`
  - `attachRelaySocket(deviceId: string, socket: RelaySocket): { onMessage(raw: string): void; onClose(): void }`
  - `class RelayError extends Error { kind: "offline" | "protocol-mismatch" | "busy" | "timeout" | "too-large" | "protocol" }`
  - `type RelayResponse = { status: number; contentType: string | null; body: string }`
  - `requestRelay(deviceId: string, r: { method: RelayMethod; path: string; query?: string; body?: unknown; actor: RelayActor }, opts?: { timeoutMs?: number }): Promise<RelayResponse>`
  - `relayControlFor(deviceId: string): PresenceControlView | null`, `__resetRelayHub(): void`

- [ ] **Step 1: Tulis test unit yang gagal**

Create `server/test/relay-hub.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { RELAY_MAX_INFLIGHT } from "@hanoman/shared";
import { __resetDeviceSockets, deviceSocketCount } from "../src/services/device-sockets";
import { __resetRelayHub, attachRelaySocket, relayControlFor, requestRelay } from "../src/services/relay/hub";

type Frame = Record<string, any>;
const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
const fake = () => {
  const sent: Frame[] = []; const closes: [number | undefined, string | undefined][] = [];
  return { sent, closes, socket: { readyState: 1, send: (d: string) => { sent.push(JSON.parse(d)); }, close: (c?: number, r?: string) => { closes.push([c, r]); } } };
};
const hello = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"], ...over });
const ready = () => { const f = fake(); const link = attachRelaySocket("dev1", f.socket); link.onMessage(hello()); return { ...f, link }; };
const lastReq = (sent: Frame[]) => sent.filter((x) => x.t === "req").at(-1)!;

beforeEach(() => { __resetRelayHub(); __resetDeviceSockets(); });

describe("hub relay — registry & hello (SPEC-1215 · ADR-0165 §1, AC-A9)", () => {
  it("hello protokol cocok → welcome + control available + terdaftar di registry socket", () => {
    const { sent } = ready();
    expect(sent[0]).toMatchObject({ t: "welcome", v: 1, protocol: 1 });
    expect(relayControlFor("dev1")).toMatchObject({ state: "available", protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] });
    expect(deviceSocketCount("dev1", "relay")).toBe(1);
  });

  it("hello protokol beda → close 4001 dan control protocol-mismatch", async () => {
    const f = fake();
    const link = attachRelaySocket("dev1", f.socket);
    link.onMessage(hello({ protocol: 2 }));
    expect(f.closes).toEqual([[4001, "protocol mismatch"]]);
    link.onClose();
    expect(relayControlFor("dev1")).toMatchObject({ state: "protocol-mismatch", protocol: 2 });
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "protocol-mismatch" });
  });

  it("socket baru menggantikan yang lama (4000), permintaan lama gagal offline", async () => {
    const first = ready();
    const pending = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    const second = fake();
    attachRelaySocket("dev1", second.socket);
    expect(first.closes).toEqual([[4000, "replaced"]]);
    await expect(pending).rejects.toMatchObject({ kind: "offline" });
    first.link.onClose(); // close event socket lama datang belakangan — tak boleh menghapus yang baru
    expect(deviceSocketCount("dev1", "relay")).toBe(1);
  });

  it("onClose → control null, permintaan tertunda gagal offline", async () => {
    const { link } = ready();
    const pending = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    link.onClose();
    await expect(pending).rejects.toMatchObject({ kind: "offline" });
    expect(relayControlFor("dev1")).toBeNull();
    expect(deviceSocketCount("dev1")).toBe(0);
  });
});

describe("requestRelay", () => {
  it("tanpa socket atau sebelum hello → offline", async () => {
    await expect(requestRelay("nope", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "offline" });
    attachRelaySocket("dev1", fake().socket);
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "offline" });
  });

  it("merakit res bertahap; status & contentType dari part pertama", async () => {
    const { sent, link } = ready();
    const p = requestRelay("dev1", { method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x" }, actor });
    const r = lastReq(sent);
    expect(r).toMatchObject({ method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x" }, actor });
    link.onMessage(JSON.stringify({ t: "res", id: r.id, status: 202, contentType: "application/json", part: '{"ok"', end: false }));
    link.onMessage(JSON.stringify({ t: "res", id: r.id, part: ":true}", end: true }));
    await expect(p).resolves.toEqual({ status: 202, contentType: "application/json", body: '{"ok":true}' });
  });

  it("part pertama tanpa status → protocol", async () => {
    const { sent, link } = ready();
    const p = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    link.onMessage(JSON.stringify({ t: "res", id: lastReq(sent).id, part: "x", end: true }));
    await expect(p).rejects.toMatchObject({ kind: "protocol" });
  });

  it("rakitan > 1 MiB → too-large + cancel", async () => {
    const { sent, link } = ready();
    const p = requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor });
    const id = lastReq(sent).id;
    link.onMessage(JSON.stringify({ t: "res", id, status: 200, part: "x".repeat(32 * 1024), end: false }));
    for (let i = 0; i < 32; i++) link.onMessage(JSON.stringify({ t: "res", id, part: "x".repeat(32 * 1024), end: false }));
    await expect(p).rejects.toMatchObject({ kind: "too-large" });
    expect(sent.some((x) => x.t === "cancel" && x.id === id)).toBe(true);
  });

  it("timeout → timeout + cancel", async () => {
    const { sent } = ready();
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor }, { timeoutMs: 30 })).rejects.toMatchObject({ kind: "timeout" });
    expect(sent.some((x) => x.t === "cancel")).toBe(true);
  });

  it(`lebih dari ${RELAY_MAX_INFLIGHT} inflight → busy; body > 32 KiB → too-large tanpa kirim`, async () => {
    const { sent } = ready();
    for (let i = 0; i < RELAY_MAX_INFLIGHT; i++) void requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor }).catch(() => {});
    await expect(requestRelay("dev1", { method: "GET", path: "/api/terminal/sessions", actor })).rejects.toMatchObject({ kind: "busy" });
    __resetRelayHub();
    const again = ready();
    const before = again.sent.length;
    await expect(requestRelay("dev1", { method: "POST", path: "/api/terminal/sessions/spec-1/steer", body: { text: "x".repeat(40_000) }, actor }))
      .rejects.toMatchObject({ kind: "too-large" });
    expect(again.sent.length).toBe(before);
    expect(sent.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run server/test/relay-hub.test.ts`
Expected: FAIL — modul `relay/hub` tak ada.

- [ ] **Step 3: Implementasi hub**

Create `server/src/services/relay/hub.ts`:

```ts
import {
  RELAY_MAX_INFLIGHT, RELAY_PROTOCOL, RELAY_REASSEMBLY_MAX_BYTES, RELAY_REQUEST_BODY_MAX_BYTES, RELAY_REQ_TIMEOUT_MS,
  utf8Bytes, zClientToHubFrame, type PresenceControlView, type RelayActor, type RelayMethod,
} from "@hanoman/shared";
import { registerDeviceSocket } from "../device-sockets";
import { runningVersion } from "../update";

/* SPEC-1215 · ADR-0165 · sisi HUB: satu socket relay per device, keadaan di MEMORI (prinsip ADR-0148).
   Restart hub = peta kosong; klien menyambung ulang lewat backoff-nya. Route HTTP yang memakai
   `requestRelay` lahir di SPEC-1216 — di turunan A ia diekspor dan dibuktikan lewat test. */

export type RelaySocket = { send(data: string): void; close(code?: number, reason?: string): void; readyState: number };
export type RelayResponse = { status: number; contentType: string | null; body: string };
type RelayErrorKind = "offline" | "protocol-mismatch" | "busy" | "timeout" | "too-large" | "protocol";
export class RelayError extends Error {
  constructor(readonly kind: RelayErrorKind, message: string = kind) { super(message); }
}

type Pending = {
  resolve: (r: RelayResponse) => void; reject: (e: RelayError) => void; timer: NodeJS.Timeout;
  status?: number; contentType: string | null; chunks: string[]; bytes: number;
};
type Link = { socket: RelaySocket; control: PresenceControlView | null; pending: Map<string, Pending>; unregister: () => void };

const links = new Map<string, Link>();
// Bertahan sesudah socket 4001 ditutup: operator hub harus MELIHAT "versi tak cocok", bukan "offline".
const mismatches = new Map<string, PresenceControlView>();
let counter = 0;

function settle(link: Link, id: string, outcome: RelayResponse | RelayError): void {
  const p = link.pending.get(id);
  if (!p) return;
  link.pending.delete(id);
  clearTimeout(p.timer);
  if (outcome instanceof RelayError) p.reject(outcome); else p.resolve(outcome);
}
function failAll(link: Link, kind: RelayErrorKind): void {
  for (const id of [...link.pending.keys()]) settle(link, id, new RelayError(kind));
}
function sendCancel(link: Link, id: string): void {
  try { link.socket.send(JSON.stringify({ t: "cancel", id })); } catch { /* socket tertutup */ }
}

export function attachRelaySocket(deviceId: string, socket: RelaySocket): { onMessage(raw: string): void; onClose(): void } {
  const previous = links.get(deviceId);
  if (previous) {
    links.delete(deviceId);
    previous.unregister();
    failAll(previous, "offline");
    try { previous.socket.close(4000, "replaced"); } catch { /* sudah tertutup */ }
  }
  const link: Link = { socket, control: null, pending: new Map(), unregister: registerDeviceSocket(deviceId, "relay", socket) };
  links.set(deviceId, link);

  return {
    onMessage(raw: string): void {
      let parsed: ReturnType<typeof zClientToHubFrame.safeParse>;
      try { parsed = zClientToHubFrame.safeParse(JSON.parse(raw)); } catch { return; }
      if (!parsed.success) return;
      const f = parsed.data;
      if (f.t === "hello") {
        const control: PresenceControlView = {
          state: "available", protocol: f.protocol, version: f.version, capabilities: f.capabilities, since: new Date().toISOString(),
        };
        if (f.protocol !== RELAY_PROTOCOL) {
          mismatches.set(deviceId, { ...control, state: "protocol-mismatch" });
          socket.close(4001, "protocol mismatch");
          return;
        }
        mismatches.delete(deviceId);
        link.control = control;
        try { socket.send(JSON.stringify({ t: "welcome", v: 1, protocol: RELAY_PROTOCOL, version: runningVersion() })); } catch { /* noop */ }
        return;
      }
      if (f.t === "res") {
        const p = link.pending.get(f.id);
        if (!p) return;
        if (p.status === undefined) {
          if (f.status === undefined) { settle(link, f.id, new RelayError("protocol", "part pertama tanpa status")); return; }
          p.status = f.status;
          p.contentType = f.contentType ?? null;
        }
        p.bytes += utf8Bytes(f.part);
        if (p.bytes > RELAY_REASSEMBLY_MAX_BYTES) { sendCancel(link, f.id); settle(link, f.id, new RelayError("too-large")); return; }
        p.chunks.push(f.part);
        if (f.end) settle(link, f.id, { status: p.status, contentType: p.contentType, body: p.chunks.join("") });
      }
      // opened/geometry/data/close = stream, milik SPEC-1218.
    },
    onClose(): void {
      // Close event socket LAMA bisa tiba sesudah penggantinya terpasang — jangan hapus yang baru.
      if (links.get(deviceId) === link) links.delete(deviceId);
      link.unregister();
      failAll(link, "offline");
    },
  };
}

export function requestRelay(
  deviceId: string,
  r: { method: RelayMethod; path: string; query?: string; body?: unknown; actor: RelayActor },
  opts: { timeoutMs?: number } = {},
): Promise<RelayResponse> {
  const link = links.get(deviceId);
  if (!link || link.socket.readyState !== 1 || !link.control)
    return Promise.reject(new RelayError(mismatches.has(deviceId) ? "protocol-mismatch" : "offline"));
  if (link.pending.size >= RELAY_MAX_INFLIGHT) return Promise.reject(new RelayError("busy"));
  if (r.body !== undefined && utf8Bytes(JSON.stringify(r.body)) > RELAY_REQUEST_BODY_MAX_BYTES)
    return Promise.reject(new RelayError("too-large"));
  const id = `r${++counter}`;
  return new Promise<RelayResponse>((resolve, reject) => {
    const timer = setTimeout(() => { sendCancel(link, id); settle(link, id, new RelayError("timeout")); }, opts.timeoutMs ?? RELAY_REQ_TIMEOUT_MS);
    timer.unref?.();
    link.pending.set(id, { resolve, reject, timer, contentType: null, chunks: [], bytes: 0 });
    try {
      link.socket.send(JSON.stringify({
        t: "req", id, method: r.method, path: r.path,
        ...(r.query ? { query: r.query } : {}), ...(r.body !== undefined ? { body: r.body } : {}), actor: r.actor,
      }));
    } catch { settle(link, id, new RelayError("offline")); }
  });
}

export function relayControlFor(deviceId: string): PresenceControlView | null {
  return links.get(deviceId)?.control ?? mismatches.get(deviceId) ?? null;
}

/** Test-only. */
export function __resetRelayHub(): void {
  for (const link of links.values()) { link.unregister(); failAll(link, "offline"); }
  links.clear();
  mismatches.clear();
}
```

- [ ] **Step 4: Jalankan test unit**

Run: `pnpm vitest --run server/test/relay-hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Tulis test route yang gagal**

Create `server/test/relay-hub.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { PRESENCE_PROTOCOL } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetPresence, presenceEntries } from "../src/services/presence/registry";
import { __resetRelayHub, relayControlFor } from "../src/services/relay/hub";

const app = buildApp({ requireAuth: false });
let host = "";
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetRelayHub(); __resetPresence(); await clean(); });

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
async function device() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}
const open = (path: string, token: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(`ws://${host}${path}`, { headers: { authorization: `Bearer ${token}` } });
  ws.once("open", () => resolve(ws));
  ws.once("error", reject);
});
const nextMessage = (ws: WebSocket) => new Promise<any>((resolve) => ws.once("message", (raw) => resolve(JSON.parse(String(raw)))));
const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
const hello = (protocol = 1) => JSON.stringify({ t: "hello", v: 1, protocol, version: "0.5.0", capabilities: ["sessions:read"] });
const presence = JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions: [] });

describe("GET /api/sync/relay/ws (SPEC-1215 · ADR-0165 §1)", () => {
  it("query token → 401; tanpa Bearer → 401", async () => {
    const status = (url: string, headers: Record<string, string> = {}) => new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.once("unexpected-response", (_r, res) => { resolve(res.statusCode ?? 0); ws.terminate(); });
      ws.once("open", () => { resolve(101); ws.close(); });
      ws.once("error", () => {});
    });
    expect(await status(`ws://${host}/api/sync/relay/ws?token=abc`)).toBe(401);
    expect(await status(`ws://${host}/api/sync/relay/ws`)).toBe(401);
  });

  it("hello → welcome dan control available beratribusi device dari TOKEN", async () => {
    const t = await device();
    const relay = await open("/api/sync/relay/ws", t.token);
    const welcome = nextMessage(relay);
    relay.send(hello());
    expect(await welcome).toMatchObject({ t: "welcome", protocol: 1 });
    await waitFor(() => relayControlFor(t.id)?.state === "available");
    relay.close();
    await waitFor(() => relayControlFor(t.id) === null);
  });

  it("relay kedua menggantikan yang pertama dengan 4000", async () => {
    const t = await device();
    const first = await open("/api/sync/relay/ws", t.token);
    const code = closeCode(first);
    const second = await open("/api/sync/relay/ws", t.token);
    expect(await code).toBe(4000);
    second.close();
  });

  it("protokol beda → relay 4001, socket sync device yang sama TETAP hidup (AC-A9, AC-A11)", async () => {
    const t = await device();
    const sync = await open("/api/sync/ws", t.token);
    const relay = await open("/api/sync/relay/ws", t.token);
    const code = closeCode(relay);
    relay.send(hello(2));
    expect(await code).toBe(4001);
    expect(relayControlFor(t.id)?.state).toBe("protocol-mismatch");
    sync.send(presence);
    await waitFor(() => presenceEntries().some((e) => e.deviceId === t.id));
    expect(sync.readyState).toBe(WebSocket.OPEN);
    sync.close();
  });

  it("frame relay > 64 KiB → relay 1009, socket sync tetap hidup (AC-A11)", async () => {
    const t = await device();
    const sync = await open("/api/sync/ws", t.token);
    const relay = await open("/api/sync/relay/ws", t.token);
    const code = closeCode(relay);
    relay.send("x".repeat(70 * 1024));
    expect(await code).toBe(1009);
    await new Promise((r) => setTimeout(r, 100));
    expect(sync.readyState).toBe(WebSocket.OPEN);
    sync.close();
  });
});
```

- [ ] **Step 6: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-hub.route.test.ts`
Expected: FAIL — upgrade `/api/sync/relay/ws` 404.

- [ ] **Step 7: Route di `sync.ts`**

Di `server/src/routes/sync.ts`: tambahkan impor

```ts
import { RELAY_MAX_FRAMES_PER_MIN } from "@hanoman/shared";
import { attachRelaySocket } from "../services/relay/hub";
```

(gabungkan `RELAY_MAX_FRAMES_PER_MIN` ke impor `@hanoman/shared` yang sudah ada). Di atas `export default async function`, tambahkan:

```ts
// Kanal server-to-server memakai Authorization header. Credential query sengaja ditolak agar
// token tidak masuk access log, history, atau telemetry proxy. Dipakai /sync/ws DAN /sync/relay/ws.
// Hook async yang mengirim balasan WAJIB `return reply` (konvensi Fastify), persis bentuk lama.
async function requireDeviceWs(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if ((req.query as { token?: string }).token) return reply.code(401).send({ error: "query token rejected" });
  const token = bearerToken(req);
  const dev = token ? await verifyDeviceToken(token) : null;
  if (!dev) return reply.code(401).send({ error: "unauthorized" });
  req.wsPrincipal = { kind: "device", id: dev.id };
}
```

Ganti opsi `/sync/ws` (`preValidation: async (req, reply) => { … }`) dengan `preValidation: requireDeviceWs` (hapus komentar lama yang kini pindah ke atas fungsi). Lalu sesudah handler `/sync/ws` selesai, tambahkan:

```ts
  // SPEC-1215 · ADR-0165 §1 · socket KEDUA per device, dibuka klien HANYA bila grant lokalnya menyala.
  // Beda sadar dari /sync/ws: socket ini TIDAK mengangkut changefeed, jadi pelanggar guard DITUTUP
  // (1008/1009) — kegagalannya tak pernah menyentuh socket sync karena socket-nya memang terpisah.
  app.get("/sync/relay/ws", { websocket: true, preValidation: requireDeviceWs }, async (socket, req) => {
    const principal = req.wsPrincipal!;
    let release: () => void;
    try { release = openWsConnection(principal); }
    catch { socket.close(1008, "connection limit"); return; }
    const link = attachRelaySocket(principal.id, socket);
    const guard = new WsMessageGuard({ perWindow: RELAY_MAX_FRAMES_PER_MIN });
    socket.on("message", (raw: Buffer) => {
      const verdict = guard.accept(raw);
      if (!verdict.ok) { socket.close(verdict.code, verdict.reason); return; }
      link.onMessage(raw.toString("utf8"));
    });
    const revalidate = setInterval(() => {
      void revalidateWsPrincipal(req, principal).then((ok) => { if (!ok) socket.close(1008, "token revoked"); });
    }, 60_000);
    revalidate.unref?.();
    socket.on("close", () => { clearInterval(revalidate); release(); link.onClose(); });
  });
```

- [ ] **Step 8: Tambah kasus relay di test pencabutan**

Di `server/test/device-token-revoke.test.ts`, tambahkan di dalam `describe`:

```ts
  it("socket relay ikut ditutup 1008 sebelum 204 (AC-A4)", async () => {
    const { cookie, device } = await loginAndDevice();
    const sync = await open("/api/sync/ws", device.token);
    const relay = await open("/api/sync/relay/ws", device.token);
    relay.send(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] }));
    await waitFor(() => deviceSocketCount(device.id, "relay") === 1 && deviceSocketCount(device.id, "sync") === 1);
    const codes = Promise.all([closeCode(sync), closeCode(relay)]);
    const del = await app.inject({ method: "DELETE", url: `/api/device-tokens/${device.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(deviceSocketCount(device.id)).toBe(0);
    expect(await codes).toEqual([1008, 1008]);
    expect(await upgradeStatus("/api/sync/relay/ws", device.token)).toBe(401);
  });
```

- [ ] **Step 9: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-hub.test.ts server/test/relay-hub.route.test.ts server/test/device-token-revoke.test.ts server/test/sync-ws-presence.test.ts server/test/sync-ws.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/relay/hub.ts server/src/routes/sync.ts server/test/relay-hub.test.ts server/test/relay-hub.route.test.ts server/test/device-token-revoke.test.ts
git commit -m "feat(relay): hub /api/sync/relay/ws + requestRelay, gagal relay tak menyentuh sync (SPEC-1215)"
```

### Task 11: Tautan relay klien — grant → connect → hello → backoff/unsupported (AC-A1, AC-A2 dasar, AC-A8 e2e, AC-A12, AC-M1, AC-M2)

**Files:**
- Create: `server/src/services/backoff.ts`
- Create: `server/src/services/relay/client.ts`
- Modify: `server/src/services/sync-client.ts:423-432` (pindah helper backoff), `:466-468` (`startSyncClient`), `:515-523` (`stopSyncClient`)
- Modify: `server/src/server.ts` (sesudah `startSessionEventRelay(app);` baris 42)
- Test: `server/test/relay-client.test.ts` (baru)

**Interfaces:**
- Consumes: `createRelayDispatcher`, `injectableFrom`, `type InjectableApp` (Task 9); `getSetting()` (Task 3); `appendEvent` (Task 6); `runningVersion()`; `attachRelaySocket`/`requestRelay`/`relayControlFor` (Task 10, di test).
- Produces (dipakai Task 12 dan SPEC-1216/1218):
  - `installRelayClient(app: InjectableApp): void`
  - `startRelayClient(base: string, token: string): void` — sinkron, tak pernah memblokir
  - `stopRelayClient(): void`
  - `refreshRelayClient(): Promise<void>` — menutup socket relay (4003) SEBELUM resolve, lalu membuka ulang bila grant menyala
  - `relayClientStatus(): RelayLinkStatus`
  - test-only: `__relayClientLastDelayMs(): number | null`, `__resetRelayClient(): void`
  - `server/src/services/backoff.ts`: `RECONNECT_MIN_MS`, `RECONNECT_MAX_MS`, `nextBackoff(prev)`, `withJitter(ms, rnd?)` (tetap di-re-export `sync-client.ts`)

- [ ] **Step 1: Tulis test yang gagal**

Create `server/test/relay-client.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RELAY_UNSUPPORTED_RETRY_MS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import {
  __relayClientLastDelayMs, __resetRelayClient, installRelayClient, relayClientStatus, startRelayClient,
} from "../src/services/relay/client";
import { injectableFrom } from "../src/services/relay/dispatcher";
import { __resetRelayHub, relayControlFor, requestRelay } from "../src/services/relay/hub";
import { startSyncClient, stopSyncClient } from "../src/services/sync-client";
import { makeSetting } from "./factory";

const hub = buildApp({ requireAuth: false });
const client = buildApp();
let hubBase = "";
let counting: Server;
let countingBase = "";
let upgrades = 0;
const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };

const clean = async () => {
  await prisma.logEntry.deleteMany(); await prisma.deviceToken.deleteMany();
  await prisma.user.deleteMany(); await prisma.setting.deleteMany();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (ok: () => boolean | Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > deadline) throw new Error("timeout"); await sleep(20); }
};
async function device() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}
const grant = (enabled: boolean) => makeSetting({ remoteControl: { enabled, capabilities: ["sessions:read"] } });

beforeAll(async () => {
  await hub.listen({ port: 0, host: "127.0.0.1" });
  hubBase = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
  // Hub versi lama: route relay tak ada → upgrade dijawab 404.
  counting = createServer((_req, res) => { res.statusCode = 404; res.end(); });
  counting.on("upgrade", (_req, socket) => {
    upgrades++;
    socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((r) => counting.listen(0, "127.0.0.1", () => r()));
  countingBase = `http://127.0.0.1:${(counting.address() as AddressInfo).port}`;
});
afterAll(async () => {
  __resetRelayClient(); stopSyncClient();
  await hub.close(); await client.close();
  await new Promise<void>((r) => counting.close(() => r()));
  await clean();
});
beforeEach(async () => { stopSyncClient(); __resetRelayClient(); __resetRelayHub(); upgrades = 0; await clean(); });

describe("tautan relay klien (SPEC-1215 · ADR-0165 §1)", () => {
  it("instance tanpa app terpasang tak pernah membuka relay (AC-M1)", async () => {
    await grant(true);
    startRelayClient(countingBase, "tok");
    await sleep(300);
    expect(upgrades).toBe(0);
    expect(relayClientStatus().state).toBe("off");
  });

  it("grant mati = NOL upgrade ke hub (AC-A1)", async () => {
    installRelayClient(injectableFrom(client));
    await grant(false);
    startRelayClient(countingBase, "tok");
    await sleep(300);
    expect(upgrades).toBe(0);
    expect(relayClientStatus().state).toBe("off");
  });

  it("upgrade 404 → unsupported, tak mengetuk lagi sebelum 30 mnt (AC-A12)", async () => {
    installRelayClient(injectableFrom(client));
    await grant(true);
    startRelayClient(countingBase, "tok");
    await waitFor(() => relayClientStatus().state === "unsupported");
    await sleep(1_500); // backoff normal akan mengetuk lagi dalam ≤ 1,2 dtk
    expect(upgrades).toBe(1);
    expect(__relayClientLastDelayMs()).toBe(RELAY_UNSUPPORTED_RETRY_MS);
    expect(relayClientStatus().lastClose?.code).toBe(404);
  });

  it("grant menyala → hello ≤ 5 dtk, requestRelay ujung-ke-ujung, audit beraktor (AC-A2, AC-A8)", async () => {
    const t = await device();
    installRelayClient(injectableFrom(client));
    await grant(true);
    const t0 = Date.now();
    startRelayClient(hubBase, t.token);
    await waitFor(() => relayControlFor(t.id)?.state === "available", 5_000);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(relayClientStatus()).toMatchObject({ state: "open", hubOrigin: hubBase });
    const res = await requestRelay(t.id, { method: "GET", path: "/api/terminal/sessions", actor });
    expect(res.status).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    await waitFor(async () => !!(await prisma.logEntry.findFirst({ where: { kind: "remote.request" } })));
    const audit = await prisma.logEntry.findFirstOrThrow({ where: { kind: "remote.request" } });
    expect(audit.data).toMatchObject({ actor, method: "GET", path: "/api/terminal/sessions", status: 200 });
    await waitFor(async () => !!(await prisma.logEntry.findFirst({ where: { kind: "remote.link" } })));
  });

  it("hub tak terjangkau: start tak memblokir, lalu backoff (AC-M2)", async () => {
    installRelayClient(injectableFrom(client));
    await grant(true);
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", () => r()));
    const port = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));
    const t0 = Date.now();
    startRelayClient(`http://127.0.0.1:${port}`, "tok");
    expect(Date.now() - t0).toBeLessThan(50);
    await waitFor(() => relayClientStatus().state === "backoff");
    expect(__relayClientLastDelayMs()!).toBeLessThanOrEqual(1_200);
  });

  it("token ditolak hub → rejected (401) lalu backoff biasa", async () => {
    installRelayClient(injectableFrom(client));
    await grant(true);
    startRelayClient(hubBase, "token-palsu");
    await waitFor(() => relayClientStatus().state === "rejected");
    expect(relayClientStatus().lastClose?.code).toBe(401);
    expect(__relayClientLastDelayMs()!).toBeLessThanOrEqual(1_200);
  });

  it("startSyncClient membuka relay; stopSyncClient menutupnya", async () => {
    const t = await device();
    installRelayClient(injectableFrom(client));
    await grant(true);
    await startSyncClient(hubBase, t.token, 60_000);
    await waitFor(() => relayControlFor(t.id)?.state === "available");
    stopSyncClient();
    expect(relayClientStatus().state).toBe("off");
    await waitFor(() => relayControlFor(t.id) === null);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-client.test.ts`
Expected: FAIL — modul `relay/client` tak ada.

- [ ] **Step 3: Pindahkan helper backoff**

Create `server/src/services/backoff.ts`:

```ts
/* SPEC-919 · ADR-0147 · reconnect dulu `setTimeout(…, 3000)` datar: terhadap hub yang mati ia
   mengetuk 20×/menit selamanya. Dipindah dari sync-client.ts (SPEC-1215, keputusan Plan P9) supaya
   tautan relay memakai rumus yang SAMA tanpa impor siklik relay/client ↔ sync-client. */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const nextBackoff = (prev: number): number =>
  prev <= 0 ? RECONNECT_MIN_MS : Math.min(RECONNECT_MAX_MS, prev * 2);
export const withJitter = (ms: number, rnd: () => number = Math.random): number =>
  Math.round(ms * (0.8 + rnd() * 0.4));
```

Di `server/src/services/sync-client.ts`, hapus blok baris 423-432 (komentar `/* SPEC-919 · ADR-0147 · reconnect dulu …*/` sampai definisi `withJitter`) dan ganti dengan:

```ts
import { RECONNECT_MAX_MS, RECONNECT_MIN_MS, nextBackoff, withJitter } from "./backoff";
import { startRelayClient, stopRelayClient } from "./relay/client";
// Diekspor ulang: test & pemanggil lama mengimpornya dari modul ini.
export { RECONNECT_MAX_MS, RECONNECT_MIN_MS, nextBackoff, withJitter };
```

(pindahkan dua baris `import` itu ke blok impor di atas berkas bila linter/TS mengeluh impor di tengah modul).

- [ ] **Step 4: Implementasi tautan relay**

Create `server/src/services/relay/client.ts`:

```ts
import type { IncomingMessage } from "node:http";
import type { WebSocket as WsSocket } from "ws";
import { RELAY_PROTOCOL, RELAY_UNSUPPORTED_RETRY_MS, type RelayLinkState, type RelayLinkStatus, type RemoteControl } from "@hanoman/shared";
import { nextBackoff, withJitter } from "../backoff";
import { appendEvent } from "../logs/event-log";
import { getSetting } from "../settings";
import { runningVersion } from "../update";
import { createRelayDispatcher, type InjectableApp, type RelayDispatcher } from "./dispatcher";

/* SPEC-1215 · ADR-0165 §1/§7 · sisi KLIEN: socket relay KEDUA ke hub. Dibuka HANYA bila grant lokal
   menyala — tanpa grant tak ada jalur perintah sama sekali, bukan handler yang menolak. Semua di sini
   fire-and-forget di belakang backoff: hub mati tak pernah memblokir peluncuran, terminal, maupun
   sync lokal (K11). `generation` membatalkan callback socket lama sesudah stop/refresh/restart. */

let app: InjectableApp | null = null;
let target: { base: string; token: string } | null = null;
let sock: WsSocket | undefined;
let dispatcher: RelayDispatcher | undefined;
let timer: NodeJS.Timeout | undefined;
let delay = 0;
let lastDelayMs: number | null = null;
let generation = 0;
let lastLinkLogged: RelayLinkState | null = null;
const OFF: RelayLinkStatus = { state: "off", since: null, hubOrigin: null, lastClose: null };
let status: RelayLinkStatus = { ...OFF };

export function installRelayClient(a: InjectableApp): void { app = a; }
export function relayClientStatus(): RelayLinkStatus { return { ...status }; }

function setState(state: RelayLinkState, patch: Partial<Pick<RelayLinkStatus, "hubOrigin" | "lastClose">> = {}): void {
  const prev = status.state;
  status = { ...status, ...patch, state, since: prev === state ? status.since : new Date().toISOString() };
  // Dicatat hanya saat keadaan BERMAKNA berganti (pola ADR-0131 §3): `connecting`/`backoff` antar
  // ketukan adalah langkah antara, dan hub yang terus menolak tak boleh melahirkan satu baris per ketukan.
  const meaningful = state === "open" || state === "unsupported" || state === "rejected"
    || (state === "backoff" && prev === "open") || (state === "off" && lastLinkLogged !== null && lastLinkLogged !== "off");
  if (prev === state || !meaningful || state === lastLinkLogged) return;
  lastLinkLogged = state;
  void appendEvent({
    kind: "remote.link", level: state === "open" || state === "off" ? "info" : "warn",
    msg: `relay ${prev} → ${state}`,
    data: { state, hubOrigin: status.hubOrigin, code: status.lastClose?.code ?? null },
  });
}

function schedule(gen: number, ms: number): void {
  if (timer) clearTimeout(timer);
  lastDelayMs = ms;
  timer = setTimeout(() => { timer = undefined; void connect(gen); }, ms);
  timer.unref?.();
}
function scheduleBackoff(gen: number): void { delay = nextBackoff(delay); schedule(gen, withJitter(delay)); }

function dropSocket(code: number, reason: string): void {
  const s = sock;
  sock = undefined;
  dispatcher?.cancelAll();
  dispatcher = undefined;
  if (!s) return;
  try { if (s.readyState === 0) s.terminate(); else s.close(code, reason); } catch { /* sudah tertutup */ }
}

const originOf = (base: string): string | null => { try { return new URL(base).origin; } catch { return null; } };

async function connect(gen: number): Promise<void> {
  if (gen !== generation || !app || !target) return;
  let grant: RemoteControl;
  try { grant = (await getSetting()).remoteControl; } catch { grant = { enabled: false, capabilities: [] }; }
  if (gen !== generation || !app || !target) return;
  // AC-A1 · grant mati = socket TAK PERNAH dibuka: "default mati" terbaca dari topologi.
  if (!grant.enabled) { setState("off"); return; }
  const { WebSocket } = await import("ws");
  if (gen !== generation || !app || !target) return;
  const url = `${target.base.replace(/^http/, "ws").replace(/\/$/, "")}/api/sync/relay/ws`;
  setState("connecting");
  const s = new WebSocket(url, { headers: { authorization: `Bearer ${target.token}` } });
  const d = createRelayDispatcher({ app, send: (json) => { if (s.readyState === 1) s.send(json); } });
  sock = s;
  dispatcher = d;
  let settled = false;

  s.on("unexpected-response", (_req, res: IncomingMessage) => {
    settled = true;
    const code = res.statusCode ?? 0;
    res.resume();
    try { s.terminate(); } catch { /* noop */ }
    if (gen !== generation) return;
    if (sock === s) { sock = undefined; dispatcher = undefined; }
    if (code === 404) {
      // AC-A12 · hub versi lama. Mengetuk tiap detik selamanya hanya membebani kedua sisi.
      setState("unsupported", { lastClose: { code, reason: "hub tak mendukung relay" } });
      schedule(gen, RELAY_UNSUPPORTED_RETRY_MS);
      return;
    }
    setState("rejected", { lastClose: { code, reason: "upgrade relay ditolak hub" } });
    scheduleBackoff(gen);
  });
  s.on("open", () => {
    if (gen !== generation) return;
    delay = 0;
    setState("open", { lastClose: null });
    s.send(JSON.stringify({ t: "hello", v: 1, protocol: RELAY_PROTOCOL, version: runningVersion(), capabilities: grant.capabilities }));
  });
  s.on("message", (raw: Buffer) => { if (gen === generation) d.onMessage(raw.toString("utf8")); });
  s.on("close", (code: number, reason: Buffer) => {
    d.cancelAll();
    if (settled || gen !== generation) return;
    if (sock === s) { sock = undefined; dispatcher = undefined; }
    const lastClose = { code, reason: reason.toString("utf8") };
    if (code === 4001) {
      // Protokol beda: menyambung ulang tiap detik tak akan pernah cocok sampai salah satu sisi upgrade.
      setState("rejected", { lastClose });
      schedule(gen, RELAY_UNSUPPORTED_RETRY_MS);
      return;
    }
    setState("backoff", { lastClose });
    scheduleBackoff(gen);
  });
  s.on("error", () => { /* 'close' atau 'unexpected-response' menyusul */ });
}

/** Sinkron dan tak pernah memblokir pemanggil (AC-M2). */
export function startRelayClient(base: string, token: string): void {
  const gen = ++generation;
  if (timer) { clearTimeout(timer); timer = undefined; }
  dropSocket(1001, "restart");
  target = { base, token };
  delay = 0;
  status = { ...status, hubOrigin: originOf(base) };
  void connect(gen);
}

export function stopRelayClient(): void {
  generation++;
  if (timer) { clearTimeout(timer); timer = undefined; }
  target = null;
  dropSocket(1001, "shutdown");
  setState("off", { hubOrigin: null, lastClose: null });
}

/** AC-A5 · grant berubah: socket relay (dan setiap permintaan yang sedang dijalankan dispatcher)
    ditutup SEBELUM promise ini resolve — `PUT /remote-control` membalas sesudahnya. Dibuka ulang
    dengan `hello` baru bila grant masih menyala. */
export async function refreshRelayClient(): Promise<void> {
  const gen = ++generation;
  if (timer) { clearTimeout(timer); timer = undefined; }
  dropSocket(4003, "grant changed");
  delay = 0;
  setState("off", { lastClose: null });
  if (target) void connect(gen);
}

/** Test-only. */
export function __relayClientLastDelayMs(): number | null { return lastDelayMs; }
/** Test-only. */
export function __resetRelayClient(): void {
  stopRelayClient();
  app = null;
  lastDelayMs = null;
  lastLinkLogged = null;
  status = { ...OFF };
}
```

- [ ] **Step 5: Kaitkan ke sync client & boot**

Di `server/src/services/sync-client.ts`, di `startSyncClient` tepat sesudah `started = true;`:

```ts
  // SPEC-1215 · ADR-0165 · socket relay hidup berdampingan dengan sync dan TAK ditunggu: ia membaca
  // grant sendiri dan diam bila mati. Instance tanpa app terpasang (test sync lama) tetap nol relay.
  startRelayClient(base, token);
```

Di `stopSyncClient`, tepat sesudah `presence?.stop(); presence = undefined;`:

```ts
  stopRelayClient();
```

Di `server/src/server.ts`, tambahkan impor

```ts
import { installRelayClient } from "./services/relay/client";
import { injectableFrom } from "./services/relay/dispatcher";
```

dan tepat sesudah `startSessionEventRelay(app);` (baris 42):

```ts
// SPEC-1215 · ADR-0165 · dispatcher relay menjalankan request hub lewat `app.inject` pada app INI,
// jadi gate & handler-nya identik dengan request lokal. Dipasang sebelum config boot memulai sync.
installRelayClient(injectableFrom(app));
```

- [ ] **Step 6: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/relay-client.test.ts server/test/sync-backoff.test.ts server/test/sync-client-presence-wiring.test.ts server/test/sync-client.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/backoff.ts server/src/services/relay/client.ts server/src/services/sync-client.ts server/src/server.ts server/test/relay-client.test.ts
git commit -m "feat(relay): tautan relay klien — grant, hello, backoff, unsupported 30 mnt (SPEC-1215)"
```

### Task 12: `GET|PUT /api/remote-control` (AC-A2, AC-A3 bagian 2, AC-A5)

**Files:**
- Create: `server/src/services/remote-control.ts`
- Create: `server/src/routes/remote-control.ts`
- Modify: `server/src/app.ts` (impor + register sesudah `await api.register(agentTokens);` baris 250)
- Modify: `server/src/services/agent-capabilities.ts:41-43`
- Modify: `server/test/agent-capabilities.test.ts` (baris sesudah `["GET", "/api/presence", "COOKIE_ONLY"],` di baris 67)
- Modify: `server/test/agent-doc-contract.test.ts` (daftar `kandidat`)
- Modify: `docs/agent-integration.md` (sesudah butir `/api/presence`)
- Modify: `server/test/parity-endpoints.test.ts`
- Test: `server/test/remote-control.route.test.ts`, `server/test/remote-control.relay.test.ts` (baru)

**Interfaces:**
- Consumes: `getSetting` (Task 3), `appendEvent`/`recentAudit` (Task 6), `refreshRelayClient`/`relayClientStatus` (Task 11), shared `zRemoteControlPut`, `validateRemoteGrant`, `type RemoteControlView`.
- Produces: `remoteControlView(): Promise<RemoteControlView>`, `updateRemoteControl(input: RemoteControlPut, by: string): Promise<RemoteControlView>`; route `GET /api/remote-control` → `RemoteControlView`; `PUT /api/remote-control` → `RemoteControlView` | 400.

- [ ] **Step 1: Tulis test route yang gagal**

Create `server/test/remote-control.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { __resetEventLog } from "../src/services/logs/event-log";
import { getSetting } from "../src/services/settings";
import { makeSetting } from "./factory";

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.logEntry.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(async () => { await clean(); __resetEventLog(); });
afterAll(async () => { await app.close(); await clean(); });

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0]!;
const login = async () => cookieOf(await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));
const put = (cookie: string, payload: unknown) => app.inject({ method: "PUT", url: "/api/remote-control", headers: { cookie }, payload });

describe("/api/remote-control (SPEC-1215 · ADR-0165 §4)", () => {
  it("tanpa cookie 401; view default mati", async () => {
    expect((await app.inject({ method: "GET", url: "/api/remote-control" })).statusCode).toBe(401);
    const cookie = await login();
    const res = await app.inject({ method: "GET", url: "/api/remote-control", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      control: { enabled: false, capabilities: [] },
      logs: { event: true, server: false, transcript: false },
      relay: { state: "off", since: null, hubOrigin: null, lastClose: null },
      audit: [],
    });
  });

  it("agent token ber-settings:write tetap 403 untuk GET dan PUT (AC-A3)", async () => {
    await makeSetting({ agentAccessEnabled: true });
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["settings:write", "sessions:write"] });
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/remote-control", headers: h })).statusCode).toBe(403);
    const res = await app.inject({ method: "PUT", url: "/api/remote-control", headers: h, payload: { control: { enabled: true, capabilities: ["sessions:read"] } } });
    expect(res.statusCode).toBe(403);
    expect((await getSetting()).remoteControl.enabled).toBe(false);
  });

  it("400: capability asing, tulis tanpa sessions:read, field asing", async () => {
    const cookie = await login();
    expect((await put(cookie, { control: { enabled: true, capabilities: ["vps:exec"] } })).statusCode).toBe(400);
    expect((await put(cookie, { control: { enabled: true, capabilities: ["sessions:write"] } })).statusCode).toBe(400);
    expect((await put(cookie, { control: { enabled: true, capabilities: [] }, extra: 1 })).statusCode).toBe(400);
  });

  it("PUT sah menyimpan grant + grant.changed beraktor cookie; PUT identik tak menambah audit", async () => {
    const cookie = await login();
    const body = { control: { enabled: true, capabilities: ["sessions:read", "sessions:spawn"] } };
    const res = await put(cookie, body);
    expect(res.statusCode).toBe(200);
    expect(res.json().control).toEqual(body.control);
    expect((await getSetting()).remoteControl).toEqual(body.control);
    expect(res.json().audit).toEqual([expect.objectContaining({
      kind: "grant.changed", data: expect.objectContaining({ scope: "control", by: "a@b.co", to: body.control }),
    })]);
    await put(cookie, body);
    expect(await prisma.logEntry.count({ where: { kind: "grant.changed" } })).toBe(1);
  });
});
```

Create `server/test/remote-control.relay.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetRelayClient, installRelayClient, relayClientStatus, startRelayClient } from "../src/services/relay/client";
import { injectableFrom } from "../src/services/relay/dispatcher";
import { __resetRelayHub, relayControlFor } from "../src/services/relay/hub";

const hub = buildApp({ requireAuth: false });
const client = buildApp();
let hubBase = "";
const clean = async () => {
  await prisma.logEntry.deleteMany(); await prisma.deviceToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await sleep(20); }
};
const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0]!;
async function loginAndDevice() {
  const cookie = cookieOf(await client.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));
  const user = await prisma.user.findFirstOrThrow();
  return { cookie, device: await issueDeviceToken(user.id, "klien") };
}
const putGrant = (cookie: string, enabled: boolean, capabilities: string[]) =>
  client.inject({ method: "PUT", url: "/api/remote-control", headers: { cookie }, payload: { control: { enabled, capabilities } } });

beforeAll(async () => {
  await hub.listen({ port: 0, host: "127.0.0.1" });
  hubBase = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
});
afterAll(async () => { __resetRelayClient(); await hub.close(); await client.close(); await clean(); });
beforeEach(async () => { __resetRelayClient(); __resetRelayHub(); await clean(); installRelayClient(injectableFrom(client)); });

describe("grant ↔ socket relay (SPEC-1215 AC-A2, AC-A5)", () => {
  it("menyalakan grant membuka relay + hello ≤ 5 dtk; mematikannya menutup relay SEBELUM PUT membalas", async () => {
    const { cookie, device } = await loginAndDevice();
    startRelayClient(hubBase, device.token);
    await sleep(300);
    expect(relayControlFor(device.id)).toBeNull();
    expect((await putGrant(cookie, true, ["sessions:read"])).statusCode).toBe(200);
    const t0 = Date.now();
    await waitFor(() => relayControlFor(device.id)?.state === "available", 5_000);
    expect(Date.now() - t0).toBeLessThan(5_000);

    const off = await putGrant(cookie, false, ["sessions:read"]);
    expect(off.statusCode).toBe(200);
    expect(relayClientStatus().state).toBe("off");
    expect(off.json().relay.state).toBe("off");
    await waitFor(() => relayControlFor(device.id) === null);
  });

  it("mengubah capability menutup relay lalu hello baru membawa capability baru", async () => {
    const { cookie, device } = await loginAndDevice();
    startRelayClient(hubBase, device.token);
    await putGrant(cookie, true, ["sessions:read"]);
    await waitFor(() => relayControlFor(device.id)?.state === "available");
    await putGrant(cookie, true, ["sessions:read", "sessions:write"]);
    await waitFor(() => relayControlFor(device.id)?.capabilities.includes("sessions:write") === true);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/remote-control.route.test.ts server/test/remote-control.relay.test.ts`
Expected: FAIL — `/api/remote-control` 404.

- [ ] **Step 3: Service & route**

Create `server/src/services/remote-control.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { RemoteControl, RemoteControlPut, RemoteControlView } from "@hanoman/shared";
import { prisma } from "../db";
import { appendEvent, recentAudit } from "./logs/event-log";
import { refreshRelayClient, relayClientStatus } from "./relay/client";
import { getSetting } from "./settings";

/* SPEC-1215 · ADR-0165 §4/§7 · ADR-0166 §8 · satu-satunya penulis `Setting.remoteControl` dan
   `Setting.logShipping`. `PUT /settings` sengaja tak bisa menyentuhnya (routes/settings.ts). */

export async function remoteControlView(): Promise<RemoteControlView> {
  const s = await getSetting();
  return { control: s.remoteControl, logs: s.logShipping, relay: relayClientStatus(), audit: await recentAudit(50) };
}

export async function updateRemoteControl(input: RemoteControlPut, by: string): Promise<RemoteControlView> {
  const before = await getSetting();
  // Kosakata sudah divalidasi route (`validateRemoteGrant`); dedup tanpa mengubah urutan pilihan operator.
  const control: RemoteControl = input.control
    ? { enabled: input.control.enabled, capabilities: [...new Set(input.control.capabilities)] as RemoteControl["capabilities"] }
    : before.remoteControl;
  const logs = input.logs ?? before.logShipping;
  const data = { ...before, remoteControl: control, logShipping: logs } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });

  const grantChanged = JSON.stringify(before.remoteControl) !== JSON.stringify(control);
  // AC-A5 · ditunggu: socket relay tertutup SEBELUM route membalas.
  if (grantChanged) {
    await refreshRelayClient();
    await appendEvent({
      kind: "grant.changed", level: "warn", msg: `grant kendali jarak jauh diubah oleh ${by}`,
      data: { scope: "control", from: before.remoteControl, to: control, by },
    });
  }
  if (JSON.stringify(before.logShipping) !== JSON.stringify(logs)) {
    await appendEvent({
      kind: "grant.changed", level: "warn", msg: `lajur log ke hub diubah oleh ${by}`,
      data: { scope: "logs", from: before.logShipping, to: logs, by },
    });
  }
  return remoteControlView();
}
```

Create `server/src/routes/remote-control.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { validateRemoteGrant, zRemoteControlPut } from "@hanoman/shared";
import { remoteControlView, updateRemoteControl } from "../services/remote-control";

// SPEC-1215 · ADR-0165 §4/§7 · grant kendali jarak jauh mesin INI. COOKIE_ONLY (top `remote-control`):
// agent token maupun principal `remote` tak boleh menaikkan haknya sendiri (cermin /agent-tokens).
export default async function (app: FastifyInstance) {
  app.get("/remote-control", async () => remoteControlView());

  app.put("/remote-control", async (req, reply) => {
    const parsed = zRemoteControlPut.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const why = parsed.data.control ? validateRemoteGrant(parsed.data.control.capabilities) : null;
    if (why) return reply.code(400).send({ error: why });
    return updateRemoteControl(parsed.data, req.user?.email ?? "unknown");
  });
}
```

Di `server/src/app.ts`: `import remoteControl from "./routes/remote-control";` dan sesudah `await api.register(agentTokens);`:

```ts
    await api.register(remoteControl); // SPEC-1215 · ADR-0165 · grant kendali jarak jauh (cookie-only)
```

- [ ] **Step 4: Peta capability, naskah agen, parity**

Di `server/src/services/agent-capabilities.ts`, ubah kondisi COOKIE_ONLY baris 41-43 menjadi:

```ts
  // SPEC-1215 · ADR-0165 §4 · `remote-control` menyalakan eksekusi agen di mesin ini atas perintah hub.
  // Capability apa pun yang bisa menulisnya adalah eskalasi RCE — cookie-only (preseden /agent-tokens).
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
    || top === "presence" || top === "models" || top === "remote-control"
    || top === "portal" || top === "client-accounts" || top === "session-events") return "COOKIE_ONLY";
```

Di `server/test/agent-capabilities.test.ts`, sesudah baris `["GET", "/api/presence", "COOKIE_ONLY"],`:

```ts
    // SPEC-1215 · ADR-0165 §4 · grant kendali jarak jauh.
    ["GET", "/api/remote-control", "COOKIE_ONLY"],
    ["PUT", "/api/remote-control", "COOKIE_ONLY"],
```

Di `server/test/agent-doc-contract.test.ts`, ubah daftar `kandidat` menjadi:

```ts
    const kandidat = ["auth", "agent-tokens", "device-tokens", "sync", "webhooks",
      "portal", "client-accounts", "presence", "remote-control"];
```

Di `docs/agent-integration.md`, sisipkan sebelum butir `` - `POST /api/update/apply` … ``:

```md
- `/api/remote-control` — grant kendali jarak jauh mesin ini dari hub (SPEC-1215/ADR-0165): siapa
  pun yang bisa menulisnya bisa membuka eksekusi agen di mesin ini atas perintah hub. Cookie-only apa
  pun method-nya, dan `PUT /api/settings` pun tak bisa mengubah kunci `remoteControl`/`logShipping`/
  `logRetention`
```

Di `server/test/parity-endpoints.test.ts`, sesudah deklarasi `NEW_TEAM`:

```ts
// SPEC-1215 · ADR-0165 · alasan yang sama: klien menandai hub "tak mendukung relay" saat upgrade 404,
// jadi route relay yang lupa di-register terbaca sebagai hub versi lama — gagal senyap.
const NEW_RELAY = ["/api/sync/relay/ws", "/api/remote-control"];
```

dan di dalam `describe`:

```ts
  it("relay surface registered (SPEC-1215)", () => {
    for (const p of NEW_RELAY) expect(routes, `belum ada: ${p}`).toContain(p);
  });
```

- [ ] **Step 5: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/remote-control.route.test.ts server/test/remote-control.relay.test.ts server/test/agent-capabilities.test.ts server/test/agent-doc-contract.test.ts server/test/parity-endpoints.test.ts server/test/mcp-coverage.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/remote-control.ts server/src/routes/remote-control.ts server/src/app.ts server/src/services/agent-capabilities.ts server/test/remote-control.route.test.ts server/test/remote-control.relay.test.ts server/test/agent-capabilities.test.ts server/test/agent-doc-contract.test.ts server/test/parity-endpoints.test.ts docs/agent-integration.md
git commit -m "feat(relay): GET|PUT /api/remote-control cookie-only, grant berubah menutup relay (SPEC-1215 AC-A3/A5)"
```

### Task 13: Frame `capacity` + `control`/`capacity` di presence (AC-A10)

**Files:**
- Modify: `server/src/services/presence/snapshot.ts` (seluruh berkas, 37 baris)
- Modify: `server/src/services/presence/sender.ts:13-60`
- Modify: `server/src/services/presence/registry.ts` (impor, `dropPresence`, `__resetPresence`, fungsi baru)
- Modify: `server/src/services/presence/view.ts:19-49`
- Modify: `server/src/routes/sync.ts` (handler `message` di `/sync/ws`)
- Modify: `server/test/presence-sender.test.ts`, `server/test/presence-view.test.ts` (tambah kasus)
- Test: `server/test/sync-capacity.test.ts` (baru)

**Interfaces:**
- Consumes: `zCapacityFrame`, `capacityFrameJson`, `capacitySignature`, `type LaunchStatus` (Task 2); `currentLaunchStatus(panes, config)` (`server/src/services/session-launch-gate.ts:14`); `getScheduler()` (`server/src/services/scheduler/config.ts:8`); `relayControlFor` (Task 10).
- Produces (dipakai SPEC-1216 untuk target Start):
  - `listPanesShared(now?: number): Promise<Pane[]>`, `buildLocalCapacity(): Promise<LaunchStatus>`, `__resetPanesMemo(): void`
  - `createPresenceSender(o: { send; build; capacity?: () => Promise<LaunchStatus>; heartbeatMs? })`
  - `recordCapacity(deviceId: string, admission: LaunchStatus, now?: number): void`, `capacityFor(deviceId: string, now?: number): LaunchStatus | null`
  - `presenceView(o?: { local?; localCapacity?: () => Promise<LaunchStatus>; now? })` — setiap `PresenceDeviceView` kini membawa `control` dan `capacity` (bisa `null`)

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/presence-sender.test.ts` (dan tambahkan `type LaunchStatus` ke impor `@hanoman/shared` di baris 2):

```ts
describe("frame capacity di pengirim (SPEC-1215 · AC-A10)", () => {
  const adm = (over: Partial<LaunchStatus> = {}): LaunchStatus => ({
    enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 4,
    loadPerCore: 0.3, maxLoadPerCore: 1.5, loadStatus: "available", ...over,
  });
  const capFrames = (sent: string[]) => sent.map((j) => JSON.parse(j)).filter((f) => f.t === "capacity");

  it("dikirim pada tick pertama, diam saat sama, dikirim saat berubah dan saat denyut", async () => {
    let current = adm();
    const sent: string[] = [];
    const sender = createPresenceSender({ send: (j) => sent.push(j), build: async () => [s()], capacity: async () => current });
    await sender.tick(T0);
    await sender.tick(T0 + 3_000);
    expect(capFrames(sent)).toHaveLength(1);
    current = adm({ liveCount: 2 });
    await sender.tick(T0 + 6_000);
    expect(capFrames(sent)).toHaveLength(2);
    await sender.tick(T0 + 6_000 + PRESENCE_HEARTBEAT_MS);
    expect(capFrames(sent)).toHaveLength(3);
    expect(capFrames(sent)[0]).toMatchObject({ t: "capacity", v: PRESENCE_PROTOCOL, admission: adm() });
  });

  it("capacity yang melempar tak menghentikan presence", async () => {
    const sent: string[] = [];
    const sender = createPresenceSender({ send: (j) => sent.push(j), build: async () => [s()], capacity: async () => { throw new Error("tmux"); } });
    await expect(sender.tick(T0)).resolves.toBeUndefined();
    expect(sent.map((j) => JSON.parse(j).t)).toEqual(["presence"]);
  });
});
```

Tambahkan di `server/test/presence-view.test.ts`: impor

```ts
import type { LaunchStatus } from "@hanoman/shared";
import { recordCapacity } from "../src/services/presence/registry";
import { __resetRelayHub, attachRelaySocket } from "../src/services/relay/hub";
import { __resetDeviceSockets } from "../src/services/device-sockets";
```

ubah `beforeEach` menjadi `beforeEach(async () => { __resetPresence(); __resetRelayHub(); __resetDeviceSockets(); await clean(); });`, lalu di dalam `describe("presenceView")`:

```ts
  // SPEC-1215 · ADR-0165 §9 · kapasitas & ketersediaan kendali untuk routing target Start (SPEC-1216).
  const adm = (over: Partial<LaunchStatus> = {}): LaunchStatus => ({
    enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 4,
    loadPerCore: 0.3, maxLoadPerCore: 1.5, loadStatus: "available", ...over,
  });

  it("device online membawa capacity dan control; mesin lokal membawa capacity sendiri", async () => {
    const d = await device("laptop");
    recordPresence(d.id, [s()], T0);
    recordCapacity(d.id, adm(), T0);
    const link = attachRelaySocket(d.id, { readyState: 1, send: () => {}, close: () => {} });
    link.onMessage(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read", "sessions:spawn"] }));
    const v = await presenceView({ local: none, localCapacity: async () => adm({ liveCount: 9 }), now: T0 });
    expect(v.devices[0]).toMatchObject({ local: true, control: null, capacity: { liveCount: 9 } });
    const found = v.devices.find((x) => x.deviceId === d.id)!;
    expect(found.capacity).toEqual(adm());
    expect(found.control).toMatchObject({ state: "available", capabilities: ["sessions:read", "sessions:spawn"] });
  });

  it("device offline: capacity dan control null", async () => {
    const d = await device("laptop");
    recordCapacity(d.id, adm(), T0);
    const v = await presenceView({ local: none, localCapacity: async () => adm(), now: T0 });
    expect(v.devices.find((x) => x.deviceId === d.id)).toMatchObject({ online: false, capacity: null, control: null });
  });
```

Create `server/test/sync-capacity.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { capacityFrameJson, type LaunchStatus } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetPresence, capacityFor } from "../src/services/presence/registry";

const app = buildApp({ requireAuth: false });
let host = "";
const admission: LaunchStatus = {
  enabled: true, liveCount: 2, liveAgentCount: 1, maxConcurrent: 4, loadPerCore: 0.5, maxLoadPerCore: 1.5, loadStatus: "available",
};
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetPresence(); await clean(); });

async function openSync() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  const t = await issueDeviceToken(u.id, "laptop");
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://${host}/api/sync/ws`, { headers: { authorization: `Bearer ${t.token}` } });
    s.once("open", () => resolve(s)); s.once("error", reject);
  });
  return { t, ws };
}

describe("frame capacity di /api/sync/ws (SPEC-1215 · AC-A10)", () => {
  it("dicatat ke registry beratribusi device dari TOKEN", async () => {
    const { t, ws } = await openSync();
    ws.send(capacityFrameJson(admission));
    await waitFor(() => capacityFor(t.id) !== null);
    expect(capacityFor(t.id)).toEqual(admission);
    ws.close();
    await waitFor(() => capacityFor(t.id) === null);
  });

  it("frame capacity rusak dibuang tanpa menutup socket sync", async () => {
    const { t, ws } = await openSync();
    ws.send(JSON.stringify({ t: "capacity", v: 1, admission, extra: true }));
    ws.send(JSON.stringify({ t: "capacity", v: 1, admission: { liveCount: "banyak" } }));
    await new Promise((r) => setTimeout(r, 150));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(capacityFor(t.id)).toBeNull();
    ws.close();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/presence-sender.test.ts server/test/presence-view.test.ts server/test/sync-capacity.test.ts`
Expected: FAIL — `recordCapacity`/`capacityFor` bukan export; opsi `capacity` diabaikan.

- [ ] **Step 3: Snapshot bersama**

Ganti isi `server/src/services/presence/snapshot.ts` menjadi:

```ts
import { MAX_PRESENCE_SESSIONS, type LaunchStatus, type PresenceSession } from "@hanoman/shared";
import { listPanesAsync, type Pane } from "../pty";
import { readPhases } from "../session-phases";
import { getScheduler } from "../scheduler/config";
import { currentLaunchStatus } from "../session-launch-gate";

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

// SPEC-1215 · presence DAN capacity dibangun per tick 3 dtk dari pane yang sama. Memo 1 dtk supaya
// keduanya berbagi SATU `tmux list-panes` — mesin klien bisa Mac mini 8 GB (ADR-0161).
const PANES_MEMO_MS = 1_000;
let panesMemo: { at: number; value: Promise<Pane[]> } | null = null;

export function listPanesShared(now = Date.now()): Promise<Pane[]> {
  if (panesMemo && now - panesMemo.at < PANES_MEMO_MS) return panesMemo.value;
  const value = listPanesAsync();
  panesMemo = { at: now, value };
  value.catch(() => { if (panesMemo?.value === value) panesMemo = null; });
  return value;
}

/** Test-only. */
export function __resetPanesMemo(): void { panesMemo = null; }

/** Snapshot mesin ini. Dipakai klien (untuk dikirim) DAN hub (untuk dirinya sendiri).
    Dipotong di plafon supaya frame tak pernah menabrak `maxPayload` socket sync. */
export async function buildLocalPresence(): Promise<PresenceSession[]> {
  const panes = await listPanesShared();
  return panes.slice(0, MAX_PRESENCE_SESSIONS).map((p) => paneToPresence(p, activePhase(p)));
}

/** SPEC-1215 · ADR-0165 §9 · angka yang SAMA dengan gerbang peluncuran, bukan metrik baru. */
export async function buildLocalCapacity(): Promise<LaunchStatus> {
  return currentLaunchStatus(await listPanesShared(), await getScheduler());
}
```

- [ ] **Step 4: Pengirim**

Ganti `createPresenceSender` dan `startPresenceSender` di `server/src/services/presence/sender.ts` (baris 13-60) menjadi, dan tambahkan `capacityFrameJson, capacitySignature, type LaunchStatus` ke impor `@hanoman/shared` serta `buildLocalCapacity` ke impor `./snapshot`:

```ts
export type PresenceSender = { tick(now: number): Promise<void> };

export function createPresenceSender(o: {
  send: (json: string) => void;
  build: () => Promise<PresenceSession[]>;
  /** SPEC-1215 · ADR-0165 §9 · absen = tak ada frame capacity (test lama, dan pemakaian tanpa gerbang). */
  capacity?: () => Promise<LaunchStatus>;
  heartbeatMs?: number;
}): PresenceSender {
  const heartbeatMs = o.heartbeatMs ?? PRESENCE_HEARTBEAT_MS;
  let lastSignature: string | null = null;
  let lastSentAt = 0;
  let lastCapacity: string | null = null;
  let lastCapacityAt = 0;
  const trySend = (json: string): void => {
    try { o.send(json); } catch { /* socket sudah tertutup — siklus reconnect yang mengurusnya */ }
  };

  async function tickPresence(now: number): Promise<void> {
    let sessions: PresenceSession[];
    // tmux mati / belum jalan bukan alasan untuk mengganggu socket sync.
    try { sessions = trimPresenceToBudget(await o.build()); } catch { return; }
    // Signature dihitung atas daftar yang SUDAH dipotong — kalau tidak, mesin di atas anggaran
    // akan mengirim ulang byte yang identik tiap tick karena signature-nya terus berubah.
    const signature = presenceSignature(sessions);
    const due = lastSignature === null || signature !== lastSignature || now - lastSentAt >= heartbeatMs;
    if (!due) return;
    lastSignature = signature;
    lastSentAt = now;
    trySend(presenceFrameJson(sessions));
  }

  // Blok terpisah dari presence: kegagalan satu tak boleh membungkam yang lain. Guard hub
  // (`PRESENCE_MAX_FRAMES_PER_MIN` = 60) menghitung keduanya: ≤ 20 + ≤ 20 frame/menit.
  async function tickCapacity(now: number): Promise<void> {
    if (!o.capacity) return;
    let admission: LaunchStatus;
    try { admission = await o.capacity(); } catch { return; }
    const signature = capacitySignature(admission);
    if (lastCapacity !== null && signature === lastCapacity && now - lastCapacityAt < heartbeatMs) return;
    lastCapacity = signature;
    lastCapacityAt = now;
    trySend(capacityFrameJson(admission));
  }

  return {
    async tick(now: number): Promise<void> {
      await tickPresence(now);
      await tickCapacity(now);
    },
  };
}

/** Pembungkus `setInterval` untuk pemakaian nyata. Timer di-`unref` supaya tak menahan proses. */
export function startPresenceSender(o: {
  send: (json: string) => void;
  build?: () => Promise<PresenceSession[]>;
  capacity?: () => Promise<LaunchStatus>;
  tickMs?: number;
  heartbeatMs?: number;
}): { stop(): void } {
  const sender = createPresenceSender({
    send: o.send, build: o.build ?? buildLocalPresence, capacity: o.capacity ?? buildLocalCapacity, heartbeatMs: o.heartbeatMs,
  });
  void sender.tick(Date.now());
  const timer = setInterval(() => { void sender.tick(Date.now()); }, o.tickMs ?? PRESENCE_TICK_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
```

- [ ] **Step 5: Registry & view**

Di `server/src/services/presence/registry.ts`: ubah impor baris 1 menjadi `import { PRESENCE_OFFLINE_MS, type LaunchStatus, type PresenceSession, type PresenceSessionView } from "@hanoman/shared";`, ubah `dropPresence` dan `__resetPresence`, lalu tambahkan fungsi baru:

```ts
/* SPEC-1215 · ADR-0165 §9 · kapasitas per device, DI MEMORI seperti sesi (prinsip ADR-0148). Peta
   terpisah dari `devices`: frame capacity bisa tiba sebelum frame presence pertama. */
const capacities = new Map<string, { admission: LaunchStatus; at: number }>();

export function recordCapacity(deviceId: string, admission: LaunchStatus, now = Date.now()): void {
  capacities.set(deviceId, { admission, at: now });
}

/** Angka yang denyutnya berhenti melewati ambang offline tak lagi dipercaya untuk routing. */
export function capacityFor(deviceId: string, now = Date.now()): LaunchStatus | null {
  const c = capacities.get(deviceId);
  if (!c) return null;
  if (now - c.at >= PRESENCE_OFFLINE_MS) { capacities.delete(deviceId); return null; }
  return c.admission;
}

/** Socket putus = device offline seketika; tak perlu menunggu ambang denyut. */
export function dropPresence(deviceId: string): void { devices.delete(deviceId); capacities.delete(deviceId); }
```

(hapus definisi `dropPresence` lama), dan `export function __resetPresence(): void { devices.clear(); capacities.clear(); }`.

Di `server/src/services/presence/view.ts`: tambahkan `type LaunchStatus` ke impor shared, `buildLocalCapacity` ke impor `./snapshot`, `capacityFor` ke impor `./registry`, dan `import { relayControlFor } from "../relay/hub";`. Ganti fungsi `presenceView` menjadi:

```ts
export async function presenceView(
  o: { local?: () => Promise<PresenceSession[]>; localCapacity?: () => Promise<LaunchStatus>; now?: number } = {},
): Promise<PresenceView> {
  const now = o.now ?? Date.now();
  const local = o.local ?? buildLocalPresence;

  // Requirement 5 · sesi mesin ini masuk lewat pintu yang SAMA dengan device remote, supaya
  // `statusAt` dan bentuk barisnya lahir dari satu rumus.
  recordPresence(LOCAL_DEVICE_ID, await local().catch(() => []), now);
  // SPEC-1215 · hub juga target Start ("tanpa kandidat → hub ini"), jadi kapasitasnya ikut tampil.
  const localCapacity = await (o.localCapacity ?? buildLocalCapacity)().catch(() => null);

  const live = new Map(presenceEntries(now).map((e) => [e.deviceId, e.sessions]));
  const rows = await prisma.deviceToken.findMany({
    where: { revokedAt: null }, orderBy: { createdAt: "asc" },
  });

  const devices: PresenceDeviceView[] = [{
    deviceId: LOCAL_DEVICE_ID, name: hostname(), local: true, online: true,
    lastSeenAt: new Date(now).toISOString(), sessions: live.get(LOCAL_DEVICE_ID) ?? [],
    control: null, capacity: localCapacity,
  }];
  for (const r of rows) {
    const sessions = live.get(r.id);
    devices.push({
      deviceId: r.id, name: r.name, local: false, online: !!sessions,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      sessions: sessions ?? [],
      // SPEC-1215 · `control` dari hello socket relay (bisa hidup/mismatch walau presence belum tiba);
      // `capacity` hanya untuk device yang online — angka basi tak boleh mengusulkan target.
      control: relayControlFor(r.id),
      capacity: sessions ? capacityFor(r.id, now) : null,
    });
  }

  // Gerbang requirement 7: instalasi satu mesin (nol device token) tak berubah tampilannya.
  return { enabled: rows.length > 0, devices };
}
```

- [ ] **Step 6: Hub menerima frame capacity**

Di `server/src/routes/sync.ts`: tambahkan `zCapacityFrame` ke impor `@hanoman/shared` dan `recordCapacity` ke impor `../services/presence/registry`. Ganti handler `socket.on("message", …)` di `/sync/ws` menjadi:

```ts
    socket.on("message", (raw: Buffer) => {
      try {
        if (!guard.accept(raw).ok) return;
        const msg: unknown = JSON.parse(raw.toString("utf8"));
        // deviceId SELALU dari token terverifikasi — payload tak pernah boleh menamai dirinya.
        const presence = zPresenceFrame.safeParse(msg);
        if (presence.success) { recordPresence(principal.id, presence.data.sessions); return; }
        // SPEC-1215 · ADR-0165 §9 · arah naik kedua. Gagal parse = dibuang, tak pernah menutup socket.
        const capacity = zCapacityFrame.safeParse(msg);
        if (capacity.success) recordCapacity(principal.id, capacity.data.admission);
      } catch { /* frame rusak — dibuang */ }
    });
```

- [ ] **Step 7: Jalankan test**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/presence-sender.test.ts server/test/presence-view.test.ts server/test/sync-capacity.test.ts server/test/presence-snapshot.test.ts server/test/presence-registry.test.ts server/test/presence.route.test.ts server/test/sync-ws-presence.test.ts server/test/sync-client-presence-wiring.test.ts server/test/events-presence-gate.test.ts && pnpm --filter ./server typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/presence server/src/routes/sync.ts server/test/presence-sender.test.ts server/test/presence-view.test.ts server/test/sync-capacity.test.ts
git commit -m "feat(presence): frame capacity + control/capacity per device (SPEC-1215 AC-A10)"
```

### Task 14: Panel Settings "Kendali jarak jauh" (grant opt-in eksplisit oleh cookie lokal)

**Files:**
- Modify: `shared/src/api.ts:177` (sesudah `deviceToken: …`)
- Modify: `src/src/api/client.ts:1` (impor tipe) dan sesudah `revokeDeviceToken` (baris 545)
- Create: `src/src/screens/RemoteControlPanel.tsx`
- Create: `src/src/screens/RemoteControlPanel.test.tsx`
- Modify: `src/src/screens/SettingsScreen.tsx` (impor, `S_SECTIONS` baris 636, `content` baris 1539)

**Interfaces:**
- Consumes: `GET|PUT /api/remote-control` (Task 12); `type RemoteControlView`, `type RemoteControlPut`, `type RemoteCapability`, `type RelayLinkState` (Task 1); `Switch`, `Card`, `Badge`, `StateBlock`, `type ShowToast` (`src/src/ds`).
- Produces: `paths.remoteControl`, `api.getRemoteControl(): Promise<RemoteControlView>`, `api.putRemoteControl(b: RemoteControlPut): Promise<RemoteControlView>`, `export function RemoteControlPanel({ onToast }: { onToast?: ShowToast })`.

- [ ] **Step 1: Tulis test yang gagal**

Create `src/src/screens/RemoteControlPanel.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteControlView } from "@hanoman/shared";
import { RemoteControlPanel } from "./RemoteControlPanel";

const base: RemoteControlView = {
  control: { enabled: false, capabilities: [] },
  logs: { event: true, server: false, transcript: false },
  relay: { state: "off", since: null, hubOrigin: null, lastClose: null },
  audit: [],
};
const json = (value: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => value } as Response);

function mockApi(initial: RemoteControlView) {
  const puts: unknown[] = [];
  let current = initial;
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    if (String(url) === "/api/remote-control" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { control: RemoteControlView["control"] };
      puts.push(body);
      current = { ...current, control: body.control };
      return json(current);
    }
    if (String(url) === "/api/remote-control") return json(current);
    throw new Error(`unexpected fetch ${String(url)}`);
  });
  return puts;
}

afterEach(() => vi.restoreAllMocks());

describe("RemoteControlPanel (SPEC-1215 · ADR-0165 §4)", () => {
  it("default mati: toggle capability terkunci sampai master menyala", async () => {
    mockApi(base);
    render(<RemoteControlPanel />);
    const master = await screen.findByRole("switch", { name: "Izinkan kendali jarak jauh" });
    expect(master).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Mulai sesi" })).toHaveAttribute("aria-disabled", "true");
  });

  it("menyalakan master mengirim grant Lihat saja", async () => {
    const puts = mockApi(base);
    render(<RemoteControlPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: "Izinkan kendali jarak jauh" }));
    await waitFor(() => expect(puts).toEqual([
      { control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } },
    ]));
  });

  it("menyalakan Mulai sesi selalu menyertakan Lihat", async () => {
    const puts = mockApi({ ...base, control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } });
    render(<RemoteControlPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: "Mulai sesi" }));
    await waitFor(() => expect(puts.at(-1)).toEqual({
      control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read", "sessions:spawn"] },
    }));
  });

  it("status relay dan audit aksi hub ditampilkan", async () => {
    mockApi({
      ...base,
      control: { enabled: true, capabilities: ["sessions:read"] },
      relay: { state: "open", since: "2026-09-15T01:00:00.000Z", hubOrigin: "https://hub.example", lastClose: null },
      audit: [{
        id: 1, deviceId: "local", deviceName: "mac-mini", lane: "event", seq: "1", ts: "2026-09-15T01:00:00.000Z",
        receivedAt: "2026-09-15T01:00:00.000Z", level: "info", kind: "remote.request", projectId: null, specId: null,
        sessionId: null, msg: "GET /api/terminal/sessions → 200", data: null, hasTranscript: false,
      }],
    });
    render(<RemoteControlPanel />);
    expect(await screen.findByText("tersambung")).toBeInTheDocument();
    expect(screen.getByText("https://hub.example")).toBeInTheDocument();
    expect(screen.getAllByTestId("remote-audit-row")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run src/src/screens/RemoteControlPanel.test.tsx`
Expected: FAIL — modul `./RemoteControlPanel` tak ada.

- [ ] **Step 3: Path & client API**

Di `shared/src/api.ts`, sesudah baris `deviceToken: (id: string) => \`${API}/device-tokens/${id}\`,`:

```ts
  // SPEC-1215 · ADR-0165 · grant kendali jarak jauh mesin ini (cookie-only)
  remoteControl: `${API}/remote-control`,
```

Di `src/src/api/client.ts`, tambahkan `type RemoteControlView, type RemoteControlPut,` ke impor `@hanoman/shared` baris 1, lalu sesudah `revokeDeviceToken: …`:

```ts
  // SPEC-1215 · ADR-0165 · grant kendali jarak jauh (LOCAL-only, cookie-only).
  getRemoteControl: () => j<RemoteControlView>(paths.remoteControl),
  putRemoteControl: (b: RemoteControlPut) => j<RemoteControlView>(paths.remoteControl, { method: "PUT", ...body(b) }),
```

- [ ] **Step 4: Komponen**

Create `src/src/screens/RemoteControlPanel.tsx`:

```tsx
import React from "react";
import type { RelayLinkState, RemoteCapability, RemoteControlView } from "@hanoman/shared";
import { Badge, Card, StateBlock, Switch, type ShowToast } from "../ds";
import { api } from "../api/client";

// SPEC-1215 · ADR-0165 §4 · K7 transparansi: operator mesin INI menentukan apa yang boleh dilakukan hub
// dan membaca audit apa yang sudah dilakukannya. Berkas sendiri (pola ClientAccessPanel): SettingsScreen
// sudah ~80 KB. Toggle lajur log sengaja BELUM ada — pengirimannya lahir di SPEC-1217 (keputusan Plan P6).

const VIEW: RemoteCapability[] = ["sessions:read", "backlog:read", "ide:read"];
const EXTRA: { cap: RemoteCapability; label: string; desc: string }[] = [
  { cap: "sessions:write", label: "Tulis terminal", desc: "Ketik ke terminal, steer, interrupt, jawab & ambil alih dialog." },
  { cap: "sessions:spawn", label: "Mulai sesi", desc: "Membuka sesi agen BARU di mesin ini atas perintah hub — eksekusi agen di mesin ini. Hub tak bisa memaksa melewati gerbang beban." },
  { cap: "backlog:write", label: "Tandai selesai", desc: "Hanya menandai backlog selesai; suntingan backlog lain tetap tertutup untuk hub." },
];
const RELAY_LABEL: Record<RelayLinkState, string> = {
  off: "mati", connecting: "menyambung", open: "tersambung", backoff: "mencoba lagi",
  unsupported: "hub tak mendukung", rejected: "ditolak hub",
};
const RELAY_TONE: Record<RelayLinkState, "ok" | "warn" | "neutral"> = {
  off: "neutral", connecting: "neutral", open: "ok", backoff: "warn", unsupported: "warn", rejected: "warn",
};

function Row({ title, desc, children, last }: { title: string; desc: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="hn-setting-row" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--border-hair)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div className="hn-setting-control" style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

export function RemoteControlPanel({ onToast }: { onToast?: ShowToast }) {
  const [view, setView] = React.useState<RemoteControlView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { api.getRemoteControl().then(setView).catch(() => setFailed(true)); }, []);

  if (!view) {
    return (
      <Card eyebrow="kendali" title="Kendali jarak jauh dari hub">
        {failed
          ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Gagal memuat grant kendali jarak jauh.</div>
          : <StateBlock kind="loading" compact title="Memuat grant…" />}
      </Card>
    );
  }

  const { enabled, capabilities } = view.control;
  const has = (c: RemoteCapability) => capabilities.includes(c);
  const union = (...lists: RemoteCapability[][]): RemoteCapability[] => [...new Set(lists.flat())];
  const save = async (nextEnabled: boolean, next: RemoteCapability[]) => {
    setBusy(true);
    try {
      setView(await api.putRemoteControl({ control: { enabled: nextEnabled, capabilities: next } }));
      onToast?.(nextEnabled ? "Grant kendali jarak jauh disimpan" : "Kendali jarak jauh dimatikan", "ok", "check");
    } catch {
      onToast?.("Gagal menyimpan grant kendali jarak jauh", "err", "x-circle");
    } finally { setBusy(false); }
  };
  // Server menolak grant tulis tanpa `sessions:read` — UI menjaga invarian yang sama, tak mengandalkan 400.
  const toggleMaster = (on: boolean) => save(on, on && capabilities.length === 0 ? VIEW : capabilities);
  const toggleView = (on: boolean) => save(enabled, on ? union(capabilities, VIEW) : []);
  const toggleExtra = (cap: RemoteCapability, on: boolean) =>
    save(enabled, on ? union(capabilities, VIEW, [cap]) : capabilities.filter((c) => c !== cap));

  return (
    <>
      <Card eyebrow="kendali" title="Kendali jarak jauh dari hub">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Mengizinkan operator <b>hub</b> tempat mesin ini tersinkron bertindak di mesin ini lewat route yang
          sama dengan dashboard lokal. Default mati dan hanya bisa dinyalakan dari mesin ini — hub tak bisa
          menyalakannya sendiri.
        </div>
        <Row title="Izinkan kendali jarak jauh" desc="Membuka socket relay ke hub. Mati = tak ada jalur perintah dari hub sama sekali.">
          <Switch checked={enabled} disabled={busy} onChange={(on: boolean) => void toggleMaster(on)} aria-label="Izinkan kendali jarak jauh" />
        </Row>
        <Row title="Lihat" desc="Daftar sesi, fase, dialog, dokumen & review sesi, IDE baca-saja.">
          <Switch checked={has("sessions:read")} disabled={busy || !enabled} onChange={(on: boolean) => void toggleView(on)} aria-label="Lihat" />
        </Row>
        {EXTRA.map((e, i) => (
          <Row key={e.cap} title={e.label} desc={e.desc} last={i === EXTRA.length - 1}>
            <Switch checked={has(e.cap)} disabled={busy || !enabled} onChange={(on: boolean) => void toggleExtra(e.cap, on)} aria-label={e.label} />
          </Row>
        ))}
      </Card>
      <Card eyebrow="kendali" title="Status relay">
        <div data-testid="relay-status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <Badge tone={RELAY_TONE[view.relay.state]}>{RELAY_LABEL[view.relay.state]}</Badge>
          <span style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{view.relay.hubOrigin ?? "mesin ini tak tersambung ke hub"}</span>
          {view.relay.lastClose && (
            <span style={{ color: "var(--text-muted)" }}>
              tutup terakhir {view.relay.lastClose.code}{view.relay.lastClose.reason ? ` · ${view.relay.lastClose.reason}` : ""}
            </span>
          )}
        </div>
      </Card>
      <Card eyebrow="kendali" title="Audit aksi hub di mesin ini">
        {view.audit.length === 0
          ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada aksi dari hub.</div>
          : view.audit.map((a) => (
            <div key={a.id} data-testid="remote-audit-row" style={{ fontSize: 12.5, padding: "8px 0", borderBottom: "1px solid var(--border-hair)", overflowWrap: "anywhere" }}>
              <b>{a.kind}</b> · {a.msg} · <span style={{ color: "var(--text-muted)" }}>{new Date(a.ts).toLocaleString("id-ID")}</span>
            </div>
          ))}
      </Card>
    </>
  );
}
```

- [ ] **Step 5: Pasang di Settings**

Di `src/src/screens/SettingsScreen.tsx`: `import { RemoteControlPanel } from "./RemoteControlPanel";   // SPEC-1215 · ADR-0165 · grant kendali jarak jauh` di dekat impor `ClientAccessPanel`. Di `S_SECTIONS`, sesudah baris `{ key: "perangkat", … }`:

```ts
  { key: "kendali-jarak-jauh", label: "Kendali jarak jauh", icon: "shield" }, // SPEC-1215 · ADR-0165 · grant hub → mesin ini
```

Di rantai `content`, sesudah baris `: tab === "perangkat" ? <DeviceTokensPanel onToast={onToast} />`:

```tsx
    : tab === "kendali-jarak-jauh" ? <RemoteControlPanel onToast={onToast} />
```

- [ ] **Step 6: Jalankan test + typecheck**

Run: `pnpm vitest --run src/src/screens/RemoteControlPanel.test.tsx src/src/screens/SettingsScreen.test.tsx && pnpm --filter ./src typecheck && pnpm --filter ./shared typecheck`
Expected: PASS; typecheck bersih.

- [ ] **Step 7: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/src/screens/RemoteControlPanel.tsx src/src/screens/RemoteControlPanel.test.tsx src/src/screens/SettingsScreen.tsx
git commit -m "feat(ui): panel Kendali jarak jauh — grant opt-in, status relay, audit (SPEC-1215)"
```

### Task 15: Cabut penanda DIRANCANG untuk bagian yang mendarat di A

**Files:**
- Modify: `internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md:3-5`
- Modify: `internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md:3-5`
- Modify: `internal/docs/adr/0046-kanal-ws-sync-terpisah.md:8-9`, `internal/docs/adr/0147-kanal-presence-di-socket-sync.md:16`, `internal/docs/adr/0065-ai-agent-capability-agent-token.md:12`
- Modify: `internal/docs/architecture/api-contract.md:1405-1409` (+ daftar cookie-only agent token)
- Modify: `internal/docs/architecture/data-model.md:284,726`
- Modify: `internal/docs/architecture/stack.md:41-43`
- Modify: `internal/docs/security/threat-model.md:150`
- Modify: `internal/docs/frontend/frontend-implementation.md:43-45`
- Modify: `internal/docs/operations/production.md:90`
- Modify: `internal/docs/README.md:105-106`, `internal/docs/adr/README.md:3-4`
- Modify: `internal/skills/hanoman/SKILL.md` (sesudah butir presence, baris 114)

**Interfaces:** — (dokumen; tak ada kode)

- [ ] **Step 1: Status ADR**

`0165` baris 3-5, ganti tiga baris `**Status:** diterima (SPEC-1215, fase Spec) · 2026-09-15 · **implementasi menyusul** lewat turunan` … `memuat satu pun perilaku di bawah.` dengan:

```md
**Status:** diterima (SPEC-1215, fase Spec) · 2026-09-15 · **turunan A mendarat** (SPEC-1215): §1 socket
relay, §3 principal `remote`, §4 grant + `/api/remote-control`, §5 allowlist, §7 pencabutan seketika, dan
§9 frame `capacity` + `control`. **Menyusul:** §6 approval/`force`/langganan dan §8 satu sesi lintas
instance di SPEC-1216 (turunan B); stream, resize, dan §10 backpressure di SPEC-1218 (turunan C). Koreksi
fase Plan atas spec dicatat di spec §S13.
```

`0166` baris 3-5, ganti `**Status:** … dikerjakan turunan D.` dengan:

```md
**Status:** diterima (SPEC-1215, fase Spec) · 2026-09-15 · **sebagian mendarat (turunan A)**: model
`LogEntry`/`LogCursor` (migration `20260915120000_log_terpusat`), `appendEvent` ber-seq HLC, hook sesi
aditif, dan tap lokal `session.start`/`session.end`/`remote.request`/`remote.link`/`grant.changed`.
**Menyusul di SPEC-1217 (turunan D):** pengiriman, ingest, redaksi, pencarian, retensi, lajur
`server`/`transcript`, serta tap `session.phase`/`session.result`/`launch.rejected`/`log.gap`.
```

- [ ] **Step 2: Penanda amandemen**

- `0046`: `(dirancang,` + baris berikut `> berlaku saat turunan A mendarat):**` → `(berlaku sejak turunan A mendarat, SPEC-1215):**` (satu baris).
- `0147`: `(0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) (dirancang):**` → `(0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) (butir 1, 2, 4 berlaku sejak turunan A; butir 3 menyusul SPEC-1216):**`
- `0065`: `(0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) (dirancang):**` → `(0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) (berlaku sejak turunan A untuk principal `remote` dan top `remote-control`; top `devices` & `logs` lahir bersama SPEC-1216/SPEC-1217):**`
- `0148`, `0135`, `0117`, `0161`, `0120`, `0079`: **biarkan** `(dirancang)` — milik SPEC-1216/SPEC-1217.

- [ ] **Step 3: Architecture, security, frontend, operations**

`api-contract.md` baris 1405: ganti `— **DIRANCANG, belum ada di kode**` dengan `— **sebagian mendarat (turunan A)**`. Ganti blok status 4 baris (`> **Status:** kontrak dikunci fase Spec 2026-09-15. Implementasi lewat turunan A–D` … `> di bawah dilayani server.`) dengan:

```md
> **Status:** kontrak dikunci fase Spec 2026-09-15.
> **Dilayani sejak turunan A (SPEC-1215):** `GET /sync/relay/ws` (hub; `welcome`/`req`/`cancel` ↔
> `hello`/`res`; klien A menjawab `open` dengan `close 4502`), frame naik `capacity` +
> `devices[].control|capacity` di `GET /presence`, `DELETE /device-tokens/:id` yang menutup socket sebelum
> 204, `GET|PUT /remote-control` (tanpa `shipping` — menyusul SPEC-1217), gate principal `remote`, dan
> `PUT /settings` yang mempertahankan tiga kunci baru.
> **Belum dilayani:** `/devices/:deviceId/relay/*` dan tiket `relay:*` (SPEC-1216/SPEC-1218), `POST /sync/logs`
> dan `/logs*` (SPEC-1217), perubahan `POST /terminal/sessions` & `POST /specs/:id/done` (SPEC-1216).
```

Lalu jalankan `grep -n "presence" internal/docs/architecture/api-contract.md` untuk menemukan daftar top cookie-only agent token (§Agent tokens) dan tambahkan `remote-control` tepat sesudah `presence` di daftar itu dengan catatan `(SPEC-1215 · ADR-0165)`.

`data-model.md` baris 284: `**DIRANCANG, belum di \`zSetting\`**) — LOCAL-only, tanpa migration.` → `sudah di \`zSetting\` sejak turunan A; \`logShipping\`/\`logRetention\` baru dibaca SPEC-1217) — LOCAL-only, tanpa migration.` Baris 726: `— **DIRANCANG, belum ada di skema**` → `— skema mendarat di turunan A (SPEC-1215); ingest, pencarian, retensi di SPEC-1217`.

`stack.md` baris 41: `— DIRANCANG (SPEC-1215 ·` → `— turunan A mendarat (SPEC-1215 ·`; baris 43: `), belum ada di kode.**` → `); B/C/D = SPEC-1216/SPEC-1218/SPEC-1217.**`

`threat-model.md` baris 150: akhir judul `) — DIRANCANG` → `) — sebagian mendarat (turunan A: grant, gate \`remote\`, allowlist, pencabutan seketika; sisanya SPEC-1216/1217/1218)`.

`frontend-implementation.md` baris 43: `- **Kendali & tampilan klien dari hub — DIRANCANG** (SPEC-1215 ·` → `- **Kendali & tampilan klien dari hub — sebagian mendarat** (SPEC-1215 ·`; baris 45 `  belum ada di kode.` → `  \`RemoteControlPanel\` (Settings → Kendali jarak jauh) mendarat di turunan A tanpa toggle lajur log (SPEC-1217); sisanya DIRANCANG untuk SPEC-1216/SPEC-1218.`

`operations/production.md` baris 90: `menyiarkan \`GET /api/sync/ws\`. |` → `menyiarkan \`GET /api/sync/ws\`, menerima \`GET /api/sync/relay/ws\` (SPEC-1215 — reverse proxy wajib meneruskan upgrade keduanya). |`

- [ ] **Step 4: Index & skill**

`internal/docs/README.md` baris 105-106: ganti kedua kemunculan `**dirancang (SPEC-1215)**` dengan `**turunan A mendarat (SPEC-1215)**`.
`internal/docs/adr/README.md`: `SPEC-1215 (dirancang; tabel & tap event di turunan A, sisanya turunan D)` → `SPEC-1215 (tabel & tap event lokal mendarat di turunan A; sisanya SPEC-1217)`; `SPEC-1215 (dirancang; turunan A/B/C)` → `SPEC-1215 (turunan A mendarat; B = SPEC-1216, C = SPEC-1218)`.

`internal/skills/hanoman/SKILL.md`: sisipkan sesudah baris `  \`stopSyncClient()\` (socket yatim ber-token lama sesudah \`applySyncConfig()\`).`:

```md
- **Kendali jarak jauh hub → klien, turunan A** (SPEC-1215/**ADR-0165**+**ADR-0166**): klien yang grant
  LOCAL-only `Setting.data.remoteControl`-nya dinyalakan cookie lewat `PUT /api/remote-control` membuka
  socket KEDUA `ws://<hub>/api/sync/relay/ws` (device token); grant mati = nol upgrade. Hub mengirim `req`
  ke route yang SUDAH ada dan dispatcher klien menjalankannya lewat `app.inject`. **Lima gotcha:**
  (1) principal `remote` sah hanya bila header `x-hanoman-relay` = rahasia proses **dan**
  `req.raw.socket` bukan `net.Socket` — header dari jaringan 401 walau rahasianya benar; (2)
  `relayRouteAllowed` adalah lapis kedua di atas capability (`backlog:write` lewat relay hanya
  `POST /specs/:id/done`), dan body `POST /terminal/sessions` dinilai di `preHandler` karena `onRequest`
  belum punya body; (3) `PUT /api/settings` mempertahankan `remoteControl`/`logShipping`/`logRetention`;
  (4) `registerSessionHooks` kini aditif dan mengembalikan pencabut — jangan "mereset" dengan `{}`;
  (5) `DELETE /device-tokens/:id` menutup socket sync + relay sebelum 204 lewat `device-sockets.ts`.
  Audit `remote.*`/`grant.changed` hidup di `LogEntry` `deviceId:"local"`. Route HTTP relay di hub,
  stream tampilan, dan log terpusat: SPEC-1216 / SPEC-1218 / SPEC-1217.
```

- [ ] **Step 5: Integritas index**

Run: `hanoman docs index --check`
Expected: `index ok`.

- [ ] **Step 6: Commit**

```bash
git add internal/docs internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-1215): cabut penanda DIRANCANG bagian turunan A"
```

### Task 16: Verifikasi akhir + smoke API nyata dua instance

**Files:** — (tak ada perubahan kecuali perbaikan yang ditemukan; setiap perbaikan kembali ke task asalnya dengan test merah dulu)

- [ ] **Step 1: Typecheck paket tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck && pnpm --filter ./cli typecheck`
Expected: keempatnya tanpa error.

- [ ] **Step 2: Test yang tersentuh sejak base**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "${HANOMAN_BASE_SHA:-67478d09c611ed926620eaa8c69c4213d5486ef0}" --no-file-parallelism`
Expected: seluruh berkas PASS; jumlah berkas > 0 (`--changed` menyalakan `passWithNoTests`, jadi nol berkas = hijau palsu — bila nol, jalankan ulang dengan path eksplisit dari Task 1–14). Gagal ramai 404/P2022 = isolasi DB/env, bukan regresi.

- [ ] **Step 3: Index docs**

Run: `hanoman docs index --check`
Expected: `index ok`.

- [ ] **Step 4: Boot hub + klien (dua `HANOMAN_HOME`, dua port)**

```bash
S=$(mktemp -d); mkdir -p "$S/hub" "$S/klien"
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-1215
for n in hub klien; do
  env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_PUBLIC_ORIGINS DATABASE_URL="file:$S/$n/hanoman.db" \
    pnpm --filter ./server exec prisma migrate deploy --schema prisma/schema.prisma
done
env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_PUBLIC_ORIGINS -u SYNC_SERVER_URL -u SYNC_DEVICE_TOKEN \
  HANOMAN_HOME="$S/hub" DATABASE_URL="file:$S/hub/hanoman.db" PORT=18787 HANOMAN_UPDATE_FETCH=0 HANOMAN_TMUX_SOCKET=hanoman-smoke-hub \
  pnpm --filter ./server exec tsx src/server.ts > "$S/hub.log" 2>&1 &
echo $! > "$S/hub.pid"
until curl -sf http://127.0.0.1:18787/api/health >/dev/null; do sleep 1; done
curl -s -c "$S/hub.jar" -H 'content-type: application/json' -d '{"email":"op@hub.test","password":"password1"}' http://127.0.0.1:18787/api/auth/setup
curl -s -b "$S/hub.jar" -H 'content-type: application/json' -d '{"name":"klien-smoke"}' http://127.0.0.1:18787/api/device-tokens > "$S/device.json"
DEV_ID=$(node -e 'console.log(require(process.argv[1]).id)' "$S/device.json")
DEV_TOKEN=$(node -e 'console.log(require(process.argv[1]).token)' "$S/device.json")
env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_PUBLIC_ORIGINS \
  HANOMAN_HOME="$S/klien" DATABASE_URL="file:$S/klien/hanoman.db" PORT=18788 HANOMAN_UPDATE_FETCH=0 HANOMAN_TMUX_SOCKET=hanoman-smoke-klien \
  SYNC_SERVER_URL=http://127.0.0.1:18787 SYNC_DEVICE_TOKEN="$DEV_TOKEN" \
  pnpm --filter ./server exec tsx src/server.ts > "$S/klien.log" 2>&1 &
echo $! > "$S/klien.pid"
until curl -sf http://127.0.0.1:18788/api/health >/dev/null; do sleep 1; done
curl -s -c "$S/klien.jar" -H 'content-type: application/json' -d '{"email":"op@klien.test","password":"password1"}' http://127.0.0.1:18788/api/auth/setup
```

Expected: kedua `/api/health` menjawab `{"ok":true}`; `device.json` berisi `id` dan `token`.

- [ ] **Step 5: Curl endpoint yang tersentuh**

```bash
# (a) default mati: tanpa socket relay
curl -s -b "$S/klien.jar" http://127.0.0.1:18788/api/remote-control
# (b) AC-A6 nyata: header relay dari jaringan
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-hanoman-relay: palsu' http://127.0.0.1:18788/api/terminal/sessions
# (c) query token di relay hub
curl -s -o /dev/null -w '%{http_code}\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' 'http://127.0.0.1:18787/api/sync/relay/ws?token=x'
# (d) AC-A2: nyalakan grant → relay open, hub melihat control + capacity
curl -s -b "$S/klien.jar" -X PUT -H 'content-type: application/json' \
  -d '{"control":{"enabled":true,"capabilities":["sessions:read","backlog:read","ide:read"]}}' http://127.0.0.1:18788/api/remote-control
sleep 5
curl -s -b "$S/klien.jar" http://127.0.0.1:18788/api/remote-control
curl -s -b "$S/hub.jar" http://127.0.0.1:18787/api/presence
# (e) AC-A3: PUT /settings tak bisa mematikan/menyalakan grant
curl -s -b "$S/klien.jar" http://127.0.0.1:18788/api/settings \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);x.remoteControl={enabled:false,capabilities:[]};process.stdout.write(JSON.stringify(x))})' \
  | curl -s -b "$S/klien.jar" -X PUT -H 'content-type: application/json' --data-binary @- http://127.0.0.1:18788/api/settings >/dev/null
curl -s -b "$S/klien.jar" http://127.0.0.1:18788/api/remote-control
# (f) AC-A5: matikan grant → relay tertutup; hub control null
curl -s -b "$S/klien.jar" -X PUT -H 'content-type: application/json' -d '{"control":{"enabled":false,"capabilities":["sessions:read"]}}' http://127.0.0.1:18788/api/remote-control
sleep 2
curl -s -b "$S/hub.jar" http://127.0.0.1:18787/api/presence
# (g) AC-A4: nyalakan lagi, lalu cabut device token di hub
curl -s -b "$S/klien.jar" -X PUT -H 'content-type: application/json' -d '{"control":{"enabled":true,"capabilities":["sessions:read"]}}' http://127.0.0.1:18788/api/remote-control
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' -b "$S/hub.jar" -X DELETE "http://127.0.0.1:18787/api/device-tokens/$DEV_ID"
sleep 3
curl -s -b "$S/klien.jar" http://127.0.0.1:18788/api/remote-control
```

Expected:
- (a) `control.enabled:false`, `relay.state:"off"`, `audit:[]`.
- (b) `401`. (c) `401`.
- (d) PUT → `control.enabled:true`; GET klien → `relay.state:"open"`, `relay.hubOrigin:"http://127.0.0.1:18787"`, audit memuat `grant.changed` dan `remote.link`; presence hub → device `klien-smoke` dengan `control.state:"available"` dan `capacity` berisi `maxConcurrent` (bila `capacity` masih `null`, tunggu satu tick 3 dtk lalu ulangi).
- (e) GET sesudah PUT settings → `control.enabled:true` tetap.
- (f) PUT → `relay.state:"off"`; presence hub → `control:null` untuk device itu.
- (g) DELETE → `204`; GET klien → `relay.state` `"backoff"` atau `"rejected"` dengan `lastClose.code` `1008` atau `401`; `hub.log` tak memuat stack trace.

- [ ] **Step 6: Matikan kedua instance per-PID (JANGAN `pkill -f`)**

```bash
kill "$(cat "$S/klien.pid")" "$(cat "$S/hub.pid")"
tmux -L hanoman-smoke-hub kill-server 2>/dev/null; tmux -L hanoman-smoke-klien kill-server 2>/dev/null; true
```

Catatan: `pnpm exec` bisa meninggalkan proses anak `tsx`; bila `lsof -ti:18787` / `lsof -ti:18788` masih memberi PID, `kill <pid>` satu per satu.

- [ ] **Step 7: Centang plan & commit akhir**

Centang setiap step yang selesai di berkas plan ini (`- [ ]` → `- [x]`), lalu:

```bash
git add docs/superpowers/plans/2026-09-15-spec-1215-a-fondasi-kanal-relay.md
git commit -m "docs(spec-1215): centang plan turunan A"
```

Jangan `git push` (milik orchestrator).

---

## Self-review — cakupan AC → task

| AC | Bukti di plan |
|---|---|
| AC-A1 grant mati = nol upgrade | Task 11 `relay-client.test.ts` "grant mati = NOL upgrade" |
| AC-A2 grant menyala → hello ≤ 5 dtk | Task 11 (start dengan grant menyala) + Task 12 `remote-control.relay.test.ts` (PUT menyalakan) + Task 16 (d) |
| AC-A3 `PUT /settings` mempertahankan; non-cookie 403 | Task 3 `settings-remote-keys.test.ts`; Task 12 agent token 403; Task 16 (e) |
| AC-A4 cabut token → sync + relay 1008 sebelum 204 | Task 7 + Task 10 Step 8 `device-token-revoke.test.ts`; Task 16 (g) |
| AC-A5 grant berubah → relay tertutup sebelum PUT membalas | Task 11 `refreshRelayClient` + Task 12 `remote-control.relay.test.ts`; Task 16 (f) |
| AC-A6 header relay dari jaringan → 401 (HTTP & WS) | Task 8 `relay-gate.test.ts` (listen nyata); Task 16 (b) |
| AC-A7 di luar allowlist/capability → 403 tanpa handler | Task 1 tabel; Task 8 (PATCH spec tak berubah); Task 9 (inject tak dipanggil) |
| AC-A8 audit `remote.request` beraktor | Task 9 unit audit + Task 11 e2e baris `LogEntry` |
| AC-A9 protokol beda → 4001 + `protocol-mismatch` | Task 10 unit + route |
| AC-A10 frame `capacity`; hub lama tetap sync | Task 2 (`zPresenceFrame` menolak frame capacity) + Task 13 |
| AC-A11 kegagalan relay tak menutup sync | Task 10 route (4001 dan 1009, sync tetap OPEN) |
| AC-A12 upgrade 404 → unsupported ≥ 30 mnt | Task 11 server penghitung upgrade |
| AC-M1 tanpa hub/app = nol relay | Task 11 "instance tanpa app" + wiring hanya dari `startSyncClient` |
| AC-M2 hub tak terjangkau tak memblokir | Task 11 "start tak memblokir, lalu backoff" |

Pemeriksaan konsistensi nama yang dilakukan penulis plan: `relaySecret`/`isRelaySecret`/`isInProcessRequest` (Task 8) dipakai Task 9; `encodeRelayActor`/`decodeRelayActor` (Task 8) dipakai Task 9 & test; `appendEvent`/`recentAudit`/`__resetEventLog` (Task 6) dipakai Task 9, 11, 12; `registerDeviceSocket`/`closeDeviceSockets`/`deviceSocketCount`/`__resetDeviceSockets` (Task 7) dipakai Task 10 & 13; `attachRelaySocket`/`requestRelay`/`relayControlFor`/`__resetRelayHub` (Task 10) dipakai Task 11, 12, 13; `installRelayClient`/`startRelayClient`/`stopRelayClient`/`refreshRelayClient`/`relayClientStatus`/`__resetRelayClient`/`__relayClientLastDelayMs` (Task 11) dipakai Task 12; `injectableFrom` (Task 9) dipakai Task 11 & 12; `recordCapacity`/`capacityFor` (Task 13); `RemoteControlView`/`RemoteControlPut`/`RelayLinkState` (Task 1) dipakai Task 12 & 14.

