# Audit UI/UX dashboard hanoman — Oktober 2026

Audit menyeluruh seluruh tampilan dashboard dengan tujuan **UI/UX minimalis, clean, usable**. Dokumen ini adalah
laporan temuan dan usulan redesign; belum ada perubahan kode. Pekerjaan perbaikan diturunkan ke backlog/ADR terpisah.

## Metode dan batasan

- 52 subagent (model Haiku): 21 layar × 2 sudut pandang, ditambah 9 audit lintas-halaman.
  - POV A: **pengguna harian** — tugas utama, jumlah klik, hierarki, noise, state kosong/loading/error, copy, aksi destruktif.
  - POV B: **desainer minimalis + a11y + responsif** — spacing, tipografi, kontras, ARIA, keyboard, mobile, kepatuhan design system.
  - Lintas-halaman: IA/navigasi, onboarding, responsif, aksesibilitas fondasi, copy, design system/CSS, densitas, power user, performa.
- **Audit statis dari kode** (`src/src/**`), tanpa render browser. Temuan yang agen tandai "perlu verifikasi runtime"
  (layout 360 px, urutan fokus, kontras aktual) belum terbukti. Angka kontras dihitung dari hex token, bukan diukur.
- Nomor baris merujuk kode saat audit (commit `8380d3fa`); bisa bergeser.

## Skor per layar (1–10)

| Layar | Skor | Layar | Skor |
|---|---|---|---|
| Dalang | 4 | Overview | 5 |
| Lead | 4–5 | Scheduler | 5 |
| Klien | 4–6 | IDE | 5 |
| Settings | 4–5 | VPS · Skills · Docs | 5 |
| Triase | 4–6 | Backlog · PRD · Tim · QA · Projects | 5–6 |
| Terminal | 5–6 | Auth · Setup | 6 |
| Review | 5 | Portal pelanggan | 5 |

Lintas-halaman: IA 4 · onboarding 5 · a11y 5 · power user 5 · responsif 6.

## Masalah sistemik

1. **Terlalu padat dan duplikat.** "Sesi aktif", "perlu perhatian", dan "total spec" tampil 3–4 kali
   (`OverviewScreen.tsx:137-140,150,158,192`, `DalangStage.tsx:170-180`). Toolbar Backlog ±13 kontrol
   (`BacklogScreen.tsx:1034-1090`); kartu Backlog 5 aksi + ±8 metadata.
2. **Design system tidak ditegakkan.** 1.416 `style={{` di `screens/` (Settings 137, Backlog 100, Terminal 60, GitGraph 60);
   496 `fontSize` literal vs 100 token (210 off-skala: 12.5/11.5/13.5/10/10.5); 981 angka spacing literal; 48 `!important`
   dan satu selektor `[style*="flex: 1"]` di `app.css`; hover via `useState` di 9 file; 106 `<button>` dan 43 `<input>` native.
   Berkas raksasa: `App.tsx` 114 KB, `SettingsScreen` 99 KB, `TerminalScreen` 82 KB, `BacklogScreen` 68 KB.
3. **Kontras token.** `--text-subtle` (#90826c) ±3,7:1 di kartu dan ±3,2:1 di panel, dipakai 188 kali sebagai warna teks.
   Teks tombol primer putih di brass-500 ±3,2:1 (override `app.css:751`). `--status-warn` ±3,1–3,7:1.
   `--border-strong` input 1,51:1 dan `--border-focus` 2,99:1 (WCAG 1.4.11 butuh 3:1).
4. **Error ditelan.** ±38 `.catch(() => {})` dan ±19 `catch {}` non-test. Pola berulang: gagal memuat tampil sebagai
   empty state ("Belum ada …", "Tak ada konflik", "Memuat…" selamanya).
5. **Tanpa undo, command palette, atau shortcut global.** Toast satu slot, 2,6 dtk, tanpa aksi (`ds/kit.tsx:11-43`).
   Shortcut nyata hanya di GitGraph. Alur "sesi butuh keputusan → jawab" = 2 klik ke terminal + 1–2 klik jawab.
6. **Copy campur dan jargon bocor.** "SoT", "SpecSlim", "on-convention", "basi", "gerbang", "cap", "grant", "debog";
   enum mentah (`from-scratch`, `wontfix`, `blocker`, `priority`); satu konsep banyak istilah (Klien/Device/Mesin/hub);
   tiga format waktu relatif ("baru saja lalu").
7. **Performa terasa** (perlu profiling): snapshot WS `sessions`/`pending`/`leadAsks` memicu re-render seluruh `App.tsx`
   (±1800 baris) tanpa digest; atlas pet 1,1 MB selalu dimuat; layar Dalang re-render tiap 26 ms (ticker) dan 1 dtk (jam);
   font via `@import` render-blocking; scroll menulis localStorage tiap frame (`ui-state/hooks.ts:84`).
8. **Responsif dilawan dengan `!important`.** Layout inline di TSX dikalahkan CSS mobile. Viewport tanpa `viewport-fit=cover`
   (`index.html:5`) → token `--safe-*` tidak aktif. Beberapa grid inline tanpa `hn-grid-mobile` (`App.tsx:576,594,617`).

## P0 — perbaiki dulu

### Aksi destruktif tanpa konfirmasi (melanggar aturan DS)
| Aksi | Lokasi |
|---|---|
| Hapus spec | `BacklogScreen.tsx:598`, `App.tsx:1429` |
| Tutup/kill sesi terminal; "Buang" ketikan tertahan | `TerminalScreen.tsx:313-317`, `TerminalPane.tsx` (`dropHeld`) |
| Hapus akun klien | `ClientAccessPanel.tsx:102` |
| Reset hard / Clean untracked | `GitGraph.tsx:135-137,677-679` |
| Reset Settings; hapus/reset config (termasuk secret) | `SettingsScreen.tsx:931-935,349-352,389-409` |
| Hapus cron | `SchedulerCrons.tsx:158-163,216` |
| Hapus test case / lampiran QA; "Kirim semua ke backlog" | `QaCasesPanel.tsx:87`, `QaAttachments.tsx:65`, `QaFindingsPanel.tsx:64-84` |
| Hapus custom agent; "Timpa" skill | `CustomAgentsPanel.tsx:221-225`, `SkillEditor.tsx:74-78` |
| Batalkan keputusan/rantai Lead; Submit | `LeadScreen.tsx:243-244,376-381,473-475` |
| Hapus lampiran spec; tolak issue GitHub | `SpecAttachments.tsx:132-158`, `TriageScreen.tsx:293-298` |
| Sign-out | `auth/AccountMenu.tsx:49` |

### Data hilang diam-diam
- Draft editor dibuang saat pindah berkas: `DocsWorkspace.tsx:153,159`, `IdeScreen.tsx:175-189`, `SkillEditor.tsx:58-62`;
  "Kembali" QA editor (`QaReportEditor.tsx:65`).
- Input angka Lead/Scheduler dipaksa ke minimum saat dikosongkan, dan Lead menyimpan tiap ketukan lalu `disabled={busy}`
  → fokus hilang (`LeadScreen.tsx:84,103-124,334`; `SchedulerScreen.tsx:275,287,333`).
- Settings `persist` menampilkan toast sukses sebelum PUT dan menelan error (`SettingsScreen.tsx:735-739`);
  textarea goal menyimpan per ketikan (`:1402`).
- Pesan chat portal yang gagal terkirim tampak terkirim (`portal/ChatPanel.tsx:80-89`).

### Fitur rusak / menyesatkan
- Tab IDE di Klien selalu "Tak ada project aktif": `projectId` tidak diteruskan (`ClientsScreen.tsx:139-140`).
- Layar Dalang tanpa jalan keluar di mobile: tombol ✕ ada di `.hn-dlg-chips` yang `display:none` ≤767 px, 34×34 px.
- Edit di IDE tetap aktif saat ref lain dipilih → menimpa working tree dengan isi ref lama (`IdeScreen.tsx:500,247-251`).
- `FolderPicker` baris folder = `div onClick`, tak bisa keyboard (`FolderPicker.tsx:14-21`); "Pilih folder ini" memilih path
  ketikan yang belum divalidasi (`:44,47`).
- `ReconcileModal` gagal memuat → "Tak ada konflik. Semua sinkron." (`ReconcileModal.tsx:19,52`).
- Keyboard trap terminal: semua tombol ke pty, tanpa jalan keluar yang terlihat (`TerminalPane.tsx:486-498`).
- Daftar kosong menyamar error: Projects, Klien, Skills, Custom agent, Triase, Portal (lihat per layar).
- Form config Lead/Scheduler dapat kehilangan setelan yang belum disimpan saat Pause/Stop memicu reload.

## Temuan per layar (ringkas)

**Overview (5)** — duplikasi KPI/kartu; hero Dalang memakan fold; jargon "SpecSlim/SoT/on-convention"; KPI "0/0" saat tanpa project
dan pesan "Semua project on-convention" menyesatkan; dua kartu "Limit langganan" berjudul sama; Overview kosong tanpa CTA onboarding.

**Dalang (4)** — mayoritas dekoratif, duplikat Overview/pet/Terminal; "HANOMAN ONLINE / SEMUA SISTEM NORMAL" hardcoded;
"menunggu" bermakna dua hal; ticker/jam me-render ulang seluruh layar; HUD/scan line/float tanpa makna; footer kontras ±2,9:1;
`role="list"` tanpa `listitem`.

**Projects & Detail (5–6)** — pintu kerja (Docs/Terminal/Backlog) terkubur di bawah lima kartu konfigurasi; StatStrip dan hapus
per baris; tabel 6 kolom tanpa aturan tablet; enum `from-scratch`; clone dikonfirmasi dua kali; error list ditelan;
`Callout` error `role="note"`.

**PRD (6)** — seleksi tersimpan selalu dihapus saat mount (`PrdScreen.tsx:275`); tanpa loading/error di daftar dan isi;
dua CTA ke backlog (Take vs Breakdown) dengan hierarki terbalik; `.hn-md` tanpa `max-width`; header pratinjau tanpa wrap;
tumpang tindih dengan "Jadikan PRD" di Backlog.

**Backlog (6)** — kartu 5 aksi + 8 metadata; toolbar ±13 kontrol; label aksi berbeda ("Mulai/Lanjutkan/Buka sesi lagi",
"Review/Review perubahan"); detail tak punya jalan menjalankan agen untuk item belum `done`; `err` merah untuk prioritas tinggi
dan sumber QA sekaligus; `StageBar` `aria-label` pada `div`; `TaskModal` bisa ditutup saat menyimpan; drag-drop hanya `title`.

**Tim (5–6)** — dua papan, dua kolom "Backlog" dengan aturan drop berbeda; kartu menampilkan `projectId` mentah;
filter kosong tanpa jalan keluar; daftar anggota gagal senyap; papan 4 kolom geser horizontal (DS minta pemilih panel);
timeline label sticky 232 px; batang timeline hanya beda warna; kontras `--text-subtle`/amber.

**QA (5–6)** — metadata ±15 field di atas tab kerja; severity/status mentah di kartu; hapus test case tanpa konfirmasi;
autosave blur tanpa indikator; tiga pintu ekspor; `Field` membungkus seluruh isi dalam `<label>`.

**Triase (4–6)** — tolak 3 klik, tanpa aksi massal tiket; keystroke memicu loading penuh; filtered-empty salah teks;
baris terpilih tak ditandai; toolbar detail ±11 kontrol; clipboard tanpa catch; tolak issue tanpa konfirmasi/undo.

**Scheduler (5)** — 11 kartu bertumpuk, antrean di urutan 6; "Gagal" tanpa aksi; jargon (gerbang, cap, load per core);
modal cron 12+ field; "zona waktu server" kontradiktif dengan waktu lokal; `LimitIndicator` `aria-label` menimpa persen,
severity hanya warna, pill ±24 px.

**Lead (4–5)** — "Menunggu kamu" di urutan ketiga; jargon (Pimpin/Lepas/Timpa/Pause vs Matikan); sesi tampil ID mentah;
baris tanpa `flex-wrap`; `ChoicePicker` bukan radiogroup; kontrol tanpa konfirmasi.

**Terminal (5–6)** — toolbar 9 kontrol bobot setara; header sel penuh ikon ambigu; panel Tampilan memuat diagnostik
"rekam jalur ketik"; "gone" tanpa aksi; tema ANSI tak diatur; sesi berakhir `opacity .6` menurunkan kontras;
hint kosong menyebut flag `--dangerously-skip-permissions`; kegagalan DELETE/clipboard ditelan.

**IDE (5)** — melebar jadi IDE penuh (editor, CRUD, upload, graph, merge/rebase/reset, cleanup); menu commit >20 item;
`window.prompt/confirm/alert` native; compare hanya Ctrl-klik pada `div`; ikon `onClick` tak fokusabel; tree tanpa `role="tree"`;
target Hapus/Ganti nama = berkas terbuka, bukan folder terklik; opsi "hapus branch juga" dipersist; tiga tempat hapus branch;
palet lane hex hardcoded (hijau-merah).

**Skills (5)** — grup tak bisa dilipat saat berisi item terpilih; empty salah teks saat pencarian kosong; `window.prompt`;
Simpan tersembunyi di mode Pratinjau saat draft kotor; modal agen 11–12 field datar; `<a>` membungkus `<Button>`;
"Skill baru" default ke lapis global tanpa peringatan.

**VPS (5)** — baris 7 tombol, Harden primary; VPS belum terhubung tampil "unreachable" merah; modal checklist memuat
provisioning; preview tidak direset saat seleksi berubah (`VpsChecklist.tsx:157-159`) dan konfirmasi tak menyebut item;
checkbox/select <44 px; Pasang disabled tanpa alasan; galat `r.out` dibuang.

**Klien (4–6)** — konsep klien/remote/presence sulit dipahami; lima switch grant (Tulis/Mulai sesi satu klik);
mematikan "Lihat" menghapus semua grant tanpa peringatan; gagal memuat akun = "Belum ada akun"; banner tanpa latar/wrap;
istilah "device/hub/instance/mesin" bercampur.

**Docs (5)** — tanpa pencarian; folder selalu tertutup walau file terpilih; draft hilang; simpan tanpa try/catch;
`covTone` dari status bukan coverage; textarea `outline:none` tanpa label; tumpang tindih dengan PRD.

**Settings (4–5)** — 16 tab datar, default "Akun"; tiga model simpan (auto-save, tombol, blur); tab "Model sesi" ±24 kontrol
dalam 6 kartu; Telegram terpecah di dua tempat; Users di Settings vs Members di Tim; `AgentAccessPanel` 4 pekerjaan;
`WebhookDocs` 331 baris di dalam tab; tanpa `<form>`; validasi hanya tersirat; hasil Test Connection tanpa live region.

**Review/Auth/Setup (5/6/6)** — Review buntu (tanpa merge/buang); semua gagal login = "Email atau password salah";
setup gagal selain 409 = "Password minimal 8 karakter"; wizard "1/2, 2/2" lalu layar ketiga; hardening di jalur pertama;
trigger akun 34×34 px.

**Portal & Public Help (5)** — kategori/prioritas/SPEC-id mentah; gagal memuat = "Belum ada pekerjaan"; input <16 px
(zoom iOS); "Cek status" bukan `<form>`; "Bug"/"Help desk" bukan bahasa awam.

## Usulan redesign

### 1. IA: 17 menu → 8, tiga grup
- **Kerja:** Overview · Projects (tab Ringkasan, PRD, Docs, QA, Kode, Skills) · Backlog (tab Spec, Tugas manusia, Review) · Triase · Sesi (Terminal + Klien)
- **Otomasi:** Otonom (Scheduler + Lead)
- **Sistem:** Skills (global) · Pengaturan (Akun, Infra/VPS, Sistem)
- Dalang → aksi di Overview. Project switcher tunggal di topbar menggantikan empat mekanisme scope.
- Mapping: Dalang→Overview; PRD/QA/Docs/IDE→Projects›tab; Tim→Backlog›Tugas manusia; Scheduler,Lead→Otonom;
  Terminal,Klien→Sesi; VPS,Settings→Pengaturan.
- Konsekuensi: redirect path lama, ubah `NAV_KEYS`/`routes.test.ts`/test badge nav, dan **ADR baru** (menimpa sebagian ADR-0160).

### 2. Per layar
- **Overview:** satu kolom "Hari ini" — status satu kalimat + CTA, sesi berjalan, perlu perhatian, tabel project, satu kartu limit
  bertab Claude/Codex. Hapus KPI strip dan hero.
- **Settings:** empat niat — Sesi harian · Agen & model (override per fungsi satu komponen) · Integrasi & akses · Lanjutan
  (+ zona bahaya). Pencarian pengaturan; satu aturan simpan (`useSettingField`: auto-save debounce + status per baris).
- **Backlog/Tim:** kartu = judul + stage + titik prioritas + satu aksi primer sadar-stage; sisanya menu ⋯; filter = search + popover.
- **Terminal:** rail sesi bertanda status + satu pane fokus; grid opsional; menu aksi per sesi; kill lewat `ConfirmDialog`.
- **IDE:** tiga tab Perubahan / Riwayat / Cabang; hapus editor, CRUD, upload; "Buka di Terminal/editor".
- **Triase & Lead:** kotak masuk keputusan — aksi Terima/Tolak inline, J/K/A/R, tolak massal + toast "Urungkan".
- **Klien:** daftar Mesin dengan satu selektor tingkat akses (Lihat/Kerja/Tulis); Tulis butuh konfirmasi; banner kendali sticky.
- **Scheduler:** strip status + tab Antre/Berjalan/Selesai/Gagal/Cron/Setelan; bahasa biasa.
- **VPS:** tabel ringkas, satu aksi "Periksa"; alur 3 langkah pilih→pratinjau terkunci→terapkan.
- **Skills:** master-detail dengan footer Simpan sticky dan guard dirty; lapis sebagai chip; agen jadi tab.
- **Review:** alur "Tinjau lalu Putuskan" dengan bar Merge/Buang sticky.
- **Portal:** beranda per project, linimasa 4 langkah (Diterima → Ditinjau → Dikerjakan → Selesai), sheet "Lapor masalah" 2 langkah.
- **Onboarding:** setup satu layar; Overview kosong dengan kartu hero (folder ada / mulai dari ide); modal project nama + folder;
  backlog pertama = judul + deskripsi; glosarium inline; menu lanjutan dibuka setelah project pertama.

### 3. Aturan minimalis hanoman (usulan)
1. Maks 6 kontrol terlihat per toolbar; sisanya filter lanjutan atau ⋯.
2. Satu aksi primer per layar dan per kartu; sekunder maks 2 ikon ghost.
3. Kartu maks 3 aksi; jarang/destruktif masuk ⋯.
4. Satu sumber untuk tiap angka; Overview memegang KPI.
5. Maks 4 KPI, tiap KPI membuka layar/filter relevan.
6. Progressive disclosure: filter tanggal/prioritas tertutup, tampil sebagai chip aktif.
7. Maks 2 badge per baris; warna hanya untuk status.
8. Dekorasi harus berfungsi: eyebrow hanya level seksi; pet/animasi hanya untuk status.

### 4. Glosarium copy (usulan)
| Konsep | Istilah baku | Hindari |
|---|---|---|
| Perangkat terpasang/jarak jauh | Perangkat | Device, Mesin, Klien, hub |
| Portal pelanggan | Klien | Client, Portal |
| Satu entri backlog | Item | SpecSlim, Spec (kecuali `SPEC-nnn`) |
| Dokumen project | Dokumen | SoT, Docs · SoT |
| Hapus permanen / lepas dari daftar | Hapus / Lepas | Buang (untuk data) |
| Ubah isi | Edit | Ubah |
| Batas sesi | Batas sesi | cap |
| Enum | label lewat map terpusat | nilai mentah |
| Waktu relatif | "baru saja", "5 menit lalu" | "5m lalu" |

Aturan voice: Indonesia seluruh UI; tombol = kata kerja + objek; "tidak" bukan "tak"; error = apa yang gagal + langkah
berikutnya; sentence case; jangan tampilkan enum mentah.

## Rencana perbaikan bertahap

**Fase 1 — quick win (±1–2 hari, risiko rendah)**
1. Token: `--text-subtle` → ±`#776853`; hapus override putih `app.css:751`; `--border-focus` brass-600; border input ink-400; `--warn` teks lebih gelap.
2. `useConfirm` di seluruh daftar P0 destruktif; ganti `window.prompt/confirm`.
3. Guard dirty (Docs, IDE, Skills, QA) + try/catch dan error inline pada simpan.
4. Helper `reportError`; larang `.catch(() => {})` tanpa alasan; bedakan error vs empty di semua daftar.
5. `viewport-fit=cover`; `hn-grid-mobile` di `App.tsx:576,594,617`; tombol keluar Dalang tampil di mobile (44×44).
6. Digest snapshot WS `sessions/pending/leadAsks`; isolasi jam/ticker Dalang; preconnect font; throttle tulis scroll.
7. Perbaiki bug fungsional: `projectId` tab IDE Klien, Edit IDE saat `viewRef`, `FolderPicker` keyboard, `ReconcileModal` error.

**Fase 2 — fondasi DS**
- Komponen: `PageHeader`, `FilterBar`, `RowList/DenseRow`, `Stack/Inline`, `Text` (skala 11/12/13/14/16), `Interactive row` (hover CSS), varian dot di `StatusPill`.
- `Field` memisah label/hint + `aria-describedby`/`aria-invalid`; Radio `radiogroup`; Modal `inert` + `h2`; shell `h1` + skip link + label search;
  Toast antrean dengan aksi "Batalkan" dan `aria-live` permanen; Icon `aria-hidden` default.
- Command palette (⌘K), shortcut `g`+huruf dan `?`, tombol "Jawab" di toast/notifikasi keputusan.
- Satu skeleton/loading; glosarium + map label terpusat (severity, prioritas, status, kind).
- Ganti layout inline dengan kelas `hn-*` + CSS var; hapus `!important` dan `[style*=`; dilarang `display:grid`/`gridTemplateColumns` inline.

**Fase 3 — redesign per layar (urutan usulan):** Overview → Settings → IA baru (ADR) → Backlog/Tim → Terminal → Triase/Lead → Klien → IDE → Scheduler → VPS → Skills → Review → Portal → Onboarding.

## Verifikasi yang masih diperlukan
- Ukur kontras aktual dan layout di 320/390/768/1024 px (screenshot).
- Profiling React saat snapshot WS masuk; `vite build` + analyzer untuk graf bundle (barrel `ds/index.ts` menarik `markdown`).
- Uji screen reader pada Terminal (xterm WebGL tanpa teks DOM), tree, dan modal.
- Konfirmasi dengan server apakah `putBinding` memvalidasi path (`FolderPicker`).

## Catatan kepatuhan repo
Perubahan IA/menu butuh ADR dan pembaruan docs yang tersentuh dalam commit yang sama; setiap API baru wajib keputusan MCP (ADR-0202).
Perubahan skema tidak termasuk dalam audit ini.

## Status pelaksanaan

Diverifikasi terhadap kode branch `ui-ux-audit` (diff terhadap `main`), bukan terhadap rencana. `[x]` berarti
ada di kode; `[ ]` berarti belum. Rincian per layar ada di
[frontend-implementation](frontend-implementation.md#audit-uiux-2026-10--fase-1-quick-win).

### Fase 1 — quick win (selesai)

- [x] 1. Token kontras: `--text-subtle` `#776853`, `--amber-700` untuk teks warning (`--status-warn`),
  `--border-strong` = ink-400, `--border-focus` = brass-600, tombol primer `--accent-on` tanpa override
  putih, alias `--brass`/`--danger`/`--line` (`ds/tokens/colors.css`, `app.css:756`).
- [x] 2. `useConfirm` untuk daftar P0 destruktif (satu sisa, lihat tindak lanjut); nol `window.confirm`,
  `window.prompt`, dan `window.alert` di layar.
- [x] 3. Guard dirty di Docs, IDE, Skills, dan QA; simpan memakai try/catch dan galat inline.
- [x] 4. Helper `lib/report-error.ts` (`errorMessage`, `failureMessage`); kebijakan larangan `.catch(() => {})`
  kosong (sisa 9, lihat tindak lanjut). Daftar yang gagal dimuat kini dipisah dari empty state di Projects,
  Tim, PRD, Reconcile, Review, dan Portal.
- [x] 5. `viewport-fit=cover`; `hn-grid-mobile` pada tiga grid inline `App.tsx`; tombol keluar Dalang 44×44
  pada mobile dan pointer kasar.
- [x] 6. Digest snapshot WS `sessions`/`pending`/`leadAsks`; ticker dan jam Dalang terisolasi; `preconnect`
  font; throttle tulis scroll. `@import` font dipindah ke `index.html` di Fase 2E (tindak lanjut 13).
- [x] 7. `projectId` tab IDE di Klien; Edit IDE diblokir saat ref lain dipilih; `FolderPicker` bisa dinavigasi
  keyboard; galat `ReconcileModal` tak lagi tampil sebagai "Tak ada konflik".

Di luar daftar: skip link dan `<h1>` di shell; `Ctrl+Shift+Esc` melepas fokus terminal; target sentuh
checkbox/radio; state kosong Overview; draft Scheduler dan Lead; Diagnostik tertutup dan banner "Berakhir"
di Terminal; persist Settings yang jujur; label ramah Portal.

### Fase 2 — fondasi DS (belum)

- [ ] Komponen `PageHeader`, `FilterBar`, `RowList`/`DenseRow`, `Stack`/`Inline`, `Text`, dan `Interactive row`.
  Yang sudah ada hanya kelas `.hn-dense-row` dan token skala 11/12/13/14/16.
- [ ] `Field` dengan `aria-describedby`/`aria-invalid`; `Radio` sebagai `radiogroup` (saat ini hanya
  radiogroup ad hoc di Lead); `Modal` dengan `inert` dan `h2`; ikon `aria-hidden` secara default.
- [ ] Toast antrean dengan aksi "Batalkan" dan `aria-live` permanen (saat ini satu toast, tanpa aksi).
- [ ] Command palette (⌘K), shortcut `g`+huruf dan `?`, tombol "Jawab" di toast dan notifikasi keputusan.
- [ ] Satu skeleton untuk loading; glosarium dan map label terpusat.
- [ ] Hapus layout inline: `style={{` di `screens/` naik dari 1.416 menjadi 1.545 (belum dikerjakan: layout inline tetap, lihat Fase 2E). `!important` di `app.css` (Fase 2E, dihitung ulang): 45 → 30 deklarasi, sisanya dicatat di frontend-implementation § Fase 2E; `[style*=` sudah tak ada di `app.css`.
- [ ] Varian `danger` pada `ProgressBar`, `Radio`, `Field`, `Callout`, dan `OverflowActions`; hanya `Button` yang punya.

### Fase 3 — redesign per layar (sebagian)

- [x] IA 17 → 8 hub bergrup dengan [ADR-0205](../adr/0205-navigasi-8-hub-bergrup.md) (menimpa sebagian
  ADR-0160). Tanpa redirect: path setiap section tak berubah, jadi tautan lama tetap membuka layar yang sama.
  `HN_NAV` dan `routes.test.ts` tetap valid; yang berubah hanya isi sidebar. Rincian:
  [frontend-implementation § Fase 3A](frontend-implementation.md#audit-uiux-2026-10--fase-3a--navigasi-8-hub-bergrup-adr-0205).
- [x] Terminal (Fase 3E): default **Fokus** berisi rail sesi bertanda status dan satu pane; Grid tetap opsional
  dan memakai workspace kanonik. Menu ⋯ per sesi (Tutup dikonfirmasi), toolbar ≤ 6 kontrol, dan laci mobile.
  Rincian: [frontend-implementation § Fase 3E](frontend-implementation.md#audit-uiux-2026-10--fase-3e--terminal-rail-sesi-dan-mode-fokus).
- [x] Review, Auth/Setup, Portal, dan Onboarding (3L · 3M · 3N): alur "Tinjau lalu Putuskan" dengan bar keputusan,
  setup satu layar dengan penomoran jujur, dan Beranda Klien dengan linimasa keluhan. Rincian dan keputusan:
  [frontend-implementation § Fase 3 · Review, Auth, Portal, Onboarding](frontend-implementation.md#audit-uiux-2026-10--fase-3--review-auth-portal-onboarding-3l--3m--3n).
  Belum dirender di browser; dua prop opsional menunggu `App.tsx` (`onGoto`, `setupStep`).
- [ ] Redesign per layar sesuai urutan usulan: Overview → Settings → Backlog/Tim → Triase/Lead →
  Klien → IDE → Scheduler → VPS → Skills → Review → Portal → Onboarding.

### Tindak lanjut Fase 1 (belum selesai)

1. **Tandai terbaca per item notifikasi.** *Server dan frontend selesai (ADR-0204, Fase 2G):* `POST /notifications/:id/read`
  (idempoten, 404 bila tak ada) dan tool `hanoman_notification_mark_read`. Bell dan arsip menandai item saat "Buka"
  (optimistik; galat → rollback + toast). Membuka bell tetap tidak menandai apa pun.
2. **`markRequeued` hanya menerima `canceled`** (`server/src/services/scheduler/queue.ts:153-158`). *Server
  selesai (ADR-0204):* `failed` diterima; token agen memerlukan `sessions:spawn` untuk baris itu (403 bila tak ada),
  karena peluncuran ulang membuka sesi agen. "Antre ulang" di `screens/SchedulerScreen.tsx` kini berhasil tanpa
  perubahan UI. Frontend tetap tak memeriksa izin apa pun.
3. **Preview cron memakai zona waktu browser.** `screens/SchedulerCrons.tsx:140` memanggil `nextRunFor` dengan
  `new Date()` lokal. *Server selesai (ADR-0204):* `serverTimeZone` ada di `GET /scheduler/state` dan
  `GET /scheduler/config`. Sisa: preview di `SchedulerCrons` perlu memakai zona itu (layar milik agen UI).
4. **`SetupWizard` di Settings tak menerima `onCancel`.** Pemanggilan ada di `screens/SettingsScreen.tsx:754`
  (rujukan awal `:632` tidak tepat); `screens/SetupWizard.tsx:120` tak merender Batal tanpa `onCancel`.
5. **Prop yang belum diteruskan di `App.tsx`:** `onOpenSpec` ke `TeamScreen` (`:1597-1598`), `previous` ke
  `DalangHanomanScreen` (`:1532-1535`), dan `setupTokenPath` ke `AuthScreen` (`:1511-1513`). Server sudah
  mengirim `setupTokenPath` di `GET /auth/status` (hanya saat hardening dan belum ada akun; ADR-0204).
6. **Copy belum seragam.** Tombol "Kirim ke Backlog" ada di `screens/team-board.tsx:120`; `EscalateDialog`
  memakai "Eskalasi" (`screens/EscalateDialog.tsx:68`).
7. **Teks amber-600 dan brass-600 di atas tint** memakai token fill sebagai teks: 12 pemakaian inline
  (9 `--amber-600`, 3 `--brass-600`), contoh `ds/components/feedback.tsx:85,87,89`. Ganti ke token teks.
8. **Token tak terdefinisi** (nol definisi di `ds/tokens/*.css`): `--brass-50` (`screens/PrdScreen.tsx:196`),
  `--brass-200` (`PrdScreen.tsx:196`, `GitGraph.tsx:678`), `--bone-50` (`VpsChecklist.tsx:79,124,275,302`),
  `--clay-700` (`VpsChecklist.tsx:267`), `--ink-100` (`McpPanel.tsx:65`, `GitGraph.tsx:631`), `--text`
  (`VpsChecklist.tsx:79,279`), `--text-primary` (`VpsProvision.tsx:44,100`), dan `--rule` (nol pemakaian).
  `--brass-050` ada di `colors.css:31` dengan nama berbeda.
9. **Sisa `.catch(() => {})` kosong, 9 di kode non-test:** `screens/IdeReadPanel.tsx:140`,
  `screens/NewTerminalModal.tsx:54`, `screens/SettingsScreen.tsx:572,573,814,826,869`,
  `screens/TerminalScreen.tsx:832`, dan `notifications/sound.ts:39`. Yang terakhir disengaja dan berkomentar,
  tetapi tetap melanggar kebijakan; perlu keputusan.
10. **"Hapus sel" di Terminal tanpa konfirmasi.** `screens/TerminalPane.tsx:854-856` memanggil `killSession`
  (`screens/TerminalScreen.tsx:376`) saat tmux sudah tak punya sesi.
11. **Review belum punya aksi keputusan.** `screens/ReviewScreen.tsx` hanya memiliki Muat ulang, Preview,
  tab Diff/Sumber, dan kembali; Merge dan Buang belum ada.
12. **Setup status 400 masih memuat "Password minimal 8 karakter"** (`screens/AuthScreen.tsx:22`).
13. **Font `@import`** (render-blocking): *selesai di Fase 2E.* `ds/tokens/fonts.css` tak lagi memuat `@import`; stylesheet Google Fonts dimuat dari `index.html` lewat preload + swap, dengan `<noscript>`. `preconnect` sudah ada.
14. **`screenReaderMode` xterm belum ada di kode** (`src/` dan `shared/`); menunggu uji VoiceOver.
15. **Verifikasi visual belum dilakukan** di 320, 390, 768, dan 1024 px. Audit ini statis; belum ada screenshot.
