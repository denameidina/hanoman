# Audit SPEC-851 — tag dari commit yang belum masuk `main` tetap eligible untuk publish

## Putusan

Temuan berconfidence tinggi, akar masalahnya tunggal dan diverifikasi langsung terhadap konfigurasi
repo yang hidup, dan perbaikannya lokal di satu workflow + satu skrip gerbang. **Spec dan Plan
dilewati**; dokumen ini menjadi doc-of-record untuk Execute. Tak ada perubahan skema, endpoint,
payload, maupun keputusan arsitektur baru: perbaikan **menegakkan** prosedur rilis yang sudah jadi
Source of Truth di `internal/docs/operations/release-npm.md` dan ADR-0087, yang selama ini hanya
berupa konvensi manusia.

## Laporan dan batas bukti

GitHub issue [denameidina/hanoman#2](https://github.com/denameidina/hanoman/issues/2) (@RamaAditya49):
workflow publish dipicu setiap tag `v*` dan satu-satunya gerbang terhadap sumbernya adalah
`tag == package.json.version`; tak ada verifikasi bahwa commit yang ditag sudah masuk `main`,
padahal runbook mensyaratkan merge ke `main` sebelum tag.

Audit dijalankan pada commit dasar `da3967af` (`v0.1.46`). Buktinya tiga lapis: pembacaan
`.github/workflows/release.yml` apa adanya, kueri **konfigurasi GitHub yang hidup** lewat `gh api`,
dan **reproduksi git nyata** di repo temporer untuk menguji perilaku `merge-base` di clone dangkal.
Publish sungguhan tidak dijalankan — nomor versi npm tak bisa dipakai ulang, jadi eksperimen
publish adalah tindakan yang tak bisa dibatalkan.

## Temuan 1 — klaim inti issue benar apa adanya

`.github/workflows/release.yml` memicu pada `push` `tags: ["v*"]` (baris 18–20), melakukan
`actions/checkout@v4` **tanpa parameter apa pun** (baris 40), lalu memasang tiga gerbang: tag ==
`package.json.version` (baris 60–69), tarball dipasang dan `hanoman --version` diuji, dan
`repository.url` yang dijaga `cli/test/pack.test.ts`. Tak ada `fetch-depth`, tak ada fetch
`origin/main`, tak ada `merge-base`, tak ada pemeriksaan containment branch mana pun.

`actions/checkout` default `fetch-depth: 1`, dan untuk `push` bertag ia mengambil **hanya refspec
tag itu** (`+<sha>:refs/tags/vX.Y.Z`) — bukan seluruh branch. Jadi bukan sekadar "gerbangnya belum
ditulis": bahannya pun tak ada di runner. Direproduksi: pada clone `--depth 1 --branch <tag>`,
`git rev-parse origin/main` gagal karena refnya tidak ada sama sekali.

## Temuan 2 — pagar yang diasumsikan issue sebenarnya sudah dicabut

Issue menutup dengan "Approval environment adalah human gate, tetapi UI approval tidak otomatis
membuktikan ancestry commit". Premis itu **sudah tidak berlaku**, dan itu menaikkan severity, bukan
menurunkannya. Kueri konfigurasi hidup:

```
gh api repos/denameidina/hanoman/rulesets              → []
gh api repos/denameidina/hanoman/environments/release  → protection_rules: []
                                                         deployment_branch_policy: null
```

Tak ada ruleset tag, tak ada required reviewer, tak ada kebijakan branch/tag pada environment
`release`. Ini konsisten dengan `internal/docs/operations/release-npm.md` langkah 3 yang mencatat
gerbang manusia **dicabut 2026-07-31**: "mendorong tag `v*` = menerbitkan ke npm, titik", termasuk
oleh sesi agen. Environment `release` tetap ada semata sebagai bagian identitas OIDC (`--env
release`), **bukan** pagar.

Artinya rantai lengkap dari "seseorang bisa mendorong tag" ke "npm menerbitkan artefak" tak
melewati satu pun titik yang memeriksa apakah kodenya pernah direview atau masuk `main`. Tabel
"Pagar yang tak bergantung penilaian siapa pun" di runbook memuat tiga baris, dan **tak satu pun**
menyentuh asal-usul commit — hanya kebenaran nomor versi dan kebisaan-jalan artefaknya.

## Temuan 3 — `fetch-depth: 0` bukan detail kosmetik; clone dangkal menjawab SALAH

Rekomendasi issue (`git merge-base --is-ancestor "$GITHUB_SHA" origin/main`) benar arahnya tetapi
tak cukup bila dipasang di atas checkout default. Diukur di repo temporer, `main` berisi 8 commit
dan tag menunjuk commit ke-6 dari ujung — **commit yang jelas-jelas ada di `main`**:

| Kondisi clone | `rev-list --count origin/main` | `merge-base --is-ancestor` | Jawaban benar |
|---|---|---|---|
| `--depth 1` + fetch `main` dangkal | 1 | exit **1** (ditolak) | 0 (lulus) |
| clone penuh + fetch `main` | 8 | exit **0** (lulus) | 0 (lulus) |

Jadi gerbang di atas clone dangkal **memblokir rilis yang sah** dengan pesan "commit belum masuk
main" padahal commitnya ada di sana. Arahnya satu jurusan: `--is-ancestor` hanya bisa menjawab 0
kalau ia benar-benar menelusuri objeknya, dan graft shallow membuat commit batas tampak tanpa
induk — ia bisa kehilangan jejak, tak bisa mengarang jejak. Karena itu clone dangkal menghasilkan
**false negative** (rilis sah tertolak), bukan false positive (tag liar lolos). Dampaknya
ketersediaan, bukan keamanan — tetapi kegagalannya menyesatkan dan akan memancing orang mencabut
gerbangnya.

Konsekuensi desain: gerbang wajib **fail closed saat repo masih dangkal**, bukan diam-diam menjawab
dari data yang tak lengkap. Kalau `fetch-depth: 0` hilang di kemudian hari, yang muncul harus
"riwayatnya tak cukup", bukan tuduhan palsu terhadap commitnya.

## Temuan 4 — `origin/main` harus di-fetch eksplisit meski `fetch-depth: 0` dipasang

`fetch-depth: 0` menghilangkan batas kedalaman, tetapi refspec `actions/checkout` untuk push bertag
tetap hanya tag itu; `refs/remotes/origin/main` tak pernah lahir. Direproduksi: pada clone tag
tanpa fetch tambahan, `origin/main` bukan ref yang bisa di-`rev-parse`. Jadi langkah gerbang wajib
memuat fetch eksplisit `+refs/heads/main:refs/remotes/origin/main` sebelum `merge-base`, dan
kegagalan me-resolve ref rilis juga harus fail closed — bukan dianggap "tak ada main, ya sudah".

Biaya `fetch-depth: 0` di repo ini terukur kecil: `size-pack` 9,72 MiB, 1.710 commit.

## Temuan 5 — tag beranotasi: yang rusak bukan putusannya, melainkan jejak auditnya

Dugaan awal audit — bahwa `$GITHUB_SHA` pada tag **beranotasi** akan membuat `merge-base` menjawab
salah — **tidak terbukti**, dan diuji dengan mutasi: gerbang tanpa `^{commit}` tetap menjawab benar
karena `git merge-base` mengupas objek tag sendiri. Yang benar-benar berubah adalah **SHA yang
dilaporkan**: tanpa `^{commit}`, log rilis mencetak sha objek tag lalu menamainya "commit", sehingga
jejak auditnya menunjuk objek yang tak pernah ada di `main`. Seluruh tag repo ini bertipe `commit`
(lightweight), jadi hari ini perbedaan itu tak muncul — `^{commit}` dipasang supaya ia tetap tak
muncul kalau seseorang mulai menandatangani tag rilis. Sifat ini yang dipagari test, bukan putusan
lulus/tolaknya.

## Scope Execute dan bukti penerimaan

1. `.github/workflows/release.yml`: `actions/checkout@v4` memakai `fetch-depth: 0`, lalu **tepat
   sesudah checkout** — sebelum setup toolchain, `pnpm install`, `pnpm release`, dan sebelum step
   yang meminta OIDC — satu langkah gerbang yang mem-fetch `origin/main` dan menjalankan skrip
   ancestry. Gerbang `tag == package.json.version` tetap berdiri **terpisah** dan tak disentuh.
2. Skrip gerbang berdiri sendiri (tanpa dependency, tak butuh `pnpm install`) yang menerima
   commit-ish dan ref rilis, dan **fail closed** pada tiga kondisi: repo masih dangkal, ref rilis
   tak bisa di-resolve, dan commit bukan ancestor ref rilis. Pesan gagal memakai anotasi `::error::`
   dan menyebut jalan keluarnya.
3. Test yang gagal pada kode dasar: kasus commit di `main` lulus, kasus commit di branch yang belum
   merge ditolak, plus kontrol dangkal/ref hilang — dijalankan terhadap repo git nyata di direktori
   temporer, bukan mock. Ditambah test struktural atas `release.yml` sendiri: `fetch-depth: 0` ada,
   skrip dipanggil, dan urutannya mendahului `pnpm install`/`pnpm release`/`npm publish`.
4. Runbook `internal/docs/operations/release-npm.md` diperbarui: baris baru di tabel pagar, dan
   catatan bahwa merge ke `main` sekarang ditegakkan mesin, bukan lagi konvensi.
5. Verifikasi terbatas pada test yang tersentuh. Tak ada endpoint, skema, atau perilaku runtime
   server yang berubah, jadi boot server + curl tidak diperlukan.

## Yang sengaja TIDAK dikerjakan

- **Tidak** memasang kembali required reviewer di environment `release`. Pencabutannya adalah
  keputusan pemilik repo 2026-07-31 yang tercatat di runbook; gerbang ancestry menjawab pertanyaan
  yang berbeda (asal-usul kode), bukan pengganti persetujuan manusia.
- **Tidak** memasang ruleset tag di GitHub. Itu konfigurasi di luar repo yang tak bisa di-review
  lewat diff dan tak bisa dipagari test dari sini.
- **Tidak** mengubah gerbang `tag == package.json.version`. Acceptance criteria issue meminta
  keduanya berdiri terpisah.
