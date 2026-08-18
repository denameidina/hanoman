# ADR-0122 — `constraints` di payload qa: bentuk payload seragam lintas source

Status: accepted · 2026-08-18

## Konteks

Lima source backlog dilayani **tiga** bentuk payload (`shared/src/spec-source.ts`, ADR-0089/0109):
brief `{context, outcome, constraints, priority}`, goal `{goal, done, constraints, priority}`, dan
qa `{severity, steps, expected, actual, env}`. Hanya qa yang tak punya `constraints` — jadi pelapor
temuan QA tak punya tempat menuliskan batasan pengerjaan ("jangan ubah kontrak API", "tanpa
migration", "reuse queue yang ada"), padahal batasan itu justru sering ia ketahui lebih dahulu
daripada siapa pun yang akan mengerjakannya.

Akibatnya terukur, bukan ketaksimetrisan kosmetik. `convertPayload` **membuang** `constraints` di
tiap konversi yang bermuara ke qa dan **melahirkannya kosong** di arah balik:

| arah | sebelum | konsekuensi |
|---|---|---|
| `brief → qa` | `dropped: nonEmpty(["constraints"])` (`spec-source.ts:112`) | batasan turun ke jejak |
| `goal → qa` | `dropped: nonEmpty(["done","constraints"])` (`:116`) | idem |
| `qa → brief` | lahir `constraints: ""` (`:135`) | tak ada yang bisa dipulihkan |
| `qa → goal` | lahir `constraints: ""` (`:127`) | idem |

Prosanya memang selamat di `Spec.sourceHistory` (ADR-0109) — jejak itu memuat payload bentuk LAMA
utuh — tetapi jejak bukan payload: item yang pindah `brief → qa → brief` **pulang tanpa
batasannya**, dan yang membacanya kemudian adalah prompt sesi, bukan manusia yang bisa membuka
riwayat. Satu field menutup keempat arah itu sekaligus.

## Keputusan

1. **`zQaPayload.constraints: z.string().default("")` — bukan `z.string()` polos.** Ini
   keputusan yang paling menentukan, dan satu-satunya yang bisa memecahkan data yang sudah ada.
   `zQaPayload` dipakai `zSpec`, `zCreateSpec`, `zPatchSpec`, dan `zChangeSpecSource`; payload qa
   yang **sudah tersimpan** tak punya field itu, jadi `z.string()` polos membuat setiap baris qa
   lama gagal validasi begitu ia dibaca, diedit, atau dikonversi. `.default("")` membuatnya lolos
   **dan** menormalkannya, sehingga tak ada dua bentuk qa yang harus dijaga hilir. Diuji dengan
   payload qa **tanpa** field itu (`shared/test/entities.test.ts`), bukan hanya dengan yang baru —
   test yang hanya memakai bentuk baru akan hijau justru pada kasus yang tak pernah terancam.
2. **`zBriefPayload`/`zGoalPayload` TIDAK ikut diberi default.** Keduanya sudah mewajibkan
   `constraints` sejak lahir, jadi tak ada baris lama yang perlu ditolong; melonggarkannya berarti
   melemahkan boundary tanpa satu pun kasus yang menuntutnya.
3. **`constraints` TIDAK masuk `SHAPE_REQUIRED.qa`.** Kosong adalah keadaan normal. Alasannya
   sudah ditetapkan untuk brief & goal (komentar `spec-source.ts`): menandainya "kurang" di tiap
   konversi jadi kebisingan, dan dialog ubah-source akan menuntut field yang memang boleh kosong.
   Komentarnya diperluas menyebut qa supaya alasan itu tak perlu ditemukan ulang.
4. **Label "Batasan" untuk qa, dan `BRIEF_FIELDS` diseragamkan sekalian.** Sebelum spec ini field
   yang sama sudah bernama dua hal tergantung layar: form buat-backlog (`src/src/App.tsx`) menulis
   **"Batasan"** untuk brief *dan* goal, sementara katalog `BRIEF_FIELDS`
   (`src/src/screens/source-meta.ts`, dipakai form edit detail + `ChangeSourceDialog`) menulis
   **"Constraints"** — satu-satunya label Inggris di seluruh katalog. Memberi qa "Constraints"
   berarti menambah bentuk ketiga pada inkonsistensi yang sudah ada; spec ini menutupnya.
   Placeholder qa `"mis. jangan ubah kontrak API"` — contoh nilai konkret, berbeda dari milik
   brief & goal (SPEC-490, ditegakkan atas SUMBER oleh `src/test/placeholder-contract.test.ts`).
5. **`priority` TETAP tidak ada di payload qa.** "Field setiap source sama" **tidak berlaku**
   untuk pasangan `priority`/`severity`: prioritas item qa diturunkan dari `severity`
   (`priorityFromSeverity`, ADR-0109) dan `deriveSpecFields` mengabaikan prioritas manual untuk
   source itu. Menambahkannya akan melahirkan dua sumber kebenaran yang pasti melenceng.
6. **Pembeda bentuk payload tak berubah.** `shapeOfPayload` membedakan qa lewat **`severity`** dan
   goal lewat **`goal`**. `constraints` kini dimiliki ketiganya, jadi ia bukan pembeda dan tak
   boleh dijadikan pembeda — qa dan goal tetap tak ambigu. Predikatnya tetap **satu**
   (`shared/src/spec-source.ts`), dipakai `zCreateSpec.superRefine` dan `zChangeSpecSource`.
7. **Katalog field frontend tetap satu.** `QA_FIELDS` bertambah satu baris dan `SHAPE_FIELDS`
   menyalurkannya ke **dua** layar sekaligus: form edit detail backlog (mode edit dan mode baca)
   dan `ChangeSourceDialog`. `NewSpecModal` memang merender ketiga bentuk secara literal sejak
   awal dan tetap begitu — itu call site, bukan katalog kedua.
8. **Tanpa migration Prisma, tanpa entri `FIELDS.spec` baru.** `Spec.payload` sudah kolom `Json`
   dan sync memindahkannya sebagai satu kolom utuh, jadi tak ada peta sync yang perlu tahu bentuk
   di dalamnya. Prompt runner mengirim payload apa adanya (`JSON.stringify`,
   `runner/src/prompt.ts`), sehingga field baru sampai ke agen tanpa satu baris kode.

## Konsekuensi

- Keenam arah `convertPayload` kini meneruskan `constraints` utuh; `dropped` untuk `brief → qa`
  menjadi **kosong** dan untuk `goal → qa` menyusut jadi `["done"]`.
- Round-trip `brief → qa → brief` mengembalikan batasan. Yang tetap **tidak** round-trip adalah
  `priority`, karena peta severity hanya punya dua nilai (`rendah → minor → sedang`) — dinyatakan
  dan diuji sejak ADR-0109, tak berubah di sini.
- Backlog qa lama tetap terbaca, teredit, dan terkonversi; batasannya lahir sebagai string kosong
  sampai seseorang mengisinya.
- Skema MCP mengiklankan field baru, jadi agen mulai mengirimnya tanpa perubahan di sisi klien.

## Gotcha

1. **`.default("")` adalah satu-satunya hal yang menyelamatkan baris lama.** Menggantinya dengan
   `z.string()` di kemudian hari akan mematikan setiap item qa yang lahir sebelum spec ini —
   diam-diam, lewat 400 di boundary yang berbeda-beda. Uji dengan payload qa **tanpa** field itu.
2. **`dropped` yang menyusut mengubah UI.** Blok `source-dropped` di `ChangeSourceDialog` kini
   **tidak dirender sama sekali** untuk `brief → qa`. Test yang membuktikan pelaporan `dropped`
   harus memakai arah yang memang masih membuang (`brief → goal` membuang Konteks); yang lama
   akan gagal dengan "unable to find testid", bukan dengan pesan yang menyebut penyebabnya.
3. **Skema MCP mengiklankan, `required` tidak.** Agen hanya mengirim apa yang diiklankan, jadi
   field yang absen di `properties` sama dengan tak ada — tetapi memasukkannya ke `required`
   membuat setiap panggilan agen menuntut string yang boleh kosong (bertentangan dengan
   keputusan 3). Dijaga `shared/test/mcp-qa-constraints.test.ts`.
4. **Dua pabrik payload qa di server tak lewat zod.** `services/ticket-accept.ts` (tiket Help
   Center) dan `services/github-accept.ts` (issue GitHub) menulis payload langsung lewat
   `prisma.spec.create`, jadi `.default("")` tak menyentuh keduanya: tanpa penyebutan eksplisit
   `constraints: ""`, item dari kedua kanal itu lahir tanpa field-nya dan tak pernah
   menampilkannya di form edit sampai ada yang mengetik di sana.
5. **`zEscalationPrefill.constraints` sudah ada sejak SPEC-340** tapi tak punya tujuan di bentuk
   qa; sejak spec ini `promoteToQa` meneruskannya. `promoteToBrief` masih tak memakainya — celah
   yang sudah ada sebelum spec ini dan sengaja dibiarkan di luar scope-nya.
