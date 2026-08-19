# ADR-0125 — Satu kontrak konfirmasi destruktif: `useConfirm()`, `window.confirm` nol di produk

Status: accepted · 2026-08-19

## Konteks

Frontend punya `ConfirmDialog` (SPEC-269, diperluas ADR-0121 dengan `requireText`) di atas `Modal`,
dan lima permukaan memakainya. Lima belas aksi destruktif lain — beberapa berdampak jauh lebih besar
— memakai `window.confirm()` native: hapus project (cascade seluruh Spec), rename `Project.id`
(merusak link Help publik + merambat ke hub), hapus dokumen Source of Truth dari disk, hapus user,
cabut device/agent token, purge activity log, nonaktifkan Help Center, dan empat mutasi VPS termasuk
harden yang berisiko lockout.

Akarnya bukan kelalaian, dan itu penting karena menentukan bentuk perbaikannya.
**`window.confirm` sinkron**, jadi ia disisipkan di tengah fungsi async sebagai satu baris.
**`ConfirmDialog` deklaratif**, jadi memakainya menuntut state `pending`, memindahkan sisa fungsi ke
callback, dan merender elemen — ±15 baris per aksi. Jalur yang benar adalah jalur yang mahal.
Inkonsistensinya karena itu telanjang di satu berkas yang sama: `TriageScreen` memakai
`ConfirmDialog` untuk *hapus tiket* dan `window.confirm` untuk *tolak tiket*. Memigrasikan 15 call
site tanpa menutup akar ini hanya menunda call site ke-16.

Efeknya terukur pada test, bukan kosmetik. `window.confirm` di jsdom memulangkan `undefined`
(falsy), jadi setiap flow berhenti di baris pertamanya kecuali test-nya mem-mock. Hanya **dua**
berkas test yang mem-mock; `deleteProject`, `deleteUser`, `revokeDeviceToken`,
`purgeSessionResults`, `deleteVps`, `hardenVps`, dan `deleteChangelog` **tak punya satu pun test
yang menekan tombolnya**.

## Keputusan

1. **`useConfirm()` memulangkan `{ confirm, dialog }`.** `confirm(options)` sebuah `Promise<boolean>`,
   sehingga call site berubah satu baris (`if (!window.confirm(x)) return;` →
   `if (!await confirm({…})) return;`) dengan alur kontrol utuh. Gerbangnya adalah **bentuk
   pemanggilan**: selama bentuk semurah itu tak ada, "pakai `ConfirmDialog`" adalah imbauan, bukan
   kontrak.
2. **Lokal per komponen, bukan Provider di akar App.** `dialog` dirender pemanggilnya sendiri.
   Alternatif Provider + `useContext` ditolak karena diuji langsung oleh repo ini: layar dirender
   berdiri sendiri di test (`render(<VpsChecklist …/>)`), jadi Provider berarti tiap test semacam
   itu harus dibungkus — atau memakai nilai default context yang diam-diam menjawab "batal" (flow
   mati senyap) atau "ya" (konfirmasi hilang senyap). Keduanya gagal **tanpa satu pun error**.
3. **Opsi `run` untuk pending protection.** Bila diberikan, dialog tetap terbuka dan `busy` selama
   mutasi berjalan — cancel, confirm, tombol Tutup, Escape, dan klik overlay semuanya mati
   (`ConfirmDialog` sudah meneruskan `onClose={busy ? undefined : onCancel}`). Tanpa `run`, submit
   ganda mustahil by construction: promise-nya diselesaikan tepat sekali dan dialognya lenyap.
4. **`confirm()` melempar bila `run` melempar; `false` HANYA untuk pembatalan.** Menerjemahkan
   kegagalan mutasi jadi `false` membuat call site menelan error. Dengan melempar, `try/catch` call
   site berperilaku persis seperti saat mutasinya ditulis inline — itulah yang menjaga penanganan
   409 `deleteProject` dan 400 "user terakhir" tetap hidup.
5. **`ConfirmDialog` diperluas `impact` dan `icon`; tombol konfirmasi mengikuti severity.** `impact`
   merender daftar `<ul>` untuk dampak berbaris-baris (rename project, harden VPS) yang sebelumnya
   dipadatkan jadi satu string `\n`-terpisah. `icon` membebaskan aksi yang bukan hapus dari ikon
   `trash-2`. Tombol konfirmasi memakai `variant="danger"` DS (`--clay-600`) saat `tone="danger"`,
   menggantikan `primary` — mengubah tampilan lima pemakai lama, disengaja, semuanya memang hapus.
6. **AC-4 ditegakkan atas SUMBER.** `src/test/confirm-inventory.test.ts` + `helpers/native-confirm.ts`
   memindai `src/src/**`, mencerminkan `placeholder-contract.test.ts` (SPEC-490). Repo tak memakai
   ESLint, jadi test pemindai adalah satu-satunya penegakan yang tersedia — dan `window.confirm` tak
   punya jejak di pohon render, sehingga tak ada test render yang akan menangkap call site baru.
7. **Satu pengecualian, beralasan: `GitGraph.tsx` "Dorong tag ke origin?".** Ia bukan gerbang
   destruktif — jawabannya adalah **nilai** `push`, bukan izin, dan membatalkannya tetap membuat
   tag. Merendernya sebagai `ConfirmDialog` justru menipu: tombol "Batal" yang tetap mengeksekusi.
   Bentuk benarnya modal form bersama dua `window.prompt` di sekitarnya; itu di luar scope SPEC-847
   yang menyoal `window.confirm`.
8. **`Modal` tidak disentuh.** `role="dialog"` + `aria-modal` + `aria-labelledby`, focus trap
   Tab/Shift-Tab ber-stack, focus restore ke pemicu, dan Escape yang inert saat `busy` sudah ada di
   sana. AC a11y dipenuhi dengan **mengunci perilaku itu lewat test**, bukan menulis ulang.

## Konsekuensi & gotcha

1. **Lupa merender `{dialog}` = promise menggantung selamanya** — tanpa error, tanpa gejala selain
   "tombolnya tak melakukan apa-apa". Penjaganya bukan disiplin melainkan test inventaris, yang
   menghitung `= useConfirm(` vs `{dialog}` per berkas. Karena itu nama hasil destructuring **wajib**
   `dialog`; `confirm` boleh di-alias saat bentrok nama (`TriageScreen` sudah punya state `confirm`,
   jadi hook-nya `askConfirm`).
2. **Pemindai yang diam-diam berhenti memberi gejala identik dengan "semua lulus".** Karena itu test
   inventaris menegaskan jumlah berkas terpindai (> 40) **dan** jumlah call site (≥ 8) sebelum
   memfilter — pelajaran `placeholder-contract`.
3. **Sumber kebenaran anti-klik-ganda adalah `useRef`, bukan state.** Klik kedua pada tombol
   konfirmasi tiba sebelum React sempat me-render ulang dengan tombol yang sudah mati; `live.current`
   dikosongkan **sebelum** `await run()`.
4. **Fokus awal jatuh ke tombol "Tutup" di header `Modal`, bukan "Batal" di footer** — kontrol aman,
   jadi kontrak "focus masuk ke kontrol aman" terpenuhi. Memindahkannya ke "Batal" menuntut prop
   `initialFocus` baru di `Modal` yang menyentuh ±20 modal lain, dan React `autoFocus` **tidak**
   cukup: ia di-override oleh `initial?.focus()` di layout effect `Modal`, yang berjalan sesudah
   `commitMount` anaknya.
5. **Focus restore hanya bisa menyasar node yang masih ada.** Pada apply remediasi VPS, konfirmasi
   yang sukses memanggil `clearSel()` dan toolbar Apply hanya dirender saat `selected.size > 0` —
   pemicunya lenyap, jadi fokus jatuh ke `body`. Bukan bug: focus restore diuji di jalur batal, di
   mana pemicunya bertahan.
6. **`ConfirmDialog` bisa hidup di dalam `Modal` lain** (checklist VPS). `modalStack` membuat Escape
   dan focus trap menyasar dialog teratas, tapi berarti `getByRole("dialog")` di test bisa cocok
   lebih dari satu — sempitkan ke elemen terakhir.
7. **`Icon` kini memancarkan `data-icon={name}`.** Tanpa itu kontrak ikon tak bisa diuji tanpa
   menyentuh internal `lucide-react`.

## Alternatif yang ditolak

- **Provider global `<ConfirmProvider>`** — lihat keputusan 2: nilai default context gagal senyap ke
  dua arah, dan setiap test layar berdiri sendiri harus dibungkus.
- **Migrasi manual 15 call site ke `<ConfirmDialog>` inline tanpa primitif** — menutup gejala hari
  ini dan membiarkan akarnya (jalur benar lebih mahal daripada jalur salah) utuh.
- **Aturan ESLint `no-restricted-globals`** — repo tak memakai ESLint sama sekali; menambah toolchain
  untuk satu aturan lebih mahal daripada satu berkas test pemindai yang polanya sudah ada (SPEC-490).
- **Mengubah urutan fokus awal `Modal` secara global** — menyentuh ±20 modal untuk memenuhi huruf
  sebuah AC yang isinya sudah terpenuhi.
