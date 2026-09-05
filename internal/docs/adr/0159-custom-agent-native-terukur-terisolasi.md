# ADR-0159 — Custom agent native, terukur, dan terisolasi

- Status: Accepted
- Tanggal: 2026-08-31
- Amandemen: 2026-09-05 — audit seluruh builtin; availability sepanjang sesi, mandat sesuai policy, dan evidence per definisi.
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
  hidup di TOML child; nama/deskripsi didaftarkan pada registry native. Prompt parent
  hanya membawa arahan delegasi dan handoff berukuran tetap.
- Seluruh JSON/TOML/hook hidup di direktori temp sesi (direktori `0700`, berkas `0600`) dan dibuang
  saat sesi ditutup. Di sandbox Podman direktori yang sama di-bind ke path absolutnya secara
  read-only; perintah hook memakai `node`, bukan path Node host. Tidak ada `.claude/agents`,
  `.codex`, atau berkas baru di worktree.
- Satu agent yang gagal dimaterialisasi dilewati dengan warning; agent lain dan sesi parent tetap
  lahir. Roster kosong mempertahankan argv/prompt lama byte-identik.
- Native custom agent Codex mensyaratkan client terdeteksi `>=0.151.0`. Client lebih tua/tak
  terdeteksi menerima warning dan **nol** registry maupun roster inline; `hanoman doctor`
  melaporkan batas ini tanpa mematikan kemampuan sesi parent Codex. Probe membaca konteks eksekusi
  yang sama dengan sesi: biner host saat sandbox mati, atau biner di `HANOMAN_SESSION_IMAGE` saat
  Podman aktif. `HANOMAN_PODMAN_BIN` dipakai baik oleh probe maupun argv sesi aktual. Config DB
  dimuat sebelum probe pertama; `hanoman doctor` juga membaca override `HANOMAN_CODEX_BIN` dari
  `RuntimeConfig` DB efektif sebelum env/default. Perubahan binary memicu refresh langsung dan
  upgrade in-place diprobe ulang paling lambat lima menit; seluruh refresh diserialkan agar probe
  timer lama tidak dapat menimpa hasil config yang lebih baru.

Bagian ADR-0094 yang menyatakan Codex mengadopsi roster inline dan risiko loop Codex nol secara
struktural **dicabut**. Pengukuran 2026-08-01 atas Codex 0.146 tetap catatan historis yang sah;
keputusan produk berubah karena runtime sekarang menyediakan custom agent native yang dapat
diverifikasi.

**Amandemen pengurangan prompt 2026-09-05:** hapus daftar nama/deskripsi dan uraian
roster dari prompt parent Claude maupun Codex. `agentDelegationClause` hanya
menambahkan satu paragraf untuk delegasi yang relevan, tujuan/scope/base/kandidat
termasuk dirty changes/bukti terdahulu/verifikasi, dan pemeriksaan hasil. Kosong
bila tidak ada agent yang dimaterialisasi. Metadata tetap ada di JSON `--agents`
Claude serta registry/TOML Codex. Pengurangan duplikasi tidak berarti metadata
native atau laporan child gratis token. Perbaikan kecil ini langsung execute;
Spec/Plan terpisah skipped, kontraknya amandemen ini dan test prompt/native.

Verifikasi amandemen: 86 test terkait + typecheck runner/server lulus. Smoke
Claude Code 2.1.261 mendaftarkan product-analyst dan support-triager secara native;
prompt tugas tidak memuat nama atau deskripsi keduanya. Runtime memilih
product-analyst tepat sekali, menghasilkan tool result berpasangan dan selesai
sukses. Ini bukti penemuan/pemanggilan pada skenario tersebut, bukan benchmark
seluruh katalog. Konfigurasi Codex teruji; smoke live Codex belum berjalan karena
executable lokal gagal ENOENT. Source ini belum menyatakan server aktif sudah
diupdate; prompt sesi yang sudah lahir juga tidak diubah.

### 2. Execution profile adalah data tersync

`CustomAgent` mendapat `activation` (`always|smart`), `effort?`, `workspacePolicy`
(`inherit|read-only|isolated-worktree`), `maxTurns?` (1–200), dan `timeoutSeconds?` (30–3600).
Kelima field masuk `FIELDS.customAgent`; nilai legacy dinormalisasi ke `always`, `inherit`, dan
`null`. `available`/`availabilityReason` tetap turunan response, tidak disimpan dan tidak disync.

`read-only` ditegakkan sebelum mutasi oleh validator murni + `PreToolUse` hook. Allowlist shell
hanya pembacaan (`rg`, `sed`, `head`, `tail`, `wc`, `ls`, dan git baca); redirect, command
substitution, chaining, `apply_patch`, git mutasi, tool mutasi, serta executable ber-path seperti
`./rg`/`/tmp/git` ditolak. Nama allowlist wajib di-resolve dari PATH agar executable milik repo
tidak dapat menyamar lewat basename. `rg` juga ditolak bila `RIPGREP_CONFIG_PATH` diwarisi karena
config itu dapat menyuntikkan `--pre` tanpa terlihat di argv. Sandbox child adalah defense in
depth, bukan satu-satunya pagar. `isolated-worktree` hanya tersedia untuk Claude;
kombinasi Codex ditolak/ditandai unavailable. `maxTurns` native hanya dipancarkan bila runtime
mendukung; timeout juga dinyatakan ke child agar batas yang tidak didukung native tidak dipalsukan
sebagai kill yang dijamin server.

`effort` bukan teks bebas: boundary dan form memakai katalog runtime/model yang sama. Runtime/model
warisan memakai irisan Claude–Codex; model Codex terpilih menyempitkan opsi lagi (misalnya Luna
tidak menerima `ultra`). Nilai legacy asing dibaca sebagai `null`, bukan diteruskan ke child.

### 3. Builtin aktif sedikit dan dipilih berdasarkan konteks

Hanya `scout`, `blast-radius`, dan `security-reviewer` aktif default; ketiganya `smart` dan
`read-only`. Builtin lain opt-in. `qa-verifier` sekarang disabled, `isolated-worktree`, maksimal
40 turn/900 detik. Pada upgrade, seed QA lama yang masih byte-equivalent dengan seed dimatikan
**tepat sekali**; suntingan/policy/saklar operator tidak disentuh. Ini satu-satunya pengecualian
sempit atas aturan ADR-0136 bahwa `enabled` selalu milik operator, karena perilaku lama terbukti
dapat mengotori worktree parent.

**Amandemen 2026-09-05:** registry native memuat seluruh agent enabled yang kompatibel dengan runtime
dan policy, sepanjang sesi. `smart` menentukan kapan parent mendelegasikan dari pekerjaan, fase,
dan diff **terkini**; tidak lagi menjadi predicate yang menyembunyikan agent saat lahir. QA/dep
karena itu tersedia meskipun diff awal kosong, dan security/spec dapat dipakai di goal/no_effort/audit.
Saklar operator, override project, policy isolated-worktree khusus Claude, gerbang versi Codex,
serta sesi raw shell tetap mengikat. Menyunting katalog memengaruhi sesi baru, bukan hot reload
registry sesi berjalan. `selectionReason` menjelaskan kebijakan ketersediaan pada response katalog.

Instruksi root-causer mengikuti policy efektif: read-only berarti diagnosis statis atas bukti yang
tersedia, hipotesis berlabel, dan rencana eksperimen untuk parent. Operator dapat memilih
isolated-worktree Claude untuk menjalankan eksperimen; validator baca-saja tidak dilonggarkan.
Test preservasi perilaku boleh langsung hijau; spec-auditor menguji keadaan akhir termasuk
requirement yang sudah dipenuhi di base. Security membedakan jalur terbukti, belum disimpulkan,
dan scope yang diperiksa. Handoff parent menyertakan tujuan/scope/base SHA/kandidat termasuk dirty
changes/bukti sebelumnya/aturan verifikasi. Child menyatakan selesai/sebagian/terhalang, bukti,
keyakinan, cakupan belum diperiksa, dan langkah berikutnya; batas instruksional 12 temuan/1200 kata.
MaxTurns awal yang dapat disunting: scout 20, auditor 30, root/QA/edge 40. Ini batas operasional
sementara, bukan hasil benchmark; Claude memakai native maxTurns, Codex mendapat instruksi batas.
Timeout QA 900 detik tetap instruksional, tidak dipasarkan sebagai hard kill.

### 4. Invocation menjadi bukti lokal, bukan klaim UI

Hook `SubagentStart`/`SubagentStop` Claude dan Codex masuk endpoint event sesi yang sudah ditandatangani.
Hook menulis satu berkas unik/atomik ke spool per sesi. Sejak amandemen 2026-09-05, root-nya
`<HANOMAN_HOME>/session-events`, sehingga server uji/instalasi lain tidak mengambil lalu menandatangani
event milik home lain. Direktori global lama di tmpdir tidak dipindai atau dimigrasikan otomatis
karena tidak membawa bukti kepemilikan instalasi. Sebelum mengganti server, tuntaskan sesi sandbox
lama atau jalankan kembali dengan env spool baru; sesi host yang mengirim HTTP tidak memakai spool.
Direktori sesi itu menjadi satu-satunya
mount custom-agent writable (`rw`) di sandbox; worker server memproses maksimal 1 MB per berkas dan
me-replay payload melalui `/api/session-events` dengan token turunan sesi. Dengan demikian loopback
container tidak dianggap loopback host, sementara autentikasi, roster check, idempotensi, dan rate
limit route tetap satu sumber. Hook menulis `.tmp` eksklusif lalu `rename` ke `.json`, sehingga
worker tak pernah membaca payload separuh jadi. Berkas invalid dan respons 4xx permanen dibuang;
exception, `429`, dan 5xx dipertahankan untuk tick berikutnya. Hook selalu fail-open.
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

**Amandemen 2026-09-05:** metadata tmux membekukan SHA-256 `definitionHash` dari prompt/profile
efektif dan policy baca-saja saat sesi lahir. Helper runner memakai artefak renderer native yang sama,
mengganti lokasi hook temp dengan slot stabil, lalu memasukkan source hook, activation, dan
model/effort warisan yang diketahui. Field tools yang tidak diterapkan renderer tidak memecah
varian. Saat materialisasi Codex berhasil parsial, hash tetap memakai roster yang dipakai saat
berkas itu dirender. Route event mengambilnya dari roster yang dipercaya,
bukan payload child; kolom nullable pada AgentInvocation mempertahankan unknown historis. Start
ulang/stop tidak mengganti identitas definisi start pertama. `reworkRequired` nullable menyimpan
penilaian admin apakah hasil membutuhkan kerja ulang parent, independen dari disposition.
Response metrics mempertahankan agregat `agents` dan menambah `variants` per nama/runtime/model/hash,
`evaluatedCount`, hitungan rework, serta `telemetry` (event terakhir, bukti belum lengkap, status
relay). Relay menyimpan observasi in-memory per spool root: waktu pemeriksaan/pengiriman/kendala,
retry pada pemeriksaan terakhir, total retry dan event dibuang sejak boot. Nol invocation bukan
bukti tidak dipakai; relay yang dapat memproses antrean tidak menjamin seluruh runtime mengirim
hook. UI memisahkan gagal memuat dari bukti kosong dan menampilkan input/output/cache secara
terpisah, tanpa menjumlahkan token cache ke input. Di samping `recent` global maksimum 100,
`samples` mempertahankan maksimum dua contoh per-agent dari masing-masing kelompok pending,
sudah dinilai, dan perlu kerja ulang, dideduplikasi berdasarkan invocation; agent yang lebih sepi
tidak kehilangan semua contoh hanya karena agent lain lebih ramai.

Eval di `evals/custom-agents` membawa 20 kasus: satu positif dan satu kontrol per delapan builtin audit awal,
ditambah preservasi QA, requirement sudah terpenuhi di base, dan sumber lokal advisory/lisensi
terkunci yang diketahui/belum diketahui. Scorer menuntut JSON evidence berstatus lengkap,
verdict terstruktur yang dikonfirmasi, serta revision/path/baris/kutipan yang cocok dengan snapshot
fixture; keyword-only, negasi, klaim unknown sebagai confirmed, jangkar salah, dan field tak dikenal
ditolak. Ini benchmark dengan kosakata terbatas, bukan penilaian bebas atas semua prosa diagnosis.
Delapan [agent aplikasi](../operations/app-support-agents.md) yang ditambahkan 2026-09-05
belum mempunyai fixture perilaku. Validasi seed/profile/renderer tidak boleh dilaporkan sebagai
benchmark keberhasilan tugas delapan agent tersebut; permintaan eval tanpa kasus gagal eksplisit.

Fixture QA/edge adalah project Node test runner tanpa instalasi dependency. Child menghasilkan
test vector JSON berbatas; harness memeriksa artefak, lalu menjalankan ulang kode fixture tepercaya
terhadap base, kandidat, dan mutant. Byte runner/aplikasi disimpan sebelum runtime berjalan;
JavaScript buatan child tidak dieksekusi oleh replay. Hasil mencatat hash artefak/output dan exit
yang diamati, dengan otoritas eksplisit `harness-replay-of-declarative-artifact`. Ini mengukur
test berbasis data, bukan kualitas penulisan sembarang kode test atau membuktikan child sebelumnya
sudah mengeksekusi perintah.

`pnpm agent:eval --runtime claude|codex [--agent name] [--case id] [--output path]` adalah live
opt-in: fixture disalin ke repo temp, base SHA dicatat, lalu overlay kandidat dikomit **hanya di repo
temp** agar child worktree native melihat kandidat yang sama. Renderer dan hook read-only produk
dipakai; parent **wajib** mendelegasikan tepat sekali ke target. Hook lifecycle
ditulis ke direktori event temp; hanya `last_assistant_message`/`result` dari tepat satu pasangan
`SubagentStart`–`SubagentStop` target yang dinilai. Stdout parent tidak pernah menjadi hasil agent.
Parent Claude berjalan restricted + `plan` dengan Task/Read/Glob/Grep pada daftar alat dan
permission allowlist. Membatasi daftar global ke Task ternyata menghilangkan alat baca dari
resolusi child native Claude 2.1.261. Parent kini boleh membaca fixture; hanya hasil child
teratribusi yang dinilai. Bash/Write/Edit tetap tidak tersedia dan hook read-only tidak dilonggarkan.
Live Claude adalah subset inspeksi berkas, bukan bukti parity seluruh tool produksi termasuk Git/Bash.
Lima kasus QA/edge **tidak tersedia live** dalam harness restricted ini: Bash child dihilangkan
oleh runtime dan penulisan artefak child di bawah plan belum didukung dengan batas yang terverifikasi.
Kelima kasus tetap diuji lewat replay offline independen; ini tidak membuktikan QA/edge live.
Codex juga tetap tidak mendukung policy isolated-worktree. Pemilihan kasus yang seluruhnya
unavailable tidak boleh menghasilkan sukses kosong.
Parent Codex berjalan
sandbox `read-only`, approval `never`, serta tanpa user config/rules. Mode `ephemeral` sengaja tidak
dipakai karena Codex 0.151 tidak mendaftarkan thread parent ke daemon kolaborasi dalam mode itu,
sehingga `spawn_agent` gagal `no thread with id`. Environment child dibentuk dari
allowlist auth/konektivitas dan menunjuk `PWD`/`OLDPWD`/`INIT_CWD` ke repo temp, bukan checkout
sumber. Ini mencegah penulisan source sebelum terjadi; hash tracked + unignored seluruh checkout
tetap menjadi deteksi tambahan. Setiap kasus live dibatasi wall-clock 180 detik; timeout menjadi
failure report, bukan proses yang menggantung. Report ditulis atomik di luar **seluruh checkout git sumber**, lalu
repo temp dibuang. Larangan output memakai real path sehingga symlink ke checkout tidak lolos.
Eval Codex mem-probe biner live, menolak versi tak terdeteksi/<`0.151.0`, dan meneruskan versi itu
ke materializer produk. Kontrak format JSON/verdict ditambahkan sesudah prompt native child
selama evaluasi; instruksi peran dan policy produksi tetap utuh. Report versi 2 membedakan
fingerprint definisi produksi dari fingerprint konfigurasi evaluasi yang menyertakan protokol
format, serta mencatat model, base/candidate SHA, dan bukti validasi.
Test/CI hanya menilai output beku dan tidak memanggil model. Precision
operasional dan eval recall tetap dua angka berbeda.

Bukti live terbatas 2026-08-31: Codex 0.151.0 menjalankan `scout-positive` dan `scout-control`
melalui child native teratribusi; keduanya lulus (`recall=1`, forbidden hit `0`, exit `0`) dan hash
checkout sumber sebelum/sesudah identik. Ini membuktikan jalur dan dua kasus `scout`, **bukan**
benchmark live seluruh delapan builtin atau bukti Claude—keduanya tetap perlu run terpisah saat
credential/kuota tersedia.

Bukti tindak lanjut 2026-09-05: uji Claude 2.1.261 mengungkap pewarisan pembatas alat global
dan kontrak format yang tidak cukup disampaikan hanya ke parent; keduanya diperbaiki pada harness.
Run scout-positive terakhir memiliki lifecycle lengkap, dua jangkar benar dan source hash tetap,
tetapi **FAIL** karena prosa + blok JSON melanggar amplop JSON murni. Ini tidak dihitung sebagai
live pass. Codex lokal gagal probe karena executable vendor hilang; lima QA/edge tetap hanya
terverifikasi offline pada harness ini.

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
9. **Config temp wajib di-mount read-only ke sandbox pada path absolut yang sama.** Argumen TOML/JSON
   tetap valid di host tetapi child tidak melihat berkasnya bila mount ini terlupa.
10. **Validator read-only memvalidasi opsi, bukan hanya nama biner.** `git diff` wajib mematikan
    external diff/textconv; `--output`, `rg --pre*`, skrip `sed` selain print numerik, ekspansi env,
    redirect, chaining, dan substitusi perintah ditolak.
11. **Telemetry sandbox lewat spool, bukan HTTP loopback.** `127.0.0.1` di Podman adalah container;
    membuka server ke bridge untuk mengakalinya akan memperlebar boundary ingress.
12. **Output eval tidak boleh hidup di bagian mana pun dari checkout sumber.** Melarang hanya
    `evals/custom-agents` masih membolehkan `--output ./report.json` mengotori commit berikutnya.
13. **Bandingkan real path dan hash seluruh checkout.** Pemeriksaan leksikal dapat ditembus symlink;
    hashing fixture saja tidak melihat executor yang menulis source lain di checkout.
14. **Gate Codex bukan snapshot boot.** Config DB harus dimuat lebih dulu; perubahan binary refresh
    langsung, probe berkala menangkap upgrade in-place, refresh wajib serial, dan sandbox wajib
    mem-probe isi image dengan biner Podman yang sama seperti sesi aktual.
15. **Skor live wajib milik child, bukan parent.** Tanpa satu start/stop target yang berpasangan,
    kasus gagal meskipun stdout parent berisi semua kata kunci expected.
16. **Isolasi source harus mencegah, bukan sekadar mendeteksi sesudah rusak.** Parent eval tidak
    mendapat tool tulis/bypass, cwd environment menunjuk repo temp, dan hash checkout hanya pagar
    tambahan—bukan mekanisme pemulihan.
17. **Jangan pakai `codex exec --ephemeral` untuk eval multi-agent 0.151.** Thread parent tidak
    terdaftar ke daemon kolaborasi dan `spawn_agent` gagal `no thread with id`. Bila error transient
    yang sama tetap muncul, jangan spawn kedua; tunggu sekali 30 detik lewat `wait_agent`.
18. **Live eval wajib punya wall-clock timeout di parent.** Timeout dalam prompt/profile child
    bukan kill yang dijamin runtime; harness memutus kasus sesudah 180 detik dan melaporkannya gagal.

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
