# ADR-0107 — Paginasi seragam seluruh daftar dashboard, berikut pengecualian yang dinyatakan

**Status:** aktif (SPEC-523). Memperluas [ADR-0038](0038-paginasi-di-response-layer.md) dari dua
daftar ke seluruh daftar utama.

## Konteks

ADR-0038 menetapkan pola paginasi hanoman: amplop `{items,total,page,pageSize}`, dipotong di layer
response, dengan `serverPage()` + `Pager` di design system. Yang tak ditetapkannya adalah
**jangkauan** — dan puluhan fitur kemudian, pola itu baru dipakai `GET /specs` dan `GET /projects`.

Audit SPEC-523 atas instalasi hidup (2026-08-04):

| Daftar | Keadaan sebelum | Baris di DB hidup |
|---|---|---|
| Notifikasi | `take: 50` hardcode, tanpa `page`/`limit`/`total` | **287** → 237 (82 %) tak terjangkau |
| Lead decisions | `take`/`skip`, balasan `{items}` **tanpa `total`** | **393** |
| Antrean scheduler | ikut utuh di dalam `GET /scheduler/state`, difilter di klien | **56** |
| GitHub issues | `{items}` polos | 9 |
| Tiket | server beramplop, **UI memanggil tanpa `page`/`limit`** | 19 |
| Changelog | UI memanggil `{limit: 10}` **tanpa `page`** | 0 (cacat struktural) |
| Riwayat sesi | server beramplop, UI memakai muat-lebih (append) | 219 |

Changelog paling tajam: `limit` tanpa `page` bukan halaman melainkan **plafon** — item ke-11 dan
seterusnya permanen tak terjangkau dari UI.

## Keputusan

**Setiap daftar utama dashboard memakai amplop dan paginator yang sama.** Server menerima
`page`/`limit` dan membalas `Paginated<T>`; UI memakai `Pager` design system — tak ada paginator
kedua, karena paginator kedua persis melahirkan inkonsistensi yang ADR ini hapus.

`skip`/`take` di query DB **sah** untuk daftar tanpa overlay (notifikasi, antrean scheduler, lead,
riwayat sesi). Larangan ADR-0038 mengikat `GET /specs` secara spesifik — overlay stage live +
write-through + notifikasi `done` di sana bergantung pada set penuh, dan itulah alasan larangannya.
Ia bukan aturan umum "jangan pernah `skip`/`take`".

### Tiga pengecualian, dinyatakan supaya tak "diperbaiki" audit berikutnya

1. **Git graph tetap jendela tumbuh (SPEC-351), bukan halaman diskrit.** Lane dihitung dari daftar
   commit **kontigu**; memenggalnya per halaman memutus tautan induk–anak di batas halaman dan
   mencabut auto-scroll. Yang ditambahkan: `total` (`git rev-list --count` dengan ref selector yang
   **sama** dengan `git log`-nya, jadi ia tak pernah menghitung ref yang tak digambar) → label
   "N dari T commit". Plafon yang tak terlihat itulah keluhan aslinya, bukan ketiadaan tombol halaman.
2. **Docs project tetap pohon.** `GET /projects/:id/docs` mengembalikan `{coverage, tree}`
   (kategori → berkas) untuk file-tree, bukan daftar rata. Memenggal pohon memutus navigasinya.
3. **Error monitoring tak punya daftar.** Dicabut
   [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md); brief SPEC-523 menyebutnya karena
   ditulis dari ingatan permukaan lama.

### Notifikasi: bell adalah baki, arsip adalah daftar

`notificationsFeed()` **tanpa argumen tetap 50 teratas** — ia memberi makan frame siar WebSocket
tiap 3 detik (`services/events.ts`), dan menyiarkan seluruh riwayat tiap 3 detik adalah regresi
biaya, bukan perbaikan. Yang ditambahkan adalah `total`, sehingga 50 berhenti berpura-pura jadi
semuanya. Halaman 2+ hidup di **modal arsip** ber-`Pager`, dibuka dari kaki dropdown bell.

`unread` selalu dihitung dari seluruh baris, tak pernah dari halaman yang diminta: lencana bell yang
mengecil saat operator membuka halaman 2 adalah kebohongan.

### Perubahan kontrak yang menghapus field

`GET /scheduler/state` berhenti mengirim `queue` dan mengirim `queueCounts`
(`{queued,launched,done,failed}`); antrean pindah ke `GET /scheduler/queue?status&page&limit`.
Alternatif "kirim `queue` yang dipotong diam-diam" **ditolak**: daftar terpotong yang tampak utuh
adalah kelas bug yang sudah menggigit repo ini berulang kali (SPEC-431/451/475).

`GET /lead/decisions` & `/lead/flows` **menambah** `page`/`limit` tanpa mencabut `take`/`skip`;
bila keduanya dikirim, `page`/`limit` menang. Penurunannya hidup di satu tempat
(`services/lead/page.ts` `leadWindow()`) — menyalinnya ke `trail.ts` dan `flow.ts` adalah kelas bug
SPEC-431/448/475: dua salinan yang tak sepakat.

## Konsekuensi

- Data lama terjangkau di seluruh daftar utama; tak ada lagi plafon yang berpura-pura jadi total.
- Dijaga `server/test/pagination-contract.test.ts`: satu daftar konstanta endpoint yang wajib
  beramplop (`items`/`total`/`page`/`pageSize` + `limit` dihormati). Daftar baru yang lahir tanpa
  halaman punya satu tempat yang menolaknya.
- Riwayat sesi kehilangan gulir-menumpuk SPEC-362. Ini pertukaran yang disengaja: satu pola
  paginasi di seluruh dashboard adalah isi objective-nya. Test SPEC-362 yang mengunci perilaku
  append sebagai kontrak diperbarui — pola SPEC-433.
- **Ceiling (ponytail):** `paginate()` tak menjepit `limit` dari atas. Bila agen mulai meminta
  `limit=999999`, jepit di satu tempat itu — tanpa ADR baru.
