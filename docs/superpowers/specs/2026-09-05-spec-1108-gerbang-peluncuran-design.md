# SPEC-1108 — Gerbang peluncuran sesi

Status: approved, 2026-09-05. [ADR-0161](../../../internal/docs/adr/0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md) mengikat; [audit](../../../internal/docs/research/audit-spec-1108-gerbang-peluncuran-sesi.md).

## Kontrak

Satu modul admission dengan dependency injection membaca pane tmux asinkron, konfigurasi,
dan load host. Wrapper launcher bersama menahan mutex check→spawn; `startSpecSession`
memakainya sebelum kill/worktree, tetap menjadi jalur backlog manual/scheduler/lead.
Project workflows dan cron membungkus persiapan worktree dalam gerbang yang sama.
Konflik, VPS hardening, dan Telegram memakai wrapper create agen asinkron.
Terminal biasa, shell, serta konsol SSH bebas check cap/load, tetapi kelahirannya juga
memakai mutex yang sama; semuanya tetap mengurangi slot.
Tidak ada registry DB, migration, dependensi baru, atau antrean kerja manual.

`Setting.scheduler.launchGuard = {enabled:true,maxLoadPerCore:2.5}`; cap tetap
`scheduler.maxConcurrent`. Source/master scheduler mati tidak mematikan gerbang. Switch
baru mematikan kedua check; batching scheduler tetap ada. Force menembus keduanya
hanya dari tindakan manusia, tidak dari governor/lead/cron/Telegram. HTTP force:true
dari Bearer AgentToken ditolak 403 sebelum lookup atau stempel approval.

409: `{error,kind:"capacity"|"host-load",admission:{enabled,liveCount,liveAgentCount,
maxConcurrent,loadPerCore,maxLoadPerCore,loadStatus}}`. `liveCount` semua pane !exited,
`liveAgentCount` hanya kelas agent terstruktur. Angka & status yang sama disediakan
state scheduler; Windows load null/unsupported, pengukuran invalid null/unavailable.
`os.freemem()` tidak dipakai. Load = loadavg()[0]/cpus().length, ditolak ketika >2,5.
Default 2,5 disetujui sebagai nilai awal, bukan kalibrasi lintas host.

`launchClass` metadata tmux internal (agent/terminal), di ujung FMT untuk kompatibilitas
kolom. Pane lama memakai spec/flow/cwd/project sebagai fallback; cap tidak bergantung
akurasi fallback ini karena selalu menghitung semua pane hidup.

## Acceptance

1. WHEN cap penuh AND scheduler mati, THEN Start backlog baru menjawab 409 sebelum
   kill/worktree/spawn; angka semua pane dan agen, cap, load dan ambang tersedia.
2. WHEN pane target hidup, THEN re-attach lulus walaupun cap/load dilanggar.
3. WHEN beberapa request bersamaan mengincar slot terakhir, THEN hanya satu agen lahir;
   kegagalan persiapan melepaskan mutex, tanpa slot yang bocor.
4. WHEN terminal/shell/konsol diminta, THEN tidak ditolak cap/load; pane mati tidak dihitung.
5. WHEN load > ambang, THEN tolak; sama dengan ambang lulus. Windows tidak menolak
   karena load palsu nol dan UI menyatakan metrik tidak tersedia.
6. WHEN force manusia atau launchGuard.enabled=false, THEN kedua check dilewati;
   approval/dependency existing tetap sesuai kontrak (force dependency memang sudah ada).
7. Semua agen terstruktur tercakup: backlog, project flows, cron, konflik, hardening VPS,
   Telegram. Konflik Git yang sudah terjadi dipertahankan bila spawn pemulih ditolak.
8. Governor menunda penolakan admission pada antrean existing, tidak gagal permanen;
   tidak ada force otomatis. Lead memakai launcher sama tanpa bypass.
9. Settings menerima baris lama dengan default aktif; operator bisa mengubah dan mematikan
   gerbang. UI Start backlog menampilkan angka 409 dan aksi force setelah melihat penolakan.
10. Seluruh pemeriksaan sesi yang ditambahkan asinkron; error baca tmux tidak berarti nol.

## Verifikasi dan batas

Unit gerbang memakai deps fake, tanpa tmux/claude. Integrasi launcher mengamati efek
worktree/spawn; HTTP diuji terhadap app dan smoke curl lokal terisolasi sekali di akhir.
Test hanya terkait, DB & socket tmux unik, server serial; typecheck shared/server/frontend
berurutan. Review blast-radius dan security sebelum commit/push. Tidak membunuh sesi
aktif atau memungut worktree yatim (SPEC-1109). Mutex berlaku satu proses instance;
agen/terminal yang dilahirkan di luar API tidak dapat dijanjikan tunduk pada admission.
