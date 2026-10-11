# ADR-0183 — Transfer berkas lewat tool MCP: unggah dari `filePath`, unduh ke `savePath`

Tanggal: 2026-10-11 · Status: diterima (permintaan pemilik repo)

**Mengamandemen** [ADR-0124](0124-lampiran-backlog-konteks-agen.md) §6 ("lampiran backlog tidak masuk
katalog MCP"), pengecualian lampiran/ekspor/impor Workspace QA di `server/test/mcp-coverage.test.ts`
(ADR-0174/0175), dan pengecualian `POST /projects/:id/upload`, `GET /projects/:id/archive`,
`POST /terminal/sessions/:id/attachments` yang bertumpu pada [ADR-0099](0099-mcp-server-hanoman.md)
("tool MCP berbentuk JSON teks"). Melanjutkan [ADR-0155](0155-mcp-cakupan-penuh-capability-danger.md)
(batas ada di capability, bukan di ketiadaan tool). Pelengkap: [ADR-0184](0184-batas-keamanan-transfer-berkas-mcp.md),
[ADR-0185](0185-capability-qa-delete.md), [ADR-0186](0186-mode-tool-transfer-menurut-efek-di-klien.md).

## Konteks

Audit cakupan menemukan 15 route yang dikecualikan karena "multipart" atau "biner". Alasannya benar
sebagai batasan bentuk — MCP server stdio berbicara JSON teks, dan byte biner dalam hasil tool
hanyalah sampah yang membakar konteks — tetapi bukan alasan untuk tidak menyediakan jalan sama
sekali: REST-nya sudah terjangkau agent token, jadi pengecualian hanya memaksa agen memakai `curl`
tanpa skema, tanpa batas ukuran, dan tanpa penjelasan galat. Pemilik repo meminta route-route itu
dibungkus.

## Keputusan

Satu mekanisme seragam, di dua tempat:

1. **Katalog tetap data murni.** `McpRequest` (shared) mendapat dua field OPSIONAL, saling
   independen dari `body`:
   - `multipart: { fields?, files: [{ field, filePath, name? }] }` — niat unggah. `fields` berurutan
     (route `/projects/:id/upload` membaca `dir → overwrite → manifest → berkas`).
   - `download: { mode: "file" | "inline", fallbackName, savePath?, overwrite? }` — niat unduh.
   `build()` tetap murni dan tak menyentuh `node:fs`; panel Settings (web) merender katalog yang
   sama. Tidak ada tipe `McpToolDef.build` baru — hanya bentuk `McpRequest` yang diperluas, jadi
   semua tool lama dan uji kontraknya tak berubah.
2. **Klien (`cli/src/mcp/client.ts` + `transfer.ts`) mengeksekusi niat itu.**
   - Unggah: argumen `filePath`/`filePaths` adalah path LOKAL di mesin klien MCP. Klien menilai path
     (ADR-0184), membaca berkas, merakit `FormData` (Content-Type diserahkan ke `fetch` agar
     memuat boundary). Satu berkas ditolak membatalkan SELURUH panggilan sebelum satu byte pun
     keluar.
   - Unduh: balasan 2xx dialirkan ke `savePath` lokal (default: direktori sementara aman milik MCP).
     Model menerima `{savedTo, filename, bytes, mime, sha256}`, **tidak pernah byte mentah**.
     `inline` hanya untuk teks kecil dan GAGAL (bukan memotong) bila kebesaran, menunjuk tool
     unduh-ke-berkas.
   - Galat HTTP tetap lewat `explainHttpError` yang sama (403 tetap menyebut `need`).

### Tool (18, `shared/src/mcp-catalog/transfer.ts`)

| Tool | Mode | Capability | Route |
|---|---|---|---|
| `hanoman_backlog_attachment_upload` | write | `backlog:write` | `POST /specs/:id/attachments` |
| `hanoman_backlog_attachment_download` | write | `backlog:read` | `GET /specs/:id/attachments/:attId` |
| `hanoman_ticket_attachment_download` | write | `support:read` | `GET /tickets/:id/attachments/:attId` |
| `hanoman_qa_attachment_upload` | write | `qa:write` | `POST …/qa/reports/:rid/attachments` |
| `hanoman_qa_attachment_download` | write | `qa:read` | `GET …/attachments/:aid` |
| `hanoman_qa_attachment_delete` | danger | `qa:delete` | `DELETE …/attachments/:aid` |
| `hanoman_qa_template_md` | read | `qa:read` | `GET /qa/template.md` |
| `hanoman_qa_template_xlsx` | write | `qa:read` | `GET /qa/template.xlsx` |
| `hanoman_qa_report_export_text` | read | `qa:read` | `GET …/export?format=md\|csv` |
| `hanoman_qa_report_export_file` | write | `qa:read` | `GET …/export?format=zip\|md\|csv\|docx\|pdf\|xlsx` |
| `hanoman_qa_import` | write | `qa:write` | `POST /projects/:pid/qa/import` |
| `hanoman_qa_cases_import` | write | `qa:write` | `POST …/cases/import` |
| `hanoman_ide_upload` | write | `ide:write` | `POST /projects/:id/upload` |
| `hanoman_ide_archive_download` | write | `ide:read` | `GET /projects/:id/archive` |
| `hanoman_session_attachment_upload` | write | `sessions:write` | `POST /terminal/sessions/:id/attachments` |
| `hanoman_qa_report_delete`, `_case_delete`, `_finding_delete` | danger | `qa:delete` | `DELETE` QA |

Capability route-route ini TIDAK berubah (kecuali DELETE QA, ADR-0185): tool hanya membungkus apa
yang sudah terjangkau token, dan tak melebarkan apa pun di sisi server. Kolom "Mode" dijelaskan di
ADR-0186.

### Yang tetap tidak dibungkus

`GET /terminal/sessions/:id/ws` dan `GET /events/ws` (WebSocket — aliran tak berujung, bukan
request-response) serta tiga route `dialog` (ADR-0142, gerbang keputusan manusia). Mekanisme di
atas tidak menyelesaikan salah satunya.

## Dampak

- `MCP_TOOL_SCHEMA_VERSION` tetap 2: penambahan tool dan field opsional bersifat aditif.
- `server/test/mcp-coverage.test.ts`: 14 entri `UNWRAPPED` dihapus (lampiran, ekspor, impor, unggah,
  arsip, template, hapus QA). Gerbang cakupan kini menegakkan bahwa route itu punya tool.
- Opsi baru `hanoman mcp`: `HANOMAN_MCP_TRANSFER_DIRS` / `--transfer-dir`,
  `HANOMAN_MCP_TRANSFER_MAX_BYTES` / `--transfer-max-bytes`.

## Penerimaan

- [x] Uji nyata: server lokal ber-`HANOMAN_HOME` sementara + `hanoman mcp` sungguhan lewat stdio:
  unggah/unduh/ekspor/impor/hapus berjalan; 403 tanpa capability menyebut `need`.
- [x] Test: `shared/src/mcp-catalog.transfer.test.ts`, `cli/test/mcp-transfer.test.ts`,
  `cli/test/mcp-client-transfer.test.ts`, `server/test/mcp-coverage.test.ts`.
