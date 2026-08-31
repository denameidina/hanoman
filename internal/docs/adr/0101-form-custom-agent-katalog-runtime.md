# ADR-0101 — Form Custom Agent berbasis katalog: `runtime` sebagai penyaring, katalog tool turunan konfigurasi MCP

- Status: Accepted — konteks materialisasi Codex **diamandemen ADR-0159**
- Tanggal: 2026-08-01
- SPEC: SPEC-484 (form Custom Agent: dropdown tools/model/mention + runtime)
- Terkait: **memperluas** [0094](0094-custom-agent-katalog-materialisasi-native.md) — katalog, anti-loop
  tiga lapis, dan materialisasi per agen tetap utuh; yang ditambah hanya satu kolom penyaring dan satu
  sumber daftar; **memperluas** [0074](0074-codex-sebagai-mesin-sesi.md) — `Agent` kini juga menjadi
  sumbu di katalog persona, bukan hanya di kelahiran sesi; **mengikuti** [0045](0045-skema-sync-synclog-version-stamp.md)
  (kolom baru wajib ikut `FIELDS`) dan [0065](0065-ai-agent-capability-agent-token.md) (endpoint baru
  dipetakan menurut method); **tidak menyentuh** [0037](0037-cabut-guardrail-safety.md) — validasi di
  sini adalah gerbang **bentuk data** di route CRUD, bukan hook deny di sesi agen;
  **diamandemen** [0159](0159-custom-agent-native-terukur-terisolasi.md): `runtime` tetap penyaring,
  tetapi kedua sisi sekarang memakai child native.

> **Amandemen 2026-08-31:** penyebutan roster Codex inline di bawah adalah konteks historis.
> Runtime tetap field penyaring persis seperti keputusan ini; yang berubah hanya targetnya menjadi
> konfigurasi custom agent native Codex di tmpdir sesi.

## Konteks

Form Custom Agent lahir bersama ADR-0094 dengan tiga field bebas-ketik — `tools`, `model`, `mentions`
— padahal ketiganya punya sumber data pasti. Biayanya bukan estetika melainkan kelas kegagalan yang
sudah diukur di ADR-0094 sendiri: **M4 — nama tool yang tak dikenal dibuang claude tanpa satu pun
pesan.** Operator yang mengetik `read, bash` (huruf kecil) mendapat agen **tanpa alat apa pun**, exit
0, sesi jalan, tak ada keluhan. Salah ketik pada `model` bermuara ke tempat yang sama.

Field keempat belum ada sama sekali. hanoman punya **dua** mesin sesi (ADR-0074) dan ADR-0094
sengaja memberi keduanya materialisasi yang **berbeda** — claude mendapat subagent sungguhan lewat
`--agents`, codex mendapat blok roster prosa yang diadopsi **inline**. Persona yang ditulis untuk
salah satu mesin karena itu tetap disodorkan ke keduanya, dan tak ada cara menyatakan "yang ini
memang untuk claude".

## Keputusan

**1. `CustomAgent.runtime` adalah kolom NULLABLE, dan `null` berarti "ikut sesi induk".**
`null` = dipakai sesi claude **maupun** codex (perilaku ADR-0094 apa adanya); `"claude"`/`"codex"` =
hanya dimaterialisasi di sesi mesin itu. Nullable **tanpa default** dipilih supaya migration tak
perlu backfill: setiap baris yang sudah ada tetap berperilaku persis seperti sebelum ADR ini. Nilai
di luar `AGENT_RUNTIMES` (mis. dari client versi lebih baru lewat sync) dibaca sebagai `null` —
katalog persona tak pernah boleh menyusut habis karena satu string asing.

**2. Runtime adalah PENYARING, bukan pemilih biner.** Ia menyaring **apa yang masuk roster** sesi,
bukan menentukan proses mana yang dijalankan. Custom agent claude adalah subagent **di dalam proses
yang sama**; melahirkan codex dari dalam sesi claude akan menjadi **titik spawn ketiga**, dan
SPEC-448 sudah membuktikan bahwa setiap pelajaran spawn di repo ini dibayar ulang di tiap titik.
Penyaringnya hidup di `agentDefsFor(projectId, agent)` — di belakang `registerCustomAgentSource`,
jadi `pty.ts` tetap nol dependensi DB dan titik cekik `createSession` tetap satu-satunya pintu
(ADR-0094 keputusan 7).

**3. Katalog tool = `DEFAULT_AGENT_TOOLS` + satu entri per SERVER MCP + pintasan `*`.** Nama tool
MCP yang sebenarnya hanya bisa diketahui dengan menyambung ke servernya — melahirkan proses, arah
yang ditolak keputusan 2. Yang **bisa** dibaca tanpa proses adalah nama servernya, dari tiga berkas
konfigurasi (`~/.claude.json` global + per-path, `<repoDir>/.mcp.json`, `~/.codex/config.toml`), dan
claude sendiri mengeja bentuk "semua tool dari satu server" sebagai `mcp__<server>__*` di pesan
validasi aturan izinnya. Semua pembacaan **gagal-terbuka**: berkas hilang/rusak → sumber itu
dilewati.

Katalog bawaannya **persis** `DEFAULT_AGENT_TOOLS`, bukan daftar kedua yang lebih panjang.
Menawarkan nama yang belum diukur (M4 membuang `TodoWrite` senyap) berarti menawarkan pilihan yang
**tidak melakukan apa-apa** — persis kegagalan yang ADR ini tutup. Memperluasnya kelak adalah
perubahan satu baris, **setelah** diukur.

**4. `*` disimpan sebagai `tools: ["*"]` dan di-EXPAND sebelum materialisasi — tidak pernah sebagai
`tools: null` maupun diteruskan apa adanya.** Tiga nilai yang berbeda dan wajib tetap berbeda:
`null` = "tak diisi" → `DEFAULT_AGENT_TOOLS`; `[]` = "sengaja tanpa tool"; `["*"]` = "semua tool yang
dikenal katalog". Ekspansinya terjadi di `agentDefsFor()`, **sebelum** `resolveTools()`, karena
ADR-0094 keputusan 5 lapis 2 menuntut hanoman selalu memancarkan `tools` **eksplisit**: meneruskan
`"*"` apa adanya membuat claude membuangnya senyap (agen tanpa alat), sementara menerjemahkannya jadi
"kosongkan `tools`" membuat agen mewarisi **seluruh** tool termasuk `Task` — dan lapis 2 lenyap tanpa
jejak (gotcha 5 ADR-0094). `runner/src/custom-agents.ts` karena itu **tak pernah melihat** `"*"` dan
tetap murni.

**5. Validasi katalog KERAS di server, tapi hanya atas field yang ADA di payload.** Nilai di luar
katalog ditolak `400` yang **menyebut nilainya**. Klausa kedua yang membuatnya bisa hidup:
`PATCH { enabled: false }` pada baris lama ber-`model` asing **tetap 200**, karena `model` tak ada di
payload itu. Tanpa klausa itu validasi keras akan mengunci saklar aktif/nonaktif setiap baris warisan
— gerbang yang menolak operasi yang tak menyentuh field bermasalah.

Satu pengecualian yang justru menegakkannya: `model` divalidasi **juga** saat hanya `runtime` yang
berubah. Menukar runtime bisa membuat model tersimpan jadi tak sah, dan menerimanya diam-diam
mengembalikan tepat kegagalan yang ADR ini tutup.

**6. Daftar mention TIDAK ikut endpoint katalog.** Ia sudah hidup di `GET /custom-agents?projectId=`
— lengkap dengan aturan project-menimpa-global. Dua sumber untuk satu daftar adalah cara dua daftar
mulai berbeda.

## Konsekuensi

- **Berbiaya nol saat tak dipakai.** Katalog kosong → argv sesi byte-identik dengan sebelum ADR ini;
  `runtime` null di semua baris → tak ada satu pun roster yang berubah.
- Nilai lama yang tak dikenal **tetap terbaca** (`GET` mengembalikannya apa adanya, UI menandainya
  chip invalid) tapi **tak bisa disimpan ulang apa adanya**. Konsekuensi sadar dari keputusan 5:
  definisi yang sah di mesin rekan (server MCP berbeda) harus diedit sebelum bisa disimpan di sini.
- `~/.claude.json` yang tak terbaca membuat katalog menyusut ke tool bawaan, dan validasi keras lalu
  menolak nilai MCP yang sebenarnya sah. Itu **terlihat** operator (pesannya menyebut nama yang
  ditolak), bukan senyap — pertukaran yang diterima ketimbang membuat kelahiran sesi bergantung pada
  keterbacaan berkas konfigurasi orang lain.
- Satu komponen DS baru (`MultiSelect`) masuk `ds/index.ts`. Ia **inline**, bukan portal: outside-click
  & focus-trap tak dibayar, dan opsinya ber-`role="option"` sehingga bisa diuji lewat `getByRole`
  alih-alih menembak `<span>` di dalam `<label>` seperti `Checkbox`/`Switch` DS.

## Gotcha yang wajib diingat

1. **`runtime` WAJIB masuk `FIELDS.customAgent`** (`server/src/services/sync.ts`) — kolom yang
   terlewat di `FIELDS` menyeberang sebagai **default palsu tanpa satu pun error** (kelas
   ADR-0090/0093, gotcha 7 ADR-0094). `PG_ORDER` tak berubah: tabelnya sudah ada di sana.
2. **Menyaring roster di `pty.ts` mengubah tanda tangan sumber yang mendaftarkan diri**
   (`registerCustomAgentSource: (projectId, agent) => AgentDef[]`). Nilai `agent` yang dipakai wajib
   `agentForDefs` — variabel yang **sudah** dihitung di sana untuk memutuskan roster codex. Membaca
   `Setting.agent` di lapis service alih-alih agen sesi yang sebenarnya mengulang bug SPEC-377 dalam
   bentuk baru: sesi bisa lahir dengan agen override per-request.
3. **`"*"` bercampur nama lain harus ditolak, bukan digabung.** "Semua tool DAN Read" tak punya makna
   yang berbeda dari "semua tool", dan menerimanya berarti dua representasi untuk satu keadaan —
   yang satu akan ter-expand, yang lain tidak, tergantung urutan.
4. **Validasi model bergantung pada runtime EFEKTIF**, yaitu `payload.runtime` bila ada, selain itu
   nilai baris yang tersimpan. Memakai `payload.runtime ?? null` membuat setiap `PATCH { model }`
   pada agen ber-runtime `codex` divalidasi terhadap gabungan katalog dan lolos untuk model claude.
5. **Sub-tabel TOML BUKAN server.** Terukur saat smoke pada `~/.codex/config.toml` nyata: satu
   server boleh punya sub-tabel (`[mcp_servers.context7.http_headers]`, `[mcp_servers.node_repl.env]`),
   dan regex yang mengizinkan titik di dalam nama melahirkan "server" palsu `context7.http_headers`
   → entri katalog `mcp__context7.http_headers__*` yang **tak pernah bisa ada**. Itu tepat kelas
   kegagalan yang ADR ini tutup — pilihan yang tidak melakukan apa-apa — hanya saja lahir dari sisi
   hanoman. Segmen tak berkutip karena itu berhenti di titik pertama; nama ber-titik yang sungguhan
   wajib berkutip di TOML dan ditangkap cabang berkutip. Sebelum perbaikan: 10 "server"; sesudah: 8.
6. **Migration ditulis tangan lalu `migrate deploy`.** `migrate dev` me-reset DB di bawah drift
   worktree tetangga, dan berkas DB itu dibagi seluruh worktree lewat `HANOMAN_HOME` (SPEC-479).
   `ALTER TABLE … ADD COLUMN "runtime" TEXT;` sah di SQLite justru karena kolomnya **nullable tanpa
   default** — larangan `DEFAULT CURRENT_TIMESTAMP` (ADR-0090) tak berlaku di sini.

## Alternatif yang ditolak

- **`runtime` wajib `claude|codex` + backfill semua baris lama ke `"claude"`.** Persis bunyi brief,
  dan lebih sederhana di kode. Ditolak karena rilisnya akan **mencabut seluruh roster dari sesi
  codex** tanpa satu pun operator memintanya — perubahan perilaku yang tak diminta, dibungkus sebagai
  perubahan form.
- **`runtime` sebagai label saja, tanpa menggerbangi apa pun.** Paling murah, tapi klausa brief
  "dipakai saat menjalankan sesi" jadi tak terpenuhi dan field itu menjadi dekorasi.
- **Menyambung ke tiap server MCP untuk mendapat nama tool sebenarnya.** Paling akurat. Ditolak: ia
  melahirkan proses dari server hanoman — arah yang ditolak ADR-0094, dan setiap titik spawn membayar
  ulang seluruh pelajaran SPEC-448 (stdin, gerbang root, env).
- **Katalog tool di-hardcode di komponen UI.** Ditolak oleh brief dan oleh kenyataan: daftar server
  MCP hidup di berkas konfigurasi mesin, yang hanya server bisa baca.
- **Validasi katalog lunak (terima lalu tandai).** Sejalan dengan presedens SPEC-339 ("katalog ini
  kurasi UI, bukan gerbang validasi") dan lebih ramah terhadap katalog MCP yang berbeda antar mesin.
  Ditolak operator: nilai yang salah ketik akan tetap tersimpan, dan gejalanya tetap muncul saat sesi
  berjalan — yakni bug yang sama, hanya dengan lencana.
