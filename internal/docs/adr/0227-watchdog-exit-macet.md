# ADR-0227 — Watchdog untuk `process.exit()` yang macet, dan berkas maksud keluar untuk supervisor

Tanggal: 2026-10-19 · Status: diterima · tanpa nomor SPEC (dikerjakan langsung atas permintaan operator)

**Melengkapi** [ADR-0088](0088-tombol-update-npm-restart-tersupervisi.md) (kode sentinel 75) dan
[ADR-0139](0139-hardening-opsional-dan-wizard-setup.md) (76/77): kode-kode itu kini bertahan walau
server harus dibunuh paksa. **Melengkapi** penutupan berbatas waktu
(`server/src/services/graceful-shutdown.ts`, [stack](../architecture/stack.md)). Nol skema, nol
endpoint, nol perubahan kontrak MCP.

## Konteks

2026-10-19, saat me-restart server 0.9.30 yang sudah hidup 8 jam, SIGTERM ditangani dengan rapi
(`SIGTERM — menutup`, app & Prisma tertutup, `process.exit(0)` terpanggil), lalu proses diam
selamanya. Batas 5 detik di graceful-shutdown tak pernah menyala. Sampel stack (`sample <pid>`):

```
node::Environment::Exit → DefaultProcessExitHandlerInternal → uv__threadpool_cleanup
  → uv_thread_join → _pthread_join → __ulock_wait
```

Yang ditunggu adalah join worker threadpool libuv. Proses itu hanya punya **3** worker
`libuv-worker` (bawaan 4), dan ketiganya menganggur di `uv_cond_wait`: satu worker sudah lenyap
sebelumnya dan sisanya tak pernah menerima pesan keluar. Di libuv 1.51 (node 24.11.1) worker hanya
berakhir lewat `exit_message`, jadi lenyapnya worker di tengah umur proses adalah kejadian abnormal.
Pemicunya belum diketahui: server yang baru boot keluar normal, dan beban terisolasi (fs, dns,
node-pty, sharp normal/rusak/paralel, Prisma, zlib, crypto) tak menghilangkan worker. Pengamatan di
produksi berjalan terpisah (watcher lldb pada `__bsdthread_terminate`, di luar repo).

Pola ini berulang. `hanoman-launchd.log` mencatat 35 SIGTERM, 7 `Killed: 9` (dibunuh manual),
2 "keluar paksa", dan 108 `EADDRINUSE`. Batas waktu yang ada tak bisa menolong karena ia timer JS,
sedangkan kemacetan terjadi sesudah JS selesai. Yang paling berbahaya adalah jalur restart dashboard
(75/76/77): ia keluar lewat `process.exit` yang sama, supervisor menunggu anak yang tak pernah mati,
dan instance tak pernah hidup lagi.

Insiden 2026-09-23/25 (`dns.lookup()` di threadpool) adalah kelas yang sama: exit yang terblokir
oleh join threadpool. Perbaikan waktu itu menutup satu sumber (fetch memakai c-ares), dan ADR ini
menutup akibatnya untuk sumber apa pun.

## Keputusan

1. **Server menitipkan pembunuhnya sendiri sebelum keluar** (`exitGuarded`,
   `server/src/services/exit-guard.ts`). Semua jalur keluar server lewat sini: shutdown SIGTERM/SIGINT
   (0/1), restart konfigurasi (76), restart manual (77), restart untuk update (75), dan `listen gagal`
   (1). Urutannya:
   - tulis `$HANOMAN_HOME/exit-intent`;
   - luncurkan `sh` terlepas (`detached`, tanpa stdio) yang menunggu 5 detik lalu `kill -9` bila PID
     yang SAMA masih hidup (waktu mulai dibandingkan lewat `ps -o lstart=`, supaya PID yang sempat
     dipakai ulang tak ikut terbunuh);
   - baru `process.exit(code)`.

   Kegagalan menulis berkas atau meluncurkan watchdog tak pernah menahan exit. Di bawah vitest,
   launcher bawaan menolak jalan, karena di sana `process.exit` dicegat sehingga watchdog sungguhan
   akan meng-SIGKILL worker test.
2. **Berkas maksud keluar** (`EXIT_INTENT_FILE`, `formatExitIntent`/`parseExitIntent`,
   `shared/src/dto.ts`). Isinya satu baris `<pid> <code>`, supaya terbaca juga dari supervisor `sh`.
   SIGKILL menghapus kode exit, dan berkas ini menyimpannya.
3. **Supervisor memercayai berkas itu hanya bila anaknya mati oleh SIGKILL dan PID-nya cocok**
   (`resolveChildExit`, `cli/src/commands/start.ts`). Berkas dibaca lalu dihapus setiap putaran;
   berkas basi dari PID lain diabaikan. Selain kasus itu perilakunya sama seperti sebelumnya
   (`code ?? 0`). Saat terpakai, supervisor mencetak
   `server macet saat keluar — dihentikan watchdog; dilanjutkan sebagai exit <code> (ADR-0227)`.

## Alternatif yang ditolak

- **Memperbaiki akar (worker libuv yang lenyap) dulu.** Pemicunya belum bisa direproduksi. Tanpa
  watchdog, setiap restart tetap bisa membekukan instance selamanya, dan perbaikan akar di masa
  depan tak membuat pengaman ini sia-sia, karena sumber lain (lookup macet, addon native) punya
  akibat yang sama.
- **Batas waktu JS yang lebih panjang atau `process.reallyExit`/`process.abort`.** Semuanya lewat
  jalur `Environment::Exit` → `uv_library_shutdown` yang sama, atau mati tanpa kode exit sama sekali.
- **Watchdog di supervisor (bunuh anak N detik sesudah SIGTERM).** Supervisor tak tahu kapan anaknya
  memanggil `process.exit` untuk restart 75/76/77, karena keputusan itu lahir di dalam server.
  Hanya server yang tahu kapan "mulai keluar".
- **Mengirim SIGKILL ke diri sendiri sesudah close.** Kode sentinel hilang dan supervisor tak bisa
  membedakan restart dari crash.

## Konsekuensi & gotcha

- Supervisor buatan sendiri (unit systemd/launchd yang memutar `node dist/server.js`) perlu membaca
  `exit-intent` bila ingin restart 75/76/77 bertahan saat server dibunuh watchdog. Kalau tidak,
  hasilnya SIGKILL (137) biasa, yang tetap lebih baik daripada macet selamanya. Pola shell ada di
  [production](../operations/production.md).
- Supervisor `sh` yang menjalankan node di depan (foreground) tak tahu PID anaknya. Node harus
  dijalankan di latar + `wait`, dan SIGTERM/SIGINT/SIGHUP diteruskan dengan `trap`. Tanpa trap,
  SIGTERM ke shell meninggalkan node sebagai yatim yang memegang port (`EADDRINUSE`).
- Watchdog adalah proses `sh` + `sleep` berumur ±5 detik per exit. Pada exit normal ia selesai sendiri
  tanpa membunuh apa pun (pemeriksaan waktu-mulai gagal).
- Bukti: `server/test/exit-guard.test.ts` (urutan intent → watchdog → exit, proses `while(true)` yang
  mengabaikan SIGTERM benar-benar mati oleh SIGKILL, proses yang sudah keluar tak tersentuh) dan
  `cli/test/start-supervisor.test.ts`. Rantai penuh diuji manual: server dibekukan lldb tepat di
  `uv_library_shutdown`, lalu `POST /api/setup` (exit 76). Watchdog membunuhnya dan `hanoman start`
  melanjutkan sebagai 76 lalu menjalankan ulang.
