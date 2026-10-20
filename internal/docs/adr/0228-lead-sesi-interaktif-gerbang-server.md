# ADR-0228 — hanoman-lead sebagai sesi interaktif per proyek, dibatasi gerbang server

Tanggal: 2026-10-20 · Status: diterima · tanpa nomor SPEC (dikerjakan langsung atas permintaan operator)

**Menggantikan** bagian "otak sekali-panggil" dari [ADR-0091](0091-hanoman-lead-agen-pemimpin.md),
[ADR-0146](0146-lead-dipicu-event-hook.md), dan [ADR-0223](0223-lead-menjawab-seluruh-rantai-tanya.md):
`claude -p`/`codex exec` per keputusan dicabut. **Mengamandemen** [ADR-0167](0167-keputusan-ambigu-lead-atau-manusia.md):
pertanyaan yang tak terjawab sesi lead dalam tenggat jatuh ke manusia. **Memakai**
[ADR-0161](0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md)/[0170](0170-orkestrasi-mutu-subagent-foreground-reviewer-beban.md)
(gerbang host) dan [ADR-0146](0146-lead-dipicu-event-hook.md) (token HMAC per sesi). **Mematuhi**
[ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (tanpa timer/queue baru) dan [ADR-0192](0192-gerbang-agen-tak-memutuskan-sesinya-sendiri.md).

Desain: `docs/superpowers/specs/2026-10-20-lead-sesi-interaktif-design.md` · Plan:
`docs/superpowers/plans/2026-10-20-lead-sesi-interaktif.md`.

## Konteks

Operator: "lead hanoman ga powerfull, bahkan dia memberikan lead tanpa cek terlebih dahulu dan manage
resource. serta ambil backlog seenaknya, setelah selesai pun tidak mengambil decision untuk merge ke
branch. lalu tidak ada lead hanoman sesi nya sehingga human tidak bisa control."

| Keluhan | Akar di kode | Bukti 2026-10-20 |
|---|---|---|
| Memutuskan tanpa cek | Lead = satu proses `codex exec`/`claude -p` per keputusan (`lead/brain.ts`). "Kumpulkan bukti" hanya kalimat prompt; dilarang menjawab "tidak tahu". Server hanya memverifikasi syarat integrasi & keberadaan berkas rujukan. | Lead memilih sendiri "bootstrap director sementara" di staging (SPEC-1450). |
| Tak mengelola resource | Nol pembacaan kuota engine maupun beban host di jalur lead; `maxConcurrent: 2` hanya membatasi proses brain. | 06:56 lead mengurutkan 7 backlog crm → 7 diluncurkan dalam 30 dtk → 7/7 gagal "berakhir sebelum done (gagal/limit)". |
| Ambil backlog seenaknya | `orderReadyWork` mengantrekan SEMUA yang tak terblokir; LLM hanya menulis urutan. | Idem. |
| Tak memutuskan merge | `integrate-main` hanya ditawarkan pada plan-bersih + pane hidup; tanpa izin manusia; syarat hijau bisa dimatikan; target `main` terpatok. | — |
| Tak ada sesi lead | Lead tanpa pane; state antrean in-memory. | — |

## Keputusan

1. **Satu sesi tmux per proyek**: `lead-<proyek>`, `SessionKind` `lead`, `launchClass: "terminal"`
   (tak memakan slot backlog), worktree baca `<repo>/.worktrees/lead-<proyek>` di HEAD branch target,
   dibuat ulang tiap kelahiran. Manusia bisa attach & mengetik seperti sesi pekerja.
2. **Seam otak = `DecideDeps.think`.** `decide()` tetap choke point tunggal ketiga pintu; `think`
   diganti `thinkViaSession` yang menulis prompt (`leadPrompt`, tak berubah) ke **`LeadEvent`** dan
   menunggu jawaban berbentuk `zLeadVerdict`. Rantai dialog, jejak, notifikasi, dan `applyAction`
   dipakai apa adanya. `runGated`, `LeadBusyError`, knob `maxConcurrent`/`queueWaitSec`/`timeoutSec`
   dicabut.
3. **Dua jenis event.** Pintu `detected`/`contract` menunggu (peminta memang menunggu jawabannya).
   Pintu `pulse` (sesi selesai/gagal, tabrakan, ambil backlog, integrasi gagal) **tanpa penunggu**:
   pembuka langsung kembali, eksekusi terjadi saat `act` lolos atau izin disetujui — tick lead tak
   pernah menunggu pane, dan izin merge boleh menunggu manusia berjam-jam.
4. **Pane bertindak lewat HTTP ber-token sesi**, bukan MCP operator: `GET /api/lead-pane/brief`
   (jatah, kuota, sesi hidup, backlog siap, inbox) dan `POST /api/lead-pane/act`, diautentikasi HMAC
   (`HANOMAN_SESSION_ID` + `HANOMAN_EVENT_TOKEN`) persis seperti `/api/session-events`. Peta
   capability: `COOKIE_ONLY` — meniru "pane lead proyek X" adalah peniruan identitas, bukan izin.
5. **Kurir** menyuntik BATCH event ke pane hanya saat pane diam (hook Stop) dan manusia tak mengetik
   dalam 120 dtk. Prioritas kelas: pertanyaan pekerja → sesi selesai/gagal → manusia/penolakan →
   denyut. Pertanyaan pekerja punya tenggat `answerSlaSec` (default 300) → lewat = `late`, jatuh ke
   manusia (ADR-0167). Pane dirotasi setelah `rotateAfterEvents` event saat diam dan inbox kosong;
   event yang dua kali dikembalikan sapuan → rotasi.
6. **Gerbang deterministik (`lead/guard.ts`)** untuk setiap `act`: event masih terbuka → allowlist →
   aturan objektif per tindakan → mode wewenang. `start-session`: spec belum selesai, disetujui
   diluncurkan, ber-objective, tanpa blocker, tanpa sesi hidup, alasan + bukti yang merujuk id spec,
   dan **jatah ≥ 1**. `answer-session`: sesi masih menunggu; teks yang menyentuh daftar sensitif
   (produksi, kredensial, akun, director, deploy, hapus data, …) **selalu minta izin**.
7. **Jatah peluncuran (`lead/budget.ts`)** = min(slot scheduler, gerbang host, kuota engine <
   `quotaStopPct` 85 %, ramp `rampStep` 1 per `rampProbeMin` 10 menit); data kuota tak terbaca = 0;
   `failStreak` 2 kegagalan sesi lead beruntun → 0 + proyek di-pause + notifikasi. Denyut hanya
   dikirim bila jatah ≥ 1 dan meminta paling banyak *jatah* pilihan.
8. **Wewenang per tindakan per proyek** (`auto`/`ask`/`off`; default merge = `ask`) dan **antrean izin
   `LeadApproval`**: verdict lead ditahan apa adanya, kartu di LeadScreen + Telegram
   (`tgla:<id>:approve|deny`), capability baru **`lead:approve`** (danger, tak diimplikasikan
   `lead:write`). Kedaluwarsa (`approvalTtlMin` 1440) = ditolak; penolakan kembali ke lead sebagai
   event `rejected`.
9. **Integrasi diperketat**: plan tanpa `- [ ]`, worktree bersih, **`verifyCommand` dijalankan
   server** dan harus hijau, satu integrasi per proyek, target `targetBranch` per proyek (bukan `main`
   terpatok). `verifyCommand` kosong ⇒ selalu minta izin. `requireGreenBeforeIntegrate` tak lagi bisa
   melonggarkan jalur lead. Sesi selesai/gagal selalu menjadi keputusan (integrasi, lanjutkan,
   hentikan, biarkan); integrasi yang gagal menjadi event `integrate-failed`.
10. **Setelan per proyek** di `Setting.lead.projects[<id>]` (Json, tanpa migration): `authority`,
    `targetBranch`, `verifyCommand`, `quotaStopPct`, `rampStep`, `rampProbeMin`, `failStreak`,
    `answerSlaSec`. Knob global baru: `deliverTimeoutSec`, `approvalTtlMin`, `rotateAfterEvents`.

Skema: `LeadEvent`, `LeadApproval` (LOCAL-ONLY, tanpa FK), `LeadDecision.eventId` — migration
`20261020120000_lead_session_inbox`.

## Konsekuensi

- Lead kini memakan satu pane agen hidup per proyek opt-in. Ia tak dihitung slot backlog, tapi tetap
  memakai kuota engine-nya; rotasi membatasi pertumbuhan konteks.
- Keputusan lebih lambat dari satu `claude -p` paralel, tetapi konsisten: satu otak per proyek
  melihat pertanyaan yang berbenturan dalam satu batch. Bila tenggat sering terlewat, jalan keluar
  yang dicatat: pane lead-pembantu kedua (belum dibuat).
- Restart server memutus penunggu in-process; event `ask` yang tersisa lewat tenggat dan jatuh ke
  manusia, event denyut tetap di inbox dan dieksekusi saat dijawab.
- Tak ada rebase otomatis oleh lead; perbaikan konflik tetap lewat sesi pekerja yang dilanjutkan.
