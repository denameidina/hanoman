# Skills Library — desain

Tanggal: 2026-09-26 · Status: desain disetujui (brainstorming), menunggu plan.

## Tujuan

hanoman bisa **melihat, menelusuri struktur, dan menyunting** skill dari semua sumber yang ada —
bukan hanya skill yang lahir dari hanoman — serta punya **skill global hanoman** yang dipakai
bersama oleh sesi agen di semua project.

- Satu halaman `/skills`: section **Global** + satu section **per project**.
- Halaman project punya pintu "Skills" yang menampilkan skill project + skill global warisan.
- Tiap skill dapat dibuka: pohon berkasnya (`SKILL.md`, `references/`, `scripts/`, `assets/`…),
  frontmatter, isi berkas, dan disunting (kecuali plugin).

## Non-tujuan

- Tak ada tabel Prisma / migration: skill tetap folder di disk.
- Tak ada file watcher / grup siar WS baru — refetch sesudah mutasi dan saat panel dibuka.
- Tak ada instalasi skill dari registry (`npx skills add` tetap di terminal).
- Skill global hanoman **tidak** aktif di luar sesi yang dibuka hanoman (keputusan sadar;
  pendekatan "salin ke `~/.claude`" ditolak karena menyentuh config user dan rawan tabrakan).

## 1. Sumber skill & model data

Modul baru `runner/src/skill-library.ts` (node-only, sejajar `runner/src/skills.ts` ADR-0114;
memakai ulang `agentSkillHome` / `agentsSkillHome` / pemindai plugin yang sudah ada).

| Lapis | Akar | Sunting | Masuk ke sesi |
|---|---|---|---|
| `hanoman` | `$HANOMAN_HOME/skills/<nama>/` | ✓ | disuntik hanoman (symlink, §2) |
| `user` | `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills` (hormati `HANOMAN_*_HOME`) | ✓ | dimuat runtime sendiri |
| `plugin` | cache plugin claude/codex (sumber sama dgn `scanAgentSkills`) | ✗ baca-saja, bisa fork | dimuat runtime sendiri |
| `project` | tiap direktori berisi `SKILL.md` di checkout utama project | ✓ | lihat `loadedBy` |

Pemindaian project: telusuri repo mencari `SKILL.md`, **kecualikan** `node_modules`, `.git`,
`.worktrees`, `dist`, `build`, `.next`, `coverage`; kedalaman maksimum 6; direktori skill tidak
ditelusuri lebih dalam lagi sesudah `SKILL.md` ditemukan. Sumber project dikenali:

| Path relatif | `source` | `loadedBy` |
|---|---|---|
| `.claude/skills/<n>` | `.claude` | `["claude"]` |
| `.agents/skills/<n>` | `.agents` | `["codex"]` |
| `.codex/skills/<n>` | `.codex` | `["codex"]` |
| lainnya (mis. `internal/skills/hanoman`) | `lainnya:<path>` | `[]` — ditampilkan "tidak dimuat otomatis" |

Lapis user: `~/.claude/skills` → `["claude"]`; `~/.codex/skills` dan `~/.agents/skills` → `["codex"]`.
Lapis hanoman → `["claude","codex"]` (lewat penyuntikan).

```ts
interface SkillEntry {
  key: string;              // "<layer>:<source>:<name>" (+ projectId utk project), URL-safe, stabil
  name: string;             // frontmatter name, fallback nama direktori
  description: string | null;
  layer: "hanoman" | "user" | "plugin" | "project";
  source: string;           // ".claude" | ".agents" | ".codex" | "plugin:<pkg>" | "lainnya:<rel>" | "hanoman"
  projectId: string | null;
  dir: string;              // path absolut
  loadedBy: ("claude" | "codex")[];
  editable: boolean;        // false hanya utk plugin
  shadowedBy?: string;      // key skill project bernama sama yang menimpa skill global hanoman
  frontmatterError?: string;
}
```

**Tabrakan nama:** skill project menang atas global hanoman. Skill global hanoman tidak
disuntik ke worktree project yang sudah punya skill bernama sama; UI menandai "tertimpa di
project X".

**Fail-open per akar:** direktori hilang / izin ditolak / YAML rusak → akar itu menyumbang nol
skill atau entri dengan `frontmatterError`; tak pernah menggagalkan akar lain. Project dengan
repo hilang → section-nya membawa `error`, bukan 500.

**Keamanan path:** setiap `path` berkas di-resolve di dalam `dir` skill (realpath); `..`,
path absolut, dan symlink yang keluar dari `dir` → 400. Pola sama dengan route IDE.

## 2. API server & penyuntikan sesi

`server/src/routes/skills.ts`, capability baru `skills:read` / `skills:write` (ADR-0099).

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/skills?scope=all` | `{ global: SkillEntry[], projects: [{ projectId, name, skills, error? }] }` — halaman `/skills` |
| GET | `/api/skills?projectId=` | global + project itu, dengan `shadowedBy` |
| GET | `/api/skills/:key/tree` | pohon berkas (file + dir, ukuran) |
| GET | `/api/skills/:key/file?path=` | isi + `hash`; biner / >1 MB → metadata saja |
| PUT | `/api/skills/:key/file?path=` | tulis dengan `baseHash` → 409 bila berubah; 403 bila `!editable` |
| POST | `/api/skills/:key/entry` | buat berkas/folder di dalam skill |
| DELETE | `/api/skills/:key/entry?path=` | hapus berkas/folder (bukan `SKILL.md`) |
| POST | `/api/skills` | buat skill: `{ layer: hanoman\|user\|project, source?, projectId?, name, description }` → kerangka `SKILL.md` |
| POST | `/api/skills/:key/fork` | salin skill mana pun (termasuk plugin) ke `hanoman` atau ke project |
| DELETE | `/api/skills/:key` | hapus skill (403 utk plugin) |

Nama skill: `^[a-z0-9][a-z0-9-]{0,63}$`; nama terpakai di tujuan → 409.
Skill project ditulis ke **checkout utama** project → tampil sebagai perubahan uncommitted di IDE
hanoman; commit dilakukan manusia/agen seperti biasa.

**Penyuntikan** (`server/src/services/skill-inject.ts`, dipanggil `pty.ts` untuk sesi agen, bukan
`opts.command`). Catatan: `.git/info/exclude` tinggal di *common dir* git — dipakai bersama semua
worktree DAN checkout utama — jadi ia bukan alat isolasi per worktree.

1. Hitung nama skill project di `cwd` sesi (pemindai §1). Skill `hanoman` bernama sama dilewati.
2. **claude** — buat `<agentTempDir>/skills-root/.claude/skills/<nama>` → symlink ke
   `$HANOMAN_HOME/skills/<nama>`, lalu tambah `--add-dir <agentTempDir>/skills-root` ke argv.
   Terverifikasi di docs Claude Code: skill `.claude/skills/` di direktori `--add-dir` dimuat,
   dengan live reload. Worktree tak disentuh sama sekali.
3. **codex** — tak ada akar skill tambahan resmi; symlink `<cwd>/.agents/skills/<nama>` (bila entri
   belum ada) + baris `/.agents/skills/<nama>` di blok bertanda `# hanoman:skill-inject` pada
   `<git-common-dir>/info/exclude` (idempoten). Pemindai project **mengabaikan symlink yang menunjuk
   ke `$HANOMAN_HOME/skills`**; membuat/fork skill project bernama sama mencabut baris exclude itu.
4. Fail-open: gagal → peringatan stderr sesi, sesi tetap jalan.

**MCP** (`shared/src/mcp-catalog/`): `hanoman_skills_list`, `hanoman_skill_read`,
`hanoman_skill_write`.

## 3. UI

Komponen `SkillsWorkspace` (pola `CustomAgentsPanel`: satu komponen, dua permukaan).

- **`/skills`** (item nav baru): satu halaman — section **Global** (sub-grup Hanoman / User /
  Plugin) + **satu section per project** berisi skill project-nya. Section project yang repo-nya
  hilang menampilkan "repo tidak ditemukan".
- **Halaman project**: `Door` "Skills" → `/project/:id/skills`, workspace yang sama dengan
  `projectId`: skill project + global warisan, global yang tertimpa ber-badge "tertimpa oleh project".

Tata letak tiga kolom (sempit → `ResponsivePanels` seperti IDE):

```
┌ Daftar skill ─────────┬ Struktur ──────────┬ Editor ─────────────────────┐
│ [cari…] [filter]      │ my-skill/          │ SKILL.md    [Pratinjau|Edit]│
│ ▸ Global              │  ├ SKILL.md        │ ┌ name / description      ┐ │
│   Hanoman (3)         │  ├ references/     │ └─────────────────────────┘ │
│   User (12)           │  │  └ api.md       │ (MarkdownView / textarea)   │
│   Plugin (40) 🔒      │  └ scripts/run.sh  │                             │
│ ▸ Project: hanoman (4)│ [+ berkas][+ folder]│ [Simpan] ⚠ belum disimpan  │
│ ▸ Project: crm (2)    │                    │                             │
└───────────────────────┴────────────────────┴─────────────────────────────┘
```

- Chip sumber (`.claude`/`.agents`/`.codex`/`plugin:x`/`lainnya`) + chip runtime pemuat
  (claude / codex / "tidak dimuat"); ⚠ untuk frontmatter rusak.
- Pohon berkas: pakai ulang `src/src/screens/file-tree.tsx`.
- Editor: kartu frontmatter; *Pratinjau* `MarkdownView`, *Edit* textarea seperti IDE (tanpa
  library editor baru). Plugin: baca-saja + tombol "Fork ke global hanoman / ke project".
- "+ Skill baru" (pilih lapis & sumber), hapus dengan konfirmasi, 409 → "berkas berubah di
  tempat lain — muat ulang / timpa".
- Design system editorial (`internal/docs/design-system/**`), komponen `ds`.

## 4. Error & testing

- 404 skill/berkas tak ada · 403 tak dapat disunting · 400 traversal/nama tak valid ·
  409 konflik hash / nama terpakai.
- Test `skill-library`: tiga lapis di tmpdir, pengecualian direktori, sumber `.claude`/`.agents`/
  `.codex`/lainnya, `shadowedBy`, frontmatter rusak, traversal & symlink keluar ditolak.
- Test route: list scope=all / projectId, CRUD berkas, 403 plugin, 409 hash, fork.
- Test penyuntikan: claude → add-dir berisi symlink; codex → symlink + exclude idempoten; skill
  tertimpa dilewati; fail-open.
- Test komponen: pengelompokan global/project, editor, mode baca-saja plugin.
- Akhir: boot server lokal, curl endpoint.

## 5. Docs

SPEC baru + ADR baru "Skill library tiga lapis + penyuntikan skill global per sesi"
(amandemen ADR-0114), perbarui `internal/docs/architecture/stack.md`,
`internal/skills/hanoman/SKILL.md`, dan tautkan di `internal/docs/README.md` — dalam commit
implementasi yang sama.
