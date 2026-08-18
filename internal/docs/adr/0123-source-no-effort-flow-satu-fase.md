# ADR-0123 — Source `no_effort`: flow satu fase `Kerjakan` untuk task remeh

Status: accepted · 2026-08-18

## Konteks

Lima source backlog memetakan ke flow lewat satu fungsi (`flowForSource`, `shared/src/dto.ts`), dan
yang **paling pendek** adalah `goal` = dua fase `Goal → Verifikasi` (ADR-0089). Untuk pekerjaan
yang benar-benar remeh — ganti copy/label, bump konstanta, perbaiki typo docs, tambah satu baris
allowlist — dua fase pun kelebihan: fase `Verifikasi` menghabiskan satu giliran agen untuk
membuktikan sesuatu yang diff-nya sendiri sudah membuktikan.

Biayanya bukan cuma token. Satu backlog = satu sesi (ADR-0015) di worktree sendiri (ADR-0002), dan
mesin operator menjalankan beberapa sesi sekaligus — itulah premis yang sama yang melahirkan
`verifyScope` (ADR-0080). Sesi yang hidup dua kali lebih lama dari kerjanya menahan slot,
RAM, dan CPU yang sedang dipakai sesi lain. Yang terjadi di lapangan: operator memfilekan task
remeh sebagai `goal` — atau lebih buruk, `brief` lima fase — karena tak ada pilihan yang lebih
pendek.

## Keputusan

1. **Source keenam `no_effort` → flow keenam `no_effort` = `PIPELINES.no_effort = ["Kerjakan"]`.**
   Satu fase. `Kerjakan` **aktif** ⇒ stage `executing`; `Kerjakan` **done/skipped** ⇒ stage `done`.
   Tak ada stage antara karena memang tak ada fase antara.

2. **Nama fase `Kerjakan` wajib unik lintas seluruh `PIPELINES`.** Peta `REACHED`
   (`server/src/services/session-phases.ts`) berkunci **nama fase saja**, bukan pasangan
   (flow, fase) — jadi memakai ulang `Execute` atau `Goal` tak menghasilkan error, ia merusak
   deteksi fase **seluruh flow yang memakai nama itu**. Aturan yang sama sudah melahirkan
   `Goal`/`Verifikasi` di ADR-0089; di sini ia ditegakkan lewat test yang membandingkan
   `PIPELINES.no_effort` terhadap union nama fase flow lain.

3. **Payload menumpang bentuk `goal` — tak ada bentuk keempat.**
   `payloadShapeFor("no_effort") === "goal"`, jadi isinya `{goal, done, constraints, priority}`.
   Alasannya bukan hemat kode. Bentuk keempat dengan field yang identik akan menuntut pembeda baru
   di `shapeOfPayload` — dan **tak ada field yang bisa membedakannya**, karena bentuknya sama.
   `shapeOfPayload` adalah yang menjaga `payloadMatchesSource` (boundary `zCreateSpec`,
   `zPatchSpec`, `zChangeSpecSource`), jadi bentuk yang tak terbedakan dari ISI-nya bukan sekadar
   duplikasi: ia predikat yang tak bisa ditulis. Di samping itu ia akan membeli matriks
   `convertPayload` 4×4 (enam pasangan baru, semuanya identitas), entri `SHAPE_FIELDS`/
   `SHAPE_REQUIRED` keempat yang menyalin `GOAL_FIELDS` kata per kata, dan cabang `oneOf`/`allOf`
   keempat di `mcp-schema.ts`.
   Konsekuensi yang diterima sadar: **`Spec.source` satu-satunya yang membedakan** item `goal` dari
   item `no_effort`. Itu memang cukup — `flowForSource` membaca `source`, bukan payload.
   `SHAPE_REQUIRED.goal` tetap `["goal", "done"]`; `done` kosong pada task remeh (diff-nya sendiri
   buktinya) bukan penghalang, karena daftar itu hanya menyalakan catatan "field ini lahir kosong"
   di dialog konversi, bukan gerbang.

4. **`WORK_PHASES` — satu daftar fase kerja, dipakai dua gerbang di dua paket.**
   Sampai spec ini "sesi ini menulis kode" dinyatakan **dua kali** sebagai rantai `||` berisi nama
   fase yang sama: `writesCode` di `runner/src/prompt.ts`
   (`includes("Execute") || includes("Goal")`) dan aturan "fase kerja aktif ⇒ `executing`" di
   `stageFor` (`server/src/services/session-phases.ts`). Rantai itu tumbuh satu suku tiap flow
   penulis-kode baru, dan **suku yang lupa ditambah tak menghasilkan error apa pun** — yang hilang
   adalah `verifyScope` (ADR-0080), klausa gaya kode (ADR-0108), dan `exitSkills` (ADR-0113),
   semuanya diam-diam. Daftarnya kini satu konstanta yang diekspor runner
   (`WORK_PHASES = ["Execute", "Goal", "Kerjakan"]`) dan diimpor server; tak ada arah impor baru
   (server sudah mengimpor `PIPELINES` dari `@hanoman/runner`).
   `writesCode` tetap **satu definisi** — yang berubah hanya sumber daftarnya.

5. **`isGoalShapedFlow` — mode goal dipaksa menyala, template global dilewati.**
   Predikat tetangga `flowForSource` di `shared/src/dto.ts`, menggantikan `flow === "goal"` di
   `session-launch.ts` dan `defaultGoalCondition`. Ketiga akibat ADR-0089 berlaku sama untuk
   `no_effort`: (a) mode goal selalu menyala — `opts.goal:false` diabaikan, karena sesi satu fase
   justru paling gampang berhenti sebelum menulis baris fase & push; (b) template global
   `Setting.goal.condition` dilewati — item membawa kondisinya sendiri; (c) kondisinya
   `goalFlowCondition`, yang kini menyebut `PIPELINES[flow]` alih-alih `PIPELINES.goal` hardcode.
   Gate codex (`codexGoalScript`) sudah menurunkan fase dari `PIPELINES[flow]` sejak awal dan
   benar tanpa perubahan.

6. **Prompt: satu builder, dua flow.** `startGoalPrompt` sudah punya kerangka yang persis
   dibutuhkan — mengeja isi payload sebagai prosa alih-alih melampirkan JSON, tanpa keputusan
   pasca-Audit, tanpa skill Brainstorm/Plan, tanpa `resumeClause` ber-plan. Ia diparametrisasi flow
   (`startGoalPrompt(flow, spec, branchTo, opts)`), bukan disalin. Yang berbeda hanya kepala prompt
   dan ada/tidaknya klausa "fase Verifikasi bukan formalitas"; prompt flow `goal` tetap
   byte-identik.

7. **Item yang sudah dimulai terkunci — otomatis, cukup diuji.** Gerbang `checkSourceChange`
   (ADR-0109) mengunci **flow**, bukan label, dan `no_effort` punya flow yang berdiri sendiri —
   jadi item berjalan tak bisa pindah ke/dari sana tanpa satu baris gerbang baru. Itu benar: berkas
   fase item `feature` tak akan pernah memuaskan `phasesComplete(["Kerjakan"])`, dan sebaliknya —
   bentuk kelas bug SPEC-433, di mana sebuah keadaan secara struktural tak bisa tercapai. Item yang
   **belum** dimulai tetap bebas pindah: `convertPayload` berkunci **bentuk**, jadi
   `brief ↔ no_effort` sudah dilayani jalur `brief ↔ goal` tanpa baris baru.

8. **`SOURCE_META` frontend wajib berentri** (`{ label: "Tanpa effort", icon: "zap", tone: "brass",
   color: "var(--brass-400)" }`). Fallback `SOURCE_META[s] ?? SOURCE_META.brief` **diam**: tanpa
   entri, item `no_effort` memakai lencana "feature brief" dan tak ada satu pun error yang
   menyanggahnya — persis yang menimpa `help` (ADR-0109 poin 5). `SOURCE_OPTS` diturunkan dari
   `zSpecSource.options`, jadi dialog "Ubah type" ikut otomatis; tab filter daftar backlog dan tab
   form "backlog baru" ditambahkan eksplisit. Author diberi prefiks `No effort ·`, cermin
   `Audit ·`/`Goal ·`.

9. **Tanpa migration.** `Spec.source` sudah kolom `String`; penambahan nilai enum murni zod —
   preseden `audit` (SPEC-237), `help` (ADR-0062), `goal` (ADR-0089). `FIELDS.spec` sync allowlist
   sudah memuat `source` & `payload`, dan `Spec.sourceHistory` menyimpan `from`/`to` sebagai string,
   jadi nilai baru menyeberang apa adanya.

## Konsekuensi

- Operator punya pilihan yang benar-benar lebih pendek dari `goal`; task remeh berhenti dibayar
  dengan pipeline yang tak dipakai.
- Sesi `no_effort` tetap **penulis kode penuh**: `verifyScope`, klausa gaya kode, dan `exitSkills`
  terpasang lewat `writesCode` yang sama. Yang dihapus adalah ritual perencanaan & pembuktian
  terpisah, bukan disiplin verifikasinya — prompt-nya menyuruh membuktikan **di fase yang sama**.
- Flow penulis-kode berikutnya cukup mendaftarkan nama fasenya di `WORK_PHASES` untuk mendapat
  ketiga klausa sekaligus, alih-alih menemukan dua rantai `||` yang harus sama-sama diingat.
- `goal` dan `no_effort` tak bisa dibedakan dari payload-nya. Kode yang perlu membedakan keduanya
  **wajib** membaca `Spec.source` / flow, bukan menebak dari isi.
- Item berjalan tak bisa dipindah ke/dari `no_effort` (409). Itu disengaja, bukan keterbatasan.

## Alternatif yang ditolak

- **Knob "lewati fase Verifikasi" di atas flow `goal`.** Knob tak mengubah `PIPELINES`, sementara
  `REACHED`, `phasesComplete`, `defaultGoalCondition`, dan gate sh codex semuanya menurunkan
  tuntutannya dari `PIPELINES[flow]`. Hasilnya sesi yang digerbangi fase yang tak akan pernah
  ditulis — bentuk SPEC-433 lagi. Alasan yang sama membuat ADR-0089 memilih flow, bukan knob.
- **Bentuk payload keempat.** Lihat keputusan 3: tak ada field pembeda, jadi `shapeOfPayload` tak
  bisa ditulis untuknya.
- **Memakai ulang nama fase `Execute`.** Merusak deteksi fase seluruh flow yang memakainya
  (keputusan 2).
- **Menghidupkan `cross-audit` sebagai preseden penambahan source.** Tetap dicabut (ADR-0092);
  spec ini tak menyentuhnya.
