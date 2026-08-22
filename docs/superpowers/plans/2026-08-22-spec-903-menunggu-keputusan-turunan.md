# "Menunggu keputusan" sebagai keadaan turunan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `SessionInfo.decision` berhenti menjadi latch marker dan menjadi keadaan turunan — marker
terisi **dan** pane benar-benar diam — sehingga pil "Menunggu keputusan" padam begitu agen kembali
bekerja, lewat jalur mana pun, untuk claude maupun codex.

**Architecture:** Marker `.worktrees/.decisions/<id>` tetap sinyal masuk yang durable (hanya hook
agen dan bukti positif jawaban manusia yang boleh mengubahnya). Yang berubah adalah cara membacanya:
`FMT` milik `tmux list-panes -a` yang sudah dipanggil tiap poll bertambah satu variabel,
`#{window_activity}`, dan `decision` digerbangi "pane tak mengeluarkan apa pun selama ≥ 3 detik".
Nol invokasi tmux tambahan (pola `#{alternate_on}`, SPEC-863). Terminal, pet, notifikasi, dan panel
lead semuanya membaca bit yang sama, jadi tak ada rumus kedua yang perlu dijaga tetap sinkron.

**Tech Stack:** TypeScript strict, Node + Fastify, tmux 3.x, vitest.

Spec: `docs/superpowers/specs/2026-08-22-spec-903-menunggu-keputusan-turunan-design.md`
Audit: `docs/superpowers/audits/2026-08-22-spec-903-menunggu-keputusan-turunan.md`

## Global Constraints

- **Nol invokasi tmux tambahan per sesi per poll.** Variabel baru wajib menumpang `FMT` yang sudah
  ada (`server/src/services/pty.ts:250`). Tak boleh ada `capture-pane` baru di jalur poll.
- **Fail-open.** Aktivitas pane tak terbaca → dibaca sebagai "diam" → perilaku persis hari ini.
- **`PANE_QUIET_MS = 3000`** (terukur, audit §3.1: pane bekerja `window_activity == now` pada 22/22
  sampel 1 Hz; pane diam beku 317 dtk; lag pembulatan detik ≤ 1 dtk).
- **Marker tak boleh dikosongkan oleh heuristik.** `Notification` claude mengisi marker sekali per
  dialog dan tak pernah menembak lagi (terukur SPEC-452: 0 B selama 120 dtk dengan dialog terbuka).
  Menghapusnya karena pane kebetulan berisik menghilangkan pertanyaan itu permanen.
- **Semantik isi marker (ADR-0141) tak disentuh:** tetap "detik epoch onset, ditulis sekali".
- **Kosakata sesi WAJIB identik antara `TerminalScreen` dan `pet-state`** (batas (2) backlog).
  Dipenuhi secara konstruksi: keduanya membaca `session.decision` yang sama; **jangan** menambah
  predikat di salah satu sisi.
- **Jangan menyentuh** `server/src/services/lead/detect.ts` selain de-duplikasi `clearMarker` di
  Task 5, `runner/src/settings.ts`, `runner/src/codex-settings.ts`, skema, DTO, atau frontend.
- Perintah test di seluruh plan ini memakai DB terisolasi (SPEC-479) dan berjalan serial:
  ```bash
  export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
  ```
  Jalankan dari root worktree `.worktrees/spec-903`.

---

## File Structure

| berkas | tanggung jawab |
|---|---|
| `server/src/services/pty.ts` | **inti** — `PANE_QUIET_MS`, `paneQuiet()`, `decisionOnset()`, `clearMarker()`, `FMT` += `#{window_activity}`, `Pane.activityAt`, `decision`/`decisionAt` turunan, `liveDecisions().waiting` |
| `server/src/services/notifications.ts` | `scanDecisions` menotifikasi memakai bit turunan; dedup tetap dikunci pada marker |
| `server/src/routes/lead.ts` | daftar `waiting` panel lead memakai bit turunan |
| `server/src/routes/terminal.ts` | `dialog/answer` yang berhasil mengosongkan marker |
| `server/src/services/lead/detect.ts` | hanya memakai `clearMarker` yang sudah diekspor (de-dup) |
| `server/test/pty.test.ts` | unit murni `paneQuiet`/`decisionOnset` + integrasi tmux sungguhan |
| `server/test/notifications.test.ts` | gerbang `waiting` + dedup kedipan |
| `server/test/terminal.route.test.ts` | `decisionAt` yang menyeberang HTTP, semantik baru |
| `server/test/terminal-dialog.route.test.ts` | jawaban yang mendarat mengosongkan marker |
| `internal/docs/adr/0143-menunggu-keputusan-keadaan-turunan.md` | ADR baru |
| `internal/docs/adr/0141-…`, `internal/docs/adr/README.md`, `internal/docs/README.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/frontend/frontend-implementation.md` | amandemen + index |

---

## Task 1: `paneQuiet` — gerbang murni

**Files:**
- Modify: `server/src/services/pty.ts` (sesudah `markerFilled`, ±baris 49)
- Test: `server/test/pty.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `export const PANE_QUIET_MS: number` (3000);
  `export const paneQuiet(activityAt: number, now?: number): boolean` — `activityAt` dalam **detik**
  epoch; `now` dalam **milidetik**.

- [x] **Step 1: Write the failing test**

Tambahkan di `server/test/pty.test.ts`, tepat sesudah test `markerFilled` (±baris 654), dan
tambahkan `PANE_QUIET_MS, paneQuiet` ke daftar import dari `../src/services/pty`:

```ts
  // SPEC-903 · ADR-0143 · marker terisi bukan bukti sesi menunggu; yang menggerbanginya adalah
  // pane yang benar-benar diam. Ambang 3 dtk diukur di audit §3.1, bukan ditebak.
  it("paneQuiet: aktivitas tak terbaca dibaca sebagai diam (fail-open, SPEC-903)", () => {
    const now = 1_800_000_000_000;
    expect(paneQuiet(NaN, now)).toBe(true);
    expect(paneQuiet(0, now)).toBe(true);
  });

  it("paneQuiet: keluaran lebih baru dari PANE_QUIET_MS = tidak diam (SPEC-903)", () => {
    const now = 1_800_000_000_000;
    expect(paneQuiet(now / 1000, now)).toBe(false);
    expect(paneQuiet((now - PANE_QUIET_MS + 1_000) / 1000, now)).toBe(false);
    expect(paneQuiet((now - PANE_QUIET_MS) / 1000, now)).toBe(true);
    expect(paneQuiet((now - 300_000) / 1000, now)).toBe(true);
  });
```

- [x] **Step 2: Run test to verify it fails**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "paneQuiet"
```

Expected: FAIL — `paneQuiet is not a function` / error TypeScript pada import.

- [x] **Step 3: Write minimal implementation**

Di `server/src/services/pty.ts`, tepat sesudah `markerFilled` (±baris 49):

```ts
// SPEC-903 · ADR-0143 · "menunggu manusia" adalah keadaan TURUNAN, bukan latch. Marker tetap sinyal
// masuk yang durable — hook agen memasangnya dan hanya UserPromptSubmit / jawaban manusia yang
// melepasnya — tapi dibacanya digerbangi: pane yang masih mengeluarkan sesuatu berarti agen sedang
// bekerja, bukan menunggu. Sumbernya `#{window_activity}` yang ikut di FMT, jadi nol invokasi tmux
// tambahan (pola `#{alternate_on}`, SPEC-863).
//
// Ambangnya diukur (audit SPEC-903 §3.1): pane claude yang bekerja punya `window_activity == now`
// pada 22/22 sampel 1 Hz — timer giliran berdetak tiap detik — sementara pane yang diam di prompt
// beku 317 dtk. 3 dtk = 3× margin di atas jeda keluaran terukur (≤ 1 dtk) dan di atas lag
// pembulatan detik tmux (≤ 1 dtk).
export const PANE_QUIET_MS = 3_000;

// `activityAt` = detik epoch `#{window_activity}`. Nol/NaN = tmux tak menjawabnya (versi lama,
// format kosong) → dibaca sebagai diam: ragu selalu berarti pil TETAP menyala, karena pil yang
// padam saat ada pertanyaan sungguhan membuat manusia kehilangan pertanyaannya.
export const paneQuiet = (activityAt: number, now: number = Date.now()): boolean =>
  !(activityAt > 0) || now - activityAt * 1000 >= PANE_QUIET_MS;
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "paneQuiet"
```

Expected: PASS, 2 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(pty): gerbang paneQuiet dari window_activity (SPEC-903)"
```

---

## Task 2: `decision` turunan dari `#{window_activity}`

**Files:**
- Modify: `server/src/services/pty.ts:250-256` (`FMT`), `:92-96` (`Pane`), `:281-302` (`parsePanes`)
- Test: `server/test/pty.test.ts`

**Interfaces:**
- Consumes: `PANE_QUIET_MS`, `paneQuiet` (Task 1)
- Produces: `Pane.activityAt: number` (detik epoch, `NaN` bila tmux tak menjawab);
  `Pane.decision` kini `!exited && !!decisionFile && markerFilled(f) && paneQuiet(activityAt)`

- [x] **Step 1: Write the failing test**

Tambahkan di `server/test/pty.test.ts` sesudah test `"listSessions melaporkan decision saat marker
keputusan terisi (SPEC-196)"` (±baris 666):

```ts
  // SPEC-903 · ADR-0143 · marker DITULIS hook agen dan hanya dilepas UserPromptSubmit, jadi ia tetap
  // terisi sepanjang agen bekerja sesudah pertanyaannya dijawab lewat TUI/route/Esc. Yang
  // memadamkannya bukan tambalan per-jalur, tapi keadaan pane yang sebenarnya.
  it("decision padam selama pane masih bicara, menyala saat pane diam (SPEC-903)",
    { timeout: 40_000 }, async () => {
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-903-noisy");
    // Berisik ±5 dtk (25 × 0,2 dtk), lalu diam — satu pane membuktikan kedua arah transisinya.
    const noisy = "i=0; while [ $i -lt 25 ]; do printf .; sleep 0.2; i=$((i+1)); done; sleep 300";
    const s = createSession("p903", repoDir, {
      id: "spec-903-noisy", decisionFile, command: ["/bin/sh", "-c", noisy],
    });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    try {
      writeFileSync(decisionFile, `${Math.floor(Date.now() / 1000)}\n`);
      expect(markerFilled(decisionFile)).toBe(true);
      expect(find().decision).toBe(false);                       // marker terisi ≠ menunggu
      await new Promise((r) => setTimeout(r, 2_000));
      expect(find().decision).toBe(false);                       // masih bicara → masih bekerja
      await waitFor(() => find().decision === true, 30_000);     // diam ≥ 3 dtk → menunggu
    } finally {
      killSession(s.id);
    }
  });
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "SPEC-903"
```

Expected: FAIL pada asertion pertama — `expected true to be false`, karena `decision` hari ini hanya
membaca marker.

- [x] **Step 3: Write minimal implementation**

3a. `FMT` (`server/src/services/pty.ts:250`) — tambah satu kolom di **ujung**:

```ts
const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}", "#{@hanoman_agent}", "#{alternate_on}",
  "#{window_activity}",
].join("\t");
```

3b. Tipe `Pane` (±baris 92) — tambah field sesudah `altScreen`:

```ts
type Pane = SessionInfo & {
  code: number; phaseFile?: string; decisionFile?: string;
  // SPEC-863 · `#{alternate_on}` pane — TUI layar penuh (vim) 1, shell dan TUI agen 0.
  altScreen: boolean;
  // SPEC-903 · `#{window_activity}` — detik epoch keluaran TERAKHIR pane. Satu window satu pane di
  // setiap sesi hanoman, jadi ini aktivitas pane. NaN bila tmux tak menjawabnya (versi lama).
  activityAt: number;
};
```

3c. `parsePanes` (±baris 285) — destructure kolom baru, hitung `activityAt`, gerbangi `decision`:

```ts
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, agent,
      alternate, activity] = line.split("\t");
    if (!n?.startsWith(PREFIX)) return [];
    const exited = dead === "1";
    const activityAt = Number(activity);
    return [{
      id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
      flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
      cwd: cwd ?? "", exited, code: Number(code) || 0,
      decisionFile: decisionFile || undefined,
      // SPEC-230 · branch integrasi sesi project-level (PRD: prd/<slug>). Kosong = tak ada.
      branch: branch || undefined,
      // SPEC-196 · marker terisi = agen pernah minta masukan. SPEC-903 · ADR-0143 · itu sinyal
      // masuk, bukan keadaan: pane yang masih bicara berarti agen sudah lanjut bekerja, apa pun
      // jalur yang mengakhiri episode menunggunya (dialog dijawab di TUI, lewat route SPEC-899,
      // Esc, atau codex yang melanjutkan sendiri).
      decision: !exited && !!decisionFile && markerFilled(decisionFile) && paneQuiet(activityAt),
      // SPEC-338 · sesi yang lahir sebelum ADR-0074 tak punya opsi ini → claude.
      agent: (agent === "codex" ? "codex" : "claude") as Agent,
      altScreen: alternate === "1",
      activityAt,
    }];
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "SPEC-903"
```

Expected: PASS.

- [x] **Step 5: Jalankan test pty yang tersentuh, pastikan tak ada yang jadi merah selain yang memang berubah artinya**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts
```

Expected: satu-satunya kegagalan yang boleh ada adalah
`"listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)"` dan
`"listSessions memberi decisionAt dari epoch di marker; teks lama diabaikan"` — keduanya diperbaiki
di Step 6 & Task 3. Kegagalan lain = regresi, hentikan dan telusuri.

- [x] **Step 6: Sesuaikan test SPEC-196 yang artinya memang berubah**

Ganti test `"listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)"` di
`server/test/pty.test.ts:657` menjadi (pane `/bin/sleep` tak pernah bicara sesudah lahir, jadi ia
diam sesudah `PANE_QUIET_MS`):

```ts
  it("listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)",
    { timeout: 20_000 }, async () => {
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-d");
    // SPEC-903 · pane mentah yang tak pernah bicara: `#{window_activity}` mematok waktu lahir pane,
    // jadi gerbang diam baru lewat sesudah PANE_QUIET_MS — itu bagian dari kontraknya sekarang.
    const s = createSession("p1", repoDir, { decisionFile, command: ["/bin/sleep", "300"] });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    try {
      expect(find().decision).toBe(false);        // sesi hidup, marker belum ditulis
      appendFileSync(decisionFile, "menunggu\n");  // hook Notification menulis marker
      await waitFor(() => find().decision === true, 15_000);
    } finally {
      killSession(s.id);
    }
  });
```

- [x] **Step 7: Run test to verify it passes**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "SPEC-196"
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(pty): decision turunan dari keadaan pane, bukan latch marker (SPEC-903)"
```

---

## Task 3: `decisionAt` = awal episode yang sedang berlangsung

**Files:**
- Modify: `server/src/services/pty.ts:52-62` (`markerOnset`), `:305-312` (`toSessionInfo`)
- Test: `server/test/pty.test.ts`, `server/test/terminal.route.test.ts:314-332`

**Interfaces:**
- Consumes: `Pane.activityAt` (Task 2)
- Produces: `export const decisionOnset(file: string, activityAt: number): string | undefined` —
  ISO 8601 dari `max(onset epoch di marker, activityAt)`; `undefined` bila keduanya nihil.

- [x] **Step 1: Write the failing test**

Tambahkan `decisionOnset` ke import `../src/services/pty` di `server/test/pty.test.ts`, lalu
tambahkan test murni sesudah test `paneQuiet` (Task 1):

```ts
  // SPEC-903 · ADR-0143 · satu episode marker bisa memuat beberapa episode menunggu (dijawab di TUI
  // → agen bekerja 20 menit → diam lagi). Onset di marker hanya menandai yang PERTAMA; kalau ia
  // dipakai apa adanya, PET_URGENT_MS (10 menit) menjerit untuk tunggu yang baru berumur semenit.
  it("decisionOnset memakai yang lebih baru antara onset marker dan aktivitas pane (SPEC-903)", () => {
    const f = join(repoDir, "marker-onset");
    const older = 1_755_840_000;   // 2025-08-22
    const newer = 1_787_400_000;   // 2026-08-22

    writeFileSync(f, `${older}\n`);
    expect(decisionOnset(f, newer)).toBe(new Date(newer * 1000).toISOString());
    expect(decisionOnset(f, NaN)).toBe(new Date(older * 1000).toISOString());

    writeFileSync(f, `${newer}\n`);
    expect(decisionOnset(f, older)).toBe(new Date(newer * 1000).toISOString());

    // Marker pra-ADR-0141 (isi `waiting`) tak bisa diparse; aktivitas pane tetap memberi jawaban.
    writeFileSync(f, "waiting\n");
    expect(decisionOnset(f, newer)).toBe(new Date(newer * 1000).toISOString());
    expect(decisionOnset(f, NaN)).toBeUndefined();

    expect(decisionOnset(join(repoDir, "marker-tak-ada"), NaN)).toBeUndefined();
  });
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "decisionOnset"
```

Expected: FAIL — `decisionOnset is not a function`.

- [x] **Step 3: Write minimal implementation**

Ganti `markerOnset` di `server/src/services/pty.ts:52-62` dengan pasangan berikut:

```ts
// SPEC-898 · ADR-0141 · isi marker = detik epoch ONSET episode menunggu (ditulis sekali oleh hook,
// lihat runner/src/settings.ts). Marker sesi yang lahir sebelum ADR-0141 berisi "waiting" — tak bisa
// diparse, dan 0 di sana adalah jawaban yang benar: markernya sendiri tak tahu sejak kapan.
const markerOnset = (f: string): number => {
  let raw: string;
  try { raw = readFileSync(f, "utf8"); } catch { return 0; }
  const secs = Number(raw.trim());
  return Number.isInteger(secs) && secs > 0 ? secs : 0;
};

// SPEC-903 · ADR-0143 · awal episode menunggu yang SEDANG berlangsung. Dengan `decision` menjadi
// turunan, satu episode marker bisa memuat beberapa episode menunggu; onset di marker hanya
// menandai yang pertama, dan `decisionAt` yang tetap menunjuk ke sana akan melaporkan "menunggu 20
// menit" untuk tunggu yang baru berumur semenit — PET_URGENT_MS menjerit palsu. Detik terakhir pane
// mengeluarkan sesuatu ADALAH awal episode yang sekarang. `max`, bukan "pakai aktivitas saja",
// supaya kasus langka hook-menembak-sesudah-keluaran-terakhir tetap memberi angka yang lebih benar.
// Berkasnya dibaca HANYA untuk marker yang sudah terbukti terisi, jadi sesi yang tak menunggu
// membayar nol I/O tambahan.
export const decisionOnset = (f: string, activityAt: number): string | undefined => {
  const secs = Math.max(markerOnset(f), activityAt > 0 ? Math.floor(activityAt) : 0);
  return secs > 0 ? new Date(secs * 1000).toISOString() : undefined;
};
```

Lalu di `toSessionInfo` (±baris 305) tambahkan `activityAt` ke destructure dan pakai helper baru:

```ts
const toSessionInfo = ({ id, projectId, specId, flow, cwd, exited, code, branch, decision, agent,
  decisionFile, activityAt }: Pane): SessionInfo => ({
  id, projectId, specId, flow, cwd, exited, branch, decision, agent,
  // Hanya untuk pane mati: `pane_dead_status` kosong pada pane hidup, dan `exitCode: 0` di sana
  // akan terbaca sebagai "sudah berakhir sukses".
  ...(exited ? { exitCode: code } : {}),
  ...(decision && decisionFile ? { decisionAt: decisionOnset(decisionFile, activityAt) } : {}),
});
```

Perbarui juga komentar `SessionInfo.decisionAt` (±baris 87):

```ts
  // SPEC-898 · ADR-0141 · ISO onset episode "menunggu manusia". SPEC-903 · ADR-0143 · onsetnya kini
  // yang lebih baru antara stempel di marker dan keluaran terakhir pane — awal episode yang SEDANG
  // berlangsung, bukan episode marker yang bisa jauh lebih tua. Ada HANYA saat `decision` true.
  decisionAt?: string;
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts -t "decisionOnset"
```

Expected: PASS.

- [x] **Step 5: Perbarui test integrasi `decisionAt` yang artinya berubah**

Ganti test `"listSessions memberi decisionAt dari epoch di marker; teks lama diabaikan"` di
`server/test/pty.test.ts:669-683` dengan:

```ts
  // SPEC-898 · ADR-0141 · umur "menunggu" datang dari ISI marker, bukan mtime-nya.
  // SPEC-903 · ADR-0143 · dan sejak `decision` jadi turunan, dari yang LEBIH BARU antara isi marker
  // dan keluaran terakhir pane — kalau tidak, tunggu yang baru dimulai dilaporkan setua markernya.
  it("listSessions memberi decisionAt dari episode yang sedang berlangsung",
    { timeout: 20_000 }, async () => {
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-at");
    const bornMs = Date.now();
    const s = createSession("p1", repoDir, { decisionFile, command: ["/bin/sleep", "300"] });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    try {
      expect(find().decisionAt).toBeUndefined();          // marker kosong

      writeFileSync(decisionFile, "1755840000\n");        // onset jauh lebih tua dari pane ini
      await waitFor(() => find().decision === true, 15_000);
      const at = Date.parse(find().decisionAt!);
      expect(at).toBeGreaterThan(1755840000_000);
      expect(at).toBeGreaterThanOrEqual(bornMs - 2_000);
      expect(at).toBeLessThanOrEqual(Date.now());

      writeFileSync(decisionFile, "waiting\n");           // marker sesi pra-ADR-0141
      expect(find().decision).toBe(true);
      expect(Date.parse(find().decisionAt!)).toBeGreaterThanOrEqual(bornMs - 2_000);
    } finally {
      killSession(s.id);
    }
  });
```

- [x] **Step 6: Perbarui test route `decisionAt`**

Ganti isi test `"GET /terminal/sessions meneruskan decisionAt"` di
`server/test/terminal.route.test.ts:314-332` dengan:

```ts
  it("GET /terminal/sessions meneruskan decisionAt", { timeout: 20_000 }, async () => {
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-route-at");
    // Perintah mentah, bukan agen: `decisionAt` hanya lahir untuk pane HIDUP, dan biner claude
    // yang diwariskan test tetangga bisa mati seketika (`decision` false → kolomnya absen).
    const bornMs = Date.now();
    const s = createSessionSvc("p1", repoDir, {
      id: "spec-route-at", decisionFile, command: ["/bin/sleep", "30"],
    });
    try {
      writeFileSync(decisionFile, "1755840000\n");
      // SPEC-903 · pil menyala hanya setelah pane terbukti diam (PANE_QUIET_MS); pane mentah
      // mematok `#{window_activity}` pada waktu lahirnya.
      await new Promise((r) => setTimeout(r, PANE_QUIET_MS + 750));
      const res = await app.inject({ method: "GET", url: "/api/terminal/sessions" });
      expect(res.statusCode).toBe(200);
      const row = (res.json() as { id: string; decision: boolean; decisionAt?: string }[])
        .find((x) => x.id === s.id)!;
      expect(row.decision).toBe(true);
      // SPEC-903 · ADR-0143 · yang menyeberang adalah awal episode yang sedang berlangsung, bukan
      // onset marker yang lebih tua.
      expect(Date.parse(row.decisionAt!)).toBeGreaterThan(1755840000_000);
      expect(Date.parse(row.decisionAt!)).toBeGreaterThanOrEqual(bornMs - 2_000);
    } finally {
      killSession(s.id);
    }
  });
```

Tambahkan `PANE_QUIET_MS` ke import dari `../src/services/pty` di berkas test itu.

- [x] **Step 7: Run tests to verify they pass**

```bash
pnpm vitest --run --no-file-parallelism server/test/pty.test.ts server/test/terminal.route.test.ts
```

Expected: PASS semuanya.

- [x] **Step 8: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts server/test/terminal.route.test.ts
git commit -m "feat(pty): decisionAt menunjuk episode menunggu yang sedang berlangsung (SPEC-903)"
```

---

## Task 4: satu arti untuk notifikasi & panel lead

**Files:**
- Modify: `server/src/services/pty.ts:319-323` (`liveDecisions`),
  `server/src/services/notifications.ts:148-173` (`DecisionSession`, `scanDecisions`),
  `server/src/routes/lead.ts:5,44`
- Test: `server/test/notifications.test.ts`

**Interfaces:**
- Consumes: `Pane.decision` turunan (Task 2)
- Produces: `liveDecisions(): { id: string; specId?: string; projectId: string; decisionFile: string;
  waiting: boolean }[]` — `waiting` adalah `Pane.decision` yang sama;
  `DecisionSession` di `notifications.ts` bertambah `waiting: boolean`

- [x] **Step 1: Write the failing test**

Di `server/test/notifications.test.ts`, tambahkan `waiting: true` ke tiga stub yang sudah ada
(baris 81, 92, 101 — bentuk `{ id: …, specId: …, projectId: …, decisionFile: f }`), lalu tambahkan
dua test baru di dalam `describe("scanDecisions")`:

```ts
  // SPEC-903 · ADR-0143 · marker codex dipasang di TIAP akhir turn, jadi sesi yang melanjutkan
  // sendiri hari ini menotifikasi "menunggu keputusan" berulang kali tanpa ada yang ditanyakan.
  it("tak menotifikasi selama agen masih bekerja, lalu satu kali saat benar-benar menunggu", async () => {
    const f = join(dir, "m-903");
    writeFileSync(f, "1787400000\n");
    const row = (waiting: boolean) =>
      [{ id: "s903", specId: undefined, projectId: "p1", decisionFile: f, waiting }];
    await scanDecisions(() => row(false));
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(0);
    await scanDecisions(() => row(true));
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(1);
  });

  // Manusia yang mengetik jawabannya membuat pane berisik sebentar-sebentar. Dedup karena itu tetap
  // dikunci pada MARKER, bukan pada bit turunan — kalau tidak tiap kedipan melahirkan notif kedua.
  it("kedipan sibuk di tengah satu episode marker tak melahirkan notifikasi kedua", async () => {
    const f = join(dir, "m-903-kedip");
    writeFileSync(f, "1787400000\n");
    const row = (waiting: boolean) =>
      [{ id: "s903b", specId: undefined, projectId: "p1", decisionFile: f, waiting }];
    await scanDecisions(() => row(true));
    await scanDecisions(() => row(false));
    await scanDecisions(() => row(true));
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(1);
  });
```

> Catatan untuk pelaksana: `dir` dan `prisma` sudah tersedia di berkas test itu — pakai nama yang
> sama dengan test tetangga di `describe("scanDecisions")`. Bila nama variabel direktori temporernya
> berbeda, ikuti yang ada di berkas, jangan membuat yang baru.

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run --no-file-parallelism server/test/notifications.test.ts -t "scanDecisions"
```

Expected: FAIL — test pertama mendapat 1 notifikasi (bukan 0), karena `waiting` belum dipakai.

- [x] **Step 3: Write minimal implementation**

3a. `server/src/services/pty.ts:319-323`:

```ts
// SPEC-184 · sesi hidup yang punya marker keputusan — masukan scanDecisions().
// SPEC-903 · ADR-0143 · `waiting` adalah bit turunan yang SAMA dengan `SessionInfo.decision`, supaya
// notifikasi dan panel lead tak punya rumus sendiri yang bisa berselisih dengan pil di layar.
export const liveDecisions = (): {
  id: string; specId?: string; projectId: string; decisionFile: string; waiting: boolean;
}[] =>
  listPanes()
    .filter((p) => !p.exited && p.decisionFile)
    .map((p) => ({
      id: p.id, specId: p.specId, projectId: p.projectId, decisionFile: p.decisionFile!,
      waiting: p.decision,
    }));
```

3b. `server/src/services/notifications.ts:148` — tipe:

```ts
type DecisionSession = {
  id: string; specId?: string; projectId: string; decisionFile: string; waiting: boolean;
};
```

3c. `server/src/services/notifications.ts:158-166` — badan loop:

```ts
export async function scanDecisions(read: () => DecisionSession[] = liveDecisions): Promise<void> {
  const next = new Set<string>();
  const fresh: DecisionSession[] = [];
  for (const s of read()) {
    if (!markerFilled(s.decisionFile)) continue;
    // SPEC-903 · ADR-0143 · dua peran dipisah. KAPAN menotifikasi memakai bit turunan: marker codex
    // dipasang di tiap akhir turn, jadi sesi yang melanjutkan sendiri tak boleh menotifikasi.
    // BERAPA KALI tetap dikunci pada marker terisi: manusia yang mengetik jawabannya membuat pane
    // berisik sebentar-sebentar, dan tiap kedipan akan melahirkan notifikasi kedua untuk pertanyaan
    // yang sama. Id keluar dari set hanya saat markernya kosong atau sesinya hilang.
    if (awaiting.has(s.id)) { next.add(s.id); continue; }
    if (!s.waiting) continue;
    next.add(s.id);
    fresh.push(s);
  }
  awaiting = next;
```

(sisa fungsi — blok `for (const s of fresh)` — tak berubah)

3d. `server/src/routes/lead.ts` — baris 5 dan 44:

```ts
import { listSessions, liveDecisions, sendToPane } from "../services/pty";
```

```ts
    try { waiting = liveDecisions().filter((d) => d.waiting).map((d) => d.id); }
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest --run --no-file-parallelism server/test/notifications.test.ts
```

Expected: PASS semuanya.

- [x] **Step 5: Typecheck paket server**

```bash
pnpm --filter ./server typecheck
```

Expected: nol error. (`DetectDeps.live` di `lead/detect.ts` bertipe struktural yang lebih sempit,
jadi bentuk baru `liveDecisions()` tetap cocok tanpa perubahan di sana.)

- [x] **Step 6: Commit**

```bash
git add server/src/services/pty.ts server/src/services/notifications.ts server/src/routes/lead.ts server/test/notifications.test.ts
git commit -m "feat(decision): notifikasi & panel lead memakai bit menunggu turunan (SPEC-903)"
```

---

## Task 5: jawaban dialog mengosongkan marker

**Files:**
- Modify: `server/src/services/pty.ts` (ekspor `clearMarker`, sesudah `markerFilled`),
  `server/src/routes/terminal.ts:365-384`, `server/src/services/lead/detect.ts:1,188`
- Test: `server/test/terminal-dialog.route.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `export const clearMarker(f: string): void` di `server/src/services/pty.ts`

- [x] **Step 1: Write the failing test**

Tambahkan di `server/test/terminal-dialog.route.test.ts`, di dalam
`describe("SPEC-899 · POST /terminal/sessions/:id/dialog/answer")` (atau sebagai `describe` sendiri
di ujung berkas):

```ts
describe("SPEC-903 · jawaban yang mendarat mengosongkan marker keputusan", () => {
  it("marker dikosongkan sesudah 202", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-903-"));
    const decisionFile = join(dir, "spec-903");
    writeFileSync(decisionFile, "1787400000\n");
    const s = createSession("p903", "/tmp", { decisionFile, command: ["/bin/cat"] });
    try {
      const r = await app.inject({
        method: "POST", url: `/api/terminal/sessions/${s.id}/dialog/answer`,
        payload: { screenHash: screenHashOf(SINGLE), choice: 1 },
      });
      expect(r.statusCode).toBe(202);
      expect(readFileSync(decisionFile, "utf8")).toBe("");
    } finally {
      killSession(s.id);
    }
  });
});
```

Tambahkan import yang dibutuhkan di kepala berkas test:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

> Catatan untuk pelaksana: bentuk `payload` harus sama dengan yang dipakai test `answer` yang sudah
> ada di berkas itu (skema `zSessionDialogAnswer`). Salin bentuknya dari test tetangga yang
> menghasilkan `202`, jangan menebak nama fieldnya.

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run --no-file-parallelism server/test/terminal-dialog.route.test.ts -t "SPEC-903"
```

Expected: FAIL — `expected '1787400000\n' to be ''`.

- [x] **Step 3: Write minimal implementation**

3a. `server/src/services/pty.ts`, tepat sesudah `markerFilled` (±baris 49):

```ts
// SPEC-903 · ADR-0143 · dua penulis marker dari sisi server, dan hanya dua: rantai lead yang tuntas
// (SPEC-452) dan jawaban dialog yang mendarat lewat route (SPEC-899). Keduanya bukti POSITIF manusia
// sudah menjawab — kembaran `UserPromptSubmit` untuk jalur yang tak pernah dilihat hook agen.
// Heuristik "pane sedang sibuk" TIDAK boleh memanggil ini: hook Notification claude mengisi marker
// sekali per dialog dan tak pernah menembak lagi, jadi menghapusnya di tengah dialog yang masih
// terbuka menghilangkan pertanyaan itu permanen.
export const clearMarker = (f: string): void => {
  try { writeFileSync(f, ""); } catch { /* marker lenyap = sudah kosong */ }
};
```

3b. `server/src/routes/terminal.ts` — tambahkan `clearMarker` ke import dari `../services/pty`, lalu
di handler `dialog/answer` (±baris 380), sesudah pengecekan `r.ok`:

```ts
      const r = await answerSessionDialog(sessionPaneIO(id), parsed.data);
      if (!r.ok) return reply.code(409).send({ error: DIALOG_ANSWER_ERROR[r.reason], reason: r.reason });
      // SPEC-903 · jawaban dialog adalah tool result, bukan prompt, jadi hook pengosong marker
      // (`UserPromptSubmit`, SPEC-184) tak pernah menembak untuk jalur ini. Tanpa baris ini pil
      // "Menunggu keputusan" hanya padam saat pane kebetulan diam ≥ PANE_QUIET_MS.
      if (s.decisionFile) clearMarker(s.decisionFile);
      return reply.code(202).send({ accepted: true });
```

3c. `server/src/services/lead/detect.ts` — pakai definisi yang sama, jangan definisi kedua:

- baris 1: hapus `import { writeFileSync } from "node:fs";` bila tak ada pemakai lain di berkas itu
  (periksa dengan `grep -n writeFileSync server/src/services/lead/detect.ts`)
- baris 4: tambahkan `clearMarker` ke import dari `../pty`
- baris 188: `clearMarker: (file) => { try { writeFileSync(file, ""); } catch { … } },` menjadi
  `clearMarker,`

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run --no-file-parallelism server/test/terminal-dialog.route.test.ts
```

Expected: PASS semuanya.

- [x] **Step 5: Test lead tetap hijau (jalur `clearMarker` yang di-de-dup)**

```bash
pnpm vitest --run --no-file-parallelism server/test/lead-detect.test.ts
pnpm --filter ./server typecheck
```

Expected: PASS, nol error typecheck.

- [x] **Step 6: Commit**

```bash
git add server/src/services/pty.ts server/src/routes/terminal.ts server/src/services/lead/detect.ts server/test/terminal-dialog.route.test.ts
git commit -m "feat(dialog): jawaban lewat route mengosongkan marker keputusan (SPEC-903)"
```

---

## Task 6: ADR-0143 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0143-menunggu-keputusan-keadaan-turunan.md`
- Modify: `internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md` (catatan amandemen),
  `internal/docs/adr/README.md`, `internal/docs/README.md`,
  `internal/docs/architecture/api-contract.md`, `internal/docs/frontend/frontend-implementation.md`

**Interfaces:**
- Consumes: seluruh perubahan Task 1–5
- Produces: doc-of-record

- [x] **Step 1: Periksa nomor ADR belum diambil sesi tetangga**

```bash
ls internal/docs/adr | tail -5
git log --oneline -20 --all -- internal/docs/adr | head
```

Expected: `0142-…` adalah yang terakhir → pakai `0143`. Bila `0143` sudah ada (sesi lain), pakai
nomor bebas berikutnya dan **perbarui semua rujukan `ADR-0143` di kode & docs** yang ditulis Task
1–5 (`grep -rn "ADR-0143" server/src docs internal/docs`).

- [x] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0143-menunggu-keputusan-keadaan-turunan.md` mengikuti bentuk ADR tetangga
(`internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md` sebagai contoh bentuk). Isinya wajib
memuat, dengan angka apa adanya dari audit:

1. **Konteks** — marker adalah latch: dipasang hook `Notification` (claude) / `Stop` (codex),
   dilepas hanya `UserPromptSubmit` + rantai lead. Empat jalur keluar tetap terbuka: dialog dijawab
   di TUI, route `dialog/answer` (SPEC-899), Esc, codex melanjutkan sendiri. Terukur 2026-08-22:
   dua pane memutar `✢ Creating… (28m 3s)` / `✶ Manifesting… (25m 12s)` dengan marker terisi.
2. **Keputusan** — `decision = !exited && markerFilled && paneQuiet(#{window_activity})`,
   `PANE_QUIET_MS = 3000`, fail-open, `decisionAt = ISO(max(onset marker, window_activity))`,
   `liveDecisions().waiting` sebagai satu-satunya sumber untuk notifikasi & panel lead.
3. **Bukti** — pemisahan terukur 0 dtk vs 317 dtk (22 sampel 1 Hz); `window_activity` berdetak tanpa
   klien tmux terpasang; biaya format +0,21 ms/panggilan untuk dua variabel atas empat pane.
4. **Alternatif yang ditolak** — (a) gerbang berbasis isi pane lewat `#{C/ri:}` (tersedia di tmux
   3.7b, tapi lebar pane 52 kolom sudah memotong `esc to interrupt`, bentuknya kontrak tampilan
   agen, dan footer dialog yang masih terlihat sesudah dijawab justru menahan pil menyala);
   (b) mengosongkan marker saat pane terbaca sibuk (menghilangkan pertanyaan permanen — `Notification`
   mengisi marker sekali per dialog, terukur 0 B selama 120 dtk); (c) menambal keempat jalur satu
   per satu (daftarnya terbuka).
5. **Konsekuensi** — `decision` jadi bergantung waktu (test-nya butuh jeda nyata; dicatat supaya
   yang berikutnya tak membacanya sebagai flake); `decisionAt` marker pra-ADR-0141 kini terisi;
   manusia yang mengetik di pane yang menunggu me-reset "menunggu sejak" (disengaja); pane berisik
   yang sebenarnya menunggu (keluaran tugas latar belakang) memadamkan pil sampai berhenti —
   notifikasi `decision` untuk episode itu sudah lahir lebih dulu.
6. **Batas** — pintu deteksi lead (`lead/detect.ts`) tetap memakai gerbang isinya sendiri
   (`AGENT_TURN_LINE`, SPEC-487, pemisahan 6/6 vs 0/16); prioritas `deciding` (ADR-0091) dan gerbang
   `finished`/`complete` (SPEC-433) tetap berlaku di atas bit ini; skema/DTO/sync tak tersentuh.

- [x] **Step 3: Amandemen ADR-0141**

Tambahkan satu blok "Amandemen 2026-08-22 (SPEC-903, ADR-0143)" di
`internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md`: isi marker tetap "epoch onset,
ditulis sekali" — yang berubah hanya turunannya, `decisionAt = max(onset, window_activity)`, karena
satu episode marker kini bisa memuat beberapa episode menunggu.

- [x] **Step 4: Perbarui api-contract & frontend docs**

- `internal/docs/architecture/api-contract.md` — pada deskripsi `GET /terminal/sessions`: `decision`
  bukan lagi "marker keputusan terisi" melainkan "marker terisi DAN pane diam ≥ 3 dtk (ADR-0143)";
  `decisionAt` = awal episode yang sedang berlangsung.
- `internal/docs/frontend/frontend-implementation.md` — kosakata status sesi: `awaiting` tetap
  `!exited && decision`, tetapi `decision` kini keadaan turunan; tegaskan bahwa `TerminalScreen` dan
  `pet-state` **tidak boleh** menambah predikat sendiri di atasnya.

- [x] **Step 5: Tautkan di index**

```bash
grep -n "0142" internal/docs/adr/README.md internal/docs/README.md
```

Tambahkan baris `0143` di kedua index mengikuti bentuk baris `0142` yang sudah ada, lalu:

```bash
node dist/cli.js docs index --check 2>/dev/null || pnpm --filter ./runner exec tsx src/cli.ts docs index --check
```

Bila perintah CLI tak tersedia di worktree ini, cukup pastikan kedua index memuat baris `0143` dan
path-nya benar (`ls internal/docs/adr/0143-*`).

- [x] **Step 6: Commit**

```bash
git add internal/docs
git commit -m "docs(decision): ADR-0143 menunggu keputusan sebagai keadaan turunan (SPEC-903)"
```

---

## Task 7: verifikasi akhir & smoke endpoint

**Files:** —

**Interfaces:**
- Consumes: Task 1–6

- [x] **Step 1: Jalankan seluruh test yang tersentuh perubahan, serial, DB terisolasi**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
pnpm vitest --run --no-file-parallelism \
  server/test/pty.test.ts \
  server/test/notifications.test.ts \
  server/test/terminal.route.test.ts \
  server/test/terminal-dialog.route.test.ts \
  server/test/lead-detect.test.ts
```

Expected: semua PASS. Nol test berjalan = **bukan** hijau — periksa jumlah test yang dilaporkan.

- [x] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./server typecheck
```

Expected: nol error. (`pnpm -r typecheck` **jangan** dijalankan — mesin ini menjalankan beberapa sesi.)

- [x] **Step 3: Smoke endpoint nyata sekali di akhir**

Task ini menyentuh dua endpoint (`GET /api/terminal/sessions`, `POST
/api/terminal/sessions/:id/dialog/answer`), jadi satu smoke nyata wajib. Boot server dengan
`HANOMAN_HOME` terisolasi (jangan menulis ke `~/.hanoman`) dan socket tmux sendiri:

```bash
export HANOMAN_HOME="$(mktemp -d)"
export HANOMAN_TMUX_SOCKET="hanoman-smoke-903"
export DATABASE_URL="file:$HANOMAN_HOME/hanoman.db"
pnpm --filter ./server exec prisma migrate deploy
# jalankan server di latar (catat PID-nya, bunuh per-PID di akhir — JANGAN pkill -f)
```

Lalu, dengan sebuah sesi ber-`decisionFile` yang panenya berisik lalu diam, buktikan dua hal lewat
`curl` pada `GET /api/terminal/sessions`:

1. selagi pane bicara + marker terisi → `decision: false`
2. sesudah pane diam > 3 dtk → `decision: true` dan `decisionAt` mendekati sekarang

Catat keluaran `curl` apa adanya di `docs/superpowers/plans/…` (blok hasil di ujung plan ini) atau di
badan commit. Bereskan: `kill <pid>`, `tmux -L hanoman-smoke-903 kill-server`.

- [ ] **Step 4: Sapu blast radius**

```bash
grep -rn "markerFilled" server/src src | grep -v node_modules
grep -rn "\.decision\b" src/src | grep -v node_modules
```

Expected: setiap pemakai `markerFilled` yang menyatakan "sesi ini menunggu" sudah memakai bit
turunan (pty `parsePanes`, `notifications.scanDecisions` sebagai penjaga episode marker,
`lead/detect.ts` yang sengaja dibiarkan); setiap pembaca `.decision` di frontend tak menambah
predikat sendiri.

- [ ] **Step 5: Commit sisa & push**

```bash
git status --porcelain
git add -A && git commit -m "chore(spec-903): hasil smoke + sapu blast radius"
git push origin HEAD:refs/heads/hanoman/spec-903
```

---

## Self-Review

**Spec coverage:**

| spec | task |
|---|---|
| §3.1 `decision` turunan | Task 2 |
| §3.2 sumber `#{window_activity}` di `FMT` | Task 2 Step 3a |
| §3.3 `PANE_QUIET_MS = 3000` | Task 1 |
| §3.4 fail-open | Task 1 (`!(activityAt > 0)`) |
| §3.5 marker tetap durable + penghapus baru hanya route | Task 5 |
| §3.6 `decisionAt = max(onset, activity)` | Task 3 |
| §3.7 satu sumber untuk empat permukaan | Task 4 |
| §3.8 `lead/detect.ts` tak digerbangi | Task 5 Step 3c (hanya de-dup `clearMarker`) |
| §5.1 kontrak pty | Task 1, 2, 3, 4, 5 |
| §5.2 `scanDecisions` | Task 4 |
| §5.3 panel lead | Task 4 |
| §5.4 route `dialog/answer` | Task 5 |
| §6 frontend nihil | tak ada task — disengaja, dicatat di Global Constraints |
| §7 test | Task 1–5, dijalankan bersama di Task 7 |
| §9 docs | Task 6 |

---

## Hasil verifikasi (2026-08-22)

### Test

`TEST_DATABASE_URL` terisolasi, `--no-file-parallelism`, socket tmux `hanoman-t903`, dan env sesi
agen dibersihkan (`SSH_ASKPASS`, `HANOMAN_CONTROL_ORIGINS`, `DATABASE_URL` — ketiganya mencemari
suite ini; lihat catatan gagal palsu di bawah).

| berkas | hasil |
|---|---|
| `server/test/pty.test.ts` | 65/65 lulus (termasuk 3 test SPEC-903 baru) |
| `server/test/notifications.test.ts` | 12/12 lulus (2 test SPEC-903 baru) |
| `server/test/terminal-dialog.route.test.ts` | 10/10 lulus (1 test SPEC-903 baru) |
| `server/test/lead-detect.test.ts` | 50/50 lulus |
| `server/test/terminal.route.test.ts` | 60 lulus, **21 gagal — IDENTIK di base** |
| `pnpm --filter ./server typecheck` | nol error |

**Gagal palsu yang sudah dibuktikan, bukan regresi:**

- `server/test/terminal.route.test.ts`: 21 gagal. Diperiksa dengan `git checkout 5fe3c6ff -- server/src
  server/test`, jalankan, lalu pulihkan: **21 gagal / 60 lulus di base juga**, dan daftar nama test
  yang gagal `diff`-nya KOSONG (identik). Sebagian besar test WS/resize/socket. Test SPEC-903 di
  berkas itu (`GET /terminal/sessions meneruskan decisionAt`) LULUS.
- `pty.test.ts` `"sesi agen lahir tanpa jalan meminta ketikan kredensial"`: gagal hanya bila
  `SSH_ASKPASS` ada di env sesi agen (SPEC-881). Dengan `env -u SSH_ASKPASS …` → lulus.
- Seluruh route 404 bila `HANOMAN_CONTROL_ORIGINS` diwarisi dari shell operator.

### Smoke endpoint nyata

Server sungguhan (`tsx server/src/server.ts`) di `127.0.0.1:8913`, `HANOMAN_HOME` & DB terisolasi,
socket tmux `hanoman-smoke903`, akun dibuat lewat `POST /api/auth/setup`.

**1. Gerbang turunan — `GET /api/terminal/sessions`** (pane berisik 12 dtk lalu diam, marker terisi
11 B sejak T+0):

```
marker=1787416293 (11 B)
T+0s   [{"id":"smk1",…,"exited":false,"decision":false,"agent":"claude"}]
T+5s   [{"id":"smk1",…,"exited":false,"decision":false,"agent":"claude"}]
T+17s  [{"id":"smk1",…,"decision":true,…,"decisionAt":"2026-08-22T16:31:46.000Z"}]

now=2026-08-22T16:31:56Z  marker_onset=1787416293 (16:31:33Z)  window_activity=1787416306 (16:31:46Z)
```

`decisionAt` = `max(onset, window_activity)` = `window_activity` — persis kontrak ADR-0143 §6, dan
13 detik lebih muda dari onset marker.

**2. Jalur (b) — jawaban dialog mengosongkan marker.** Pane menjalankan emulator widget
`AskUserQuestion` (kolom bebas di baris 3, digit memfokuskannya, Enter mengirim), dijawab lewat HTTP:

```
GET  /api/terminal/sessions/smk3/dialog
  → {"dialog":{"title":"Warna apa yang dipakai?","freeIndex":3,
     "options":[{"n":1,"label":"merah"},{"n":2,"label":"biru"}]},"screenHash":"48dcef803f59e5c1"}

sebelum: marker [1787416395] (11 B) · decision true · decisionAt 2026-08-22T16:33:15.000Z
POST /api/terminal/sessions/smk3/dialog/answer {"screenHash":"48dcef803f59e5c1","choice":1}
  → {"accepted":true}
layar pane: "jawaban diterima: merah / kerja lagi..."
sesudah: marker [] (0 B) · decision false · decisionAt absen
```

Bonus bukti negatif: pada pane yang layarnya TIDAK bergerak, jawaban dijawab
`409 not-landed` dan marker **tidak** disentuh — pengosongan marker memang hanya menempel pada 202.

**3. Bug aslinya, diperiksa ulang pada sesi kerja yang sungguhan.** Predikat baru dievaluasi apa
adanya terhadap pane hidup di socket `hanoman` (tanpa menyentuh apa pun milik sesi tetangga):

```
hanoman-12addc68                        umur=  1s BEKERJA  marker=-
hanoman-spec-902                        umur=  1s BEKERJA  marker=terisi   ← persis kasus laporan
hanoman-spec-903                        umur=  0s BEKERJA  marker=kosong
hanoman-spec-904                        umur=  1s BEKERJA  marker=kosong
hanoman-vpsc-cms97gza2009im8avgbkal31n  umur=  0s BEKERJA  marker=-
```

`hanoman-spec-902` adalah sesi claude yang **sedang bekerja** dengan marker **terisi** — hari ini ia
menyalakan pil "Menunggu keputusan"; dengan gerbang SPEC-903 umurnya 1 dtk → `decision: false`.
