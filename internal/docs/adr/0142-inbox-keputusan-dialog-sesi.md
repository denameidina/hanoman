# ADR-0142 — Inbox keputusan: dialog sesi dibaca & dijawab lewat HTTP bergerbang `screenHash`, di luar katalog MCP

Tanggal: 2026-08-22 · Status: diterima · Sumber: spec `docs/superpowers/specs/2026-08-22-spec-899-pet-inbox-keputusan-design.md`
Menegakkan ADR-0039 (tanpa channel realtime baru), ADR-0037 (isolasi lewat worktree, bukan lewat
prompt izin), ADR-0065 (peta route→capability), ADR-0091 (gerbang lead), ADR-0099 (MCP tak
mengeksekusi), dan ADR-0102 (jebakan widget multiSelect). Tak mencabut satu pun.

## Konteks

`server/src/services/tui-dialog.ts` sudah memiliki **seluruh** mekanisme untuk menjawab dialog
`AskUserQuestion` sebuah sesi: ia mem-parse teks pane menjadi `ChoiceDialog` dan menjawabnya lewat
primitif `PaneIO` yang disuntikkan, lengkap dengan empat jebakan yang terukur in-vivo pada claude
2.1.220 — burst > 1 karakter ditelan (SPEC-452), digit memilih seketika, kolom bebas ada di nomor
`opsi+1`, dan tombol `Submit` multiSelect tak punya nomor (SPEC-485/ADR-0102). Yang memakainya hari
ini hanya `hanoman-lead`, lewat `sendToPane`.

Untuk manusia tak ada pintunya. Panel pet (SPEC-897) menghitung, menamai, dan memberi umur pada
sesi `waiting`, lalu SPEC-898 membuat pet mengucapkannya — tetapi satu-satunya tombolnya tetap
"Buka Terminal". Operator harus pindah layar, mencari pane yang benar di antara grid workspace,
membaca ulang pertanyaan yang tadi sudah dibacakan pet, lalu menjawabnya lewat keyboard.

`POST /terminal/sessions/:id/steer` tak cukup untuk itu: ia menerima prosa dan tak pernah
mengembalikan bentuk layar (klien tak tahu apa pertanyaannya), ia mengetik ke layar apa pun yang
kebetulan sedang tampil (tak ada gerbang kesegaran untuk aksi yang lahir dari sebuah **daftar**),
dan `choices`-nya dicocokkan fuzzy lewat `resolveChoices` — benar untuk agen yang menalar dengan
bahasa, mubazir untuk manusia yang menunjuk baris nomor sekian.

## Keputusan

1. **Dua endpoint di bawah `/api/terminal/sessions/:id/`.** `GET …/dialog` →
   `200 { dialog, screenHash }` / `204`; `POST …/dialog/answer` `{ screenHash, choice?, choices?,
   text? }` → `202`. Prefix itu sudah dipetakan `capabilityForRoute` ke `rw("sessions")`, jadi
   capability-nya diturunkan **dari method** (`sessions:read` / `sessions:write`) tanpa satu baris
   pun perubahan peta — pola anti-SPEC-405.

2. **`screenHash = sha256(dialogKey(paneText)).slice(0,16)`.** Bukan hash teks pane mentah: pane
   memuat kursor berkedip dan spinner, jadi hash atasnya berbeda antar dua `capture-pane`
   berturut-turut dan setiap jawaban akan ditolak `409`. `dialogKey` sudah memikul dua pelajaran
   yang persis dibutuhkan di sini — label kolom bebas **tak ikut** (SPEC-474: begitu prosa mendarat
   labelnya berubah tanpa satu pun pertanyaan berpindah) dan `☐/☒` tab strip layar `multi`
   **dibuang** (gotcha ADR-0102 #1: mencentang satu opsi sudah membalik tab yang tampil jadi `☒`).
   Hasilnya hash yang stabil terhadap kursor & centang berjalan, dan berubah tepat saat dialognya
   terjawab (layar berhenti jadi dialog → `none`) atau rantainya maju (judul berganti). Di-hash,
   bukan mentah, supaya klien memperlakukannya sebagai token buram.

3. **Dispatch jawaban adalah CERMIN `sendToPane`, tanpa cabang baru.** `multi && submit.present` →
   `answerMultiSelectDialog`; `freeIndex !== null` → `answerChoiceDialog`; `notes` →
   `answerNotesDialog`. Tak satu pun primitif `tui-dialog.ts` ditulis ulang, dan `sendToPane` tak
   berubah satu byte. Primitif pane `pty.ts` hanya **diekspor** (`dialogIO` → `paneIO`): dua titik
   tulis yang tak sepakat soal cara mengetik adalah pola kegagalan SPEC-431/448.

4. **Layar yang tak punya kolom bebas maupun kolom catatan tak pernah dilaporkan bisa dijawab.**
   Itu dialog trust codex dan prompt izin claude. `sendToPane` sengaja tak menyentuhnya — "`Enter`
   memilih baris 1 yang memang berarti 'ya', dan mengubahnya menukar bug ini dengan regresi" — dan
   memasang tombol dashboard yang menjawab **prompt izin** adalah kebalikan penuh dari batas
   ADR-0037: kepercayaan penuh pada agen ditebus dengan isolasi worktree, bukan dengan tombol izin
   yang bisa diklik dari jauh. Layar rekap rantai (`kind: "review"`) juga `204`: ia tak punya
   pertanyaan, dan jalur mekanisnya sudah dimiliki lead (`submitPaneDialog`).

5. **Dua gerbang tulis.** Sesi ber-`isDeciding` → `409 reason:"deciding"` (ADR-0091 apa adanya;
   `lead/gate.ts` & `lead/deciding.ts` tak disentuh). Jawaban kedua untuk sesi yang sama selagi
   yang pertama berjalan → `409 reason:"answering"`, dijaga `Set<string>` in-memory (cermin
   `lead/deciding.ts`): dua POST berbarengan menyilangkan keystroke di satu pane jadi sampah yang
   tak bisa ditarik kembali.

6. **Di luar katalog MCP.** ADR-0099 sudah menetapkan MCP tak mengekspos tool yang mengeksekusi,
   dan SPEC-646/ADR-0112 menegaskannya untuk cron ("sebuah baris cron adalah
   `POST /terminal/sessions` yang ditunda"). Endpoint ini melangkah satu petak lebih jauh: ia
   menjawab pertanyaan yang **secara desain ditujukan kepada manusia**. Agen yang bisa
   memanggilnya bisa menjawab pertanyaannya sendiri, dan gerbang "manusia terakhir yang
   memutuskan" runtuh lewat pintu belakang. Capability tetap ada karena peta itu berlaku untuk
   seluruh permukaan HTTP, bukan hanya untuk yang muncul di MCP.

## Konsekuensi

- **Jawaban single-select tiba di agen sebagai teks kolom bebas berisi label opsi**, bukan sebagai
  "opsi ke-n dipilih". Untuk `AskUserQuestion` keduanya sampai ke model sebagai kalimat yang sama.
- **Dua pertanyaan berjudul sama persis dalam satu rantai punya `screenHash` yang sama.** Bentuk
  fail-*open* yang sempit, dan jawaban yang mendarat tetap jawaban atas pertanyaan berjudul sama
  yang dilihat operator. Menutupnya butuh identitas layar yang lebih kuat dari yang dipakai lead
  sendiri, dan dua definisi "layar mana ini" yang bisa berselisih adalah kelas kegagalan
  SPEC-431/448.
- **Gelembung pose `waiting` berhenti `aria-hidden`** karena ia kini punya tombol, dan elemen di
  dalam `aria-hidden` tak bisa difokuskan sama sekali. Keputusan SPEC-898 #3 tetap dipegang: yang
  disembunyikan pindah ke **teks**-nya, sehingga region `role="status"` di `pet-stage` tetap
  satu-satunya yang membacakan kabar.
- Tanpa skema DB baru, tanpa migration, tanpa channel realtime baru, tanpa polling berkala:
  keadaan "sudah terjawab" datang dari siaran `sessions` yang sudah ada, karena marker keputusan
  dikosongkan hook `UserPromptSubmit` yang sudah ada (SPEC-184, ADR-0141).

## Alternatif yang ditolak

- **Menekan digit opsi untuk single-select.** Lebih harfiah dan memberi agen opsi terstruktur,
  tetapi tak punya titik pembatalan: begitu byte-nya keluar, sesi sudah bergerak.
  `answerChoiceDialog` membuktikan teksnya mendarat (`freeTextFilled`) **sebelum** menekan `Enter`.
  Untuk aksi yang menggerakkan agen sungguhan atas satu klik di dashboard, jalur yang bisa gagal
  dengan aman menang atas jalur yang lebih harfiah.
- **Memperluas `POST …/steer`.** Tak punya kontrak layar (§Konteks), dan menambahkannya di sana
  berarti satu endpoint dengan dua semantik: "ketik apa saja" dan "jawab dialog yang ini".
- **Menaruhnya di katalog MCP** — lihat keputusan 6.
- **Polling dialog berkala dari dashboard.** Melanggar ADR-0039 dan tak dibutuhkan: dialog diambil
  saat panel dibuka, dan `409 stale` memuat ulang saat layarnya ternyata sudah berganti.
