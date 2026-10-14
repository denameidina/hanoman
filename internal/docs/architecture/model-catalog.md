# Katalog model otomatis

Kontrak provider ketiga SPEC-1442 ditetapkan di
[runtime Antigravity](antigravity-runtime.md) dan [ADR-0221](../adr/0221-antigravity-cli-runtime-interaktif-native.md):
discovery parent `agy models` mengikuti cache/batas probe di bawah; picker child memakai tier
native publik `inherit|flash|pro` terpisah dari slug parent. Effort help CLI bukan bukti dukungan
effort per-model atau per-child. Default parent `gemini-3.8-flash-high`/`high` additive,
tanpa mengganti ownership user atau rekomendasi Claude/Codex existing. Bukti implementasinya
merupakan AC-03/04/05/12 SPEC-1442. Task 1 menambahkan helper parent minimal
`antigravityEfforts`: slug bersuffix `low|medium|high` hanya memberi level itu; slug unknown
menghasilkan opsi kosong. Picker Custom Agent memakai tuple child dan effort kosong, bukan
katalog parent. Nilai stored asing dipertahankan. Provider ketiga memakai probe/cache yang sama (Task 9); live smoke endpoint produk
dijadwalkan sekali di akhir pipeline, terpisah dari receipt parser/transport.

Hanoman menemukan model dari CLI terpasang saat startup dan setiap **5 menit**. Katalog bawaan
(fallback offline) claude hanya berisi alias native `default`, `opus`, `sonnet`, `haiku`, `fable`;
codex memuat GPT-6 Astra (`gpt-6-astra`).
Model baru tidak memerlukan perubahan kode Hanoman selama protokol katalog CLI kompatibel.
Ketersediaan tetap bergantung pada akun, konfigurasi provider, dan versi CLI. Hanoman tidak
mengupgrade CLI atau mengubah sesi yang sudah berjalan. Default runtime bawaan dapat di-seed saat
install/update; pilihan yang sudah diedit operator tidak diganti.

## Sumber dan batas

- Claude: control request `initialize` di stream-json, mengambil hanya `models`.
  Tidak mengirim pesan user/inferensi; hooks dimatikan, MCP dikosongkan, cwd temp kosong.
  **Alias native diutamakan.** `id` yang disimpan & diteruskan ke `--model` adalah `value` baris
  CLI (`default`, `opus[1m]`, `sonnet`, `haiku`), bukan `resolvedModel` terpatok; `resolved`
  ikut disimpan. Alias ikut berpindah saat CLI merilis model baru, jadi setelan tak basi dan
  tak ada id yang harus dipetakan ulang. `default` (rekomendasi CLI, label `Default
  (recommended) · <model>`) selalu di urutan pertama. Selain `default`, satu baris per
  `resolvedModel` — baris alias menang atas baris id-terpatok untuk model yang sama (dulu alias
  dan id terpatok sama-sama jadi entri, jadi satu model tampil dua/tiga kali). Terverifikasi
  2026-09-23, claude 2.1.280: `--model default|opus|sonnet|haiku` diterima dan masing-masing
  jatuh ke Opus 5.5 1M / Opus 5.5 / Sonnet 5 / Haiku 4.5.
- Lookup (`claudeModel()`) mencocokkan alias **atau** `resolved`, jadi setelan lama ber-id
  terpatok (`claude-sonnet-5`) tetap mendapat label & daftar effort alias yang menunjuknya;
  validasi custom agent (`modelKnownForRuntime`) dan `/model` Telegram menerima keduanya.
- `default` hanya sah untuk `--model` sesi. Subagent (`--agents`: custom agent, model per fase
  orkestrasi) menerima alias keluarga atau id penuh, jadi picker-nya memakai
  `subagentClaudeModels()` / `runtimeSubagentModels()` yang membuang `default`. Picker saja tak
  cukup: sel fase kosong mewarisi model ORCHESTRATOR, yang boleh `default`. `resolvePhasePlan`
  karena itu memetakan `default` (dari orchestrator, sel, atau override) ke `inherit` untuk claude —
  nilai sah `--agents` yang berarti "model percakapan utama" (dokumen sub-agents Claude Code);
  UI melabelinya "warisi orchestrator".
- Statusline subagent memetakan label lewat alias **dan** `resolved`: stdin claude membawa id
  terpatok yang dipakai runtime (`claude-opus-5`), bukan alias katalog.
- Codex: `codex debug models`, tanpa `--bundled`, mengambil slug, nama, effort dan minimum
  client bila diberikan. Entri `visibility: hide` tidak masuk hasil discovery.
- Antigravity: `agy models` stdout berupa `slug<TAB>label` (receipt CLI 1.3.4, 2026-10-14:
  sepuluh baris/462 byte, fixture `server/test/fixtures/antigravity-models-1.3.4.tsv`).
  Parser mengambil hanya slug/label; suffix `low|medium|high` menjadi satu effort diketahui.
  Slug lain tetap tersedia dengan effort kosong. Child tetap memakai tier `inherit|flash|pro`,
  bukan katalog ini. Diagnostics stderr dibuang, tanpa inferensi atau login otomatis.
- Biner memakai `HANOMAN_CLAUDE_BIN`/`HANOMAN_CODEX_BIN`/`HANOMAN_ANTIGRAVITY_BIN` efektif. Dalam Podman,
  probe Claude/Codex memakai image, credential mount RO, network dan proxy sesi yang sama.
  Probe Antigravity ditolak pada sandbox/hardening sebelum membuat proses host; status provider
  menjelaskan dukungan host/lab saja, sambil mempertahankan katalog terakhir. Env probe memakai
  builder runtime: kedua credential Antigravity hanya pada Antigravity, `GOOGLE_*` lain utuh.
- Satu refresh aktif, provider diperiksa serial; timeout per proses **20 detik**, stdout
  maksimal **4 MiB**. CLI yang macet dihentikan per proses, tidak dengan pola nama.
- Refresh dikoaleskan untuk biner/mode yang sama. Key biner efektif dan sandbox/hardening dibaca
  saat admission serta sesudah await. Perubahan konfigurasi membatalkan hasil generasi lama
  (success/error/status/cache); refresh baru dapat berjalan tanpa menunggu probe lama. `finally`
  lama tidak boleh melepas promise baru. Cache commit memeriksa key kembali sebelum rename.

CLI yang terpasang adalah sumber RESMI begitu ia berhasil menjawab — hasilnya MENGGANTIKAN
katalog per-provider itu, bukan digabung selamanya dengan fallback bawaan statis. Fallback
bawaan (`shared/src/entities.ts`) hanya dipakai sebelum probe pertama sukses, atau selagi
probe gagal berturut-turut (state lama dipertahankan, lihat di bawah) — union permanen dulu
membuat id lama yang sudah diganti/dipensiunkan CLI tak pernah hilang dari picker walau CLI
sudah tak menyebutnya lagi. Karena itu daftar adalah pilihan model, bukan bukti setiap model
bisa dipakai akun tersebut. Kegagalan satu provider tidak menghapus hasil terakhir atau
menahan pembaruan provider lain.
`source: cli` berarti CLI mengembalikan katalog, bukan bukti refresh jaringan provider sukses:
CLI sendiri mungkin memakai cache internal atau katalog bundled-nya.

Cache `$HANOMAN_HOME/model-catalog.json` ditulis atomik, permission 0600, LOCAL-only.
Hanya field katalog yang disimpan; akun, token, prompt dan keluaran mentah CLI tidak ikut.
Cache lama tanpa provider Antigravity mendapat fallback minimal provider ini; unknown field
dibuang, effort Antigravity dihitung ulang dari slug konservatif. Temp file unik dibuat `wx`
0600 dan dihapus sesudah commit/dibatalkan. Cache rusak/absen memakai fallback; kegagalan write
terlihat dalam status.

## Distribusi dan pemakai

`GET /api/models` menerima cookie atau agent token (`GLOBAL_READ`, ADR-0187), mengembalikan
snapshot tanpa memulai probe. `hanoman_models` existing menerima filter `antigravity`; penambahan
provider/WS merupakan perluasan DTO tool existing tanpa capability atau route baru (ADR-0202).
Frame `{t:"models",catalog}` menumpang WebSocket events yang sudah ada, cookie-only,
diperiksa untuk perubahan setiap 3 detik. Browser melakukan satu fetch saat pemakai pertama
mount dan menerima push berikutnya; response HTTP yang kalah cepat dari WS diabaikan.
Response server versi lama tanpa Antigravity dinormalisasi ke fallback minimal.
`replaceModelCatalog(claude,codex,antigravity?)` mempertahankan pemanggil dua-argumen lama;
argumen ketiga memperbarui binding parent Antigravity untuk picker yang telah terpasang.

`replaceModelCatalog` memasang binding katalog shared untuk pemakai lama sekaligus:
Settings, Start, New Terminal, cron, custom agent, validasi custom agent, pemilihan effort,
dan perintah Telegram. Metadata effort Claude juga per model bila CLI menyediakannya;
tanpa metadata tetap memakai daftar effort lama. Effort custom agent adalah string berbatas,
dengan keabsahan pasangan diperiksa terhadap katalog pada boundary route.

Settings menghitung opsi saat render dan menampilkan sumber, waktu pemeriksaan, serta error.
Default global tetap keputusan operator. Model Codex yang ditemukan runtime tidak
ditimpa oleh peta pensiun historis ketika settings dibaca.

Default bawaan claude (`BUILTIN_CLAUDE_RUNTIME_DEFAULTS`, sel orkestrasi per fase, default
`zSetting`/konflik/lead/Telegram/portal) memakai alias `sonnet`/`opus`/`haiku`
(`RUNTIME_DEFAULTS_VERSION` 2026-09-23-v2; v2 membedakan effort per peran fase, lihat amandemen
ADR-0164 2026-09-23). Seed boot menimpa nilai yang masih berstatus
`seeded` — jadi instalasi yang dulu di-seed `claude-sonnet-5` pindah ke `sonnet` sendiri —
sedangkan id terpatok yang DIPILIH operator (`user`) dibiarkan. `RETIRED_MODELS` memetakan
`claude-opus-4-8` ke alias `opus`.

Ketiga picker (Settings, "Mulai sesi", "Sesi baru") memakai `modelSelectOptions()`
(`shared/src/entities.ts`) untuk membangun opsi Select: nilai TERSIMPAN yang sudah tak ada di
katalog (model dipensiunkan CLI, atau baris ditulis via PUT ber-AgentToken dengan id di luar
katalog) tetap ditambahkan sebagai satu opsi apa adanya, supaya operator tidak kehilangan model
yang sedang dipakai hanya karena katalog runtime berubah — picker tak boleh tampil kosong/reset
diam-diam. Bila nilai itu id terpatok yang sedang ditunjuk sebuah alias, labelnya
`<label alias> (terpatok: <id>)` supaya tak terbaca sebagai duplikat baris alias; operator yang
ingin ikut model baru cukup memilih alias-nya sekali.

## Verifikasi

Fixture model masa depan membuktikan penambahan ID/effort tanpa perubahan allowlist.
Test mencakup refresh concurrent, offline/recovery, cache, timeout, transport tanpa inference,
boundary Podman, pembaruan picker mounted, validasi custom agent, HTTP dan izin frame WS.
Probe lokal 2026-09-05 mengembalikan Fable 5.1 dan Astra beserta effort-nya.
Kontrak metadata Claude terdokumentasi pada
[referensi supportedModels](https://code.claude.com/docs/en/agent-sdk/typescript);
Hanoman menggunakan protokol CLI secara langsung, tanpa menambahkan SDK eksekusi.
