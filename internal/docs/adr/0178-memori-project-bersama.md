# 0178 — Memori project bersama lintas runtime: entity SQLite, project ditentukan proses, lattice status

Tanggal: 2026-10-07 · Status: diterima · Spec: [desain](../../../docs/superpowers/specs/2026-10-07-shared-project-memory-design.md) · Riset: [shared agent memory](../research/research-shared-agent-memory.md)

## Konteks

Memori bawaan tiap runtime (Claude Code auto memory, Codex memories, Gemini) terpisah per runtime dan
per mesin. Operator ingin satu memori per project yang dipakai semua agen — sesi hanoman, agen luar
via MCP, lintas mesin/tim — dan **akurat** serta **tepat ke project-nya**.

## Keputusan

1. **Sumber kebenaran = SQLite hanoman** (`ProjectMemory`, `MemoryEvent` append-only,
   `MemoryLocalState` LOCAL-only). Markdown/vault hanya proyeksi di masa depan. Tanpa vector store
   atau graph DB (ADR-0086: satu berkas SQLite).
2. **Satu fakta per baris, immutable kecuali `status`.** Koreksi = baris baru ber-`supersedesId`;
   yang lama `invalidated` saat penggantinya `active`. Tak ada penghapusan diam-diam.
3. **Lattice status** `proposed < active < invalidated = rejected`; transisi hanya naik. Inilah yang
   kelak membuat merge sync deterministik tanpa modal `SyncConflict`.
4. **Project ditentukan proses, tak pernah model.** Cookie → `projectId` eksplisit dari UI. Agent
   token → header `x-hanoman-repo` (remote + root commit + HEAD) yang dihitung CLI MCP dari cwd,
   dicocokkan ke `Project.gitRemote` ternormalisasi, dibatasi allowlist `AgentToken.projectIds`.
   Agent token yang mengirim `projectId` ditolak 400; token tanpa allowlist ditolak 403.
5. **Auto-aktif bersyarat**: `kind ≠ decision` ∧ jangkar ≥ 1 ∧ jangkar diverifikasi server
   (`git rev-parse <head>:<path>` di checkout project) ∧ sumber tepercaya. Selain itu antrean review
   manusia; `activate`/`reject` cookie-only.
6. Capability baru `memory:read` / `memory:write` (domain `memory`).

## Penyimpangan dari spec di tahap 1

FTS5 ditunda (filter token di JS atas ≤ 500 baris per project; FTS5 berisiko drift migrate diff);
`sourceDeviceId` nullable sampai tahap sync; kolom `reviewReason`; runtime `human`; `trusted=true`
untuk semua sumber tahap 1 (sumber tak tepercaya lahir bersama suntik sesi di tahap 2).

## Konsekuensi

- Memori hanya seakurat jangkarnya; memori tanpa jangkar selalu lewat manusia.
- Device tanpa checkout project tak bisa memverifikasi jangkar → usulan dari sana tak auto-aktif.
- `TelegramMemory` tetap terpisah (scope `chatId`, ADR-0096).

> **Tahap sync:** [ADR-0180](0180-sync-memori-entitas-opsional.md) — entitas opsional, merge lattice di hub & client, hapus permanen.
