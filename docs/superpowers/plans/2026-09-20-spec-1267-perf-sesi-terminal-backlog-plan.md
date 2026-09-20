# SPEC-1267 Perf Sesi Terminal di Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminal di Backlog responsif saat sesi agen berjalan: frame `specs` kecil dan hanya lahir saat berubah, nol I/O sinkron di jalur periodik, klien tak refetch/re-render per frame tak berubah.

**Architecture:** `liveSpecs()` dipecah menjadi `liveOverlayTick()` (efek, tiap tick) + `listSpecsLive()`/`listSpecsSlim()` (penyajian, hanya saat `specsDigest()` berubah). Frame WS `specs` memakai `SpecSlim` (tanpa `payload`/`objective`/`sourceHistory`); detail via `GET /specs/:id` baru; `GET /specs` memakai `SpecListItem`. Jalur periodik dipindah ke varian async di atas `listPanesShared()`; siar dibangun paralel; terminal diberi backpressure; klien terminal dioptimalkan. Setiap klaim perbaikan dipasangkan angka baseline (Task 0) vs sesudah (Task 11).

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), zod (`shared`), React+Vite, xterm.js (+ `@xterm/addon-webgl`), vitest.

Spec: `docs/superpowers/specs/2026-09-20-spec-1267-perf-sesi-terminal-backlog-design.md` (S0-S7, AC-S1…AC-S35).

## Global Constraints

- TypeScript strict; tanpa perubahan skema DB (tanpa migration).
- JANGAN mengubah: coalescing PTY 16 ms/cap 64 KB, satu WS events ref-count, `IMMEDIATE_PER_MIN`/`MAX_INFLIGHT`, dedup siaran (diganti bentuknya, bukan dibuang), `perMessageDeflate` (`server/src/app.ts:143-148`) sampai profil Task 11 membuktikan biaya (AC-S33a).
- Jangan menghidupkan guardrail/poller/queue yang dicabut (ADR-0024/0039).
- Tanpa lapis kompatibilitas klien lama (keputusan #2): tak ada `specsFrame`, tak ada penanda kapabilitas.
- `liveOverlayTick()` WAJIB jalan tiap tick walau digest tak berubah (AC-S6); dedup hanya memagari pembacaan set penuh.
- `filterSpecs()` WAJIB dijalankan sebelum pemetaan ke `SpecListItem` (AC-S20b); tanpa paginasi DB (ADR-0038).
- Test: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>` untuk test server; sebelum tiap commit cukup test tersentuh (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`), bukan suite penuh / `pnpm -r typecheck`.
- Docs tersentuh diperbarui di commit yang sama, ditautkan di `internal/docs/README.md`.
- Setelah tiap task: centang `- [x]` di berkas plan ini.
- Tanpa klaim perbaikan tanpa pasangan angka; ukur di DB terpisah (bukan `~/.hanoman`), skenario 1 vs 4 pane, mesin sama.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/src/services/events-profile.ts` (baru) | Instrumen `HANOMAN_EVENTS_PROFILE=1` (nol biaya saat mati) |
| `shared/src/entities.ts` | `zSpecListItem`, `zSpecSlim` (dirantai `.omit`) |
| `shared/src/dto.ts:816` | Frame `specs` → `SpecSlim[]` |
| `server/src/services/live-specs.ts` | Pecah: `liveOverlayTick`, `listSpecsLive`, `listSpecsSlim`, `specsDigest`, `liveSignature`; `liveSpecs` = komposisi |
| `server/src/routes/specs.ts` | `GET /specs/:id` baru; `GET /specs` → `SpecListItem` sesudah `filterSpecs` |
| `server/src/services/events.ts` | Sig sekali, `sig?` per grup, `allSettled`, `attach` pakai `g.last` |
| `server/src/services/presence/view.ts` / grup presence | Signature tanpa `lastSeenAt` lokal |
| `server/src/services/pty.ts`, `session-phases.ts` | Varian async + memo berkas fase; backpressure |
| `server/src/routes/terminal.ts`, `scheduler/*`, `worktree-project.ts`, `lead/engine.ts` | Migrasi ke `getSessionAsync` |
| `src/src/lib/specs-digest.ts` (baru) | `specsDigestOf`, `mergeSlim` (murni) |
| `src/src/App.tsx`, `BacklogScreen.tsx`, `ChangeSourceDialog.tsx`, `api/client.ts` | Dedup klien, detail via `getSpec` |
| `src/src/screens/TerminalScreen.tsx`, `TerminalPane.tsx` | Pane tersembunyi, WebGL, memo, ticker, resize |
| `internal/docs/**`, `internal/skills/hanoman/SKILL.md`, ADR baru | Dokumentasi |

(Jalur `src/src/...` disesuaikan dengan lokasi sebenarnya berkas; jalankan `git ls-files | grep <nama>` bila berbeda.)

---

### Task 0: Instrumen + baseline (langkah 0; AC-S18, AC-S32 sisi "sebelum")

**Files:**
- Create: `server/src/services/events-profile.ts`
- Modify: `server/src/services/events.ts` (`__tick`, `broadcast`)
- Test: `server/test/events-profile.test.ts`

**Interfaces:**
- Produces: `export const PROFILE: boolean`; `export function profStart(): number` (0 bila mati); `export function profEnd(group: string, t0: number, bytes: number, emitted: boolean): void`; `export function startLagMonitor(): void`.

- [ ] **Step 1: Tulis test gagal**

```ts
import { describe, it, expect, vi } from "vitest";
describe("events-profile", () => {
  it("mati: profStart tak memanggil hrtime", async () => {
    delete process.env.HANOMAN_EVENTS_PROFILE;
    vi.resetModules();
    const spy = vi.spyOn(process.hrtime, "bigint");
    const m = await import("../src/services/events-profile");
    expect(m.profStart()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
  it("hidup: profEnd mengakumulasi per grup", async () => {
    process.env.HANOMAN_EVENTS_PROFILE = "1";
    vi.resetModules();
    const m = await import("../src/services/events-profile");
    const t0 = m.profStart();
    m.profEnd("specs", t0, 1234, true);
    expect(m.__snapshot().specs.frames).toBe(1);
    expect(m.__snapshot().specs.bytes).toBe(1234);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/events-profile.test.ts` → FAIL (modul tak ada).

- [ ] **Step 3: Implementasi**

```ts
import { monitorEventLoopDelay } from "node:perf_hooks";
export const PROFILE = process.env.HANOMAN_EVENTS_PROFILE === "1";
type Acc = { builds: number[]; frames: number; bytes: number; ticks: number };
const acc: Record<string, Acc> = {};
let h: ReturnType<typeof monitorEventLoopDelay> | undefined;
export const profStart = (): number => (PROFILE ? Number(process.hrtime.bigint() / 1000n) : 0);
export function profEnd(group: string, t0: number, bytes: number, emitted: boolean): void {
  if (!PROFILE) return;
  const a = (acc[group] ??= { builds: [], frames: 0, bytes: 0, ticks: 0 });
  a.builds.push((Number(process.hrtime.bigint() / 1000n) - t0) / 1000);
  a.ticks++;
  if (emitted) { a.frames++; a.bytes += bytes; }
}
export const __snapshot = () => acc;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
export function startLagMonitor(): void {
  if (!PROFILE || h) return;
  h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  setInterval(() => {
    const ms = (n: number) => +(n / 1e6).toFixed(1);
    const rows = Object.entries(acc).map(([g, a]) => `${g}: build p95=${pct(a.builds, 0.95).toFixed(1)}ms frames=${a.frames}/${a.ticks} bytes=${a.bytes}`);
    console.log(`[events-profile] loop p50=${ms(h!.percentile(50))} p99=${ms(h!.percentile(99))} max=${ms(h!.max)}ms | ${rows.join(" | ")}`);
    h!.reset(); for (const k of Object.keys(acc)) delete acc[k];
  }, 10_000).unref();
}
```

Pasang di `__tick`: `const t0 = profStart();` sebelum `g.build()`, `profEnd(msg.t, t0, sig.length, emitted)` sesudahnya; panggil `startLagMonitor()` di `startLoop()`.

- [ ] **Step 4: Test lulus** — jalankan perintah Step 2 → PASS.

- [ ] **Step 5: Ukur baseline (WAJIB sebelum Task 1)**
  1. `export HANOMAN_HOME=$(mktemp -d)`; salin DB dev 1069 baris ke `$HANOMAN_HOME/hanoman.db` bila ada, kalau tidak seed 1069 baris lewat skrip sementara di scratchpad (1056 `done` dengan `payload` besar).
  2. `HANOMAN_EVENTS_PROFILE=1 node server/dist/server.js` (build dulu), buka Backlog di Chrome dengan 1 pane lalu 4 pane; catat 3 laporan 10 dtk tiap skenario.
  3. DevTools: hitung request `GET /specs`/menit dan frame WS `specs`/menit; ukuran satu frame `specs` mentah (`curl` atau log profil) dan deflate; profil Performance 30 dtk (CPU renderer) untuk 1 vs 4 pane.
  4. Tulis tabel "sebelum" ke `docs/superpowers/plans/2026-09-20-spec-1267-perf-sesi-terminal-backlog-baseline.md` (data, bukan laporan analisis; dirujuk Task 11).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/events-profile.ts server/src/services/events.ts server/test/events-profile.test.ts docs/superpowers/plans/2026-09-20-spec-1267-perf-sesi-terminal-backlog-baseline.md
git commit -m "perf(events): instrumen HANOMAN_EVENTS_PROFILE + baseline SPEC-1267"
```

---

### Task 1: Tipe `SpecListItem` & `SpecSlim` (AC-S1, AC-S20a)

**Files:**
- Modify: `shared/src/entities.ts` (dekat `zSpec`), `shared/src/dto.ts:816`, `shared/src/index.ts` bila perlu ekspor
- Test: `shared/test/spec-slim.test.ts`

**Interfaces:**
- Produces: `zSpecListItem`, `type SpecListItem = z.infer<typeof zSpecListItem>`, `zSpecSlim`, `type SpecSlim`; frame `{ t: "specs"; specs: SpecSlim[] }`.

- [ ] **Step 1: Test gagal**

```ts
import { zSpec, zSpecListItem, zSpecSlim } from "../src/entities";
it("SpecListItem tanpa payload/sourceHistory, tetap objective", () => {
  expect("payload" in zSpecListItem.shape).toBe(false);
  expect("sourceHistory" in zSpecListItem.shape).toBe(false);
  expect("objective" in zSpecListItem.shape).toBe(true);
});
it("SpecSlim tanpa objective; dependsOn/blockedBy dipertahankan bila ada di zSpec", () => {
  expect("objective" in zSpecSlim.shape).toBe(false);
  for (const k of ["dependsOn", "blockedBy"]) expect(k in zSpecSlim.shape).toBe(k in zSpec.shape);
});
```

- [ ] **Step 2:** `pnpm vitest --run shared/test/spec-slim.test.ts` → FAIL.
- [ ] **Step 3: Implementasi**

```ts
export const zSpecListItem = zSpec.omit({ payload: true, sourceHistory: true });
export type SpecListItem = z.infer<typeof zSpecListItem>;
export const zSpecSlim = zSpecListItem.omit({ objective: true });
export type SpecSlim = z.infer<typeof zSpecSlim>;
```
Ubah `dto.ts:816` menjadi `specs: SpecSlim[]`. Bila `zSpec` bukan `ZodObject` langsung (mis. `.extend`/refine), sesuaikan `.omit` pada objek dasarnya. Jalankan `pnpm --filter shared build` bila paket mengekspor dari `dist`.
- [ ] **Step 4:** test lulus.
- [ ] **Step 5: Commit** `feat(shared): SpecListItem/SpecSlim, frame specs ringkas`. (Tipe klien/server yang pecah dibetulkan di Task 2-5; commit ini boleh dibarengi sekadar cast sementara TIDAK boleh — jika compile pecah, satukan dengan Task 2 di commit yang sama.)

---

### Task 2: Pecah `liveSpecs()` + digest (AC-S4-S8, S20c)

**Files:**
- Modify: `server/src/services/live-specs.ts`
- Test: `server/test/live-specs-split.test.ts`; test lama `server/test/specs.route.test.ts` harus hijau TANPA diubah.

**Interfaces:**
- Produces:
  - `liveOverlayTick(): Promise<void>`
  - `listSpecsLive(filter?: {project?: string; source?: string}): Promise<Spec[]>` (overlay baca-saja + `decorateBlocked`)
  - `listSpecsSlim(): Promise<SpecSlim[]>`
  - `specsDigest(): Promise<string>`
  - `liveSignature(): Promise<string>`
  - `liveSpecs(filter)` = `await liveOverlayTick(); return listSpecsLive(filter)` (perilaku tak berubah)
- Consumes: `sessionPhasesBySpec()` sinkron dulu (diasyncan di Task 6; tulis lewat satu fungsi lokal `phases()` agar Task 6 mengganti satu titik).

- [ ] **Step 1: Test gagal** (pakai helper DB test yang dipakai `specs.route.test.ts`)

```ts
it("digest berubah saat update/tambah/hapus, tetap saat diam", async () => {
  await seed(3);
  const d0 = await specsDigest();
  expect(await specsDigest()).toBe(d0);
  await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "x", version: { increment: 1 } } });
  const d1 = await specsDigest(); expect(d1).not.toBe(d0);
  await prisma.spec.create({ data: newSpec("SPEC-9") });
  const d2 = await specsDigest(); expect(d2).not.toBe(d1);
  await prisma.spec.delete({ where: { id: "SPEC-9" } });
  expect(await specsDigest()).not.toBe(d2);
});
it("listSpecsSlim tak memuat payload/objective/sourceHistory", async () => {
  await seed(2);
  for (const s of await listSpecsSlim()) for (const k of ["payload", "objective", "sourceHistory"]) expect(k in s).toBe(false);
});
it("liveOverlayTick memajukan stage + persist walau tak ada yang memanggil listSpecs", async () => {
  // gunakan mock sessionPhasesBySpec persis seperti test 'advances + persists off-page' di specs.route.test.ts
});
it("liveSignature berubah saat plan berhenti memuat '- [ ]' (AC-S7)", async () => { /* tulis berkas plan di tmp cwd, ubah, bandingkan */ });
it("digest melempar → cabang pemanggil fail-open (diuji di Task 4)", () => {});
```
Isi placeholder komentar di atas dengan mock nyata sesuai pola test SPEC-199 yang ada (salin mock-nya; jangan biarkan kosong).

- [ ] **Step 2:** jalankan → FAIL.
- [ ] **Step 3: Implementasi**
  - Ekstrak inti overlay menjadi `applyOverlay(specs, live)` murni (mengembalikan `{out, advanced, doneNow}`).
  - `liveOverlayTick`: `live = await phases()`; bila `live.size===0` return; `findMany({where:{id:{in:[...live.keys()]}}})`; hitung advanced; jalankan blok write-through CAS + `recordHeadSha` + `notifySynced` + `recordCompletion` yang SAMA persis dengan kode lama (pindahkan, jangan tulis ulang logikanya).
  - `listSpecsLive`: `findMany` + sort `specNum` + `applyOverlay` baca-saja + `decorateBlocked`.
  - `listSpecsSlim`: `findMany({select: <semua kolom Spec kecuali payload, objective, sourceHistory>, orderBy})` + sort + overlay baca-saja + `decorateBlocked`. Daftar `select` dibangun dari `Object.keys(zSpecSlim.shape)` dikurangi field turunan (`blockedBy`, `dependsOn` bila turunan) agar tak berselisih.
  - `specsDigest`: `aggregate({_count:{_all:true}, _max:{updatedAt:true}, _sum:{version:true}})` → `sha1(`${count}:${max?.getTime()??0}:${sum??0}|${await liveSignature()}`)`.
  - `liveSignature`: dari `phases()` urut `specId`; `${specId}:${faseAktif}` + bila fase akhir `done` → `:${mtimeMs}:${size}` berkas plan (pakai `fs/promises.stat`, di-try/catch → `:0:0`). Gunakan helper gerbang plan di `session-phases.ts:176` untuk lokasi plan.
  - `liveSpecs` = komposisi.
- [ ] **Step 4:** `pnpm vitest --run --no-file-parallelism server/test/live-specs-split.test.ts server/test/specs.route.test.ts` → semua PASS (test lama tanpa edit).
- [ ] **Step 5: Commit** `refactor(specs): pecah liveSpecs jadi overlay tick + penyajian + digest` (sertakan perubahan Task 1 bila terpisah membuat compile pecah).

---

### Task 3: `GET /specs/:id` baru + `GET /specs` → `SpecListItem` (AC-S20a-c, S21a)

**Files:**
- Modify: `server/src/routes/specs.ts` (sekitar baris 80-100), `server/src/routes/capabilities*` bila peta capability eksplisit (spec: turunan prefix `/specs` per method, tanpa peta baru — verifikasi dengan test)
- Test: `server/test/specs.route.test.ts` (tambah blok), tanpa mengubah test lama

**Interfaces:**
- Consumes: `listSpecsLive`, `liveOverlayTick` (Task 2), `zSpecListItem`.
- Produces: `GET /specs/:id -> 200 Spec | 404 { error: "spec tak ditemukan" }`; `GET /specs` `items: SpecListItem[]`.

- [ ] **Step 1: Tes gagal**

```ts
it("GET /specs: items tanpa payload/sourceHistory, dengan objective", async () => { /* inject, cek kunci */ });
it("GET /specs?q=<kata hanya di objective> tetap menemukan (AC-S20b)", async () => {
  await createSpec({ id: "SPEC-50", objective: "kata-unik-zzz", title: "t" });
  const r = await app.inject({ method: "GET", url: "/specs?q=kata-unik-zzz" });
  expect(r.json().items.map((s: any) => s.id)).toContain("SPEC-50");
});
it("GET /specs/:id penuh + 404", async () => {
  const ok = await app.inject({ method: "GET", url: "/specs/SPEC-50" });
  expect(ok.json()).toHaveProperty("payload");
  expect(ok.json().objective).toBe("kata-unik-zzz");
  const nf = await app.inject({ method: "GET", url: "/specs/SPEC-NOPE" });
  expect(nf.statusCode).toBe(404); expect(nf.json()).toEqual({ error: "spec tak ditemukan" });
});
it("GET /specs/:id overlay baca-saja: stage maju di respons, DB & notifikasi tak berubah (AC-S21a)", async () => {
  // mock sessionPhasesBySpec seperti test SPEC-199; assert row DB stage lama, prisma.notification.count() sama
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementasi.** Di handler daftar: `const rows = await liveSpecs(filter); const items = filterSpecs(rows, q…)` (urutan tak berubah), lalu `paginate(items.map(({payload, sourceHistory, ...rest}) => rest))`. Route baru: cari via `prisma.spec.findUnique`; 404 bila null; terapkan overlay baca-saja untuk satu item (ekspor `overlayOne(spec)` dari `live-specs.ts` yang memakai `applyOverlay`); `decorateBlocked([spec])[0]`.
- [ ] **Step 4:** `pnpm vitest --run --no-file-parallelism server/test/specs.route.test.ts` PASS.
- [ ] **Step 5: Docs** — `internal/docs/architecture/api-contract.md`: tambah `GET /specs/:id`, ubah kontrak `GET /specs`; `internal/skills/hanoman/SKILL.md:572` koreksi klaim "tidak ada".
- [ ] **Step 6: Commit** `feat(specs): GET /specs/:id + GET /specs ringkas (objective ditahan)`.

---

### Task 4: Siar — grup `specs` ringkas + digest, stringify sekali (AC-S1-S6, S17)

**Files:**
- Modify: `server/src/services/events.ts` (tipe `Group`, grup `specs` baris ~70, `__tick`, `broadcast`)
- Test: `server/test/events.test.ts` (tambah; ikuti pola test yang ada)

**Interfaces:**
- Produces: `Group.sig?: (msg: WireMsg) => string`; `Group.gate?: () => Promise<string>` (bila diberikan dan hasilnya sama dengan `g.lastGate`, `build()` DILEWATI dan tak ada frame, namun `pre()` tetap dijalankan); `Group.pre?: () => Promise<void>` (dipanggil tiap tick; untuk `specs` = `liveOverlayTick`). `broadcast(sig: string, s: WireMsg, cookieOnly)`.

- [ ] **Step 1: Test gagal**
  - Frame `specs` hasil `build()` tak memuat 3 field (AC-S1).
  - DB diam 5 tick → `broadcast` 1x (frame pertama) lalu 0 (AC-S3).
  - Ubah satu baris → tepat 1 frame (AC-S4).
  - Sesi hidup mock berfase maju, DB digest awal sama → `liveOverlayTick` dipanggil tiap tick (spy) dan baris DB naik stage (AC-S6).
  - `specsDigest` melempar → frame tetap dibangun (fail-open).
  - `JSON.stringify` dipanggil sekali per frame lahir (spy pada `JSON.stringify` dengan filter arg `t==="specs"`) (AC-S17).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementasi.** Di `__tick` untuk tiap grup jatuh tempo: `await g.pre?.()` (try/catch → log via `g.failing`); bila `g.gate`: `let k; try { k = await g.gate() } catch { k = undefined }`; `if (k !== undefined && k === g.lastGate) continue;` lalu `g.lastGate = k`. Build → `const sig = g.sig ? g.sig(msg) : JSON.stringify(msg)`; bila `g.sig` ada, string kirim tetap `JSON.stringify(msg)` sekali dan disimpan ke `g.last`; dedup pada `g.lastSig`. Untuk grup `specs`: `pre: liveOverlayTick`, `gate: specsDigest`, `build: async () => ({t:"specs", specs: await listSpecsSlim()})`. Setelah gate berubah tetapi `liveOverlayTick` baru saja memajukan DB, digest berikutnya berubah lagi → satu frame tambahan yang wajar. `stopLoop` juga mereset `lastGate`.
- [ ] **Step 4:** `pnpm vitest --run --no-file-parallelism server/test/events.test.ts` PASS + test SPEC-199 lain hijau.
- [ ] **Step 5: Docs** — `internal/docs/architecture/stack.md`, SKILL.md baris 85 (kontrak frame `specs` ringkas, dedup digest). Draft ADR ditunda ke Task 11 (satu ADR).
- [ ] **Step 6: Commit** `perf(events): frame specs ringkas + dedup digest, stringify sekali`.

---

### Task 5: Klien — dedup, tipe state `SpecSlim`, `mergeSlim`, detail via HTTP (AC-S19-S23)

Dibagi tiga commit (5a, 5b, 5c). Tugas 5b sesuai saran fase Spec (penyatuan tipe) dan 5a-bagian merge-order.

**Files:**
- Create: `src/src/lib/specs-digest.ts`, `src/src/lib/specs-digest.test.ts`
- Modify: `src/src/api/client.ts` (~271, tambah `getSpec(id)`, `listSpecs` → `Paginated<SpecListItem>`), `src/src/App.tsx` (941, 984-986, 1277-1303), `src/src/screens/BacklogScreen.tsx` (164, 249, 391, 395, 443, 656, 695, 975-1000), `src/src/components/ChangeSourceDialog.tsx` (32, 47), `src/src/screens/TerminalScreen.tsx` (98, 587)

**Interfaces:**
- Produces:
  - `specsDigestOf(specs: readonly Pick<SpecSlim,"id"|"stage"|"version"|"updatedAt">[]): string`
  - `mergeSlim<T extends SpecSlim>(http: T, slim: SpecSlim | undefined): T` menimpa HANYA `stage,status,version,updatedAt,blockedBy,dependsOn,title,priority` (field ringkas), mempertahankan `payload/objective/sourceHistory`.
  - `api.getSpec(id: string): Promise<Spec>` (404 → lempar galat bertipe yang dikenali, mis. `ApiError.status===404`).

- [ ] **5a Step 1: Test gagal (`specs-digest.test.ts`)**

```ts
it("digest sama untuk isi sama, referensi beda", () => {
  const a = [{ id: "S1", stage: "plan", version: 1, updatedAt: "t" }];
  expect(specsDigestOf(a)).toBe(specsDigestOf(structuredClone(a)));
});
it("berubah saat stage/version/updatedAt/tambah/hapus", () => { /* 5 assert */ });
it("mergeSlim menjaga objective/payload/sourceHistory dari HTTP", () => {
  const http = { id: "S1", objective: "obj", payload: {a:1}, sourceHistory: [1], stage: "plan", version: 1 } as any;
  const m = mergeSlim(http, { id: "S1", stage: "exec", version: 2 } as any);
  expect(m.objective).toBe("obj"); expect(m.stage).toBe("exec"); expect(m.version).toBe(2);
});
```
- [ ] **5a Step 2-4:** gagal → implementasi (`specsDigestOf` = `specs.map(s=>`${s.id}:${s.stage}:${s.version}:${s.updatedAt}`).join("|")`) → lulus (`pnpm vitest --run src/src/lib/specs-digest.test.ts`).
- [ ] **5a Step 5:** `App.tsx:984`: `const lastDigest = useRef(""); … if (m.t==="specs") { setBacklog(m.specs); const d = specsDigestOf(m.specs); if (d !== lastDigest.current) { lastDigest.current = d; setDataVersion(v=>v+1); } }`. Balik urutan merge `BacklogScreen.tsx:997-1000` menjadi `data.items.map((s) => mergeSlim(s, backlogById.get(s.id)))`. Ketik state `backlog` sebagai `SpecSlim[]` (5b). Tes render/komponen: buktikan `setDataVersion` tak naik pada frame identik bila ada harness App; bila tidak ada, cukup unit `specsDigestOf`.
- [ ] **Commit 5a:** `perf(client): dedup dataVersion by digest + mergeSlim`.
- [ ] **5b:** Ganti tipe state `backlog` (App + prop turunan) menjadi `SpecSlim[]`; hasil `load()` awal (`App.tsx:941`) dipetakan ke `SpecSlim` (sekarang dari `SpecListItem` dengan `objective` dibuang via helper `toSlim`) supaya `objective` tak muncul kadang-kadang. `pnpm --filter src exec tsc --noEmit` (satu kali, lokal untuk file tersentuh; bukan `-r`) harus menunjukkan semua pembaca `payload/objective/sourceHistory` yang tersisa sebagai galat tipe → itulah daftar call-site untuk 5c. **Commit 5b** `refactor(client): state backlog bertipe SpecSlim`.
- [ ] **5c: detail via HTTP.** `BacklogScreen` dialog detail: `useEffect` `api.getSpec(id)` saat dibuka, simpan `detail` state; baris 164/249/391/395/443 membaca dari `detail`. 404 → tutup dialog + toast (AC-S22). `ChangeSourceDialog` menerima `spec: Spec` dari pemanggil (hasil `getSpec`). Backlink audit `App.tsx:1277-1303`: `await api.getSpec(id)` untuk `objective`. Baris grid/list `:656,:695` tetap membaca `objective` dari item HTTP (`SpecListItem`). Test komponen: dialog memanggil `getSpec` (mock api), 404 menutup dialog.
- [ ] **5c Step:** hapus langganan `sessions` kedua `TerminalScreen.tsx:98`, pakai prop dari `App` (AC-S23); test: render TerminalScreen dengan prop, assert `subscribe("sessions")` tidak dipanggil dari dalamnya.
- [ ] **5c Step:** dedup `presence` di klien: bandingkan signature tanpa `lastSeenAt` lokal sebelum `setState`.
- [ ] **Jalankan:** `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`. **Commit 5c** `feat(client): detail spec via GET /specs/:id, satu langganan sessions`.
- [ ] **Docs:** `internal/docs/frontend/*` yang menyebut state backlog/dataVersion bila ada (grep `dataVersion` di `internal/docs`).

---

### Task 6: Async jalur periodik (AC-S9-S12)

**Files:**
- Modify: `server/src/services/pty.ts` (`sessionPhasesBySpec` ~1212, `liveDecisions`/`scanDecisions` ~491, `pollPhases` ~1340, `paneComplete` ~1320), `server/src/services/session-phases.ts` (41, 176, 179), `server/src/services/live-specs.ts` (`phases()`), `server/src/services/events.ts` (`notificationsFeed`)
- Test: `server/test/periodic-async.test.ts`, test pty/session-phases yang ada tetap hijau

**Interfaces:**
- Produces: `sessionPhasesBySpecAsync(): Promise<Map<string,{phases:…;cwd:string}>>`; `liveDecisionsAsync()`; `readPhasesAsync(path): Promise<PhaseFile|null>` dengan memo `(path,mtimeMs,size)` per tick; `planOpenAsync(cwd, specId): Promise<boolean>`; `stageForRunAsync(...)`.
- Consumes: `listPanesShared()` dari `server/src/services/presence/snapshot.ts:39`.

- [ ] **Step 1: Tes gagal**
  - Menyadap `child_process.execFileSync`, `fs.readFileSync/statSync/readdirSync` (vi.spyOn pada modul `node:fs` dan `node:child_process`), jalankan `liveOverlayTick()`, `specsDigest()`, build grup `notifications`, hitung panggilan pada path fase/plan/tmux → 0 (AC-S9).
  - `listPanesShared` menolak → `sessionPhasesBySpecAsync()` = map kosong, stage tak mundur (AC-S12).
  - `pollPhases` + `paneComplete` untuk berkas sama dalam satu tick → satu `readFile` (AC-S11).
  - Dua pemanggil `sessionPhasesBySpecAsync` dalam 1 dtk → satu `tmux list-panes` (AC-S10).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementasi.** Salin logika sinkron ke pasangan async (jangan ubah semantik "hanya maju"); `phases()` di live-specs menjadi `sessionPhasesBySpecAsync().catch(() => new Map())`. Memo berkas fase: `Map<path,{mtimeMs,size,value}>` divalidasi dengan `fs.promises.stat` (async). Gerbang plan `readdir`/`readFile` → `fs/promises`. `notificationsFeed` memakai `liveDecisionsAsync`. Hapus varian sinkron bila tak ada pemanggil tersisa (`grep -rn sessionPhasesBySpec\( server/src`); jika masih ada pemanggil non-periodik, biarkan dan beri komentar.
- [ ] **Step 4:** `pnpm vitest --run --no-file-parallelism server/test/periodic-async.test.ts server/test/live-specs-split.test.ts server/test/specs.route.test.ts server/test/pty*.test.ts` PASS (ingat memori: pty test gagal palsu oleh tmux sisa; bersihkan socket test bila perlu).
- [ ] **Step 5: Commit** `perf(server): jalur periodik specs/notifications tanpa I/O sinkron`. Docs: stack.md (satu baris: jalur periodik async di atas `listPanesShared`).

---

### Task 7: `getSessionAsync` di route WS terminal, scheduler, reaper, lead (AC-S9)

**Files:**
- Modify: `server/src/routes/terminal.ts:558`, `server/src/services/pty.ts:1444-1450` (+ capture-pane pane mati), `server/src/services/scheduler/reconcile.ts:74`, `scheduler/engine.ts:40`, `server/src/services/worktree-project.ts:10`, `server/src/services/lead/engine.ts:127`
- Test: `server/test/sync-io-guard.test.ts` + test route/scheduler/lead yang ada

**Interfaces:**
- Consumes: `getSessionAsync(id)` (`pty.ts:510`), `listSessionsAsync()`. Bila `capture-pane` untuk pane mati hanya ada versi sinkron, tambah `capturePaneAsync(name, opts)` (promisify `execFile`).

- [ ] **Step 1: Tes gagal** — spy `execFileSync` lalu jalankan: reconcile scheduler untuk item launched, satu tick reaper, satu pulse lead, `attach` WS terminal (`injectWS`) → 0 panggilan `execFileSync` bertarget tmux (AC-S9).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Ganti `getSession`→`await getSessionAsync` di lima titik; jadikan fungsi pembungkusnya `async` bila belum, dan perbarui pemanggilnya. Pada `attach` WS, pasang listener `onOpen`/buffer pesan yang masuk selama `await` supaya frame awal tak hilang (lihat catatan spike SPEC-1215 "frame attach hilang tanpa listener onOpen").
- [ ] **Step 4:** `pnpm vitest --run --no-file-parallelism` pada test tersentuh (`terminal.route`, scheduler, lead, worktree-project) PASS. Catatan memori: `terminal.route` gagal palsu bila `HANOMAN_SHELL`/`NODE_ENV` salah; ikuti memori itu, bukan regresi.
- [ ] **Step 5: Commit** `perf(server): route WS terminal, scheduler, reaper, lead tanpa tmux sinkron`.

---

### Task 8: Siar paralel + `g.last` + dedup presence (AC-S15, S16, S24)

**Files:**
- Modify: `server/src/services/events.ts` (`__tick`, `attach`), grup presence (baris ~96) dengan `sig` yang membuang `lastSeenAt` device lokal
- Test: `server/test/events.test.ts`

- [ ] **Step 1: Tes gagal**
  - Dua grup fake, satu melempar → grup lain tetap `broadcast`, urutan broadcast = urutan `GROUPS` (AC-S15).
  - `attach` klien kedua saat loop hidup dengan `g.last` terisi → `build` tidak dipanggil ulang, klien menerima string `g.last` (AC-S16). Klien pertama (g.last kosong) → build.
  - Presence: dua build yang hanya beda `lastSeenAt` device lokal → 1 frame; payload frame tetap memuat `lastSeenAt` mutakhir (AC-S24, dua assert).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `const due = GROUPS.filter(g => tick % g.everyTicks === 0); const results = await Promise.allSettled(due.map(runGroup))`; `runGroup` menjalankan `pre/gate/build` + profil dan mengembalikan `{g,msg,sig}|null`; sesudah semuanya settle, iterasi `due` berurutan untuk `broadcast`. Kegagalan → `g.failing` seperti kini. `attach`: `if (g.last && !(g.cookieOnly && !cookieClients.has(c)))` filter grup lalu kirim `g.last`; sisanya `await g.build()`. Presence `sig: (m) => JSON.stringify({ ...m, devices: m.devices.map(d => d.isLocal ? { ...d, lastSeenAt: 0 } : d) })` (sesuaikan nama field yang sebenarnya di `presence/view.ts:40`).
- [ ] **Step 4:** PASS. **Step 5: Commit** `perf(events): grup dibangun paralel terisolasi, attach pakai g.last, presence terdedup`.
- [ ] **Keputusan bersyarat (kadens):** JANGAN ubah `everyTicks` di task ini. Diputuskan di Task 11 hanya bila angka gagal (keputusan #4).

---

### Task 9: Backpressure terminal (AC-S25, S25a)

**Files:**
- Modify: `server/src/services/pty.ts` (~1229 kirim ke client), `server/src/routes/terminal.ts:565`
- Test: `server/test/terminal-backpressure.test.ts`

**Interfaces:**
- Produces: `createBoundedSender(ws: {send(s:string|Buffer):void; bufferedAmount:number}, opts?: {high?: number /*1 MiB*/; cap?: number /*256 KiB*/; onResync?: () => void}): { send(chunk: string): void; flush(): void; dispose(): void }`.

- [ ] **Step 1: Tes gagal** — ws palsu dengan `bufferedAmount` diatur tes: (a) di bawah plafon → kirim langsung; (b) di atas 1 MiB → chunk digabung, tak dikirim; (c) `bufferedAmount` turun (interval `setTimeout(20)` mengecek) → satu kirim gabungan; (d) penulis jauh lebih cepat: pending melewati `cap` → byte terlama dibuang, `onResync` dipanggil sekali, `bufferedAmount` diamati tak tumbuh monoton (AC-S25a); (e) coalescing 16 ms tak disentuh (test coalescer lama tetap hijau).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasi di berkas baru `server/src/services/bounded-sender.ts`; pasang di titik kirim terminal. `onResync` mengirim ulang layar memakai jalur attach/scrollback yang sudah ada (`capture-pane` async dari Task 7) sebagai frame reset. Timer drain `unref()` dan dihentikan di `dispose` (dipanggil saat close).
- [ ] **Step 4:** PASS + test pty/terminal route tersentuh. **Step 5: Commit** `feat(terminal): backpressure bufferedAmount, drop terlama + resync`. Docs: stack.md.

---

### Task 10: Klien terminal (AC-S26-S31)

Enam sub-commit kecil; tiap sub-langkah: tes dulu, implementasi, `pnpm vitest --run <test>`, commit. (Catatan memori: test terminal rapuh terhadap viewport; jaga test deterministik, jangan bergantung ukuran layar.)

**Files:** `src/src/screens/TerminalScreen.tsx` (98, 514-533, 520-527, 779), `src/src/components/TerminalPane.tsx` (97-112, 232, 522-528), `src/src/lib/hidden-ring.ts` (baru) + test, `src/src/lib/shared-ticker.ts` (baru) + test, `package.json` (`@xterm/addon-webgl`, versi sepadan `@xterm/xterm` yang terpasang)

- [ ] **10a Ring pane tersembunyi (AC-S26, S26a, S26b).** Test `hidden-ring.test.ts`: `createHiddenRing(cap=256*1024)`; `push(chunk)`; `drain(): {chunks: string[]; overflowed: boolean}`; setelah dorong 10× cap, `size()` ≤ cap (memori konstan) dan `overflowed===true`. Implementasi: antrean chunk + total byte, buang terlama saat melewati cap, set flag. Di `TerminalPane`: prop `hidden`; bila hidden `write` → `ring.push`; saat tampil → jika `overflowed` kirim pesan resync (jalur attach/`capture-pane` yang sudah ada) dan `term.reset()`, kalau tidak `for (c of chunks) term.write(c)`. Commit `perf(terminal): pane tersembunyi menahan output di ring 256 KB`.
- [ ] **10b WebGL + cursorBlink (AC-S27, S28).** Test: mock `WebglAddon` yang melempar di ctor/`loadAddon` → pane tetap berfungsi (renderer DOM, tanpa toast) dan `dispose()` addon dipanggil sekali; `onContextLoss` → dispose + fallback. `cursorBlink: focused`, ubah lewat `term.options.cursorBlink` saat fokus berubah. Commit `perf(terminal): WebGL dengan fallback DOM, cursorBlink hanya fokus`.
- [ ] **10c memo + handler stabil.** `React.memo(Cell)`, `React.memo(TerminalPane)`; handler di `TerminalScreen.tsx:520-527` via `useCallback`/ref. Test: render ulang parent dengan prop identik tidak me-render ulang Cell (hitung render lewat spy pada komponen anak). Commit `perf(terminal): memo Cell/TerminalPane + handler stabil`.
- [ ] **10d ticker bersama PhaseStrip (AC-S29).** `shared-ticker.ts`: `subscribeTick(fn): () => void`, satu `setInterval(1000)` hidup selama ada pelanggan; test dengan fake timers: 5 pelanggan → 1 interval; 0 pelanggan → interval dibersihkan. Ganti interval per sel `TerminalScreen.tsx:779`. Commit.
- [ ] **10e timer 100 ms bersyarat (AC-S29).** `TerminalPane.tsx:232`: mulai interval saat prediksi pending > 0, `clearInterval` saat 0; test fake timers. Commit.
- [ ] **10f resize debounce + dedup (AC-S30).** Debounce `ResizeObserver` 100 ms; simpan `lastSent {cols,rows}`; test: 5 resize cepat dengan ukuran akhir sama dengan yang terkirim → 0 pesan; ukuran baru → 1 pesan. Commit.
- [ ] **Jalankan:** `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`. Docs: `internal/docs/frontend/*` terminal (grep `TerminalPane`).

---

### Task 11: Ukur ulang, docs, ADR, verifikasi API nyata (AC-S13, S14, S31-S35)

**Files:**
- Modify: `internal/docs/architecture/stack.md`, `internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md` (baris 85 & 572 sudah disentuh Task 3-4; pastikan konsisten), `internal/docs/README.md`
- Create: `internal/docs/adr/0168-frame-specs-ringkas-siar.md` (cek nomor bebas: `ls internal/docs/adr | tail`; bila bentrok, ambil nomor berikutnya), tabel hasil di `docs/superpowers/plans/2026-09-20-spec-1267-perf-sesi-terminal-backlog-baseline.md`

- [ ] **Step 1: Ukur ulang** persis skenario/DB/mesin Task 0 Step 5 (1 vs 4 pane): durasi build per grup, lag event loop p50/p99/max, frame `specs`/menit (DB diam 60 dtk → 0), `GET /specs`/menit (→ 0), ukuran frame mentah+deflate (≤ 5% baseline), CPU renderer. Tempel tabel sebelum vs sesudah.
- [ ] **Step 2: Keputusan bersyarat.** Bila p99 > 50 ms atau max > 100 ms atau build `specs` p95 > 20 ms setelah Task 4-9, ubah `everyTicks` grup `specs` 1→3 (test + ukur ulang, dokumentasikan sebagai perilaku terlihat). Bila deflate terlihat di profil, buka keputusan baru (jangan ubah `perMessageDeflate` tanpa pasangan angka sendiri, AC-S33a).
- [ ] **Step 3: API nyata.** `pnpm --filter server build`; boot `HANOMAN_HOME=$(mktemp -d) node server/dist/server.js` (DB terpisah), lalu:
  - `curl -s localhost:$PORT/api/specs | jq '.items[0] | keys'` → tak ada `payload`/`sourceHistory`, ada `objective`.
  - `curl -s localhost:$PORT/api/specs/SPEC-1` → penuh; id ngawur → 404 `{"error":"spec tak ditemukan"}`.
  - `curl -s "localhost:$PORT/api/specs?q=<kata objective>"` → item ditemukan.
  - Sambung `/api/events/ws` (wscat/node) → frame `specs` tanpa 3 field; diam 60 dtk → nol frame `specs` lanjutan.
  (Auth/prefix mengikuti konfigurasi lokal; sesuaikan `PORT` dan cookie/token.)
- [ ] **Step 4: ADR** amandemen ADR-0039/0145: frame `specs` ringkas, `GET /specs/:id`, `GET /specs` `SpecListItem`; dampak klien lama/baru tanpa kompatibilitas (gejala senyap, penawar `ReloadBadge`/`trackServerVersion` SPEC-868); alternatif B/C ditolak. Tautkan di `internal/docs/README.md`.
- [ ] **Step 5: Grep verifikasi nol sinkron:** `grep -nE "execFileSync|readFileSync|statSync|readdirSync" server/src/services/live-specs.ts server/src/services/events.ts server/src/routes/terminal.ts` → tak ada di jalur periodik.
- [ ] **Step 6: Test tersentuh:** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` → hijau.
- [ ] **Step 7: Commit** `docs(spec-1267): hasil ukur, ADR frame specs ringkas, stack/api-contract/SKILL`.

---

## Self-Review

**Cakupan spec.** AC-S1-S5 → T1, T2, T4; S6-S8 → T2, T4; S9-S12 → T6, T7; S13-S14, S32 → T0, T11; S15-S17, S24 → T4, T8; S18 → T0; S19-S23 → T5; S20a-c, S21a → T3; S25/S25a → T9; S26-S31 → T10; S33-S35 → T11 (+ docs bertahap T3, T4, T6, T9, T10). Dua saran fase Spec dijadikan sub-task eksplisit: urutan `filterSpecs` sebelum pemetaan (T3, tes `q`), penyatuan tipe state `backlog` (T5b).

**Konsistensi tipe.** `SpecSlim`/`SpecListItem` (T1) dipakai T2-T5; `specsDigest`/`liveOverlayTick`/`listSpecsSlim`/`listSpecsLive` (T2) dipakai T3-T4; `Group.pre/gate/sig` (T4) dipakai T8; `createBoundedSender` (T9) memakai `capturePaneAsync` (T7).

**Risiko yang perlu dijaga saat Execute.** (1) T1 dapat memecah compile sampai T2-T5 — satukan commit bila perlu. (2) Path klien `src/src/...` diverifikasi dengan `git ls-files`. (3) Test pty/terminal rentan gagal palsu (tmux sisa, viewport) — lihat memori proyek sebelum menyimpulkan regresi.
