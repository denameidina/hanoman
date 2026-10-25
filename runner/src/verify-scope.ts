import type { VerifyScope } from "./types";

// SPEC-376 · ADR-0080 — scope verifikasi sesi.
//
// Sampai spec ini, prompt sesi DIAM soal seberapa luas harus diverifikasi: ia bicara fase,
// otonomi, skill, commit, dan push — tapi tak sekali pun menyebut test. Karena diam, agen jatuh
// ke konvensi repo target (DoD hanoman sendiri dulu berbunyi `vitest run --no-file-parallelism`
// = 258 berkas test) dan ke kebiasaan "kalau ragu, jalankan semuanya". Beberapa sesi berjalan
// bersamaan di satu mesin, jadi biaya itu dikalikan.
//
// Klausa ini MENGARAHKAN, bukan memaksa: tak ada hook deny (ADR-0037 tetap utuh; preseden
// ADR-0073 yang menambah hook Stop tanpa mencabutnya). Karena itu ia harus (a) menyebut
// perintah yang benar-benar bisa dijalankan, bukan imbauan abstrak, dan (b) memberi jalan
// keluar eksplisit untuk perubahan berdampak luas — scope sempit yang dipatuhi membabi buta
// justru melahirkan regresi yang lolos.
const CHANGED = [
  "Scope verifikasi: HANYA yang berubah. Mesin ini menjalankan beberapa sesi sekaligus —",
  "memverifikasi seluruh project menghabiskan RAM & CPU yang sedang dipakai sesi lain.",
  "",
  "Berkas yang berubah di worktree ini:",
  '`git diff --name-only "$HANOMAN_BASE_SHA"...HEAD` (yang sudah di-commit) dan',
  "`git status --porcelain` (yang belum).",
  "",
  "- Test: jalankan HANYA test yang berkaitan dengan berkas itu. Repo vitest:",
  '  `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` (vitest sendiri menurunkan berkas yang',
  "  berubah dari git, termasuk yang belum di-commit), atau `pnpm vitest related --run <berkas…>`,",
  "  atau sebut path berkas test-nya langsung. Stack lain: `pytest <path>`, `go test ./paket/...`.",
  "  JANGAN `pnpm test` atau `vitest run` polos — itu seluruh suite.",
  "  Jebakan: `--changed` menyalakan `passWithNoTests`, jadi nol test TERLIHAT hijau. Pastikan",
  '  test-nya memang berjalan, jangan menerima "no test files" sebagai bukti.',
  "- Typecheck: hanya paket yang tersentuh (mis. `pnpm --filter ./server typecheck`).",
  "  JANGAN `pnpm -r typecheck` — itu menyalakan satu proses tsc per paket sekaligus.",
  "- Ritme: per task jalankan berkas test yang task itu sentuh saja.",
  "  JANGAN menjalankan ulang berkas test yang sudah hijau selama kode yang diujinya",
  "  tak berubah sejak itu. Typecheck paket tersentuh sesudah task yang mengubah",
  "  tipe/kontrak ekspor, bukan tiap task. Gabungan semua test tersentuh + typecheck",
  "  dijalankan SEKALI di akhir, sebelum melapor.",
  "- Lint: hanya berkas yang berubah, bukan seluruh repo.",
  "- Build penuh: hanya bila yang kamu ubah memang soal build/bundling.",
  "- Boot server + curl / smoke end-to-end: hanya bila task ini menyentuh endpoint atau perilaku",
  "  runtime-nya, sekali di akhir — bukan rutin tiap task.",
  "- Membereskan proses nyangkut: JANGAN `pkill -f <pola>` maupun `killall`. Prompt setiap sesi",
  "  hidup di ARGV proses agennya, jadi pola seperti `vitest`/`tsc`/`node` ikut mencocoki agen sesi",
  "  LAIN di mesin ini dan mematikannya di tengah kerja — dan `pkill` mengecualikan leluhurnya",
  "  sendiri, jadi yang mati selalu sesi tetangga, bukan sesimu. Bunuh per-PID: `ps`/`lsof -ti:<port>`",
  "  → `kill <pid>`; atau sempitkan polanya sampai memuat path worktree-mu sendiri.",
  "",
  "Suite penuh, lint penuh, dan build penuh adalah tugas MANUSIA sebelum merge, bukan tugas sesi.",
  "Pengecualian yang kamu putuskan sendiri: bila perubahanmu memang berdampak luas (mengubah",
  "tipe/kontrak bersama, skema, atau berkas yang diimpor banyak modul), perluas scope seperlunya",
  "dan katakan alasannya. Ini panduan biaya, bukan larangan.",
].join("\n");

// Mode `none` — untuk perangkat yang tak kuat menjalankan test sama sekali (bahkan set
// `--changed` yang sempit membuat mesin operator tersendat). Sama seperti CHANGED ia mengarahkan,
// bukan memaksa; bedanya ia tak memberi jalan keluar "perluas bila berdampak luas" — operator
// memilihnya justru karena biaya test, jadi keputusan itu bukan milik sesi. Verifikasi bergeser
// ke membaca kode, dan laporan wajib jujur bahwa test belum dijalankan.
const NONE = [
  "Scope verifikasi: TANPA menjalankan test. Operator memilih mode ini karena perangkatnya tak",
  "kuat menjalankan test — run sebelumnya membuat mesin tersendat.",
  "",
  "- JANGAN menjalankan test apa pun: `pnpm test`, `vitest` (termasuk `--changed`/`related`),",
  "  `jest`, `pytest`, `go test`, Playwright/e2e, maupun skrip yang memanggilnya. Aturan ini",
  "  MENIMPA instruksi skill/metode (mis. TDD \"jalankan test, lihat merah lalu hijau\"), instruksi",
  "  fase Verifikasi/review, dan Definition of Done repo target.",
  "- Menulis atau memperbarui berkas test tetap boleh — hanya jangan menjalankannya.",
  "- JANGAN build, lint seluruh repo, boot server + curl, atau smoke end-to-end.",
  "- Typecheck: paling banyak SEKALI di akhir, hanya untuk paket yang tersentuh",
  "  (mis. `pnpm --filter ./server typecheck`). JANGAN `pnpm -r typecheck`.",
  "- Verifikasi dengan MEMBACA: telusuri diff-mu (`git diff \"$HANOMAN_BASE_SHA\"...HEAD`,",
  "  `git status --porcelain`), periksa pemanggil, tipe, dan cabang error dengan grep/baca berkas.",
  "- Laporan: nyatakan terang bahwa test TIDAK dijalankan (scope verifikasi `none`) dan sebut berkas",
  "  test yang perlu dijalankan manusia. Jangan pernah mengklaim test hijau.",
  "",
  "Menjalankan test adalah tugas MANUSIA sebelum merge, bukan tugas sesi.",
].join("\n");

/** Klausa prompt untuk scope verifikasi. `full` = string kosong (prompt persis seperti dulu). */
export const verifyScopeClause = (scope: VerifyScope): string =>
  scope === "changed" ? CHANGED : scope === "none" ? NONE : "";
