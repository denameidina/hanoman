# Delapan agent untuk pembuatan dan dukungan aplikasi

Pengguna menyetujui tiga peran utama (design, feature builder, performance) dan lima
peran pendukung yang telah direkomendasikan. Tambahkan kedelapannya ke katalog
bawaan, lalu daftarkan dan aktifkan sebagai custom agent global pada instance
Hanoman pengguna melalui API. Jangan menimpa konfigurasi bernama sama yang sudah ada.

| Nama | Tugas dan hasil | Policy |
| --- | --- | --- |
| product-designer | Alur pengguna, UI sesuai design system, responsive, aksesibilitas dan seluruh state; artefak desain/implementasi UI dengan verifikasi render bila alat tersedia | isolated-worktree |
| feature-builder | Spec/desain menjadi fitur berbatas jelas, test relevan dan docs; parent memegang integrasi | isolated-worktree |
| performance-engineer | Baseline, profil bottleneck dan optimasi terukur pada skenario/environment setara | isolated-worktree |
| product-analyst | Kebutuhan, prioritas/MVP dan acceptance criteria yang dapat diuji | read-only |
| solution-architect | Keputusan lintas modul, kontrak data/API, tradeoff dan jalur migrasi | read-only |
| operations-engineer | Kesiapan rilis, migrasi, health check, monitoring, backup/restore/rollback yang dapat dibuktikan | isolated-worktree |
| support-triager | Reproduksi/gejala/versi/severity, duplikasi tiket, draf balasan dan handoff bug | read-only |
| knowledge-maintainer | Panduan, FAQ, release notes dan runbook dari perilaku/versi yang terverifikasi | isolated-worktree |

Semua peran memakai activation=smart, mentions kosong, model mengikuti sesi pada seed,
rekomendasi Claude sonnet dan Codex gpt-5.6-terra. Ini profil awal, bukan hasil
benchmark perbandingan model. Tiga peran read-only dibatasi 30 turn; lima peran
isolated 40 turn; timeout tidak ditambah. Effort medium kecuali arsitektur/performance high.
Katalog baru opt-in (enabledByDefault=false), mempertahankan tiga default aktif lama.
Registrasi pengguna enabled=true; lima isolated memakai runtime=claude karena
Codex belum mendukung policy ini, tiga read-only runtime=null.

Prompt berisi prosedur, input minimum, kapan berhenti, bukti, batas ownership,
dan laporan ringkas ke parent. Tidak mengaku menguji/render/mengukur bila belum dilakukan.
Ketiadaan alat browser/monitoring ditulis sebagai gap, bukan dilompati dengan klaim selesai.
Worktree tidak mengisolasi layanan eksternal: operasi produksi mengikuti otorisasi
yang sudah ada; bila belum ada, hasil lokal dibuat konkret dahulu. Support tidak
mengirim balasan tanpa otorisasi eksplisit. Semua peran daun menyerahkan eskalasi
ke parent. Tidak membuat framework/proses berat untuk tugas kecil.

Katalog tetap data murni yang dapat dibundel browser. Seed idempoten tetap menjaga
edit, saklar dan tombstone operator. Evaluator 20 kasus lama tetap terbatas pada
delapan peran audit; delapan peran baru belum memiliki benchmark perilaku. Test
konfigurasi dan native materialization bukan bukti keberhasilan tugas nyata.

Penyelesaian: delapan definisi valid, cakupan seed upgrade dan native policy/model
teruji, test tersentuh/typecheck hijau, docs terindeks, registrasi API dibaca ulang.
Perubahan source disimpan di worktree/branch terisolasi; tidak merge atau restart
instance produksi sebagai bagian tugas ini.
