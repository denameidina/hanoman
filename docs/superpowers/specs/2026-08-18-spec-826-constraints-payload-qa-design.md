# SPEC-826 — Field `constraints` (Batasan) di payload QA

**Tanggal:** 2026-08-18 · **Source:** brief · **Prioritas:** sedang
**ADR:** 0122 (baru) · **Migration:** tidak ada (`Spec.payload` sudah kolom `Json`)

## Masalah

Tiga bentuk payload hidup berdampingan (`shared/src/spec-source.ts`): brief
`{context, outcome, constraints, priority}`, goal `{goal, done, constraints, priority}`, qa
`{severity, steps, expected, actual, env}`. Hanya **qa** yang tak punya `constraints`, jadi
pelapor temuan QA tak punya tempat menuliskan batasan pengerjaan ("jangan ubah kontrak API",
"tanpa migration", "reuse queue yang ada") — batasan yang justru sering ia ketahui.

Akibatnya terukur, bukan kosmetik. `convertPayload` **membuang** `constraints` di tiap konversi
yang bermuara ke qa dan **melahirkannya kosong** di arah balik:

| arah | hari ini | sesudah |
|---|---|---|
| `brief → qa` | `dropped: ["constraints"]` | diteruskan, `dropped: []` |
| `goal → qa` | `dropped: ["done","constraints"]` | diteruskan, `dropped: ["done"]` |
| `qa → brief` | lahir `constraints: ""` | diteruskan |
| `qa → goal` | lahir `constraints: ""` | diteruskan |
| `brief → goal` | sudah diteruskan | tak berubah |
| `goal → brief` | sudah diteruskan | tak berubah |

Prosa memang selamat di `Spec.sourceHistory` (ADR-0109), tapi item yang pindah
`brief → qa → brief` **pulang tanpa batasannya**. Satu field menutup empat arah lossy sekaligus.

## Keputusan

### 1. `zQaPayload.constraints: z.string().default("")` — bukan `z.string()` polos

Ini gerbang utamanya. Payload qa yang **sudah tersimpan** tak punya field itu; `z.string()` polos
membuat setiap baris lama gagal validasi begitu ia lewat `zPatchSpec`/`zCreateSpec`/`zSpec`/
`zChangeSpecSource` — semuanya memakai `z.union([zBriefPayload, zQaPayload, zGoalPayload])`.
Dengan `.default("")` baris lama parse mulus dan **ternormalisasi** ke `constraints: ""`, jadi
tak ada dua bentuk qa yang harus dijaga hilir.

`zBriefPayload`/`zGoalPayload` **tidak** ikut diberi default: keduanya sudah mewajibkan
`constraints` sejak lahir, jadi tak ada baris lama yang perlu ditolong, dan melonggarkannya
justru melemahkan boundary tanpa alasan.

### 2. Label: **"Batasan"** — dan `BRIEF_FIELDS` diseragamkan sekalian

Hari ini label field yang sama berbeda tergantung layar: form buat-backlog (`App.tsx`) menulis
**"Batasan"** untuk brief *dan* goal, sementara katalog `BRIEF_FIELDS` (dipakai form edit di
detail backlog + `ChangeSourceDialog`) menulis **"Constraints"**. Jadi field brief yang sama
sudah bernama dua hal tergantung dari mana operator membukanya, dan "Constraints" adalah
satu-satunya label Inggris di seluruh katalog.

qa memakai **"Batasan"**, dan `BRIEF_FIELDS` ikut diubah `Constraints → Batasan` — disengaja,
menutup inkonsistensi yang sudah ada alih-alih menambah bentuk ketiga.

Placeholder qa: `"mis. jangan ubah kontrak API"` — contoh nilai konkret, berbeda dari milik
brief (`reuse queue yang ada`) dan goal (`tanpa cache eksternal`), sesuai SPEC-490 (ditegakkan
`src/test/placeholder-contract.test.ts` atas SUMBER).

### 3. `constraints` TIDAK masuk `SHAPE_REQUIRED.qa`

Kosong adalah keadaan normal. Komentar `spec-source.ts:62-65` sudah memutuskan ini untuk brief &
goal ("menandainya 'kurang' tiap konversi jadi kebisingan"); komentarnya diperluas menyebut qa
supaya alasannya tak perlu ditemukan ulang. Konsekuensinya `missing` tak pernah memuat
`constraints`, dan dialog ubah-source tak pernah menuntutnya.

### 4. Pembeda bentuk payload tak disentuh

`shapeOfPayload` membedakan qa lewat **`severity`** dan goal lewat **`goal`**. `constraints`
kini dimiliki ketiganya, jadi ia bukan pembeda dan tak boleh jadi pembeda — qa dan goal tetap
tak ambigu. Predikat tetap **satu** di `shared/src/spec-source.ts`.

### 5. Katalog field frontend tetap satu

`QA_FIELDS` di `src/src/screens/source-meta.ts` bertambah satu baris (setelah `env`, mengikuti
posisi `constraints` sebagai field terakhir di brief & goal). Satu penambahan itu menutup **dua**
layar sekaligus lewat `SHAPE_FIELDS`: form edit di `BacklogScreen` (mode edit *dan* mode baca
lewat `DetailRow`) dan `ChangeSourceDialog`.

Form **buat-backlog** (`NewSpecModal`, `src/src/App.tsx`) tidak membaca `SHAPE_FIELDS` — ia
merender ketiga bentuk secara literal. Field Batasan ditambahkan di cabang qa-nya di sana; itu
bukan katalog kedua, hanya call site yang memang sudah literal sejak awal. State-nya **tak
bertambah**: `SpecForm.constraints` sudah ada (dipakai brief & goal).

### 6. `priority` tetap TIDAK ada di payload qa

Ia diturunkan dari `severity` (`priorityFromSeverity`, ADR-0109). "Field setiap source sama"
**tidak berlaku** untuk pasangan itu; menambahkannya akan menabrak `deriveSpecFields`, yang
untuk qa mengabaikan `manualPriority`.

## Permukaan yang berubah

**shared**
- `entities.ts` — `zQaPayload.constraints` `.default("")`.
- `spec-source.ts` — empat cabang `convertPayload`; komentar `SHAPE_REQUIRED`.
- `mcp-schema.ts` — `QA_PAYLOAD.properties.constraints` (**bukan** `required`); kalimat
  `SPEC_PAYLOAD_ONEOF.description` yang mengeja bentuk qa.

**server**
- `services/ticket-accept.ts` — pabrik payload qa dari tiket Help Center: `constraints: ""`.
- `services/github-accept.ts` — pabrik payload qa dari issue GitHub: `constraints: ""`.

**frontend**
- `screens/source-meta.ts` — `QA_FIELDS` + entri constraints; `BRIEF_FIELDS` label.
- `App.tsx` — `SpecPrefill.constraints?`, seed `blank`, `promoteToQa` meneruskan
  `escalation.prefill.constraints` (kolom yang sudah ada di `zEscalationPrefill` tapi selama ini
  tak pernah dipakai jalur qa), render Field Batasan di cabang qa, `createSpec` menyertakan
  `constraints` di payload qa.
- `screens/BacklogScreen.tsx` — `saveEdit` cabang qa menyertakan `constraints: form.constraints ?? ""`.

**tidak tersentuh, dan itu benar**
- `runner/src/prompt.ts` mengirim payload apa adanya (`JSON.stringify`) — field baru sampai ke
  agen tanpa satu baris kode.
- `sync.ts` tak butuh entri `FIELDS.spec` baru — `payload` sudah satu kolom `Json` utuh.
- Tak ada migration Prisma.
- `promoteToBrief` tetap tak meneruskan `prefill.constraints`; itu celah yang sudah ada sebelum
  spec ini dan bukan bagian dari objektifnya.

## Test

Kompatibilitas mundur adalah klaim utamanya, jadi ia diuji dengan payload qa **tanpa**
`constraints`, bukan hanya dengan yang baru:

1. `shared/test/entities.test.ts` — `zQaPayload.parse` atas payload qa lama → sukses,
   `constraints === ""`; `zPatchSpec`/`zCreateSpec` atas payload qa lama → sukses.
2. `shared/src/spec-source-convert.test.ts` — keempat arah qa memperbarui `dropped`/isi; test
   round-trip `brief→qa→brief` dibalik klaimnya: `constraints` kini **selamat**; test
   `payload null` memuat `constraints: ""`.
3. `server/test/spec-source-gate.test.ts` + `spec-source.route.test.ts` — payload hasil konversi
   memuat `constraints`; `dropped` brief→qa jadi kosong.
4. `src/test/change-source.test.tsx` — brief→qa tak lagi melaporkan apa pun sebagai `dropped`
   (blok `source-dropped` hilang) dan field Batasan ter-prefill; laporan `dropped` tetap diuji
   lewat arah yang memang masih membuang (`brief → goal` membuang Konteks).
5. `src/test/placeholder-contract.test.ts` — otomatis mencakup Field baru di `App.tsx`.

## Docs (commit yang sama)

`internal/docs/adr/0122-*.md` (baru) + `internal/docs/adr/README.md` + `internal/docs/README.md`;
`internal/docs/architecture/api-contract.md`; `internal/docs/architecture/data-model.md`;
`internal/skills/hanoman/SKILL.md`; `docs/agent-integration.md` §7.
