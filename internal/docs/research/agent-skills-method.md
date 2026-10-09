# Metode Agent Skills (Addy Osmani)

## Rancangan dan sumber

Tujuan: menambahkan `agent-skills` sebagai metode backlog ketiga lewat registry
`shared/src/method-catalog.ts`, sesuai ADR-0113/0114. Default tetap `superpowers`.
Pilihan Start dan Settings, status pemasangan, serta union direktori plan/spec
mengikuti katalog yang sama; tidak perlu endpoint, migration, atau executor baru.

Dipertimbangkan 2026-10-10 dari [repo upstream](https://github.com/addyosmani/agent-skills)
commit `1401c8b8030e023baeebb31781a6653fe8e93026` (plugin v0.6.12).
Bacaan: [README](https://github.com/addyosmani/agent-skills/blob/1401c8b8030e023baeebb31781a6653fe8e93026/README.md),
[setup Codex](https://github.com/addyosmani/agent-skills/blob/1401c8b8030e023baeebb31781a6653fe8e93026/docs/codex-setup.md),
[spec-driven-development](https://github.com/addyosmani/agent-skills/blob/1401c8b8030e023baeebb31781a6653fe8e93026/skills/spec-driven-development/SKILL.md),
[planning-and-task-breakdown](https://github.com/addyosmani/agent-skills/blob/1401c8b8030e023baeebb31781a6653fe8e93026/skills/planning-and-task-breakdown/SKILL.md),
serta manifest plugin/marketplace Claude dan Codex.

| Fase hanoman | Skill plugin `agent-skills` |
| --- | --- |
| Brainstorm | `idea-refine` |
| Spec | `spec-driven-development` |
| Audit | `debugging-and-error-recovery`, `code-review-and-quality` |
| Plan | `planning-and-task-breakdown` |
| Execute | `incremental-implementation`, `test-driven-development`, `code-review-and-quality` |
| Verifikasi | `superpowers:verification-before-completion` |

Objective memakai kontrak fase hanoman. `exitSkills` tetap membawa gerbang
Superpowers yang diwajibkan ADR-0113, sehingga kedua plugin diperlukan.

Upstream memakai `tasks/plan.md` dan `tasks/todo.md`; adaptasi hanoman menyimpan
plan beserta checklist `- [ ]` di `docs/agent-skills/plans/` dan spec di
`docs/agent-skills/specs/`. Satu plan memuat keputusan dan task agar centang yang
dipantau hanoman merupakan sumber status implementasi. Jangan menimpa plan lain
yang belum tuntas, membuat tracker eksternal, atau menjalankan seluruh lifecycle
upstream dari satu fase. Keputusan terbuka dan review memakai jalur sesi hanoman.
Meta-skill `using-agent-skills` tidak dipaksa otomatis, sesuai rekomendasi Codex
upstream; skill dipilih per fase/tugas sesuai instruksi project dan pengguna.

## Cara penggunaan

1. Di **Settings → Sesi**, pilih **Agent Skills (Addy Osmani)** sebagai metode default,
   atau pilih metode ini di dialog **Start** untuk backlog tertentu.
2. Periksa status skill untuk agen yang akan digunakan. Jalankan pemasangan lewat
   sesi terminal dari Settings bila belum siap; Start tetap fail-open sesuai ADR-0114.
3. Setelah pemasangan, mulai sesi agen baru agar plugin ditemukan.
4. Spec dan plan sesi disimpan dalam direktori metode di atas. Metode distempel
   saat peluncuran pertama backlog; mengganti default tidak mengubah sejarahnya.

Claude:

```sh
claude plugin marketplace add addyosmani/agent-skills
claude plugin install agent-skills@addy-agent-skills
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
```

Codex (CLI v0.122+ menurut panduan upstream):

```sh
codex plugin marketplace add addyosmani/agent-skills
codex plugin add agent-skills@agent-skills
codex plugin add superpowers@openai-curated
```

Nama marketplace berbeda: Claude `addy-agent-skills`, Codex `agent-skills`.
Perintah ini menjadi petunjuk pemasangan dalam katalog; penambahan metode tidak
memasang plugin secara otomatis di mesin operator.

## Kriteria penerimaan

- Metode baru muncul dan dapat dipilih pada kedua picker melalui katalog.
- Prompt feature/QA/goal serta continue/resume memakai skill dan direktori metode
  baru, dan tetap membawa gerbang verifikasi.
- Paket Agent Skills tanpa gerbang Superpowers dilaporkan belum siap; dua plugin
  lengkap siap untuk Claude dan Codex.
- Metode lama dan fallback tidak berubah; semua gerbang plan memindai union.

## Plan implementasi

- [x] Tambahkan regresi prompt, status kesiapan, dan pilihan metode baru.
- [x] Tambahkan satu entri katalog dengan pemetaan fase, adaptasi artefak, prasyarat,
  dan perintah pemasangan native per agen.
- [x] Jalankan test terarah shared/runner/picker/status/gerbang plan serta typecheck
  shared, runner, dan web; periksa diff dan tautkan dokumentasi ini ke index.


## Hasil verifikasi

Test terarah: shared katalog/status, runner prompt/fase/goal/Stop hook Codex,
picker dan status UI (179 test setelah menambahkan kedua pilihan ke regresi
picker), serta gerbang plan server (76 test), seluruhnya lulus.
Typecheck `shared`, `runner`, `src`, dan `server` lulus. DB test server diisolasi
melalui `TEST_DATABASE_URL`; env operator dibersihkan sesuai AGENTS.md.
Pemasangan plugin sungguhan dan sesi agen live tidak dijalankan dalam verifikasi ini.
