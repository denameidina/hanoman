# Fase Mockup — desain

**Tanggal:** 2026-10-31 · **Status:** disetujui operator (brainstorming 2026-10-31) · **ADR:** ADR-0233 (ditulis
bersama implementasi).

## Konteks & keputusan

Flow `feature` dan `qa` langsung melompat dari Spec ke Plan. Perubahan UI baru terlihat sesudah Execute,
sehingga salah tafsir tampilan baru ketahuan di Review atau sesudah merge. Operator ingin satu langkah
**Mockup**: gambar UI dihasilkan dan disetujui sebelum Plan, dan langkah itu dilewati bila backlog tak
menyentuh UI.

Yang sudah ada dan dipakai ulang:

- Daftar fase per flow: `FLOW_PHASES` (`shared/src/orchestration.ts:14`). State fase diturunkan dari
  berkas `$HANOMAN_PHASE_FILE` (`server/src/services/session-phases.ts`), tidak disimpan di DB.
- Keputusan skip fase oleh agen lewat marker `<Fase> skipped` (pola jalur cepat qa, ADR-0040).
- Skill per fase per metode: `METHODS[*].phaseSkills` (`shared/src/method-catalog.ts`).
- Lapis skill global `$HANOMAN_HOME/skills/<nama>` yang disuntik ke setiap sesi: claude lewat
  `--add-dir`, codex/antigravity lewat symlink `.agents/skills` (`server/src/services/skill-inject.ts`).
- Skill `codex-image` (kini hanya di `~/.claude/skills/codex-image` mesin operator) membungkus
  `codex exec` + tool `image_gen` Codex, tanpa `OPENAI_API_KEY`. Codex sendiri punya skill sistem
  `imagegen` (tool bawaan `image_gen`).

Yang belum ada: skill yang dibundel paket npm lalu di-seed, rute yang menyajikan gambar dari worktree,
komponen zoom/pan. Dialog pertanyaan sesi (`src/src/screens/PetAnswer.tsx`) hanya teks, IDE menampilkan
PNG sebagai "File biner", dan sesi tak memegang agent token untuk mengunggah lampiran.

Keputusan operator (brainstorming):

1. Fase `Mockup` di flow **feature dan qa**, posisi **sesudah Spec, sebelum Plan**.
2. Skip diputuskan **agen**: tak ada UI yang berubah/dibuat → `Mockup skipped`.
3. Mockup **wajib disetujui** lewat jalur tanya yang ada (hanoman-lead bila aktif, selain itu manusia).
   Operator **harus bisa melihatnya langsung di hanoman** dengan zoom in/out yang mudah.
4. Engine gambar: runtime **codex** memakai `image_gen` bawaan (skill `imagegen`). Runtime **lain**
   memakai skill `codex-image`. hanoman **memiliki** skill itu: dibundel di paket npm, di-seed ke
   `$HANOMAN_HOME/skills`, disuntik per sesi ke runtime yang belum punya.
5. Gambar mockup **di-commit ke git** di `docs/mockups/<spec-id>/`.
6. Gambar dibawa ke dashboard dengan **membaca worktree** (opsi A), bukan unggah lampiran lewat MCP
   (sesi tak punya token; sandbox tak menjangkau upload dir; batas 10 berkas; PNG di-encode ulang) dan
   bukan salin-ke-lampiran saat fase selesai (persetujuan terjadi sebelum fase selesai).

## Objective

Untuk setiap backlog feature/qa yang mengubah atau membuat UI, operator melihat dan menyetujui mockup
di dashboard sebelum fase Plan berjalan. Backlog tanpa UI tak membayar waktu atau token untuk fase ini.

Kriteria sukses:

- Sesi feature/qa baru menampilkan fase `Mockup` di PhaseStrip antara Spec dan Plan.
- Backlog yang menyentuh UI menghasilkan ≥1 PNG di `docs/mockups/<spec-id>/` yang bisa dibuka, di-zoom,
  dan digeser di dashboard dari tiga tempat (dialog tanya, chip fase, detail backlog).
- Backlog tanpa UI mencatat `Mockup skipped` dan langsung ke Plan.
- Sesi claude dan antigravity di mesin tanpa `~/.claude/skills/codex-image` tetap memuat skill
  `codex-image` (disuntik hanoman).

## Arsitektur

### 1. Fase `Mockup` di pipeline

- `FLOW_PHASES.feature = [Brainstorm, Objective, Spec, Mockup, Plan, Execute, Review]`.
- `FLOW_PHASES.qa = [Audit, Spec, Mockup, Plan, Execute, Review]`. Flow lain tak berubah.
- **Stage:** `Mockup` tidak masuk `REACHED`, jadi backlog tetap `spec-ready` sampai Plan tercatat. Tak ada
  nilai stage baru dan tak ada perubahan skema/migration.
- `Mockup` bukan `WORK_PHASES` (tidak menulis kode produk) dan bukan `UNSKIPPABLE_PHASES`.
- **Fase opsional:** konstanta baru `OPTIONAL_PHASES = {Mockup}` di `@hanoman/shared`. `derivePhases`
  membaca fase opsional yang **belum tercatat** sebagai `skipped` bila ada fase **sesudahnya** yang sudah
  tercatat (`done`/`skipped`). Aturan ini melindungi sesi yang lahir sebelum update. Agennya tak tahu ada
  Mockup dan tak akan pernah menulisnya; tanpa aturan ini `phasesComplete` tak pernah benar dan chip
  Mockup terlihat `active` di belakang Plan yang sudah selesai.
- **Jalur cepat qa:** marker jalur cepat (`orchestratorClause` langkah 5, `auditDecisionInstruction`)
  menulis `Mockup skipped` bersama `Spec skipped` dan `Plan skipped`.
- **Gerbang codex & goal** (`runner/src/codex-settings.ts`, `runner/src/goal.ts`) yang memeriksa
  `done|skipped` per fase membaca `FLOW_PHASES` sehingga ikut menuntut baris Mockup. Sesi lama memegang
  skrip gerbang yang ditulis saat lahir, jadi tak terdampak.
- **Orkestrasi:** agen fase `hanoman-fase-mockup`. Default `BUILTIN_ORCHESTRATION_DEFAULTS` untuk feature
  & qa: claude `sonnet·medium`, codex `gpt-5.6-terra·medium`, antigravity `inherit`. Alasannya: fase ini
  menulis spec gambar dan menunggu `image_gen`; penalaran berat ada di Spec. `RUNTIME_DEFAULTS_VERSION`
  naik (`2026-10-31-v1`). Seed mempertahankan sel `Mockup` yang sudah diisi operator, pola ADR-0230 #3.
- Cermin tipe yang disalin tangan ikut diperbarui: `src/src/api/client.ts` (`Phase`/`Flow`) dan
  pratinjau `PhasePlanPreview`.

### 2. Isi fase Mockup (prompt + skill)

Panduan fase dipakai dua mode dengan isi yang sama: `MOCKUP_CLAUSE` di `phaseInstruction` (sesi tunggal)
dan `backlogGuide("Mockup")` (agen fase, `runner/src/phase-agents.ts`).

1. **Putuskan perlu/tidak.** Baca dokumen spec (qa jalur cepat: dokumen audit). Bila tak ada layar,
   komponen, atau state UI yang berubah atau dibuat (perbaikan backend, CLI, refactor, docs) → `Mockup
   skipped`, dengan satu baris alasan di laporan/terminal. Ragu → anggap ada UI dan buat mockup.
2. **Siapkan.** Baca design system project bila ada (mis. `internal/docs/design-system/**`, `DESIGN.md`)
   dan layar yang sekarang (kode komponen yang akan diubah). Tangkapan layar UI saat ini boleh dipakai
   sebagai referensi `--ref` bila tersedia.
3. **Hasilkan.** Satu gambar per layar/state yang berubah, **maks 6**. Desktop `1536x1024`; tambah
   `1024x1536` (mobile) bila perubahannya menyentuh layout responsif. Berkas:
   `docs/mockups/<spec-id>/<NN>-<slug>.png` (`spec-id` huruf kecil, `NN` dua digit urut). Muat & ikuti
   skill `codex-image`; ia menentukan engine per runtime (§3).
4. **Catat.** Tambah bagian `## Mockup` di dokumen spec: tiap berkas, layar/state yang ditunjukkannya,
   dan apa yang berubah dibanding sekarang.
5. **Minta persetujuan** lewat jalur tanya yang berlaku. Sesi tunggal memakai `ASK_ROUTE`; agen fase
   memakai `Keputusan terbuka:` yang di-relay orchestrator. Pertanyaan memuat daftar path absolut
   gambar (lead membacanya dengan alat baca gambar) dan kalimat `Lihat di hanoman: Backlog <SPEC-ID> →
   Mockup`. Opsinya: **Setujui** · **Revisi** (beserta catatan) · **Lewati mockup**.
   - Revisi → buat ulang gambar yang diminta dengan **spec gambar lengkap ditambah koreksi**, bukan
     koreksinya saja (aturan `codex-image`: koreksi parsial membuat batasan lama terlupa). Timpa berkas
     yang sama, lalu tanya lagi. Tak ada batas putaran.
   - Lewati → hapus berkas mockup yang belum di-commit, `Mockup skipped`.
6. **Tutup.** Disetujui → commit `docs/mockups/<spec-id>/` dan dokumen spec, lalu `Mockup done`.

Dampak ke fase lain (satu kalimat di panduan masing-masing, hanya bila `docs/mockups/<spec-id>/` ada):

- Plan: tiap task UI merujuk berkas mockup yang diwujudkannya.
- Execute: UI dibangun dengan kode sesuai mockup. PNG mockup **tidak** dipakai sebagai aset produk.
- Review: tabel `AC → putusan → bukti` memuat kesesuaian hasil dengan mockup.

**Skill fase:** `METHODS.*.phaseSkills.Mockup = [MOCKUP_SKILL]` untuk ketiga metode, dengan
`MOCKUP_SKILL = "codex-image"` sebagai konstanta (pola `VERIFICATION_GATE`). Satu nama untuk semua runtime
supaya prompt tetap netral-agen (ADR-0074); pemilihan engine ada di dalam skill.

**Codex tak tersedia** (runtime non-codex, `codex` tak terpasang atau belum login, exit 3/127): agen
**tidak** membuat pengganti (SVG/CSS/HTML yang dirasterisasi). Ia bertanya lewat jalur tanya: tunggu
operator menjalankan `codex login`, atau lewati mockup.

### 3. Skill `codex-image` milik hanoman

- **Sumber:** `server/skills/codex-image/` (`SKILL.md`, `scripts/codex-image.sh`,
  `scripts/normalize-set.py`, `references/sprite-sheets.md`), disalin dari skill operator dengan perubahan:
  - Path `~/.claude/skills/codex-image/...` → `"${HANOMAN_HOME:-$HOME/.hanoman}/skills/codex-image/..."`.
  - Bagian baru **"Pilih engine"** di atas: punya tool `image_gen` (runtime Codex) → pakai langsung lewat
    skill `imagegen`, jangan memanggil `codex exec` dari dalam Codex; sesudahnya salin hasil dari
    `$CODEX_HOME/generated_images/...` ke path tujuan. Tak punya → jalankan `scripts/codex-image.sh`.
  - Contoh use case `ui-mockup` untuk fase Mockup.
- **Paket npm:** entri `copyPlan` baru `server/skills → skills` (`cli/src/release/pack.ts`). Resolusi
  runtime memakai pola `scriptPath()` milik skrip VPS: berkas paket saat terpasang, berkas repo saat dev.
- **Seed** (`server/src/services/bundled-skills.ts`, dipanggil sekali saat server boot, fail-open): untuk
  tiap skill bundel, tujuan `$HANOMAN_HOME/skills/<nama>`:
  - belum ada → salin, lalu tulis `.hanoman-bundled.json` `{ version, sha }` (sha = hash isi bundel);
  - ada, bermarker, dan hash isi sekarang = `sha` tercatat (belum diubah operator) → timpa dengan versi
    bundel baru bila berbeda;
  - ada tanpa marker, atau sudah diubah operator → biarkan dan catat peringatan di log.
- **Suntik "bila belum punya":** `injectGlobalSkills` melewati skill **bundel** (bermarker) bila runtime
  sesi sudah punya skill bernama sama di lapis user (`~/.claude/skills`, `~/.codex/skills`,
  `~/.agents/skills`, `~/.gemini/antigravity-cli/skills`) atau project. Skill global buatan operator
  tetap disuntik seperti sekarang; aturan lama (project bernama sama menang) tak berubah.
- `hanoman doctor`: baris info "fase Mockup di runtime non-codex butuh `codex` CLI yang sudah login".
  Hanya peringatan, tidak menggagalkan.

### 4. Mockup terlihat di hanoman

**Server — rute baru** (`server/src/routes/specs.ts`, capability turun dari prefix `specs` → `backlog:read`):

- `GET /specs/:id/mockups` → `200 { source: "worktree" | "repo" | null, dir: string | null, items: MockupItem[] }`
  (`dir` = path absolut folder di mesin server, untuk agen lokal).
  `MockupItem = { name: string; size: number; modifiedAt: string }`, diurutkan menurut nama. Sumber
  folder: worktree sesi backlog (`.worktrees/<sessionId>/docs/mockups/<spec-id>/`) bila ada, selain itu
  checkout project (`<repoDir>/docs/mockups/<spec-id>/`), selain itu `items: []` dengan `source: null`.
  Spec tak ada → 404.
- `GET /specs/:id/mockups/:name` → bytes gambar. `name` wajib cocok
  `^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$`. `realpath` berkas wajib berada di dalam `realpath`
  folder mockup (menolak symlink keluar). Content-Type dari ekstensi, `content-disposition: inline`,
  `x-content-type-options: nosniff`, `content-security-policy: sandbox; default-src 'none'`,
  `cache-control: no-cache` (revisi menimpa nama yang sama). Tak ada / nama ditolak → 404.
- Kontrak masuk `shared/src/api.ts` + tipe `MockupItem` di `shared/src/dto.ts`.

**Keputusan MCP (ADR-0202):**

- Tool baca `hanoman_backlog_mockups_list` (`shared/src/mcp-catalog/backlog.ts`, capability
  `backlog:read`). Balasannya memuat `items` plus `dir` (path absolut folder di mesin server), supaya lead
  dan agen lokal bisa membaca gambarnya langsung.
- Transfer tool `hanoman_backlog_mockup_download` (`shared/src/mcp-catalog/transfer.ts`, capability
  `backlog:read`, pola `hanoman_backlog_attachment_download`) untuk `GET /specs/:id/mockups/:name`:
  mengunduh satu gambar ke disk lokal klien MCP. Mengikuti preseden ADR-0183 (rute biner punya transfer
  tool, bukan `UNWRAPPED`); agen di mesin server tetap bisa membaca langsung lewat `dir`.

**Frontend:**

- `src/src/ds/ImageViewer.tsx` (baru, tanpa pustaka): overlay modal layar penuh.
  - Zoom: scroll roda di posisi kursor, tombol `+`/`−`, tombol `Fit` dan `100%`, keyboard `+`/`-`/`0`.
  - Geser: drag mouse atau satu jari. Pinch dua jari di layar sentuh. Klik ganda bergantian Fit ↔ 100%.
  - Banyak gambar: strip thumbnail, `←`/`→`, label `n / total` + nama berkas.
  - `Esc`/tombol tutup, fokus terkunci di dialog (`role="dialog"`, `aria-modal`), tautan "Buka asli"
    (tab baru).
  - Skala 10%–800%. Transform `translate + scale` di satu elemen (GPU), tanpa re-render per gerakan
    (state gerak di ref, `requestAnimationFrame`).
  - Gaya mengikuti `internal/docs/design-system/**` (bone paper, brass).
- `src/src/screens/MockupGallery.tsx` (baru): memuat `GET /specs/:id/mockups` **saat dibuka** (bukan
  polling, sesuai ADR-0039), menampilkan thumbnail, lalu membuka `ImageViewer`. URL gambar diberi
  `?v=<modifiedAt>` supaya revisi tak tertahan cache.
- Tiga titik masuk:
  1. **Dialog tanya sesi** (`PetAnswer.tsx`): tombol `Lihat mockup (n)` bila backlog sesi itu punya
     mockup. Daftarnya diambil saat dialog terbuka.
  2. **Chip fase `Mockup`** di PhaseStrip (`TerminalScreen.tsx`): bisa diklik saat state `active` atau
     `done`, membuka galeri.
  3. **Detail backlog** (`BacklogScreen.tsx`): bagian `Mockup` di dekat `SpecAttachmentsPanel`; tak
     dirender bila kosong.
- Thumbnail gambar di `SpecAttachmentsPanel` (`SpecAttachments.tsx:143`), yang kini tak bisa diklik,
  ikut membuka `ImageViewer`.

## Penanganan galat

| Kondisi | Perilaku |
|---|---|
| `codex` tak ada / belum login (runtime non-codex) | Agen bertanya: `codex login` lalu lanjut, atau lewati. Tak ada gambar pengganti. |
| `image_gen` gagal / tanpa gambar (exit 4/5) | Coba ulang sekali dengan spec lebih konkret; gagal lagi → tanya. |
| Seed skill gagal (izin tulis, paket rusak) | Peringatan di log; server tetap boot; fase Mockup jatuh ke jalur "codex tak tersedia" bila skill tak termuat. |
| Worktree sudah dibersihkan dan mockup belum di-merge | `source: null`, galeri menampilkan "Belum ada mockup". |
| Nama berkas tak valid / traversal / symlink keluar | 404, tanpa membedakan alasan. |
| Sesi lama tanpa marker Mockup | Fase opsional dibaca `skipped` begitu fase sesudahnya tercatat. |

## Acceptance criteria

- **AC-1** WHEN sesi feature atau qa lahir, THE pipeline SHALL memuat `Mockup` tepat sesudah `Spec` dan
  sebelum `Plan`. Flow lain SHALL tak berubah.
- **AC-2** WHILE `Mockup` belum tercatat dan suatu fase sesudahnya sudah tercatat `done`/`skipped`, THE
  server SHALL menurunkan `Mockup` sebagai `skipped`.
- **AC-3** WHEN `Mockup` tercatat `done` atau `skipped`, THE stage backlog SHALL tidak berubah karenanya
  (tetap ditentukan Spec/Plan/Execute/Review).
- **AC-4** WHEN jalur cepat qa dipilih, THE prompt SHALL menyuruh menulis `Spec skipped`, `Mockup
  skipped`, dan `Plan skipped`.
- **AC-5** THE prompt sesi tunggal dan instruksi agen fase Mockup SHALL memuat: keputusan skip tanpa UI,
  lokasi `docs/mockups/<spec-id>/`, batas 6 gambar, permintaan persetujuan dengan opsi
  Setujui/Revisi/Lewati dan petunjuk "Lihat di hanoman", larangan gambar pengganti, dan commit sebelum
  `Mockup done`.
- **AC-6** THE `phaseSkills.Mockup` setiap metode SHALL berisi `codex-image`.
- **AC-7** WHEN server boot dan `$HANOMAN_HOME/skills/codex-image` belum ada, THE server SHALL menyalin
  skill bundel ke sana beserta marker. WHEN salinan bermarker belum diubah operator dan versi bundel
  berbeda, THE server SHALL memperbaruinya. WHEN salinan diubah operator atau tanpa marker, THE server
  SHALL membiarkannya.
- **AC-8** WHEN sesi lahir dan runtime-nya sudah punya skill user/project bernama `codex-image`, THE
  hanoman SHALL tidak menyuntik salinan bundel. Selain itu THE hanoman SHALL menyuntiknya untuk claude,
  codex, dan antigravity.
- **AC-9** THE paket npm SHALL memuat `skills/codex-image/**`, dan `SKILL.md`-nya SHALL tidak menyebut
  path `~/.claude/skills`.
- **AC-10** `GET /specs/:id/mockups` SHALL mengembalikan daftar gambar dari worktree sesi, jatuh ke
  checkout project, lalu ke daftar kosong. Spec tak ada SHALL memberi 404.
- **AC-11** `GET /specs/:id/mockups/:name` SHALL menyajikan gambar dengan Content-Type yang benar dan
  header `nosniff` + CSP sandbox. Nama tak valid, traversal, atau symlink keluar SHALL memberi 404.
- **AC-12** THE tool MCP `hanoman_backlog_mockups_list` dan transfer tool `hanoman_backlog_mockup_download`
  SHALL ada dengan capability `backlog:read` (gerbang `mcp-coverage` hijau).
- **AC-13** THE `ImageViewer` SHALL mendukung zoom (roda, tombol, keyboard), Fit/100%, geser dengan
  drag, pinch, navigasi antar-gambar, dan tutup dengan Esc.
- **AC-14** THE galeri mockup SHALL bisa dibuka dari dialog tanya sesi, chip fase Mockup, dan detail
  backlog. Thumbnail lampiran gambar backlog SHALL membuka viewer yang sama.

## Testing

Test baru atau diperbarui, dijalankan per task (`--changed`, `--no-file-parallelism`, `TEST_DATABASE_URL`
terisolasi):

- `shared/src/orchestration.test.ts`: urutan fase feature/qa, `OPTIONAL_PHASES`, default sel Mockup.
- `server/test/session-phases.test.ts`: skip implisit fase opsional (AC-2), stage tak berubah
  oleh Mockup (AC-3), `phasesComplete` dengan sesi lama.
- `shared/src/method-catalog.test.ts`: `phaseSkills.Mockup` di ketiga metode (AC-6).
- `runner/test/prompt-golden.test.ts` + `runner/test/__golden__` (start-feature, start-qa*, continue-feature,
  resume-qa, hash Antigravity), `runner/test/orchestrator-prompt.test.ts`, `runner/test/phase-agents.test.ts`,
  dan `runner/test/method-phases.test.ts` untuk panduan Mockup + jalur cepat (AC-4, AC-5). Perubahan
  golden disengaja.
- `server/test/bundled-skills.test.ts` (baru): salin, perbarui yang belum diubah, pertahankan yang
  diubah/tanpa marker (AC-7).
- `server/test/skill-inject.test.ts`: lewati skill bundel bila runtime sudah punya (AC-8).
- `cli/test/pack.test.ts`: `copyPlan` memuat `skills` (AC-9).
- `server/test/spec-mockups.route.test.ts` (baru): daftar dari worktree/repo/kosong, 404 spec, sajian bytes + header, tolak traversal
  & symlink (AC-10, AC-11). Gerbang `server/test/mcp-coverage.test.ts` + test tool katalog (AC-12).
- `src/src/ds/ImageViewer.test.tsx`: zoom via tombol/keyboard, reset Fit/100%, navigasi, Esc (AC-13).
  Test titik masuk galeri (AC-14).
- Uji nyata sekali di akhir: boot server, `curl` kedua rute mockup terhadap backlog dengan PNG contoh.

## Docs yang disentuh

- `internal/docs/adr/0233-fase-mockup.md` (baru) + index `internal/docs/README.md`.
- `internal/docs/architecture/api-contract.md` (dua rute), `internal/docs/architecture/stack.md` (fase &
  skill bundel), `docs/agent-integration.md` (tool MCP baru), `internal/skills/hanoman/SKILL.md` (daftar
  fase).

## Di luar scope

- Menyunting mockup di dashboard (anotasi, coretan). Revisi tetap lewat catatan teks di jawaban.
- Persetujuan mockup lewat Telegram.
- Mockup untuk flow selain feature/qa (goal, no_effort, scaffold, prd, dst.).
- Menegakkan persetujuan di server: kepatuhan tetap lewat prompt (ADR-0037), sama seperti `Verdict:`
  Review.
- Memasang skill ke home runtime milik user (`~/.claude/skills`, dst.). hanoman hanya menyuntik per sesi.

## Risiko

- **Ukuran repo:** PNG 1–2 MB × maks 6 per backlog ber-UI ikut di-commit. Disengaja (keputusan 5).
- **Waktu & token:** 1–3 menit per gambar, ditambah satu putaran tanya. Dibatasi maks 6 gambar, dan
  backlog tanpa UI dilewati.
- **Kepatuhan prompt:** agen bisa salah menilai "tanpa UI". Aturan "ragu → buat mockup" condong ke aman.
- **Ketergantungan Codex:** runtime non-codex butuh `codex` CLI ber-login di mesin yang sama. Hal ini
  dinyatakan di `doctor` dan di jalur galat.
