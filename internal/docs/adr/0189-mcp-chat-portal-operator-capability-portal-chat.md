# ADR-0189 — Chat portal sisi operator terjangkau agen: domain capability `portal-chat`, ekspor dan tulis-PRD sebagai tool `danger`

Tanggal: 2026-10-11
Status: diterima
SPEC: — (permintaan eksplisit pemilik: route REST yang belum jadi tool MCP dibungkus)
**Mengamandemen ADR-0129** (permukaan operator chat portal, tak pernah dipertimbangkan untuk agen) dan melengkapi **ADR-0065**
**Tidak mengubah ADR-0110**: `/api/portal/**` (sesi cookie klien) dan `/api/client-accounts*` TETAP cookie-only
Terkait: ADR-0100 (data keluar workspace), ADR-0155 (mode `danger`), SPEC-405, ADR-0157

## Konteks

ADR-0129 (SPEC-854) memberi operator empat route untuk obrolan portal klien:

| Route | Fungsi |
|---|---|
| `GET /portal-chat/sessions?project=` | daftar sesi + `clientEmail` + `kuota` |
| `GET /portal-chat/sessions/:id` | satu sesi: PRD draft + seluruh pesan (termasuk `rawText` yang tertolak gerbang) |
| `POST /portal-chat/sessions/:id/prd` | menulis `docs/prd/<slug>.md` di checkout repo |
| `GET /portal-chat/export?project&from&to` | NDJSON seluruh transkrip + email klien (untuk training) |

Prefix `portal-chat` tak dikenal peta → `null` → cookie-only. Ini **berbeda** dari `portal` (sesi
cookie klien) yang ADR-0110 tutup dengan alasan kuat: responsnya bergantung `req.user`/akun klien.
Permukaan `portal-chat` adalah sisi *operator* — pemanggilnya admin, dan agen yang membantu operator
(membaca ide klien, menyusun backlog dari PRD draft) tak punya jalur ke sana.

## Pemeriksaan handler (syarat tugas)

`routes/portal-chat-admin.ts` **tidak membaca `req.user`** di satu pun dari empat route. Admin vs klien
dipisah SEBELUM handler oleh `clientRouteAllowed` (deny-by-default, ADR-0110): tak satu route pun
terdaftar di sana, jadi akun klien selalu 403 (test `portal-chat-admin.route.test.ts` +
`mcp-observability.route.test.ts` menegaskannya). Datanya per-project, bukan per-akun-pemanggil.
**Tidak ada data per-akun yang membuat capability tak bermakna.**

Yang perlu dilaporkan: isinya **data pribadi pihak ketiga** (email klien, percakapan klien) dan
`POST …/prd` menulis ke filesystem dengan isi yang berasal dari percakapan klien.

## Keputusan

### 1. Domain capability BARU: `portal-chat:read` / `portal-chat:write`

`capabilityForRoute`: segmen pertama `portal-chat` (dicocokkan PERSIS, bukan prefix `portal`) →
`rw("portal-chat")` dari METHOD. Opt-in, tidak diwarisi capability lama. Domain sendiri karena:

- membaca percakapan klien + email mereka bukan `projects:read`/`support:read`; mencentang
  "Projects — baca" tak boleh diam-diam membuka transkrip klien;
- menulis PRD ke checkout bukan `docs:write` yang dipahami manusia ("tulis file .md project") —
  isinya berasal dari percakapan klien yang diringkas agen, dan dibaca sesi agen berikutnya.
  `portal-chat:write` ditandai `risk: "exec"` di grid Settings, kelas yang sama dengan `skills:write`
  (mengubah apa yang dibaca sesi berikutnya).

Ekspor TIDAK diberi capability `danger` tersendiri: daftar + detail sesi sudah memaparkan data yang
sama per sesi (email + seluruh pesan), jadi pemisah itu teater — pemegang `portal-chat:read` bisa
mengumpulkan korpus yang sama dengan memanggil detail satu per satu. Yang nyata: mode `danger`
menyembunyikannya dari tingkat default agar tak terpanggil tak sengaja.

### 2. Empat tool

| Tool | Mode | Capability |
|---|---|---|
| `hanoman_portal_admin_chat_sessions` | baca | `portal-chat:read` |
| `hanoman_portal_admin_chat_session_get` | baca | `portal-chat:read` |
| `hanoman_portal_admin_chat_export` | `danger` | `portal-chat:read` |
| `hanoman_portal_admin_chat_prd_write` | `danger` | `portal-chat:write` |

- **Daftar** selalu mengirim `limit` (default 20): tanpanya server mengembalikan SELURUH sesi.
- **Detail**: pesan dipaginasi sebagai `items` (agar pemotong ukuran `renderResult` memangkas per
  item, bukan jatuh ke `preview` teks), teks dipotong 2000, `prdMarkdown` 6000 + `prdChars`.
- **Ekspor** (batas ukuran balasan MCP): server mengirim NDJSON utuh; wrapper mem-parse tiga bentuk
  yang bisa diserahkan klien MCP — multi-baris (string), SATU baris (lolos `JSON.parse` → objek),
  nol baris (`null`/`""`) — lalu memadatkan tiap sesi (pesan dipotong 800, `rawText` dibuang,
  PRD → `prdChars`) dan memaginasinya (default **5** sesi/halaman). Transkrip lengkap satu sesi:
  `hanoman_portal_admin_chat_session_get`.
- **Tulis PRD**: deskripsi menyebut bahwa berkas bernama sama DITIMPA, bahwa isinya masukan tak
  tepercaya, dan bahwa tool TIDAK membuat backlog (SPEC-854 huruf B tak berubah).

### 3. Perbaikan REST kecil: ekspor dengan tanggal cacat → 400

`GET /portal-chat/export?from=bukan-tanggal` dulu menghasilkan `Invalid Date` → Prisma melempar →
**500**. Pemanggil baru mengirim string bebas dari model, jadi route kini menolak 400
`{ error: "from|to bukan tanggal valid" }`. Satu-satunya perubahan perilaku REST di ADR ini;
pemanggil dashboard selalu mengirim ISO sah sehingga tak terdampak.

### 4. Redaksi

`cli/src/mcp/redact.ts` TIDAK diubah: tak ada rahasia (token/secret) di jalur ini — `redactToken`
hanya memaskir nilai token agen dan pola `hnm_agt_…`, dan balasan portal-chat tak memuatnya. Data
pribadi (email klien) bukan rahasia kredensial; perlindungannya adalah capability + mode `danger`
untuk ekspor, dan deskripsi tool yang menyebutnya data pribadi.

## Yang tetap TIDAK dibungkus (dan alasan)

`/api/portal/**` (termasuk `POST /portal/projects/:id/chat/sessions/:sid/messages`): sesi cookie
klien, respons bergantung `req.user`, dan POST-nya menjalankan satu giliran agen tersandbox atas
nama klien. Memberi agen operator jalan ke sana berarti agen bisa berbicara sebagai klien. Cookie-only
(ADR-0110 utuh); test `agent-capabilities.test.ts` mengikat `GET/POST /api/portal/**` → `COOKIE_ONLY`.

## Konsekuensi

- Nol migration. Capability bertambah 2 (bersama ADR-0188: 34 → 38, domain 15 → 17).
- Token lama tidak mewarisi: test memakai token berisi SEMUA capability lama dan memastikan 403
  `need: portal-chat:read|write`.
- Test: `mcp-observability.route.test.ts` (gerbang nyata via Bearer, shape() terhadap balasan nyata
  termasuk NDJSON satu-sesi, slug traversal 400, tulis PRD tak membuat backlog, klien tetap 403),
  `agent-capabilities.test.ts`, `mcp-catalog.observability.test.ts`.
