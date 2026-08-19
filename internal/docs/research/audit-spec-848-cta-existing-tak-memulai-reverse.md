# Audit SPEC-848 — CTA existing codebase menjanjikan reverse docs tetapi tak pernah memulai sesinya

- **Sumber**: finding QA SPEC-848 · severity `major` · prioritas `sedang` · GitHub issue
  [denameidina/hanoman#5](https://github.com/denameidina/hanoman/issues/5) (@RamaAditya49)
- **Tanggal**: 2026-08-19
- **Menyentuh (Execute)**: `src/src/App.tsx` · `src/test/new-project-reverse.test.tsx` ·
  `src/test/new-project-clone.test.tsx` · `internal/docs/product/onboarding.md` ·
  `internal/docs/requirements/frd.md` · `internal/docs/operations/agent-documentation-workflow.md`
- **Keputusan fase**: **Spec dan Plan DILEWATI**. Dua cacat berconfidence tinggi, keduanya di satu
  berkas frontend, akarnya terbaca langsung dari kode dan terbukti gagal-hijau lewat test (§1, §4).
  Dokumen ini jadi doc-of-record perbaikannya.
- **ADR**: tanpa ADR baru. [ADR-0026](../adr/0026-reverse-docs-sesi-interaktif-project-level.md)
  **ditegakkan**, bukan diamandemen: keputusannya berbunyi "dipicu manusia dari UI", dan tombol
  `Tambah/Clone → reverse-engineer docs` **adalah** pemicu manusia itu — yang hilang cuma sambungannya.
  Bentuknya sama persis dengan "pemicu ganda" yang sudah berlaku untuk scaffold
  ([ADR-0052](../adr/0052-scaffold-flow-from-ide.md)).

---

## 1. Gejala dan bukti

Operator menekan CTA yang berbunyi `Tambah → reverse-engineer docs` (mode folder lokal) atau
`Clone → reverse-engineer docs` (mode clone), lalu mendarat di workspace Docs yang **kosong**. Tak ada
sesi apa pun yang lahir; untuk benar-benar memulainya ia harus menemukan sendiri pintu **Reverse docs**
di layar detail project.

Bukan dugaan — `api.reverseDocs` hanya punya **satu** call site di seluruh frontend, dan call site itu
bukan jalur pembuatan project:

| Yang dijanjikan | Di mana | Yang benar-benar terjadi |
|---|---|---|
| label tombol `Tambah/Clone → reverse-engineer docs` | `src/src/App.tsx:552-554` | — |
| deskripsi tab: "hanoman reverse-engineer docs dari codebase yang ada, lalu menyusun Source of Truth-nya" | `src/src/App.tsx:569` | — |
| toast "Project `<id>` dibuat · reverse-engineer docs" | `src/src/App.tsx:889` | `setSection("docs")` — **tak ada `api.reverseDocs`** |
| `api.reverseDocs(project)` | `src/src/App.tsx:955` (fungsi `reverseDocs`) | dipanggil **hanya** oleh prop `onReverse` (`App.tsx:1245`) → pintu manual `ProjectDetailScreen.tsx:162` |

Jalur `from-scratch` di fungsi yang sama membuktikan bahwa yang hilang memang sambungannya, bukan
kemampuannya: `App.tsx:874-886` membaca `autoScaffold`, memanggil `api.scaffoldDocs(created.id)`, lalu
`openTerminal(id)`. Cabang `existing` berakhir dua baris kemudian tanpa padanan itu.

Terukur (empat test baru, `src/test/new-project-reverse.test.tsx`, terhadap kode sebelum perbaikan):
**4 gagal / 4** — `reverseDocs` tak pernah terpanggil pada kedua mode, dan layar yang muncul bukan
Terminal.

## 2. Akar masalah

**(A) Cabang `existing` di `createProject()` tak pernah memulai sesi.** `src/src/App.tsx:887-889`:

```
    setProjectId(created.id); setSection("docs");
    showToast("Project " + created.id + " dibuat · reverse-engineer docs", "ok", "box");
```

Berlaku untuk **kedua** mode existing — folder lokal maupun clone (jalur clone jatuh ke baris yang sama
sesudah `api.cloneProject` + `api.getProject` sukses, `App.tsx:856-866`). Toast-nya menyatakan sebuah
proses; `setSection("docs")` membuka pohon docs project yang menurut definisi **belum disusun**. Dari
sudut operator, itu bukan "belum mulai" melainkan "sudah mulai, tapi hasilnya tak ada" — jalur onboarding
utama untuk existing codebase berhenti sebelum langkah yang menjadi alasan produk ini ada.

**(B) Pintu retry-nya sendiri tak terjangkau untuk project hasil clone.** `src/src/App.tsx:1245-1246`
menggerbangi kedua pintu pada `proj.repoDir` saja:

```
    onReverse={proj.kind === "existing" && proj.repoDir ? … : undefined}
```

`POST /projects/:id/clone` (`server/src/routes/bindings.ts:35-46`) menyimpan hasilnya sebagai
**LocalBinding** (`setBinding`), bukan `Project.repoDir` — mode clone memang mengirim `repoDir:
undefined` (`App.tsx:851`) supaya kegagalan clone tak meninggalkan project setengah jadi (SPEC-218).
Jadi project existing hasil clone permanen ber-`repoDir === null` dengan `binding` terisi, dan pintu
**Reverse docs** miliknya **tak pernah dirender**. Server sudah lama membaca path efektif lewat
`resolveRepoDir` (binding ?? repoDir, SPEC-213/217) dan kartu identitas di layar yang sama pun sudah
menampilkan path efektif (`ProjectDetailScreen.tsx:127`); yang tertinggal cuma gerbang aksinya. Cacat
yang sama mengenai `onScaffold`.

Konsekuensinya berlapis dengan (A): jalur yang paling mungkin gagal (clone) adalah justru jalur yang
sesudahnya **tak punya jalan kembali** — persis kondisi yang dilarang AC-3.

## 3. Yang **bukan** penyebabnya

- Bukan endpoint. `POST /terminal/sessions {project, flow:"reverse"}` utuh dan idempoten:
  id deterministik `reverse-<project>`, pane hidup dipakai ulang (`server/src/routes/terminal.ts:170-200`).
- Bukan gerbang `repoDir` di server. Ia menjawab 400/422 `needsBind` dengan kalimatnya sendiri —
  tak pernah dipanggil karena tak ada pemanggil.
- Bukan setting. `autoScaffold` bermakna khusus from-scratch ("Auto-scaffold doc index — Project
  from-scratch otomatis di-scaffold doc index-nya", `SettingsScreen.tsx:742-745`); tak ada knob yang
  menahan reverse, jadi tak ada konfigurasi yang bisa menjelaskan diamnya.
- Bukan "operator lupa mengisi folder". Mode existing **tak punya** field nama (`App.tsx:589-616`),
  sehingga `canSubmit` untuk mode lokal jatuh ke `!!f.dir.trim()`: folder selalu wajib.

## 4. Keputusan produk (AC-4)

Issue menawarkan dua arah: (i) auto-start reverse, atau (ii) jujurkan CTA jadi `Tambah/Clone project`
dan sodorkan next-step manual. Dipilih **(i)**, dengan tiga alasan:

1. **Sudah dijanjikan di dua tempat sekaligus** — label tombol dan deskripsi tab — dan keduanya lahir
   bersama fitur ini, bukan salah tulis belakangan.
2. **Presedennya ada dan simetris**: from-scratch memulai scaffold-nya sendiri sejak ADR-0052.
   Menurunkan janji existing justru membuat dua jalur onboarding berperilaku berbeda tanpa alasan.
3. **Menekan tombol itulah persetujuannya** — ADR-0026 mensyaratkan pemicu manusia dari UI, dan CTA
   memenuhinya. Karena itu tak ada knob baru: menambah setting untuk menahan sesi yang baru saja
   diminta secara eksplisit hanya menambah keadaan yang harus dijelaskan.

Docs yang menuliskan janji lama ("tombol **Reverse docs**" sebagai satu-satunya pemicu) diperbarui di
commit yang sama supaya AC-4 tetap berlaku ke arah sebaliknya: tak ada dokumen yang tertinggal
mengklaim flow manual.

## 5. Perbaikan

1. **`createProject()` cabang `existing` memulai sesinya** (`App.tsx`): sesudah project (dan clone)
   sukses, panggil `api.reverseDocs(created.id)` lalu `openTerminal(id)`. **Tepat satu** panggilan per
   pembuatan — jalur clone tetap `getProject` dulu supaya binding-nya ada sebelum sesi lahir.
2. **Kegagalan tak membuang project** (AC-3): project yang sudah dibuat dipertahankan, layar berpindah
   ke **detail project** (bukan Docs kosong), dan toast membawa kalimat galat server dari
   `ApiError.detail.error` — bukan `"POST … → 422"` yang tak bisa ditindaklanjuti. Retry-nya adalah
   pintu **Reverse docs** di layar itu; `createProject` tak pernah dipanggil dua kali.
3. **Gerbang pintu memakai path efektif** (`App.tsx`): `proj.binding ?? proj.repoDir`, cermin
   `resolveRepoDir` di server. Berlaku untuk `onReverse` dan `onScaffold`.
4. **Test** (`src/test/new-project-reverse.test.tsx`): mode lokal (AC-1), mode clone termasuk urutan
   binding→sesi (AC-2), jalur gagal + retry tanpa project ganda (AC-3), dan pintu Reverse docs untuk
   project yang hanya punya binding. `new-project-clone.test.tsx` ikut menumbuhkan mock `reverseDocs`
   karena alur yang diujinya kini melewatinya.

## 6. Jebakan yang mengikat

- **Sesi lahir dari `created` yang benar.** Pada mode clone, `created` di-refresh dari `api.getProject`
  supaya binding hasil clone ikut terbaca; memanggil reverse sebelum refresh itu menghasilkan 400
  `needsBind` untuk project yang sebetulnya sehat. Urutannya dikunci test.
- **Idempotensi datang dari server, bukan dari UI.** `reverse-<project>` memakai id deterministik dan
  pane hidup dipakai ulang (ADR-0015/SPEC-394), jadi retry manual sesudah kegagalan parsial tak pernah
  melahirkan sesi kedua.
- **Pesan galat wajib dari `detail.error`.** `ApiError.message` yang dibentuk `client.ts:103` berbunyi
  `POST /api/terminal/sessions → 422`; kalimat yang bisa ditindaklanjuti hidup di body JSON.
