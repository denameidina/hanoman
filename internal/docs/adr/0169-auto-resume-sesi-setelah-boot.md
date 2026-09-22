# ADR-0169 — Sesi backlog yang direkonsiliasi saat boot dilanjutkan otomatis

- Status: Accepted
- Tanggal: 2026-09-22
- SPEC: — (brainstorm langsung di sesi Claude Code, bukan lewat backlog hanoman)
- Terkait: melengkapi [0084](0084-melanjutkan-sesi-backlog.md) (jalur `resume` dipakai apa
  adanya, tak ada mekanisme peluncuran baru),
  [0079](0079-history-sesi-terminal-store-lokal-plus-transkrip.md) &
  [0125](0125-akhir-sesi-riwayat-tercatat.md) (`reconcileHistory`,
  `endedReason: "reconciled"`). **Mengamandemen**
  [0161](0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md): gerbang kapasitas DILEWATI
  khusus jalur ini, lewat opsi baru `bypassCapacity` — **bukan** `force`. Menegakkan
  [0093](0093-dependency-antar-backlog.md): gerbang dependency TETAP berlaku di jalur ini,
  sengaja tak ikut dilewati.

## Konteks

Sesi agen hidup di daemon tmux terpisah dari proses Node (ADR-0016). Restart proses hanoman
saja (update, crash Node) sudah aman — tmux tak ikut mati. Yang belum aman: reboot OS penuh
mematikan tmux daemon itu sendiri. Saat hanoman boot lagi, `reconcileHistory()`
(`session-history.ts:208`) sudah membedakan dengan tepat sesi yang **dihentikan manusia**
(menutup baris riwayatnya sendiri sebelum shutdown) dari sesi yang **terputus paksa** (baris
masih `endedAt: null` saat boot berikutnya, ditutup `endedReason: "reconciled"`) — tapi ia
hanya menutup baris, tak menyalakan apa pun kembali. Operator harus sadar dan klik "Lanjutkan"
manual per backlog lewat jalur `resume` (ADR-0084).

Riset menemukan mesin operator (Mac mini M2, 8 GB) sudah dua kali kernel panic tepat akibat
beban sesi paralel berlebih — bukti forensiknya berupa baris `SessionHistory`
`endedReason: 'reconciled'` massal tepat setelah reboot (lihat memori project
`mac-mini-8gb-panic-agen-paralel`), pola yang identik dengan skenario yang ADR ini tangani
pemulihannya. Operator diberi tahu risiko ini secara eksplisit dan tetap memilih auto-resume
tanpa batas kapasitas.

Ditemukan juga bahwa gerbang kapasitas (ADR-0161) dan gerbang dependency antar-backlog
(ADR-0093) sama-sama dikontrol satu flag `opts.force` di `startSpecSession()` — tak ada cara
melewati salah satu tanpa yang lain lewat API yang ada sebelum ADR ini.

## Keputusan

1. **Sinyal deteksi tanpa mekanisme baru.** `reconciledSpecIdsSince(cutoff)`
   (`session-history.ts`) membaca specId dari baris yang baru ditutup `reconciled` PADA SAPUAN
   BOOT INI (`reconciledAt >= cutoff`, `cutoff` diambil tepat sebelum `reconcileHistory()`
   dipanggil). Itulah himpunan kandidat resume — persis "sesi yang tadinya hidup lalu terputus
   paksa", apa pun sebabnya (reboot, crash, tmux dibunuh manual).
2. **Filter stage.** Hanya kandidat yang `Spec.stage !== "done"` yang dicoba — item yang sudah
   selesai sebelum reboot tak perlu dilanjutkan meski baris riwayatnya kena reconcile.
3. **Eksekusi lewat jalur yang sama persis dengan "Lanjutkan" manusia.**
   `resumeReconciledSessions()` (`session-boot-resume.ts`) memanggil `startSpecSession()`
   (ADR-0084) berurutan (bukan paralel — murni menghindari operasi git/worktree saling
   tabrak, bukan throttle kapasitas) untuk tiap kandidat.
4. **Kapasitas dilewati, dependency TIDAK.** `startSpecSession()` mendapat opsi baru
   `opts.bypassCapacity`, diteruskan ke `withSessionAdmission({ force: opts.force ||
   opts.bypassCapacity })` — melewati HANYA gerbang kapasitas/beban host ADR-0161.
   `if (!opts.force)` di sekitar `blockersForSpec()` (gerbang dependency ADR-0093) TIDAK
   disentuh: auto-resume hanya mengirim `bypassCapacity: true`, tidak pernah `force: true`.
   Item yang dependency-nya belum ter-merge tetap diblokir seperti biasa.
5. **Kegagalan per item tidak menghentikan yang lain.** Ditangkap, dicatat via
   `recordFailure()` (notifikasi yang sudah ada, `"Gagal: <title> — <reason>"`), lanjut ke
   kandidat berikutnya. Tanpa retry otomatis — fallback-nya tombol "Lanjutkan" manual yang
   sudah ada.
6. **Full otomatis, tanpa konfirmasi.** Tak ada toggle setting, tak ada banner "Lanjutkan
   semua?" — begitu server boot dan menemukan kandidat, langsung dicoba.
7. **Di luar scope.** Memastikan proses hanoman sendiri auto-start saat OS boot
   (launchd/systemd) — dianggap sudah/akan diatur manual per mesin, bukan bagian ADR ini.

## Konsekuensi

**Positif:** reboot atau crash tak lagi berarti operator harus mengingat dan mengklik ulang
tiap backlog yang sedang jalan — jalur yang sudah teruji (ADR-0084) kini dipicu otomatis alih-alih
menunggu manusia.

**Risiko diterima secara sadar:** pada mesin 8 GB yang sudah pernah kernel panic akibat sesi
paralel berlebih, auto-resume yang melewati cap `maxConcurrent` bisa memicu kondisi yang sama
lagi bila banyak sesi hidup bersamaan saat reboot terjadi — operator memilih ini secara eksplisit
di atas alternatif "taati cap, sisanya notifikasi manual" saat brainstorming (lihat
[spec](../../docs/superpowers/specs/2026-09-22-auto-resume-sesi-setelah-restart-design.md)).
Mitigasinya bukan kode — bila pola ini terbukti memicu panic lagi, keputusan #4 di atas
diamandemen ADR baru, bukan diam-diam diubah di kode.

**Yang TIDAK berubah:** `force: true` (jalur manusia, `POST /terminal/sessions`) tetap melewati
keduanya (kapasitas + dependency) seperti sebelum ADR ini — `bypassCapacity` adalah opsi
tambahan, bukan pengganti.
