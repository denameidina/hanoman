# ADR-0207 — Pengaturan: empat niat, satu aturan simpan, dan god-file dipecah

- Status: Diterima
- Tanggal: 2026-10-11
- SPEC: Audit UI/UX 2026-10 · Fase 3C (tanpa nomor SPEC; keputusan dari audit)
- Terkait: memperluas **0205** (menu di dalam hub Pengaturan; hub Pengaturan dan posisinya di grup Sistem tak berubah), menegakkan **0115** (kunci `hn.ui.v1.settings.tab` dan deep link), **0160** (bentuk URL `/settings` tetap, tanpa route baru), **0139** (wizard setup awal dan hardening tetap di niat Lanjutan), **0202** (tak ada API atau skema baru; setiap PUT yang ada dipakai apa adanya, jadi tak ada keputusan MCP baru).

## Konteks

Pengaturan adalah `SettingsScreen.tsx` 1 540 baris (99 KB) dengan 16 tab datar dan default "Akun". Tiga model simpan
berjalan berdampingan: auto-save, tombol Simpan, dan simpan saat blur. Akibatnya terlihat di basis `8380d3fa` (nomor baris
di bawah merujuk ke sana): `persist` menampilkan toast sukses sebelum PUT dan menelan galat
(`SettingsScreen.tsx:735-739`), textarea goal menyimpan tiap ketikan (`:1402`), dan `WebhookDocs` 331 baris
tertanam di dalam tab. Audit menilai IA 4/10 dan layar Settings 4–5/10.

## Keputusan

### 1. Empat niat

| Niat | Isi | Catatan |
|---|---|---|
| **Sesi harian** | notifikasi, perilaku sesi, default agen & model, mode goal, scope verifikasi, metode workflow | default |
| **Agen & model** | override per fungsi (Konflik, Lead, obrolan portal), orkestrasi | |
| **Integrasi & akses** | Akses AI Agent, Telegram, Webhook, Perangkat, Kendali jarak jauh, Akses klien | |
| **Lanjutan** | Akun, Pengguna, Setup awal, Konfigurasi (env), Log aktivitas, Custom agent, Zona bahaya | tertutup default di navigasi |

Katalog hidup di `SETTINGS_INTENTS` (`src/src/screens/settings/model.ts`). Di desktop dan tablet, niat yang punya lebih
dari satu bagian membuka daftar bagiannya di bawahnya. Di ponsel, satu `Select` "Bagian pengaturan" memuat semua bagian
dengan awalan niatnya. Niat Lanjutan terbuka hanya bila bagian aktifnya memang ada di dalamnya. Kunci lama dipetakan
lewat `normalizeSection` (`umum` → `sesi`, `orkestrasi` → `model`); nilai rusak jatuh ke Sesi harian.

### 2. Satu aturan simpan: `useSettingField`

Setiap field auto-save memakai hook yang sama dengan tiga jadwal:

| Jenis field | Jadwal simpan | Status baris |
|---|---|---|
| Sakelar, pilihan diskret | langsung (`delayMs: 0`) | Menyimpan… / Tersimpan / Gagal |
| Teks yang diketik | debounce 400 ms (`SAVE_DEBOUNCE_MS`); blur menyimpan segera (`flush`) | sama |
| Angka | dinilai saat blur atau Enter; di luar batas ditolak atau dipotong | sama |

Simpan yang gagal mengembalikan nilai tampil ke nilai tersimpan (rollback), menampilkan galat, dan menawarkan ulang
dengan nilai yang gagal. Yang punya pengecualian sengaja: **secret dan kredensial Telegram serta konfigurasi env**
memakai tombol Simpan di dalam `<form>` dan tidak auto-save.

### 3. God-file dipecah

`SettingsScreen.tsx` menjadi shell 207 baris: store snapshot, pilihan bagian, navigasi niat, pencarian, dan
`renderSection`. Isi tiap niat ada di `src/src/screens/settings/`: `SessionSettings`, `AgentsModels`, `Integrations`,
`Advanced`, `AgentAccess`, `DeviceTokens`, `SettingsSearch`, `useSettingsStore` (antrean PUT, rebase, rollback per kunci),
`useSettingField`, `rows`, `fields`, dan `engines`.

### 4. Ingatan dan deep link

Bagian aktif disimpan di `hn.ui.v1.settings.tab` (ADR-0115). `/settings#bagian=<kunci>` dibaca saat layar dibuka dan
tidak ditulis ulang saat navigasi biasa, sehingga hash tak ikut terbawa. Tak ada route baru.

### 5. Zona bahaya dan pencarian

"Reset ke default" hanya ada di Zona bahaya (Lanjutan) dan selalu lewat konfirmasi. "Cari pengaturan" adalah
`role="search"`: di dalam bagian aktif, baris dan kartu yang tak cocok disembunyikan; lintas bagian, daftar tautan
bagian yang cocok muncul di bawah kotak. Escape mengosongkan kotak.

## Alternatif yang ditolak

1. **16 tab datar dengan default Akun.** Ditolak: itulah yang dinilai audit sebagai IA 4/10.
2. **Route bersarang `/settings/<niat>/<bagian>`.** Ditolak: mengubah bentuk URL dan memutus tautan yang sudah beredar,
   pola yang sama dengan penolakan di ADR-0205 (alternatif "route bersarang").
3. **Tiga model simpan dipertahankan.** Ditolak: simpan saat blur dan tombol global membuat perubahan bisa hilang tanpa
   tanda, dan toast sukses sebelum PUT berbohong saat gagal.
4. **Auto-save juga untuk secret.** Ditolak: setiap ketikan akan mengirim nilai setengah jadi ke server. Form eksplisit
   memberi satu kali simpan yang disengaja.

## Konsekuensi & gotcha

- Setelan baru masuk ke `SETTINGS_INTENTS` dan memakai kunci bagian yang unik. `SECTION_KEYS` diturunkan dari katalog,
  jadi tak perlu daftar kedua.
- Field auto-save baru wajib memakai `useSettingField`. Field yang tak di-`flush` saat blur bisa kehilangan simpan
  terakhirnya.
- Utang yang tersisa, dicatat di frontend-implementation § 3C: `WebhookDocs` masih punya "Retry" dan "bisa basi" di
  allowlist UTANG Fase 3 (`glossary-guard`); `AgentDocCard` dan `McpPanel` masih memakai inline style di dalam Akses AI
  Agent.
- Test lama Pengaturan diperbarui ke nama niat dan bagian baru; cakupan assertion-nya tetap.

## Bukti

- Commit: `e5d44eac` (redesign per layar gelombang 1: `SettingsScreen.tsx`, `settings/useSettingField.ts`,
  `settings/model.ts`; pemecahan dan niat baru).
- Berkas: `src/src/screens/SettingsScreen.tsx` (207 baris; basis `8380d3fa` 1 540 baris),
  `src/src/screens/settings/{model.ts, useSettingField.ts, useSettingsStore.ts, SessionSettings.tsx, AgentsModels.tsx, Integrations.tsx, Advanced.tsx, SettingsSearch.tsx}`,
  `src/src/screens/styles/settings.css`.
- Tes: `src/test/settings-intents.test.tsx`, `src/test/settings-use-setting-field.test.tsx`,
  `src/test/settings-search.test.tsx`.
- Dokumen: [frontend-implementation § Fase 3C](../frontend/frontend-implementation.md),
  [audit § Status pelaksanaan](../frontend/ui-ux-audit-2026-10.md).
