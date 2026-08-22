# SPEC-908 — Langganan berparameter di `/api/events/ws` · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empat layar dashboard (Scheduler, Triage, Lead, GitGraph) berhenti men-poll HTTP dan menerima pembaruannya lewat langganan berparameter di WebSocket siar `/api/events/ws` yang sudah ada.

**Architecture:** Kanal `/api/events/ws` menerima **satu** jenis frame masuk (`{t:"sub", subs:[…]}`) dengan semantik ganti-penuh. Server menyimpan entri langganan berkunci `subKey(topic, params)` — dihitung fungsi murni yang **sama** di kedua sisi — sehingga N klien berparameter identik berbagi satu `build`, satu `JSON.stringify`, dan satu dedup signature. Delapan grup global ADR-0039 tidak disentuh. Klien memuat awal lewat HTTP seperti sekarang; WS hanya menyegarkan, dan `setInterval` fallback hanya menyala saat ada **bukti** server tak punya topiknya (`hello`) atau socket bisu 15 dtk.

**Tech Stack:** TypeScript strict · Fastify + `@fastify/websocket` · zod 3 · React 18 + Vite · vitest 2 (jsdom untuk `src`, node untuk `server`/`shared`)

## Global Constraints

- **Endpoint HTTP tidak ada yang dihapus.** MCP, agent token, portal klien, dan dashboard versi lama memakainya (ADR-0087: dashboard boleh lebih baru daripada server yang dilayaninya).
- **Tidak ada koneksi WebSocket kedua.** `MAX_CONNECTIONS_PER_PRINCIPAL` = 8 (`server/src/services/ws-admission.ts:10`) tak boleh naik; semua langganan multipleks di socket yang sudah ada.
- **Kanal WS terminal (`server/src/services/pty.ts`) dan jalur ketikan/echo prediktif (SPEC-856/860/878/882) tidak disentuh sama sekali.**
- **Tak boleh memblokir event loop.** Semua `build` topik wajib async; **dilarang** memakai `listSessions()` (`execFileSync`, terukur 6,28 ms–916 ms per panggilan) — pakai `listSessionsAsync`.
- **Silent refresh dipertahankan.** Pembaruan yang datang tak boleh menyentuh state `loading`/`error` maupun mem-blank data saat gagal.
- **Filter, nomor halaman, dan opsi graph yang sedang aktif tetap dihormati** (SPEC-523, SPEC-740, ADR-0107, ADR-0115). `limit` tetap plafon — tak pernah dipulihkan dari storage, dan dijepit server.
- **Auth tak dilonggarkan.** `admitBrowserWs` + `revalidateWsPrincipal` apa adanya. Frame `sub` hanya dilayani principal `kind === "user"` (dan `"test"` saat `NODE_ENV=test`).
- Kadens topik baru: `schedulerState` 2 000 ms · `schedulerQueue` 3 000 ms · `tickets` 3 000 ms · `lead` 4 000 ms · `git` 4 000 ms. Semuanya ≤ kadens polling hari ini (5 000/5 000/5 000/5 000/4 000 ms).
- Batas frame masuk: `MAX_WS_MESSAGE_BYTES` = 64 KiB (sudah ada), `subs` ≤ **16** entri, parameter zod `.strict()`, topik tak dikenal **dilewati per-entri** (frame tidak dijatuhkan).
- Docs `internal/docs/**` yang tersentuh diperbarui **dalam commit yang sama** dan ter-link di `internal/docs/README.md`.

### Perintah verifikasi baku

Mesin ini menjalankan beberapa sesi sekaligus. **Selalu** pakai bentuk ini — DB test diturunkan dari `HANOMAN_HOME`, bukan dari checkout, jadi run tetangga akan menghapus DB di tengah run kita (SPEC-479):

```bash
# test server / shared
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism <path…>

# test klien (jsdom, tanpa DB)
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run <path…>

# typecheck paket yang tersentuh saja
pnpm --filter ./shared typecheck    # atau ./server, ./src
```

**Jangan** `pnpm test`, `vitest run` polos, atau `pnpm -r typecheck`. Suite penuh adalah tugas manusia sebelum merge.

---

## Struktur berkas

**Dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `server/src/services/events-topics.ts` | Registry topik: kadens + `build(params)` per topik. Tahu **apa** yang dihitung, tak tahu siapa pelanggannya. |
| `server/src/services/scheduler/state.ts` | `buildSchedulerState()` — satu definisi untuk route HTTP & hub. |
| `server/src/services/tickets-list.ts` | `buildTicketsPage()` — idem. |
| `server/src/services/lead/views.ts` | `buildLeadStatus()` / `buildLeadDecisions()` / `buildLeadFlows()` — idem. |
| `server/src/services/repo-dir.ts` | `repoOf()` dipindah dari `routes/ide.ts` supaya service bisa memakainya. |
| `src/src/api/live.ts` | `useLiveTopic` — satu tempat untuk "kapan menyegarkan" + degradasi. |
| `src/src/ds/components/live.tsx` | `LiveConnectionBadge` — indikator koneksi mati, design-system compliant. |
| `shared/test/events-topics.test.ts` | Kontrak `subKey` + `zTopicParams`. |
| `server/test/events-subscriptions.test.ts` | Kontrak hub berlangganan. |
| `server/test/events-sub-frame.test.ts` | Gerbang frame masuk di route (principal, bentuk, batas). |
| `src/test/events-topics.test.ts` | Klien: frame `sub`, coalesce, re-kirim, `hello`, fallback. |

**Diubah:**

| Berkas | Perubahan |
|---|---|
| `shared/src/dto.ts` | `GraphCommit`/`RepoStatus`/`Stash` pindah ke sini; `EventTopic`, `zTopicParams`, `subKey`, `zEventsClientMsg`, 6 varian `EventMsg` baru. |
| `server/src/services/git-ide.ts` | Re-export tiga tipe dari shared; tambah `buildGitLive()`. |
| `src/src/api/client.ts` | Re-export tiga tipe dari shared (hapus definisi kembarnya). |
| `server/src/services/events.ts` | Peta `entries`, `subscribeClient()`, tick entri non-blocking, `hello` saat attach, sapu di `detach`/`__reset`; `WireMsg` disempitkan ke `EventMsg`. |
| `server/src/routes/events.ts` | `socket.on("message")` bergerbang principal + `WsMessageMeter`. |
| `server/src/routes/scheduler.ts` | Body `/scheduler/state` & `/scheduler/queue` → panggil service. |
| `server/src/routes/tickets.ts` | Body `GET /tickets` → panggil service. |
| `server/src/routes/lead.ts` | Body `/lead/status`, `/lead/decisions`, `/lead/flows` → panggil service. |
| `server/src/routes/ide.ts` | `repoOf` diimpor dari service. |
| `server/src/services/scheduler/queue.ts` | Tambah `buildQueuePage()`. |
| `src/src/api/events.ts` | `subscribeTopic`, `eventsTopics`, `subscribeTopics`. |
| `src/src/ds/index.ts` | Ekspor `LiveConnectionBadge`. |
| `src/src/screens/{SchedulerScreen,TriageScreen,LeadScreen,GitGraph}.tsx` | Ganti `setInterval` dengan `useLiveTopic`; pasang indikator. |
| `internal/docs/architecture/{api-contract,stack}.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/docs/README.md`, `internal/docs/adr/<baru>.md` | Docs. |

---

## Task 1: Kontrak wire di `shared`

**Files:**
- Modify: `shared/src/dto.ts`
- Modify: `server/src/services/git-ide.ts:53,60,95`
- Modify: `src/src/api/client.ts:59,88,89`
- Test: `shared/test/events-topics.test.ts` (create)

**Interfaces:**
- Produces: `EventTopic`, `TopicParams`, `zTopicParams`, `subKey(topic, params): string`, `MAX_SUBS`, `zEventsClientMsg`, `EventsClientMsg`, dan enam varian `EventMsg` baru (`hello`, `schedulerState`, `schedulerQueue`, `tickets`, `lead`, `git`). Juga memindahkan `GraphCommit`, `RepoStatus`, `Stash` ke `@hanoman/shared`.

- [x] **Step 1: Buktikan ketiga tipe git memang kembar identik sebelum dipindah**

Run:
```bash
diff <(sed -n '59p;88p;89p' src/src/api/client.ts) <(sed -n '53p;95p' server/src/services/git-ide.ts; sed -n '60,63p' server/src/services/git-ide.ts | tr -d '\n' | sed 's/  */ /g')
```
Ini pembanding kasar; yang mengikat adalah `pnpm --filter ./src typecheck` di Step 8. Catat: `GraphCommit` dan `Stash` byte-identik; `RepoStatus` identik isinya, hanya beda pembungkus baris.

- [x] **Step 2: Tulis test yang gagal**

Create `shared/test/events-topics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { subKey, zTopicParams, zEventsClientMsg, MAX_SUBS, type EventTopic } from "../src/dto";

describe("SPEC-908 · kunci langganan", () => {
  it("stabil terhadap urutan kunci — dua tab berparameter sama harus berbagi satu entri", () => {
    const a = subKey("tickets", { page: 2, limit: 20, q: "bug" });
    const b = subKey("tickets", { q: "bug", limit: 20, page: 2 });
    expect(a).toBe(b);
  });

  it("membuang `undefined` — filter kosong dan filter absen adalah langganan yang SAMA", () => {
    expect(subKey("tickets", { page: 1, limit: 20, project: undefined }))
      .toBe(subKey("tickets", { page: 1, limit: 20 }));
  });

  it("beda parameter = beda kunci, dan beda topik = beda kunci", () => {
    expect(subKey("tickets", { page: 1 })).not.toBe(subKey("tickets", { page: 2 }));
    expect(subKey("tickets", { page: 1 })).not.toBe(subKey("lead", { page: 1 } as never));
  });
});

describe("SPEC-908 · skema parameter topik", () => {
  it("menolak kunci asing — `.strict()`, bukan diabaikan", () => {
    const r = zTopicParams.schedulerQueue.safeParse({ status: "queued", page: 1, limit: 10, evil: 1 });
    expect(r.success).toBe(false);
  });

  it("menjepit plafon: limit di atas batas ditolak (ADR-0107)", () => {
    expect(zTopicParams.tickets.safeParse({ page: 1, limit: 5000 }).success).toBe(false);
    expect(zTopicParams.tickets.safeParse({ page: 1, limit: 20 }).success).toBe(true);
  });

  it("git wajib punya projectId dan flag boolean yang eksplisit", () => {
    expect(zTopicParams.git.safeParse({ limit: 200, branch: "", showRemote: true, showTags: true }).success).toBe(false);
    expect(zTopicParams.git.safeParse({
      projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true,
    }).success).toBe(true);
  });

  it("menolak string yang terlalu panjang (permukaan masuk berbatas)", () => {
    expect(zTopicParams.tickets.safeParse({ page: 1, limit: 20, q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("SPEC-908 · frame masuk", () => {
  it("menerima frame `sub` yang sah", () => {
    const r = zEventsClientMsg.safeParse({ t: "sub", subs: [{ topic: "tickets", params: { page: 1, limit: 20 } }] });
    expect(r.success).toBe(true);
  });

  it("menolak `subs` lebih dari MAX_SUBS", () => {
    const subs = Array.from({ length: MAX_SUBS + 1 }, () => ({ topic: "tickets", params: {} }));
    expect(zEventsClientMsg.safeParse({ t: "sub", subs }).success).toBe(false);
  });

  it("menolak frame dengan `t` lain — ini satu-satunya frame masuk yang ada", () => {
    expect(zEventsClientMsg.safeParse({ t: "write", d: "rm -rf /" }).success).toBe(false);
  });

  it("topik tak dikenal LOLOS parse — penyaringannya per-entri di server (ADR-0087)", () => {
    const r = zEventsClientMsg.safeParse({ t: "sub", subs: [{ topic: "masaDepan", params: {} }] });
    expect(r.success).toBe(true);
  });
});

describe("SPEC-908 · setiap topik punya skema", () => {
  it("kunci zTopicParams menutupi seluruh EventTopic", () => {
    const topics: EventTopic[] = ["schedulerState", "schedulerQueue", "tickets", "lead", "git"];
    expect(Object.keys(zTopicParams).sort()).toEqual([...topics].sort());
  });
});
```

- [x] **Step 3: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run shared/test/events-topics.test.ts`
Expected: FAIL — `subKey`, `zTopicParams`, `zEventsClientMsg`, `MAX_SUBS` tak diekspor dari `../src/dto`.

- [x] **Step 4: Pindahkan tiga tipe git ke `shared/src/dto.ts`**

Tambahkan di `shared/src/dto.ts`, tepat sebelum blok `EventMsg` (cari `export type EventMsg`):

```ts
// SPEC-908 · dipindah dari server/src/services/git-ide.ts + src/src/api/client.ts, yang dulu
// mendeklarasikannya KEMBAR tanpa ikatan tipe apa pun. Frame `git` di EventMsg memaksa keduanya
// menjadi satu definisi; kedua berkas lama kini me-re-export dari sini.
export type GraphCommit = { sha: string; parents: string[]; author: string; at: string; subject: string; refs: string[]; tags: string[] };
export type RepoStatus = {
  branch: string; ahead: number; behind: number;
  staged: string[]; unstaged: string[]; untracked: string[]; clean: boolean;
};
export type Stash = { ref: string; message: string; at: string };
```

- [x] **Step 5: Tambahkan kontrak topik di `shared/src/dto.ts`**

Tambahkan setelah blok Step 4:

```ts
// SPEC-908 · topik langganan BERPARAMETER di /events/ws, mengamandemen ADR-0039 (yang hanya
// mengenal snapshot global tanpa parameter). Nama topik SENGAJA identik dengan `t` frame keluarnya:
// satu-ke-satu, jadi tak ada peta kedua yang bisa berselisih diam-diam.
export type EventTopic = "schedulerState" | "schedulerQueue" | "tickets" | "lead" | "git";

/** Plafon jumlah langganan per klien. Satu layar Scheduler = 5 (state + 4 QueueSection). */
export const MAX_SUBS = 16;

const zPage = z.number().int().min(1).max(10_000);
// ADR-0107 · `limit` adalah PLAFON, bukan preferensi: dijepit di sini persis seperti di route HTTP.
const zLimit = z.number().int().min(1).max(200);

export const zTopicParams = {
  schedulerState: z.object({}).strict(),
  schedulerQueue: z.object({
    status: z.enum(["queued", "launched", "done", "failed", "canceled"]),
    page: zPage, limit: zLimit,
  }).strict(),
  tickets: z.object({
    project: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    q: z.string().max(200).optional(),
    page: zPage, limit: zLimit,
  }).strict(),
  lead: z.object({
    projectId: z.string().max(120).optional(),
    decPage: zPage, flowPage: zPage, limit: zLimit,
  }).strict(),
  git: z.object({
    projectId: z.string().max(120),
    limit: z.number().int().min(1).max(20_000),
    branch: z.string().max(200),
    showRemote: z.boolean(), showTags: z.boolean(),
  }).strict(),
} as const;

export type TopicParams = { [K in EventTopic]: z.infer<(typeof zTopicParams)[K]> };

// Kunci kanonik sebuah langganan, dihitung fungsi yang SAMA di server dan klien. Kalau id datang
// dari klien, dua tab berparameter identik menerima frame yang berbeda byte dan dedup signature
// ADR-0039 hilang — di sini keduanya menerima string yang sama persis.
export function subKey(topic: EventTopic, params: Record<string, unknown>): string {
  const canon: Record<string, unknown> = {};
  for (const k of Object.keys(params).sort()) if (params[k] !== undefined) canon[k] = params[k];
  return `${topic}|${JSON.stringify(canon)}`;
}

// Satu-satunya frame klien → server. Semantik GANTI-PENUH: frame ini mengganti seluruh himpunan
// langganan klien, jadi tak ada frame `unsubscribe` dan re-kirim saat reconnect identik dengan
// pemasangan pertama. `topic` sengaja `string`, bukan enum: dashboard boleh lebih baru daripada
// server (ADR-0087), jadi topik masa depan harus DILEWATI per-entri, bukan menjatuhkan frame.
export const zEventsClientMsg = z.object({
  t: z.literal("sub"),
  subs: z.array(z.object({
    topic: z.string().max(40),
    params: z.record(z.unknown()),
  })).max(MAX_SUBS),
}).strict();
export type EventsClientMsg = z.infer<typeof zEventsClientMsg>;
```

- [x] **Step 6: Tambahkan enam varian `EventMsg`**

Di `shared/src/dto.ts`, pada union `EventMsg` (setelah `| { t: "update"; update: UpdateStatus };` — ubah titik-koma jadi lanjutan union):

```ts
  | { t: "update"; update: UpdateStatus }
  // SPEC-908 · frame langganan berparameter. `key` = subKey(topic, params) yang dihitung KEDUA
  // sisi; klien membuang frame yang kuncinya bukan miliknya, jadi halaman/filter yang sedang
  // aktif tak mungkin ditimpa muatan halaman lain.
  | { t: "hello"; topics: EventTopic[] }
  | { t: "schedulerState"; key: string; state: SchedulerStateView }
  | { t: "schedulerQueue"; key: string; data: Paginated<SchedulerQueueItemView> }
  | { t: "tickets"; key: string; data: Paginated<TicketView> & { unreviewed: number } }
  | { t: "lead"; key: string; status: LeadStatusView;
      decisions: Paginated<LeadDecisionView>; flows: Paginated<LeadFlowView> }
  | { t: "git"; key: string; graph: { commits: GraphCommit[]; current: string; total: number };
      status: RepoStatus; stashes: Stash[] };
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run shared/test/events-topics.test.ts`
Expected: PASS — 11 test.

- [x] **Step 8: Buang definisi kembar di server & klien**

Di `server/src/services/git-ide.ts`, ganti baris 53, blok 60-63, dan baris 95 dengan satu re-export dekat impor teratas:

```ts
import type { GraphCommit, RepoStatus, Stash } from "@hanoman/shared";
export type { GraphCommit, RepoStatus, Stash } from "@hanoman/shared";
```

Di `src/src/api/client.ts`, ganti baris 59, 88, dan 89 dengan:

```ts
export type { GraphCommit, RepoStatus, Stash } from "@hanoman/shared";
```

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: nol error. Kalau ada `Cannot find name 'RepoStatus'` di `git-ide.ts`, itu karena `import type` di atas terlewat — fungsi `repoStatus` memakainya sebagai anotasi.

- [x] **Step 9: Commit**

```bash
git add shared/src/dto.ts shared/test/events-topics.test.ts server/src/services/git-ide.ts src/src/api/client.ts
git commit -m "feat(events): kontrak topik langganan berparameter di shared (SPEC-908)

GraphCommit/RepoStatus/Stash dulu dideklarasikan KEMBAR di server dan klien tanpa
ikatan tipe apa pun; frame \`git\` memaksa keduanya jadi satu definisi di shared.
subKey dihitung fungsi yang sama di kedua sisi supaya N klien berparameter identik
menerima string yang sama persis dan dedup signature ADR-0039 tetap berlaku."
```

---

## Task 2: Satu definisi per muatan — ekstraksi builder ke service

**Files:**
- Create: `server/src/services/scheduler/state.ts`, `server/src/services/tickets-list.ts`, `server/src/services/lead/views.ts`, `server/src/services/repo-dir.ts`
- Modify: `server/src/services/scheduler/queue.ts`, `server/src/services/git-ide.ts`, `server/src/routes/scheduler.ts:58-98`, `server/src/routes/tickets.ts:22-36`, `server/src/routes/lead.ts:34-99`, `server/src/routes/ide.ts:31-35,247-281`
- Test: `server/test/events-builders.test.ts` (create)

**Interfaces:**
- Consumes: `TopicParams`, `Paginated`, `GraphCommit`/`RepoStatus`/`Stash` (Task 1).
- Produces:
  - `buildSchedulerState(): Promise<SchedulerStateView>`
  - `buildQueuePage(f: TopicParams["schedulerQueue"]): Promise<Paginated<SchedulerQueueItemView>>`
  - `buildTicketsPage(f: TopicParams["tickets"]): Promise<Paginated<TicketView> & { unreviewed: number }>`
  - `buildLeadStatus(): Promise<LeadStatusView>`
  - `buildLeadDecisions(f): Promise<Paginated<LeadDecisionView>>`, `buildLeadFlows(f): Promise<Paginated<LeadFlowView>>`
  - `buildGitLive(repoDir: string | null, p: TopicParams["git"]): Promise<{ graph: {commits; current; total}; status: RepoStatus; stashes: Stash[] }>`
  - `repoOf(id: string): Promise<string | null | undefined>` dari `services/repo-dir.ts`

> **Kenapa ekstraksi ini wajib, bukan kenyamanan:** kalau hub menyalin serializer route, frame dan respons HTTP jadi dua bentuk yang bisa berselisih diam-diam — persis kelas bug SPEC-431/448/475. Satu definisi, dua pemanggil.

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/events-builders.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { buildTicketsPage } from "../src/services/tickets-list";
import { buildQueuePage } from "../src/services/scheduler/queue";
import { resetDb } from "./helpers/db";   // helper yang sudah dipakai suite lain

describe("SPEC-908 · builder dipakai bersama route & hub", () => {
  beforeEach(async () => { await resetDb(); });

  it("buildTicketsPage menghormati halaman & menghitung `unreviewed` atas SET PENUH", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", repoDir: null } });
    for (let i = 0; i < 25; i++) {
      await prisma.ticket.create({ data: {
        id: `t${i}`, projectId: "p1", number: i + 1, category: "bug",
        title: `Tiket ${i}`, reporterEmail: "a@b.c", body: "x",
        status: i < 7 ? "new" : "accepted",
      } });
    }
    const p1 = await buildTicketsPage({ page: 1, limit: 20 });
    expect(p1.items).toHaveLength(20);
    expect(p1.total).toBe(25);
    expect(p1.unreviewed).toBe(7);

    const p2 = await buildTicketsPage({ page: 2, limit: 20 });
    expect(p2.items).toHaveLength(5);
    // `unreviewed` dihitung atas set penuh, bukan per halaman — lencana tak boleh mengecil.
    expect(p2.unreviewed).toBe(7);
  });

  it("buildTicketsPage menyaring `q` atas judul & email pelapor", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", repoDir: null } });
    await prisma.ticket.create({ data: { id: "t1", projectId: "p1", number: 1, category: "bug", title: "Terminal lemot", reporterEmail: "a@b.c", body: "x", status: "new" } });
    await prisma.ticket.create({ data: { id: "t2", projectId: "p1", number: 2, category: "bug", title: "Graph kosong", reporterEmail: "z@y.x", body: "x", status: "new" } });
    const r = await buildTicketsPage({ page: 1, limit: 20, q: "terminal" });
    expect(r.items.map((t) => t.id)).toEqual(["t1"]);
    expect(r.total).toBe(1);
  });

  it("buildQueuePage mengembalikan amplop Paginated dengan tanggal sudah ISO", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", repoDir: null } });
    await prisma.schedulerQueueItem.create({ data: {
      id: "q1", specId: "SPEC-1", projectId: "p1", source: "backlog", priority: 1, status: "queued",
    } });
    const r = await buildQueuePage({ status: "queued", page: 1, limit: 10 });
    expect(r.total).toBe(1);
    expect(typeof r.items[0]!.enqueuedAt).toBe("string");
    expect(r.items[0]!.launchedAt).toBeNull();
  });
});
```

> Sebelum menulis, buka satu test server yang sudah ada (mis. `server/test/tickets.test.ts`) dan **tiru cara ia menyiapkan DB** — nama helper reset dan field wajib `Ticket`/`SchedulerQueueItem` diambil dari sana, bukan ditebak. Kalau helper `resetDb` bernama lain, pakai nama yang dipakai suite itu.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events-builders.test.ts
```
Expected: FAIL — modul `../src/services/tickets-list` tak ada.

- [x] **Step 3: Ekstrak `buildTicketsPage`**

Create `server/src/services/tickets-list.ts`:

```ts
import type { Ticket } from "@prisma/client";
import type { Paginated, TicketView, TopicParams } from "@hanoman/shared";
import { prisma } from "../db";
import { paginate } from "./paginate";

// SPEC-908 · satu definisi untuk GET /tickets dan topik siar `tickets`. Sebelumnya inline di
// routes/tickets.ts; menyalinnya ke hub berarti dua serializer yang bisa berselisih diam-diam.
const view = (t: Ticket & { _count?: { attachments: number } }): TicketView => ({
  id: t.id, projectId: t.projectId, number: t.number, category: t.category, title: t.title,
  reporterEmail: t.reporterEmail, status: t.status, specId: t.specId,
  attachmentCount: t._count?.attachments ?? 0, createdAt: t.createdAt.toISOString(),
});

export async function buildTicketsPage(
  f: Partial<TopicParams["tickets"]>,
): Promise<Paginated<TicketView> & { unreviewed: number }> {
  const where: { projectId?: string; status?: string } = {};
  if (f.project) where.projectId = f.project;
  if (f.status) where.status = f.status;
  let rows = await prisma.ticket.findMany({
    where, orderBy: { createdAt: "desc" }, include: { _count: { select: { attachments: true } } },
  });
  if (f.q) {
    const n = f.q.toLowerCase();
    rows = rows.filter((t) => `${t.title} ${t.reporterEmail}`.toLowerCase().includes(n));
  }
  // `unreviewed` dihitung atas SET PENUH, bukan per halaman: lencana "belum ditinjau" tak boleh
  // mengecil saat operator pindah halaman (SPEC-523).
  const unreviewed = rows.filter((t) => t.status === "new").length;
  return {
    ...paginate(rows.map(view), f.page ? String(f.page) : undefined, f.limit ? String(f.limit) : undefined),
    unreviewed,
  };
}
```

Ganti body `GET /tickets` di `server/src/routes/tickets.ts:22-36` menjadi:

```ts
  app.get("/tickets", async (req) => {
    const { project, status, q, page, limit } = req.query as Record<string, string | undefined>;
    return buildTicketsPage({
      project, status, q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  });
```

Tambahkan `import { buildTicketsPage } from "../services/tickets-list";` dan **hapus** const `view` lokal beserta impor `paginate`/`Ticket` **hanya jika** tak ada pemakai lain di berkas itu — periksa dengan `grep -n "view(\|paginate(\|Ticket\b" server/src/routes/tickets.ts` sebelum menghapus.

- [x] **Step 4: Ekstrak `buildQueuePage`**

Tambahkan di `server/src/services/scheduler/queue.ts`, tepat setelah `listQueuePage`:

```ts
// SPEC-908 · amplop view (tanggal ISO) untuk GET /scheduler/queue dan topik siar `schedulerQueue`.
export async function buildQueuePage(
  f: { status?: string; page?: number; limit?: number },
): Promise<Paginated<SchedulerQueueItemView>> {
  const r = await listQueuePage({
    status: f.status,
    page: f.page ? String(f.page) : undefined,
    limit: f.limit ? String(f.limit) : undefined,
  });
  return {
    items: r.items.map((q) => ({
      id: q.id, specId: q.specId, projectId: q.projectId, source: q.source,
      priority: q.priority, status: q.status, sessionId: q.sessionId, note: q.note,
      enqueuedAt: q.enqueuedAt.toISOString(),
      launchedAt: q.launchedAt ? q.launchedAt.toISOString() : null,
    })),
    total: r.total, page: r.page, pageSize: r.pageSize,
  };
}
```

Tambahkan `import type { Paginated, SchedulerQueueItemView } from "@hanoman/shared";` di puncak berkas itu.

Ganti body `GET /scheduler/queue` di `server/src/routes/scheduler.ts:86-98`:

```ts
  app.get("/scheduler/queue", async (req) => {
    const { status, page, limit } = req.query as Record<string, string | undefined>;
    return buildQueuePage({ status, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined });
  });
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events-builders.test.ts
```
Expected: PASS — 3 test.

- [x] **Step 6: Ekstrak `buildSchedulerState` (dan singkirkan `listSessions` sinkron dari jalur ini)**

Create `server/src/services/scheduler/state.ts`, salin **apa adanya** isi handler `GET /scheduler/state` (`server/src/routes/scheduler.ts:58-83`) dengan **satu** perubahan: `listSessions()` → `await listSessionsAsync()`.

```ts
import type { SchedulerStateView } from "@hanoman/shared";
import { listSessionsAsync } from "../pty";
import { getScheduler } from "./config";      // sesuaikan dengan impor yang dipakai routes/scheduler.ts
import { getLastRun } from "./runs";          //   idem — salin dari berkas route, jangan menebak
import { queueCounts, listQueue } from "./queue";

// SPEC-908 · satu definisi untuk GET /scheduler/state dan topik siar `schedulerState`.
// `listSessionsAsync`, BUKAN `listSessions`: hub berbagi event loop dengan PTY terminal dan
// `execFileSync` tmux memblokirnya (terukur sampai 916 ms saat mesin sibuk — SPEC-479/812).
export async function buildSchedulerState(): Promise<SchedulerStateView> {
  const cfg = await getScheduler();
  const live = (await listSessionsAsync()).filter((s) => !s.exited);
  const srcView = (id: string, sc: { enabled: boolean; everyMin: number }, minCount?: number) => {
    const last = getLastRun(id);
    return {
      id, enabled: sc.enabled, everyMin: sc.everyMin, minCount,
      lastRunAt: last ? new Date(last).toISOString() : null,
      nextRunAt: last ? new Date(last + sc.everyMin * 60_000).toISOString() : null,
    };
  };
  const sources = [srcView("backlog", cfg.sources.backlog), srcView("triase", cfg.sources.triase)];
  const counts = await queueCounts();
  const launchedSpecs = new Set((await listQueue("launched")).map((q) => q.specId));
  const sessions = live.filter((s) => s.specId && launchedSpecs.has(s.specId));
  return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queueCounts: counts, sessions };
}
```

> Nama impor (`getScheduler`, `getLastRun`) **disalin dari puncak `server/src/routes/scheduler.ts`** — buka berkas itu dan pakai jalur impor yang persis sama, disesuaikan kedalaman relatifnya.

Ganti body route menjadi `app.get("/scheduler/state", () => buildSchedulerState());`.

- [x] **Step 7: Ekstrak view lead**

Create `server/src/services/lead/views.ts` dengan tiga fungsi yang menyalin `server/src/routes/lead.ts:34-68`, `:72-84`, `:89-99` **apa adanya**, kecuali `listSessions()` → `await listSessionsAsync()` di `buildLeadStatus`:

```ts
import type { Paginated, LeadStatusView, LeadDecisionView, LeadFlowView } from "@hanoman/shared";
import { listSessionsAsync } from "../pty";
import { prisma } from "../../db";
// …impor lain (getLead, leadActive, liveDecisions, decidingIds, queuedIds, lastPulse,
//   leadGateStats, listQueue, listDecisions, listFlows, toDecisionView, toFlowView)
//   DISALIN dari puncak server/src/routes/lead.ts dengan kedalaman relatif disesuaikan.
//   `toDecisionView`/`toFlowView` bila lokal di route: pindahkan ke sini juga dan impor balik.

export async function buildLeadStatus(): Promise<LeadStatusView> { /* salinan :34-68, listSessionsAsync */ }
export async function buildLeadDecisions(f: { projectId?: string; page?: number; limit?: number }): Promise<Paginated<LeadDecisionView>> { /* salinan :72-84 */ }
export async function buildLeadFlows(f: { projectId?: string; page?: number; limit?: number }): Promise<Paginated<LeadFlowView>> { /* salinan :89-99 */ }
```

> Tiga route lead **tetap menerima seluruh query lamanya** (`specId`, `sessionId`, `status`, `flowId`, `take`, `skip`) — jangan dipersempit. Yang dipersempit hanya parameter **topik siar**. Bentuk fungsi service karena itu: `buildLeadDecisions(f: Parameters<typeof listDecisions>[0])`, dan route meneruskan query-nya apa adanya.

Ganti ketiga body route dengan pemanggilan service.

- [x] **Step 8: Pindahkan `repoOf` + tambahkan `buildGitLive`**

Create `server/src/services/repo-dir.ts`:

```ts
import { prisma } from "../db";
import { resolveRepoDir } from "./repo-binding";   // salin jalur impor dari routes/ide.ts

// undefined = project tak ada (→404); null = ada tapi tanpa checkout lokal; string = repoDir.
// SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-6).
// SPEC-908 · dipindah dari routes/ide.ts supaya hub siar bisa memakai resolusi yang SAMA.
export async function repoOf(id: string): Promise<string | null | undefined> {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return undefined;
  return (await resolveRepoDir(id)) ?? null;
}
```

Di `server/src/routes/ide.ts` hapus definisi lokal `repoOf` (baris 31-35) dan impor dari `../services/repo-dir`.

Tambahkan di `server/src/services/git-ide.ts`:

```ts
// SPEC-908 · muatan layar GitGraph dalam SATU tarikan — cermin `load()`-nya. Dibundel karena
// ketiganya hari ini satu render: tiga frame terpisah akan menampilkan campuran dua generasi data.
export async function buildGitLive(repoDir: string | null, p: TopicParams["git"]): Promise<{
  graph: { commits: GraphCommit[]; current: string; total: number };
  status: RepoStatus; stashes: Stash[];
}> {
  const [graph, status, stashes] = await Promise.all([
    listGraph(repoDir, p.limit, {
      branches: p.branch ? [p.branch] : undefined,
      showRemote: p.showRemote ? undefined : false,
      showTags: p.showTags ? undefined : false,
    }),
    repoStatus(repoDir),
    listStashes(repoDir),
  ]);
  return { graph, status, stashes };
}
```

Tambahkan `import type { TopicParams } from "@hanoman/shared";`.

- [x] **Step 9: Jalankan test route yang tersentuh**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism \
  server/test/events-builders.test.ts server/test/scheduler.route.test.ts \
  server/test/scheduler-queue.service.test.ts server/test/tickets.test.ts \
  server/test/lead-routes.test.ts server/test/lead-list-pagination.test.ts \
  server/test/ide.route.test.ts
```
Expected: semua PASS. **Kalau `scheduler.route` atau `lead-routes` merah dengan "listSessions is not a function"**, itu karena test-nya men-stub `listSessions` sementara service kini memanggil `listSessionsAsync` — perbarui stub-nya ke `listSessionsAsync`. Itu perubahan yang benar, bukan gejala regresi.

- [x] **Step 10: Typecheck & commit**

Run: `pnpm --filter ./server typecheck`

```bash
git add server/src/services server/src/routes server/test/events-builders.test.ts
git commit -m "refactor(events): satu definisi per muatan untuk route dan hub siar (SPEC-908)

Body enam route diekstrak ke service supaya frame siar dan respons HTTP tak punya
dua serializer yang bisa berselisih diam-diam (kelas bug SPEC-431/448/475).
buildSchedulerState & buildLeadStatus sekaligus berhenti memakai listSessions()
ber-execFileSync, yang memblokir event loop yang dibagi dengan PTY terminal."
```

---

## Task 3: Hub berlangganan di `services/events.ts`

**Files:**
- Create: `server/src/services/events-topics.ts`
- Modify: `server/src/services/events.ts`
- Test: `server/test/events-subscriptions.test.ts` (create)

**Interfaces:**
- Consumes: builder Task 2, kontrak Task 1.
- Produces: `subscribeClient(c: Client, subs: { topic: string; params: unknown }[]): void`, `TOPICS` (registry), dan `attach()` yang kini mengirim frame `hello` lebih dulu.

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/events-subscriptions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "../src/services/pty";
import { attach, detach, subscribeClient, __tick, __reset } from "../src/services/events";
import * as topics from "../src/services/events-topics";
import { subKey } from "@hanoman/shared";

function fakeClient(): Client & { frames: unknown[] } {
  const frames: unknown[] = [];
  return { frames, send: (s: string) => { frames.push(JSON.parse(s)); }, close: () => {} };
}
const framesOf = (c: { frames: unknown[] }, t: string) =>
  (c.frames as { t: string }[]).filter((m) => m.t === t);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SPEC-908 · hub langganan berparameter", () => {
  beforeEach(() => { __reset(); });
  afterEach(() => { __reset(); vi.restoreAllMocks(); });

  it("mengirim frame `hello` berisi daftar topik SEBELUM snapshot grup", async () => {
    const c = fakeClient();
    await attach(c);
    const first = c.frames[0] as { t: string; topics: string[] };
    expect(first.t).toBe("hello");
    expect(first.topics).toContain("tickets");
    expect(first.topics).toContain("git");
  });

  it("entri tanpa pelanggan TIDAK PERNAH dihitung", async () => {
    const spy = vi.spyOn(topics.TOPICS.tickets, "build");
    const c = fakeClient();
    await attach(c);
    for (let i = 0; i < 10; i++) await __tick();
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it("mengirim muatan pertama SEGERA saat berlangganan — tak menunggu tick", async () => {
    vi.spyOn(topics.TOPICS.tickets, "build").mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 },
    });
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    await flush();
    const f = framesOf(c, "tickets") as { key: string }[];
    expect(f).toHaveLength(1);
    expect(f[0]!.key).toBe(subKey("tickets", { page: 1, limit: 20 }));
  });

  it("dua klien berparameter identik = SATU build dan frame byte-identik", async () => {
    const spy = vi.spyOn(topics.TOPICS.tickets, "build").mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 },
    });
    const a = fakeClient(), b = fakeClient();
    await attach(a); await attach(b);
    subscribeClient(a, [{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    await flush();
    spy.mockClear();
    subscribeClient(b, [{ topic: "tickets", params: { limit: 20, page: 1 } }]);   // urutan kunci beda
    await flush();
    // b dilayani dari cache entri yang SAMA — nol build tambahan.
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(framesOf(a, "tickets")[0])).toBe(JSON.stringify(framesOf(b, "tickets")[0]));
  });

  it("dedup signature: build mengembalikan data sama → tak ada frame kedua", async () => {
    vi.spyOn(topics.TOPICS.tickets, "build").mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 },
    });
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    await flush();
    for (let i = 0; i < 20; i++) { await __tick(); await flush(); }
    expect(framesOf(c, "tickets")).toHaveLength(1);
  });

  it("kadens per-topik dihormati — `git` tak dihitung tiap tick", async () => {
    const spy = vi.spyOn(topics.TOPICS.git, "build")
      .mockImplementation(async () => ({ graph: { commits: [], current: "", total: 0 }, status: null as never, stashes: [] }));
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "git", params: { projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true } }]);
    await flush();
    spy.mockClear();
    for (let i = 0; i < 4; i++) { await __tick(); await flush(); }
    // everyTicks git = 4 (tick 1 dtk) → tepat satu recompute dalam 4 tick.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("build yang MELEMPAR tak menghapus frame lama dan tak menjatuhkan tick berikutnya", async () => {
    const spy = vi.spyOn(topics.TOPICS.tickets, "build")
      .mockResolvedValueOnce({ data: { items: [], total: 1, page: 1, pageSize: 20, unreviewed: 0 } })
      .mockRejectedValueOnce(new Error("DB mati"))
      .mockResolvedValue({ data: { items: [], total: 2, page: 1, pageSize: 20, unreviewed: 0 } });
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    await flush();
    for (let i = 0; i < 8; i++) { await __tick(); await flush(); }
    const f = framesOf(c, "tickets") as { data: { total: number } }[];
    expect(f[0]!.data.total).toBe(1);
    expect(f.at(-1)!.data.total).toBe(2);
    expect(spy.mock.calls.length).toBeGreaterThan(2);
  });

  it("frame `sub` MENGGANTI seluruh himpunan — langganan lama berhenti dihitung", async () => {
    const spy = vi.spyOn(topics.TOPICS.tickets, "build").mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 },
    });
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    await flush();
    subscribeClient(c, [{ topic: "tickets", params: { page: 2, limit: 20 } }]);
    await flush();
    spy.mockClear();
    for (let i = 0; i < 6; i++) { await __tick(); await flush(); }
    for (const call of spy.mock.calls) expect((call[0] as { page: number }).page).toBe(2);
  });

  it("topik tak dikenal dilewati PER-ENTRI, yang dikenal tetap terpasang (ADR-0087)", async () => {
    vi.spyOn(topics.TOPICS.tickets, "build").mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 },
    });
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [
      { topic: "topikMasaDepan", params: {} },
      { topic: "tickets", params: { page: 1, limit: 20 } },
    ]);
    await flush();
    expect(framesOf(c, "tickets")).toHaveLength(1);
  });

  it("parameter cacat dibuang tanpa melempar", async () => {
    const spy = vi.spyOn(topics.TOPICS.tickets, "build");
    const c = fakeClient();
    await attach(c);
    expect(() => subscribeClient(c, [{ topic: "tickets", params: { page: 0, limit: 99_999 } }])).not.toThrow();
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it("detach menyapu langganan — build berhenti setelah klien terakhir lepas", async () => {
    const spy = vi.spyOn(topics.TOPICS.tickets, "build").mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 },
    });
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    await flush();
    detach(c);
    spy.mockClear();
    for (let i = 0; i < 6; i++) { await __tick(); await flush(); }
    expect(spy).not.toHaveBeenCalled();
  });

  it("build lambat tidak menunda grup global — `sessions` tetap terbit", async () => {
    vi.spyOn(topics.TOPICS.git, "build").mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ graph: { commits: [], current: "", total: 0 }, status: null as never, stashes: [] }), 50)),
    );
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "git", params: { projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true } }]);
    const before = Date.now();
    for (let i = 0; i < 4; i++) await __tick();
    // __tick tak pernah menunggu build langganan; empat tick harus selesai jauh di bawah 50 ms.
    expect(Date.now() - before).toBeLessThan(40);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events-subscriptions.test.ts
```
Expected: FAIL — `subscribeClient` tak diekspor, modul `events-topics` tak ada.

- [x] **Step 3: Tulis registry topik**

Create `server/src/services/events-topics.ts`:

```ts
import type { EventMsg, EventTopic, TopicParams } from "@hanoman/shared";
import { zTopicParams } from "@hanoman/shared";
import { buildSchedulerState } from "./scheduler/state";
import { buildQueuePage } from "./scheduler/queue";
import { buildTicketsPage } from "./tickets-list";
import { buildLeadStatus, buildLeadDecisions, buildLeadFlows } from "./lead/views";
import { buildGitLive } from "./git-ide";
import { repoOf } from "./repo-dir";

// SPEC-908 · registry topik langganan: tahu APA yang dihitung dan seberapa sering, tak tahu
// siapa pelanggannya (itu urusan services/events.ts). `build` mengembalikan BADAN frame tanpa
// `t`/`key` — hub yang memasangnya, jadi nama topik dan `t` frame tak bisa berselisih.
type Body<T extends EventTopic> = Omit<Extract<EventMsg, { t: T }>, "t" | "key">;

export type Topic<T extends EventTopic> = {
  everyTicks: number;
  build: (params: TopicParams[T]) => Promise<Body<T>>;
};

// everyTicks dihitung terhadap tick 1 dtk. Semuanya ≤ kadens polling klien yang digantikan
// (5/5/5/5/4 dtk) — lihat tabel di spec §4.
export const TOPICS: { [K in EventTopic]: Topic<K> } = {
  schedulerState: { everyTicks: 2, build: async () => ({ state: await buildSchedulerState() }) },
  schedulerQueue: { everyTicks: 3, build: async (p) => ({ data: await buildQueuePage(p) }) },
  tickets:        { everyTicks: 3, build: async (p) => ({ data: await buildTicketsPage(p) }) },
  lead:           { everyTicks: 4, build: async (p) => ({
    status: await buildLeadStatus(),
    decisions: await buildLeadDecisions({ projectId: p.projectId, page: p.decPage, limit: p.limit }),
    // SPEC-485 · rantai boleh tak ada di instance lama; kegagalannya tak menjatuhkan panel.
    flows: await buildLeadFlows({ projectId: p.projectId, page: p.flowPage, limit: p.limit })
      .catch(() => ({ items: [], total: 0, page: 1, pageSize: p.limit })),
  }) },
  git:            { everyTicks: 4, build: async (p) => buildGitLive(await repoOf(p.projectId) ?? null, p) },
};

export const TOPIC_NAMES = Object.keys(TOPICS) as EventTopic[];

export function isTopic(t: string): t is EventTopic {
  return Object.prototype.hasOwnProperty.call(TOPICS, t);
}

/** Parse parameter sebuah entri `sub`; `undefined` = tolak entri itu (bukan seluruh frame). */
export function parseParams<T extends EventTopic>(topic: T, params: unknown): TopicParams[T] | undefined {
  const r = zTopicParams[topic].safeParse(params);
  return r.success ? (r.data as TopicParams[T]) : undefined;
}
```

- [x] **Step 4: Tambahkan bookkeeping langganan di `services/events.ts`**

Ubah `server/src/services/events.ts`:

1. Sempitkan tipe frame — ini menutup lubang senyap yang sudah ada:

```ts
// SPEC-908 · dulu `{ t: string; [k: string]: unknown }`, sehingga `t` yang salah ketik lolos
// typecheck server dan jatuh senyap di klien (`m.t === …` tak pernah cocok). Dengan `EventMsg`
// kompilator yang menegakkannya. Baris Prisma bertanggal Date tetap sah: JSON.stringify
// menjadikannya string sesuai wire type — persis konvensi route lain.
type WireMsg = EventMsg;
```

Bila `pnpm --filter ./server typecheck` mengeluh pada grup `vps` (baris Prisma `Date` vs `string`), pakai penyempitan yang tetap mengikat `t`:

```ts
type WireMsg = { t: EventMsg["t"] } & Record<string, unknown>;
```

Ambil bentuk pertama bila lolos; bentuk kedua adalah cadangan yang tetap menutup salah-ketik `t`.

2. Tambahkan entri langganan, di bawah deklarasi `GROUPS`:

```ts
import { TOPICS, TOPIC_NAMES, isTopic, parseParams } from "./events-topics";
import { subKey, type EventTopic } from "@hanoman/shared";

type SubEntry = {
  topic: EventTopic;
  params: unknown;
  key: string;
  clients: Set<Client>;
  tick: number;
  last: string;
  inflight: boolean;
  failing?: boolean;
};
const entries = new Map<string, SubEntry>();

function sendTo(c: Client, s: string): void {
  try { c.send(s); } catch { clients.delete(c); dropClientSubs(c); }
}

function frameOf(e: SubEntry, body: object): string {
  return JSON.stringify({ t: e.topic, key: e.key, ...body });
}

// Satu recompute untuk SEMUA pelanggan entri ini; dedup signature dipertahankan persis seperti
// Group.last. Tak pernah di-await oleh __tick — satu `git log` lambat tak boleh menunda grup
// `sessions`/`specs` yang berkadens 1 dtk (dan event loop yang sama melayani PTY terminal).
async function runEntry(e: SubEntry): Promise<void> {
  if (e.inflight) return;
  e.inflight = true;
  try {
    const body = await (TOPICS[e.topic].build as (p: unknown) => Promise<object>)(e.params);
    if (e.failing) { e.failing = false; console.log(`siar langganan pulih: ${e.key}`); }
    const s = frameOf(e, body);
    if (s === e.last) return;
    e.last = s;
    for (const c of e.clients) sendTo(c, s);
  } catch (err) {
    // Frame lama SENGAJA tak dihapus: klien tak boleh di-blank karena satu build gagal.
    if (!e.failing) { e.failing = true; console.error(`siar langganan gagal membangun ${e.key}:`, err); }
  } finally { e.inflight = false; }
}

// Ganti-penuh: frame `sub` mengganti SELURUH himpunan langganan klien, jadi tak ada yang bisa
// bocor dan re-kirim saat reconnect identik dengan pemasangan pertama.
export function subscribeClient(c: Client, subs: { topic: string; params: unknown }[]): void {
  const wanted = new Set<string>();
  for (const s of subs) {
    if (!isTopic(s.topic)) continue;                 // ADR-0087 · dashboard boleh lebih baru
    const params = parseParams(s.topic, s.params);
    if (params === undefined) continue;              // entri cacat dibuang, frame tidak
    const key = subKey(s.topic, params as Record<string, unknown>);
    wanted.add(key);
    let e = entries.get(key);
    if (!e) {
      e = { topic: s.topic, params, key, clients: new Set(), tick: 0, last: "", inflight: false };
      entries.set(key, e);
    }
    const isNew = !e.clients.has(c);
    e.clients.add(c);
    // Muatan pertama SEGERA: dari cache bila entri sudah punya, satu build di luar jadwal bila
    // belum. Tanpa ini, kembali dari tab tersembunyi (socket ditutup atas permintaan kita,
    // api/events.ts:77) berarti layar diam sampai tick berikutnya.
    if (isNew && e.last) sendTo(c, e.last);
    else if (isNew) void runEntry(e);
  }
  for (const [key, e] of entries) {
    if (wanted.has(key) || !e.clients.has(c)) continue;
    e.clients.delete(c);
    if (e.clients.size === 0) entries.delete(key);
  }
}

function dropClientSubs(c: Client): void {
  for (const [key, e] of entries) {
    if (!e.clients.delete(c)) continue;
    if (e.clients.size === 0) entries.delete(key);
  }
}
```

3. Di `__tick()`, setelah loop `GROUPS` (masih di dalam `try`), tambahkan:

```ts
    for (const e of entries.values()) {
      e.tick++;
      if (e.tick % TOPICS[e.topic].everyTicks !== 0) continue;
      void runEntry(e);        // sengaja TIDAK di-await: lihat komentar runEntry
    }
```

4. Di `attach()`, kirim `hello` **paling dulu**:

```ts
export async function attach(c: Client): Promise<void> {
  clients.add(c);
  startLoop();
  // SPEC-908 · advertensi kemampuan. Server lama tak mengirim frame ini sama sekali — itulah
  // sinyal yang dipakai klien untuk memutuskan tetap men-poll HTTP (ADR-0087).
  try { c.send(JSON.stringify({ t: "hello", topics: TOPIC_NAMES })); } catch { return; }
  for (const g of GROUPS) { /* …tak berubah… */ }
}
```

5. Di `detach()` dan `__reset()`:

```ts
export function detach(c: Client): void {
  clients.delete(c);
  dropClientSubs(c);
  if (clients.size === 0) stopLoop();
}

export function __reset(): void { clients.clear(); entries.clear(); stopLoop(); }
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events-subscriptions.test.ts server/test/events.test.ts
```
Expected: PASS — 12 test baru + `events.test.ts` yang ada tetap hijau. Kalau `events.test.ts` merah karena kini ada frame `hello` di awal, perbaiki **assertion-nya** (frame pertama bukan lagi `sessions`) — itu perubahan kontrak yang disengaja, bukan regresi.

- [x] **Step 6: Typecheck & commit**

Run: `pnpm --filter ./server typecheck`

```bash
git add server/src/services/events.ts server/src/services/events-topics.ts server/test/events-subscriptions.test.ts server/test/events.test.ts
git commit -m "feat(events): hub langganan berparameter di samping GROUPS global (SPEC-908)

Entri berkunci subKey: satu build untuk N klien berparameter identik, dedup
signature dipertahankan, entri mati saat pelanggan terakhirnya lepas sehingga
sumber mahal tak pernah dihitung untuk parameter yang tak ada yang menonton.
runEntry sengaja tak di-await __tick: satu \`git log\` lambat tak boleh menunda
grup 1 dtk di event loop yang sama dengan PTY terminal.

WireMsg disempitkan ke EventMsg — sebelumnya \`t\` salah ketik lolos typecheck
server lalu jatuh senyap di klien."
```

---

## Task 4: Gerbang frame masuk di `routes/events.ts`

**Files:**
- Modify: `server/src/routes/events.ts:26`
- Test: `server/test/events-sub-frame.test.ts` (create)

**Interfaces:**
- Consumes: `subscribeClient` (Task 3), `zEventsClientMsg`/`MAX_SUBS` (Task 1), `WsMessageMeter`/`MAX_WS_MESSAGE_BYTES` (`server/src/services/ws-admission.ts:7,227`).
- Produces: kanal `/events/ws` yang membaca frame `sub` **hanya** dari principal `kind === "user"` / `"test"`.

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/events-sub-frame.test.ts`. Tiru **cara `server/test/events.route.test.ts` membangun app dan membuka WS** (boot Fastify + `@fastify/websocket`, tiket, subprotocol) — jangan menebak bentuknya.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// …impor helper app/WS DISALIN dari server/test/events.route.test.ts…
import * as events from "../src/services/events";

describe("SPEC-908 · gerbang frame masuk /events/ws", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { events.__reset(); });

  it("principal cookie: frame `sub` diteruskan ke hub", async () => {
    const spy = vi.spyOn(events, "subscribeClient").mockImplementation(() => {});
    const ws = await openEventsWs({ kind: "user" });
    ws.send(JSON.stringify({ t: "sub", subs: [{ topic: "tickets", params: { page: 1, limit: 20 } }] }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![1]).toEqual([{ topic: "tickets", params: { page: 1, limit: 20 } }]);
    ws.close();
  });

  it("principal agent: frame `sub` DIBUANG — /events/ws dipetakan ke GLOBAL_READ, sedangkan topik "
    + "baru menyentuh domain support/lead/ide", async () => {
    const spy = vi.spyOn(events, "subscribeClient").mockImplementation(() => {});
    const ws = await openEventsWs({ kind: "agent" });
    ws.send(JSON.stringify({ t: "sub", subs: [{ topic: "tickets", params: { page: 1, limit: 20 } }] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(ws.OPEN);   // dibuang, bukan diputus
    ws.close();
  });

  it("frame bukan JSON / bukan `sub` diabaikan tanpa menutup socket", async () => {
    const spy = vi.spyOn(events, "subscribeClient").mockImplementation(() => {});
    const ws = await openEventsWs({ kind: "user" });
    ws.send("bukan json");
    ws.send(JSON.stringify({ t: "write", d: "rm -rf /" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it("frame melebihi MAX_WS_MESSAGE_BYTES tak pernah sampai ke hub", async () => {
    const spy = vi.spyOn(events, "subscribeClient").mockImplementation(() => {});
    const ws = await openEventsWs({ kind: "user" });
    ws.send(JSON.stringify({ t: "sub", subs: [{ topic: "tickets", params: { q: "x".repeat(70_000) } }] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
    ws.close();
  });

  it("subs melebihi MAX_SUBS ditolak seluruh frame-nya", async () => {
    const spy = vi.spyOn(events, "subscribeClient").mockImplementation(() => {});
    const ws = await openEventsWs({ kind: "user" });
    ws.send(JSON.stringify({
      t: "sub",
      subs: Array.from({ length: 17 }, () => ({ topic: "tickets", params: { page: 1, limit: 20 } })),
    }));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
    ws.close();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events-sub-frame.test.ts
```
Expected: FAIL — belum ada handler `"message"`, jadi `subscribeClient` tak pernah dipanggil.

- [x] **Step 3: Implementasi handler**

Ubah `server/src/routes/events.ts`. Ganti komentar "Read-only feed: frame masuk diabaikan" pada baris 6-7 dan tambahkan handler setelah `void attach(client)`:

```ts
// SPEC-199 · WebSocket siar dashboard (ADR-0039). Auth diwarisi gate onRequest scope /api
// (cookie same-origin), sama seperti WS terminal.
// SPEC-908 · kanal ini kini menerima SATU jenis frame masuk (`{t:"sub"}`) untuk langganan
// berparameter. Gerbangnya principal, bukan sekadar bentuk: `/events/ws` dipetakan ke
// capability GLOBAL_READ untuk agent token (ADR-0065), sementara topik langganan menyentuh
// domain `support`, `lead`, dan `ide`. Tanpa gerbang ini satu agent token ber-read global
// memperoleh baca ke tiga domain yang tak diberikan kepadanya.
const canSubscribe = principal.kind === "user"
  || (principal.kind === "test" && process.env.NODE_ENV === "test");
const meter = new WsMessageMeter({ maxBytes: MAX_WS_MESSAGE_BYTES });
socket.on("message", (raw: Buffer) => {
  if (!canSubscribe) return;
  if (!meter.accept(raw.length)) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { return; }
  const r = zEventsClientMsg.safeParse(parsed);
  if (!r.success) return;
  subscribeClient(client, r.data.subs);
});
```

> **Baca `server/src/services/ws-admission.ts:227` dan `server/src/routes/terminal.ts` lebih dulu** untuk konstruktor & nama method `WsMessageMeter` yang sebenarnya (`accept`/`allow`/`take` — pakai yang ada di sana, jangan menebak) serta bentuk kuota per menit yang dipakai terminal. Frame `sub` lahir dari perubahan filter/halaman manusia, bukan ketikan — pakai kuota kecil, bukan 6.000/menit milik terminal.

Impor yang ditambahkan:

```ts
import { admitBrowserWs, openWsConnection, revalidateWsPrincipal, WsMessageMeter, MAX_WS_MESSAGE_BYTES } from "../services/ws-admission";
import { attach, detach, subscribeClient } from "../services/events";
import { zEventsClientMsg } from "@hanoman/shared";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism \
  server/test/events-sub-frame.test.ts server/test/events.route.test.ts \
  server/test/events-ws.test.ts server/test/events-ws-default-origin.test.ts \
  server/test/parity-endpoints.test.ts
```
Expected: semua PASS.

> Kalau `vi.spyOn(events, "subscribeClient")` tak mempan (modul ESM read-only), ganti strateginya: jangan mem-spy, melainkan berlangganan sungguhan dan **assert frame `tickets` yang diterima** (atau tidak diterima) di socket. Yang diuji adalah perilaku gerbang, bukan pemanggilan fungsi.

- [x] **Step 5: Review keamanan**

Jalankan agen `security-reviewer` atas diff `server/src/routes/events.ts` + `server/src/services/events.ts` + `server/src/services/events-topics.ts`, dengan pertanyaan eksplisit: **bisakah principal non-cookie mencapai `subscribeClient`, dan bisakah `params` mencapai argv/path tanpa validasi?** Perbaiki temuan yang jalurnya terbukti sebelum lanjut.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/events.ts server/test/events-sub-frame.test.ts
git commit -m "feat(events): terima frame \`sub\` bergerbang principal cookie (SPEC-908)

/events/ws dipetakan ke GLOBAL_READ untuk agent token, sedangkan topik langganan
menyentuh domain support/lead/ide — tanpa gerbang kind===user satu token ber-read
global memperoleh baca ke tiga domain yang tak diberikan kepadanya."
```

---

## Task 5: Klien — `subscribeTopic` di atas socket yang sama

**Files:**
- Modify: `src/src/api/events.ts`
- Test: `src/test/events-topics.test.ts` (create), `src/test/events.test.ts` (tetap harus hijau)

**Interfaces:**
- Consumes: `EventTopic`, `TopicParams`, `subKey`, `EventMsg` (Task 1).
- Produces:
  - `subscribeTopic<T extends EventTopic>(topic: T, params: TopicParams[T], onData: (m: Extract<EventMsg, {t:T}>) => void): () => void`
  - `eventsTopics(): EventTopic[]` — dari frame `hello`, `[]` sebelum tiba
  - `subscribeTopics(cb: (topics: EventTopic[]) => void): () => void`
  - `eventsSilentSince(): number | null` — stempel kapan socket terakhir mengantar frame; `null` bila belum pernah

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/events-topics.test.ts`. **Tiru `FakeWS` di `src/test/events.test.ts:10`** — jangan menulis fake baru.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// …impor FakeWS/pemasangan global DISALIN dari src/test/events.test.ts…
import { subscribeTopic, eventsTopics, subscribeTopics } from "../src/api/events";
import { subKey } from "@hanoman/shared";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SPEC-908 · langganan topik di klien", () => {
  beforeEach(() => { /* reset FakeWS + mock api.issueWsTicket, pola events.test.ts */ });
  afterEach(() => { vi.restoreAllMocks(); });

  it("mengirim SATU frame `sub` untuk beberapa langganan yang mount bersamaan", async () => {
    const off1 = subscribeTopic("tickets", { page: 1, limit: 20 }, () => {});
    const off2 = subscribeTopic("schedulerQueue", { status: "queued", page: 1, limit: 10 }, () => {});
    await flush();
    FakeWS.last!.open();
    await flush();
    const subFrames = FakeWS.last!.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "sub");
    expect(subFrames).toHaveLength(1);
    expect(subFrames[0].subs).toHaveLength(2);
    off1(); off2();
  });

  it("mengirim ULANG himpunan penuh setelah reconnect", async () => {
    const off = subscribeTopic("tickets", { page: 3, limit: 20 }, () => {});
    await flush();
    FakeWS.last!.open();
    await flush();
    const first = FakeWS.last!;
    first.close();
    await vi.advanceTimersByTimeAsync(600);   // backoff awal 500 ms
    await flush();
    FakeWS.last!.open();
    await flush();
    const resent = FakeWS.last!.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "sub");
    expect(resent).toHaveLength(1);
    expect(resent[0].subs[0].params).toEqual({ page: 3, limit: 20 });
    off();
  });

  it("hanya meneruskan frame yang `key`-nya milik langganan ini", async () => {
    const seen: unknown[] = [];
    const off = subscribeTopic("tickets", { page: 1, limit: 20 }, (m) => seen.push(m));
    await flush();
    FakeWS.last!.open();
    await flush();
    FakeWS.last!.emit({ t: "tickets", key: subKey("tickets", { page: 2, limit: 20 }), data: { items: [], total: 0, page: 2, pageSize: 20, unreviewed: 0 } });
    expect(seen).toHaveLength(0);
    FakeWS.last!.emit({ t: "tickets", key: subKey("tickets", { page: 1, limit: 20 }), data: { items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 } });
    expect(seen).toHaveLength(1);
    off();
  });

  it("frame `hello` mengisi daftar topik dan memberitahu pelanggan status", async () => {
    const seen: string[][] = [];
    const offT = subscribeTopics((t) => seen.push(t));
    const off = subscribeTopic("tickets", { page: 1, limit: 20 }, () => {});
    await flush();
    FakeWS.last!.open();
    await flush();
    expect(eventsTopics()).toEqual([]);
    FakeWS.last!.emit({ t: "hello", topics: ["tickets", "git"] });
    expect(eventsTopics()).toEqual(["tickets", "git"]);
    expect(seen.at(-1)).toEqual(["tickets", "git"]);
    off(); offT();
  });

  it("melepas langganan terakhir mengirim frame `sub` kosong (server melepas entrinya)", async () => {
    const off = subscribeTopic("tickets", { page: 1, limit: 20 }, () => {});
    await flush();
    FakeWS.last!.open();
    await flush();
    const before = FakeWS.last!.sent.length;
    off();
    await flush();
    const after = FakeWS.last!.sent.slice(before).map((s) => JSON.parse(s));
    expect(after.some((m) => m.t === "sub" && m.subs.length === 0)).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/events-topics.test.ts`
Expected: FAIL — `subscribeTopic` tak diekspor.

- [x] **Step 3: Implementasi di `src/src/api/events.ts`**

Tambahkan (jangan mengubah `subscribe`/`open`/`close` yang ada selain tiga sisipan yang disebut):

```ts
import { paths, subKey, type EventMsg, type EventTopic, type TopicParams } from "@hanoman/shared";

// SPEC-908 · langganan berparameter di atas socket yang SAMA — tanpa koneksi kedua (kuota
// MAX_CONNECTIONS_PER_PRINCIPAL = 8 tak boleh naik).
type Sub = { topic: EventTopic; params: Record<string, unknown>; refs: number };
const topicSubs = new Map<string, Sub>();
let subsDirty = false;
let topics: EventTopic[] = [];
const topicsSubs = new Set<(t: EventTopic[]) => void>();

export const eventsTopics = (): EventTopic[] => topics;
export function subscribeTopics(cb: (t: EventTopic[]) => void): () => void {
  topicsSubs.add(cb);
  return () => { topicsSubs.delete(cb); };
}

// Empat QueueSection yang mount dalam satu render = SATU frame, bukan empat.
function flushSubs(): void {
  subsDirty = false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const subs = [...topicSubs.values()].map((s) => ({ topic: s.topic, params: s.params }));
  try { ws.send(JSON.stringify({ t: "sub", subs })); } catch { /* onclose yang menangani */ }
}
function markSubsDirty(): void {
  if (subsDirty) return;
  subsDirty = true;
  queueMicrotask(flushSubs);
}

export function subscribeTopic<T extends EventTopic>(
  topic: T, params: TopicParams[T], onData: (m: Extract<EventMsg, { t: T }>) => void,
): () => void {
  const key = subKey(topic, params as Record<string, unknown>);
  let s = topicSubs.get(key);
  if (!s) { s = { topic, params: params as Record<string, unknown>, refs: 0 }; topicSubs.set(key, s); }
  s.refs++;
  markSubsDirty();
  // Socket dibuka & ditutup oleh ref-count yang SAMA dengan consumer grup global. Tiap pemanggil
  // memasang listener-nya SENDIRI dan memanggil `onData`-nya sendiri — kalau listener ini malah
  // mengiterasi himpunan handler bersama, dua consumer pada kunci yang sama akan menerima tiap
  // frame dua kali (N listener × N handler).
  const offFrames = subscribe((m) => {
    if (m.t !== topic) return;
    if ((m as { key?: string }).key !== key) return;   // frame halaman lain tak boleh mendarat
    onData(m as Extract<EventMsg, { t: T }>);
  });
  return () => {
    offFrames();
    if (--s!.refs <= 0) topicSubs.delete(key);
    markSubsDirty();
  };
}
```

Tiga sisipan pada kode yang sudah ada:

1. Di `ws.onopen` (`:54`), setelah `backoff = 500;` tambahkan `flushSubs();` — himpunan penuh dikirim ulang tiap reconnect.
2. Di `ws.onmessage` (`:55-60`), setelah `if (!status.connected) setStatus(…)` tambahkan:

```ts
    lastFrameAt = Date.now();
    if (m.t === "hello") {
      topics = m.topics;
      for (const cb of topicsSubs) cb(topics);
    }
```

3. Di dekat `status`, tambahkan `let lastFrameAt: number | null = null;` dan `export const eventsSilentSince = (): number | null => lastFrameAt;`. Di `close()` dan `onVisibility()` **jangan** mereset `topics` — server yang sama akan mengirim `hello` lagi saat reconnect, dan mengosongkannya di antara akan menyalakan fallback poll tanpa sebab.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/events-topics.test.ts src/test/events.test.ts`
Expected: PASS — 5 test baru + `events.test.ts` yang ada tetap hijau.

- [x] **Step 5: Commit**

```bash
git add src/src/api/events.ts src/test/events-topics.test.ts
git commit -m "feat(events): subscribeTopic di atas socket events yang sudah ada (SPEC-908)

Tanpa koneksi kedua — kuota MAX_CONNECTIONS_PER_PRINCIPAL = 8 tak boleh naik.
Frame \`sub\` ter-coalesce di microtask (4 QueueSection = 1 frame) dan dikirim
ulang UTUH tiap onopen. Frame dicocokkan lewat subKey, jadi muatan halaman lain
tak mungkin mendarat di layar yang sedang di halaman lain."
```

---

## Task 6: `useLiveTopic` + indikator koneksi

**Files:**
- Create: `src/src/api/live.ts`, `src/src/ds/components/live.tsx`, `src/test/helpers/events-stub.ts`
- Modify: `src/src/ds/index.ts`, `src/src/screens/HanomanPet.tsx:63-70`
- Test: `src/test/use-live-topic.test.tsx` (create)

**Interfaces:**
- Consumes: `subscribeTopic`, `eventsTopics`, `subscribeTopics`, `eventsSilentSince`, `eventsStatus`, `subscribeStatus` (Task 5).
- Produces:
  - `useLiveTopic<T extends EventTopic>(o: { topic: T; params: TopicParams[T]; apply: (m: Extract<EventMsg,{t:T}>) => void; refetch: () => void; pollMs: number }): void`
  - `useEventsStatus(): EventsStatus` (diekspor dari `src/src/api/live.ts`; `screens/HanomanPet.tsx:63` memakai versi ini dan definisi lokalnya dihapus)
  - `<LiveConnectionBadge />` dari `../ds`

- [x] **Step 1: Tulis stub `../src/api/events` yang dipakai Task 6–10**

Create `src/test/helpers/events-stub.ts`. Tanpa berkas ini, lima berkas test berikutnya akan
menulis lima stub yang berselisih — dan `setTopics`/`emitTopic`/`lastSubParams`/`setStatus`
dipakai apa adanya di Task 7, 8, 9, dan 10.

```ts
import { vi } from "vitest";
import { subKey, type EventMsg, type EventTopic } from "@hanoman/shared";

type Handler = (m: EventMsg) => void;

const state = {
  topics: [] as EventTopic[],
  topicsSubs: new Set<(t: EventTopic[]) => void>(),
  frameSubs: new Map<string, Set<Handler>>(),   // key → handler
  subs: [] as { topic: EventTopic; params: Record<string, unknown> }[],
  silentSince: null as number | null,
  status: { connected: true, since: Date.now(), paused: false },
  statusSubs: new Set<(s: typeof state.status) => void>(),
};

export function resetEventsStub(): void {
  state.topics = []; state.topicsSubs.clear(); state.frameSubs.clear();
  state.subs = []; state.silentSince = null;
  state.status = { connected: true, since: Date.now(), paused: false };
  state.statusSubs.clear();
}

/** Menyalakan frame `hello` — daftar topik yang didukung "server" dalam test ini. */
export function setTopics(t: EventTopic[]): void {
  state.topics = t;
  for (const cb of state.topicsSubs) cb(t);
}

/** Mendorong satu frame langganan; hanya mendarat di pelanggan yang `key`-nya cocok. */
export function emitTopic(m: EventMsg & { key: string }): void {
  state.silentSince = Date.now();
  for (const h of state.frameSubs.get(m.key) ?? []) h(m);
}

export function setStatus(s: Partial<typeof state.status>): void {
  state.status = { ...state.status, ...s };
  for (const cb of state.statusSubs) cb(state.status);
}

export function setSilentSince(v: number | null): void { state.silentSince = v; }

/** Parameter langganan terakhir untuk sebuah topik — `undefined` bila tak ada. */
export function lastSubParams(topic: EventTopic): Record<string, unknown> | undefined {
  return [...state.subs].reverse().find((s) => s.topic === topic)?.params;
}

/** Semua langganan aktif untuk sebuah topik (mis. empat QueueSection). */
export function allSubs(topic: EventTopic): Record<string, unknown>[] {
  return state.subs.filter((s) => s.topic === topic).map((s) => s.params);
}

export const eventsStub = {
  subscribeTopic: (topic: EventTopic, params: Record<string, unknown>, onData: Handler) => {
    const key = subKey(topic, params);
    state.subs.push({ topic, params });
    let set = state.frameSubs.get(key);
    if (!set) { set = new Set(); state.frameSubs.set(key, set); }
    set.add(onData);
    return () => {
      set!.delete(onData);
      const i = state.subs.findIndex((s) => s.topic === topic && subKey(s.topic, s.params) === key);
      if (i >= 0) state.subs.splice(i, 1);
    };
  },
  eventsTopics: () => state.topics,
  subscribeTopics: (cb: (t: EventTopic[]) => void) => {
    state.topicsSubs.add(cb);
    return () => { state.topicsSubs.delete(cb); };
  },
  eventsSilentSince: () => state.silentSince,
  eventsStatus: () => state.status,
  subscribeStatus: (cb: (s: typeof state.status) => void) => {
    state.statusSubs.add(cb);
    return () => { state.statusSubs.delete(cb); };
  },
  subscribe: () => () => {},
};
```

Pemasangannya di tiap berkas test (Task 6–10) selalu bentuk yang sama:

```ts
import { eventsStub, resetEventsStub, setTopics, emitTopic, setStatus, lastSubParams, allSubs } from "./helpers/events-stub";
vi.mock("../src/api/events", () => eventsStub);
beforeEach(() => { resetEventsStub(); localStorage.clear(); });
```

> `vi.mock` di-hoist ke puncak berkas, jadi `eventsStub` harus berupa objek modul-level (bukan
> dibangun di dalam `beforeEach`) — itulah kenapa reset-nya fungsi terpisah.

- [x] **Step 2: Tulis test yang gagal**

Create `src/test/use-live-topic.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { useLiveTopic } from "../src/api/live";
import { LiveConnectionBadge } from "../src/ds";
import { eventsStub, resetEventsStub, setTopics, emitTopic, setStatus, setSilentSince } from "./helpers/events-stub";

vi.mock("../src/api/events", () => eventsStub);

function Probe({ onRefetch }: { onRefetch: () => void }) {
  const [n, setN] = React.useState(0);
  useLiveTopic({
    topic: "tickets", params: { page: 1, limit: 20 },
    apply: () => setN((x) => x + 1), refetch: onRefetch, pollMs: 5000,
  });
  return <div data-testid="n">{n}</div>;
}

describe("SPEC-908 · useLiveTopic", () => {
  beforeEach(() => { resetEventsStub(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("server MENDUKUNG topiknya → nol setInterval, refetch tak pernah dipanggil", async () => {
    setTopics(["tickets"]);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("frame tiba → apply dipanggil, refetch tetap nol", async () => {
    setTopics(["tickets"]);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { emitTopic({ t: "tickets", key: "…", data: {} }); });
    expect(screen.getByTestId("n").textContent).toBe("1");
    expect(refetch).not.toHaveBeenCalled();
  });

  it("server TAK punya topiknya (hello tanpa `tickets`) → fallback poll menyala di pollMs", async () => {
    setTopics(["git"]);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("socket BISU 15 dtk tanpa `hello` → fallback poll menyala (WS terhalang proxy)", async () => {
    setTopics([]); setSilentSince(null);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(refetch).toHaveBeenCalled();
  });

  it("tab tersembunyi tak pernah memicu refetch fallback", async () => {
    setTopics([]); setSilentSince(null);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("SPEC-908 · LiveConnectionBadge", () => {
  it("diam saat terhubung", () => {
    setStatus({ connected: true, since: Date.now(), paused: false });
    render(<LiveConnectionBadge />);
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
  });

  it("diam saat `paused` — tab tersembunyi ditutup ATAS PERMINTAAN KITA, bukan gangguan", () => {
    setStatus({ connected: false, since: Date.now() - 60_000, paused: true });
    render(<LiveConnectionBadge />);
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
  });

  it("muncul hanya setelah putus melewati grace 6 dtk", () => {
    setStatus({ connected: false, since: Date.now() - 2_000, paused: false });
    const { rerender } = render(<LiveConnectionBadge />);
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
    setStatus({ connected: false, since: Date.now() - 9_000, paused: false });
    rerender(<LiveConnectionBadge />);
    expect(screen.getByText(/koneksi terputus/i)).toBeTruthy();
  });
});
```

- [x] **Step 3: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/use-live-topic.test.tsx`
Expected: FAIL — modul `../src/api/live` tak ada.

- [x] **Step 4: Implementasi `useLiveTopic`**

Create `src/src/api/live.ts`:

```ts
import React from "react";
import type { EventMsg, EventTopic, TopicParams } from "@hanoman/shared";
import {
  subscribeTopic, eventsTopics, subscribeTopics, eventsSilentSince,
  eventsStatus, subscribeStatus, type EventsStatus,
} from "./events";

// SPEC-908 · socket bisu selama ini tanpa satu pun frame = WS terhalang (proxy yang menolak
// upgrade) padahal HTTP hidup. Baru di situ polling HTTP dihidupkan lagi.
const FALLBACK_AFTER_MS = 15_000;

// SPEC-897 · status socket `events` yang sudah ada — pengamat, tak membuka koneksi sendiri.
export function useEventsStatus(): EventsStatus {
  const [status, setStatus] = React.useState(eventsStatus);
  React.useEffect(() => {
    setStatus(eventsStatus());   // bisa sudah berubah antara render pertama dan efek ini
    return subscribeStatus(setStatus);
  }, []);
  return status;
}

/**
 * SPEC-908 · satu tempat untuk "kapan menyegarkan". Muat AWAL tetap HTTP (layar memanggil
 * `load()`-nya sendiri); hook ini hanya mendorong pembaruan.
 *
 * `apply` sengaja tak punya akses ke state loading/error layar — sifat silent refresh karena itu
 * dijaga secara konstruksi, bukan oleh disiplin pemanggil.
 */
export function useLiveTopic<T extends EventTopic>(o: {
  topic: T; params: TopicParams[T];
  apply: (m: Extract<EventMsg, { t: T }>) => void;
  refetch: () => void; pollMs: number;
}): void {
  const { topic, params, pollMs } = o;
  const applyRef = React.useRef(o.apply); applyRef.current = o.apply;
  const refetchRef = React.useRef(o.refetch); refetchRef.current = o.refetch;
  // Params adalah objek baru tiap render; kuncinya yang stabil, bukan referensinya.
  const paramsKey = JSON.stringify(params);

  // Daftar topik disimpan sebagai STATE, bukan dibaca dari modul saat render: kalau hanya
  // `supported` yang di-state-kan, transisi [] → ["git"] pada layar `tickets` tak mengubah
  // `supported` (tetap false), React membatalkan render, dan keputusan fallback membeku pada
  // nilai lama — layar tak pernah menyalakan poll-nya.
  const [topics, setTopics] = React.useState<EventTopic[]>(() => eventsTopics());
  React.useEffect(() => {
    setTopics(eventsTopics());   // bisa sudah berubah antara render pertama dan efek ini
    return subscribeTopics(setTopics);
  }, []);
  const supported = topics.includes(topic);

  React.useEffect(
    () => subscribeTopic(topic, params, (m) => applyRef.current(m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topic, paramsKey],
  );

  // Fallback: hanya pada BUKTI, bukan pada ketiadaan bukti.
  const [blind, setBlind] = React.useState(false);
  React.useEffect(() => {
    if (supported || topics.length > 0) { setBlind(false); return; }   // server menjawab
    const t = setTimeout(() => { if (eventsSilentSince() === null) setBlind(true); }, FALLBACK_AFTER_MS);
    return () => clearTimeout(t);
  }, [supported, topics.length]);

  const polling = !supported && (blind || topics.length > 0);
  React.useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => { if (!document.hidden) refetchRef.current(); }, pollMs);
    return () => clearInterval(t);
  }, [polling, pollMs, paramsKey]);
}
```

Hapus `useEventsStatus` lokal di `src/src/screens/HanomanPet.tsx:63-70` dan impor dari `../api/live` — satu definisi.

- [x] **Step 5: Implementasi `LiveConnectionBadge`**

Create `src/src/ds/components/live.tsx`:

```tsx
import React from "react";
import { Badge } from "./feedback";
import { useEventsStatus } from "../../api/live";

// SPEC-897 · grace yang menelan tiga percobaan reconnect (backoff 0,5 → 1 → 2 dtk) supaya satu
// blip jaringan tak melahirkan lencana yang berkedip.
const OFFLINE_MS = 6_000;

/**
 * SPEC-908 · "terputus adalah kondisi, bukan ketiadaan kondisi". `paused` (tab tersembunyi;
 * socket ditutup ATAS PERMINTAAN KITA, api/events.ts:77) bukan gangguan dan tak pernah tampil.
 */
export function LiveConnectionBadge({ className = "" }: { className?: string }) {
  const s = useEventsStatus();
  const [now, setNow] = React.useState(() => Date.now());
  const down = !s.connected && !s.paused;
  React.useEffect(() => {
    if (!down) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [down]);
  if (!down || now - s.since < OFFLINE_MS) return null;
  return (
    <Badge tone="warn" variant="soft" icon="wifi-off" className={className}>
      koneksi terputus · menyambung ulang…
    </Badge>
  );
}
```

> **Dua hal wajib diperiksa, bukan diasumsikan:** (1) nama tone yang sah di `Badge` — buka `src/src/ds/components/feedback.tsx:19` dan pakai nilai `tone` yang benar-benar ada (`warn`/`warning`/…); (2) nama ikon `wifi-off` harus benar-benar ada di peta ikon — 15 nama lucide lama pernah jatuh senyap ke `Circle` di ±123 call site. Verifikasi dengan `grep -n "wifi-off" src/src/ds/*.tsx src/src/ds/**/*.ts*`; kalau tak ada, pilih nama yang ada di peta tersebut.

Tambahkan `export { LiveConnectionBadge } from "./components/live";` di `src/src/ds/index.ts`.

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/use-live-topic.test.tsx src/test/hanoman-pet.test.tsx`
Expected: PASS. `hanoman-pet.test.tsx` ikut karena `useEventsStatus` pindah berkas.

- [x] **Step 7: Commit**

```bash
git add src/src/api/live.ts src/src/ds/components/live.tsx src/src/ds/index.ts src/src/screens/HanomanPet.tsx src/test/use-live-topic.test.tsx src/test/helpers/events-stub.ts
git commit -m "feat(dashboard): useLiveTopic + indikator koneksi mati (SPEC-908)

Fallback poll menyala hanya pada BUKTI — hello tanpa topiknya, atau socket bisu
15 dtk (WS terhalang proxy). Selama WS sehat: nol setInterval, nol HTTP berkala.
apply() tak punya akses ke state loading/error layar, jadi silent refresh dijaga
secara konstruksi, bukan oleh disiplin pemanggil."
```

---

## Task 7: TriageScreen

**Files:**
- Modify: `src/src/screens/TriageScreen.tsx:19,359-378`
- Test: `src/test/triage-live.test.tsx` (create); `src/test/triage.test.tsx`, `src/test/triage-pager.test.tsx`, `src/test/triage-state-persist.test.tsx` harus tetap hijau

**Interfaces:**
- Consumes: `useLiveTopic`, `LiveConnectionBadge` (Task 6).

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/triage-live.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
// …mock ../src/api/client dan ../src/api/events dengan pola yang dipakai src/test/triage.test.tsx…

describe("SPEC-908 · TriageScreen live", () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("tidak men-poll HTTP saat WS mendukung topiknya", async () => {
    setTopics(["tickets"]);
    const listTickets = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 });
    renderTriage({ listTickets });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(listTickets).toHaveBeenCalledTimes(1);   // hanya muat awal
  });

  it("frame WS memperbarui daftar TANPA layar berkedip ke loading", async () => {
    setTopics(["tickets"]);
    renderTriage({ listTickets: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, unreviewed: 0 }) });
    await act(async () => {});
    await act(async () => {
      emitTopic({
        t: "tickets", key: subKey("tickets", { page: 1, limit: 20 }),
        data: { items: [ticket("t1", "Terminal lemot")], total: 1, page: 1, pageSize: 20, unreviewed: 1 },
      });
    });
    expect(screen.getByText("Terminal lemot")).toBeTruthy();
    expect(screen.queryByText(/Memuat/i)).toBeNull();
  });

  it("berlangganan dengan halaman & filter yang SEDANG aktif — operator tak dilempar ke halaman 1", async () => {
    setTopics(["tickets"]);
    localStorage.setItem("hn.ui.v1.triage.page", "3");
    localStorage.setItem("hn.ui.v1.triage.status", '"new"');
    renderTriage({ listTickets: vi.fn().mockResolvedValue({ items: [], total: 100, page: 3, pageSize: 20, unreviewed: 0 }) });
    await act(async () => {});
    expect(lastSubParams("tickets")).toEqual({ page: 3, limit: 20, status: "new" });
  });

  it("frame gagal/absen tak mem-blank daftar yang sudah tampil", async () => {
    setTopics(["tickets"]);
    renderTriage({ listTickets: vi.fn().mockResolvedValue({ items: [ticket("t1", "Terminal lemot")], total: 1, page: 1, pageSize: 20, unreviewed: 1 }) });
    await act(async () => {});
    await act(async () => { setStatus({ connected: false, since: Date.now() - 9_000, paused: false }); await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByText("Terminal lemot")).toBeTruthy();
    expect(screen.getByText(/koneksi terputus/i)).toBeTruthy();
  });
});
```

> Bentuk `localStorage` untuk `usePersistedState` **disalin dari `src/test/triage-state-persist.test.tsx`** — kunci dan encoding-nya diambil dari sana, jangan ditebak.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/triage-live.test.tsx`
Expected: FAIL — `listTickets` dipanggil berkali-kali (interval masih ada), `lastSubParams` kosong.

- [x] **Step 3: Ganti `setInterval` dengan `useLiveTopic`**

Di `src/src/screens/TriageScreen.tsx`, ganti blok `:373-377`:

```tsx
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
```

dengan:

```tsx
  // SPEC-908 · pembaruan didorong lewat langganan `/events/ws`. Params = state layar yang SEDANG
  // aktif, jadi halaman & penyaring yang berjalan dihormati secara konstruksi: frame halaman lain
  // punya `key` lain dan tak mungkin mendarat di sini.
  useLiveTopic({
    topic: "tickets",
    params: {
      project: project || undefined, status: status || undefined, q: q || undefined,
      page, limit: TICKET_PAGE,
    },
    apply: (m) => { setList(m.data.items); setTotal(m.data.total); setUnreviewed(m.data.unreviewed); setState("ready"); },
    refetch: () => load(true),
    pollMs: POLL_MS,
  });
```

Tambahkan `import { useLiveTopic } from "../api/live";` dan `LiveConnectionBadge` ke impor `../ds`. Pasang `<LiveConnectionBadge />` di baris header layar, di samping `ResetViewButton`. **Jangan** hapus `POLL_MS` — ia kini kadens fallback.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run \
  src/test/triage-live.test.tsx src/test/triage.test.tsx src/test/triage-pager.test.tsx \
  src/test/triage-state-persist.test.tsx src/test/triage-github.test.tsx
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/TriageScreen.tsx src/test/triage-live.test.tsx
git commit -m "feat(triage): pembaruan lewat langganan WS, bukan poll 5 dtk (SPEC-908)"
```

---

## Task 8: SchedulerScreen (+ QueueSection, `nonce` dicabut)

**Files:**
- Modify: `src/src/screens/SchedulerScreen.tsx:15,172-195,301-317,363-383`
- Test: `src/test/scheduler-live.test.tsx` (create); `src/test/scheduler-screen.test.tsx`, `src/test/scheduler-queue-pager.test.tsx`, `src/test/scheduler-nav.test.tsx`, `src/test/scheduler-lead-state-persist.test.tsx` tetap hijau

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/scheduler-live.test.tsx`:

```tsx
describe("SPEC-908 · SchedulerScreen live", () => {
  it("nol poll HTTP saat WS mendukung: getSchedulerState & getSchedulerQueue masing-masing 1×", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    const getSchedulerState = vi.fn().mockResolvedValue(stateFixture());
    const getSchedulerQueue = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    renderScheduler({ getSchedulerState, getSchedulerQueue });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getSchedulerState).toHaveBeenCalledTimes(1);
    // Empat QueueSection = empat muat awal, bukan lebih.
    expect(getSchedulerQueue).toHaveBeenCalledTimes(4);
  });

  it("empat QueueSection berlangganan dengan `status` DAN halaman masing-masing", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    localStorage.setItem("hn.ui.v1.scheduler.queue-failed-page", "2");
    renderScheduler({});
    await act(async () => {});
    const subs = allSubs("schedulerQueue");
    expect(subs).toHaveLength(4);
    expect(subs.find((s) => s.status === "failed")!.page).toBe(2);
    expect(subs.find((s) => s.status === "queued")!.page).toBe(1);
  });

  it("frame schedulerQueue hanya mendarat di seksi yang kuncinya cocok", async () => {
    setTopics(["schedulerState", "schedulerQueue"]);
    renderScheduler({});
    await act(async () => {});
    await act(async () => {
      emitTopic({
        t: "schedulerQueue", key: subKey("schedulerQueue", { status: "failed", page: 1, limit: 10 }),
        data: { items: [queueItem("q9", "SPEC-9")], total: 1, page: 1, pageSize: 10 },
      });
    });
    expect(within(section("Gagal")).getByText(/SPEC-9/)).toBeTruthy();
    expect(within(section("Antrean")).queryByText(/SPEC-9/)).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/scheduler-live.test.tsx`
Expected: FAIL.

- [x] **Step 3: Cabut `nonce` dari SchedulerScreen**

Hapus `const [nonce, setNonce] = React.useState(0);` (`:303`) dan `setNonce((n) => n + 1)` di dalam `load` (`:308`). Ganti blok interval (`:311-315`) dengan:

```tsx
  // SPEC-908 · state scheduler didorong lewat langganan; `nonce` SPEC-523 tak diperlukan lagi
  // karena tiap QueueSection kini berlangganan halamannya sendiri.
  useLiveTopic({
    topic: "schedulerState", params: {},
    apply: (m) => { setState(m.state); setPhase("ready"); },
    refetch: () => load(true), pollMs: POLL_MS,
  });
```

Hapus prop `nonce` dari keempat pemanggilan `<QueueSection …>` (`:363`, `:369`, `:378`, `:381`) dan dari signature-nya (`:172`).

- [x] **Step 4: Buat QueueSection berlangganan sendiri**

Ganti effect `:182-195` di `QueueSection`:

```tsx
  const load = React.useCallback(() => {
    api.getSchedulerQueue({ status, page, limit: QUEUE_PAGE })
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => { /* muat diam tak pernah mem-blank seksi yang sudah tampil */ });
  }, [status, page]);
  React.useEffect(() => { load(); }, [load]);
  useLiveTopic({
    topic: "schedulerQueue", params: { status, page, limit: QUEUE_PAGE },
    apply: (m) => { setItems(m.data.items); setTotal(m.data.total); },
    refetch: load, pollMs: POLL_MS,
  });
```

> Perhatikan: `catch` lama menyetel `setItems([])`/`setTotal(0)`. Itu **dipertahankan hanya untuk muat awal** — kalau ingin bentuk lama persis, biarkan `catch` di `load()` seperti aslinya. Yang tak boleh adalah pembaruan yang datang mem-blank seksi; `apply` memang tak punya jalur error.

`status` di `QueueSection` bertipe string; sempitkan prop-nya ke `TopicParams["schedulerQueue"]["status"]` supaya cocok dengan skema.

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run \
  src/test/scheduler-live.test.tsx src/test/scheduler-screen.test.tsx \
  src/test/scheduler-queue-pager.test.tsx src/test/scheduler-nav.test.tsx \
  src/test/scheduler-lead-state-persist.test.tsx
```
Expected: semua PASS.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/SchedulerScreen.tsx src/test/scheduler-live.test.tsx
git commit -m "feat(scheduler): langganan WS per seksi antrean, nonce SPEC-523 dicabut (SPEC-908)

Tiap QueueSection kini berlangganan (status, page)-nya sendiri, jadi penanda
muat-ulang yang dulu di-bump poll state tak punya pekerjaan lagi."
```

---

## Task 9: LeadScreen

**Files:**
- Modify: `src/src/screens/LeadScreen.tsx:14,287-314`
- Test: `src/test/lead-live.test.tsx` (create); `src/test/lead-screen.test.tsx`, `src/test/lead-pager.test.tsx` tetap hijau

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/lead-live.test.tsx`:

```tsx
describe("SPEC-908 · LeadScreen live", () => {
  it("nol poll HTTP saat WS mendukung", async () => {
    setTopics(["lead"]);
    const getLeadStatus = vi.fn().mockResolvedValue(leadStatusFixture());
    renderLead({ getLeadStatus });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getLeadStatus).toHaveBeenCalledTimes(1);
  });

  it("satu frame menyetel status, decisions, dan flows SEKALIGUS — tak ada campuran dua generasi", async () => {
    setTopics(["lead"]);
    renderLead({});
    await act(async () => {});
    await act(async () => {
      emitTopic({
        t: "lead", key: subKey("lead", { decPage: 1, flowPage: 1, limit: 20 }),
        status: leadStatusFixture({ lastPulseAt: "2026-08-23T00:00:00.000Z" }),
        decisions: { items: [decision("d1", "Lanjut")], total: 1, page: 1, pageSize: 20 },
        flows: { items: [], total: 0, page: 1, pageSize: 20 },
      });
    });
    expect(screen.getByText(/Lanjut/)).toBeTruthy();
  });

  it("berlangganan dengan filter project & kedua nomor halaman yang aktif", async () => {
    setTopics(["lead"]);
    localStorage.setItem("hn.ui.v1.lead.filter", '"proj-a"');
    localStorage.setItem("hn.ui.v1.lead.decPage", "2");
    renderLead({});
    await act(async () => {});
    expect(lastSubParams("lead")).toEqual({ projectId: "proj-a", decPage: 2, flowPage: 1, limit: 20 });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/lead-live.test.tsx`
Expected: FAIL.

- [x] **Step 3: Ganti interval**

Di `src/src/screens/LeadScreen.tsx`, ganti blok `:310-313` dengan:

```tsx
  // SPEC-908 · satu topik untuk ketiga daftar — cermin `load()` yang sudah satu Promise.all.
  // Memecahnya jadi tiga topik akan menampilkan campuran dua generasi data yang hari ini
  // tak mungkin terjadi.
  useLiveTopic({
    topic: "lead",
    params: {
      projectId: filter === "all" ? undefined : filter,
      decPage, flowPage, limit: LIST_PAGE,
    },
    apply: (m) => {
      setState(m.status);
      setDecisions(m.decisions.items); setDecTotal(m.decisions.total);
      setFlows(m.flows.items); setFlowTotal(m.flows.total);
      setPhase("ready");
    },
    refetch: () => load(true), pollMs: POLL_MS,
  });
```

Pasang `<LiveConnectionBadge />` di header layar, di samping `ResetViewButton`.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run \
  src/test/lead-live.test.tsx src/test/lead-screen.test.tsx src/test/lead-pager.test.tsx \
  src/test/scheduler-lead-state-persist.test.tsx
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/LeadScreen.tsx src/test/lead-live.test.tsx
git commit -m "feat(lead): status + decisions + flows lewat satu frame langganan (SPEC-908)"
```

---

## Task 10: GitGraph

**Files:**
- Modify: `src/src/screens/GitGraph.tsx:21,306-350`
- Test: `src/test/git-graph-live.test.tsx` (create); `src/test/git-graph-view.test.tsx`, `src/test/git-graph-render.test.tsx`, `src/test/git-graph.test.ts` tetap hijau

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/git-graph-live.test.tsx`:

```tsx
describe("SPEC-908 · GitGraph live", () => {
  it("nol poll HTTP saat WS mendukung — ideGraph/ideStatus/ideStashes masing-masing 1×", async () => {
    setTopics(["git"]);
    const ideGraph = vi.fn().mockResolvedValue({ commits: [], current: "main", total: 0 });
    const ideStatus = vi.fn().mockResolvedValue(statusFixture());
    const ideStashes = vi.fn().mockResolvedValue([]);
    renderGraph({ ideGraph, ideStatus, ideStashes, projectId: "p1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(ideGraph).toHaveBeenCalledTimes(1);
    expect(ideStatus).toHaveBeenCalledTimes(1);
    expect(ideStashes).toHaveBeenCalledTimes(1);
  });

  it("satu frame menyetel graph + status + stash sekaligus", async () => {
    setTopics(["git"]);
    renderGraph({ projectId: "p1" });
    await act(async () => {});
    await act(async () => {
      emitTopic({
        t: "git", key: subKey("git", { projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true }),
        graph: { commits: [commit("abc1234", "Perbaiki graph")], current: "main", total: 1 },
        status: statusFixture({ clean: false, unstaged: ["a.ts"] }),
        stashes: [{ ref: "stash@{0}", message: "wip", at: "2026-08-23T00:00:00Z" }],
      });
    });
    expect(screen.getByText(/Perbaiki graph/)).toBeTruthy();
  });

  it("`more()` menaikkan limit → langganan pindah ke kunci baru", async () => {
    setTopics(["git"]);
    renderGraph({ projectId: "p1", commits: 200 });
    await act(async () => {});
    expect(lastSubParams("git")!.limit).toBe(200);
    await act(async () => { screen.getByRole("button", { name: /muat lebih/i }).click(); });
    expect(lastSubParams("git")!.limit).toBe(400);
  });

  it("frame WS tak menyentuh state paging maupun melempar posisi gulir", async () => {
    setTopics(["git"]);
    renderGraph({ projectId: "p1" });
    await act(async () => {});
    await act(async () => {
      emitTopic({ t: "git", key: subKey("git", { projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true }),
        graph: { commits: [], current: "main", total: 0 }, status: statusFixture(), stashes: [] });
    });
    expect(screen.queryByText(/Memuat/i)).toBeNull();
  });
});
```

> Nama tombol "muat lebih" dan fixture commit **disalin dari `src/test/git-graph-view.test.tsx`** — jangan menebak label UI.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run src/test/git-graph-live.test.tsx`
Expected: FAIL.

- [x] **Step 3: Ganti interval**

Di `src/src/screens/GitGraph.tsx`, ganti blok `:346-349` dengan:

```tsx
  // SPEC-908 · perubahan repo yang datang di luar aksi sinkron sendiri (sesi claude yang commit,
  // konflik merge/rebase diselesaikan di Terminal) kini didorong lewat langganan `/events/ws`,
  // bukan poll 4 dtk. `apply` sengaja tak menyentuh `state`/`paging`: pembaruan yang datang tak
  // boleh membuat graph berkedip maupun melempar posisi gulir operator (SPEC-245/351).
  useLiveTopic({
    topic: "git",
    params: {
      projectId, limit: gopts.limit, branch: gopts.branch,
      showRemote: gopts.showRemote, showTags: gopts.showTags,
    },
    apply: (m) => {
      setRows(computeLanes(m.graph.commits));
      setCurrent(m.graph.current);
      setTotal(m.graph.total ?? 0);
      setHasMore(m.graph.commits.length >= gopts.limit);
      setState("ready");
      setStatus(m.status);
      setStashes(m.stashes);
    },
    refetch: () => load(true), pollMs: POLL_MS,
  });
```

Pasang `<LiveConnectionBadge />` di toolbar graph.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
env -u HANOMAN_CONTROL_ORIGINS pnpm vitest --run \
  src/test/git-graph-live.test.tsx src/test/git-graph-view.test.tsx \
  src/test/git-graph-render.test.tsx src/test/git-graph.test.ts
```
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/GitGraph.tsx src/test/git-graph-live.test.tsx
git commit -m "feat(gitgraph): graph+status+stash lewat langganan WS berparameter (SPEC-908)

Satu \`git log\` per PARAMETER yang benar-benar ditonton, bukan per klien per
4 dtk; hasilnya dibagi semua tab yang sedang melihat project & opsi yang sama."
```

---

## Task 11: Docs — ADR baru + doc arsitektur + index

**Files:**
- Create: `internal/docs/adr/<NNNN>-langganan-berparameter-events-ws.md`
- Modify: `internal/docs/README.md`, `internal/docs/architecture/api-contract.md:1228-1234,1365,1507`, `internal/docs/architecture/stack.md:6,33`, `internal/docs/frontend/frontend-implementation.md:216-221,346`

- [x] **Step 1: Tentukan nomor ADR yang belum terpakai**

Run:
```bash
ls internal/docs/adr/ | sed 's/-.*//' | sort -n | tail -5
grep -n "^- \[01" internal/docs/README.md | head -3
git log --oneline -30 --all -- internal/docs/adr | head -20
```
Ambil nomor **satu di atas** yang tertinggi dari ketiganya. Nomor ADR bertabrakan antar-sesi konkuren — periksa ketiga sumber, bukan hanya `ls`.

- [x] **Step 2: Tulis ADR**

Create `internal/docs/adr/<NNNN>-langganan-berparameter-events-ws.md` dengan struktur ADR repo (Konteks / Keputusan / Konsekuensi), memuat:

- **Status:** aktif (SPEC-908). **Mengamandemen ADR-0039** (kanal tak lagi read-only; delapan grup global tetap apa adanya, langganan berparameter berdampingan). **Menegakkan** ADR-0024, ADR-0087, ADR-0107, ADR-0115, ADR-0134, ADR-0014/0016.
- **Konteks:** empat layar berparameter tertinggal karena `GROUPS` adalah snapshot global tanpa parameter dan `routes/events.ts` tak pernah memasang `socket.on("message")`. Sebutkan angkanya: 4 layar × 5/5/5/4 dtk per tab.
- **Keputusan** beserta **alasan menolak invalidasi/versi**: satu round-trip HTTP tersisa; dua sumber kebenaran bentuk muatan; dan untuk git, menghitung "apakah berubah" praktis sama mahalnya dengan menghitung datanya.
- **Lima pagar biaya** (§4 spec): entri hanya untuk parameter berpelanggan; dedup signature; satu build untuk N klien lewat `key` turunan-parameter; kadens per-topik ≤ kadens lama; `runEntry` tak pernah di-await sehingga tak memblokir grup 1 dtk maupun PTY terminal.
- **Gerbang principal** `kind === "user"` beserta alasannya (`/events/ws` = GLOBAL_READ, topik menyentuh `support`/`lead`/`ide`).
- **Degradasi** lewat frame `hello` (ADR-0087) dan dua keadaan fallback yang bisa dibuktikan.
- **Konsekuensi & plafon:** permukaan masuk bertambah (dibatasi 64 KiB / 16 subs / zod `.strict()`); `tickets` masih men-scan tabel penuh dan `take` di query adalah perbaikan terpisah; empat `QueueSection` = empat entri per layar Scheduler.

- [x] **Step 3: Perbarui doc arsitektur**

`internal/docs/architecture/api-contract.md` §Events (`:1228-1234`) — ganti baris `klien->server: — (read-only feed; frame masuk diabaikan)` dengan blok frame masuk, daftar topik, `key`, kadens, dan gerbang principal.

`:1365` — kalimat "Realtime area Triase = **HTTP polling** (pola GitGraph), bukan kanal WS baru (ADR-0039)" **wajib diperbarui**: kini langganan `tickets` di kanal yang sama, HTTP tetap ada untuk muat awal & fallback.

`:1507` — "Semua HTTP (polling) — TAK ADA kanal WebSocket baru (ADR-0039 utuh)" pada blok hanoman-lead: kanal baru memang tetap tak ada, tetapi lead kini punya topik langganan di kanal yang sudah ada. Perbarui kalimatnya supaya tak terbaca sebagai larangan yang masih berlaku.

`internal/docs/architecture/stack.md:6,33` — baris Realtime: WebSocket untuk terminal **dan** seluruh data live dashboard (grup global + langganan berparameter); HTTP tinggal muat awal & fallback.

`internal/docs/frontend/frontend-implementation.md:216-221` — `useLiveTopic`, `subscribeTopic`, degradasi `hello`, `LiveConnectionBadge`; `:346` — tambahkan bahwa `useEventsStatus` kini hidup di `api/live.ts` dan dipakai indikator keempat layar, bukan hanya pet.

- [x] **Step 4: Tautkan ADR di index**

Tambahkan satu baris di `internal/docs/README.md` pada blok ADR (mengikuti format tetangganya, paling atas karena nomornya tertinggi).

Run: `pnpm hanoman docs index --check` (atau `node cli/dist/index.js docs index --check` bila CLI belum ter-build). Expected: index utuh.

- [x] **Step 5: Commit**

```bash
git add internal/docs
git commit -m "docs(events): ADR-<NNNN> langganan berparameter mengamandemen ADR-0039 (SPEC-908)"
```

---

## Task 12: Verifikasi menyeluruh & smoke endpoint

**Files:** tak ada perubahan kode kecuali perbaikan temuan.

- [x] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: hijau. **Jangan terima "no test files" sebagai bukti** — `--changed` menyalakan `passWithNoTests`. Pastikan jumlah berkas test yang berjalan masuk akal (≥ 25 berkas untuk perubahan seluas ini).

Kegagalan yang **bukan** regresi dan sudah terukur sebelumnya: 20 gagal `listChatSessions is not a function` di test portal (mock SPEC-854 ketinggalan di base), dan `placeholder-contract` merah karena tiga `<Input type="number">` di SettingsScreen. Verifikasi keduanya juga merah di `$HANOMAN_BASE_SHA` sebelum menyalahkan perubahan ini.

- [x] **Step 2: Typecheck ketiga paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```
Expected: nol error. (Tiga paket, bukan `-r`: `runner`/`cli` tak tersentuh.)

- [x] **Step 3: Jalankan agen `blast-radius`**

Minta ia memeriksa tempat lain yang seharusnya ikut berubah tapi tidak: cermin tipe `GraphCommit`/`RepoStatus`/`Stash` yang tersisa, konsumen `EventMsg` yang belum menangani `t` baru (`switch` tanpa `default`), berkas test yang men-stub `../src/api/events` (scout mendaftar enam: `terminal-history-button`, `new-project-reverse`, `workspace-state-persist`, `responsive-shell-modal`, `hanoman-pet`, `new-terminal-runtime`) dan kini kehilangan ekspor baru, serta doc kontrak yang masih menyebut `/events/ws` read-only. Perbaiki temuan yang nyata.

- [x] **Step 4: Smoke endpoint nyata di local**

Task ini menyentuh perilaku runtime endpoint, jadi sekali di akhir:

```bash
HANOMAN_HOME="$(mktemp -d)" TEST_DATABASE_URL= DATABASE_URL= \
  node server/dist/server.js &   # atau `pnpm dev`; catat PID-nya
# 1. keempat endpoint HTTP masih hidup (JANGAN dihapus — MCP/agent token/portal memakainya)
curl -s localhost:<port>/api/scheduler/state  | head -c 200
curl -s "localhost:<port>/api/tickets?page=1&limit=20" | head -c 200
curl -s localhost:<port>/api/lead/status      | head -c 200
curl -s "localhost:<port>/api/projects/<id>/graph?limit=5" | head -c 200
# 2. WS: sambung, kirim frame `sub`, pastikan frame `hello` lalu frame `tickets` ber-`key` tiba
```

> `HANOMAN_HOME` ke direktori sementara adalah **wajib**: smoke tanpa itu menulis `setup.token` ke home nyata, dan `.env` repo utama bisa bocor ke worktree sehingga server membuka DB yang salah. Bunuh server **per-PID** (`kill <pid>`), jangan `pkill -f`.

- [x] **Step 5: Jalankan agen `qa-verifier`**

Serahkan diff lengkap + hasil Step 1. Mintalah ia membuktikan bahwa test yang lulus benar-benar menguji perubahannya — khususnya bahwa test "nol poll HTTP" akan **merah** bila `setInterval` dikembalikan (scout memastikan **tak satu pun** test lama menegakkan kadens poll, jadi ini satu-satunya pengaman).

### Hasil verifikasi (dijalankan)

- **Test:** shared 26 berkas/190 · server 270 berkas/2 700 · src 165 berkas/1 151 · runner 11/175 · cli 15/124.
  Merah yang **bukan** regresi & terbukti pra-ada: `client-portal` + `portal-scroll` (21 gagal
  `portalApi.listChatSessions is not a function`, mock SPEC-854 ketinggalan di base; diff ini nol
  menyentuh portal), `pty.test.ts` (hijau lagi begitu `SSH_ASKPASS_REQUIRE=force` ambient di-unset),
  dan `notifications.route` "terbaru dulu" (dua `notification.create` beruntun bertabrakan di
  milidetik yang sama → `orderBy createdAt desc` seri; 1 lulus dari 3 run, tak tersentuh diff).
- **Typecheck:** shared + server + src nol error.
- **Smoke nyata:** sembilan endpoint HTTP lama tetap 200 dengan bentuk yang sama; `limit=abc`/`limit=0`
  kembali `pageSize: 1`. WS: satu socket, `hello` lalu keempat frame berparameter dalam 4–103 ms,
  `key` = `subKey` kanonik, topik tak dikenal dilewati per-entri; 20 dtk diam = **tepat 1 frame**
  per topik berparameter (dedup signature bekerja).
- **Temuan yang diperbaiki di task ini** (dari `blast-radius` + `qa-verifier`): regresi `limit` tak
  sah jadi dump tabel penuh; `hello` mengiklankan topik ke principal yang gerbangnya menolak;
  `broadcast()` tak menyapu langganan klien mati; `MAX_SUBS` tak ditegakkan di pengirim; serializer
  `TicketView` masih kembar; tujuh impor mati + komentar kontrak basi di `routes/lead.ts`; header
  `SchedulerScreen`; sembilan stub `../src/api/events` yang kehilangan ekspor baru; enam doc
  kontrak yang masih menyebut "HTTP polling"; dan tiga test invariant halaman yang belum ada.
- **Ditemukan pra-ada di base, lalu DIPERBAIKI atas permintaan:** `LeadScreen.tsx`
  `useEffect(() => { setDecPage(1); setFlowPage(1) }, [filter])` juga menyala saat **mount**, jadi
  nomor halaman yang dipersistensi SPEC-740 selalu dipulihkan ke 1 tiap layar Lead dibuka. Kini
  berpagar pembanding penyaring-yang-sedang-ditampilkan; AC-15 (ganti penyaring → halaman 1) tetap
  berlaku dan punya test-nya sendiri. Bentuk tanpa pagar yang sama **masih ada** di
  `TriageScreen.tsx:377`, `ProjectsScreen.tsx:127`, dan `BacklogScreen.tsx:915` — dicatat sebagai
  gotcha #8 di ADR-0115.

- [x] **Step 6: Centang seluruh kotak plan & commit terakhir**

```bash
grep -c '^- \[ \]' docs/superpowers/plans/2026-08-23-spec-908-realtime-ws-berparameter.md   # harus 0
git add -A && git commit -m "chore(spec-908): plan tuntas — verifikasi & smoke terekam"
git push origin HEAD:refs/heads/hanoman/spec-908
```
