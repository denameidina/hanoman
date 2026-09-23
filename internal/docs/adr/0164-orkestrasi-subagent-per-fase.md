# ADR-0164 — Orkestrasi subagent per fase: model & effort lewat definisi subagent

- Status: Accepted · **diamandemen [0167](0167-keputusan-ambigu-lead-atau-manusia.md)** (2026-09-19):
  `Pertanyaan untuk manusia:` (satu pertanyaan) diganti `Keputusan terbuka:` (wajib, tanpa batas) +
  status `menunggu-keputusan`; relay langkah 4 tak lagi "putuskan sendiri" di sesi tanpa pengawas.
- Tanggal: 2026-09-14
- Spec: [rancangan orkestrasi subagent per fase](../../../docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md)
- Terkait: **mengamandemen** [0061](0061-model-effort-per-sesi-picker-start.md) — model/effort sesi kini
  model/effort **orchestrator**; **tidak menghidupkan kembali** [0058](0058-model-effort-per-fase.md) —
  tak ada `/model` yang diketik agen; **memperluas** [0094](0094-custom-agent-katalog-materialisasi-native.md)
  & [0159](0159-custom-agent-native-terukur-terisolasi.md) — renderer, hook, roster, dan `AgentInvocation`
  dipakai untuk agen fase; **menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) &
  [0015](0015-one-session-per-backlog.md) — tetap satu sesi tmux per backlog; **mengubah pelaksana**
  [0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md) & [0040](0040-jalur-cepat-qa-dielicit-prompt.md) — batas fase
  ditembus orchestrator, keputusan jalur cepat qa jadi rekomendasi agen Audit.

## Konteks

Operator ingin setiap fase flow (mis. brief: Brainstorm → Objective → Spec → Plan → Execute) dikerjakan
model & effort yang berbeda, disetel dari Settings, dengan sesi utama sebagai orchestrator. ADR-0058
pernah mencobanya lewat agen yang mengetik `/model`+`/effort` di batas fase dan dicabut ADR-0061:
peralihannya bergantung kepatuhan agen, server tak bisa menegakkannya, `/effort` diabaikan di Opus.

Kedua runtime kini punya subagent native ber-model/effort per definisi. Diukur 2026-09-14 (claude
2.1.270, codex 0.154.0), dengan parent SENGAJA berbeda dari anak:

| # | Yang diukur | Hasil |
|---|---|---|
| P1 | claude `--agents` tanpa kunci `tools` | Subagent mendapat seluruh tool sesi dan memanggil skill `superpowers:verification-before-completion`. |
| P2 | claude parent Haiku/low, agen Sonnet/medium | stdin `subagentStatusLine`: `model: claude-sonnet-5`, `effort: medium`; `SubagentStop.effort.level = medium`. |
| P3 | claude `SendMessage` ke agent ID | Subagent yang sama dilanjutkan dengan konteks utuh; `SubagentStart` menembak ulang dengan `agent_id` SAMA. |
| P4 | stdin `subagentStatusLine` | `tasks[]` = `id, type:"local_agent", label/description, startTime (ms), model, effort?, tokenCount` — **tanpa nama agen**. |
| P5 | codex parent Sol/medium, role Luna/low via `config_file` | Rollout anak `gpt-5.6-luna` + `reasoning_effort: low`; rollout parent nol `luna`. |
| P6 | codex `spawn_agent` + `send_input` | Skill tersedia di anak; pesan susulan dijawab dari konteks yang sama. |

## Keputusan

1. **`Setting.orchestration`** (Json, tanpa migration): saklar per flow + matriks
   `claude`/`codex` × fase; sel `null` mewarisi model/effort orchestrator (picker Start). Resolver murni
   `resolvePhasePlan` (`@hanoman/shared`) dipakai server dan pratinjau Start; effort dikoersi ke model
   hasil resolusi. Profil bawaan yang ter-seed dijelaskan pada amandemen 2026-09-17.
2. **Agen fase di-generate saat sesi lahir** (`buildPhaseAgents`), bernama `hanoman-fase-<slug>`, bukan
   baris `CustomAgent`: tak disync, tak masuk katalog, tak masuk graf mention. Instruksinya potongan prompt
   mode tunggal yang dipindah ke fase pemiliknya. Awalan `hanoman-fase-` dicadangkan di skema custom agent.
   Review whole-branch (M-1): skema hanya menggerbangi ENTRY BARU — baris `CustomAgent` lama ber-awalan itu
   bisa nyasar lewat sync dari peer lama, jadi `createSession` MENYARING ulang `customDefs` di kelahiran
   sesi (bukan cuma memercayai skema) supaya tak pernah menimpa definisi agen fase asli.
3. **Agen fase dirender tanpa kunci `tools`** — pengecualian sadar atas gotcha 5 ADR-0094 (P1): tanpa itu
   agen fase kehilangan `Skill` tanpa galat. Batas loop: kedalaman native claude (3 lapis), `agents.max_depth=3`
   codex, larangan tertulis memanggil `hanoman-fase-*`.
4. **Prompt orchestrator** hanya membawa kontrak delegasi: deskripsi pemanggilan `Fase <Nama Fase>` (P4),
   blok serah-terima tetap, orchestrator satu-satunya penulis `$HANOMAN_PHASE_FILE`, ulang **sekali** lalu
   `AskUserQuestion` (juga di sesi full-control), relay pertanyaan ke subagent yang SAMA (P3/P6), dilarang
   mengerjakan fase sendiri. **Live smoke 2026-09-14** (orchestrator Haiku 4.5/low) menemukan header blok
   `Fase <n>/<total>: <Nama Fase>` bersebelahan dengan instruksi deskripsi membuat model menyalin header
   sebagai deskripsi, dan langkah tulis `$HANOMAN_PHASE_FILE` bukan gerbang wajib sehingga terlewat sebelum
   commit/push — klausa diperkuat: header jadi `Urutan: <n>/<total> · <Nama Fase>` (deskripsi kalimat
   terpisah, eksplisit BUKAN baris pertama blok), dan penulisan berkas fase jadi tindakan wajib pertama
   (diverifikasi `tail -1`) sebelum fase berikutnya/commit/push, dengan gerbang penutup yang menolak
   commit final sebelum SEMUA fase tercatat `done`/`skipped`.
   Review whole-branch (temuan I-2) menemukan klausa lanjutan audit (`payload.fromAudit`) sesi tunggal
   dipakai APA ADANYA di mode orchestrator, padahal isinya menyuruh AGEN itu sendiri "pakai sebagai
   bahan"/"ambil keputusan" — di orchestrator itu berarti mengerjakan fase sendiri. Varian orchestrator
   (`auditContinuationForOrchestrator`) dipisah: feature meneruskan path dokumen audit ke agen fase
   Brainstorm (dan Objective) lewat `Artefak fase sebelumnya:`, TANPA orchestrator membacanya untuk
   merancang; qa menandai `Audit skipped` sendiri (gerbang `tail -1` yang sama) lalu meneruskan dokumen
   itu ke agen fase Spec, dengan orchestrator diizinkan SATU keputusan ROUTING saja (jalur-cepat/penuh)
   dari isi dokumen — bukan investigasi maupun rancangan. Temuan M-6: codex tak punya tool
   `AskUserQuestion`; klausa langkah 3–4 untuk plan codex diganti "tanyakan di terminal ini lalu tunggu
   jawaban", aturan tetap berlaku walau klausa otonomi menyuruh tak bertanya — claude tak berubah.
   Final fix A2: keputusan ROUTING kelanjutan audit qa itu MENGGANTIKAN pemicu langkah 5 (frasa
   `Rekomendasi fase: jalur-cepat` dari agen Audit) — dua mekanisme dulu bersambung tanpa penyelaras
   sehingga orchestrator literal bisa selalu jatuh ke jalur penuh (frasa tak akan pernah ada karena
   Audit tak dijalankan) atau mendelegasikan ulang Audit demi frasa itu. Untuk feature, path dokumen
   audit di baris `Artefak fase sebelumnya:` saat memanggil Objective ditambahkan DI SAMPING path
   artefak Brainstorm, bukan menggantikannya.
5. **All-or-nothing**: satu agen fase gagal dimaterialisasi (atau codex < 0.151) → sesi lahir mode tunggal
   dengan prompt lama yang dirakit pemanggil dari input yang sama. Flow mati → argv & prompt byte-identik
   (golden test). Konteks smart activation custom agent (`AgentSelectionContext.prompt`) selalu prompt
   yang benar-benar lahir: roster dipilih ulang dengan `legacyPrompt` saat fallback (audit R7).
6. **Bukti**: `AgentInvocation.phase`/`effort` (satu migration, LOCAL-only); effort stop dari payload
   runtime. Frame `phase` WS terminal diperkaya status/durasi/percobaan/token; `evidence: missing` sesudah
   60 dtk tanpa invocation dilabeli "bukti subagent tak diterima". Metrik custom agent mengecualikan baris
   ber-`phase`. Review whole-branch (I-1/M-2): chip HANYA memakai invocation SEJAK SESI LAHIR (id sesi
   tetap per spec, jadi run yang dilanjutkan bisa mewarisi baris `running` dari run yang sudah mati) —
   fase yang sudah `done`/`skipped` SAAT LAHIR (dicatat `createSession` dari berkas fase ke opsi tmux
   `@hanoman_done_at_birth`) tak pernah dilabeli ⚠ hanya karena tak ada invocation sesudah lahir.
7. **Tampilan**: tab Settings "Orkestrasi" (`Switch` `aria-label` `Orkestrasi <flow>` per kartu), pratinjau
   fase di modal Start (`Memuat rencana fase…` sampai Setting — dan bila codex, versi codex — termuat;
   tanda per bagian ` (warisi)`/` (model warisi)`/` (effort warisi)`), chip `PhaseStrip` (strip menggulir
   horizontal, panel detail dibatasi tinggi badan sel) + chip orchestrator di header sel,
   `subagentStatusLine` claude `label · model · effort · durasi · token`.

## Alternatif ditolak

- **Seed baris `CustomAgent` per fase** — ±60 baris tersync, instruksi beku terhadap ganti metode, pengaturan
  pindah ke layar Agents.
- **Server spawn satu sesi tmux per fase** — tanpa orchestrator, membalik ADR-0024/0015; ditolak dua kali.
- **Runtime berbeda per fase** (claude memanggil `codex exec`) — titik spawn baru, ditolak ADR-0094/SPEC-448.
- **Orchestrator mengerjakan fase interaktif sendiri** — melanggar "setiap fase oleh subagent"; relay P3/P6 cukup.

## Konsekuensi

- Delegasi tetap kepatuhan orchestrator; yang dijamin model/effort **saat** didelegasikan dan **terlihatnya**
  pelanggaran, bukan kemustahilannya. Terukur 2026-09-14: orchestrator lemah (Haiku 4.5/low) melewatkan
  penulisan `$HANOMAN_PHASE_FILE` sama sekali sebelum gerbang di atas ditambahkan — Opus 5/medium pada sesi
  pembanding yang sama menulisnya benar. Klausa yang lebih ketat mengurangi risiko ini, tak menghapusnya;
  operator sebaiknya tetap memilih model orchestrator yang cukup mampu, bukan mengandalkan prompt saja.
- Tiap fase mulai dengan konteks segar → biaya token bisa naik; serah-terima lewat berkas.
- Profil bawaan yang ter-seed dapat mengubah perilaku flow sesudah upgrade; marker provenance mencegah
  perubahan itu menimpa nilai yang pernah diedit operator.
- `pty.ts` tetap nol dependensi DB: invocation disuntik lewat `setPhaseInvocations`.

## Amandemen 2026-09-17 — default runtime bawaan dan override per sesi

Rekomendasi model/effort kini menjadi default produk, bukan hanya contoh di dokumentasi:

| Ruang | Claude | Codex |
|---|---|---|
| Orchestrator global | `sonnet` · `medium` | `gpt-5.6-terra` · `medium` |
| Fase rutin | `sonnet` · medium | Terra · medium |
| Fase sintesis/keputusan | `opus` · medium | Sol · medium |
| `no_effort` bila diaktifkan | `haiku` · low | Terra · low |

Sejak 2026-09-23 (katalog alias, [model-catalog](../architecture/model-catalog.md)) nilai claude
adalah alias native CLI, bukan id terpatok. Orchestrator boleh memilih `default`, yang tak sah di
`--agents`; sel yang mewarisinya dirender `inherit` oleh `resolvePhasePlan`.

Matriks lengkap per flow/fase berada di `BUILTIN_ORCHESTRATION_DEFAULTS` (`@hanoman/shared`):
Spec pada feature/qa/prd memakai Opus/Sol, breakdown memakai Opus/Sol, dan fase dokumentasi
reverse memakai Sonnet/Terra. `no_effort` default-nya **mati**.

Saat install pertama atau boot sesudah update, server men-seed default sebelum sesi pertama dapat lahir.
Seed menyimpan marker lokal `builtinRuntimeDefaults`: setiap model, effort, saklar flow, dan field
sel fase ditandai `seeded` atau `user`. Nilai `seeded` mengikuti rekomendasi versi terbaru; nilai
`user` tidak disentuh. Baris lama tanpa marker dikenali dari default historis (`Opus/xhigh`,
`Sol/xhigh`, dan matriks kosong) lalu dimigrasikan tanpa migration SQL. Setting bersifat lokal dan
marker tidak ikut sync antar-mesin.

Pada modal **Mulai sesi**, setelah picker orchestrator, operator dapat memilih `model` dan `effort`
untuk setiap subagent fase. Payload opsional `phaseOverrides` tidak disimpan ke Setting: ia hanya
berlaku pada sesi yang sedang dilahirkan. Prioritas resolusi adalah:

`override sesi` → `sel Settings` → `orchestrator` → koersi effort terhadap model hasil resolusi.

Ganti runtime pada modal menghapus override fase karena katalog Claude dan Codex berbeda. Flow mati
atau Codex yang belum mendukung native subagent tetap mengikuti fallback sesi tunggal.
