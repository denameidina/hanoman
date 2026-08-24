# ADR-0148 — Status hidup per-device disimpan di MEMORI, tak pernah menyentuh DB

**Status:** aktif (SPEC-919) · 2026-08-24.
**Menegakkan** [0131](0131-retensi-change-feed-sync.md) (feed sync tak boleh dibanjiri tulisan
berkadens tinggi), [0045](0045-skema-sync-synclog-version-stamp.md) (yang menyeberang adalah *record*),
[0086](0086-sqlite-satu-satunya-provider.md) (satu berkas SQLite, tanpa Redis/queue),
[0024](0024-sesi-interaktif-menggantikan-run.md) (nol worker baru).
Berpasangan dengan [ADR-0147](0147-kanal-presence-di-socket-sync.md), yang memutuskan bagaimana
keadaan itu sampai ke hub.

## Konteks

SPEC-919 membawa "sesi apa yang hidup di device mana" ke hub. Pertanyaan yang tersisa: di mana
keadaan itu disimpan, dan apakah ia entitas.

Pola default repo ini untuk "keadaan milik satu mesin" adalah **tabel LOCAL-only** —
`LocalBinding`, `SyncState`, `SyncOutbox`, `SyncConflict`, `SessionHistory`, `User.terminalWorkspace`
(ADR-0118). Semuanya baris DB yang sengaja tidak masuk `SYNCED`/`FIELDS`.

Yang membuat presence berbeda adalah **kadensnya**. ADR-0131 mengukur apa yang terjadi ketika
sesuatu berkadens tinggi menulis ke DB hub: `pollHealth()` memanggil `notifySynced("vps", …)`
setiap polling — sekali per 5 menit per VPS — dan menghasilkan **121.222 baris / 213,6 MB, yaitu
83 % isi database hub**, sampai hub tercekik `P1008 Socket timeout` berulang. Presence berdenyut
**tiap 30 detik per device**: dua orde lebih sering daripada sumber yang sudah pernah merobohkan
hub produksi.

## Keputusan

### 1. Registry di memori, nol tabel, nol kolom, nol migration

`services/presence/registry.ts` menyimpan `Map<deviceId, { sessions, lastFrameAt }>` dan
**tak menyentuh Prisma sama sekali**.

Ini bukan "tabel yang kebetulan tak masuk `FIELDS`" — barisnya tak pernah lahir. Perbedaannya
bukan retoris: `FIELDS`, `SYNCED`, `PARENTS`, `DATE_FIELDS`, `JSON_FIELDS`, `BOOTSTRAP_ORDER`, dan
`PG_ORDER` adalah **tujuh daftar literal yang harus bergerak bersama**, dan repo ini sudah
membayar kelas gagal-senyap itu berkali-kali (ADR-0090/0093/0105/0135). Keadaan yang tak punya
baris **tak bisa** masuk `SyncLog` walau kelak seseorang menambah entitas ke `SYNCED` tanpa membaca
ADR ini. Jaminannya struktural, bukan disiplin.

### 2. Alternatif yang ditolak

- **Model `DevicePresence` LOCAL-only** (pola `LocalBinding`/`SyncState`). Nilai yang ditawarkannya
  adalah "bertahan restart" — dan nilai itu tidak ada: restart hub memutus socket, jadi barisnya
  basi sampai reconnect toh. Yang dibayar adalah persis harga yang dilarang ADR-0131: tulisan
  SQLite per denyut per device, ke berkas yang sama yang melayani `GET /specs`.
- **Menjadikan presence entitas tersync.** Mustahil dibenarkan: nilainya berumur detik dan hanya
  berarti untuk mesin yang sedang menyala.
- **Kolom `lastSeenAt` baru.** Tak perlu: `DeviceToken.lastSeenAt` sudah ada dan sudah ditulis
  best-effort oleh `verifyDeviceToken` pada setiap request sync ter-auth. "Terakhir terlihat" untuk
  device offline karena itu **tak menuntut satu kolom pun**. Kanal presence sendiri sengaja
  **tidak** menulis `lastSeenAt` per denyut — itu akan mengembalikan tulisan berkadens tinggi lewat
  pintu belakang.

### 3. `statusAt` dicap di registry, bukan oleh klien

Registry membandingkan status baru dengan status sebelumnya per `(deviceId, sessionId)` dan
mencap waktu **hanya saat berubah**.

Alasannya bukan kerapian. Kalau klien yang mengirim `statusAt`, "sedang bekerja" tak punya stempel
yang jujur di sana: satu-satunya bahan yang tersedia adalah aktivitas pane, yang bergerak tiap
detik — signature berubah tiap denyut, dan pengirim yang seharusnya diam berubah jadi banjir
frame. Karena sesi mesin hub sendiri masuk lewat pintu yang sama (ADR-0147 §8), rumus ini berlaku
seragam untuk device lokal maupun remote.

### 4. Keadaan basi punah sendiri

Dua jalur, keduanya tanpa timer:

- socket putus → `dropPresence(deviceId)`, device offline **seketika**;
- denyut berhenti melewati `PRESENCE_OFFLINE_MS` = 90 detik (3× denyut, jadi satu denyut hilang
  tak menghukum) → entri disapu **saat dibaca**, bukan oleh penyapu berkala.

Registry yang kosong sesudah restart hub adalah **fitur**: klien mengisinya kembali dalam satu
siklus reconnect (≤ 30 detik), dan tak ada baris basi yang perlu direkonsiliasi.

## Konsekuensi

**Baik.** Nol migration, nol entri di tujuh daftar sync, nol tulisan DB per denyut. Presence
mustahil membanjiri `SyncLog` — bukan karena diawasi, melainkan karena tak punya jalan ke sana.
Registry-nya fungsi murni terhadap waktu yang disuntik, jadi ambang offline dan stempel transisi
bisa diuji tanpa menyentuh jam maupun DB.

**Buruk.** Keadaan hilang saat proses restart, dan tak ada riwayat: "sesi apa yang jalan tadi pagi"
tak bisa dijawab dari sini. Itu memang bukan pertanyaan yang backlog ini jawab — `SessionResult`
dan `SessionHistory` yang memegang jejak eksekusi. Keputusan ini juga mengasumsikan **satu proses
server** (ADR-0086: nol worker terpisah, nol Redis); membelah server jadi beberapa proses kelak
akan membelah registry ini bersamanya, dan itu menuntut ADR baru.

**Batas.** Presence murni informasional — ia tak menggerbangi start sesi, worktree, auto-merge,
scheduler, maupun lead, dan tak boleh mulai dibaca jalur eksekusi tanpa ADR baru. Batas yang sama
dengan ADR-0135 §6, dengan alasan tambahan yang khusus di sini: keadaan yang punah sendiri tak
boleh jadi prasyarat bagi keputusan yang harus deterministik.
