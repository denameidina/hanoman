# ADR-0175 — Workspace QA: sync dua arah + byte lampiran di luar feed; temuan → backlog; ekspor OOXML tanpa dependensi

- Status: Accepted
- Tanggal: 2026-10-01
- SPEC: — ([desain](../../../docs/superpowers/specs/2026-10-01-qa-workspace-part2-4-design.md),
  [rencana](../../../docs/superpowers/plans/2026-10-01-qa-workspace-part2-4.md))
- **Melengkapi** [0174](0174-workspace-qa.md) (bagian 1: fondasi, LOCAL-only). **Memperluas**
  [0068](0068-lampiran-tiket-masuk-record-sync.md) (byte lazy-fetch hub → local) menjadi dua arah dan ber-verifikasi.

## Konteks

ADR-0174 menyiapkan skema (kolom `version`, `backlogId`, `sha256`, `syncState`) tetapi menahan tiga hal: laporan hanya
hidup di satu mesin, temuan tak bisa menjadi pekerjaan agen, dan keluaran terbatas Markdown/ZIP. Ketiganya dikerjakan di sini.

## Keputusan

### Temuan → backlog
1. `POST …/findings/:fid/backlog` dan `POST …/reports/:rid/backlog` membuat backlog `source: qa` — cermin `escalateTask`
   (ADR-0152): idempoten lewat `QaFinding.backlogId`, tautan putus dibuat ulang, retry P2002, `launchApprovedAt` hanya bila principal
   punya `sessions:write`. Capability tetap `qa:write` (permukaan MASUK memegang capability-nya sendiri, cermin ADR-0157).
2. Pemetaan **lossy dan dinyatakan**: severity blocker/critical→critical, major→major, minor/trivial→minor; P0/P1→tinggi, P2→sedang,
   P3→rendah. Nilai QA asli ikut tertulis di teks backlog. Lampiran temuan DISALIN (key baru) — berbagi key membuat hapus satu sisi merusak sisi lain.
3. **Pengecualian read-only:** laporan `closed` tetap boleh mengirim temuan (hanya tautan yang berubah, bukan isi). `QaFinding.spec` adalah cermin
   yang dihitung saat baca, tak disimpan. Tanpa siklus retest.

### Sync
4. `qaReport`/`qaCase`/`qaFinding`/`qaAttachment` masuk `SYNCED` (+ `FIELDS`, `PARENTS` cascade, `BOOTSTRAP_ORDER` induk-sebelum-anak). `version` dan
   `syncState` TIDAK masuk FIELDS (stempel mekanisme / state lokal). Konflik memakai LWW + modal rekonsil yang ada (ADR-0067); hapus memakai tombstone (ADR-0119).
   Mengubah anak juga menerbitkan laporan (`updatedAt` = jam LWW). Hapus project membuang byte lokal sebelum baris cascade.
5. **Byte tak pernah lewat feed.** Dua endpoint device-token di scope terenkapsulasi: `GET`/`PUT /api/sync/qa-attachments/:id`, batas 10 MB di PARSER
   (413 terlepas dari urutan otentikasi). Hub memverifikasi **ukuran + sha256 + tipe** sebelum menulis, dan tujuan tulis selalu `storageKey` baris itu —
   tak pernah path dari body. Hub TIDAK menjalankan ulang pipeline unggahan (normalisasi gambar mengubah byte → sha256 tak cocok); byte sudah
   dinormalisasi & dipindai di mesin asalnya.
6. `storageKey` yang menyeberang divalidasi di PINTU RECORD (`validateSyncData`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`, mime daftar-putih, `sha256` 64 hex, `size` ≤ 10 MB)
   **dan** di endpoint byte (pertahanan berlapis): key datang dari peer mana pun yang memegang device token, dan menjadi path di upload dir hub.
7. **`syncState` per mesin** (kolom LOCAL): `local-only` (byte hanya di sini, belum diunggah) · `remote` (metadata ada, byte belum diunduh) · `available` ·
   `failed` (hub menolak isi, atau byte lokal hilang — jangan diulang selamanya). Record lampiran BARU dari peer lahir `remote`/`available` menurut keberadaan
   byte; gema record milik sendiri TIDAK menyentuh state (kalau tidak, unggahan berhenti selamanya). Hub/standalone tak punya atasan: `local-only` dibaca `available`.
8. Client: `readQaAttachmentBytes` = SATU pintu baca (penyajian, ekspor, salin ke backlog): lokal → tarik dari hub (dedupe serentak, verifikasi, cache) →
   null. `uploadPendingQaBytes` dipanggil di akhir `syncOnce` SESUDAH outbox dikuras (hub menolak PUT tanpa baris), maks 5 per siklus, best-effort.
   Tanpa GC byte lintas mesin (ADR-0068).

### Ekspor
9. DOCX, XLSX, PDF, CSV **tanpa dependensi baru**: OOXML ditulis sendiri di atas `zip.ts`; PDF lewat `pdfkit` + `sharp` (webp→png); screenshot tertanam. Impor matriks test case
   (XLSX/CSV) = upsert via kolom `Ref`, kolom absen ≠ sel kosong, transaksi semua-atau-tidak-sama-sekali. Pembaca XLSX tahan simpanan Excel (sharedStrings, rich text,
   sel lompat, sheet bernama "Test case").

## Verifikasi

Dua proses nyata (hub + client, DB dan upload dir terpisah): client→hub (metadata + byte), hub→client (fetch-through ber-hash), edit dan hapus dua arah, cascade.
Pembaca independen: `python-docx` (DOCX), `openpyxl`/`xlsxwriter` (XLSX), PyMuPDF/`pdftotext` (PDF).

## Konsekuensi

- Satu migration additif (`QaAttachment.version/updatedAt`); baris lama diisi `updatedAt = createdAt` (hasil generate Prisma tak mengisinya dan gagal di DB berisi — diverifikasi).
- Hub **harus dinaikkan lebih dulu** (urutan rilis hub-duluan, ADR-0135): client baru yang mendorong `qaReport` ke hub lama ditolak per-record ("unknown entity"), non-destruktif dan sembuh sendiri.
- Nomor tampil (QA-007/F-01/TC-03) tetap dihitung saat render; setelah sync, baris lebih tua dari mesin lain dapat menggeser nomor. Ekspor membekukannya.
