# Pet bicara (SPEC-898) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pet dashboard mengucapkan kabarnya sendiri — gelembung ber-template saat pose berganti, rekap "selama kamu pergi" saat tab aktif lagi, urgensi yang naik saat sebuah pertanyaan menua, dan pose `thanks` saat dielus.

**Architecture:** Marker keputusan (`.worktrees/.decisions/<id>`) berhenti menumpuk baris `waiting` dan mulai menyimpan **detik epoch onset**-nya; server menurunkan `decisionAt` dari sana ke payload sesi. Di klien, `pet-state.ts` menumbuhkan `since`/`subject` pada `PetCondition` (urgensi = turunan, bukan keadaan kedua), modul murni baru `pet-speech.ts` memegang seluruh templat kalimat + rekap, dan `HanomanPet.tsx` merender gelembung di dalam `pet-actor` (ikut posisi pet, di-clamp ke viewport). Satu baris atlas baru `thanks` lewat pipeline A.

**Tech Stack:** React 18 + TypeScript strict (paket `src`, Vite), Fastify + Node (paket `server`), zod DTO bersama (`shared`), vitest + @testing-library/react, Python 3 + Pillow/numpy untuk pipeline atlas, Codex CLI (GPT Image) untuk generasi frame.

**Spec:** `docs/superpowers/specs/2026-08-22-spec-898-pet-bicara-design.md`

## Global Constraints

- **Tanpa LLM, tanpa suara, tanpa notifikasi browser.** Kalimat pet 100 % templat.
- **Tanpa channel realtime / endpoint / skema DB baru.** ADR-0039 & ADR-0024 ditegakkan; `decisionAt` adalah penambahan kolom payload yang **additif** (klien lama mengabaikannya, server lama tak mengirimnya).
- **Semua timer = satu `setTimeout` per peristiwa.** Tanpa `setInterval`, tanpa `requestAnimationFrame`.
- **Keyframe hanya `transform`/`opacity`.**
- **Warna hanya token design system** (`var(--…)`). Nol literal hex/rgb di gaya inline pet.
- **`prefers-reduced-motion: reduce`:** gelembung tetap tampil dengan `animation: "none"`; hati tidak dirender; baris `thanks` tidak diputar.
- **Gerbang tap SPEC-763:** badan pet tetap satu tombol 44×44 px di kaki. Satu-satunya hit area tambahan adalah tombol gelembung rekap.
- **Baris atlas WAJIB lewat pipeline A**: `gen.py` (latar hijau, model sheet dilampirkan) → `key.py` → `register.py` → `qa.py` → `atlas.py`. Atlas ≤ `ATLAS_BUDGET` 1 000 000 B — turunkan `quality`, **jangan** naikkan plafon.
- **Scope verifikasi = berkas yang berubah saja.** Jalankan test yang tersentuh, bukan suite penuh; typecheck hanya paket yang tersentuh.
- **Test paket `src` dijalankan `env -u NODE_ENV pnpm vitest --run <path>`** — `NODE_ENV=production` di shell membuat RTL `act` gagal.
- **Test paket `server` butuh isolasi DB:** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` + `--no-file-parallelism`.
- **Docs yang tersentuh diperbarui dalam commit yang sama** dan ter-link di `internal/docs/README.md`.

---

### Task 1: Marker keputusan menyimpan onset-nya

**Files:**
- Modify: `runner/src/settings.ts:10-15`
- Modify: `runner/src/codex-settings.ts:36-39`
- Test: `runner/test/settings.test.ts`, `runner/test/codex-settings.test.ts`

**Interfaces:**
- Consumes: —
- Produces: kontrak isi marker — berkas `.worktrees/.decisions/<id>` berisi **detik epoch** onset episode "menunggu manusia" selama `size > 0`; kosong = tak menunggu. Dibaca Task 2.

- [x] **Step 1: Tulis test yang gagal (claude)**

Tambahkan di `runner/test/settings.test.ts`, di dalam `describe("guardSettings")`:

```ts
  // SPEC-898 · ADR-0141 · hook menulis STEMPEL, dan hanya bila marker masih kosong. `echo waiting >>`
  // yang lama mencap ulang mtime tiap notifikasi idle, jadi umur "menunggu" tak pernah tumbuh.
  it("Notification menulis epoch sekali saja; marker terisi tak ditimpa", () => {
    const cmd = (guardSettings("/tmp/dec") as any).hooks.Notification[0].hooks[0].command as string;
    expect(cmd).toContain("[ -s '/tmp/dec' ]");
    expect(cmd).toContain("date +%s > '/tmp/dec'");
    expect(cmd).not.toContain("echo waiting");
  });
  it("UserPromptSubmit tetap mengosongkan marker (episode berikutnya dapat stempel baru)", () => {
    const cmd = (guardSettings("/tmp/dec") as any).hooks.UserPromptSubmit[0].hooks[0].command as string;
    expect(cmd).toBe(": > '/tmp/dec'");
  });
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run runner/test/settings.test.ts`
Expected: FAIL — `expected '…echo waiting >> …' to contain "[ -s '/tmp/dec' ]"`

- [x] **Step 3: Implementasi (claude)**

Di `runner/src/settings.ts`, ganti blok `if (decisionFile) { … }` menjadi:

```ts
  if (decisionFile) {
    const f = `'${decisionFile.split("'").join("'\\''")}'`;
    // SPEC-898 · ADR-0141 · isi marker = detik epoch ONSET episode ini, ditulis SEKALI. Notification
    // berulang (Claude idle lagi) tak boleh mencapnya ulang: kalau ia mencap ulang, "menunggu sejak"
    // selalu terbaca lebih muda dari satu putaran idle dan gerbang urgensi tak pernah menyala.
    // `size > 0` tetap satu-satunya arti "menunggu manusia" (SPEC-184) — markerFilled tak berubah.
    hooks.Notification = [{ hooks: [{ type: "command",
      command: `grep -qiE 'idle|permission|waiting for|needs.?input' && { [ -s ${f} ] || date +%s > ${f}; } || true` }] }];
    hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: `: > ${f}` }] }];
  }
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run runner/test/settings.test.ts`
Expected: PASS (7 test)

- [x] **Step 5: Tulis test yang gagal (codex)**

Tambahkan di `runner/test/codex-settings.test.ts`, di dalam `describe("codexHookArgs")`:

```ts
  // SPEC-898 · ADR-0141 · cermin guardSettings: Stop menulis stempel sekali, bukan menumpuk baris.
  it("Stop menulis epoch hanya saat marker kosong", () => {
    const stop = codexHookArgs({ decisionFile: "/tmp/d1" }).find((a) => a.startsWith("hooks.Stop="))!;
    expect(stop).toContain("[ -s '/tmp/d1' ]");
    expect(stop).toContain("date +%s > '/tmp/d1'");
    expect(stop).not.toContain("echo waiting");
  });
```

- [x] **Step 6: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run runner/test/codex-settings.test.ts`
Expected: FAIL — `expected '…echo waiting >> …' to contain "[ -s '/tmp/d1' ]"`

- [x] **Step 7: Implementasi (codex)**

Di `runner/src/codex-settings.ts`, ganti baris `stop.push(...)` di blok `if (o.decisionFile)`:

```ts
  if (o.decisionFile) {
    // SPEC-898 · ADR-0141 · stempel onset, ditulis sekali (lihat runner/src/settings.ts).
    stop.push(`[ -s ${shq(o.decisionFile)} ] || date +%s > ${shq(o.decisionFile)}`);
    submit.push(`: > ${shq(o.decisionFile)}`);
  }
```

- [x] **Step 8: Jalankan kedua berkas test**

Run: `env -u NODE_ENV pnpm vitest --run runner/test/settings.test.ts runner/test/codex-settings.test.ts`
Expected: PASS — kedua berkas hijau, termasuk assert lama `expect(joined).not.toContain("prompt")`

- [x] **Step 9: Commit**

```bash
git add runner/src/settings.ts runner/src/codex-settings.ts runner/test/settings.test.ts runner/test/codex-settings.test.ts
git commit -m "feat(pet): marker keputusan menyimpan epoch onset, bukan baris waiting"
```

---

### Task 2: `decisionAt` di payload sesi

**Files:**
- Modify: `server/src/services/pty.ts` (`markerFilled` sekitar baris 46, `SessionInfo` sekitar 67, `parsePanes` sekitar 281, `toSessionInfo` sekitar 288)
- Modify: `shared/src/dto.ts:696-703` (`SessionDTO`)
- Modify: `src/src/api/client.ts:17-26` (`TerminalSession`)
- Test: `server/test/pty.test.ts`, `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: kontrak isi marker dari Task 1.
- Produces: `SessionInfo.decisionAt?: string` (ISO 8601), ada **hanya** saat `decision === true` **dan** isi marker adalah integer. Dipakai Task 3 lewat `TerminalSession.decisionAt`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/pty.test.ts`, tepat setelah test `"listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)"`:

```ts
  // SPEC-898 · ADR-0141 · umur "menunggu" datang dari ISI marker, bukan mtime-nya: hook Notification
  // yang berulang mencap ulang mtime, jadi umurnya tak pernah tumbuh.
  it("listSessions memberi decisionAt dari epoch di marker; teks lama diabaikan", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-at");
    const s = createSession("p1", repoDir, { specId: "SPEC-AT", flow: "feature", prompt: "x", decisionFile });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    expect(find().decisionAt).toBeUndefined();          // marker kosong

    writeFileSync(decisionFile, "1755840000\n");
    expect(find().decision).toBe(true);
    expect(find().decisionAt).toBe(new Date(1755840000_000).toISOString());

    writeFileSync(decisionFile, "waiting\n");           // marker sesi pra-ADR-0141
    expect(find().decision).toBe(true);
    expect(find().decisionAt).toBeUndefined();
  });
```

Pastikan `writeFileSync` ada di import `node:fs` berkas itu; tambahkan bila belum.

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "decisionAt"`
Expected: FAIL — `expected undefined to be '2025-…'` (properti belum ada)

- [x] **Step 3: Implementasi di `pty.ts`**

Ganti `markerFilled` dan tetangganya:

```ts
// SPEC-196 · marker keputusan (.worktrees/.decisions/<id>) yang terisi = sesi sedang menunggu
// manusia. Satu definisi dipakai listSessions (pembeda terminal) dan scanDecisions (notifikasi).
// statSync gagal (berkas belum ada) → false.
export const markerFilled = (f: string): boolean => {
  try { return statSync(f).size > 0; } catch { return false; }
};

// SPEC-898 · ADR-0141 · isi marker = detik epoch ONSET episode menunggu (ditulis sekali oleh hook,
// lihat runner/src/settings.ts). Marker sesi yang lahir sebelum ADR-0141 berisi "waiting" — tak bisa
// diparse, dan `undefined` di sana adalah jawaban yang benar: kita memang tak tahu sejak kapan.
// Berkasnya dibaca HANYA untuk marker yang sudah terbukti terisi, jadi sesi yang tak menunggu
// membayar nol I/O tambahan.
const markerOnset = (f: string): string | undefined => {
  let raw: string;
  try { raw = readFileSync(f, "utf8"); } catch { return undefined; }
  const secs = Number(raw.trim());
  if (!Number.isInteger(secs) || secs <= 0) return undefined;
  return new Date(secs * 1000).toISOString();
};
```

Tambahkan `readFileSync` ke import `node:fs` di berkas itu bila belum ada.

Di `SessionInfo`, setelah `branch?: string; decision: boolean;`:

```ts
  // SPEC-898 · ADR-0141 · ISO onset episode "menunggu manusia". Ada HANYA saat `decision` true dan
  // marker memuat stempel; absen untuk sesi yang lahir sebelum ADR-0141.
  decisionAt?: string;
```

Di `parsePanes`, ganti baris `decision: …` dengan dua baris (satu perhitungan, dipakai dua kali):

```ts
      // SPEC-196 · sesi hidup dengan marker keputusan terisi = menunggu manusia.
      decision: !exited && !!decisionFile && markerFilled(decisionFile),
```

tetap apa adanya, lalu di `toSessionInfo` tambahkan turunannya:

```ts
const toSessionInfo = ({ id, projectId, specId, flow, cwd, exited, code, branch, decision, agent, decisionFile }: Pane): SessionInfo => ({
  id, projectId, specId, flow, cwd, exited, branch, decision, agent,
  // Hanya untuk pane mati: `pane_dead_status` kosong pada pane hidup, dan `exitCode: 0` di sana
  // akan terbaca sebagai "sudah berakhir sukses".
  ...(exited ? { exitCode: code } : {}),
  ...(decision && decisionFile ? { decisionAt: markerOnset(decisionFile) } : {}),
});
```

Catatan: `{ decisionAt: undefined }` tetap hilang saat JSON serialize, jadi payload byte-identik dengan sebelumnya untuk marker legacy.

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "decisionAt"`
Expected: PASS

- [x] **Step 5: Tulis test route yang gagal**

Tambahkan di `server/test/terminal.route.test.ts`, di dalam `describe` yang memuat test `"createSession menyimpan branch dan mengembalikannya di listSessions"`:

```ts
  // SPEC-898 · ADR-0141 · payload additif: kolom baru harus benar-benar menyeberang HTTP, bukan
  // hanya ada di SessionInfo.
  it("GET /terminal/sessions meneruskan decisionAt", async () => {
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-route-at");
    const s = createSessionSvc("p1", repoDir, { specId: "SPEC-AT", flow: "feature", prompt: "x", decisionFile });
    mkdirSync(join(repoDir, ".worktrees", ".decisions"), { recursive: true });
    writeFileSync(decisionFile, "1755840000\n");
    const res = await app.inject({ method: "GET", url: "/api/terminal/sessions" });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { id: string; decisionAt?: string }[]).find((x) => x.id === s.id)!;
    expect(row.decisionAt).toBe(new Date(1755840000_000).toISOString());
    killSession(s.id);
  });
```

- [x] **Step 6: Jalankan test, pastikan gagal lalu lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV pnpm vitest --run --no-file-parallelism server/test/terminal.route.test.ts -t "decisionAt"`
Expected: PASS langsung (route mengembalikan `listSessions()` apa adanya — test ini mengunci bahwa ia memang begitu). Bila FAIL, perbaiki route sebelum lanjut.

- [x] **Step 7: Rambatkan tipe ke wire & klien**

Di `shared/src/dto.ts`, `SessionDTO`, setelah `exitCode?: number;`:

```ts
  // SPEC-898 · ADR-0141 · ISO onset episode "menunggu manusia"; ada hanya saat `decision` true.
  decisionAt?: string;
```

Di `src/src/api/client.ts`, `TerminalSession`, setelah `deciding?: boolean;`:

```ts
  // SPEC-898 · ADR-0141 · ISO onset episode "menunggu manusia" (isi marker keputusan). Absen =
  // tak diketahui (sesi yang lahir sebelum ADR-0141) — pet tak pernah mengeskalasi tanpa stempel.
  decisionAt?: string;
```

- [x] **Step 8: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: nol error

- [x] **Step 9: Commit**

```bash
git add server/src/services/pty.ts shared/src/dto.ts src/src/api/client.ts server/test/pty.test.ts server/test/terminal.route.test.ts
git commit -m "feat(pet): decisionAt di payload sesi, diturunkan dari onset marker"
```

---

### Task 3: `pet-state.ts` — `since`, `subject`, urgensi

**Files:**
- Modify: `src/src/screens/pet-state.ts`
- Test: `src/test/pet-state.test.ts`

**Interfaces:**
- Consumes: `TerminalSession.decisionAt` (Task 2).
- Produces:
  - `PetCondition.since: number | null` — ms epoch onset kondisi bila diketahui.
  - `PetCondition.subject: string | null` — pokok kalimat (id backlog/sesi).
  - `export const PET_URGENT_MS = 10 * 60_000`
  - `export function sessionKind(s: TerminalSession, doneSpecs: ReadonlySet<string>): PetConditionKind | null`
  - `export const doneSpecIds = (backlog: Spec[]): Set<string>`
  - `export const newestNotifiedAt = (rows: Notification[]): string`
  - `export const SHIPPED_TYPES: ReadonlySet<string>`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/pet-state.test.ts` (sesuaikan import: tambahkan `PET_URGENT_MS`, `sessionKind`, `doneSpecIds`):

```ts
describe("umur menunggu (SPEC-898)", () => {
  const bl = [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })];
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("since kondisi waiting = decisionAt TERTUA di antara sesi yang menunggu", () => {
    const sessions = [
      session({ id: "b", specId: "SPEC-2", decision: true, decisionAt: at(2 * 60_000) }),
      session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: at(20 * 60_000) }),
    ];
    const v = derivePetState({ sessions, backlog: bl, notifications: [], now: NOW });
    expect(v.kind).toBe("waiting");
    expect(v.since).toBe(NOW - 20 * 60_000);
  });

  it("tanpa decisionAt, since null — pet tak pernah mengeskalasi tanpa stempel", () => {
    const sessions = [session({ id: "a", specId: "SPEC-1", decision: true })];
    expect(derivePetState({ sessions, backlog: bl, notifications: [], now: NOW }).since).toBeNull();
  });

  it("recheckAt memuat onset urgensi selama belum mendesak, lalu berhenti", () => {
    const young = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: at(60_000) })];
    expect(derivePetState({ sessions: young, backlog: bl, notifications: [], now: NOW }).recheckAt)
      .toBe(NOW - 60_000 + PET_URGENT_MS);
    const old = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: at(PET_URGENT_MS + 1) })];
    expect(derivePetState({ sessions: old, backlog: bl, notifications: [], now: NOW }).recheckAt).toBeNull();
  });

  it("subject memberi pokok kalimat tanpa memparsing headline", () => {
    const sessions = [session({ id: "a", specId: "SPEC-1", decision: true })];
    expect(derivePetState({ sessions, backlog: bl, notifications: [], now: NOW }).subject).toBe("SPEC-1");
    expect(derivePetState({ sessions: [], backlog: bl, notifications: [], now: NOW }).subject).toBeNull();
  });

  it("sessionKind adalah SATU klasifikasi sesi, dipakai daftar kondisi dan rekap", () => {
    const done = doneSpecIds([spec({ id: "SPEC-9", stage: "done" })]);
    expect(sessionKind(session({ id: "x", decision: true }), done)).toBe("waiting");
    expect(sessionKind(session({ id: "x", decision: true, deciding: true }), done)).toBe("deciding");
    expect(sessionKind(session({ id: "x", exited: true, exitCode: 1 }), done)).toBe("failed");
    expect(sessionKind(session({ id: "x", exited: true, exitCode: 0 }), done)).toBeNull();
    expect(sessionKind(session({ id: "x", specId: "SPEC-9" }), done)).toBe("review");
    expect(sessionKind(session({ id: "x" }), done)).toBe("working");
  });
});
```

Bila helper `session()` di berkas itu belum menerima `decisionAt`, ia sudah `Partial<TerminalSession>` — tak perlu diubah setelah Task 2.

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-state.test.ts -t "SPEC-898"`
Expected: FAIL — `PET_URGENT_MS`/`sessionKind`/`doneSpecIds` tak diekspor

- [x] **Step 3: Implementasi**

Di `src/src/screens/pet-state.ts`:

1. Setelah `PET_SLEEP_MS`, tambahkan:

```ts
// SPEC-898 · sesi yang menunggu selama ini = mendesak. Ambangnya tinggal di sini bersama ambang
// waktu pet lainnya; `pet-speech.ts` mengimpornya, tak pernah sebaliknya.
export const PET_URGENT_MS = 10 * 60_000;
```

2. Di `PetCondition`, tambahkan dua field setelah `count`:

```ts
  // Pokok kalimat (id backlog / nama sesi). `headline` ditulis untuk daftar panel selebar 268 px;
  // gelembung butuh pokoknya saja, dan memparsing headline untuk mendapatkannya adalah tebakan.
  subject: string | null;
  // ms epoch kapan kondisi ini MULAI, bila diketahui. null = tak ada stempelnya.
  since: number | null;
```

3. Ekspor `SHIPPED_TYPES` (ubah `const SHIPPED_TYPES` menjadi `export const SHIPPED_TYPES`).

4. Ganti `newestAt` menjadi ekspor, dan pakai di `petPulse`:

```ts
export const newestNotifiedAt = (rows: Notification[]): string =>
  rows.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");
```

(hapus `newestAt` lama; ganti pemakaiannya di `petPulse` menjadi `newestNotifiedAt(notifications)`)

5. Ekstrak klasifikasi sesi ke ekspor tingkat modul, di atas `derivePetConditions`:

```ts
export const doneSpecIds = (backlog: Spec[]): Set<string> =>
  new Set(backlog.filter((s) => s.stage === "done").map((s) => s.id));

// Tiap sesi tepat SATU kondisi: panel yang mendaftar semuanya akan menyebut sesi yang sama dua
// kali kalau himpunannya tumpang tindih (sesi ber-`decision` juga memenuhi syarat `working`).
// Urutan di sini ADALAH urutan spesifisitas, dan ia cermin sel Terminal. Diekspor karena rekap
// "selama kamu pergi" (pet-speech.ts) harus memakai klasifikasi yang SAMA — tabel yang disalin ke
// pemakai kedua adalah kelas bug SPEC-431/448.
export function sessionKind(s: TerminalSession, doneSpecs: ReadonlySet<string>): PetConditionKind | null {
  const reviewable = !!s.specId && doneSpecs.has(s.specId);
  if (s.exited) return s.exitCode ? "failed" : reviewable ? "review" : null;
  if (s.decision && !s.deciding) return "waiting";
  if (s.deciding) return "deciding";
  return reviewable ? "review" : "working";
}
```

6. Di dalam `derivePetConditions`: hapus `const done = new Set(...)` dan closure `kindOf`; pakai
`const done = doneSpecIds(backlog);` dan `const k = sessionKind(s, done);`.

7. Lengkapi setiap `out.push({...})` dengan `subject` & `since`:

- `offline`: `subject: null, since: conn.since,`
- `failed`: `subject: sessionName(dead), since: null,`
- `blockedCond()`: `subject: stuck!.id, since: null,`
- `shipped`: `subject: shipped.specId ?? "Backlog", since: null,`
- `docs-updated`: `subject: docs.specId ?? "Audit", since: null,`

8. Ubah `sessionCond` supaya membawa keduanya:

```ts
  const sessionCond = (kind: PetConditionKind, pose: PetPose, of: TerminalSession[],
    headline: (first: TerminalSession) => string, since: number | null = null): PetCondition => ({
    kind, pose, headline: headline(of[0]!),
    detail: specOf(backlog, of[0]!)?.title ?? "Sesi terminal",
    count: of.length, subject: sessionName(of[0]!), since,
    target: { section: "terminal", sessionId: of[0]!.id }, recheckAt: null,
  });
```

9. Tambahkan helper + pasang urgensi pada kondisi `waiting`:

```ts
  // Yang TERTUA yang menentukan: sesi yang paling lama tak dijawab adalah yang paling mendesak.
  const oldestDecisionAt = (of: TerminalSession[]): number | null => {
    const stamps = of.map((s) => (s.decisionAt ? Date.parse(s.decisionAt) : NaN))
      .filter((n) => Number.isFinite(n));
    return stamps.length > 0 ? Math.min(...stamps) : null;
  };
```

Ganti blok `if (rows("waiting").length) …` menjadi:

```ts
  if (rows("waiting").length) {
    const since = oldestDecisionAt(rows("waiting"));
    out.push({
      ...sessionCond("waiting", "waiting", rows("waiting"), (s) => `Menunggu jawabanmu · ${sessionName(s)}`, since),
      // Pet jadi mendesak TEPAT pada menit ke-10 lewat timeout yang sudah ada — tanpa denyut.
      recheckAt: since !== null && now - since < PET_URGENT_MS ? since + PET_URGENT_MS : null,
    });
  }
```

10. Di `derivePetState`, lengkapi `floor` dengan `subject: null, since: null,`.

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-state.test.ts`
Expected: PASS — seluruh berkas (test SPEC-585/897 lama ikut hijau)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/pet-state.ts src/test/pet-state.test.ts
git commit -m "feat(pet): PetCondition membawa subject & since; urgensi lewat recheckAt"
```

---

### Task 4: `pet-speech.ts` — templat kalimat

**Files:**
- Create: `src/src/screens/pet-speech.ts`
- Test: `src/test/pet-speech.test.ts` (baru)

**Interfaces:**
- Consumes: `PetView`, `PET_URGENT_MS`, `KIND_NOUN` dari `pet-state.ts` (Task 3).
- Produces:
  - `export const PET_SPEECH_MS = 5_000`, `PET_RECAP_MS = 12_000`, `PET_AWAY_MS = 5 * 60_000`
  - `export type PetSpeech = { kind: "pose" | "recap"; text: string; ttl: number }`
  - `export function speechFor(view: PetView, now: number): PetSpeech | null`
  - `export function humanAge(ms: number): string`
  - `export function isUrgent(c: Pick<PetCondition, "kind" | "since">, now: number): boolean`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/pet-speech.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { derivePetState, PET_URGENT_MS, type PetView } from "../src/screens/pet-state";
import { humanAge, isUrgent, PET_SPEECH_MS, speechFor } from "../src/screens/pet-speech";

const NOW = Date.parse("2026-08-22T10:00:00.000Z");

function spec(over: Partial<Spec> & { id: string }): Spec {
  return {
    projectId: "hanoman", title: `judul ${over.id}`, source: "brief", stage: "spec-ready",
    priority: "sedang", author: "op", objective: "", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], ...over,
  } as Spec;
}
const session = (over: Partial<TerminalSession> & { id: string }): TerminalSession =>
  ({ projectId: "hanoman", cwd: "/tmp", exited: false, ...over });

const view = (over: Partial<PetView>): PetView => ({
  kind: "ready", pose: "ready", headline: "h", detail: "d", count: 1,
  subject: null, since: null, target: null, recheckAt: null, conditions: [], ...over,
} as PetView);

describe("speechFor (SPEC-898)", () => {
  it("hanya kabar yang tak lewat Toast yang bergelembung", () => {
    for (const kind of ["working", "review", "blocked", "deciding", "ready"] as const)
      expect(speechFor(view({ kind }), NOW)).toBeNull();
  });

  it("shipped: satu baris, dengan hitungan saat lebih dari satu", () => {
    expect(speechFor(view({ kind: "shipped", subject: "SPEC-547" }), NOW))
      .toEqual({ kind: "pose", text: "SPEC-547 selesai", ttl: PET_SPEECH_MS });
    expect(speechFor(view({ kind: "shipped", subject: "SPEC-547", count: 2 }), NOW)!.text)
      .toBe("SPEC-547 selesai · 2 kabar");
  });

  it("docs-updated memakai kata kerjanya sendiri", () => {
    expect(speechFor(view({ kind: "docs-updated", subject: "SPEC-612" }), NOW)!.text)
      .toBe("SPEC-612 dokumen terbit");
  });

  it("waiting menyebut umur HANYA saat sudah mendesak", () => {
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-612", since: NOW - 60_000 }), NOW)!.text)
      .toBe("SPEC-612 butuh jawabanmu");
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-612", since: NOW - 12 * 60_000 }), NOW)!.text)
      .toBe("SPEC-612 butuh jawabanmu — 12 menit");
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-612", since: null }), NOW)!.text)
      .toBe("SPEC-612 butuh jawabanmu");
  });

  it("hitungan mendahului umur", () => {
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-1", count: 3, since: NOW - 30 * 60_000 }), NOW)!.text)
      .toBe("SPEC-1 butuh jawabanmu · 3 sesi — 30 menit");
  });

  it("offline bicara tanpa pokok", () => {
    expect(speechFor(view({ kind: "offline", subject: null }), NOW)!.text).toBe("Aku kehilangan sambungan");
  });

  it("bekerja atas PetView nyata dari derivePetState", () => {
    const sessions = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: new Date(NOW - 15 * 60_000).toISOString() })];
    const v = derivePetState({ sessions, backlog: [spec({ id: "SPEC-1", stage: "executing" })], notifications: [], now: NOW });
    expect(speechFor(v, NOW)!.text).toBe("SPEC-1 butuh jawabanmu — 15 menit");
  });
});

describe("humanAge & isUrgent (SPEC-898)", () => {
  it("detik, menit, jam", () => {
    expect(humanAge(9_000)).toBe("9 detik");
    expect(humanAge(12 * 60_000)).toBe("12 menit");
    expect(humanAge(60 * 60_000)).toBe("1 jam");
    expect(humanAge(65 * 60_000)).toBe("1 jam 5 menit");
  });
  it("mendesak hanya untuk waiting yang punya stempel dan sudah lewat ambang", () => {
    expect(isUrgent({ kind: "waiting", since: NOW - PET_URGENT_MS }, NOW)).toBe(true);
    expect(isUrgent({ kind: "waiting", since: NOW - PET_URGENT_MS + 1 }, NOW)).toBe(false);
    expect(isUrgent({ kind: "waiting", since: null }, NOW)).toBe(false);
    expect(isUrgent({ kind: "failed", since: NOW - 60 * 60_000 }, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-speech.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/pet-speech"`

- [ ] **Step 3: Implementasi**

Buat `src/src/screens/pet-speech.ts`:

```ts
// SPEC-898 · kalimat pet — templat murni, tanpa LLM dan tanpa React/DOM, supaya tiap barisnya bisa
// diuji tabel. Pemisahan yang sama dengan pet-state.ts: kalimat yang lahir di dalam komponen hanya
// bisa diuji lewat render.
//
// Himpunan kabar yang bergelembung SENGAJA tertutup: `Toast` design system sudah melaporkan aksi
// pengguna di tengah-bawah, dan keadaan mapan (`working`/`review`/`blocked`/`deciding`/`ready`)
// yang bergelembung tiap kali sebuah sesi lahir adalah kebisingan, bukan kabar.
import { PET_URGENT_MS, type PetCondition, type PetConditionKind, type PetView } from "./pet-state";

export const PET_SPEECH_MS = 5_000;
// Rekap hidup lebih lama: ia membawa aksi, dan operator yang baru kembali belum tentu sedang melihat.
export const PET_RECAP_MS = 12_000;
export const PET_AWAY_MS = 5 * 60_000;

export type PetSpeech = { kind: "pose" | "recap"; text: string; ttl: number };

const BUBBLE_KINDS: ReadonlySet<PetConditionKind> = new Set(["shipped", "docs-updated", "waiting", "offline"]);

// Kata kerja gelembung — sengaja BUKAN `headline`: headline ditulis untuk daftar panel selebar
// 268 px berdampingan dengan detail, gelembung ditulis untuk dibaca sekilas di atas kepala pet.
const VERB: Partial<Record<PetConditionKind, string>> = {
  shipped: "selesai",
  "docs-updated": "dokumen terbit",
  waiting: "butuh jawabanmu",
};
// Satuan pendek untuk lencana di dalam kalimat. KIND_NOUN terlalu panjang untuk gelembung.
const SPEECH_NOUN: Partial<Record<PetConditionKind, string>> = {
  shipped: "kabar", "docs-updated": "dokumen", waiting: "sesi",
};

export const isUrgent = (c: Pick<PetCondition, "kind" | "since">, now: number): boolean =>
  c.kind === "waiting" && c.since !== null && now - c.since >= PET_URGENT_MS;

export function humanAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))} detik`;
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} jam ${rest} menit` : `${hours} jam`;
}

/** Kalimat untuk pandangan pet; `null` = kondisi ini tak bergelembung. */
export function speechFor(view: PetView, now: number): PetSpeech | null {
  if (!BUBBLE_KINDS.has(view.kind)) return null;
  if (view.kind === "offline") return { kind: "pose", text: "Aku kehilangan sambungan", ttl: PET_SPEECH_MS };
  let text = `${view.subject ?? "Backlog"} ${VERB[view.kind]}`;
  if (view.count > 1) text += ` · ${view.count} ${SPEECH_NOUN[view.kind]}`;
  if (isUrgent(view, now)) text += ` — ${humanAge(now - view.since!)}`;
  return { kind: "pose", text, ttl: PET_SPEECH_MS };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-speech.test.ts`
Expected: PASS (9 test)

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/pet-speech.ts src/test/pet-speech.test.ts
git commit -m "feat(pet): pet-speech.ts — templat kalimat gelembung"
```

---

### Task 5: `pet-speech.ts` — snapshot & rekap "selama kamu pergi"

**Files:**
- Modify: `src/src/screens/pet-speech.ts`
- Test: `src/test/pet-speech.test.ts`

**Interfaces:**
- Consumes: `sessionKind`, `doneSpecIds`, `newestNotifiedAt`, `SHIPPED_TYPES`, `PetInput` (Task 3).
- Produces:
  - `export type PetSnapshot = { at: number; sessions: Record<string, PetConditionKind>; notifiedAt: string }`
  - `export function petSnapshot(input: PetInput): PetSnapshot`
  - `export function petRecap(before: PetSnapshot, input: PetInput): PetSpeech | null`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/pet-speech.test.ts` (tambahkan `petRecap`, `petSnapshot`, `PET_RECAP_MS` ke import; tambahkan import `type Notification` dari `@hanoman/shared`):

```ts
const notif = (over: Partial<Notification> & { id: string }): Notification => ({
  type: "done", title: "judul", specId: null, projectId: "hanoman", sessionId: null,
  readAt: null, createdAt: new Date(NOW).toISOString(), ...over,
} as Notification);

describe("rekap selama kamu pergi (SPEC-898)", () => {
  const bl = [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })];

  it("tanpa perubahan → null (tab sepi tak disambut '0 selesai')", () => {
    const input = { sessions: [], backlog: bl, notifications: [], now: NOW };
    expect(petRecap(petSnapshot(input), { ...input, now: NOW + 60_000 })).toBeNull();
  });

  it("menghitung selesai · menunggu · gagal", () => {
    const before = petSnapshot({ sessions: [session({ id: "a", specId: "SPEC-1" })], backlog: bl, notifications: [], now: NOW });
    const after = {
      sessions: [
        session({ id: "a", specId: "SPEC-1", decision: true }),        // working → waiting
        session({ id: "b", exited: true, exitCode: 1 }),               // gagal, baru
      ],
      backlog: bl,
      notifications: [
        notif({ id: "n1", type: "done", createdAt: new Date(NOW + 60_000).toISOString() }),
        notif({ id: "n2", type: "automerge", createdAt: new Date(NOW + 90_000).toISOString() }),
      ],
      now: NOW + 20 * 60_000,
    };
    expect(petRecap(before, after)).toEqual({ kind: "recap", text: "2 selesai · 1 menunggu · 1 gagal", ttl: PET_RECAP_MS });
  });

  it("kabar yang lahir SAAT pergi terhitung walau transient-nya sudah luruh", () => {
    const before = petSnapshot({ sessions: [], backlog: bl, notifications: [], now: NOW });
    const after = {
      sessions: [], backlog: bl,
      notifications: [notif({ id: "n1", createdAt: new Date(NOW + 60_000).toISOString() })],
      now: NOW + 40 * 60_000,     // jauh di luar PET_TRANSIENT_MS
    };
    expect(petRecap(before, after)!.text).toBe("1 selesai");
  });

  it("sesi yang SUDAH menunggu sebelum pergi tak dihitung ulang", () => {
    const waiting = [session({ id: "a", specId: "SPEC-1", decision: true })];
    const before = petSnapshot({ sessions: waiting, backlog: bl, notifications: [], now: NOW });
    expect(petRecap(before, { sessions: waiting, backlog: bl, notifications: [], now: NOW + 20 * 60_000 })).toBeNull();
  });

  it("notifikasi yang sudah ada sebelum pergi tak dihitung", () => {
    const notifications = [notif({ id: "n0", createdAt: new Date(NOW - 60_000).toISOString() })];
    const before = petSnapshot({ sessions: [], backlog: bl, notifications, now: NOW });
    expect(petRecap(before, { sessions: [], backlog: bl, notifications, now: NOW + 20 * 60_000 })).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-speech.test.ts -t "rekap"`
Expected: FAIL — `petSnapshot is not a function`

- [ ] **Step 3: Implementasi**

Tambahkan di `src/src/screens/pet-speech.ts` (perluas import dari `./pet-state`):

```ts
import {
  doneSpecIds, newestNotifiedAt, PET_URGENT_MS, sessionKind, SHIPPED_TYPES,
  type PetCondition, type PetConditionKind, type PetInput, type PetView,
} from "./pet-state";

// Dicap saat tab jadi HIDDEN, dibandingkan saat tab terlihat lagi. Mengambilnya saat visible berarti
// ia dicap ulang tiap render dan diff-nya selalu kosong.
export type PetSnapshot = {
  at: number;
  sessions: Record<string, PetConditionKind>;   // id sesi → kondisinya saat snapshot
  notifiedAt: string;                            // createdAt notifikasi terbaru saat snapshot
};

export function petSnapshot(input: PetInput): PetSnapshot {
  const done = doneSpecIds(input.backlog);
  const sessions: Record<string, PetConditionKind> = {};
  for (const s of input.sessions) {
    const kind = sessionKind(s, done);
    if (kind) sessions[s.id] = kind;
  }
  return { at: input.now, sessions, notifiedAt: newestNotifiedAt(input.notifications) };
}

/**
 * Rekap perubahan sejak snapshot; `null` bila tak ada yang berubah.
 *
 * Kabar "selesai" dihitung dari FEED, bukan dari kondisi yang sedang menyala: `shipped` meluruh 45
 * detik (PET_TRANSIENT_MS) dan operator yang pergi 20 menit tak akan pernah melihatnya.
 */
export function petRecap(before: PetSnapshot, input: PetInput): PetSpeech | null {
  const after = petSnapshot(input);
  const fresh = (kind: PetConditionKind): number =>
    Object.entries(after.sessions).filter(([id, k]) => k === kind && before.sessions[id] !== kind).length;
  const shipped = input.notifications
    .filter((n) => SHIPPED_TYPES.has(n.type) && n.createdAt > before.notifiedAt).length;
  const parts = [
    shipped > 0 ? `${shipped} selesai` : "",
    fresh("waiting") > 0 ? `${fresh("waiting")} menunggu` : "",
    fresh("failed") > 0 ? `${fresh("failed")} gagal` : "",
  ].filter(Boolean);
  return parts.length > 0 ? { kind: "recap", text: parts.join(" · "), ttl: PET_RECAP_MS } : null;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-speech.test.ts`
Expected: PASS (14 test)

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/pet-speech.ts src/test/pet-speech.test.ts
git commit -m "feat(pet): rekap 'selama kamu pergi' dari diff snapshot"
```

---

### Task 6: Gelembung pose di renderer

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Modify: `src/src/app.css` (setelah `@keyframes hn-pet-reveal`)
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `speechFor`, `PetSpeech`, `PET_SPEECH_MS` (Task 4); `view.subject`/`view.since` (Task 3).
- Produces: elemen `data-testid="pet-bubble"` di dalam `pet-actor`, di luar `pet-stage`; state `speech` + satu `setTimeout` yang dipakai ulang Task 7 & seterusnya.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan `describe` baru di akhir `src/test/hanoman-pet.test.tsx` (tambahkan `PET_SPEECH_MS` ke import dari `../src/screens/pet-speech`):

```ts
describe("HanomanPet — pet bicara (SPEC-898)", () => {
  const bl = [spec({ id: "SPEC-1", stage: "executing" })];
  const bubble = () => screen.queryByTestId("pet-bubble");

  it("gelembung lahir saat pose berganti ke kabar yang tak lewat Toast", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toBeNull();                                   // mount tak berteriak
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()!.textContent).toBe("SPEC-1 butuh jawabanmu");
  });

  it("keadaan mapan tak bergelembung", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1" })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toBeNull();
  });

  it("gelembung pose tak menerima pointer dan tak diumumkan dua kali", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    const el = bubble()!;
    expect(el).toHaveStyle({ pointerEvents: "none" });
    expect(el.getAttribute("aria-hidden")).toBe("true");
    // Kalimat status tetap SATU sumber untuk pembaca layar.
    expect(screen.getByTestId("pet-status").textContent).toContain("menunggu jawabanmu");
    expect(styleOf(el)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("gelembung hilang sendiri lewat satu timeout", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
      expect(bubble()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(PET_SPEECH_MS + 50); });
      expect(bubble()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("gelembung di-clamp ke viewport walau pet di tepi kanan", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    const left = Number(/left:\s*(-?\d+)px/.exec(styleOf(bubble()!))![1]);
    // Pet berdiri di rumah (tepi kanan): tepi kanan gelembung harus tetap di dalam viewport.
    expect(HOME + left).toBeGreaterThanOrEqual(0);
    expect(HOME + left + 200).toBeLessThanOrEqual(window.innerWidth);
  });

  it("reduced-motion: gelembung tetap tampil, tanpa animasi", () => {
    mockMatchMedia((q) => q === REDUCED);
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toHaveStyle({ animation: "none" });
  });

  it("panel terbuka menelan gelembung — daftarnya sudah di layar", () => {
    const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
    expect(bubble()).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx -t "SPEC-898"`
Expected: FAIL — `expected null not to be null` (pet-bubble belum ada)

- [ ] **Step 3: Tambah keyframe**

Di `src/src/app.css`, setelah blok `@keyframes hn-pet-reveal { … }`:

```css
/* SPEC-898 · gelembung bicara pet. Hanya opacity + transform → compositor. */
@keyframes hn-pet-bubble-in {
  0% { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 4: Implementasi renderer**

Di `src/src/screens/HanomanPet.tsx`:

1. Import:

```ts
import { PET_SPEECH_MS, speechFor, type PetSpeech } from "./pet-speech";
```

2. Konstanta, di dekat `PANEL_EDGE`:

```ts
// Lebar terburuk gelembung. Clamp memakainya sebagai lebar, jadi gelembung pendek di dekat tepi
// sedikit lebih ke dalam dari yang perlu — yang tak boleh terjadi adalah terpotong.
const BUBBLE_W = 200;
const BUBBLE_EDGE = 8;
```

3. State + timer, setelah `const [decay, setDecay] = …`:

```ts
  // Satu gelembung pada satu waktu; yang baru menggantikan yang lama beserta timer-nya.
  const [speech, setSpeech] = React.useState<(PetSpeech & { id: number }) | null>(null);
```

4. Setelah blok `view = React.useMemo(…)` dan efek `recheckAt`, tambahkan:

```ts
  React.useEffect(() => {
    if (!speech) return;
    const t = setTimeout(() => setSpeech(null), speech.ttl);
    return () => clearTimeout(t);
  }, [speech]);

  // Kalimat dibandingkan SAAT RENDER (pola yang sama dengan `seenPulse`): pet bicara saat kabarnya
  // berubah, bukan saat mount, dan `waiting` yang menua dari biasa ke mendesak dihitung sebagai
  // kabar baru — karena itu pembandingnya teks, bukan `kind`.
  const line = speechFor(view, Date.now());
  const [saidLine, setSaidLine] = React.useState<string | null>(line?.text ?? null);
  if ((line?.text ?? null) !== saidLine) {
    setSaidLine(line?.text ?? null);
    if (line) setSpeech({ ...line, id: Date.now() });
  }
```

5. Posisi horizontal, setelah `const currentX = …`:

```ts
  // Gelembung hidup DI DALAM actor supaya ia ikut posisi pet tanpa kode posisi; yang dihitung di
  // sini hanya pergeseran agar ia tak keluar viewport saat pet berada di tepi.
  const bubbleLeft = React.useMemo(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : laneWidth;
    const want = move.x + anchor.x * cellW - BUBBLE_W / 2;
    const clamped = Math.min(Math.max(want, BUBBLE_EDGE), Math.max(BUBBLE_EDGE, vw - BUBBLE_W - BUBBLE_EDGE));
    return Math.round(anchor.x * cellW - BUBBLE_W / 2 + (clamped - want));
  }, [move.x, cellW, anchor.x, laneWidth]);
```

6. Render, sebagai anak pertama `pet-actor` (sebelum `<div data-testid="pet-stage">`):

```tsx
        {speech && !open && (
          <div data-testid="pet-bubble" data-kind={speech.kind} aria-hidden="true" style={{
            pointerEvents: "none", position: "absolute", left: bubbleLeft, bottom: cellH - 6,
            width: "max-content", maxWidth: BUBBLE_W, boxSizing: "border-box", padding: "6px 10px",
            fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.35,
            color: "var(--text-strong)", background: "var(--surface-card)",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-sm)",
            animation: reduced ? "none" : "hn-pet-bubble-in var(--dur-base) var(--ease-out) both",
          }}>{speech.text}</div>
        )}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: PASS — seluruh berkas, termasuk test SPEC-585/648/897 lama

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/src/app.css src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): gelembung bicara saat kabar berganti"
```

---

### Task 7: Gelembung rekap saat tab aktif lagi

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `petSnapshot`, `petRecap`, `PET_AWAY_MS`, `PET_RECAP_MS` (Task 5); state `speech` (Task 6).
- Produces: gelembung ber-`data-kind="recap"` yang berisi satu `<button>` pembuka panel.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `describe("HanomanPet — pet bicara (SPEC-898)")`:

```ts
  // `document.hidden` adalah getter; test menukarnya lalu menembakkan visibilitychange, persis
  // seperti browser.
  function setHidden(value: boolean): void {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  }

  it("rekap muncul sesudah tab tersembunyi ≥ 5 menit, dengan tombol yang membuka panel", () => {
    const now = vi.spyOn(Date, "now");
    const T0 = Date.parse("2026-08-22T10:00:00.000Z");
    now.mockReturnValue(T0);
    try {
      const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(true);
      now.mockReturnValue(T0 + 6 * 60_000);
      rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(false);
      const el = screen.getByTestId("pet-bubble");
      expect(el.getAttribute("data-kind")).toBe("recap");
      expect(el.textContent).toContain("1 menunggu");
      fireEvent.click(within(el).getByRole("button"));
      expect(screen.getByTestId("pet-panel")).toBeTruthy();
      expect(screen.queryByTestId("pet-bubble")).toBeNull();
    } finally { now.mockRestore(); setHidden(false); }
  });

  it("absen singkat tak melahirkan rekap", () => {
    const now = vi.spyOn(Date, "now");
    const T0 = Date.parse("2026-08-22T10:00:00.000Z");
    now.mockReturnValue(T0);
    try {
      const { rerender } = render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(true);
      now.mockReturnValue(T0 + 60_000);                    // 1 menit < PET_AWAY_MS
      rerender(<HanomanPet sessions={[session({ id: "a", specId: "SPEC-1", decision: true })]} backlog={bl} onOpen={vi.fn()} />);
      setHidden(false);
      const el = screen.queryByTestId("pet-bubble");
      // Boleh ada gelembung POSE (kondisi memang berubah), tapi tak boleh ada rekap.
      expect(el?.getAttribute("data-kind")).not.toBe("recap");
    } finally { now.mockRestore(); setHidden(false); }
  });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx -t "rekap muncul"`
Expected: FAIL — `expected null to be 'recap'`

- [ ] **Step 3: Implementasi**

Di `src/src/screens/HanomanPet.tsx`:

1. Perluas import:

```ts
import {
  PET_AWAY_MS, PET_SPEECH_MS, petRecap, petSnapshot, speechFor,
  type PetSnapshot, type PetSpeech,
} from "./pet-speech";
```

2. Konstanta, di dekat `BUBBLE_EDGE`:

```ts
// Socket `events` ditutup saat tab hidden dan baru menyambung saat tab aktif lagi (api/events.ts),
// jadi frame pertama belum tentu sudah tiba pada `visibilitychange`. Snapshot ditahan selama ini,
// bukan dibuang pada render pertama yang datanya masih basi.
const RECAP_GRACE_MS = 5_000;
```

3. Ref + efek, setelah efek timer gelembung:

```ts
  const awayRef = React.useRef<PetSnapshot | null>(null);
  const backAtRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const input = { sessions, backlog, notifications: items, now: Date.now() };
    if (documentHidden) {
      // Dicap saat tab jadi hidden — mengambilnya saat visible berarti ia dicap ulang tiap render
      // dan diff-nya selalu kosong.
      if (!awayRef.current) awayRef.current = petSnapshot(input);
      backAtRef.current = null;
      return;
    }
    const away = awayRef.current;
    if (!away) return;
    if (backAtRef.current === null) backAtRef.current = input.now;
    if (input.now - away.at < PET_AWAY_MS) { awayRef.current = null; return; }
    const recap = petRecap(away, input);
    if (recap) { awayRef.current = null; setSpeech({ ...recap, id: input.now }); return; }
    if (input.now - backAtRef.current > RECAP_GRACE_MS) awayRef.current = null;
  }, [documentHidden, sessions, backlog, items]);
```

4. Ganti render gelembung Task 6 supaya rekap punya tombol dan tetap terjangkau:

```tsx
        {speech && !open && (
          <div data-testid="pet-bubble" data-kind={speech.kind}
            aria-hidden={speech.kind === "pose" ? "true" : undefined} style={{
            pointerEvents: "none", position: "absolute", left: bubbleLeft, bottom: cellH - 6,
            width: "max-content", maxWidth: BUBBLE_W, boxSizing: "border-box", padding: "6px 10px",
            fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.35,
            color: "var(--text-strong)", background: "var(--surface-card)",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-sm)",
            animation: reduced ? "none" : "hn-pet-bubble-in var(--dur-base) var(--ease-out) both",
          }}>
            {speech.text}
            {speech.kind === "recap" && (
              // Satu-satunya hit area tambahan di jalur pet, dan ia transient: kelas yang sama
              // dengan panel, bukan pelebaran badan pet (SPEC-763).
              <div style={{ marginTop: 6, pointerEvents: "auto" }}>
                <Button size="sm" variant="ghost" leftIcon="list-checks"
                  aria-label={`${speech.text} — buka ringkasan pet`}
                  style={reduced ? { transition: "none", transform: "none" } : undefined}
                  onClick={() => { setSpeech(null); showPanel(); }}>Lihat</Button>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: PASS — seluruh berkas

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): rekap 'selama kamu pergi' saat tab aktif lagi"
```

---

### Task 8: Urgensi menurut umur menaikkan fps baris `waiting`

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `isUrgent` (Task 4), `view.since` (Task 3).
- Produces: durasi animasi baris `waiting` dibagi `PET_URGENT_RATE` saat mendesak.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `describe("HanomanPet — pet bicara (SPEC-898)")` (tambahkan `durationMs` ke import bila belum ada — sudah ada di berkas ini):

```ts
  it("baris waiting berdenyut lebih cepat saat pertanyaannya menua", () => {
    const young = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: new Date(Date.now() - 60_000).toISOString() })];
    const { rerender } = render(<HanomanPet sessions={young} backlog={bl} onOpen={vi.fn()} />);
    expect(styleOf(atlas())).toContain(`${durationMs("waiting")}ms`);

    const old = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: new Date(Date.now() - 20 * 60_000).toISOString() })];
    rerender(<HanomanPet sessions={old} backlog={bl} onOpen={vi.fn()} />);
    expect(styleOf(atlas())).toContain(`${Math.round(durationMs("waiting") / 1.5)}ms`);
  });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx -t "berdenyut lebih cepat"`
Expected: FAIL — durasi tetap `durationMs("waiting")`

- [ ] **Step 3: Implementasi**

1. Import `isUrgent` dari `./pet-speech`.

2. Konstanta di dekat `BUBBLE_W`:

```ts
// SPEC-898 · fps baris `waiting` saat pertanyaannya sudah menua (6 → 9). Digerbangi baris, bukan
// pose: `wave`/`thanks` yang menumpang di atasnya tetap berirama normal.
const PET_URGENT_RATE = 1.5;
```

3. Ganti perhitungan `frames`:

```ts
  const urgent = isUrgent(view, Date.now()) && displayRow === "waiting";
  const frameMs = Math.round(durationMs(displayRow) / (urgent ? PET_URGENT_RATE : 1));
  const frames = reduced
    ? "none"
    : `hn-pet-frames ${frameMs}ms steps(${columns}, end) ${display.loop ? "infinite" : "1 forwards"}`;
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: PASS — seluruh berkas

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): baris waiting lebih mendesak saat pertanyaannya menua"
```

---

### Task 9: Baris atlas `thanks` (pipeline A)

**Files:**
- Create: `internal/assets/pet/prompts/thanks.md`
- Create (turunan pipeline): `internal/assets/pet/rows/thanks.png`, `internal/assets/pet/rows/thanks.report.json`, `internal/assets/pet/qa/thanks.gif`, `internal/assets/pet/qa/thanks-contact.png`, `internal/assets/pet/qa/thanks-onion.png`
- Modify: `internal/scripts/pet/petlib.py` (`ROWS`), `internal/scripts/pet/atlas.py` (`quality`)
- Modify: `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp`, `internal/assets/pet/pet.json` (dirakit ulang)
- Modify: `src/src/screens/pet-sprite.ts` (`PET_ROW_KEYS`)
- Test: `src/test/pet-sprite.test.ts`, `internal/scripts/pet/test-petlib.py`

**Interfaces:**
- Consumes: —
- Produces: `PetRowKey` `"thanks"` pada indeks 12, `loop: false`, `then: "idle"`, `fps: 10`. Dipakai Task 10 lewat `oneShot`.

- [ ] **Step 1: Tulis naskah baris**

Buat `internal/assets/pet/prompts/thanks.md`, mengikuti bentuk `prompts/wave.md`:

```markdown
# Row `thanks` — 8 frames, one-shot gratitude

The character stands facing three-quarters toward the viewer and performs a single, calm
gesture of thanks (STK-007: GST-02 open palm · EXP-08 grateful · TAL-01 neutral curve).

Frame beats:
1. Neutral standing pose, identical footing to `idle` frame 1.
2. Both hands begin to rise toward the chest.
3. Hands meet in front of the chest, palms together, elbows relaxed.
4. Head dips slightly, eyes narrow into a pleased crescent (no emoji face).
5. Deepest point of the bow — head lowest, tail curving gently upward.
6. Head rises back, hands begin to open downward and outward.
7. Palms open at waist height, tail settling.
8. Back to the neutral standing pose of frame 1 so the row can chain into `idle`.

Hard constraints for this row:
- Feet stay in exactly the same place in all 8 frames — no stepping, no drifting.
- Hands NEVER rise above the shoulders. `wave` is the row that lifts one hand to head height;
  this row must be unmistakably different from it.
- Both hands move together and symmetrically. One-handed gestures read as waving.
- The tail stays inside the cell; it curves up at most to hip height.
- No speech bubbles, no hearts, no props, no sparkles — the gratitude is in the body only.
```

- [ ] **Step 2: Daftarkan baris di pipeline & frontend**

Di `internal/scripts/pet/petlib.py`, tambahkan di ekor `ROWS`:

```python
    # SPEC-898 · reaksi saat pet dielus (STK-007). Sekali-putar seperti `wave`, bukan pose mesin.
    {"key": "thanks",       "fps": 10, "loop": False, "mode": "stand", "then": "idle"},
```

Di `src/src/screens/pet-sprite.ts`, tambahkan `"thanks"` di ekor `PET_ROW_KEYS`:

```ts
export const PET_ROW_KEYS = [
  "idle", "walk-right", "walk-left", "working", "waiting", "blocked", "review", "shipped",
  // SPEC-897 · dua baris baru di EKOR: indeks baris lama tak bergeser, diff atlas minimal.
  "docs-updated", "wave", "deciding", "sleep",
  // SPEC-898 · reaksi elus. BUKAN pose — `POSE_ROW` tak menyentuhnya.
  "thanks",
] as const;
```

- [ ] **Step 3: Perbarui test manifest (akan gagal sampai atlas dirakit)**

Di `src/test/pet-sprite.test.ts`, ganti `expect(PET_MANIFEST.rows.length).toBe(12);` menjadi `13`, dan tambahkan:

```ts
    // SPEC-898 · baris reaksi, bukan pose: ia hanya bisa dipilih oleh `oneShot`.
    expect(rowIndex("thanks")).toBe(12);
    expect(rowOf("thanks").loop).toBe(false);
    expect(thenOf("thanks")).toBe("idle");
    expect(Object.values(POSE_ROW)).not.toContain("thanks");
```

- [ ] **Step 4: Jalankan pipeline generasi**

```bash
python3 internal/scripts/pet/gen.py thanks        # ±3 menit, butuh Codex CLI
python3 internal/scripts/pet/key.py thanks
python3 internal/scripts/pet/register.py thanks
python3 internal/scripts/pet/qa.py thanks
```

Expected: `qa.py` mencetak OK — 8 sprite, tumpahan sel 0 px, residu pra-pin ≤ 0,25 (`stand`).
Bila gagal, ulangi `gen.py thanks --note "<koreksi>"` (mis. `"keep both hands below the shoulders"`,
`"keep the feet identical in every frame"`) sampai gerbangnya lolos. Jangan menurunkan gerbang.

- [ ] **Step 5: Rakit atlas dengan quality yang muat**

`quality=82` sudah memberi 975 484 B pada 12 baris; baris ke-13 melampaui `ATLAS_BUDGET`. Turunkan
`quality` di `internal/scripts/pet/atlas.py` (mulai dari `78`, turunkan bertahap bila masih besar)
dan tambahkan komentar alasannya:

```python
def encode(atlas: Image.Image) -> bytes:
    buf = io.BytesIO()
    # SPEC-898 · 13 baris tak muat di plafon 1 MB pada quality 82 (12 baris = 975 484 B). Plafonnya
    # tidak dinaikkan: satu <img> yang di-decode di setiap halaman adalah anggaran, bukan preferensi.
    atlas.save(buf, format="WEBP", quality=78, method=6, exact=False)
    return buf.getvalue()
```

```bash
python3 internal/scripts/pet/atlas.py
python3 internal/scripts/pet/verify.py
python3 internal/scripts/pet/atlas.py --check
```

Expected: `atlas.py` mencetak `13 baris` dan byte < 1 000 000; `verify.py` dan `--check` OK.
**Catat angka nyata (quality final + byte final)** — dipakai di Task 11.

- [ ] **Step 6: Jalankan test yang tersentuh**

```bash
python3 internal/scripts/pet/test-petlib.py
env -u NODE_ENV pnpm vitest --run src/test/pet-sprite.test.ts src/test/hanoman-pet.test.tsx
```

Expected: PASS semuanya.

- [ ] **Step 7: Review Gate 2 (mata manusia)**

Lihat `internal/assets/pet/qa/thanks.gif` dan `qa/thanks-contact.png`: siluet profil satu mata,
jamang, kain, ekor besar; kedua tangan bergerak simetris dan **tak pernah** melewati bahu; kaki
tak bergeser; tak ada ornamen kedua yang berkedip (cacat yang lolos gerbang numerik pada `sleep`,
SPEC-897). Bila cacat, kembali ke Step 4 dengan `--note`.

- [ ] **Step 8: Commit**

```bash
git add internal/assets/pet internal/scripts/pet src/src/screens/pet-sprite.ts src/test/pet-sprite.test.ts
git commit -m "feat(pet): baris atlas thanks (13 baris, quality diturunkan agar muat 1 MB)"
```

---

### Task 10: Dielus — tiga klik memutar `thanks` + hati

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Modify: `src/src/app.css`
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: baris `thanks` (Task 9), `oneShot` yang sudah ada.
- Produces: `data-testid="pet-hearts"`; perilaku klik ke-3 yang **tidak** menyentuh panel.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `describe("HanomanPet — pet bicara (SPEC-898)")`:

```ts
  it("tiga klik dalam 2 dtk memutar baris thanks + hati, tanpa mengubah panel", () => {
    render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    fireEvent.click(hit());                                   // buka
    expect(screen.getByTestId("pet-panel")).toBeTruthy();
    fireEvent.click(hit());                                   // tutup
    fireEvent.click(hit());                                   // elus — panel TIDAK dibuka lagi
    expect(rowshift()).toHaveAttribute("data-row", "thanks");
    expect(screen.getByTestId("pet-hearts").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("pet-hearts")).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("pet-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("klik yang berjauhan tetap membuka/menutup panel seperti biasa", () => {
    vi.useFakeTimers();
    try {
      render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
      fireEvent.click(hit());
      act(() => { vi.advanceTimersByTime(2_500); });
      fireEvent.click(hit());
      act(() => { vi.advanceTimersByTime(2_500); });
      fireEvent.click(hit());
      expect(rowshift()).not.toHaveAttribute("data-row", "thanks");
    } finally { vi.useRealTimers(); }
  });

  it("reduced-motion: elus tak memutar apa pun dan tak memunculkan hati", () => {
    mockMatchMedia((q) => q === REDUCED);
    render(<HanomanPet sessions={[]} backlog={bl} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(hit());
    fireEvent.click(hit());
    expect(rowshift()).not.toHaveAttribute("data-row", "thanks");
    expect(screen.queryByTestId("pet-hearts")).toBeNull();
  });
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx -t "tiga klik"`
Expected: FAIL — `expected data-row "idle" to be "thanks"`

- [ ] **Step 3: Tambah keyframe hati**

Di `src/src/app.css`, setelah `@keyframes hn-pet-bubble-in`:

```css
/* SPEC-898 · hati kecil saat pet dielus. Transform + opacity saja; dimatikan oleh reduced-motion
   di komponen (elemennya tak dirender sama sekali). */
@keyframes hn-pet-heart {
  0% { opacity: 0; transform: translateY(0) scale(0.6); }
  30% { opacity: 1; transform: translateY(-8px) scale(1); }
  100% { opacity: 0; transform: translateY(-26px) scale(0.9); }
}
```

- [ ] **Step 4: Implementasi**

Di `src/src/screens/HanomanPet.tsx`:

1. Konstanta:

```ts
// SPEC-898 · elus = tiga klik dalam dua detik. Klik ke-3 TIDAK menyentuh panel: itulah isi
// "tidak membuka/menutup panel berulang". Klik pertama & kedua tetap buka lalu tutup — itu
// perilaku normal dua klik dan tak boleh diubah demi easter egg.
const PET_CLICK_WINDOW_MS = 2_000;
const PET_CLICK_BURST = 3;
```

2. State + ref, di dekat `oneShot`:

```ts
  const clicksRef = React.useRef<number[]>([]);
  const [hearts, setHearts] = React.useState(0);
```

3. Pemutar `thanks`, setelah `playWave`:

```ts
  const playThanks = React.useCallback(() => {
    if (reduced) return;
    setOneShot({ row: "thanks", id: Date.now() });   // menggantikan `wave` yang mungkin sedang main
    setHearts((n) => n + 1);
  }, [reduced]);
```

4. Ganti `reactAndToggle`:

```ts
  function reactAndToggle() {
    const now = Date.now();
    const burst = [...clicksRef.current.filter((t) => now - t < PET_CLICK_WINDOW_MS), now];
    if (burst.length >= PET_CLICK_BURST) {
      clicksRef.current = [];        // satu terima kasih per rentetan
      playThanks();
      return;
    }
    clicksRef.current = burst;
    if (!reduced) setReacting(true);
    playWave();
    togglePanel();
  }
```

5. Render hati, di dalam `pet-stage` tepat setelah lencana:

```tsx
          {hearts > 0 && !reduced && (
            <span data-testid="pet-hearts" key={hearts} aria-hidden="true" style={{
              pointerEvents: "none", position: "absolute", zIndex: 2,
              left: Math.round(anchor.x * cellW), bottom: Math.round(cellH * 0.55),
            }} onAnimationEnd={(event) => {
              if ((event.target as HTMLElement).dataset.last === "1") setHearts(0);
            }}>
              {[0, 1, 2].map((i) => (
                <span key={i} data-last={i === 2 ? "1" : undefined} style={{
                  position: "absolute", left: i * 9 - 9, fontFamily: "var(--font-ui)", fontSize: 12,
                  color: "var(--accent)",
                  animation: `hn-pet-heart 900ms var(--ease-out) ${i * 120}ms both`,
                }}>♥</span>
              ))}
            </span>
          )}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: PASS — seluruh berkas

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/src/app.css src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): dielus tiga klik memutar thanks + hati"
```

---

### Task 11: ADR-0141 & docs

**Files:**
- Create: `internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md`
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/frontend/frontend-implementation.md` (seksi "Pet Hanoman")
- Modify: `internal/assets/pet/README.md`
- Modify: `internal/docs/README.md`

**Interfaces:**
- Consumes: angka nyata quality + byte atlas dari Task 9 Step 5.
- Produces: —

- [ ] **Step 1: Tulis ADR-0141**

Buat `internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md`, mengikuti bentuk ADR-0140
(judul, `Tanggal · Status · Sumber`, Konteks, Keputusan bernomor, Konsekuensi, Alternatif ditolak).
Isi yang wajib ada:

- **Konteks:** `TerminalSession` tak punya stempel waktu; hook `Notification` menumpuk baris
  sehingga mtime marker dicap ulang tiap idle (bukti: marker nyata 13 baris).
- **Keputusan 1:** isi marker `.worktrees/.decisions/<id>` adalah **detik epoch onset**, ditulis
  sekali (`[ -s F ] || date +%s > F`); `size > 0` tetap satu-satunya arti "menunggu manusia" —
  SPEC-184 diamandemen pada isinya, bukan pada semantiknya.
- **Keputusan 2:** `decisionAt` adalah kolom payload sesi yang **additif & opsional**; absen berarti
  "tak diketahui", dan konsumen tak boleh mengeskalasi tanpa stempel.
- **Keputusan 3:** tanpa endpoint, channel, skema DB, atau poll baru — ADR-0039 & ADR-0024
  ditegakkan.
- **Konsekuensi:** sesi yang lahir sebelum versi ini tak punya stempel sampai episode menunggu
  berikutnya; dialog TUI yang dijawab tanpa `UserPromptSubmit` tetap meninggalkan marker terisi
  (cacat lama SPEC-184, tak diperkenalkan di sini).
- **Alternatif ditolak:** mtime marker (tercap ulang), peta onset di memori server (hilang saat
  restart & saat dashboard tutup), `createdAt` notifikasi `decision` (benar, tapi `pty.ts` sengaja
  nol dependensi DB dan grup siar `sessions` di-recompute tiap detik).

- [ ] **Step 2: Tautkan ADR di index**

Di `internal/docs/adr/README.md`, tambahkan baris paling atas daftar:

```markdown
- [0141 — Onset "menunggu" hidup di isi marker keputusan](0141-onset-menunggu-di-marker-keputusan.md) — *mengamandemen SPEC-184 pada isi marker; menegakkan 0039/0024*
```

- [ ] **Step 3: Perbarui `frontend-implementation.md`**

Di seksi "Pet Hanoman", perbarui judul seksi menjadi menyebut `Pet hidup C SPEC-898`, tambahkan
`decisionAt` sebagai baris tabel sumber, dan tambahkan paragraf yang menjelaskan: himpunan tertutup
kabar yang bergelembung, gelembung pose `aria-hidden` vs gelembung rekap ber-tombol, snapshot dicap
saat hidden, ambang `PET_AWAY_MS`/`PET_URGENT_MS`, fps `waiting` yang naik, elus tiga klik, dan
atlas 13 baris.

- [ ] **Step 4: Perbarui `internal/assets/pet/README.md`**

Ubah "12 baris" → "13 baris"; tambahkan baris `thanks` pada penjelasan; ganti catatan anggaran
dengan angka nyata dari Task 9 (quality final, byte final, sisa terhadap 1 MB); tambahkan ke seksi
review manusia bahwa `thanks` harus dibedakan dari `wave` (kedua tangan, tak pernah di atas bahu).

- [ ] **Step 5: Cek index Source of Truth**

Run: `node dist/cli.js docs index --check 2>/dev/null || pnpm --filter ./runner exec tsx src/cli.ts docs index --check`
Jika CLI tak tersedia di worktree, cukup pastikan `internal/docs/README.md` memuat tautan ADR-0141
(kategori `adr`) — `frontend-implementation.md` dan `internal/assets/pet/README.md` sudah ter-link
sejak spec A.

- [ ] **Step 6: Commit**

```bash
git add internal/docs internal/assets/pet/README.md
git commit -m "docs(pet): ADR-0141 onset menunggu di marker + docs SPEC-898"
```

---

### Task 12: Verifikasi akhir

**Files:** —

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti hijau untuk `Execute done`.

- [ ] **Step 1: Test paket `src` yang tersentuh**

```bash
env -u NODE_ENV pnpm vitest --run \
  src/test/pet-speech.test.ts src/test/pet-state.test.ts \
  src/test/pet-sprite.test.ts src/test/pet-walk.test.ts \
  src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx
```
Expected: seluruh berkas PASS, dan jumlah test **bukan** nol (`--changed` tak dipakai di sini justru
supaya "no test files" tak bisa terbaca hijau).

- [ ] **Step 2: Test paket `runner` & `server` yang tersentuh**

```bash
env -u NODE_ENV pnpm vitest --run runner/test/settings.test.ts runner/test/codex-settings.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV \
  pnpm vitest --run --no-file-parallelism server/test/pty.test.ts server/test/terminal.route.test.ts
```
Expected: PASS.

- [ ] **Step 3: Pipeline atlas**

```bash
python3 internal/scripts/pet/test-petlib.py
python3 internal/scripts/pet/verify.py
python3 internal/scripts/pet/atlas.py --check
```
Expected: OK, `13 baris`, byte < 1 000 000.

- [ ] **Step 4: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck
pnpm --filter ./runner typecheck
pnpm --filter ./server typecheck
pnpm --filter ./src typecheck
```
Expected: nol error. (Empat paket memang tersentuh — `pnpm -r typecheck` tetap tidak dipakai.)

- [ ] **Step 5: Uji endpoint nyata sekali di akhir**

```bash
HANOMAN_HOME="$(mktemp -d)" DATABASE_URL="file:$(mktemp -d)/smoke.db" \
  pnpm --filter ./server exec tsx src/server.ts &
# tunggu port siap, lalu:
curl -s localhost:8787/api/terminal/sessions | head -c 400
```
Expected: 200 dengan array JSON. Bila ada sesi yang markernya terisi, barisnya memuat `decisionAt`
ISO. Matikan server per-PID (`lsof -ti:8787` → `kill <pid>`), **jangan** `pkill -f`.

- [ ] **Step 6: Diff bersih & push**

```bash
git status --porcelain     # harus kosong
git push origin HEAD:refs/heads/hanoman/spec-898
```
