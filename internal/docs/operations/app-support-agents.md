# Agent untuk pembuatan dan dukungan aplikasi

Katalog sekarang berisi 25 peran: delapan agent audit/QA inti, delapan agent aplikasi
di bawah, dan sembilan agent domain opt-in — lima PENGERJA isolated-worktree
(frontend/backend/database/Cloudflare/VPS) dan empat auditor read-only pasangan
review-nya (a11y/API/skema/Cloudflare), dikoreksi 2026-09-25 dari rilis pertama yang
keliru menghasilkan sembilan auditor read-only saja — lihat
[audit 2026-09-25](../research/audit-2026-09-25-custom-agent-dan-agen-domain.md) §3
dan §"Koreksi 2026-09-25".
Definisi adalah data di `shared/src/builtin-agents.ts`, dengan kelompok aplikasi di
`shared/src/builtin-app-agents.ts` dan kelompok domain di `shared/src/builtin-domain-agents.ts`.

## Memilih peran

| Agent | Gunakan ketika | Hasil yang diserahkan ke parent |
| --- | --- | --- |
| `product-designer` | Alur pengguna atau antarmuka perlu DIRANCANG sesuai design system (layout/token/copy/state visual) — bukan state/data-fetching React (itu `frontend-engineer`, `shared/src/builtin-domain-agents.ts`) | Alur, keputusan UI, artefak sesuai design system, state dan bukti render nyata (CDP) |
| `feature-builder` | Kebutuhan dan lingkup implementasi sudah cukup jelas | Patch dalam ownership, hasil test/typecheck relevan, docs dan batas yang belum diverifikasi |
| `performance-engineer` | Ada keluhan lambat atau target performa yang perlu diukur | Baseline, profil penyebab, perubahan, perbandingan setara dan kemungkinan regresi |
| `product-analyst` | Masalah, pengguna, prioritas atau scope MVP belum jelas | Kebutuhan berbukti, asumsi, prioritas dan acceptance criteria yang dapat diuji |
| `solution-architect` | Keputusan melintasi modul, data, API atau integrasi | Pilihan beserta tradeoff, rekomendasi, kontrak dan strategi migrasi |
| `operations-engineer` | Aplikasi akan dirilis atau perlu dukungan operasional | Artefak rilis/runbook, health check, rencana rollback serta bukti latihan yang dilakukan |
| `support-triager` | Ada laporan pengguna yang perlu ditata menjadi tindakan | Ringkasan masalah, versi/environment, severity beralasan, duplikat, draf balasan dan handoff |
| `knowledge-maintainer` | Panduan/FAQ/release notes/runbook perlu dibuat atau diperbarui | Dokumen berdasarkan perilaku dan versi yang sudah terverifikasi, dengan tautan sumber |
| `frontend-engineer` | Komponen/hook React/TS/Vite perlu ditulis/diperbaiki (state, efek, WebSocket, responsive) pada desain yang sudah ada — beda dari `product-designer` (visual) | Patch, test komponen, bukti render (Playwright bila proyek punya, fallback CDP) |
| `backend-engineer` | Route/handler backend perlu ditulis/diubah dan dibuktikan lewat boot server + curl, bukan hanya test unit | Patch per endpoint, cabang error dibuktikan, idempotensi dinilai |
| `database-engineer` | Skema/migration database perlu ditulis dan dibuktikan aman lewat apply di DB sekali-pakai + EXPLAIN | Migration, bukti EXPLAIN, status rollback, dokumen skema (ADR bila repo mewajibkan) |
| `cloudflare-engineer` | Infra Cloudflare (Workers/Pages/D1/R2/KV/Queues/DO/secrets/DNS/Access/WAF/Tunnel) perlu BENAR-BENAR diterapkan | Aksi produksi tercatat, titik rollback, config akhir per environment — **wewenang penuh ke produksi TANPA gerbang izin tambahan** dalam scope mandat |
| `vps-engineer` | Server Linux VPS via ssh perlu diprovisioning/dikonfigurasi dan diterapkan ke server nyata | Aksi produksi tercatat, validator statis lolos, bukti restore/downtime — **wewenang penuh ke produksi TANPA gerbang izin tambahan** dalam scope mandat |
| `a11y-auditor` | Diff mengubah markup/JSX/CSS komponen interaktif dan perlu diaudit WCAG 2.2 AA statis | Temuan berstatus (terbukti-statis/butuh-verifikasi-runtime), read-only |
| `api-contract-auditor` | Diff mengubah route/handler HTTP dan kontraknya perlu diverifikasi independen | Tabel per endpoint: cabang, status, idempotensi, kompatibilitas klien, read-only |
| `schema-migration-auditor` | Diff mengubah skema/migration dan perlu diaudit statis sebelum merge | Risiko data lama, indeks vs query nyata, status rollback, read-only |
| `cloudflare-config-auditor` | Diff menyentuh config Cloudflare dan perlu diaudit statis sebelum diterapkan | Binding/migration/edge berisiko per environment, read-only, tak pernah deploy |

Lima agen domain pertama (`frontend`/`backend`/`database`/`cloudflare`/`vps-engineer`)
adalah PENGERJA `isolated-worktree`; empat sisanya (`a11y`/`api-contract`/`schema-migration`/
`cloudflare-config-auditor`) adalah auditor `read-only` pasangan review-nya — lihat
[audit 2026-09-25](../research/audit-2026-09-25-custom-agent-dan-agen-domain.md)
§"Koreksi 2026-09-25". `cloudflare-engineer` dan `vps-engineer` BERBEDA dari
`operations-engineer`: keduanya berwenang mengubah infra Cloudflare/VPS langsung
dengan wewenang produksi penuh tanpa perlu mengutip otorisasi eksplisit dari mandat
(disiplinnya lewat prosedur rollback/validasi, bukan gerbang persetujuan) —
`operations-engineer` tetap dipakai untuk runbook/kesiapan rilis app-level generik
yang WAJIB mengutip otorisasi eksplisit sebelum aksi produksi.

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

Nama/deskripsi agent tersedia melalui registry native. Prompt utama hanya mendapat
satu arahan delegasi/handoff yang ukurannya tetap; daftar dan instruksi agent tidak
disalin ke dalamnya. Jika tidak ada agent yang dimaterialisasi, arahan itu juga tidak
ditambahkan. Laporan child dan metadata native tetap dapat menggunakan konteks.

| Kelompok | Policy | Runtime | Batas awal |
| --- | --- | --- | --- |
| designer | isolated-worktree | Claude Code | 60 turn |
| builder | isolated-worktree | Claude Code | 80 turn |
| performance, operations | isolated-worktree | Claude Code | 40 turn |
| knowledge | isolated-worktree | Claude Code | 30 turn |
| frontend, backend | isolated-worktree | Claude Code | 80 turn |
| database, cloudflare, vps-engineer | isolated-worktree | Claude Code | 60 turn |
| analyst, support | read-only | Claude Code atau Codex native yang didukung | 30 turn |
| architect | read-only | Claude Code atau Codex native yang didukung | 40 turn |
| a11y, api-contract | read-only | Claude Code atau Codex native yang didukung | 30 turn |
| schema-migration, cloudflare-config | read-only | Claude Code atau Codex native yang didukung | 30 turn |

Codex belum mendukung isolated-worktree pada custom agent Hanoman. Sepuluh agent
`isolated-worktree` (lima aplikasi + lima domain) tidak dimasukkan ke roster Codex;
policy tidak diturunkan menjadi inherit.
Worktree terisolasi juga tidak mengisolasi database atau layanan eksternal.
Operations perlu mengikuti scope otorisasi yang benar-benar sudah diberikan.
Jika belum ada otorisasi produksi, siapkan artefak dan bukti lokal untuk parent.
Support menyiapkan draf; pengiriman balasan membutuhkan otorisasi eksplisit.

Seed menyimpan `model=null` dan `runtime=null` seperti builtin lama. Model eksplisit
operator menang. Jika belum diisi, builtin global merekomendasikan sonnet untuk
Claude dan gpt-5.6-terra untuk Codex, kecuali solution-architect (opus / gpt-5.6-sol,
audit 2026-09-25). Ini profil awal yang dapat diubah, bukan kesimpulan model terbaik
dari benchmark. Effort medium, kecuali performance dan architect high serta
knowledge-maintainer low; timeout tidak ditetapkan. Claude memakai batas turn native;
batas turn Codex bersifat instruksi.

Pembuatan melalui API berbeda dari seed internal: payload dengan
`workspacePolicy=isolated-worktree` harus menyertakan `runtime=claude`.
Definisi global yang didaftarkan sebelum kode katalog baru terpasang tampil sebagai
custom biasa. Setelah kode terpasang, label builtin diturunkan dari namanya.
Baris API tanpa stempel seed diperlakukan sebagai milik operator, KECUALI isinya
byte-identik dengan salah satu versi katalog yang pernah dirilis
(`BUILTIN_FINGERPRINT_HISTORY`, audit 2026-09-25): baris itu diadopsi, diberi stempel,
dan ikut upgrade. Baris yang sudah disunting tak pernah diadopsi; jangan memalsukan
stempel untuk memaksa upgrade.

## Input dan bukti

Berikan tujuan, scope/ownership, repo/worktree, base SHA dan kandidat SHA sebagai
nilai heksadesimal literal, acceptance criteria, bukti terdahulu dan perintah
verifikasi. Sertakan target pengguna/design system untuk designer, skenario dan
environment untuk performance, serta versi/log yang telah disamarkan untuk support.
Untuk agent isolated, parent WAJIB meng-commit kandidat dulu: worktree child lahir
dari commit, jadi perubahan yang belum di-commit tak terlihat. Child checkout SHA
kandidat, meng-commit hasilnya, dan melaporkan SHA hasil untuk di-`git cherry-pick`
parent (audit 2026-09-25, P0-2).

Katalog tidak menyertakan nama MCP karena berbeda antar mesin. Designer tidak
otomatis mendapat browser/screenshot, operations tidak otomatis mendapat akses
monitoring/produksi, dan support tidak otomatis mendapat akses Help Center.
Parent menyediakan bukti atau mengonfigurasi tool yang tersedia lewat katalog
Custom Agents sesuai kebutuhan. Jika alat tidak tersedia, agent mencatat
verifikasi yang belum dilakukan; pemeriksaan source bukan bukti render visual.
Tiga peran read-only tidak memiliki Write/Edit; solution-architect punya Bash yang
dibatasi validator read-only ke perintah baca (rg/sed -n/git diff|show|log).

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
