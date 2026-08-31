# ADR-0159 — Custom agent native, terukur, dan terisolasi

- Status: Accepted
- Tanggal: 2026-08-31
- SPEC: SPEC-950 (audit efektivitas custom agent)
- Terkait: **mengamandemen** [0094](0094-custom-agent-katalog-materialisasi-native.md) dengan
  mencabut materialisasi Codex inline; **mengamandemen**
  [0136](0136-agen-bawaan-sistem-seed-idempoten.md) pada default `qa-verifier` dan profil builtin;
  **memperluas** [0108](0108-klausa-gaya-kode-prompt-agen.md) ke subagent native Codex;
  **menegakkan** [0002](0002-git-worktree-isolation.md) dan
  [0037](0037-cabut-guardrail-safety.md) — policy read-only hanya kontrak custom subagent yang
  dipilih operator, bukan menghidupkan kembali deny hook sesi parent.

## Konteks

Audit SPEC-950 menemukan katalog delapan agent sudah kaya prosedur tetapi efektivitasnya belum bisa
dibuktikan. Claude memakai subagent native, sedangkan Codex hanya menerima full instructions di
prompt parent dan **mengadopsi persona inline**. Semua agent enabled masuk setiap sesi tanpa melihat
flow/diff, tidak ada batas kerja per agent, `qa-verifier` dapat menjalankan eksperimen kontrol di
worktree parent, dan tidak ada jejak apakah sebuah invocation berguna. UI hanya membuktikan definisi
tersimpan, bukan agent dipanggil atau temuannya diterima.

Enam prioritas audit karena itu satu perubahan kontrak, bukan enam kosmetik: native execution,
profil aman, aktivasi relevan, bukti lifecycle, keputusan manusia, dan eval deterministik.

## Keputusan

### 1. Kedua runtime memakai custom agent native

- Claude menerima JSON `--agents` dengan prompt/tool/model/effort/policy per agent.
- Codex menerima `agents.enabled=true`, plafon tiga thread, dan satu
  `agents."<name>".config_file` TOML per agent melalui `-c`. Full developer instructions hanya
  hidup di TOML child; prompt parent membawa nama, deskripsi, dan cara memanggil `spawn_agent`.
- Seluruh JSON/TOML/hook hidup di direktori temp sesi (direktori `0700`, berkas `0600`) dan dibuang
  saat sesi ditutup. Tidak ada `.claude/agents`, `.codex`, atau berkas baru di worktree.
- Satu agent yang gagal dimaterialisasi dilewati dengan warning; agent lain dan sesi parent tetap
  lahir. Roster kosong mempertahankan argv/prompt lama byte-identik.

Bagian ADR-0094 yang menyatakan Codex mengadopsi roster inline dan risiko loop Codex nol secara
struktural **dicabut**. Pengukuran 2026-08-01 atas Codex 0.146 tetap catatan historis yang sah;
keputusan produk berubah karena runtime sekarang menyediakan custom agent native yang dapat
diverifikasi.

### 2. Execution profile adalah data tersync

`CustomAgent` mendapat `activation` (`always|smart`), `effort?`, `workspacePolicy`
(`inherit|read-only|isolated-worktree`), `maxTurns?` (1–200), dan `timeoutSeconds?` (30–3600).
Kelima field masuk `FIELDS.customAgent`; nilai legacy dinormalisasi ke `always`, `inherit`, dan
`null`. `available`/`availabilityReason` tetap turunan response, tidak disimpan dan tidak disync.

`read-only` ditegakkan sebelum mutasi oleh validator murni + `PreToolUse` hook. Allowlist shell
hanya pembacaan (`rg`, `sed`, `head`, `tail`, `wc`, `ls`, dan git baca); redirect, command
substitution, chaining, `apply_patch`, git mutasi, dan tool mutasi ditolak. Sandbox child adalah
defense in depth, bukan satu-satunya pagar. `isolated-worktree` hanya tersedia untuk Claude;
kombinasi Codex ditolak/ditandai unavailable. `maxTurns` native hanya dipancarkan bila runtime
mendukung; timeout juga dinyatakan ke child agar batas yang tidak didukung native tidak dipalsukan
sebagai kill yang dijamin server.

### 3. Builtin aktif sedikit dan dipilih berdasarkan konteks

Hanya `scout`, `blast-radius`, dan `security-reviewer` aktif default; ketiganya `smart` dan
`read-only`. Builtin lain opt-in. `qa-verifier` sekarang disabled, `isolated-worktree`, maksimal
40 turn/900 detik. Pada upgrade, seed QA lama yang masih byte-equivalent dengan seed dimatikan
**tepat sekali**; suntingan/policy/saklar operator tidak disentuh. Ini satu-satunya pengecualian
sempit atas aturan ADR-0136 bahwa `enabled` selalu milik operator, karena perilaku lama terbukti
dapat mengotori worktree parent.

Seleksi dihitung sekali saat sesi lahir dari runtime, flow, prompt, `baseSha`, dan daftar changed
files. `always` custom agent tetap ikut; builtin `smart` memakai predicate konstanta per nama.
Kegagalan membaca git menjadi changed-files kosong dan tidak menggagalkan sesi.

### 4. Invocation menjadi bukti lokal, bukan klaim UI

Hook `SubagentStart`/`SubagentStop` Claude dan Codex masuk endpoint event sesi yang sudah ditandatangani.
Roster efektif disimpan sebagai metadata tmux sehingga server hanya menerima `agent_type` Hanoman
yang benar-benar tersedia di sesi itu. Unique `(sessionId,runtimeInvocationId)` membuat start/stop
idempoten; boot menutup invocation `running` tanpa parent hidup sebagai `abandoned`.

`AgentInvocation` LOCAL-only dan tanpa FK. Ia menyimpan waktu/status, model, token yang benar-benar
tersedia, excerpt bersih ANSI maksimal 4 KiB, hash hasil penuh, hash perubahan status worktree,
dan disposition manusia. Transcript hanya dibaca dari root runtime yang diizinkan, berkas biasa
di bawah 10 MiB, dan path-nya tidak disimpan. Stop tanpa start melahirkan record sintetis
`startedAt=endedAt`, `status=completed`, `durationMs=null`; angka nol tidak dipakai untuk waktu yang
tidak diketahui.

### 5. Pengukuran operasional dan eval tidak dicampur

Route cookie-admin `GET /api/custom-agents/metrics` menampilkan invocation, median durasi, token
nullable, disposition, dan precision operasional `(accepted+partial)/seluruh non-pending`.
`PATCH /api/custom-agents/invocations/:id` menyimpan `accepted|partial|rejected|false-positive`
serta note. Excerpt membuat kedua route tetap cookie-only; agent token tidak mendapat akses.

Eval di `evals/custom-agents` membawa satu kasus positif dan satu kontrol per delapan builtin.
Scorer murni menuntut semua finding expected dan nol forbidden hit. `pnpm agent:eval --runtime
claude|codex [--agent name] [--output path]` adalah live opt-in: fixture disalin ke repo temp,
renderer produk dipakai, report ditulis di luar source, lalu repo temp dibuang. Test/CI hanya
menilai output beku dan tidak memanggil model. Precision operasional dan eval recall tetap dua
angka berbeda.

## Konsekuensi

- Custom agent sekarang bisa menghemat konteks parent di kedua runtime, tetapi invocation nyata
  menambah waktu dan kuota. Aktivasi smart mengurangi panggilan yang tidak relevan; ia bukan jaminan
  model pasti mendelegasikan.
- Policy read-only mengurangi risiko, tetapi hook produk adalah boundary utamanya. Parent yang
  berjalan dengan izin luas tidak otomatis membuat child aman.
- Telemetry adalah best-effort. Hook event gagal terbuka agar pekerjaan tidak macet; invocation
  yang hilang tidak boleh ditafsirkan sebagai "agent tidak dipakai" tanpa memeriksa kesehatan hook.
- `workspaceChanged=true` membuktikan snapshot berubah selama invocation, bukan membuktikan agent
  itu satu-satunya penulis bila proses lain menyentuh worktree bersamaan.
- Model/effort rekomendasi builtin dipilih per runtime saat materialisasi tanpa menimpa `model=null`
  pada baris seed; override operator tetap menang.

## Gotcha yang wajib diingat

1. **Jangan kembalikan full instructions ke prompt parent Codex.** Itu membatalkan penghematan
   konteks meski subagent native masih bekerja.
2. **Jangan mengandalkan sandbox parent untuk read-only child.** Override parent dapat memperlebar
   izin; validator + hook wajib tetap terpasang.
3. **Temp hook Codex perlu trust eksplisit sekali jalan.** Tanpa flag trust, runtime melewati hook
   sampai review interaktif dan policy read-only lenyap senyap.
4. **Null bukan nol.** Token atau durasi yang tak tersedia tetap `null` sampai API dan UI; angka nol
   adalah klaim pengukuran.
5. **`AgentInvocation` tidak boleh masuk registry sync.** Session id, transcript, dan worktree hanya
   bermakna pada mesin yang menjalankannya.
6. **Eval live bukan test rutin.** Ia memakai kuota model; yang otomatis hanya scorer output beku.
7. **Flag trust hook Codex wajib tepat satu.** `agentFlags()` sudah memasangnya untuk seluruh sesi;
   materializer child hanya menambah registry/config. CLI Codex menolak flag itu bila muncul dua
   kali dan pane mati sebelum TUI lahir.
8. **Hook temp wajib diuji sebagai subprocess dari artefak yang benar-benar ditulis.** Menjalankan
   validator murni saja tidak menangkap helper transpiler (misalnya `__name`) yang bisa ikut
   terserialisasi lewat `Function#toString` tetapi tidak ikut masuk skrip mandiri.

## Alternatif yang ditolak

- **Pertahankan persona Codex inline.** Murah secara proses tetapi membakar konteks parent dan tidak
  menghasilkan invocation yang dapat dibuktikan.
- **Aktifkan semua builtin selalu.** Membuat katalog tampak sibuk tetapi menaikkan biaya dan noise;
  penggunaan bukan efektivitas.
- **Percaya prompt read-only saja.** Instruksi adalah arahan, bukan enforcement sebelum mutasi.
- **Satu quality score gabungan.** Precision disposition dan recall fixture mengukur hal berbeda;
  menggabungkannya mengarang presisi yang tidak dimiliki data.
- **Menjalankan eval live di CI.** Non-deterministik, memakai kredensial/kuota operator, dan membuat
  rilis bergantung pada layanan model eksternal.
