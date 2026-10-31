# Fase Mockup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Tiap task satu kotak `- [ ]`.

**Goal:** Fase `Mockup` opsional di flow feature & qa yang menghasilkan PNG mockup lewat `image_gen`
(codex) / skill `codex-image` milik hanoman (runtime lain). Mockup disetujui lead/manusia sesudah dilihat
di dashboard dengan zoom/pan.

**Architecture:** Fase baru di `FLOW_PHASES` dengan skip implisit untuk sesi lama. Panduan fase sama di
mode sesi tunggal dan agen fase. Skill dibundel di `server/skills/` → paket npm → di-seed ke
`$HANOMAN_HOME/skills` → disuntik per sesi. Server membaca `docs/mockups/<spec-id>/` dari worktree sesi.
Frontend menambah `ImageViewer` (zoom/pan) dan galeri di tiga titik masuk.

**Tech Stack:** TypeScript strict, Fastify, React+Vite, vitest. Tanpa pustaka baru.

**Spec:** [`docs/superpowers/specs/2026-10-31-fase-mockup-design.md`](../specs/2026-10-31-fase-mockup-design.md).

## Global Constraints

- Tanpa perubahan skema Prisma / migration. Tanpa nilai stage baru.
- Prompt tetap netral-agen (ADR-0074): satu nama skill `codex-image` untuk semua runtime.
- Setiap API baru punya keputusan MCP di commit yang sama (ADR-0202, AGENTS #7).
- Docs yang tersentuh diperbarui di commit yang sama + ter-link di `internal/docs/README.md`.
- UI mengikuti `internal/docs/design-system/**` (bone paper, brass). Tanpa polling HTTP (ADR-0039).
- Lokasi mockup: `docs/mockups/<spec-id huruf kecil>/<NN>-<slug>.png`, maks 6 gambar, desktop `1536x1024`,
  mobile `1024x1536`.
- Nama fase persis `Mockup`. Nama agen fase `hanoman-fase-mockup`. Konstanta skill `MOCKUP_SKILL = "codex-image"`.
- **Perintah test per task** (env sesi hanoman wajib dilepas, DB terisolasi; shell zsh + hook rtk):

  ```bash
  /usr/bin/env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u HANOMAN_SESSION_ID \
    -u HANOMAN_EVENT_URL -u HANOMAN_EVENT_TOKEN -u HANOMAN_EVENT_DIR -u HANOMAN_EVENT_HOST -u SSH_ASKPASS \
    TEST_DATABASE_URL=file:/private/tmp/fase-mockup-t.test.db \
    pnpm vitest --run <path-test…> --no-file-parallelism
  ```

  Typecheck hanya paket yang tersentuh (`pnpm --filter ./server typecheck`, `./shared`, `./runner`, `./src`).
  Jangan `git add -A`: boot/test server meninggalkan `hanoman-dev.db-shm/-wal`.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/orchestration.ts` | `FLOW_PHASES` + `OPTIONAL_PHASES` |
| `shared/src/runtime-defaults.ts` | sel default Mockup, versi seed |
| `server/src/services/session-phases.ts` | skip implisit fase opsional |
| `shared/src/method-catalog.ts` | `MOCKUP_SKILL`, `phaseSkills.Mockup` |
| `runner/src/prompt.ts`, `runner/src/phase-agents.ts` | panduan fase Mockup + jalur cepat |
| `server/skills/codex-image/**` (baru) | skill bundel |
| `server/src/services/bundled-skills.ts` (baru) | lokasi bundel + seed ke `$HANOMAN_HOME/skills` |
| `server/src/services/skill-inject.ts` | lewati bundel bila runtime sudah punya |
| `server/src/services/spec-mockups.ts` (baru) | resolusi folder, daftar, baca aman |
| `server/src/routes/specs.ts` | dua rute mockup |
| `src/src/ds/ImageViewer.tsx` (baru) | overlay zoom/pan/navigasi |
| `src/src/screens/MockupGallery.tsx` (baru) | muat daftar saat dibuka + thumbnail + viewer |

---

### Task 1: Fase `Mockup` di pipeline + skip implisit + default orkestrasi + ADR

- [ ] Fase Mockup masuk pipeline feature/qa dan sesi lama tak tersandera.

**Files:** `shared/src/orchestration.ts`, `server/src/services/session-phases.ts`, `shared/src/runtime-defaults.ts`,
`internal/docs/adr/0233-fase-mockup.md` (baru), `internal/docs/README.md`, `internal/docs/architecture/stack.md`.
**Test:** `shared/src/orchestration.test.ts`, `server/test/session-phases.test.ts`,
`server/src/services/runtime-defaults.test.ts`.

**Interfaces — Produces:**

```ts
// shared/src/orchestration.ts
export const MOCKUP_PHASE = "Mockup";
/** ADR-0233 · fase yang belum tercatat dibaca `skipped` bila fase sesudahnya sudah tercatat. */
export const OPTIONAL_PHASES: ReadonlySet<string>; // = new Set([MOCKUP_PHASE])
```

- `FLOW_PHASES.feature = [Brainstorm, Objective, Spec, Mockup, Plan, Execute, Review]`,
  `FLOW_PHASES.qa = [Audit, Spec, Mockup, Plan, Execute, Review]` (AC-1).
- `derivePhases`: fase di `OPTIONAL_PHASES` tanpa catatan **dan** ada fase sesudahnya yang tercatat →
  `{ state: "skipped" }`. Fase `active` = fase pertama yang belum tercatat **dan** bukan skip implisit (AC-2).
  `REACHED` tak diberi kunci Mockup (AC-3).
- `BUILTIN_ORCHESTRATION_DEFAULTS` feature & qa: `Mockup` claude `sonnet·medium`, codex
  `gpt-5.6-terra·medium` (antigravity otomatis `inherit`). `RUNTIME_DEFAULTS_VERSION = "2026-10-31-v1"`.
  Pelestarian sel operator sudah generik (`server/src/services/runtime-defaults.ts:111`); tambahkan test-nya
  untuk sel `Mockup`.
- ADR-0233 (Status aktif, 2026-10-31): keputusan 1–6 spec, aturan fase opsional, MCP, konsekuensi (golden
  berubah, PNG di git). Link di README index (bagian ADR) dan `stack.md` (daftar fase).
- Test: urutan fase feature/qa dan flow lain identik; `[Spec done, Plan done]` → Mockup `skipped`, Execute
  `active`; `[Spec done]` → Mockup `active`; `stageFor` dengan `Mockup done` saja tetap `spec-ready`;
  `phasesComplete` benar untuk berkas lama tanpa Mockup yang sudah `Review done`; seed menambah sel Mockup dan
  mempertahankan sel Mockup yang diisi operator sebelum marker.

### Task 2: Panduan fase Mockup di prompt + skill fase + jalur cepat

- [ ] Agen tahu cara mengerjakan, melewati, dan meminta persetujuan mockup di kedua mode.

**Files:** `shared/src/method-catalog.ts`, `runner/src/prompt.ts`, `runner/src/phase-agents.ts`,
`runner/test/__golden__/*`.
**Test:** `shared/src/method-catalog.test.ts`, `runner/test/prompt.test.ts`, `runner/test/orchestrator-prompt.test.ts`,
`runner/test/phase-agents.test.ts`, `runner/test/method-phases.test.ts`, `runner/test/prompt-golden.test.ts`.

**Interfaces — Produces:**

```ts
// shared/src/method-catalog.ts
export const MOCKUP_SKILL = "codex-image";
// runner/src/prompt.ts — satu sumber untuk sesi tunggal & agen fase
export const MOCKUP_GUIDE: string;          // langkah 1–6 spec §2
export const mockupFollowUp: { Plan: string; Execute: string; Review: string };
```

- `METHODS.{superpowers,matt,agent-skills}.phaseSkills.Mockup = [MOCKUP_SKILL]` (AC-6). Bukan fase terakhir,
  jadi `exitSkills` tak menempel.
- `MOCKUP_GUIDE` memuat: skip bila tak ada UI berubah/dibuat + satu baris alasan, "ragu → buat"; baca design
  system + kode layar; maks 6 gambar, ukuran, path `docs/mockups/<spec-id>/<NN>-<slug>.png`; muat skill
  `codex-image`; bagian `## Mockup` di dokumen spec; persetujuan dengan path absolut + `Lihat di hanoman:
  Backlog <SPEC-ID> → Mockup` + opsi Setujui/Revisi/Lewati; revisi = spec gambar lengkap + koreksi, timpa
  berkas; lewati = hapus berkas belum-commit; larangan gambar pengganti + tanya `codex login`/lewati bila
  Codex tak tersedia; commit lalu `Mockup done` (AC-5).
- Sesi tunggal: `phaseInstruction` menambahkan `MOCKUP_GUIDE` bila `phases.includes("Mockup")` (pola
  `SELF_REVIEW_CLAUSE`). Persetujuan lewat `ASK_ROUTE`.
- Agen fase: `backlogGuide` case `"Mockup"` → `MOCKUP_GUIDE`, dengan persetujuan diarahkan ke
  `Keputusan terbuka:` (lewat `PHASE_AGENT_AUTONOMY` yang ada). Case Plan/Execute/Review menambah kalimat
  `mockupFollowUp` (berlaku hanya bila `docs/mockups/<spec-id>/` ada). `SELF_REVIEW_CLAUSE` ikut menyebut
  kesesuaian mockup.
- Jalur cepat qa: `auditDecisionInstruction` dan `orchestratorClause` langkah 5 menulis `Spec skipped`,
  `Mockup skipped`, `Plan skipped` (AC-4). Cek kontinuasi audit (`prompt.ts:404-449`) tetap benar.
- Golden: jalankan sekali tanpa `-u` untuk melihat diff, periksa diff hanya memuat Mockup, baru perbarui
  snapshot (`start-feature`, `start-qa-matt`, `continue-feature`, `resume-qa`, hash Antigravity). Catat di
  pesan commit bahwa perubahan golden disengaja (ADR-0233).
- Test: Mockup ada di `phaseSkillsFor` ketiga metode; prompt start-feature memuat `docs/mockups/` + tiga opsi;
  instruksi `hanoman-fase-mockup` memuat `Keputusan terbuka`; jalur cepat memuat tiga baris skipped.

### Task 3: Skill `codex-image` dibundel + seed saat boot

- [ ] hanoman membawa dan memasang skill `codex-image` ke `$HANOMAN_HOME/skills`.

**Files:** `server/skills/codex-image/{SKILL.md,scripts/codex-image.sh,scripts/normalize-set.py,references/sprite-sheets.md}`
(baru, salin dari `~/.claude/skills/codex-image/`), `server/src/services/bundled-skills.ts` (baru),
`server/src/server.ts:118`, `cli/src/release/pack.ts:79`.
**Test:** `server/test/bundled-skills.test.ts` (baru), `cli/test/pack.test.ts`.

**Interfaces — Produces:**

```ts
// server/src/services/bundled-skills.ts
export const BUNDLED_MARKER = ".hanoman-bundled.json"; // { version: string; sha: string }
export function bundledSkillsDir(): string;             // pola scriptPath(): paket `skills/` → repo `server/skills/`
export function bundledSkillNames(): string[];
export function isBundledCopy(dir: string): boolean;    // marker ada (dipakai Task 4)
export function seedBundledSkills(hanomanHome: string, log?: (m: string) => void):
  { seeded: string[]; updated: string[]; kept: string[] };
```

- `SKILL.md`: semua path `~/.claude/skills/codex-image` → `"${HANOMAN_HOME:-$HOME/.hanoman}/skills/codex-image"`.
  Bagian baru **Pilih engine** di atas (runtime punya `image_gen` → skill `imagegen`, jangan `codex exec`;
  salin dari `$CODEX_HOME/generated_images` ke tujuan; selain itu → skrip). Contoh `Use case: ui-mockup` untuk
  fase Mockup (AC-9). Bit eksekusi skrip dipertahankan (`chmod +x`).
- `sha` = sha256 atas daftar (path relatif + isi) berkas skill, urut, tanpa marker. Seed: belum ada → salin +
  marker; ada + marker + sha isi sekarang == sha marker + sha bundel berbeda → timpa; selain itu biarkan +
  log (AC-7). Fail-open: galat apa pun → log, server tetap boot.
- `server.ts`: panggil `seedBundledSkills(resolveHome(), app.log.warn)` di sebelah `installCustomAgents()`.
- `copyPlan`: `{ from: join(repo, "server/skills"), to: "skills", dir: true }`.
- Test (dir sementara sebagai home & bundel tiruan): salin awal + marker; update bila belum diubah; tak
  menimpa bila diubah; tak menimpa tanpa marker; sumber hilang → hasil kosong tanpa throw. `pack.test`:
  `copyPlan` memuat `skills`, dan `SKILL.md` bundel tak memuat `~/.claude/skills`.

### Task 4: Suntik "bila belum punya" + catatan doctor

- [ ] Skill bundel tak menggandakan skill bernama sama yang sudah dimiliki runtime.

**Files:** `server/src/services/skill-inject.ts:52`, `cli/src/commands/doctor.ts`.
**Test:** `server/test/skill-inject.test.ts`, test doctor yang ada (`cli/test/`, cari `doctor`).

- **Consumes:** `isBundledCopy(dir)` (Task 3), `scanGlobalSkills` lapis `user`.
- `injectGlobalSkills`: buang dari `todo` skill yang `isBundledCopy(s.dir)` **dan** punya nama sama di lapis
  user yang `loadedBy` memuat `o.agent` (claude: `.claude`; codex: `.codex`/`.agents`; antigravity:
  `.gemini/antigravity-cli`/`.agents`). Skill global non-bundel tak berubah (AC-8).
- `doctor`: baris info `·`/`!` "fase Mockup di runtime non-codex butuh `codex` CLI yang sudah login
  (`codex login`)". Tampil bila codex tak ada; tak fatal.
- Test: bundel + `~/.claude/skills/codex-image` tiruan → tak disuntik untuk claude, tetap disuntik untuk
  codex/antigravity; bundel tanpa duplikat → disuntik ke ketiganya; skill global non-bundel bernama sama
  tetap disuntik (perilaku lama).

### Task 5: Rute mockup + keputusan MCP + kontrak

- [ ] Dashboard dan agen bisa mendaftar & mengambil gambar mockup backlog.

**Files:** `server/src/services/spec-mockups.ts` (baru), `server/src/routes/specs.ts` (dekat `:435`),
`shared/src/dto.ts`, `shared/src/api.ts:40`, `shared/src/mcp-catalog/backlog.ts`, `shared/src/mcp-catalog/transfer.ts`,
`docs/agent-integration.md`, `internal/docs/architecture/api-contract.md`.
**Test:** `server/test/spec-mockups.route.test.ts` (baru), `server/test/mcp-coverage.test.ts`, test katalog MCP
yang memeriksa daftar tool (cari `hanoman_backlog_attachments_list` di `shared/src/**/*.test.ts`).

**Interfaces — Produces:**

```ts
// shared/src/dto.ts
export const zMockupItem = z.object({ name: z.string(), size: z.number(), modifiedAt: z.string() });
export const zSpecMockups = z.object({
  source: z.enum(["worktree", "repo"]).nullable(), dir: z.string().nullable(), items: z.array(zMockupItem),
});
// server/src/services/spec-mockups.ts
export const MOCKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/i;
export async function resolveMockupDir(spec: { id: string; projectId: string }):
  Promise<{ source: "worktree" | "repo"; dir: string } | null>;
export async function listMockups(spec: { id: string; projectId: string }): Promise<SpecMockups>;
export async function readMockup(spec: { id: string; projectId: string }, name: string):
  Promise<{ buf: Buffer; mime: string } | null>;
```

- Folder: `<repoDir>/.worktrees/<sessionIdForSpec(id)>/docs/mockups/<id.toLowerCase()>` bila direktori ada,
  selain itu `<repoDir>/docs/mockups/<id.toLowerCase()>`, selain itu `null` (`resolveRepoDir` dari
  `local-binding`). `readMockup`: nama wajib cocok `MOCKUP_NAME`, `realpath(berkas)` wajib diawali
  `realpath(dir) + sep`, harus berkas biasa; selain itu `null`.
- `GET /specs/:id/mockups` → `zSpecMockups`, urut nama; spec tak ada 404 (AC-10).
  `GET /specs/:id/mockups/:name` → bytes, `content-type` dari ekstensi, `content-disposition: inline`,
  `nosniff`, `content-security-policy: sandbox; default-src 'none'`, `cache-control: no-cache`; `null` → 404 (AC-11).
- MCP: `hanoman_backlog_mockups_list` (read, `backlog:read`, `samplePath: /specs/SPEC-1/mockups`) dan
  `hanoman_backlog_mockup_download` (transfer, `backlog:read`, pola `hanoman_backlog_attachment_download`,
  parameter `spec`, `name`, `savePath`, `overwrite`) (AC-12). Bagian baru di `docs/agent-integration.md`.
- `shared/src/api.ts` (pembangun path, pola `specAttachments`): `specMockups(id)` → `/specs/:id/mockups`,
  `specMockup(id, name)` → `/specs/:id/mockups/:name`. `api-contract.md`: dua rute + header.
- Test: worktree ada → `source: worktree`; hanya repo → `repo`; tak ada → `{ source: null, items: [] }`; spec
  tak ada 404; PNG disajikan dengan header di atas; `..%2F`, nama tanpa ekstensi gambar, dan symlink yang
  keluar folder → 404; agent token tanpa `backlog:read` → 403 dengan `need`.

### Task 6: Komponen `ImageViewer` (zoom/pan/navigasi)

- [ ] Operator bisa memperbesar, memperkecil, menggeser, dan berpindah antar-gambar dengan mudah.

**Files:** `src/src/ds/ImageViewer.tsx` (baru), `src/src/ds/index.ts`, `src/src/ds/styles.css` atau token yang ada.
**Test:** `src/test/image-viewer.test.tsx` (baru).

**Interfaces — Produces:**

```ts
export type ViewerImage = { src: string; name: string; href?: string };
export function ImageViewer(props: {
  images: ViewerImage[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}): JSX.Element;
```

- Overlay modal (`role="dialog"`, `aria-modal`, `aria-label`, fokus masuk & kembali seperti `DocPreviewModal`).
  Toolbar: `−`, persen zoom, `+`, `Fit`, `100%`, "Buka asli" (`href ?? src`, tab baru), tutup.
- Zoom 10%–800%: roda di posisi kursor, tombol, keyboard `+`/`=`/`-`/`0` (0 = Fit). Klik ganda Fit ↔ 100%.
  Geser: pointer drag (mouse & satu jari, `setPointerCapture`). Pinch dua pointer. Transform
  `translate3d + scale` pada satu elemen, state gerak di `useRef` + `requestAnimationFrame` (tanpa re-render
  per gerakan). Ganti gambar → reset ke Fit.
- Banyak gambar: strip thumbnail, `←`/`→`, label `n / total · nama`. `Esc` menutup. `touch-action: none` di
  kanvas. Gaya token design system; layout mobile tanpa scroll horizontal.
- Test (jsdom): tombol `+` menaikkan label persen, `Fit` mengembalikan; `0` reset; `→` memanggil
  `onIndex(1)`; `Esc` memanggil `onClose`; thumbnail ke-2 diklik → `onIndex(1)`; satu gambar → tanpa strip.

### Task 7: Galeri mockup + tiga titik masuk + thumbnail lampiran

- [ ] Mockup bisa dibuka dari dialog tanya sesi, chip fase Mockup, dan detail backlog.

**Files:** `src/src/screens/MockupGallery.tsx` (baru), `src/src/api/client.ts:287`, `src/src/screens/PetAnswer.tsx`,
`src/src/screens/HanomanPet.tsx:622,632`, `src/src/screens/TerminalScreen.tsx:1271,1493,1695`,
`src/src/screens/BacklogScreen.tsx:511`, `src/src/screens/SpecAttachments.tsx:143`.
**Test:** `src/test/mockup-gallery.test.tsx` (baru) + test layar yang ada untuk PetAnswer/PhaseStrip/SpecAttachments.

- **Consumes:** `ImageViewer` (Task 6), path `specMockups`/`specMockup` + tipe `SpecMockups` (Task 5).
- `client.ts`: `api.specMockups(id): Promise<SpecMockups>` dan `api.mockupSrc(id, name, modifiedAt): string`
  (URL `specMockup` + `?v=<modifiedAt>`).
- `MockupGallery({ specId, variant: "section" | "button", label? })`: `section` memuat daftar saat mount dan
  merender thumbnail (tak merender apa pun bila kosong); `button` memuat saat mount, merender
  `Lihat mockup (n)` hanya bila n > 0. Klik → `ImageViewer`. Galat muat → teks kecil "Mockup tak bisa dimuat".
- `PetAnswer`: prop baru `specId?: string | null` (HanomanPet meneruskan `s.specId`); render
  `<MockupGallery variant="button">` di atas opsi jawaban bila `specId` ada.
- `PhaseStrip`: prop baru `onOpenMockup?: () => void`. Chip `Mockup` dengan state `active`/`done` dan
  `onOpenMockup` → aksi "Lihat mockup" (di panel chip bila ada agen, atau klik langsung bila tidak).
  `TerminalScreen` meneruskan handler yang membuka galeri untuk `specId` sesi itu.
- `BacklogScreen`: `<MockupGallery variant="section" specId={…}>` berjudul `Mockup`, di dekat
  `SpecAttachmentsPanel`.
- `SpecAttachments`: klik thumbnail gambar membuka `ImageViewer` berisi semua lampiran gambar (AC-14).
- Test: galeri `button` tak merender apa pun saat daftar kosong dan merender `Lihat mockup (2)` saat ada dua;
  klik membuka dialog viewer; `section` menampilkan thumbnail; chip Mockup memanggil `onOpenMockup`; klik
  thumbnail lampiran membuka viewer.

### Task 8: Dokumentasi akhir + uji nyata

- [ ] Semua docs SoT sinkron dan rute terbukti di server lokal.

**Files:** `internal/skills/hanoman/SKILL.md` (daftar fase + skill bundel), `internal/docs/README.md`
(link spec/plan/ADR), cek `internal/docs/architecture/data-model.md` bila menyebut daftar fase.

- `rtk proxy grep -rn "Spec → Plan\|Spec, Plan" internal/docs internal/skills docs/agent-integration.md`
  untuk daftar fase yang usang; perbarui yang menyebut urutan feature/qa.
- Typecheck paket tersentuh: `pnpm --filter ./shared typecheck`, `./runner`, `./server`, `./src`, `./cli`.
- Uji nyata: build server (`pnpm --filter ./server build`), boot dengan `HANOMAN_HOME` sementara, buat
  backlog di project uji, taruh dua PNG di `docs/mockups/<spec-id>/` checkout project, lalu
  `rtk proxy curl -o` ke `GET /specs/:id/mockups` dan `GET /specs/:id/mockups/01-x.png` (cek header via `-D`),
  serta satu nama traversal (harus 404). Pastikan `$HANOMAN_HOME/skills/codex-image/SKILL.md` + marker
  ter-seed. Matikan server per-PID (AGENTS #6).
- Jalankan ulang set test seluruh task (`--changed "$(git merge-base HEAD main)"`, perintah Global
  Constraints) dan laporkan hasilnya.
