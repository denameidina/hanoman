# Audit lanjutan custom agent bawaan + 9 agen domain baru — 25 September 2026

Status: audit dan perbaikan P0/P1 selesai di branch `feat/audit-custom-agent-20260925`
(worktree `.worktrees/audit-custom-agent-20260925`). P2 dan sebagian keputusan terbuka
sengaja **ditunda** — lihat §4/§5. Dikerjakan oleh empat implementer paralel (katalog,
runner, server, domain) dengan lima commit inti: `32a4b8e0`, `0d5ec950`, `4c6ebe92`,
`4067a02e`/`eff20a11`/`8b12f9ed`/`8b12f9ed` (server), dan agen domain (bergabung ke
`8b12f9ed` karena race commit di worktree bersama — lihat §3.4).

## 1. Ringkasan eksekutif

Audit sebelumnya ([2026-09-05](audit-2026-09-05-custom-agent-bawaan.md)) menutup celah
kebijakan/seleksi/eval pada delapan agent inti dan menambah delapan agen aplikasi.
Audit kali ini menemukan **regresi baru** yang lahir justru dari perbaikan itu, plus
kebutuhan sembilan agen domain tambahan yang direkomendasikan riset terpisah:

1. **Tiga agen punya slug Codex yang tidak pernah ada di katalog runtime** (`gpt-5.6`
   di root-causer/edge-case-hunter/security-reviewer) — `recommendedModel` diam-diam
   mengembalikan `null` dan agen mewarisi model sesi. **Diperbaiki (P0-1).**
2. **Agen `isolated-worktree` tidak diberi tahu bahwa worktree-nya lahir dari sebuah
   commit, bukan dari pohon kerja parent** — kontrak lama menjanjikan "kandidat termasuk
   dirty changes", padahal worktree Git terisolasi tidak pernah melihatnya. Risikonya
   hijau palsu di qa-verifier dan hasil yang tidak pernah sampai ke parent. **Diperbaiki
   (P0-2)** dengan kontrak SHA literal + `git cherry-pick`, bukan kebijakan worktree baru.
3. **Delapan agen aplikasi terdaftar di DB tanpa stempel seed** karena didaftarkan lewat
   API sebelum seed mengenalnya (2026-09-05) — seed menganggapnya sudah disunting
   operator dan tak pernah lagi menerima perbaikan katalog. **Diperbaiki (P0-3)** lewat
   adopsi berbasis sidik jari historis.
4. **`operations-engineer` tidak menegaskan bahwa berada di worktree bukan otorisasi
   produksi.** **Diperbaiki (P0-4).**
5. **`DATABASE_URL` operasional hanoman bocor ke env pane sesi agen** — kelas bug yang
   sama dengan `hanoman-test-env-bocor-database-url`. **Diperbaiki (P0-5)**, dilepas dari
   env pane sesi agen dan ditambah larangan eksplisit di policy isolated.
6. **Allowlist shell read-only tidak pernah dijelaskan ke agen yang dipagarinya** —
   agen membuang giliran mencoba perintah yang pasti ditolak. **Diperbaiki (P1-1)**,
   prosa allowlist kini dirakit dari satu sumber (`READ_ONLY_POLICY`).
7. **`spec-auditor` (builtin) dan reviewer fase Execute (ADR-0170) memakai dua daftar
   putusan yang berbeda isi** — satu 6 putusan, satu 5. **Disatukan (P1-6)** lewat
   `shared/src/spec-audit.ts` (`SPEC_AUDIT_VERDICTS`/`SPEC_AUDIT_VERDICT_LIST`).
8. **Anggaran argv `--agents` (102.400 B) nyaris penuh dengan 16 agen (71.160 B terukur),
   dan akan terlampaui begitu 9 agen domain ditambahkan** (≈113 KB proyeksi). **Mitigasi
   (P1-11)**: boilerplate policy/handoff/gaya-kode ditulis sekali ke berkas bersama per
   sesi, dirujuk lewat path — bukan disalin ke tiap prompt.
9. **Riset domain**: dari 16 usulan agen baru, 9 lolos deduplikasi dan lolos semua syarat
   ADR-0136 (prosedur, kelas kegagalan terukur, putusan kecil). Lihat §3.

Semua sembilan agen domain baru **opt-in dan read-only**; tak satu pun aktif default.
Tiga default lama (`scout`, `blast-radius`, `security-reviewer`) tidak berubah.

## 2. Tabel putusan per agen (23 agen lama)

Kolom "Sebelum" dari `shared/src/builtin-agents.ts`/`builtin-app-agents.ts` sebelum
branch ini (snapshot `8cea296c`); "Sesudah" adalah hasil perbaikan di branch ini.

| Agen | Putusan | Sebelum (claude · codex · effort · turns · policy) | Sesudah |
|---|---|---|---|
| scout | pertahankan | haiku · gpt-5.6-terra · low · 20 · RO | tidak berubah (langkah 1/3 diperjelas, P2 ditunda) |
| root-causer | perbaiki | sonnet · **gpt-5.6✗** · high · 40 · RO | sonnet · **gpt-5.6-sol** · high · **30** · RO; 4 status (`terbukti-eksekusi`/`terbukti-statis`/`belum-terbukti`/`gugur`) |
| qa-verifier | perbaiki | sonnet · terra(tak pernah dipakai) · medium · 40 · 900s · iso | sonnet · terra · medium · 40 · **1800s** · iso; +`Edit`; verifikasi SHA eksplisit |
| edge-case-hunter | perbaiki | sonnet · **gpt-5.6✗** · high · 40 · iso | sonnet · **gpt-5.6-terra** · high · 40 · iso; kategori state UI + anggaran 8 test |
| blast-radius | perbaiki ringan | sonnet · terra · medium · 30 · RO | tidak berubah di scope P0/P1 (P2 ditunda) |
| spec-auditor | perbaiki + satukan sumber | sonnet · terra · high · 30 · RO | sama profil; putusan diimpor dari `shared/src/spec-audit.ts` bersama reviewer ADR-0170 |
| security-reviewer | perbaiki | sonnet · **gpt-5.6✗** · high · 30 · RO | sonnet · **gpt-5.6-sol** · high · 30 · RO; langkah 1b telusur mundur ke pemanggil gerbang bersama; gerbang origin/CSRF |
| dep-auditor | perbaiki | haiku · terra · medium (no-op di haiku) · 30 · RO | **sonnet** · terra · medium · **40** · RO; prosedur lockfile-first lintas ekosistem |
| feature-builder | perbaiki | sonnet · terra(mati) · medium · 40 · iso | sonnet · terra · medium · **80** · iso; bentuk laporan Status/AC/SHA |
| solution-architect | perbaiki (spekulatif, lihat §5.5) | sonnet · terra · high · 30 · RO | **opus** · **gpt-5.6-sol** · high · **40** · RO; +`Bash`; reuse peta scout |
| operations-engineer | perbaiki (gerbang produksi) | sonnet · terra(mati) · medium · 40 · iso | tidak berubah profil; gerbang otorisasi produksi eksplisit (P0-4). P2 (effort high + checklist VPS) ditunda |
| knowledge-maintainer | sempitkan | sonnet · terra(mati) · medium · 40 · iso | sonnet · terra · **low** · **30** · iso; mandat hanya docs pengguna, "runbook" milik operations-engineer |
| product-analyst | sempitkan | sonnet · terra · medium · 30 · RO | tidak berubah profil; deskripsi menyebut batas eksplisit vs support-triager. Penggabungan (Keputusan terbuka #3) **ditunda** |
| support-triager | sempitkan | sonnet · terra · medium · 30 · RO | idem |
| product-designer, performance-engineer | — | — | **tidak disentuh** (P2 di luar scope task ini) |
| 9 agen domain baru | baru | — | lihat §3 |

"terra(mati)": `models.codex` tak pernah dipakai karena materializer menyaring
`isolated-worktree` dari Codex. Ini tetap benar sesudah perbaikan — lihat ADR-0159 §2.

## 3. Katalog 9 agen domain baru

Berkas baru `shared/src/builtin-domain-agents.ts`, di-spread ke `BUILTIN_AGENTS` sesudah
`...BUILTIN_APP_AGENTS`. Semuanya `enabledByDefault: false`, `workspacePolicy: "read-only"`,
`activation: "smart"`.

| Agen | Domain | Model (claude/codex) · effort · turns | Alasan lolos dedup |
|---|---|---|---|
| `a11y-auditor` | frontend | sonnet/gpt-5.6-terra · medium · 30 | Tak ada auditor aksesibilitas statis; product-designer adalah penulis, bukan auditor |
| `frontend-render-auditor` | frontend | sonnet/gpt-5.6-terra · medium · 30 | Kelas bug state basi/langganan bocor/main thread belum dicakup; performance-engineer mengukur angka, ini menganalisis kode |
| `api-contract-auditor` | backend | sonnet/gpt-5.6-terra · medium · 30 | Konsistensi cabang/status/idempotensi endpoint; security-reviewer menangani input jahat, blast-radius drift lintas paket |
| `concurrency-hazard-hunter` | backend | sonnet/gpt-5.6-sol · high · 30 | Proaktif atas state bersama; root-causer bersifat reaktif (bug sudah terjadi) |
| `schema-migration-auditor` | database | **opus**/gpt-5.6-sol · high · 30 | Menegakkan kontrak "skema + migration + ADR" (CLAUDE.md bagian Jangan) — model dinaikkan ke opus karena kesalahan di area ini biasanya tak bisa dibatalkan |
| `layering-guard` | arsitektur | sonnet/gpt-5.6-terra · medium · 20 | Menjaga janji arah impor tertulis (mis. "data murni, dibundel ke browser" di `shared`) |
| `cloudflare-config-auditor` | infra | sonnet/gpt-5.6-sol · high · 30 | Gabungan dua usulan riset (deploy + zero-trust) — satu entri menghemat anggaran argv |
| `vps-hardening-auditor` | infra | sonnet/gpt-5.6-sol · high · 30 | Probe SSH interaktif dibuang karena read-only menolak `ssh`; murni audit config statis |
| `maintainability-reviewer` | dev umum | sonnet/gpt-5.6-terra · medium · 30 | Mandat unik (duplikasi/abstraksi/penamaan); nama `code-reviewer` sengaja dihindari karena rancu dengan agen plugin pihak ketiga |

Ditolak/ditunda saat deduplikasi: `migration-apply-verifier` dan `refactor-executor`
(keduanya butuh `isolated-worktree` — ditunda sampai P0-2 terbukti stabil di produksi),
`adr-scribe` (menulis ADR dari worktree terpisah memicu tabrakan nomor — alasan yang
sama dengan pencabutan `doc-syncer` di ADR-0136), `test-strategist` (menggandakan fase
Plan dan edge-case-hunter). `vps-deploy-readiness-auditor` diserap sebagai amandemen
P2 operations-engineer, ditunda.

Kedua agen infra (`cloudflare-config-auditor`, `vps-hardening-auditor`) menandai
perintah operator (`wrangler …`, `sshd -T`, `nginx -t`, `systemctl …`, `ufw …`,
`caddy validate`) dengan frasa eksplisit **"UNTUK PARENT, jangan kamu jalankan
sendiri"** — dikunci test read-only baru (§6) karena kedua perintah itu memang
ditolak validator `readOnlyDecision` bila agen mencobanya sendiri.

Prasyarat sebelum menyalakan agen domain di sebuah project: **P1-1** (allowlist
read-only satu sumber) dan **P1-11** (anggaran argv, §1 poin 8) — tanpanya menyalakan
banyak agen domain sekaligus bisa melampaui `AGENTS_ARG_SAFE_BYTES` dan sesi jatuh ke
mode tunggal secara diam-diam.

## 4. Yang dikerjakan vs ditunda

### Dikerjakan (scope P0 + P1 + katalog domain)

- P0-1 slug Codex, P0-2 kontrak isolated-worktree (SHA + cherry-pick), P0-3 adopsi
  baris tanpa stempel, P0-4 gerbang produksi operations-engineer, P0-5 `DATABASE_URL`
  di env pane + policy.
- P1-1 allowlist read-only satu sumber, P1-2 tiga/empat status root-causer, P1-3
  qa-verifier (+`Edit`, 1800s, bentuk laporan), P1-4 edge-case-hunter (kategori state
  UI, anggaran 8 test), P1-5 security-reviewer (telusur mundur, origin/CSRF), P1-6
  kosakata putusan bersama spec-auditor/reviewer, P1-7 dep-auditor (sonnet, prosedur
  lockfile-first), P1-8 hapus duplikasi `LEAF_HANDOFF`, P1-9 feature-builder (maxTurns
  80), P1-10 telemetry token (baca `message.usage`/`payload.info.total_token_usage`
  nyata, bukan `record.usage` yang selalu kosong), P1-11 kontrak agen ke berkas
  bersama (`agentContractFiles`) + guard anggaran argv untuk semua sesi claude, P1-12
  `claudeEfforts` mengembalikan `[]` untuk model tanpa effort dikenal (haiku).
- Sembilan agen domain baru (§3) plus penguatan penandaan "UNTUK PARENT" pada dua
  agen infra.
- Keputusan model solution-architect (opus/gpt-5.6-sol/high/40) — ditandai spekulatif,
  lihat Keputusan terbuka #5 di §5.

### Ditunda (P2, sesuai keputusan scope manusia)

- P2 agen aplikasi lain: product-designer/performance-engineer maxTurns 60,
  operations-engineer effort high + checklist VPS, sempitan scout/blast-radius.
- `migration-apply-verifier`, `refactor-executor` (agen domain isolated-worktree).
- Seed stamping per-iterasi sudah dikerjakan (bagian dari P0-3), tapi item P2 lain
  (`recommendedModel` untuk override project, `activation: smart` yang inert,
  disposition otomatis dari `Verdict` reviewer) tidak disentuh.
- Amandemen ADR-0167 (pelonggaran "menunggu-keputusan"), penggabungan
  product-analyst+support-triager, pelonggaran validator read-only (Keputusan terbuka
  #7) — semuanya butuh keputusan manusia, lihat §5.

## 5. Keputusan terbuka tersisa (butuh manusia)

1. Policy Execute implementer: tetap isolated + cherry-cherry-pick (dipilih untuk
   branch ini) atau `inherit-worktree` baru (feature-builder menulis langsung di
   worktree fase)? ADR-0170 belum diamandemen untuk opsi kedua.
2. Amandemen ADR-0167: longgarkan "keputusan terbuka apa pun → berhenti" menjadi
   "berhenti hanya bila memblokir acceptance"?
3. Penggabungan product-analyst + support-triager menjadi `requirements-analyst`, dan
   nasib knowledge-maintainer (dicabut atau tetap disempitkan seperti sekarang). Seed
   tidak menghapus baris yang namanya hilang dari katalog — butuh kebijakan tombstone.
4. Infra: tetap auditor read-only + gerbang produksi (dipilih), atau pecah
   operations-engineer jadi dua peran (auditor + penulis produksi)?
5. `solution-architect` ke opus/high/40 spekulatif tanpa benchmark — sebaiknya
   ditinjau ulang setelah telemetry token (P1-10, sudah diperbaiki) mengumpulkan data
   biaya nyata.
6. `dep-auditor` haiku→sonnet: langsung diganti (dipilih) vs jalankan dulu fixture
   eval di haiku.
7. Pelonggaran validator read-only (izinkan `git blame`/`git grep`/`git ls-files`/
   `cat` tanpa opsi, `| ; & < >` di dalam kutip) — menambah permukaan hook keamanan,
   belum diputuskan.
8. `Skill`/MCP untuk builtin (agen desain/Cloudflare lebih kuat dengan skill
   impeccable/wrangler) — dilarang katalog saat ini (ADR-0094 M4), butuh pengukuran.
9. Agen domain mana yang dinyalakan per project sebelum P1-11 sepenuhnya menutup
   risiko anggaran argv.
10. root-causer: tetap read-only (diagnosis statis, jalan di Codex) atau
    isolated-worktree (reproduksi nyata, hanya Claude)?

## 6. Bukti verifikasi

Angka di bawah dari laporan masing-masing implementer paralel di worktree yang sama
(bukan dijalankan ulang oleh penulis dokumen ini, kecuali disebutkan "diverifikasi
ulang"):

| Implementer/scope | Perintah (resep isolasi SPEC-479) | Hasil |
|---|---|---|
| Katalog (`shared/src/builtin-agents.ts`, `builtin-app-agents.ts`) | `pnpm vitest --run shared/test/builtin-agents.test.ts --no-file-parallelism` | 15/15 lulus (dijalankan dua kali, sebelum & sesudah commit paralel `0d5ec950`) |
| Runner (kontrak worktree, allowlist, argv) | `custom-agents.test.ts` + `agent-readonly.test.ts` + `phase-agents.test.ts` + `server/test/phase-agents.pty.test.ts` | 41 + 30 + 37 + 18 = 126/126 lulus; suite tetangga (`codex-agent-config`, `custom-agent-eval`, `agent-definition`, dll.) juga lulus |
| Server (seed, `DATABASE_URL`, telemetry, efforts) | `builtin-agents` (server) + `pty` + `custom-agents.pty`/`phase-agents.pty` + `agent-invocations.service` + `custom-agent-metrics.route`/`phase-invocation-cache` + set P1-12 + `shared`/`runner` terkait | 23 + 69 + 40 + 13 + 10 + 202 + 85 = **442/442 lulus**, 0 gagal |
| Domain (9 agen baru) | `shared/test/builtin-agents.test.ts` + `shared/test/builtin-domain-agents.test.ts` + `runner/test/builtin-domain-agents-readonly.test.ts` + `runner/test/agent-readonly.test.ts` | 15 + 8 + 28 + 30 = **81/81 lulus** |

Typecheck: `pnpm --filter ./shared typecheck` dan `pnpm --filter ./runner typecheck`
bersih di seluruh laporan.

**Merah yang sudah ada sebelum task ini dimulai, bukan disebabkan perubahan di sini,
dan sengaja TIDAK diperbaiki (bukan milik agen manapun dalam scope ini):**

- `runner/test/builtin-app-agents.test.ts` (2 test) — diverifikasi ulang saat menulis
  dokumen ini (`pnpm vitest --run runner/test/builtin-app-agents.test.ts
  --no-file-parallelism`, resep isolasi SPEC-479): **2 gagal**, `expected 80 to be 40`
  dan `model = "gpt-5.6-terra"` tak ditemukan di config Codex `solution-architect`.
  Test ini mengunci profil LAMA (maxTurns seragam 40, model Codex seragam
  `gpt-5.6-terra`) dan menjadi basi begitu P1-9 (feature-builder maxTurns 80) dan
  keputusan model solution-architect (opus/gpt-5.6-sol) mendarat. Berkas ini milik
  paket `runner` — di luar scope docs; perlu diperbarui oleh siapa pun yang berikutnya
  menyentuh `runner/test/`.
- `server/test/prd-from-audit.route.test.ts` (1 test) — sudah merah di `main` 0.9.4
  menurut catatan memori proyek (`hanoman-base-merah-prd-audit-launch-admission`),
  tidak terkait perubahan branch ini.

**Docs index check**: `pnpm exec tsx cli/src/hanoman.ts docs index --check` → `index
ok`. Ini bukan gate mekanis yang memblokir commit (guardrail SoT dicabut ADR-0023) dan
hanya memverifikasi bahwa setiap doc di `internal/docs/**` terjangkau dari
`README.md` — bukan bahwa tautan ke `docs/superpowers/**` di luar `internal/docs/`
valid (tautan itu diverifikasi manual dengan membaca berkas targetnya).
