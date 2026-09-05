# Audit delapan custom agent bawaan Hanoman — 5 September 2026

Status: audit awal dan perbaikan kode selesai; lihat tindak lanjut di akhir laporan untuk hasil
validasi dan batas runtime. Bagian audit awal di bawah merekam snapshot `88e634e4` (main saat audit
dimulai), bukan perilaku sesudah perbaikan. Pekerjaan berada di branch `audit/builtin-agents-20260905`.

## Kesimpulan

Katalog memiliki pembagian tanggung jawab yang masuk akal, prosedur konkret, dan tuntutan bukti yang lebih kuat daripada persona generik. Infrastruktur seed, native child, isolasi, dan telemetry sudah tersedia. Tiga default saat ini layak dipertahankan: **scout, blast-radius, security-reviewer**.

Namun, kesiapan fungsional kedelapan agent belum merata. **Root-causer terbentur kebijakan alatnya sendiri; seleksi sekali saat sesi lahir melewatkan kebutuhan yang muncul kemudian; benchmark belum membuktikan prosedur operasional yang dijanjikan.** Instruksi edge-case-hunter dan spec-auditor juga mengandung aturan absolut yang dapat menghasilkan penilaian salah.

Jangan mengaktifkan semua agent sebagai cara memperbaiki masalah ini. Prioritaskan kesesuaian tugas–alat, ketersediaan agent pada workflow yang tepat, dan kualitas pengukuran.

## Cakupan dan cara menilai

Audit mencakup semua delapan entri `BUILTIN_AGENTS`: isi prompt, trigger, profil model/effort, alat/policy, materialisasi Claude/Codex, seed dan upgrade, pengukuran invocation, serta fixture/scorer eval. Hanoman-lead adalah peran orkestrator tersendiri, bukan entri katalog CustomAgent bawaan ini.

Sumber kontrak: [ADR-0136](../adr/0136-agen-bawaan-sistem-seed-idempoten.md), [ADR-0159](../adr/0159-custom-agent-native-terukur-terisolasi.md), dan skill proyek.

Bukti dikumpulkan melalui pembacaan kode, 109 test terarah, probe fungsi produk, serta query **read-only** terhadap `~/.hanoman/hanoman.db`. Tidak ada pemanggilan model dalam audit ini, tidak ada perubahan konfigurasi agent, dan tidak ada penulisan ke DB operasional.

Penilaian desain di bawah adalah kesimpulan audit, **bukan skor akurasi model**. Temuan mekanis direproduksi terpisah dari saran penyempurnaan prompt.

## Inventaris

Sumber: [katalog builtin](../../../shared/src/builtin-agents.ts). Model merupakan rekomendasi bawaan saat runtime dimaterialisasi; override operator dapat mengubahnya.

| Agent | Default | Claude / Codex | Effort | Policy | Batas khusus agent |
|---|---|---|---|---|---|
| scout | Aktif | haiku / gpt-5.6-terra | low | read-only | Tidak ditetapkan |
| root-causer | Nonaktif | sonnet / gpt-5.6 | high | read-only | Tidak ditetapkan |
| qa-verifier | Nonaktif | sonnet / belum tersedia dengan policy bawaan | medium | isolated-worktree | 40 turn; instruksi 900 detik |
| edge-case-hunter | Nonaktif | sonnet / belum tersedia dengan policy bawaan | high | isolated-worktree | Tidak ditetapkan |
| blast-radius | Aktif | sonnet / gpt-5.6-terra | medium | read-only | Tidak ditetapkan |
| spec-auditor | Nonaktif | sonnet / gpt-5.6-terra | high | read-only | Tidak ditetapkan |
| security-reviewer | Aktif | sonnet / gpt-5.6 | high | read-only | Tidak ditetapkan |
| dep-auditor | Nonaktif | haiku / gpt-5.6-terra | medium | read-only | Tidak ditetapkan |

Semuanya menggunakan aktivasi `smart`. Kolom model Codex tetap ada di definisi QA/edge-case, tetapi materializer Hanoman menolak `isolated-worktree` untuk Codex. Ini batas implementasi Hanoman yang diaudit, bukan klaim bahwa seluruh produk Codex tidak mempunyai mekanisme isolasi.

## Penilaian setiap agent

### 1. scout — pertahankan sebagai default

**Kelebihan:** mandatnya sempit dan berguna: menemukan titik masuk, alur data, lokasi perubahan, serta representasi kontrak yang diduplikasi. Pencarian dilakukan melalui beberapa sudut, bukan satu simbol. Hasil diwajibkan ringkas dengan `path:baris`; pencarian yang gagal harus menyebut pola yang dicoba. Profil effort rendah sesuai tujuan menekan pekerjaan eksplorasi berulang.

**Kekurangan:** sebagian pencarian duplikasi tumpang tindih dengan blast-radius. Format keluarannya belum membatasi jumlah jangkar/temuan atau mewajibkan tingkat keyakinan. Trigger dapat memasukkannya ke sesi tanpa diff meskipun sesi itu tidak membutuhkan eksplorasi kode. Bukti live yang tercatat baru dua kasus kecil scout, belum menunjukkan manfaat pada repositori besar.

**Rekomendasi:** pertahankan default. Beri parent template pertanyaan yang sempit dan gunakan kembali peta scout untuk review berikutnya. Bedakan tugas scout sebelum perubahan dari blast-radius sesudah perubahan. Tambahkan batas laporan dan pernyataan bagian yang belum diperiksa; ukur kebutuhan baca ulang parent sebelum mengganti model.

Bukti: `shared/src/builtin-agents.ts:37`, `server/src/services/custom-agents.ts:66`.

### 2. root-causer — perbaiki kesesuaian tugas dan alat sebelum memperluas penggunaan

**Kelebihan:** reproduksi didahulukan; minimal dua hipotesis bersaing; eksperimen harus membedakan hipotesis; agent dilarang menyulap dugaan menjadi sebab yang terbukti. Hasil akhirnya diminta menyebut perbaikan minimum dan cara verifikasi.

**Kekurangan utama, terkonfirmasi:** profil `read-only` menolak perintah `pnpm`, `node`, `python3`, dan `curl`. Padahal prosedurnya mewajibkan menjalankan reproduksi dan eksperimen. Mempunyai alat Bash tidak berarti perintah itu bisa dijalankan. Agent dapat membaca bukti yang sudah tersedia, tetapi tidak dapat menjalankan banyak reproduksi standar. Trigger hanya melihat keberadaan fase Audit, sehingga diagnosis pada flow lain juga dapat tidak tersedia.

**Rekomendasi:** tetap opt-in. Sediakan lingkungan eksperimen terisolasi, dengan DB/env tersendiri dan larangan mengubah source parent. Untuk runtime yang belum mendukung profil itu, tawarkan mandat diagnosis statis yang jujur dengan keluaran “belum terbukti; eksperimen berikut diperlukan”. Jangan membuka policy baca-saja semua agent demi satu kebutuhan diagnosis.

Bukti: `shared/src/builtin-agents.ts:70`, `runner/src/agent-readonly.ts:6`, `server/src/services/custom-agents.ts:79`.

### 3. qa-verifier — berguna, tetapi ketersediaan dan bukti verifikasinya perlu diperbaiki

**Kelebihan:** menargetkan test yang tersentuh, menyelidiki state bersama/paralelisme/env yang bocor, meminta perintah dan keluaran, melarang stash bersama, serta memindahkan eksperimen kontrol ke worktree terpisah. Satu-satunya builtin dengan maxTurns dan timeoutSeconds eksplisit.

**Kekurangan:** hanya tersedia untuk Claude dengan policy bawaan. Pada sesi feature baru tanpa changed files, ia tersaring keluar sekalipun diaktifkan operator. Roster tidak diperbarui setelah implementasi menghasilkan diff. Instruksi “test harus merah pada base” juga terlalu luas untuk test perlindungan perilaku lama atau refactor yang memang mempertahankan perilaku. Kebutuhan baseSha/patch sudah disebut, tetapi kualitas verifikasi tetap bergantung pada kelengkapan konteks yang diberikan parent.

**Rekomendasi:** opt-in untuk verifikasi perubahan berisiko. Pastikan agent dapat dipilih ketika verifikasi benar-benar dibutuhkan. Berikan base SHA, snapshot kandidat termasuk perubahan belum commit, daftar test, dan policy env/DB. Pisahkan bukti regression test baru dari bukti preservasi perilaku. Nyatakan 900 detik sebagai batas instruksional; jangan menampilkannya sebagai penghentian proses yang dijamin server.

Bukti: `shared/src/builtin-agents.ts:106`, `server/src/services/custom-agents.ts:81`, `runner/src/custom-agents.ts:39`.

### 4. edge-case-hunter — revisi aturan test sebelum dijadikan kebiasaan

**Kelebihan:** daftar batasnya sistematis: kosong/null, angka ekstrem, Unicode, urutan, duplikasi, kegagalan parsial, retry, dan input luar. Menulis test tanpa memperbaiki kode produksi menjaga independensi temuan. Worktree terpisah mengurangi risiko mengganggu pekerjaan parent.

**Kekurangan utama:** instruksi menyatakan test yang langsung hijau “tak membuktikan apa-apa” dan akan tetap hijau saat kode rusak. Ini tidak benar secara umum. Test baru untuk penanganan duplikasi yang sudah benar dapat langsung hijau, lalu merah ketika pengecekan duplikasi dihapus pada regresi berikutnya. Aturan saat ini mendorong agent membuang test perlindungan yang sah. Tidak tersedia di Codex dengan policy bawaan; tidak memiliki batas kerja khusus.

**Rekomendasi:** tetap opt-in. Untuk bug yang memang ada, minta reproduksi merah sebelum perbaikan. Untuk perilaku yang sudah benar, terima test hijau yang membuktikan kontrak, dan gunakan mutation/negative control di lingkungan terisolasi bila diperlukan. Kembalikan patch test, perintah, hasil, dan bug yang ditemukan; tetapkan scope serta batas kerja.

Bukti: `shared/src/builtin-agents.ts:149`, terutama baris 174–176.

### 5. blast-radius — salah satu agent yang paling sesuai kebutuhan Hanoman

**Kelebihan:** mencari kelas bug yang tidak tertangkap typecheck: daftar field manual, enum duplikat, payload lintas paket, schema boundary, dokumen kontrak, dan contoh konfigurasi. Wajib menjelaskan akibat konkret bila ketidaksinkronan dibiarkan. Sangat relevan dengan struktur shared/server/runner/frontend dan kontrak sync Hanoman.

**Kekurangan:** “urut dari yang paling senyap” berisiko mengalahkan besarnya dampak; bug yang tidak senyap bisa tetap lebih kritis. Tidak ada format deduplikasi atau batas jelajah. Sebagian pekerjaan mengulang pencarian scout bila hasil scout tidak diteruskan.

**Rekomendasi:** pertahankan default. Urutkan berdasarkan dampak, kemungkinan, dan keyakinan; kesenyapan menjadi faktor tambahan. Beri base SHA dan ringkasan scout, lalu minta hanya kontrak yang berubah dan representasi lain yang seharusnya ikut berubah.

Bukti: `shared/src/builtin-agents.ts:187`.

### 6. spec-auditor — mandat penting dengan definisi bukti yang terlalu sempit

**Kelebihan:** membandingkan permintaan dengan hasil, bukan mengandalkan checklist. Memisahkan “terpenuhi”, “berbeda”, dan pekerjaan di luar permintaan. Cocok menjaga scope serta menemukan plan yang menyimpang dari spec.

**Kekurangan utama:** “tanpa jangkar di diff = tak terpenuhi” mengabaikan requirement yang sudah dipenuhi implementasi lama, konfigurasi yang tidak berubah, atau validasi runtime. Ini berpotensi memberi false negative dan mendorong perubahan yang sebenarnya tidak perlu. Ketiadaan bukti juga disamakan dengan terbukti tidak terpenuhi. Dalam flow audit murni, smart selection justru tidak memasukkannya.

**Rekomendasi:** periksa keadaan akhir terhadap requirement, memakai diff untuk mengidentifikasi perubahan. Tambahkan putusan “sudah terpenuhi sebelum perubahan”, “belum terverifikasi”, dan “tidak berlaku”. Jika spec, plan, dan steering pengguna berbeda, tampilkan dasar prioritasnya. Aktifkan sesuai kebutuhan audit kepatuhan atau penutupan fitur, setelah prompt dikoreksi.

Bukti: `shared/src/builtin-agents.ts:225`, terutama baris 244–250; `server/src/services/custom-agents.ts:75`.

### 7. security-reviewer — pertahankan default, perbaiki trigger dan cara melaporkan ketidakpastian

**Kelebihan:** menelusuri input sampai dampak, memeriksa kepemilikan objek selain autentikasi, validasi, batas ukuran, serta kebocoran kredensial. Meminta jalur yang sudah diperiksa membantu membedakan audit nyata dari laporan kosong.

**Kekurangan utama, terkonfirmasi:** seleksi mensyaratkan fase Execute/Audit dan kecocokan kata tertentu. Pada flow goal/no_effort dengan `server/src/routes/auth.ts` berubah, agent tetap tidak terpilih. Pemindaian prompt/file di awal sesi juga dapat melewatkan permukaan eksternal yang muncul kemudian. Instruksi menahan temuan tanpa jalur konkret belum menyediakan tempat bagi jalur berisiko yang penelusurannya belum selesai; “bersih” dapat dibaca terlalu kuat.

**Rekomendasi:** pertahankan default dan perluas seleksi berdasarkan sifat perubahan lintas flow. Laporkan “terbukti”, “belum dapat disimpulkan”, dan “tidak ditemukan masalah dalam scope yang diperiksa” secara berbeda. Sertakan batas audit, skenario penyalahgunaan, dampak, dan keyakinan. Perlakukan ini sebagai audit statis; policy bawaan tidak menjalankan curl/eksploitasi.

Bukti: `shared/src/builtin-agents.ts:259`, `server/src/services/custom-agents.ts:56` dan `:72`.

### 8. dep-auditor — berguna saat ada perubahan dependensi, tetapi cakupannya belum terbukti

**Kelebihan:** memeriksa advisory, lisensi, pemeliharaan, dependensi transitif, install script, dan kemungkinan memakai kemampuan yang sudah ada. Klaim CVE/lisensi harus membawa URL; informasi tanpa sumber harus disebut belum terverifikasi. Menyediakan alat web pada konfigurasi Claude.

**Kekurangan:** seleksi hanya membaca manifest/lockfile yang sudah berubah saat sesi lahir. Daftar pemicu tidak mencakup semua ekosistem/lockfile, misalnya `uv.lock`, `poetry.lock`, `Gemfile.lock`, atau `composer.lock`. Kebijakan shell menolak package-manager audit sehingga pengujian deterministik perlu jalur terpisah. Fixture eval yang tersedia hanya membahas penggunaan nanoid versus kemampuan runtime; belum menguji kualitas pencocokan advisory/rentang versi/lisensi.

**Rekomendasi:** tetap opt-in pada perubahan manifest/lockfile dengan peluang pemilihan saat perubahan muncul. Tambahkan sumber advisori primer, tanggal pengecekan, versi terkunci, jalur transitif, dan status “belum terverifikasi” pada putusan akhir. Jalankan scanner deterministik di lingkungan terisolasi jika diperlukan, lalu agent menilai relevansi hasilnya. Validasi ekuivalensi fungsi sebelum menolak dependensi.

Bukti: `shared/src/builtin-agents.ts:300`, `server/src/services/custom-agents.ts:53`, `evals/custom-agents/manifest.ts:111`.

## Temuan lintas agent dan urutan perbaikan

### P1 — tugas diagnosis tidak dapat dijalankan dengan policy bawaan

Probe fungsi produk `readOnlyDecision`, menggunakan payload Bash dan environment kosong, memberi:

| Perintah yang diajukan ke validator (tidak dieksekusi) | Hasil |
|---|---|
| pnpm vitest --run test/ttl.test.ts | Ditolak |
| node -e 1 | Ditolak |
| python3 -V | Ditolak |
| curl http://127.0.0.1:3000/api/health | Ditolak |
| git diff --no-ext-diff --no-textconv | Diizinkan |
| rg TTL . | Diizinkan |

Ini membuktikan benturan kebijakan dan mandat root-causer. Bukan pengukuran kegagalan model live.

### P1 — daftar agent dibekukan terlalu dini dan bergantung nama fase

Seleksi dibuat pada `server/src/services/pty.ts:618`, lalu registry/config native ditulis pada kelahiran sesi. Tidak ada evaluasi ulang changed files pada kode seleksi ini setelah implementasi berlangsung.

Probe `selectAgentRows` memakai **semua delapan agent enabled=true**, sehingga agent yang hilang benar-benar disebabkan selector, bukan saklar default:

| Konteks Claude | Yang terpilih |
|---|---|
| feature baru, diff kosong | scout, edge-case-hunter, blast-radius, spec-auditor |
| feature dengan src/customer.ts dan package.json berubah | scout, qa-verifier, edge-case-hunter, blast-radius, spec-auditor, dep-auditor |
| goal dengan route auth berubah | blast-radius |
| no_effort dengan route auth berubah | blast-radius |
| audit pemenuhan acceptance criteria | scout, root-causer, blast-radius |

**Perbaikan:** pisahkan “tersedia untuk dipanggil” dari “direkomendasikan sekarang”. Registrasikan agent enabled yang kompatibel secara cukup konservatif; arahkan delegasi berdasarkan fase/diff terbaru. Alternatif refresh native perlu lebih dahulu dibuktikan dukungan runtime-nya. Jangan menjanjikan hot refresh hanya dengan memperbarui cache DB.

### P1 — benchmark belum setara dengan perilaku produksi

Ada dua celah berbeda:

1. **Policy berbeda:** `runner/src/custom-agent-eval.ts:364` memanggil `renderAgentsJson([def])` tanpa `readOnlyHookCommand`; baris 377 memanggil materializer Codex tanpa opsi hook itu. Produksi memasangnya di `server/src/services/pty.ts:633`. Parent eval tetap dibatasi, tetapi kelulusan eval tidak membuktikan keberhasilan child dengan allowlist shell produksi.
2. **Scorer menilai kata, bukan bukti:** `runner/src/custom-agent-eval.ts:167` mencocokkan regex terhadap seluruh teks. Probe berikut untuk `security-reviewer-positive` lulus dengan recall=1, forbiddenHitRate=0, passed=true:

> Saya belum membaca kode dan belum membuktikan temuan. Daftar kata: GET /documents/:id authenticated ownership missing.

Fixture diagnosis/QA/edge-case berupa `source.txt`; sebagian berisi observasi atau pseudocode, bukan project dengan test runner yang dapat langsung dijalankan. Kontrol itu berguna untuk menilai pembacaan kasus kecil, tetapi belum membuktikan reproduksi, penulisan test, atau verifikasi yang dijanjikan agent.

**Perbaikan:** gunakan policy yang sama dengan produksi; pertahankan atribusi lifecycle child yang sudah ada; tambahkan fixture executable dan validasi artefak, perintah, hasil, serta lokasi bukti. Tambahkan kasus negasi/ketidakpastian/parafrasa pada scorer. Jalankan benchmark live sesudah harness representatif, dipisah per agent, runtime, model, dan versi prompt.

### P2 — aturan absolut pada test dan diff menghasilkan penilaian keliru

Perbaiki edge-case-hunter dan spec-auditor sebagaimana uraian per agent. QA juga perlu membedakan test regresi baru dari test preservasi perilaku lama. Tambahkan kasus kontrol “implementasi sudah benar tetapi test belum ada” serta “requirement sudah dipenuhi di base” pada evaluasi.

### P2 — pengukuran operasional belum cukup untuk memilih agent/model terbaik

Pada DB lokal yang dibaca saat audit:

- Delapan baris CustomAgent global tersedia; tiga aktif sama dengan default; tidak ditemukan baris scope project.
- AgentInvocation mempunyai **0 baris**.
- Ini berarti **belum ada bukti invocation di DB ini**, bukan bukti bahwa agent tidak pernah dipakai; telemetry dapat hilang dan instance lain tidak ikut diperiksa.
- ADR-0159 hanya mencatat dua kasus scout di Codex pada 31 Agustus 2026. Itu bukti historis terbatas, bukan benchmark seluruh agent.

Kode metrik mengelompokkan berdasarkan `agentName` saja (`server/src/services/agent-invocations.ts:237`) dan menghitung `accepted + partial` sebagai pembilang precision operasional. Angka tersebut sah sebagai definisi produk, tetapi belum membandingkan model/runtime/versi prompt dan belum mengukur defect recall atau penghematan biaya.

**Perbaikan:** tampilkan alasan seleksi/tidak tersedia, kesehatan telemetry, jumlah hasil yang benar-benar dinilai, dan kelompokkan bukti per runtime/model/versi definisi. Catat durasi, token tersedia, hasil diterima, false positive, dan kebutuhan kerja ulang parent. Hindari ranking numerik sebelum sampelnya memadai.

### P2 — batas kerja dan format serah-terima belum seragam

Tujuh agent memiliki maxTurns dan timeoutSeconds null. QA memiliki maxTurns Claude dan timeout dalam prosa; ini bukan jaminan hard kill server. Semua agent diminta laporan ringkas, tetapi belum mempunyai batas keluaran atau amplop bukti bersama.

**Perbaikan:** tetapkan batas kerja berdasarkan tugas, dengan status “selesai / sebagian / terhalang” dan alasan. Seragamkan konteks masukan: tujuan, scope, base SHA, kandidat yang diperiksa, artefak relevan, dan aturan verifikasi. Seragamkan keluaran: simpulan, bukti, keyakinan, cakupan belum diperiksa, serta langkah berikutnya. Nilai batas waktunya dari hasil pengukuran, bukan angka tebakan.

## Kekuatan infrastruktur yang perlu dipertahankan

- Seed idempoten, menghormati tombstone, dan pembaruan instruksi memperhatikan suntingan operator: `server/src/services/builtin-agents.ts:64`.
- Definisi child native dan roster parent ringkas menjaga pemisahan konteks di kedua runtime.
- Enam agent berpolicy read-only; dua agent QA memakai isolasi worktree. Ketiadaan kemampuan tulis bukan hanya permintaan dalam prompt.
- Semua builtin adalah daun dengan mentions kosong, sehingga tidak menciptakan rantai delegasi builtin yang tidak diperlukan.
- Lifecycle, hasil, disposition, dan nilai token/durasi nullable sudah menjadi fondasi observabilitas yang berguna.
- Evaluasi mempunyai kasus positif dan kontrol untuk setiap agent, atribusi hasil child, serta perlindungan checkout sumber. Perbaikannya perlu memperkuat fondasi ini.

## Rekomendasi keputusan operator

1. **Pertahankan tiga default saat ini.** Jangan menaikkan model atau menambah agent baru sebelum bukti manfaat tersedia.
2. **Dahulukan perbaikan root-causer, seleksi lintas flow, dan kesetaraan evaluator dengan produksi.** Ketiganya memengaruhi apakah mandat agent dapat dijalankan dan dibuktikan.
3. **Revisi prompt QA/edge-case/spec-auditor.** Pertahankan tuntutan bukti, perbaiki klaim absolutnya.
4. **Lanjutkan uji opt-in terukur:** QA pada perubahan berisiko, dep-auditor pada manifest/lockfile, spec-auditor pada acceptance criteria, edge-case pada kontrak yang membutuhkan test tambahan.
5. **Baru putuskan perubahan default/model dari data:** temuan diterima, false positive, waktu/token, dan kerja ulang parent.

## Verifikasi audit

Perintah test yang dijalankan:

```sh
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS \
  TEST_DATABASE_URL="file:$(mktemp -d /tmp/hanoman-builtin-audit-tests.XXXXXX)/t.test.db" \
  pnpm vitest --run --no-file-parallelism \
  shared/test/builtin-agents.test.ts \
  runner/test/custom-agents.test.ts \
  runner/test/agent-readonly.test.ts \
  runner/test/codex-agent-config.test.ts \
  runner/test/custom-agent-eval.test.ts \
  server/test/builtin-agents.test.ts \
  server/test/custom-agent-selection.test.ts
```

Hasil: **7 berkas lulus, 109 test lulus**, durasi 7,58 detik. Test harness menggunakan executor uji; tidak memanggil layanan model. DB test dibuat terpisah dari DB operasional.

Probe tambahan menjalankan `readOnlyDecision`, `selectAgentRows`, dan `scoreAgentEvalCase` melalui `pnpm exec tsx --input-type=module -e`; hasilnya dicatat pada tabel di atas. Kelulusan test berarti perilaku yang saat ini dikunci test konsisten, bukan bahwa semua mandat agent sudah terbukti efektif.

Tidak ada perubahan kode/endpoint, sehingga typecheck paket dan smoke endpoint tidak diperlukan untuk perubahan laporan ini. Audit menghasilkan dokumen ini dan satu tautan index; rekomendasi menunggu keputusan tindak lanjut.

## Tindak lanjut implementasi — 5 September 2026

Pengguna mengotorisasi seluruh perbaikan setelah audit. Kontrak akhir ada di
[spec tindak lanjut](../../../docs/superpowers/specs/2026-09-05-custom-agent-audit-followup.md) dan
[plan](../../../docs/superpowers/plans/2026-09-05-custom-agent-audit-followup.md); keputusan produk
dicatat pada amandemen [ADR-0159](../adr/0159-custom-agent-native-terukur-terisolasi.md).

| Area audit | Perbaikan akhir |
|---|---|
| Diagnosis vs policy | Root-causer default mendiagnosis statis, menandai hipotesis, dan menyerahkan rencana eksperimen; override isolated mengizinkan eksperimen di worktree. Hook tidak diperlonggar. |
| Ketersediaan sepanjang sesi | Registry memuat agent enabled yang kompatibel. Parent menilai kebutuhan dari fase/diff terbaru sebelum delegasi. Versi Codex yang tidak didukung dan isolated Codex tetap unavailable. |
| Delapan prompt | Reuse peta scout; prioritas dampak/keyakinan blast; test preservasi boleh hijau; spec dinilai pada keadaan akhir/base; security dan dep membedakan bukti dari unknown. |
| Handoff dan batas | Tujuan, scope, base SHA, kandidat dirty, bukti terdahulu, aturan verifikasi; hasil berstatus, berjangkar, dengan keyakinan dan bagian belum diperiksa. Cap awal scout 20, auditor 30, root/QA/edge 40; timeout QA tetap instruksional. |
| Evaluator | 20 fixture, JSON evidence terstruktur, jangkar aktual, dan sumber advisory/lisensi lokal terkunci. QA/edge memakai artefak JSON tervalidasi serta replay kode fixture immutable pada base/kandidat/mutant. |
| Identitas hasil | Hash artefak native efektif + policy + profil diketahui dibekukan dari roster; termasuk model/effort warisan dan roster asli saat materialisasi parsial. Payload child tidak dipercaya untuk identitas. |
| Metrik dan UI | Varian runtime/model/hash, nullable rework, contoh pending/dinilai/rework per-agent, token terpisah, dan pembedaan data kosong/kegagalan memuat/observasi relay. |
| Isolasi event | Spool dipisah ke `<HANOMAN_HOME>/session-events`; server sementara tidak lagi mengonsumsi antrean home lain. |

Default aktif tetap scout/blast-radius/security-reviewer dan model bawaan tetap. Seed hanya
memperbarui definisi yang belum disunting; saklar, override, dan tombstone operator dipertahankan.
Tidak ada benchmark yang dipakai untuk mengklaim pilihan model atau cap baru sudah optimal.

### Bukti verifikasi tindak lanjut

- Verifikasi integrasi akhir: 20 berkas, **296 test lulus**, server serial dengan HANOMAN_HOME dan DB
  sementara terpisah. Pengujian mencakup prompt, runtime/seed/sync, hook, evaluator, metadata
  tmux, lifecycle/auth API, spool, metrik, dan UI.
- Typecheck shared, runner, server, dan frontend lulus pada konfigurasi akhir. Evaluator 25/25
  juga lulus pada run terarah, terpisah dari model live; lihat catatan live di bawah.
- Migrasi diterapkan pada DB sementara. Server HTTP lokal + curl membuktikan daftar 8 agent,
  varian/hash/samples, PATCH disposition+rework, dan 401 tanpa autentikasi. Setelah perbaikan
  spool, server uji menunjukkan lastDeliveryAt null dan nol event dibuang tanpa producer uji.
- Review independen prompt/availability, observabilitas, serta evaluator/integrasi diselesaikan;
  temuan hash efektif, sample starvation, integritas source pada jalur error, dan ID duplicate
  ekuivalen diperbaiki.
- Full suite, deploy, merge, dan pembaruan DB operasional tidak dijalankan.

### Batas bukti dan catatan operasional

Kelima fixture QA/edge tetap teruji melalui replay offline. Live QA/edge tidak tersedia dalam
harness restricted saat ini; Codex juga tidak mendukung policy isolated-worktree dalam Hanoman.
Ini bukan bukti bahwa QA/edge tidak mampu bekerja dalam sesi produksi Claude. Replay menguji
test berbasis data, bukan kualitas penulisan semua bentuk kode test.

Codex lokal tidak dapat diprobe karena wrapper npm kehilangan executable vendornya (ENOENT).
Gerbang versi menghentikan live eval; instalasi CLI global tidak diubah.

Uji Claude 2.1.261 mengungkap dua lapis pembatas alat parent yang diwariskan child. Perbaikan
membuka hanya Task/Read/Glob/Grep pada daftar alat dan permission allowlist, tetap restricted+plan
tanpa Bash/Write/Edit. Percobaan berikutnya membuktikan child dapat membaca dan menemukan
cermin tertinggal, tetapi skor tetap gagal karena format prosa/claim tidak mematuhi kontrak JSON.
Kontrak format evaluasi kemudian dipasang langsung pada child. **Hasil live terakhir tetap FAIL**
(scout-positive, Claude 2.1.261/haiku): lifecycle start-stop lengkap, proses exit 0, verdict
`mirror-stale` dan kedua jangkar benar, tetapi respons masih berupa prosa + blok JSON sehingga
tidak memenuhi amplop JSON murni. Recall scorer ketat 0; ini kegagalan kepatuhan format, bukan
bukti scout tidak menemukan masalah. Hash checkout sebelum/sesudah sama pada seluruh percobaan.
Report membedakan hash definisi produksi/evaluasi/protokol. Tidak ada skor gagal yang diubah
menjadi pass melalui pelonggaran parser, dan tidak ada benchmark live seluruh delapan agent.

Artefak verifikasi lokal tersimpan di
`../hanoman-agent-audit-20260905/` terhadap direktori checkout utama: report JSON keempat
percobaan Claude, log test akhir, dan log typecheck. Report native tetap di luar checkout sumber.

**Catatan smoke awal:** meskipun DB/HANOMAN_HOME sudah sementara, root spool lama ternyata global
di tmpdir. Server uji sempat menunjukkan pengiriman event tanpa producer fixture; ia segera
dihentikan. DB uji hanya berisi invocation sintetis yang sengaja dibuat dan tidak memiliki
LeadDecision. Jenis/jumlah event antrean yang mungkin terambil tidak dapat direkonstruksi dari
observasi tersebut; DB operasional tidak ditulis. Temuan ini memicu perbaikan namespace spool
dan uji ulang. Antrean legacy tidak dimigrasikan otomatis karena kepemilikan instalasinya tidak
tercatat; tuntaskan sesi sandbox lama atau mulai ulang dengan env spool baru saat menerapkan
versi ini.
