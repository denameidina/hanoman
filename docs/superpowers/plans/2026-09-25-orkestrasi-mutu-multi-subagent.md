# Orkestrasi mutu: multi-subagent dalam fase, reviewer independen, gerbang beban

- Tanggal: 2026-09-25
- Branch: `feat/orkestrasi-mutu` (worktree `.worktrees/orkestrasi-mutu`)
- Sumber: audit 5-subagent 2026-09-25 (input · proses · output · performa · desain multi-subagent)
- ADR: [0170](../../../internal/docs/adr/0170-orkestrasi-mutu-subagent-foreground-reviewer-beban.md),
  [0171](../../../internal/docs/adr/0171-indeks-spec-project-notification-created.md)

## Tujuan

Sesi orchestrator bisa memecah pekerjaan di dalam fase ke beberapa subagent (model/effort sesuai
peran), hasil Execute diperiksa reviewer independen sebelum fase ditutup, dan mesin 8 GB tak
tercekik oleh sesi/subagent yang lolos gerbang.

## Temuan pemicu (ringkas)

1. Subagent LATAR tak punya tool `Agent` (docs resmi). Agen fase berjalan di latar (ADR-0164 T1) →
   izin "custom agent lain boleh dipanggil" tak bisa dipenuhi; fase juga bisa terpotong.
2. Execute memaksa `executing-plans`, padahal skill itu menyuruh `subagent-driven-development`.
3. "done" = klaim agen; tak ada reviewer independen (7/200 sesi); auto-merge tanpa verifikasi.
4. Gerbang admission: terminal-agen operator `exempt`, tanpa sinyal memori, resume boot bypass cap.
5. Gerbang plan lolos bila nama berkas plan tanpa spec-id.
6. `Spec.projectId` & `Notification.createdAt` full-scan.

## Paket kerja

### P0 · Ukur (tanpa kode produk)
- [ ] Hook PreToolUse(`Agent`) `updatedInput.run_in_background=false` ± `CLAUDE_CODE_FORK_SUBAGENT=0`:
      foreground? nested jalan? anak paralel tumpang tindih? Bash latar tetap hidup?

### P1 · Subagent foreground + batas (runner/server, claude)
- [ ] `guardSettings`: PreToolUse matcher `Agent` memaksa `run_in_background:false` (bentuk dari P0).
- [ ] Env sesi claude: varian terbukti P0 + `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3`.
- [ ] Test unit hook + env; golden prompt tak berubah.

### P2 · Delegasi & reviewer (runner prompt)
- [ ] Execute di mode orchestrator memakai `subagent-driven-development`.
- [ ] Klausa delegasi per fase di instruksi agen fase (roster-aware, model per peran, batas paralel).
- [ ] Reviewer independen `hanoman-reviewer` (claude opus·high / codex sol·high, read-only) dipanggil
      orchestrator sesudah laporan Execute `selesai`, sebelum menulis `Execute done`; `rework` → kembali
      ke agen Execute yang sama (maks 2 putaran), lalu `Keputusan terbuka`.
- [ ] Kontrak nama plan `<YYYY-MM-DD>-<spec-id>-<slug>.md`; path persis diteruskan ke Execute.
- [ ] Laporan Execute memuat tabel AC → bukti.
- [ ] Orchestrator hanya meneruskan `INDEX.md` lampiran (tak membaca semua lampiran).
- [ ] Fase Verifikasi ikut klausa scope verifikasi.
- [ ] Klausa metode `matt` diselaraskan dengan ADR-0167.

### P3 · Gerbang beban (server)
- [ ] Terminal-agen operator tak lagi `exempt`; hanya shell mentah/console VPS.
- [ ] Sinyal memori tersedia (`kern.memorystatus_level` darwin, `MemAvailable` linux) di `launchStatus`.
- [ ] Auto-resume boot tunduk cap (bertahap), mengamandemen ADR-0169.

### P4 · Server kecil
- [ ] `@@index` `Spec.projectId`, `Notification.createdAt` + migration (ADR-0171).
- [ ] `planComplete`: fase Plan tercatat `done` tetapi tak ada berkas plan ber-spec-id → bukan selesai.

### P5 · Docs & verifikasi
- [ ] ADR-0170, ADR-0171, amandemen 0164/0169, index `internal/docs/README.md`.
- [ ] Test tersentuh hijau (resep isolasi DB + env), typecheck paket tersentuh.

## Ditunda (keputusan terpisah)
- Kolom `parentInvocationId`/`depth` di `AgentInvocation` (butuh bukti tautan dari P0).
- Gerbang bukti mesin (`.evidence/*.json`) untuk auto-merge; `SessionResult` di semua jalur `done`.
- Retensi `Notification`.
