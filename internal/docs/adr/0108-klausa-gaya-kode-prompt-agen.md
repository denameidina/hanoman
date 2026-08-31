# ADR-0108 — Klausa gaya kode: satu konstanta di setiap prompt agen, tanpa knob

- Status: Accepted
- Tanggal: 2026-08-06
- SPEC: SPEC-543 (brief, prioritas sedang)
- Terkait: memperluas pola klausa prompt [0080](0080-scope-verifikasi-per-sesi.md); menjangkau
  [0094](0094-custom-agent-katalog-materialisasi-native.md) (prompt custom agent),
  [0091](0091-hanoman-lead-agen-pemimpin.md) & [0105](0105-changelog-per-project.md) (titik spawn
  agen kedua). [0037](0037-cabut-guardrail-safety.md) tetap utuh — tak ada hook deny yang
  dihidupkan kembali. [0024](0024-sesi-interaktif-menggantikan-run.md),
  [0098](0098-putusan-lead-ringkas-terstruktur.md) utuh.

## Konteks

Kode yang dihasilkan sesi agen hanoman sering memuat komentar yang cuma mengulang apa yang sudah
dinyatakan kode di baris berikutnya — nama fungsi diulang di atas fungsinya, ekspresi diterjemahkan
kembali ke bahasa Indonesia, langkah demi langkah dinarasikan, pembatas seksi berhiasan dipasang di
antara blok. Hasilnya berisik, cepat basi (komentar tak ikut di-refactor), dan menambah beban
review.

Sebabnya sama persis dengan lubang yang ditutup ADR-0080 untuk scope verifikasi: **prompt sesi tak
pernah menyebut gaya kode sama sekali.** `runner/src/prompt.ts` bicara fase, otonomi, skill, scope
verifikasi, commit, dan push. Karena ia diam soal bentuk kode, tiap sesi jatuh ke kebiasaan default
modelnya, dan kebiasaan default itu adalah menjelaskan diri sendiri.

Ironisnya repo ini punya konvensi yang **berlawanan arah** dengan kebiasaan itu, dan konvensi itu
tak pernah dinyatakan ke agen mana pun. Komentar di `runner/src/verify-scope.ts`,
`server/src/services/lead/brain.ts`, dan `runner/src/custom-agents.ts` panjang bukan karena mereka
menarasikan kode, melainkan karena mereka merekam hal yang **tak terbaca dari kode**: alasan sebuah
keputusan, angka yang terukur di lapangan, rujukan SPEC/ADR sebuah workaround. Aturan yang berlaku
di sini bukan "sedikit komentar" melainkan "komentar yang membawa informasi yang tak ada di kode".

## Keputusan

1. **Satu konstanta, satu berkas.** `CODE_STYLE_CLAUSE` di `runner/src/code-style.ts`, diekspor
   dari `@hanoman/runner` — cermin `verify-scope.ts`. Sengaja **bukan** fungsi ber-parameter:
   tak ada nilai yang bisa mengubah isinya (lihat keputusan 4).

2. **Gerbangnya ada DI DALAM teks klausa**, di baris pertamanya: klausa berlaku *setiap kali agen
   menulis atau mengubah kode*. Ini bukan gaya bahasa melainkan syarat agar keputusan 3 mungkin.
   Klausa yang sama dipasang di prompt yang keluarannya bukan kode (lead, narator changelog); tanpa
   gerbang tekstual itu satu konstanta harus bercabang jadi dua varian, dan dua varian yang harus
   tetap sepakat adalah kelas bug "satu definisi, N call site" yang sudah dibayar hanoman empat kali
   (SPEC-431/448/475/481) — kali ini dalam bentuk teks, yang bahkan tak punya tipe yang memaksanya
   konsisten.

3. **Dipasang di SEMUA titik prompt agen, bukan hanya yang menulis kode.** hanoman punya dua titik
   spawn agen (`services/pty.ts` dan `services/lead/brain.ts`), dan yang kedua adalah yang selalu
   terlewat (SPEC-448: `rootBypassEnv` tak pernah menyeberang ke sana selama berbulan-bulan).
   Daftarnya:

   | Prompt | Gerbang |
   | --- | --- |
   | `startPrompt` · `continuePrompt` · `resumePrompt` · `startGoalPrompt` | `writesCode(flow)` yang sudah ada — sumber kebenaran yang sama dengan `scopeClause` |
   | Tiga pintu konflik rebase/merge (`POST /specs/:id/integrate`, `finishGraphOp`, `POST /terminal/sessions/:id/integrate`) | tanpa gerbang — menyelesaikan konflik selalu berarti menyunting kode |
   | `agentPromptOf` (custom agent, `claude --agents`) | tanpa gerbang |
   | `leadPrompt` · `changelogPrompt` | tanpa gerbang; gerbangnya baris pertama klausa |

   **Amandemen ADR-0159:** persona Codex inline sudah dicabut. `agentPromptOf` sekarang mengirim
   klausa ke developer instructions child native **kedua runtime**, karena keduanya berkonteks
   terpisah. Prompt parent hanya mendapat klausa delegasi ringkas dan tidak mengulang full prompt.

4. **Tanpa `Setting`, tanpa kolom, tanpa endpoint, tanpa override per sesi.** Perbedaan sadar dari
   ADR-0080: scope verifikasi punya knob karena biayanya nyata dan berbeda per mesin dan per
   perubahan — ada keadaan di mana `full` benar. Gaya kode tak punya sumbu biaya seperti itu;
   "sesi ini boleh menulis komentar yang mengulang kode" bukan pilihan yang masuk akal untuk
   ditawarkan, dan knob yang tak pernah benar untuk digeser hanyalah permukaan konfigurasi yang
   harus dijaga selamanya.

5. **Mengarahkan, bukan memaksa.** Tak ada hook `PreToolUse`, tak ada linter yang menolak commit,
   tak ada gate. ADR-0037 tetap utuh, dengan preseden ADR-0080 & ADR-0073 yang menambah klausa/hook
   tanpa mencabutnya. Yang diubah adalah default yang diikuti agen saat prompt tak berkata apa-apa.

Isi klausanya lima butir: (1) tulis kode yang rapi dan mengikuti idiom, penamaan, serta struktur
kode di sekitarnya; (2) jangan menulis komentar yang mengulang apa yang sudah dinyatakan kode;
(3) komentar hanya untuk yang tak terbaca dari kode — alasan/why, trade-off, workaround beserta
rujukan SPEC/ADR-nya, invariant yang tak kelihatan; (4) tanpa komentar pembatas seksi, header
berhiasan, atau narasi langkah demi langkah; (5) tanpa kode mati / kode yang dikomentari.

## Konsekuensi

- **Positif:** nol migration, nol tabel, nol endpoint, nol knob. Kalimatnya diubah di satu berkas
  dan seluruh permukaan ikut. Karena prompt sesi diserahkan sebagai **argumen positional** agen
  (SPEC-223), klausa benar-benar hidup di ARGV proses — sehingga "ia terkirim" bisa dibuktikan
  dengan membaca pane tmux sesi sungguhan, bukan hanya dengan memanggil builder prompt-nya.
- **Jangkauan berhenti di terminal biasa.** Sesi agen tanpa `flow` lahir **tanpa prompt** (manusia
  yang mengetik), persis batas yang sudah dinyatakan ADR-0080. Untuk claude, celah itu tertutup
  sebagian: custom agent tetap menerima klausa lewat `--agents` walau sesi induknya tak berprompt.
- **Flow dokumen tak menerimanya** (audit, prd, breakdown, reverse, scaffold) — cermin keputusan 4
  ADR-0080: mereka tak menulis kode, jadi klausanya hanya menambah token.
- **Prompt bertambah beberapa baris.** Untuk lead itu tampak bertabrakan dengan ADR-0098, tapi yang
  dibatasi ADR-0098 adalah panjang **keluaran** (`decision`/`reason`), bukan panjang prompt — dan
  gerbang di baris pertama membuat klausanya tak menyala saat lead sekadar memutuskan.
- **Reversibilitas:** hapus satu berkas dan call site-nya; tak ada data yang tertinggal.

## Gotcha wajib

- **Klausa ini adalah muatan `pkill -f`.** Prompt sesi hidup di ARGV agennya, jadi kata apa pun di
  dalamnya bisa dicocoki pola `pkill` milik sesi tetangga — sebab persis SPEC-402, yang di sana
  dipicu oleh `vitest`/`tsc` di dalam klausa scope. Jangan memasukkan nama perintah ke klausa ini.
- **Test "terkirim" wajib membaca pane, bukan builder.** Memanggil `startPrompt()` lalu meng-assert
  isinya hanya membuktikan builder-nya; celah yang dikhawatirkan justru **call site yang lupa
  memanggilnya**. Buktinya harus datang dari sesi tmux sungguhan (pola `fixtures/fake-agent-env.sh`,
  SPEC-376/SPEC-337).
- **Klausa TIDAK melarang komentar.** hanoman sendiri bergantung pada komentar ber-rujukan SPEC/ADR
  di titik-titik cekiknya; klausa yang terbaca sebagai "kurangi komentar" akan menghapus justru
  informasi yang tak bisa dipulihkan dari kode. Yang dilarang adalah komentar yang **mengulang**
  kode.
- **Gerbangnya `writesCode(flow)`, bukan daftar flow yang ditulis ulang.** Menyalin daftarnya
  berarti dua definisi "sesi ini menulis kode" yang bisa berselisih saat flow baru lahir — persis
  yang dihindari SPEC-407 ketika `goal` ditambahkan ke predikat itu, bukan ke cabang if di
  `scopeClause`.
