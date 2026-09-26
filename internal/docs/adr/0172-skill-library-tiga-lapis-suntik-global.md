# ADR-0172 — Skill library tiga lapis + penyuntikan skill global hanoman per sesi

- Status: Accepted
- Tanggal: 2026-09-26
- SPEC: — ([desain](../../../docs/superpowers/specs/2026-09-26-skills-library-design.md),
  [plan](../../../docs/superpowers/plans/2026-09-26-skills-library.md))
- Mengamandemen: [0114](0114-status-pemasangan-skill-metode.md) (status pemasangan skill metode)
- Terkait: [0094](0094-custom-agent-katalog-materialisasi-native.md) (pola global/project untuk
  custom agent), [0099](0099-mcp-server-hanoman.md) (server MCP, capability per tool)

## Konteks

Sebelum ini skill hanya terlihat sebagai **prasyarat metode** (ADR-0114): `scanAgentSkills`
mencocokkan id skill terpasang dengan `methodSkills()` dan Settings menampilkan centang. Operator
tak bisa melihat skill apa yang dipakai sebuah project, tak bisa membuka isinya, tak bisa
menyuntingnya, dan tak punya tempat untuk skill yang dipakai **bersama** oleh sesi di semua project.
Skill project (`<repo>/.claude/skills`, `.agents/skills`, `.codex/skills`, folder lain berisi
`SKILL.md`) tidak dipindai sama sekali.

## Keputusan

1. **Tanpa tabel.** Skill tetap folder di disk; tak ada model Prisma/migration. Pemindaian saat
   request (`runner/src/skill-library.ts`), tanpa cache dan tanpa watcher — cache akan basi
   terhadap suntingan di luar hanoman, dan pemindaian direktori murah.
2. **Empat lapis, satu bentuk `SkillEntry`** (`shared/src/skills.ts`):
   `hanoman` (`$HANOMAN_HOME/skills`), `user` (`~/.claude|~/.codex|~/.agents/skills`, hormati
   `HANOMAN_*_HOME`), `plugin` (cache plugin claude/codex, **baca-saja**, bisa di-fork), dan
   `project` (setiap direktori berisi `SKILL.md` di checkout utama, kedalaman ≤ 6, mengecualikan
   `node_modules`/`.git`/`.worktrees`/`dist`/`build`/`.next`/`coverage`). Sumber project dipetakan
   ke runtime pemuatnya: `.claude/skills` → claude; `.agents/skills` & `.codex/skills` → codex;
   selain itu `lainnya:<rel>` → tidak dimuat otomatis (ditampilkan apa adanya).
3. **Key** `layer~projectId|-~source~name` — `~` tak pernah muncul di nama skill maupun id
   project, sementara source boleh memuat `:`/`/`. Server me-resolve key dengan memindai ulang,
   bukan dengan menerima path dari klien.
4. **Keamanan path**: setiap operasi berkas lewat `safeJoin` (realpath) di dalam direktori skill;
   `..`, path absolut, dan symlink yang keluar → 400. Tulis memakai `baseHash` (sha256) → 409 bila
   berkas berubah sejak dibaca.
5. **Capability `skills:read` / `skills:write`**, dipetakan MENURUT METHOD (kelas bug SPEC-405):
   menyunting skill global hanoman mengubah instruksi setiap sesi berikutnya di semua project.
   Tool MCP `hanoman_skill_delete` bermode `danger` (daftar `DESTRUCTIVE_BUT_WRITE`).
6. **Penyuntikan skill global hanoman** (`server/src/services/skill-inject.ts`, dipanggil
   `createSession` untuk sesi agen, bukan `opts.command`):
   - Skill project bernama sama **menang** — skill global itu tak disuntik dan UI menandainya
     `shadowedBy`.
   - **claude**: `--add-dir <agentTempDir>/skills-root` berisi `.claude/skills/<n>` → symlink.
     Docs Claude Code: skill di `.claude/skills/` direktori `--add-dir` dimuat, dengan live
     reload. Worktree tak disentuh. `--add-dir` variadik, jadi ia argumen **terakhir** argv.
   - **codex**: tak ada akar skill tambahan resmi, maka symlink `<cwd>/.agents/skills/<n>` + baris
     `/.agents/skills/<n>` di blok `# hanoman:skill-inject` pada `<git-common-dir>/info/exclude`.
   - Fail-open: gagal → peringatan stderr sesi; sesi tetap lahir.

## Konsekuensi

- `info/exclude` tinggal di **common dir** git — dipakai bersama semua worktree dan checkout
  utama — jadi baris exclude codex ikut berlaku di checkout utama. Mitigasi: pemindai project
  mengabaikan symlink yang menunjuk ke `$HANOMAN_HOME/skills`, dan membuat/fork skill project
  bernama sama mencabut baris itu (`unexcludeInjected`).
- Skill global hanoman **tidak** aktif saat `claude`/`codex` dijalankan di luar hanoman —
  keputusan sadar; menyalinnya ke `~/.claude/skills` akan menyentuh config user dan rawan bentrok
  nama.
- Suntingan dari luar hanoman terlihat saat panel dibuka ulang (refetch), bukan real-time.
- Skill project ditulis ke checkout utama → tampil sebagai perubahan uncommitted di IDE hanoman.
- ADR-0114 tetap memegang pencocokan prasyarat metode; `skillsUnder` kini diekspor dan dipakai
  ulang, tanpa perubahan perilaku.
