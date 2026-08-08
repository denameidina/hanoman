# Design system — hanoman

Estetika **editorial instrument-panel**: bone paper hangat, ink text, satu aksen **brass** (gold-leaf wayang). Font IBM Plex (Serif display, Sans UI, Mono data/label). Hairline 1px, radius kontrol 5px / kartu 12px. Semantik earthy (leaf/amber/clay). Satu permukaan gelap: terminal log.

Detail token & komponen ada di paket design system terpisah (Hanoman Design System). Frontend wajib memakai token & komponennya — jangan menciptakan warna/tipografi baru.

## Ilustrasi produk

Katalog authoritative berada di `internal/assets/illustration/inventory.json`: **41 master WebP**
dalam sepuluh family. Frontend tidak memakai filename secara langsung. Semua artwork dipanggil lewat
ID katalog (`HRO-001`, `PST-002`, dan seterusnya) pada komponen `Illustration` dari design system;
registry-nya hidup di `src/src/ds/illustration-registry.ts` dan diuji setara 41/41 dengan inventory.
Yang di-bundle registry adalah turunan web terkompres di `internal/assets/illustration/web/`, bukan
masternya — lihat [frontend-implementation](../frontend/frontend-implementation.md#pipeline-illustration-assets).

API komponen:

- `Illustration` menerima seluruh `IllustrationId`, memakai alt default dari intent katalog,
  lazy-load + decode async, aspect ratio katalog, dan `contain` secara default. `priority` hanya untuk
  artwork above-the-fold; `fit`, `style`, `className`, dan `sizes` boleh ditentukan caller.
- `ProductStateIllustration`, `MascotIllustration`, `StickerIllustration`, dan `SpotIllustration`
  membatasi ID secara type-level ke family-nya. Pakai wrapper ini bila family sudah diketahui.
- `decorative` wajib untuk artwork yang hanya mengulang title/status yang sudah terbaca. Bentuk ini
  merender `alt=""` + `aria-hidden="true"`; artwork informatif mempertahankan alt katalog atau alt
  yang sengaja ditulis caller.
- `StateBlock` menerima `illustration` opsional sebagai pengganti tile ikon. Keadaan loading tetap
  memakai spinner; filtered-empty sederhana tak perlu gambar besar.

Penempatan mengikuti kegunaan, bukan kewajiban memajang semuanya. Enam product-state dipakai pada
onboarding, backlog sungguh kosong, sesi aktif, menunggu keputusan, sukses, dan error yang bisa
dipulihkan. Family **sticker** (`STK-001…008`) ditempatkan sebagai **Pet Hanoman**: maskot
persisten di sudut dashboard yang pose-nya turunan status sesi & backlog, bukan hiasan — tabel
status → pose beserta urutan prioritasnya ada di
[frontend-implementation](../frontend/frontend-implementation.md#pet-hanoman-status-sesi-sebagai-pose-spec-585).
Model sheet serta template sosial tetap frontend-addressable melalui registry tetapi
tidak dipaksakan masuk instrument panel operasional. Motif tanpa makna status selalu dekoratif.

## Placeholder: contoh nilai, bukan pengulangan label (SPEC-490)

Label, hint, dan placeholder menjawab tiga pertanyaan berbeda — jangan salah satu
mengerjakan pekerjaan yang lain:

| elemen | menjawab |
|---|---|
| `Field label` / `aria-label` | *field ini apa* — **wajib**, tak pernah digantikan placeholder |
| `Field hint` | *aturannya apa* (opsional: batasan & konsekuensi) |
| `placeholder` | *isinya kelihatan seperti apa* |

1. Placeholder berisi **contoh nilai nyata**, diawali `mis. ` bila nilainya bebas
   (`mis. erp-tumbuh-ai`), atau **bentuk formatnya apa adanya** bila formatnya terikat
   (`~/.ssh/id_ed25519`, `https://github.com/org/repo.git`, `-1001234567890`, `22`,
   `••••••••`).
2. **Bukan** pengulangan label (`Cari backlog…` untuk label "Cari backlog") dan **bukan**
   instruksi (`Ceritakan apa yang terjadi…`). Instruksi tempatnya di `hint`.
3. Placeholder tak pernah menggantikan label — ia hilang begitu diketik.
4. Field yang nilainya **sudah ada** boleh memakai placeholder sebagai penanda keadaan
   (`••••1234`, `biarkan kosong = pertahankan`); itu lebih berguna daripada contoh.

**Berlaku untuk** input teks (termasuk `password`/`number`/`email`/`search`),
`textarea`/`HnTextarea`, dan kolom cari combobox (`MultiSelect.searchPlaceholder` —
`placeholder`-nya adalah label tombol, bukan petunjuk kolom).

**Di luar aturan, dengan alasan:** `<Select>` native (selalu menampilkan opsi terpilih;
keadaan belum-memilih dilayani opsi pertama yang eksplisit — `Pilih branch…`), `type="date"`
dan kerabatnya (browser **mengabaikan** `placeholder` dan merender widget bawaan), serta
checkbox/radio/file. Field yang sah tak punya placeholder ditandai di call site-nya:

    {/* placeholder-exempt: <alasan> */}

Ditegakkan `src/test/placeholder-contract.test.ts` — lihat
[frontend-implementation](../frontend/frontend-implementation.md).
