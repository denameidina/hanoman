# Pet jujur & lengkap (SPEC-897) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pet dashboard berhenti memamerkan data basi saat WS `events` putus, mendaftar semua kondisi aktif berikut aksinya, menghitung kondisi sejenis di lencana, dan menumbuhkan dua pose baru (`deciding`, `sleeping`) dari dua baris atlas baru.

**Architecture:** `events.ts` menumbuhkan pengamat status di atas socket yang sudah ada (tanpa channel baru). `pet-state.ts` berubah dari "satu pose" menjadi `derivePetConditions() → PetCondition[]` dengan `derivePetState()` sebagai turunannya (`conditions[0]` + daftarnya). Dua baris atlas dibuat lewat pipeline Python spec A (Codex → key → register → qa → atlas). Renderer menambahkan lencana, panel berdaftar, dan fade `opacity`.

**Tech Stack:** React 18 + TypeScript (paket `src`), Vitest + Testing Library, Python 3 + Pillow/numpy (`internal/scripts/pet/`), Codex CLI untuk generasi frame.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-22-spec-897-pet-jujur-lengkap-design.md`. Spec A (fondasi): `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`.
- **Tanpa endpoint, skema Prisma, poll, atau channel WS baru** (ADR-0039). Status koneksi diturunkan dari socket `events` yang sudah ada.
- **Tanpa ADR baru** — ADR-0039/0093/0134/0140 ditegakkan, tak ada yang diamandemen.
- `PET_OFFLINE_MS = 6_000`; `PET_SLEEP_MS = 30 * 60_000`; `PET_TRANSIENT_MS = 45_000` (tak berubah).
- Warna hanya lewat token DS (`var(--accent)`, `var(--accent-on)`, `var(--border-hair)`, `var(--shadow-sm)`, `var(--radius-pill)`, `var(--font-ui)`, `var(--text-strong)`, `var(--text-muted)`, `var(--font-display)`, `var(--dur-slow)`, `var(--ease-out)`). **Nol warna literal.**
- `prefers-reduced-motion` menulis nilai **persis** `"none"` (di-assert, bukan asymmetric matcher).
- Jalur pet `pointer-events: none`; hanya tombol 44 px di kaki, pegangan, dan panel yang `auto`. Lencana **wajib** `pointerEvents: "none"` + `aria-hidden`.
- Atlas ≤ `petlib.ATLAS_BUDGET` = 1 000 000 B. Bila terlampaui, turunkan `quality` di `internal/scripts/pet/atlas.py` (82 → 78) dan catat angkanya di `internal/assets/pet/README.md`. **Jangan menaikkan plafon.**
- Baris atlas baru **wajib** lewat pipeline `gen.py` → `key.py` → `register.py` → `qa.py` → `atlas.py`, latar hijau `#00FF00`, model sheet dilampirkan, **tanpa mirror**.
- Test frontend dijalankan `env -u NODE_ENV pnpm vitest --run <path>` dari root worktree (prod bikin RTL `act` gagal). **Jangan** `pnpm test`, `pnpm -r typecheck`, atau build penuh.
- Typecheck hanya paket yang tersentuh: `pnpm --filter ./src typecheck`.
- Docs `internal/docs/**` yang tersentuh diperbarui (Task 7) dan ter-link di `internal/docs/README.md`.

---

### Task 1: Status koneksi di `api/events.ts`

**Files:**
- Modify: `src/src/api/events.ts`
- Test: `src/test/events.test.ts`

**Interfaces:**
- Consumes: `subscribe(handler)` yang sudah ada; socket WS `events`.
- Produces:
  - `export type EventsStatus = { connected: boolean; since: number; paused: boolean }`
  - `export function eventsStatus(): EventsStatus`
  - `export function subscribeStatus(handler: (s: EventsStatus) => void): () => void`

- [x] **Step 1: Tulis test yang gagal**

Ganti seluruh isi `src/test/events.test.ts` dengan:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../src/api/client";

// jsdom tak menyediakan WebSocket — kita pasang palsu sebelum modul memanggil `new WebSocket`.
class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

// Modulnya singleton ber-state; tiap test butuh instansi baru.
beforeEach(() => {
  vi.resetModules();
  FakeWS.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("client events singleton", () => {
  it("membuka satu koneksi untuk banyak subscriber, meneruskan frame, menutup saat sub terakhir lepas", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "ws-once" });
    const { subscribe } = await import("../src/api/events");
    const got: string[] = [];
    const un1 = subscribe((m) => { if (m.t === "specs") got.push("a"); });
    const un2 = subscribe((m) => { if (m.t === "specs") got.push("b"); });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1)); // satu koneksi dibagi
    const conn = FakeWS.instances[0]!;
    conn.emit({ t: "specs", specs: [] });
    expect(got).toEqual(["a", "b"]);
    un1(); un2();
    expect(conn.readyState).toBe(3); // ditutup saat sub terakhir lepas
  });
});

describe("status koneksi events (SPEC-897)", () => {
  it("mulai tak terhubung dan menyalakan `connected` pada FRAME PERTAMA, bukan pada onopen", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "t" });
    const { subscribe, subscribeStatus, eventsStatus } = await import("../src/api/events");
    const seen: boolean[] = [];
    subscribeStatus((s) => seen.push(s.connected));
    expect(eventsStatus().connected).toBe(false);
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const conn = FakeWS.instances[0]!;
    conn.onopen?.();
    expect(eventsStatus().connected).toBe(false);   // socket terbuka ≠ frame tiba
    expect(seen).toEqual([]);
    conn.emit({ t: "specs", specs: [] });
    expect(eventsStatus().connected).toBe(true);
    expect(seen).toEqual([true]);
  });

  it("frame kedua tak memanggil handler lagi (status yang tak berubah tak memicu render)", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "t" });
    const { subscribe, subscribeStatus } = await import("../src/api/events");
    const seen: boolean[] = [];
    subscribeStatus((s) => seen.push(s.connected));
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const conn = FakeWS.instances[0]!;
    conn.emit({ t: "specs", specs: [] });
    conn.emit({ t: "specs", specs: [] });
    expect(seen).toEqual([true]);
  });

  it("onclose mematikan `connected` dan mencap ulang `since`", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "t" });
    const { subscribe, subscribeStatus, eventsStatus } = await import("../src/api/events");
    subscribeStatus(() => { });
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const conn = FakeWS.instances[0]!;
    conn.emit({ t: "specs", specs: [] });
    const connectedAt = eventsStatus().since;
    conn.close();
    expect(eventsStatus().connected).toBe(false);
    expect(eventsStatus().since).toBeGreaterThanOrEqual(connectedAt);
    expect(eventsStatus().paused).toBe(false);
  });

  it("tab hidden memberi `paused` tanpa mencap ulang `since`; tab aktif lagi mencap ulang saat masih putus", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "t" });
    const { subscribe, subscribeStatus, eventsStatus } = await import("../src/api/events");
    subscribeStatus(() => { });
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(eventsStatus().paused).toBe(true);
    expect(eventsStatus().connected).toBe(false);   // socket ditutup oleh onVisibility
    const hiddenAt = eventsStatus().since;

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(eventsStatus().paused).toBe(false);
    // jam "tak terhubung sejak" dinolkan: tanpa ini, `since` bernilai jam-jam lalu dan pet
    // langsung mengaku putus di detik pertama tab kembali.
    expect(eventsStatus().since).toBeGreaterThanOrEqual(hiddenAt);
  });

  it("berhenti memberi tahu setelah unsubscribe", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "t" });
    const { subscribe, subscribeStatus } = await import("../src/api/events");
    const seen: boolean[] = [];
    const off = subscribeStatus((s) => seen.push(s.connected));
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    off();
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    expect(seen).toEqual([]);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/events.test.ts`
Diharapkan: FAIL — `subscribeStatus is not a function` / `eventsStatus is not a function`.

- [x] **Step 3: Implementasi**

Di `src/src/api/events.ts`, tepat di bawah blok deklarasi `let opening = false;`, sisipkan:

```ts
// SPEC-897 · status koneksi diturunkan dari socket yang SAMA — tanpa channel, endpoint, atau poll
// baru (ADR-0039). `connected` menyala pada FRAME PERTAMA, bukan pada `onopen`: socket terbuka
// adalah fakta transport, bukan fakta pengiriman (pelajaran terukur SPEC-878/ADR-0134). `paused`
// terpisah karena tab hidden menutup socket dengan SENGAJA — menyebutnya gangguan berarti tiap
// kembali dari tab lain memudarkan pet.
export type EventsStatus = { connected: boolean; since: number; paused: boolean };

const statusSubs = new Set<(s: EventsStatus) => void>();
let status: EventsStatus = {
  connected: false, since: Date.now(),
  paused: typeof document !== "undefined" && document.hidden,
};

function setStatus(next: Partial<EventsStatus>): void {
  const merged = { ...status, ...next };
  if (merged.connected === status.connected && merged.since === status.since
    && merged.paused === status.paused) return;
  status = merged;
  for (const s of statusSubs) s(status);
}

export const eventsStatus = (): EventsStatus => status;

// Pengamat murni: TIDAK membuka socket. Yang membuka tetap `subscribe`, dan App sudah
// memanggilnya untuk `specs`/`sessions` (plus NotificationsContext).
export function subscribeStatus(handler: (s: EventsStatus) => void): () => void {
  statusSubs.add(handler);
  return () => { statusSubs.delete(handler); };
}
```

Ganti `ws.onmessage` menjadi:

```ts
  ws.onmessage = (ev) => {
    let m: EventMsg;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    if (!status.connected) setStatus({ connected: true, since: Date.now() });
    for (const s of subs) s(m);
  };
```

Ganti `ws.onclose` menjadi:

```ts
  ws.onclose = () => {
    ws = undefined;
    if (status.connected) setStatus({ connected: false, since: Date.now() });
    scheduleReconnect();
  };
```

Ganti `onVisibility` menjadi:

```ts
function onVisibility(): void {
  if (document.hidden) {
    // `paused` dulu, baru tutup: onclose yang menyusul harus sudah membawa paused = true.
    setStatus({ paused: true });
    close();
  } else {
    setStatus(status.connected ? { paused: false } : { paused: false, since: Date.now() });
    if (subs.size) void open();
  }
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/events.test.ts`
Diharapkan: PASS, 6 test.

- [x] **Step 5: Typecheck & commit**

```bash
pnpm --filter ./src typecheck
git add src/src/api/events.ts src/test/events.test.ts
git commit -m "feat(pet): events.ts mengekspos status koneksi (connected pada frame pertama)"
```

---

### Task 2: Dua baris atlas baru (`deciding`, `sleep`)

**Files:**
- Create: `internal/assets/pet/prompts/deciding.md`, `internal/assets/pet/prompts/sleep.md`
- Modify: `internal/scripts/pet/petlib.py` (`ROWS`)
- Modify: `src/src/screens/pet-sprite.ts` (`PET_ROW_KEYS`)
- Generated (dikomit): `internal/assets/pet/rows/{deciding,sleep}.png` + `.report.json`, `internal/assets/pet/qa/{deciding,sleep}{.gif,-contact.png,-onion.png}`, `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp`, `internal/assets/pet/pet.json`
- Test: `internal/scripts/pet/test-petlib.py` (tak diubah — harus tetap hijau), `src/test/pet-sprite.test.ts`

**Interfaces:**
- Consumes: pipeline spec A (`gen.py`, `key.py`, `register.py`, `qa.py`, `atlas.py`, `verify.py`).
- Produces: `PET_ROW_KEYS` 12 elemen dengan `"deciding"` dan `"sleep"` di ekor (indeks 10 & 11); `PET_MANIFEST.rows.length === 12`; atlas 1536×2496.

- [x] **Step 1: Tulis naskah `prompts/deciding.md`**

Buat `internal/assets/pet/prompts/deciding.md` (satu paragraf, pola persis `review.md`/`blocked.md`):

```markdown
ROW "deciding" (8 frames, loops): he is DELIBERATING — someone else is making the call and he is turning it over in his mind. He is NOT looking at anything: unlike the "review" row he does not lean forward and does not scan to the right. He stands upright with his weight settled back, feet, legs and sarong fixed. One hand is raised to his chin in a thinking gesture, the elbow tucked in; the other arm hangs relaxed. His gaze goes UP and away, eyebrow raised: frames 1-2 looking up-right, frames 3-4 drifting up and further away, frames 5-6 drifting back, frame 7 a slow blink, frame 8 back to frame 1. The head tilts a few degrees with the gaze, never snapping. The tail rises behind him in a slow, big curve that curls at the tip like a question mark and uncurls again over the 8 frames — it is the clearest sign that he is thinking. No props, no speech bubble, no question mark drawn in the air.
```

- [x] **Step 2: Tulis naskah `prompts/sleep.md`**

Buat `internal/assets/pet/prompts/sleep.md`:

```markdown
ROW "sleep" (8 frames, loops): nothing is happening and he has fallen asleep, peacefully and with dignity — no snot bubble, no "Z" letters, no pillow, no blanket, no props at all. He is SITTING on the ground, curled small: hips and folded legs on the baseline, back gently rounded, both arms resting loosely in his lap. His single eye is CLOSED throughout — a calm curved line with the lashes down, the eyebrow relaxed. The long tail is curled all the way around his seated body, its golden tip resting near his feet. The hips, folded legs, sarong and tail are drawn at exactly the same position and size in all 8 frames. The only motion is a very slow sleeping breath: frames 1-4 the head and shoulders sink a little lower and the chin comes closer to the chest, frames 5-8 they rise back up; the very tip of the tail lifts a few pixels on frame 3 and settles again on frame 6. Everything is small and unhurried — this row plays at 4 fps.
```

- [x] **Step 3: Daftarkan dua baris di `petlib.ROWS`**

Di `internal/scripts/pet/petlib.py`, ganti dua baris terakhir array `ROWS` sehingga daftarnya berakhir:

```python
    {"key": "wave",         "fps": 10, "loop": False, "mode": "stand", "then": "idle"},
    # SPEC-897 · ditambahkan di EKOR supaya indeks baris lama tak bergeser (atlas & pet.json
    # memakai urutan array sebagai indeks baris).
    {"key": "deciding",     "fps": 6,  "loop": True,  "mode": "stand"},
    {"key": "sleep",        "fps": 4,  "loop": True,  "mode": "stand"},
]
```

- [x] **Step 4: Pastikan pipeline Python masih hijau dengan 12 baris**

Jalankan: `python3 internal/scripts/pet/test-petlib.py`
Diharapkan: PASS (semua assert komposisi memakai `len(petlib.ROWS)`, bukan angka). Bila ada assert yang mem-hardcode 10, ganti jadi `len(petlib.ROWS)`.

- [x] **Step 5: Generate baris `deciding` lewat Codex**

Jalankan (±3 menit):

```bash
python3 internal/scripts/pet/gen.py deciding
python3 internal/scripts/pet/key.py deciding
python3 internal/scripts/pet/register.py deciding
python3 internal/scripts/pet/qa.py deciding
```

Diharapkan: `qa.py` mencetak OK dan menulis `internal/assets/pet/qa/deciding.gif`, `deciding-contact.png`, `deciding-onion.png`.
Bila `qa.py` gagal (sprite ≠ 8, menyentuh tepi, tumpahan sel, residu pra-pin > 0,15), ulangi dari `gen.py` dengan catatan reviewer, mis.:
`python3 internal/scripts/pet/gen.py deciding --note "keep the feet, legs and sarong identical in every cell; leave clear empty space between cells"`

- [x] **Step 6: Generate baris `sleep` lewat Codex**

```bash
python3 internal/scripts/pet/gen.py sleep
python3 internal/scripts/pet/key.py sleep
python3 internal/scripts/pet/register.py sleep
python3 internal/scripts/pet/qa.py sleep
```

Diharapkan: sama seperti Step 5, untuk `sleep`.

- [x] **Step 7: Review manusia (Gate 2 brand)**

Lihat `internal/assets/pet/qa/deciding-contact.png` dan `internal/assets/pet/qa/sleep-contact.png` (buka gambarnya, jangan hanya percaya gerbang numerik). Yang harus benar: siluet profil satu mata, jamang, kain merah-emas, ekor besar berornamen, tak ada mirror, tak ada prop selain yang disebut naskah, `sleep` benar-benar duduk dengan mata terpejam, `deciding` benar-benar menengadah (bukan condong ke kanan seperti `review`). Bila salah, ulangi Step 5/6 dengan `--note`.

- [x] **Step 8: Rakit atlas & manifest**

```bash
python3 internal/scripts/pet/atlas.py
python3 internal/scripts/pet/verify.py
```

Diharapkan: `atlas.py` mencetak `ditulis hnm-pet-anoman-atlas-v01.webp (<N> B, 1536×2496) + pet.json`, dengan `<N> ≤ 1000000`; `verify.py` OK.
**Bila `atlas.py` gagal dengan "atlas … > anggaran":** ubah `quality=82` menjadi `quality=78` di `internal/scripts/pet/atlas.py` `encode()`, jalankan ulang, dan catat angka barunya di Task 7 (`internal/assets/pet/README.md`). Jangan menaikkan `ATLAS_BUDGET`.

- [x] **Step 9: Tulis test manifest 12 baris yang gagal**

Di `src/test/pet-sprite.test.ts`, tambahkan di dalam blok `describe` yang sudah ada:

```ts
  it("manifest memuat dua baris SPEC-897 di ekor, indeks lama tak bergeser", () => {
    expect(PET_MANIFEST.rows.length).toBe(12);
    expect(PET_MANIFEST.rows.map((r) => r.key).slice(10)).toEqual(["deciding", "sleep"]);
    expect(rowIndex("wave")).toBe(9);          // indeks baris lama tak bergeser
    expect(rowIndex("deciding")).toBe(10);
    expect(rowIndex("sleep")).toBe(11);
    expect(durationMs("deciding")).toBe(Math.round((8 / 6) * 1000));
    expect(durationMs("sleep")).toBe(2000);    // 8 frame @ 4 fps
    expect(rowOf("sleep").loop).toBe(true);
    expect(thenOf("sleep")).toBeNull();
  });
```

Pastikan `PET_MANIFEST`, `rowIndex`, `rowOf`, `durationMs`, `thenOf` sudah ada di baris `import` berkas itu; tambahkan yang belum.

- [x] **Step 10: Jalankan test, pastikan gagal**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/pet-sprite.test.ts`
Diharapkan: FAIL — `parsePetManifest` melempar `pet.json tidak sah: rows: butuh 10 baris` (manifest sudah 12, `PET_ROW_KEYS` masih 10).

- [x] **Step 11: Tambah dua key di `PET_ROW_KEYS`**

Di `src/src/screens/pet-sprite.ts`:

```ts
export const PET_ROW_KEYS = [
  "idle", "walk-right", "walk-left", "working", "waiting", "blocked", "review", "shipped",
  // SPEC-897 · dua baris baru di EKOR: indeks baris lama tak bergeser, diff atlas minimal.
  "docs-updated", "wave", "deciding", "sleep",
] as const;
```

- [x] **Step 12: Jalankan test, pastikan lulus**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/pet-sprite.test.ts`
Diharapkan: PASS.

- [x] **Step 13: Commit**

```bash
git add internal/assets/pet internal/scripts/pet/petlib.py internal/scripts/pet/atlas.py \
  src/src/screens/pet-sprite.ts src/test/pet-sprite.test.ts
git commit -m "feat(pet): baris atlas deciding & sleep (PET-001 → 12 baris)"
```

---

### Task 3: Kondisi & tabel prioritas baru di `pet-state.ts`

**Files:**
- Modify: `src/src/screens/pet-state.ts`
- Modify: `src/src/screens/pet-sprite.ts` (`POSE_ROW` untuk tiga pose baru)
- Test: `src/test/pet-state.test.ts`, `src/test/pet-sprite.test.ts`

**Interfaces:**
- Consumes: `PetRowKey` dari Task 2 (`"deciding"`, `"sleep"`).
- Produces:
  - `PetPose` = `"ready" | "sleeping" | "working" | "deciding" | "waiting" | "blocked" | "review" | "shipped" | "docs-updated" | "offline"`
  - `PetConditionKind` = `"offline" | "failed" | "blocked" | "waiting" | "deciding" | "shipped" | "docs-updated" | "working" | "review" | "ready"`
  - `PetCondition = { kind; pose; headline; detail; count: number; target: PetTarget | null; recheckAt: number | null }`
  - `PetView = PetCondition & { conditions: PetCondition[] }`
  - `PetConnection = { connected: boolean; since: number; paused: boolean }`
  - `derivePetConditions(input: PetInput): PetCondition[]`, `derivePetState(input: PetInput): PetView`
  - `petPulse(sessions: TerminalSession[], notifications: Notification[]): string`
  - `KIND_NOUN: Record<PetConditionKind, string>`, `PET_OFFLINE_MS`, `PET_SLEEP_MS`
  - `PetInput` bertambah `connection?: PetConnection` dan `quietSince?: number`
  - **Dicabut:** field `transientUntil` (diganti `recheckAt`) dan sufiks `+N lainnya` di `detail`.

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/pet-state.test.ts`, ganti baris `import` teratas menjadi:

```ts
import { describe, expect, it } from "vitest";
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import {
  derivePetConditions, derivePetState, petPulse, KIND_NOUN,
  PET_OFFLINE_MS, PET_SLEEP_MS, PET_TRANSIENT_MS, loadPetRoam, savePetRoam,
  type PetConnection, type PetInput,
} from "../src/screens/pet-state";
```

Ganti setiap `expect(view.transientUntil)` yang sudah ada menjadi `expect(view.recheckAt)`.
Hapus assertion yang mengharapkan sufiks `+N lainnya` di `detail` (mis. `expect(view.detail).toContain("+1 lainnya")`), ganti dengan `expect(view.count).toBe(2)` pada test yang sama.
Lalu tambahkan blok berikut di akhir berkas:

```ts
const ONLINE: PetConnection = { connected: true, since: 0, paused: false };
const OFFLINE_AT = (since: number): PetConnection => ({ connected: false, since, paused: false });

describe("SPEC-897 — kondisi terputus", () => {
  it("menang atas segalanya setelah grace habis", () => {
    const view = derivePetState({
      ...EMPTY,
      connection: OFFLINE_AT(NOW - PET_OFFLINE_MS),
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", decision: true })],
    });
    expect(view.pose).toBe("offline");
    expect(view.kind).toBe("offline");
    expect(view.headline).toContain("Tak terhubung sejak");
    expect(view.target).toBeNull();
    // kondisi lama TETAP terdaftar — panel menyebutnya sebagai data terakhir.
    expect(view.conditions.map((c) => c.kind)).toEqual(["offline", "waiting"]);
  });

  it("tidak menyala selama grace, dan menjadwalkan recheck tepat saat grace habis", () => {
    const since = NOW - 1_000;
    const view = derivePetState({
      ...EMPTY, connection: OFFLINE_AT(since),
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(view.pose).toBe("working");
    expect(view.recheckAt).toBe(since + PET_OFFLINE_MS);
  });

  it("tab hidden (paused) tak pernah dibaca sebagai terputus", () => {
    const view = derivePetState({
      ...EMPTY,
      connection: { connected: false, since: NOW - 60_000, paused: true },
      backlog: [spec({ id: "SPEC-1" })],
    });
    expect(view.pose).toBe("ready");
    expect(view.recheckAt).toBeNull();
  });
});

describe("SPEC-897 — pose deciding", () => {
  it("duduk di bawah `waiting` dan di atas keadaan mapan", () => {
    const view = derivePetState({
      ...EMPTY, connection: ONLINE,
      backlog: [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })],
      sessions: [
        session({ id: "spec-1", specId: "SPEC-1", decision: true }),
        session({ id: "spec-2", specId: "SPEC-2", deciding: true }),
      ],
    });
    expect(view.pose).toBe("waiting");
    expect(view.conditions.map((c) => c.kind)).toEqual(["waiting", "deciding"]);
  });

  it("sesi yang dilayani lead tak lagi menyamar jadi `working`", () => {
    const view = derivePetState({
      ...EMPTY, connection: ONLINE,
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", deciding: true })],
    });
    expect(view.pose).toBe("deciding");
    expect(view.conditions.map((c) => c.kind)).toEqual(["deciding"]);
    expect(view.target).toEqual({ section: "terminal", sessionId: "spec-1" });
  });
});

describe("SPEC-897 — tidur", () => {
  it("lantai menjadi `sleeping` setelah PET_SLEEP_MS tanpa kehidupan", () => {
    const view = derivePetState({ ...EMPTY, quietSince: NOW - PET_SLEEP_MS });
    expect(view.pose).toBe("sleeping");
    expect(view.kind).toBe("ready");
    expect(view.recheckAt).toBeNull();
  });

  it("menjadwalkan onset tidur lewat satu recheck, bukan denyut", () => {
    const quietSince = NOW - 60_000;
    const view = derivePetState({ ...EMPTY, quietSince });
    expect(view.pose).toBe("ready");
    expect(view.recheckAt).toBe(quietSince + PET_SLEEP_MS);
  });

  it("tak pernah tidur selama masih ada satu kondisi terdaftar", () => {
    const view = derivePetState({
      ...EMPTY, quietSince: NOW - PET_SLEEP_MS,
      backlog: [spec({ id: "SPEC-1" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", exited: true, exitCode: 1 })],
    });
    expect(view.pose).toBe("blocked");
  });

  it("petPulse berubah saat sesi hidup atau notifikasi terbaru berubah", () => {
    const a = petPulse([session({ id: "s1" })], []);
    expect(petPulse([session({ id: "s1" })], [])).toBe(a);
    expect(petPulse([session({ id: "s1" }), session({ id: "s2" })], [])).not.toBe(a);
    expect(petPulse([session({ id: "s1" })], [notif({ id: "n1" })])).not.toBe(a);
    // sesi yang sudah mati bukan kehidupan
    expect(petPulse([session({ id: "s1" }), session({ id: "s9", exited: true })], [])).toBe(a);
  });
});

describe("SPEC-897 — daftar kondisi & hitungan", () => {
  it("mendaftar semua kondisi aktif dengan count per kind", () => {
    const view = derivePetState({
      ...EMPTY, connection: ONLINE,
      backlog: [
        spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" }),
        spec({ id: "SPEC-3", stage: "done" }),
      ],
      sessions: [
        session({ id: "a", specId: "SPEC-1", decision: true }),
        session({ id: "b", specId: "SPEC-2", decision: true }),
        session({ id: "c", specId: "SPEC-3" }),
      ],
    });
    expect(view.kind).toBe("waiting");
    expect(view.count).toBe(2);
    expect(view.conditions.map((c) => [c.kind, c.count])).toEqual([["waiting", 2], ["review", 1]]);
    expect(view.detail).not.toContain("lainnya");
  });

  it("backlog tertahan dependency naik jadi pose hanya saat tak ada sesi hidup", () => {
    const backlog = [
      spec({ id: "SPEC-2", stage: "spec-ready", blockedBy: [{ id: "SPEC-1", reason: "unfinished" }] }),
    ];
    const sepi = derivePetState({ ...EMPTY, backlog });
    expect(sepi.pose).toBe("blocked");
    expect(sepi.kind).toBe("blocked");

    const ramai = derivePetState({
      ...EMPTY, backlog: [...backlog, spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(ramai.pose).toBe("working");
    // tetap TERDAFTAR, di ekor — terlihat di panel, tak pernah memimpin.
    expect(ramai.conditions.map((c) => c.kind)).toEqual(["working", "blocked"]);
  });

  it("lantai punya count 1 supaya lencana tak menyala saat istirahat", () => {
    const view = derivePetState({ ...EMPTY, backlog: [spec({ id: "SPEC-1" }), spec({ id: "SPEC-2" })] });
    expect(view.count).toBe(1);
    expect(view.headline).toContain("2 backlog siap");
    // lantai TETAP masuk daftar supaya panel selalu punya satu baris + satu aksi.
    expect(view.conditions).toHaveLength(1);
    expect(view.conditions[0]!.kind).toBe("ready");
    expect(view.conditions[0]!.target).toEqual({ section: "backlog" });
  });

  it("setiap kind punya kata benda untuk lencana", () => {
    for (const c of derivePetConditions({
      ...EMPTY, connection: OFFLINE_AT(NOW - PET_OFFLINE_MS),
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    })) expect(KIND_NOUN[c.kind]).toBeTruthy();
  });

  it("recheckAt = yang paling awal di antara transient, grace, dan tidur", () => {
    const shippedAt = NOW - 1_000;
    const view = derivePetState({
      ...EMPTY, connection: OFFLINE_AT(NOW - 2_000),
      notifications: [notif({ id: "n1", specId: "SPEC-1", createdAt: new Date(shippedAt).toISOString() })],
    });
    // grace offline (NOW - 2000 + 6000) lebih awal dari luruh transient (NOW - 1000 + 45000)
    expect(view.recheckAt).toBe(NOW - 2_000 + PET_OFFLINE_MS);
    expect(view.pose).toBe("shipped");
    expect(PET_TRANSIENT_MS).toBe(45_000);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/pet-state.test.ts`
Diharapkan: FAIL — `derivePetConditions is not a function`, `petPulse is not a function`.

- [x] **Step 3: Tulis ulang `pet-state.ts`**

Ganti bagian dari deklarasi `export type PetPose` sampai akhir `derivePetState` di `src/src/screens/pet-state.ts` dengan:

```ts
export type PetPose = "ready" | "sleeping" | "working" | "deciding" | "waiting" | "blocked"
  | "review" | "shipped" | "docs-updated" | "offline";

// Artwork pose hidup di atlas sprite PET-001 (`pet-sprite.ts`, spec Pet hidup A); sticker STK-*
// tak lagi dipakai pet.

export const POSE_LABEL: Record<PetPose, string> = {
  ready: "siap",
  sleeping: "tidur",
  working: "sedang bekerja",
  deciding: "sedang diputuskan lead",
  waiting: "menunggu jawabanmu",
  blocked: "tertahan",
  shipped: "baru saja selesai",
  review: "menunggu review",
  "docs-updated": "dokumen baru terbit",
  offline: "tak terhubung",
};

// SPEC-897 · `kind` ≠ `pose`: sesi gagal dan backlog tertahan dependency memakai pose `blocked`
// yang sama tetapi dihitung, didaftar, dan dibuka secara berbeda.
export type PetConditionKind = "offline" | "failed" | "blocked" | "waiting" | "deciding"
  | "shipped" | "docs-updated" | "working" | "review" | "ready";

// Satuan untuk angka di lencana: "2" telanjang di pojok sprite tak punya makna bagi pembaca layar.
export const KIND_NOUN: Record<PetConditionKind, string> = {
  offline: "koneksi terputus",
  failed: "sesi gagal",
  blocked: "backlog tertahan dependency",
  waiting: "sesi menunggu jawabanmu",
  deciding: "sesi sedang diputuskan lead",
  shipped: "kabar selesai",
  "docs-updated": "dokumen terbit",
  working: "sesi berjalan",
  review: "sesi menunggu review",
  ready: "backlog siap dikerjakan",
};

// Umur keadaan transient (`shipped`/`docs-updated`) sejak notifikasinya lahir.
export const PET_TRANSIENT_MS = 45_000;

// SPEC-897 · backoff reconnect `events` mulai 500 ms dan berlipat sampai 10 dtk; tanpa jeda ini
// satu blip jaringan memudarkan pet dan membuat lencana berkedip.
export const PET_OFFLINE_MS = 6_000;
// Sepi selama ini = tidur. Bukan denyut: komponen memakai `recheckAt` untuk satu timeout.
export const PET_SLEEP_MS = 30 * 60_000;

export const PET_HIDDEN_KEY = "hanoman.pet.hidden";

// Pet hidup A · berkeliaran di tepi bawah (desktop/tablet). "1" = berkeliaran (default), "0" = diam
// di pojok. Tier mobile mengabaikannya: selalu diam (SPEC-763, tap nyasar).
export const PET_ROAM_KEY = "hanoman.pet.roam";

export type PetTarget = { section: "terminal" | "backlog"; sessionId?: string };

// SPEC-897 · status socket `events` (bukan channel baru — lihat api/events.ts).
export type PetConnection = { connected: boolean; since: number; paused: boolean };

export type PetCondition = {
  kind: PetConditionKind;
  pose: PetPose;
  headline: string;
  detail: string;
  // Berapa hal sejenis; dibawa lencana & daftar panel, bukan lagi sufiks "+N lainnya" di `detail`.
  count: number;
  // null = tak ada yang bisa dibuka (kondisi `offline`); memberinya target palsu berarti tombol
  // yang membuka layar yang salah.
  target: PetTarget | null;
  // Kapan kondisi INI berhenti benar tanpa data baru. Menggantikan `transientUntil`: tiga hal
  // memakainya sekarang (luruh transient, habisnya grace offline, onset tidur) dan ketiganya
  // dilayani satu `setTimeout` di komponen.
  recheckAt: number | null;
};

export type PetView = PetCondition & { conditions: PetCondition[] };

export type PetInput = {
  sessions: TerminalSession[];
  backlog: Spec[];
  notifications: Notification[];
  now: number;
  connection?: PetConnection;   // kosong = dianggap terhubung
  quietSince?: number;          // kosong = tak pernah tidur
};

// `automerge` tak ada di enum `zNotification` walau server menulisnya, jadi perbandingannya lewat
// Set<string> — bukan penyempitan tipe yang justru akan menolak nilai yang benar-benar datang.
const SHIPPED_TYPES = new Set<string>(["done", "automerge"]);

const ONLINE: PetConnection = { connected: true, since: 0, paused: false };

// Urutan daftar sesi datang dari `tmux list-panes -a`; menstabilkannya di sini membuat headline
// tak berganti nama tiap frame siar hanya karena urutan pane bergeser.
const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));

const sessionName = (s: TerminalSession): string => s.specId ?? s.id;

const specOf = (backlog: Spec[], s: TerminalSession): Spec | undefined =>
  (s.specId ? backlog.find((x) => x.id === s.specId) : undefined);

const hhmm = (t: number): string =>
  new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const newestAt = (rows: Notification[]): string =>
  rows.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");

// Tanda tangan "ada kehidupan" di dashboard: id sesi hidup + notifikasi terbaru. Komponen mencap
// ulang `quietSince` tiap kali nilai ini berubah — itulah seluruh mekanisme bangun tidur.
export const petPulse = (sessions: TerminalSession[], notifications: Notification[]): string =>
  `${sessions.filter((s) => !s.exited).map((s) => s.id).sort().join(",")}|${newestAt(notifications)}`;

export function derivePetConditions(input: PetInput): PetCondition[] {
  const { sessions, backlog, notifications, now } = input;
  const conn = input.connection ?? ONLINE;
  const out: PetCondition[] = [];

  // 1 · terputus menang atas segalanya: apa pun yang ditampilkan di bawahnya adalah data terakhir,
  // dan pet yang tetap berkata "sedang bekerja" atas data beku adalah bentuk paling murni dari
  // berbohong. `paused` (tab hidden) sengaja bukan gangguan — socket ditutup atas permintaan kita.
  if (!conn.connected && !conn.paused && now - conn.since >= PET_OFFLINE_MS) {
    out.push({
      kind: "offline", pose: "offline",
      headline: `Tak terhubung sejak ${hhmm(conn.since)}`,
      detail: "Dashboard menyambung ulang sendiri; yang tertulis di bawah adalah data terakhir.",
      count: 1, target: null, recheckAt: null,
    });
  }

  const done = new Set(backlog.filter((s) => s.stage === "done").map((s) => s.id));
  const audit = new Set(backlog.filter((s) => s.source === "audit").map((s) => s.id));

  const live = byId(sessions.filter((s) => !s.exited));
  const failed = byId(sessions.filter((s) => s.exited && !!s.exitCode));
  const waiting = live.filter((s) => !!s.decision && !s.deciding);
  const deciding = live.filter((s) => !!s.deciding);
  const reviewing = byId(sessions.filter((s) => !!s.specId && done.has(s.specId)));
  const working = live.filter((s) => !s.deciding && !(s.specId && done.has(s.specId)));

  const blockedSpecs = byId(backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) > 0));

  const sessionCond = (kind: PetConditionKind, pose: PetPose, rows: TerminalSession[],
    headline: string): PetCondition => ({
    kind, pose, headline,
    detail: specOf(backlog, rows[0]!)?.title ?? "Sesi terminal",
    count: rows.length, target: { section: "terminal", sessionId: rows[0]!.id }, recheckAt: null,
  });

  if (failed.length) {
    const dead = failed[0]!;
    out.push({
      kind: "failed", pose: "blocked",
      headline: `${sessionName(dead)} · sesi gagal`,
      detail: `Keluar dengan exit ${dead.exitCode}`,
      count: failed.length, target: { section: "terminal", sessionId: dead.id }, recheckAt: null,
    });
  }

  const stuck = blockedSpecs[0];
  const blockedCond = (): PetCondition => ({
    kind: "blocked", pose: "blocked",
    headline: `${stuck!.id} · tertahan dependency`,
    detail: `Menunggu ${(stuck!.blockedBy ?? []).map((b) => b.id).join(", ")}`,
    count: blockedSpecs.length, target: { section: "backlog" }, recheckAt: null,
  });
  // Gerbang SPEC-585 dipertahankan: `blockedBy` adalah keadaan normal & berumur panjang di project
  // ber-`dependsOn` (ADR-0093), jadi ia hanya boleh jadi POSE saat tak ada sesi hidup. Saat ada, ia
  // turun ke EKOR daftar (di bawah) — tetap terlihat di panel, tak pernah memimpin.
  if (stuck && live.length === 0) out.push(blockedCond());

  // Sesi yang memang menunggu manusia. `deciding` dikecualikan dan punya kondisinya sendiri di
  // bawah: sesi yang sedang disusunkan keputusannya oleh hanoman-lead tak meminta apa-apa darimu.
  if (waiting.length)
    out.push(sessionCond("waiting", "waiting", waiting, `Menunggu jawabanmu · ${sessionName(waiting[0]!)}`));
  if (deciding.length)
    out.push(sessionCond("deciding", "deciding", deciding, `${sessionName(deciding[0]!)} · lead sedang memutuskan`));

  // Kabar yang meluruh. Menang atas keadaan mapan (kabar baru lebih informatif), kalah dari gagal &
  // menunggu — perayaan tak boleh menutupi permintaan tolong.
  const fresh = notifications.filter((n) => Date.parse(n.createdAt) + PET_TRANSIENT_MS > now);
  const newest = (rows: Notification[]): Notification | undefined =>
    [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shippedRows = fresh.filter((n) => SHIPPED_TYPES.has(n.type) && !(n.specId && audit.has(n.specId)));
  const docRows = fresh.filter((n) => n.type === "done" && !!n.specId && audit.has(n.specId));
  const shipped = newest(shippedRows);
  const docs = newest(docRows);
  if (shipped) {
    out.push({
      kind: "shipped", pose: "shipped",
      headline: `${shipped.specId ?? "Backlog"} · selesai`, detail: shipped.title,
      count: shippedRows.length, target: { section: "backlog" },
      recheckAt: Date.parse(shipped.createdAt) + PET_TRANSIENT_MS,
    });
  }
  if (docs) {
    out.push({
      kind: "docs-updated", pose: "docs-updated",
      headline: `${docs.specId ?? "Audit"} · dokumen terbit`, detail: docs.title,
      count: docRows.length, target: { section: "backlog" },
      recheckAt: Date.parse(docs.createdAt) + PET_TRANSIENT_MS,
    });
  }

  // Sesi hidup yang backlog-nya BELUM done. Pengecualian itu yang membuat pintu `review` di bawah
  // bisa menyala sama sekali: pada jalur sukses pane agen tak pernah mati (SPEC-433), jadi
  // "selesai" hanya terbaca dari `Spec.stage` — yang diturunkan server dari bukti yang sama
  // (fase terminal + plan terceklist, ADR-0029).
  if (working.length)
    out.push(sessionCond("working", "working", working, `${sessionName(working[0]!)} · sedang berjalan`));
  if (reviewing.length)
    out.push(sessionCond("review", "review", reviewing, `${sessionName(reviewing[0]!)} · menunggu review`));

  if (stuck && live.length > 0) out.push(blockedCond());

  return out;
}

// Yang paling awal di antara kandidat yang masih di depan; null bila tak ada.
const earliest = (now: number, ...cands: (number | null)[]): number | null => {
  const future = cands.filter((c): c is number => c !== null && c > now);
  return future.length ? Math.min(...future) : null;
};

export function derivePetState(input: PetInput): PetView {
  const { backlog, now, quietSince } = input;
  const conn = input.connection ?? ONLINE;
  const conditions = derivePetConditions(input);

  // Lantai. Selalu benar, jadi pet tak pernah kehabisan pose. `count` sengaja 1: jumlah backlog
  // siap sudah ada di headline, dan lencana adalah alarm — ia tak boleh menyala saat istirahat.
  const readySpecs = backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) === 0);
  const asleep = quietSince !== undefined && now - quietSince >= PET_SLEEP_MS;
  const floor: PetCondition = {
    kind: "ready", pose: asleep ? "sleeping" : "ready",
    headline: asleep
      ? "Tidur — tak ada kabar 30 menit terakhir"
      : readySpecs.length > 0 ? `${readySpecs.length} backlog siap dikerjakan` : "Tidak ada pekerjaan siap",
    detail: asleep ? "Bangun sendiri begitu ada sesi atau notifikasi baru." : "Tak ada sesi yang berjalan",
    count: 1, target: { section: "backlog" }, recheckAt: null,
  };

  const list = conditions.length > 0 ? conditions : [floor];
  const top = list[0]!;
  // Selama grace berjalan pose tetap yang lama, tapi kita harus bangun tepat saat ia habis.
  const offlineAt = !conn.connected && !conn.paused ? conn.since + PET_OFFLINE_MS : null;
  // Tidur hanya menggantikan lantai: selama satu kondisi masih terdaftar, ada yang meminta.
  const sleepAt = conditions.length === 0 && quietSince !== undefined && !asleep
    ? quietSince + PET_SLEEP_MS : null;

  return { ...top, recheckAt: earliest(now, top.recheckAt, offlineAt, sleepAt), conditions: list };
}
```

Hapus helper `others()` yang tak lagi dipakai. `loadPetHidden`/`savePetHidden`/`loadPetRoam`/`savePetRoam` di bawahnya tak berubah.

- [x] **Step 4: Lengkapi `POSE_ROW` untuk tiga pose baru**

Di `src/src/screens/pet-sprite.ts`, ganti `POSE_ROW`:

```ts
// `ready` dan `offline` adalah pose yang namanya berbeda dari barisnya. `offline` sengaja memakai
// `idle`: yang dikatakan pet saat terputus adalah "aku tak tahu", dan itu diucapkan oleh pudar +
// kalimat — baris ke-13 berarti ±80 KB atlas untuk informasi yang sudah tersampaikan.
export const POSE_ROW: Record<PetPose, PetRowKey> = {
  ready: "idle",
  sleeping: "sleep",
  offline: "idle",
  working: "working",
  deciding: "deciding",
  waiting: "waiting",
  blocked: "blocked",
  review: "review",
  shipped: "shipped",
  "docs-updated": "docs-updated",
};
```

Di `src/test/pet-sprite.test.ts`, tambahkan:

```ts
  it("POSE_ROW total atas sepuluh pose dan hanya menunjuk baris yang ada", () => {
    const poses: PetPose[] = ["ready", "sleeping", "working", "deciding", "waiting", "blocked",
      "review", "shipped", "docs-updated", "offline"];
    for (const p of poses) expect(PET_ROW_KEYS).toContain(POSE_ROW[p]);
    expect(Object.keys(POSE_ROW).sort()).toEqual([...poses].sort());
    expect(POSE_ROW.offline).toBe("idle");
    expect(POSE_ROW.sleeping).toBe("sleep");
  });
```

Tambahkan `POSE_ROW`, `PET_ROW_KEYS` ke `import` dari `../src/screens/pet-sprite` dan `type PetPose` dari `../src/screens/pet-state` di berkas test itu.

- [x] **Step 5: Jalankan test, pastikan lulus**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/pet-state.test.ts src/test/pet-sprite.test.ts`
Diharapkan: PASS keduanya.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/pet-state.ts src/src/screens/pet-sprite.ts \
  src/test/pet-state.test.ts src/test/pet-sprite.test.ts
git commit -m "feat(pet): derivePetConditions — kondisi terputus, deciding, tidur, hitungan per kind"
```

---

### Task 4: Mesin berkeliaran untuk pose baru

**Files:**
- Modify: `src/src/screens/pet-walk.ts`
- Test: `src/test/pet-walk.test.ts`

**Interfaces:**
- Consumes: `PetPose` (Task 3), `POSE_ROW` (Task 3).
- Produces: perilaku `stepWalk` untuk `offline`/`sleeping` (diam di tempat) dan `deciding` (pose tenang). Tak ada tipe baru.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/pet-walk.test.ts` (di dalam `describe` terluar yang sudah ada, atau sebagai `describe` baru — sesuaikan dengan helper `input()`/`rng()` yang sudah ada di berkas itu):

```ts
describe("SPEC-897 — pose baru", () => {
  it("`offline` diam di tempat: tak pulang ke pojok, transisi dipotong", () => {
    const state = { x: 300, facing: "right" as const, mode: "walk" as const, until: NOW + 5_000 };
    const step = stepWalk(state, {
      now: NOW, currentX: 300, laneWidth: 1200, petWidth: 128, pose: "offline",
      hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false,
      tier: "desktop",
    }, () => 0.5);
    expect(step.state.mode).toBe("stand");
    expect(step.state.x).toBe(300);
    expect(step.row).toBe("idle");
    expect(step.move).toEqual({ x: 300, durationMs: 0 });
  });

  it("`sleeping` diam di tempat dan memutar baris `sleep`", () => {
    const state = { x: 300, facing: "right" as const, mode: "stand" as const, until: NOW - 1 };
    const step = stepWalk(state, {
      now: NOW, currentX: 300, laneWidth: 1200, petWidth: 128, pose: "sleeping",
      hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false,
      tier: "desktop",
    }, () => 0.5);
    expect(step.state.mode).toBe("stand");
    expect(step.row).toBe("sleep");
    expect(step.move).toBeNull();
  });

  it("`deciding` ikut aturan pose tenang: boleh jalan-jalan", () => {
    const state = { x: 600, facing: "right" as const, mode: "stand" as const, until: NOW - 1 };
    const step = stepWalk(state, {
      now: NOW, currentX: 600, laneWidth: 1200, petWidth: 128, pose: "deciding",
      hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false,
      tier: "desktop",
    }, () => 0.9);
    expect(step.state.mode).toBe("walk");
    expect(step.row).toMatch(/^walk-/);
  });
});
```

Sesuaikan nama konstanta `NOW` dengan yang sudah ada di berkas test itu; bila belum ada, tambahkan `const NOW = 1_000_000;` di atas.

- [x] **Step 2: Jalankan test, pastikan gagal**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/pet-walk.test.ts`
Diharapkan: FAIL pada test `offline` — pose tak dikenal jatuh ke cabang pose tenang sehingga `mode` menjadi `"walk"`.

- [x] **Step 3: Implementasi**

Di `src/src/screens/pet-walk.ts`, tepat di bawah `const ATTENTION: ReadonlySet<PetPose> = new Set(["waiting", "blocked"]);` tambahkan:

```ts
// SPEC-897 · terputus & tidur = berhenti di tempat. Pulang ke pojok adalah gestur "kabar penting
// selalu di tempat yang sama"; di dua keadaan ini tak ada kabar — yang ada justru ketiadaannya.
const STILL: ReadonlySet<PetPose> = new Set(["offline", "sleeping"]);
```

Lalu sisipkan cabang baru **tepat setelah** cabang jeda (`if (input.hovered || input.panelOpen || input.documentHidden) …`) dan **sebelum** `if (ATTENTION.has(pose))`:

```ts
  // 3 · terputus / tidur: berhenti di tempat, baris pose diputar.
  if (STILL.has(pose))
    return { state: stand(cur, Infinity), row: poseRow, move: moving ? { x: cur, durationMs: 0 } : null };
```

Perbarui penomoran komentar cabang di bawahnya (`3 →` `4`, `4 →` `5`, `5 →` `6`).

- [x] **Step 4: Jalankan test, pastikan lulus**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/pet-walk.test.ts`
Diharapkan: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/pet-walk.ts src/test/pet-walk.test.ts
git commit -m "feat(pet): mesin berkeliaran — terputus & tidur diam di tempat, deciding pose tenang"
```

---

### Task 5: Renderer — status koneksi, pudar, lencana, tidur

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `eventsStatus`/`subscribeStatus` (Task 1), `derivePetState`/`petPulse`/`KIND_NOUN`/`PetConnection` (Task 3), `POSE_ROW` (Task 3).
- Produces: `data-testid="pet-badge"` (lencana sprite), `data-offline="true"` pada `data-testid="pet-viewport"`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/hanoman-pet.test.tsx` sebuah `describe` baru. Berkas itu sudah memakai `vi.mock` untuk beberapa modul; tambahkan mock `../src/api/events` di dekat mock lain yang sudah ada:

```tsx
vi.mock("../src/api/events", () => ({
  subscribe: () => () => { },
  eventsStatus: () => mockStatus,
  subscribeStatus: () => () => { },
}));
let mockStatus = { connected: true, since: 0, paused: false };
```

(`let mockStatus` harus dideklarasikan dengan `var`-hoisting-safe pattern: taruh `let mockStatus …` **di atas** blok `vi.mock` tak cukup karena `vi.mock` di-hoist — pakai `vi.hoisted`:)

```tsx
const h = vi.hoisted(() => ({ status: { connected: true, since: 0, paused: false } }));
vi.mock("../src/api/events", () => ({
  subscribe: () => () => { },
  eventsStatus: () => h.status,
  subscribeStatus: () => () => { },
}));
```

Lalu:

```tsx
describe("SPEC-897 — pet jujur", () => {
  beforeEach(() => { h.status = { connected: true, since: 0, paused: false }; });

  it("lencana hitungan muncul saat ada ≥2 kondisi sejenis, dan tak menerima pointer", () => {
    render(<HanomanPet sessions={[
      session({ id: "a", specId: "SPEC-1", decision: true }),
      session({ id: "b", specId: "SPEC-2", decision: true }),
    ]} backlog={[spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })]}
      onOpen={() => { }} />);
    const badge = screen.getByTestId("pet-badge");
    expect(badge.textContent).toBe("2");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge.style.pointerEvents).toBe("none");
    expect(screen.getByTestId("pet-status").textContent).toContain("2 sesi menunggu jawabanmu");
  });

  it("tak ada lencana saat hanya satu kondisi sejenis", () => {
    render(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]}
      backlog={[spec({ id: "SPEC-1", stage: "executing" })]} onOpen={() => { }} />);
    expect(screen.queryByTestId("pet-badge")).toBeNull();
  });

  it("panel mendaftar SEMUA kondisi aktif dengan aksi per baris", async () => {
    const opened: unknown[] = [];
    render(<HanomanPet sessions={[
      session({ id: "a", specId: "SPEC-1", decision: true }),
      session({ id: "c", specId: "SPEC-3" }),
    ]} backlog={[spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-3", stage: "done" })]}
      onOpen={(t) => opened.push(t)} />);
    fireEvent.click(screen.getByTestId("pet-hit"));
    const rows = screen.getAllByTestId("pet-condition");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["waiting", "review"]);
    // aksi baris KEDUA membuka sesi kedua, bukan puncak prioritas
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Buka Terminal" }));
    expect(opened).toEqual([{ section: "terminal", sessionId: "c" }]);
  });

  it("pudar dan mengaku saat terputus; baris offline tanpa tombol", () => {
    h.status = { connected: false, since: Date.now() - 60_000, paused: false };
    render(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1" })]}
      backlog={[spec({ id: "SPEC-1", stage: "executing" })]} onOpen={() => { }} />);
    const viewport = screen.getByTestId("pet-viewport");
    expect(viewport.getAttribute("data-offline")).toBe("true");
    expect(viewport.style.opacity).toBe("0.45");
    expect(screen.getByTestId("pet-status").textContent).toContain("Tak terhubung sejak");
    fireEvent.click(screen.getByTestId("pet-hit"));
    const rows = screen.getAllByTestId("pet-condition");
    expect(rows[0]!.getAttribute("data-kind")).toBe("offline");
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
  });

  it("tak pudar saat tab hidden (paused), karena socket ditutup atas permintaan kita", () => {
    h.status = { connected: false, since: Date.now() - 60_000, paused: true };
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={() => { }} />);
    expect(screen.getByTestId("pet-viewport").getAttribute("data-offline")).toBeNull();
  });
});
```

Sesuaikan helper `session()`/`spec()` dan import (`within`, `fireEvent`, `screen`, `render`, `beforeEach`) dengan yang sudah ada di berkas test itu; tambahkan `within` ke import `@testing-library/react` bila belum ada, dan salin helper `session`/`spec` dari `src/test/pet-state.test.ts` bila belum ada di berkas ini.

- [x] **Step 2: Jalankan test, pastikan gagal**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx`
Diharapkan: FAIL — `pet-badge`/`pet-condition` tak ditemukan.

- [x] **Step 3: Implementasi — hook status & tidur**

Di `src/src/screens/HanomanPet.tsx`, tambahkan import:

```tsx
import { eventsStatus, subscribeStatus, type EventsStatus } from "../api/events";
```

dan perluas import dari `./pet-state`:

```tsx
import {
  derivePetState, loadPetHidden, loadPetRoam, savePetHidden, savePetRoam, petPulse,
  KIND_NOUN, POSE_LABEL, type PetTarget,
} from "./pet-state";
```

Tambahkan hook di dekat `useDocumentHidden`:

```tsx
// SPEC-897 · status socket `events` yang sudah ada — pengamat, tak membuka koneksi sendiri.
function useEventsStatus(): EventsStatus {
  const [status, setStatus] = React.useState(eventsStatus);
  React.useEffect(() => {
    setStatus(eventsStatus());   // bisa berubah antara render pertama dan efek ini
    return subscribeStatus(setStatus);
  }, []);
  return status;
}
```

Di dalam komponen, tepat di atas blok `const view = React.useMemo(...)`:

```tsx
  const connection = useEventsStatus();
  // Denyut kehidupan dashboard; `quietSince` dicap ulang tiap kali ia berubah. Dibandingkan SAAT
  // RENDER (pola "menyesuaikan state ketika prop berubah") supaya tak ada render perantara yang
  // memperlihatkan pet tidur satu frame sesudah kabar datang.
  const pulse = petPulse(sessions, items);
  const [seenPulse, setSeenPulse] = React.useState(pulse);
  const [quietSince, setQuietSince] = React.useState(() => Date.now());
  if (seenPulse !== pulse) { setSeenPulse(pulse); setQuietSince(Date.now()); }
```

Ganti `useMemo` view dan efek peluruhannya:

```tsx
  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now(), connection, quietSince }),
    [sessions, backlog, items, connection, quietSince, decay]);

  React.useEffect(() => {
    if (view.recheckAt === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.recheckAt - Date.now()));
    return () => clearTimeout(t);
  }, [view.recheckAt]);
```

Ganti komentar di atas `const [decay, setDecay]` menjadi:

```tsx
  // Dinaikkan HANYA oleh `recheckAt`: peluruhan transient, habisnya grace terputus, dan onset
  // tidur — tiga saat keadaan berubah tanpa data baru. Bukan denyut: satu timeout tepat waktu.
```

- [x] **Step 4: Implementasi — kalimat status, wave, lencana, pudar**

Ganti baris `const status = …`:

```tsx
  const offline = view.pose === "offline";
  const status = `Hanoman ${POSE_LABEL[view.pose]} · ${view.headline}`
    + (view.count > 1 ? ` · ${view.count} ${KIND_NOUN[view.kind]}` : "");
```

Ganti `playWave` — melambai atas data basi, atau melambai sambil tidur, keduanya berbohong:

```tsx
  const playWave = React.useCallback(() => {
    if (reduced || view.pose === "offline" || view.pose === "sleeping") return;
    setOneShot((o) => o ?? { row: "wave", id: Date.now() });
  }, [reduced, view.pose]);
```

Ganti pembuka `pet-viewport`:

```tsx
            <div data-testid="pet-viewport" data-offline={offline ? "true" : undefined} style={{
              position: "relative", overflow: "hidden", width: cellW, height: cellH,
              opacity: offline ? 0.45 : 1,
              transition: reduced ? "none" : "opacity var(--dur-slow) var(--ease-out)",
            }}>
```

Tambahkan lencana **tepat setelah** `<span className="hn-sr-only" data-testid="pet-status">{status}</span>` dan sebelum `<div data-testid="pet-reactor" …>`:

```tsx
          {view.count > 1 && (
            <span data-testid="pet-badge" aria-hidden="true" title={`${view.count} ${KIND_NOUN[view.kind]}`}
              style={{
                pointerEvents: "none", position: "absolute", top: 4, right: 8, zIndex: 2,
                minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700, lineHeight: 1,
                color: "var(--accent-on)", background: "var(--accent)",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
                boxShadow: "var(--shadow-sm)",
              }}>{view.count}</span>
          )}
```

- [x] **Step 5: Implementasi — panel multi-kondisi**

Di dalam `<div ref={panelRef} data-testid="pet-panel" …>`, ganti keempat blok isi (eyebrow, headline, detail, baris tombol) dengan:

```tsx
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>{POSE_LABEL[view.pose]}</div>
          <ul data-testid="pet-conditions" style={{
            listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10,
          }}>
            {view.conditions.map((c, i) => (
              <li key={`${c.kind}:${i}`} data-testid="pet-condition" data-kind={c.kind}
                style={i > 0 ? { borderTop: "1px solid var(--border-hair)", paddingTop: 10 } : undefined}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={i === 0
                    ? { fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600,
                        color: "var(--text-strong)", lineHeight: 1.25 }
                    : { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600,
                        color: "var(--text-strong)", lineHeight: 1.3 }}>{c.headline}</span>
                  {c.count > 1 && (
                    <span data-testid="pet-condition-count" title={`${c.count} ${KIND_NOUN[c.kind]}`} style={{
                      flex: "0 0 auto", padding: "2px 6px", fontFamily: "var(--font-ui)", fontSize: 11,
                      fontWeight: 700, lineHeight: 1, color: "var(--accent-on)", background: "var(--accent)",
                      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
                    }}>{c.count}</span>
                  )}
                </div>
                <div style={{ marginTop: 3, fontFamily: "var(--font-ui)", fontSize: 12.5,
                  color: "var(--text-muted)", lineHeight: 1.45 }}>{c.detail}</div>
                {c.target && (
                  <div style={{ marginTop: 7 }}>
                    <Button size="sm" variant={i === 0 ? "primary" : "ghost"}
                      leftIcon={c.target.section === "terminal" ? "terminal" : "list-checks"}
                      style={reduced ? { transition: "none", transform: "none" } : undefined}
                      onClick={() => { const t = c.target!; closePanel(); onOpen(t); }}>
                      {c.target.section === "terminal" ? "Buka Terminal" : "Buka Backlog"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12,
            borderTop: "1px solid var(--border-hair)", paddingTop: 10 }}>
            {tier !== "mobile" && (
              <Button size="sm" variant="ghost"
                style={reduced ? { transition: "none", transform: "none" } : undefined}
                onClick={() => setRoaming(!roam)}>{roam ? "Diam di pojok" : "Berkeliaran"}</Button>
            )}
            <Button size="sm" variant="ghost"
              style={reduced ? { transition: "none", transform: "none" } : undefined}
              onClick={() => setVisibility(true)}>Sembunyikan</Button>
          </div>
```

- [x] **Step 6: Jalankan test, pastikan lulus**

Jalankan: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx`
Diharapkan: PASS. Test lama yang mencari tombol `Buka Terminal`/`Buka Backlog` tunggal mungkin perlu diarahkan ke baris pertama (`within(screen.getAllByTestId("pet-condition")[0]!)`); perbaiki bila gagal, **jangan** melemahkan assertion a11y/reduced-motion/pointer-containment.

- [x] **Step 7: Typecheck & commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx
git commit -m "feat(pet): lencana hitungan, panel multi-kondisi, pudar saat terputus, tidur"
```

---

### Task 6: Verifikasi lintas berkas yang tersentuh

**Files:**
- Test: seluruh test yang tersentuh perubahan Task 1–5.

**Interfaces:**
- Consumes: seluruh keluaran Task 1–5.
- Produces: bukti hijau untuk klaim selesai.

- [x] **Step 1: Jalankan seluruh test frontend yang tersentuh**

Jalankan:

```bash
env -u NODE_ENV pnpm vitest --run \
  src/test/events.test.ts src/test/pet-state.test.ts src/test/pet-sprite.test.ts \
  src/test/pet-walk.test.ts src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx
```

Diharapkan: PASS, 6 berkas, **nol** "no test files".

- [x] **Step 2: Jalankan test yang memakai mock `api/events`**

Perubahan `events.ts` menambah dua export; berkas yang mem-`vi.mock` modul itu harus ikut menyediakannya bila komponennya memanggilnya. `HanomanPet` dipasang oleh `App`, jadi test App ikut terdampak. Jalankan:

```bash
env -u NODE_ENV pnpm vitest --run \
  src/test/app-flows.test.tsx src/test/app-state-persist.test.tsx \
  src/test/shell-scroll-restore.test.tsx src/test/responsive-shell-modal.test.tsx \
  src/test/workspace-state-persist.test.tsx src/test/new-project-reverse.test.tsx \
  src/test/new-terminal-runtime.test.tsx src/test/terminal-cleanups.test.tsx \
  src/test/terminal-screen.test.tsx src/test/notifications-os.test.tsx \
  src/test/shell-reload-badge.test.tsx src/test/codex-limit-badge.test.tsx \
  src/test/terminal-history-button.test.tsx
```

Diharapkan: PASS. Bila sebuah berkas gagal dengan `eventsStatus is not a function`, tambahkan `eventsStatus: () => ({ connected: true, since: 0, paused: false })` dan `subscribeStatus: () => () => {}` ke factory `vi.mock("../src/api/events", …)` di berkas itu.

- [x] **Step 3: Pipeline Python**

```bash
python3 internal/scripts/pet/test-petlib.py
python3 internal/scripts/pet/verify.py
python3 internal/scripts/pet/atlas.py --check
```

Diharapkan: PASS semuanya; `atlas.py --check` mencetak `OK atlas segar, <N> B, 12 baris` dengan `<N> ≤ 1000000`.

- [x] **Step 4: Typecheck paket `src`**

Jalankan: `pnpm --filter ./src typecheck`
Diharapkan: exit 0, nol error.

- [x] **Step 5: Commit perbaikan mock bila ada**

```bash
git add -A src/test
git commit -m "test(pet): lengkapi mock api/events dengan status koneksi"
```

(Lewati bila tak ada perubahan.)

---

### Task 7: Docs

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md` (seksi "Pet Hanoman", baris 283 dst.)
- Modify: `internal/assets/pet/README.md`
- Verify: `internal/docs/README.md` (tautan sudah ada sejak spec A — dicek, bukan ditambah)

**Interfaces:**
- Consumes: perilaku final Task 1–5.
- Produces: docs SoT yang cocok dengan kode.

- [ ] **Step 1: Perbarui judul & tabel prioritas seksi Pet**

Di `internal/docs/frontend/frontend-implementation.md`, ganti judul seksi menjadi:

```markdown
## Pet Hanoman: status sesi sebagai sprite hidup (SPEC-585 · SPEC-648 · Pet hidup A ADR-0140 · Pet hidup B SPEC-897)
```

Ganti seluruh tabel prioritas tujuh baris dengan tabel sepuluh baris §5.2 spec B, dan ganti kalimat pembuka "**Kontrak status** (tak berubah sejak SPEC-585)" menjadi:

```markdown
**Kontrak status.** Sumber tunggalnya `derivePetConditions` di `src/src/screens/pet-state.ts`
(murni & bertest): ia mengembalikan **daftar** kondisi terurut prioritas, dan `derivePetState`
mengembalikan `conditions[0]` beserta seluruh daftarnya (`PetView = PetCondition & { conditions }`).
Panel dan pose karena itu tak bisa saling bertentangan secara konstruksi. Kosakata sesinya
**identik** dengan sel Terminal (`awaiting` = hidup && `decision`, `deciding` menang atasnya,
`failed` = `exited` && `exitCode` bukan nol). `kind` **bukan** `pose`: sesi gagal dan backlog
tertahan dependency memakai pose `blocked` yang sama tetapi dihitung, didaftar, dan dibuka berbeda.
```

- [ ] **Step 2: Tambahkan empat paragraf baru**

Sisipkan setelah daftar "Empat keputusan di dalam tabel itu" (perbarui judulnya jadi "Tujuh keputusan di dalam tabel itu") empat butir:

```markdown
- **Terputus adalah kondisi, bukan ketiadaan kondisi.** `api/events.ts` mengekspos `eventsStatus`
  / `subscribeStatus` di atas socket `events` yang sudah ada — tanpa channel, endpoint, atau poll
  baru (ADR-0039). `connected` menyala pada **frame pertama**, bukan pada `onopen`: socket terbuka
  adalah fakta transport, bukan fakta pengiriman (pelajaran terukur SPEC-878/ADR-0134). `paused`
  terpisah karena tab hidden menutup socket **atas permintaan kita**; menyebutnya gangguan berarti
  tiap kembali dari tab lain memudarkan pet, dan jam "tak terhubung sejak" karena itu **dinolkan**
  saat tab aktif lagi. Grace `PET_OFFLINE_MS` = 6 dtk menelan tiga percobaan reconnect (backoff
  0,5 → 1 → 2 → 4 → 8 → 10 dtk) supaya satu blip tak memudarkan pet.
- **`deciding` di bawah `waiting`, bukan di atasnya.** Sesi yang dilayani hanoman-lead tak meminta
  apa-apa dari manusia; sesi ber-`decision` meminta. Sebelum SPEC-897 keadaan ini menyamar jadi
  `working`, sehingga "agen sedang mengetik" dan "lead sedang memutuskan untuknya" terlihat sama.
- **Tidur hanya menggantikan lantai.** `PET_SLEEP_MS` = 30 menit sejak `quietSince`, yang dicap
  ulang tiap kali `petPulse` (id sesi hidup + `createdAt` notifikasi terbaru) berubah. Selama satu
  saja kondisi masih terdaftar, pet **tetap terjaga** — termasuk atas sesi gagal yang tak ditengok
  dan backlog yang tertahan dependency. Tidur berarti "tak ada yang meminta apa pun darimu".
  `quietSince` disemai saat mount: membuka dashboard membuat pet terjaga 30 menit lagi.
- **`transientUntil` menjadi `recheckAt`.** Maknanya melebar dari "kapan pose transient luruh"
  menjadi "kapan pandangan ini berhenti benar **tanpa data baru**" — tiga hal memakainya (luruh
  transient, habisnya grace terputus, onset tidur) dan ketiganya dilayani **satu** `setTimeout`.
  Tak ada interval, tak ada denyut.
```

- [ ] **Step 3: Perbarui paragraf atlas, DOM, mesin, a11y**

- Paragraf "**Atlas & manifest**": `10 baris` → `12 baris`, tambahkan `deciding, sleep` ke daftar key, dan tambahkan kalimat: *"`POSE_ROW` memetakan sepuluh pose ke dua belas baris; `offline` sengaja memakai baris `idle` — yang dikatakan pet saat terputus adalah "aku tak tahu", dan itu diucapkan oleh pudar + kalimat, bukan oleh gerak baru."*
- Blok DOM: tambahkan `│  ├─ span.pet-badge   lencana hitungan · aria-hidden · pointer-events:none` setelah baris `span.hn-sr-only`, dan tambahkan `← opacity 0,45 saat pose offline` pada baris `pet-viewport`.
- Tabel mesin berkeliaran: tambahkan baris `| `offline` ∨ `sleeping` | **diam di tempat** — transisi dipotong, tak pulang ke pojok |` dan tambahkan `deciding` ke daftar pose tenang.
- Paragraf "**Interaksi & preferensi**": ganti kalimat tentang panel menjadi deskripsi daftar multi-kondisi (baris pertama bertipografi headline, tiap baris punya tombol ke targetnya sendiri, baris `offline` tanpa tombol, lencana kecil per baris saat `count > 1`).
- Paragraf "**Aksesibilitas & reduced motion**": tambahkan bahwa kalimat sr-only membawa `· <count> <KIND_NOUN[kind]>` saat `count > 1` dan bahwa lencana `aria-hidden`-lah yang menjaga kalimat itu tetap satu-satunya sumber.
- Paragraf "**Pengujian**": tambahkan `events.test.ts` (status koneksi) dan `pet-state.test.ts` ke daftar.

- [ ] **Step 4: Perbarui `internal/assets/pet/README.md`**

- Kalimat pembuka: `8 kolom × 10 baris` → `8 kolom × 12 baris`.
- Tambahkan baris di bawah judul: *"Spec B: `docs/superpowers/specs/2026-08-22-spec-897-pet-jujur-lengkap-design.md` menambahkan baris `deciding` & `sleep` (tanpa ADR baru)."*
- Tambahkan ke seksi "Yang dikunci pengukuran": *"12 baris pada `quality=<nilai final>` = `<N>` B — plafon `ATLAS_BUDGET` 1 MB. Bila baris ke-13 diperlukan, turunkan `quality` lagi; jangan naikkan plafon: satu `<img>` yang di-decode di setiap halaman adalah anggaran, bukan preferensi."* Isi `<nilai final>` dan `<N>` dengan angka nyata dari Task 2 Step 8.
- Tambahkan ke seksi "Review manusia": *"`deciding` harus menengadah (bukan condong memindai seperti `review`); `sleep` harus duduk dengan mata terpejam (bukan berdiri lesu seperti `blocked`)."*

- [ ] **Step 5: Verifikasi index Source of Truth**

Jalankan: `rtk proxy grep -n "frontend-implementation\|assets/pet" internal/docs/README.md`
Diharapkan: kedua path sudah terdaftar (ditambahkan spec A). Bila `internal/assets/pet/README.md` belum ada di index, tambahkan lewat `node cli/dist/index.js docs link internal/assets/pet/README.md` atau sunting index secara manual mengikuti format baris di sekitarnya.

- [ ] **Step 6: Commit**

```bash
git add internal/docs/frontend/frontend-implementation.md internal/assets/pet/README.md internal/docs/README.md
git commit -m "docs(pet): SPEC-897 — status koneksi, daftar kondisi, deciding & tidur, 12 baris atlas"
```

---

### Task 8: Smoke browser nyata (CDP)

**Files:** tak ada yang diubah — ini verifikasi.

**Interfaces:**
- Consumes: seluruh hasil Task 1–7.
- Produces: bukti bahwa atlas 12 baris benar-benar termuat dan pudar/lencana bekerja di browser nyata.

- [ ] **Step 1: Boot dev server**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm dev
```

Diharapkan: Vite mencetak URL dev (mis. `http://localhost:5173`).

- [ ] **Step 2: Periksa atlas & baris di browser**

Ikuti pola memori `hanoman-browser-smoke-via-cdp`: buka dashboard lewat CDP, lalu evaluasi di halaman:

```js
const img = document.querySelector('[data-testid="pet-atlas"]');
JSON.stringify({
  naturalW: img.naturalWidth, naturalH: img.naturalHeight,
  row: document.querySelector('[data-testid="pet-rowshift"]').dataset.row,
  anim: getComputedStyle(img).animationName,
});
```

Diharapkan: `naturalW: 1536`, `naturalH: 2496`, `anim: "hn-pet-frames"`.

- [ ] **Step 3: Hentikan server per-PID**

```bash
lsof -ti:5173 | xargs -r kill
```

**Jangan** `pkill -f`/`killall` — pola itu mematikan agen sesi tetangga (SPEC-402).

- [ ] **Step 4: Commit (bila ada perbaikan dari smoke)**

```bash
git add -A
git commit -m "fix(pet): perbaikan dari smoke browser"
```

(Lewati bila tak ada perubahan.)
