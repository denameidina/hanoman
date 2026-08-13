# ADR-0113 — Registry metode workflow: katalog `METHODS` di `shared`, gerbang plan memindai union direktori

- Status: Accepted
- Tanggal: 2026-08-13
- SPEC: SPEC-734
- Terkait: **menegakkan** [0029](0029-execute-done-butuh-plan-terceklist.md) (gerbang plan
  terceklist — memperluas jangkauannya ke seluruh metode, tanpa mengubah aturannya),
  mengikuti pola knob [0080](0080-scope-verifikasi-per-sesi.md) (override per sesi → Setting
  global → default) dan [0081](0081-default-sesi-konflik-opt-in.md) (blok `Setting` `Json`
  tanpa migration); menegakkan [0024](0024-sesi-interaktif-menggantikan-run.md) (prompt satu-satunya
  pengarah sesi), [0037](0037-cabut-guardrail-safety.md) (mengarahkan, bukan menolak),
  [0074](0074-codex-sebagai-mesin-sesi.md) (prompt netral-agen),
  [0089](0089-backlog-goal-flow-dua-fase.md) (fase `Goal` sengaja tanpa skill),
  [0090](0090-stempel-waktu-backlog-created-started.md) (stempel tulis-sekali = fakta historis),
  [0109](0109-ubah-source-backlog-item.md) (konversi payload field-ke-field).

## Konteks

hanoman hanya mengenal SATU metodologi kerja (superpowers), dan itu tak dipilih di mana pun: ia
tertulis **literal**, sebagian sebagai string path. Enumerasi `grep -rn "superpowers"` atas seluruh
`*.ts`/`*.tsx` non-test di `shared/src server/src runner/src src/src cli/src` menemukan **sembilan**
titik fungsional — brief SPEC-734 hanya menyebut enam:

| # | Titik | Peran | Di brief? |
|---|---|---|---|
| 1 | `runner/src/prompt.ts` `PHASE_SKILLS` | peta fase → skill | ya |
| 2 | `runner/src/prompt.ts` `phaseInstruction` | klausa gerbang plan di prompt | ya |
| 3 | `runner/src/codex-settings.ts` | loop plan di Stop hook codex | ya |
| 4 | `server/src/services/session-phases.ts` `planComplete` | gerbang stage `executing` | ya |
| 5 | `server/src/services/stage-artifacts.ts` | peta stage → dir artefak | ya |
| 6 | `server/src/services/spec-docs.ts` `kindOf` | klasifikasi doc dari prefix path | ya |
| 7 | **`runner/src/goal.ts` `defaultGoalCondition`** | grep plan di kondisi mode goal | **tidak** |
| 8 | **`runner/src/prompt.ts` `continuePrompt`/`resumeClause`** | path plan saat sesi dilanjutkan | **tidak** |
| 9 | **`server/src/services/lead/prompt.ts`** | plan yang dibaca lead sebelum memutuskan | **tidak** |

Ketiga titik tambahan itu kelas yang sama persis. Nomor 7 yang paling tajam: kondisi mode goal
menuntut hasil `grep -rn -- "- [ ]"` yang **KOSONG** sebagai bukti selesai, jadi direktori yang salah
bukan sekadar tak informatif — **ia memuaskan gerbangnya**.

Akibatnya metodologi lain (mattpocock/skills) tak bisa dicoba tanpa menyunting sembilan tempat, dan
tak ada cara membandingkan hasil dua metode pada backlog yang sebanding.

Prasyarat yang dipastikan di kode sebelum memutuskan: `Setting.data` bertipe `Json` dan
`Spec.payload` bertipe `Json?` → default global + metode per-item muat lewat `.default()` zod
**tanpa migration**; `runner/package.json` sudah punya `"@hanoman/shared": "workspace:*"` (sampai
spec ini nol import), dan impor itu terbukti bekerja di bawah vitest.

## Keputusan

### 1. Satu registry, `shared/src/method-catalog.ts`

`MethodDef { id, label, planDir, specDir, phaseSkills, exitSkills, extraClause?, requires }`;
`METHODS: Record<string, MethodDef>`; `DEFAULT_METHOD = "superpowers"`. Menambah metode ketiga =
**satu entri**. Katalog awal: `superpowers` (isi `PHASE_SKILLS` dipindah apa adanya) dan `matt`.

Modul ini **sengaja bebas zod**. Ia diimpor `@hanoman/runner`, lapis yang selama ini bebas skema;
menyeret mesin validasi ke sana hanya untuk membaca tabel konstanta tak sepadan.

### 2. Registry di `shared`, **DI-IMPORT** runner — bukan dicerminkan (deviasi sadar)

Ini menyimpang dari konvensi `shared/src/enums.ts`, yang mencerminkan `Flow`/`Agent`/`VerifyScope`
sebagai union TS terpisah supaya lapis runner bebas zod. Cermin masuk akal untuk **enum tiga kata**;
ia tidak masuk akal untuk **tabel yang harus identik di tiga paket**. SPEC-407 sudah membayar
konvensi itu dengan **EMPAT cermin `Flow`**, dan sebuah katalog yang bercabang diam-diam antara
`shared` dan `runner` akan melahirkan tepat kelas bug yang spec ini ada untuk menghapusnya.

### 3. INVARIAN 1 — gerbang plan fail-closed, memindai UNION

`PLAN_DIRS`/`SPEC_DIRS` = union `planDir`/`specDir` seluruh metode terdaftar. Setiap **gerbang**
membacanya: `planComplete()`, skrip Stop hook codex (loop per direktori), `defaultGoalCondition()`,
`artifactsToRemove()`, `kindOf()`, dan prompt lead.

Yang menentukan bukan sekadar "pakai daftar", melainkan **bentuk penanganan direktori yang tak ada**:
`planComplete` wajib `continue`, **bukan `return true`**. Item yang lahir dengan superpowers lalu
dilanjutkan dengan metode lain akan melihat direktori metode barunya kosong → `true` hampa →
backlog lompat ke `done` padahal plan lama masih penuh `- [ ]`.

**Prompt tetap menyebut direktori metode sesi itu** (AC-4); yang union adalah gerbangnya. Keduanya
berdampingan: Stop hook codex memenuhi AC-4 karena union ⊇ `{planDir}`.

### 4. INVARIAN 2 — pintu keluar tak bisa dinegosiasikan

`exitSkills` wajib non-kosong dan wajib memuat `superpowers:verification-before-completion`
(konstanta `VERIFICATION_GATE`), ditegakkan test **di sumber** atas `METHODS` (pola SPEC-490).

Penegakannya **struktural, bukan konvensi**: `skillInstruction` menggabungkan `exitSkills` ke fase
**TERAKHIR** pipeline, digerbangi `writesCode(flow)` — gerbang yang SAMA dengan
`scopeClause`/`codeStyleClause`, karena menyalin daftar flow-nya berarti dua definisi "sesi ini
menulis kode" yang bisa berselisih saat flow baru lahir.

mattpocock TIDAK punya padanan `verification-before-completion`. Tanpa penggabungan ini, flow `goal`
(Goal → Verifikasi) kehilangan satu-satunya gerbangnya — fase `Goal` memang sengaja tanpa skill
(ADR-0089) — dan flow `feature`/`qa` metode `matt` berakhir di `implement`+`tdd`+`code-review` tanpa
gerbang verifikasi sama sekali.

### 5. Resolusi metode (cermin `verifyScope`, ADR-0080)

```
opts.method  →  Spec.payload.method  →  Setting.method  →  DEFAULT_METHOD
```

Diresolusi di **satu titik**, `session-launch.ts`. Bila `Spec.payload.method` belum ada, metode hasil
resolusi **distempel ke payload** pada peluncuran itu; sesudah itu ia **beku** — fakta historis
"metode saat item ini PERTAMA diluncurkan", cermin `startedAt` (ADR-0090). Tanpa pembekuan itu,
mengganti default global akan memindahkan item yang sedang berjalan ke direktori plan lain di tengah
jalan.

### 6. `zMethod` LENIENT, dan nilai mentah tak pernah dikoersi

`Setting.method` dan `zTerminalSession.method` bertipe `z.string()`, bukan `z.enum` ketat: instance
yang di-sync dari hub bisa membawa id metode yang belum ada di build ini, dan itu harus jadi
**fallback diam** — bukan baris Setting yang gagal parse lalu mengosongkan layar Settings (alasan
yang sama dengan model/effort di `zSetting`).

Nilai mentah **tidak** dikoersi saat disimpan maupun saat dibaca `getSetting()`; yang lenient adalah
`resolveMethod()` di setiap titik pakai, **termasuk kedua picker UI**. Mengoersi saat baca berarti
menyimpan-ulang nilai hub sebagai `superpowers` dan membuangnya diam-diam.

### 7. PIPELINES TIDAK BERUBAH

Nama fase adalah kunci peta `REACHED` di `server/src/services/session-phases.ts`; mengubahnya
merusak pemetaan stage. Metode hanya mengganti **CARA** sebuah fase dikerjakan, bukan fase apa yang
ada — itulah yang membuat kedelapan flow ikut tanpa perlakuan khusus.

### 8. Rekonsiliasi "hanya skill model-invoked"

Katalog mattpocock membedakan skill user-invoked (slash command) dan model-invoked. Dari daftar
resminya, `to-tickets` dan `implement` adalah slash command, sementara constraint SPEC-734 berbunyi
"HANYA SKILL MODEL-INVOKED yang boleh masuk katalog … test sumber menolaknya".

Kedua pernyataan hanya bisa benar bersamaan pada satu bacaan: yang dilarang adalah **kelas bahaya
yang constraint itu sendiri sebutkan** — skill yang **MEWAWANCARAI manusia** (`/grill-me`,
`/to-spec`) — karena sesi hanoman tak berpenunggu dan `AUTONOMY_CLAUSE_FULL` melarang agen bertanya
→ deadlock, kelas bug yang sama dengan checkpoint "review" superpowers. Bukti bacaan ini ada di
constraint berikutnya, yang justru **mengatur cara memakai `to-tickets`** di fase Plan; kalimat itu
tak punya makna bila `to-tickets` terlarang. Perhatikan pula katalog memilih **`grilling`** (primitif
model-invoked) alih-alih `/grill-me` (pembungkus user-invoked) — persis pemisahan ini.

Penegakannya berbentuk **denylist di test sumber**: `grill-me`, `to-spec`, `triage`,
`grill-with-docs`, `to-questionnaire`, `wait-what`, `teach`, `handoff`, `ask-matt`, `wayfinder`,
`setup-matt-pocock-skills`, `improve-codebase-architecture` — tak satu pun boleh muncul di
`phaseSkills`/`exitSkills` entri mana pun. `triage`/`to-spec` terlarang dengan alasan kedua: keduanya
menulis ke issue tracker **eksternal**, sedangkan hanoman ADALAH tracker-nya (`Spec` di SQLite).
Ditambah `extraClause` per metode yang menyatakan sesi tak berpenunggu, dan bahwa `to-tickets` di
sini penghasil berkas plan berkotak di `planDir` — **bukan penerbit tiket**.

## Konsekuensi

- **Default `superpowers` byte-identik dengan sebelum spec ini.** Untuk `superpowers`,
  penggabungan `exitSkills` di-dedup habis (Execute & Verifikasi memang sudah memuat gerbangnya) dan
  `extraClause`-nya tak ada (→ string kosong → dibuang `filter(Boolean)`). Dijaga test yang
  membandingkan keempat builder tanpa argumen `method` dengan `method: "superpowers"` eksplisit,
  plus 78 test prompt lama yang tetap hijau tanpa disunting.
- **Tanpa migration, tanpa endpoint baru.** `Setting.method` lewat `.default()`; stempel item lewat
  kolom `Json?` yang sudah ada; picker Settings menulis lewat `PUT /settings` yang sudah ada.
- **Metode adalah properti sesi BACKLOG.** Sesi project-level (reverse/scaffold/prd/breakdown),
  cron, dan penyelesai konflik tetap `DEFAULT_METHOD` (konstanta modul `PROJECT_METHOD` di
  `prompt.ts`): tak satu pun punya baris `Spec`, dan katalog mattpocock tak punya skill penyusun
  Source of Truth. Karena `writesCode` untuk flow dokumen bernilai false, prompt keduanya juga tetap
  byte-identik.
- **`convertPayload` (ADR-0109) tak diajari membawa stempel metode.** Mengubah type backlog item
  membangun payload baru field-ke-field, jadi `method` ikut hilang dan item itu kembali mengikuti
  `Setting.method` di peluncuran berikutnya. Aman karena gerbang plan sudah union (INVARIAN 1) dan
  stempelnya lahir lagi saat itu juga; payload lama tetap utuh di `Spec.sourceHistory`. Menambalnya
  berarti menyunting predikat milik spec lain tanpa AC yang memintanya.
- Di luar scope, dinyatakan: default metode per **project** (preseden `Project.autoMerge` — kolom
  `Json?`, LOCAL-only), deteksi otomatis plugin terpasang, metode per-flow, dan memindahkan artefak
  superpowers yang sudah ada. Tahap 1 cukup menampilkan `requires` sebagai catatan di picker.

## Gotcha wajib

1. **`planComplete` wajib `continue`, bukan `return true`,** saat sebuah `planDir` tak ada. Bentuk
   lama (`try { readdirSync } catch { return true }`) benar untuk satu direktori dan **fail-open**
   untuk banyak: direktori metode PERTAMA yang tak ada akan mengakhiri pemindaian sebelum metode
   kedua dilihat. Dijaga test khusus "dir metode pertama tak ada tak menghentikan pemindaian metode
   kedua".
2. **`runner/src/goal.ts` mudah terlewat** — ia bukan "prompt", jadi ia tak muncul saat orang
   mengaudit prompt. Dan gerbangnya menuntut hasil grep **KOSONG**, jadi menunjuk direktori yang
   salah membuatnya **lulus**, bukan gagal. Setiap penambahan metode wajib melewatinya.
3. **`exitSkills` digerbangi `writesCode`, bukan "selalu".** Menambahkannya tanpa gerbang mengubah
   prompt scaffold & prd (fase terakhirnya tak punya skill) → default tak lagi byte-identik.
4. **Judul blok skill memakai `method.label`, dan label `superpowers` sengaja huruf kecil.**
   `"Skills superpowers WAJIB"` adalah byte yang sudah ada; label ber-kapital akan memecah
   byte-identitas tanpa satu pun test lain menangkapnya.
5. **`extraClause` wajib menyebut `planDir` metodenya** (dijaga test sumber): klausa yang menyebut
   direktori metode lain adalah instruksi yang salah, dan tak ada mekanisme lain yang menangkapnya.
6. **Assertion "kunci `phaseSkills` ⊆ nama fase `PIPELINES`" hidup di `runner/test/`, bukan di
   `shared`.** `PIPELINES` ada di `runner`, dan `runner` sudah mengimpor `shared` — mengujinya dari
   `shared` berarti siklus paket. Ini deviasi sadar dari RENCANA TEST brief.
7. **Kartu "Metode workflow" di Settings duduk di tab `Sesi`,** bukan `Model sesi` — sekamar dengan
   kartu Scope verifikasi (ADR-0080) yang bentuknya memang ia cerminkan.
