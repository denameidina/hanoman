# Audit SPEC-847 — 15 destructive flow memakai `window.confirm`, melewati `ConfirmDialog`

**Sumber:** GitHub issue [denameidina/hanoman#6](https://github.com/denameidina/hanoman/issues/6) (@RamaAditya49) · severity **major**
**Status:** temuan terkonfirmasi lewat inspeksi sumber + inventaris test. Keputusan: **Spec → Plan → Execute penuh** (luas: 15 call site di 9 berkas, menyentuh kontrak DS bersama).

## Ringkasan

Frontend punya `ConfirmDialog` (SPEC-269, diperluas ADR-0121 dengan `requireText`) di atas `Modal`
(`ds/kit.tsx`) yang sudah memberi focus trap, Escape, focus restore, `aria-modal`, dan `busy`.
Lima permukaan memakainya (`BranchesPanel`, `TriageScreen`, `WebhooksPanel`, `IdeScreen`,
`SettingsScreen`/Telegram). **Lima belas** aksi destruktif lain — beberapa dengan dampak jauh lebih
besar — memakai `window.confirm()` native.

Ini bukan sekadar inkonsistensi visual. Ia punya akar struktural yang bisa dinamai, dan konsekuensi
yang terukur pada test.

## Akar masalah

`window.confirm()` **sinkron dan memblokir**. Karena itu ia bisa dipakai *di tengah* sebuah fungsi
async tanpa memecah alur kontrol:

```ts
if (!window.confirm("Hapus project …?")) return;
await api.deleteProject(p.id);
```

`ConfirmDialog` **deklaratif**: memakainya menuntut call site menyimpan state `pending`, memindahkan
sisa fungsi ke callback `onConfirm`, dan merender elemen dialog. Itu ±15 baris boilerplate per aksi.
Jadi setiap kali seorang penulis menghadapi aksi destruktif baru, jalur termurah adalah `window.confirm`
— dan yang mahal adalah jalur yang benar. Hasilnya terlihat paling telanjang di **satu berkas yang
sama**: `TriageScreen.tsx` memakai `ConfirmDialog` untuk *hapus tiket* (baris 221) dan `window.confirm`
untuk *tolak tiket* (baris 104).

**Akarnya bukan "orang lupa memakai komponen", melainkan tidak adanya bentuk pemanggilan yang
seharga `window.confirm`.** Selama bentuk itu tak ada, migrasi 15 call site hari ini akan diikuti
call site ke-16 besok.

## Inventaris — 15 pemakaian

| # | Berkas:baris | Aksi | Dampak | Bentuk |
|---|---|---|---|---|
| 1 | `src/src/App.tsx:816` | rename Project.id | link Help publik rusak + sync ke hub ikut berganti | gerbang di tengah fungsi |
| 2 | `src/src/App.tsx:894` | hapus project | cascade seluruh Spec | gerbang |
| 3 | `src/src/screens/DocsWorkspace.tsx:175` | hapus doc SoT | berkas di disk dihapus | gerbang |
| 4 | `src/src/screens/ChangelogScreen.tsx:102` | hapus changelog | — | gerbang |
| 5 | `src/src/screens/TriageScreen.tsx:104` | tolak & tutup tiket | tak membuat backlog | gerbang |
| 6 | `src/src/screens/SettingsScreen.tsx:150` | hapus user | seluruh sesinya dicabut | gerbang |
| 7 | `src/src/screens/SettingsScreen.tsx:202` | cabut device token | perangkat berhenti sync | gerbang |
| 8 | `src/src/screens/SettingsScreen.tsx:248` | purge activity log | append-only log dihapus | gerbang |
| 9 | `src/src/screens/SettingsScreen.tsx:391` | cabut agent token | agen kehilangan akses seketika | gerbang |
| 10 | `src/src/screens/ProjectDetailScreen.tsx:33` | nonaktifkan Help Center | link publik berhenti menerima | gerbang |
| 11 | `src/src/screens/GitGraph.tsx:133` | "Dorong tag ke origin?" | **bukan gerbang** — jawabannya nilai `push` | pertanyaan bernilai |
| 12 | `src/src/screens/VpsChecklist.tsx:168` | apply remediasi AUTO ke VPS | mutasi server produksi | gerbang |
| 13 | `src/src/screens/VpsChecklist.tsx:187` | tandai seksi N/A massal | menutup temuan audit | gerbang |
| 14 | `src/src/screens/VpsScreen.tsx:110` | harden VPS | firewall/SSH/fail2ban — risiko lockout | gerbang |
| 15 | `src/src/screens/VpsScreen.tsx:126` | hapus registrasi VPS | — | gerbang |

Empat belas di antaranya **gerbang izin** (batal = tak terjadi apa-apa). Satu — `GitGraph:133` —
bukan: membatalkannya **tetap membuat tag**, hanya tanpa push. Ia adalah *input boolean* yang
menyamar sebagai konfirmasi, hidup di antara dua `window.prompt`.

## Bukti terukur: flow yang tak pernah diuji

`window.confirm` di jsdom memulangkan `undefined` (falsy), jadi setiap flow di atas **berhenti di
baris pertamanya** pada test render — kecuali test itu mem-*mock* `window.confirm`. Hanya **dua**
berkas test yang melakukannya (`project-help-center.test.tsx:55`, `vps-checklist.test.tsx:135,150`).

Konsekuensinya, sebagian besar aksi destruktif produk **tak punya satu pun test yang menekan
tombolnya**. Diperiksa lewat inventaris pemanggilan API di `src/test`:

| API | dites lewat UI? |
|---|---|
| `deleteProject` | tidak ada rujukan sama sekali |
| `deleteUser`, `revokeDeviceToken`, `purgeSessionResults`, `deleteVps`, `hardenVps`, `deleteChangelog` | tidak ada rujukan sama sekali |
| `revokeAgentToken` | hanya di-`vi.fn()` sebagai mock modul — tak ada test yang mengekliknya |
| `rejectTicket` | hanya di-`vi.fn()` — tak ada test yang menekan "Tolak" |
| `deleteDoc` | hanya di `client.test.ts` (lapis HTTP), bukan flow |
| `disableHelpCenter`, `remediate`, `markNaBulk` | ada, **karena** test-nya mem-mock `window.confirm` |

Jadi klaim pelapor "acceptance/UI tests bergantung pada mock `window.confirm`, bukan perilaku
user-facing" **understated**: untuk delapan aksi, testnya bahkan tak ada.

## Yang sudah benar (jangan dibangun ulang)

`Modal` (`ds/kit.tsx:45-152`) sudah memenuhi sebagian besar kontrak interaksi yang diminta issue:

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` ke judul (baris 114-116).
- Focus trap Tab/Shift-Tab dengan stack modal bertingkat (baris 61-90).
- **Focus restore** ke elemen pemicu di cleanup (`previous?.focus()`, baris 96).
- Escape → `onClose`, dan `ConfirmDialog` meneruskan `onClose={busy ? undefined : onCancel}`
  (`ConfirmDialog.tsx:26`) sehingga **Escape sudah inert saat pending**.
- Focus awal jatuh ke input pertama, jika tak ada ke tombol pertama — di `ConfirmDialog` tanpa
  `requireText` itu adalah tombol **"Tutup"** di header, yaitu kontrol aman (membatalkan). AC-3
  ("focus masuk ke kontrol aman") karena itu **sudah terpenuhi tanpa mengubah `Modal`**; mengubah
  urutan fokus global akan menyentuh ±20 modal lain tanpa kebutuhan.

Yang **belum** ada di `ConfirmDialog`: daftar dampak terstruktur, ikon non-`trash-2` untuk aksi yang
bukan hapus (rename/cabut/nonaktifkan/apply), dan warna tombol yang mengikuti severity — tombol
konfirmasi hari ini `variant="primary"` (kuningan) walau `tone="danger"`, padahal DS punya
`variant="danger"` (`--clay-600`, `ds/components/forms.tsx:17`).

## Arah perbaikan

Satu primitif baru, bukan 15 refactor manual: **`useConfirm()`** di `ds/`, yang memulangkan
`{ confirm, dialog }` dan membuat bentuk pemanggilan seharga native:

```ts
const { confirm, dialog } = useConfirm();
…
if (!await confirm({ title: `Hapus project "${p.name}"?`, impact: [...] })) return;
```

**Lokal per komponen, bukan Provider di akar App.** Alasannya diuji langsung oleh repo ini: layar
dirender berdiri sendiri di test (`render(<VpsChecklist …/>)`), dan Provider berarti setiap test
semacam itu harus dibungkus — atau memakai nilai default yang diam-diam menjawab "batal"/"ya".
Bentuk `{ confirm, dialog }` tak punya kopling lintas-pohon dan merupakan evolusi langsung dari
pola `<ConfirmDialog>` yang sudah dipakai lima layar.

Footgun-nya nyata dan disebut di muka: komponen yang memanggil `useConfirm()` tapi lupa merender
`{dialog}` membuat promise-nya menggantung selamanya. Itu dijaga test inventaris sumber yang sama
yang menegakkan AC-4.

Pending protection (AC-2) lewat opsi `run`: bila diberikan, dialog **tetap terbuka & busy** selama
mutasi berjalan (cancel/confirm/Tutup/Escape mati), lalu tutup; bila `run` melempar, `confirm()`
ikut melempar sehingga `try/catch` call site berperilaku persis seperti saat mutasi ditulis inline.

Penegakan AC-4 lewat test pemindai sumber — polanya sudah ada di repo: `placeholder-contract.test.ts`
+ `helpers/form-fields.ts` (SPEC-490) memindai `src/src` dan menuntut setiap pengecualian menyebut
alasannya lewat komentar. `confirm-inventory.test.ts` mencerminkannya.

**Satu pengecualian yang didokumentasikan:** `GitGraph.tsx:133`. Ia bukan gerbang destruktif —
membatalkannya tetap membuat tag — jadi merendernya sebagai `ConfirmDialog` justru menipu ("Batal"
yang tetap mengeksekusi). Bentuk benarnya adalah modal form (nama + pesan + checkbox "dorong ke
origin") yang sekaligus menggantikan dua `window.prompt` di sekitarnya. `window.prompt` di luar
scope issue ini (yang menyebut `window.confirm`), dan `GitGraph` belum punya modal sama sekali, jadi
mengerjakannya di sini menukar fokus dengan risiko. Dicatat sebagai tindak lanjut.

## Pemetaan ke acceptance criteria issue

| AC | Cara dipenuhi |
|---|---|
| AC-1 dialog aplikasi dengan nama objek, dampak, label aksi | `ConfirmDialog` + prop baru `impact` (daftar `<ul>`); tiap call site menyebut nama objeknya |
| AC-2 pending menonaktifkan close/cancel/confirm | opsi `run` di `useConfirm` → `busy` selama mutasi; `onClose` sudah `undefined` saat busy |
| AC-3 focus aman, focus restore, Escape membatalkan bila belum pending | sudah ada di `Modal`; dikunci test, bukan diasumsikan |
| AC-4 tak ada `window.confirm` untuk destructive product flow | `confirm-inventory.test.ts` memindai `src/src`; pengecualian wajib menyebut alasan |
| RTL test cancel/confirm/Escape/focus restore/double-click | pada delete project, delete doc, revoke token, apply VPS (minimum yang diminta issue) |

## Tindak lanjut di luar scope

- `window.prompt` masih dipakai `GitGraph.tsx:128` (nama branch), `:131-132` (nama & pesan tag),
  `:172` (rename branch). Butuh modal form, bukan `ConfirmDialog`.
- Focus awal `Modal` jatuh ke tombol "Tutup" di header, bukan "Batal" di footer. Aman, tapi kalau
  suatu saat diinginkan, butuh prop `initialFocus` di `Modal` (React `autoFocus` **tidak** cukup:
  ia di-override oleh `initial?.focus()` di layout effect `Modal`, yang berjalan sesudah
  `commitMount` anak).
