# ADR-0201 — Help Center publik anonim tidak dibungkus tool MCP

Tanggal: 2026-10-11
Status: diterima (keputusan atas permintaan pemilik repo untuk "membungkus yang bermakna")
SPEC: —
Terkait: ADR-0062 (Help Center publik) · ADR-0068 (lampiran tiket) · SPEC-352 (honeypot) · SPEC-805 (status tanpa gerbang `helpEnabled`) · ADR-0099/0155 (cakupan MCP) · ADR-0199/0200

## Konteks

Tiga route di `server/src/routes/help.ts` — `GET /help/:slug`, `POST /help/:slug/tickets`,
`GET /help/:slug/tickets/:key` — tak punya capability. Gerbang `/api` mem-bypass seluruh `/api/help*`
(`app.ts`), otorisasinya `helpEnabled` project + kunci opaque tiket, dan ingress publik mengizinkannya
dari origin publik. Permintaan: tentukan secara jujur mana yang layak jadi tool.

## Keputusan: tidak ada tool MCP untuk ketiganya

1. **`POST /help/:slug/tickets` (kirim tiket anonim) — tidak dibungkus.** Pengirimnya, secara desain,
   adalah pelapor MANUSIA tanpa akun: multipart dengan lampiran, honeypot `hc_trap`, dan rate-limit
   per IP+project (`help-ratelimit`). Tool MCP berarti agen operator membuat tiket atas nama "pelapor"
   — memalsukan sumbernya (email pelapor karangan), melewati honeypot/rate-limit yang dirancang untuk
   membendung otomatisasi, dan membanjiri antrean triase yang pembacanya manusia yang sama. Rate-limit
   per IP bahkan tak berarti apa-apa bagi proses lokal. Operator yang ingin mencatat laporan memakai
   jalur yang memang ada untuknya — `hanoman_backlog_create` (sumber `help`, `qa`, `brief`, dst.) —
   bukan menyamar sebagai pengunjung Help Center.
2. **`GET /help/:slug` dan `GET /help/:slug/tickets/:key` — tidak dibungkus.** Keduanya tidak membuka
   data baru bagi operator: info publik hanya `projectName` + kategori tetap; status publik adalah
   proyeksi sempit (`number, category, title, publicStatus, createdAt`) dari baris `Ticket` yang sudah
   terbaca penuh lewat `hanoman_tickets_list`/`hanoman_ticket_get` (`support:read`), dan URL publik project
   lewat `hanoman_help_center_get` (`projects:read`). Membungkusnya hanya menambah tool yang memerlukan
   kunci opaque (`key`) yang tak dipegang agen, lalu memberinya capability baru atau — lebih buruk —
   menempelkan `support:read` pada route yang sebenarnya anonim (gerbang tak pernah mengevaluasinya,
   jadi capability itu akan menjadi kebohongan di katalog).
3. **Peta capability tidak diubah**: `/api/help*` tetap `null` (bukan domain agen). Tes
   `agent-capabilities.test.ts` mengunci itu, dan tes gerbang nyata membuktikan token agen tak mengubah
   jawaban route. Ketiga route dicatat di `UNWRAPPED` mcp-coverage dengan alasan masing-masing, dan
   `docs/agent-integration.md` §5 menjelaskannya kepada agen.

## Konsekuensi

- Tak ada capability baru dan tak ada tool baru dari ADR ini.
- Bila kelak operator butuh "pratinjau tampilan publik", itu permintaan baru dengan jawaban baru
  (mis. membaca `helpUrl` lalu membuka halamannya) — bukan alasan membuka jalur kirim anonim.

## Penerimaan

- [x] Tiga route tercatat di `UNWRAPPED` dengan alasan; tes cakupan hijau.
- [x] `GET /api/help/:slug` dengan dan tanpa agent token menjawab identik (404 generik untuk project tak ada).
