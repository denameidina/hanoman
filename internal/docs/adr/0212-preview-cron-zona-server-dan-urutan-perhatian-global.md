# ADR-0212 — Preview cron dalam zona server, dan urutan "perlu perhatian" global

- Status: Accepted · **memperluas ADR-0204** (bagian 3 & "sisi UI yang belum diubah" dicabut) dan **memperluas ADR-0112** (`nextRunFor` menerima zona)
- Tanggal: 2026-10-11
- SPEC: — (tindak lanjut audit UI/UX 2026-10)
- Terkait: ADR-0198 (paginasi & filter `GET /projects`) · ADR-0099 / ADR-0202 (MCP, keputusan wajib) · ADR-0135 (`handledBy`) · ADR-0107 (state scheduler)

## Konteks

1. **Preview cron memakai zona browser.** `nextRunFor` hanya menghitung di zona lokal proses; `SchedulerCrons`
   hanya menampilkan preview bila zona browser kebetulan sama dengan zona server (ADR-0204). Di luar itu operator
   tak melihat jam jalan berikutnya sama sekali.
2. **Urutan "perlu perhatian" hanya per halaman.** Tampilan default memanggil `GET /projects` berhalaman, lalu
   `ProjectsScreen` mengurutkan setiap halaman di klien. Project yang dokumennya rusak bisa jatuh ke halaman kedua.

## Keputusan

**1. `nextRunFor(expr, after, tz?)` menerima zona IANA (`shared/src/cron-expr.ts`).**
- Tanpa `tz`: perilaku lama, zona lokal proses. Server tak berubah.
- Dengan `tz`: jam dinding dipecah lewat `Intl.DateTimeFormat` (`hourCycle: h23`) dan dikonversi balik ke
  instan. Zona tak dikenal → `null`, sama seperti ekspresi tak sah.
- **Perilaku DST** (diuji matriks UTC, Asia/Jakarta, America/New_York):
  - musim semi, jam yang tak ada (02:30 saat 02:00 → 03:00): jatuh tempo bergeser ke 03:30, sekali; sama dengan zona lokal JS;
  - musim gugur, jam ganda (01:30 saat 02:00 → 01:00): kemunculan **pertama** yang dipakai, jadi jadwal berjalan sekali;
  - hari yang melintasi transisi memakai pemindaian penuh; hari lain satu offset, tanpa konversi per kandidat.

**2. `SchedulerCrons` memakai `serverTimeZone`** (sudah ada di state/config, ADR-0204). Preview selalu dihitung dalam
zona server; catatan "preview hanya bila zona browser sama" dan cabangnya dihapus. Zona browser tinggal cadangan
untuk state lama yang belum melaporkan zona.

**3. `GET /projects` menerima dua param opsional** (`server/src/routes/projects.ts`, `services/project-list.ts`):
- `sort=attention`: mengurutkan **seluruh hasil** sebelum dipotong: rusak (0) → drift (1) → sisanya (2); dalam
  tiap rank menurut nama (huruf kecil), lalu id. Urutannya total, jadi paginasi lintas halaman konsisten.
- `attention=1|true` (juga `0|false`): menyaring ke project dengan `docStatus` ≠ `ok`. Nilai lain → **400**.
- `sort` dengan nilai selain `attention` → **400**, bukan diabaikan diam-diam.
- Tanpa kedua param, balasan persis seperti sebelumnya (backward compatible).
- Memakai `docStatus` yang sudah dihitung `toProjectView`; tak ada kolom atau migrasi baru.

**4. `ProjectsScreen`**: tampilan default dan chip "Perlu perhatian" meminta `sort=attention` (chip itu juga
`attention=true`) lewat API berhalaman. Klien **tak lagi mengurutkan ulang** (`sortByAttention` dibuang dari layar).
Chip "Sesi berjalan" tetap memakai daftar penuh dari App, karena status sesi tak ada di API; urutannya urutan App.

**5. Keputusan MCP: param aditif pada tool yang ada, tanpa tool baru.**
- `hanoman_projects_list` mendapat `sort` (enum `attention`) dan `attention` (boolean; `false` menghilangkan
  parameternya, sama seperti `startable` di backlog). Keduanya opsional, jadi kontrak v1 (parameter wajib) tak berubah.
- Route `GET /projects` sudah terjangkau tool itu; capability tetap `projects:read`. Tak ada entri baru di
  `UNWRAPPED`/`COOKIE_ONLY`. `mcp-coverage` tak berubah.
- Preview cron tidak dibungkus tool MCP: `computeNextRun` di server tetap zona lokal, dan tool scheduler yang ada
  sudah membawa `serverTimeZone` lewat state/config (`shape: raw`).

## Konsekuensi

- **Perilaku baru:** `GET /projects?sort=…` dan `attention=…` ada; nilai di luar daftar menjawab 400. Klien lama
  yang tak mengirim keduanya tak terdampak.
- **Tanpa migrasi, tanpa perubahan skema.** `shared/src/dto.ts` tidak disentuh.
- **Biaya:** setiap `GET /projects` tetap menghitung `docStatus` untuk seluruh project (perilaku lama, ADR-0018),
  lalu mengurutkan. Pengurutan itu O(n log n) atas daftar yang sudah ada di memori.
- **Batas:** chip "Sesi berjalan" tidak diurut perhatian (tak diminta, dan status sesi tak ada di API). Jalur
  klien non-paginasi (`pageSize` tak diberikan) juga tak diurut; produksi selalu memberi `pageSize`.
- Pengujian: `server/test/projects-sort.route.test.ts` (lintas halaman), `server/test/project-list.test.ts`
  (fungsi murni), `shared/src/cron-expr.test.ts` (matriks zona), `shared/src/mcp-catalog.projects.test.ts`,
  `src/src/screens/ProjectsScreen.test.tsx`, `src/src/screens/SchedulerCrons.test.tsx`.
