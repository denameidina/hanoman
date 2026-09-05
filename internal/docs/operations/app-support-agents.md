# Agent untuk pembuatan dan dukungan aplikasi

Katalog sekarang berisi 16 peran: delapan agent audit/QA yang sudah ada dan delapan
agent aplikasi di bawah. Definisi adalah data di `shared/src/builtin-agents.ts`,
dengan kelompok aplikasi di `shared/src/builtin-app-agents.ts`.

## Memilih peran

| Agent | Gunakan ketika | Hasil yang diserahkan ke parent |
| --- | --- | --- |
| `product-designer` | Alur pengguna atau antarmuka perlu dirancang/diperbaiki | Alur, keputusan UI, artefak sesuai design system, state dan bukti render |
| `feature-builder` | Kebutuhan dan lingkup implementasi sudah cukup jelas | Patch dalam ownership, hasil test/typecheck relevan, docs dan batas yang belum diverifikasi |
| `performance-engineer` | Ada keluhan lambat atau target performa yang perlu diukur | Baseline, profil penyebab, perubahan, perbandingan setara dan kemungkinan regresi |
| `product-analyst` | Masalah, pengguna, prioritas atau scope MVP belum jelas | Kebutuhan berbukti, asumsi, prioritas dan acceptance criteria yang dapat diuji |
| `solution-architect` | Keputusan melintasi modul, data, API atau integrasi | Pilihan beserta tradeoff, rekomendasi, kontrak dan strategi migrasi |
| `operations-engineer` | Aplikasi akan dirilis atau perlu dukungan operasional | Artefak rilis/runbook, health check, rencana rollback serta bukti latihan yang dilakukan |
| `support-triager` | Ada laporan pengguna yang perlu ditata menjadi tindakan | Ringkasan masalah, versi/environment, severity beralasan, duplikat, draf balasan dan handoff |
| `knowledge-maintainer` | Panduan/FAQ/release notes/runbook perlu dibuat atau diperbarui | Dokumen berdasarkan perilaku dan versi yang sudah terverifikasi, dengan tautan sumber |

Parent memilih peran berdasarkan tugas saat itu. Fitur kecil dapat langsung memakai
feature-builder; tidak perlu menjalankan semua agent secara berurutan. Untuk fitur
yang masih kabur, alur yang berguna adalah analyst → designer dan/atau architect →
builder → QA/review yang relevan. Performance digunakan ketika ada target atau
bukti masalah. Operations dan knowledge mendukung rilis; support memasok masalah
terstruktur kepada parent untuk diteruskan ke root-causer atau performance.

Semua agent baru adalah daun: `mentions=[]`, tidak memperoleh alat delegasi.
Panah di atas berarti parent menerima hasil lalu memberi tugas berikutnya.
Pekerjaan yang dibagi tetap perlu ownership yang tidak bertabrakan.

## Konfigurasi

Semua memakai `activation=smart`. Pada instalasi baru, delapan tambahan ini
`enabledByDefault=false`; tiga default aktif lama tetap scout, blast-radius,
security-reviewer. Aktifkan peran yang dibutuhkan di Custom Agents. Enabled berarti
tersedia untuk dipilih parent, bukan otomatis dipanggil pada setiap giliran.
Perubahan konfigurasi berlaku pada **sesi baru**; roster sesi yang sedang berjalan
tidak diubah.

| Kelompok | Policy | Runtime | Batas awal |
| --- | --- | --- | --- |
| designer, builder, performance, operations, knowledge | isolated-worktree | Claude Code | 40 turn |
| analyst, architect, support | read-only | Claude Code atau Codex native yang didukung | 30 turn |

Codex belum mendukung isolated-worktree pada custom agent Hanoman. Lima agent
tersebut tidak dimasukkan ke roster Codex; policy tidak diturunkan menjadi inherit.
Worktree terisolasi juga tidak mengisolasi database atau layanan eksternal.
Operations perlu mengikuti scope otorisasi yang benar-benar sudah diberikan.
Jika belum ada otorisasi produksi, siapkan artefak dan bukti lokal untuk parent.
Support menyiapkan draf; pengiriman balasan membutuhkan otorisasi eksplisit.

Seed menyimpan `model=null` dan `runtime=null` seperti builtin lama. Model eksplisit
operator menang. Jika belum diisi, builtin global merekomendasikan sonnet untuk
Claude dan gpt-5.6-terra untuk Codex. Ini profil awal yang dapat diubah, bukan
kesimpulan model terbaik dari benchmark. Effort medium, kecuali performance dan
architect high; timeout tidak ditetapkan. Claude memakai batas turn native;
batas turn Codex bersifat instruksi.

Pembuatan melalui API berbeda dari seed internal: payload dengan
`workspacePolicy=isolated-worktree` harus menyertakan `runtime=claude`.
Definisi global yang didaftarkan sebelum kode katalog baru terpasang tampil sebagai
custom biasa. Setelah kode terpasang, label builtin diturunkan dari namanya.
Baris API tanpa stempel seed diperlakukan sebagai milik operator dan tidak ditimpa
otomatis; jangan memalsukan stempel untuk memaksa upgrade.

## Input dan bukti

Berikan tujuan, scope/ownership, repo/worktree, base dan kandidat (termasuk dirty
changes yang belum masuk commit), acceptance criteria, bukti terdahulu dan perintah
verifikasi. Sertakan target pengguna/design system untuk designer, skenario dan
environment untuk performance, serta versi/log yang telah disamarkan untuk support.
Untuk agent isolated, parent harus memastikan snapshot kandidat tersedia pada
worktree child; branch baru tidak otomatis membawa dirty changes parent.

Katalog tidak menyertakan nama MCP karena berbeda antar mesin. Designer tidak
otomatis mendapat browser/screenshot, operations tidak otomatis mendapat akses
monitoring/produksi, dan support tidak otomatis mendapat akses Help Center.
Parent menyediakan bukti atau mengonfigurasi tool yang tersedia lewat katalog
Custom Agents sesuai kebutuhan. Jika alat tidak tersedia, agent mencatat
verifikasi yang belum dilakukan; pemeriksaan source bukan bukti render visual.
Tiga peran read-only tidak memiliki Bash/Write/Edit.

Perbandingan performa harus menggunakan skenario dan environment yang setara,
pengukuran berulang dan catatan noise. Angka yang belum diukur tetap belum
terverifikasi. Test yang lulus bukan pengganti pemeriksaan UX, keberhasilan
rollback, atau pembuktian isi balasan support.

## Batas validasi

Test katalog, seed upgrade dan native renderer memeriksa nama/profile, isolasi,
alat leaf, kompatibilitas runtime, dan preservasi konfigurasi operator.
Evaluator di `evals/custom-agents` memiliki 20 fixture untuk **delapan agent audit
lama**. Delapan agent aplikasi belum memiliki fixture perilaku atau benchmark
tugas nyata. Meminta evaluator menjalankan salah satunya menghasilkan error
tidak ada kasus, bukan skor lulus. Ukur keberhasilan dari tugas nyata beserta
review hasil sebelum menarik kesimpulan efektivitas.

Keputusan: [spec](../../../docs/superpowers/specs/2026-09-05-app-support-agents-design.md)
dan [plan](../../../docs/superpowers/plans/2026-09-05-app-support-agents.md).
Kontrak sistem: [ADR-0136](../adr/0136-agen-bawaan-sistem-seed-idempoten.md) dan
[ADR-0159](../adr/0159-custom-agent-native-terukur-terisolasi.md).
