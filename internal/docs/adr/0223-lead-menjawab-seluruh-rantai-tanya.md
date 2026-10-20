# ADR-0223 — Lead menjawab seluruh rantai tanya: antrean FIFO, layar harus sepakat dengan payload, AC-11 per pertanyaan

Tanggal: 2026-10-18 · Status: diterima · tanpa nomor SPEC (dikerjakan langsung atas permintaan operator) ·
yang memutuskan tiap langkah rantai kini sesi lead ([ADR-0228](0228-lead-sesi-interaktif-gerbang-server.md)); antrean FIFO per sesi & kecocokan layar di sini tetap berlaku

**Mengamandemen** [ADR-0146](0146-lead-dipicu-event-hook.md) §5 ("satu sesi = satu pekerjaan; event
yang tiba selagi sesi dikerjakan menimpa yang tertunda — terbaru menang") dan §6 (dialog ditunggu
SESUDAH `decide()`), serta arti AC-11 / OQ-10 [ADR-0091](0091-hanoman-lead-agen-pemimpin.md)
(`maxAutoAnswers`). **Menegakkan** [0167](0167-keputusan-ambigu-lead-atau-manusia.md) (tanpa batas
jumlah pertanyaan; >4 keputusan dipecah ke beberapa `AskUserQuestion` berturut-turut),
[0024](0024-sesi-interaktif-menggantikan-run.md) (nol timer/queue/worker baru — antreannya Map di
memori yang sudah ada), [0142](0142-inbox-keputusan-dialog-sesi.md) & [0143](0143-menunggu-keputusan-keadaan-turunan.md)
(marker & pemiliknya tak disentuh). Nol skema, nol endpoint baru, nol perubahan kontrak MCP.

## Konteks

Operator: "lead belum mampu menjawab semua pertanyaan berantai dari sesi Claude Code". Diukur dari
jejak `LeadDecision`/`LeadFlow` dan log server mesin operator (2026-10-15 … 10-17):

1. **Jawaban mendarat di dialog yang salah — spec-1457.** Claude mengajukan dua `AskUserQuestion`
   berdekatan: A (4 pertanyaan, "port edge …") dan B (1 pertanyaan, "temperature …"). Lead menerima
   event B, memutuskan "temperature", lalu mengetiknya ke kolom bebas pertanyaan pertama dialog A
   yang sedang tampil. Transkrip: `Apakah port edge … ikut dalam SPEC-1457? → Pilih: Ya. Filter Branch
   dibaca dari URL … Temperature …`; log: `tak terjawab — dialog belum tertutup sesudah pertanyaan
   terakhir dijawab`; tiga tab sisanya dijawab manusia, dan Claude sendiri bertanya ulang "jawaban
   pertama tadi tampak tertukar". Penyebab di kode: `runChain` mengetik berdasarkan payload tanpa
   pernah membuktikan layar menampilkan pertanyaan yang sama.
2. **Panggilan di tengah rantai bisa hilang.** `intakeAsk` menyimpan satu slot `pending` "terbaru
   menang", dan `running` baru menyala sesudah `await maxConcurrent()` di `run()`: event yang tiba di
   celah itu menimpa entri yang belum mulai, lalu KEDUANYA berjalan paralel di satu pane (terbukti
   lewat test: kode lama `maxRunning = 2`).
3. **Pagar AC-11 memutus sesi sehat.** `answers` menghitung TOTAL jawaban per sesi dan tak pernah
   di-reset selama sesi hidup. Default `maxAutoAnswers` = 3 → lead berhenti sesudah panggilan
   ketiga; operator menaikkannya ke 20 dan tetap tercatat `Sesi spec-1468 sudah dijawab otomatis 20×
   berturut-turut` di tengah brainstorm berisi puluhan keputusan BERBEDA (13 + 3 + 3 + 7 + …).
4. **Penolakan senyap.** Event yang ditolak ember laju (429) tak meninggalkan jejak apa pun.

## Keputusan

1. **Antrean FIFO per sesi** (`lead/ask.ts`). `Entry.pending` → `Entry.queue: Item[]`, urut kedatangan,
   batas `ASK_QUEUE_MAX = 8` (meluap → buang yang TERTUA + log). Bendera `busy` diset SINKRON di intake
   dan baru dilepas di `finally` pekerja, jadi event di celah `await` mengantre alih-alih menimpa.
   "Satu sesi = satu pekerjaan" tetap benar secara konstruksi.
2. **Layar harus sepakat dengan payload** (`lead/detect.ts` `dialogFits`). Sebelum `decide()` tiap
   langkah, `waitDialogFor` menunggu (≤ `DIALOG_WAIT_TRIES` × 300 ms) sampai dialog di pane adalah
   pertanyaan langkah itu; sesudah `decide()` dan sebelum mengetik, layar dinilai ULANG (operator bisa
   menjawab selagi lead memutuskan). Aturannya fail-OPEN pada ketiadaan bukti, fail-CLOSED pada bukti
   yang bertentangan: jumlah tab ≠ jumlah pertanyaan, judul (baris pertama pertanyaan yang dilipat
   TUI; dinormalisasi huruf/angka saja) bukan awalan teks pertanyaan, atau tak satu pun opsi sepakat.
   Layar tanpa judul/opsi terbaca dinilai cocok — perilaku persis sebelum ADR ini.
3. **Dialog milik tanya lain → rotasi, bukan kegagalan.** Langkah pertama yang mendapati pertanyaan
   lain melapor `mismatch: true` (tak ada yang diputuskan/diketik, `failures` tak naik). Pekerja
   mendahulukan tanya berikutnya di antrean dan mengembalikan yang ini ke ekor, paling banyak
   `ASK_MISMATCH_MAX = 2` kali per tanya. Mismatch tanpa tanya lain di antrean = berhenti (dialognya
   menunggu manusia, terlihat di pet/inbox seperti sebelumnya).
4. **AC-11 menghitung pertanyaan yang SAMA, bukan jumlah jawaban.** `answers` menjadi
   `{ sig, n }` per sesi, `sig = askSignature()` (teks pertanyaan payload / pesan giliran codex,
   dinormalisasi). Pertanyaan berbeda yang terjawab memutus deret dan melepas `capped`.
   `admitAsk` menerima `sig` dan hanya menolak bila `sig` sama dengan deret yang sudah mencapai
   `maxAutoAnswers`; pemanggil tanpa `sig` dinilai fail-closed seperti dulu. Knob, rentang (1–20),
   default (3), dan skema `Setting.lead` tak berubah — yang berubah artinya; label di layar Lead
   menjadi "Jawaban berulang per pertanyaan (maks)".
5. **Penolakan batas laju dicatat** di log server (`lead ask <sesi>: tanya <askId> ditolak batas
   laju — menunggu manusia`). Ember lajunya sendiri tak diubah.

## Alternatif yang ditolak

- **Menaikkan `maxAutoAnswers` saja / mencabut AC-11.** Menunda masalah (spec-1468 kena di 20) atau
  membuka kembali loop yang ingin dicegah AC-11.
- **Antrean tanpa pencocokan layar.** FIFO memperbaiki kehilangan event, tetapi urutan event tak
  dijamin sama dengan urutan dialog di layar (kasus spec-1457) — tanpa pencocokan, jawaban tetap bisa
  tertukar, hanya lebih jarang.
- **Pencocokan ketat (semua opsi harus identik).** Parser membaca TUI yang bisa berubah bentuk
  (pelipatan, `(Recommended)`, markdown); ketat berarti regresi senyap ke "lead tak menjawab apa pun".
- **Batas laju yang menunggu alih-alih menolak.** Butuh penantian berbatas di jalur hook (≤ 2 dtk
  `curl -m 2`); di luar lingkup — kini penolakannya setidaknya terlihat.

## Konsekuensi

- Satu langkah rantai kini membaca pane SEBELUM `decide()` (≤ 20 × `capture-pane` bila dialognya
  tak kunjung cocok). Dialog yang cocok tergambar dalam milidetik setelah `PreToolUse`, jadi biaya
  normalnya satu tangkapan.
- Test fixture rantai harus menggambar layar yang sesuai payload (judul = teks pertanyaan) — memang
  bentuk TUI sungguhan.
- Implementasi: `server/src/services/lead/{ask,detect}.ts`, `server/src/routes/session-events.ts`,
  `src/src/screens/LeadScreen.tsx`; test `server/test/lead-ask.test.ts`,
  `server/test/lead-detect-event.test.ts`, `server/test/lead-detect.test.ts`.
