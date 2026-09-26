# Mode Execute: inline | subagent — desain

Tanggal: 2026-09-26 · Status: disetujui operator · Mengamandemen ADR-0170 P2.

## Masalah

Sejak ADR-0170 P2, fase Execute sesi claude ber-orkestrasi memakai
`superpowers:subagent-driven-development`: minimal dua subagent BERURUTAN per task (implementer +
reviewer, plus perbaikan & review ulang), masing-masing membangun konteks dan menjalankan test dari
nol, semuanya foreground (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`), ditambah review akhir DUA kali
(final review milik skill + `hanoman-fase-review`). Operator melaporkan Execute "lama banget".

## Keputusan

- Field baru `executeMode: "inline" | "subagent"` per flow di `Setting.orchestration.<flow>`
  (JSON, tanpa migration), **default `inline`** — termasuk setting lama tanpa field (default zod).
- Berlaku untuk flow ber-fase Execute/Goal (`feature`, `qa`, `goal`) dan **hanya sesi claude
  ber-orkestrasi**; codex & sesi tunggal tetap `executing-plans` seperti sebelumnya.

| | inline (default) | subagent |
|---|---|---|
| Skill Execute | `executing-plans` + TDD + verifikasi | `subagent-driven-development` + TDD + verifikasi |
| Klausa delegasi Execute/Goal | kerjakan task plan SENDIRI berurutan; subagent hanya pencarian read-only paralel | satu implementer per task, review per task (seperti ADR-0170) |
| Review akhir | `hanoman-fase-review` | `hanoman-fase-review` saja — final review skill dilewati |

- Jalur data: `resolvePhasePlan` → `PhasePlan.executeMode` → `phaseSkillsFor` & instruksi agen fase;
  AgentDef fase membawa `executeMode` → `withPhaseDelegation` (pty.ts) memilih klausa.
- UI: Settings → Orkestrasi, per flow yang relevan, pilihan "Execute: Inline | Subagent per task"
  bertanda khusus Claude.

## Konsekuensi

- Semua flow pindah ke inline saat update — disengaja (permintaan operator); subagent tetap bisa
  dinyalakan per flow.
- Inline kehilangan review per task & konteks segar per task; gerbang mutu tersisa = TDD,
  gerbang verifikasi, dan `hanoman-fase-review` (maks 2 putaran rework).
