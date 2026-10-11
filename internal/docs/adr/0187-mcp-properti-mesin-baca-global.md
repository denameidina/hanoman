# ADR-0187 — Properti mesin terjangkau agen: `/models`, `/methods/status`, `/codex/version` jadi baca-global, dan `hanoman_health`

Tanggal: 2026-10-11
Status: diterima
SPEC: — (permintaan eksplisit pemilik: route REST yang belum jadi tool MCP dibungkus)
**Mengamandemen ADR-0114 §4** ("`methods` → cookie-only") dan keputusan SPEC-339 (`/codex/version` & `/models` cookie-only)
Melanjutkan **ADR-0157** (tool untuk route `GLOBAL_READ`) · Terkait: ADR-0099 (MCP), ADR-0065 (capability), SPEC-405/ADR-0088 (`GLOBAL_READ` hanya untuk method baca), ADR-0037 (observabilitas, bukan gerbang)

## Konteks

Audit cakupan menemukan empat route observabilitas tanpa tool MCP, dengan keadaan gerbang berbeda:

| Route | Gerbang sebelum ADR ini | Isi |
|---|---|---|
| `GET /models` | `COOKIE_ONLY` (prefix `models`) | katalog model claude/codex hasil probe CLI + status probe per penyedia |
| `GET /methods/status` | `null` → cookie-only | kesiapan skill metode per agen (path home/roots skill di mesin ini) |
| `GET /codex/version` | `null` → cookie-only | versi codex CLI terpasang vs minimum |
| `GET /health` | `GLOBAL_READ` + `PUBLIC` | `{ ok: true }` |

Ketiga yang pertama lahir sebagai data **picker dashboard** (SPEC-339, SPEC-739), dan "cookie-only"
di sana adalah akibat tak adanya entri di `capabilityForRoute`, bukan keputusan keamanan yang
ditimbang. ADR-0114 §4 menyebutnya tegas ("properti MESIN … cookie-only seperti `/codex/version`"),
tetapi alasan yang ditulis hanya "ini properti mesin yang dibaca dashboard, bukan permukaan kerja
agen" — dan itu persis yang membuatnya layak dibaca agen: agen yang harus memilih `model`/`effort`
untuk `hanoman_session_create` atau `hanoman_agent_create` tak punya cara lain selain menebak id.

## Pemeriksaan handler (syarat tugas)

Capability hanya bermakna bila data tak bergantung akun. Ketiga handler diperiksa satu per satu:

- `GET /models` → `modelCatalogService.snapshot()`; tak membaca `req.user`/`req.agent`. Katalognya
  di-allowlist `parseCachedCatalog` ("raw initialize includes account details and must never be
  cached"); test `model-catalog.route.test.ts` menegaskan tak ada `account` di respons.
- `GET /methods/status` → `methodStatusReport()` memindai disk mesin; tak membaca identitas
  pemanggil. Memuat path absolut `home`/`roots` skill — kelas informasi yang sama dengan
  `GET /fs/browse` (sudah `GLOBAL_READ`).
- `GET /codex/version` → `codexVersionInfo()`; cache 5 menit seluruh-proses, tak per-akun.

Tak satu pun memakai `req.user`. **Tidak ada data per-akun yang membuat capability tak bermakna.**

## Keputusan

### 1. Tiga route pindah ke `GLOBAL_READ`, HANYA untuk method baca

`capabilityForRoute`: `models`, `methods`, `codex` bergabung dengan `limits/update/events/fs/health`
dalam cabang `read ? "GLOBAL_READ" : "COOKIE_ONLY"`. Bentuk itu (bukan `return "GLOBAL_READ"`) adalah
pelajaran SPEC-405: route tulis yang kelak lahir di prefix itu otomatis cookie-only. Tak ada capability
baru — `GLOBAL_READ` memang artinya "terjangkau setiap agent token sah", dan ketiga data ini tidak
rahasia, tidak per-akun, dan tidak mengubah apa pun.

`models` keluar dari daftar cookie-only. Grup WebSocket `models` di `/events/ws` **tetap** `cookieOnly`
(`services/events.ts`) — frame siar itu urusan dashboard, tak ada tool yang menyentuhnya, dan
melonggarkannya tak diminta siapa pun.

### 2. Empat tool baca-saja, `capability: null`

`hanoman_models` (opsional `agent` menyaring satu penyedia), `hanoman_codex_version`,
`hanoman_methods_status`, `hanoman_health`. Dibungkus di `shared/src/mcp-catalog/observability.ts`.
Memasang pembaruan/skill tetap tindakan manusia — tak ada tool tulis untuk ketiganya.

### 3. `hanoman_health` dibungkus (bukan dibiarkan tanpa tool)

Pertanyaan tugas: masuk akal sebagai tool? **Ya, ringan.** `hanoman_about` sengaja tidak menyentuh
jaringan (ia melaporkan konfigurasi lokal), sehingga agen tak punya cara mengetahui apakah host
*hidup* selain menebak dari 401. `GET /health` publik dan murah; membungkusnya memberi tombol
"host-nya hidup, jadi masalahnya token/master switch" — pemisahan yang sama yang dilakukan probe
otomatis di `cli/src/mcp/client.ts`, tetapi kini bisa diminta agen sendiri. Hanya `{ ok: true }`;
tak ada rahasia, tak ada beban.

## Konsekuensi

- Nol endpoint baru, nol migration, nol capability baru. Aditif: token lama tak kehilangan apa-apa.
- Test yang mengikat: `server/test/agent-capabilities.test.ts` (baca = `GLOBAL_READ`, POST/PUT/DELETE
  = `COOKIE_ONLY`), `server/test/mcp-observability.route.test.ts` (token tanpa capability → 200;
  token berkapasitas penuh tak bisa menulis), `server/test/model-catalog.route.test.ts` (diperbarui:
  `/models` tak lagi `COOKIE_ONLY`), `shared/src/mcp-catalog.observability.test.ts`.
- Gerbang cakupan (`mcp-coverage.test.ts`) tak berubah: ketiga route sudah `GLOBAL_READ`, jadi kini
  *wajib* punya tool — dan punya.
- Dokumen `docs/agent-integration.md` dan `api-contract.md` diperbarui; ADR-0114 §4 kini diamandemen
  oleh ADR ini.
