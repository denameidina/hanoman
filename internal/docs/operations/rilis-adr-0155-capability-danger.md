# Catatan rilis — ADR-0155: capability berakses `danger` (BREAKING)

**Rilis ini mempersempit setiap agent token yang sudah terbit.** Baca sebelum upgrade.

## Apa yang berubah

Empat operasi paling tajam dipecah dari `:write` menjadi capability tersendiri berakses ketiga,
**`danger`** — dan `:write` **tidak** mengimplikasikannya:

| Capability baru | Yang pindah ke sana |
|---|---|
| `sessions:spawn` | membuka sesi agen baru (`POST /terminal/sessions`) |
| `ide:git` | merge, rebase, pull, drop, hapus branch, hapus worktree |
| `backlog:lifecycle` | integrate, hapus backlog, geser stage |
| `vps:exec` | console, session, provision, harden, remediate, probe, test, audit |

Tak ada migration dan tak ada perubahan skema: `AgentToken.capabilities` bertipe `Json`, dan
**tak satu baris token pun disentuh**. Itulah yang membuat rilis ini breaking — hak berbahaya
harus lahir dari tindakan sadar, bukan diwarisi diam-diam.

## Yang akan patah, dan cara membetulkannya

### 1. Gateway Telegram TIDAK AKAN MENYALA

`TELEGRAM_REQUIRED_CAPABILITIES` bertambah empat, dan gateway menolak start bila **satu pun**
kurang — bukan 403 per-panggilan, tapi gateway tak jalan sama sekali. Ini kelas kegagalan SPEC-491
("Telegram diam total").

**Perbaikan:** Settings → Akses AI Agent → cabut token gateway, buat ulang dengan keempat kotak
kolom **berbahaya** dicentang, lalu pasang tokennya kembali di kredensial Telegram. Panel
menampilkan daftar capability yang kurang, jadi kamu tak perlu menebak.

### 2. Agent token lain kehilangan hak berbahayanya

Token ber-`sessions:write` berhenti bisa membuka sesi; ber-`ide:write` berhenti bisa merge/rebase;
ber-`backlog:write` berhenti bisa integrate/hapus/geser stage; ber-`vps:write` berhenti bisa
menjalankan perintah remote.

Kegagalannya **bisa dibaca**: 403 menyebut capability yang kurang (`{"error":"capability
required","need":"sessions:spawn"}`), dan panel Settings menandai token yang menyempit dengan
kalimat yang menyebut hak yang HILANG.

**Perbaikan:** centang capability berbahaya yang memang diperlukan token itu. Kalau ternyata tak
diperlukan, biarkan — penyempitannya justru yang diinginkan.

## Yang bertambah

MCP kini mencakup **seluruh permukaan REST yang terjangkau agent token**: 151 tool, dari 17.
Tingkat mode bertambah jadi tiga:

```
hanoman mcp --read-only     →  62 tool
hanoman mcp                 → 117 tool   (default; tool berbahaya TAK terlihat)
hanoman mcp --danger        → 151 tool
```

`HANOMAN_MCP_DANGER=1` setara `--danger`. Yang lebih sempit selalu menang, dan memberi keduanya
sekaligus menghasilkan keluhan, bukan diam.

**`--danger` BUKAN kontrol keamanan.** Ia menentukan tool mana yang *terlihat*; yang menahan
sungguhan adalah capability pada token. Sebuah tool bisa terlihat dan tetap menjawab 403 — itu
perilaku yang benar.

## Yang tetap TIDAK tersedia lewat MCP

Bukan karena terlewat: kredensial Telegram (ADR-0097), dialog sesi `AskUserQuestion` (SPEC-899 —
agen yang bisa menjawabnya bisa menjawab pertanyaannya sendiri), cronjob scheduler (ADR-0112 —
cron adalah `POST /terminal/sessions` yang ditunda), unggahan multipart, unduhan biner, dan field
`password` VPS.

## Rujukan

[ADR-0155](../adr/0155-mcp-cakupan-penuh-capability-danger.md) · mengamandemen
[ADR-0099](../adr/0099-mcp-server-hanoman.md) §4 dan ADR-0065.
