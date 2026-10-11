# Audit UI/UX dashboard hanoman — Oktober 2026

Audit menyeluruh seluruh tampilan dashboard dengan tujuan **UI/UX minimalis, clean, usable**. Dokumen ini adalah
laporan temuan dan usulan redesign. Perbaikannya sudah dikerjakan di branch `ui-ux-audit`; status per butir ada di § Status pelaksanaan.

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

Diverifikasi terhadap kode (commit `cfabc308`, diff terhadap basis `8380d3fa`, yaitu merge-base dengan `main`), bukan terhadap rencana. `[x]` berarti ada di kode dan sesuai rincian; `[ ]` berarti belum atau baru sebagian, dengan sebabnya ditulis di baris itu. Rencana per baris ada di [plan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md); rincian per layar ada di [frontend-implementation](frontend-implementation.md#audit-uiux-2026-10--fase-1-quick-win).

**Ringkasan**

- **Fase 1: selesai.** P0 dan quick win 1A–1K ada di kode. Tindak lanjut Fase 1 masih terbuka di butir 3, 7, 11, 14, dan 15 (lihat § Tindak lanjut Fase 1).
- **Fase 2: selesai, dengan sisa.** Tombol "Jawab" di toast dan notifikasi belum ada; varian `danger` belum di ProgressBar, Radio, Field, dan Callout; layout inline (`style={{`) belum dipindah ke kelas.
- **Fase 3: semua layar 3A–3P sudah dikerjakan.** Tidak ada layar yang belum dikerjakan. Sisa per layar ditulis di bawah dan di daftar keputusan terbuka.
- **Verifikasi visual di Chrome:** tiga commit perbaikan hasil QA Chrome setelah redesign (`56eb30cd`, `82b5dee4`, `cfabc308`) menyentuh shell, pet, Terminal, IDE, Review, Portal, Skills, QA, Tim, dan Settings. Brief menyebut empat putaran; git mencatat tiga commit perbaikan dan dokumen tidak menyebut "putaran", jadi angka empat belum bisa dicocokkan. Uji layout 320/390/768/1024 px per layar tidak tercatat di dokumen.

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

### Fase 2 — fondasi DS (selesai, dengan sisa)

- [x] **2A komponen DS.** `PageHeader`, `FilterBar`, `RowList`, `DenseRow`, `Stack`, `Inline`, dan `Text` ada di `ds/components/layout.tsx`. Hover baris interaktif: `.hn-row-interactive:hover` di `app.css`. Varian titik di `StatusPill` ada di `ds/components/feedback.tsx`.
- [x] **2B a11y DS.** `Field` memasang `aria-describedby` dan `aria-invalid` (`ds/kit.tsx`). `Radio` dan `RadioGroup` di `ds/components/forms.tsx`. `Modal` memberi `inert` pada saudara dan judul `<h2>` (`ds/kit.tsx`). `Icon` ber-`aria-hidden` kecuali bernama (`ds/icon.tsx`). Toast antrean punya aksi dan `aria-live` (`ds/kit.tsx`). Label aksinya "Urungkan", bukan "Batalkan" seperti di rencana.
- [x] **2C palet dan shortcut.** `palette/CommandPalette.tsx`; ⌘K/Ctrl+K di `palette/useGlobalShortcuts.ts`; prefiks `g` di `palette/shortcuts.ts`; `?` lewat `palette/ShortcutHelp.tsx`; aksi "Jawab sesi yang menunggu" di `palette/commands.ts`.
- [ ] **2C sisa: tombol "Jawab" di toast dan notifikasi keputusan belum ada.** `notifications/` (lonceng dan arsip) tidak punya aksi Jawab. "Jawab" hanya tampil di Overview, Dalang, gelembung pet, dan palet.
- [x] **2D labels dan glosarium.** `lib/labels.ts` dan `lib/time-format.ts` jadi satu tempat. `frontend/glossary.md` berlaku, dan `glossary-guard.test.ts` menegakkan istilah terlarang. Copy yang belum diganti tercatat sebagai utang Fase 3 di glosarium (lihat keputusan terbuka). Skeleton tunggal ada di `ds/components/skeleton.tsx` dan dipakai di sembilan berkas.
- [x] **2E pembersihan CSS.** `DalangStage` dan kelas `.hn-*` yang mati dicabut. `!important` di `app.css` turun dari 48 ke 30 deklarasi, dan sisanya dicatat per penyebab di frontend-implementation § Fase 2E. Font tidak lagi `@import` yang memblokir render. Ukuran `app.css` naik lagi setelah QA Chrome; lihat Metrik.
- [x] **2G backend tindak lanjut (ADR-0204).** Requeue untuk baris `failed` (butuh `sessions:spawn`), `POST /notifications/:id/read` dengan tool `hanoman_notification_mark_read`, `serverTimeZone` di state dan config scheduler, dan tes `setupTokenPath`.
- [ ] **Hapus layout inline (sisa).** `style={{` di `src/src/screens/`: 1.416 di basis, 1.546 pada Fase 2 (sebelum redesign Fase 3), dan 561 sekarang. Sisa 561 belum dipindah ke kelas `hn-*` dan dicatat sebagai utang bertahap (frontend-implementation § Fase 2E). Selektor `[style*=` sudah tidak ada di `app.css`.
- [ ] **Varian `danger` (sisa).** Sudah ada di `Button` (`ds/components/forms.tsx`) dan `OverflowActions` (`tone="danger"`, `ds/components/ui.tsx`). Belum ada di `ProgressBar`, `Radio`, `Field` (`ds/kit.tsx`), dan `Callout`.

### Fase 3 — redesign per layar (selesai per layar)

Urutan mengikuti rencana. Label memakai label di plan: QA = 3L, Review = 3L′, Portal = 3M, Onboarding dan Auth = 3N, Skills = 3K.

- [x] **3A Navigasi.** 8 hub bergrup dengan ADR-0205, tanpa redirect. `HN_NAV` tetap daftar rute.
- [x] **3B Overview dan Dalang.** Overview "Hari ini". Dalang jadi papan senyap, menggantikan takeover sinematik; belum ada ADR untuk perubahan ini (lihat keputusan).
- [x] **3C Pengaturan.** Empat niat, `screens/settings/**`, satu aturan simpan (`useSettingField`), deep link `#bagian=`. Sisa: ADR IA Pengaturan belum ditulis.
- [x] **3D Backlog dan Tim.** Segmen "Review" tidak dibuat (lihat keputusan).
- [x] **3E Terminal.** Default Fokus dengan rail sesi, Grid opsional, toolbar maksimal 6 kontrol.
- [x] **3F Triase dan Lead.** Kotak masuk keputusan dengan Terima/Tolak inline.
- [x] **3G Klien.** Tab Perangkat · Akun · Log, selektor tingkat Lihat/Kerja/Tulis. API grant tidak berubah. Sisa: grant per perangkat remote (lihat keputusan).
- [x] **3H IDE.** "Perubahan dulu" dengan empat tab. Sisa: membalik keputusan SPEC-879 di toolbar (keputusan DS).
- [x] **3I Scheduler.** Tab hub Otonom dengan strip status dan tab Antre · Berjalan · Riwayat · Cron · Setelan. Sisa: verifikasi Chrome untuk wrap toolbar di 390/820/1280 dan ellipsis `<select>` belum diulang (frontend-implementation § 3I). Preview cron hanya tampil bila zona browser sama dengan zona server.
- [x] **3J VPS.** Daftar ringkas dengan stepper dan Periksa; alur Pilih → Pratinjau → Terapkan. Sisa: skor kepatuhan di daftar (lihat keputusan).
- [x] **3K Skills.** Master-detail dengan footer Simpan sticky, chip lapis, dan tab Skill · Agen.
- [x] **3L QA.** Editor lembar kerja dengan header sticky dan daftar temuan sebagai RowList.
- [x] **3L′ Review.** "Tinjau lalu Putuskan" dengan bar keputusan sticky. Tujuannya navigasi: Backlog, Terminal, IDE. Sisa: Merge dan Buang belum ada (lihat keputusan).
- [x] **3M Portal.** Beranda Klien, linimasa 4 langkah, sheet Lapor masalah dua langkah. Sisa: tab "Tanya & ide" hanya tampil bila chat diaktifkan (lihat keputusan).
- [x] **3N Onboarding dan Auth.** Setup satu layar. `App.tsx` sudah meneruskan `setupStep` ke AuthScreen (`App.tsx:1570`).
- [x] **3P Projects · PRD · Docs.** Daftar diurut perhatian per halaman. Sisa: urutan perhatian global untuk mode API butuh parameter urut dari server (lihat keputusan).

### Metrik sebelum → sesudah

Sebelum = basis `8380d3fa`. Sesudah = `cfabc308`. Hitungan memakai `grep` dan `git grep` langsung, dan dapat diulang dengan pola di kolom catatan.

| Metrik | Sebelum | Sesudah | Catatan |
|---|---|---|---|
| `style={{` di `src/src/screens/` | 1.416 | 561 | Puncak 1.546 pada Fase 2 (`b5995b97`, `f8acf77f`); 706 pada `e5d44eac`; 561 sejak `c81413cb`. Plan sebelumnya menulis 1.545. |
| `fontSize` literal (angka atau string px) di `src/src/` | 496 | 229 | Regex `fontSize: <angka>`. Semua pemakaian `fontSize`, termasuk token: 634 → 312. |
| `!important` di `app.css` (deklarasi) | 48 | 30 | Teks mentah 49 → 32; dua di komentar sekarang, satu di komentar di basis. |
| Selektor `[style*=` di `app.css` | 1 | 0 | Satu sisa di komentar (`app.css:1035`). |
| Menu nav sidebar | 17 | 8 | `HN_NAV` 17 entri di basis; sekarang 8 hub di 3 grup (`nav-hubs.ts`). |
| `SettingsScreen.tsx` (baris) | 1.540 | 207 | Basis 99 KB, sesuai audit. Angka 1.727 di brief tidak bisa direproduksi dari basis. |
| `app.css` (byte) | 54.592 | 54.105 | Turun ke 43.102 pada `c81413cb` (2E), lalu naik lagi karena tiga commit QA Chrome. Puncak 64.956 pada `f8acf77f`. |
| Berkas test (`*.test.ts(x)` di `src/`) | 249 | 310 | Hitung berkas. |
| Test | baseline 7 gagal / 6 berkas | 2.916 hijau | Angka 2.916 dilaporkan dari run terakhir dan tidak dijalankan ulang untuk dokumen ini. Baseline dari plan § Baseline. |

### Tindak lanjut Fase 1 (status per butir)

| No | Butir | Status | Bukti dan catatan |
|---|---|---|---|
| 1 | Tandai terbaca per item | Selesai | Server ADR-0204. Lonceng (`NotificationBell.tsx`) dan arsip (`NotificationsArchiveModal.tsx`) menandai saat "Buka". |
| 2 | `markRequeued` menerima `failed` | Selesai | ADR-0204; 403 bila token tak punya `sessions:spawn`. Tombol "Antre ulang" tidak berubah. |
| 3 | Preview cron zona server | Sebagian | `serverTimeZone` sudah ada. `SchedulerCrons.tsx` hanya menampilkan preview bila zona browser sama dengan zona server, karena `nextRunFor` tak punya parameter zona. |
| 4 | `SetupWizard` menerima `onCancel` | Selesai | `screens/SetupWizard.tsx` merender Batal; pemakai di `screens/settings/Advanced.tsx`. |
| 5 | Prop belum diteruskan di `App.tsx` | Selesai | `onOpenSpec` ke TeamScreen (`App.tsx:1665`); `previous` ke DalangHanomanScreen (`App.tsx:1596`); `setupTokenPath` ke AuthScreen (`App.tsx:1569`). |
| 6 | Copy "Kirim ke Backlog" dan "Eskalasi" | Selesai | "Eskalasi" sudah tidak ada di kode; "Kirim ke Backlog" dipakai di `EscalateDialog.tsx` dan `team-board.tsx`. |
| 7 | Teks amber/brass di atas tint | Sebagian | Tinggal teks `--brass-600` di `NotificationBell.tsx` dan ikon `--amber-600` di `screens/styles/qa.css` (ikon, bukan teks). |
| 8 | Token tak terdefinisi | Selesai | Nol pemakaian `--brass-50`, `--brass-200`, `--bone-50`, `--clay-700`, `--ink-100`, `--text`, `--text-primary`, dan `--rule` di kode non-test. |
| 9 | `.catch(() => {})` kosong | Selesai | Nol pola kosong di kode non-test. Satu sebutan ada di komentar `lib/report-error.ts`. |
| 10 | "Hapus sel" tanpa konfirmasi | Selesai | Dialog konfirmasi di `screens/TerminalPane.tsx` (judul "Hapus sel"). |
| 11 | Review: aksi Merge dan Buang | Belum | Lihat keputusan terbuka nomor 9. |
| 12 | Galat setup status 400 | Selesai | Pesan galat menyebut bidang dari `fieldErrors` (`screens/AuthScreen.tsx`); tidak lagi memuat pesan password untuk semua galat. |
| 13 | Font `@import` memblokir render | Selesai | `ds/tokens/fonts.css` tanpa `@import`; `index.html` memakai preload dan swap, dengan `<noscript>`. |
| 14 | `screenReaderMode` xterm | Belum | Tidak ada di `src/` dan `shared/`. Menunggu uji VoiceOver. |
| 15 | Verifikasi visual di 320/390/768/1024 px | Sebagian | Tiga commit perbaikan hasil QA Chrome tercatat di git. Uji per ukuran layar tidak tercatat di dokumen. |

### Keputusan terbuka dan ditunda

Daftar ini butuh keputusan pemilik produk atau pekerjaan lintas-tim (server, MCP, design system). Dokumen ini tidak memutuskan apa pun. Setiap butir menunjuk bukti di repo. Butir yang "dari brief" belum tercatat di dokumen atau kode dan perlu dikonfirmasi pemiliknya sebelum dicatat sebagai keputusan.

**Produk dan UX**

1. **Tab "Tanya & ide" di portal dan probe 404.** Tab hanya tampil bila chat diaktifkan (frontend-implementation § 3M). Pilihannya: flag ketersediaan (ADR-0110) atau tab selalu tampil. Mekanisme probe 404 belum tercatat di dokumen.
2. **Segmen "Review" di Backlog.** Tidak dibuat, karena `Spec.stage` tak punya tahap review. Tinjauan adalah aksi "Review perubahan" pada item (frontend-implementation § 3D). Menambahkannya butuh keputusan produk dan tahap atau penanda di server.
3. **Pet: chip tanpa lencana di viewport pendek.** Keputusan produk (dari brief). Tidak ditemukan di dokumen atau kode.
4. **Pengecualian gelap Dalang di design system.** Panel Dalang gelap hanya disebut sebagai konteks kontras di `design-system.md` (tabel `--border-focus`). Belum ada pengecualian tema yang resmi.
5. **Takeover sinematik Dalang dan pet fixed dihapus.** Perubahan sudah ada di kode (3B; pet tak lagi `position: fixed`, frontend-implementation baris 1740), tetapi belum ada ADR. ADR-0205 tidak mencakupnya. Pertimbangkan ADR baru.
6. **ADR IA Pengaturan (empat niat).** Belum ditulis (plan 3C).
7. **Toolbar IDE membalik SPEC-879.** Keputusan 3H (frontend-implementation § 3H). `design-system.md` baris 34 dan 44 masih menyatakan aturan SPEC-879, jadi dokumen DS perlu diperbarui atau keputusan dicabut.
8. **Akun pertama di AuthScreen vs wizard satu layar.** Setup sudah satu layar; langkah "2/2" hanya tampil bila wizard tampil (frontend-implementation § 3N). Apakah akun digabung ke wizard perlu ditinjau terhadap ADR-0139.

**Server, API, dan kontrak**

9. **Merge dan Buang di layar Review.** Belum ada. Review hanya navigasi. Butuh endpoint baru dan keputusan MCP (ADR-0202).
10. **Review: 409 dan keadaan kosong.** `ReviewScreen` memetakan 409 ke keadaan kosong (frontend-implementation, bagian Review). Server membalas 200 untuk keadaan kosong. Menyamakan keduanya butuh kontrak API; bila endpoint berubah, perlu keputusan MCP (ADR-0202).
11. **Grant per perangkat remote.** Selektor tingkat memetakan ke `PUT /remote-control` yang ada (frontend-implementation § 3G). Dari brief: API hanya menerima perangkat lokal, sehingga grant per perangkat remote belum bisa diatur dari UI. Belum tercatat di dokumen.
12. **Skor kepatuhan VPS di daftar.** `VpsView` tidak memuat skor; perlu DTO atau perubahan server (frontend-implementation § 3G/3J, utang).
13. **Preview cron zona server.** `nextRunFor` tak punya parameter zona. Perlu `nextRunFor(expr, after, tz)` di `shared/`, yaitu keputusan terpisah (frontend-implementation § 3I, baris 724–727).
14. **Urutan perhatian global Projects.** Mode API hanya mengurutkan per halaman. Urutan global butuh parameter urut dari server (frontend-implementation § 3P).

**Design system, aksesibilitas, dan kode**

15. **`screenReaderMode` xterm.** Belum ada di kode. Menunggu uji VoiceOver (tindak lanjut 14).
16. **Menu ARIA penuh pada `OverflowActions`.** Panel tetap `dialog`, bukan `role="menu"`, karena pemakai dan test mencari item sebagai tombol (`ds/components/ui.tsx`, komentar di baris 140). Sebelas berkas test menyebut `OverflowActions` atau `menuitem`. Mengubahnya menyentuh test-test itu.
17. **Inline style tersisa (561).** Migrasi bertahap ke kelas `hn-*`. Layout inline yang tersisa dicatat per kategori di frontend-implementation § Fase 2E.
18. **`!important` tersisa (30).** Dicatat per penyebab di frontend-implementation § Fase 2E.
19. **Varian `danger` di ProgressBar, Radio, Field, dan Callout.** Sisa Fase 2.
20. **Utang copy Fase 3.** Tercatat di `glossary.md` (§ Utang copy untuk Fase 3): `LogsPanel` "Device", `PhasePlanPreview`, `SyncButton` "hub", `WebhookDocs` "Retry", dan peta lokal `MODE_LABEL`, `KIND_LABEL`, `GROUP_LABEL`, `RELAY_LABEL`.
21. **Verifikasi yang belum tercatat.** Uji layout 320/390/768/1024 px per layar, verifikasi ulang 3I di Chrome, profiling React saat snapshot WS masuk, dan apakah `putBinding` memvalidasi path (lihat § Verifikasi yang masih diperlukan).
