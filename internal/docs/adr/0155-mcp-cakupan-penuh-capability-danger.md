# ADR-0155 — Capability berakses `danger`: batas yang nyata untuk operasi yang menjalankan sesuatu

Tanggal: 2026-08-25
Status: diterima
SPEC: — (dikerjakan langsung dari design `docs/superpowers/specs/2026-08-25-mcp-cakupan-penuh-design.md`)
**Mengamandemen ADR-0099 §4** (batas tool MCP) dan **ADR-0065** (kosakata capability agent token)
Terkait: ADR-0088 & SPEC-405 (prefix dipetakan tanpa melihat method) · ADR-0091 (domain `lead` tersendiri) · ADR-0094 (`agents` dipetakan menurut method) · ADR-0097 (permukaan kredensial cookie-only) · ADR-0112 (`scheduler/crons` cookie-only) · SPEC-360 (`branches` sengaja bukan anggota `IDE_SUBS`) · SPEC-491 (Telegram diam total)

## Konteks

MCP hanoman (ADR-0099) mengekspos 17 tool dari 259 endpoint REST — ±6,6 % permukaan. Batas itu
disengaja: §4 menolak `POST /terminal/sessions`, seluruh `/api/vps*`, `POST /specs/:id/integrate`,
`DELETE /specs/:id`, dan `PATCH /specs/:id {stage}` karena semuanya **menjalankan sesuatu**.

Tetapi menolaknya **di katalog MCP** tak menutup apa pun. Kelima permukaan itu sudah terjangkau
agent token lewat REST hari ini: `capabilityForRoute` memetakannya ke `sessions:write`,
`vps:write`, dan `backlog:write` — capability yang rutin dicentang untuk pekerjaan sehari-hari.
Agen yang memegang token semacam itu tinggal memakai `curl`. Yang hilang bukan kemampuannya,
melainkan skema yang membimbing, redaksi token, dan pemotongan JSON yang sah.

Dengan kata lain: ADR-0099 §4 memasang gerbang di tempat yang tak dilewati siapa pun.

## Keputusan

### 1. Batasnya pindah ke capability, bukan ke ketiadaan tool

Empat operasi paling tajam dipecah dari `:write` menjadi capability tersendiri berakses **`danger`**
— akses ketiga di `zCapabilityInfo`, di samping `read` dan `write`:

| Capability | risk | Route |
|---|---|---|
| `sessions:spawn` | `rce` | `POST /terminal/sessions` |
| `ide:git` | `exec` | `POST /projects/:id/git{,/merge,/rebase,/pull,/drop}`, `branches/delete`, `worktrees/delete` |
| `backlog:lifecycle` | `exec` | `DELETE /specs/:id`, `POST /specs/:id/integrate`, `PATCH /specs/:id {stage}` |
| `vps:exec` | `exec` | `console`, `session`, `audit`, `probe`, `test`, `harden`, `provision{,/preview}`, `remediate{,/preview}` |

**`grantsCapability` tidak diubah aturannya.** `:write` mengimplikasikan `:read` dan itu saja; akses
`danger` tak diimplikasikan apa pun. Kalau diimplikasikan `:write`, seluruh ADR ini kosmetik — dan
itulah yang diuji lebih dulu, sebelum satu pun route dipindahkan.

Tak ada perubahan skema Prisma: `AgentToken.capabilities` bertipe `Json`.

### 2. HANYA tulisan yang merusak yang pindah; seluruh pembacaan tetap di tempatnya

Ini bukan detail. Cabang berbasis prefix adalah kelas bug SPEC-405, dan ia selalu menyeret lebih
banyak dari yang dimaksud. Karena itu:

- `POST /terminal/sessions` dicocokkan ke **panjang segmen persis** (`seg.length === 2`), bukan
  prefix — `/terminal/sessions/:id/steer` berawalan sama dan tetap `sessions:write`.
- `branches` **tetap bukan anggota `IDE_SUBS`** (SPEC-360): `GET /projects/:id/branches` dan
  `/branches/unused` tetap `projects:read`. Yang pindah hanya `POST /branches/delete`. Konsekuensi
  yang disadari: mendaftar branch adalah permukaan `projects`, menghapusnya permukaan `ide` — asimetri
  yang disengaja, karena alternatifnya adalah mengubah endpoint lama diam-diam.
- `GET /projects/:id/worktrees` dan `/worktrees/stats` tetap `ide:read`.
- `GET /vps/components` tak punya `seg[2]` sehingga jatuh ke `vps:read`; `items/na`, `items/na-bulk`,
  `items/:id/attest` tetap `vps:write`.

Test `server/test/agent-capabilities.test.ts` menjaga **dua sisi**: yang berbahaya benar-benar
pindah, DAN tetangganya tidak ikut. Sisi kedua yang paling mudah rusak.

### 3. `PATCH /specs/:id {stage}` digerbangi di HANDLER, bukan di `capabilityForRoute`

`capabilityForRoute` adalah fungsi murni `(method, path)`. Kemurnian itu bukan estetika: ia yang
membuat uji kontrak katalog MCP mungkin — tiap tool menyimpan `samplePath`/`sampleMethod` dan test
membuktikan capability yang diklaim tool sama dengan yang dituntut server. Mencabangkan fungsi itu
menurut body akan menghancurkan properti tersebut.

Karena itu `capabilityForRoute` tetap memetakan `PATCH /specs/:id` → `backlog:write`, dan gerbang
`backlog:lifecycle` dipasang di dalam handler `routes/specs.ts`, berjalan hanya ketika
`body.stage !== undefined`, **sebelum** query apa pun sehingga penolakan tak punya efek samping.
Sesi cookie tak tersentuh (`req.agent` undefined), konsisten dengan model "cookie = akses penuh".

**Utang yang disadari:** gerbang ini tak terlihat uji kontrak mana pun. Penjaganya adalah
`server/test/specs-stage-gate.test.ts` — jangan hapus berkas itu.

### 4. Token yang sudah terbit DISEMPITKAN, tidak di-backfill

Migration tak menyentuh satu baris token pun. Token ber-`sessions:write` berhenti bisa membuka sesi
sampai manusia mencentang `sessions:spawn`. Hak berbahaya harus lahir dari tindakan sadar, bukan
diwarisi diam-diam.

Radius ledakannya nyata: `TELEGRAM_REQUIRED_CAPABILITIES` bertambah empat, dan `credentials.ts`
menolak **menyalakan** gateway bila satu pun kurang — bukan 403 per-panggilan, tapi gateway tak
jalan. Itu kelas kegagalan SPEC-491 ("Telegram diam total"). Yang menjinakkannya: kekurangannya
dilaporkan **dengan nama** lewat `telegramInboundReadiness`, dan panel Settings menyebut hak yang
HILANG dengan kalimat pada baris tokennya sendiri — checkbox kosong baru tak berbicara apa-apa
kepada orang yang tak membaca release note.

### 5. Grid Settings jadi empat kolom; sel kosong lebih jujur daripada checkbox palsu

`label | baca | tulis | berbahaya`. Kolom keempat hanya terisi untuk empat domain yang punya
pecahannya; delapan domain lain kosong di sana. Merender checkbox yang tak memetakan ke capability
mana pun akan membuat grid berbohong tentang apa yang bisa diberikan.

### 6. Tiga tingkat mode CLI, dan ia BUKAN kontrol keamanan

`--read-only` → *(default)* → `--danger` / `HANOMAN_MCP_DANGER=1`. Yang lebih sempit selalu menang
apa pun urutan argumen, dan memberi keduanya sekaligus **mengeluh** alih-alih diam — memilih yang
lebih longgar diam-diam adalah cara paling mudah membuat seseorang menyalakan permukaan berbahaya
tanpa sadar.

Mengikuti ADR-0099 §5: tingkat yang lebih rendah **menghilangkan** tool dari `tools/list`, bukan
menolaknya saat dipanggil. Tool yang tak terlihat tak bisa dicoba.

**Ditulis di tiga tempat sekaligus** karena kekeliruan ini menular: di `MCP_INSTRUCTIONS`, di
keluaran `hanoman_about` (`modeNote`), dan di kartu "MCP server" panel Settings — tingkat mode
menentukan tool mana yang **terlihat**; yang menahan sungguhan adalah capability pada token. Sebuah
tool bisa terlihat dan tetap menjawab 403.

Catatan kecil yang mudah dilanggar: kalimat `modeNote` sengaja **tak memuat kata "token"**. Uji
`hanoman_about` melarang kata itu muncul di mana pun dalam balasannya, dan larangan itulah yang
menjaga rahasia tak pernah bocor lewat pintu tersebut.

### 7. Katalog dipecah per domain, dan dua gerbang menjaganya

`shared/src/mcp-catalog.ts` (378 baris) menjadi `shared/src/mcp-catalog/` dengan satu berkas per
domain. Entri dipindahkan **apa adanya lewat skrip**, bukan diketik ulang: 17 test katalog lulus
tanpa satu assert pun diubah, dan itulah buktinya perilaku tak berubah.

Dua gerbang anti-drift lahir bersamanya:

1. **mode ⇔ capability** (`shared/src/mcp-catalog.test.ts`) — tool bercapability `danger` wajib
   bermode `danger`, dan sebaliknya kecuali daftar-kecuali eksplisit `DESTRUCTIVE_BUT_WRITE` untuk
   tool yang destruktif tapi domainnya tak punya pecahan `danger`.
2. **cakupan** (`server/test/mcp-coverage.test.ts`) — inventaris route dibaca dari **sumber**
   `server/src/routes/**`, bukan dari daftar tangan, lalu dicocokkan dengan katalog. Endpoint baru
   yang terjangkau agent token tapi lupa dibungkus akan menggagalkan test. Berkas ini satu-satunya
   tempat katalog (`shared`), peta capability (`server`), dan route itu sendiri bertemu.

Terukur saat gerbang kedua dipasang: **258 route, 166 terjangkau agent token, 86 cookie-only, 151
belum terbungkus**. Assert utamanya di-skip sampai katalog lengkap — melonggarkannya alih-alih
men-skip akan membuat gerbang itu bohong selamanya. Kontrol negatifnya tetap aktif, jadi gerbang
yang berhenti mendeteksi apa pun akan ketahuan.

### 8. Katalog: 151 tool, cakupan PENUH, dan yang tetap di luar

Terukur dari CLI nyata (`tools/list`): **`--read-only` 62 · default 117 · `--danger` 151**, jadi
**34 tool bermode `danger`**. Gerbang cakupan `server/test/mcp-coverage.test.ts` hijau **tanpa
skip**: setiap route yang terjangkau agent token punya tool, tercakup tool bercabang (dicatat
dengan NAMA tool-nya, dan nama itu diverifikasi ada), atau terdaftar dikecualikan dengan alasan.

**Yang tetap di luar katalog, dan alasannya masing-masing:**

| Yang dikecualikan | Alasan |
|---|---|
| `GET`/`PUT /telegram/settings`, `POST /telegram/test`, `DELETE /telegram/credentials` | permukaan kredensial, COOKIE_ONLY (ADR-0097) |
| `GET /terminal/sessions/:id/dialog`, `dialog/answer`, `dialog/takeover` | gerbang keputusan MANUSIA (SPEC-899 · ADR-0142): agen yang bisa menjawab `AskUserQuestion` bisa menjawab pertanyaannya sendiri |
| enam route `scheduler/crons*` | COOKIE_ONLY (ADR-0112): cron adalah `POST /terminal/sessions` yang ditunda |
| `POST /specs/:id/attachments`, `POST /projects/:id/upload`, `POST /terminal/sessions/:id/attachments` | multipart |
| `GET /projects/:id/archive`, dua unduhan lampiran | biner |
| `GET /terminal/sessions/:id/ws` | WebSocket, bukan request-response |
| field `password` pada VPS create/update | kredensial transien; ADR-0097 menetapkan permukaan kredensial bukan wilayah agent token |

Satu asimetri yang mudah "diperbaiki" keliru: `hanoman_ide_branches_unused` menuntut
`projects:read`, bukan `ide:read`. `branches` sengaja bukan anggota `IDE_SUBS` (SPEC-360) — daftar
branch adalah permukaan project, dan hanya `branches/delete` yang pindah ke `ide:git`.

Dua tool menuntut capability yang BERBEDA dari yang ditegakkan server, dan keduanya disengaja
karena gerbangnya tak hidup di `capabilityForRoute`:

- `hanoman_backlog_stage_set` → katalog menyebut `backlog:write`; server menuntut
  `backlog:lifecycle` lewat gerbang handler. Terbukti ujung-ke-ujung: dipanggil lewat MCP dengan
  token ber-`backlog:write`, balasannya menyebut `backlog:lifecycle`.
- `hanoman_session_integrate` → `sessions:write`, karena ia hidup di bawah prefix `terminal` dan
  tak ada `sessions:integrate`.

Menaikkan nilai capability keduanya di katalog akan MEMBUAT uji kontrak merah, bukan memperbaiki
keamanan. Deskripsi tool-lah yang memberitahu agen capability apa yang sebenarnya dituntut.

## Konsekuensi

- **Breaking change bagi setiap agent token yang sudah terbit** yang mengandalkan `sessions:write`,
  `ide:write`, `backlog:write`, atau `vps:write` untuk operasi berbahaya. 403-nya menyebut
  capability yang kurang (`checkAgentCapability` sudah mengembalikan `need`), jadi kegagalannya
  bisa dibaca — tapi ia tetap kegagalan.
- Gateway Telegram **tidak menyala** sampai keempat kotak dicentang.
- Tripwire jumlah capability di `server/test/agent-tokens.route.test.ts` naik 24 → 28.
- `zCapabilityInfo.access` melebar, jadi konsumen mana pun yang mengasumsikan dua nilai akan
  terkoreksi oleh tipe.
- Tak ada endpoint REST baru, tak ada migration, tak ada perubahan skema.
- `McpConfig.readOnly` → `McpConfig.level`; `mcpToolsFor(readOnly: boolean)` → `mcpToolsFor(level)`.
  Pemanggilnya hanya CLI dan test.
- `McpRequest.method` melebar ke PUT & DELETE; `zCapabilityInfo.access` melebar ke tiga nilai.

## Yang TIDAK diputuskan di sini

- Katalog MCP itu sendiri. Tool untuk permukaan yang kini terjangkau lahir di rencana terpisah
  (`docs/superpowers/plans/2026-08-25-mcp-2..6-*.md`), bersama tingkat mode ketiga `--danger` di CLI.
  ADR ini hanya memasang batasnya.
- `projects:destroy`. `DELETE /projects/:id` dan `POST /:id/rename` tetap `projects:write`.
- Membuka `scheduler/crons`, `webhooks`, `portal`, `sync`, atau permukaan `COOKIE_ONLY` lain.
  Semuanya menuntut ADR-nya sendiri; `crons` khususnya adalah `POST /terminal/sessions` yang
  ditunda (ADR-0112).

## Amandemen 2026-08-26 — "pilih semua" per kolom

Grid empat kolomnya mendapat checkbox **pilih semua**: satu global di sel kiri header, satu per
kolom (`baca`, `tulis`, `berbahaya`). Bekerja atas himpunan id yang benar-benar ada di katalog,
bukan hasil kali domain×akses — kolom `berbahaya` hanya terisi untuk empat domain, jadi memilihnya
berarti empat capability, bukan satu per domain. Tri-state: *indeterminate* saat kolomnya setengah
terisi, supaya kolom yang sebagian tercentang tak terbaca kosong. Tak mengubah satu pun keputusan
di atas — hanya menghapus alasan orang memberi token capability seadanya karena malas mencentang
tiga puluhan kotak.
