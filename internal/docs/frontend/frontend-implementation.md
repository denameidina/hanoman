# Frontend implementation

## Penolakan peluncuran (SPEC-1108 / ADR-0161)

`StartSessionModal` menahan dialog saat menerima 409 admission: jumlah seluruh pane hidup,
agen terstruktur, cap, load/core dan ambangnya ditampilkan sebelum opsi **Mulai tetap**.
**Coba lagi** tidak memaksa. Tombol force dependency yang sudah ada menjelaskan bahwa
force juga melewati cap dan pemeriksaan host. Force hanya diterima dari operator cookie;
Bearer AgentToken ditolak 403 sebelum stempel approval atau persiapan peluncuran.

`StartSessionModal` dipakai bersama oleh Start di Backlog dan Ambil backlog di Terminal,
sehingga operator mendapat picker model/effort serta override fase yang sama sebelum sesi
lahir. `useLaunchAdmission` menangani aksi manual reverse/scaffold/PRD/breakdown dan restart dari
riwayat. Callback retry mempertahankan argumen pekerjaan
aslinya; dialog menawarkan coba lagi, force eksplisit, atau batal. Peluncuran otomatis
saat create project tidak memakai hook ini dan tidak mengirim force.

SettingsPanel Scheduler menyediakan `launchGuard.enabled` dan `maxLoadPerCore` (default
2,5); gerbang bekerja meski scheduler/source mati. Snapshot admission datang melalui
state/topik scheduler yang sudah ada. Load `null` ditulis **tidak tersedia**, Windows
menyebut platform tidak didukung, bukan angka nol atau klaim mesin senggang.


- React + TypeScript (Vite). Komponen dari Hanoman Design System.
- Layout responsif (SPEC-763): drawer mobile `<768px`, rail 72px pada tablet `768–1199px`, sidebar
  248px pada desktop `≥1200px`; topbar 56px dengan alat yang tak pernah membungkus (QA run4); konten maks 1200px (Docs full-width).
- Bagian: Overview, Projects (list + pagination + cari + hapus project per baris) → **detail project** (identitas, coverage, edit `name`/`desc` lewat `PATCH /projects/:id`, dan pintu: Source of Truth, Terminal, Backlog, Reverse docs). `id` tak pernah dapat diubah — ia kunci asing spec (SPEC-146). Hapus project ada di detail dan di header Docs — konfirmasi dulu, ditolak bila ada sesi tmux aktif; rename tidak ditolak, karena `id` tak bergerak. **PRD** (SPEC-210 · ADR-0041 — layar nav sebelum Backlog, **two-pane**: sidebar kiri daftar dokumen PRD yang bisa diklik + pane kanan preview `MarkdownView` inline. Filter project punya opsi **"Semua project"** → `GET /prds` lintas-project (item dikelompokkan per project); satu project terpilih → `GET /projects/:id/prds`; keduanya freshest-wins. **PRD baru** membuka sesi `flow:"prd"` project-level; project target dipilih **di dalam modal** (field `Select` project, default ikut filter aktif atau project pertama saat "Semua project") — tombol selalu aktif, tak perlu memfilter daftar dulu (SPEC-212); **Take ke backlog** membuka `NewSpecModal` ter-prefill dengan tautan PRD di teks Konteks, ke project asal PRD), Backlog (cari teks + filter project/stage/prioritas + tab sumber + tiga mode tampilan grid/list/board + aksi per spec + detail spec via modal: judul, stage bar, objective, field brief/QA), Terminal (sesi Claude Code interaktif di tmux), Docs (tree realtime semua `.md` di repo via `GET /docs`, dikelompokkan per direktori; kategori di luar `docsDir` masuk grup **Lainnya (tidak dinilai)** tanpa status linked — hanya kategori berskor yang masuk coverage, lihat ADR-0013; tombol **Muat ulang** membaca ulang tree, **Hapus** menghapus file asli, path ditampilkan repo-relative tanpa prefix `internal/docs`), VPS (daftar + audit/harden + Test connection + Open Console shell ssh + buka sesi Claude, SPEC-211; **klik baris membuka satu modal** berisi detail VPS — last audit + health disk/mem/load — menyatu dengan checklist kepatuhan 232 item, SPEC-220/221; tak ada lagi side panel terpisah), Tim (papan kerja **manusia** — tiga mode tampilan: Papan kanban empat kolom, Linimasa Gantt rencana, dan Lintas project satu baris ringkas per project; SPEC-946/948/949), Settings (model & effort sesi — **default global**; model/effort dipilih **per sesi saat Start** lewat picker `StartSessionModal`, matrix per-fase dicabut, SPEC-252/ADR-0061; notifikasi, akun, users).
- **Dikte suara** ([ADR-0177](../adr/0177-dikte-suara-seam-speech-engine.md)) — `TerminalPane` menampilkan baris
  `VoiceControls` (tombol mic toggle, pemilih bahasa `id-ID`/`en-US`, pratinjau interim, pesan galat) di antara
  host terminal dan composer, hanya bila `canWrite` dan browser mendukung Web Speech. Teks **final** ditambahkan ke
  `TerminalComposer` lewat `voiceAppend` (alur debounce/delta composer yang ada; tak pernah mengirim `\r`); interim
  hanya pratinjau. Di desktop composer ikut tampil selama mic aktif dan selama berisi. Bahasa tersimpan di
  `localStorage` `hanoman.voice.lang`. Engine ditukar lewat antarmuka `SpeechEngine` (jalur Whisper menyusul).
- **Klien** (SPEC-919 · [ADR-0147](../adr/0147-kanal-presence-di-socket-sync.md)) — `ClientsScreen`:
  satu kartu per device (nama, `hub ini` untuk mesin lokal, online/offline, terakhir terlihat) berisi
  sesi hidupnya (SPEC-nnn + judul dari backlog, project, fase, status, sudah berjalan berapa lama);
  baris ber-`specId` **bisa diklik** ke detail backlognya. Digerakkan grup siar `presence`; jalur
  HTTP `api.presence()` hanya menutup keadaan WS terhalang proxy dan duduk **di layar ini**, bukan
  di muat awal `App` — menambah satu panggilan `api` ke `load()` mematahkan 20 test ber-mock parsial
  sekaligus (kelas jebakan SPEC-884).
- **Entri nav bergerbang** (SPEC-919): `NavItem.gate` + context `NavGate` di `ds/shell.tsx`. `Shell`
  dirender di belasan cabang `App`, jadi gerbangnya context — prop akan meninggalkan cabang yang
  terlewat. Default context kosong = entri bergerbang **tersembunyi**; entri `clients` menyala hanya
  saat `presence.enabled` (hub punya ≥1 `DeviceToken` belum dicabut), sehingga instalasi satu mesin
  tetap melihat **15** entri nav yang sama seperti sebelum SPEC-919 (`HN_NAV` kini 16, satu bergerbang).
- **`PresenceChip`** (SPEC-919) — penanda "dikerjakan di `<device>`" di baris/kartu backlog, kartu
  board, dan baris project (sel Status). Satu komponen untuk ketiganya, disuapi indeks murni
  `screens/presence-map.ts`. Ia **beda** dari `HandledByChips` (ADR-0135): yang itu penetapan MANUAL
  yang menyeberang sync, yang ini keadaan LIVE yang tak pernah masuk DB. Daftar nama kosong →
  **nol elemen**, ujung terakhir gerbang "instance tanpa sync tak berubah tampilannya".
- **Kendali & tampilan klien dari hub — turunan A + B + C + D mendarat** (SPEC-1215/SPEC-1216/SPEC-1217/SPEC-1218 ·
  [ADR-0165](../adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) · [spec §S4.11](../../../docs/superpowers/specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md)),
  `RemoteControlPanel` (Settings → Kendali jarak jauh) mendarat dengan **tiga toggle lajur log**
  (`event`/`server`/`transcript`, `event` default nyala — SPEC-1217 AC-D1). Target Start + aksi sesi
  lintas instance (`createApi({base})`, `InstanceContext`, pemilih target di `StartSessionModal`, retry
  `syncOnce` pada `409 spec-404`), termasuk route `/devices/:deviceId/relay/*`, mendarat di turunan B
  (SPEC-1216 · [spec §S9](../../../docs/superpowers/specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md));
  tampilan identik — stream, resize, backpressure §S10 — mendarat di turunan C (SPEC-1218):
  `RemoteInstanceView`/`RemoteBanner`, `TerminalPane`/`SpecDocsModal`/`IdeReadPanel` mode=remote,
  dan tombol Buka `ClientsScreen` — lihat [plan turunan C](../../../docs/superpowers/plans/2026-09-18-spec-1218-tampilan-identik-turunan-c-plan.md).
  - **Pabrik API.** `createApi({ base })` menggantikan prefix `/api` dengan
    `/api/devices/<deviceId>/relay`; `api = createApi()` tetap untuk 61 importir.
  - **`InstanceContext`** (`local | remote`) memberi `useApi()` dan `useWsTarget()` (URL + tiket
    `relay:<deviceId>:…`). `TerminalPane`, chip fase, `SpecDocsModal`, dan panel IDE baca dirender
    **modul yang sama** di dalamnya.
  - **`TerminalPane` remote:** tak pernah mengirim `resize`, menerapkan frame `geometry`, baca-saja
    tanpa `sessions:write`, dan resync `4009` lewat reconnect yang ada.
  - **Layar Klien:** menampilkan `control` & `capacity`, tombol **Buka** (`RemoteInstanceView` +
    banner "Sedang melihat klien X · vN"), dan tab **Device | Log** (default Device — SPEC-1217
    D6/AC-S8). Tab **Log** merender `LogsPanel.tsx` (SPEC-1217 AC-D5/D8/D10): pencarian
    (device/project/spec/lane/level/kind/teks), kursor opaque (tanpa `total`), buka transkrip per
    entri, dan blok retensi (`GET|PUT /api/logs/retention`).
  - **`StartSessionModal` di hub:** mendapat pemilih target (default `handledBy` ∩ online ∩
    `sessions:spawn` ∩ kapasitas); "Mulai tetap" tak dirender untuk target remote.
  - **Settings klien:** `RemoteControlPanel` (grant, tiga toggle lajur log, status relay/pengiriman,
    audit 50 terbaru).
- **Start dari Backlog tetap di Backlog** setelah sesi berhasil dibuat; modal tertutup dan toast sukses
  tampil. Operator berpindah ke Terminal hanya lewat aksi eksplisit **Buka sesi** (SPEC-341).
- Filter project di Backlog **dan PRD** dibaca dari satu state `projectFilter` milik `App`, bukan state
  lokal tiap layar (SPEC-146) — detail project memakainya untuk membuka Backlog dalam keadaan tersaring.
  Sentinel `"all"` = "Semua project" (PRD → `GET /prds` lintas-project; Backlog → `project` di-omit).

## Audit UI/UX 2026-10 · Fase 1 (quick win)

Fase 1 dari [audit UI/UX](ui-ux-audit-2026-10.md) sudah ada di kode; diverifikasi terhadap diff `main`,
bukan terhadap rencana. Status per butir dan sisanya ada di [§Status pelaksanaan](ui-ux-audit-2026-10.md#status-pelaksanaan).
Token dan aturan lintas-layar ada di [design-system](../design-system/design-system.md#kontras-konfirmasi-dan-error-audit-uiux-2026-10--fase-1).

Per layar:

- **Overview** — state kosong (belum ada project) hanya menampilkan kartu dan CTA "Buat project pertama",
  tanpa KPI strip (`screens/OverviewScreen.tsx:126-137`; `test/overview-screen.test.tsx`).
- **Dalang** — ticker 26 ms terisolasi di `BootTicker` dan jam 1 dtk di `DalangClock`
  (`screens/DalangHanomanScreen.tsx:46-104`), sehingga layar induk tak ikut re-render. Teks statis
  "HANOMAN ONLINE" diganti status koneksi nyata dari `events.connected` (`:172`). Tombol keluar berada di
  luar `.hn-dlg-chips` dan berukuran 44×44 pada `(pointer: coarse)` atau ≤767px (`app.css:1013-1025`,
  `--touch-target`). Di desktop tombol tetap 34px. Tes: `test/dalang-hanoman.test.tsx`.
- **Backlog** — hapus spec lewat `useConfirm` (`screens/BacklogScreen.tsx:1082-1096`). Kartu menampilkan
  satu aksi utama sadar-stage; sisanya di `OverflowActions` ⋯ (`:600-638`). `TaskModal` tak bisa ditutup
  saat menyimpan (`screens/TaskModal.tsx:125`), dan hapus tugas berkonfirmasi (`:102-105`). Tes:
  `test/backlog-delete-confirm.test.tsx`, `test/backlog-ui-audit.test.tsx`, `test/task-modal-busy.test.tsx`.
- **Terminal** — kill sesi berkonfirmasi (`requestKill`, `screens/TerminalScreen.tsx:336-350`); "Buang"
  ketikan tertahan berkonfirmasi (`confirmDiscard`, `screens/TerminalPane.tsx:828-835`). Panel Diagnostik
  tertutup secara default (`TerminalScreen.tsx:531`). Sesi berakhir memakai banner "Berakhir" tanpa
  meredupkan badan (`:1362-1372`). Modal fullscreen tak ditutup oleh Escape (`:1389`). `Ctrl+Shift+Esc`
  melepas fokus dari terminal (`TerminalPane.tsx:517-518`). Tes: `test/terminal-screen.test.tsx`,
  `test/terminal-pane.test.tsx`. Celah: "Hapus sel" (`TerminalPane.tsx:854-856`) masih memanggil
  `killSession` tanpa konfirmasi.
- **Settings** — persist jujur: toast sukses hanya setelah PUT berhasil, galat tampil, dan nilai kembali ke
  nilai tersimpan saat gagal (`screens/SettingsScreen.tsx:871-874`). Penyimpanan berurutan lewat antrean
  GET → rebase → PUT (`:801,865-869`; `test/settings-rebase.test.tsx`). Gagal memuat setelan menampilkan
  galat dan tidak jatuh ke default yang bisa menimpa server (`:828-832`). Reset konfigurasi, hapus atau
  cabut token, hapus log, hapus pengguna, dan hapus kredensial Telegram memakai `useConfirm`
  (`:231,299,362,435,609,947`). Tab default adalah **Sesi** (`:803`; `test/settings-nav.test.tsx`).
- **Klien** — tab IDE meneruskan `projectId` (`screens/ClientsScreen.tsx:193` → `RemoteInstanceView.tsx:59`;
  `test/clients-screen.test.tsx`). Hapus akun berkonfirmasi (`screens/ClientAccessPanel.tsx:89-96`;
  `test/client-access-panel.test.tsx`). Grant berisiko (Tulis, Mulai sesi) berkonfirmasi di
  `screens/RemoteControlPanel.tsx:134-139`, yaitu di Settings → Kendali jarak jauh, bukan di Klien.
- **IDE** — guard draft saat pindah berkas atau ganti ref (`screens/IdeScreen.tsx:225-238,434`). Edit
  diblokir saat ref lain dipilih (`:302,607`; `test/ide-edit-guard.test.tsx`). Input nama, folder, dan
  rename memakai `Modal` design system (`:673-686`), hapus memakai `useConfirm` (`:370-374`), dan konflik
  unggah memakai Modal (`:689`). Tree memakai ARIA tree dan navigasi panah (`screens/file-tree.tsx`;
  `test/file-tree-keyboard.test.tsx`).
- **Docs** — guard draft saat pindah dokumen (`screens/DocsWorkspace.tsx:177-187,200`). Simpan memakai
  try/catch dengan galat inline (`:191-195,346-348`; `test/docs-save-guard.test.tsx`).
- **Skills** — guard dirty (`screens/skills/SkillsWorkspace.tsx:43-52`, `SkillEditor.tsx:136-137`).
  "Timpa" berkonfirmasi (`SkillEditor.tsx:200`). Nama skill baru lewat `Modal` (`SkillEditor.tsx:79-93`,
  `SkillsWorkspace.tsx:105-133`; `screens/skills/SkillsWorkspace.test.tsx`).
- **GitGraph** — tak ada pemanggilan `window.confirm`. Reset hard dan Clean untracked lewat `guard` →
  `confirm` aplikasi (`screens/GitGraph.tsx:222-224,532-535,855-871`; `test/git-graph-destructive.test.tsx`).
  `test/confirm-inventory.test.ts` menjaga jumlah `window.*` native tetap nol.
- **Scheduler** — input angka tak dipaksa ke minimum saat dikosongkan. Nilai disimpan sebagai draft; blur
  mengembalikannya ke nilai tersimpan, dan komit lewat Enter atau "Simpan setelan" (`screens/SchedulerScreen.tsx:270-320`).
  Jeda dan Hentikan berkonfirmasi (`:458-474`). Simpan setelan tak menimpa `enabled`/`paused` (`:289-291`).
  Hapus cron berkonfirmasi (`screens/SchedulerCrons.tsx:178-190`; `screens/SchedulerCrons.test.tsx`).
- **Lead** — input angka memakai draft, tanpa PUT per ketukan dan tanpa `disabled={busy}`. Komit saat blur
  atau Enter (`screens/LeadScreen.tsx:85,103-109,140-161`). Batal keputusan dan batal atau kirim rangkaian
  berkonfirmasi (`:475-492`). Helper `screens/sched-lead-shared.tsx` dipakai Scheduler, Cron, dan Lead
  (`test/sched-lead-shared.test.tsx`).
- **QA** — hapus test case, lampiran, dan "Kirim semua ke backlog" berkonfirmasi (`screens/qa/QaCasesPanel.tsx:28`,
  `QaAttachments.tsx:41`, `QaFindingsPanel.tsx:79,100`; `screens/qa/QaWorkspace.test.tsx`, `screens/qa/QaAttachments.test.tsx`).
  "Kembali" dengan isian belum tersimpan bertanya dulu, dan badge "Belum disimpan" tampil
  (`qa/QaReportEditor.tsx:79-88,115`). Severity dan status tampil sebagai label (`qa/qa-ui.ts:10,62-63`).
  `QaField` memisahkan label (`htmlFor`) dari hint (`qa/QaField.tsx:23-26`).
- **Triase** — tolak tiket dan tolak issue GitHub berkonfirmasi (`screens/TriageScreen.tsx:145-160,362-373`).
  Clipboard punya catch dengan toast galat (`:162-167`). Query di-debounce, dan loading penuh hanya tampil
  bila belum ada data (`:445-460`). Label filter kosong "Semua project" dan "Semua status" (`:541-545`).
- **Projects** — galat dipisah dari daftar kosong (`screens/ProjectsScreen.tsx:181-186`). Muat ulang yang
  gagal mempertahankan baris lama (`:139-141`). Enum `from-scratch` memakai label "Dari nol" (`:22`). Clone
  dikonfirmasi satu kali di modal (`screens/MissingRepoCard.tsx:44-51`).
- **PRD** — seleksi tersimpan tak dibuang saat mount (`screens/PrdScreen.tsx:333-343`). Daftar memiliki
  loading dan error (`:315,365-368`); isi memiliki error (`:224-227`).
- **Tim** — filter kosong memiliki "Hapus filter" (`screens/TeamScreen.tsx:278-281,356-357`). Anggota yang
  gagal dimuat tampil sebagai galat dengan Coba lagi (`:87-89,325-328`).
- **Review dan Reconcile** — `ReconcileModal` gagal memuat tak lagi menampilkan "Tak ada konflik"; teks itu
  hanya tampil bila `loadError` kosong (`screens/ReconcileModal.tsx:94,106-112`). `ReviewScreen`
  mengubah 409 menjadi empty state, bukan galat merah (`:40-41`). Review belum punya aksi Merge/Buang.
- **Auth dan Setup** — galat login dibedakan per penyebab: 401, 429, dan jaringan (`screens/AuthScreen.tsx:16-31`).
  Galat setup selain 409 jatuh ke `failureMessage` (`:27`). Status 400 masih memuat "Password minimal 8 karakter"
  (`:22`); sisanya ada di tindak lanjut.
- **VPS** — preview di-reset saat pilihan item berubah (`screens/VpsChecklist.tsx:170-173`). Konfirmasi
  menyebut item (`:193-204`). Galat `r.out` tampil di toast, tidak dibuang (`screens/VpsScreen.tsx:128,152`).
- **Portal** — label ramah untuk kategori dan prioritas (`portal/labels.ts:4-18`) serta stage
  (`portal/ClientPortal.tsx:23`). Pesan yang gagal terkirim ditandai "Gagal terkirim" (`portal/ChatPanel.tsx:101,190-196`).
  Muat gagal dipisah dari "Belum ada pekerjaan" (`ClientPortal.tsx:180-185`; `portal/ChatPanel.test.tsx`).

Lintas layar:

- **Shell** — `ds/shell.tsx` merender tautan "Lewati ke konten" (`:138-154,224`) dan judul layar sebagai
  `<h1>` (`:266-272`). `src/index.html:6` memakai `viewport-fit=cover`.
- **Responsif** — tiga grid inline di `App.tsx` (`:577,595,618`) memakai kelas `hn-grid-mobile`, yang di
  bawah 768px menjadi satu kolom (`app.css:287`).
- **Konfirmasi dan galat** — `useConfirm` dipakai 34 berkas. `ConfirmDialog` menerima `impact` (daftar bebas)
  dan `confirmLabel`. `lib/report-error.ts` menyediakan `errorMessage` dan `failureMessage`. Sisa
  `.catch(() => {})` di kode non-test berjumlah 9 dan ada di tindak lanjut.
- **FolderPicker** — baris folder berupa `<button>` native sehingga bisa difokus dengan keyboard
  (`screens/FolderPicker.tsx:17-21`). "Pilih folder ini" aktif hanya bila draft sama dengan folder yang
  dimuat dan tidak sedang memuat atau galat (`:62,68`; `test/folder-picker.test.tsx`).
- **Performa** — `lib/snapshot-digest.ts` (`digestOf`, `applyIfChanged`) dipasang di `App.tsx` untuk frame
  WS `sessions`, `leadAsks`, dan `pending`: frame yang isinya sama tak menyentuh state (`App.tsx:949-950,1007-1013`).
  `specs` memakai `specsDigestOf` yang sudah ada (`:1000-1001`). Tulis scroll ke `localStorage` di-throttle
  200 ms dan di-flush saat `scrollend` dan unmount (`ui-state/hooks.ts:66,84-107`). `index.html:8-9`
  memakai `preconnect` untuk Google Fonts; `@import` di `ds/tokens/fonts.css:9` belum diubah.
- **Design system** — token kontras, alias, dan aturan konfirmasi/error ada di
  [design-system](../design-system/design-system.md#kontras-konfirmasi-dan-error-audit-uiux-2026-10--fase-1).

Test baru Fase 1 (berkas tak terlacak di `main`): `test/app-snapshot-digest.test.tsx`,
`test/backlog-delete-confirm.test.tsx`, `test/backlog-ui-audit.test.tsx`, `test/docs-save-guard.test.tsx`,
`test/file-tree-keyboard.test.tsx`, `test/folder-picker.test.tsx`, `test/git-graph-destructive.test.tsx`,
`test/ide-edit-guard.test.tsx`, `test/limit-indicator-a11y.test.tsx`, `test/notifications-mark-read.test.tsx`,
`test/orchestration-panel.test.tsx`, `test/overview-screen.test.tsx`, `test/portal-labels.test.ts`,
`test/report-error.test.ts`, `test/sched-lead-shared.test.tsx`, `test/shell-a11y.test.tsx`,
`test/task-modal-busy.test.tsx`, `test/ui-audit-tokens.test.ts`, dan `lib/snapshot-digest.test.ts`.

## Audit UI/UX 2026-10 · Fase 2C · Palet perintah & shortcut

Fase 2C dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md): palet perintah ⌘K,
shortcut `g` + huruf, `?`, `/`, dan project switcher tunggal di topbar. Aturan interaksinya ada di
[design-system](../design-system/design-system.md#palet-perintah-dan-shortcut-audit-uiux-2026-10--fase-2c).
Tak ada endpoint baru: palet membaca state App yang sudah ada (`projects`, `backlog`, `sessions`,
`projectFilter`) dan menyimpan riwayatnya di ui-state (`hn.ui.v1.palette.recent`).

Berkas di `src/src/palette/`:

- `commands.ts` — sumber perintah murni (`buildPaletteCommands`) dan pencarian (`searchCommands`). Kueri kosong
  menampilkan Riwayat, Menunggu kamu, Aksi, dan Pindah ke; Backlog dan Project hanya muncul saat diketik
  (dipangkas `SEARCH_CAP` = 8). Layar bergerbang (`gate`) tak muncul selama gerbangnya mati.
- `fuzzy.ts` — pencocokan urutan karakter, tanpa membedakan huruf besar dan diakritik. Kata yang muncul utuh
  selalu mengalahkan kecocokan berpencar.
- `shortcuts.ts` — peta chord `CHORD_KEYS` (17 huruf, satu per entri `HN_NAV`), `stepChord` dengan jendela
  1 dtk, dan `shortcutSections` untuk dialog bantuan.
- `useGlobalShortcuts.ts` — satu listener `keydown` di window. Tidak aktif saat fokus di input, textarea,
  select, atau contenteditable; di dalam `.xterm` (termasuk ⌘K, karena Ctrl+K milik readline); saat ada
  `[aria-modal="true"]`; saat memakai Ctrl/⌘/Alt; dan saat `enabled=false` (login, portal klien).
- `ui-store.ts` — status buka palet dan bantuan. Store modul, bukan context, supaya tombol topbar di setiap
  cabang `App` bisa membukanya tanpa prop baru (alasan yang sama dengan `NavGate`).
- `CommandPalette.tsx` — `Modal` DS berisi combobox + listbox. Fokus tetap di kotak kueri dan opsi aktif
  ditunjuk lewat `aria-activedescendant`. Panah melewati perintah nonaktif, Enter menjalankan, Esc menutup
  dan fokus kembali ke pemicu. Riwayat ditulis langsung ke storage karena komponen unmount saat palet
  tertutup, sehingga state `usePersistedState` tak sempat tersimpan.
- `ShortcutHelp.tsx` — dialog `?`. Isinya dibangkitkan dari `shortcuts.ts`, sehingga tak bisa menyimpang dari
  shortcut yang benar-benar bekerja.
- `ProjectSwitcher.tsx` — `ProjectScopeContext` (diisi App dari state `projectFilter`) dan `Select`
  "Project aktif". Hanya tampil di layar `PROJECT_SCOPED_KEYS` (backlog, team, prd) — layar yang benar-benar
  membaca filter itu. Nama scope masuk breadcrumb (`data-testid="scope-crumb"`).
- `palette.css` — gaya palet, dialog bantuan, dan `.hn-shell-cmdk`. Pada `(pointer: coarse), (max-width: 767px)`
  tombol ≥ `--touch-target` dan petunjuk ⌘K/Ctrl K disembunyikan.

Shell (`ds/shell.tsx`): tombol topbar `aria-label="Cari"` membuka palet dan memasang `aria-keyshortcuts`
(`Meta+K` di Mac, `Control+K` di lainnya). Kotak cari layar (`showSearch`, Projects) tetap ada berdampingan.

App (`App.tsx`):

- `useGlobalShortcuts` diberi `navKeys` = `HN_NAV` yang sudah tersaring gerbang; hook dipanggil sebelum gerbang
  auth, sehingga urutan hook tetap.
- `paletteCommands` disusun dari state App. "Jawab sesi yang menunggu" memakai `waitingSessions` dari
  `screens/pet-state.ts` dan membuka Terminal ter-fokus ke sesi itu.
- Dalang keluar ke layar sebelumnya: `lastPageRef` menyimpan layar nav terakhir yang bukan dalang dan dipakai
  sebagai `previous`. Tanpa riwayat (dibuka langsung dari URL) ia jatuh ke Overview.
- `TeamScreen` menerima `onOpenSpec` → `/backlog/<id>` (Backlog dengan SpecDetail terbuka).
- `AuthScreen` menerima `setupTokenPath` dari `/auth/status`. Field itu sudah ada di `AuthStatus`
  (`shared/src/dto.ts`) dan server (`server/src/routes/auth.ts`).
- Toast: App merender `ToastHost` (antrean dari `ds/kit.tsx`), diimpor langsung dari `./ds/kit`.

Tes:

- `src/palette/commands.test.ts` — fuzzy, perintah, pencarian, dan "setiap layar HN_NAV bisa dicapai lewat
  palet" (termasuk layar bergerbang yang mati).
- `src/palette/shortcuts.test.ts` — chord dan jendelanya; setiap entri HN_NAV punya huruf; isi bantuan.
- `src/palette/CommandPalette.test.tsx` — dialog, navigasi panah, perintah nonaktif, prefill, Esc + fokus,
  riwayat.
- `src/palette/useGlobalShortcuts.test.tsx` — chord, pengecualian fokus/xterm/dialog/modifier, ⌘K, `?`, `/`.
- `src/palette/shell-topbar.test.tsx` — tombol Cari, petunjuk Ctrl K, project switcher, breadcrumb scope.
- `src/routes.test.ts` — setiap entri HN_NAV kembali ke section-nya lewat `routePath`/`parseRoute`.
- `src/test/palette-app.test.tsx` — ⌘K lalu Backlog, `g p` lalu `?`, Dalang kembali ke Projects.

Belum di Fase 2C (lihat [§Status pelaksanaan](ui-ux-audit-2026-10.md#status-pelaksanaan)):

- Tombol "Buat project pertama" di Overview masih `onGoto("projects")`. Membuka modal project baru langsung
  butuh prop `onCreateProject` di `OverviewScreen` (`screens/`, milik Fase 2F).
- Tombol "Jawab" pada toast dan notifikasi keputusan: sudah ada sejak Fase 4 (lihat § Fase 4 · Jawab dari notifikasi).

## Kontrak responsive seluruh frontend (SPEC-763)

Semua permukaan — seluruh `HN_NAV`, section transien App, Auth/setup, Modal/form, Pet Hanoman, Help
Center publik, dan portal klien — memakai **komponen/data/state yang sama** di mobile, tablet, dan
desktop. Tidak ada route atau screen mobile kedua. Breakpoint tunggal ada di `ds/responsive.tsx`:
mobile `<768px`, tablet `768–1199px`, desktop `≥1200px`; `Shell` menulis tier hidup ke
`data-layout` untuk kontrak dan diagnosis.

**Chrome.** `Shell` merender satu navigation tree berisi delapan hub bergrup (`HN_HUBS`, ADR-0205; `HN_NAV` tetap daftar rute yang valid). Pada mobile tree itu
menjadi drawer ber-backdrop dengan tombol `aria-controls`/`aria-expanded`, focus trap, Escape,
focus restore, konten belakang `inert`, dan menutup sesudah navigasi. Tablet merender rail 72px (ikon + `title`), desktop
sidebar 248px. Topbar/search/limit/notifikasi/update/action/account membungkus pada ruang sempit;
tak satu pun dihilangkan. `<main>` adalah satu-satunya page scroller dan menahan overflow mendatar.

**Vocabulary layout.** Token gutter, safe-area, touch target, sidebar, dan topbar ada di
`ds/tokens/spacing.css`; aturan viewport dan media query bersama ada di `app.css`. Gunakan
`ResponsiveToolbar` untuk kelompok kontrol, `ResponsivePanels` untuk master/detail atau workspace,
dan `LocalOverflow` untuk konten yang memang harus bergulir mendatar. `ResponsivePanels` menjaga
panel nonaktif tetap mounted: pada mobile operator memilih panel melalui tab, sedangkan
tablet/desktop menampilkan instance yang sama sebagai split-pane sesuai `splitAt`. Perubahan tier
tidak ditulis ke localStorage dan tidak memutasi selection/state ADR-0115. Pergantian panel selector
memindahkan fokus ke region baru agar fokus tidak tertinggal pada panel yang menjadi tersembunyi.

Keluarga yang mengikuti kontrak itu:

- KPI, metadata, form padat, pseudo-table, dan row aksi (Overview, Projects, Project detail,
  Backlog, Scheduler, Lead, VPS, Settings) turun menjadi satu kolom atau wrap. Projects
  menjadi row/card berlabel; board Backlog tetap horizontal di scroller lokal dan semua aksi punya
  jalur button non-drag.
- PRD, Docs, Review, Spec Docs, dan IDE Explorer memakai pemilih master/detail pada mobile lalu
  split-pane pada layar lebar. Git Graph memakai Graph/Detail; graph, kode, dan diff tetap memiliki
  scroller lokal serta semua operasi yang dahulu kontekstual memiliki tombol touch/keyboard. Baris
  kepala IDE (`.hn-ide-head`) menaruh strip tab dan toolbar dalam satu baris ber-basis dinyatakan:
  satu baris di ~1100px, dua baris di 820px, dan di 390px toolbar turun ke barisnya sendiri sebagai
  strip yang menggulir (`.hn-ide-toolbar`). Baris commit Git Graph hidup di scroller lokal
  `ide-graph-rows`; baris Branches/Worktrees membungkus lewat `.hn-dense-row` (SPEC-879).
- Terminal mobile memilih satu cell/panel aktif tanpa mengubah `{rows,cols,cells}` workspace yang
  dipersist untuk desktop. Semua `TerminalPane` tetap mounted; layar lebar kembali ke grid. Host
  yang berubah ukuran tetap menjalankan `ResizeObserver → FitAddon.fit() → resize` WebSocket.
  Initial fit, attach WebSocket, dan observer mengabaikan host `0×0` milik panel tersembunyi agar
  PTY background tidak direflow ke ukuran minimum palsu; saat panel terlihat lagi observer mengirim ukuran riil. Deep-link sesi
  memilih grup dan cell target pada mobile. Semua pintu yang mengetahui ID sesi—Backlog, hasil
  pembukaan flow project, konflik integrasi, VPS, Scheduler, IDE, dan Lead—wajib meneruskan ID itu
  saat membuka Terminal; navigasi tanpa target hanya untuk pintu Terminal generik. Root Terminal
  mengikuti tinggi flex Shell dengan basis minimum, bukan mengurangi `100dvh` memakai tinggi chrome
  tetap: pada viewport pendek `<main>` yang menggulir agar toolbar dan pane aktif tetap terjangkau
  (SPEC-767).
- Settings mengganti sidebar section dengan `Select` mobile. Auth/Help/portal memiliki scroller
  `100dvh`; header, tab, row metadata, dan form membungkus tanpa menghapus field/aksi. Pet memakai
  safe-area, handle 44px, dan panel yang di-clamp terhadap dynamic viewport.

**Aksesibilitas & viewport.** Target sentuh minimum adalah 44×44px pada mobile/pointer kasar.
Primitive interaktif memakai semantic button/tab/select serta keyboard; Modal punya
`role="dialog"`, accessible title, focus trap/restore, Escape, badan scroll, footer wrap, dan bentuk
bottom sheet mobile. Root memakai `100vh` sebagai fallback lalu `100dvh`; safe-area diterapkan pada
drawer, dialog, fullscreen, Pet, dan permukaan mandiri supaya browser chrome/notch/keyboard virtual
tidak menutup kontrol. `prefers-reduced-motion: reduce` mematikan animation/transition global tanpa
menghilangkan status atau aksi.

Popover topbar yang memakai pola menu/dialog memindahkan fokus saat dibuka, mendukung Escape dan
outside-click, mengembalikan fokus ke pemicu, serta memberi Arrow/Home/End pada item menu.

**Overflow.** Invariant halaman adalah `scrollWidth <= clientWidth`. Horizontal overflow hanya sah
bila dimiliki container `.hn-local-overflow` atau seam lokal setara untuk terminal, kode, diff,
graph, board, dan tabel yang memang membutuhkan lebar intrinsik. `min-width:0` wajib diteruskan di
rantai flex/grid; jangan memperbaiki overflow halaman dengan menyembunyikan fitur atau metadata.

**Invariant halaman tidak menjamin layar terbaca.** Diukur di Chrome atas instance hanoman
terisolasi (390/320/820px, ke-13 layar `HN_NAV`): `scrollWidth <= clientWidth` **lulus di semua
layar** sementara tiga kelas cacat tetap hidup di baliknya, karena ketiganya membayar overflow
dengan memotong atau menjepit, bukan dengan reflow. Ketiganya kini punya aturan:

- **Tab wajib `flex: 0 0 auto`.** `.hn-tabs` sudah `overflow-x: auto`, tapi tab yang boleh menyusut
  akan berhenti di `min-width` target sentuh (44px) dan label `nowrap`-nya **tumpah ke tab
  tetangga** alih-alih memicu scroll — strip itu lalu tak pernah punya konten lebih lebar untuk
  digulir. Terukur pada strip sumber Backlog di 390px: tumpahan **67px** (`Semua spec` 22px menimpa
  `Dari brief`, `Help Center` 20px terpotong di tepi) dan `canScroll: false`; dengan flex-shrink
  mati: tumpahan **0px**, konten 499px > kotak 362px, strip menggulir. Gerbangnya
  `src/test/responsive-no-squeeze.test.tsx`.
- **Baris `[teks][tombol]` wajib `hn-dense-row`.** Tombol tidak menyusut, jadi teks menerima sisa
  lebar berapa pun itu. Terukur di 390px: nama project di Overview jadi **3 baris (4
  karakter/baris)**, kalimat gerbang scheduler jadi **9 baris (8 karakter/baris)**. `.hn-dense-row`
  memberi anak `flex: 1` lebar minimum 220px sehingga tombolnya turun ke baris berikutnya.
- **Baris kepala wajib punya `flex-basis` yang DINYATAKAN, bukan `auto` (SPEC-879).** `flex-wrap`
  memutus baris memakai *hypothetical main size*, yaitu `flex-basis` — dengan basis `auto` itu
  berarti **lebar isi**, jadi memberi salah satu item kemampuan menyusut tak pernah menolong dan
  bentuk kepala ditentukan isinya, bukan layout-nya. Terukur pada baris kepala IDE di 1100px yang
  sama: tab Explorer memberi **satu** baris sementara tab Worktrees memberi **dua**, semata karena
  label tab aktif dirender `font-weight: 600`; dan menambahkan satu project bernama `probe-diff`
  membuat **keempat** tab jadi dua baris, karena lebar `<select>` native mengikuti opsi
  terpanjangnya. `.hn-ide-head` karena itu memberi toolbar basis 480px (`.hn-ide-toolbar`
  `flex: 1 1 480px`): ≥480px ia tetap satu baris, kurang dari itu ia turun ke barisnya sendiri dan
  menggulir di sana. Rata kanan lewat `margin-inline-start: auto` pada anak pertama, **bukan**
  `justify-content: flex-end` — di kontainer yang menggulir, flex-end membuat awal konten tak
  terjangkau.
- **Scroller lokal wajib punya konten yang lebih lebar, dan anak BLOK tak pernah memberikannya
  (SPEC-879).** Blok selalu selebar induknya, jadi `.hn-local-overflow` yang membungkus satu `<div>`
  biasa adalah scroller mati persis seperti strip tab tanpa `flex-shrink: 0` — terukur pada kartu
  Git Graph di 390px: `content = box = 362`, `canScroll: false`, dan **200 tombol subject commit
  runtuh ke `0×44`** sementara pill ref meluber menimpa kolom author. Bungkus **region yang memang
  butuh lebar intrinsik saja** (baris commit), beri anaknya `min-width`, dan beri lantai `min-width`
  pada kolom yang boleh disantap tetangganya — pill ref `flex: 0 0 auto` memakan kolom subject lebih
  dulu, jadi tanpa lantai itu baris HEAD menyisakan **24px** meski kartunya sudah punya lebar
  minimum.
- **Baris tabel reflow sebelum menggulir (SPEC-879).** Menggulir mendatar hanya sah untuk konten
  yang tak bisa reflow (graph, diff, kode). Baris Branches/Worktrees bisa: tanpa `flex-wrap` mereka
  menyembunyikan **tombol Hapus tiap baris** 193–364px di luar layar di 390px (18px di 820px) tanpa
  satu pun scrollbar terlihat. `.hn-dense-row` + `flex-wrap: wrap` inline di semua tier, kolom meta
  `margin-left: auto`; di ≥1200px barisnya muat sehingga bentuk desktop tak berubah.
- **Baris di dalam daftar bertinggi terbatas wajib `flex: 0 0 auto`.** Daftar pemilih (Ambil
  backlog, Riwayat sesi) adalah `flex-direction: column` ber-`maxHeight`, jadi barisnya boleh
  diperas di bawah kontennya: terukur tombol **44px memuat isi 66px**, dan judul yang membungkus
  **menimpa baris di bawahnya**. Ini akar yang sama dengan tab yang tumpah.
- **`all: "unset"` inline adalah racun bagi aturan mobile.** Ia inline, jadi ia menang atas
  `button { min-height: var(--touch-target) }` **dan** atas `flex-wrap` milik `.hn-dense-row` —
  terukur baris pemilih 39px, di bawah minimum 44px. `app.css` sudah menambal tiga nama kelas
  (`.hn-touch-target`, `.hn-project-open`, `.hn-terminal-unplaced-action`) dengan `!important`,
  tapi tambalan itu hanya menjangkau yang sudah diketahui. Pakai reset eksplisit per properti
  (`font`/`color`/`background`/`border`/`textAlign`), jangan `all: unset`.
- **Pembungkus flex tak boleh berupa `<button>` itu sendiri.** Kotak tombol tak menumbuhkan
  tingginya untuk baris flex yang membungkus; letakkan barisnya di `<span>` di dalam tombol.
- **Judul adalah yang terakhir mengalah.** Di baris pemilih, judul ber-`flex-basis: 0` kalah dari
  tetangga yang basis-nya selebar isinya — terukur judul tersisa **"Ba…"** (konten terpotong 667px)
  sementara id project yang identik di semua baris tampil penuh. Di mobile `.hn-picker-title` turun
  ke barisnya sendiri dan membungkus; `!important` wajib karena `white-space: nowrap`-nya inline.
- **Pet melayang mencuri tap, dan z-index bukan yang membatasinya.** (Catatan historis: sejak ADR-0206 jalur pet tak lagi
  `position: fixed`.) Pet `position: fixed` z-80
  memang di bawah lapisan chrome (header 90, Modal 150), tapi **di atas konten halaman**. Tombol
  tembus-pandangnya dulu selebar seluruh panggung 76×76, sehingga tap yang ditujukan ke kontrol di
  bawahnya mendarat di pet — terukur `elementFromPoint` atas 9 titik sampel per kontrol: "Hapus
  spec" 2/9, "Buka project" 3/9, "Pimpin" 4/9, item PRD 2/9. Area tangkapnya kini dibatasi
  `HIT = 44` (minimum aksesibilitas) berjangkar kanan-bawah: **6 kontrol di 4 layar → 1 kontrol di
  1 layar**. Sisa satu itu melekat pada sifat widget melayang; operator bisa menyembunyikan pet.
- **Label topbar panjang diringkas, bukan dihapus.** Pil update selebar 296px dari ~358px baris
  tools sendirian memaksa topbar jadi tiga baris — terukur **161–211px = 19–25%** viewport 844px.
  Di mobile `.hn-topbar-label` diganti `.hn-topbar-label-short` (versinya saja): header turun ke
  **111px (13%)** pada layar tanpa search/aksi. Yang diringkas hanya kata-nya — kontrol, versi, dan
  `aria-label`/`title`-nya tetap ada, sesuai aturan "tak satu pun dihilangkan"; ikon telanjang
  ditolak karena lingkaran kosong tak mengatakan apa pun.

## Audit UI/UX 2026-10 · Fase 3A · Navigasi 8 hub bergrup (ADR-0205)

Fase 3A dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md): 17 entri sidebar
menjadi 8 hub di tiga grup. Keputusan dan alasannya ada di [ADR-0205](../adr/0205-navigasi-8-hub-bergrup.md);
pola interaksinya di [design-system](../design-system/design-system.md#navigasi-hub-audit-uiux-2026-10--fase-3a).
URL tidak berubah dan tidak ada redirect, karena path setiap section sama seperti sebelumnya.

Berkas:

- `src/src/nav-hubs.ts` — murni: `HN_HUBS` (delapan hub, tab, `default`, turunan `derived`), `HN_GROUPS`,
  `PALETTE_ONLY_SECTIONS` (dalang), `hubOf`, `tabOf` (tab yang mewakili sebuah section), `sectionsOf`,
  `tabsOf` (menyaring gerbang), `hubTarget` (tab terakhir, lalu default), dan `hubBadge` (jumlah antrean tab).
- `src/src/ds/shell.tsx` — sidebar merender hub per grup berlabel (`role="group"`). Item aktif = hub dari
  `active`. Klik hub → `hubTarget`. Tab terakhir per hub disimpan di ui-state `nav.lastTab` dan **hanya
  ditulis `Shell`** lewat efek pada `active`. Crumb `hub-crumb` `Hub › Tab` untuk hub bertab banyak;
  deskripsi layar dibungkus span sendiri agar teksnya tetap utuh. `HN_NAV` tetap diekspor.
- `src/src/ds/section-tabs.tsx` — `SectionTabs`: `Tabs` DS (`role="tablist"`). Tab terpilih diturunkan dari
  `section` (URL). Klik tab → `onNavigate` (kecuali tab yang sama dengan `section`). Gerbang tab disaring,
  badge per tab dari `NavPending`. Tak merender apa pun bila hub hanya punya satu tab yang tampil.
- `src/src/App.tsx` — `hubTabs` (`SectionTabs`) dipasang di layar anak hub: Projects (`projects`, `project`,
  `prd`, `docs`, `qa`, `ide`), Backlog (`backlog`, `team`, `review`), Sesi (`terminal`, `clients`), Otonom
  (`scheduler`, `lead`), dan Pengaturan (`settings`, `vps`). Layar hub satu-tab (Overview, Triase, Skills)
  tak memasangnya. Dalang tetap `section`, tanpa Shell.
- `src/src/palette/commands.ts` — aksi **"Buka panggung"** (`action:panggung` → `dalang`), karena Dalang tak
  lagi di sidebar. Entri "Pindah ke Dalang Hanoman" tetap ada.
- `src/src/palette/shortcuts.ts` — baris bantuan Dalang bernama "Buka panggung" (`g d`).
- `src/src/app.css` — `.hn-nav-group`, `.hn-nav-group-label` (disembunyikan di rail tablet, diganti garis
  pemisah), dan `.hn-section-tabs`. Kelas `.hn-shell-workspace` dihapus bersama eyebrow "Workspace".

Tes:

- `src/src/nav-hubs.test.ts` — delapan hub dan tiga grup; setiap section `HN_NAV` dimiliki sebuah hub atau
  tercatat palet-saja (**tak ada section yatim**); satu section hanya punya satu hub; gerbang tab sama dengan
  gerbang `HN_NAV`; `default` tak bergerbang; `hubTarget` (riwayat, gerbang, fallback); `hubBadge`.
- `src/test/nav-hub.test.tsx` — `SectionTabs` (tab terpilih, turunan, klik, tab induk dari detail project,
  gerbang, badge, tanpa bar); `Shell` (crumb, riwayat tab bertahan lewat pemasangan ulang, fallback gerbang).
- `src/test/hub-nav-app.test.tsx` — App utuh: delapan hub di sidebar; `/prd` membuka tab PRD tanpa mengubah
  URL; klik tab memindahkan URL ke `/team`; klik hub kembali ke tab terakhir; palet "Buka panggung" → `/dalang`.
- `src/test/responsive-shell-modal.test.tsx` — drawer memuat delapan hub dan tiga grup; tab bergerbang tak
  pernah jadi tombol sidebar (hub Sesi tetap ada).
- `src/test/nav-pending-badge.test.tsx` — badge hub = antrean tab-tabnya (PRD di Projects, Lead di Otonom).
- `src/src/palette/commands.test.ts` dan `shortcuts.test.ts` — "Buka panggung" membuka Dalang dan terbaca di
  bantuan shortcut.

Overview kini punya tombol "Buka panggung" (lihat Fase 3B di bawah).

## Audit UI/UX 2026-10 · Fase 3E · Terminal: rail sesi dan mode fokus

Fase 3E dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md): default layar
Terminal berpindah dari grid ke **Fokus**, yaitu satu pane terminal dengan rail sesi di sampingnya. Grid tetap
ada sebagai mode opsional (toggle **Fokus | Grid**) dan memakai workspace kanonik
[ADR-0118](../adr/0118-workspace-terminal-kanonik-per-user.md) tanpa perubahan. Mode tampilan adalah state
presentasional per browser ([ADR-0115](../adr/0115-state-tampilan-dashboard-persisten.md)). Tidak ada API baru,
jadi tak ada keputusan MCP baru ([ADR-0202](../adr/0202-keputusan-mcp-wajib-untuk-setiap-api-baru.md)). Keputusan
layar ini dicatat di [ADR-0209](../adr/0209-terminal-rail-sesi-fokus-default.md). Pola interaksinya ada di [design-system](../design-system/design-system.md).

Berkas:

- `src/src/screens/terminal-rail.ts` — murni (tanpa React): `railStatus` (Menunggu keputusan · Lead memutuskan ·
  Berjalan · Gagal · exit N · Selesai), `sortRail` (butuh keputusan → berjalan → gagal → selesai; di grup
  "butuh keputusan" yang paling lama menunggu tampil dulu), `resolveFocus` (`focusId` bila masih hidup, selain
  itu baris pertama), `railTarget` (↑/↓ tanpa berputar, Home/End), `railStartedMs` (`startedAt` server dalam
  detik epoch; 0 = tak diketahui), dan `isTerminalView` (`focus` | `grid`).
- `src/src/screens/TerminalRail.tsx` — `SessionRail`: `ul` daftar sesi. Tiap baris = tombol fokus (roving
  tabindex, `aria-current`) + `StatusPill` dot + waktu relatif (`relativeTime`, diperbarui tiap 30 dtk) + menu ⋯
  `OverflowActions` ("Aksi sesi <id> di daftar"). Aksi tak pernah di dalam tombol klik.
- `src/src/screens/TerminalScreen.tsx` — `view` (ui-state `terminal.view`, default `focus`), `focusId` (lokal,
  tak dipersist), `finishedIds` (verdict plan dari pane, SPEC-433), `sessionMenuItems` (satu sumber menu ⋯ untuk
  sel grid, baris rail, dan kepala pane fokus), `SessionDialogs` (dialog dokumen dan integrasi dipegang layar,
  jadi tetap terbuka walau drawer mobile menutup), `OpenMenu` ("Buka…"), dan `FocusView` (rail, kepala pane,
  banner Berakhir, strip fase, satu `TerminalPane`).
- `src/src/screens/styles/terminal.css` — kelas `hn-terminal-*`: toolbar, toggle segmen, rail, pane fokus, dock,
  dan pemicu laci mobile. Diimpor dari `TerminalScreen.tsx`; `app.css` tidak disentuh.
- `src/src/screens/TerminalPane.tsx` — prop opsional `composer` (pane fokus selalu menampilkan composer).
  Composer, dikte, dan papan tombol kini dibungkus `.hn-terminal-dock`; grid tetap memakai perilaku lama.
- `src/src/screens/NewTerminalModal.tsx` — pemilih project (`projects`, `onProjectChange`) pindah ke "Sesi baru".
  Toolbar tak lagi memuat pemilih project; "Terminal biasa" memakai project yang terakhir dipilih.

Toolbar (≤ 6 kontrol): **Sesi baru** (primer) · **Buka…** (Ambil backlog, Riwayat sesi, Terminal biasa) ·
toggle **Fokus | Grid** · **Tampilan** (font, papan tombol, ketik responsif; Diagnostik tetap tertutup; Reset grid
hanya di mode grid) · **Layar penuh**. Baris grid (mode grid saja): tab grup, `+ Kolom`, dan `+ Baris`. Di sempit,
ketiga aksi susunan itu masuk menu **Atur grid**.

**Ponsel (<768px, QA Fase 3E+).** Toolbar tetap satu baris: **Sesi baru** · **Buka…** (ikon ber-label `Buka…`,
nama aksesibelnya sama, tak ada teks yang terpotong) · **Sesi · N** (laci rail, hanya mode Fokus) ·
**⋯ Menu terminal** (Pakai mode Grid/Fokus, Layar penuh, Tampilan terminal yang dibuka sebagai sheet). Kepala pane
satu baris: nama, status, ⋯; tanpa tombol Sesi. Strip fase memakai `PhaseStrip compact`. Dock pane fokus
ringkas: composer satu baris (mic · kolom · **Kirim**), lalu baris **Tombol khusus** (mengalihkan papan tombol) ·
galat dikte · **⋯ Opsi dikte suara** (bahasa dan keterangan audio). Papan tombol **tertutup** secara default di
ponsel; pilihan tersimpan di `hn.ui.v1.terminal.keys` dan tetap menang. Tablet sentuh tetap terbuka seperti dulu.
Tinggi pane dijaga `min-height: calc(55dvh + 168px)` (`terminal.css`, `@media (max-width: 767px)`): xterm
≥ ~55% viewport dalam keadaan default; papan tombol terbuka mengurangi sekitar 52 px lagi. Tablet dan desktop
tetap memakai toolbar dan dock lama. Jsdom tak mengukur tinggi, jadi kontrak CSS-nya diikat di
`test/terminal-css-contract.test.ts`; angka nyatanya milik verifikasi visual 390×844.

Perilaku:

- Mode dipersist per browser. Pengguna yang memakai grid bisa kembali dengan satu klik, dan nilai rusak di
  storage jatuh ke Fokus.
- Pane fokus memasang satu `TerminalPane`, jadi satu sesi tetap satu attach tmux. Layar penuh per sesi
  (`fullId`) menampilkan placeholder di pane fokus, sama seperti sel grid.
- Deep link (`focusSession` dari notifikasi atau palet), sesi baru, ambil backlog, dan riwayat membuka sesi itu
  di fokus DAN menempatkannya di grid, sehingga mode grid tetap utuh.
- "Tutup" dari rail atau pane fokus selalu lewat `useConfirm` dan menyebut nama sesinya. Sel grid tetap punya
  tombol × sendiri.
- Mobile (<768px): rail menjadi laci (`Modal`), dibuka dari tombol "Sesi · N" di kepala pane. Memilih sesi di
  laci menutupnya dan membuka sesi itu.
- Keterbatasan: "Selesai" karena plan tuntas hanya diketahui untuk sesi yang pernah dibuka di pane (verdict
  dari frame phase). Sesi lain tampil "Berjalan" sampai dibuka. "Putus" (hasil rekonsiliasi boot) hanya ada di
  riwayat, bukan di daftar hidup.

Tes:

- `src/test/terminal-rail.test.ts` — urutan rail, status, fallback fokus, navigasi keyboard, `startedAt`, dan
  validasi mode.
- `src/test/terminal-focus.test.tsx` — default Fokus (satu pane), urutan rail, panah/Home/End, klik baris, kill
  lewat menu (Batal tak mematikan; Tutup dikonfirmasi), deep link fokus, toggle Grid bertahan lintas mount, nilai
  rusak, toolbar ≤ 6 kontrol, dan laci mobile. Ponsel: toolbar satu baris, isi ⋯, kepala pane tanpa tombol Sesi,
default papan tombol tertutup dan tablet tetap terbuka (`terminal-focus`). `terminal-pane` menguji dock ringkas
(Kirim, Tombol khusus, mic di baris composer, bahasa di ⋯). `terminal-css-contract` mengikat aturan CSS yang tak
terukur jsdom.
- Suite terminal yang menguji komposisi grid (`terminal-screen`, `terminal-screen-memo`, `terminal-cleanups`) memasang
  `hn.ui.v1.terminal.view = "grid"`. Pembukaan Ambil backlog, Riwayat, dan Terminal biasa kini lewat "Buka…".

## Audit UI/UX 2026-10 · Fase 2E · Pembersihan CSS

Pembersihan setelah redesign Fase 3: kelas yang tak lagi dirender dihapus, `!important` yang penyebabnya sudah
hilang dicabut, dan font tak lagi memblokir render. Perilaku dan tampilan layar yang masih dipakai tidak berubah.

- **Dihapus:** `screens/DalangStage.tsx` beserta `test/dalang-stage.test.tsx`. Hero-nya tak dirender layar mana pun.
  `WayangSilhouette` pindah ke `screens/WayangSilhouette.tsx` (satu-satunya ekspor yang dipakai, oleh
  `DalangHanomanScreen`; impor di sana hanya baris yang berubah).
- **Kelas `.hn-*` mati** (nol pemakai di TSX/TS/tes, termasuk yang dibentuk dinamis) dicabut dari `app.css`:
  `.hn-dalang*` seluruhnya; `.hn-dlg-*` lama (HUD, KPI, donut, rig, grafik, footer, chip, kartu project,
  benang, scan); `.hn-backlog-*`, `.hn-team-*` (toolbar), `.hn-project-header|row|open`, `.hn-vps-row|main|actions|pills|sep`,
  `.hn-stat-grid`, `.hn-card-footer`, `.hn-wrap-mobile`, dan `.hn-portal-toolbar` (sudah tak dipakai `ClientPortal`).
  Keyframes tanpa rujukan ikut dicabut: `hn-dalang-flow`, `hn-dalang-sway`, `hn-dlg-blink|rot|rotr|scan|arm-a|arm-b|float|ping`,
  `hn-toast-in`. Aturan yang campur kelas mati dan hidup dipangkas hanya di bagian yang mati.
- **Dipertahankan (hidup):** `.hn-dlg`, `.hn-dlg-top|title|exit|empty|rt|dot` di `app.css` (dipakai
  `DalangHanomanScreen`; `dalang.css` menimpa sebagian, dan kedua aturan tetap berlaku sesuai urutan kaskade).
  Kelas dinamis (`hn-skeleton-r-*`, `hn-responsive-panels--*`, `hn-terminal-gutter--*`, dan sejenisnya) tetap.
- **`!important`: 45 → 30 deklarasi** (teks 47 → 32 termasuk dua di komentar). Yang tersisa, dengan penyebab yang
  sudah diperiksa satu per satu:
  - `.hn-viewport-popover` (4): menimpa `position`/`width`/`max-height` inline di AccountMenu, LimitIndicator,
    UpdateIndicator, dan NotificationBell.
  - `.hn-modal-*` (7): menimpa `alignItems`, `width`/`maxWidth`/`maxHeight`/`borderRadius`, dan `padding` inline di
    `ds/kit.tsx`.
  - `.hn-grid-mobile`, `.hn-stack-mobile`, `.hn-dense-row` (3): `gridTemplateColumns` inline di App.tsx dan
    ReconcileModal; `alignItems` inline di TerminalScreen dan SessionHistoryModal.
  - `.hn-picker-row > .hn-picker-title` (4): `flex`, `minWidth`, `whiteSpace`, dan `overflow` inline.
  - `.hn-portal-header|content|row` (4): `height` dan `padding` inline di `portal/ClientPortal.tsx`. Portal sedang
    digarap agen lain, jadi aturan ini tak disentuh.
  - `.hn-setting-row` dan dua aturan `.hn-setting-control` (3): `.hn-set-row` di `screens/styles/settings.css` memakai
    `align-items: center` dan dimuat setelah `app.css`. Dua aturan kontrol belum diverifikasi per elemen, jadi dibiarkan.
  - `.hn-touch-target` dan `[role="button"][tabindex="0"]` (2): `minWidth: 28`/`height: 28` inline pada tombol ikon di
    `ds/kit.tsx`.
  - Reduced motion `*` (3): selektor universal kalah spesifisitas, dan `ds/kit.tsx` memberi `animation` inline
    pada modal.
  Menurunkan angka ini lebih jauh berarti memindahkan layout inline tersebut ke kelas (Fase 2 yang belum selesai).
- **Font:** `@import` Google Fonts di `ds/tokens/fonts.css` (memblokir render) dipindah ke `index.html`: `<link rel="preload"
  as="style">` yang berpindah ke `rel="stylesheet"` saat tiba, dengan `<noscript>` sebagai cadangan. Offline atau tanpa JS,
  fallback generik keluarga font di `ds/tokens/typography.css` yang berlaku. `preconnect` tetap.
- **Ukuran `app.css`:** 64.956 → 43.102 byte (1.349 → 998 baris). Selektor `.hn-*` unik 236 → 139. Catatan: angka ini berlaku pada `c81413cb`. Tiga commit perbaikan QA Chrome sesudahnya (`56eb30cd`, `82b5dee4`, `cfabc308`) menaikkan berkas itu lagi menjadi 54.105 byte (1.167 baris) di `cfabc308`; basis `8380d3fa` 54.592 byte (lihat § Status pelaksanaan di audit).
- **Tes:** `test/ui-audit-tokens.test.ts` (kontras footer Dalang diganti kontras teks `dalang.css` di atas `--term-bg`;
  asersi chip Dalang diganti "tombol keluar tak disembunyikan di `dalang.css`"; kontrak font non-blocking dan fallback
  generik). `test/responsive-touch-targets.test.ts` (`.hn-project-open` dicabut dari daftar). `ds-css-contract.test.ts`
  tak membaca kelas yang dicabut dan tak berubah.
- **Catatan:** aset `internal/assets/dalang/*.webp` tak lagi diimpor kode (DalangStage pemakai terakhirnya). Berkas
  aset dibiarkan; pembersihannya di luar 2E.

## Audit UI/UX 2026-10 · Fase 3B · Overview "Hari ini" dan Dalang sebagai papan senyap

Fase 3B dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md) untuk dua layar. Keputusan
Dalang: [ADR-0208](../adr/0208-dalang-papan-senyap-pengecualian-gelap.md).
Aturan susunan ada di [design-system](../design-system/design-system.md) (Primitif layout) dan istilah di
[glosarium](glossary.md).

**Overview** (`screens/OverviewScreen.tsx`, `screens/styles/overview.css`) — satu kolom "Hari ini", tanpa KPI
strip dan tanpa hero:

- `PageHeader` "Hari ini" dengan satu kalimat status (`N sesi berjalan · N menunggu jawabanmu · N perlu
  perhatian`, satu hitungan untuk kalimat dan seksi). CTA primer kontekstual: "Jawab sesi yang menunggu" bila
  ada yang menunggu, selain itu "Buka backlog". "Buka panggung" sekunder (`onGoto("dalang")`).
- Sesi berjalan: `RowList`, yang menunggu di atas dengan tombol "Jawab". Baris membuka sesinya. Durasi
  ditulis "dimulai N menit lalu" lewat `relativeTime` (tak ada formatter durasi di `lib/`).
- Perlu perhatian: dokumen rusak/drift, label dari `DOC_STATUS_LABEL`.
- Project: nama, cakupan (`ProgressBar` + persentase), status, dan `ProjectView.backlog` sebagai "N item
  terbuka". Footer satu baris "Backlog: N dari brief · N dari QA · N prioritas tinggi" menggantikan kartu KPI.
- Aktivitas terbaru: maks 5 baris klik. Limit langganan: satu seksi bertab Claude/Codex (tetap).
- Tanpa project: kartu "Selamat datang" dengan "Buat project pertama"; ilustrasi kecil PST-001 hanya di sini.
- Judul seksi `<h3>` (judul `Card` DS adalah div). Layout lewat kelas `hn-ov-*`, tanpa inline grid.
- `DalangStage` tak lagi dirender Overview.

**Dalang Hanoman** (`screens/DalangHanomanScreen.tsx`, `screens/styles/dalang.css`) — dipangkas jadi papan
status senyap. Gelap tetap dipertahankan sebagai **pengecualian terdokumentasi**: satu-satunya layar gelap
penuh, karena seluruh layarnya kerja aktif. Dihapus: HUD berputar, scan line, float, kursor berkedip,
count-up, ticker mengetik, footer slogan, KPI ganda, jam per detik, rig animasi, donut distribusi, grafik
7 hari, dan panel aktivitas. Tersisa:

- Ringkasan satu baris dan status koneksi nyata (`useEventsStatus`: Terhubung, Jeda, atau Koneksi terputus).
- Seksi "Menunggu jawabanmu" di atas, dengan tombol Jawab.
- Daftar project sebagai baris `<button>`: wayang `WayangSilhouette` 24px, nama, fase, sesi, dan aksi.
- Jalan keluar 44×44 di semua ukuran layar, di `.hn-dlg-actions` (bukan di `.hn-dlg-chips`).
- Tanpa timer dan tanpa animasi. Pet **tidak** dirender di layar ini: Dalang berada di luar `Shell`, sehingga tak punya
  slot pet (lihat [ADR-0206](../adr/0206-pet-footer-sidebar-default-per-tier.md) § 5). Koreksi atas teks Fase 3B sebelumnya
  yang menyebut pet tetap bergerak di sini.

Kelas `.hn-dlg-*` lama yang tak lagi dirender sudah dicabut di Fase 2E (lihat § Fase 2E). `dalang.css` menimpa
kelas yang masih dipakai.

**DalangStage** (`screens/DalangStage.tsx`) sudah dihapus di Fase 2E. Layar Dalang memakai `WayangSilhouette`
dari `screens/WayangSilhouette.tsx`.

Tes: `src/test/overview-screen.test.tsx` (kalimat status, CTA kontekstual, urutan sesi, aktivitas maks 5,
kontrak tanpa inline grid), `src/test/dalang-hanoman.test.tsx` (ringkasan, seksi menunggu, tiap project sekali,
status koneksi, papan senyap tanpa animasi dan timer), dan `src/test/responsive-no-squeeze.test.tsx` (baris
Overview memakai `DenseRow`).

## Audit UI/UX 2026-10 · Fase 3 · IDE "Perubahan dulu" (3H)

Fase 3H dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md): IDE dibuka pada
tab **Perubahan**, bukan pada pohon berkas. Tanpa endpoint baru, jadi tak ada keputusan MCP baru
(aturan #7 AGENTS.md tak tersentuh). Berkas: `screens/IdeScreen.tsx` (shell, toolbar, Perubahan, Berkas),
`screens/CabangPanel.tsx` (menggantikan `BranchesPanel` + `WorktreesPanel`), `screens/GitGraph.tsx`
(Riwayat), `screens/file-tree.tsx` (pohon + menu konteks), `screens/ide-menu.tsx` (menu konteks bersama),
dan `screens/styles/ide.css` (layout yang dipindah dari inline; `app.css` tak disentuh).

Susunan layar:

- **Tab** (`Tabs` DS, label tab "Bagian IDE", tersimpan per project di `hn.ui.v1.ide@<project>.tab`):
  Perubahan (default, dengan jumlah perubahan) · Riwayat · Cabang · Berkas. Jalur lama tetap membuka tempat
  yang sama: `explorer` → Berkas, `graph` → Riwayat, `branches`/`worktrees` → Cabang (`LEGACY_TAB`). Nilai
  tak dikenal jatuh ke Perubahan. Buka berkas dari commit atau dari baris uncommitted pindah ke Berkas.
- **Toolbar atas** (≤ 6 kontrol): proyek, ref, Fetch, Tersembunyi, Muat ulang, ⋯. Checkout ref dan Kelola
  remote ada di ⋯ (`OverflowActions`).
- **Perubahan**: daftar Staged dan Changed sebagai `RowList` dengan badge M/A/D dan legenda. Pilih berkas →
  diff di panel kanan. Satu aksi primer **Commit dari Terminal** (`onGotoTerminal`, nonaktif bila host tak
  memberi handler). Commit tulis belum punya endpoint di klien API, jadi aksinya membawa ke sesi Terminal.
- **Riwayat**: git graph. Lane SVG `aria-hidden`; baris `role="listitem"` di dalam `role="list"`; merge diberi
  teks "merge". Menu commit dikelompokkan **Navigasi** (checkout, salin, bandingkan) · **Cabang & tag** (merge,
  rebase, branch, tag, hapus branch) · **Lanjutan** (cherry-pick, revert, reset, drop) — reset hard dan drop
  tetap lewat dialog dampak dan ada di grup paling bawah. Remote, tag, redupkan merge, dan gaya ada di
  disclosure **Tampilan**. Menu branch menaut **Kelola di tab Cabang**.
- **Cabang**: branch dan worktree dalam **satu daftar**. Worktree tampil sebagai barisnya dengan branch-nya;
  branch tanpa worktree tampil sebagai baris sendiri. Filter status dan cari di bar; base, cakupan, dan
  "Hapus branch worktree juga" di disclosure **Opsi**. Pembersihan (per baris atau massal) menulis dampaknya
  di satu dialog: sesi yang ditutup, commit yang hilang, berkas kotor, branch ikut. Branch belum ter-merge
  menuntut ketikan ulang (nama branch, atau `hapus paksa` bila batch) sesuai ADR-0121. Satu-satunya tempat
  hapus branch utama adalah tab ini; menu commit hanya menautkan ke sini.
- **Berkas**: satu baris kontrol (Berkas baru · Unggah · ⋯ berisi Folder baru dan Unggah folder · label tujuan
  `→ folder`). Aksi per entri pindah ke **menu konteks baris pohon**: klik-kanan, tombol ⋯ untuk pointer, atau
  tombol Menu / Shift+F10 saat baris difokus. Isi menu: Berkas baru di folder itu, Folder baru (folder saja),
  Ganti nama…, Hapus berkas/folder…. Guard draft Fase 1 dan konfirmasi hapus ber-`requireText` untuk folder tetap.
- **Pemisah panel berkas**: `role="separator"` antara pohon dan isi (tablet/desktop; di mobile tak dirender).
  Keyboard: ←/→ 16 px, Shift+←/→ 48 px, Home/End ke batas. Pointer: seret. Lebar 220–560 px tersimpan di
  `treeW` dan diteruskan ke `ResponsivePanels` sebagai `masterWidth`.

Keputusan:

- Satu seleksi dipakai dua tab (`selKind`): `"file"` tampil di Berkas, staged/unstaged tampil di Perubahan.
  Pindah tab tak membawa diff ke Berkas (dan sebaliknya).
- Tombol ⋯ pada baris pohon `aria-hidden` dan di luar tab order: ia jalan pointer. Jalur keyboard-nya tombol
  Menu/Shift+F10 pada `treeitem` itu sendiri, supaya tak ada tombol bersarang di dalam treeitem.
- `Menu` dipindah dari `GitGraph.tsx` ke `ide-menu.tsx` dan kini mendukung grup (`MenuItem.group`). Fokus, panah,
  Home/End, Escape, dan klik-luar tetap seperti sebelumnya.
- Pane yang diuji kontrak scroll-chain (SPEC-393) tetap memakai gaya inline `flex`/`min-height`/`overflow`.
- `IdeReadPanel` (dipakai Klien): galat memuat riwayat tampil sebagai galat, bukan "Tak ada commit".

Pengujian: `ide-tabs.test.tsx` (tab default, jalur lama, toolbar ≤ 6, Commit, RowList M/A/D, role list Riwayat,
pemisah keyboard), `cabang-panel.test.tsx` (mewarisi suite BranchesPanel dan WorktreesPanel), dan
`git-graph-menu.test.tsx` (grup menu, Kelola di tab Cabang). Asersi lama yang menegaskan Explorer sebagai
tab default, tombol toolbar Hapus/Ganti nama, dan tab "Git Graph" / "Branches" / "Worktrees" diperbarui ke
bentuk baru di `ide-screen`, `ide-file-ops`, `ide-hidden-toggle`, `ide-edit-guard`, `ide-responsive`, dan tiga
tes di luar folder IDE (`doc-download-screens`, `preview-fill-height`, `scroll-chain`).

Belum diverifikasi: tampilan di 390/820/1100 px (jsdom tanpa layout; pemisah bertumpu pada celah grid
`ResponsivePanels`) dan commit dari UI. Commit tulis butuh endpoint dan keputusan MCP sendiri (ADR-0202).

**QA Fase 4 · kepala IDE (toolbar, fokus, sentuh).** Tiga temuan dari audit visual 390/820/1280 px:

- **Toolbar membungkus, tidak lagi menggulir.** `<select>` project memakai lebar intrinsik opsi terpanjang
  (`flex: 0 0 auto` dari app.css), sehingga satu nama project panjang melebarkan toolbar ke 648 px dan
  mendorong selector cabang keluar layar. Override di `screens/styles/ide.css` (selektor `.hn-ide-head >
  .hn-ide-toolbar`, dua kelas, mengalahkan `nowrap` + `overflow-x: auto` di app.css): `.hn-ide-proyek`
  `flex: 1 1 140px` (ponsel: baris penuh), `.hn-ide-ref` `flex: 1 1 140px`, keduanya `min-width: 0` dengan
  `max-width` dan ellipsis; nama project utuh di `title`. Tombol tetap `flex: 0 0 auto`, jadi toolbar tetap
  ≤ 6 kontrol. **Ini membalik keputusan SPEC-879** (toolbar menggulir di barisnya sendiri); aturan `nowrap`
  dan `overflow-x` di app.css belum dihapus (berkas itu di luar lingkup Fase 4).
- **Ring fokus region panel.** `ResponsivePanels` memberi `tabIndex=-1` pada setiap panel. Di mode split
  ring UA biru menggambar kotak di sekeliling panel Perubahan. Kini `:focus` tanpa outline, dan
  `:focus-visible` di mode selector memakai `--border-focus` (brass-600).
- **Target sentuh toggle diff/source (dan Preview/Source).** Tinggi 22 px → `min-height: 24px` (WCAG 2.5.8),
  44 px di `(pointer: coarse), (max-width: 767px)`, dan kelas `hn-touch-target` di JSX.

Belum diverifikasi visual ulang di Chrome: wrap toolbar di 390/820/1280 (jumlah baris kontrol di ponsel
diperkirakan tiga) dan ellipsis `<select>` di Chrome, Safari, dan Firefox.

## Audit UI/UX 2026-10 · Fase 3I · Scheduler (tab hub Otonom)

Fase 3I dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md): layar Scheduler
sebagai tab "Scheduler" di hub Otonom (ADR-0205). Tanpa perubahan API, jadi tak ada keputusan MCP baru.
Server sudah memberi `serverTimeZone` dan requeue baris gagal lewat ADR-0204.

Susunan layar:

- **Strip status** satu baris di atas tab: state (`StatusPill` titik: Berjalan / Dijeda / Berhenti),
  kapasitas `ProgressBar` "N dari M sesi", limit ringkas (`LimitBadge`, `CodexLimitBadge`), status koneksi
  live, lalu Jeda/Lanjutkan (atau Aktifkan). **Hentikan** berdiri sendiri setelah garis pemisah, `variant="danger"`,
  dan selalu lewat `useConfirm` dengan daftar dampak.
- **Antre** (`QueueSection` status `queued`): `DenseRow` dengan Batalkan.
- **Berjalan**: `state.sessions` sebagai `RowList`, dengan Buka terminal dan penanda "menunggu kamu".
- **Riwayat**: chip Selesai · Gagal · Dibatalkan. Chip hanya untuk status yang berisi, dan awalnya memilih
  Gagal, lalu Selesai, lalu Dibatalkan. Aksi per status: Buka review dan Salin, Antre ulang, atau Antre lagi.
- **Cron**: `SchedulerCrons` berupa tabel yang menjadi kartu di mobile (satu markup, CSS yang mengubah
  susunannya). Setiap cron punya menu ⋯ (Ubah · Jalankan sekarang · Riwayat · Hapus lewat konfirmasi).
  Form memakai dua tab: **Dasar** (nama, jadwal, prompt, aktif) dan **Lanjutan** (runtime, model, effort).
- **Setelan**: bahasa biasa dengan draft dan "Simpan setelan" (pola Fase 1G). Kelompok: Sesi, Peluncuran
  (dengan status pemeriksaan saat ini), Sumber otomatis, Project yang diizinkan, lalu Orkestrasi.
- **Orkestrasi** di Setelan: `OrchestrationPanel variant="accordion"`, satu baris per flow yang bisa dibuka,
  tertutup secara default. Tiap perubahan tersimpan langsung lewat `PUT /settings` dengan rebase ke DB terbaru.

Tab kosong hanya menampilkan satu baris keterangan dan tak memakan ruang. Angka di tab muncul hanya bila
lebih dari nol. Semua muat awal memakai `SkeletonList`. Galat muat tetap tampil sebagai galat dengan Coba lagi.

Zona waktu (ADR-0204): instan dari server (jalan berikutnya, terakhir, riwayat) ditampilkan lewat `fmtAt`
dalam `serverTimeZone`, dan tab Cron menyebut zonanya. Preview "jalan berikutnya" di form memakai
`nextRunFor(expr, now, serverTimeZone)` (ADR-0212), jadi tampil dalam zona server walau zona browser berbeda.
Tanpa keterbatasan zona lagi; `nextRunFor` tanpa `tz` tetap zona lokal proses.

Keadaan tab: tab aktif bertahan di ui-state `scheduler.tab`, dan pilihan chip di `scheduler.riwayatStatus`.
Riwayat dan Cron baru dimount saat tabnya dibuka (muat antrean dan daftar cron on-demand). Antre, Berjalan,
dan Setelan selalu termount, supaya draft Setelan tak hilang saat pindah tab.

Copy yang berubah (glosarium): "Batas sesi berjalan" → **Batas sesi bersamaan**; "Pemeriksaan sebelum
peluncuran" (saklar) → **Tahan peluncuran saat server sibuk**; tab "Antrean" → **Antre**; "sesi hidup" →
**N dari M sesi**. Pesan kosong "tak ada" diganti "Tidak ada".

Berkas:

- `src/src/screens/SchedulerScreen.tsx`: strip, lima tab, `QueueSection`, `HistoryPanel`, `SettingsPanel`,
  `OptInPanel`, `OrchestrationSection`, dan `useSettingsSnapshot` (baca dan tulis orkestrasi).
- `src/src/screens/SchedulerCrons.tsx`: tabel/kartu, menu ⋯, form dua tab, dan prop opsional `timeZone`.
- `src/src/screens/OrchestrationPanel.tsx`: varian `accordion` (opsional). Varian default `cards` tetap dipakai
  Settings tanpa perubahan. `FlowBody` dipakai bersama kedua varian.
- `src/src/screens/sched-lead-shared.tsx`: `fmtAt` dan `browserTimeZone`. `InlineError` memakai kelas
  `hn-sched-error` (dipakai LeadScreen juga).
- `src/src/screens/styles/scheduler.css`: gaya layar ini. Diimpor dari keempat berkas di atas. `app.css` tak disentuh.
- `src/src/App.tsx`: tidak berubah. Props `SchedulerScreen` sama, dan tak ada prop baru yang dibutuhkan.

Tes:

- `src/test/scheduler-screen.test.tsx`: tab, chip riwayat, kontrol (Jeda, Hentikan, Simpan), orkestrasi accordion,
  galat, dan pembatalan.
- `src/test/scheduler-live.test.tsx`: langganan lazy (Antre saat mount, Riwayat saat dibuka) dan frame live.
- `src/test/scheduler-queue-pager.test.tsx`: pager per status.
- `src/src/screens/SchedulerCrons.test.tsx`: menu ⋯, form dua tab, zona server, dan preview.
- `src/test/orchestration-panel.test.tsx`: varian accordion dan varian kartu (Settings).
- `src/test/sched-lead-shared.test.tsx`: `fmtAt` (zona, tanggal kosong, zona tak dikenal).
- Penjaga: `glossary-guard`, `placeholder-contract`, `no-silent-catch`, dan `confirm-inventory`.

## Audit UI/UX 2026-10 · Fase 3F · Triase & Lead (kotak masuk keputusan)

Fase 3F dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md). Usulan dan aturannya
ada di [audit § Triase & Lead](ui-ux-audit-2026-10.md) dan [aturan minimalis](ui-ux-audit-2026-10.md#3-aturan-minimalis-hanoman-usulan).
Istilah tampil mengikuti [glosarium](glossary.md). Kelas layout di `screens/styles/triage.css` (`hn-triage-*`) dan
`screens/styles/lead.css` (`hn-lead-*`), keduanya diimpor dari komponen; `app.css` tak disentuh.

Berkas:

- `src/src/screens/TriageScreen.tsx` — satu daftar gabungan tiket Help Center dan issue GitHub (tanpa tab).
  Tipe `Row` menyatukan keduanya dengan kunci `t:<id>` / `i:<id>`. Segmented status `Belum ditinjau (N) · Diterima ·
  Ditutup` menggantikan select status. `InboxRow`: titik status (`StatusPill` dot), judul, meta satu baris, checkbox
  untuk yang belum ditinjau, dan Terima/Tolak inline. `TicketDetailView` dan `IssueDetailView` memakai decision bar
  sticky (`.hn-triage-decision`); aksi lain di `OverflowActions`. `CombinedPager` untuk footer dua sumber.
- `src/src/screens/LeadScreen.tsx` — satu kalimat status, `RadioGroup` mode Aktif/Jeda/Mati, kolom utama "Menunggu
  kamu" (`WaitingCard`) dan timeline riwayat (`DecisionItem`, `FlowItem`), kolom samping dengan callout keamanan,
  lipatan "Project yang dipimpin", dan lipatan "Pengaturan lead" (draft lokal + Simpan pengaturan).

Perilaku Triase:

- Penyaring: pencarian `Cari tiket` dan popover "Filter" (Project, Sumber: Semua sumber / Help Center / GitHub),
  chip aktif, dan "Hapus semua filter". Status selalu satu pilihan (default "Belum ditinjau").
- Issue GitHub hanya dimuat bila satu project dipilih (satu repo). "Tarik issue" tampil di baris status saat ada
  project dan sumber bukan Help Center. Sumber GitHub tanpa project menyatakan "Pilih satu project".
- Tolak tiket langsung tanpa dialog, lalu toast "Urungkan" 6 dtk yang memanggil `PATCH /tickets/:id` dengan
  `{ status: "new" }`. Tolak issue GitHub dan Tolak terpilih tetap lewat konfirmasi: tak ada endpoint ubah status
  untuk issue (`unlink` melepas tautan, bukan membuka kembali), jadi tak ada "Urungkan" untuk issue.
- Terima pada baris dan lewat keyboard tetap di kotak masuk (toast "Diterima → SPEC-n"). Terima pada detail membawa
  ke backlog seperti sebelumnya (`onAccepted` dari App).
- Aksi massal: Terima terpilih (tiket: `acceptTicket` per id, prioritas sedang; issue: `acceptGithubIssues`) dan
  Tolak terpilih dengan konfirmasi yang memuat daftar nama item.
- Keyboard: J/K pindah baris (membuka detail), A terima, R tolak, Esc tutup detail. Pintasan aktif hanya saat fokus
  ada di layar ini dan bukan di kolom isian atau dialog.
- Menu ⋯ detail: Edit, Buka status publik, Salin link publik, Salin link backlog, Lepas tautan, Hapus.
  Lampiran tampil di disclosure "Lampiran (n)".
- Pagination: satu sumber memakai pager eksak. Dua sumber memakai footer "Halaman N dari M" karena kedua sumber
  dipaginasi pada nomor halaman yang sama dan totalnya tak bisa dijumlah secara bermakna.
- Pencarian: tiket disaring server; issue disaring di klien pada halaman yang dimuat.
- Realtime tiket: langganan `tickets` dengan params status/project/q/page. Status default `new` ikut dalam kunci.

Perilaku Lead:

- Kalimat status: "Lead {aktif|dijeda|mati} · N menunggu kamu · N antre". Mode Aktif/Jeda langsung menulis
  `enabled`/`paused`; Mati minta konfirmasi yang menyebut efeknya.
- "Menunggu kamu": kartu per sesi. Untuk sesi yang bisa dijawab, pertanyaannya dibaca lewat
  `GET /terminal/sessions/:id/dialog` (`api.sessionDialog`) dan opsi tunggal jadi tombol sekali klik
  (`POST …/dialog/answer`); opsi jamak jadi checkbox + "Kirim pilihan". Jika dialog tak bisa dibaca, kartu menyatakan
  "Jawab di Terminal". Nama sesi: project · spec dari antrean scheduler, lalu dari jejak keputusan.
- Riwayat: satu timeline keputusan dan rangkaian dengan chip Semua / Keputusan / Rangkaian, dan penyaring project
  di popover "Project". Pager eksak per jenis; "Semua" memakai footer halaman gabungan (`decPage` dan `flowPage`
  disinkronkan saat berpindah halaman di mode itu).
- Ubah jawaban: pilihan (radio untuk tunggal, checkbox untuk jamak) dan isian, lalu "Kirim jawaban" membuka
  konfirmasi yang menyebut jawaban sekarang dan jawaban baru. Draft tetap utuh bila server menolak.
- Kolom samping: callout "Dikunci secara teknis" (produksi, VPS, dan penghapusan data), lipatan "Project yang
  dipimpin · N dari M diurus lead" (opt-in dan jeda per project), dan lipatan "Pengaturan lead" (interval, batas
  waktu, batas jawaban otomatis, syarat integrasi, baris model lead). Pengaturan memakai draft lokal dengan
  "Simpan pengaturan" dan "Batal"; simpan yang tak mengubah nilai tak menulis apa pun.

Kontrak: prop `TriageScreen` (`projects`, `onAccepted`, `onToast`) dan `LeadScreen` (`projects`,
`onProjectChanged`, `onToast`, `onGotoTerminal`) tak berubah, jadi `App.tsx` tak perlu diedit. `GithubIssuesPanel`
tak lagi diekspor: panel tab sudah digantikan daftar gabungan.

Keputusan:

- Menu detail memakai "Edit", bukan "Ubah" (glosarium: *Ubah isi* → Edit). "Ubah jawaban" tetap; itu frasa lead.
- Tidak ada aksi "Tautkan" di menu ⋯: belum ada endpoint untuk menautkan tiket ke spec yang sudah ada. "Lepas tautan" tetap.
- Tolak issue GitHub tak punya "Urungkan" (lihat di atas).

Tes:

- `src/test/triage.test.tsx`, `triage-github.test.tsx`, `github-issues-pager.test.tsx`, `triage-live.test.tsx`,
  `triage-pager.test.tsx`, `triage-state-persist.test.tsx`.
- `src/test/lead-screen.test.tsx`, `lead-live.test.tsx`, `lead-pager.test.tsx`, `scheduler-lead-state-persist.test.tsx`.
- Guard: `glossary-guard`, `no-silent-catch`, `placeholder-contract`, `confirm-inventory`.

## Audit UI/UX 2026-10 · Fase 3 · Klien & VPS (3G · 3J)

Fase 3G (Klien) dan 3J (VPS) dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md).
Aturan layar mengikuti [audit § Klien dan VPS](ui-ux-audit-2026-10.md#2-per-layar) dan
[glosarium](glossary.md). Selektor tingkat memetakan ke grant `PUT /remote-control` yang sudah ada (keputusan di
[ADR-0210](../adr/0210-perangkat-tingkat-akses-lihat-kerja-tulis.md)). Grant per perangkat remote: opsi D (tingkat yang
dilaporkan, baca-saja) dan opsi C (**permintaan tingkat dengan persetujuan lokal**, [ADR-0217](../adr/0217-permintaan-tingkat-akses-perangkat-remote-disetujui-lokal.md),
dari keputusan [ADR-0216](../adr/0216-grant-per-perangkat-remote-diusulkan.md)). Pemetaan tingkat ↔ grant kini satu sumber: `REQUEST_TIER_GRANTS` di `shared`.

Berkas:

- `src/src/screens/remote-access-tier.ts` — murni: tingkat Lihat/Kerja/Tulis ↔ grant (`TIER_GRANTS`, diambil dari
  `REQUEST_TIER_GRANTS` di `shared`), `tierOf` (termasuk `khusus` dan `kosong`), `grantDiff`, `needsConfirm`, dan kalimat dampak per grant.
- `src/src/screens/access-request.ts` — murni (ADR-0217): `requestBlockReason` (alasan "Minta tingkat…" mati: offline,
  protokol tak cocok, kendali belum diizinkan), `hostOf` (host dari origin hub), `REQUEST_STATUS_LABEL`.
- `src/src/screens/RemoteControlPanel.tsx` — `RemoteAccessSection` (master + selektor tingkat, konfirmasi naik
  dan turun), `AccessRequestsApproval` (ADR-0217: bagian "Permintaan dari server pusat" di dalam `RemoteAccessCard`;
  hanya permintaan `pending`; Setujui lewat `useConfirm` yang menyebut dampak tiap grant dan nonaktif bila master
  mati; Setujui mengirim `{tier, from}` dari kartu, dan 409 (kartu basi) memuat ulang daftar dengan pesan
  "Permintaan berubah, periksa lagi"; Tolak langsung; dimuat ulang saat jendela fokus, tanpa polling), `RemoteAccessCard` (kartu izin di tab
  Perangkat), `RemoteControlPanel` (panel Pengaturan: log, status relay dan riwayat diringkas, rinciannya di `<details>`).
- `src/src/screens/ClientsScreen.tsx` — tab **Perangkat · Akun · Log**. Baris Perangkat = `DenseRow`: nama,
  online/offline (`StatusPill` dot), "N sesi berjalan" / "Tidak ada sesi berjalan", terakhir terlihat, dan satu
  aksi "Lihat (baca saja)". Sesi tanpa SPEC hanya teks. Prop `onToast` opsional. Perangkat remote juga punya
  tombol **Minta tingkat…** (ADR-0217, `AccessRequestPanel`): pilih Lihat/Kerja/Tulis, kirim, lalu status
  permintaan (menunggu persetujuan di perangkat itu · disetujui · ditolak · kedaluwarsa). Tombol mati dengan alasan
  saat offline, protokol tak cocok, atau kendali belum diizinkan. Galat hub (mis. 409 perangkat belum mendukung) tampil `role="alert"`.
  Baris "Tingkat akses" (opsi D, baca-saja) tetap ada.
- `src/src/screens/ClientAccessPanel.tsx` — tab Akun: baris akun = `DenseRow`. Aksi: Nonaktifkan/Aktifkan,
  **Cabut akses** (dikonfirmasi; mengosongkan `projects`), dan **Hapus akun** di menu ⋯ (dikonfirmasi).
- `src/src/screens/RemoteBanner.tsx` — bar brass solid yang menempel (`.kl-banner`): "Nama · Baca-saja · vX ·
  online" dan tombol Keluar.
- `src/src/screens/vps-status.ts` — murni: `vpsSteps` (Terhubung → Diaudit → Diperkuat, masing-masing dengan
  teks), `canApplyRemediation`, `scoreText`.
- `src/src/screens/VpsScreen.tsx` — daftar sebagai `RowList`: nama dan alamat, stepper tiga langkah, skor,
  satu aksi **Periksa** (audit). Menu ⋯ (`OverflowActions`): Tes koneksi, Buka console, Sesi Claude, Edit,
  Harden (danger), Hapus registrasi (danger). Harden dan hapus selalu lewat `useConfirm`. Detail server
  dibuka sebagai modal bertab.
- `src/src/screens/VpsChecklist.tsx` — modal bertab **Ringkasan · Checklist · Pemasangan · Akses**; panel
  tetap ter-mount dan disembunyikan (`TabPanel`), jadi pilihan dan filter tak hilang saat pindah tab.
  Header checklist menempel: skor, dan `FilterBar` (kotak cari tetap terlihat; seksi, mode, status, dan
  severity di popover Filter; filter aktif tampil sebagai chip). Badge hanya untuk item bermasalah. Alur perbaikan tiga langkah:
  **Pilih → Pratinjau → Terapkan**. Terapkan nonaktif sampai pratinjau dibuat untuk pilihan yang sama, dan
  mengubah pilihan membatalkan pratinjau.
- `src/src/screens/styles/clients.css`, `src/src/screens/styles/vps.css` — kelas `kl-*` dan `vps-*`. Ukuran
  dari skala token, jarak dari `--space-N`, warna dari token semantik. Target sentuh 44px pada pointer kasar.

Keputusan:

- **Pemetaan tingkat ↔ grant.** Lihat = `sessions:read`, `backlog:read`, `ide:read`. Kerja = Lihat +
  `backlog:write` + `sessions:spawn`. Tulis = Kerja + `sessions:write`. Kombinasi lain tampil sebagai **Khusus**
  dengan rincian yang dilipat. Tingkat selalu memuat `sessions:read`, karena server menolak grant tulis tanpa
  itu.
- **Konfirmasi.** Naik ke Kerja atau Tulis memakai dialog `danger` dan menyebut apa yang diizinkan. Turun, atau
  grant yang dicabut, memakai dialog biasa yang menyebut "Dicabut: …". Lihat tak bisa dimatikan dari selektor.
  Mematikan kendali lewat master tidak mengubah grant yang tersimpan, sama seperti sebelumnya.
- **Skor kepatuhan di daftar VPS.** Selesai (ADR-0211): `VpsView.scoreTotal` dari snapshot audit tersimpan,
  dibaca langsung dari listing; "Skor —" bila belum pernah diaudit di mesin ini. Checklist yang dimuat
  memuat ulang daftar, jadi N/A/attest yang baru ditandai ikut tampil di baris.
- **Istilah.** Copy memakai glosarium: Terhubung/Diaudit/Diperkuat, Pratinjau, Terapkan, Tandai terpenuhi,
  "Lihat (baca saja)", "Baca-saja". Tak ada "hub", "Device", "basi", atau "retry" di teks tampil.

Tes:

- `src/test/remote-access-tier.test.ts` — pemetaan tingkat, `tierOf`, `grantDiff`, dan konfirmasi.
- `src/test/vps-status.test.ts` — tiga langkah, syarat Terapkan, dan teks skor.
- `src/screens/RemoteControlPanel.test.tsx` — selektor, dialog naik dan turun, Khusus, relay dan riwayat,
  lajur log.
- `src/test/clients-screen.test.tsx`, `client-access-panel.test.tsx`, `remote-instance-view.test.tsx` (banner).
- `src/test/vps-screen.test.tsx`, `vps-checklist.test.tsx`, `vps-apply-confirm.test.tsx`.

Utang yang perlu keputusan di luar berkas ini:

- `App.tsx`: teruskan `onToast` ke `ClientsScreen` (opsional, tanpanya toast akses tak tampil).
- `SettingsScreen.tsx`: tab Akses klien dan Kendali jarak jauh. *Diputuskan di 3C:* keduanya dipertahankan
  sebagai bagian di niat "Integrasi & akses" (lihat [Fase 3C](#audit-uiux-2026-10--fase-3c--pengaturan-empat-niat)).
- `lib/labels.ts`: `MODE_LABEL` (Otomatis/Audit/Info) masih di `VpsChecklist.tsx`; pindahkan ke sana.
- `VpsView`: tambahkan `scoreTotal` ke daftar bila skor perlu tampil tanpa membuka checklist.

## Audit UI/UX 2026-10 · Fase 3 · Backlog & Tim (3D)

Fase 3D dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md). Aturan layar
mengikuti [audit § Backlog · Tim](ui-ux-audit-2026-10.md#2-per-layar) dan [glosarium](glossary.md). **Tidak ada
perubahan API.** Pengelompokan tahap dan lensa dilakukan di klien.

Berkas:

- `src/src/screens/BacklogScreen.tsx` — **daftar** (`RowList`/`DenseRow`) adalah tampilan utama, papan (`Board`)
  tampilan kedua lewat `ViewToggle` (ikon, nama "Daftar"/"Papan"). Segmen tahap = `Tabs` pill dengan hitungan dari
  himpunan yang sama dengan daftar: Semua · Brainstorm (brainstorming, objective) · Spec (spec-ready, planned) ·
  Dikerjakan (executing) · Selesai (done). Baris/kartu: `PrioDot` (titik, bentuk membawa makna), judul, id, asal
  (`SourceTag`, teks meta), pil tahap, dan paling banyak dua lencana (Terblokir, kehadiran). Satu aksi primer
  sadar-tahap (`startLabel`: Mulai/Lanjutkan; "Buka sesi" bila berjalan; "Review perubahan" untuk item selesai),
  sisanya di `OverflowActions`.
- `SpecDetail` alur linier: **Ringkasan** (progres `StageBar`, rincian project/penulis/tanggal/branch asal, prioritas
  diubah langsung) → **CTA "Jalankan"** (semua tahap; "Buka sesi" bila berjalan) → **Review, dokumen, lampiran** →
  **Lanjutan** (`<details>` tertutup: branch, dependency, auto-merge, ubah status, integrasi, type, jejak) →
  **Zona berbahaya** (Hapus, lewat `useConfirm`).
- Penyaring: `FilterBar` = pencarian + popover "Filter" (sumber, project, prioritas, rentang tanggal) + chip aktif +
  Reset. Hanya satu baris utama; tahap di atasnya.
- Urung: perubahan prioritas (hanya selagi `brainstorming` dan belum dimulai) menampilkan toast "Urungkan" lewat
  `useToast` + `ToastHost` milik layar. Hapus tetap konfirmasi.
- Muat: `SkeletonList` hanya untuk muat pertama; refetch menampilkan "Memuat…" tanpa mengosongkan daftar.
- **Data:** daftar mengambil himpunan terfilter penuh (tanpa `page`/`limit`, seperti papan) lalu dipaginasi di klien.
  Alasan: server hanya menyaring SATU nilai `stage` persis, sedangkan segmen adalah grup.
- **Keputusan:** segmen "Review" tidak dibuat. `Spec.stage` tak punya tahap review; tinjauan adalah aksi "Review
  perubahan" pada item. Menambahkannya butuh keputusan produk dan tahap/penanda di server.
- `src/src/screens/TeamScreen.tsx` — **lensa "Saya"** bawaan (`memberId(email)` dari `api.authStatus`, hanya bila
  akunnya terdaftar sebagai anggota; tanpanya lensa tak ditawarkan), "Semua" melepasnya. Baris alat ≤6 kontrol:
  mode (Papan/Linimasa/Lintas project), lensa, pencarian, Filter (project, kolom, anggota, zoom), Tugas baru, ⋯
  (Anggota tim). `SyncButton` hanya tampil di instance klien. Pindah dan tugaskan punya toast "Urungkan".
- `src/src/screens/team-board.tsx` — kartu hanya **judul, titik prioritas (sama dengan Backlog), avatar + penanggung
  jawab, dan satu menu "Ubah tugas"** (pindah kolom, tugaskan, kosongkan, buka spec / lepas tautan / kirim ke
  Backlog). Project ada di tooltip kartu. Mobile (≤767px): satu kolom + pemilih `Tabs`.
- `src/src/screens/team-timeline.tsx` — tak berubah; legenda sudah ada di `TimelineLegend`.
- `src/src/screens/styles/backlog.css`, `styles/team.css` — kelas `hn-bl-*` dan `hn-tm-*` (token saja). Prefiks baru
  sengaja berbeda dari `.hn-backlog-*`/`.hn-team-*` di `app.css`, yang aturan `!important`-nya kini tak terpakai
  (dihapus di Fase 2E).
- `src/src/screens/AutoMergeCard.tsx` — copy "setelan basi" diganti (utang copy Fase 3 selesai).

Tes: `backlog-*.test.tsx`, `reopen-session`, `revert-stage`, `search-filter`, `change-source`, `team-board`,
`team-escalate`, `team-screen` (+ lensa dan urung baru), `backlog-ui-audit` (+ skeleton dan urung prioritas).
Guard: `glossary-guard`, `no-silent-catch`, `placeholder-contract`, `confirm-inventory` hijau.

`App.tsx` sudah meneruskan `onOpenSpec` ke `TeamScreen`, jadi item "Buka SPEC di Backlog" di menu kartu tampil. Tak ada
perubahan di `App.tsx` untuk Fase 3D.

## Audit UI/UX 2026-10 · Fase 3 · Projects, PRD, Docs, Skills (3P · 3K)

Redesign hub Projects (daftar, detail, PRD, Docs) dan Skills, sesuai [usulan § Per layar](ui-ux-audit-2026-10.md#2-per-layar)
dan [aturan minimalis](ui-ux-audit-2026-10.md#3-aturan-minimalis-hanoman-usulan). Label 3P dipakai karena
label 3I di rencana sudah milik Scheduler. Skills tetap dicatat sebagai 3K.

Berkas (milik fase ini; CSS baru di `src/src/screens/styles/`):

- `ProjectsScreen.tsx`: RowList diurut perhatian oleh server (`sort=attention`, ADR-0212: dokumen rusak → drift → sisanya), chip Semua · Perlu perhatian · Sesi berjalan
  dengan hitungan, StatStrip dibuang. Kolom: Project (nama + jenis + deskripsi) · Status (+ PresenceChip) · Dokumen · Backlog terbuka.
  Hapus di ⋯ per baris.
- `ProjectDetailScreen.tsx`: header, tiga pintu besar (Backlog n · Terminal · Dokumen), `MissingRepoCard` di atas pintu,
  `<details>` "Pengaturan project" (Help Center, auto-merge, custom agent, tautan Skills), zona bahaya paling bawah.
- `PrdScreen.tsx`: indeks kiri dikelompokkan per status (Draf · Dieskalasi · Terwujud, tiap grup `<details>`), halaman
  baca ~68ch, bar aksi sticky (judul + "Jadikan backlog" + ⋯ berisi Unduh), sheet tiga pilihan (brief, goal, atau breakdown
  dengan checklist usulan), usulan breakdown sebagai panel lipat baca-saja.
- `DocsWorkspace.tsx` + `styles/docs.css`: satu toggle Baca | Edit, bar simpan sticky (belum disimpan · Batal · Simpan),
  pencarian di atas pohon, chip kategori PRD · Spec · ADR · Lainnya (`docKind`, diturunkan dari path kategori), cakupan
  sebagai chip, pohon `role="tree"` dengan panah atas/bawah. Hapus dan unduh di ⋯ kepala dokumen.
- `skills/SkillsWorkspace.tsx`: Tabs "Skill" · "Agen". Tab Skill = master-detail. Tab Agen memuat `CustomAgentsPanel`
  hanya saat pertama dibuka. Hapus skill di ⋯.
- `skills/SkillsList.tsx`: daftar ringkas (nama, deskripsi satu baris, sumber, nama project), lapis sebagai chip
  Semua · Global · Project · Plugin. Global = lapis `hanoman` + `user`. Tanpa grup lipat.
- `skills/SkillEditor.tsx`: footer Simpan selalu tampil untuk skill yang bisa disunting, sticky, dengan "belum disimpan".
- `CustomAgentsPanel.tsx` + `CustomAgentMetrics.tsx`: modal tiga tab (Dasar · Tools & Mention · Lanjutan). Jumlah galat
  per tab tampil sebagai angka di tab. Kartu memuat Ubah, switch aktif, dan ⋯ berisi Hapus. Bukti dan sampel ada di
  lipatan "Bukti", dan telemetri di lipatan "Bukti penggunaan" tingkat panel.
- `FolderPicker.tsx`, `MissingRepoCard.tsx`: baris folder memakai kelas (hover di CSS). Modal clone memakai
  `dismissible={!busy}` tanpa `() => {}`.

Keputusan perilaku:

1. **Sumber daftar project.** Tampilan "Semua" tanpa filter perangkat tetap memakai API (SPEC-198), jadi galat, Coba lagi,
   dan paginasi Fase 1 tidak berubah. Chip aktif memakai daftar penuh dari App, sehingga hitungan chip sama dengan hasilnya.
   Urutan perhatian selalu global (ADR-0212): tampilan default dan chip "Perlu perhatian" meminta `sort=attention`
   (chip itu juga `attention=true`) ke server, dan klien tak mengurutkan ulang. Chip "Sesi berjalan" tetap dari daftar
   penuh App (status sesi tak ada di API), jadi urutannya urutan App.
2. **Kolom yang dipindah.** "Ditangani oleh" dan "Aktivitas" tak lagi jadi kolom daftar; keduanya tampil di detail. Filter
   perangkat tetap di daftar. Jenis project ditampilkan sebagai teks, bukan lencana (maks. dua lencana per baris).
3. **Tab Agen di Skills.** Katalog agen tidak dimuat sebelum tab dibuka. Ini menjaga halaman Skills tetap ringan dan
   tidak menembak API agen saat layar dibuka.
4. **Rantai flex Docs.** Pane preview Docs tetap memakai gaya inline `flex`/`minHeight`/`overflow` pada rantai
   SPEC-363/393. Kontrak itu diuji lewat style, dan jsdom tak memuat CSS.
5. **Status PRD tak dikenal** masuk grup sendiri, tidak hilang diam-diam.

Test: `projects-screen`, `project-detail`, `project-handled-by`, `prd-screen`, `doc-download-screens`, `docs-*`,
`custom-agents-panel`, `screens-state-persist`, `preview-fill-height`, `scroll-chain`, `skills/SkillsWorkspace`,
`settings-agent*`, serta guard `glossary-guard` (allowlist "Cakupan SoT" dihapus), `no-silent-catch`,
`placeholder-contract`, `confirm-inventory`, dan `ds-css-contract`. Test `edit-project-folder-picker` dan
`app-flows` ikut dijalankan. Test IDE (`IdeScreen`) di luar lingkup fase ini.

## Audit UI/UX 2026-10 · Fase 3 · QA (3L)

Redesign workspace QA: editor laporan menjadi lembar kerja, daftar laporan dan temuan memakai RowList, dan
pengajuan dikerjakan lewat satu dialog bersyarat. Sesuai [usulan § Per layar](ui-ux-audit-2026-10.md#2-per-layar)
dan [aturan minimalis](ui-ux-audit-2026-10.md#3-aturan-minimalis-hanoman-usulan). Produk: [workspace QA](../product/qa-workspace.md).

Berkas (`src/src/screens/qa/`; CSS baru di `src/src/screens/styles/qa.css`, dimuat oleh `QaWorkspace`):

- `QaWorkspace.tsx`: toolbar lima kontrol (Project, Sinkronkan QA, Laporan baru, Impor, Unduh template). Daftar memuat
  dengan `SkeletonList`. Modal impor dan buat laporan memakai `Field` DS; berkas native diberi `aria-label`.
- `QaReportList.tsx`: `RowList`. Baris = kode · status (`Badge` titik) · judul · versi dan penguji · lulus n/m · temuan ·
  keputusan · "Diubah …" (`relativeTime`). Satu pintu unduh per baris: ZIP.
- `QaReportEditor.tsx`: 
  - Header sticky: Kembali, kode, status, judul. Satu aksi utama mengikuti keadaan: terkunci → Buka kembali; ada
    perubahan → Simpan (Ajukan atau Selesaikan dan kunci jadi sekunder); bersih → Ajukan atau Selesaikan dan kunci.
    ⋯ berisi tautan ekspor (ZIP utama, lalu DOCX, PDF, XLSX, CSV, .md), Pratinjau laporan, dan Hapus (tak ada bila terkunci).
  - Kartu "Info laporan" ringkas (versi, penguji, keputusan, perangkat). "Ubah info" membuka drawer berisi seluruh isian;
    laporan baru membukanya otomatis. Perubahan tetap draf sampai disimpan dari header.
  - Tab Langkah uji · Temuan · Lampiran tepat di bawah kartu, sehingga selalu terlihat tanpa menggulir melewati form.
  - Ajukan dan Selesaikan dan kunci membuka dialog **Tinjau dan ajukan**: checklist judul (wajib), keputusan (wajib,
    dipilih di dialog), dan temuan terbuka (informasi). Galat server tampil di dialog itu.
  - Mobile (<768 px): header menyisakan judul dan ⋯; aksi utama, status simpan, dan ⋯ pindah ke bar bawah yang menempel
    (`position: fixed` dengan `env(safe-area-inset-bottom)`), lewat CSS pada satu elemen yang sama.
- `QaCasesPanel.tsx`: kartu test case = Kode · Nama · ⋯ (Hapus test case, dikonfirmasi). Status = `RadioGroup` satu
  ketukan bergaya chip (Belum diuji · Lulus · Gagal · Terhambat · Dilewati), menggantikan select dan badge ganda. Indikator
  simpan per kartu: Menyimpan… · Tersimpan · galat beserta alasannya.
- `QaFindingsPanel.tsx`: `RowList` temuan. Baris = kode · dampak · status · judul · prioritas · fitur · test case · tautan
  SPEC. Di luar baris: satu aksi utama, **Kirim ke backlog** (belum terkirim atau tautan putus) atau **Buka backlog**
  (sudah terkirim). ⋯ berisi Kerjakan langsung, Ubah temuan, dan Hapus temuan. Mengetuk baris membuka detail (langkah,
  hasil, lampiran). **Kirim semua ke backlog (n)**: konfirmasi menyebut dampaknya, lalu dialog hasil per temuan (berhasil
  dengan SPEC dan baru atau sudah ada; gagal dengan alasannya), bukan hanya toast.
- `QaPreview.tsx`: hanya pratinjau Markdown (renderer yang sama dengan ekspor). Tautan unduh pindah ke menu ⋯.
- `QaAttachments.tsx`: gaya lewat kelas; perilaku dan struktur teks tak berubah.
- `qa-ui.ts`: `QA_EXPORTS` satu daftar format untuk menu ⋯. `QaField.tsx` dihapus: `Field` DS sudah menautkan label, hint,
  dan galat (lihat [design-system § Form, Modal, Toast](../design-system/design-system.md)).

Keputusan perilaku:

1. **Keputusan dipilih di dialog pengajuan.** Server hanya mensyaratkan keputusan (`verdict`) untuk mengajukan atau
   menyelesaikan laporan; temuan terbuka tidak menghalangi. Karena itu "temuan terbuka" hanya ditampilkan sebagai
   informasi. Judul dan keputusan menonaktifkan tombol konfirmasi.
2. **Pratinjau dan ekspor di ⋯, bukan di tab.** Setiap format punya satu tempat. Pratinjau membuka dialog sendiri, dan tab
   Pratinjau dihapus.
3. **Drawer Info, bukan lipatan di atas tab.** Form panjang tak lagi mendorong tab kerja ke bawah. Drawer tidak punya
   tombol simpan: satu jalur simpan di header, dan Kembali tetap bertanya bila ada draf.
4. **Status test case tetap lengkap.** Lima nilai (`todo`, `pass`, `fail`, `blocked`, `skipped`) tetap tersedia sebagai
   chip; tak ada yang disembunyikan demi ringkas.
5. **Label, bukan enum mentah.** Tahap backlog di baris temuan memakai `STAGE_LABEL` (mis. "Brainstorm"), bukan nilai
   mentah `brainstorming`.
6. **Tanpa perubahan API.** Tidak ada route atau tool MCP baru; keputusan ADR-0202 tidak berubah.

Belum diverifikasi: tampilan di 320, 390, 768, dan 1024 px (jsdom tak menghitung layout dan CSS). Pemeriksaan
visual dilakukan manusia sebelum merge.

Test: `QaWorkspace.test.tsx` (26 kasus: daftar, editor, status test case, alur ajukan, kirim ke backlog dan hasil massal,
menu ⋯, impor dan ekspor, galat, drawer Info), `QaAttachments.test.tsx`, dan `qa-nav`. Guard: `glossary-guard`,
`no-silent-catch`, `placeholder-contract`, `confirm-inventory`, `ds-css-contract`, `ui-audit-tokens`, dan
`responsive-touch-targets`.

## Audit UI/UX 2026-10 · Fase 3C · Pengaturan (empat niat)

Fase 3C dari [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md): 16 tab datar dan
`SettingsScreen.tsx` ±1 540 baris dipecah menjadi **shell tipis** dan modul per niat. Aturan layar mengikuti
[audit § Settings](ui-ux-audit-2026-10.md#2-per-layar) dan [glosarium](glossary.md). Tidak ada API baru dan tidak ada
perubahan skema; setiap PUT/endpoint yang sudah ada dipakai apa adanya.

**Keputusan IA.** Empat niat — **Sesi harian** (default) · **Agen & model** · **Integrasi & akses** ·
**Lanjutan** (tertutup default di navigasi). Di desktop/tablet, niat dengan lebih dari satu bagian membuka daftar
bagiannya di bawah dirinya; di mobile, satu `Select` "Bagian pengaturan" memuat semua bagian dengan awalan niatnya.
Keputusan IA ini dicatat di [ADR-0207](../adr/0207-pengaturan-empat-niat-satu-aturan-simpan.md) (ADR-0205 hanya
mencakup level hub).

Berkas:

- `src/src/screens/SettingsScreen.tsx` — shell: store snapshot, pilihan bagian, navigasi niat, "Cari pengaturan",
  dan `renderSection`. Mengekspor ulang `AgentAccessPanel` dan `DeviceTokensPanel` untuk pemanggil lama.
- `src/src/screens/settings/model.ts` — katalog IA (`SETTINGS_INTENTS`, `SECTION_KEYS`), `normalizeSection`
  (kunci lama `umum`→`sesi`, `orkestrasi`→`model`), `readHashSection`, default `S_DEFAULTS`, dan helper model claude.
- `src/src/screens/settings/useSettingsStore.ts` — snapshot tunggal: `persist` (antrean PUT, rebase S5, toast jujur,
  rollback per kunci yang berubah), `save`, `update`, `current`.
- `src/src/screens/settings/useSettingField.ts` — **satu aturan simpan** (lihat tabel di bawah).
- `src/src/screens/settings/rows.tsx` — `SettingRow` (dengan status simpan per baris), `Prose`, `SectionNote`, `BlockedHint`.
- `src/src/screens/settings/fields.tsx` — `FunctionOverride` (komponen override satu-bentuk), `EngineFields`
  (runtime/model/effort), `CodexVersionNote`, `AgentGroupHeader`, `NumberSettingField`.
- `src/src/screens/settings/engines.ts` — penulis `lead` (`PUT /lead/config`) dan `telegram` (GET + PUT segar).
- `src/src/screens/settings/SessionSettings.tsx` — Sesi harian: notifikasi, perilaku sesi, default agen & model,
  mode goal, scope verifikasi, metode workflow.
- `src/src/screens/settings/AgentsModels.tsx` — Agen & model: Override per fungsi (Konflik, Lead, obrolan portal) dan
  orkestrasi.
- `src/src/screens/settings/Integrations.tsx` — Integrasi & akses · Telegram (kredensial, uji, gateway, agen operator)
  dan Webhook (dokumentasi dilipat di `<details>`).
- `src/src/screens/settings/AgentAccess.tsx`, `DeviceTokens.tsx` — dipindah dari shell tanpa perubahan perilaku.
- `src/src/screens/settings/Advanced.tsx` — Lanjutan: Akun, Pengguna, Setup awal, Konfigurasi (env), Log aktivitas,
  Custom agent, dan Zona bahaya (Reset ke default, konfirmasi tetap).
- `src/src/screens/settings/SettingsSearch.tsx` — "Cari pengaturan": filter DOM dan daftar bagian lintas niat.
- `src/src/screens/styles/settings.css` — layout, nav, status simpan, dan lebar kontrol lewat kelas (bukan inline).
- `src/src/screens/WebhooksPanel.tsx`, `WebhookDocs.tsx` — tombol "Dokumentasi webhook" dan "Kembali" hanya tampil bila
  callback-nya diberikan (dipakai untuk pelipatan).

**Aturan simpan (satu hook, tiga perilaku).**

| Jenis field | Perilaku | Status baris |
|---|---|---|
| Sakelar, pilihan (diskret) | auto-save, `delayMs: 0`; nilai tampil langsung, rollback bila gagal | Menyimpan… / Tersimpan / Gagal — coba lagi |
| Teks diketik (kondisi goal) | auto-save dengan debounce 400 ms (`SAVE_DEBOUNCE_MS`); blur menyimpan segera (`flush`) | sama |
| Angka (jatah, batas waktu) | dinilai saat blur/Enter: di luar batas ditolak atau dipotong dengan toast; nilai lama dipertahankan saat kosong | sama |
| Secret & kredensial Telegram | **tombol Simpan eksplisit** dalam `<form>` (Enter mengirim), tombol nonaktif tanpa perubahan, teks "Ada perubahan belum disimpan." | — |
| Konfigurasi env (`Konfigurasi`) | tombol Simpan per baris dalam `<form>`; secret tetap lewat "Ganti"/"Hapus" | — |

Gagal menyimpan: nilai tampil kembali ke nilai tersimpan (rollback), toast galat, dan baris menampilkan
"Gagal — coba lagi" dengan tombol ulang yang mengirim nilai yang gagal. Simpan yang selesai setelah ada ubahan baru
tak menimpa status ubahan itu. Sakelar dan pilihan tetap memberi toast sukses setelah PUT berhasil (perilaku Fase 1).

**Override satu-bentuk.** Konflik, Lead, dan operator Telegram memakai `FunctionOverride` + `EngineFields`: sakelar
"Pakai setelan sendiri", dan saat mati, teks warisan (`data-testid` tetap: `conflict-inherited`,
`lead-engine-inherited`, `telegram-engine-inherited`). Obrolan portal memakai komponen yang sama dengan sakelar
berlabel "Aktifkan obrolan" (fitur on/off, bukan override model). Agen operator Telegram ditaruh di Integrasi &
akses · Telegram — satu tempat dengan kredensialnya — dan Agen & model hanya menunjuk ke sana.

**Cari pengaturan.** Kotak `role="search"` "Cari pengaturan". Di dalam bagian aktif, baris (`data-setting-row`) dan
kartu (`data-setting-card`) yang judul/penjelasan/kata kuncinya (`data-search`) tak cocok disembunyikan dengan atribut
`hidden`; kartu yang judulnya cocok menampilkan seluruh barisnya. `MutationObserver` menyaring ulang bila daftar
yang dimuat async masuk. Lintas bagian, daftar tautan bagian yang cocok muncul di bawah kotak. Escape mengosongkan.

**Kunci persist dan deep link.** Bagian aktif tersimpan di `hn.ui.v1.settings.tab` (ADR-0115). Kunci lama dipetakan
lewat `normalizeSection`; nilai rusak jatuh ke Sesi harian. Deep link `/settings#bagian=<kunci>` dibaca saat dibuka
(tanpa route baru, dan hash tak ditulis ulang saat navigasi biasa supaya tak ikut terbawa).

Test:

- `src/test/settings-use-setting-field.test.tsx` — debounce, flush, nilai sama dilewati, status
  pending→saving→saved, rollback dan retry, simpan usang tak menimpa status, unmount menyimpan.
- `src/test/settings-search.test.tsx` — `applySettingsFilter` di DOM, `searchSections`, dan integrasi di layar.
- `src/test/settings-intents.test.tsx` — empat niat, Lanjutan tertutup default, kunci lama, deep link, Reset hanya
  di Zona bahaya.
- Test lama Pengaturan (`settings-*.test.tsx`, `SettingsScreen.test.tsx`, `config-panel`, `codex-version-note`,
  `method-*`, `workspace-state-persist`, `agent-tokens`) diperbarui ke nama niat/bagian baru; cakupan assertion-nya
  tetap. Test navigasi ke Telegram memakai deep link agar tak memuat Akses AI Agent. `glossary-guard` kehilangan
  allowlist `SettingsScreen.tsx` ("SoT, ADR…") karena copy-nya sudah diganti.

Utang yang tersisa di Fase 3C:

- `WebhookDocs.tsx`: copy "bisa basi" dan "Retry" masih di allowlist UTANG Fase 3 (keputusan istilah "Kirim ulang").
- ADR untuk IA Pengaturan sudah ditulis: [ADR-0207](../adr/0207-pengaturan-empat-niat-satu-aturan-simpan.md).
- `screens/AgentDocCard.tsx` dan `McpPanel.tsx` masih memakai inline style di dalam Akses AI Agent (bukan bagian Fase 3C).

## Audit UI/UX 2026-10 · Fase 3 · Review, Auth, Portal, Onboarding (3L · 3M · 3N)

Tiga layar yang dibaca operator sebagai "buntu" atau "membingungkan" di [audit](ui-ux-audit-2026-10.md#temuan-per-layar-ringkas):
Review (tanpa keputusan), Setup (dua layar dengan penomoran 1/3), dan Klien (daftar tanpa jawaban atas "bagaimana masalah saya?").
Susunan dan kelas ada di `screens/styles/review.css`, `screens/styles/auth.css`, dan `portal/portal.css` (bersama Help Center publik).

### 3L · Review: "Tinjau lalu Putuskan"

- **Kepala ringkas:** judul item, `N berkas berubah · +X −Y baris` (dihitung dari `changed`, tanpa endpoint baru), dan
  "Kembali" + "Muat ulang".
- **Daftar dan isi:** `ChangedSection` + `TreeRoot` di kiri (atau atas di mobile), viewer Diff|Sumber di kanan. Header viewer
  menampilkan `+n −m` untuk berkas yang sedang dibuka.
- **Bar keputusan sticky** di bawah. Tiga tujuan, semuanya *navigasi*, bukan mutasi baru:
  - **Buka di Backlog** (item backlog; sesi PRD tidak punya tujuan ini): tempat merge/rebase (`integrateSpec` yang dipasang App lewat `onIntegrate`).
  - **Buka di Terminal:** sesi konflik dan commit.
  - **Buka di IDE:** git graph dan diff lintas cabang.
  - Prop baru `onGoto?: (to: Route) => void`. Tanpa prop ini tiap tujuan menjadi tautan `routePath()` (`/backlog/<id>`, `/terminal`, `/ide`).
- **Keputusan: tidak ada merge/buang langsung di Review.** `integrateSpec` punya penanganan konflik (→ sesi Terminal) dan dialog
  dampaknya di Backlog. Menyalinnya ke Review menggandakan jalur mutasi tanpa konteks itu. Tidak ada endpoint "buang" untuk worktree
  item yang bisa dipakai layar ini; `revertStage` mengubah stage, bukan worktree.

**ReconcileModal (Konflik sinkron):**

- Hanya field yang **berbeda** yang tampil, sebagai `<dl>` dengan kolom Lokal dan Server. Di mobile dua kolom jadi bertumpuk, dan
  label sisi (`Lokal`/`Server`) tampil lewat `hn-reconcile-side`. Di desktop label itu tetap ada untuk pembaca layar.
- Jenis data (`spec`, `sessionResult`, …) lewat `ENTITY_LABEL` lokal; jenis yang belum dikenal menjadi "Data", bukan kode mentah.
- **Istilah "server pusat"** menggantikan "hub" di seluruh copy konflik. Ini menutup keputusan terbuka di
  [glosarium](glossary.md#keputusan-terbuka); entri allowlist `ReconcileModal` di `glossary-guard` dihapus.
- `.catch(() => {})` yang sempat ada digantikan `.catch` yang menampilkan galat lewat `failureMessage`.

### 3N · Onboarding: setup satu layar, akun dengan nomor jujur

- **SetupWizard** kini satu layar: *Peruntukan* (`RadioGroup`; default "Perangkat ini" pada setup pertama) dan, hanya bila
  publik tanpa hardening, pengakuan risiko. **Hardening** dan prasyaratnya di `Lanjutan · keamanan (hardening)` yang tertutup
  (`<details>`); toggle tetap terkunci selama ada prasyarat merah (aturan lama tak berubah).
- **Penomoran:** "hanoman · setup 1/2" hanya saat setup pertama. Akun pertama adalah langkah 2/2 **hanya** bila wizard tadi
  tampil. `AuthScreen` menerima `setupStep?: 2` dan baru menampilkan "setup 2/2" bila layar induk meneruskannya
  (App.tsx sudah meneruskannya, lihat di bawah). Tanpa prop itu, layar akun tidak mengklaim nomor langkah.
- **AuthScreen:** input `size="lg"` (16 px, mencegah zoom iOS); ilustrasi `PST-001` kecil (dekoratif) hanya di setup;
  tombol nonaktif selalu menyebut alasannya (`#auth-block-reason`); galat per penyebab tetap.
- **AccountMenu:** gaya dipindah ke kelas `hn-account-*`; perilaku dan kontrak tes tak berubah.

### 3M · Portal klien: "Beranda Klien"

- **Kerangka:** header bermerek "Klien", judul = nama project (`h1`) dan kalimat "Beranda Klien · lihat bagaimana masalah
  Anda berkembang di sini." CTA primer **Lapor masalah** di kanan kepala. Pemilih project (chip) hanya bila ada lebih dari satu.
- **Tab:** *Keluhan saya* (default; jawaban atas "bagaimana masalah saya?") · *Progres pekerjaan* (backlog, data tak berubah) ·
  *Tanya & ide* (chat, hanya bila diaktifkan). Chat tetap tab: sesinya milik project, dan API tak mengaitkan sesi ke tiket,
  jadi memasukkannya ke detail keluhan butuh perubahan API.
- **Kartu keluhan:** nomor, judul (tombol → detail), pill status, linimasa 4 langkah (kompak), dan satu kalimat keadaan
  (`ticketNote`). Detail (modal) memuat linimasa penuh, kalimat keadaan, dan isi laporan.
- **Linimasa** (`portal/ticket-timeline.ts`, fungsi murni; `portal/TicketTimeline.tsx`, komponen bersama dengan Help Center):

  | status publik (`publicStatus()`) | Diterima | Ditinjau | Dikerjakan | Selesai |
  |---|---|---|---|---|
  | Sedang ditinjau | sudah | **sekarang** | belum | belum |
  | Diterima | sudah | sudah | **sekarang** (menunggu giliran) | belum |
  | Sedang dikerjakan | sudah | sudah | **sekarang** | belum |
  | Selesai | sudah | sudah | sudah | sudah |
  | Ditutup | sudah | *tidak dilanjutkan* | belum | belum |

  Keputusan: urutan langkah mengikuti kosakata klien (Diterima → Ditinjau → Dikerjakan → Selesai), bukan urutan status server.
  Server mengurutkan "Sedang ditinjau" sebelum "Diterima"; di sini "Diterima" berarti tinjauan sudah lewat dan laporan
  menunggu giliran. Status tak dikenal hanya menandai langkah pertama dan tak pernah melempar.
- **Lapor masalah** = sheet dua langkah (`Modal`, `langkah 1 dari 2`): *Apa yang terjadi?* (project bila >1, kategori, judul, detail),
  lalu *Lampiran (opsional)* dengan ringkasan dan "Tercatat atas nama <email akun>". Tombol Lanjut nonaktif dengan alasan.
  Payload tak berubah (`createTicket`, multipart). Email tak diketik ulang.
- **PublicHelpApp:** halaman status memakai `TicketTimeline` + `TicketNote` + `StatusPill` yang sama; form memakai kelas
  `hn-public-*`. Honeypot (SPEC-352) tak berubah, termasuk gaya offscreen inline yang disengaja.
- **Input 16 px:** `Input size="lg"`, `.hn-portal-textarea`, dan `.hn-public-input` (font 16 px). Di layar sentuh/mobile
  tombol, select, dan input mendapat tinggi minimum 44 px lewat `portal.css`.

### Penjaga dan tes

- `glossary-guard`: entri allowlist `ReconcileModal` dihapus (copy "server pusat"). `no-silent-catch`, `placeholder-contract`, dan
  `confirm-inventory` lulus tanpa allowlist baru.
- Test yang diubah ke struktur baru: `client-portal`, `portal-scroll`, `public-help`, `setup-wizard` (satu layar), `reconcile-modal`,
  `review-screen` (bar keputusan dan header), `auth-screen-token` (penomoran), dan `ChatPanel.test` (nama "Keluhan saya").
- Test baru: `ticket-timeline.test.tsx` (pemetaan murni untuk semua status `publicStatus()` + komponen dengan `aria-current`).
- Verifikasi: `pnpm typecheck` bersih; 22 berkas test area ini + test sekitar App (`app-*`, `hub-nav-app`, `palette-app`,
  `triage`, `nav-*`, `illustration-placement`) lulus. CSS baru diuji sintaksnya dengan PostCSS. **Render browser per layar ini tidak tercatat di sini**
  (uji layout 320/390/768 px dan bar sticky per layar ini belum tercatat; tiga commit QA Chrome yang menyentuh Review dan Portal ada di riwayat git, lihat § Status pelaksanaan di audit).

### Prop App.tsx (sudah tersambung; tidak ada yang wajib)

1. `ReviewScreen` menerima `onGoto` di `App.tsx:1793` (sudah tersambung). Tanpa itu, tiga tujuan keputusan
   menjadi tautan biasa (muat ulang halaman penuh, state hilang).
2. `AuthScreen` menerima `setupStep` di `App.tsx:1570` (sudah tersambung). Tanpa itu, layar akun setup
   tampil tanpa nomor (aman, tidak menyesatkan).

### Risiko dan keputusan yang perlu dilihat

- Pemetaan "Diterima" (lihat tabel) adalah keputusan produk; jika server kelak mengubah urutan status, `ticket-timeline.ts` dan test-nya
  harus ikut berubah.
- Nama tab Klien berubah ("Laporan & keluhan" → "Keluhan saya", "Obrolan" → "Tanya & ide"). Test dan docs lama yang menyebut nama
  lama sudah diperbarui; dokumen lain di luar area ini belum dicek.
- `ClientPortal`, `PublicHelpApp`, dan `ReviewScreen` tetap memakai `style` inline untuk root scroller dan `LIST_SCROLL_STYLE`
  karena tes rantai gulir (`portal-scroll`, `public-help`, `auth-responsive`) mengunci nilai itu lewat `toHaveStyle`.


## State tampilan persisten (SPEC-740 · ADR-0115)

Tiap halaman mengingat state tampilannya dan memulihkannya saat pengguna kembali — lewat navigasi
maupun refresh/buka-ulang browser. Mekanismenya **satu** modul, `src/src/ui-state/`; layar tak boleh
menambal sendiri.

**Aturan untuk layar (dan layar baru):**

- Field tampilan memakai **`usePersistedState(screen, field, initial, accept?)`**, bukan
  `React.useState`. Yang dihitung field tampilan: nilai filter & kata kunci, nomor halaman, offset
  scroll, id/path terpilih, tab & sub-tab, seksi yang di-expand.
- Yang **tidak** dipersist: draft editor (`draft`, `form`, `mode: "edit"`), `busy`/`loading`/`error`,
  dan data itu sendiri. Storage hanya untuk parameter tampilan — jangan menaruh payload besar atau
  data sensitif.
- Field **nullable** wajib menyebut guard `nullableStr` (default guard tak punya informasi tipe saat
  `initial` bernilai `null`); union/enum menyebut `oneOf(...)`.
- State per-project memakai `scoped(screen, projectId)` sebagai screen key — tanpa itu filter project
  A muncul saat project B dibuka.
- Yang disimpan untuk sebuah objek terpilih adalah **id/slug**-nya, lalu diresolusi ulang dari daftar
  hidup (pola `sel` PRD, `selectedId` `detailId` VPS).
- Layar berfilter memasang **`<ResetViewButton screen active={n} onReset?>`** di baris penyaringnya.
  `active` dihitung layar (hanya ia yang tahu default field-nya) dan sekaligus menyalakan lencana
  "N filter aktif" — syarat SPEC-740: daftar yang tampak kosong tak boleh terbaca sebagai data kosong.
  `onReset` untuk state yang dipakai layar tapi dimiliki App (`projectFilter`).
- Daftar panjang memasang **`useScrollRestore(screen, field, ready)`** pada container bergulirnya;
  `ready` menyala saat data pertama sudah mendarat. Scroll tingkat-halaman sudah ditangani `Shell`
  untuk semua layar sekaligus — tak perlu diulang.
- Hanya **`page`** yang dipulihkan, **tak pernah `limit`** — `limit` tanpa `page` berperilaku sebagai
  plafon (SPEC-523 · ADR-0107). `pageSize` tetap konstanta/prop layar.

**Bentuk kunci:** `hn.ui.v1.<screen>[@<scope>].<field>`. Versi hidup di dalam kunci; menaikkannya
membuat state lama tak terlihat tanpa migrasi, dan `pruneUiState()` (dipanggil sekali saat App mount)
menyapu sisanya. Nilai yang gagal di-parse atau salah bentuk jatuh ke default, tak pernah melempar.

**Cakupan hari ini** — semua entri `HN_NAV`; Overview memang tak punya state tampilan:

| screen | scope | field |
|---|---|---|
| `app` | — | `section` (guard `NAV_KEYS`), `projectId`, `projectFilter` |
| projects | — | `q`, `page`, scroll daftar |
| prd | — | `status`, `sel` |
| backlog | — | `tab`, `view`, `q`, `stage`, `prio`, `dateField`, `from`, `to`, `page`, `detailId`, scroll |
| triage | — | `tab`, `project`, `status`, `q`, `page`, `openId`, scroll |
| team | — | `view`, `q`, `col`, `member`, `zoom` (ADR-0153), `expanded` (ADR-0154) — **tanpa `page`**: papan tim tak dipaginasi (ADR-0151) |
| scheduler | — | `queue-<status>-page`, `cronRunsPage`, `cronProject`, `cronOpenRuns` |
| lead | — | `filter`, `decPage`, `flowPage` |
| terminal | — | `project`; mapping grid kanonik di server per user (ADR-0118) |
| ide | project | `tab`, `viewRef`, `selected`, `selKind`, `mdView`, `stagedView`, `changedView`, `diffTab` |
| vps | — | `detailId` |
| clients | — | *(tak ada)* — SPEC-919: layar ini tak punya filter, paginasi, maupun pilihan; seluruh isinya didorong grup siar `presence` (cermin Overview) |
| docs | project | `selected` |
| settings | — | `tab` |

**Navigasi = URL (ADR-0160).** `section` **diturunkan** dari `pathname` lewat `src/src/routes.ts`
(`/backlog`, `/projects/<id>`, `/backlog/<specId>`, `/review/<kind>/<id>`);
`setSection(key)` = `navigate(routePath(...))`, jadi tombol Kembali/Maju browser dan link yang dibagikan
bekerja. `app.section` di storage tetap DITULIS tiap rute `HN_NAV` dibuka dan hanya DIBACA saat URL tak
menunjuk halaman (`/`, key mati `runs`/`triggers`), digerbangi **`NAV_KEYS`** (diekspor `ds/shell.tsx`):
section transien (`project`/`review`) tak boleh jadi titik mendarat dari storage — dari URL boleh, karena
id-nya ikut di path. Hash lama (`#spec=`, ADR-0071) dibaca sesudah mount lalu **dialihkan**
(`replace`) ke path barunya; builder `specDeepLink` memancarkan path.
Dua belas layar di luar Overview/Projects/Backlog/PRD adalah `React.lazy` di balik Suspense `gate()`:
test yang membuka layar itu memakai `findBy*`/`waitFor`, bukan `getBy*` langsung sesudah klik.

**Impor:** `ResetViewButton` mengambil `Badge`/`Button` dari `../ds/components/*` dan `ds/shell.tsx`
mengambil `useScrollRestore` dari `../ui-state/hooks` — lewat barrel, `ds → shell → ui-state → ds`
jadi lingkaran impor yang mati saat inisialisasi modul.

**Test:** `src/test/setup.ts` mengosongkan `localStorage` sebelum tiap test. vitest memakai satu jsdom
per berkas, jadi tanpa itu test pertama yang menyetel filter mewariskannya ke test berikutnya dan
kegagalannya terbaca seperti regresi komponen.
- Realtime: **WebSocket** untuk semua data live — satu WS siar dashboard `/events/ws`
  (backlog/sesi/notifikasi/limits/vps, SPEC-199/ADR-0039) + WS PTY per terminal
  (`/terminal/sessions/:id/ws`, frame `data`/`phase`/`exit`). Klien punya satu koneksi events
  singleton (`api/events.ts`, ref-count) yang di-`subscribe` tiap consumer. HTTP GET hanya untuk
  paint pertama (projects tetap HTTP — bukan data real-time). Tidak ada SSE, tidak ada poll
  `setInterval`. Optimistic UI untuk kontrol lokal.
- **Data BERPARAMETER ikut lewat socket yang sama** (SPEC-908/**ADR-0145**, mengamandemen ADR-0039;
  **tak ada koneksi kedua** — kuota `MAX_CONNECTIONS_PER_PRINCIPAL` = 8 tak boleh naik). Empat layar
  yang dulu men-poll sendiri (Scheduler 5 dtk + `nonce`, Triage 5 dtk, Lead 5 dtk, GitGraph 4 dtk)
  kini berlangganan: `subscribeTopic(topic, params, onData)` di `api/events.ts` mendaftarkan minat,
  frame `{t:"sub", subs}` **ter-coalesce di microtask** (empat `QueueSection` yang mount bersamaan =
  satu frame) dan **dikirim ulang UTUH tiap `onopen`**. Frame masuk dicocokkan `msg.key ===
  subKey(topic, params)` — fungsi murni di `@hanoman/shared` yang dihitung kedua sisi, jadi muatan
  halaman lain **tak mungkin mendarat** di layar yang sedang di halaman lain, dan dua tab
  berparameter identik menerima string yang sama persis.
- **`useLiveTopic` (`api/live.ts`) adalah satu-satunya tempat "kapan menyegarkan".** Layar tetap
  memanggil `load()`-nya sendiri untuk muat awal; hook ini hanya mendorong pembaruan. `apply` sengaja
  **tak diberi akses** ke state `loading`/`error` layar — sifat silent refresh karena itu dijaga
  secara konstruksi, bukan oleh disiplin pemanggil. `setInterval` fallback menyala HANYA pada dua
  keadaan yang bisa dibuktikan: (1) frame `hello` sudah tiba dan topiknya tak ada di dalamnya —
  server lama tak mengirim `hello` sama sekali, dan ketiadaannya itulah sinyalnya (ADR-0087); (2)
  socket bisu 15 dtk tanpa satu pun frame — WS terhalang proxy padahal HTTP hidup. Selama WS sehat:
  **nol `setInterval`, nol request HTTP berkala**. Gotcha React yang mengunci ini: daftar topik wajib
  disimpan sebagai **state**, bukan dibaca dari modul saat render — kalau hanya "didukung/tidak" yang
  di-state-kan, transisi `[] → ["git"]` pada layar `tickets` tak mengubah nilainya, React membatalkan
  render, dan keputusan fallback membeku.
- **`q` pencarian Triase di-debounce 400 ms sebelum mengubah kunci langganan** (bukan sebelum muat
  HTTP-nya). Tiap huruf mengubah kunci → entri baru di server yang dibangun di luar jadwal, dan
  sebelas dari dua belas hasilnya langsung dibuang karena entrinya sudah tergantikan huruf berikutnya.
- Tidak ada layar Runs, biaya, maupun anggaran: run + queue dicabut (ADR-0024). Kuota model dipantau
  lewat **LimitIndicator** (badge topbar + kartu Overview) yang membaca `GET /limits` dari OAuth usage
  API Anthropic (SPEC-181/ADR-0024). Settings tak punya `dailyBudget`/`maxConcurrent`. Label reset tiap
  window = countdown (`reset 5j 30m`); window **weekly** menambah momen absolut reset (tanggal+jam, waktu
  lokal browser, `id-ID`) — mis. `reset 52j 8m · Rab, 15 Jul, 07.00` — karena reset mingguan berhari-hari
  ke depan (SPEC-205). Di macOS token dibaca dari Keychain `Claude Code-credentials` milik **akun user
  macOS** (`-a <user>`) lebih dulu, baru entri tanpa akun: claude 2.1.280 bisa menyisakan entri akun
  `unknown` ber-accessToken kosong yang terpilih lebih dulu, dan badge lalu menampilkan "Claude idle /
  belum login" padahal claude login (terukur 2026-09-23). Token kosong dilewati, tak pernah dipakai.
- Markdown render: `marked` → sanitasi allowlist DOMPurify → `MarkdownView`; file non-.md dirender
  sebagai blok kode. Konten repository tidak pernah langsung dipasang sebagai HTML (SPEC-759).
- State ringan lewat React; persist preferensi (edit docs, settings) ke server (dan localStorage sebagai draft).
- **Loading / empty / error** dirender lewat satu komponen `StateBlock` (`ds/components/state.tsx`),
  jadi ketiganya tidak pernah terlihat sama. Fetch awal (`projects+specs`) digerbangkan
  sekali di `App` untuk semua section kecuali Settings, yang memuat datanya sendiri. Error state selalu
  membawa aksi retry; empty state membawa call-to-action ke aksi yang relevan. Settings **tidak** lagi
  jatuh ke nilai default saat GET gagal — toggle berikutnya akan mem-PUT default itu menimpa server.

## Pipeline illustration assets

`internal/assets/illustration/inventory.json` adalah sumber metadata untuk seluruh **41** master.
`src/src/ds/illustration-registry.ts` memegang tuple `IllustrationId` eksplisit (memberi union type),
membaca metadata inventory, lalu mengambil semua WebP dengan `import.meta.glob` eager `?url`. Vite
karena itu meng-hash dan menyalin berkas yang cocok ke `src/dist/assets` saat build; tidak ada
salinan kedua di `src/public` dan tidak ada route server/file-read runtime.

Yang di-glob adalah **`internal/assets/illustration/web/`, bukan master**. Master sengaja
near-lossless (~1,5 MB per keping, 38,8 MB total) dan glob eager mengangkut apa pun yang cocok
sampai ke tarball npm: sekali terukur, paket `hanoman` melonjak **5,5 MB → 46,1 MB** semata karena
master ikut. Turunan web dirakit `internal/assets/illustration/build-web.mjs` (`cwebp`, maks 768px
sisi panjang, q78, metadata dibuang) — 38,8 MB → 1,5 MB, paket kembali ke **7,1 MB**.

Turunan itu **di-commit**, bukan dirakit saat build: runner GitHub Actions yang menjalankan
`pnpm release` tak punya `cwebp`. Setiap master berubah, jalankan ulang skripnya lalu commit
hasilnya bersama masternya. Kesegaran dilacak lewat hash master di `web/manifest.json`, bukan mtime
— git tak mengawetkan mtime, jadi checkout segar akan selalu terbaca "usang" kalau memakai stempel
waktu. `build-web.mjs --check` melaporkan yang hilang/usang tanpa menulis apa pun.

`src/src/ds/Illustration.tsx` adalah satu titik render `<img>`: alt/decorative, lazy/eager,
`fetchpriority`, aspect ratio, object-fit, serta data attribute debugging. Screen mengimpor
`Illustration` atau wrapper family dari barrel `src/src/ds/index.ts` dan hanya menyebut ID katalog —
raw filename di luar registry adalah drift bug.

Pemetaan product-state yang hidup sekarang:

| ID | Keadaan frontend |
|---|---|
| `PST-001` | entry akun/setup (`AuthScreen`) |
| `PST-002` | backlog benar-benar kosong, bukan hasil filter |
| `PST-003` | cell sesi terminal aktif |
| `PST-004` | cell sesi menunggu keputusan manusia |
| `PST-005` | cell sesi sukses + Overview seluruh project on-convention |
| `PST-006` | initial load server gagal tetapi bisa di-retry |

Artwork kecil di header terminal dekoratif karena pill/teks tetap menjadi sumber makna aksesibel;
error dan empty state informatif memakai alt katalog. Family model, hero, lakon, spot, mascot,
sticker, social, diagram, dan motif seluruhnya terdaftar dan dapat dipakai komponen, tetapi hanya
family yang relevan dengan operasi harian yang ditempatkan di dashboard. Contract
`src/test/illustration-registry.test.ts` membuat penambahan/penghapusan record inventory gagal sampai
registry ID ikut diperbarui; `internal/assets/illustration/verify.mjs` memeriksa byte, dimensi,
orientasi, dan alpha master **berikut** keberadaan, batas 768px, alpha, dan pengecilan tiap turunan
web-nya — master sehat yang turunannya hilang berarti layar kosong di dashboard, bukan sekadar aset
besar.

## Pet Hanoman: status sesi sebagai sprite hidup (SPEC-585 · SPEC-648 · Pet hidup A ADR-0140 · Pet hidup B SPEC-897 · Pet hidup C SPEC-898 ADR-0141 · Pet hidup D SPEC-899 ADR-0142 · Pet hidup E SPEC-904 · Pet hidup F SPEC-905 ADR-0144 · Pet hidup G SPEC-909 ADR-0146)

Widget maskot: penempatan dan default per tier ada di [ADR-0206](../adr/0206-pet-footer-sidebar-default-per-tier.md)
(menggantikan sebagian [ADR-0144](../adr/0144-pet-diseret-sumbu-y-jalur-melebar.md); desktop di footer sidebar,
tablet dan ponsel di lajur bawah dan mati default; tak tampil di Dalang). Pose-nya **turunan** keadaan sesi & backlog,
bukan hiasan, dan seluruh sinyalnya sudah ada di klien — tak ada endpoint status, tak ada skema,
tak ada channel realtime baru (ADR-0024 & ADR-0039 utuh).

| sumber | frame WS | dipakai untuk |
|---|---|---|
| `sessions: TerminalSession[]` | `sessions` | `exited`, `exitCode`, `decision`, `deciding`, `decisionAt`, `specId` |
| `backlog: SpecSlim[]` | `specs` (SPEC-1267: tanpa `payload`/`objective`/`sourceHistory`; `dataVersion` naik hanya bila `specsDigestOf` berubah) | `stage`, `blockedBy`, `source`, `title` |
| `useNotifications().items` | `notifications` | `type` + `createdAt` keadaan transient |
| `subscribeStatus()` dari `api/events` | — (socket itu sendiri) | apakah ketiga sumber di atas masih segar (SPEC-897) |
| `document.hidden` | — | snapshot rekap "selama kamu pergi" (SPEC-898) |

**Kontrak status.** Sumber tunggalnya `derivePetConditions` di `src/src/screens/pet-state.ts`
(murni & bertest): ia mengembalikan **daftar** kondisi terurut prioritas, dan `derivePetState`
mengembalikan `conditions[0]` beserta seluruh daftarnya (`PetView = PetCondition & { conditions }`).
Panel dan pose karena itu tak bisa saling bertentangan secara konstruksi. Kosakata sesinya
**identik** dengan sel Terminal (`awaiting` = hidup && `decision`, `deciding` menang atasnya,
`failed` = `exited` && `exitCode` bukan nol). Urutan tabel **adalah** urutan prioritas: kandidat
pertama yang menyala menang, dan itu satu-satunya mekanisme anti-kedip — tak ada timer dwell.
`kind` **bukan** `pose`: sesi gagal dan backlog tertahan dependency memakai pose `blocked` yang
sama tetapi dihitung, didaftar, dan dibuka berbeda.

| # | kind | pose | baris atlas | menyala saat | count |
|---|---|---|---|---|---|
| 1 | `offline` | `offline` | `idle` (pudar) | `!connected && !paused` dan sudah lewat `PET_OFFLINE_MS` sejak `since` | 1 |
| 2 | `failed` | `blocked` | `blocked` | ada sesi `exited` ber-`exitCode` bukan nol | jumlah sesi gagal |
| 3 | `blocked` | `blocked` | `blocked` | **hanya bila tak ada sesi hidup** dan ada backlog belum-`done` ber-`blockedBy` | jumlah backlog tertahan |
| 4 | `waiting` | `waiting` | `waiting` | sesi hidup ber-`decision` yang **tidak** sedang dilayani lead | jumlah sesi |

Kondisi juga membawa `subject` (pokok kalimat — id backlog/sesi) dan `since` (ms epoch onset bila
diketahui: `decisionAt` **tertua** untuk `waiting`, `conn.since` untuk `offline`, `null` selebihnya).
Keduanya ada supaya `pet-speech.ts` tak perlu memparsing `headline`, yang ditulis untuk daftar panel.
| 5 | `deciding` | `deciding` | `deciding` | sesi hidup ber-`deciding` (lead sedang menyusun keputusan) | jumlah sesi |
| 6 | `shipped` | `shipped` | `shipped` | notifikasi `done`/`automerge` non-audit, masih di dalam window transient | jumlah notifikasi segar |
| 7 | `docs-updated` | `docs-updated` | `docs-updated` | notifikasi `done` untuk backlog ber-`source: "audit"`, masih transient | jumlah notifikasi segar |
| 8 | `working` | `working` | `working` | sesi hidup, backlog belum `done`, **bukan** `deciding` | jumlah sesi |
| 9 | `review` | `review` | `review` | sesi terdaftar yang backlog-nya sudah `stage: "done"` | jumlah sesi |
| 10 | `blocked` | `blocked` | `blocked` | backlog tertahan dependency **saat ada sesi hidup** — ekor daftar, tak pernah jadi pose | jumlah backlog tertahan |
| — | `ready` | `ready` / `sleeping` | `idle` / `sleep` | lantai: daftar kosong | 1 |

Baris 3 dan 10 adalah **kondisi yang sama** di dua tempat: gerbang "tak ada sesi hidup" memutuskan
apakah ia boleh menjadi **pose** (naik ke #3) atau hanya boleh **didaftar** (turun ke #10).

**Tiap sesi tepat satu kondisi.** Himpunan lama tumpang tindih — sesi ber-`decision` juga memenuhi
syarat `working` — yang tak terlihat selama hanya puncak yang ditampilkan, tetapi akan menyebut
sesi yang sama dua kali begitu panel mendaftar semuanya. Klasifikasinya karena itu satu jalur:
`failed` → `waiting` → `deciding` → `review` → `working`, dan urutan itu ADALAH urutan spesifisitas.

Delapan keputusan di dalam tabel itu yang tak terbaca dari kodenya:

- **`blocked` karena dependency digerbangi "tak ada sesi hidup".** `blockedBy` adalah keadaan normal
  & berumur panjang di project ber-`dependsOn` (ADR-0093). Tanpa gerbang itu pet terkunci di pose
  peringkat 1 selamanya lalu berhenti memberi tahu apa pun. Backlog yang menunggu giliran tak
  sedang meminta apa-apa dari manusia; sesi yang gagal meminta.
- **`waiting` mengecualikan `deciding`.** Sesi yang sedang disusunkan keputusannya oleh hanoman-lead
  terlihat identik dengan sesi mandek (diam, marker terisi) — membacanya sebagai "butuh kamu"
  adalah alarm palsu (`TerminalSession.deciding`, ADR-0091).
- **Transien menang atas keadaan mapan, kalah dari `blocked`/`waiting`.** Kabar baru lebih
  informatif daripada keadaan mapan, tetapi perayaan tak boleh menutupi permintaan tolong. Window
  `PET_TRANSIENT_MS` = 45 dtk sejak `createdAt` notifikasinya; komponen menjadwalkan **satu**
  `setTimeout` tepat pada saat luruhnya, bukan denyut.
- **Terputus adalah kondisi, bukan ketiadaan kondisi.** `api/events.ts` mengekspos `eventsStatus`
  / `subscribeStatus` di atas socket `events` yang sudah ada — tanpa channel, endpoint, atau poll
  baru (ADR-0039). Hook pembacanya `useEventsStatus` hidup di **`api/live.ts`** sejak SPEC-908 (dulu
  lokal di `screens/HanomanPet.tsx`): ia kini dipakai juga oleh `LiveConnectionBadge`
  (`ds/components/live.tsx`) yang dipasang di keempat layar realtime — lencana `warn` ber-ikon
  `wifi-off` yang muncul hanya setelah putus melewati grace **6 dtk**, dan **tak pernah** saat
  `paused`. `connected` menyala pada **frame pertama**, bukan pada `onopen`: socket terbuka
  adalah fakta transport, bukan fakta pengiriman (pelajaran terukur SPEC-878/ADR-0134). `paused`
  terpisah karena tab hidden menutup socket **atas permintaan kita**; menyebutnya gangguan berarti
  tiap kembali dari tab lain memudarkan pet, dan jam "tak terhubung sejak" karena itu **dinolkan**
  saat tab aktif lagi. Grace `PET_OFFLINE_MS` = 6 dtk menelan tiga percobaan reconnect (backoff
  0,5 → 1 → 2 → 4 → 8 → 10 dtk) supaya satu blip tak memudarkan pet. Sebelum SPEC-897 status ini
  tak ada sama sekali: `sessions`/`backlog` membeku dan pet tetap memamerkan "sedang bekerja".
- **`deciding` di bawah `waiting`, bukan di atasnya.** Sesi yang dilayani hanoman-lead tak meminta
  apa-apa dari manusia; sesi ber-`decision` meminta. Sebelum SPEC-897 keadaan ini menyamar jadi
  `working`, sehingga "agen sedang mengetik" dan "lead sedang memutuskan untuknya" terlihat sama.
- **Tidur hanya menggantikan lantai.** `PET_SLEEP_MS` = 30 menit sejak `quietSince`, yang dicap
  ulang tiap kali `petPulse` (id sesi hidup + `createdAt` notifikasi terbaru) berubah. Selama satu
  saja kondisi masih terdaftar pet **tetap terjaga** — termasuk atas sesi gagal yang tak ditengok
  dan backlog yang tertahan dependency. Tidur berarti "tak ada yang meminta apa pun darimu".
  `quietSince` disemai saat mount: membuka dashboard membuat pet terjaga 30 menit lagi.
- **`transientUntil` menjadi `recheckAt`.** Maknanya melebar dari "kapan pose transient luruh"
  menjadi "kapan pandangan ini berhenti benar **tanpa data baru**" — tiga hal memakainya (luruh
  transient, habisnya grace terputus, onset tidur) dan ketiganya dilayani **satu** `setTimeout`.
  Tak ada interval, tak ada denyut.
- **`review` memakai `stage === "done"`, bukan `exited`.** Agen adalah TUI interaktif: pada jalur
  sukses pane **tak pernah** mati (SPEC-433), jadi `exited` sendirian adalah gerbang yang nyaris
  tak pernah menyala. `Spec.stage` diturunkan server dari bukti yang sama (fase terminal + plan
  terceklist, ADR-0029) dan memang bergerak. Karena itu pula `working` mengecualikan sesi ber-spec
  `done`: pane hidup di atas backlog selesai bukan sedang bekerja, ia menunggu dilihat.

**Atlas & manifest.** `internal/assets/pet/hnm-pet-anoman-atlas-v02.webp` + `pet.json` (PET-001,
`version: 2`): sel 192×208, 8 kolom, **16 baris** (`idle, walk-right, walk-left, working, waiting,
blocked, review, shipped, docs-updated, wave, deciding, sleep, thanks, held, falling, dizzy` — enam
terakhir dari SPEC-897/898/904, ditambahkan di EKOR supaya indeks baris lama tak bergeser),
karakter berdiri 168 px, jangkar kaki x 0,62 / baseline 202. Baris ke-13 memaksa `quality` WebP
turun 82 → 76 untuk **seluruh** atlas; baris ke-14–16 (SPEC-904) memaksa **plafon**-nya naik 1 MB →
1,3 MB dengan `quality` tetap 76, karena `quality` adalah tuas yang lemah di atlas ini (q76 → q20
hanya −34 %) dan biaya decode mengikuti **piksel**, bukan byte. Atlas yang dikomit 1 165 556 B
(1536×3328); angka pengukurannya di `internal/assets/pet/README.md`. Atlas v01 **dihapus**, tidak
disimpan berdampingan.
`pet-sprite.ts` memvalidasi manifest (validator tangan — `zod` tak bisa di-resolve dari paket
`src`), memetakan pose → baris (`POSE_ROW`; hanya `ready → idle` yang berganti nama),
`durationMs = columns / fps × 1000`, dan rantai `then` untuk baris sekali-putar (`shipped`, `wave`,
`thanks` → `idle`). `POSE_ROW` memetakan **sepuluh** pose ke enam belas baris; `offline` sengaja
menumpang baris `idle` — yang dikatakan pet saat terputus adalah "aku tak tahu", dan itu diucapkan
oleh pudar + kalimat, bukan oleh gerak baru. `thanks` **bukan** pose sama sekali: ia baris reaksi
yang hanya bisa dipilih `oneShot`, jadi ia tak muncul di `POSE_ROW` dan tak menambah `PetPose`.
`held`, `falling`, dan `dizzy` (SPEC-904) sama: ketiganya baris interaksi untuk pet yang **diseret**
— terangkat, turun perlahan, pusing sesaat lalu berdiri lagi — dan sejak SPEC-905/ADR-0144 dipakai
oleh **mode** bernama sama di `pet-walk.ts`, bukan oleh `POSE_ROW`. `wave` diregenerasi SPEC-904 supaya bisa diputar
**berulang** tanpa kedip sambungan: frame 8 kini satu langkah sebelum frame 1 (tangan di pinggul),
bukan salinan pose istirahat, sementara manifestnya tetap `loop: false, then: "idle"` —
`loop: true` akan membuat animasinya `infinite` sehingga `onAnimationEnd` tak pernah menyala dan
`oneShot` tak pernah dibersihkan. SPEC-905 memakai keleluasaan itu: selama pointer menempel (atau
tombolnya fokus keyboard) `wave` diputar **berulang**, dan keputusan lanjut/berhenti hanya diambil
di `animationend` — yaitu tepat di **batas putaran**, sehingga lepas hover tak pernah memotong
lambaian di tengah. `oneShot.id` karena itu wajib **penghitung naik**, bukan `Date.now()`: `key`
React pada `<img>` adalah `${row}:${id}`, dan dua putaran yang selesai di milidetik yang sama memberi
`key` identik sehingga animasinya tak restart dan lambaian berhenti diam-diam. Gerbang barunya
`isHandled(mode)` — melambai sambil diangkat, jatuh, atau pusing sama berbohongnya dengan melambai
sambil tidur. Pipeline pembuatannya (Codex → key → registrasi → QA → atlas) di
`internal/assets/pet/README.md`. Sticker `STK-*` tetap di katalog ilustrasi tetapi **tak lagi
dipakai pet**.

**DOM & kepemilikan transform.** Grammar SPEC-648 dipertahankan: tiap pemilik `transform` adalah
elemen sendiri, keyframe hanya menulis `transform`/`opacity`, tanpa JS per frame, tanpa
rAF/interval.

```
pet-root     relative · width 100% · tinggi 1 sel × s (66 px saat disembunyikan) · pointer-events:none · z 80
             di slot Shell: .hn-shell-dock (desktop) atau .hn-shell-lane (tablet/ponsel) — bukan fixed
└─ pet-actor   transform: translate(var(--x), calc(-1 * var(--y))) · transition: transform <segmen> <linear|fall>
   ├─ pet-bubble  gelembung bicara · di LUAR live region · pointer-events:none (tombol rekap auto)
   ├─ pet-stage   role=status aria-live=polite · hn-pet-reveal
   │  ├─ pet-reactor   hover/klik
   │  │  └─ pet-viewport   overflow:hidden · width 192s · height 208s · opacity 0,45 saat pose offline
   │  │     └─ pet-rowshift   height 208s · transform: translateY(calc(var(--row) * -100%))
   │  │        └─ img.hn-pet-atlas   width 1536s · animation: hn-pet-frames var(--dur) steps(8,end) <count> <fill>
   │  ├─ span.hn-sr-only   kalimat status
   │  ├─ span.pet-badge   lencana hitungan · aria-hidden · pointer-events:none
   │  ├─ span.pet-hearts  3 hati saat dielus · aria-hidden · pointer-events:none
   │  └─ button.hit   44×44 di kaki · pointer-events:auto · .hn-pet-hit (touch-action/user-select) · pegangan seret
   └─ panel   popover · dijangkar ke pet, di-clamp viewport · daftar SEMUA kondisi
```

Satu `<img>` atlas; frame oleh `steps(8, end)` atas `translateX(-100%)` (`-100%` = lebar img = 8
sel, jadi bebas skala dan bebas `var()` di keyframe), baris oleh `--row` pada `.hn-pet-rowshift`.
Baris `loop: false` memakai `animation-iteration-count: 1` + `forwards`; `animationend` (difilter
`animationName === "hn-pet-frames"` dan baris yang sedang aktif) mengganti ke baris `then` atau
melepas `wave`. Pergantian baris sekali-putar memakai `key` React pada img agar animasi mulai dari
frame 1. Skala `s` = tinggi karakter / `character.h`: **112 px** desktop & tablet, **96 px** mobile
(`useResponsiveTier`). Katalog motion SPEC-648 (`pet-motion.ts`, `hn-pet-idle-*`, `hn-pet-pose-*`,
`hn-pet-celebrate`, token `--dur-pet-*`) **dicabut** oleh Pet hidup A — gerak pose kini datang dari
frame yang digambar, bukan dari transform di atas satu raster; `hn-pet-reveal`, `hn-pet-click`, dan
`hn-pet-panel-*` tetap.

**Mesin berkeliaran** (`pet-walk.ts`, murni: `stepWalk(state, input, rng)` menerima keadaan +
masukan + `rng` dan mengembalikan keadaan baru, baris yang harus diputar, dan perpindahan):

| kondisi | perilaku |
|---|---|
| `dragging` (SPEC-905) | **menang atas semua baris di bawah** — `mode: "held"`, baris `held`, `x`/`y` = pointer di-clamp jalur & plafon angkat, `durationMs = 0` |
| dilepas dari `held` (SPEC-905) | `mode: "falling"`, baris `falling`, `y → 0` dengan `ease: "fall"` selama `max(220, y/240 × 1000)` ms; `parkedX` dicap di sini |
| mendarat (SPEC-905) | `mode: "dizzy"` selama `durationMs("dizzy")` = 1000 ms, lalu baris pose + jadwal **berdiri** baru — bukan langsung jalan lagi |
| `tier === "mobile"` ∨ `reduced` ∨ `!roam` | di **`parkedX`** bila pernah diseret, selain itu di **rumah** (`x = laneWidth − petWidth − margin`), menghadap kanan, `durationMs = 0` |
| `offline` ∨ `sleeping` | **diam di tempat** — transisi dipotong di posisi saat ini, arah hadap dipertahankan, tak pulang ke pojok |
| pose tenang: `ready`, `working`, `deciding`, `review`, `docs-updated` | bergantian **berdiri 1,2–4,5 dtk** (baris pose) dan **jalan 5–14 dtk** @ 40 px/dtk ke target acak dalam `[margin, laneWidth − petWidth − margin]`; baris `walk-right`/`walk-left` sesuai arah; sampai → berdiri |
| pose perhatian: `waiting`, `blocked` | `mode: "home"` — jalan pulang ke pojok kanan bila belum di sana, lalu berdiri memutar baris pose; kabar penting selalu di tempat yang sama |
| `shipped` | berhenti di tempat, baris `shipped` sekali → `idle` (lewat `then`), lalu aturan tenang |
| `hovered` ∨ `panelOpen` ∨ `documentHidden` | berhenti (transisi dipotong di posisi saat ini); masuk hover → `wave` **berulang** sampai hover lepas (SPEC-905) |
| resize (`laneWidth` berubah) | `fitWalk` (QA run3): rencana yang sedang berjalan dihentikan, `x` di-clamp ke jalur baru, jadwal berdiri dimulai ulang. Posisi yang digambar juga di-clamp tiap render (`clampMove`) |
| lebar jalur belum terukur (0) | tak ada langkah dan aktor tak dirender; rencana pertama dimulai di rumah (`tick` di `HanomanPet.tsx`). Tanpa fallback ke `window.innerWidth`, yang dulu menempatkan pet di 1280 px di sidebar 248 px |

Penjadwalan: **satu** `setTimeout` pada `state.until` + `transitionend` pada `pet-actor` (difilter
`propertyName === "transform"`) + `visibilitychange` + `resize` (debounce 150 ms). Tanpa interval.
Sejak SPEC-905 `transitionend` yang sama juga menutup fase `falling` — pendaratannya tetap dinilai
dari **jam** (`now ≥ state.until`), peristiwanya hanya membangunkan langkah. `currentX` dibaca dari
`getBoundingClientRect()` hanya pada peristiwa, bukan per frame (jsdom memberi rect nol → jatuh ke
posisi keadaan).

**Pet diseret** (SPEC-905 · ADR-0144). `PetWalkState` bertambah `y` (px di atas lantai jalur) dan
`parkedX`; `PetMove` menjadi `{ x, y, durationMs, ease }`; tiga mode `held`/`falling`/`dizzy` duduk
di **kepala** `stepWalk`, di atas `anchored()` — fisika tak boleh diinterupsi pergantian pose.
Gesturnya Pointer Events di tombol 44 px yang sudah ada (`pointerdown` + `setPointerCapture` +
`pointermove`/`pointerup`/`pointercancel`); **bukan** drag-and-drop HTML5, dan tanpa listener di
`document` — capture sudah mengarahkan seluruh peristiwa ke tombolnya. Delapan hal yang tak terbaca
dari kodenya:

- **Ambang 6 px memisahkan klik dari seret.** Di bawahnya gestur tetap klik → panel + elus SPEC-898
  utuh; melewatinya ia seret dan `click` yang menyusul `pointerup` **ditelan** supaya `thanks` tak
  ikut terpicu.
- **Koordinat dihitung sebagai SELISIH, bukan dari `getBoundingClientRect()`**
  (`dx = clientX − currentX()`, `dy = clientY + y`). Offset jalur saling menghilangkan, jadi rumus
  yang sama benar di browser **dan** bisa di-assert di jsdom yang memberi rect nol.
- **Jalur TIDAK melebar saat diangkat (lajur pet, Audit UI/UX 2026-10).** Dulu jalur `position: fixed` melebar
  ke `var(--safe-top)` selagi `held`/`falling`, dan plafonnya dibaca dari rect yang sudah melebar. Sekarang
  jalur ada di alur layout: melebar berarti konten bergeser. Pet yang diangkat melayang di atas konten
  (manipulasi langsung oleh manusia); plafonnya tinggi viewport (`laneHeight()`), dan `pointer-events: none`
  di root tetap berlaku — `elementFromPoint` di bawah jalur tetap mengembalikan konten dashboard.
- **Satu properti `transform` untuk kedua sumbu, juga saat `y = 0`.** Daftar properti yang
  di-transisi tak boleh berganti di tengah rantai berjalan → diangkat → jatuh → mendarat.
  `ease: "fall"` = `cubic-bezier(0.55, 0.085, 0.68, 0.53)` (easeInQuad — percepatan, bukan linear).
- **`cut()` menyempit ke `walk`/`home`, dan `land()` selalu memancarkan `y → 0`.** Memotong transisi
  pet yang sedang jatuh sama dengan menghapus jatuhnya; dan `move: null` pada jalur `reduced` yang
  tak pernah melewati `falling` akan meninggalkan sprite **di udara**, karena komponen menyimpan
  `move` terakhir.
- **`dizzy` kembali ke pose lewat `until` mesin, bukan lewat `thenOf`.** Manifest menulis
  `then: "idle"`, dan rantai itu berbohong saat pose mesinnya `working`.
- **`parkedX` adalah titik jangkar; predikat `anchored()` tak berubah** dan **seret nyala di semua
  tier, termasuk mobile** — `anchored()` melarang gerak *otonom*, bukan manipulasi langsung yang
  diminta manusia. Tanpa `parkedX`, justru pengguna "Diam di pojok", `prefers-reduced-motion`, dan
  mobile yang pet-nya melompat balik ke pojok begitu dilepas. `prefers-reduced-motion`: seret tetap
  boleh, jatuh **seketika**, `dizzy` **dilewati**. Posisi **tidak** persisten antar-muat halaman.

**Pet bicara** (SPEC-898; templat murni di `src/src/screens/pet-speech.ts`, tanpa LLM). Empat hal:

- **Gelembung pose.** Satu baris di atas kepala saat kalimat pet berubah. Himpunannya **tertutup**:
  `shipped`, `docs-updated`, `waiting`, `offline` — dan hanya itu. `Toast` design system sudah
  duduk di tengah-bawah untuk aksi pengguna, sedangkan keadaan mapan (`working`/`review`/`blocked`/
  `deciding`/`ready`) yang bergelembung tiap kali sebuah sesi lahir adalah kebisingan, bukan kabar.
  Pembandingnya **teks kalimat**, bukan `kind`: `waiting` yang menua dari biasa ke mendesak adalah
  kabar baru walau `kind`-nya sama. Perbandingan dilakukan **saat render** (pola yang sama dengan
  `seenPulse`), jadi pet tak berteriak saat mount. Umur 5 dtk lewat satu `setTimeout`; gelembung
  baru menggantikan yang lama beserta timernya. Ia `aria-hidden` — region `role="status"` sudah
  membacakan pergantian pose, dan gelembung yang ikut diumumkan berarti kabar yang sama terdengar
  dua kali dengan dua rumusan berbeda. **Kecuali gelembung `waiting`** (SPEC-899): ia menumbuhkan
  CTA "Jawab di sini", dan elemen di dalam `aria-hidden` tak bisa difokuskan sama sekali — jadi
  yang `aria-hidden` pindah ke `<span data-testid="pet-bubble-text">`-nya, dan janjinya tetap
  dipegang: region status tetap satu-satunya yang membacakan kabar, tombolnya membawa kalimatnya
  di `aria-label` (pola yang sama dengan tombol `Lihat` milik rekap).
  Panel yang terbuka menelannya: daftarnya sudah di layar.
- **Rekap "selama kamu pergi".** Snapshot (`petSnapshot`: id sesi → kondisinya + `createdAt`
  notifikasi terbaru) dicap saat tab jadi **hidden**, dibandingkan saat ia terlihat lagi. Setelah
  `PET_AWAY_MS` = 5 menit, `petRecap` memberi satu kalimat berisi tiga angka — `2 selesai ·
  1 menunggu · 1 gagal` — dan bagian bernilai nol dibuang (kembali ke tab yang sepi tak boleh
  disambut "0 selesai"). "Selesai" dihitung dari **feed** notifikasi, bukan dari kondisi yang
  sedang menyala: `shipped` meluruh 45 dtk dan operator yang pergi 20 menit tak akan pernah
  melihatnya. Snapshot **wajib** dicap saat hidden; mengambilnya saat visible berarti ia dicap
  ulang tiap render dan diff-nya selalu kosong. Karena `api/events.ts` baru menyambung ulang saat
  tab aktif, snapshot ditahan `RECAP_GRACE_MS` = 5 dtk sesudah kembali sampai frame pertama tiba.
  Gelembung ini hidup 12 dtk, **tidak** `aria-hidden`, dan membawa satu tombol `Lihat` yang membuka
  panel — satu-satunya hit area tambahan di jalur pet, transient, kelas yang sama dengan panel dan
  bukan pelebaran badan pet (SPEC-763).
- **Urgensi menurut umur.** `isUrgent` = `kind === "waiting"` ∧ `since !== null` ∧
  `now − since ≥ PET_URGENT_MS` (10 menit). Efeknya dua: gelembung menyebut durasinya
  (`SPEC-612 butuh jawabanmu — 12 menit`) dan durasi animasi baris `waiting` dibagi
  `PET_URGENT_RATE` = 1,5 (fps 6 → 9), digerbangi **baris** supaya `wave`/`thanks` yang menumpang
  tetap berirama normal. Onsetnya dilayani `recheckAt` yang sudah ada — pemakaian **keempat** field
  itu — jadi pet berubah tepat pada menit ke-10 tanpa satu pun denyut. `since` diturunkan dari
  `decisionAt` (ADR-0141; sejak ADR-0143 = awal episode yang SEDANG berlangsung, bukan onset marker
  yang bisa jauh lebih tua): absen berarti tak diketahui, dan pet **tak pernah** mengeskalasi tanpa
  stempel.
- **Dielus.** Tiga klik dalam 2 dtk memutar baris `thanks` sekali (lewat `oneShot`, mekanisme
  `wave`) plus tiga hati `♥` ber-`hn-pet-heart`. Klik ke-3 **tidak** menyentuh panel sama sekali —
  itulah isi "tidak membuka/menutup panel berulang"; klik pertama & kedua tetap buka lalu tutup,
  karena itu perilaku normal dua klik dan tak boleh diubah demi easter egg. Reduced-motion tak
  memutar `thanks` maupun merender hati.

**Inbox keputusan** (SPEC-899 · ADR-0142; `src/src/screens/PetAnswer.tsx`). Baris kondisi `waiting`
di panel menumbuhkan **satu kotak jawaban per sesi**, bukan satu untuk kondisi. Daftar sesinya lahir
dari `waitingSessions(sessions, backlog)` di `pet-state.ts`, yang memakai `sessionKind` yang sama
dengan panel & rekap — predikat kedua (`decision && !deciding`) yang disalin ke pemakai ketiga
adalah kelas bug SPEC-431/448, dan sesi yang sedang dipegang lead memang tak boleh muncul di sini.

Komponen sendiri, bukan blok di `HanomanPet.tsx`: siklus hidupnya (muat → kirim → terkirim →
`409` muat ulang) tak berhubungan dengan mesin berkeliaran, gelembung, dan a11y panggung yang
dipegang komponen itu. Ia di-mount digerbangi **`open`**, bukan `panelMounted` — panel yang sedang
beranimasi keluar masih ter-mount, dan kotak yang lahir di sana akan memanggil endpoint dialog
untuk panel yang justru sedang ditutup.

- **Memuat** saat mount → `api.sessionDialog(id)`. Tak ada polling dan tak ada channel baru
  (ADR-0039 utuh): keadaan "sudah terjawab" datang dari siaran `sessions` yang sudah ada, yang
  meng-unmount kotak ini begitu sesinya berhenti `waiting`. **SPEC-903 · ADR-0143 ·** yang
  memadamkannya BUKAN hook `UserPromptSubmit` — hook itu tak pernah menembak untuk jalur ini
  (jawaban dialog adalah tool result, bukan prompt). Yang memadamkannya dua: route
  `POST /terminal/sessions/:id/dialog/answer` yang berhasil mengosongkan marker, dan gerbang
  `paneQuiet` begitu agen kembali mengeluarkan sesuatu.
- **Single-select** = judul + satu tombol per opsi; satu klik mengirim `{ screenHash, choice }`.
  **multiSelect** = `Checkbox` per opsi (nilai awal dari `checked` layar) + satu `Submit` yang
  mengirim `{ screenHash, choices }`. **Kolom bebas** (`freeIndex !== null` atau `notes`) menambah
  satu `<input>`; di layar single ia punya tombol `Kirim` sendiri, di layar multi ia ikut `Submit`.
- **Terkirim** mengganti kotak dengan satu baris "Terkirim — menunggu <sesi> bergerak".
- **`409`** dibedakan lewat `reason`, bukan lewat prosa: `stale` memuat ulang pertanyaannya satu
  kali (layarnya memang sudah berganti), `deciding` berkata lead yang berhak, sisanya menyuruh
  operator ke Terminal. `204` (tak ada dialog yang bisa dijawab di layar itu — termasuk dialog
  trust & prompt izin, yang **sengaja** tak pernah dilaporkan) menjadi kalimat, bukan tombol.

**Pertanyaan dari payload event, bukan dari scrape** (SPEC-909 · ADR-0146). `PetAnswer` menerima
prop `ask?: SessionAsk` yang datang dari frame siar **`leadAsks`** — kanal `/api/events/ws` yang
sudah ada, tanpa WebSocket kedua (ADR-0039 utuh). Pembagian dua sumbernya tegas, dan itu yang
membuat keduanya tak pernah berselisih:

- **`ask` menjawab "APA pertanyaannya"** — payload tool `AskUserQuestion` apa adanya, bukti dari
  agennya sendiri, tiba seketika (terukur 32–164 ms sesudah agen bertanya), tak pernah terpotong
  lebar pane. Ia dirender **di atas** ketiga cabang keluar, termasuk saat `GET …/dialog` menyerah —
  itulah kasus yang dulu melahirkan `"Pertanyaannya tak terbaca dari sini"`.
- **`payload` menjawab "BARIS MANA yang ditekan"** — `screenHash` + nomor opsi, yang memang hanya
  ada di layar. Tombol, checkbox, kotak teks, dan `send()` tetap memakainya apa adanya; pagar
  SPEC-899/ADR-0142 berdiri utuh.

Yang ditampilkan `ask`: **status lead** (`hanoman-lead mengantre` / `sedang menyusun` / `sudah
menjawab` / `Kamu yang menjawab sesi ini` / `tak sanggup`, satu tabel kalimat di satu tempat),
**langkah rantai** (`Pertanyaan n dari N` dari `at`/`total` — untuk `ask` yang ada, rumus lama
berbasis `dialog.tabs` sengaja dimatikan supaya barisnya tak dobel), dan **pertanyaan aslinya**.

Sesi **codex** tak punya `AskUserQuestion`: `questions` kosong dan yang ada cuma `message` = teks
giliran terakhirnya. Pet mengatakannya apa adanya lewat eyebrow `Giliran terakhir sesi`, bukan
merendernya sebagai pertanyaan berpilihan yang opsinya tak ada.

**Ambil alih** (AC-6). Tombol `pet-answer-takeover` memanggil
`POST /terminal/sessions/:id/dialog/takeover` dan menghentikan lead **sebelum** ia mengetik ke pane;
`409 answering` berarti terlambat dan dikatakan begitu ("hanoman-lead sudah mengirim jawabannya ke
pane"), bukan diam. Sesudah `state = "taken-over"` tombolnya hilang — tak ada lagi yang bisa
direbut. Satu baris catatan saja yang dirender, dan hasil aksi terakhir MENANG atas kalimat
keadaan: dua `pet-answer-note` sekaligus membuat operator membaca yang salah.

Tanpa `ask` — server yang lebih tua (ADR-0087 mengizinkan dashboard lebih baru), sesi pra-pembaruan,
atau frame yang belum tiba — seluruh blok ini tak dirender dan kotaknya berperilaku **persis seperti
sebelum SPEC-909**, termasuk kalimat `"Pertanyaannya tak terbaca dari sini"`.

Gelembung pose `waiting` menawarkan **"Jawab di sini"** yang menutup gelembung lalu membuka panel —
jalur yang sama persis dengan tombol `Lihat` milik rekap.

**Penempatan & mount (Audit UI/UX 2026-10 · lajur pet; [ADR-0206](../adr/0206-pet-footer-sidebar-default-per-tier.md)).** `HanomanPet` dibuat **sekali** di `App.tsx`
(satu elemen, di dalam `PetDockContext.Provider` yang membungkus `{screen}`; `petOn` = preferensi
`hn.ui.v1.pet.enabled` atau default tier, lihat `ui-state/pet-pref.ts`). `Shell` menaruhnya di slot:
`.hn-shell-dock` di footer sidebar (desktop) atau `.hn-shell-lane` di bawah `<main>` (tablet/ponsel).
Pet tak lagi `position: fixed`: jalurnya ada di alur layout, sehingga tak ada kontrol yang tertutup dan
tak ada `z-index` pet yang harus dijaga terhadap header, modal, dan toast. Tablet dan ponsel: lajur selalu setinggi
**chip 56 px** (`LANE_CHIP_H`, rata kanan, tombol 44 px), tak pernah lebih tinggi meski pet dibangkitkan — sprite
lalu melayang di atas lajur sebagai overlay sementara (`peek`), ditutup Esc atau klik di luar root (Esc saat panel
terbuka menutup panel dulu). Layar tanpa Shell (Dalang)
tak punya slot dan tak menampilkan pet. Pet tetap dibuat di App, bukan di Shell, karena `<Shell>` ditulis
ulang di tiap cabang `section`: pet yang tinggal di sana lahir kembali tiap navigasi.

**Interaksi & preferensi.** Klik = panel + `wave` sekali + berhenti; hover/fokus = berhenti +
`wave` **berulang** sampai hover lepas (SPEC-905). Gerbangnya `canWave()`, dan daftarnya jangan
disalin: ia `!reduced ∧ pose ∉ {offline, sleeping} ∧ !dragging ∧ !isHandled(mode)` — melambai atas
data basi, sambil tidur, atau sambil diangkat/jatuh/pusing sama-sama berbohong, dan `isHandled`
adalah satu-satunya tempat ketiga mode fisika itu dinamai (mode keempat cukup ditambahkan di sana). Panel dijangkar ke posisi pet saat buka
(`left = clamp(pusat − 134, 12, vw − 268 − 12)`) dan duduk di atas jalur. Isinya **daftar seluruh
kondisi aktif**, bukan hanya puncaknya: satu baris per kondisi, masing-masing dengan detail,
lencana hitungan kecil saat `count > 1`, dan tombol `Buka Terminal`/`Buka Backlog` ke **targetnya
sendiri** — sebelum SPEC-897, operator dengan satu sesi gagal dan dua sesi menunggu hanya punya
satu tombol, dan tombol itu membuka sesi yang gagal. Baris pertama memakai tipografi headline
alih-alih diberi blok terpisah di atas daftar: blok terpisah menuliskan kondisi puncak dua kali di
panel selebar 268 px. Baris ber-`target: null` (yakni `offline`) tak punya tombol. Klik memasang `hn-pet-click` sekali dan membersihkan state melalui `animationend`
yang difilter menurut nama, bukan timer. Ringkasan memisahkan `open` dari `panelMounted`:
tutup/Escape/klik-luar membuat panel `aria-hidden`, inert, dan tidak menerima pointer selama
`hn-pet-panel-out`, lalu unmount pada `animationend`. Tombol `Diam di pojok`/`Berkeliaran`
menyimpan `hanoman.pet.roam` (default berkeliaran; tier mobile dipaksa diam dan tombolnya
disembunyikan). `hanoman.pet.hidden` + pegangan buntut 44 px tak berubah: disembunyikan berarti
**menyusut**, bukan lenyap.

**Aksesibilitas & reduced motion.** Atlas `alt=""` + `aria-hidden`; kalimat status (`Hanoman
<label> · <headline>`) hidup di `span.hn-sr-only` di dalam `role="status" aria-live="polite"` —
menggantikan "alt bermakna di gambar" SPEC-585, karena satu gambar yang isinya berganti-frame tak
punya alt yang jujur. Saat `count > 1` kalimat itu bertambah ` · <count> <KIND_NOUN[kind]>` —
lencananya sendiri `aria-hidden` dan `pointer-events: none`, dan justru itulah yang menjaga kalimat
tetap satu-satunya sumber (angka telanjang di pojok sprite tak punya satuan bagi pembaca layar,
dan hit area kedua akan melanggar gerbang tap SPEC-763). Satu sumber kalimat, tanpa teks
tersembunyi kembar. Panel yang sedang keluar
inert agar kontrol tersembunyi tidak dapat menerima fokus. `prefers-reduced-motion: reduce` dibaca
di JS (`window.matchMedia`, ikut mendengarkan perubahan; ketiadaannya berarti tidak reduce): saat
aktif, `animation` dan `transition` menulis nilai eksak `none`, pet tak berkeliaran, dan `wave`/
`thanks` tak pernah dipasang — motion mati total tanpa membuat status hilang. **Menyeret tetap
boleh** (SPEC-905): ia manipulasi langsung yang diminta manusia; yang dimatikan adalah jatuhnya
(seketika) dan pusingnya (dilewati), dan pet berhenti di tempat terakhir ia diletakkan — belum
tentu pojok. Gelembung bicara
tetap **tampil** di sana (ia informasi, bukan gerak) hanya tanpa `hn-pet-bubble-in`; hati tak
dirender sama sekali.

**Gerbang tap (SPEC-763, diperluas).** Jalur pet selebar slotnya dan setinggi satu sel — ia duduk di alur
layout, jadi "tak menutupi kontrol" ditegakkan oleh tata letak, bukan koordinat. `pet-root` dan seluruh
pembungkusnya `pointer-events: none`; hanya tombol 44 px di kaki sprite (ikut berpindah bersama pet),
pegangan, dan panel yang `auto`. Tak boleh ada anak ber-`pointer-events: auto` baru yang tak perlu.
Pengukuran SPEC-905 di bawah ini dibuat saat jalur masih `fixed`; angka posisinya tetap berlaku, tetapi
pelebaran vertikalnya sudah dicabut. Terukur lewat CDP: 1280×800 jalur 1265 px: atlas termuat, `animation-name: hn-pet-frames`, transform frame −256 → −640 px dalam 400 ms, actor 1136 → 1027,4 px (`mode: walk`, baris `working` lalu `walk-left`), dan tombol di bawah jalur tetap dijawab `elementFromPoint`; 390×844: actor diam di rumah 264 px, `mode: stand`, tak satu pun baris walk muncul, frame tetap berjalan, tap tetap tembus.

**Tanpa ADR untuk SPEC-897, dan itu disengaja.** Tak ada endpoint, skema, poll, atau channel yang
berubah; status koneksi adalah pengamat socket `events` yang sudah ada, dan dua baris atlas
menumpang keluarga aset & pipeline yang sudah ditetapkan ADR-0140. Yang bertambah adalah isi tabel
prioritas dan bentuk panel — konvensi, bukan arsitektur. ADR-0039 (tanpa realtime baru), ADR-0093
(dependency berumur panjang), ADR-0134 (fakta pengiriman ≠ fakta transport), dan ADR-0140 semuanya
**ditegakkan**.

**Yang tak dikerjakan, berikut alasannya.** Fase sesi tak masuk headline karena
`ProjectView.session.phase` hanya dimuat sekali saat login (`projects` tak didorong WS) sehingga
bisa basi berjam-jam — `Spec.stage` menjawab pertanyaan yang sama dan hidup. Pet berskop workspace
dan sengaja **tak** mengikuti `projectFilter`: ia hadir juga di halaman yang tak punya filter itu.

**Pengujian.** `pet-state.test.ts` (tabel prioritas, eksklusivitas kondisi, terputus, deciding,
tidur, `recheckAt`), `events.test.ts` (status koneksi: frame pertama vs `onopen`, `paused`, jam
putus), `pet-sprite.test.ts` (manifest 16 baris + `POSE_ROW` + kontrak CSS terparse),
`pet-walk.test.ts` (tabel mesin + seret/jatuh/pusing/`parkedX`), `hanoman-pet.test.tsx`
(render/interaksi/reduced/roam/mobile/jalan + lencana/panel berdaftar/pudar + gestur seret, plafon
angkat, ambang klik-vs-seret, lambaian menetap), `pet-mount.test.tsx` (mount tunggal + sumber
artwork),
`internal/scripts/pet/test-petlib.py` (pipeline atas lembar sintetis).

## DalangStage — hero Overview: Anoman sebagai dalang

> **Fase 3B:** hero ini tak lagi dirender Overview (lihat § Fase 3B di atas). **Fase 2E:** berkas dan test-nya sudah
> dihapus (lihat § Fase 2E). Uraian di bawah menggambarkan kondisi sebelum Fase 3B dan dipertahankan sebagai sejarah.

Metafora produk dinaikkan ke permukaan: Overview dibuka `DalangStage`
(`src/src/screens/DalangStage.tsx`), panel kelir tempat Anoman-dalang "memainkan" project.
Sumber "hidup"-nya **`sessions` dari siaran WS `t:"sessions"`** — BUKAN `ProjectView.session`,
yang hanya dimuat saat login dan basi berjam-jam (catatan pet di atas; versi pertama panel ini
memakainya dan karena itu diam saja saat task berjalan). Kosakatanya cermin `pet-state.ts` &
sel Terminal: hidup = `!exited` (diurutkan per id — urutan `tmux list-panes` bergeser tiap
siaran), menunggu manusia = `decision && !deciding` → wayang **amber, diam menoleh**
(`hn-dalang-puppet--still`, `data-waiting`), yang `deciding` dilayani lead tetap terbaca
bekerja. Satu sesi hidup = satu **wayang dimainkan** — kartu gelap `--term-bg` ber-rim brass
(`color-mix` atas `--brass-500`, cermin `--ring`) berisi siluet wayang SVG yang bergoyang
(`hn-dalang-sway`, transform-only → compositor, padam otomatis oleh blok
`prefers-reduced-motion` global) plus nama project + `Spec.stage` (overlay live; fase sesi tak
ada di wire `TerminalSession`); klik → `setFocusSession(id)` + section terminal (jalur yang
sama dengan pet). Project tanpa sesi hidup = chip **wayang parkir** di baris debog
(`hn-dalang-debog`); klik → detail project. Kartu "Claude Code sedang jalan" + KPI "Sesi aktif"
Overview ikut pindah ke sumber yang sama. **Figurnya keluarga aset sendiri** sejak aset Codex
menggantikan maskot registry (MPS-004/003): `internal/assets/dalang/` — sang dalang **enam
lengan** ber-gapit kosong (wayang-nya kartu sesi), satu wayang project per kartu hidup, dan
blencong di header yang "menyala" lewat `data-lit` + drop-shadow CSS hanya saat ada sesi
(asetnya sengaja digambar tanpa glow). Frontend mengimpor **versi display** (512/384/256,
±134 KB total) — master q90 tinggal di `master/` dan tak pernah masuk bundel (pelajaran 5,5 →
46,1 MB registry illustration). Rekaman produksi + prompt + cara regenerasi (chroma key
`petlib.chroma_key`) di README direktori aset itu. **Mode orkestrasi**: saat ada sesi hidup,
`.hn-dalang-stage[data-live]` membalik kelir jadi panggung GELAP (permukaan gelap yang memang
milik kerja aktif) ber-pendar radial blencong, dan **benang gapit** — kurva brass ber-dash yang
mengalir (`hn-dalang-flow`) — digambar dari kipas tangan dalang ke tiap kartu wayang. Path-nya
DIUKUR dari `getBoundingClientRect` kartu nyata (kartu wrap, lebar berubah) via
`useLayoutEffect` + `ResizeObserver` (di-guard `typeof` — jsdom tak punya keduanya bermakna:
rect 0 → benang kosong, svg kontraknya tetap dirender dan itu yang dikunci test). Idle tetap
bone yang tenang — kontras itulah yang membuat momen orkestrasi terbaca.
Empat stat di header: **dikerjakan hari ini** (`Spec.startedAt` pada hari LOKAL ini —
komponen-per-komponen, bukan parse `YYYY-MM-DD` yang jatuh ke UTC, gotcha ADR-0090), sesi
berjalan, menunggu (`!startedAt && stage !== "done"`), dan total `done`. `doneAt` sengaja tak
dipakai: ia tidak ada di wire `zSpec` (hanya kolom DB/portal, ADR-0105).

Komponen murni presentasi — data dari props Overview (`projects`, `backlog`, `sessions`),
nol fetch baru, nol channel realtime baru (ADR-0039). Arah visualnya direkam sebagai concept art
di `internal/assets/concepts/dalang/` (4 state, digenerate Codex/GPT Image dengan pola pipeline
ADR-0140; enam lengan = pengecualian ikonografi sadar, dicatat di README direktori itu).
Pengujian: `src/test/dalang-stage.test.tsx` (state sunyi/running, hitung stat hari lokal,
navigasi klik, kontrak token warna).

## Dalang Hanoman — layar panggung orkestrasi sinematik

> **Fase 3B:** layar ini sudah dipangkas jadi papan status senyap (lihat § Fase 3B di atas). Uraian di bawah
> menggambarkan panggung sinematik sebelum Fase 3B.

Menu `dalang` ("Dalang Hanoman", ikon `drama`) membuka
`src/src/screens/DalangHanomanScreen.tsx` — implementasi layar dari konsep Claude Design
"Dashboard Futuristik" dengan **data nyata**, dirender **TANPA Shell sebagai takeover layar
penuh** (`position: fixed; inset: 0; z-index: 100` — kelas fullscreen Terminal; keluar via
tombol ✕ atau Escape → `setSection("overview")`; pet z-80 otomatis tertutup): **hero RIG
ber-sendi** — Hanoman dirakit dari 5 bagian (`internal/assets/dalang/hnm-hero-rig-*.webp`,
badan + 4 lengan **tanpa rantai tergambar** — semua tali digambar SVG oleh aplikasi,
bukan aset; geometri diukur otomatis `internal/scripts/dalang/rigbuild.py`) dalam kanvas
`aspect-ratio: 835/582` (ARM_SCALE 0.78 — lengan generasi terlalu tebal, dikecilkan murni
lewat geometri CSS),
tiap lengan `rotate` ±3° pada `transform-origin` cakram bahunya dengan durasi berbeda
(5–7 s) sehingga geraknya organik, bukan satu gambar mengambang — melayang di atas
**SEMUA project**: yang ber-sesi hidup jadi wayang menyala (satu kartu per sesi WS, klik →
fokus terminal; `decision && !deciding` = amber), yang tanpa sesi tetap tampil sebagai
**wayang redup** (`.hn-dlg-prj--off`, grayscale, tanpa goyang, klik → detail project).
**Benang gapit ke SEMUA wayang** — jangkar benang = 4 anchor `[data-hand]` di titik gapit
tiap tangan rig: lengan ATAS → benang emas mengalir ke wayang hidup, lengan TENGAH
(menjuntai) → benang kendur redup (`.hn-dlg-thread--slack`, utuh tanpa dash, melengkung ke
bawah, tanpa animasi) ke wayang diam — sang dalang selalu memegang seluruh panggung
walau nol sesi (pola pengukuran DalangStage), KPI
count-up, ticker boot yang mengetik fakta nyata, jam hidup per detik, donut distribusi
backlog per `zStage` (dirangkum done/executing/planned/sisanya→spec — kosakata stage BUKAN
"execute/plan", gotcha typecheck), dan chart "dimulai 7 hari" dari `startedAt` hari LOKAL.
Ini **satu-satunya layar gelap penuh** — dibenarkan peran warna DS "dark terminal = kerja
aktif": seluruh layar adalah panggung kerja aktif; aksen tetap brass, nol neon. Semua warna
lewat kelas `.hn-dlg-*` di `app.css`/token (dikunci test kontrak
`src/test/dalang-hanoman.test.tsx`; cabang section dijaga `app-router.test.tsx`). Animasi
transform/opacity + drop-shadow, padam di blok `prefers-reduced-motion` global; ticker &
count-up cek `matchMedia` sendiri karena berbasis JS.

## Tinggi & scrolling: rantai flex, bukan angka ajaib
`#root` memakai `100vh` sebagai fallback lalu dikunci `100dvh; overflow: hidden`, jadi tinggi yang
tersedia mengikuti dynamic viewport tanpa menyerahkan scroll kepada body.
Layar berdaftar tidak boleh menggulir seluruh halaman — filter bar dan Pager harus tetap
terlihat — jadi yang menggulir hanyalah area barisnya.

`LIST_SCROLL_STYLE` dulu `maxHeight: calc(100vh - 340px)`. `340` adalah tebakan tinggi
topbar + chrome card + pager, dan tebakan itu salah di tiap layar dengan takaran berbeda:
layar dengan filter bar lebih tinggi menyisakan lubang kosong di bawah, yang lebih pendek
memotong daftarnya. Angka itu juga tak punya cara untuk tetap sinkron saat chrome berubah.

Sekarang tingginya diturunkan rantai flex, tanpa angka:

| style | dipakai di | arti |
|---|---|---|
| `LIST_SCREEN_STYLE` | root layar | kolom flex, `flex:1 1 auto`, `min-height:0` |
| `FIXED_ROW_STYLE` | filter bar, header, legend, `Pager` | `flex:0 0 auto` — tak ikut menyusut |
| `LIST_SCROLL_STYLE` | area baris | `flex:1 1 auto`, `min-height:0`, `overflow-y:auto` |

`min-height: 0` itu kuncinya: tanpa ia, flex item menolak lebih pendek dari min-content-nya,
jadi daftar panjang mendorong Pager keluar layar alih-alih menggulir. `FIXED_ROW_STYLE` juga
bukan hiasan — default flex item adalah `flex-shrink: 1`, jadi header dan kartu **ikut
gepeng** kalau tidak dikunci.

Shell menyediakan ujung atas rantainya: pembungkus konten di `<main>` kini `min-height: 100%`
+ `box-sizing: border-box` + kolom flex. `min-height` (bukan `height`) supaya layar non-daftar
— Overview, Docs, Settings — tetap tumbuh melewati viewport dan digulir `<main>` seperti dulu;
dengan `height`, anak-anaknya jadi flex item bertinggi tetap dan ikut menyusut. `border-box`
wajib, kalau tidak padding menambah tinggi di atas 100% dan melahirkan scrollbar kedua.

`Card` punya prop `fill` untuk kartu yang membungkus header + daftar + Pager
(Projects, dan daftar berpager lain): ia meneruskan rantai flex ke pembungkus anaknya. Tanpa `fill`,
`Card` berperilaku persis seperti sebelumnya.

**Kartu yang berisi pane bergulir WAJIB memakai `fill` — bukan `style`** (SPEC-393). `Card`
selalu menyisipkan satu pembungkus `<div>` di sekitar `children`, dan pembungkus itu
`display: block` kecuali `fill` dipasang; `fill`-lah yang menyetel
`display:flex` + `flexDirection:column` + `flex:1 1 auto` + `minHeight:0` pada **dua-duanya**
(div terluar *dan* pembungkus anak). Memasang rantai flex lewat `style` hanya mengenai div
terluar, sehingga pembungkus anak memutus rantainya: `flex`/`minHeight` di pane jadi inert, pane
tumbuh setinggi isinya, dan karena `Card` ber-`overflow: hidden` isinya **terpotong tanpa
scroller mana pun**. Terukur di Chrome: pane 11 830 px di dalam kartu 701 px → 11 184 px hilang.
Test kontrak `src/test/scroll-chain.test.tsx` menaiki rantai leluhur tiap pane dan menuntut
setiap mata rantai meneruskan tinggi; rinciannya di
[audit SPEC-393](../research/audit-spec-393-ide-docs-tak-bisa-scroll.md).

Aturan ini berlaku untuk **kartu ber-tinggi terbatas** — entah batasnya datang dari rantai flex
layar (Docs/IDE) atau dari `maxHeight` kartunya sendiri (modal berkas Git Graph, `86vh`). Kartu
yang tingginya mengikuti isi tak perlu `fill`: pane di dalamnya memakai `maxHeight` sendiri
(`ReviewScreen` 640, `BranchesPanel` 620) sehingga tak bergantung pada rantai apa pun.

**Gotcha: `fill` di overlay flex ber-arah baris.** `fill` ikut menyetel `flex: 1 1 auto`. Di
kartu yang jadi **grid item** (Docs/IDE) itu tak berpengaruh, tapi di modal yang dipusatkan
overlay `display: flex` (arah **baris**) `flex-grow: 1` bekerja pada **lebar** — panel modal
Git Graph terukur melar 900 → 1464 px. Kembalikan defaultnya lewat `style` (di-spread sesudah
`fill` di `Card`): `flex: "0 1 auto"`.

**Kecuali untuk pane yang harus setinggi viewport** (pratinjau dokumen, SPEC-363):
`LIST_SCREEN_STYLE` ber-`flex-basis: auto`, dan karena `<main>` memakai `min-height: 100%`
(bukan `height` — lihat alinea di atas), item ber-basis `auto` memakai tinggi **isi**-nya lalu
menumbuhkan halaman alih-alih menggulir di dalam dirinya — terukur pane 6000 px + halaman ikut
menggulir. Layar yang ingin pane-nya terikat viewport memakai **`flex: 1 1 0`** di root-nya
(basis 0 membuat tinggi container pasti lebih dulu), baru `flex: 1 1 auto` + `overflow: auto`
di pane. Lihat bagian pratinjau dokumen di bawah.

## Backlog: tiga mode tampilan, dan board yang tidak boleh berbohong
`BacklogScreen` merender satu daftar spec dalam tiga bentuk — **grid** (default, kartu penuh
dengan stage bar), **list** (satu baris per spec), dan **board** (kanban). Grid dan list
dipaginasi lewat `usePaged`; board tidak, karena kolom yang terpotong halaman bukan board.

Toolbar dua baris (SPEC-178): baris atas tab sumber + toggle view + hitungan; baris bawah
kotak **Cari backlog** (substring case-insensitive pada `id + title + objective`) diikuti
`Select` project, stage, dan prioritas. Semua penyaring digabung serentak ke satu `filtered`
dan berlaku di ketiga view; kuncinya masuk `usePaged` agar halaman reset saat filter berubah.
Search/stage/prioritas view-local; project tetap `App.projectFilter` (SPEC-146).

Tab sumbernya lima (SPEC-521): `Semua spec · Dari brief · Dari QA · Audit · Goal`. Nilainya
menyeberang apa adanya sebagai `source` ke `GET /specs` (`all` → param di-omit), dan **Goal**
adalah backlog bermode goal — alur dua fase tanpa perencanaan (ADR-0089) yang tanpa tab ini hanya
muncul tercampur di "Semua spec". `source` disaring di DB sebelum overlay stage-live, jadi ia pula
yang menentukan scope overlay/write-through — beda lapis dari stage/prioritas/tanggal yang
disaring di layer response (ADR-0038). `help` sengaja tak bertab: item tiket sudah dinaikkan ke
brief/qa/audit oleh jalur triase (ADR-0062).

Label tab **"Goal"** sengaja sama persis dengan label badge kartu (`SOURCE_META.goal`), jadi
pencarian berbasis teks di test akan cocok **ganda** begitu ada item goal di layar — pakai
`getByRole("tab", { name })`, atau `getAllByText(...).length` seperti yang sudah dilakukan untuk
"Audit" di `backlog-board.test.tsx`.

Ketiganya memakai rantai flex di atas. Board sedikit berbeda: barisnya menggulir **mendatar**
(`overflow-x:auto`, `overflow-y:hidden`) dan tiap **kolom** menggulir tegak sendiri, jadi judul
kolom tak pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. Kartu board
`flex: 0 0 auto` — tanpa itu kartu menyusut mengisi kolom alih-alih kolomnya menggulir.

Kolomnya: `Backlog · Brainstorm · Objective · Spec · Plan · Execute · Success`. Lima kolom tengah
(Brainstorm…Execute) benar-benar `Spec.stage`; **Backlog** dan **Success** turunan, bukan field:

- **Backlog** — spec `brainstorming` yang **belum punya sesi hidup** (`!hasSession`). Begitu sesinya
  mulai, kartunya pindah ke Brainstorm. `hasSession` datang dari `listSessions()` (tmux), bukan status run.
- **Success** — `stage === "done"`.
- Kolom **Failed** dihapus bersama tabel `Run` (ADR-0024): sebuah sesi tak meninggalkan status terminal
  yang bisa dibaca dari spec — `mirrorStage` monotonic-forward (ADR-0008) menahan spec di stage terakhir
  yang tercapai, jadi tak ada yang bisa mengklaim kartu ke "Failed".

Konsekuensinya untuk drag: **kolom stage tidak bisa menerima maupun melepas kartu** (`draggable={false}`).
`Spec.stage` diturunkan dari phase-file sesi (ADR-0008/0024); UI yang menulisnya akan membuat
`executing`/`done` tercapai tanpa sesi yang benar-benar berjalan. Hanya ada **satu** drop yang sah, dan
ia bermuara ke `POST /terminal/sessions`, bukan ke `PATCH /specs`:

    Backlog ──drag──► Brainstorm   = mulai sesi

Kenapa cuma Brainstorm? Karena kontrak kanban adalah **kartu mendarat di kolom tempat ia dijatuhkan**.
Sesi selalu mulai dari awal pipeline, jadi spec yang baru dijalankan berakhir di stage `brainstorming` —
Brainstorm satu-satunya tujuan yang jujur. Menerima drop di Execute berarti kartunya melompat empat
kolom ke kiri sesaat setelah dilepas.

**Ubah status dari detail (SPEC-744; menegakkan ADR-0027).** `SpecDetail` menampilkan status aktif
dan hanya menawarkan stage yang lebih awal. Memilih target menyimpan draft lokal — belum memanggil
API — lalu menampilkan transisi, fakta bahwa fase sesi tak dibatalkan, kemungkinan penghapusan
dokumen Spec/Plan, dan jaminan kode/commit tak disentuh. Stage aktif dan stage ke depan tak masuk
pilihan karena kemajuan hanya berasal dari fase sesi.

**Simpan status** memanggil `onRevertStage(spec, target)` satu kali. Respons `Spec` mengganti item
yang sama di state backlog milik `App`; `BacklogScreen` lalu memproyeksikan snapshot hasil query
grid/list/board ke item ber-ID sama dari prop backlog itu. Modal detail yang tetap terbuka dan ketiga
view daftar karena itu membaca nilai baru tanpa fetch atau state status kedua. Respons
`{pending,wouldDelete}` membuka langkah kedua existing; hanya **Hapus & kembalikan** yang mengirim
`confirmDelete:true`. Satu guard in-flight bersama mengunci select dan seluruh jalan keluar kedua
dialog selama request. Sukses menutup hanya dialog konfirmasi, sedangkan gagal mempertahankan detail
dan draft target agar bisa dicoba lagi; toast `App` tetap menjadi umpan balik sukses/gagal. Tanpa
endpoint, skema, migration, atau ADR baru.

Aturannya dua fungsi murni terekspor, `specColumn(spec, hasSession)` dan `canDrop(from, to)`, diuji di
`src/test/backlog-board.test.tsx` — termasuk render test jsdom yang men-drag kartu sungguhan,
karena `from`/`to` yang tertukar lolos dari unit test aturannya sendiri.

**Reopen sesi untuk spec `done` (SPEC-172).** Kadang hanoman menandai `done` terlalu dini
(mis. spec ber-banyak-PR, baru sebagian beres). `SpecDetail` (modal detail) menampilkan tombol
**"Buka sesi lagi"** saat `spec.stage === "done"`, memanggil `onStart(spec)` — flow start yang
sama (`POST /terminal/sessions`), tapi server memilih prompt **lanjutan** (fase Execute saja)
karena stage-nya `done`. Sengaja **hanya** di detail: `SpecActions` (dipakai grid/list/board)
tak diubah, jadi aksi ini tak muncul di tiga mode tampilan itu. Stage tetap `done`; diuji di
`src/test/reopen-session.test.tsx`.

Drag pakai HTML5 drag-and-drop native, tanpa dependency — dan ia mati total di keyboard maupun
layar sentuh. Karena itu **setiap kartu di ketiga mode, termasuk `BoardCard`, membawa `SpecActions`**
(mulai/lanjutkan sesi, lihat dokumen, review). Drag adalah jalan pintas, bukan jalan satu-satunya.

Memulai sesi **tidak** memindahkan layar — operator tetap di Backlog dengan filter dan mode tampilannya
utuh. Yang menandai sesi sudah jalan adalah kartunya sendiri: `activeSpecs` (diturunkan dari
`listSessions()` tmux) menyegar, tombolnya berubah, dan toast muncul.

## Tim — papan kerja manusia (SPEC-946/948 · ADR-0150/0151/0153)
`TeamScreen` adalah papan kanban untuk pekerjaan **manusia** di sekitar sesi agen: desain, meeting
klien, deploy, nego, urusan internal. Ia **bukan** mode keempat `BacklogScreen`. Kolom board
Backlog adalah `Spec.stage` yang diturunkan dari fase sesi (ADR-0008/0024); kolom di sini adalah
`Task.status`, yang memang milik manusia.

Konsekuensinya aturan drag **berbalik**, bukan menyempit. Di Backlog hanya satu drop yang sah
(`Backlog → Brainstorm`, dan ia bermuara ke `POST /terminal/sessions`). Di sini keempat kolom
saling menerima, dan yang tersisa satu larangan — `canDropTask(from, to) = from !== to`, karena
drop ke kolom asal bukan perpindahan dan hanya melahirkan satu `PATCH` yang menulis nilai yang
sudah ada plus satu baris `SyncLog` tanpa pembaca (ADR-0131). Kartu mendarat di **ujung** kolom
tujuan (`order = max + 1`); menyusun ulang di dalam kolom lewat drag bukan bagian item ini.

Kolomnya empat dan lahir dari `TASK_STATUSES`, bukan daftar literal baru: `Backlog · Dikerjakan ·
Review · Selesai`. Rantai flex-nya persis board Backlog — barisnya menggulir **mendatar**
(`overflow-x:auto`, `overflow-y:hidden`, `.hn-board-local-overflow`) dan tiap **kolom** menggulir
tegak sendiri, dengan kartu `flex: 0 0 auto` supaya kolomnya yang menggulir, bukan kartunya yang
menyusut.

**Langganan PER KOLOM, dan plafonnya terlihat.** Papan tak dipaginasi — kolom yang terpotong
halaman bukan board — tapi topik `tasks` mewajibkan `page`/`limit` dan `zSubLimit` menjepit `limit`
ke 200. Satu langganan untuk seluruh papan salah dan bisa dibuktikan salah: `buildTasksPage`
mengurutkan `order asc`, sementara `order` bermakna **di dalam** kolom, jadi potongan 200 memotong
himpunan gabungan empat kolom di titik yang sewenang-wenang. Papan karena itu memasang **empat**
langganan `{projectId?, status, memberId?, q?, page: 1, limit: 200}` (4 dari `MAX_SUBS = 16`), tiap
kolom membawa `total`-nya sendiri, dan begitu `total > items.length` kaki kolom merender
`menampilkan N dari M — persempit penyaring`. Muat awal HTTP memakai parameter **identik** dengan
langganannya: muat tak-berbatas lalu langganan berplafon membuat kartu lenyap tiga detik setelah
muncul, tanpa satu pun tindakan operator dan tanpa satu pun error.

Hanya muat **pertama** yang boleh merender blok `loading`. Tanpa pemisahan itu tiap huruf di kotak
cari membuat keempat kolom lenyap sekejap. Refetch yang gagal sesudah papan tampil menandai
hitungan **"basi"** (pola SPEC-857), bukan menimpa papan yang sudah benar dengan layar galat. Dan
kolom kosong **di bawah penyaring** tetap dirender sebagai kolom: "Dikerjakan 0" adalah jawaban,
sedangkan blok "tak ada hasil" justru menyembunyikan tiga kolom lain yang mungkin berisi. Yang
layak menggantikan papan hanya papan yang benar-benar kosong tanpa penyaring aktif — di sana blok
kosongnya membawa pintu masuk "Tugas baru".

Toolbar dua baris cermin `BacklogScreen`: baris atas toggle mode tampilan (`Tabs variant="pill"`),
**Tugas baru**, **Anggota**, `SyncButton`, `ResetViewButton`, hitungan ber-`role="status"`, dan
`LiveConnectionBadge`; baris bawah **Cari tugas** + penyaring project, kolom, anggota, dan — di mode
Linimasa **dan** Lintas project — **Zoom linimasa**. Kelas
responsifnya dinamai sendiri (`.hn-team-topline` dkk.) dan didaftarkan ke grup selector yang sama
di `app.css` — layar yang meminjam nama layar lain adalah cara aturan mulai berubah untuk satu
layar dan diam-diam ikut mengubah yang lain.

Penyaring project memakai **`App.projectFilter`** (SPEC-146: App pemilik tunggal "daftar disaring
ke project mana"), jadi berpindah dari Backlog ke Tim tak mengganti project yang sedang dilihat —
dan karena state itu di luar jangkauan `resetUiState("team")`, `ResetViewButton` diberi `onReset`.
Di mode **Lintas project** penyaring itu `disabled` dan sebabnya **dirender sebagai teks** di
sebelahnya — bukan `title`: `Select` menyebar prop sisa ke `<select>` di dalam pembungkusnya, dan
kontrol form yang `disabled` menekan pointer event, jadi tooltipnya tak pernah muncul di browser
mana pun dan yang tersisa bagi operator justru kontrol mati tanpa sebab (kelas SPEC-546). Nilainya
**tidak** ditulis — mode yang gunanya membandingkan antar-project tak boleh mendarat
menampilkan satu baris, dan menyetelnya ke `"all"` sendiri akan mengubah apa yang dilihat Backlog.
Ia juga tak ikut `activeFilters` di mode itu: lencana "N filter aktif" yang menghitung penyaring
yang tak berlaku sama menyesatkannya dengan mengabaikannya diam-diam — dan `ResetViewButton`
**ikut** dimode-kan (`onReset` jadi `undefined`), sebab tombol yang mengaku memegang N filter lalu
menghapus filter ke-N+1 mengubah apa yang dilihat Backlog. Untuk alasan yang sama
`defaultProjectId` milik `TaskModal` dibaca dari nilai **efektif**, bukan `projectFilter` mentah:
"Tugas baru" yang memilih-awal project yang UI-nya baru saja menyatakan tak berlaku melahirkan
kartu di project yang tak pernah dipilih siapa pun. Konsekuensinya jujur dan
diuji dua arah — mode ini **satu-satunya** yang memuat ulang saat berpindah, dan hanya saat
penyaringnya memang sedang aktif.

Penyaring **kolom** mempersempit kolom yang tampil, dan hanya kolom yang tampil yang dimuat &
dilanggan, jadi biaya servernya ikut mengecil. Tak ada sentinel "Tanpa project": `where.projectId`
di server hanya dipasang saat nilainya truthy, jadi `projectId: null` tak bisa dinyatakan sebagai
query tanpa menambah sentinel ke kontrak — kartu tanpa project tetap terlihat di "Semua project"
dan diberi label `tanpa project`. Sisa state tampilan (`view`, `q`, `col`, `member`, `zoom`,
`expanded`) persisten berkunci `team` (SPEC-740/ADR-0115); tak ada `page`, papan tak dipaginasi.
`expanded` menyimpan baris project yang terbuka di mode Lintas project — nilai rusak jatuh ke `[]`
tanpa melempar, dan project yang sudah lenyap tinggal di sana tanpa efek karena tak ada baris yang
bisa dibukanya.

`TEAM_VIEWS` berisi **tiga** entri (`board` · "Papan", `timeline` · "Linimasa", `projects` ·
"Lintas project") yang dirender sebagai tablist ber-`usePersistedState`; ketiganya satu array — mode
baru menambah entri, bukan memasang mekanisme baru pada layar yang sudah dipakai orang. Cermin
`TEAM_VIEWS` ↔ cabang render dijaga test kontrak: entri tanpa cabangnya sendiri merender permukaan
mode **lain** di bawah pilnya, 200 dan nol error — kelas bug yang sama yang dijaga
`app-router.test.tsx` untuk `HN_NAV`. Karena mode Lintas project memakai komponen kanvas yang
**sama** dengan mode Linimasa, ia wajib membawa `data-testid` sendiri (`TimelineCanvas` menerimanya
lewat prop `testId`) — tanpa itu ia **lolos** cermin itu sambil melanggar persis apa yang
dijaganya.

**Kartu membawa aksi eksplisit karena drag mati di keyboard dan di layar sentuh.** Tiap kartu punya
dua `Select` di kakinya — *Pindah kolom* dan *Tugaskan* — plus satu baris aksi backlog, semuanya
ber-`aria-label` yang memuat judul tugasnya supaya papan berisi banyak kartu tetap punya nama unik
bagi pembaca layar dan bagi test. Isinya: prioritas, project (atau `tanpa project`), judul yang
membuka `TaskModal`, assignee, dan rentang `startDate → dueDate`; kartu tanpa tanggal tak merender
barisnya sama sekali.

Baris aksi backlog punya **dua keadaan** (SPEC-947 · ADR-0152). `specId` kosong → tombol
*Eskalasi*, yang membuka `EscalateDialog`. `specId` terisi → lencana cermin (`SPEC-nnn · stage`,
atau **"tautan putus"** bila `spec` null — bukan disamarkan jadi "tak pernah dieskalasi", ADR-0150)
plus tombol *Lepas tautan*. Tautan putus menawarkan **lepas tautan**, bukan eskalasi ulang:
keadaan itu perlu dilihat operator dulu, meski server sendiri sanggup menyembuhkannya.

`EscalateDialog` merender pemilih **project hanya bila kartunya belum punya**, dan tombol kirimnya
mati sampai project dipilih — **dengan sebabnya tertulis** ("Nomor SPEC diambil dari repo project"),
karena tombol mati tanpa penjelasan adalah bentuk lain dari menolak dengan diam (SPEC-546). Label
source datang dari `sourceMeta()` (`source-meta.ts`) dan prioritasnya **prefilled dari kartu**.
Galat API meninggalkan dialog **terbuka** beserta isiannya. Lepas tautan tak berdialog konfirmasi:
ia non-destruktif dan reversibel, jadi `useConfirm` di sana hanya menambah klik.

Anggota dikelola di **modal dalam layar Tim**, bukan `SettingsScreen.tsx` yang sudah 93 KB. Form
ubahnya **tak punya field email sama sekali**: `Member.id` diturunkan dari email dan changefeed
sync tak punya operasi rename (ADR-0094/0150), jadi emailnya dirender sebagai teks plus kalimat
"ganti email berarti hapus lalu buat baru". Menghapus lewat `useConfirm` (ADR-0127), dan dialognya
menyebut bahwa tugasnya **tidak** ikut terhapus (`onDelete: SetNull`).

**Mode Linimasa** (SPEC-948 · ADR-0153) menghamparkan tugas yang sama di sumbu waktu: baris = task,
batang = `startDate → dueDate`, zoom `Hari · Minggu · Bulan` yang persisten lewat `uiKey("team","zoom")`
dengan bawaan `week`. Zoom **bukan** penyaring — ia tak ikut `activeFilters`. Datanya `board` yang
**sudah** dimuat mode Papan, jadi berpindah mode maupun mengganti zoom tak melahirkan satu pun
request, dan plafon 200/kolom berlaku di sini juga (dirender sebagai satu baris "N tugas tak
termuat"). Penyaring kolom karena itu ikut mempersempit linimasa.

Aritmetikanya seluruhnya fungsi murni di `team-rules.ts` dan `today` selalu argumen. Yang perlu
diketahui saat menyentuhnya: akhir tanggal **inklusif** (tanpa itu task sehari berlebar nol dan
kartunya seolah tak bertanggal); "belum dijadwalkan" berarti **kedua** tanggal null, satu tanggal
saja tetap batang satu hari; tenggat yang mendahului mulai digambar bernada galat, bukan ditukar;
dan jendela berplafon 120 tick sehingga task yang tak muat mendarat di daftar **"Di luar jendela"**
alih-alih hilang. Kedua daftar di bawah kanvas ("Belum dijadwalkan", "Di luar jendela") hanya
dirender saat berisi.

Gulir mendatarnya hidup di kanvas, tak pernah di badan halaman (SPEC-879), dan pembungkus di
dalamnya berlebar **eksplisit** — anak blok di container `overflow: auto` menyusut mengikuti
containernya dan scroller-nya lalu tak punya apa pun untuk digulir. `overflow-x`, `min-width: 0`,
dan `max-width: 100%` sengaja di **gaya inline** dan bukan di `.hn-timeline-scroll`: jsdom tak
memuat stylesheet, jadi properti yang hanya hidup di `app.css` dijaga nol test — terukur, kelasnya
bisa dikosongkan tanpa satu pun test merah. Kelasnya menyimpan sisanya (`overscroll-behavior`,
`-webkit-overflow-scrolling`), yang memang tak berarti di jsdom. Kolom label
`position: sticky; left: 0`; gridline baris digambar `repeating-linear-gradient`, bukan satu div
per sel (40 baris × 120 tick = 4 800 node kosong). `TimelineCanvas` sengaja **tak menyebut `Task`**
dan menerima `bars` **jamak** — dan mode Lintas project di bawah memakai keduanya apa adanya.

**Mode Lintas project** (SPEC-949 · ADR-0154) adalah mode ketiga dan terakhir: satu baris ringkas
per project, plus baris **"Tanpa project"**, yang bisa **dibuka** menjadi task-nya. Ia memakai
ULANG `TimelineCanvas` — kanvasnya hanya bertambah dua prop **opsional** (`testId`, `labelHead`),
tanda tangan lamanya tak berubah satu huruf pun, dan test mode Linimasa tetap hijau tanpa disentuh.

Tiap baris project membawa **amplop + segmen**: satu batang amplop `min(startDate)`→`max(dueDate)`
dari `projectSpan(tasks)`, lalu satu segmen per task bertanggal di atasnya. Amplop sendirian
berbohong tentang okupansi — project ber-task di Januari dan Desember menggambar batang selebar
setahun dan tampak bertabrakan dengan segalanya — dan karena satu-satunya guna mode ini adalah
menemukan tabrakan, kebohongan itu tepat mengenai satu-satunya pembacanya. Urutan lukisnya diuji:
amplop yang dilukis **sesudah** segmen menutupi segmennya, dan itu lolos sempurna dari uji
aritmetika mana pun.

Yang perlu diketahui saat menyentuh aritmetikanya: `projectSpan` mengembalikan **`null`**, bukan
rentang selebar nol, saat tak satu pun task bertanggal — satu-satunya pintu yang menutup batang tak
terlihat dan `NaN%`; akhir tetap inklusif **tanpa ditambahkan dua kali** karena `taskSpan` sudah
menambahkannya; task tanpa tanggal **diabaikan** alih-alih membatalkan rentang; dan `invalid`
**menular** dari task mana pun yang tanggalnya terbalik supaya barisnya mengaku. `barGeometry`
dipisah jadi `spanGeometry(span, window)` karena rentang project tak punya `startDate`.
`projectGroups` adalah satu-satunya tempat task dibagi per project, dengan invarian "tiap id muncul
tepat sekali" diuji langsung; kunci "tanpa project" di dalamnya `Symbol`, bukan string sentinel,
sebab `Project.id` renameable (SPEC-255).

Jendela dihitung dari **seluruh** task yang termuat, bukan dari baris yang terlihat: membuka satu
baris tak boleh menggeser sumbu saat operator sedang membandingkan dua project. Project yang jatuh
di luar jendela berplafon **tetap punya baris**, tanpa batang, dan `meta`-nya dibedakan dari "belum
dijadwalkan" — dua keadaan bar-less dengan sebab dan penawar berbeda tak boleh terlihat sama.

Berkasnya dipecah **sejak awal** — `BacklogScreen` 63 KB dan `TerminalScreen` 57 KB adalah
pelajaran yang tak perlu diulang:

| Berkas | Tanggung jawab |
|---|---|
| `screens/team-rules.ts` | fungsi **murni**: `TEAM_COLUMNS`, `emptyBoard`, `canDropTask`, `nextOrder`, `moveCard`, `replaceCard`, konversi tanggal, dan seluruh aritmetika linimasa (`taskSpan`, `timelineWindow`, `spanGeometry`, `barGeometry`, `todayOffset`, `timelineRows`, `projectSpan`, `projectGroups`). Nol React, nol I/O |
| `screens/team-board.tsx` | `TeamBoard` + `TaskCard` — render & event drag |
| `screens/team-timeline.tsx` | `TimelineCanvas` (generik, tak menyebut `Task`) + `TeamTimeline` (mode task) + `TeamProjectTimeline` (mode lintas project) |
| `screens/TaskModal.tsx` | satu form untuk buat DAN ubah, plus hapus |
| `screens/MembersPanel.tsx` | modal kelola anggota |
| `screens/EscalateDialog.tsx` | dialog eskalasi kartu → backlog (project bila perlu · source · prioritas) |
| `screens/TeamScreen.tsx` | toolbar, fetch & langganan per kolom, state, mutasi optimistis |

`<input type="date">` memancarkan `YYYY-MM-DD` sementara `zCreateTask` menuntut ISO 8601
**ber-offset** — mengirim nilai input apa adanya dijawab `400` oleh route. Konversinya dua fungsi
murni di `team-rules.ts`, dan nilainya **tengah hari UTC**: `T00:00:00Z` mundur ke tanggal
sebelumnya di zona waktu barat, dan tanggal yang bergeser sehari saat dibaca kembali adalah bug
yang tak memunculkan satu pun error.

Aturannya diuji dua lapis, dan lapis pertama **tidak cukup**: `from`/`to` yang tertukar saat
dipasang lolos dari unit test aturannya sendiri. `src/test/team-board.test.tsx` karena itu men-drag
kartu sungguhan di jsdom (`fireEvent.dragStart` + `fireEvent.drop`, dengan `DataTransfer` palsu),
persis pola `src/test/backlog-board.test.tsx`. Linimasa mengikuti pembagian yang sama:
`team-rules.test.ts` menguji aritmetikanya langsung, sementara `team-timeline.test.tsx` merender
kanvasnya dan membandingkan `left`/`width` batang dengan `barGeometry` untuk masukan yang sama —
`left`/`width` yang tertukar lolos sempurna dari uji aritmetikanya sendiri. Mode Lintas project
mengikuti pembagian yang persis sama lewat `team-projects.test.tsx`, dengan satu tambahan yang
hanya bisa diuji di DOM: **urutan lukis** amplop terhadap segmennya.

## Terminal (sesi Claude Code interaktif)
> **Sejak Fase 3E** default tampilannya **Fokus** (rail sesi + satu pane); seksi ini menjelaskan mode **Grid**
> opsional. Lihat [Fase 3E](#audit-uiux-2026-10--fase-3e--terminal-rail-sesi-dan-mode-fokus).

`TerminalScreen` dalam mode Grid menampilkan sesi dalam **grid `rows × cols`** (CSS Grid): `+ Kolom` menambah
kolom (kiri↔kanan), `+ Baris` menambah baris (atas↔bawah); tiap kolom dan baris punya `×` di gutter
untuk menutupnya (grid tak boleh menyusut di bawah 1×1). Menutup kolom/baris **tidak** mematikan
sesi — selnya lenyap dan sesinya jatuh ke tray, karena itu tak ada konfirmasi. Tiap sel me-mount satu `TerminalPane`
yang membuka WebSocket ke `/api/terminal/sessions/:id/ws`; sel kosong menampilkan picker sesi yang
belum tertempat, dan sesi yang belum di grid duduk di **tray**. Satu sesi menempati **paling banyak
satu sel** (menjaga resize tmux tak berkedip). Dua aksi per sel: **Lepas** (unbind, sesi tetap
hidup) dan **Tutup/`×`** (kill lewat `DELETE`).

Pada mobile, workspace persisten itu **tidak** diperkecil menjadi banyak terminal mungil dan tidak
ditulis ulang: tab panel memilih satu cell untuk ditampilkan, sementara setiap cell/`TerminalPane`
tetap mounted. Kontrol tambah baris/kolom tetap di toolbar; gutter hapus desktop diganti tombol
Hapus baris/kolom aktif pada mobile. Tray, pilih sesi, phase/docs, lepas, tutup, dan fullscreen
tetap tersedia. Kembali ke layar lebar
merender grid `{rows,cols,cells}` yang sama. `TerminalPane` hanya
autofocus pada pointer halus agar ponsel tidak memunculkan keyboard virtual tanpa intent; setiap
perubahan host terlihat tetap ditangkap `ResizeObserver`, diteruskan ke `FitAddon.fit()`, lalu
mengirim resize PTY melalui WebSocket. Initial fit, `onopen`, dan callback observer mengabaikan ukuran `0×0` ketika panel disembunyikan,
sehingga perpindahan tab mobile tidak mengecilkan tmux background ke ukuran minimum xterm. Aksi
`focusSession`/sesi baru/pilih dari tray juga mengaktifkan grup dan cell target pada selector mobile.

Input xterm yang lahir saat tiket/upgrade WebSocket masih `CONNECTING` ditahan berurutan oleh
`TerminalPane` dan dikirim sebagai satu frame segera setelah `open`; jalur ini tidak membuang
ketikan awal. Pada perangkat sentuh, swipe vertikal satu jari di host terminal dikonversi ke baris
melalui tinggi host/jumlah row dan `Terminal.scrollLines()` (dengan sisa pecahan disimpan), lalu
`preventDefault()` menahan scroller halaman. Pan horizontal dan pinch-zoom tetap diserahkan ke
browser; gesture multi-touch tidak diambil terminal.

**Echo prediktif lokal** (SPEC-856, tanpa ADR — arah MASUK, pelengkap arah keluar SPEC-812; seluruh
perubahannya di klien). Sebelumnya sebuah huruf baru tampil sesudah round-trip penuh
klien → server → tmux → pty → flush coalesce → klien: terukur **242 ms** dari keydown sampai glyph
pada RTT 200 ms di TUI claude, **2,7 ms** sesudahnya. Logikanya di modul murni
`src/src/screens/terminal-predict.ts` (tanpa React, tanpa xterm — `TerminalPane` menyuplai
pandangan layar sebagai data), dengan **satu invarian keselamatan**: begitu satu byte pun datang
dari pty, prediksi di-rollback **sebelum** byte itu ditulis, dalam **satu** panggilan `term.write`,
sehingga layar sesudah tiap frame server byte-identik dengan layar tanpa prediksi (dibuktikan
membandingkan model layar xterm *dan* `tmux capture-pane`). Karakter tampil bergaris bawah
(`\x1b[4m`…`\x1b[24m` — netral SGR; `\x1b[m` akan merusak latar yang dipakai `\x1b[K` saat
rollback) dan rollback-nya `\x1b[<n>D\x1b[K`, setia karena gerbang menjamin ekor baris kosong.
Prediksi **mati** saat: sakelar operator mati, byte tak akan pernah terkirimkan (`View.deliverable` — sesi tmux lenyap/4004 atau antrean penuh; SPEC-878 · ADR-0134: byte yang diantre untuk sambungan yang masih akan pulih **tetap** diprediksi, karena "tersambung" bukan "terkirim"), alternate screen **pane**
(SPEC-863 · ADR-0133 — dipasok server lewat frame `{t:"alt"}` dari `#{alternate_on}` milik tmux,
**bukan** dipindai dari aliran: tmux tak pernah meneruskan `?1049h/l` milik program di dalam pane,
sementara `?1049h` yang memang sampai adalah `smcup` klien tmux sendiri — byte pertama tiap attach,
tanpa pasangan `l` selama sambungan hidup, dan memindainya terukur mematikan fitur ini **total**),
input bukan teks tunggal (escape/panah/Enter/Tab/ctrl/paste/IME), kursor di dua
kolom terakhir, ekor baris tak kosong, baris berpola password, dan begitu satu prediksi mencapai
TTL 500 ms tanpa pernah ter-echo **sesudah frame yang membawanya diakui server** (`{t:"in", d, seq}` → `{t:"ack", seq}` — SPEC-878 · ADR-0134; sebelum pengakuan itu jam TTL **tak berjalan sama sekali**, karena diamnya server tak memisahkan "pty bungkam" dari "byte belum sampai", dan menghukumnya terukur membeli 30,5 detik layar bisu untuk satu kedip 500 ms). Suspend **menyembuhkan diri** (amandemen ADR-0134, 2026-08-22): teks yang diketik selama suspend dicatat, dan begitu sebuah frame server yang sudah **tergambar** (callback `term.write`) memperlihatkan ekor ketikan itu di kiri kursor, suspend dicabut seketika — pemicu palsunya adalah TUI agen yang menggambar ulang >500 ms saat mesin sibuk; fallback-nya 5 detik, hanya untuk konteks yang memang bungkam (`read -s` dan tombol yang ditelan dialog sama-sama terukur membalas nol byte). Sisa yang belum ter-echo dihidupkan ulang di kursor
baru lewat `echoedPrefixLen`, atau dibuang bila gerbang tak lagi lolos — tak ada jalur yang
meninggalkan karakter tanpa pemilik. **Keputusan itu diambil di callback `term.write` frame server
(`onFrameParsed`), bukan tepat sesudah pemanggilannya** (2026-08-22): xterm hanya memproses write
pertama sesudah input pengguna secara sinkron, sedangkan write frame server diparse lewat `setTimeout`,
jadi buffer tepat sesudah `write` masih memuat glyph prediksi sendiri — terukur di xterm 6 asli, dan
blok reapply lama karena itu tak pernah menggambar ulang apa pun. Selama sebuah frame masih in
flight (`gen ≠ parsed`), huruf baru **ditangguhkan** ke `unechoed` alih-alih digambar: write yang
dipanggil dari callback terukur mendarat SESUDAH chunk yang sudah antre, sehingga glyph yang digambar
selagi in flight akan mendahului sisa lama dan membalik urutan. Callback frame terakhirlah yang
menggambar sisa + yang ditangguhkan dalam satu write; callback frame yang sudah disusul frame lebih
baru tak memutuskan apa pun, dan control/bulk/penolakan gerbang memutus urutan `unechoed`
(Backspace tak pernah membuat huruf yang ia hapus diprediksi ulang). Di atasnya, **semua** jalur input keluar lewat batcher
yang sama (SPEC-878): `term.onData` boleh ditahan 16 ms selagi prediksi aktif, sedangkan clipboard
(SPEC-289), tap dialog (SPEC-452), lampiran (SPEC-816), dan papan tombol layar (SPEC-800) memakai
`sendRaw` = `push(d, false)` yang **menguras antrean lebih dulu** lalu meneruskan payload utuh dalam
satu frame — jaminan "satu tekan = satu keystroke" dan "paste utuh" tak berubah, sementara
transposisi yang terukur (`["\x1b","z"]` untuk `z` lalu Escape) hilang secara konstruksi. Batcher
tak memanen ketikan manusia (jeda 120–200 ms ≫ 16 ms) — nilainya di burst: terukur frame masuk
10 → 5 dan byte keluar 20 524 → 11 370, karena TUI agen menggambar ulang sekali per *event input*,
bukan per karakter. Sakelarnya state tampilan lokal `hn.ui.v1.terminal.predict` (SPEC-740 ·
ADR-0115), default hidup, di panel tampilan bersama ukuran font & papan tombol.

**Antrean ketikan saat sambungan putus** (SPEC-878 · ADR-0134). `pendingInput` berbatas
`MAX_PENDING_INPUT = 4 096` byte; penuh berarti byte baru **tidak** diterima, `deliverable` tertutup
(jadi tak ada glyph yang menjanjikan sesuatu yang dibuang), dan strip mengatakannya. Byte tak pernah
menyalip antrean yang belum terkuras — `sendInput` mengirim langsung **hanya** saat antrean kosong.
Saat sambungan pulih, prediksi outage di-rollback lebih dulu, lalu `{t:"resize"}` dikirim (geometri
yang berubah selagi putus hilang senyap karena `send` no-op), baru antrean dikuras — **kecuali** bila
ia memuat `\r`/`\n`: antrean itu **seluruhnya ditahan** dan strip menawarkan `Kirim` / `Buang`.
Alasannya terukur: layar operator sudah basi berdetik-detik saat blob mendarat, dan `capture-pane`
memperlihatkan baris yang salah benar-benar ter-submit ke agen. Memecah di `\r` pertama ditolak —
itu mengirim separuh kalimat operator. Balasan handshake terminal (`isTerminalResponse`, kini di
`@hanoman/shared`) tak pernah ikut mengantre: ia milik sambungan yang sudah mati, dan blob campuran
menembus gerbang `writeTo` (SPEC-860) apa adanya. Antrean **tidak** dipersistensi lintas unmount, dan
dibuang saat sesi dinyatakan lenyap (4004) karena tak ada lagi tujuannya.

Toolbar juga punya **Ambil backlog** (SPEC-179): tombol yang membuka modal picker berisi
backlog item yang bisa diambil (`stage !== "done"` dan belum punya sesi hidup). Memilih satu
memanggil `POST /terminal/sessions {spec, flow}` — endpoint idempoten yang sama dengan tombol
Mulai/Lanjutkan di halaman Backlog — lalu menaruh sesinya di sel kosong pertama grup aktif.
`flow` dipilih otomatis dari `spec.source` (`qa`/`feature`). Nol perubahan server.

Toolbar juga punya **Terminal biasa** (SPEC-236): membuka **shell tmux polos tanpa Claude** di
repoDir project terpilih (`POST {project, shell:true}`) untuk sekadar menjalankan command —
di sebelah **Sesi baru** yang men-spawn agen. Sesi shell tak punya flow/spec, tampil seperti
sesi biasa; menutupnya hanya kill pane (cwd = repoDir, bukan worktree). Lihat ADR-0056.

**Sesi baru** (SPEC-517) tak lagi men-spawn seketika: ia membuka `NewTerminalModal` — Agen ·
Model · Effort, prefill dari `GET /settings` (gagal-diam ke default bawaan), katalog dari
`@hanoman/shared` lewat `screens/session-runtime.ts` (`runtimeModels`/`runtimeEfforts`/
`runtimeFor`) — berkas yang sama yang dipakai picker Start backlog, supaya dua picker itu tak bisa
berselisih pendapat. Pilihannya dikirim sebagai `POST {project, agent?, model?, effort?}` dan jadi
argv pane tmux; tanpa mengubah apa pun, body-nya `{project}` polos dan perilakunya persis seperti
sebelumnya. Catatan versi codex (`codexClientTooOld`) muncul di sini juga dan **tak** memblokir
tombolnya. "Mulai lagi" pada baris riwayat ber-`kind: "terminal"` mengirim runtime baris itu —
agen/model/effort sudah tercatat di `SessionHistory` sejak ADR-0079. Sejak audit S4c (2026-09-23)
baris ber-`specId` juga mengirim `agent` (+ `model`/`effort` bila tercatat), supaya sesi codex tak
dilanjutkan sebagai claude; `phaseOverrides` sesi asal tak tersimpan di mana pun, jadi tak diulang.

Toolbar juga punya **Riwayat** (SPEC-362 · [ADR-0079](../adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md)):
membuka `SessionHistoryModal` — **modal**, bukan panel tetap, persis seperti picker "Ambil backlog".
Itulah cara memenuhi "mudah diakses tapi tidak menghalangi UI terminal": grid di belakangnya tak
berubah ukuran sama sekali, dan selama modal tak dibuka **tak ada request riwayat** yang berjalan.
Isinya: penyaring (project · jenis · cari), daftar baris (waktu mulai, badge jenis **berlabel manusia**
dari `SESSION_KIND_LABEL` — bukan slug, pelajaran SPEC-262/264 — judul/spec, penanda transkrip, durasi,
status `berjalan`/`selesai`/`exit <code>`/**`terputus`**), lalu **kontrol halaman** `Pager` DS: sejak
SPEC-523 halaman **mengganti** isi (muat-lebih `IntersectionObserver` dicabut demi satu pola paginasi
yang sama dengan backlog/project/tiket), dan `Pager` sendiri yang menyatakan "N–M dari T" sehingga baris
penutup SPEC-351 tak lagi perlu. Server yang memaginasi (`{items,total,page,pageSize}`); modal hanya
menaikkan `page`. Klik baris → detail: metadata + transkrip read-only dalam `<pre>` teks polos,
tombol **Salin transkrip** dan **Mulai lagi**.

Status **`terputus`** adalah SPEC-844 · [ADR-0125](../adr/0125-akhir-sesi-riwayat-tercatat.md): baris
hasil rekonsiliasi boot (`endedReason: "reconciled"` — pane lenyap karena reboot/`kill-server`/crash).
Hijau `selesai` berbohong dan merah mengarang, jadi tone-nya **`warn`**. Verdict-nya **tidak** dihitung
di layar — `statusOf()` memanggil `sessionOutcome()` (`@hanoman/shared`), satu definisi yang dipakai UI,
test, dan prosa kontrak webhook; menyalinnya ke sini adalah kelas bug SPEC-431/448. Durasi baris terputus
`—`, bukan `0 dtk` (`endedAt`-nya batas bawah, `reconciledAt` batas atas — mengurangkannya menghasilkan
nol yang tak berarti), dan detailnya merender `Callout` warn yang menyatakan hasil & transkripnya tak
diketahui plus dua stempel `Terakhir terlihat hidup`/`Terdeteksi mati`. "Mulai lagi" tetap jalur
pemulihannya — tak ada endpoint baru. "Mulai lagi" tak pernah menghidupkan sesi lama (tmux
sudah membunuhnya) — ia men-spawn sesi baru lewat endpoint yang sudah ada, dan hanya muncul untuk
`restartableKind()` (`spec`/`terminal`/`shell`/`reverse`/`scaffold`).

Grid-grid itu dikelompokkan ke **grup** bernama yang dipindah lewat tabbar (`+` menambah, `✎`
mengganti nama, `×` menghapus; grup terakhir tak bisa dihapus). Tiap grup memegang `Layout`-nya
sendiri, dan satu sesi menempati paling banyak satu sel **di satu grup** — tray karena itu global,
berisi sesi yang tak punya sel di grup mana pun. Grup non-aktif tidak dirender, jadi pindah tab
menutup lalu membuka ulang WebSocket sesi di grup tujuan; scrollback dipegang tmux, bukan buffer
xterm. Sejak SPEC-786/[ADR-0118](../adr/0118-workspace-terminal-kanonik-per-user.md), state kanonik
adalah `TerminalWorkspaceV1 = {version:1,groups}` di `User.terminalWorkspace`: urutan grup,
`{rows,cols,cells}` row-major, dan `sessionId` per cell. `active`, `activeCell`, fullscreen, modal,
viewport, dan panel mobile yang terlihat tetap lokal. Logika grup murni ada di
`screens/terminal-workspace.ts`; schema wire bersama ada di `@hanoman/shared`.

`useTerminalWorkspace(userId)` melakukan `GET /terminal/workspace` **sebelum** writer aktif,
menserialkan semua GET/PUT, dan menyimpan lewat `{baseRevision,workspace}`. Satu 409
`revision-conflict` menerapkan ulang fungsi mutasi ke snapshot `current` tepat sekali; konflik kedua
memuat state terbaru dan menampilkan status, bukan overwrite diam-diam. Mount, window focus,
document visible, dan write sukses diikuti refresh/adopsi HTTP; tak ada WebSocket baru.

`hanoman.terminal.workspace` dan `hanoman.terminal.layout` sekarang hanya input migrasi satu kali:
bila GET server null dan legacy valid, browser itu boleh seed; browser kosong tidak PUT. Setelah
server mempunyai state, legacy dibuang. Cache `hanoman.terminal.workspace.v2.<userId>` hanya paint
recovery per-user saat GET gagal — writer mati, cache tidak pernah diunggah otomatis. Status
`loading`/`recovering`/`conflict` terlihat di toolbar dan kontrol mapping dinonaktifkan ketika write
tidak aman.

Rekonsiliasi menunggu workspace server **dan** `listTerminals()` sukses. Rejection list tidak diubah
menjadi `[]`; hanya sesi yang terbukti tak ada pada snapshot tmux sukses yang dikeluarkan dari cell,
dan hasil berbeda dipersistenkan lewat CAS. Logika grid murni tetap di
`screens/terminal-layout.ts` (teruji tanpa DOM). Responsive desktop/tablet/mobile memakai objek
kanonik yang sama: resize dan selector panel tidak pernah memanggil writer atau mengubah koordinat.
Ini bukan chat buatan sendiri — yang dirender adalah TUI agen asli, byte demi byte.

Tombol **Layar penuh** (`maximize-2`) di ujung toolbar memaksimalkan screen: root-nya jadi
`position: fixed; inset: 0; z-index: 100`, menimpa sidebar dan topbar `Shell` — di bawah modal (150)
dan toast (200), supaya dialog konfirmasi tak terkubur. Chrome menyusut jadi satu baris (tabbar dan
toolbar melebur, `GroupTabs` kehilangan garis bawahnya lewat prop `compact`) sehingga grid mendapat
sisa layar. Ini **maximize dalam app**, bukan Fullscreen API: `requestFullscreen()` merebut `Escape`,
dan `Escape` adalah tombol tersibuk di TUI Claude Code. Karena itu pula **tak ada** handler `Escape`
untuk keluar — hanya tombol. Pengguna yang mau seluruh layar device menekan `F11` sendiri. State
`maxed` tidak dipersist (SPEC-163).

Berbeda dari maximize-grid itu, tiap **sel** punya ikon **`fullscreen`** di header-nya (SPEC-232):
mengklik membuka **satu** terminal itu sendiri dalam sebuah **modal** besar (DS `Modal`, prop baru
`closeOnEscape={false}` karena Escape milik TUI Claude Code — keluar via `×`/backdrop saja). Supaya
invariant *satu sesi = satu attach tmux* terjaga, sel yang sedang penuh **melepas** `TerminalPane`-nya
dan menampilkan placeholder "Terbuka di layar penuh"; pane hidup pindah ke modal. Menutup modal
memasang ulang pane di sel (reconnect murah — scrollback dipegang tmux, sama seperti pindah grup).
State `fullId` di `TerminalScreen` tak dipersist; bila sesinya lenyap lewat frame WS siar, modal
tertutup sendiri. Ini **maximize satu terminal**, bukan seluruh grid — dua fitur terpisah.

**Salin/tempel** (SPEC-289): xterm merender seleksinya sendiri di canvas, bukan seleksi native
browser — jadi Cmd/Ctrl+C browser takkan menyalin apa pun tanpa wiring eksplisit. `TerminalPane`
memasang `attachCustomKeyEventHandler` yang mendelegasikan keputusan ke fungsi murni
`clipboardIntent` (`screens/terminal-clipboard.ts`, teruji tanpa DOM): **Cmd** (macOS) atau
**Ctrl+Shift** (Windows/Linux) + `C` menyalin seleksi lewat `navigator.clipboard.writeText(term.getSelection())`,
+ `V` menempel lewat `readText()` → kirim sebagai input PTY. **Ctrl polos sengaja dilewatkan** agar
Ctrl+C tetap SIGINT dan Ctrl+V tetap literal (milik TUI Claude Code). Copy hanya aktif bila ada
seleksi. `navigator.clipboard` butuh secure context — terpenuhi di https VPS & localhost.

**Menyeleksinya butuh modifier — dan itu wajib disetel eksplisit** (SPEC-511, memperbaiki premis
SPEC-289 "seleksi mouse jalan"): sesi lahir dengan tmux `mouse on` (SPEC-209) supaya wheel browser
menggulir riwayat pane, dan harganya tmux **menyalakan mouse-reporting di terminal klien** — terukur
`ESC[?1000h ESC[?1002h ESC[?1006h` dengan `mouse on`, nol dengan `mouse off`. xterm.js memanggil
`SelectionService.disable()` begitu ada protokol mouse aktif (`CoreBrowserTerminal.ts`
`onProtocolChange`), dan satu-satunya jalan keluarnya `shouldForceSelection()`: di **macOS**
`altKey && macOptionClickForcesSelection`, di **non-macOS** `shiftKey` tanpa syarat. Opsi itu
default `false`, jadi sebelum SPEC-511 macOS **tak punya cara menyeleksi sama sekali** — drag polos
0 karakter, Option+drag 0 karakter, `hasSelection()` selamanya `false`, dan `clipboardIntent`
karenanya selalu `null` untuk `C`. `TerminalPane` kini menyetel **`macOptionClickForcesSelection:
true`**; konsekuensi sadar, Option+drag di macOS berhenti berarti block/column select. **Mematikan
`mouse on` bukan alternatif:** biner `claude` memuat `ESC[?1000h ESC[?1006h` sendiri, jadi mode itu
tetap diteruskan ke klien sementara scroll riwayat SPEC-209 ikut hilang. Karena modifier tak
terlihat, header `Cell` membawa ikon `clipboard` ber-`title` yang menyebut Option/Shift + kombo
salin-tempelnya. Test yang mengikat memeriksa **opsi di konstruktor `Terminal`**
(`test/terminal-pane.test.tsx`, `@xterm/xterm` di-mock) — bukan helper murni, karena helper-nya
memang tak pernah salah.

Sesi yang **berakhir** (`exited`) ditandai kontras di header cell dengan `StatusPill`
hijau **"Selesai"**, dan badan terminalnya diredupkan (`opacity: 0.6`) untuk menandakan
proses sudah beku — menggantikan suffix teks `· berakhir` yang lama (SPEC-188).

Sesi yang **berhenti menunggu keputusan manusia** (`listSessions().decision`) ditandai pill amber
berdenyut **"Menunggu keputusan"**
(`StatusPill status="awaiting"`). Header cell diberi tint sesuai state — hijau untuk `exited`,
amber untuk menunggu keputusan — supaya pembeda terbaca sekilas, bukan hanya dari pill.
SPEC-903 · ADR-0143 · `decision` adalah **keadaan turunan**, bukan isi marker apa adanya: marker
`.worktrees/.decisions/<id>` terisi **dan** pane tak mengeluarkan apa pun selama ≥ 3 dtk. Gerbang itu
hidup di server (`pty.ts`), dan tak boleh dicermin di sini: `TerminalScreen` maupun `pet-state`
**tidak** menambah predikat sendiri di atas `session.decision` — satu-satunya alasan kosakata kedua
permukaan itu tetap identik adalah karena keduanya membaca bit yang sama.

`TerminalScreen` menerima daftar sesi lewat WS siar `/events/ws` (grup `sessions`, SPEC-199) —
bukan lagi poll 8s. Transisi ke/keluar "menunggu keputusan" dan `exited` datang sebagai push;
server men-poll tmux di satu loop dan menyiarkan saat berubah (dedup signature).

Proxy dev Vite harus memakai `ws: true`, kalau tidak upgrade WebSocket dijawab 404 (berlaku untuk
kedua WS: `/terminal/sessions/:id/ws` dan `/events/ws`).

## Melihat dokumen audit/spec/plan (SPEC-170)
Setiap backlog item mengumpulkan dokumen yang ditulis agent sepanjang alur —
audit, objective, spec/design, plan, brainstorm. `SpecDocsModal`
(`screens/SpecDocsModal.tsx`) adalah satu dialog (reuse `Modal`) yang menampilkannya:
kiri daftar berkas dikelompokkan per **jenis**, kanan preview Markdown. Datanya dari
`GET /specs/:id/docs` (daftar `{kind,path,name}`, sudah terurut per jenis oleh server) dan
`GET /specs/:id/docs/*` (isi). Server memilih sumber **freshest-wins** di `resolveDir`:
worktree sesi tmux yang masih hidup untuk spec itu, kalau tidak `repoDir` project — jadi
dokumen bisa di-review **sebelum** branch run di-merge.

Pemicunya dua, keduanya membuka modal ber-`specId` yang sama:
- **Backlog** — ikon `file-text` "Lihat dokumen" di `SpecActions` (`BacklogScreen.tsx`), jadi
  muncul di ketiga mode (grid/list/board) sekaligus.
- **Terminal** — ikon `file-text` di header `Cell` (`TerminalScreen.tsx`), hanya bila sesi punya
  `specId`; karena keyed spec-id, ia otomatis membaca worktree sesi yang sedang berjalan.

Renderer Markdown dipakai bersama: `MarkdownView`/`hnDocHtml` (`ds/markdown.tsx`, marked +
DOMPurify + kelas `.hn-md`) — sumber yang sama untuk `SpecDocsModal`, `DocsWorkspace`, PRD,
IDE, Git Graph, Review, dan Dokumentasi AI Agent. SPEC-759 menjadikan titik cekik ini
batas keamanan: HTML hasil `marked.parse()` disanitasi dengan allowlist tag/atribut HTML-only,
scheme URL aktif dibuang setelah normalisasi, checkbox GFM dibuat inert, dan kegagalan jatuh ke
`<pre>` ter-escape. Preview baru wajib memakai renderer ini, bukan memanggil parser sendiri.

**Aksi preview `.md` di IDE & Review** (SPEC-385). Empat permukaan dulu hanya bisa menampilkan
`.md` sebagai teks mentah dalam `<pre>` — pane diff Explorer, modal berkas Git Graph, dan Review
(backlog **maupun** sesi PRD) — sementara IDE mode file punya preview inline SPEC-240 yang hanya
memakai sisa lebar di samping tree 300 px. Penyelesaiannya satu komponen design system,
**`DocPreviewModal`** (`ds/DocPreviewModal.tsx`): `Modal` ber-`fillHeight` `width={980}` berisi
`MarkdownView` di pane `flex: 1 1 0` ber-`data-testid="doc-preview-scroll"`, plus `DocDownload`
opsional. Komponen ini **tak menyentuh api client** — pemanggil menyerahkan `text` dan (opsional)
fungsi `download`, jadi ia tak tahu apa-apa soal spec/ide/review.

- **Gerbang seragam** di semua permukaan: `isMarkdownPath(path)` (satu-satunya definisi "berkas
  markdown", diangkat dari const lokal `IdeScreen` ke `ds/markdown.tsx`) **dan** `binary === false`
  **dan** `content !== null` — berkas yang dihapus tak punya isi untuk dibaca.
- **IDE Explorer** — tombol `Preview lebar` di kedua pane. Labelnya sengaja **bukan** "Preview":
  toggle inline SPEC-240 sudah memakai kata itu, dan dua tombol berlabel sama membuat query test
  ambigu. Toggle inline **tetap ada** (default preview); sumber isi mengikuti pane yang aktif —
  mode file = isi berkas di ref yang dilihat, mode diff = isi sesudah perubahan (bukan diff-nya).
- **Review** — tombol `Preview` di toolbar; `kind="session"` memilih endpoint review sesi.
- **Git Graph** — **tab ketiga `preview`**, bukan modal: permukaannya sudah modal, jadi
  `DocPreviewModal` di atasnya membuat Escape ambigu dan menumpuk dua backdrop.
- Pratinjau tetap ditutup otomatis saat seleksi berkas berpindah.
- Unduhannya menunjuk endpoint yang sama dengan isi yang dirender (lihat tabel review/diff di
  [api-contract](../architecture/api-contract.md)), jadi yang diunduh persis yang dibaca —
  memenuhi ADR-0078 untuk keempat permukaan baru tanpa endpoint ekspor baru.

**Pratinjau dokumen tak boleh menggulir ke samping** (SPEC-363). `.hn-md` (`app.css`) memasang
`overflow-wrap: anywhere` di akar, `table-layout: fixed` + `overflow-wrap` di sel, dan
`white-space: pre-wrap` + `overflow-wrap` di `pre` (`overflow: auto` ditahan sebagai jaring
pengaman). `anywhere`, **bukan** `break-word`: hanya `anywhere` yang mengecilkan *min-content*,
dan min-content itulah yang membuat rantai inline `code` tanpa spasi serta tabel lebar mendorong
container. Terukur di Chrome atas 353 `.md` nyata: 33 dokumen menggulir horizontal → 0, dan 187
dokumen ber-`pre` menggulir → 0 (harga: konten 12,5% lebih tinggi). Metode pengukurannya dulu hidup di
dokumen audit SPEC-363; dokumen itu dipensiunkan di SPEC-386
([ADR-0083](../adr/0083-retensi-dokumen-audit.md)) — naskah penuhnya ada di riwayat git.

**Jendela pratinjau setinggi ruang yang ada, bukan angka tetap** (SPEC-363). `62vh`
(`SpecDocsModal`) dan `maxHeight: 620` (`DocsWorkspace`, `IdeScreen` Explorer) dicabut: yang
pertama membuang 18–23% tinggi di tiap layar, yang kedua **melebihi** `<main>` di layar 13"
(dua scrollbar) sekaligus memakai kurang dari separuh tinggi di monitor besar. Penggantinya
rantai flex: `Modal` punya prop **`fillHeight`** (opt-in — panel dapat `height: 88vh`, badannya
`flex: 1 1 auto` + `minHeight: 0`; 20-an modal lain tak berubah), dan layar Docs/IDE menaruh
`flex: 1 1 0` + `minHeight: 0` di root-nya lalu `flex: 1 1 auto` + `overflow: auto` di pane.
**`flex-basis` wajib `0` di item terluar**: pembungkus `<main>` memakai `min-height: 100%`
(bukan `height`, SPEC-351), jadi basis `auto` membuat item memakai tinggi isinya dan menumbuhkan
halaman — terukur pane 6000 px + halaman ikut menggulir. Karena itu `LIST_SCREEN_STYLE`
(yang ber-basis `auto`) tidak dipakai apa adanya di sini. Pane pratinjau ditandai
`data-testid="doc-preview-scroll"` (pohon berkas Explorer: `data-testid="ide-tree-scroll"`);
Git Graph & Branches di IDE sengaja **tidak** ikut rantai ini karena auto-load
`IntersectionObserver`-nya bergantung pada `<main>` yang menggulir.

Rantai itu awalnya dipasang lewat `style` pada `Card` dan karena itu tak pernah benar-benar
menggulir sampai SPEC-393 memindahkannya ke prop **`fill`** — lihat aturan `Card` di atas.
Kartu Docs (`DocsWorkspace`) dan kedua kartu IDE Explorer (`IdeScreen`) kini `<Card padding={0} fill>`.

## Review worktree: collapse & tree Changed (SPEC-171, SPEC-177)

> Fase 3L (Audit UI/UX 2026-10): kepala ringkas, bar keputusan sticky, dan Konflik sinkron hanya menampilkan field yang berbeda. Lihat [Fase 3 · Review, Auth, Portal, Onboarding](#audit-uiux-2026-10--fase-3--review-auth-portal-onboarding-3l--3m--3n).

`ReviewScreen` (`screens/ReviewScreen.tsx`) menampilkan file worktree backlog item ala VSCode:
sidebar **Changed** (SCM) + **Files** (tree), viewer Diff|Source, read-only. Dua pohon dibangun
oleh `buildFileTree(paths)` dan dirender `TreeRow` — keduanya kini di modul bersama
`screens/file-tree.tsx` (SPEC-189), dipakai Review **dan** IDE Explorer.

`TreeRow` mount **collapsed** (`useState(defaultOpen)`, default `false`) — buka Review pertama kali
= semua folder tertutup (SPEC-177; sebelumnya `depth < 1` membuat folder top-level ikut terbuka).
Dua prop opsional membuat satu komponen melayani kedua pohon: `defaultOpen` (Changed-tree
mengoper `true` supaya rantai induk file changed langsung terlihat) dan `meta` (map
`path → ChangedFile`; leaf yang ada di map menampilkan status `A/M/D` + `+add −del`, sama seperti
flat list).

Section **Changed** punya toggle **List | Tree** (`chView`, default `list`) di header "Changed · N":
List = flat path penuh (existing), Tree = `buildFileTree(changed.map(c => c.path))` dengan
`meta`+`defaultOpen`. Pilihan tak dipersist. Tak ada perubahan endpoint — murni frontend.

## Stage & progress
Tidak ada layar Runs, SSE, maupun StatusPill status-run — semuanya dicabut bersama tabel `Run`
(ADR-0024). Progres sebuah backlog dibaca dari **`Spec.stage`**, yang server turunkan dari phase-file
sesi (`$HANOMAN_PHASE_FILE` → `services/session-phases.ts`, `services/stage-machine.ts`). Kartu backlog
dan modal detail menampilkan **stage bar** (Brainstorm → … → Done); daftar didorong lewat WS siar
`/events/ws` (grup `specs`, SPEC-199), bukan poll. Sesi hidup dideteksi dari `listSessions()` (tmux) —
saat sesi ditutup, `liveSpecs()` (server, dipakai `GET /specs` DAN hub siar) write-through memajukan
stage dan membuat notifikasi `done`. `executing` tertahan (tak jadi `done`)
selama plan `docs/superpowers/plans/**` masih punya `- [ ]` (SPEC-173/ADR-0029). Fase `skipped`
(alur `qa`, SPEC-145/ADR-0020) keluar dari penyebut progress sehingga jalur cepat yang sukses tetap 100%.

## Favicon (SPEC-147)
Favicon adalah **aset statis**, bukan komponen: `src/public/favicon.svg` (SPEC-147). Vite root
adalah `src/`, jadi `publicDir` default-nya `src/public/` — dev menyajikannya di `/favicon.svg`,
`vite build` menyalinnya ke `src/dist/`, dan di produksi `fastifyStatic` (`server/src/app.ts:51-52`)
menyajikannya dari root. Server tidak tahu-menahu. Bentuknya mengikuti `IconTile` design system —
mark `buntut` putih di atas tile `--brass-500` ber-radius 24% — tapi hex-nya ditulis **literal**,
karena dokumen `.svg` yang dimuat sebagai favicon tak mewarisi CSS custom property halaman. Atribut
`d`-nya di-**bake** sekali dari `taperedSpiralPath()` (`src/src/ds/marks.tsx`), yang menghitung
spiralnya saat runtime dan tak pernah menyimpannya sebagai string; berkas `.svg` itu tidak diedit
tangan. Tak ada `favicon.ico`: Safari 26+ sudah mendukung favicon SVG, dan bila suatu saat browser
lawas perlu didukung, `.ico` cukup dijatuhkan ke `src/public/` **tanpa perubahan markup** — browser
me-request `/favicon.ico` dari root dengan sendirinya.

## Konfirmasi destruktif: satu kontrak, `window.confirm` nol (SPEC-847 · ADR-0127)

Setiap aksi destruktif produk memakai dialog aplikasi. Bentuk pemanggilannya **`useConfirm()`**
(`ds/useConfirm.tsx`), yang memulangkan `{ confirm, dialog }`:

```tsx
const { confirm, dialog } = useConfirm();
…
if (!await confirm({
  title: `Hapus project "${p.name}"?`,
  impact: ["Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan."],
  confirmLabel: "Hapus project",
  run: () => api.deleteProject(p.id),
})) return;
```

`confirm(options)` sebuah `Promise<boolean>` supaya call site tetap satu baris di tengah fungsi
async — itulah gerbangnya. Dialognya **dirender pemanggilnya sendiri** (`{dialog}`), bukan lewat
Provider di akar App: layar di repo ini dirender berdiri sendiri di test, dan nilai default sebuah
context akan menjawab "batal" atau "ya" **tanpa satu pun error**.

- **`impact?: React.ReactNode[]`** → daftar `<ul>` di bawah `message`. Dampak berbaris-baris
  (rename `Project.id`, harden VPS) tak lagi dipadatkan jadi satu string `\n`-terpisah.
- **`icon?: string`** → menimpa ikon header **dan** ikon tombol konfirmasi. Aksi yang bukan hapus
  memakai ikonnya sendiri (`pencil` rename, `key-round` cabut token, `ban` nonaktifkan,
  `shield` mutasi VPS, `x-circle` tolak tiket); default tetap turunan `tone`.
- **`run?: () => Promise<unknown>`** → dialog tetap terbuka & `busy` selama mutasi; cancel,
  confirm, Tutup, Escape, dan klik overlay semuanya mati. Bila `run` melempar, `confirm()` ikut
  melempar — `false` **hanya** berarti pembatalan, tak pernah kegagalan.
- Tombol konfirmasi memakai `variant="danger"` (`--clay-600`) saat `tone="danger"`.

Yang menjaganya tetap berlaku adalah **test pemindai sumber**, bukan disiplin — pola yang sama
dengan kontrak placeholder di bawah. `src/test/confirm-inventory.test.ts` (+
`test/helpers/native-confirm.ts`) memindai `src/src/**` dan menegakkan tiga hal: tak ada
`window.confirm` tanpa komentar `confirm-exempt: <alasan>`, daftar pengecualian persis satu, dan
setiap `= useConfirm(` diimbangi `{dialog}` yang dirender (lupa merendernya membuat promise
menggantung selamanya tanpa gejala apa pun). Satu pengecualian: `GitGraph` "Dorong tag ke origin?"
— jawabannya **nilai** `push`, bukan izin, dan membatalkannya tetap membuat tag.

`Modal` (`ds/kit.tsx`) tak disentuh: focus trap, focus restore ke pemicu, `aria-modal`, dan
`onClose` yang `undefined` saat `busy` sudah ada di sana. Fokus awal jatuh ke tombol **"Tutup"** di
header (kontrol aman); React `autoFocus` tak bisa memindahkannya karena layout effect `Modal`
berjalan sesudah `commitMount` anaknya.

## Placeholder tiap field form (SPEC-490)

Aturan isinya ada di [design-system](../design-system/design-system.md). Yang menjaganya
tetap berlaku ada tiga lapis, karena ini bentuk "satu definisi, N call site" yang sudah
berulang di repo ini (SPEC-431/448/475/481):

1. **Katalog** untuk field yang dirender dari data — `ConfigEntry.example`
   (`shared/src/config-registry.ts`) menyetir **dua** panel Settings sekaligus (Config
   runtime + Kredensial Telegram, ~25 field lewat satu `<Input>`), dan
   `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS` (`screens/BacklogScreen.tsx`, kini triple
   `[key, label, placeholder]`) menyetir 3–5 field detail spec lewat satu `<HnTextarea>`.
   Contohnya **tidak** ikut `ConfigEntryView`/`GET /api/config`: klien menghitungnya dari
   katalog yang memang sudah ter-bundle (`configEntry(key)`), jadi wire contract tak melebar
   untuk nilai presentasi — semangat ADR-0018. Nol perubahan server.
2. **Call site** untuk sisanya.
3. **Kontrak** `src/test/placeholder-contract.test.ts` di atas scanner bersama
   `src/test/helpers/form-fields.ts`: memindai `src/src/**/*.tsx` non-test dan menolak
   field dalam scope yang tak punya placeholder, atau yang placeholder-nya identik dengan
   labelnya. Ia menegakkan atas **sumber**, bukan DOM — field tanpa placeholder terlihat
   persis seperti field yang belum diketik, jadi tak ada test render yang akan
   menangkapnya. Terukur saat lahir: **23** field kosong dari **82** yang dalam scope.

**Empat gotcha scanner:** (a) isi komentar di-**blank** dulu — `<input>` yang hidup di dalam
prosa komentar memberi 5 positif palsu; (b) ujung tag pembuka dicari sebagai `>` di luar
`{…}` dan string, karena `onChange={(e) => …}` memuat `>`; (c) `aria-hidden` sah ditulis
**tanpa nilai** di JSX (honeypot SPEC-352), jadi deteksinya tak boleh menuntut `=` — itulah
yang membuat honeypot keluar scope sendiri tanpa daftar khusus; (d) pemeriksaan "tak
mengulang label" hanya menyala saat placeholder **dan** namanya sama-sama literal statis —
banyak placeholder di sini ekspresi kondisional. Ia lantai, bukan seluruh aturan; sisanya
editorial.

**Konsekuensi untuk test:** kueri `getByPlaceholderText(...)` mengunci **salinan** UI, dan
salinan itu memang yang diperbaiki spec ini — tiga test pecah karenanya. Peganglah nama
aksesibilitasnya (`getByLabelText`), bukan placeholder-nya.

## Path project dipilih, bukan diketik (SPEC-217/218 · SPEC-858)

Browser tak bisa memulangkan path absolut dari `<input type="file" webkitdirectory>`, jadi
setiap field path project memakai `FolderPicker` (`src/src/screens/FolderPicker.tsx` — pindah
dari `App.tsx` di SPEC-867 saat call site keempat lahir di berkas lain) — modal yang menelusuri
filesystem **mesin server** lewat `GET /fs/browse` dan memulangkan path absolut. Ia dipakai
empat call site dengan bentuk yang sama — `Field` membungkus satu baris flex berisi `Input`
(`flex:1`, `minWidth:0` supaya baris tak melar di viewport sempit) + `Button size="sm"
variant="secondary" leftIcon="folder-open"` berbunyi "Pilih folder":

- **Project baru → from scratch**: Direktori tempat repo baru di-init.
- **Project baru → existing**: Direktori checkout lokal, atau folder tujuan clone.
- **Edit project → "Path (mesin ini)"** (SPEC-858): override per-mesin `LocalBinding`.
- **Detail project → "Belum ada checkout di mesin ini"** (SPEC-867): folder tujuan clone (picker
  memilih **induk**), dan folder repo yang sudah ter-clone manual.

Dua invariant. **`start={f.dir}`** — picker mulai dari nilai yang sedang ada di field, bukan
dari `homedir()`; tanpa itu mengoreksi satu path berarti menelusuri ulang dari akar tiap kali.
Dan **input teksnya tetap bisa diketik** sebagai fallback: picker hanya menulis `f.dir`, ia
bukan satu-satunya jalan masuk — path di mesin lain (atau yang belum ada) hanya bisa diketik.

Jalur simpannya tak berubah: Edit project tetap lewat `updateProject()` yang memisahkan
`name`/`desc`/`gitRemote` (`PATCH /projects/:id`, disync) dari `dir` (`PUT`/`DELETE
/projects/:id/binding`, **tak disync** — lihat [api-contract](../architecture/api-contract.md)).

Laporan "tombol Pilih folder di Edit project tidak ada" (SPEC-868) **bukan** cacat baris ini: diukur
di browser nyata 390–1440px tombolnya tampil penuh dan picker-nya terbuka di atas modal Edit. Yang
lama adalah JS di tab yang sudah terbuka — lihat
[audit SPEC-868](../research/audit-spec-868-tab-basi-setelah-update.md) dan seksi berikutnya.

## Tab yang bundle-nya ketinggalan servernya (SPEC-868)

Frontend disajikan dari paket npm yang sama dengan server, jadi restart update (ADR-0088) mengganti
bundle yang dilayani — tetapi **tab yang sudah ter-load tak memuat ulang apa pun**. Ia terus polling
`/api/*` dengan sukses karena API kompatibel mundur, jadi tak ada yang terlihat rusak; pengguna
hanya tak punya UI yang baru dirilis. Yang membuatnya tak terdiagnosis: `UpdateBadge` waktu itu
dirender **hanya saat `updateAvailable`**, dan tepat sesudah update terpasang nilai itu kembali
`false` — **tab paling basi justru terlihat paling terkini**. (SPEC-906 mencabut kepadaman itu: pil
versi netral kini tetap ada saat up-to-date. Yang ia tampilkan adalah `currentVersion` **milik
server**, jadi ia tak menggantikan `ReloadBadge` — tab basi tetap butuh perbandingan boot vs
sekarang di bawah untuk tahu dirinya ketinggalan.)

`UpdateStatus.currentVersion` (versi proses server) sudah tiba tiap frame WS grup `update`; yang
kurang cuma membandingkannya dengan versi saat tab ini memuat. `trackServerVersion`
(`src/src/api/update.ts`) adalah reducer murni yang menyimpan versi frame pertama sebagai `boot`;
`currentVersion` berbeda sesudahnya = server sudah di-restart ke versi lain → `restartedTo`.

Tiga invariant yang tak terbaca dari bentuknya. **Versi kosong tak pernah dihitung drift** — dev dan
bundle yang belum ter-stamp memulangkan `""`. **Server yang kembali ke `boot` menghapus status
basi**, bukan melatch-nya. Dan **`prev` dipulangkan apa adanya saat tak berubah**: frame `update`
datang tiap kali status registry di-recompute, sementara `getSnapshot` `useSyncExternalStore` wajib
referensial stabil.

`ReloadBadge` (`screens/UpdateIndicator.tsx`) menghuni slot topbar yang sama dengan `UpdateBadge` dan
merupakan pasangan arah sebaliknya — `UpdateBadge` = "server ketinggalan npm", `ReloadBadge` = "tab
ini ketinggalan server". Sejak SPEC-906 keduanya bisa tampil bersamaan (pil versi netral + ajakan
muat ulang) — itu justru keadaan yang benar sesudah update terpasang. Label panjang/ringkas mengikuti
kontrak topbar mobile SPEC-763. Ia **mengajak**, tak pernah memuat ulang sendiri: refresh tanpa
diminta membuang apa yang sedang diketik operator.

## Project tanpa checkout di mesin ini (SPEC-867)

`Project.repoDir` **tak pernah menyeberang sync** (`server/src/services/sync.ts`) dan `LocalBinding`
LOCAL-only per-device (ADR-0043), jadi project yang datang dari hub — dan project yang clone-nya
gagal saat dibuat — mendarat dengan `binding` **dan** `repoDir` null. Justru di keadaan itu detail
project paling bisu: pintu "Reverse docs"/"Scaffold docs" digerbangi path efektif (`App.tsx`),
sehingga keduanya **hilang tanpa alasan**. `MissingRepoCard`
(`src/src/screens/MissingRepoCard.tsx`) mengisi lubang itu dengan predikat yang **sama persis**
(`p.binding ?? p.repoDir`) — ia muncul tepat saat dua pintu itu menghilang, dan merender `null`
selebihnya.

Dua cabang. **Ada `gitRemote`**: "Clone dari git remote" (membuka modal) + "Pilih folder di device".
**Tanpa `gitRemote`**: clone dinyatakan mustahil apa adanya, tombolnya "Isi git remote" (mengantar
ke modal Edit yang memang punya field itu) + "Pilih folder di device".

Tiga hal yang membuatnya bekerja:

- **Folder pilihan adalah INDUK, bukan target.** `FolderPicker` memulangkan folder yang **sudah
  ada**; `git clone` menolak folder tak kosong. `cloneTargetInto` (`screens/git-remote.ts`)
  menyusun `<induk>/<repoBasename(remote)>` — tanpa itu percobaan pertama selalu gagal dengan
  "destination path already exists". `start` picker memegang **induk** terakhir, bukan target,
  karena target belum ada dan `GET /fs/browse` akan membalas 400 untuknya.
- **Kegagalan tinggal di dalam modal.** `POST /projects/:id/clone` membalas `{ error, detail }`
  dengan `detail` = **stderr git**, sementara `ApiError.message` cuma `POST /api/… → 409`.
  `cloneErrorText` mengangkat keduanya; modal tetap terbuka dengan tombol "Coba lagi", dan project
  tak tersentuh sama sekali.
- **Clone digerbangi `useConfirm`** (SPEC-847/ADR-0127). Klien tak bisa menjawab "folder ini
  kosong?" — `GET /fs/browse` hanya melist **direktori**, bukan berkas — jadi tak ada cara
  menggerbangi konfirmasi hanya pada folder tak kosong; ia dipasang di **setiap** clone, karena
  menulis ke disk mesin ini dan mengunduh isi repo memang layak dinamai lebih dulu. Dialognya
  menyebut folder tujuan, remote-nya, dan fakta bahwa **git yang menolak** folder berisi (terukur:
  `fatal: destination path '…' already exists and is not an empty directory`, berkas yang sudah ada
  tak tersentuh) — jadi pertanyaan "apa ini menimpa sesuatu?" dijawab di dalam dialog, bukan
  digantung. Opsi `run:` dipakai supaya dialog tetap terbuka & `busy` selama `git clone` berjalan;
  itulah yang menutup submit kedua, dan lemparannya diteruskan ke `catch` yang menampilkan stderr.
  Dua gotcha: `{dialog}` dirender **di luar** `<Modal>` clone (focus trap & entri `modalStack`
  sendiri; yang terakhir di DOM tampil paling atas), dan tombol ghost modal clone berbunyi
  **"Tutup"**, bukan "Batal" — dua "Batal" yang bertumpuk tak bisa dibedakan operator maupun test.
  "Pilih folder di device" **tak** dikonfirmasi: ia tak menyentuh disk sama sekali (hanya baris
  `LocalBinding`).

Binding hasil clone ditulis **oleh endpoint**; klien hanya memanggil `onProjectChanged` (jalur
refetch VM SPEC-258). Toast kegagalan clone di modal Project baru karena itu berhenti menyebut
"Edit" dan menunjuk kartu ini — cabang `catch`-nya sudah `setSection("project")`, jadi operator
mendarat persis di sana.

## Notifikasi backlog selesai (SPEC-180)
Awareness saat backlog mencapai `done`: toast, daftar (lonceng), dan sound. Semua sisi klien
bersandar pada notifikasi yang **dibuat server-side** (`GET /notifications`) — lihat
[ADR-0033](../adr/0033-notifikasi-backlog-selesai.md).

- **`NotificationsProvider`** (`src/src/notifications/NotificationsContext.tsx`) membungkus tree
  ter-autentikasi di `App`. Ia menerima notifikasi lewat WS siar `/events/ws` (grup `notifications`,
  SPEC-199) — bukan lagi poll 10s; server men-`scanDecisions` + query di satu loop lalu menyiarkan.
  Baseline = `createdAt` terbesar saat frame pertama (frame pertama **tidak** men-toast riwayat lama);
  notifikasi lebih baru → `showToast` + `playNotifySound`, digerbang setting `notifyDone`/`notifySound`.
  Helper murni `newSince`/`maxAt` diuji terpisah.
- **Notifikasi OS lintas tab (SPEC-196):** toast in-app hanya terlihat di tab hanoman yang fokus.
  Saat `document.hidden` (user pindah tab) dan izin `Notification` sudah granted, `notifyOS` menembak
  `new Notification(msg, { tag: id })` (Web Notifications API native) untuk `done` **dan** `decision`,
  sehingga notifikasi tetap sampai di level OS. Izin diminta pada gestur user pertama (membonceng
  listener unlock audio). Klik notifikasi OS → `window.focus()` + redirect ke sesi (`onOpen`).
- **`NotificationBell`** (`.../NotificationBell.tsx`) dirender di topbar `Shell` (konsumsi context,
  nol prop-threading ke ~9 call-site `<Shell>`; nilai context default aman untuk test tanpa provider):
  tombol lonceng + badge unread (`--clay-500`), dropdown daftar (`SPEC-x · judul`, "selesai · 5 menit lalu" (`relativeTime`),
  dot unread). Membuka dropdown TIDAK menandai apa pun (audit 2026-10). "Jawab" (keputusan, aksi primer) dan "Buka" pada satu item =
  `POST /notifications/:id/read` (ADR-0204): optimistik, galat → item kembali belum-dibaca + toast err;
  arsip "Semua notifikasi" memakai jalur yang sama. "Tandai semua dibaca" = `POST /notifications/read`.
  Tombol "Bersihkan" = `DELETE /notifications`.
- **`UpdateBadge`** (`screens/UpdateIndicator.tsx`) — pil topbar **dua wajah dalam satu kontrol**
  (SPEC-906), keduanya bersumber dari `useUpdate()` (store WS grup `update`, pola `useLimits`).
  `updateAvailable` → pil **brass** `Update · <latest>`; popover: heading, perintah update dalam blok
  mono + tombol **Salin**, tombol **Pasang & mulai ulang** bila `canApply` (SPEC-405 · ADR-0088),
  baris `terpasang X · tersedia Y`. Sudah terkini → pil **netral** (`--bone-100`/`--border-hair`,
  bukan brass: keadaan ini tak meminta apa pun) berlabel `v<currentVersion>`; popover ringkas berisi
  baris versi yang sama + `updateRegistryLine(u)` — sebab "sudah terbaru" hanya berarti sesuatu bila
  jelas menurut registry mana dan kapan diperiksa, dan `registry.status: "unavailable"` (offline,
  opt-out, paket belum terbit) **bukan** error. Sebelum SPEC-906 pil ini padam total saat up-to-date
  dan versi yang sedang dipakai instance tak tersebut di satu tempat pun di UI. Satu gerbang tersisa:
  `currentVersion` kosong (dev/bundle belum ter-stamp) tetap tak merender apa-apa — pil `v` telanjang
  lebih buruk daripada topbar kosong. Label panjang/ringkas mengikuti kontrak topbar mobile SPEC-763
  (`.hn-topbar-label`/`-short`): di layar sempit yang tersisa nomor versinya saja, nama kontrolnya
  dipikul `aria-label`/`title`.
- **`AccountMenu`** (`auth/AccountMenu.tsx`) — widget topbar `Shell` paling kanan (SPEC-216): tombol
  avatar (inisial huruf pertama email, lingkaran brass) yang membuka popover berisi email pengguna +
  tombol **Keluar**. Konsumsi `AuthContext` (`auth/AuthContext.tsx`, provider `AuthProvider` di `App`,
  pola sama `NotificationBell`) — **nol prop-threading** ke ~9 call-site `<Shell>`; nilai context default
  aman (`user: null` → tak merender apa-apa) sehingga `<Shell>` tanpa provider (mis. test) tak error.
  **Keluar** memanggil `POST /auth/logout` lalu balik ke Login (`onLoggedOut`); walau jaringan gagal,
  state klien tetap dibersihkan (`catch`+`finally`). Tombol logout **sekunder** tetap ada di
  Settings → Akun.
- **Sound**: WAV bundled di `src/public/sounds/notify-<kind>.wav`, dibangkitkan
  `scripts/gen-notify-sounds.mjs` (deterministik, in-repo). `playNotifySound(kind)` (`.../sound.ts`)
  memakai **satu** elemen `Audio` yang dipakai ulang; `unlockNotifySound()` meng-unlock elemen itu
  (prime muted→play→pause) pada **gestur user pertama** (listener `pointerdown`/`keydown` di
  `NotificationsProvider`), supaya bunyi dari push notifikasi WS tak ditolak autoplay (SPEC-192).
- **Setting** di layar Settings → section "Sesi & notifikasi": toggle **Notifikasi backlog selesai**
  (`notifyDone`), select **Sound** (`notifySound`: Short/Medium/Long/Senyap) + tombol **Preview**.

## Audit UI/UX 2026-10 · Fase 4 · Jawab dari notifikasi & migrasi inline

Lanjutan [rencana perbaikan](../../../docs/superpowers/plans/2026-10-11-ui-ux-audit.md) (Fase 2C/2G yang tertunda). Dua hal: aksi **Jawab** langsung dari notifikasi, dan migrasi `style={{` literal ke kelas CSS (visual-ekuivalen).

**Jawab dari notifikasi.**

- Toast keputusan (`NotificationsContext`, satu-satunya tempat toast notifikasi live) membawa `action: { label: "Jawab" }` dan `duration: 7000`. Aksi = `markRead(id)` lalu `onOpen(n)`, yaitu `App.openNotification` → Terminal terfokus ke sesi itu (`notifTarget`, fokus yang sudah ada).
- Toast **dilewati** bila `isViewing(n)` bernilai benar: `section === "terminal" && focusSession === n.sessionId` (App). Bunyi dan notifikasi OS tetap berjalan. Batas: sesi yang dipilih manual di rail Terminal tak dilaporkan ke App (layar itu memegang fokusnya sendiri), jadi predikat hanya mengenali sesi yang dibuka dari notifikasi, palet, atau pet.
- Satu notifikasi = satu toast: `toasted` (Set id, berbatas 200) di atas baseline frame pertama.
- Lonceng dan arsip: keputusan menampilkan **Jawab** sebagai aksi primer (`.hn-notif-open--primary`); "Buka" dan "Lihat triase" tetap. Membuka dropdown tetap tak menandai apa pun.
- Waktu relatif di lonceng dan arsip memakai `relativeTime` ("5 menit lalu"), bukan "5m lalu".

**Migrasi inline → kelas.** Kelas baru di `src/src/styles/app-shell.css` (diimpor `ds/kit.tsx`) dan `src/src/notifications/notifications.css`. Nilai tiap kelas sama dengan inline yang diganti. `app.css` tak disentuh.

| Berkas | `style={{` sebelum | sesudah | Sisa dan alasannya |
|---|---|---|---|
| `App.tsx` | 49 | 0 | — |
| `ds/kit.tsx` | 24 | 3 | lebar panel Modal (prop `width`); `HnTextarea` (fokus dan invalid dinamis); `PagerBtn` (aktif, hover, disabled dinamis) |
| `ds/shell.tsx` | 8 | 1 | tombol nav (aktif, hover, `interactive` dinamis). Skip link (`style={skipShown ? …}`) tetap dan dites di `shell-a11y` |
| `notifications/NotificationBell.tsx` | 17 | 0 | — |
| `notifications/NotificationsArchiveModal.tsx` | 5 | 0 | — |
| `screens/PetAnswer.tsx` | 15 | 0 | `style={flat}` ×4 tetap: override reduced-motion ke `Button`, yang menaruh transisinya sendiri secara inline |

Catatan:

- `Input` dan `Select` meneruskan `className` dan `style` ke **pembungkus**, bukan ke `<input>`. Maka `width: 100%` → `hn-w-full`, `flex: 1` → `hn-grow`, dan `flex: 1, minWidth: 0` → `hn-grow-min`.
- Aturan mobile `!important` di `app.css` (grid, modal, popover) tetap menang atas kelas baru.
- Footer Modal memakai `.hn-modal-panel > .hn-modal-footer` (spesifisitas lebih) supaya padding bawahnya tetap 14px dan tak bergantung urutan impor CSS.
- Test: `test/notifications-decision-toast.test.tsx` (aksi Jawab lewat `ToastHost`, dilewati saat sesi ditonton, durasi 7 dtk, satu notifikasi satu toast) dan `test/notification-bell.test.tsx` (Jawab menandai terbaca dan memanggil navigasi; waktu relatif).

## IDE Visual (SPEC-182 · ADR-0034)
Nav entri **IDE** (`code-2`) membuka `IdeScreen` (`screens/IdeScreen.tsx`), difilter per project lewat
`Select` di toolbar (pola sama dengan Docs · SoT). Tiga tab berbagi toolbar: **Explorer**, **Git Graph**,
dan **Branches** (SPEC-360).

- **Toolbar**: `Select` project + `Select` **ref** (opsi `· working tree ·` + branch local +
  `origin/<b>` dari `api.listBranches`) + tombol **Checkout**. Memilih ref hanya mengubah **sudut
  pandang** (drives `GET /tree`/`/file` lewat `?ref=`) — melihat branch origin **tanpa** checkout.
  Tombol Checkout memanggil `POST /git {op:"checkout"}` yang memindah HEAD working tree sungguhan.
- **Explorer**: grid `300px 1fr`. Kiri, dari atas ke bawah: dua section SCM **Staged** & **Changed**
  lalu **pohon folder Files** (`buildFileTree`+`TreeRow` dari `screens/file-tree.tsx`, `api.ideTree`) —
  folder **default collapse** ala Review (SPEC-189, tanpa `meta`/`defaultOpen` → ikon file biasa,
  tertutup). Kanan pane isi (`api.ideFile`): view source = `<pre><code class="hljs">` di-highlight
  **highlight.js** (bahasa dari ekstensi, fallback `highlightAuto`); edit = `<textarea>` mono + Simpan
  (`api.putIdeFile`). File biner → placeholder.
  - **Preview `.md` (SPEC-240)**: berkas `.md` **default menampilkan markdown terender** — bukan raw
    source — lewat `MarkdownView` (`ds/markdown.tsx`, marked + DOMPurify + `.hn-md`, renderer
    **bersama** Docs·SoT & `SpecDocsModal`). Header pane memberi toggle **Preview | Source** di samping **Edit** (pola pill
    yang sama dengan toggle Diff|Source); **Source** menampilkan raw source highlighted seperti biasa.
    State `mdView` (default `"preview"`) di-reset ke preview tiap `.md` baru dipilih; **Edit** tetap
    mengubah raw source, dan sesudah **Simpan** kembali ke preview. File **non-`.md`** tak punya toggle
    (tetap highlighted source + Edit). Helper `isMarkdown(path) = /\.md$/i`. Frontend-only, tanpa endpoint baru.
  - **Staged & Changed (SPEC-234)**: **Staged** = index vs HEAD, **Changed** = working tree vs index +
    untracked; masing-masing toggle **List | Tree** lewat `ChangedSection` shared di `file-tree.tsx`
    (dipakai Review juga). Data `api.ideStatus` (`GET /projects/:id/status`), **independen** dari
    dropdown ref (status inheren milik working tree utama). Klik file → pane kanan **diff** read-only
    (toggle Diff | Source, `DiffView` shared di `screens/diff-view.tsx`) via `api.ideFileDiff`; klik
    file dari pohon Files tetap membuka **editor**. Header kiri menampilkan branch aktif; **Muat ulang**
    & tiap git op (checkout/merge) menyegarkan status. Read-only — tak ada stage/unstage dari UI.
- **Git Graph** (`screens/GitGraph.tsx`): DAG commit dari `api.ideGraph`, lane dihitung **client-side**
  murni oleh `computeLanes` (`screens/git-graph.ts`, nol dep, diuji terpisah). Segmen penyambung
  diturunkan `rowEdges` (in/out/through per-baris) → digambar **cubic-bezier** (SPEC-189) sehingga
  branch & merge tersambung lintas lane, bukan garis melayang. Baris = SVG lane berwarna + chip ref
  (HEAD di-`--brass-500`) + subject + author + tanggal relatif (kolom rata, hover bone). **Klik**
  commit → panel detail (`api.ideCommit`) + daftar file berubah (klik file → buka di Explorer pada sha itu).
  **Klik-kanan** → context-menu: Checkout / Merge ke branch ini / Cherry-pick / Revert / Buat branch
  di sini… / **Hapus branch** — tiap aksi `POST /git`. Hapus sadar local vs origin (SPEC-206,
  `menuItems`): ref `origin/<b>` dikelompokkan dengan branch lokal `<b>`; per branch ditawarkan
  "Hapus `<b>` (local + origin)" / "(local)" / "Hapus origin/`<b>`" sesuai ref yang ada (local tak
  boleh branch aktif; origin selalu boleh). `origin/HEAD` diabaikan.
- **Dialog Paksa**: mutasi yang balas **409** (sesi aktif / tree kotor) memunculkan `ForceDialog`
  dengan pesan git asli + tombol **Paksa** yang mengulang op `force:true` (peringatan: bisa membuang
  perubahan tak ter-commit & mengganggu sesi Claude). Aman-default; force opt-in per aksi.

### Tab Branches — semua branch project (SPEC-360 · ADR-0077 · SPEC-859)
Tab ketiga IDE Visual, di samping Explorer & Git Graph. `BranchesPanel.tsx` hidup sebagai komponen
sendiri — `GitGraph.tsx` sudah 43 KB dan tak layak ditumpangi lagi. Isinya **seluruh** branch project,
local maupun origin, ter-merge maupun belum: panel meminta `api.branchesUnused(id, base, "all")` sekali
lalu menyaring di klien, sehingga "yang sedang tampak" persis sama dengan yang bisa dipilih.

- **Header**: kotak **cari** nama branch + `Select` **status** (`semua status` default ·
  `ter-merge saja` · `belum ter-merge`) + `Select` **base** (default "base otomatis", opsinya dari
  `api.listBranches`) + `Select` **scope** (`local + origin` default · `local saja` · `origin saja`) +
  **Muat ulang** + tombol **Hapus terpilih (N)**. Mengganti base memuat ulang laporan; mengganti
  status/cari mengosongkan pilihan dan mengembalikan batas render.
- **Baris**: checkbox · nama branch (mono) · badge **status** (`ter-merge` tone `ok` / `belum ter-merge`
  tone `warn`) · badge scope `local`/`origin`/`local + origin` · badge alasan untuk baris terkunci
  (`LOCK_LABEL`) · subject + umur commit terakhir · tombol **Hapus** per baris. Baris terkunci
  (`locks` tak kosong — termasuk `main` yang selalu tampil sebagai base+current) checkbox-nya mati dan
  tombol Hapus-nya disabled; "Pilih semua yang boleh" melewatinya.
- **Batas render** `PAGE = 100` + tombol **Tampilkan N lagi**. Batas ini **bagian dari definisi "sedang
  tampak"**: `Pilih semua yang boleh (N)` hanya mencakup baris yang benar-benar dirender, jadi pilihan
  tak pernah memuat branch yang tak terlihat operator. Server memancarkan daftar penuh urut nama;
  yang membatasi hanya klien.
- **Konfirmasi & hasil**: `ConfirmDialog` menyebut jumlah + scope; hasil dilaporkan per baris
  (`N terhapus (K dipaksa) · M gagal`, tiap kegagalan menampilkan `error` dari server) sehingga
  kegagalan sebagian terlihat apa adanya, bukan tersembunyi di balik satu toast.
- **Dialog risiko untuk branch belum ter-merge (SPEC-859)**: begitu target memuat satu saja branch
  `merged:false`, dialognya berbeda — `impact` menyebut jumlah + nama branch-nya dan menyatakan commit
  yang hanya ada di sana akan hilang, dan `requireText` menuntut ketikan ulang (nama branch bila
  targetnya satu, `hapus paksa` bila batch — pola ADR-0121). **Hanya** dialog inilah yang mengirim
  `allowUnmerged: true`; batch yang seluruhnya ter-merge tak pernah membawanya.
- **Dua empty state yang berbeda**: "Tak ada branch" (project memang belum punya branch) vs "Tak ada
  branch cocok filter" (daftar tersaring) — supaya daftar tersaring tak terbaca sebagai data kosong.
- **Dua jebakan test yang sudah memakan korban** — keduanya membuat test "lulus" secara palsu:
  `Checkbox` design system bukan `<input type=checkbox>` melainkan `<label>` (pembawa `data-testid`)
  yang membungkus `<span>`, dan **onClick hidup di span itu** — mengklik label adalah no-op
  (pelajaran SPEC-299), jadi test mengklik `getByTestId(id).firstElementChild`. Dan `Tabs` merender
  `<button role="tab">`; role eksplisit menimpa role implisit, jadi query tab WAJIB `role: "tab"`,
  bukan `"button"`. `confirmLabel` dialog sengaja "Ya, hapus" karena tombol per baris sudah "Hapus".

### Parity ekstensi Git Graph (SPEC-233 · ADR-0055)
Git graph diperluas mendekati ekstensi VS Code **Git Graph** (mhutchie). Semua tetap tunduk gate sesi +
force (op menyentuh working tree) atau worktree isolasi + handoff sesi claude (op rawan konflik):
- **Menu commit**: reset (soft/mixed/hard), **rebase current → sini**, **drop commit**, copy hash/subject,
  **Add tag…** (lightweight/annotated + push). Rebase/drop lewat `POST /git/rebase|drop` (isolasi); konflik → Terminal.
- **Menu branch** (klik-kanan chip ref, `branchMenuItems`): checkout, rename, push, merge/**rebase** ke current,
  hapus (local/origin/both), **Create Pull Request** (`api.idePrUrl` → provider), **Create archive** (`api.ideArchiveUrl`).
  Ref `origin/*` juga: **Pull into current** (`POST /git/pull`).
- **Menu tag** (chip tag terpisah, warna leaf): hapus (local/+origin), push, copy.
- **Baris uncommitted changes** (lingkaran terbuka) dari `api.ideStatus` bila tree kotor → menu: stash,
  reset (mixed/hard), clean untracked. **Strip stash** (`api.ideStashes`): apply/pop/drop/branch-from/copy.
- **Detail commit** diperkaya: badge **signed** (`%G?`), avatar **gravatar** (config `fetchAvatars`, default off),
  toggle **tree/flat**, klik file → **modal diff** (reuse `DiffView` dari `screens/diff-view.tsx`, tab Diff|Source),
  aksi per-file (view-at-rev/open/copy path), body **linkify** URL/issue/parent-hash + **emoji**/**markdown**
  (`screens/git-graph-render.ts`, dep-nol, md5 gravatar internal).
- **Compare dua commit**: Ctrl/Cmd-klik commit kedua → panel + modal diff (`api.ideCompare`/`ideCompareFile`).
- **Find** (⌘F, client-side atas baris ter-muat, fallback `api.ideSearch`) + **center HEAD** (⌘H); hasil di-highlight & di-navigasi.
- **Kontrol tampilan**: filter branch (`?branches=`), toggle remote/tag, redup merge-commit, style rounded↔angular.
  Preferensi dari **CONFIG_REGISTRY grup `gitGraph`** (`api.getConfig`): warna lane, style, tanggal, show/hide, mute,
  fetchAvatars, emoji/markdown, issue-link pattern.
- **Jendela commit berhalaman (SPEC-351)**: `?limit=` bukan konstanta melainkan **halaman** (`PAGE = 200`).
  `limit` hidup di dalam state `gopts` — satu update, jadi mengganti filter/toggle me-reset jendela ke halaman
  pertama tanpa fetch ganda. `hasMore` diturunkan dari `commits.length >= limit` (git memotong tepat di
  `--max-count`, jadi balasan penuh = mungkin masih ada; halaman yang tak penuh menutup sendiri penandanya).
  **Baris penutup** di kaki daftar selalu menyatakan `N commit dimuat` + `· seluruh history` atau tombol
  `Muat 200 lagi`; baris itu sekaligus **sentinel `IntersectionObserver`** yang memuat halaman berikutnya begitu
  tergulir masuk viewport (tombol = jalur manual + fallback tanpa `IntersectionObserver`). Penambahan halaman
  dimuat **diam** (`pagingRef`) supaya baris yang sudah tampil tak diganti StateBlock dan posisi guliran bertahan;
  pembaruan diam SPEC-245 ikut memakai `limit` berjalan sehingga jendela tak pernah menyusut.
- **Modal Remotes** (`IdeScreen`): list/add/hapus remote (`api.ideRemotes`/`ideAddRemote`/`ideDeleteRemote`); tombol **Fetch** (`--prune`).

## Help Center — halaman publik + Triase + kartu link (SPEC-253 · ADR-0062)

**Rute publik pertama di SPA.** `main.tsx` men-mount `<PublicHelpApp/>` (`public/PublicHelpApp.tsx`) saat
`location.pathname` diawali `/help/` — **tanpa** `AuthProvider`/Shell/login; selainnya `<App/>` biasa.
Fallback `index.html` sudah ada (prod `setNotFoundHandler`; dev Vite historyApiFallback) → bundle yang sama
melayani keduanya, **nol perubahan server** untuk menyajikan halaman. `PublicHelpApp` mem-parse path:
`/help/:slug` → **form keluhan** (Select kategori, judul, detail, email, input file ≤3 gambar + preview,
field honeypot `hc_trap` tersembunyi — nama netral + `autocomplete="new-password"`, SPEC-352) yang submit
multipart via `api/help.ts` (`helpApi`, same-origin fetch; **memvalidasi bentuk respons** sebelum merender
sukses, karena honeypot menjawab `200 {ok:true}`) lalu
menampilkan **nomor tiket + link status berkode** (Salin); `/help/:slug/status/:key` → **status publik**
terpetakan otomatis. Layout minimal (bone paper, `Card`/`Button`/`Select`/`StateBlock` DS tanpa context auth).

**Triase** (nav `triage` "Triase" `inbox` di `HN_NAV`; cabang `section === "triage"` di `App.tsx`, pola VPS
— screen mandiri, tak lewat `gate`). `screens/TriageScreen.tsx`: **muat awal lewat HTTP + pembaruan diam lewat langganan
`tickets` di `/api/events/ws`** (SPEC-908/ADR-0145, `useLiveTopic`) — kunci langganannya memuat
filter, `q` (di-debounce 400 ms), dan nomor halaman yang sedang aktif, jadi frame halaman lain tak
mendarat; `setInterval` hanya menyala sebagai fallback saat server belum punya topiknya. Master→detail: daftar tiket (Badge status + kategori, judul, email, waktu
relatif, badge **"belum ditinjau"** dari `unreviewed`) + filter project/status + cari; detail = isi penuh +
**lampiran** (thumbnail via `GET /tickets/:id/attachments/:attId`, ber-auth same-origin) + email + tombol
**Terima** (Select prioritas → `api.acceptTicket`) & **Tolak** (`useConfirm` → `api.rejectTicket`) + tautan
`→ SPEC-N` bila sudah promoted. **Terima** → `onAccepted(spec)` → `setProjectFilter` + `setSection("backlog")` + toast.

**Kartu Help Center** di `ProjectDetailScreen.tsx` (`HelpCenterCard`): toggle
Aktifkan/Nonaktifkan (`api.enableHelpCenter`/`disableHelpCenter`); saat aktif tampil **link publik**
(`<base>/help/<slug>`, dari `api.getHelpCenter`) + tombol **Salin**.

**Notifikasi tiket** (reuse jalur existing): `zNotification.type` menerima `ticket`; `toastFor` → tone warn +
icon `inbox`; `NotificationBell` per-tipe (icon/warna brass, label "keluhan baru", aksi "Lihat triase");
`notifTarget` → `{ section: "triage", projectFilter }`. Server menotifikasi **setiap** tiket baru (dedup `key`),
tersiar lewat grup `notifications` WS existing.

## Portal klien — chrome sendiri, rantai gulir sendiri, warna dari fungsi murni (SPEC-617/626/647 · ADR-0110/0111)

> Fase 3M (Audit UI/UX 2026-10): Beranda Klien dengan linimasa keluhan 4 langkah dan sheet "Lapor masalah" dua langkah. Tab kini *Keluhan saya* · *Progres pekerjaan* · *Tanya & ide*. Lihat [Fase 3 · Review, Auth, Portal, Onboarding](#audit-uiux-2026-10--fase-3--review-auth-portal-onboarding-3l--3m--3n).


`ClientPortal` (`portal/ClientPortal.tsx`) di-fork di `App.tsx` **sesudah gerbang auth**, sebelum
`Shell`: sidebar `HN_NAV` adalah navigasi operator, dan setiap entrinya adalah 403 yang menunggu
diklik. Konsekuensinya ia tak mewarisi apa pun dari `Shell` — termasuk **scroll**.

**Rantai gulir.** `#root` dikunci dynamic viewport + `overflow: hidden` (lihat "Tinggi & scrolling" di atas),
jadi layar yang tak memasang scroller-nya sendiri tak bisa digulir sama sekali — bukan terpotong
di ujung, melainkan tak terjangkau sejak baris pertama yang melewati viewport. Portal karena itu
memakai konstanta DS yang **sama** dengan layar operator, bukan angka baru:

| elemen | style | arti |
|---|---|---|
| root (`data-testid="portal-root"`) | `height:100dvh`, `min-height:0`, kolom flex | sumber batas tinggi |
| `<header>` | `FIXED_ROW_STYLE` | **di luar scroller** → tetap terbaca saat daftar digulir |
| `<main>` (`data-testid="portal-scroll"`) | `LIST_SCROLL_STYLE` | satu-satunya yang menggulir |

Di dalam `<main>` ada pembungkus `max-width`/padding biasa: begitu berada **di dalam** scroller,
pembungkus `display: block` yang tumbuh setinggi isinya justru yang benar. Karena itu test
`portal-scroll.test.tsx` memeriksa rantai dari **scroller ke atas**, bukan dari daftar ke atas.
Isi `Modal` mewarisi kontrak dialog bersama: pada mobile panel menjadi bottom sheet yang di-clamp
ke `100dvh` + safe-area; badannya `overflow:auto`, footer membungkus, dan fokus dikurung lalu
dikembalikan. Overlay `position:fixed` tak diklip `#root` (yang tak membuat containing block).

**Warna badge = fungsi murni, bukan literal.** `portal/status-pill.ts` memetakan keadaan → status
`StatusPill` yang sudah ada; nol warna baru, nol warna literal di layar. Keduanya **tabel +
fallback `idle`** sehingga TOTAL: nilai tak dikenal netral, bukan warna yang percaya diri tentang
keadaan yang tak diketahui. Satu sumber dipakai baris daftar **dan** modal — warna berbeda di dua
tempat untuk item yang sama adalah bug SPEC-626, bukan variasi.

| yang dilihat klien (`publicStatus()`, SPEC-293) | `StatusPill` | warna |
|---|---|---|
| `Sedang ditinjau` (tiket `new`) | `queued` | wind |
| `Diterima` (`accepted`, belum jalan) | `awaiting` | amber |
| `Sedang dikerjakan` (`accepted` + stage `executing`) | `running` | brass |
| `Selesai` (`accepted` + stage `done`) | `done` | leaf |
| `Ditutup` (tiket `rejected`) | `failed` | clay |

| stage backlog | label (`STAGE_LABEL`) | `StatusPill` |
|---|---|---|
| `brainstorming`, `objective` | Dirumuskan | `queued` |
| `spec-ready` | Disiapkan | `queued` |
| `planned` | Direncanakan | `queued` |
| `executing` | Sedang dikerjakan | `running` |
| `done` | Selesai | `done` |
| *tak dikenal* | labelnya sendiri | `idle` |

Domain `ticketPill` adalah **kosakata klien**, bukan `Ticket.status` mentah: `toPortalTicket()`
sudah memetakannya lewat `publicStatus()` sebelum dikirim. Pemetaannya diikat ke sumber itu oleh
test kontrak yang menyilangkan seluruh status × stage — kosakata yang berubah di `publicStatus()`
membuat test merah, bukan diam-diam jadi abu-abu.

**Paginasi** (SPEC-647 · ADR-0107 diterapkan, tanpa ADR baru). Kedua daftar mengambil dan
merender **satu halaman** (`PORTAL_PAGE = 20`, cermin `TICKET_PAGE` triase) lewat `Pager` design
system + `serverPage()` — bukan tombol ad-hoc. Endpoint-nya sudah beramplop `Paginated` sejak
ADR-0110; yang tak pernah ada adalah **kliennya** — `api/portal.ts` memanggil tanpa satu pun
parameter, dan `paginate()` tanpa `limit` membalas SELURUH baris. Empat hal yang menentukan
bentuknya:

- **`page` dan `limit` selalu berpasangan.** `api/portal.ts` menerima satu argumen
  `PortalPage = {page,limit}`; `limit` tanpa `page` bukan halaman melainkan **plafon** (jebakan
  terukur SPEC-523). Bentuk argumennya yang mencegahnya, bukan disiplin call site.
- **Angka di tab = `total` dari amplop**, bukan `items.length`. Sesudah paginasi, `items.length`
  hanya menjawab "berapa baris yang kebetulan tampil" — lencana yang mengecil saat klien membuka
  halaman 2 adalah kebohongan (ADR-0107). Itu juga satu-satunya alasan **kedua** daftar tetap
  dimuat bersama meski hanya satu yang tampak.
- **Satu nomor halaman per daftar, di-reset oleh satu effect `[active, tab]`.** Ganti project atau
  tab → halaman 1 (idiom `TriageScreen`); klik halaman **tidak** menggeser project maupun tab.
  `onSent` (kirim keluhan) memaksa halaman tiket ke 1 — tiket baru duduk paling atas
  (`createdAt desc`), jadi memuat ulang di halaman aktif akan menyembunyikan tiket yang baru saja
  dikirim. Muat ulang untuk project yang sama dipicu penghitung `reload` supaya reset halaman +
  pemuatan jadi **satu** fetch.
- **Respons basi tak menimpa halaman yang lebih baru:** `loadLists` memegang nomor urut di
  `useRef` dan hanya respons terbaru yang boleh `setState`.

`Pager` portal **tak** memakai `FIXED_ROW_STYLE`: portal hanya punya satu scroller (`<main>`,
tabel di atas) dan tak memakai rantai flex per-daftar seperti layar operator, jadi ia ikut
menggulir di ujung daftarnya. Keadaan kosong & ujung daftar bawaan DS: `Pager` mengembalikan
`null` saat `total === 0` (jadi `StateBlock` kosong tetap sendirian) dan men-disable
Sebelumnya/Berikutnya di ujung — tak ada tombol yang menggantung aktif.

**Pemilih project sengaja tanpa kontrol halaman** — dinyatakan supaya audit berikutnya tak
"memperbaikinya". `GET /portal/projects` ikut beramplop `paginate()` (pola yang sama, bukan pola
sendiri) dan UI memintanya tanpa query: ia pemilih, bukan daftar yang ditelusuri, dan project
terpilih yang jatuh dari halaman justru mematahkan syarat "perpindahan halaman mempertahankan
project terpilih".

**Kirim keluhan** (SPEC-626 · ADR-0111). Tombol di baris tab (terlihat dari kedua tab) membuka
`TicketForm` (`portal/TicketForm.tsx`): Project (hanya yang boleh diakses, default project aktif) ·
Kategori (`zTicketCategory.options`) · Judul · Detail · lampiran gambar opsional ≤3. **Tak ada
field email** — server mengambilnya dari akun — dan **tak ada honeypot**: `hc_trap` menebak
"apakah ini bot", sedangkan portal sudah tahu siapa pengirimnya. Sesudah `201`, modal tertutup,
tab pindah ke Help desk, dan daftar tiket **dimuat ulang dari server** (bukan disisipkan di klien)
sehingga yang tampil adalah tiket seperti yang dilihat operator.

## Badge "butuh pengajuan" di sidebar (SPEC-961)

Sidebar tak pernah menjawab pertanyaan pertama operator tiap kali membuka dashboard: **apa lagi yang
menunggu saya?** Empat permukaan `HN_NAV` karena itu membawa **badge angka** di tepi kanan entrinya:

| Nav | Yang dihitung |
| --- | --- |
| `triage` | `Ticket` + `GithubIssue` berstatus `new` — dua kanal masuk, satu angka, persis seperti layarnya |
| `backlog` | `Spec` yang **belum pernah punya sesi** (`startedAt === null`, ADR-0090) dan belum `done` |
| `prd` | PRD berstatus `draft` — belum melahirkan satu pun backlog (`shared/src/prd-status.ts`) |
| `lead` | `LeadFlow` yang masih terbuka (`menunggu` / `sebagian`) |

**Angkanya datang dari server, bukan dihitung di klien.** Grup siar GLOBAL ke-11 `pending` di
`/api/events/ws` (tiap 5 dtk, dedup signature — frame lahir hanya saat salah satu angka berubah).
Menghitungnya di klien mustahil tanpa berbohong: tiket, issue GitHub, dan PRD tak ada di frame
global mana pun, dan `specs` sendiri berpaginasi di layarnya.

**Bentuknya satu definisi, dibaca dua sisi.** `shared/src/pending.ts` memegang tipe `PendingCounts`,
kosakata status lead yang terbuka, dan helper render (`pendingFor`, `pendingLabel`, `pendingTotal`).
Server mengisi angkanya, `shell.tsx` merender — dan "belum diputuskan" tak bisa berarti dua hal di
kedua ujung (pola yang sama dipakai `ticket-status.ts` & `prd-status.ts`).

**Empat keputusan tampilan yang mengikat:**

1. **Nol tak pernah dirender.** Nol adalah keadaan paling sering, dan kolom "0" di seluruh sidebar
   berisik justru saat tak ada yang perlu dikerjakan.
2. **`null` ≠ nol.** Server yang lebih tua tak pernah mengirim frame `pending` (ADR-0087); sampai
   frame pertama tiba sidebar terlihat **persis seperti sebelum SPEC ini**, bukan seperti instalasi
   yang antreannya kosong.
3. **Angka masuk ke nama tombolnya** (`aria-label` "Triase, 3 butuh pengajuan"). Pada rail tablet
   (768–1199px) label nav disembunyikan CSS, jadi angka yang hanya hidup sebagai teks badge tak
   punya cara diumumkan; badge-nya sendiri `aria-hidden` supaya tak dibacakan dua kali.
4. **Context, bukan prop.** `NavPending` mengikuti `NavGate` (SPEC-919) dengan alasan yang sama:
   `Shell` dirender di belasan cabang `App`, dan cabang yang terlewat tak akan error — ia hanya
   kehilangan badge-nya, senyap.

Warnanya **kertas di atas brass tua** (`--bone-000` pada `--brass-700`), bukan clay: ini pekerjaan
yang menunggu, bukan kesalahan. Pasangan itu diukur, bukan dipilih dari nama token — rilis 0.2.5
sempat mengirim `color: var(--text-on-brass)`, yang **nilainya `var(--ink-900)`**: tinta gelap yang
dirancang untuk `--accent` (brass-500) yang terang. Di atas brass-600 rasionya **3,77:1** dan
angkanya tak terbaca sama sekali di layar; pasangan sekarang **6,65:1**. Typecheck, build, dan
seluruh test render lolos tanpa satu pun dari mereka melihat warna — karena itu gerbangnya kini
menghitung rasio WCAG dari nilai token yang berlaku (`nav-pending-badge.test.tsx`), lengkap dengan
kontrol negatif yang membuktikan pasangan lama gagal di gerbang yang sama. Test:
`src/test/nav-pending-badge.test.tsx` (render), `shared/src/pending.test.ts` (aturan angka),
`server/test/pending-counts.service.test.ts` (definisi + cache PRD), dan `server/test/events.test.ts`
(frame ikut di `attach`, karena badge ini tak punya muat awal HTTP).

## Settings → Akses AI Agent → MCP server (SPEC-482 · ADR-0099)

`src/src/screens/McpPanel.tsx` dirender **di dalam** `AgentAccessPanel` (tab "Akses AI Agent"), di
bawah kartu master switch dan daftar token — memasang MCP server dan memberi capability adalah satu
pekerjaan manusia, dan memisahkannya ke tab lain membuat setengahnya tak pernah terlihat. Dua kartu:

1. **MCP server** — pemilih klien (Claude Code · Claude Desktop · Codex · Cursor/Copilot) yang
   mengganti bentuk snippet (JSON `mcpServers` / JSON `servers` / TOML `[mcp_servers.hanoman]`),
   plus sakelar **Mode baca-saja** yang menambahkan `"--read-only"` ke `args`. Host diisi dari
   `window.location.origin` sehingga snippet selalu menunjuk instance yang sedang dibuka — agent
   token diterbitkan per-instance. **Token selalu placeholder `hnm_agt_…`**: panel ini memang tak
   punya aksesnya (server hanya menyimpan sha256), dan batasan SPEC-482 melarang token muncul di
   contoh pemasangan. Tombol Salin memakai `navigator.clipboard` dengan penanganan gagal yang diam
   — snippet tetap terlihat dan bisa diblok manual di konteks non-secure.
2. **Tool yang tersedia** — tabel `nama · mode · capability` yang dirender dari **`MCP_TOOLS`**
   (`@hanoman/shared`), sumber yang sama dengan runtime MCP. Daftar capability yang ditulis tangan
   di panel adalah daftar yang akan basi; inilah yang memberi tahu manusia checkbox mana yang perlu
   dicentang di kartu token tepat di atasnya.

Panel ini **tidak memanggil API sama sekali** — seluruh isinya turunan dari katalog di `shared` dan
dari `window.location.origin`, jadi ia tak punya state loading/error.

## Settings → Telegram (SPEC-476 · ADR-0096 · kredensial SPEC-477 · ADR-0097)

Tab Telegram memakai pola Settings existing: state loading/error tidak pernah jatuh ke default yang
dapat menimpa setelan server. Tiga kartu:

1. **Kredensial** — empat field dari `GET /api/telegram/settings`. Bot token & AgentToken
   `type="password"` dengan **placeholder = nilai masked** (`••••` + 4 karakter terakhir), sehingga
   kosong berarti "pertahankan yang lama" dan nilai utuh tak pernah dirender. Allowlist & Chat /
   Channel ID target teks biasa. Tiap field diberi badge sumber: `tersimpan` (`source==="db"`),
   `dari .env · deprecated` (`"env"`), `belum diisi` (`"default"`). Tombol **Simpan kredensial**
   hanya mengirim field yang benar-benar diisi.
2. **Uji koneksi & hapus** — **Test Connection** (`POST /api/telegram/test`) menampilkan **dua**
   `Callout` bertumpuk (SPEC-491): yang atas hasil jalur **keluar** (`ok`/`err` — bot token), yang
   bawah `inbound` dari respons yang sama — `ok` bila gateway sedang polling dengan AgentToken sah,
   `warn` berikut `reason` dan daftar capability yang kurang bila belum. Dua baris, bukan satu,
   karena hijau jalur keluar pernah berdampingan dengan jalur masuk yang mati total — persis
   keluhan "diam total"; satu `Callout` gabungan akan mengulang kesalahan yang sama. Tombolnya
   `disabled` selama menunggu dan server membatasi 10 detik, jadi UI tak pernah menggantung.
   **Hapus kredensial** lewat `ConfirmDialog`, lalu memuat ulang kartu & status — toast menyebut
   bila ada nilai `.env` yang kembali dipakai.
3. **Gateway** — toggle `Setting.telegram.enabled`/`progress` (berlaku seketika, tanpa restart),
   readiness, bot username, allowlist count, capability kurang, dan onboarding lima langkah yang
   kini seluruhnya di dalam dashboard.

Status memakai `GET /api/telegram/status` saat tab dibuka + refresh eksplisit; tidak menambah WebSocket
baru. Toggle mati menghentikan poll, bukan membunuh tmux/memory. Layout tetap editorial/bone paper/brass;
daftar readiness ringkas tidak membutuhkan visualisasi terminal atau raw transcript.

**Unduh dokumen** (SPEC-361 · ADR-0078). `ds/DocDownload.tsx` merender sepasang anchor `.md` /
`.pdf` dan dipasang di **setiap** pratinjau Markdown: `SpecDocsModal` (komponen yang sama dipakai
Backlog **dan** Terminal, jadi satu pemasangan menutup dua entry point), `PrdScreen` (pane preview),
`DocsWorkspace` (**mode preview saja** — isi tersimpan, bukan draft editor), dan `IdeScreen`
(Explorer, berkas non-biner, honor `viewRef` sehingga unduhan mengikuti branch yang dilihat).
URL-nya dari `api.specDocDownloadUrl`/`docDownloadUrl`/`prdDownloadUrl`/`ideFileDownloadUrl`
(pembungkus `paths.download`, cermin `ideArchiveUrl` SPEC-233) — **URL, bukan `fetch`**: anchor
sungguhan agar `content-disposition` server yang menamai berkas, dan cookie sesi ikut same-origin.
Karena itu `Button` DS menerima prop `as="a"` (menekan atribut `type`/`disabled` yang tak sah pada
`<a>`, memakai `aria-disabled`). Test yang mem-*mock* `../src/api/client` secara parsial perlu ikut
menyediakan fungsi URL ini.

## Settings → Model sesi → Agen hanoman-lead (SPEC-488)

Kartu keempat di tab **Model sesi**, di bawah "Konflik rebase & merge", dengan bentuk yang persis
sama (ADR-0081): `Switch` opt-in → tiga `Select` (Runtime · Model · Effort). Mati → satu baris
`data-testid="lead-engine-inherited"` yang **menyebutkan nilai warisan yang benar-benar berlaku**
(hasil `sessionAgentDefaults()`, dihitung di klien dari `agent`/`model`/`effort`/`codex`) — tanpa
baris itu operator ditinggal bertanya "lalu lead pakai apa?".

Tiga aturan yang mengikat, ketiganya sudah berlaku untuk kartu konflik dan tak boleh menyimpang:
menukar **Runtime** menukar model+effort sekalian ke default runtime itu (kalau tidak lead lahir
`codex -m claude-opus-5`); memilih model codex **mengoersi** effort-nya (`coerceCodexEffort` —
effort properti per-model, SPEC-339, jadi picker memakai `codexEfforts(model)` bukan
`CODEX_EFFORTS`); dan katalognya dibaca dari `@hanoman/shared`, sumber yang sama dengan picker
Start.

**Beda satu-satunya dari kartu konflik: jalur tulisnya.** Kartu ini melakukan read-modify-write
bersegar lewat `GET`+`PUT /lead/config`, bukan `save()` (`PUT /settings`). `SettingsScreen`
mengirim seluruh `Setting` dari snapshot yang dimuat **sekali** saat mount, dan blok `lead` punya
penulis kedua — `LeadScreen`. Menulisnya dari snapshot mengembalikan `paused`/`everyMin` ke nilai
lama: rem darurat yang lepas sendiri. Kegagalan menulis mengembalikan state lokal ke nilai
sebelumnya (pola "jangan pernah biarkan layar memperlihatkan nilai yang tak ada di server").
Konsekuensi untuk test: berkas test Settings yang mem-*mock* `../src/api/client` **tak** perlu
menyediakan `getLeadConfig`/`putLeadConfig` selama ia tak menyentuh kartu ini — kartu tak memanggil
keduanya saat render, hanya saat operator menyimpan.

`LeadScreen` sendiri menampilkan hasilnya sebagai satu baris `data-testid="lead-engine-line"`
(`mesin: Claude Code · claude-opus-5 · xhigh`, atau "ikut default global · atur di Settings → Model
sesi"). Datanya sudah ada di `config` yang dipoll layar itu — **nol permintaan baru, nol perubahan
DTO**; `cfg.engine?.` memakai optional chaining karena dashboard bisa lebih baru daripada server
yang dilayaninya (ADR-0087).

## Form Custom Agent — kontrol pilihan, bukan teks bebas (SPEC-484 · ADR-0101)

`CustomAgentsPanel` (satu komponen untuk Settings **dan** Project detail) memakai empat kontrol
pilihan. Sumbernya API, bukan hardcode di komponen: `GET /api/custom-agents/catalog` untuk
tools/model/runtime, dan `GET /api/custom-agents?projectId=` — yang sudah dipanggil panel — untuk
daftar **mention**.

| Field | Kontrol | Default |
|---|---|---|
| Tools | `MultiSelect` (cari + chip), opsi **Semua tools (`*`)** paling atas | kosong → `null` = `DEFAULT_AGENT_TOOLS` |
| Runtime agent | `Select` | **Ikut sesi induk** (`""` → `null`) |
| Model | `Select`, **menyusut mengikuti runtime** | **Ikut sesi induk** (`""` → `null`) |
| Mention | `MultiSelect` (cari + chip) | kosong |

**`MultiSelect` (DS baru).** Chip untuk yang terpilih (masing-masing ber-tombol ×), tombol pembuka,
lalu — saat terbuka — `<input role="searchbox">` + daftar `<button role="option">`. **Inline, bukan
portal:** portal menuntut outside-click & focus-trap yang panel ini tak perlu bayar, dan `role`
sungguhan membuatnya bisa diuji lewat `getByRole` alih-alih menembak `<span>` di dalam `<label>`
seperti `Checkbox`/`Switch` DS — jebakan yang sudah tiga kali membuat test "lulus" tanpa terjadi
apa-apa (SPEC-299/360/447). Prop `invalidValues` merender chip bertanda ⚠.

**Tiga aturan yang mencerminkan server, ditegakkan di kontrol supaya operator tak pernah bisa
menyusun kombinasi yang pasti ditolak:**

1. **`*` dan nama eksplisit saling meniadakan.** Memilih *Semua tools* mengosongkan sisanya dan
   sebaliknya — cermin `400 "pintasan * harus jadi satu-satunya pilihan tools"`.
2. **Daftar model menyusut mengikuti runtime** (claude → `MODELS`, codex → `CODEX_MODELS`, warisi →
   keduanya ber-label). Menukar runtime yang membuat model terpilih tak sah **mengosongkan** model.
3. **Nilai lama di luar katalog tetap TERBACA** sebagai chip ⚠ (dan opsi ⚠ di `Select` model), tapi
   **Simpan terkunci** selama masih ada — validasi server keras, jadi menguncinya di sini membuat
   operator melihat sebabnya sebelum menekan tombol, bukan sesudah menerima 400. Saklar
   aktif/nonaktif di kartu **tak ikut terkunci**: ia mem-`PATCH { enabled }` saja, dan server hanya
   memvalidasi field yang ada di payload.

Kartu agen menampilkan pil runtime (`claude`/`codex`); **warisi tak menampilkan apa pun** — pil
untuk keadaan default hanya menambah derau. Kolom Tools di kartu tetap merender **hasil resolusi**
(`resolveTools`), dan `["*"]` ikut di-expand secara tampilan supaya yang terbaca adalah apa yang
benar-benar diterima agen.

**Bukti agent (amandemen ADR-0159, 2026-09-05):** kartu menjelaskan arti smart (tersedia sepanjang
sesi, delegasi menurut pekerjaan terbaru), policy baca-saja, maxTurns native Claude/instruksi
Codex, dan timeout instruksional. `CustomAgentMetrics` menampilkan token input/output/cache
terpisah, jumlah dinilai/pending/kerja ulang, dan rincian runtime/model/hash definisi. Nilai
historis null tampil belum tercatat. Penilaian kerja ulang memakai Select tiga keadaan
(belum dinilai/perlu/tidak perlu), terpisah dari disposition. Kegagalan fetch bukti tampil dengan
tombol muat ulang; nol baris diberi penjelasan bahwa bukan bukti agent tidak dipakai. Status relay
menyebut observasi transport server sejak boot, bukan mengklaim semua hook runtime sehat.

## Obrolan portal klien — `ChatPanel` + `PortalChatPanel` (SPEC-854 · ADR-0129/0130)

> Fase 3M: `ChatPanel` memakai kelas `hn-chat-*` (portal.css); tab-nya berlabel "Tanya & ide" dan teks pembedanya menunjuk ke "Keluhan saya".
> ADR-0211: tab "Tanya & ide" mengikuti `chatEnabled` pada proyeksi project (tanpa probe ke `/chat/sessions`). Tab `tanya` yang tertinggal dari project tanpa chat jatuh ke Keluhan.


Dua komponen, dua audiens, dua berkas API terpisah — sengaja tak berbagi apa pun kecuali DTO.

**`src/src/portal/ChatPanel.tsx`** (klien, di dalam `ClientPortal` sebagai tab **Obrolan**):

- Layar pilih tipe (**Brainstorming** / **Bertanya**), masing-masing dengan satu kalimat penjelas.
  Tombol tipe yang jatahnya habis **menonaktifkan diri** — klien tahu sebelum menekan.
- Blok `chat-beda-help` menjelaskan bedanya dari Help desk. Ini bukan hiasan: "kenapa ada dua
  kotak masuk" adalah pertanyaan pertama yang muncul, dan brief mensyaratkan jawabannya ada di UI.
- Blok `chat-jatah` menyebut pemakaian & tanggal reset dalam **tanggal panjang** ("1 September
  2026"), bukan stempel waktu.
- Satu giliran bisa memakan 30–180 detik, jadi kirim menampilkan `StateBlock kind="loading"`
  ("hanoman sedang memikirkan…") alih-alih terlihat menggantung. Giliran klien dirender optimistis;
  server tetap yang menomori urutannya.
- **Aturan berkas itu:** tak satu pun teksnya boleh teknis. Gagal apa pun — jaringan, 500, timeout —
  dijawab satu kalimat biasa lewat `chat-galat`. Diuji: teks galat tak boleh memuat kode status,
  nama alamat, atau kata `Error`.

**`src/src/screens/PortalChatPanel.tsx`** (operator, dibuka dari `PrdScreen` lewat tombol
**"Draft dari portal klien"**, hanya saat satu project terpilih):

- Baris sesi menyebut tipe, ringkasan, **email klien**, dan tanggal — itulah "asal draft" yang
  disyaratkan huruf B. Pil `PRD draft` / `PRD dokumen` membedakan yang belum & sudah dimaterialisasi.
- Transkrip menampilkan giliran yang **diblokir gerbang keluaran** dengan border merah, alasannya,
  dan **teks asli agen**. Hanya dari sini operator bisa menilai penjagaan bekerja atau kelewat lapar.
- PRD draft dirender `MarkdownView`, dengan input slug + tombol **"Jadikan dokumen PRD"**. Salinan
  di sebelahnya menyatakan apa adanya: menyimpan ke `docs/prd/`, **tidak** membuat backlog.
- Angka jatah di `portal-chat-kuota` datang dari amplop daftar (`quotaView` yang sama dengan klien),
  bukan hitungan kedua.

## Settings → Orkestrasi, pratinjau Start, chip fase (ADR-0164)

- **Tab Orkestrasi** (`OrchestrationPanel`): satu kartu per flow — `Switch` ber-`aria-label` `Orkestrasi
  <flow>` langsung + tabel fase × (Claude Code | Codex CLI) berisi dua `Select` (model: `— warisi
  orchestrator` + katalog runtime; effort: `— warisi` + `runtimeEfforts`). Menukar model mengoreksi effort
  sel. Tabel di dalam `overflowX: auto`.
- **Modal Start** (`PhasePlanPreview`): picker yang ada = orchestrator; di bawahnya daftar `Fase · model ·
  effort (warisi)` dari `resolvePhasePlan`, atau catatan "sesi tunggal" (flow mati / codex < 0.151).
  Setiap fase juga memiliki picker override model + effort (`Select` DS ukuran `sm`); opsi kosong
  menyebut sumber & nilainya — `Warisi Settings · <nilai>` bila sel Settings terisi, selain itu
  `Warisi orchestrator · <nilai>` (dihitung `resolvePhasePlan` tanpa bagian override itu). Nilai override
  tersimpan selalu tetap jadi opsi terpilih: model di luar katalog lewat `modelSelectOptions`, effort yang
  tak didukung model hasil resolusi (mis. sesudah model orchestrator diganti) sebagai `<effort> (dikoersi →
  <efektif>)`. Override dikirim sebagai `phaseOverrides` dan hanya berlaku untuk sesi itu; tanda baris per
  bagian juga untuk override — ` (override sesi)` hanya bila model DAN effort di-override, selain itu mis.
  ` (model override · effort warisi)` (audit R6).
  Sebelum Setting — dan untuk codex, versi codex — termuat, pratinjau menampilkan `Memuat rencana fase…`
  alih-alih menyimpulkan sesi tunggal lebih dulu; gagal memuat versi codex dihitung sebagai tak terdeteksi
  → sesi tunggal (cermin server, yang memperlakukan versi codex null sebagai tak didukung). Tanda warisi
  per BAGIAN, bukan per sel: ` (warisi)` bila sel model dan effort kosong keduanya, ` (model warisi)` /
  ` (effort warisi)` bila cuma satu yang kosong. Audit S4 (2026-09-23): blok `orchestration` absen di
  respons = `ORCHESTRATION_DEFAULTS` (matriks bawaan, `no_effort` mati — sama dengan server), bukan sel
  kosong; `GET /settings` GAGAL menampilkan galat (`role="alert"`, "Gagal memuat Setting") alih-alih
  rencana palsu; target device remote (SPEC-1216) menambah catatan `phase-plan-remote-note` bahwa
  rencana final ditentukan Setting device itu dan override fase bisa diabaikan device versi lama.
- **Sel terminal**: chip `orch <model> · <effort>` di header bila `orchestrated`; `PhaseStrip` menggambar
  fase ber-agen sebagai chip `ikon · nama · model · effort · durasi` (+`↻n`, ⚠ "bukti subagent tak
  diterima"), ringkas bila header < 480px, klik → detail token in/out/cache terpisah + cuplikan hasil.
  Baris chip menggulir horizontal di scroller-nya sendiri; panel detail adalah SIBLING dari scroller itu,
  diposisikan relatif terhadap badan sel (`position: relative` di badan sel, bukan di strip), tingginya
  dibatasi tinggi badan sel (`maxHeight: calc(100% - 48px)`) dengan scroll vertikal internal, lebarnya ≤
  lebar sel. Fase tanpa agen digambar seperti sebelumnya. Aksesibilitas (audit R2): nama aksesibel chip
  selalu lengkap — `Fase <nama>: <status> · <model> · <effort> · <durasi> · percobaan n · bukti subagent
  tak diterima` (`chipAccessibleName`, juga saat mode ringkas menyembunyikannya secara visual); panel
  `Detail fase <nama>` memakai `usePopoverFocus` DS (`aria-haspopup`/`aria-controls`, fokus masuk panel,
  Esc & klik-luar menutup, fokus kembali ke chip).

## Penghapusan memori project dan changelog (ADR-0182)

Menu, halaman, pintu project, API client, setelan agen changelog, dan allowlist
project token khusus memori dihapus. Notifikasi/badge memori tidak lagi dirender.
URL `/memory*` dan `/changelog*` serta state section lama mengikuti fallback
navigasi yang sudah ada. UI tidak menyediakan akses ke data fitur yang dihapus.

## Audit UI/UX 2026-10 — gelombang 4 (penutupan)

- Inline style → kelas/CSS-var: Terminal, IDE (GitGraph lane `--graph-lane-0..5`, `--lane`, `--depth`, `--row-h`), panel Pengaturan (Webhook/Logs/MCP/Members), `App.tsx`, `ds/kit.tsx`, dialog/timeline/VPS/limit. Berkas CSS baru di `screens/styles/` (`dialogs.css`, `limits.css`, `portal-chat.css`, `auto-merge.css`; tambahan `ide.css`, `team.css`, `vps.css`). Urutan aturan di `ide.css` penting (`.hn-ide-sel` harus setelah `.hn-ide-changed-row`).
- `test/project-css.ts`: helper yang menyuntikkan CSS proyek ke jsdom agar tes layout membaca kaskade, bukan style inline; jsdom mengabaikan spesifisitas dan `@media` non-screen.
- Tombol "Jawab" di toast keputusan dan lonceng; `OverflowActions` menu ARIA penuh (`role=menu/menuitem`, roving, typeahead); `Button variant="danger-outline"`; fokus keyboard Button/IconButton terlihat (ring `--border-focus`); toggle "Mode pembaca layar" xterm.
- Review: prop `onIntegrate/onRevert/onDiscard` (Integrasikan, Kembalikan ke Dikerjakan, Hapus worktree) tanpa endpoint baru.
- Backend aditif: `PortalProject.chatEnabled`, `VpsView.scoreTotal` (ADR-0211); `nextRunFor(expr, after, tz)` dan `GET /projects?sort=attention` (ADR-0212). ADR 0206–0210 mencatat keputusan pet, Pengaturan, Dalang, Terminal, Perangkat.

## Audit UI/UX 2026-10 — gelombang 5: filter Ber-worktree dan setup (ADR-0214)

- **Backlog, filter "Ber-worktree"** (`screens/backlog-worktree.ts`): field "Worktree" di popover Filter (`Select` aria "Filter worktree"), chip "Ber-worktree" saat aktif, ikut Reset filter. Predikatnya `baseSha` terisi, yaitu "hanoman pernah membuatkan worktree" (kolom sejak ADR-0030). Worktree yang sudah dibersihkan tetap terhitung; pekerjaan di luar hanoman dan item yang selesai sebelum ADR-0030 tidak. Angka segmen tahap ikut himpunan yang disaring. Label di `lib/labels.ts` (`WORKTREE_SCOPE_LABEL`). Tes: `test/backlog-worktree-filter.test.tsx`.
- **Backlog, mengapa tidak "Perlu ditinjau"**: stage `done` sudah segmen "Selesai"; status tinjau dan integrasi tidak ada di `SpecSlim` (status tinjau kini ada sejak ADR-0218 sebagai `reviewedAt`; integrasi tetap tidak); keputusan sesi "menunggu manusia" (`SessionDTO.decision`) tidak sampai ke Backlog, yang hanya menerima `activeSpecs`. Predikat itu baru jujur bila `App` meneruskan himpunan sesi yang menunggu keputusan; sampai itu, filter ini tidak menjanjikan "belum ditinjau".
- **Setup, dua langkah dengan nomor jujur** (ADR-0214): wizard "setup 1/2" dan akun "setup 2/2" tetap. Nomor "2/2" hanya tampil bila wizard dijawab di sesi itu. Penerapannya, `setupStep={setupDone ? 2 : undefined}` pada `AuthScreen` di `App.tsx`, menunggu pemilik `App.tsx`.

## Audit UI/UX 2026-10 — Review tanpa 409 dan hapus worktree item (ADR-0213)

- **Review, keadaan kosong** (`screens/ReviewScreen.tsx`): `GET /specs/:id/review` menjawab **200** `{ empty:true, reason }` untuk "belum ada worktree maupun commit", bukan 409. Layar memeriksa `r.empty` lalu menampilkan keadaan kosong dengan teks sesuai `reason`: `no-worktree` ("Sesi belum membuat worktree…") atau `no-commit` ("Worktree sudah dilepas dan belum ada commit…"). `data-reason` pada `.hn-review-empty` memuat alasannya; `409` hanya dipetakan pada jalur spec (repoDir belum diatur), lihat ADR-0215. Tes: `screens/ReviewScreen.test.tsx`.
- **Jalur sesi, ADR-0215** (amandemen ADR-0213): `GET /terminal/sessions/:id/review` juga menjawab **200** `{ empty, reason }` (`no-worktree` bila sesi tak punya worktree, `no-commit` bila direktorinya lenyap). Layar tak lagi memetakan 409 pada jalur sesi; 409 di sana (repoDir belum diatur) tampil sebagai galat "Gagal memuat review". Tes: `src/test/review-screen.test.tsx` dan `screens/ReviewScreen.test.tsx`.
- **Hapus worktree satu item** mengganti `deleteWorktrees` dengan nama turunan. Tombol "Hapus worktree" di `App.tsx` memanggil `api.deleteSpecWorktree(spec.id)` → `DELETE /specs/:id/worktree`. Ini mengamandemen kalimat "tanpa endpoint baru" pada bagian Review di atas. Galat `ok:false` tetap dilempar ke bar keputusan.
- **Tipe kontrak** `SpecReview`, `ReviewFile`, dan `ChangedFile` berasal dari `@hanoman/shared` (`spec-review.ts`, `zSpecReview`). `api/client.ts` mengekspor ulang namanya, jadi pemakainya tak berubah.

## Audit UI/UX 2026-10 — gelombang 6 (perbaikan hasil QA Chrome gelombang 4–5)

- Review: aksi navigasi berlabel pada bar (Backlog/Terminal/IDE), "Aksi lain" berlabel aksesibel, konfirmasi Integrasikan bernada netral (bukan danger), bar satu baris <400px. Aturan pohon berkas dipindah dari `ide.css` ke `screens/styles/file-tree.css` (diimpor `file-tree.tsx`) agar Review/Skills tak bergantung pada `ide.css`.
- Popover Filter Backlog ter-clamp di mobile; daftar "Bergantung pada" tak menyusut; select native berelipsis ≤640px; tab Scheduler membungkus ≤420px; ring fokus untuk wrapper Input DS (`:focus-within:has(> .hn-input-core)`).
- Overview: nama aktivitas `min-width: 8ch`, footer Backlog tautan penuh di mobile; Settings merender backtick sebagai `<code>` (`SettingRow desc`); chip jenis modal Feature brief membungkus; dialog Remote IDE bertumpuk ≤640px.
- Terminal: "Jawab" ke sesi yang sudah berakhir tak lagi memfokus sesi lain — toast "Sesi itu sudah berakhir." dengan aksi "Riwayat sesi"; target fokus dibersihkan saat meninggalkan Terminal (`App.tsx`). Composer sticky di dasar pada ponsel; select dikte 44px pada pointer kasar. IDE: label ref berupa pil berelipsis dengan area klik ≥24px (44px pada pointer kasar).
- Batas verifikasi: pengecekan layout dilakukan dengan Chrome headless pada fixture CSS asli dan jsdom; QA aplikasi hidup untuk gelombang 6 dicatat di audit doc.

## Audit UI/UX 2026-10 — gelombang 7: filter "Perlu ditinjau" (Backlog)

- **Predikat** (`screens/backlog-worktree.ts`, `reviewSpecIdsOf`): item yang sesinya hidup dan `sessionKind` = `waiting` (`decision && !deciding`). Kondisinya sama dengan "Menunggu jawabanmu" di Overview dan pet. Tes `test/backlog-review-filter.test.tsx` mengunci kesamaannya dengan `waitingSessions`.
- **Data**: `App.tsx` menghitung `reviewSpecIds` dari daftar sesi dan meneruskannya ke `BacklogScreen` sebagai prop opsional. Tanpa prop, filter ini menghasilkan daftar kosong. Layar Backlog tetap tak menerima daftar sesi.
- **Tampilan**: field "Tinjauan" di popover Filter, berdampingan dengan "Worktree"; chip "Perlu ditinjau" saat aktif; ikut Reset filter; digabung AND dengan "Ber-worktree". Angka segmen tahap mengikuti himpunan yang disaring. Daftar yang kosong karena filter kini dijawab "Tidak ada spec untuk filter ini" dengan Reset, bukan "Tidak ada spec di tahap …".
- **Klausa `stage` done + `baseSha` (semula tidak dipakai; kini diamandemen ADR-0218).** Alasan lama: status tinjau tak tercatat di server, dan `baseSha` tak berarti worktree masih ada. Status tinjau kini tercatat di `Spec.reviewedAt`, jadi klausa itu masuk sebagai (b) `stage = done` **dan** `baseSha` terisi **dan** `reviewedAt` null. Lihat gelombang 8 di bawah.
- **Batas (diperbarui ADR-0218)**: tinjauan item selesai kini punya sinyal jujur, yaitu penanda yang ditulis operator. Label "Perlu ditinjau" dan "Menunggu jawabanmu" untuk kondisi yang sama masih keputusan terbuka di `glossary.md`.

## Audit UI/UX 2026-10 — gelombang 8: penanda "sudah ditinjau" (ADR-0218)

- **Data**: `Spec.reviewedAt` (zod `zSpec`/`zSpecSlim`, `.nullable().default(null)`), ikut `GET /specs` lewat projection `live-specs`. Klien versi lama tetap parse.
- **Predikat**: `reviewSpecIdsOf(sessions, specs)` (ADR-0218 §7). Klausa sesi tak berubah. `App.tsx` meneruskan `backlog` sebagai argumen kedua dan memakainya sebagai dependensi memo.
- **Tombol "Tandai ditinjau" / "Batalkan tanda ditinjau"** di dua tempat, keduanya untuk item `done`. (1) Bar keputusan ReviewScreen: prop `reviewed` dan `onMarkReviewed`, di layar sempit pindah ke menu ⋯. Galat dari server tampil di bar. (2) Menu ⋯ item Backlog (`SpecActions`) di semua tampilan (daftar, kartu, papan). Yang kedua wajib: item yang worktree-nya sudah dihapus menampilkan keadaan kosong di Review, tanpa bar.
- **Hint filter** "Tinjauan" menyebut kedua kondisi. Tes `test/backlog-reviewed.test.tsx` mengunci predikat klausa baru dan aksi menu. `test/review-screen-reviewed.test.tsx` mengunci tombol bar, pembalikan, galat, dan letaknya di layar sempit.
- **Tanpa dialog konfirmasi**: aksinya bisa dibalik dengan tombol yang sama dan tak membuang apa pun.
- **Batas yang tersisa**: integrasi tidak menandai otomatis (ADR-0218 §5). Item yang sudah diintegrasikan tetap tampil di filter sampai operator menandainya.

## Audit UI/UX 2026-10 — Perangkat: tingkat yang dilaporkan dan alasan "Lihat (baca saja)" (ADR-0216 opsi D)

- **Baris "Tingkat akses" per perangkat remote** di tab Perangkat (`ClientsScreen.tsx`, `ReportedAccessLine`). Tingkatnya dibaca dari `control.capabilities` (hello relay), bukan dari API baru. Keadaannya: Lihat, Kerja, Tulis, Khusus (dengan rincian), Nonaktif (kendali aktif tanpa grant), atau Tidak diketahui (tanpa laporan, atau protokol tak cocok). Penanda "Diatur di perangkat itu" dan penjelasan singkat menegaskan bahwa pengaturannya hanya di perangkat itu. Tidak ada tombol ubah.
- **Pemetaan murni** `reportedAccessOf(d)` dan **alasan tombol** `openBlockReason(d)`, keduanya diekspor dari `ClientsScreen.tsx` dan diuji di `test/clients-remote-access.test.tsx`.
- **Alasan tombol memeriksa capability.** "Lihat (baca saja)" butuh `sessions:read`, karena terminal tampilan remote dimulai dari WS baca-saja yang menuntutnya, dan setiap tingkat memuatnya. Perangkat dengan `capabilities: []` atau tanpa `sessions:read` kini menonaktifkan tombol dan menjelaskan alasannya. Sebelumnya tombol tetap aktif lalu ditolak 403.
- **Batas.** Tab Dokumen dan IDE di `RemoteInstanceView` tetap menuntut `backlog:read` dan `ide:read` dan gagal sendiri; tombol tidak memeriksanya. Copy ada di `lib/labels.ts` (`REPORTED_ACCESS_*`, `OPEN_BLOCK_*`), baris glosarium "Izin yang dilaporkan perangkat remote". Keputusan grant per perangkat (opsi B dan C) tetap di [ADR-0216](../adr/0216-grant-per-perangkat-remote-diusulkan.md).

- Review (penutup gelombang 7): 409 pada jalur spec tidak lagi dipetakan ke keadaan kosong; ia tampil sebagai galat "Gagal memuat review" yang bisa dicoba ulang. Keadaan kosong hanya datang dari 200 `empty` (ADR-0213/0215).

## Audit UI/UX 2026-10 — tinjauan segar: Overview, Graf IDE, Terminal

Perbaikan atas temuan tinjauan segar (path relatif `src/src`). Tanpa `!important` dan inline style baru.

- **Overview.** Proyek yang sudah di "Perlu perhatian" tak diulang di "Project"; judul seksi memberi hitungan jujur ("3 dari 5 · sisanya di atas"), dan bila semua bermasalah, satu baris menyebut itu. Baris "Perlu perhatian" membawa cakupan, karena bar cakupan hanya ada di "Project". Keadaan "Sesi berjalan" kosong jadi satu baris (`.hn-ov-empty`), bukan kartu `StateBlock`. "Aktivitas terbaru" memakai satu label keadaan (`PROJECT_ACTIVITY_LABEL` di `lib/labels.ts`): teks `activity` dari server (`idle`, `running · <flow>`) tak lagi tampil mentah. Di desktop kolom status lebar tetap (`.hn-ov-act`). Judul "Hari ini" tetap `<h2>` tetapi disembunyikan secara visual (`.hn-ov-pagehead`): topbar sudah memuat nama layar.
- **Graf IDE.** Hint "⌘F cari · ⌘H ke HEAD" tersembunyi di pointer kasar dan ≤640px. Di ≤640px kolom penulis dan "working tree" disembunyikan, kolom tanggal tetap, dan lantai lebar baris (`.hn-git-rows`) turun 176px supaya tanggal dan ⋮ muat di 390. Daftar commit memakai `.hn-git-scroll`: bayangan tepi (`background` `local`/`scroll`) muncul hanya bila masih ada kolom di luar layar.
- **Label IDE.** Pilihan ref "· working tree ·" menjadi "Belum di-commit" dengan `title`. Toggle "Tersembunyi" menjadi "Diabaikan git": ia menampilkan berkas dan folder yang `.gitignore` sembunyikan, bukan cabang, jadi "Cabang tersembunyi" tak tepat.
- **Terminal.** Tombol ikon folder sempit tetap bernama "Buka…" (nama aksesibel), dengan tooltip yang menjelaskan isi menu; teks "Buka…" ikut tampil dari 641px (`.hn-terminal-open-text`). Tombol "Tombol khusus" menjadi "Esc, Tab, panah"; tooltip-nya menyebut Enter juga, karena papan itu memuatnya dan label yang terlalu panjang tak muat di dock ponsel.
- **Tes.** `overview-screen`, `ide-responsive`, `terminal-css-contract`, `terminal-focus`, `terminal-pane`, `ide-screen`, `ide-tabs`, dan `ide-hidden-toggle` diperbarui atau ditambah.
- **Batas.** Keputusan istilah nav "Overview", "Projects", dan "Settings" masih terbuka (lihat `glossary.md`). `rel()` di Graf IDE memakai singkatan (`5m`, `2h`) yang belum diatur glosarium; dipertahankan karena kolom tanggal harus sempit. Tampilan nyata (lebar, sentuh, dan gulir di 390) belum diverifikasi di browser.
