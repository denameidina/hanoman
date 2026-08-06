// SPEC-543 · ADR-0108 — klausa gaya kode.
//
// Lubangnya sama persis dengan yang ditutup ADR-0080 untuk scope verifikasi: prompt sesi bicara
// fase, otonomi, skill, commit, dan push, tapi tak sekali pun menyebut bentuk kode yang diharapkan.
// Karena diam, tiap sesi jatuh ke kebiasaan default modelnya — dan kebiasaan itu adalah menarasikan
// kode yang baru saja ditulisnya.
//
// Baris pertama menggerbangi seluruh klausa. Itu syarat, bukan gaya bahasa: konstanta yang SAMA
// dipasang di prompt yang keluarannya bukan kode (hanoman-lead, narator changelog), dan tanpa
// gerbang tekstual ia harus bercabang jadi dua varian yang wajib tetap sepakat — kelas bug
// "satu definisi, N call site" (SPEC-431/448/475/481) dalam bentuk teks, yang bahkan tak punya
// tipe yang memaksanya konsisten.
//
// Ia TIDAK melarang komentar. Yang dilarang adalah komentar yang mengulang kode; komentar seperti
// yang sedang kamu baca ini justru bentuk yang diminta butir 3.
export const CODE_STYLE_CLAUSE = [
  "Gaya kode — berlaku setiap kali kamu menulis atau mengubah kode:",
  "- Tulis kode yang rapi dan mengikuti idiom, penamaan, serta struktur kode di sekitarnya.",
  "  Kodemu harus terbaca seperti kode yang sudah ada di berkas itu, bukan seperti tempelan.",
  "- Jangan menulis komentar yang cuma mengulang apa yang sudah dinyatakan kode.",
  "- Komentar hanya untuk hal yang TIDAK terbaca dari kode: alasan/why sebuah keputusan,",
  "  trade-off yang diambil, workaround beserta rujukan SPEC/ADR-nya, atau invariant yang tak",
  "  kelihatan. Komentar semacam itu justru berharga — jangan ikut dibuang.",
  "- Jangan menambahkan komentar pembatas seksi, header berhiasan, atau narasi langkah demi langkah.",
  "- Jangan meninggalkan kode mati atau kode yang dikomentari. Hapus saja; riwayat git yang menyimpannya.",
].join("\n");
