# SPEC-847 — Satu kontrak konfirmasi destruktif (`useConfirm`), `window.confirm` dicabut dari produk

**Tanggal:** 2026-08-19 · **Source:** qa (GitHub issue #6, @RamaAditya49) · **Prioritas:** sedang
**ADR:** 0125 (baru) · **Migration:** tidak ada · **Endpoint:** tidak ada · **Skema:** tidak ada
**Audit:** [`internal/docs/research/audit-spec-847-destructive-confirm-native.md`](../../../internal/docs/research/audit-spec-847-destructive-confirm-native.md)

## Masalah

Lima belas aksi destruktif frontend memakai `window.confirm()` native, sementara `ConfirmDialog`
(SPEC-269 · ADR-0121) sudah ada dan dipakai lima permukaan lain. Inkonsistensinya telanjang di satu
berkas: `TriageScreen` memakai `ConfirmDialog` untuk *hapus tiket* dan `window.confirm` untuk *tolak
tiket*.

Akarnya bukan kelalaian. `window.confirm` **sinkron** — ia bisa disisipkan di tengah fungsi async
sebagai satu baris. `ConfirmDialog` **deklaratif** — memakainya menuntut state `pending`, memindahkan
sisa fungsi ke callback, dan merender elemen. Jalur yang benar adalah jalur yang mahal, jadi setiap
aksi destruktif baru lahir sebagai `window.confirm` lagi. Memigrasikan 15 call site tanpa menutup
akar ini hanya menunda call site ke-16.

Efeknya terukur pada test, bukan cuma kosmetik: `window.confirm` di jsdom memulangkan `undefined`
(falsy), jadi setiap flow berhenti di baris pertamanya kecuali test-nya mem-mock. Hanya dua berkas
test yang mem-mock; `deleteProject`, `deleteUser`, `revokeDeviceToken`, `purgeSessionResults`,
`deleteVps`, `hardenVps`, dan `deleteChangelog` **tak punya satu pun test yang menekan tombolnya**.

## Keputusan

### 1. `useConfirm()` — bentuk pemanggilan seharga `window.confirm`

Primitif baru `src/src/ds/useConfirm.tsx`:

```ts
const { confirm, dialog } = useConfirm();
…
if (!await confirm({ title: `Hapus project "${p.name}"?`, impact: […] })) return;
```

Call site berubah satu baris (`window.confirm(...)` → `await confirm({...})`), alur kontrolnya utuh.
Ini gerbang utama keputusan ini: selama bentuk murah itu tak ada, aturan "pakai `ConfirmDialog`"
adalah imbauan, bukan kontrak.

### 2. Lokal per komponen — **bukan** Provider di akar App

`useConfirm()` memulangkan `dialog` yang **dirender pemanggilnya sendiri**. Alternatif Provider +
`useContext` ditolak karena diuji langsung oleh repo ini: layar dirender berdiri sendiri di test
(`render(<VpsChecklist …/>)`, `render(<TriageScreen …/>)`), jadi Provider berarti tiap test semacam
itu harus dibungkus — atau memakai nilai default context yang diam-diam menjawab "batal" (flow mati
senyap) atau "ya" (konfirmasi hilang senyap). Keduanya gagal tanpa satu pun error.

Bentuk `{ confirm, dialog }` juga evolusi langsung dari pola yang sudah dipakai lima layar: state
dialog tetap lokal, hanya alur kontrolnya yang berbalik.

**Harganya dinyatakan:** komponen yang memanggil `useConfirm()` tapi lupa merender `{dialog}`
membuat promise-nya menggantung selamanya — tanpa error, tanpa gejala selain "tombolnya tak
melakukan apa-apa". Karena itu penjaganya bukan disiplin melainkan test pemindai sumber yang sama
yang menegakkan AC-4 (§5).

### 3. `run` — pending protection yang benar-benar menahan submit ganda

Opsi `run?: () => Promise<unknown>`:

- **tanpa `run`** — dialog tutup saat Confirm diklik, `confirm()` resolve `true`. Submit ganda mustahil
  by construction: promise-nya diselesaikan tepat sekali (dijaga ref `settled`), klik kedua tak punya
  dialog untuk diklik.
- **dengan `run`** — dialog **tetap terbuka & `busy`** selama mutasi berjalan. Cancel, Confirm, tombol
  Tutup, Escape, dan klik overlay semuanya mati (`ConfirmDialog` sudah meneruskan
  `onClose={busy ? undefined : onCancel}`). Sesudah selesai dialog tutup dan `confirm()` resolve `true`.
- bila `run` **melempar**, dialog tutup dan `confirm()` ikut **melempar** — jadi `try/catch` call site
  berperilaku persis seperti saat mutasinya ditulis inline. Nilai balik `false` disediakan **hanya**
  untuk pembatalan, tak pernah untuk kegagalan; mencampur keduanya membuat call site menelan error.

`run` dipakai pada aksi yang mutasinya langsung menyusul konfirmasi. Aksi yang konfirmasinya gerbang
di tengah alur lebih panjang (rename `Project.id` di `App.updateProject`, yang diikuti
`updateProject` + binding + refetch) tetap memakai bentuk gerbang tanpa `run`.

### 4. `ConfirmDialog` diperluas: `impact`, `icon`, dan tombol yang mengikuti severity

- **`impact?: React.ReactNode[]`** — daftar dampak terstruktur (`<ul>`), memenuhi AC-1 untuk aksi
  yang dampaknya berbaris-baris (rename project, harden VPS). Hari ini teksnya dipadatkan ke satu
  string `\n`-terpisah di prompt browser.
- **`icon?: string`** — override ikon header. Default tetap turunan `tone` (`trash-2` / `help-circle`),
  jadi lima pemakai lama tak berubah. Aksi yang bukan hapus (rename, cabut token, nonaktifkan,
  apply) memakai ikonnya sendiri, sesuai permintaan issue "jangan memaksa semua action memakai ikon
  trash".
- Tombol konfirmasi memakai **`variant="danger"`** saat `tone === "danger"` (hari ini `primary`).
  DS sudah punya varian itu (`--clay-600`, `ds/components/forms.tsx:17`); memakainya membuat severity
  terbaca dari warna, bukan cuma dari kata. Ini mengubah tampilan lima pemakai lama — disengaja,
  semuanya memang aksi hapus.

### 5. AC-4 ditegakkan atas SUMBER: `src/test/confirm-inventory.test.ts`

Polanya sudah ada di repo — `placeholder-contract.test.ts` + `helpers/form-fields.ts` (SPEC-490)
memindai `src/src` dan menuntut tiap pengecualian menyebut alasannya. Test ini mencerminkannya dan
menegakkan tiga hal:

1. `window.confirm` / `confirm(` telanjang tak muncul di `src/src/**` — kecuali baris yang didahului
   komentar `confirm-exempt: <alasan ≥ 12 karakter>`.
2. Scanner-nya benar-benar memindai (jumlah berkas > 40) — scanner yang diam-diam berhenti memberi
   gejala identik dengan "semua lulus" (pelajaran `placeholder-contract`).
3. Setiap berkas yang memanggil `useConfirm(` juga merender `{dialog}` — penjaga footgun §2.

### 6. Satu pengecualian, disebutkan: `GitGraph.tsx:133`

"Dorong tag ke origin?" **bukan gerbang destruktif** — membatalkannya tetap membuat tag, hanya tanpa
push. Ia input boolean yang menyamar sebagai konfirmasi. Merendernya sebagai `ConfirmDialog` justru
menipu: tombol "Batal" yang tetap mengeksekusi. Bentuk benarnya modal form (nama + pesan + checkbox
push) yang sekaligus menggantikan dua `window.prompt` di sekitarnya — di luar scope issue ini (yang
menyebut `window.confirm`), dan `GitGraph` belum punya modal sama sekali. Ditandai
`confirm-exempt:` dengan alasannya, dan dicatat sebagai tindak lanjut.

### 7. `Modal` tidak disentuh

`ds/kit.tsx` sudah memberi `role="dialog"` + `aria-modal` + `aria-labelledby`, focus trap Tab/Shift-Tab
ber-stack, focus restore ke pemicu, dan Escape yang inert saat `busy`. AC-3 karena itu dipenuhi
**dengan mengunci perilaku yang sudah ada lewat test**, bukan dengan menulis ulang.

Focus awal jatuh ke tombol **"Tutup"** di header (kontrol aman: ia membatalkan), bukan "Batal" di
footer. Issue menyebut "initial focus aman (Cancel)"; huruf ACnya — kontrol aman — terpenuhi.
Memindahkannya ke Cancel menuntut prop `initialFocus` baru di `Modal` yang menyentuh ±20 modal lain
tanpa kebutuhan, dan React `autoFocus` **tidak** cukup: ia di-override oleh `initial?.focus()` di
layout effect `Modal`, yang berjalan sesudah `commitMount` anaknya.

## Ruang lingkup perubahan

| Berkas | Aksi | Bentuk | Ikon |
|---|---|---|---|
| `App.tsx:816` | rename `Project.id` | gerbang + `impact` 3 baris | `pencil` |
| `App.tsx:894` | hapus project | `run` + `impact` | default `trash-2` |
| `DocsWorkspace.tsx:175` | hapus doc SoT | `run` | `trash-2` |
| `ChangelogScreen.tsx:102` | hapus changelog | `run` | `trash-2` |
| `TriageScreen.tsx:104` | tolak tiket | gerbang (busy layar sudah ada) | `x-circle` |
| `SettingsScreen.tsx:150` | hapus user | `run` | `trash-2` |
| `SettingsScreen.tsx:202` | cabut device token | `run` | `key-round` |
| `SettingsScreen.tsx:248` | purge activity log | `run` | `trash-2` |
| `SettingsScreen.tsx:391` | cabut agent token | `run` | `key-round` |
| `ProjectDetailScreen.tsx:33` | nonaktifkan Help Center | gerbang | `ban` |
| `VpsChecklist.tsx:168` | apply remediasi | gerbang + `impact` | `shield` |
| `VpsChecklist.tsx:187` | tandai seksi N/A | gerbang | `shield` |
| `VpsScreen.tsx:110` | harden VPS | gerbang + `impact` | `shield` |
| `VpsScreen.tsx:126` | hapus registrasi VPS | gerbang | `trash-2` |
| `GitGraph.tsx:133` | dorong tag | **exempt**, beralasan | — |

## Test

RTL, minimum yang diminta issue — **hapus project, hapus doc, cabut token, apply VPS** — masing-masing
menguji: batal, konfirmasi, Escape, focus restore ke pemicu, dan klik ganda/pending.

Plus: unit `useConfirm` (resolve sekali, `run` menahan busy, `run` melempar → `confirm()` melempar),
kontrak `ConfirmDialog` baru (`impact`, `icon`, varian tombol), dan `confirm-inventory`.

Dua berkas test yang hari ini mem-mock `window.confirm` (`project-help-center.test.tsx`,
`vps-checklist.test.tsx`) berpindah menekan tombol dialog sungguhan — itulah perbaikan yang diminta
AC-4 ("bukan mock, perilaku user-facing").

## Bukan bagian dari spec ini

- `window.prompt` di `GitGraph.tsx:128,131,132,172` — butuh modal form, bukan `ConfirmDialog`.
- Prop `initialFocus` di `Modal` (§7).
- Perubahan server/API/skema apa pun: nihil.
