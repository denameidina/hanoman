# Desain — auto-resume sesi setelah restart hanoman / reboot device

## Latar belakang

Sesi agen (`claude` interaktif di tmux, satu per backlog) hidup di daemon tmux yang
terpisah dari proses Node hanoman (ADR-0016). Restart proses hanoman saja (update lewat
tombol, crash Node) sudah aman — tmux tidak ikut mati, sesi tetap hidup dan tinggal
di-attach ulang.

Yang **belum** aman: reboot OS penuh mematikan tmux daemon itu sendiri, bukan cuma proses
Node. Semua pane `claude` mati sekaligus. Saat hanoman boot lagi (manual atau lewat
launchd/systemd yang sudah dipasang di sebagian mesin), `reconcileHistory()`
(`server/src/services/session-history.ts:208`) hanya **menutup** baris `SessionHistory`
yang tmux-nya sudah tak ada (`endedReason: RECONCILED`) — tidak menyalakan apa pun
kembali. Operator harus sadar lalu klik "Lanjutkan" manual per backlog item lewat jalur
resume yang sudah ada (ADR-0084, `startSpecSession()`).

Tujuan fitur ini: begitu hanoman boot kembali (habis restart proses atau reboot device),
sesi yang tadinya aktif otomatis dibangun ulang dan lanjut jalan, tanpa operator harus
klik apa pun.

**Di luar scope** (diputuskan eksplisit saat brainstorming): memastikan proses hanoman
sendiri auto-start saat OS boot (launchd/systemd) — dianggap sudah/akan diatur manual di
tiap mesin, bukan bagian fitur ini.

## Sinyal deteksi

Tidak perlu mekanisme deteksi baru. `reconcileHistory()` sudah membedakan dengan tepat:

- Sesi yang **dihentikan manusia** (stop/interrupt) menutup baris `SessionHistory`-nya
  sendiri **sebelum** shutdown, dengan `endedReason` normal — tidak pernah masuk jalur
  reconcile.
- Sesi yang **terputus paksa** (reboot OS, tmux/proses crash, tmux dibunuh manual) masih
  ber-`endedAt: null` saat boot berikutnya, lalu ditutup reconcile dengan
  `endedReason: RECONCILED`.

Baris yang baru saja ditutup `RECONCILED` pada satu siklus boot **adalah** himpunan
kandidat resume. Dari situ, saring backlog yang `Spec.stage` belum `done` (item yang sudah
selesai tidak perlu dilanjutkan meski baris riwayatnya kena reconcile).

## Eksekusi

Fungsi baru `resumeReconciledSessions(candidateSpecIds)` dipanggil di `server/src/server.ts`
tepat sesudah `reconcileHistory()` pada urutan boot yang sama (sebelum server mulai
menerima trafik biasa, sejalan dengan `reconcileAgentInvocations` yang sudah ada di titik
yang sama).

Untuk tiap kandidat (dedupe per `specId`, hanya `stage !== done`):

1. Panggil `startSpecSession(specId, ...)` — jalur `resume` yang sama persis dengan tombol
   "Lanjutkan" (ADR-0084): kalau worktree/branch masih ada dipakai apa adanya, kalau tidak
   dibangun ulang dari `headSha`/branch remote, lalu sesi dilanjutkan dengan prompt
   sadar-fase.
2. Panggilan dilakukan **berurutan** (`for await`, bukan `Promise.all`) supaya operasi git
   worktree antar item tidak saling tabrak — ini murni menghindari race operasi git, bukan
   throttle kapasitas.
3. **Gerbang kapasitas peluncuran (SPEC-1108/ADR-0161, `scheduler.maxConcurrent`) sengaja
   TIDAK ditegakkan di jalur ini.** Keputusan eksplisit: semua kandidat dicoba walau
   jumlahnya melebihi kapasitas normal. Diputuskan sadar risikonya di mesin 8 GB yang
   pernah kernel panic akibat sesi paralel berlebih (lihat memori
   `mac-mini-8gb-panic-agen-paralel`) — operator memilih "semua kembali" di atas
   "batasi demi stabilitas".

## Penanganan gagal

Satu kandidat gagal (worktree rusak tak bisa dibangun ulang, konflik git, dll)
di-*catch* per item — **tidak** menghentikan proses untuk kandidat lain. Kegagalan dicatat
sebagai `Notification` baru: `"Gagal melanjutkan otomatis: <specId> — <alasan>"`, supaya
operator tahu item mana yang perlu ditangani manual (lewat tombol "Lanjutkan" biasa,
jalur yang sama tetap tersedia sebagai fallback).

## Dampak UI

Tidak ada perubahan frontend. Sesi yang berhasil resume otomatis membuat pane tmux hidup
lagi, dan dashboard yang membaca state lewat `/api/events/ws` (kanal siar yang sudah ada)
langsung melihatnya sebagai sesi berjalan begitu dibuka/di-refresh — sama seperti sesi
yang dilanjutkan manual lewat tombol.

## Docs yang perlu disentuh dalam commit yang sama

- ADR baru (mis. `internal/docs/adr/01xx-auto-resume-sesi-setelah-boot.md`) yang
  mengamandemen semangat ADR-0084 (resume tetap manual) dan mencatat pengecualian
  terhadap gerbang ADR-0161 khusus untuk jalur boot-recovery ini — supaya keputusan
  "abaikan kapasitas" tidak terlihat sebagai bug di masa depan.
- `internal/docs/README.md` — tautkan spec + ADR baru.
- Kalau relevan, `internal/docs/architecture/stack.md` / doc sesi terkait yang menyebut
  perilaku boot.

## Testing

- Unit: `resumeReconciledSessions()` — kandidat terisi benar dari baris `RECONCILED` +
  filter `stage !== done`; dedupe per `specId`; kandidat gagal tidak menghentikan
  iterasi; notifikasi tercatat untuk kandidat gagal.
- Integrasi: boot sequence server — sesudah `reconcileHistory()` menutup baris, sesi baru
  benar-benar dipanggil lewat `startSpecSession()` (mock/stub jalur tmux/worktree berat).
- Tidak perlu test end-to-end tmux/reboot sungguhan (di luar kemampuan suite) — cukup
  pastikan pemanggilan jalur resume yang sudah teruji ADR-0084 terjadi dengan input yang
  benar.

## Keputusan yang dikunci saat brainstorming

1. Scope: restart proses **dan** reboot device (bukan salah satu saja).
2. Mode: full otomatis tanpa konfirmasi — tidak ada toggle setting, tidak ada banner
   "Lanjutkan semua?".
3. Auto-start proses hanoman saat OS boot (launchd/systemd) — **di luar scope**, dianggap
   sudah diatur manual per mesin.
4. Gerbang kapasitas SPEC-1108 **diabaikan** di jalur ini — semua kandidat dicoba, sadar
   risiko crash di mesin 8 GB.
5. Kegagalan per item: lewati + notifikasi, tanpa retry otomatis.
