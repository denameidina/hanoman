# ADR-0143 — "Menunggu keputusan" adalah keadaan TURUNAN dari keadaan pane, bukan latch marker

Tanggal: 2026-08-22 · Status: diterima · Sumber: audit `docs/superpowers/audits/2026-08-22-spec-903-menunggu-keputusan-turunan.md`, spec `docs/superpowers/specs/2026-08-22-spec-903-menunggu-keputusan-turunan-design.md`
Mengamandemen SPEC-184 pada **arti** marker keputusan dan ADR-0141 pada **turunan** `decisionAt`
(isi marker tak berubah); menegakkan ADR-0039 (tanpa channel realtime baru), ADR-0024 (tanpa
queue/worker), ADR-0091 (prioritas `deciding`), dan ADR-0037.

## Konteks

`SessionInfo.decision` mengaku sebagai **keadaan** ("sesi ini sedang menunggu manusia") padahal ia
membaca sebuah **pemberitahuan** ("sesi ini pernah minta masukan"): satu bit dari ukuran berkas
marker `.worktrees/.decisions/<id>` (`pty.ts` `markerFilled`).

Marker itu dipasang hook agen — claude lewat `Notification` yang teksnya cocok
`idle|permission|waiting for|needs.?input` (`runner/src/settings.ts`), codex lewat `Stop`
(`runner/src/codex-settings.ts`) karena codex tak punya `Notification` — dan dilepas oleh **satu**
peristiwa saja, `UserPromptSubmit`, plus jalur rantai lead (`lead/detect.ts`). Empat cara episode
menunggu berakhir tak melepasnya:

| jalur | kenapa marker tetap terisi |
|---|---|
| (a) memilih opsi `AskUserQuestion`/izin di TUI | jawabannya *tool result*, bukan prompt |
| (b) `POST /terminal/sessions/:id/dialog/answer` (SPEC-899) | handler-nya tak menyentuh marker |
| (c) Esc | bukan event hook apa pun |
| (d) codex melanjutkan sendiri | marker dipasang di **tiap** akhir turn |

Akibatnya terukur 2026-08-22 di mesin dev: pane `hanoman-spec-901` memutar
`✢ Creating… (28m 3s · ↓ 112.3k tokens)` dan `hanoman-spec-902` memutar `✶ Manifesting… (25m 12s)`
sementara kedua markernya terisi (8 B) — pil "Menunggu keputusan" menyala pada dua sesi yang jelas
sedang bekerja, di sel Terminal maupun di pet.

ADR-0141 sudah menamai cacat ini di bagian Konsekuensi-nya ("`decision` lengket **dan** umurnya
terus tumbuh") dan menyerahkannya ke SPEC-899. SPEC-899 menutup jalur (b) sebagai fitur, bukan
sebagai pengosong marker — jadi keempat jalur tetap terbuka. Menambalnya satu per satu tak akan
pernah selesai: daftar jalur keluar bertambah tiap kali ada permukaan baru (tombol layar SPEC-800,
panel pet SPEC-899, mesin agen ketiga).

## Keputusan

1. **`decision` menjadi turunan:** `!exited && markerFilled(f) && paneQuiet(pane)`. Marker tetap
   sinyal MASUK yang durable; yang digerbangi adalah pembacaannya.
2. **Gerbangnya `#{window_activity}`** — variabel format tmux yang ikut menumpang `FMT` milik
   `tmux list-panes -a` yang sudah dipanggil tiap poll (pola `#{alternate_on}`, ADR-0133). **Nol
   invokasi tmux tambahan**; batas biaya di sini nyata, bukan teoretis (pemanggilan tmux per-poll
   pernah memblokir event loop sampai 916 ms saat mesin sibuk).
3. **`PANE_QUIET_MS = 3000`.** Pane yang tak mengeluarkan apa pun selama itu dibaca "tidak sedang
   bekerja".
4. **Fail-open.** `window_activity` tak terbaca / bukan angka → dibaca sebagai diam → perilaku
   persis sebelum ADR ini. Ragu selalu berarti pil TETAP menyala: pil yang menyala kelewat lama itu
   mengganggu, pil yang padam saat ada pertanyaan sungguhan membuat manusia kehilangan
   pertanyaannya.
5. **Marker tak boleh dikosongkan oleh heuristik.** Penulis marker dari sisi server tetap hanya dua,
   dan keduanya bukti POSITIF manusia sudah menjawab: rantai lead yang tuntas (SPEC-452) dan
   `POST /terminal/sessions/:id/dialog/answer` yang berhasil — yang terakhir ditambahkan ADR ini
   sebagai kembaran `UserPromptSubmit` untuk jalur SPEC-899. Definisinya satu, `clearMarker()` di
   `pty.ts`.
6. **`decisionAt = ISO(max(onset di marker, window_activity))`** saat `decision` true. **Isi marker
   tetap "detik epoch onset, ditulis sekali" — semantik ADR-0141 tak disentuh**; yang berubah hanya
   turunannya.
7. **Satu sumber untuk semua permukaan.** `liveDecisions()` mengembalikan bit turunan yang sama
   (`waiting`), dipakai `scanDecisions()` (notifikasi) dan `GET /lead/status` (panel lead).
   `TerminalScreen`, `pet-state`, dan badge `SchedulerScreen` sudah membaca `SessionInfo.decision`
   yang sama — kosakata sesi tetap identik **secara konstruksi**, bukan lewat rumus paralel yang
   harus dijaga tetap mirip. Cacahan permukaan sengaja tak ditulis sebagai angka: pembaca berikutnya
   mewarisi bit yang benar tanpa harus terdaftar di sini, dan itulah gunanya satu sumber.
   **Konsekuensinya di frontend:** pil `deciding` (ADR-0091 AC-3) tak boleh lagi bersarang di dalam
   `awaiting`. Sebelum ADR ini `decision` adalah latch yang menyala sepanjang episode lead, jadi
   sarang itu aman; kini `decision` padam tiap kali pane mengeluarkan sesuatu — termasuk saat lead
   sendiri mengetik jawabannya — dan sel Terminal akan DIAM justru pada sesi yang sedang dilayani,
   sementara `sessionKind` pet (yang menguji `deciding` berdiri sendiri) tetap bicara.
8. **Dedup notifikasi tetap dikunci pada marker, bukan pada bit turunan.** KAPAN menotifikasi
   memakai bit turunan (sehingga codex yang terus bekerja tak lagi menotifikasi di tiap akhir turn);
   BERAPA KALI dikunci pada marker terisi, karena manusia yang mengetik jawabannya membuat pane
   berisik sebentar-sebentar dan tiap kedipan akan melahirkan notifikasi kedua untuk pertanyaan yang
   sama.
9. **Pintu deteksi lead (`lead/detect.ts`) tidak digerbangi ulang.** Ia sudah menolak sesi yang
   layarnya berakhir pada baris giliran agen (`AGENT_TURN_LINE`, SPEC-487, pemisahan terukur 6/6 vs
   0/16) — gerbang berbasis ISI yang lebih kuat dari milik ADR ini. Menumpuk gerbang kedua di sana
   menambah permukaan kegagalan tanpa menutup satu pun jalur baru.

## Bukti

- **Pemisahan 0 dtk vs 317 dtk.** 22 sampel berturut-turut, 1 Hz, socket `hanoman`: pane claude yang
  bekerja punya `window_activity == now` pada **22/22** sampel (timer giliran claude berdetak tiap
  detik → jeda keluaran maksimum ≤ 1 dtk); dua pane claude yang diam di prompt beku pada satu
  stempel selama 317 dtk dan terus.
- **Berdetak tanpa klien tmux terpasang.** Socket terpisah, nol klien, pane mencetak tiap 0,5 dtk:
  `window_activity` maju tiap sampel dengan lag ≤ 1 dtk (pembulatan detik). Penting karena hanoman
  baru memasang klien tmux saat ada yang menonton.
- **Biaya format ≈ 0.** 50 invokasi `list-panes -a -F …` atas 4 pane: 4,12 ms/panggilan (FMT lama)
  vs 4,33–4,38 ms/panggilan dengan `#{window_activity}` **dan** sebuah pencarian isi pane
  `#{C/ri:}`. Dengan hanya `#{window_activity}` selisihnya di bawah resolusi ukur.
- Ambang 3 dtk karena itu 3× margin di atas jeda keluaran terukur dan di atas lag pembulatan detik.
- Setiap sesi hanoman satu window satu pane (`list-windows -a` → `panes=1`), jadi
  `#{window_activity}` == aktivitas pane.

## Alternatif yang ditolak

- **Gerbang berbasis ISI pane** (arah yang disebut objective backlog: `readDialogScreen` terbaca =
  menunggu, spinner kerja = tidak). Isi pane bisa dibaca tanpa invokasi tambahan — tmux 3.7b
  mendukung `#{C/ri:pola}` (glob/regex atas isi pane, mengembalikan nomor baris) dan biayanya sudah
  diukur di atas. Tetap ditolak sebagai sumber utama karena tiga hal: **(i)** lebar pane memotong
  penandanya — pane sesi di mesin dev 52 kolom, dan di sana baris kerja claude terbaca
  `✳ Manifesting… (32m 13s · ↓ 130.3k tokens)` dengan `esc to interrupt` sudah terpotong habis;
  **(ii)** bentuknya kontrak tampilan agen, bukan kontrak kita — nama verb claude berganti tiap
  rilis dan codex punya baris statusnya sendiri, sementara `window_activity` berlaku sama untuk
  keduanya dan untuk mesin agen ketiga yang belum ada; **(iii)** footer dialog sebagai gerbang
  positif justru **menahan** pil menyala di jalur (a) — sesudah manusia memilih opsi, footer bisa
  masih terlihat di layar sementara agen sudah kembali bekerja. `#{C/ri:}` dicatat di audit sebagai
  jalan yang tersedia bila suatu saat dibutuhkan.
- **`AGENT_TURN_LINE` (SPEC-487) sebagai gerbang pil.** Pola itu juga cocok dengan baris giliran yang
  *baru selesai* (`✻ Cooked for 40m 4s`, tetap di layar) — dan sesi yang baru selesai giliran memang
  sedang menunggu manusia. Benar untuk pintu lead ("jangan ketik ke sana"), salah untuk pil.
- **Mengosongkan marker saat pane terbaca sibuk.** Godaan yang wajar (latch-nya benar-benar lepas,
  onset ikut segar) dan **berbahaya**: `Notification` claude mengisi marker sekali per dialog dan tak
  pernah menembak lagi selama dialog itu terbuka — terukur SPEC-452, 0 B selama 120 detik dengan
  dialognya masih terbuka. Satu keluaran latar belakang akan membuat pertanyaan itu hilang PERMANEN
  dari pil, pet, notifikasi, dan panel lead. Tak ada yang akan menulisnya kembali.
- **Menambal keempat jalur satu per satu.** Daftarnya terbuka; tiap permukaan baru harus ingat
  menambal. Tambalan (b) tetap dikerjakan karena ia benar sendiri, bukan karena ia cukup.

## Konsekuensi

- **`decision` menjadi bergantung waktu.** Test-nya butuh jeda nyata (`PANE_QUIET_MS` + margin);
  test integrasi tmux di `server/test/pty.test.ts` yang menunggu ±8 detik itu **bukan** flake.
- **`decisionAt` marker pra-ADR-0141 (isi `waiting`) kini terisi**, bukan lagi `undefined` — dulu
  "tak diketahui", kini diketahui dari aktivitas pane. Perbaikan, bukan regresi: ADR-0141 §Konsekuensi
  menyebut sesi itu sebagai kompromi yang benar hanya karena tak ada sumber lain.
- **Manusia yang mulai mengetik di pane yang menunggu me-reset "menunggu sejak"** (echo → aktivitas).
  Disengaja: pet tak perlu mendesak sesi yang sedang dilayani orang.
- **Pane berisik yang sebenarnya menunggu** (mis. keluaran tugas latar belakang selagi dialog
  terbuka) memadamkan pil sampai keluarannya berhenti. Harga yang diterima sadar: notifikasi
  `decision` untuk episode itu sudah lahir lebih dulu, dan pil kembali menyala 3 dtk sesudahnya.
- **Codex berhenti menotifikasi di tiap akhir turn** selama ia melanjutkan sendiri — perbaikan
  langsung atas jalur (d) yang selama ini membanjiri feed notifikasi.
- Bentuk DTO tak berubah (`decision: boolean`, `decisionAt?: string`): **nol migrasi, nol dampak
  sync, nol gerbang versi**. Yang berubah artinya, bukan bentuknya.
- Prioritas lead (`deciding` menang, ADR-0091) dan gerbang SPEC-433 (`finished`/`complete` menang)
  hidup di frontend **di atas** bit ini dan tetap berlaku apa adanya.
- Sesi yang sudah berjalan ikut terperbaiki tanpa dilahirkan ulang: tak ada satu pun hook agen yang
  berubah.
